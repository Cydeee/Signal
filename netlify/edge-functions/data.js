// netlify/edge-functions/data.js
export default async (_req) => {
  const SYMBOL = 'BTCUSDT';   // change or loop for other pairs
  const LIMIT  = 250;         // klines each tf for bloc A

  const result = {
    dataA: {}, dataB: {}, dataC: {},
    dataD: null, dataE: null, dataF: null,
    errors: []
  };

  /* ───────── resilient JSON fetch for Binance/Futures ───────── */
  async function safeJson(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (NetlifyEdge)',
          'Accept':     'application/json'
        }
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {       // got HTML / blank
        await new Promise(r => setTimeout(r, 400));
        continue;                                   // retry
      }
      const txt = await res.text();
      try { return JSON.parse(txt); }               // success
      catch { await new Promise(r => setTimeout(r, 400)); }
    }
    throw new Error('invalid JSON after retries');
  }

  /* ───────── indicator helpers ───────── */
  const sma=(a,p)=>a.slice(-p).reduce((s,x)=>s+x,0)/p;
  const std=(a,p)=>{const s=a.slice(-p),m=sma(s,p);return Math.sqrt(s.reduce((t,x)=>t+(x-m)**2,0)/p);};
  const ema=(a,p)=>{if(a.length<p)return 0;const k=2/(p+1);let e=sma(a.slice(0,p),p);for(let i=p;i<a.length;i++)e=a[i]*k+e*(1-k);return e;};
  function rsi(a,p){if(a.length<p+1)return 0;let g=0,l=0;for(let i=1;i<=p;i++){const d=a[i]-a[i-1];d>=0?g+=d:l-=d;}let ag=g/p,al=l/p;
    for(let i=p+1;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;}return al===0?100:100-100/(1+ag/al);}
  const atr=(h,l,c,p)=>{if(h.length<p+1)return 0;const t=[];for(let i=1;i<h.length;i++)t.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));return sma(t.slice(-p),p);};

  /* ───────── BLOC A – trend / volatility ───────── */
  for (const tf of ['15m','1h','4h','1d']) {
    try {
      const rows = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      if (!Array.isArray(rows)) throw new Error('klines not array');

      const c=rows.map(r=>+r[4]),h=rows.map(r=>+r[2]),l=rows.map(r=>+r[3]),last=c.at(-1)||1;
      result.dataA[tf] = {
        ema50:+ema(c,50).toFixed(2),
        ema200:+ema(c,200).toFixed(2),
        rsi14:+rsi(c,14).toFixed(1),
        bbPct:+((4*std(c,20)/last)*100).toFixed(2),
        atrPct:+((atr(h,l,c,14)/last)*100).toFixed(2)
      };
    } catch (e) { result.errors.push(`A[${tf}]: ${e.message}`); }
  }

  /* ───────── BLOC B – price-action insight ───────── */
  try {
    for (const tf of ['15m','1h','4h','1d']) {
      const rows = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=5`);
      if(!Array.isArray(rows)||rows.length<5) throw new Error(`klines[${tf}]`);

      const closes=rows.map(r=>+r[4]);
      const pct=((closes.at(-1)-closes[0])/closes[0])*100;

      let note;
      if(pct>=1.5)          note='🔼 strong up-move – breakout long / exit shorts';
      else if(pct>=0.5)     note='⬆ bullish drift – long bias';
      else if(pct<=-1.5)    note='🔽 strong down-move – breakout short / exit longs';
      else if(pct<=-0.5)    note='⬇ bearish drift – short bias';
      else {                // range → potential reversal
        note = closes.at(-1)>closes.at(-2)
          ? '↗ range base – early long reversal?'
          : '↘ range top – early short reversal?';
      }
      result.dataB[tf] = { pct:+pct.toFixed(2), note };
    }
  } catch (e) {
    result.errors.push(`B: ${e.message}`);
    result.dataB={};
  }

  /* ───────── BLOC C – volume-flow (15 m, 1 h, 4 h, 24 h) ───────── */
  try {
    const rows = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1600`);
    if(!Array.isArray(rows)) throw new Error('1m klines not array');

    const now=Date.now(), win={'15m':0.25,'1h':1,'4h':4,'24h':24};
    for(const [lbl,hrs] of Object.entries(win)){
      const cut=now-hrs*3_600_000;
      let bull=0,bear=0;
      for(const k of rows){ const ts=+k[0]; if(ts<cut) continue;
        const open=+k[1],close=+k[4],vol=+k[5];
        close>=open? bull+=vol : bear+=vol;
      }
      result.dataC[lbl]={bullVol:+bull.toFixed(2),bearVol:+bear.toFixed(2),totalVol:+(bull+bear).toFixed(2)};
    }
    const tot24=result.dataC['24h'].totalVol;
    const base={'15m':tot24/96,'1h':tot24/24,'4h':tot24/6};
    result.dataC.relative={};
    for(const lbl of ['15m','1h','4h']){
      const r=result.dataC[lbl].totalVol/Math.max(base[lbl],1);
      result.dataC.relative[lbl]=r>2?'very high':r>1.2?'high':r<0.5?'low':'normal';
    }
  } catch (e) {
    result.errors.push(`C: ${e.message}`);
    result.dataC={};
  }

  /* ───────── BLOC D – derivatives positioning ───────── */
  try {
    const fr   = await safeJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    if(!Array.isArray(fr)) throw new Error('fundingRate not array');

    const arr=fr.slice(-42).map(d=>+d.fundingRate),mean=sma(arr,arr.length),
          sd=Math.sqrt(arr.reduce((t,x)=>t+(x-mean)**2,0)/arr.length),
          z = sd?((arr.at(-1)-mean)/sd).toFixed(2):'0.00';

    const oiNow = await safeJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist= await safeJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);

    if(typeof oiNow.openInterest!=='string'||!oiHist[0]?.sumOpenInterest) throw new Error('OI shape');

    const pct24h=(((+oiNow.openInterest-+oiHist[0].sumOpenInterest)/+oiHist[0].sumOpenInterest)*100).toFixed(1);
    result.dataD={ fundingZ:z, oiDelta24h:pct24h };
  } catch (e) { result.errors.push(`D: ${e.message}`); }

  /* ───────── BLOC E – sentiment ───────── */
  try {
    const cg = await fetch('https://api.coingecko.com/api/v3/coins/bitcoin').then(r=>r.json());
    const up=cg.sentiment_votes_up_percentage ?? cg.community_data?.sentiment_votes_up_percentage;
    if(up==null) throw new Error('sentiment missing');
    const fg = await fetch('https://api.alternative.me/fng/?limit=1').then(r=>r.json());
    const fgd=fg.data?.[0]; if(!fgd) throw new Error('FNG missing');
    result.dataE={ sentimentUpPct:+up.toFixed(1), fearGreed:`${fgd.value} · ${fgd.value_classification}` };
  } catch (e) { result.errors.push(`E: ${e.message}`); }

  /* ───────── BLOC F – macro context ───────── */
  try {
    const gv = await fetch('https://api.coingecko.com/api/v3/global').then(r=>r.json());
    const g  = gv.data; if(!g?.total_market_cap?.usd) throw new Error('global missing');
    result.dataF={
      totalMcapT:+(g.total_market_cap.usd/1e12).toFixed(2),
      mcap24hPct:+g.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance:+g.market_cap_percentage.btc.toFixed(2),
      ethDominance:+g.market_cap_percentage.eth.toFixed(2)
    };
  } catch (e) { result.errors.push(`F: ${e.message}`); }

  /* ───────── return JSON ───────── */
  return new Response(
    JSON.stringify({ ...result, timestamp:Date.now() }),
    { headers:{ 'Content-Type':'application/json' } }
  );
};
