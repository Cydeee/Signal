// scripts/fetch-liquidations.js
const fs = require('fs');

;(async () => {
  // ─── CONFIG ─────────────────────────────────────────────────────────────────
  // Perpetual BTC-USDT on OKX
  const INST_TYPE = 'SWAP';  
  const INST_ID   = 'BTC-USDT-SWAP';
  // we'll grab up to 1,000 recent liquidation orders
  const LIMIT     = 1000;

  // time windows in milliseconds
  const WINDOWS = {
    '1h':  1  * 60 * 60 * 1000,
    '4h':  4  * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  };

  // ─── FETCH ──────────────────────────────────────────────────────────────────
  const url = `https://www.okx.com/api/v5/public/liquidation-orders`
            + `?instType=${INST_TYPE}`
            + `&instId=${INST_ID}`
            + `&limit=${LIMIT}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
  const { data } = await res.json();  
  // data: Array of { instType, instId, uly, px, sz, side, ts, ... }

  const now = Date.now();
  const out = {};

  // ─── AGGREGATE ───────────────────────────────────────────────────────────────
  for (const [label, span] of Object.entries(WINDOWS)) {
    const cutoff = now - span;
    let long = 0, short = 0;

    for (const o of data) {
      // OKX's ts is already in ms
      if (o.ts < cutoff) continue;
      // px = price, sz = quantity (in contracts). USD value = px * sz
      const usd = parseFloat(o.px) * parseFloat(o.sz);
      // OKX side="sell" means LONG positions were liquidated
      if (o.side.toLowerCase() === 'sell')  long  += usd;
      else if (o.side.toLowerCase() === 'buy') short += usd;
    }

    out[label] = {
      long:  +long.toFixed(2),
      short: +short.toFixed(2),
      total: +((long + short).toFixed(2))
    };
  }

  // ─── WRITE JSON ───────────────────────────────────────────────────────────────
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );
  console.log('✅ liquidation-data.json updated:', out);
})();
