// scripts/fetch-liquidations.js
const fs = require('fs');

(async () => {
  const SYMBOL   = 'BTCUSDT';
  const ENDPOINT = `https://api.bybit.com/v2/public/liq-records?symbol=${SYMBOL}&limit=2000`;

  // time windows in ms
  const WINDOWS = {
    '1h':  1  * 60 * 60 * 1000,
    '4h':  4  * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  };

  let data;
  try {
    const res = await fetch(ENDPOINT, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const js = await res.json();
    if (js.retCode !== 0) throw new Error(`API error: ${js.retMsg}`);
    data = js.result.data; // array of { price, qty, side, time, ... }
  } catch (e) {
    console.error(`Failed to fetch Bybit liq-records: ${e.message}`);
    // fallback all zeros
    const zero = { long: 0, short: 0, total: 0 };
    fs.writeFileSync(
      './public/liquidation-data.json',
      JSON.stringify({ '1h': zero, '4h': zero, '24h': zero }, null, 2)
    );
    process.exit(1);
  }

  const now = Date.now();
  const out = {};

  for (const [label, ms] of Object.entries(WINDOWS)) {
    const cutoff = now - ms;
    let long = 0, short = 0;

    for (const ev of data) {
      // Bybit returns timestamp in milliseconds
      if (ev.time < cutoff) continue;
      const price = parseFloat(ev.price);
      const qty   = parseFloat(ev.qty);
      const usd   = price * qty;
      // side "Sell" means liquidating LONG positions
      if (ev.side === 'Sell')  long  += usd;
      else if (ev.side === 'Buy') short += usd;
    }

    out[label] = {
      long:  +long.toFixed(2),
      short: +short.toFixed(2),
      total: +((long + short).toFixed(2))
    };
  }

  // write to public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );
  console.log('✅ liquidation-data.json updated:', out);
})();
