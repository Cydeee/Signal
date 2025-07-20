// scripts/fetch-liquidations.js
const fs = require('fs');

(async () => {
  const intervals = ['1h', '4h', '24h'];
  const out = {};

  for (const interval of intervals) {
    try {
      // Build the history endpoint URL
      const url = new URL('https://open-api-v4.coinglass.com/api/futures/liquidation/history');
      url.searchParams.set('symbol', 'BTCUSDT');
      url.searchParams.set('period', interval);
      url.searchParams.set('limit', '1');   // only need the most recent point

      const res  = await fetch(url.toString(), { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const js   = await res.json();
      const data = Array.isArray(js.data) ? js.data[0] : null;
      if (!data) throw new Error('no data in response');

      const long  = parseFloat(data.long_liquidation_usd  || data.long_liquidation_amount  || 0);
      const short = parseFloat(data.short_liquidation_usd || data.short_liquidation_amount || 0);
      const total = parseFloat((long + short).toFixed(2));

      out[interval] = { long, short, total };
    } catch (e) {
      console.error(`Error fetching ${interval}:`, e.message);
      out[interval] = { long: 0, short: 0, total: 0 };
    }
  }

  // Write to public/liquidation-data.json so Netlify can serve it
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', out);
})();
