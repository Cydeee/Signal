// netlify/edge-functions/data.js
//
// Returns JSON containing:
//   • dataA  – price / volatility / trend indicators
//   • dataB  – derivatives positioning
//   • dataC  – long & short liquidations (Binance, no key)
//   • dataD  – sentiment gauges
//   • dataE  – macro market context
//   • errors – any issues encountered

export default async (_req) => {
  const SYMBOL = 'BTCUSDT';         // USDT-margined perp
  const LIMIT  = 250;               // klines per tf for bloc A

  const result = {
    dataA: {}, dataB: null, dataC: {}, dataD: null, dataE: null, errors: []
  };

  /* ───────── indicator helpers ───────── */
  const sma = (a, p) => a.slice(-p).reduce((s, x) => s + x, 0) / p;
  const std = (a, p) => {
    const slice = a.slice(-p), m = sma(slice, p);
    return Math.sqrt(slice.reduce((t, x) => t + (x - m) ** 2, 0) / p);
  };
  function ema(a, p) {
    if (a.length < p) return 0;
    const k = 2 / (p + 1);
    let e = sma(a.slice(0, p), p);
    for (let i = p; i < a.length; i++) e = a[i] * k + e * (1 - k);
    return e;
  }
  function rsi(a, p) {
    if (a.length < p + 1) return 0;
    let gains = 0, losses = 0;
    for (let i = 1; i <= p; i++) {
      const d = a[i] - a[i - 1];
      d >= 0 ? (gains += d) : (losses -= d);
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

  /* ───────── BLOCK A – price / TA ───────── */
  for (const tf of ['15m', '1h', '4h', '1d']) {
    try {
      const rows = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`
      ).then(r => r.json());
      if (!Array.isArray(rows)) throw new Error('klines not array');

      const c = rows.map(r => +r[4]);
      const h = rows.map(r => +r[2]);
      const l = rows.map(r => +r[3]);
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

  /* ───────── BLOCK B – derivatives positioning ───────── */
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
        +oiHist[0].sumOpenInterest) *
      100
    ).toFixed(1);

    result.dataB = { fundingZ: z, oiDelta24h: pct24h };
  } catch (e) {
    result.errors.push(`B: ${e.message}`);
  }

  /* ───────── BLOCK C – long / short liquidations ───────── */
  try {
    const rows = await fetch(
      `https://fapi.binance.com/futures/data/forceOrders?symbol=${SYMBOL}&limit=1000`
    ).then(r => r.json());
    if (!Array.isArray(rows)) throw new Error('forceOrders not array');

    const now   = Date.now();
    const winHr = { '1h': 1, '4h': 4, '24h': 24 };
    const dataC = {};

    for (const [lbl, hrs] of Object.entries(winHr)) {
      const cutoff = now - hrs * 3_600_000;
      let longUsd = 0, shortUsd = 0;

      for (const o of rows) {
        if (o.time < cutoff) break;                // rows: newest → oldest
        const price = +o.price || +o.avgPrice || 0;
        const usd   = +o.origQty * price;
        // side 'SELL' → long position liquidated
        o.side === 'SELL' ? (longUsd  += usd)
                          : (shortUsd += usd);
      }

      dataC[lbl] = {
        long:  +longUsd.toFixed(2),
        short: +shortUsd.toFixed(2),
        total: +(longUsd + shortUsd).toFixed(2)
      };
    }

    // relative intensity tag (1 h vs 24 h hourly mean)
    const base  = Math.max(dataC['24h'].total / 24, 1);
    const ratio = dataC['1h'].total / base;
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

  /* ───────── BLOCK D – sentiment ───────── */
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

  /* ───────── BLOCK E – macro context ───────── */
  try {
    const gv = await fetch(
      'https://api.coingecko.com/api/v3/global'
    ).then(r => r.json());
    const g = gv.data;
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

  /* ───────── return response ───────── */
  return new Response(
    JSON.stringify({ ...result, timestamp: Date.now() }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
