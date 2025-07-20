// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // ─── Launch Chromium without sandbox (required on GitHub runners)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // ─── Go to Coinglass liquidation page (default 24 h)
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'networkidle2'
  });

  // ─── Wait until at least one row appears *and* we see our BTC symbol
  await page.waitForSelector('table tbody tr');
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('table tbody tr'))
      .some(row => {
        const txt = row.querySelector('td')?.innerText.trim();
        return txt === 'BTCUSDT' || txt === 'BTC';
      });
  }, { timeout: 15000 });

  // ─── Extract the numbers
  const snapshot = await page.evaluate(() => {
    const parseVal = txt => parseFloat(txt.replace(/[$M,]/g, '')) || 0;
    const rows = Array.from(document.querySelectorAll('table tbody tr'));

    // Find the row whose first cell is exactly "BTCUSDT" or "BTC"
    const btcRow = rows.find(row => {
      const td = row.querySelector('td');
      return td && (td.innerText.trim() === 'BTCUSDT' || td.innerText.trim() === 'BTC');
    });
    if (!btcRow) throw new Error('BTC row not found');

    const cells = btcRow.querySelectorAll('td');
    // On Coinglass the columns are usually:
    // [0]=Symbol, [1]=Exchange, [2]=Long, [3]=Short, [4]=Net, [5]=Total
    const long  = parseVal(cells[2]?.innerText);
    const short = parseVal(cells[3]?.innerText);
    // Some UIs omit a “total” column—fallback to long+short
    const total = parseVal(cells[5]?.innerText) || (long + short);

    return { long, short, total };
  });

  await browser.close();

  // ─── Write JSON into public/ so Netlify serves it at
  // https://<your-site>.netlify.app/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(snapshot, null, 2)
  );

  console.log('✅ liquidation-data.json updated');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
