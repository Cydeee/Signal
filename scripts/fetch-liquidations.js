// scripts/fetch-liquidations.js
const fs = require('fs');

(async () => {
  const EXCHANGE  = 'Binance';
  const SYMBOL    = 'BTC';
  const ENDPOINT  = `https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list?exchange=${EXCHANGE}`;

  // 1) Fetch the coin list
  const resp = await fetch(ENDPOINT);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching Coin List`);
  const js   = await resp.json();
  if (js.code !== '0') throw new Error(`API error: ${js.msg}`);

  // 2) Find BTC entry
  const entry = js.data.find(x => x.symbol === SYMBOL);
  if (!entry) throw new Error(`Symbol ${SYMBOL} not found in data`);

  // 3) Extract your three intervals
  const out = {};
  for (const interval of ['1h','4h','24h']) {
    const longKey  = `long_liquidation_usd_${interval}`;
    const shortKey = `short_liquidation_usd_${interval}`;
    const longVal  = parseFloat(entry[longKey])  || 0;
    const shortVal = parseFloat(entry[shortKey]) || 0;
    out[interval] = {
      long:  +longVal.toFixed(2),
      short: +shortVal.toFixed(2),
      total: +((longVal + shortVal).toFixed(2))
    };
  }

  // 4) Write to public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', out);
})();
