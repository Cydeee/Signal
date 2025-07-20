// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // 1) launch without sandbox on GitHub runners
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // 2) helper to fetch a single interval
  async function fetchInterval(label, url) {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('table tbody tr', { timeout: 60000 });
    // small pause to let JS finish
    await new Promise(r => setTimeout(r, 2000));

    return await page.evaluate(() => {
      const parseVal = txt => parseFloat(txt.replace(/[$,M]/g, '')) || 0;
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      // match exactly "BTCUSDT" or "BTC"
      const btcRow = rows.find(r => {
        const sym = r.querySelector('td')?.innerText.trim();
        return sym === 'BTCUSDT' || sym === 'BTC';
      });
      if (!btcRow) throw new Error('BTC row not found');

      const cells = btcRow.querySelectorAll('td');
      // columns: [0]=sym,[1]=exch,[2]=Long,[3]=Short, ...,[5]=Total
      const long  = parseVal(cells[2]?.innerText);
      const short = parseVal(cells[3]?.innerText);
      const total = parseVal(cells[5]?.innerText) || (long + short);

      return { long, short, total };
    });
  }

  // 3) define the four pages (you may need to adjust the query param names
  //    if Coinglass uses different ones)
  const pages = {
    '15m':  'https://www.coinglass.com/LiquidationData?type=15m',
    '1h':   'https://www.coinglass.com/LiquidationData?type=1h',
    '4h':   'https://www.coinglass.com/LiquidationData?type=4h',
    '24h':  'https://www.coinglass.com/LiquidationData'           // default = 24h
  };

  const result = {};
  for (const [label, url] of Object.entries(pages)) {
    try {
      result[label] = await fetchInterval(label, url);
    } catch (e) {
      console.error(`Failed ${label}:`, e.message);
      result[label] = { long: 0, short: 0, total: 0 };
    }
  }

  await browser.close();

  // 4) write to public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(result, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', result);
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
