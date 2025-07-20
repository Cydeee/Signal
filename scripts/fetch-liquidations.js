// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // ─── Launch without sandbox so it works on GH Ubuntu runners
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // ─── Load Coinglass liquidation page (default timeframe)
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'load',
    timeout: 60000
  });

  // ─── Wait up to 60s for at least one table row to appear
  await page.waitForSelector('table tbody tr', { timeout: 60000 });
  // Give an extra 2s for dynamic JS to populate data
  await page.waitForTimeout(2000);

  // ─── Scrape the BTC row
  const snapshot = await page.evaluate(() => {
    const parseVal = txt => parseFloat(txt.replace(/[$,M]/g, '')) || 0;
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    const btcRow = rows.find(r => r.innerText.includes('BTC'));
    if (!btcRow) throw new Error('BTC row not found');
    const cells = btcRow.querySelectorAll('td');

    // On Coinglass table the columns are usually:
    // [0]=Coin, [1]=Exchange, [2]=Long, [3]=Short, [4]=Net, [5]=Total
    const long  = parseVal(cells[2]?.innerText);
    const short = parseVal(cells[3]?.innerText);
    // Total sometimes missing—fallback to long+short
    const total = parseVal(cells[5]?.innerText) || (long + short);

    return { long, short, total };
  });

  await browser.close();

  // ─── Write JSON into public/ so Netlify will serve it
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(snapshot, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', snapshot);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
