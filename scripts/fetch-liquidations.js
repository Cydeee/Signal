// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page    = await browser.newPage();
  await page.goto('https://www.coinglass.com/LiquidationData', { waitUntil: 'networkidle2' });
  await page.waitForSelector('table tbody tr');

  const data = await page.evaluate(() => {
    const parseVal = txt => parseFloat(txt.replace(/[$M,]/g, '')) || 0;
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    const btc  = rows.find(r => r.innerText.includes('BTC'));
    if (!btc) throw new Error('BTC row not found');
    const c = btc.querySelectorAll('td');
    return {
      '15m': { long: parseVal(c[3].innerText), short: parseVal(c[4].innerText), total: parseVal(c[5].innerText) },
      '1h':  { long: parseVal(c[6].innerText), short: parseVal(c[7].innerText), total: parseVal(c[8].innerText) },
      '4h':  { long: parseVal(c[9].innerText), short: parseVal(c[10].innerText), total: parseVal(c[11].innerText) },
      '24h': { long: parseVal(c[12].innerText), short: parseVal(c[13].innerText), total: parseVal(c[14].innerText) },
    };
  });

  await browser.close();

  // write into public so Netlify will serve it at /liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(data, null, 2)
  );
  console.log('✅ liquidation-data.json updated');
})()
.catch(e => { console.error(e); process.exit(1); });
