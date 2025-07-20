// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

;(async () => {
  // 1) Launch headless Chrome
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // 2) Go to Coinglass
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'networkidle0',
    timeout: 60000
  });
  // 3) Wait for the specific table to appear
  await page.waitForSelector('table', { timeout: 60000 });

  // 4) Scrape by header names
  const result = await page.evaluate(() => {
    const parseVal = txt => {
      // strip $ , then handle "M" suffix
      let v = txt.replace(/\$/g, '').replace(/,/g, '');
      if (v.endsWith('M')) return parseFloat(v.slice(0, -1)) * 1e6;
      return parseFloat(v) || 0;
    };

    // find the table with "1h Long" in its header row
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find(tbl => {
      const headers = Array.from(tbl.querySelectorAll('thead th')).map(th => th.innerText.trim());
      return headers.includes('1h Long') && headers.includes('4h Long') && headers.includes('24h Long');
    });
    if (!table) throw new Error('Could not locate the Total Liquidations table');

    // build a map from header text → column index
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
    const idx = name => {
      const i = headers.indexOf(name);
      if (i < 0) throw new Error(`Missing header "${name}"`);
      return i;
    };

    const i1L  = idx('1h Long'),  i1S  = idx('1h Short');
    const i4L  = idx('4h Long'),  i4S  = idx('4h Short');
    const i24L = idx('24h Long'), i24S = idx('24h Short');

    // find the BTCUSDT row exactly
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const btcRow = rows.find(r => {
      const first = r.querySelector('td')?.innerText.trim();
      return first === 'BTCUSDT';
    });
    if (!btcRow) throw new Error('BTCUSDT row not found');

    const cells = Array.from(btcRow.querySelectorAll('td')).map(td => td.innerText.trim());

    // parse out each interval
    const long1  = parseVal(cells[i1L]),  short1  = parseVal(cells[i1S]);
    const long4  = parseVal(cells[i4L]),  short4  = parseVal(cells[i4S]);
    const long24 = parseVal(cells[i24L]), short24 = parseVal(cells[i24S]);

    return {
      '1h':  { long: long1,  short: short1,  total: +(long1  + short1 ).toFixed(2) },
      '4h':  { long: long4,  short: short4,  total: +(long4  + short4 ).toFixed(2) },
      '24h': { long: long24, short: short24, total: +(long24 + short24).toFixed(2) }
    };
  });

  await browser.close();

  // 5) Write your JSON
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(result, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', result);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
