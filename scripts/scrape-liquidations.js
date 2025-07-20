// Signal/scripts/scrape-liquidations.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

(async () => {
  // ←–– adjust symbols here as needed
  const SYMBOLS = (process.env.SYMBOLS || 'BTC').split(',');
  const result  = {};

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  for (const sym of SYMBOLS) {
    const url = `https://www.coinglass.com/Liquidation/${sym}`;
    await page.goto(url, { waitUntil: 'networkidle2' });

    // ❗ you may need to open DevTools and inspect window.__NUXT__ to find the exact path
    const data = await page.evaluate(() => {
      // Coinglass ships its data in Nuxt’s initial state
      const nuxt = window.__NUXT__?.data?.[0];
      // e.g. nuxt.liQ?.history or similar — adjust this path
      return {
        '1h':  nuxt.liquidation?.['1h'],
        '4h':  nuxt.liquidation?.['4h'],
        '24h': nuxt.liquidation?.['24h'],
      };
    });

    result[sym] = {
      long:  { '1h': data['1h']?.long,  '4h': data['4h']?.long,  '24h': data['24h']?.long  },
      short: { '1h': data['1h']?.short, '4h': data['4h']?.short, '24h': data['24h']?.short },
      total: { '1h': data['1h']?.total, '4h': data['4h']?.total, '24h': data['24h']?.total },
    };
  }

  await browser.close();

  // write to root so Netlify can serve it at /liquidation.json
  const outPath = path.resolve(__dirname, '../liquidation.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ${outPath}`);
})();
