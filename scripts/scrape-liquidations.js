// scripts/scrape-liquidations.js

const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');

async function getSpot(page) {
  return page.evaluate(async () => {
    const res  = await fetch('https://capi.coinglass.com/api/coin/liquidation');
    if (!res.ok) throw new Error(`Spot fetch HTTP ${res.status}`);
    const json = await res.json();

    // Normalize to array of records
    let items;
    if (Array.isArray(json)) {
      items = json;
    } else if (json.data && Array.isArray(json.data)) {
      items = json.data;
    } else if (json.data && typeof json.data === 'object') {
      items = Object.entries(json.data).map(([sym, rec]) => {
        if (!rec.symbol) rec.symbol = sym;
        return rec;
      });
    } else if (typeof json === 'object' && json !== null) {
      items = Object.entries(json).map(([sym, rec]) => {
        if (!rec.symbol) rec.symbol = sym;
        return rec;
      });
    } else {
      throw new Error('Unexpected spot JSON format');
    }

    // Find BTC
    const btc = items.find(c => c.symbol === 'BTC');
    if (!btc) {
      const sample = items.slice(0,5).map(c=>c.symbol).join(', ');
      throw new Error(`BTC not found; got symbols: ${sample}…`);
    }

    return {
      '1h':  { long: btc.long_liquidation_usd_1h,  short: btc.short_liquidation_usd_1h,  total: btc.liquidation_usd_1h  },
      '4h':  { long: btc.long_liquidation_usd_4h,  short: btc.short_liquidation_usd_4h,  total: btc.liquidation_usd_4h  },
      '24h': { long: btc.long_liquidation_usd_24h, short: btc.short_liquidation_usd_24h, total: btc.liquidation_usd_24h }
    };
  });
}

async function getFutures(page) {
  const intervals = { '1h': 'h1', '4h': 'h4', '24h': 'h24' };
  const out = {};
  for (const [label, timeType] of Object.entries(intervals)) {
    out[label] = await page.evaluate(async t => {
      const url = `https://capi.coinglass.com/api/futures/liquidation/chart?symbol=BTC-PERPETUAL&timeType=${t}`;
      const r   = await fetch(url);
      if (!r.ok) throw new Error(`Futures ${t} HTTP ${r.status}`);
      return r.json();
    }, timeType);
  }
  return out;
}

;(async () => {
  // Launch and navigate
  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('https://www.coinglass.com/Liquidation/BTC', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  // Scrape spot + futures
  const spot    = await getSpot(page);
  const futures = await getFutures(page);

  await browser.close();

  // Write out
  const output = { spot, futures };
  const outFile = path.resolve(__dirname, '../liquidation.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log(`✔ Wrote ${outFile}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
