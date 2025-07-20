// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

;(async () => {
  // 1) Launch Chromium (no-sandbox for GitHub runners)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // 2) Navigate and wait for the table
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'networkidle0',
    timeout: 60000
  });
  // Give React a moment
  await new Promise(r => setTimeout(r, 5000));

  // 3) Scrape by header + “BTC” row
  const result = await page.evaluate(() => {
    // parse “1.23M” → 1_230_000, “456,789” → 456789
    const parseVal = txt => {
      let v = txt.replace(/\$/g, '').replace(/,/g, '').trim();
      const isM = /M$/i.test(v);
      if (isM) v = v.slice(0, -1);
      const n = parseFloat(v) || 0;
      return isM ? n * 1e6 : n;
    };

    // find the table whose <th> row contains “1h Long”
    const tables = Array.from(document.querySelectorAll('table'));
    const tbl = tables.find(t => {
      const heads = Array.from(t.querySelectorAll('thead th')).map(th => th.innerText.trim());
      return heads.includes('1h Long');
    });
    if (!tbl) throw new Error('Total Liquidations table not found');

    // map header labels → column indexes
    const headers = Array.from(tbl.querySelectorAll('thead th')).map(th => th.innerText.trim());
    const idx = name => {
      const i = headers.indexOf(name);
      if (i < 0) throw new Error(`Missing header "${name}"`);
      return i;
    };
    const i1L  = idx('1h Long'),  i1S  = idx('1h Short');
    const i4L  = idx('4h Long'),  i4S  = idx('4h Short');
    const i24L = idx('24h Long'), i24S = idx('24h Short');

    // find the row whose first cell is exactly “BTC”
    const rows = Array.from(tbl.querySelectorAll('tbody tr'));
    const btcRow = rows.find(r => {
      const c0 = r.querySelector('td')?.innerText.trim();
      return c0 === 'BTC';
    });
    if (!btcRow) throw new Error('BTC row not found');

    const cells = Array.from(btcRow.querySelectorAll('td')).map(td => td.innerText.trim());

    // parse each interval
    const long1  = parseVal(cells[i1L]),  short1  = parseVal(cells[i1S]);
    const long4  = parseVal(cells[i4L]),  short4  = parseVal(cells[i4S]);
    const long24 = parseVal(cells[i24L]), short24 = parseVal(cells[i24S]);

    return {
      '1h':  { long: +long1.toFixed(2),  short: +short1.toFixed(2),  total: +(long1  + short1 ).toFixed(2) },
      '4h':  { long: +long4.toFixed(2),  short: +short4.toFixed(2),  total: +(long4  + short4 ).toFixed(2) },
      '24h': { long: +long24.toFixed(2), short: +short24.toFixed(2), total: +(long24 + short24).toFixed(2) },
    };
  });

  await browser.close();

  // 4) Write JSON so Netlify serves it at /public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(result, null, 2)
  );
  console.log('✅ liquidation-data.json updated:', result);
})();
