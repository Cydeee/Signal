// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // Launch headless Chromium without sandbox (GitHub runner friendly)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Navigate to the Liquidation Heatmap page
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'networkidle0',
    timeout: 60000
  });
  // Wait for the table to show up
  await page.waitForSelector('table', { timeout: 60000 });

  // Scrape the table by header labels
  const result = await page.evaluate(() => {
    const parseVal = txt => {
      // remove $ , and convert M suffix
      let v = txt.replace(/\$/g, '').replace(/,/g, '');
      if (v.endsWith('M')) return parseFloat(v) * 1e6;
      return parseFloat(v) || 0;
    };

    // 1) Find the table that has "1h Long" in its headers
    const tables = Array.from(document.querySelectorAll('table'));
    let tbl = tables.find(t => {
      const headers = Array.from(t.querySelectorAll('thead th')).map(th => th.innerText.trim());
      return headers.includes('1h Long') && headers.includes('4h Short') && headers.includes('24h Long');
    });
    if (!tbl) throw new Error('Could not locate the Total Liquidations table');

    // 2) Build a map of header → index
    const headers = Array.from(tbl.querySelectorAll('thead th')).map(th => th.innerText.trim());
    const idx = name => {
      const i = headers.indexOf(name);
      if (i === -1) throw new Error(`Missing header "${name}"`);
      return i;
    };

    const i1L = idx('1h Long'),  i1S = idx('1h Short');
    const i4L = idx('4h Long'),  i4S = idx('4h Short');
    const i24L= idx('24h Long'), i24S= idx('24h Short');

    // 3) Find the BTC row
    const rows  = Array.from(tbl.querySelectorAll('tbody tr'));
    const btcRx = /^(BTCUSDT|BTC)$/i;
    const btcRow = rows.find(r => {
      const sym = r.querySelector('td')?.innerText.trim();
      return btcRx.test(sym);
    });
    if (!btcRow) throw new Error('BTC row not found in table');

    const cells = Array.from(btcRow.querySelectorAll('td')).map(td => td.innerText.trim());

    // 4) Parse out the values
    const long1 = parseVal(cells[i1L]),  short1 = parseVal(cells[i1S]);
    const long4 = parseVal(cells[i4L]),  short4 = parseVal(cells[i4S]);
    const long24= parseVal(cells[i24L]), short24= parseVal(cells[i24S]);

    return {
      '1h':  { long: long1,  short: short1,  total: parseFloat((long1  + short1 ).toFixed(2)) },
      '4h':  { long: long4,  short: short4,  total: parseFloat((long4  + short4 ).toFixed(2)) },
      '24h': { long: long24, short: short24, total: parseFloat((long24 + short24).toFixed(2)) }
    };
  });

  await browser.close();

  // Write the JSON so Netlify will serve it at /public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(result, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', result);
})();
