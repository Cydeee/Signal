// scripts/scrape-liquidations.js

const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');

;(async () => {
  // 1. Launch Puppeteer
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // 2. Navigate so CORS/cookies are set
  await page.goto('https://www.coinglass.com/Liquidation/BTC', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  // 3. Fetch spot-liquidation, parse into an array of items
  const spot = await page.evaluate(async () => {
    const res = await fetch('https://capi.coinglass.com/api/coin/liquidation');
    if (!res.ok) throw new Error(`Spot fetch HTTP ${res.status}`);
    const json = await res.json();

    let items;
    if (Array.isArray(json)) {
      items = json;
    } else if (json.data && Array.isArray(json.data)) {
      items = json.data;
    } else if (json.data && typeof json.data === 'object') {
      // data is an object mapping symbols → records
      items = Object.entries(json.data).map(([sym, rec]) => {
        if (rec.symbol == null) rec.symbol = sym;
        return rec;
      });
    } else {
      throw new Error('Unexpected spot list format');
    }

    const btc = items.find(c => c.symbol === 'BTC');
    if (!btc) {
      const syms = items.map(c => c.symbol).slice(0,10).join(', ');
      throw new Error(`BTC not found (available: ${syms}…)`);
    }

    return {
      '1h':  { long: btc.long_liquidation_usd_1h,  short: btc.short_liquidation_usd_1h,  total: btc.liquidation_usd_1h  },
      '4h':  { long: btc.long_liquidation_usd_4h,  short: btc.short_liquidation_usd_4h,  total: btc.liquidation_usd_4h  },
      '24h': { long: btc.long_liquidation_usd_24h, short: btc.short_liquidation_usd_24h, total: btc.liquidation_usd_24h }
    };
  });

  // 4. Fetch the futures‐chart for each interval
  const intervals = { '1h': 'h1', '4h': 'h4', '24h': 'h24' };
  const futures   = {};
  for (const [label, timeType] of Object.entries(intervals)) {
    futures[label] = await page.evaluate(async t => {
      const url = `https://capi.coinglass.com/api/futures/liquidation/chart?symbol=BTC-PERPETUAL&timeType=${t}`;
      const r   = await fetch(url);
      if (!r.ok) throw new Error(`Futures ${t} HTTP ${r.status}`);
      return r.json();
    }, timeType);
  }

  await browser.close();

  // 5. Write to liquidation.json
  const output = { spot, futures };
  const outFile = path.resolve(__dirname, '../liquidation.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log(`✔ Wrote ${outFile}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
