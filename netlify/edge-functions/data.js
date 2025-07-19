// netlify/edge-functions/data.js

/**
 * This edge function will run at the CDN edge on every request to /data
 * and fetch fresh Binance / Coingecko data live.
 */

export default async (request, context) => {
  const SYMBOL = 'BTCUSDT', LIMIT = 250
  const result = { dataA: {}, dataB: null, dataD: null, dataE: null, errors: [] }

  // A tiny browser-style fetch
  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`)
    return res.json()
  }

  // Indicator helpers (same as your index.html)
  const sma = (a,p) => a.slice(-p).reduce((s,x)=>s+x,0)/p
  const std = (a,p)=>{ const s=a.slice(-p),m=sma(s,p); return Math.sqrt(s.reduce((t,x)=>t+(x-m)**2,0)/p) }
  const ema = (a,p)=>{ if(a.length<p) return 0; const k=2/(p+1); let e=sma(a.slice(0,p),p); for(let i=p;i<a.length;i++) e=a[i]*k+e*(1-k); return e }
  const rsi = (a,p)=>{ if(a.length<p+1) return 0; let g=0,l=0; for(let i=1;i<=p;i++){const d=a[i]-a[i-1]; d>=0?g+=d:l-=d;} let ag=g/p,al=l/p; for(let i=p+1;i<a.length;i++){const d=a[i]-a[i-1]; ag=(ag*(p-1)+Math.max(d,0))/p; al=(al*(p-1)+Math.max(-d,0))/p;} return al===0?100:100-100/(1+ag/al) }
  const atr = (h,l,c,p)=>{ if(h.length<p+1) return 0; const arr=[]; for(let i=1;i<h.length;i++){arr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])))} return sma(arr.slice(-p),p) }

  // ─── Block A ───────────────────────────────────────────────────────────────
  for (const tf of ['15m','1h','4h','1d']) {
    try {
      const rows = await fetchJson(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`
      )
      if (!Array.isArray(rows)) throw new Error(`invalid klines`)
      const c = rows.map(r=>+r[4]), h=rows.map(r=>+r[2]), l=rows.map(r=>+r[3]), last=c.at(-1)||1
      result.dataA[tf] = {
        ema50:  +ema(c,50).toFixed(2),
        ema200: +ema(c,200).toFixed(2),
        rsi14:  +rsi(c,14).toFixed(1),
        bbPct:  +((4*std(c,20)/last)*100).toFixed(2),
        atrPct: +((atr(h,l,c,14)/last)*100).toFixed(2),
      }
    } catch (e) {
      result.errors.push(`A[${tf}]: ${e.message}`)
    }
  }

  // ─── Block B ───────────────────────────────────────────────────────────────
  try {
    const fr = await fetchJson(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`
    )
    if (!Array.isArray(fr)) throw new Error(`invalid fundingRate`)
    const arr = fr.slice(-42).map(d=>+d.fundingRate)
    const mean = arr.reduce((s,x)=>s+x,0)/arr.length
    const sd   = Math.sqrt(arr.reduce((t,x)=>t+(x-mean)**2,0)/arr.length)
    const z    = sd?((arr.at(-1)-mean)/sd).toFixed(2):'0.00'
    const [oiN, oiH] = await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`),
      fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`)
    ])
    const pct = (((+oiN.openInterest - +oiH[0].sumOpenInterest)/+oiH[0].sumOpenInterest)*100).toFixed(1)
    result.dataB = { fundingZ: z, oiDelta24h: pct }
  } catch (e) {
    result.errors.push(`B: ${e.message}`)
  }

  // ─── Block D ───────────────────────────────────────────────────────────────
  try {
    const cg = await fetchJson('https://api.coingecko.com/api/v3/coins/bitcoin')
    const fg = await fetchJson('https://api.alternative.me/fng/?limit=1')
    result.dataD = {
      sentimentUpPct: +cg.sentiment_votes_up_percentage.toFixed(1),
      fearGreed:      `${fg.data[0].value} · ${fg.data[0].value_classification}`
    }
  } catch (e) {
    result.errors.push(`D: ${e.message}`)
  }

  // ─── Block E ───────────────────────────────────────────────────────────────
  try {
    const gv = await fetchJson('https://api.coingecko.com/api/v3/global')
    const g  = gv.data
    result.dataE = {
      totalMcapT:   +((g.total_market_cap.usd/1e12).toFixed(2)),
      mcap24hPct:   +g.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance: +g.market_cap_percentage.btc.toFixed(2),
      ethDominance: +g.market_cap_percentage.eth.toFixed(2),
    }
  } catch (e) {
    result.errors.push(`E: ${e.message}`)
  }

  // ─── Return JSON ────────────────────────────────────────────────────────────
  return new Response(JSON.stringify({ ...result, timestamp: Date.now() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
