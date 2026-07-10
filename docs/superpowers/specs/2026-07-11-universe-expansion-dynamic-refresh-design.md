# 設計書: 一覧データ拡充＋動的化（Universe Expansion + Dynamic Refresh）

- date: 2026-07-11
- status: draft（ユーザーレビュー待ち）
- project: investment-portal
- 由来: 将来タスク backlog #1（所有ノート `Projects/investment-portal.md` 「🗂 将来タスク backlog」）
- 関連: [[strategy-personal-finance-advice-intent]] / [[全アプリcron手動化]] / [[nexus-scale-design]] / [[investment-portal-dual-deploy-persona]]

---

## §0 目的・背景・非目標

### 目的
株価・財務データダッシュボードの銘柄ユニバースを **約95 → 約300（日米・セクター網羅）** へ拡充し、更新を **完全手動 → 自動（cron）** に恒常化する。中〜長期ファンダメンタルズ投資に必要な範囲での最新化を、Vercel Hobby 制約と既存アーキを壊さずに達成する。

### 背景（現状・実測）
- **ユニバース**: 現状 約95銘柄（JP74/US21）。正データ = Neon `market.ticker_master`。源流 = ローカル SQLite `data/investment.db`（`financial_data_v2` 等）→ `scripts/etl_to_postgres.py` → Neon。
- **更新**: 完全手動。`scripts/get_stock_multi.py`（yfinance で株価5年＋info[marketCap/per/pbr]、財務はローカル SQLite から読む）→ data.js 出荷、または `etl_to_postgres.py` で Neon seed。`scripts/` の cron は旧パス `/home/shugo/my_website` を指し実質停止。
- **財務ソース（重要）**: JP の財務は **EDINET パース由来**（`download_edinet`/`parse_edinet*` → `financial_data_v2`）。yfinance ではない。US の財務は現状 data.js seed 由来。
- **配信**: `/api/market/list`（`{stocks, updated_at}`・軽量サマリ全量＋直近3期財務・prices無し）＋ `/api/market/{ohlcv,financials}`（遅延ハイドレート）。`dataClient.js` が REMOTE_ENABLED=true で消費。
- **表示**: `filterAndRenderPortal()`（index.html:1895）が `STOCK_DATA` 全走査 → `portal-container.innerHTML` を全再構築、各カードに inline SVG スパークライン（`buildSparklineSVG`）。IntersectionObserver は未使用。
- **Vercel Hobby 関数**: 現状 **11/12**（auth3＋market3＋me5）。空き1。
- **Neon `market` スキーマ**: `ticker_master` / `ohlcv`(PK ticker,date) / `financials_annual`(PK ticker,fiscal_year,fiscal_period) / `ai_comments`(PK ticker,fiscal_year) が既に定義済（`db/schema.sql`）。

### 非目標（今回やらない）
1. **intraday リアルタイム/オンデマンドライブ取得**（Vercel 10秒・レート制限・複雑性に対しリターンが薄い。中長期ファンダに EOD で必要十分）。将来のライブ化余地は配信契約の抽象維持で"ほぼ無コスト"で残す（§7）。
2. **新規 Vercel Functions の増設**（枠 11/12 を守る。取り込みは Actions 側）。
3. **nexus の改修**（nexus ticker_master はポートフォリオ用途。正データ源に昇格させない）。
4. **AI 財務コメントの自動 cron 化**（Claude 課金ゆえ [[全アプリcron手動化]]方針に従い手動/予算管理）。

---

## §1 決定事項サマリ（brainstorming Q&A で確定）

| # | 論点 | 決定 |
|---|---|---|
| 1 | 動的化の意味 | **cron 自動更新**（日次 EOD 株価）。ライブは非目標。抽象境界のみ保つ。 |
| 2 | ユニバース規模 | **約300（日米主要・セクター網羅）**。段階的に 500+/広域へ拡張可能に設計。 |
| 3 | 表示 | **クライアント窓表示**（可視範囲のみ描画＋スクロールで増分＋スパークライン遅延描画）。サーバ page 分割は不採用。 |
| 4 | ユニバースの正データ | **投資ポータル自己完結**（リポ内 curated seed → `market.ticker_master`）。nexus は消費側で軽い整合チェックのみ。 |
| 5 | 財務ソース（**spec で提案・レビュー要**） | **拡張分は yfinance financials（JP+US 均一）**。既存 EDINET-JP データは保持。§3.2 で詳述。 |

---

## §2 アーキテクチャ概観

```
[data/universe.csv]  ← 正データ（curated seed・太田さん編集可）
      │  (seed 適用: scripts/seed_universe.py)
      ▼
[Neon market.ticker_master]
      ▲                         ┌──────────────── GitHub Actions cron（Vercel 関数外・無料）
      │                         │  market-refresh.yml
      │  upsert                 │   ├ 日次: yfinance batch → ohlcv（EOD）＋ info(marketCap/per/pbr)
[market.ohlcv]  ◄──────────────┤   └ 週次/月次: yfinance financials → financials_annual（拡張分）
[market.financials_annual] ◄───┘
[market.ai_comments]  ◄── 手動バッチ（analyze_financials.py・Claude Haiku・拡張時のみ）
      │
      ▼  読み取り（既存・不変）
[/api/market/list, /ohlcv, /financials]  ─→  dataClient.js  ─→  filterAndRenderPortal（窓表示化）
```

---

## §3 コンポーネント設計

### §3.1 取り込み cron: `.github/workflows/market-refresh.yml`
既存 `cashflow-pull.yml` と同型（`workflow_dispatch` 先行サニティ → schedule 有効化）。
- **runner**: ubuntu-latest / python 3.13 / `pip install "psycopg[binary]>=3" yfinance`。
- **env**: `DATABASE_URL`（Secrets・`market` スキーマ upsert 権限）。Claude キーは**不要**（純データ ETL）。
- **schedule**: 
  - 日次株価: `cron: "0 21 * * 1-5"`（UTC 21:00 ≒ JST 翌 06:00・平日）＝米国クローズ後・EOD 反映。
  - 週次財務: 別 workflow か同 workflow の分岐（`cron: "0 22 * * 6"` 週次）。財務は低頻度で十分。
- **step**: `python scripts/refresh_market.py [--prices|--financials|--all]`（下記スクリプト）。
- **concurrency**: `group: market-refresh, cancel-in-progress: false`。

### §3.2 取り込みスクリプト: `scripts/refresh_market.py`（新規・Neon直書き）
現 `get_stock_multi.py`（ローカル SQLite 前提・data.js 出荷）とは別に、**Neon を直接 upsert** する cron 用スクリプトを新設（既存スクリプトは手動フルビルド用に温存）。
- **`--prices`（日次）**: `market.ticker_master` から全 ticker を取得 → `yf.download(tickers, period="10d", group_by="ticker", threads=True, auto_adjust=True)` で**バッチ取得**（nexus `portfolio.py fetch_quotes` と同パターン・1リクエスト・レート制限回避）→ 各 ticker の直近営業日を `market.ohlcv` へ `INSERT ... ON CONFLICT (ticker,date) DO UPDATE`。同時に `stock.info`（per-ticker・marketCap/trailingPE→forwardPE/priceToBook）で `ticker_master.market_cap/per/pbr/updated_at=now()` を upsert（`updated_at` 前進 = `/api/market/list` の updated_at バッジが自動更新）。
  - 注: `stock.info` は per-ticker で遅い。300銘柄でも GHA の 10分枠で収まる想定（バッチ history は高速、info は逐次でも数分）。収まらなければ info は週次へ降格。
- **`--financials`（週次）**: 各 ticker の財務を **yfinance**（`stock.income_stmt`/`balance_sheet`/`cashflow`・annual）から取得 → `financials_annual` の対応列へマッピング upsert（§3.2.1）。週次で新規 annual filing を1週間以内に反映（財務は四半期報告ゆえ週次で十分）。
- **冪等/堅牢**: 取得失敗銘柄は `try/except` で skip＋stderr ログ（全体を止めない・cashflow ETL と同思想）。`ON CONFLICT DO UPDATE` で再実行安全。price は当日足のみ upsert（履歴全体は初回シードで投入）。

#### §3.2.1 財務ソースの決定（**レビュー要**）
- **提案**: **拡張分（新規 ticker）の財務は yfinance financials を均一ソース**にする。yfinance の annual は Total Revenue→`net_sales`、Gross Profit→`gross_profit`、Operating Income→`operating_income`、Net Income→`net_income`、BS（Total Current Assets 等）→`current_assets`/`net_assets` 等、CF（Operating/Investing/Financing/Cash 期首期末）→`operating_cf`/`investing_cf`/`financing_cf`/`cf_cash_start`/`cf_cash_end` にマッピング。おおむね直近4年。
- **既存 JP74 の EDINET データは保持**（yfinance で上書きしない＝EDINET は高品質・履歴長）。実装: `financials_annual` の既存行は EDINET seed 由来、新規 ticker のみ yfinance で埋める（`source` 列を足すか、既存行 DO NOTHING で守る）。
- **トレードオフ（正直に）**: yfinance 財務は JP 銘柄で EDINET より項目欠損/精度が落ちる場合がある。EDINET-JP パイプラインは JP 専用・手動ゆえ大規模ユニバースの恒常化には不向き。→ **コア JP は EDINET（手動・高品質）、拡張分は yfinance（自動・均一）** のハイブリッドが現実解。**この方針でよいか spec レビューで確認**。

### §3.3 ユニバース seed: `data/universe.csv` + `scripts/seed_universe.py`
- **`data/universe.csv`**: `ticker,company_name,industry,currency,country,type` 列の curated リスト。私が主要指数構成ベースで**日米〜300のスターター**を生成（JP: TOPIX Core/主要225からセクター代表、US: S&P 主要＋セクター代表で**米国を厚く**＝percentile 改善）。太田さんが行追加/削除で編集。
- **`scripts/seed_universe.py`**: csv → `market.ticker_master` へ upsert（`ON CONFLICT (ticker) DO UPDATE` で company_name/industry/currency/country/type を同期）。**csv に無い ticker は削除しない**（誤削除防止・削除は明示フラグ `--prune` でのみ）。
- **段階拡張**: csv に ticker を足して `seed_universe.py`＋`refresh_market.py --all` を回すだけ。再アーキ不要。

### §3.4 配信: `/api/market/list`（原則不変・関数ゼロ増）
- **窓表示はクライアント側**で行うため、`list` は従来どおり**軽量サマリ全量**を返す（束B の percentile/ランキングが全ユニバースをクライアントで要求するため・§3.5 根拠）。300銘柄でも数十KB（gzip 後さらに小）。
- **payload 肥大の監視**: 500+ で list が大きくなる場合、`financials_trend`（直近3期）を list から外し ohlcv/financials 遅延に寄せる余地あり（将来・今回は不要）。関数増設はしない。
- Cache-Control（`s-maxage=3600, stale-while-revalidate=86400`）維持。

### §3.5 一覧窓表示: `filterAndRenderPortal` の窓化
- **根拠**: 束B（相対 percentile/横断ランキング・`cross-section-rules.js`）は**全ユニバースをクライアントで保持して percentile を計算する**必要がある。→ サーバ page 分割は「どのみち全サマリが要る」ため逆効果。データは全量クライアント保持のまま、**DOM 描画とスパークライン描画だけを窓化**する。
- **設計**:
  1. `filterAndRenderPortal` は従来どおり全 `STOCK_DATA` を filter/sort して**完全な `list`（表示対象配列）を構築**（percentile 等は全量で不変）。
  2. その `list` を**先頭 N件（例 60）だけ DOM 描画**し、末尾に**センチネル要素**を置く。
  3. **`IntersectionObserver`** がセンチネル可視化を検知 → 次の N件を append（無限スクロール）。フィルタ/検索/ソート変更時は window をリセット（先頭から再描画）。
  4. **スパークライン**: 現状 inline SVG（`buildSparklineSVG`）は軽量だが、行が窓に入った時点で描画すれば更に軽い。窓内カードのみ SVG を生成（窓外は未生成）。
- **不変**: 検索デバウンス（C3・180ms）・`dataLoadState` 状態機械（C2）・0件/失敗UI・ソート/フィルタの意味は保持。カードのマークアップ/クリック委譲も不変。
- **スコープ**: `index.html` inline（F2 IIFE 内）。新規に window 露出する関数があれば `Object.assign(window,{...})` へ追加（F2 規律）。

### §3.6 AI 財務コメント（手動・予算管理）
- `market.ai_comments` テーブルは既存。`scripts/analyze_financials.py`（Claude Haiku）を**拡張時に手動バッチ**で回し、新規 ticker×年度のコメントを生成 → `ai_comments` へ upsert。
- **自動 cron に載せない**（[[全アプリcron手動化]]）。新規銘柄は AI コメントが後追いで空 = 許容（詳細ビューはコメント空でも正常＝前方互換）。
- `/api/market/financials` がコメントを返す経路は既存を踏襲（要確認: financials.py が ai_comments を join しているか。していなければ本 spec 外の別タスク）。

### §3.7 nexus 整合チェック（軽量）
- nexus ウォッチリスト/portfolio の保有 ticker が投資ポータルのユニバース（`ticker_master`）に**含まれない場合に警告**する軽いチェック（保有＝必ず分析可を担保）。
- 実装最小: `scripts/refresh_market.py` の末尾 or 独立スクリプトで「nexus holdings ∖ universe」を stderr ログ（自動追加はしない・人手で seed に足す判断）。nexus 側は無改修。
- YAGNI: 双方向同期や自動取り込みはしない。

---

## §4 データフロー（更新1サイクル）
1. （必要時）太田さんが `data/universe.csv` を編集 → `seed_universe.py` で `ticker_master` upsert。
2. 日次: GHA `market-refresh.yml --prices` → yfinance batch → `ohlcv` upsert＋`ticker_master` の marketCap/per/pbr/updated_at 前進。
3. 週次: `--financials` → yfinance financials → `financials_annual` upsert（拡張分のみ・EDINET-JP は保持）。
4. （拡張時のみ・手動）`analyze_financials.py` → `ai_comments`。
5. 本番 `/api/market/list` が最新スナップショットを配信 → `dataClient.bootData()` → `filterAndRenderPortal`（窓表示）。updated_at バッジは自動前進。

---

## §5 エラー処理・冪等・レート制限
- **冪等**: 全 upsert が `ON CONFLICT DO UPDATE`。price は当日足のみ・再実行安全。
- **部分失敗許容**: 取得失敗 ticker は skip＋ログ、ジョブ全体は継続（cashflow ETL 同思想）。
- **レート制限**: price は `yf.download` バッチ（1リクエスト）で回避。`stock.info`/financials は per-ticker ゆえ必要なら `time.sleep` 微小挿入＋失敗リトライ1回。GHA timeout 10分。
- **loud-fail 検証**: 取得0件/全銘柄失敗はジョブを**非ゼロ終了**（サイレント空更新を防ぐ）。
- **本番反映確認**: push/デプロイ後は `/api/market/list` を curl して件数・updated_at を確認（[[investment-portal-dual-deploy-persona]]＝通常URL/persona 両方）。

## §6 Vercel Hobby 制約遵守
- **新 Function ゼロ**（取り込みは GHA・配信は既存3エンドポイント）。関数 11/12 を維持。
- `.vercelignore` は現状どおり scripts/ を配信除外（cron スクリプトは本番配信されない）。

## §7 段階拡張・将来ライブ化余地
- **段階拡張**: seed csv 追記＋cron 再実行のみで 300→500+。窓表示ゆえ表示は破綻しない。500+ で list payload が問題化したら §3.4 の list スリム化（別タスク）。
- **将来ライブ**: 配信契約 `dataClient.js → /api/market/*` を保つ。将来ライブ源は「`ohlcv` を live provider から書く別 collector」or「新 live エンドポイント追加（枠が空けば）」で**差し替え/追加**対応。今回コード追加なし＝抽象境界を汚さないことだけ守る。

## §8 テスト戦略
- **純ロジック**: `refresh_market.py` の yfinance→schema マッピングを純関数化し、fixture（yfinance 応答モック）で単体テスト（Python `pytest`）。`seed_universe.py` の csv→upsert を dry-run＋fixture DB で検証。
- **窓表示**: `filterAndRenderPortal` 窓化を node/実ブラウザで検証（既存 `scratchpad/mock_prod_server.py` に多数銘柄を投入し、①初期 N件描画 ②スクロールで増分 ③フィルタ/検索/ソートで window リセット ④percentile/ランキングが全量で不変 ⑤pageerror0）。GPU/描画は実機サニティ（headless 不可分は太田さん確認）。
- **契約不変**: `/api/market/list` 応答形（`{stocks, updated_at}`）不変を回帰。
- **冪等**: refresh を2回連続実行し ohlcv/financials 行数・値が安定を確認。
- ultracode 方針: 実装は SDD（各タスク fresh implementer→review）＋whole-branch 敵対検証 wf。

## §9 リスク・未決事項
1. **財務ソース（§3.2.1）**: yfinance 財務品質（特に JP）。→ ハイブリッド（コア EDINET／拡張 yfinance）を提案・**レビュー確認**。
2. **`stock.info` の速度**: 300銘柄の info 逐次取得が GHA 10分に収まるか。→ 収まらなければ info を週次へ降格 or 並列化。実装時に実測。
3. **list payload**: 300 は数十KB で問題なし。500+ で監視。
4. **financials.py の ai_comments 経路**: 既存が join 済か要確認（未対応なら本 spec 外）。
5. **seed の初期履歴**: 新規 ticker の ohlcv 5年履歴は初回 seed（`--prices` の period を初回だけ長く）で投入。日次は直近のみ。
6. **通貨/セクター表記の一貫性**: 新規 US 銘柄の industry 表記を既存セクター分類（束B の 38分類）と整合させる（seed csv で正規化）。

## §10 実装フェーズ分割（plan 用の粗い区切り）
- **P1 seed 基盤**: `data/universe.csv`（日米〜300スターター）＋`seed_universe.py`＋単体テスト。
- **P2 取り込み cron**: `refresh_market.py`（--prices/--financials・純関数マッピング＋テスト）＋`market-refresh.yml`（dispatch 先行）。
- **P3 初回シード**: 新規 ticker の履歴 ohlcv＋financials 投入（手動フル1回）。
- **P4 窓表示**: `filterAndRenderPortal` 窓化＋IntersectionObserver＋実ブラウザ検証。
- **P5 整合チェック＋AI コメント手動バッチ**（軽量）。
- **P6 段階的本番化**: dispatch サニティ → schedule 有効化 → 本番 curl（通常URL/persona 両方）。

各フェーズは独立検証可能。P4（窓表示）は P1-3（データ）と独立に着手可。
