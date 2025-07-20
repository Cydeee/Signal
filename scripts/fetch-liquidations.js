// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // 1) launch headless Chromium without sandbox
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
  // ensure table has at least one row
  await page.waitForSelector('table tbody tr', { timeout: 60000 });

  // 3) helper: click a timeframe button and scrape its BTC row
  async function scrapeTab(labelText) {
    // click the button whose innerText exactly matches labelText
    await page.evaluate((text) => {
      const btn = Array.from(document.querySelectorAll('button'))
                       .find(b => b.innerText.trim() === text);
      if (!btn) throw new Error(`Button "${text}" not found`);
      btn.click();
    }, labelText);

    // wait for re-render
    await new Promise(r => setTimeout(r, 2000));
    await page.waitForSelector('table tbody tr', { timeout: 30000 });

    // extract the BTC row
    return await page.evaluate(() => {
      const parseVal = txt => parseFloat(txt.replace(/[$,M]/g, '')) || 0;
      const rows     = Array.from(document.querySelectorAll('table tbody tr'));
      const btcRow   = rows.find(r => {
        const sym = r.querySelector('td')?.innerText.trim();
        return sym === 'BTCUSDT' || sym === 'BTC';
      });
      if (!btcRow) throw new Error('BTC row not found');
      const cells = btcRow.querySelectorAll('td');
      const long  = parseVal(cells[2]?.innerText);
      const short = parseVal(cells[3]?.innerText);
      // column 5 is “Total” when present
      const total = parseVal(cells[5]?.innerText) || (long + short);
      return { long, short, total };
    });
  }

  // 4) define which tabs & labels to scrape
  const intervals = {
    '15m': null,            // Coinglass UI doesn’t support 15 m aggregate
    '1h':  '1 hour',
    '4h':  '4 hour',
    '12h': '12 hour',
    '24h': '24 hour'
  };

  const out = {
