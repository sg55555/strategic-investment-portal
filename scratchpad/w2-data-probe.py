"""W2 の設計判断に要る2点を本番データで実測する（読み取りのみ）。

    python3 scratchpad/w2-data-probe.py

  ① ベンチ(1306.T/SPY)と代表銘柄に「1日だけ 1/10 になって戻る」型の異常バーが無いか
     （実際に 1306.T の 2026-03-30/31 で踏んだ。分割の未調整と思われる）。
  ② ベンチ重ね描きを**同一価格軸**に載せたとき、窓ごとにローソクがどれだけ圧縮されるか
     （リベース後のベンチの値域 ÷ ローソクの値域）。5Y/MAX で破綻しないかの判断材料。
"""
import json
import statistics
import urllib.request

PROD = "https://strategic-investment-portal.vercel.app"
TICKERS = ["7203.T", "6758.T", "8306.T", "9984.T", "1306.T", "SPY", "AAPL", "NVDA"]


def fetch(ticker):
    url = f"{PROD}/api/market/ohlcv?ticker={urllib.parse.quote(ticker)}"
    req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
    return json.loads(raw)["prices"]


def outliers(prices, factor=3.0, win=11):
    """前後の中央値から factor 倍以上ずれた終値（＝1日だけ跳ぶ型）を拾う。"""
    out = []
    for i, p in enumerate(prices):
        lo, hi = max(0, i - win // 2), min(len(prices), i + win // 2 + 1)
        neigh = [q["close"] for j, q in enumerate(prices[lo:hi], lo) if j != i]
        if len(neigh) < 4:
            continue
        med = statistics.median(neigh)
        if med <= 0:
            continue
        r = p["close"] / med
        if r > factor or r < 1 / factor:
            out.append((p["time"], round(p["close"], 2), round(med, 2), round(r, 3)))
    return out


def window(prices, months):
    if not prices:
        return []
    end = prices[-1]["time"]
    y, m, d = int(end[:4]), int(end[5:7]), int(end[8:10])
    tm, ty = m - months, y
    while tm <= 0:
        tm += 12
        ty -= 1
    start = f"{ty:04d}-{tm:02d}-{min(d, 28):02d}"
    return [p for p in prices if p["time"] >= start]


def rng(vals):
    return (max(vals) - min(vals)) if vals else 0


def main():
    data = {}
    print("=== ① 異常バー（1日だけ跳ぶ終値・前後中央値の3倍以上ズレ）===")
    for t in TICKERS:
        try:
            data[t] = fetch(t)
        except Exception as e:                                  # noqa: BLE001
            print(f"{t}: 取得失敗 {e}")
            continue
        o = outliers(data[t])
        print(f"{t:8s} bars={len(data[t]):6d} 異常={len(o):3d} " + (str(o[:6]) if o else ""))

    # ② は「データが正しければどうなるか」を見たいので、①で見つかった異常バーは除いて測る
    #    （異常バー込みの数字は 1306.T の 2026-03-30/31 に引っ張られて実態より悪く出る）。
    for t, prices in list(data.items()):
        bad = {o[0] for o in outliers(prices)}
        if bad:
            data[t] = [p for p in prices if p["time"] not in bad]
            print(f"\n  ※ {t}: 異常バー {len(bad)} 本を除いて②を測る {sorted(bad)}")

    print("\n=== ② 同一軸にベンチを重ねたときの圧縮率（ベンチ値域 ÷ ローソク値域・異常バー除去後）===")
    print("  1.0 なら影響なし。大きいほどローソクが縦に潰れる。")
    for stock in ["7203.T", "6758.T", "AAPL", "NVDA"]:
        if stock not in data:
            continue
        bench = "1306.T" if stock.endswith(".T") else "SPY"
        if bench not in data:
            continue
        row = [f"{stock:8s} vs {bench:7s}"]
        for label, months in [("1M", 1), ("6M", 6), ("1Y", 12), ("5Y", 60), ("MAX", None)]:
            win = data[stock] if months is None else window(data[stock], months)
            if len(win) < 2:
                row.append(f"{label}=--")
                continue
            s, e = win[0]["time"], win[-1]["time"]
            bw = [p for p in data[bench] if s <= p["time"] <= e]
            if len(bw) < 2:
                row.append(f"{label}=--")
                continue
            base, main_base = bw[0]["close"], win[0]["close"]
            reb = [main_base * (p["close"] / base) for p in bw]
            cand = [p["high"] for p in win] + [p["low"] for p in win]
            ratio = rng(reb) / rng(cand) if rng(cand) else 0
            row.append(f"{label}={ratio:5.2f}")
        print("  " + "  ".join(row))


if __name__ == "__main__":
    import urllib.parse
    main()
