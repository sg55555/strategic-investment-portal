#!/usr/bin/env python3
"""Neon 財務テーブルに「移行時に欠落した3列」を SQLite から復元する。

背景（2026-06-30 監査 C4 で判明）:
  Slice1 の ETL(`etl_to_postgres.py`)は旧 data.js を source にしており、旧 data.js は
  gross_profit / cf_cash_start / cf_cash_end を持たなかった。そのため Neon の
  market.financials_annual はこの3列が全銘柄 NULL のまま。一方ローカル SQLite
  (data/investment.db の financial_data_v2)には実データが揃っている(0 null)。
  → フロント(index.html)はこの NULL に対し特定企業のマジック定数(期首現金 6524000)や
    売上総利益=売上×0.2 を捏造していた。フロント側は捏造を廃止済(欠損は正直表示)。
    本スクリプトは「本来あるデータ」を Neon に戻し、実値を表示できるようにする。

安全設計:
  - 既存3列のみ UPDATE（INSERT しない＝Neon に無い年度は触らない）。他の財務値は不変。
  - (ticker, fiscal_year, fiscal_period='FY') で一致した行だけ更新。
  - 既定は dry-run（差分を表示するだけ）。--apply で初めて書き込む。
  - 値が一致している行はスキップ（冪等）。

使い方:
    export DATABASE_URL='postgresql://...'          # Neon 接続文字列（最小権限ロール推奨）
    python scripts/restore_financials_to_neon.py              # dry-run（変更内容を表示）
    python scripts/restore_financials_to_neon.py --apply      # 実際に書き込む
依存: psycopg>=3
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

import psycopg

# 復元対象＝Neon 移行で欠落した3列のみ（監査 C4 で NULL 100% を確認）。
COLS = ("gross_profit", "cf_cash_start", "cf_cash_end")
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "investment.db"


def load_sqlite() -> dict:
    """{(ticker, fiscal_year): {col: value}} を SQLite から読む（period=FY のみ）。"""
    if not DB_PATH.exists():
        sys.exit(f"SQLite が見つかりません: {DB_PATH}")
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT ticker, fiscal_year, " + ", ".join(COLS)
        + " FROM financial_data_v2 WHERE fiscal_period = 'FY'"
    ).fetchall()
    con.close()
    out: dict = {}
    for r in rows:
        vals = {c: r[c] for c in COLS}
        if all(vals[c] is None for c in COLS):
            continue
        out[(r["ticker"], int(r["fiscal_year"]))] = vals
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="実際に Neon へ書き込む（既定は dry-run）")
    args = ap.parse_args()

    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        sys.exit("DATABASE_URL が未設定です。")

    src = load_sqlite()
    if not src:
        sys.exit("SQLite に復元対象データがありません。")
    print(f"SQLite 側: {len(src)} (ticker, year) 行に復元値あり。")

    set_clause = ", ".join(f"{c} = %s" for c in COLS)
    updated = skipped = missing = 0
    examples: list[str] = []

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        for (ticker, fy), vals in sorted(src.items()):
            cur.execute(
                "SELECT " + ", ".join(COLS)
                + " FROM market.financials_annual"
                " WHERE ticker = %s AND fiscal_year = %s AND fiscal_period = 'FY'",
                (ticker, fy),
            )
            row = cur.fetchone()
            if row is None:
                missing += 1
                continue
            cur_vals = dict(zip(COLS, row))
            # 既に同値なら冪等スキップ。NULL → 実値 の行だけ更新対象。
            if all(cur_vals[c] == vals[c] for c in COLS):
                skipped += 1
                continue
            if len(examples) < 8:
                examples.append(
                    f"  {ticker} {fy}: "
                    + ", ".join(f"{c} {cur_vals[c]}→{vals[c]}" for c in COLS if cur_vals[c] != vals[c])
                )
            if args.apply:
                cur.execute(
                    f"UPDATE market.financials_annual SET {set_clause}"
                    " WHERE ticker = %s AND fiscal_year = %s AND fiscal_period = 'FY'",
                    tuple(vals[c] for c in COLS) + (ticker, fy),
                )
            updated += 1
        if args.apply:
            conn.commit()

    print(f"更新{'（適用）' if args.apply else '（予定・dry-run）'}: {updated} 行 / 一致スキップ: {skipped} / Neon未存在: {missing}")
    if examples:
        print("変更例:")
        print("\n".join(examples))
    if not args.apply and updated:
        print("\n→ 問題なければ --apply を付けて再実行してください。")


if __name__ == "__main__":
    main()
