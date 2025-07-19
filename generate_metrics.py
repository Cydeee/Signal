#!/usr/bin/env python3
import requests
import json
from statistics import mean, pstdev

BASE = "https://api.binance.com"
CG   = "https://api.coingecko.com/api/v3"

def fetch_block_a():
    """Fetch all four timeframes from Binance and compute EMA50, EMA200, RSI14, BB width%, ATR/Close%."""
    TF = {
      "15m": {"interval":"15m","sma_periods":(50,200),"rsi":14,"bb":20,"atr":14},
      "1h":  {"interval":"1h", "sma_periods":(50,200),"rsi":14,"bb":20,"atr":14},
      "4h":  {"interval":"4h", "sma_periods":(50,200),"rsi":14,"bb":20,"atr":14},
      "1d":  {"interval":"1d", "sma_periods":(50,200),"rsi":14,"bb":20,"atr":14},
    }
    out = {}
    for name,conf in TF.items():
        url = f"{BASE}/api/v3/klines"
        params = {"symbol":"BTCUSDT","interval":conf["interval"],"limit":250}
        data = requests.get(url, params=params).json()
        closes = [float(c[4]) for c in data]
        highs  = [float(c[2]) for c in data]
        lows   = [float(c[3]) for c in data]
        last   = closes[-1]

        # EMA by smoothing formula
        def ema(series, n):
            k = 2/(n+1)
            e = mean(series[:n])
            for price in series[n:]:
                e = price*k + e*(1-k)
            return e

        # RSI
        def rsi(series, n):
            gains = []
            losses = []
            for i in range(1,n+1):
                diff = series[i] - series[i-1]
                (gains if diff>0 else losses).append(abs(diff))
            avg_gain  = mean(gains)
            avg_loss  = mean(losses)
            rs = avg_gain/avg_loss if avg_loss>0 else 0
            # smooth further periods
            for i in range(n+1, len(series)):
                diff=series[i]-series[i-1]
                avg_gain = (avg_gain*(n-1) + max(diff,0))/n
                avg_loss = (avg_loss*(n-1) + max(-diff,0))/n
                rs = avg_gain/avg_loss if avg_loss>0 else 0
            return 100 - 100/(1+rs)

        # Bollinger-Band width % = (4*stddev/last)*100  (approx)
        bb_width = (4 * pstdev(closes[-conf["bb"]:]) / last * 100) if len(closes)>=conf["bb"] else None

        # ATR/Close %
        trs=[]
        for i in range(1,len(highs)):
            trs.append(max(
                highs[i]-lows[i],
                abs(highs[i]-closes[i-1]),
                abs(lows[i]-closes[i-1])
            ))
        atr_val = mean(trs[-conf["atr"]:]) if len(trs)>=conf["atr"] else None
        atr_pct = (atr_val/last*100) if atr_val else None

        out[name] = {
            "ema50": round(ema(closes, conf["sma_periods"][0]), 2),
            "ema200":round(ema(closes, conf["sma_periods"][1]), 2),
            "rsi":   round(rsi(closes, conf["rsi"]), 1),
            "bb_width_pct": round(bb_width, 2) if bb_width is not None else None,
            "atr_pct":      round(atr_pct, 2)  if atr_pct  is not None else None
        }
    return out

def fetch_block_b():
    """Funding-rate z-score and 24h open-interest %Δ from Binance."""
    # funding z-score
    fr = requests.get(f"{BASE}/fapi/v1/fundingRate", params={"symbol":"BTCUSDT","limit":1000}).json()
    arr = [float(x["fundingRate"]) for x in fr[-42:]]
    m, sd = mean(arr), pstdev(arr)
    z   = round((arr[-1]-m)/sd, 2) if sd>0 else 0

    # open interest %Δ
    oi_now = float(requests.get(f"{BASE}/fapi/v1/openInterest", params={"symbol":"BTCUSDT"}).json()["openInterest"])
    oi_hist = requests.get(
        f"{BASE}/futures/data/openInterestHist",
        params={"symbol":"BTCUSDT","period":"1h","limit":24}
    ).json()[0]["sumOpenInterest"]
    pct = round((oi_now - oi_hist) / oi_hist * 100, 1)

    return {"funding_z_score": z, "oi_pct_24h": pct}

def fetch_block_d():
    """CoinGecko sentiment votes % + Fear & Greed index."""
    cg = requests.get(f"{CG}/coins/bitcoin").json()
    fg = requests.get("https://api.alternative.me/fng/?limit=1").json()
    return {
      "sentiment_votes_percent": round(cg["sentiment_votes_up_percentage"], 1),
      "fear_and_greed": fg["data"][0]["value_classification"]
    }

def fetch_block_e():
    """Global crypto metrics from CoinGecko /global endpoint."""
    g = requests.get(f"{CG}/global").json()["data"]
    return {
      "total_market_cap_usd_t": round(g["total_market_cap"]["usd"]/1e12, 2),
      "mcap_change_24h_pct": round(g["market_cap_change_percentage_24h_usd"], 2),
      "btc_dominance_pct": round(g["market_cap_percentage"]["btc"], 2),
      "eth_dominance_pct": round(g["market_cap_percentage"]["eth"], 2)
    }

if __name__=="__main__":
    metrics = {
      "blockA": fetch_block_a(),
      "blockB": fetch_block_b(),
      "blockD": fetch_block_d(),
      "blockE": fetch_block_e()
    }
    with open("metrics.json","w") as f:
        json.dump(metrics, f, indent=2)
    print("✅ metrics.json written")
