// scripts/fetch-liquidations.js
const fs = require('fs');

(async () => {
  const SYMBOL    = 'BTCUSDT';
  const ENDPOINT  = `https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${SYMBOL}`;
  const INTERVALS = [
    { key: '1h',  ms: 1  * 60 * 60 * 1000 },
    { key: '4h',  ms: 4  * 60 * 60 * 1000 },
    { key: '24h', ms: 24 * 60 * 60 * 1000 },
  ];

  // 1) Fetch all liquidation orders from Binance Futures (no API key needed)
  const now    = Date.now();
  const resp   = await fetch(ENDPOINT);
  if (!resp.ok) throw new Error(`Binance HTTP ${resp.status}`);
  const orders = await resp.json();  // array of {symbol, side, price, quantity, time, ...}

  // 2) Aggregate USD value by interval and side
  const out = {};
  for (const {key, ms} of INTERVALS) {
    const cutoff = now - ms;
    let long = 0, short = 0;
    for (const o of orders) {
      if (o.time < cutoff) continue;
      // USD value = price * quantity
      const usd = parseFloat(o.price) * parseFloat(o.origQty || o.orderQty || o.quantity);
      if (o.side === 'SELL') {
        // a SELL liquidation means a LONG position was closed
        long += usd;
      } else if (o.side === 'BUY') {
        // a BUY liquidation means a SHORT position was closed
        short += usd;
      }
    }
    out[key] = {
      long:  +long.toFixed(2),
      short: +short.toFixed(2),
      total: +((long + short).toFixed(2))
    };
  }

  // 3) Write the JSON so Netlify serves it at /public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', out);
})();
