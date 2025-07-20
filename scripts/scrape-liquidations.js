// scripts/scrape-liquidations.js

const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');

;(async () => {
  // 1. Launch headless Puppeteer
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // 2. Navigate to Coinglass to set cookies/CORS
  await page.goto('https://www.coinglass.com/Liquidation/BTC', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  // 3. Fetch the spot-liquidation list
  const spot = await page.evaluate(async () => {
    const res = await fetch('https://capi.coinglass.com/api/coin/liquidation');
    if (!res.ok) throw new Error(`Spot fetch HTTP ${res.status}`);
    let list = await res.json();

    // Ensure list is an array
    if (!Array.isArray(list)) {
      if (Array.isArray(list.data)) {
        list = list.data;
      } else if (typeof list === 'object' && list !== null) {
        list = Object.values(list);
      } else {
        throw new Error('Unexpected spot list format');
      }
    }

    const btc = list.find(c => c.symbol === 'BTC');
    if (!btc) throw new Error('BTC not found in spot list');

    return {
      '1h':  { long: btc.long_liquidation_usd_1h,  short: btc.short_liquidation_usd_1h,  total: btc.liquidation_usd_1h  },
      '4h':  { long: btc.long_liquidation_usd_4h,  short: btc.short_liquidation_usd_4h,  total: btc.liquidation_usd_4h  },
      '24h': { long: btc.long_liquidation_usd_24h, short: btc.short_liquidation_usd_24h, total: btc.liquidation_usd_24h }
    };
  });

  // 4. Fetch the futures‐chart for each interval
  const intervals = { '1h': 'h1', '4h': 'h4', '24h': 'h24' };
  const futures   = {};
  for (const [label, t] of Object.entries(intervals)) {
    futures[label] = await page.evaluate(async type => {
      const url = `https://capi.coinglass.com/api/futures/liquidation/chart?symbol=BTC-PERPETUAL&timeType=${type}`;
      const r   = await fetch(url);
      if (!r.ok) throw new Error(`Futures ${type} HTTP ${r.status}`);
      return r.json();
    }, t);
  }

  await browser.close();

  // 5. Write combined JSON to repo root
  const output = { spot, futures };
  const outFile = path.resolve(__dirname, '../liquidation.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log(`✔ Wrote ${outFile}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
