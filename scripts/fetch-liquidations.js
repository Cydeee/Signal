// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

;(async () => {
  // Launch headless Chromium without sandbox
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Navigate to the Coinglass LiquidationData page
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'load',
    timeout: 60000
  });

  // Pause 5 seconds for React to render
  await new Promise(res => setTimeout(res, 5000));

  // Scrape via regex + “M” handling
  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    const intervals = ['1h', '4h', '24h'];
    const out = {};

    // parse values like "1.185M" or "123,456"
    const parseVal = txt => {
      if (!txt) return 0;
      let v = txt.replace(/[$,]/g, '').trim();
      const isM = /M$/i.test(v);
      if (isM) v = v.slice(0, -1);
      const num = parseFloat(v) || 0;
      return isM ? num * 1e6 : num;
    };

    intervals.forEach(label => {
      // match "1h Rekt … Long 1.185M … Short 0.6M"
      const re = new RegExp(
        label + '\\s+Rekt[\\s\\S]*?Long\\s*([\\d.,]+M?)[\\s\\S]*?Short\\s*([\\d.,]+M?)',
        'i'
      );
      const m = text.match(re);
      if (m) {
        const long  = parseVal(m[1]);
        const short = parseVal(m[2]);
        out[label] = {
          long,
          short,
          total: parseFloat((long + short).toFixed(2))
        };
      } else {
        console.error(`⚠️ Could not match ${label} Rekt block`);
        out[label] = { long: 0, short: 0, total: 0 };
      }
    });

    return out;
  });

  await browser.close();

  // Write JSON so Netlify serves it under /public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(data, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', data);
})();
