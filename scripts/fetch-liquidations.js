// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // Launch Chromium without the sandbox so it can run on GitHub’s Ubuntu runner
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('https://www.coinglass.com/LiquidationData', { waitUntil: 'networkidle2' });
  await page.waitForSelector('table tbody tr');

  const data = await page.evaluate(() => {
    const parseVal = txt => parseFloat(txt.replace(/[$M,]/g, '')) || 0;
    const rows     = Array.from(document.querySelectorAll('table tbody tr'));
    const btcRow   = rows.find(r => r.innerText.includes('BTC'));
    if (!btcRow) throw new Error('BTC row not found');
    const c = btcRow.querySelectorAll('td');

    return {
      '15m': {
        long:  parseVal(c[3].innerText),
        short: parseVal(c[4].innerText),
        total: parseVal(c[5].innerText)
      },
      '1h': {
        long:  parseVal(c[6].innerText),
        short: parseVal(c[7].innerText),
        total: parseVal(c[8].innerText)
      },
      '4h': {
        long:  parseVal(c[9].innerText),
        short: parseVal(c[10].innerText),
        total: parseVal(c[11].innerText)
      },
      '24h': {
        long:  parseVal(c[12].innerText),
        short: parseVal(c[13].innerText),
        total: parseVal(c[14].innerText)
      }
    };
  });

  await browser.close();

  // Write the snapshot into public/liquidation-data.json so Netlify will serve it
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(data, null, 2)
  );

  console.log('✅ liquidation-data.json updated');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
