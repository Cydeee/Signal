  // ─── BLOCK B: Derivatives Positioning ──────────────────────────────────────
  try {
    // 1) funding rate
    const fr = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=' + SYMBOL + '&limit=1000')
                   .then(r=>r.json());
    if (!Array.isArray(fr)) throw new Error('fundingRate not array');
    const arr = fr.slice(-42).map(d=>+d.fundingRate),
          mean = arr.reduce((s,x)=>s+x,0)/arr.length,
          sd   = Math.sqrt(arr.reduce((t,x)=>t+(x-mean)**2,0)/arr.length),
          z    = sd ? ((arr.at(-1)-mean)/sd).toFixed(2) : '0.00';

    // 2) open interest history
    const [oiN, oiH] = await Promise.all([
      fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=' + SYMBOL).then(r=>r.json()),
      fetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=' + SYMBOL + '&period=1h&limit=24')
        .then(r=>r.json())
    ]);
    if (typeof oiN.openInterest !== 'string' || !oiH[0]?.sumOpenInterest) {
      throw new Error('OI shape unexpected');
    }
    const pct24h = (((+oiN.openInterest - +oiH[0].sumOpenInterest) / +oiH[0].sumOpenInterest) * 100).toFixed(1);

    result.dataB = { fundingZ: z, oiDelta24h: pct24h };
  } catch (e) {
    result.errors.push('B: ' + e.message);
  }

  // ─── BLOCK D: Sentiment ──────────────────────────────────────────────────────
  try {
    const cg = await fetch('https://api.coingecko.com/api/v3/coins/bitcoin')
                    .then(r=>r.json());
    // Coingecko sometimes nests sentiment under community_data
    const upPct = cg.sentiment_votes_up_percentage 
               ?? cg.community_data?.sentiment_votes_up_percentage
               ?? null;
    if (upPct == null) throw new Error('Missing sentiment_votes_up_percentage');

    const fg = await fetch('https://api.alternative.me/fng/?limit=1')
                    .then(r=>r.json());
    const fgData = fg.data?.[0];
    if (!fgData) throw new Error('Missing Fear & Greed data');

    result.dataD = {
      sentimentUpPct: +upPct.toFixed(1),
      fearGreed:      `${fgData.value} · ${fgData.value_classification}`
    };
  } catch (e) {
    result.errors.push('D: ' + e.message);
  }

  // ─── BLOCK E: Macro Risk Context ─────────────────────────────────────────────
  try {
    const gv = await fetch('https://api.coingecko.com/api/v3/global')
                    .then(r=>r.json());
    const g  = gv.data;
    if (!g?.total_market_cap?.usd) throw new Error('Missing global data');

    result.dataE = {
      totalMcapT:   +(g.total_market_cap.usd / 1e12).toFixed(2),
      mcap24hPct:   +g.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance: +g.market_cap_percentage.btc.toFixed(2),
      ethDominance: +g.market_cap_percentage.eth.toFixed(2),
    };
  } catch (e) {
    result.errors.push('E: ' + e.message);
  }
