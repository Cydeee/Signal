// netlify/functions/data.js

// ─── fetchJson helper with automatic proxy fallback ──────────────────────────
async function fetchJson(url) {
  const isBinance = url.includes('api.binance.com');
  const fetchUrl  = isBinance
    ? `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    : url;

  const res = await fetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) at ${fetchUrl}`);
  }
  const json = await res.json();
  console.log(`Fetched ${fetchUrl} →`, Array.isArray(json) ? `array[${json.length}]` : typeof json);
  return json;
}

// ─── Indicator helpers ───────────────────────────────────────────────────────
function sma(a, p) {
  return a.slice(-p).reduce((sum, x) => sum + x, 0) / p;
}
function std(a, p) {
  const slice = a.slice(-p);
  const m = sma(slice, p);
  return Math.sqrt(slice.reduce((t, x) => t + (x - m) ** 2, 0) / p);
}
function ema(a, p) {
  if (a.length < p) return 0;
  const k = 2 / (p + 1);
  let e = sma(a.slice(0, p), p);
  for (let i = p; i < a.length; i++) {
    e = a[i] * k + e * (1 - k);
  }
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

// ─── Netlify function handler ────────────────────────────────────────────────
exports.handler = async () => {
  const SYMBOL = 'BTCUSDT';
  const LIMIT  = 250;

  // — BLOCK A —
  const intervals = ['15m','1h','4h','1d'];
  const dataA = {};
  await Promise.all(intervals.map(async tf => {
    const url  = `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`;
    const rows = await fetchJson(url);
    if (!Array.isArray(rows)) throw new Error(`Expected klines array but got ${typeof rows}`);

    const c = rows.map(r => +r[4]), h = rows.map(r => +r[2]), l = rows.map(r => +r[3]);
    const last = c.at(-1) || 1;
    dataA[tf] = {
      ema50:  +ema(c,50).toFixed(2),
      ema200: +ema(c,200).toFixed(2),
      rsi14:  +rsi(c,14).toFixed(1),
      bbPct:  +((4*std(c,20)/last)*100).toFixed(2),
      atrPct: +((atr(h,l,c,14)/last)*100).toFixed(2),
    };
  }));

  // — BLOCK B —
  const fr = await fetchJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
  if (!Array.isArray(fr)) throw new Error(`Expected fundingRate array but got ${typeof fr}`);
  const arr = fr.slice(-42).map(d => +d.fundingRate);
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const sd   = Math.sqrt(arr.reduce((t, x) => t + (x - mean) ** 2, 0) / arr.length);
  const z    = sd ? ((arr.at(-1) - mean) / sd).toFixed(2) : '0.00';

  const [oiN, oiH] = await Promise.all([
    fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`),
    fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`)
  ]);
  const pct24h = (((+oiN.openInterest - +oiH[0].sumOpenInterest) / +oiH[0].sumOpenInterest) * 100).toFixed(1);
  const dataB  = { fundingZ: z, oiDelta24h: pct24h };

  // — BLOCK D —
  const cg = await fetchJson('https://api.coingecko.com/api/v3/coins/bitcoin');
  const fg = await fetchJson('https://api.alternative.me/fng/?limit=1');
  const dataD = {
    sentimentUpPct: +cg.sentiment_votes_up_percentage.toFixed(1),
    fearGreed:      `${fg.data[0].value} · ${fg.data[0].value_classification}`
  };

  // — BLOCK E —
  const gv = await fetchJson('https://api.coingecko.com/api/v3/global');
  const g  = gv.data;
  const dataE = {
    totalMcapT:   +((g.total_market_cap.usd / 1e12).toFixed(2)),
    mcap24hPct:   +g.market_cap_change_percentage_24h_usd.toFixed(2),
    btcDominance: +g.market_cap_percentage.btc.toFixed(2),
    ethDominance: +g.market_cap_percentage.eth.toFixed(2),
  };

  // ─── Return JSON ────────────────────────────────────────────────────────────
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataA, dataB, dataD, dataE, timestamp: Date.now() })
  };
};
