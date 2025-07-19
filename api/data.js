// api/data.js
export default async function handler(req, res) {
  const SYMBOL = 'BTCUSDT';
  const LIMIT  = 250;

  // — Helpers (EMA, RSI, ATR, etc.) — copy your client logic:
  const sma = (a, p) => a.slice(-p).reduce((s, x) => s + x, 0) / p;
  const std = (a,p) => { const s=a.slice(-p), m=sma(s,p); return Math.sqrt(s.reduce((t,x)=>t+(x-m)**2,0)/p) };
  const ema = (a,p) => {
    if (a.length < p) return 0;
    const k = 2/(p+1);
    let e = sma(a.slice(0,p),p);
    for (let i=p; i<a.length; i++) e = a[i]*k + e*(1-k);
    return e;
  };
  const rsi = (a,p) => {
    if (a.length < p+1) return 0;
    let gains=0, losses=0;
    for (let i=1; i<=p; i++){
      const d = a[i]-a[i-1];
      if (d>=0) gains+=d; else losses-=d;
    }
    let ag=gains/p, al=losses/p;
    for (let i=p+1; i<a.length; i++){
      const d=a[i]-a[i-1];
      ag = (ag*(p-1) + Math.max(d,0))/p;
      al = (al*(p-1) + Math.max(-d,0))/p;
    }
    return al===0?100:100-100/(1+ag/al);
  };
  const atr = (h,l,c,p) => {
    if (h.length < p+1) return 0;
    const trs = [];
    for (let i=1; i<h.length; i++){
      trs.push(Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1])));
    }
    return sma(trs.slice(-p),p);
  };

  // — BLOCK A —
  const intervals = ['15m','1h','4h','1d'];
  const dataA = {};
  await Promise.all(intervals.map(async (tf) => {
    const rows = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`
    ).then(r=>r.json());
    const c = rows.map(r=>+r[4]), h = rows.map(r=>+r[2]), l = rows.map(r=>+r[3]);
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
  const fr = await fetch(
    `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000}`
  ).then(r=>r.json());
  const arr = fr.slice(-42).map(d=>+d.fundingRate);
  const mean = arr.reduce((s,x)=>s+x,0)/arr.length;
  const sd   = Math.sqrt(arr.reduce((t,x)=>t+(x-mean)**2,0)/arr.length);
  const z    = sd ? ((arr.at(-1)-mean)/sd).toFixed(2) : "0.00";
  const [oiN,oiH] = await Promise.all([
    fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`).then(r=>r.json()),
    fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`).then(r=>r.json())
  ]);
  const pct = (((+oiN.openInterest - +oiH[0].sumOpenInterest)/+oiH[0].sumOpenInterest)*100).toFixed(1);
  const dataB = { fundingZ: z, oiDelta24h: pct };

  // — BLOCK D —
  const [cg, fg] = await Promise.all([
    fetch('https://api.coingecko.com/api/v3/coins/bitcoin').then(r=>r.json()),
    fetch('https://api.alternative.me/fng/?limit=1').then(r=>r.json())
  ]);
  const dataD = {
    sentimentUpPct: cg.sentiment_votes_up_percentage.toFixed(1),
    fng: fg.data[0].value_classification
  };

  // — BLOCK E —
  const g = await fetch('https://api.coingecko.com/api/v3/global').then(r=>r.json()).then(j=>j.data);
  const dataE = {
    mcapT:  (g.total_market_cap.usd/1e12).toFixed(2),
    mcapΔ:  g.market_cap_change_percentage_24h_usd.toFixed(2),
    btcDom: g.market_cap_percentage.btc.toFixed(2),
    ethDom: g.market_cap_percentage.eth.toFixed(2)
  };

  res.status(200).json({ dataA, dataB, dataD, dataE, timestamp: Date.now() });
}
