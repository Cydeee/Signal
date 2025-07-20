// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // 1) launch headless Chromium without sandbox on GitHub runners
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // 2) go to the Coinglass liquidation page
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'load',
    timeout: 60000
  });

  // 3) helper: click a tab and scrape its table
  async function scrapeTab(buttonText) {
    // find and click the button whose text exactly matches
    const [btn] = await page.$x(`//button[normalize-space()="${buttonText}"]`);
    if (!btn) throw new Error(`Tab "${buttonText}" not found`);
    await btn.click();

    // give it a moment to re-render
    await new Promise(r => setTimeout(r, 2000));
    // wait for the table rows
    await page.waitForSelector('table tbody tr', { timeout: 30000 });

    // scrape BTC row
    return await page.evaluate(() => {
      const parseVal = txt => parseFloat(txt.replace(/[$,M]/g, '')) || 0;
      const rows     = Array.from(document.querySelectorAll('table tbody tr'));
      const btcRow   = rows.find(r => {
        const sym = r.querySelector('td')?.innerText.trim();
        return sym === 'BTCUSDT' || sym === 'BTC';
      });
      if (!btcRow) throw new Error('BTC row not found');
      const cells = btcRow.querySelectorAll('td');

      // table columns: [0]=sym, [1]=exch, [2]=Long, [3]=Short, [4]=Net?, [5]=Total?
      const long  = parseVal(cells[2]?.innerText);
      const short = parseVal(cells[3]?.innerText);
      const total = parseVal(cells[5]?.innerText) || (long + short);

      return { long, short, total };
    });
  }

  // 4) Pull each interval
  const out = {
    // UI doesn’t support 15m, so we default to zeros here
    '15m': { long: 0, short: 0, total: 0 },
    '1h':  null,
    '4h':  null,
    '12h': null,
    '24h': null
  };

  for (const [label, tabText] of [
    ['1h',  '1 hour'],
    ['4h',  '4 hour'],
    ['12h', '12 hour'],
    ['24h', '24 hour']
  ]) {
    try {
      out[label] = await scrapeTab(tabText);
    } catch (err) {
      console.error(`Failed to scrape ${label}:`, err.message);
      // fallback to zeros on error
      out[label] = { long: 0, short: 0, total: 0 };
    }
  }

  await browser.close();

  // 5) write the result
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
