#!/usr/bin/env python3
"""W1: /api/market/list の gzip サイズ回帰（上限 60KB）＋ px カバレッジの確認。

    .venv/bin/python scratchpad/w1-payload-check.py
Neon への SELECT のみ（書込ゼロ）。fetch_list() を直接呼ぶので Vercel は不要。
"""
import gzip
import importlib.util
import json
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LIMIT_KB = 60.0

for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

spec = importlib.util.spec_from_file_location("market_list", os.path.join(ROOT, "api", "market", "list.py"))
market_list = importlib.util.module_from_spec(spec)
spec.loader.exec_module(market_list)

t0 = time.time()
payload = market_list.fetch_list()
elapsed = (time.time() - t0) * 1000
body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
gz = len(gzip.compress(body)) / 1024
stocks = payload["stocks"]
with_px = sum(1 for e in stocks.values() if "px" in e)
spark_ok = all(len(e["px"]["spark"]) <= 30 for e in stocks.values() if e.get("px") and e["px"].get("spark"))

print(f"fetch_list: {elapsed:.0f}ms  gzip={gz:.1f}KB  px={with_px}/{len(stocks)}  "
      f"asof={payload['market_asof']}  px_error={payload['px_error']}")
fail = []
if gz > LIMIT_KB:
    fail.append(f"payload {gz:.1f}KB > 上限 {LIMIT_KB}KB")
if payload["px_error"]:
    fail.append("px_error=True（価格集計が失敗している）")
if with_px < len(stocks) * 0.9:
    fail.append(f"px カバレッジが低い（{with_px}/{len(stocks)}）")
if not spark_ok:
    fail.append("spark が30点を超えている")
if not payload["market_asof"]:
    fail.append("market_asof が空")
print("❌ " + " / ".join(fail) if fail else "✅ payload OK")
sys.exit(1 if fail else 0)
