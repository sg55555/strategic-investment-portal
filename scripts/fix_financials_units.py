#!/usr/bin/env python3
"""yfinance 由来の財務行のうち、生の通貨単位（円/ドル）のまま入った行を百万単位へ直す。

背景（2026-08-25 に判明）:
  refresh_market.py --financials（2026-07-11 導入・毎週土曜の cron）が yfinance の値を /1e6 せずに
  market.financials_annual（百万単位の規約）へ書いていた。被害＝333行/146銘柄。チャートは単位規約
  どおりに動いた結果「39918854.0兆円」を事実として描いた。
  ETL 側は修正済み（refresh_market.py: 実物ラベル＋/1e6＋生単位漏れの loud-fail）。修正後の ETL を
  1回回せば yfinance が返す年（直近5期・2022〜2026）は上書きで直る。**このスクリプトはそれで直らない
  古い年（yfinance がもう返さない 2021 の3行）と、ETL 再実行までの間の全行を直すためのもの**。

安全設計:
  - source='yfinance' の行だけ触る（EDINET 行は規約どおり百万単位＝対象外）。
  - 通貨別のしきい値（百万単位で JPY 1e9＝1000兆円 / USD 1e7＝10兆ドル）を超える行だけ対象。
    正当な最大級（MUFG 総資産≈4e8 百万円・JPMorgan≈4e6 百万ドル）は必ず通し、生単位の漏れ
    （小型株でも JPY≥1e10・USD≥1e8）は必ず捕まえる位置。finance-rules.js の UNIT_SANE_LIMIT と同値。
  - **冪等**: 割った後はしきい値未満になるので、二度実行しても二度割りしない。
  - 既定は dry-run（対象行を全部表示するだけ）。--apply で初めて UPDATE する。NULL は NULL のまま。
  - 金額列だけ割る（source/年度/期は不変）。

使い方:
    export DATABASE_URL='postgresql://...'          # Neon 接続文字列（market スキーマ UPDATE 権限）
    python scripts/fix_financials_units.py              # dry-run（対象行を表示）
    python scripts/fix_financials_units.py --apply      # 実際に書き込む
依存: psycopg>=3
"""
from __future__ import annotations

import argparse
import os
import sys

# refresh_market.py と同じ列定義を使う（写しを持たない）。
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.refresh_market import _FIN_COLS  # noqa: E402

MILLION = 1_000_000.0
# finance-rules.js の UNIT_SANE_LIMIT と同値（百万単位）。変えるときは両方同じ向きに。
UNIT_SANE_LIMIT = {"JPY": 1e9, "USD": 1e7}


def max_abs(row_vals) -> float:
    xs = [abs(v) for v in row_vals if isinstance(v, (int, float)) and v == v]
    return max(xs) if xs else 0.0


def is_raw_unit_leak(row_vals, currency: str | None) -> bool:
    """行の金額列の最大絶対値が通貨別しきい値以上なら「生単位の漏れ」。通貨不明は JPY 側（緩い方）。"""
    limit = UNIT_SANE_LIMIT.get(currency or "", UNIT_SANE_LIMIT["JPY"])
    return max_abs(row_vals) >= limit


def classify(rows, currency_of) -> list[dict]:
    """rows: (ticker, fiscal_year, fiscal_period, *_FIN_COLS 値) の並び。対象行だけを返す。"""
    out = []
    for r in rows:
        ticker, fy, period = r[0], r[1], r[2]
        vals = r[3:3 + len(_FIN_COLS)]
        cur = currency_of(ticker)
        if is_raw_unit_leak(vals, cur):
            out.append({"ticker": ticker, "fy": fy, "period": period, "currency": cur, "max_abs": max_abs(vals)})
    return out


def _connect():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        sys.exit("DATABASE_URL not set")
    import psycopg
    return psycopg.connect(url)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="実際に Neon へ書き込む（既定は dry-run）")
    args = ap.parse_args(argv)

    cols = ", ".join(_FIN_COLS)
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT ticker, currency FROM market.ticker_master")
            currency = dict(cur.fetchall())
            cur.execute(
                f"SELECT ticker, fiscal_year, fiscal_period, {cols} FROM market.financials_annual "
                f"WHERE source = 'yfinance' ORDER BY ticker, fiscal_year")
            rows = cur.fetchall()
        targets = classify(rows, lambda t: currency.get(t))
        print(f"yfinance 行: {len(rows)} / 生単位の漏れ（対象）: {len(targets)}")
        for t in targets:
            print(f"  {t['ticker']:8s} FY{t['fy']} {t['period']} {t['currency'] or '?':3s} max|v|={t['max_abs']:.3e}")
        if not targets:
            print("対象なし（冪等・既に百万単位）")
            return 0
        if not args.apply:
            print("\n→ dry-run。問題なければ --apply を付けて再実行してください。")
            return 0
        sets = ", ".join(f"{c} = {c} / {MILLION}" for c in _FIN_COLS)
        with conn.cursor() as cur:
            for t in targets:
                cur.execute(
                    f"UPDATE market.financials_annual SET {sets} "
                    f"WHERE ticker = %s AND fiscal_year = %s AND fiscal_period = %s AND source = 'yfinance'",
                    (t["ticker"], t["fy"], t["period"]))
        conn.commit()
        print(f"更新（適用）: {len(targets)} 行")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
