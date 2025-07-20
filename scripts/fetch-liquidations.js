// scripts/fetch-liquidations.js
const fs = require('fs');

(async () => {
  // 1) Pull down the page HTML
  const html = await fetch('https://www.coinglass.com/LiquidationData')
    .then(r => r.text());

  // 2) Extract the Next.js JSON blob
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) {
    throw new Error('Could not find __NEXT_DATA__ script tag');
  }
  const nextData = JSON.parse(match[1]);

  // 3) Navigate to the Total Liquidations data
  //    (this path is what Coinglass uses in initialState)
  const allLiq = nextData
    .props
    .pageProps
    .initialState
    .totalLiquidation; 

  if (!Array.isArray(allLiq)) {
    throw new Error('Unexpected shape for totalLiquidation');
  }

  // 4) Find the BTCUSDT entry
  const btc = allLiq.find(x => x.symbol === 'BTCUSDT');
  if (!btc) {
    throw new Error('BTCUSDT data not found in totalLiquidation');
  }

  // 5) Build our three-interval snapshot
  const out = {
    '1h':  { long: btc['1hLong'],  short: btc['1hShort'],  total: btc['1hLong']  + btc['1hShort']  },
    '4h':  { long: btc['4hLong'],  short: btc['4hShort'],  total: btc['4hLong']  + btc['4hShort']  },
    '24h': { long: btc['24hLong'], short: btc['24hShort'], total: btc['24hLong'] + btc['24hShort'] },
  };

  // 6) Write it so Netlify will serve it
  fs.writeFileSync(
    './public/liquidation-data.json',
    JSON.stringify(out, null, 2)
  );

  console.log('✅ liquidation-data.json updated:', out);
})();
