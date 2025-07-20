// netlify/edge-functions/data.js
export default async (request) => {
  const SYMBOL = 'BTCUSDT';
  const LIMIT  = 250;

  const result = { dataA:{}, dataB:null, dataC:{}, dataD:null, dataE:null, errors:[] };

  /* ─ indicator helpers …  (unchanged code for sma, std, ema, rsi, atr) ─ */

  /* ─ blocs A, B, D, E … (identical to your previous version) ─ */

  // ─── BLOCK C: Long / Short Liquidations (public endpoint) ─────────────
  try {
    // Pull the last 1 000 liquidation rows once,
    // then slice them into 1 h, 4 h, 24 h buckets ↓
    const rows = await fetch(
      `https://fapi.binance.com/fapi/v1/allForceOrders` +
      `?symbol=${SYMBOL}&limit=1000&autoCloseType=LIQUIDATION`
    ).then(async r => {
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('application/json'))
        throw new Error(`unexpected content-type: ${ct}`);
      return r.json();
    });

    if (!Array.isArray(rows)) throw new Error('allForceOrders not array');

    const now   = Date.now();
    const winHr = { '1h':1, '4h':4, '24h':24 };
    const dataC = {};

    for (const [label, hrs] of Object.entries(winHr)) {
      const cutoff = now - hrs * 3_600_000;
      let longUsd = 0, shortUsd = 0;

      for (const o of rows) {
        if (o.time < cutoff) break;             // rows are newest → oldest
        const price = +o.avgPrice || +o.price;
        const usd   = +o.origQty * price;
        if (o.side === 'SELL') longUsd  += usd; // long position liquidated
        else                   shortUsd += usd; // short position liquidated
      }

      dataC[label] = {
        long:  +longUsd.toFixed(2),
        short: +shortUsd.toFixed(2),
        total: +(longUsd + shortUsd).toFixed(2)
      };
    }

    result.dataC = dataC;
  } catch (e) {
    result.errors.push(`C: ${e.message}`);
    result.dataC = {};
  }

  /* ─ return JSON ─ */
  return new Response(
    JSON.stringify({ ...result, timestamp: Date.now() }),
    { headers:{ 'Content-Type':'application/json' } }
  );
};
