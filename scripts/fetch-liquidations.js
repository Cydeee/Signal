// scripts/fetch-liquidations.js
const puppeteer = require('puppeteer');
const fs        = require('fs');

;(async () => {
  // ─── Launch Chromium (GitHub runners need no‐sandbox) ───────
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // ─── Go to Coinglass LiquidationData ───────────────────────
  await page.goto('https://www.coinglass.com/LiquidationData', {
    waitUntil: 'load',
    timeout: 60000
  });
  // give the React UI time to fetch & render
  await page.waitForTimeout(5000);

  // ─── Scrape via regex + proper “M” handling ────────────────
  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    const intervals = ['1h', '4h', '24h'];
    const out = {};

    // parses strings like “1.185M” → 1185000, “0.6M” → 600000, “123,456” → 123456
    const parseVal = txt => {
      if (!txt) return 0;
      let v = txt.replace(/[$,]/g, '').trim();
      const isM = /M$/i.test(v);
      if (isM) v = v.slice(0, -1);
      const num = parseFloat(v) || 0;
      return isM ? num * 1e6 : num;
    };

    intervals.forEach(label => {
      // look for “1h Rekt … Long 1.185M … Short 0.6M”
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

  // ─── Write the JSON so Netlify serves it at /public/liquidation-data.json ─
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(data, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', data);
})();
