// netlify/edge-functions/data.js
export default async (_request) => {
  const SYMBOL = 'BTCUSDT';   // linear USDT perp
  const LIMIT  = 250;         // klines per tf for bloc A

  const result = { dataA:{}, dataB:null, dataC:{}, dataD:null, dataE:null, errors:[] };

  /* ───────────────── Indicator helpers (unchanged) ─────────────────── */
  const sma = (a,p)=>a.slice(-p).reduce((s,x)=>s+x,0)/p;
  const std = (a,p)=>{const s=a.slice(-p),m=sma(s,p);return Math.sqrt(s.reduce((t,x)=>t+(x-m)**2,0)/p);};
  function ema(a,p){if(a.length<p)return 0;const k=2/(p+1);let e=sma(a.slice(0,p),p);for(let i=p;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
  function rsi(a,p){if(a.length<p+1)return 0;let g=0,l=0;for(let i=1;i<=p;i++){const d=a[i]-a[i-1];d>=0?g+=d:l-=d;}let ag=g/p,al=l/p;
    for(let i=p+1;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;}return al===0?100:100-100/(1+ag/al);}
  function atr(h,l,c,p){if(h.length<p+1)return 0;const t=[];for(let i=1;i<h.length;i++){t.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));}return sma(t.slice(-p),p);}

  /* ────────────────────────── BLOCK A (price TA) ───────────────────── */
  for(const tf of ['15m','1h','4h','1d']){
    try{
      const rows=await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`).then(r=>r.json());
      if(!Array.isArray(rows)) throw new Error('klines not array');
      const c=rows.map(r=>+r[4]),h=rows.map(r=>+r[2]),l=rows.map(r=>+r[3]),last=c.at(-1)||1;
      result.dataA[tf]={ema50:+ema(c,50).toFixed(2),ema200:+ema(c,200).toFixed(2),rsi14:+rsi(c,14).toFixed(1),
        bbPct:+((4*std(c,20)/last)*100).toFixed(2),atrPct:+((atr(h,l,c,14)/last)*100).toFixed(2)};
    }catch(e){result.errors.push(`A[${tf}]: ${e.message}`);}
  }

  /* ────────────────────────── BLOCK B (funding / OI) ───────────────── */
  try{
    const fr=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`).then(r=>r.json());
    if(!Array.isArray(fr)) throw new Error('fundingRate not array');
    const arr=fr.slice(-42).map(d=>+d.fundingRate),mean=arr.reduce((s,x)=>s+x,0)/arr.length,
          sd=Math.sqrt(arr.reduce((t,x)=>t+(x-mean)**2,0)/arr.length),z=sd?((arr.at(-1)-mean)/sd).toFixed(2):'0.00';
    const [oiNow,oiHist]=await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`).then(r=>r.json()),
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`).then(r=>r.json())
    ]);
    if(typeof oiNow.openInterest!=='string'||!oiHist[0]?.sumOpenInterest) throw new Error('OI shape unexpected');
    const pct24h=(((+oiNow.openInterest-+oiHist[0].sumOpenInterest)/+oiHist[0].sumOpenInterest)*100).toFixed(1);
    result.dataB={fundingZ:z,oiDelta24h:pct24h};
  }catch(e){result.errors.push(`B: ${e.message}`);}

  /* ────────────────────────── BLOCK C (Bybit liquidations) ──────────── */
  try{
    /**
     * Bybit v5 public REST:  /v5/market/liquidation
     *   – category = linear  (USDT-margined perps)
     *   – symbol   = e.g. BTCUSDT
     *   – limit    ≤ 1000
     * Docs & press release: Bybit made the entire liquidation tape public in Feb-2025 :contentReference[oaicite:0]{index=0}
     */
    async function sumWindow(hrs){
      const cutoff=Date.now()-hrs*3_600_000;
      let longUsd=0,shortUsd=0,cursor='';
      while(true){
        const url=new URL('https://api.bybit.com/v5/market/liquidation');
        url.searchParams.set('category','linear');
        url.searchParams.set('symbol',SYMBOL);
        url.searchParams.set('limit','1000');
        if(cursor) url.searchParams.set('cursor',cursor);
        const j=await fetch(url).then(r=>r.json());
        if(j.retCode!==0) throw new Error(`Bybit retCode ${j.retCode}`);
        const rows=j.result.list;
        if(!rows||rows.length===0) break;
        for(const r of rows){
          const ts=+r.updatedTime;
          if(ts<cutoff) return {longUsd,shortUsd};
          const usd=+r.qty*+r.price;
          // Bybit uses side BUY = shorts liquidated, SELL = longs liquidated
          r.side==='Sell'? longUsd+=usd : shortUsd+=usd;
        }
        if(!j.result.nextPageCursor) break;
        cursor=j.result.nextPageCursor;
      }
      return {longUsd,shortUsd};
    }

    // compute liquidation totals for three windows
    const windows={'1h':1,'4h':4,'24h':24};
    for(const [lbl,hrs] of Object.entries(windows)){
      const {longUsd,shortUsd}=await sumWindow(hrs);
      result.dataC[lbl]={long:+longUsd.toFixed(2),short:+shortUsd.toFixed(2),total:+(longUsd+shortUsd).toFixed(2)};
    }

    /* add a simple relativity tag: compare 1 h value to its 24 h average */
    const base=Math.max(result.dataC['24h'].total/24,1); // avoid /0
    const ratio=result.dataC['1h'].total/base;
    let level='normal';
    if(ratio>2) level='very high';
    else if(ratio>1.2) level='high';
    else if(ratio<0.5) level='low';
    result.dataC.relative24h=level;            // e.g. "high", "low", "normal"
  }catch(e){
    result.errors.push(`C: ${e.message}`);
    result.dataC={};
  }

  /* ────────────────────────── BLOCK D (sentiment) ──────────────────── */
  try{
    const cg=await fetch('https://api.coingecko.com/api/v3/coins/bitcoin').then(r=>r.json()),
          up=cg.sentiment_votes_up_percentage??cg.community_data?.sentiment_votes_up_percentage;
    if(up==null) throw new Error('Missing sentiment_votes_up_percentage');
    const fg=await fetch('https://api.alternative.me/fng/?limit=1').then(r=>r.json()),fgd=fg.data?.[0];
    if(!fgd) throw new Error('Missing Fear & Greed data');
    result.dataD={sentimentUpPct:+up.toFixed(1),fearGreed:`${fgd.value} · ${fgd.value_classification}`};
  }catch(e){result.errors.push(`D: ${e.message}`);}

  /* ────────────────────────── BLOCK E (macro) ─────────────────────── */
  try{
    const gv=await fetch('https://api.coingecko.com/api/v3/global').then(r=>r.json()),g=gv.data;
    if(!g?.total_market_cap?.usd) throw new Error('Missing global data');
    result.dataE={
      totalMcapT:+(g.total_market_cap.usd/1e12).toFixed(2),
      mcap24hPct:+g.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance:+g.market_cap_percentage.btc.toFixed(2),
      ethDominance:+g.market_cap_percentage.eth.toFixed(2)};
  }catch(e){result.errors.push(`E: ${e.message}`);}

  /* ─────────────────────────── Return JSON ────────────────────────── */
  return new Response(JSON.stringify({...result,timestamp:Date.now()}),
    {headers:{'Content-Type':'application/json'}});
};
