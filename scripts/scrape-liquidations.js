// scripts/scrape-liquidations.js

const fs   = require('fs');
const path = require('path');

async function main() {
  // ─── 1) SPOT DATA ───────────────────────────────────────────────
  const listRes = await fetch(
    'https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list'
  );
  if (!listRes.ok) throw new Error(`Coin-list HTTP ${listRes.status}`);
  const listJson = await listRes.json();
  if (!Array.isArray(listJson.data)) {
    throw new Error('Unexpected coin-list format');
  }
  const btc = listJson.data.find(c => c.symbol === 'BTC');
  if (!btc) throw new Error('BTC not found in coin-list');

  const spot = {
    '1h':  { long: btc.long_liquidation_usd_1h,  short: btc.short_liquidation_usd_1h,  total: btc.liquidation_usd_1h  },
    '4h':  { long: btc.long_liquidation_usd_4h,  short: btc.short_liquidation_usd_4h,  total: btc.liquidation_usd_4h  },
    '24h': { long: btc.long_liquidation_usd_24h, short: btc.short_liquidation_usd_24h, total: btc.liquidation_usd_24h }
  };

  // ─── 2) FUTURES CHART DATA ───────────────────────────────────────
  const intervals = { '1h': 'h1', '4h': 'h4', '24h': 'h24' };
  const futures = {};

  for (const [label, timeType] of Object.entries(intervals)) {
    const url = new URL(
      'https://open-api-v4.coinglass.com/api/futures/liquidation/chart'
    );
    url.searchParams.set('symbol', 'BTC-PERPETUAL');
    url.searchParams.set('timeType', timeType);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Chart ${timeType} HTTP ${res.status}`);
    futures[label] = await res.json();
  }

  // ─── 3) WRITE OUTPUT ─────────────────────────────────────────────
  const out = { spot, futures };
  const file = path.resolve(__dirname, '../liquidation.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('✔ liquidation.json updated');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
