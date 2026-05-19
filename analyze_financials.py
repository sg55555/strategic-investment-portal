#!/usr/bin/env python3
"""
AI財務分析コメント生成スクリプト
各企業・各年度の財務データを分析し、経営状況の解説コメントを生成します。

使い方:
  python analyze_financials.py

必要環境変数:
  ANTHROPIC_API_KEY=sk-ant-...
  または .env ファイルに記載

生成されたコメントは analysis_cache.json に保存され、
get_stock_multi.py の実行時に data.js に組み込まれます。
"""

import os
import sys
import json
import sqlite3
from pathlib import Path

try:
    import anthropic
except ImportError:
    print("ERROR: anthropic パッケージが未インストールです。")
    print("  $ .venv/bin/pip install anthropic")
    sys.exit(1)

# .env ファイルからAPIキーを読み込む
env_file = Path(__file__).parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line.startswith("ANTHROPIC_API_KEY="):
            os.environ["ANTHROPIC_API_KEY"] = line.split("=", 1)[1].strip()
            break

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
if not API_KEY:
    print("ERROR: ANTHROPIC_API_KEY が未設定です。")
    print("  .env ファイルに ANTHROPIC_API_KEY=sk-ant-... を記載してください。")
    sys.exit(1)

DB_PATH    = "/home/shugo/weather.db"
CACHE_PATH = Path(__file__).parent / "analysis_cache.json"

client = anthropic.Anthropic(api_key=API_KEY)

def generate_analysis(company_name: str, ticker: str, currency: str, year: int,
                       prev_year_data: dict | None, current_data: dict) -> str:
    """Claude にて財務データを分析し、日本語コメントを生成する"""

    unit = "百万ドル" if currency == "USD" else "百万円"

    # 前年比計算
    def yoy(curr, prev_key):
        if prev_year_data and prev_year_data.get(prev_key, 0) != 0:
            pct = ((curr - prev_year_data[prev_key]) / abs(prev_year_data[prev_key])) * 100
            sign = "+" if pct >= 0 else ""
            return f"{sign}{pct:.1f}%"
        return "前年比不明"

    sales     = current_data.get("net_sales", 0)
    op_inc    = current_data.get("operating_income", 0)
    net_inc   = current_data.get("net_income", 0)
    op_cf     = current_data.get("operating_cf", 0)
    inv_cf    = current_data.get("investing_cf", 0)
    fin_cf    = current_data.get("financing_cf", 0)
    n_assets  = current_data.get("net_assets", 0)
    t_assets  = (current_data.get("current_assets", 0) + current_data.get("non_current_assets", 0))
    op_margin = (op_inc / sales * 100) if sales > 0 else 0
    roe       = (net_inc / n_assets * 100) if n_assets > 0 else 0

    prompt = f"""あなたは機関投資家向けの財務アナリストです。
以下の財務データをもとに、{company_name}（{ticker}）の{year}年度の経営状況を
**日本語で3〜4文の簡潔な分析コメント**として記述してください。

## {year}年度 財務データ（{unit}単位）
- 売上高: {sales:,} {unit}（前年比: {yoy(sales, 'net_sales')}）
- 営業利益: {op_inc:,} {unit}（営業利益率: {op_margin:.1f}%）
- 当期純利益: {net_inc:,} {unit}（ROE: {roe:.1f}%）
- 営業CF: {op_cf:,} {unit}
- 投資CF: {inv_cf:,} {unit}
- 財務CF: {fin_cf:,} {unit}
- 純資産: {n_assets:,} {unit}

## 記述ルール
- 数値の変化（増収・増益・減収・減益）とその一般的な業界背景に触れる
- 「キャッシュフロー状況」と「財務健全性」について言及する
- 推測・断定的な表現は避け、データから読み取れることに限定する
- 3〜4文、200文字以内
- 注記や見出しは不要。コメント本文のみ出力すること
"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text.strip()


def main():
    # キャッシュの読み込み
    cache = {}
    if CACHE_PATH.exists():
        cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT ticker, company_name, COALESCE(currency,'JPY') FROM ticker_master")
    companies = cursor.fetchall()

    updated = 0
    for ticker, company_name, currency in companies:
        # 財務データ取得（古い年度順）
        cursor.execute("""
            SELECT fiscal_year, current_assets, non_current_assets, current_liabilities,
                   non_current_liabilities, net_assets, net_sales, operating_income,
                   net_income, operating_cf, investing_cf, financing_cf
            FROM financial_data_v2 WHERE ticker = ? AND fiscal_period='FY'
            ORDER BY fiscal_year ASC
        """, (ticker,))
        rows = cursor.fetchall()
        if not rows:
            continue

        print(f"\n[{ticker}] {company_name}")
        prev_data = None
        for row in rows:
            year = row[0]
            data = {
                "current_assets": row[1], "non_current_assets": row[2],
                "current_liabilities": row[3], "non_current_liabilities": row[4],
                "net_assets": row[5], "net_sales": row[6], "operating_income": row[7],
                "net_income": row[8], "operating_cf": row[9],
                "investing_cf": row[10], "financing_cf": row[11]
            }

            cache_key = f"{ticker}_{year}"
            if cache_key in cache:
                print(f"  [{year}] キャッシュ済みスキップ")
                prev_data = data
                continue

            print(f"  [{year}] 生成中...")
            try:
                comment = generate_analysis(company_name, ticker, currency, year, prev_data, data)
                cache[cache_key] = comment
                print(f"  [{year}] OK: {comment[:50]}...")
                updated += 1
            except Exception as e:
                print(f"  [{year}] ERROR: {e}")

            prev_data = data

    conn.close()
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完了: {updated}件 新規生成、キャッシュ保存: {CACHE_PATH}")


if __name__ == "__main__":
    main()
