// netlify/edge-functions/data.js
//
// Edge-function that returns a JSON payload with:
//   dataA – price/volatility/trend indicators
//   dataB – derivatives positioning
//   dataC – long/short liquidation totals (Bybit, no-key)
//   dataD – sentiment gauges
//   dataE – macro market context
//
// Only bloc C was recently rewritten; everything else is as in your earlier file.

export default async (_request) => {
  const SYMBOL = 'BTCUSDT';   // USDT-margined perp (change later for other coins)
  const LIMIT  = 250;         // klines fetched per timeframe in bloc A

  const result = {
    dataA: {}, dataB: null, dataC: {}, dataD: null, dataE: null, errors: []
  };

  /* ───────────────────────── Indicator helpers ─────────────────────── */

  function sma(a, p) {
    return a.slice(-p).reduce((sum, x) => sum + x, 0) / p;
  }

  function std(a, p) {
    const slice = a.slice(-p);
    const m     = sma(slice, p);
    return Math.sqrt(slice.reduce((t, x) => t + (x - m) ** 2, 0) / p);
  }

  function ema(a, p) {
    if (a.length < p) return 0;
    const k = 2 / (p + 1);
    let e   = sma(a.slice(0, p), p);
    for (let i = p; i < a.length; i++) e = a[i] * k + e * (1 - k);
    return e;
  }

  function rsi(a, p) {
    if (a.length < p + 1) return 0;
    let gains = 0, losses = 0;
    for (let i = 1; i <= p; i++) {
      const d = a[i] - a[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    let avgG = gains / p, avgL = losses / p;
    for (let i = p + 1; i < a.length; i++) {
      const d = a[i] - a[i - 1];
      avgG = (avgG * (p - 1) + Math.max(d, 0)) / p;
      avgL = (avgL * (p - 1) + Math.max(-d, 0)) / p;
    }
    return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }

  function atr(h, l, c, p) {
    if (h.length < p + 1) return 0;
    const trs = [];
    for (let i = 1; i < h.length; i++) {
      trs.push(
        Math.max(
          h[i] - l[i],
          Math.abs(h[i] - c[i - 1]),
          Math.abs(l[i] - c[i - 1])
        )
      );
    }
    return sma(trs.slice(-p), p);
  }

  /* ──────────────────────────── BLOCK A ────────────────────────────── */
  for (const tf of ['15m', '1h', '4h', '1d']) {
    try {
      const rows = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`
      ).then(r => r.json());

      if (!Array.isArray(rows)) throw new Error('klines not array');

      const c    = rows.map(r => +r[4]);
      const h    = rows.map(r => +r[2]);
      const l    = rows.map(r => +r[3]);
      const last = c.at(-1) || 1;

      result.dataA[tf] = {
        ema50:  +ema(c, 50 ).toFixed(2),
        ema200: +ema(c, 200).toFixed(2),
        rsi14:  +rsi(c, 14 ).toFixed(1),
        bbPct:  +((4 * std(c, 20) / last) * 100).toFixed(2),
        atrPct: +((atr(h, l, c, 14) / last) * 100).toFixed(2)
      };
    } catch (e) {
      result.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  /* ──────────────────────────── BLOCK B ────────────────────────────── */
  try {
    const fr = await fetch(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`
    ).then(r => r.json());
    if (!Array.isArray(fr)) throw new Error('fundingRate not array');

    const arr  = fr.slice(-42).map(d => +d.fundingRate);
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const sd   = Math.sqrt(arr.reduce((t, x) => t + (x - mean) ** 2, 0) / arr.length);
    const z    = sd ? ((arr.at(-1) - mean) / sd).toFixed(2) : '0.00';

    const [oiNow, oiHist] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`)
        .then(r => r.json()),
      fetch(
        `https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`
      ).then(r => r.json())
    ]);

    if (typeof oiNow.openInterest !== 'string' || !oiHist[0]?.sumOpenInterest)
      throw new Error('OI shape unexpected');

    const pct24h = (
      ((+oiNow.openInterest - +oiHist[0].sumOpenInterest) /
        +oiHist[0].sumOpenInterest) * 100
    ).toFixed(1);

    result.dataB = { fundingZ: z, oiDelta24h: pct24h };
  } catch (e) {
    result.errors.push(`B: ${e.message}`);
  }

  /* ──────────────────────────── BLOCK C ────────────────────────────── */
  try {
    const nowMs   = Date.now();
    const windows = { '1h': 1, '4h': 4, '24h': 24 };
    const dataC   = {};

    // Resilient JSON fetch (3 retries, validates content-type)
    async function safeFetch(url) {
      for (let i = 0; i < 3; i++) {
        const res  = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0'   // helps bypass some edge CDN checks
          }
        });
        const ct   = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          await new Promise(r => setTimeout(r, 400));
          continue;                        // retry on HTML or empty body
        }
        const txt = await res.text();
        try { return JSON.parse(txt); }    // success
        catch { await new Promise(r => setTimeout(r, 400)); }
      }
      throw new Error('invalid JSON after retries');
    }

    // Fetch liquidation totals for a single window
    async function bybitBucket(hrs) {
      const start = nowMs - hrs * 3_600_000;
      let longUsd = 0, shortUsd = 0, cursor = '';

      while (true) {
        const url = new URL('https://api.bybit.com/v5/market/liquidation');
        url.searchParams.set('category',  'linear');          // USDT perps
        url.searchParams.set('symbol',    SYMBOL);
        url.searchParams.set('startTime', start.toString());
        url.searchParams.set('endTime',   nowMs.toString());
        url.searchParams.set('limit',     '1000');
        if (cursor) url.searchParams.set('cursor', cursor);

        const j = await safeFetch(url);
        if (j.retCode !== 0) throw new Error(`Bybit retCode ${j.retCode}`);

        const rows = j.result?.list ?? [];
        if (rows.length === 0) break;

        for (const r of rows) {
          const usd = +r.qty * +r.price;
          // Bybit: side ='Sell' → long position liquidated
          (r.side === 'Sell') ? (longUsd  += usd)
                              : (shortUsd += usd);
        }
        if (!j.result.nextPageCursor) break;
        cursor = j.result.nextPageCursor;
      }
      return { longUsd, shortUsd };
    }

    // Build every requested window
    for (const [lbl, hrs] of Object.entries(windows)) {
      const { longUsd, shortUsd } = await bybitBucket(hrs);

      dataC[lbl] = {
        long:  +longUsd.toFixed(2),
        short: +shortUsd.toFixed(2),
        total: +(longUsd + shortUsd).toFixed(2)
      };
    }

    // Simple relativity tag: 1 h vs 24 h hourly average
    const base   = Math.max(dataC['24h'].total / 24, 1);
    const ratio  = dataC['1h'].total / base;
    dataC.relative24h =
      ratio > 2   ? 'very high'
    : ratio > 1.2 ? 'high'
    : ratio < 0.5 ? 'low'
                 : 'normal';

    result.dataC = dataC;
  } catch (e) {
    result.errors.push(`C: ${e.message}`);
    result.dataC = {};
  }

  /* ──────────────────────────── BLOCK D ────────────────────────────── */
  try {
    const cg = await fetch(
      'https://api.coingecko.com/api/v3/coins/bitcoin'
    ).then(r => r.json());

    const upPct =
      cg.sentiment_votes_up_percentage ??
      cg.community_data?.sentiment_votes_up_percentage;
    if (upPct == null) throw new Error('Missing sentiment_votes_up_percentage');

    const fg = await fetch(
      'https://api.alternative.me/fng/?limit=1'
    ).then(r => r.json());

    const fgData = fg.data?.[0];
    if (!fgData) throw new Error('Missing Fear & Greed data');

    result.dataD = {
      sentimentUpPct: +upPct.toFixed(1),
      fearGreed:      `${fgData.value} · ${fgData.value_classification}`
    };
  } catch (e) {
    result.errors.push(`D: ${e.message}`);
  }

  /* ──────────────────────────── BLOCK E ────────────────────────────── */
  try {
    const gv = await fetch('https://api.coingecko.com/api/v3/global')
      .then(r => r.json());
    const g  = gv.data;
    if (!g?.total_market_cap?.usd) throw new Error('Missing global data');

    result.dataE = {
      totalMcapT:   +((g.total_market_cap.usd / 1e12).toFixed(2)),
      mcap24hPct:   +g.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance: +g.market_cap_percentage.btc.toFixed(2),
      ethDominance: +g.market_cap_percentage.eth.toFixed(2)
    };
  } catch (e) {
    result.errors.push(`E: ${e.message}`);
  }

  /* ──────────────────────────── RETURN ─────────────────────────────── */
  return new Response(
    JSON.stringify({ ...result, timestamp: Date.now() }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
