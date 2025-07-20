// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // 1) Launch headless Chromium without sandbox (for GitHub runners)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // 2) Navigate to Coinglass liquidation page
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'load',
    timeout: 60000
  });
  await page.waitForSelector('table tbody tr', { timeout: 60000 });

  // 3) Helper: click a timeframe button and scrape BTC row
  async function scrapeTab(labelText) {
    // Click the button exactly matching labelText
    await page.evaluate((text) => {
      const btn = Array.from(document.querySelectorAll('button'))
                       .find(b => b.innerText.trim() === text);
      if (!btn) throw new Error(`Button "${text}" not found`);
      btn.click();
    }, labelText);

    // Wait for the table to re-render
    await new Promise(r => setTimeout(r, 2000));
    await page.waitForSelector('table tbody tr', { timeout: 30000 });

    // Extract the BTC row values
    return await page.evaluate(() => {
      const parseVal = txt => parseFloat(txt.replace(/[$,M]/g, '')) || 0;
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const btcRow = rows.find(r => {
        const sym = r.querySelector('td')?.innerText.trim();
        return sym === 'BTCUSDT' || sym === 'BTC';
      });
      if (!btcRow) throw new Error('BTC row not found');
      const cells = btcRow.querySelectorAll('td');
      const long  = parseVal(cells[2]?.innerText);
      const short = parseVal(cells[3]?.innerText);
      const total = parseVal(cells[5]?.innerText) || (long + short);
      return { long, short, total };
    });
  }

  // 4) Define intervals (15m is unsupported in the public UI)
  const intervals = {
    '15m': null,
    '1h':  '1 hour',
    '4h':  '4 hour',
    '12h': '12 hour',
    '24h': '24 hour'
  };

  // 5) Scrape each interval, falling back to zeros on error
  const out = {};
  for (const [key, label] of Object.entries(intervals)) {
    if (!label) {
      out[key] = { long: 0, short: 0, total: 0 };
    } else {
      try {
        out[key] = await scrapeTab(label);
      } catch (err) {
        console.error(`Failed to scrape ${key}:`, err.message);
        out[key] = { long: 0, short: 0, total: 0 };
      }
    }
  }

  await browser.close();

  // 6) Write the JSON so Netlify can serve it from /public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', out);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
