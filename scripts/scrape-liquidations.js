// scripts/scrape-liquidations.js

import { writeFileSync } from 'fs';
import { resolve }        from 'path';
import fetch              from 'node-fetch';  // polyfill for Node < 20, but works on 18+

async function main() {
  // ── SPOT DATA ──────────────────────────────────────────────
  const spotRes = await fetch('https://capi.coinglass.com/api/coin/liquidation');
  if (!spotRes.ok) throw new Error(`Spot HTTP ${spotRes.status}`);
  const spotJson = await spotRes.json();

  // normalize to array of records
  let list;
  if (Array.isArray(spotJson)) {
    list = spotJson;
  } else if (Array.isArray(spotJson.data)) {
    list = spotJson.data;
  } else if (typeof spotJson.data === 'object') {
    list = Object.entries(spotJson.data).map(([sym, rec]) => {
      rec.symbol ??= sym;
      return rec;
    });
  } else if (typeof spotJson === 'object') {
    list = Object.entries(spotJson).map(([sym, rec]) => {
      rec.symbol ??= sym;
      return rec;
    });
  } else {
    throw new Error('Unexpected spot JSON format');
  }

  const btc = list.find(c=>c.symbol==='BTC');
  if (!btc) throw new Error(`BTC not found; symbols: ${list.map(c=>c.symbol).slice(0,5).join(', ')}`);

  const spot = {
    '1h':  { long: btc.long_liquidation_usd_1h,  short: btc.short_liquidation_usd_1h,  total: btc.liquidation_usd_1h  },
    '4h':  { long: btc.long_liquidation_usd_4h,  short: btc.short_liquidation_usd_4h,  total: btc.liquidation_usd_4h  },
    '24h': { long: btc.long_liquidation_usd_24h, short: btc.short_liquidation_usd_24h, total: btc.liquidation_usd_24h }
  };

  // ── FUTURES CHARTS ──────────────────────────────────────────
  const intervals = { '1h': 'h1', '4h': 'h4', '24h': 'h24' };
  const futures = {};

  for (const [label, t] of Object.entries(intervals)) {
    const url = new URL('https://capi.coinglass.com/api/futures/liquidation/chart');
    url.searchParams.set('symbol','BTC-PERPETUAL');
    url.searchParams.set('timeType', t);

    const r = await fetch(url);
    if (!r.ok) throw new Error(`Futures ${t} HTTP ${r.status}`);
    futures[label] = await r.json();
  }

  // ── WRITE OUTPUT ────────────────────────────────────────────
  const out = { spot, futures };
  const file = resolve(process.cwd(), 'liquidation.json');
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('✔ liquidation.json written');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
