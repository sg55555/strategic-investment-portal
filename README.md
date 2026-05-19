# Strategic Investment Portal

プロの機関投資家向け端末を凌駕する、完全プライベートな株価・財務分析ダッシュボード。

## 機能

- **84社収録**（日本株 72社 + 米国株 7社 + ETF 5社）
- ローソク足チャート（移動平均線 5/25/75日、出来高）
- 財務3表（BS/PL/CF）+ レーダーチャートによる視覚的分析
- 3年度比較 KPIパネル（YoY自動計算）
- セクターフィルター・スクリーニング機能（PER/PBR/自己資本比率/営業利益率）
- ウォッチリスト（LocalStorage永続化）
- CSVエクスポート機能
- 米国株対応（USD通貨表示・暦年フィルタ）
- レスポンシブ対応

## 技術スタック

| カテゴリ | 技術 |
|---|---|
| フロントエンド | Vanilla HTML/CSS/JavaScript（SPA） |
| チャート | [Lightweight Charts 4.2](https://tradingview.github.io/lightweight-charts/)、[Chart.js v4](https://www.chartjs.org/) |
| データ取得 | Python / [yfinance](https://github.com/ranaroussi/yfinance) |
| データ保存 | SQLite3 |
| デプロイ | GitHub Pages / Vercel |

## ファイル構成

```
investment-portal/
├── index.html           # メインSPA（フロントエンド・Vercelデプロイ対象）
├── data.js              # 静的データファイル（STOCK_DATA）
├── favicon.svg / robots.txt / sitemap.xml / vercel.json
├── scripts/             # バックエンド Python スクリプト
│   ├── auto_terminal_filter.py  # 財務データ取得 → SQLite格納
│   ├── get_stock_multi.py       # SQLite → data.js生成
│   ├── update_data.py           # 自動更新スクリプト（日次/年次）
│   ├── analyze_financials.py    # AI財務コメント生成
│   └── maintain.sh              # 定期メンテナンス（tmp削除・ログアーカイブ）
├── data/                # ローカルのみ（gitignore対象）
│   ├── investment.db    # SQLiteデータベース
│   └── analysis_cache.json
├── tmp/                 # 一時ファイル（gitignore対象）
└── logs/                # ログ（gitignore対象）
    └── update_log.txt
```

## データ更新

```bash
# 日次更新（株価・市場指標）
python scripts/update_data.py

# 年次更新（財務3表も含む）
python scripts/update_data.py --full

# 企業追加（scripts/auto_terminal_filter.pyのtarget_companiesを編集後）
python scripts/auto_terminal_filter.py
python scripts/get_stock_multi.py
```

## メンテナンス

```bash
# 手動実行（tmp/ の古いファイル削除 + logs/ アーカイブ）
bash scripts/maintain.sh

# cron 設定（毎週日曜 2:00 に自動実行）
# 0 2 * * 0 /home/shugo/apps/investment-portal/scripts/maintain.sh >> /home/shugo/apps/investment-portal/logs/maintain.log 2>&1
```

## 免責事項

本サイトは個人的な学習・研究目的のみを対象としています。データの正確性を保証しません。投資判断は必ず公式データおよびご自身の判断に基づいて行ってください。

Data powered by yfinance.
