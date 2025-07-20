// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

(async () => {
  // Launch headless Chromium without the sandbox (required on GitHub runners)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Navigate to the Coinglass liquidation page
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'load',
    timeout: 60000
  });
  // Give the React UI a few seconds to render
  await new Promise(r => setTimeout(r, 5000));

  // Scrape via regex over the full page text
  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    const intervals = ['1h', '4h', '24h'];
    const out = {};

    intervals.forEach(label => {
      // Match lines like "1h Rekt" then "Long 123,456" and "Short 78,901"
      const re = new RegExp(
        label + '\\s+Rekt[\\s\\S]*?Long\\s*([\\d,\\.]+)[\\s\\S]*?Short\\s*([\\d,\\.]+)',
        'i'
      );
      const m = text.match(re);
      if (m) {
        const long  = parseFloat(m[1].replace(/,/g, '')) || 0;
        const short = parseFloat(m[2].replace(/,/g, '')) || 0;
        out[label] = {
          long,
          short,
          total: parseFloat((long + short).toFixed(2))
        };
      } else {
        console.error(`⚠️ Could not find "${label} Rekt"`);  
        out[label] = { long: 0, short: 0, total: 0 };
      }
    });

    return out;
  });

  await browser.close();

  // Write the result so Netlify serves it at /public/liquidation-data.json
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(data, null, 2)
  );
  console.log('✅ liquidation-data.json updated:', data);
})();
