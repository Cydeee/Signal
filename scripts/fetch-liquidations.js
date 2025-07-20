// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // Launch headless Chromium without sandbox (GitHub runner compatible)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Navigate to Coinglass liquidation page
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'networkidle0',
    timeout: 60000
  });
  await page.waitForSelector('table', { timeout: 60000 });

  // Scrape the “Total Liquidations” table that includes 1h, 4h, 24h headers
  const data = await page.evaluate(() => {
    const parseVal = txt => parseFloat(txt.replace(/[$,M]/g, '')) || 0;

    // Identify the correct table by its header text
    const tables = Array.from(document.querySelectorAll('table'));
    const tbl = tables.find(t =>
      Array.from(t.querySelectorAll('thead th'))
        .some(th => th.innerText.includes('1h Long'))
    );
    if (!tbl) throw new Error('Could not find the 1h/4h/24h table');

    // Find the BTC row
    const rows = Array.from(tbl.querySelectorAll('tbody tr'));
    const btcRow = rows.find(r => {
      const sym = r.querySelector('td')?.innerText.trim();
      return sym === 'BTCUSDT' || sym === 'BTC';
    });
    if (!btcRow) throw new Error('BTC row not found in table');

    const cells = btcRow.querySelectorAll('td');
    // columns layout:
    // [0]=symbol, [1]=exchange,
    // [2]=1h Long,  [3]=1h Short,
    // [4]=4h Long,  [5]=4h Short,
    // [6]=24h Long, [7]=24h Short, ...
    const long1h  = parseVal(cells[2].innerText);
    const short1h = parseVal(cells[3].innerText);
    const long4h  = parseVal(cells[4].innerText);
    const short4h = parseVal(cells[5].innerText);
    const long24h = parseVal(cells[6].innerText);
    const short24h= parseVal(cells[7].innerText);

    return {
      '1h':  { long: long1h,  short: short1h,  total: +(long1h  + short1h).toFixed(2) },
      '4h':  { long: long4h,  short: short4h,  total: +(long4h  + short4h).toFixed(2) },
      '24h': { long: long24h, short: short24h, total: +(long24h + short24h).toFixed(2) }
    };
  });

  await browser.close();

  // Write the JSON so Netlify serves it at /public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(data, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', data);
})();
