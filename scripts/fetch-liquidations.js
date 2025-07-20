// scripts/fetch-liquidations.js
const fs = require('fs');

(async () => {
  // 1) Define the intervals you need
  const intervals = ['15m', '1h', '4h', '24h'];
  const out = {};

  for (const interval of intervals) {
    if (interval === '15m') {
      // public API doesn’t expose a 15m aggregate
      out[interval] = { long: 0, short: 0, total: 0 };
      continue;
    }

    // 2) Build the URL for this timeframe
    //    CoinGlass’s public, no-key endpoint:
    //    https://open-api.coinglass.com/public/v2/liqHeatmap
    const url = new URL('https://open-api.coinglass.com/public/v2/liqHeatmap');
    url.searchParams.set('exchange', 'Binance');
    url.searchParams.set('symbol',  'BTCUSDT');
    url.searchParams.set('type',    interval);

    try {
      // 3) Fetch and parse JSON
      const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const js = await res.json();
      // Expecting something like:
      // { code:0, msg:"success", data:[ { symbol:"BTCUSDT", longLiquidationUsd:"1234.56", shortLiquidationUsd:"789.01" }, … ] }
      const entry = Array.isArray(js.data)
        ? js.data.find(x => x.symbol === 'BTCUSDT') || js.data[0]
        : null;
      if (!entry) throw new Error('no data in response');

      const long  = parseFloat(entry.longLiquidationUsd  || entry.longLiquidationAmount  || 0);
      const short = parseFloat(entry.shortLiquidationUsd || entry.shortLiquidationAmount || 0);
      const total = parseFloat((long + short).toFixed(2));

      out[interval] = { long, short, total };
    } catch (e) {
      console.error(`Error fetching ${interval}:`, e.message);
      out[interval] = { long: 0, short: 0, total: 0 };
    }
  }

  // 4) Write the combined JSON so Netlify serves it at /public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', out);
})();
