// netlify/functions/data.js

// 1) A fetch helper that pretends to be your browser
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      // exactly what a modern Chrome would send
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
      'Accept':          'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer':         'https://classy-pika-86d00e.netlify.app/',
    },
  });
  console.log(`→ ${res.status} ${url}`);
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) at ${url}`);
  }
  return res.json();
}

// 2) Your indicator helpers (copied from your index.html)
function sma(a,p){ return a.slice(-p).reduce((s,x)=>s+x,0)/p; }
function std(a,p){ const s=a.slice(-p),m=sma(s,p); return Math.sqrt(s.reduce((t,x)=>t+(x-m)**2,0)/p); }
function ema(a,p){ if(a.length<p) return 0; const k=2/(p+1); let e=sma(a.slice(0,p),p); for(let i=p;i<a.length;i++) e=a[i]*k+e*(1-k); return e; }
function rsi(a,p){ if(a.length<p+1) return 0; let g=0,l=0; for(let i=1;i<=p;i++){const d=a[i]-a[i-1]; d>=0?g+=d:l-=d;} let ag=g/p,al=l/p; for(let i=p+1;i<a.length;i++){const d=a[i]-a[i-1]; ag=(ag*(p-1)+(d>0?d:0))/p; al=(al*(p-1)+(d<0?-d:0))/p;} return al===0?100:100-100/(1+ag/al); }
function atr(h,l,c,p){ if(h.length<p+1) return 0; const t=[]; for(let j=1;j<h.length;j++) t.push(Math.max(h[j]-l[j],Math.abs(h[j]-c[j-1]),Math.abs(l[j]-c[j-1]))); return sma(t.slice(-p),p); }

// 3) The Netlify function handler
exports.handler = async () => {
  const SYMBOL = 'BTCUSDT', LIMIT = 250;
  const result = { dataA: {}, dataB: null, dataD: null, dataE: null, errors: [] };

  // Block A: klines
  for (const tf of ['15m','1h','4h','1d']) {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`;
      const rows = await fetchJson(url);
      if (!Array.isArray(rows)) throw new Error(`Not array at ${tf}`);
      const c = rows.map(r=>+r[4]), h=rows.map(r=>+r[2]), l=rows.map(r=>+r[3]), last=c.at(-1)||1;
      result.dataA[tf] = {
        ema50:  +ema(c,50).toFixed(2),
        ema200: +ema(c,200).toFixed(2),
        rsi14:  +rsi(c,14).toFixed(1),
        bbPct:  +((4*std(c,20)/last)*100).toFixed(2),
        atrPct: +((atr(h,l,c,14)/last)*100).toFixed(2),
      };
    } catch (e) {
      console.error(`A[${tf}] error:`, e.message);
      result.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  // Block B: derivatives positioning
  try {
    const frUrl = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`;
    const fr    = await fetchJson(frUrl);
    if (!Array.isArray(fr)) throw new Error('fundingRate not array');
    const arr = fr.slice(-42).map(d=>+d.fundingRate),
          m   = arr.reduce((s,x)=>s+x,0)/arr.length,
          sd  = Math.sqrt(arr.reduce((t,x)=>t+(x-m)**2,0)/arr.length),
          z   = sd?((arr.at(-1)-m)/sd).toFixed(2):'0.00';
    const [oiN, oiH] = await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`),
      fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`)
    ]);
    const pct = (((+oiN.openInterest - +oiH[0].sumOpenInterest)/+oiH[0].sumOpenInterest)*100).toFixed(1);
    result.dataB = { fundingZ: z, oiDelta24h: pct };
  } catch (e) {
    console.error('B error:', e.message);
    result.errors.push(`B: ${e.message}`);
  }

  // Block D: sentiment
  try {
    const cg = await fetchJson('https://api.coingecko.com/api/v3/coins/bitcoin');
    const fg = await fetchJson('https://api.alternative.me/fng/?limit=1');
    result.dataD = {
      sentimentUpPct: +cg.sentiment_votes_up_percentage.toFixed(1),
      fearGreed:      `${fg.data[0].value} · ${fg.data[0].value_classification}`
    };
  } catch (e) {
    console.error('D error:', e.message);
    result.errors.push(`D: ${e.message}`);
  }

  // Block E: macro risk
  try {
    const gv = await fetchJson('https://api.coingecko.com/api/v3/global');
    const g  = gv.data;
    result.dataE = {
      totalMcapT:   +((g.total_market_cap.usd/1e12).toFixed(2)),
      mcap24hPct:   +g.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance: +g.market_cap_percentage.btc.toFixed(2),
      ethDominance: +g.market_cap_percentage.eth.toFixed(2),
    };
  } catch (e) {
    console.error('E error:', e.message);
    result.errors.push(`E: ${e.message}`);
  }

  // Final response
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...result, timestamp: Date.now() })
  };
};
