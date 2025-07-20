// scripts/fetch-liquidations.js
const fs = require('fs');

(async () => {
  const SYMBOL   = 'BTCUSDT';
  const ENDPOINT = `https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${SYMBOL}`;

  // Define the windows we care about (in ms)
  const WINDOWS = {
    '1h':  1  * 60 * 60 * 1000,
    '4h':  4  * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000
  };

  // 1) Fetch the forced-orders list with a browser UA
  let orders;
  try {
    const resp = await fetch(ENDPOINT, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    orders = await resp.json();  // array of { price, origQty, side, time, ... }
  } catch (e) {
    console.error(`Failed to fetch Binance forced orders: ${e.message}`);
    // write zeros so your Edge Function still works
    const zero = { long: 0, short: 0, total: 0 };
    fs.writeFileSync('./public/liquidation-data.json', JSON.stringify({
      '1h': zero, '4h': zero, '24h': zero
    }, null, 2));
    process.exit(1);
  }

  const now = Date.now();
  const result = {};

  // 2) For each window, sum USD value of liquidations by side
  for (const [label, ms] of Object.entries(WINDOWS)) {
    const cutoff = now - ms;
    let long = 0, short = 0;

    for (const o of orders) {
      if (o.time < cutoff) continue;
      const qty = parseFloat(o.origQty || o.quantity || 0);
      const price = parseFloat(o.price || 0);
      const usd = price * qty;
      // side==='SELL' means a LONG was liquidated
      if (o.side === 'SELL')  long  += usd;
      else if (o.side === 'BUY') short += usd;
    }

    result[label] = {
      long:  +long.toFixed(2),
      short: +short.toFixed(2),
      total: +((long + short).toFixed(2))
    };
  }

  // 3) Write JSON for Netlify to serve
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(result, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', result);
})();
