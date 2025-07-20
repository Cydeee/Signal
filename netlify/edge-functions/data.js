// netlify/edge-functions/data.js
export default async (_req) => {
  const SYMBOL = 'BTCUSDT';              // change later for other coins
  const LIMIT  = 250;                    // klines per tf for bloc A

  const result = {
    dataA: {},   // trend / volatility indicators
    dataB: {},   // price-action insight (NEW)
    dataC: {},   // volume-flow (with 15 m)
    dataD: null, // derivatives positioning  (old bloc B)
    dataE: null, // sentiment              (old bloc D)
    dataF: null, // macro context          (old bloc E)
    errors: []
  };

  /* ───────── helper funcs ───────── */
  const sma=(a,p)=>a.slice(-p).reduce((s,x)=>s+x,0)/p;
  const std=(a,p)=>{const s=a.slice(-p),m=sma(s,p);return Math.sqrt(s.reduce((t,x)=>t+(x-m)**2,0)/p);};
  function ema(a,p){if(a.length<p)return 0;const k=2/(p+1);let e=sma(a.slice(0,p),p);for(let i=p;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
  function rsi(a,p){if(a.length<p+1)return 0;let g=0,l=0;for(let i=1;i<=p;i++){const d=a[i]-a[i-1];d>=0?g+=d:l-=d;}let ag=g/p,al=l/p;
    for(let i=p+1;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;}return al===0?100:100-100/(1+ag/al);}
  function atr(h,l,c,p){if(h.length<p+1)return 0;const t=[];for(let i=1;i<h.length;i++)t.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));return sma(t.slice(-p),p);}

  /* ───────── BLOC A – trend / volatility (unchanged) ───────── */
  for(const tf of ['15m','1h','4h','1d']){
    try{
      const rows=await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`).then(r=>r.json());
      if(!Array.isArray(rows)) throw new Error('klines not array');

      const c=rows.map(r=>+r[4]),h=rows.map(r=>+r[2]),l=rows.map(r=>+r[3]),last=c.at(-1)||1;
      result.dataA[tf]={
        ema50:+ema(c,50).toFixed(2),
        ema200:+ema(c,200).toFixed(2),
        rsi14:+rsi(c,14).toFixed(1),
        bbPct:+((4*std(c,20)/last)*100).toFixed(2),
        atrPct:+((atr(h,l,c,14)/last)*100).toFixed(2)
      };
    }catch(e){result.errors.push(`A[${tf}]: ${e.message}`);}
  }

  /* ───────── BLOC B – price-action insight (NEW) ───────── */
  try{
    const frames=['15m','1h','4h','1d'];
    const dataB={};

    for(const tf of frames){
      // 5 most recent candles ≈ one pattern cycle
      const rows=await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=5`).then(r=>r.json());
      if(!Array.isArray(rows)||rows.length<5) throw new Error(`klines[${tf}]`);

      const closes=rows.map(r=>+r[4]);
      const pct   = ((closes.at(-1)-closes[0])/closes[0])*100;

      // simple momentum & reversal tagging
      let note;
      if(pct>=1.5)          note='🔼 strong up-move – consider breakout *long* or trailing shorts';
      else if(pct>=0.5)     note='⬆ bullish drift – bias long but watch for pullbacks';
      else if(pct<=-1.5)    note='🔽 strong down-move – consider breakout *short* or exiting longs';
      else if(pct<=-0.5)    note='⬇ bearish drift – bias short but watch for bounces';
      else {                // flat range – look for reversals
        const lastTwo = closes.slice(-2);
        note = lastTwo[1]>lastTwo[0]
          ? '↗ inside range – potential early *long* reversal'
          : '↘ inside range – potential early *short* reversal';
      }

      dataB[tf]={ pct:+pct.toFixed(2), note };
    }
    result.dataB=dataB;
  }catch(e){
    result.errors.push(`B: ${e.message}`);
    result.dataB={};
  }

  /* ───────── BLOC C – volume-flow proxy (15 m, 1 h, 4 h, 24 h) ───────── */
  try{
    // 1600 × 1-minute ≈ 26.6 h (covers 24 h window comfortably)
    const rows=await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1600`).then(r=>r.json());
    if(!Array.isArray(rows)) throw new Error('1m klines not array');

    const now  = Date.now();
    const win  = { '15m':0.25, '1h':1, '4h':4, '24h':24 };
    const dataC={};

    for(const [lbl,hrs] of Object.entries(win)){
      const cut=now-hrs*3_600_000;
      let bull=0,bear=0;
      for(const k of rows){
        const ts=+k[0]; if(ts<cut) continue;
        const open=+k[1],close=+k[4],vol=+k[5];
        close>=open? bull+=vol : bear+=vol;
      }
      dataC[lbl]={ bullVol:+bull.toFixed(2), bearVol:+bear.toFixed(2), totalVol:+(bull+bear).toFixed(2) };
    }

    /* relativity tags: compare each shorter window with its 24 h-scaled mean */
    const tot24 = dataC['24h'].totalVol;
    const base  = { '15m': tot24/96, '1h': tot24/24, '4h': tot24/6 };
    const rel   = {};
    for(const lbl of ['15m','1h','4h']){
      const r=dataC[lbl].totalVol/Math.max(base[lbl],1);
      rel[lbl]= r>2?'very high':r>1.2?'high':r<0.5?'low':'normal';
    }
    dataC.relative = rel;

    result.dataC=dataC;
  }catch(e){
    result.errors.push(`C: ${e.message}`);
    result.dataC={};
  }

  /* ───────── BLOC D – derivatives positioning (old bloc B) ───────── */
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
    result.dataD={ fundingZ:z, oiDelta24h:pct24h };
  }catch(e){ result.errors.push(`D: ${e.message}`); }

  /* ───────── BLOC E – sentiment (old bloc D) ───────── */
  try{
    const cg=await fetch('https://api.coingecko.com/api/v3/coins/bitcoin').then(r=>r.json()),
          up=cg.sentiment_votes_up_percentage??cg.community_data?.sentiment_votes_up_percentage;
    if(up==null) throw new Error('Missing sentiment_votes_up_percentage');

    const fg=await fetch('https://api.alternative.me/fng/?limit=1').then(r=>r.json()),fgd=fg.data?.[0];
    if(!fgd) throw new Error('Missing Fear & Greed data');

    result.dataE={ sentimentUpPct:+up.toFixed(1), fearGreed:`${fgd.value} · ${fgd.value_classification}` };
  }catch(e){ result.errors.push(`E: ${e.message}`); }

  /* ───────── BLOC F – macro context (old bloc E) ───────── */
  try{
    const gv=await fetch('https://api.coingecko.com/api/v3/global').then(r=>r.json()),g=gv.data;
    if(!g?.total_market_cap?.usd) throw new Error('Missing global data');

    result.dataF={
      totalMcapT:+(g.total_market_cap.usd/1e12).toFixed(2),
      mcap24hPct:+g.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance:+g.market_cap_percentage.btc.toFixed(2),
      ethDominance:+g.market_cap_percentage.eth.toFixed(2)
    };
  }catch(e){ result.errors.push(`F: ${e.message}`); }

  /* ───────── return JSON ───────── */
  return new Response(
    JSON.stringify({...result,timestamp:Date.now()}),
    { headers:{'Content-Type':'application/json'} }
  );
};
