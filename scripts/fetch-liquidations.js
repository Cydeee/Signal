// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // 1) launch Chromium without sandbox (for GitHub runners)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // 2) go to the Coinglass page
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'load',
    timeout: 60000
  });
  await page.waitForSelector('button', { timeout: 60000 });

  // 3) get all button labels and map "1h","4h","12h","24h"
  const tabLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim())
  );
  const tabMap = {};
  tabLabels.forEach(label => {
    const m = label.match(/^(\d+)\s*h/i);
    if (m) tabMap[`${m[1]}h`] = label;
  });

  // 4) helper to click a tab then wait for the BTC row to appear
  async function scrapeTab(labelText) {
    // click the tab
    await page.evaluate(text => {
      const btn = Array.from(document.querySelectorAll('button'))
                       .find(b => b.innerText.trim() === text);
      if (!btn) throw new Error(`Tab button "${text}" not found`);
      btn.click();
    }, labelText);

    // allow rendering
    await new Promise(r => setTimeout(r, 2000));

    // wait for any rows
    await page.waitForSelector('table tbody tr', { timeout: 30000 });

    // now wait until we actually see the BTC row in one of them
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('table tbody tr'))
        .some(r => {
          const td0 = r.querySelector('td');
          return td0 && (td0.innerText.trim() === 'BTCUSDT' || td0.innerText.trim() === 'BTC');
        });
    }, { timeout: 30000 });

    // scrape it
    return await page.evaluate(() => {
      const parseVal = txt => parseFloat(txt.replace(/[$,M]/g, '')) || 0;
      const rows     = Array.from(document.querySelectorAll('table tbody tr'));
      const btcRow   = rows.find(r => {
        const td0 = r.querySelector('td');
        return td0 && (td0.innerText.trim() === 'BTCUSDT' || td0.innerText.trim() === 'BTC');
      });
      if (!btcRow) throw new Error('BTC row still not found after wait');
      const cells = btcRow.querySelectorAll('td');
      const long  = parseVal(cells[2]?.innerText);
      const short = parseVal(cells[3]?.innerText);
      const total = parseVal(cells[5]?.innerText) || (long + short);
      return { long, short, total };
    });
  }

  // 5) scrape each interval (15m stays zero)
  const intervals = ['15m','1h','4h','12h','24h'];
  const out = {};

  for (const key of intervals) {
    if (key === '15m') {
      out[key] = { long: 0, short: 0, total: 0 };
    } else {
      const label = tabMap[key];
      if (!label) {
        console.error(`No tab found for "${key}"`);
        out[key] = { long: 0, short: 0, total: 0 };
      } else {
        try {
          out[key] = await scrapeTab(label);
        } catch (e) {
          console.error(`Failed to scrape ${key}:`, e.message);
          out[key] = { long: 0, short: 0, total: 0 };
        }
      }
    }
  }

  await browser.close();

  // 6) write JSON to public/
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', out);
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
