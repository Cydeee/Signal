// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // 1) Navigate to Coinglass
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'load', timeout: 60000
  });
  await page.waitForSelector('button', { timeout: 60000 });

  // 2) Discover which buttons map to which intervals
  const tabLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim())
  );

  console.log('Found buttons:', tabLabels.join(' | '));

  // Build a map { '1h': '1 hour', '4h': '4 hour', … }
  const tabMap = {};
  tabLabels.forEach(label => {
    const m = label.match(/^(\d+)\s*h/i);
    if (m) tabMap[`${m[1]}h`] = label;
  });

  console.log('Mapped intervals:', JSON.stringify(tabMap));

  // 3) Helper: click & scrape
  async function scrapeTab(labelText) {
    // click
    await page.evaluate(text => {
      const btn = Array.from(document.querySelectorAll('button'))
                       .find(b => b.innerText.trim() === text);
      if (!btn) throw new Error(`Button "${text}" not found`);
      btn.click();
    }, labelText);

    // wait to re-render
    await new Promise(r => setTimeout(r, 2000));
    await page.waitForSelector('table tbody tr', { timeout: 30000 });

    // scrape BTC row
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

  // 4) Scrape each interval
  const intervals = ['15m','1h','4h','12h','24h'];
  const out = {};

  for (const key of intervals) {
    if (key === '15m') {
      out[key] = { long: 0, short: 0, total: 0 };
      continue;
    }
    const label = tabMap[key];
    if (!label) {
      console.error(`No button found in map for ${key}`);
      out[key] = { long: 0, short: 0, total: 0 };
      continue;
    }
    try {
      out[key] = await scrapeTab(label);
    } catch (e) {
      console.error(`Failed to scrape ${key}:`, e.message);
      out[key] = { long: 0, short: 0, total: 0 };
    }
  }

  await browser.close();

  // 5) Write JSON
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', out);
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
