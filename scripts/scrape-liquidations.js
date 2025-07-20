// Signal/scripts/scrape-liquidations.js
const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');

(async () => {
  // 1. Launch headless browser (for any cookies/CORS setup)
  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('https://www.coinglass.com/Liquidation/BTC', {
    waitUntil: 'networkidle2'
  });

  // 2. In-page fetch of the CoinGlass open API
  const api = await page.evaluate(async () => {
    const res = await fetch(
      'https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list'
    );
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  });

  await browser.close();

  // 3. Extract the BTC record
  const btc = api.data.find(c => c.symbol === 'BTC');
  if (!btc) throw new Error('BTC not found in API response');

  // 4. Shape into your 1h/4h/24h {long,short,total}
  const out = {
    '1h':  { long: btc.long_liquidation_usd_1h,  short: btc.short_liquidation_usd_1h,  total: btc.liquidation_usd_1h  },
    '4h':  { long: btc.long_liquidation_usd_4h,  short: btc.short_liquidation_usd_4h,  total: btc.liquidation_usd_4h  },
    '24h': { long: btc.long_liquidation_usd_24h, short: btc.short_liquidation_usd_24h, total: btc.liquidation_usd_24h }
  };

  // 5. Write to repo root as liquidation.json
  const outPath = path.resolve(__dirname, '../liquidation.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`→ Wrote ${outPath}`);
})();
