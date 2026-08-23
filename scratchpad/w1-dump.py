#!/usr/bin/env python3
"""W1「ポータル一目パック」モック用の実データ dump（読取専用・Neon への書込ゼロ）。

本番 api/market/list.py の fetch_list() をそのまま呼んで list ペイロードを再現し、
market.ohlcv から発掘4点セット + 30日スパークラインを算出して各銘柄に px として合流する。

出力: scratchpad/w1-mock-data.json  = {"stocks": {...}, "updated_at": "...", "px_meta": {...}}

発掘4点セット（本実装で list.py に載せる想定の定義。ここが仕様の実体）:
  c1   前日比%          = (last/prev - 1) * 100
  c5   5営業日騰落%     = (last/close[-6] - 1) * 100
  vr   出来高急増倍率   = last_volume / avg(直近20営業日 volume、当日除く)
  dh   52週高値からの距離% = (last/high252 - 1) * 100   （0 = 高値更新中・負 = 下）
補助: last(終値) / date / low252 / high252 / pos52(レンジ内位置0-100) / spark(30点・0-100正規化整数)
"""
import json
import os
import sys
import importlib.util

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "scratchpad", "w1-mock-data.json")

# .env を読む（値は表示しない）
for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import psycopg  # noqa: E402

spec = importlib.util.spec_from_file_location(
    "prod_list", os.path.join(ROOT, "api", "market", "list.py"))
prod_list = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prod_list)

WINDOW = 260          # 取得する直近営業日数（52週=252 + 余裕）
SPARK_N = 30          # スパークラインの点数
VOL_AVG_N = 20        # 出来高平均の営業日数（当日を除く直近20）
YEAR_N = 252          # 52週


def compute_px(rows):
    """rows = [(date, close, volume), ...] 昇順。足りなければ None を返す。"""
    if len(rows) < 6:
        return None
    closes = [r[1] for r in rows if r[1] is not None]
    if len(closes) < 6:
        return None
    last = closes[-1]
    prev = closes[-2]
    c5_base = closes[-6]
    vols = [int(r[2] or 0) for r in rows]
    prior = vols[-(VOL_AVG_N + 1):-1] or [0]
    avg_vol = sum(prior) / len(prior)
    year = closes[-YEAR_N:]
    high = max(year)
    low = min(year)
    sp = closes[-SPARK_N:]
    lo, hi = min(sp), max(sp)
    rng = (hi - lo) or 1.0
    spark = [round((v - lo) / rng * 100) for v in sp]
    return {
        "last": round(last, 2),
        "date": rows[-1][0].isoformat(),
        "c1": round((last / prev - 1) * 100, 2) if prev else None,
        "c5": round((last / c5_base - 1) * 100, 2) if c5_base else None,
        "vr": round(vols[-1] / avg_vol, 2) if avg_vol else None,
        "dh": round((last / high - 1) * 100, 2) if high else None,
        "hi52": round(high, 2),
        "lo52": round(low, 2),
        "pos52": round((last - low) / ((high - low) or 1.0) * 100),
        "spark": spark,
    }


def main():
    payload = prod_list.fetch_list()
    stocks = payload["stocks"] if "stocks" in payload else payload
    url = os.environ["DATABASE_URL"]
    by_ticker = {}
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT ticker, date, close, volume FROM ("
            "  SELECT ticker, date, close, volume, ROW_NUMBER() OVER "
            "    (PARTITION BY ticker ORDER BY date DESC) rn FROM market.ohlcv"
            f") t WHERE rn <= {WINDOW} ORDER BY ticker, date ASC"
        )
        for ticker, date, close, vol in cur.fetchall():
            by_ticker.setdefault(ticker, []).append((date, close, vol))

    n_ok = 0
    for ticker, entry in stocks.items():
        px = compute_px(by_ticker.get(ticker, []))
        if px:
            entry["px"] = px
            n_ok += 1
    out = {
        "stocks": stocks,
        "updated_at": payload.get("updated_at", "") if isinstance(payload, dict) else "",
        "px_meta": {"tickers": len(stocks), "with_px": n_ok,
                    "spark_n": SPARK_N, "vol_avg_n": VOL_AVG_N, "year_n": YEAR_N},
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUT)
    print(f"wrote {OUT}  {size/1024:.1f}KB  tickers={len(stocks)} with_px={n_ok}")
    # px 部分だけのサイズも測る（本実装の payload 増分見積の根拠）
    px_only = json.dumps({t: s.get("px") for t, s in stocks.items() if s.get("px")},
                         ensure_ascii=False, separators=(",", ":"))
    print(f"px payload only: {len(px_only.encode())/1024:.1f}KB raw")
    import gzip
    print(f"px payload only: {len(gzip.compress(px_only.encode()))/1024:.1f}KB gzip")
    full = json.dumps(out["stocks"], ensure_ascii=False, separators=(",", ":")).encode()
    print(f"full list payload: {len(full)/1024:.1f}KB raw / {len(gzip.compress(full))/1024:.1f}KB gzip")


if __name__ == "__main__":
    sys.exit(main())
