// scripts/scrape-liquidations.js

import fs   from 'fs';
import path from 'path';
import fetch from 'node-fetch';  // we’ll add this to package.json

async function fetchWindow(symbol, spanMs) {
  const now = Date.now();
  const payload = {
    jsonrpc: '2.0',
    id:      1,
    method:  'public/get_last_trades_by_instrument_and_time',
    params: {
      instrument_name: `${symbol}-PERPETUAL`,
      start_timestamp: now - spanMs,
      end_timestamp:   now,
      count:           1000,
      include_old:     false
    }
  };

  const res = await fetch(
    'https://www.deribit.com/api/v2/public/get_last_trades_by_instrument_and_time',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    }
  );
  if (!res.ok) throw new Error(`${symbol} ${spanMs}ms HTTP ${res.status}`);
  const jr = await res.json();
  const trades = jr.result?.trades;
  if (!Array.isArray(trades)) throw new Error('Unexpected RPC shape');

  let long = 0, short = 0;
  for (const t of trades) {
    if (t.trade_type !== 'liquidation') continue;
    const usd = t.price * t.amount;    // $1 per contract
    if (t.direction === 'sell')  long  += usd;
    else if (t.direction === 'buy') short += usd;
  }
  return {
    long:  +long.toFixed(2),
    short: +short.toFixed(2),
    total: +((long + short).toFixed(2))
  };
}

async function main() {
  const symbol = 'BTC';  // ←– swap to ETH, SOL, etc.
  const windows = {
    '1h':  1  * 60 * 60 * 1000,
    '4h':  4  * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  };

  const out = {};
  for (const [label, span] of Object.entries(windows)) {
    out[label] = await fetchWindow(symbol, span);
  }

  const file = path.resolve(process.cwd(), 'liquidation.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`✔ Wrote ${file}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
