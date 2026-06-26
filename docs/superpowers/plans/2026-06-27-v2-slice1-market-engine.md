# v2 Slice 1「高速・大量銘柄の市場リサーチ器」実装プラン

> 親spec: `docs/superpowers/specs/2026-06-27-wealth-cockpit-v2-architecture.md`（案C）。
> Slice 1 = 認証不要・個人データゼロ・公開可能な器。`REMOTE_ENABLED` フラグで v1(本番) を一度も壊さず並走。

**Goal:** 21MB静的`data.js`をやめ、Neon Postgres + `/api/market/*` + `dataClient.js`shim で、見た目同一のまま初回ロードを数KBにする。

## Global Constraints
- 個人データを一切扱わない（market スキーマのみ）。認証不要。
- 既存 index.html の挙動・見た目を変えない。`REMOTE_ENABLED=false` で旧`data.js`同期読みに即フォールバック。
- Vercel Python Functions は **kakeibo の実パターンに合わせる**（`/home/shugo/apps/kakeibo-dashboard/api/` の handler 形・接続・cookie無し版を参照）。
- DB接続は Neon プールド接続（pgbouncer）。`DATABASE_URL`(or `POSTGRES_URL`) 環境変数。

## 進捗
- [x] **Task 1: スキーマ** `db/schema.sql`（market.ticker_master/ohlcv/financials_annual/ai_comments＋索引）。
- [x] **Task 2: ETL** `scripts/etl_to_postgres.py`（data.js→market 冪等投入）。**パース/変換は実data.jsで検証済**（100/122990/293/292）。DB挿入はNeon接続後に通し。
- [ ] **Task 3: スキーマ適用＋ETL実行（要DATABASE_URL）**
  - `psql "$DATABASE_URL" -f db/schema.sql`
  - `pip install 'psycopg[binary]'` → `DATABASE_URL=... python scripts/etl_to_postgres.py`
  - 検証: `SELECT count(*) FROM market.ohlcv;` = 122990 等。
- [ ] **Task 4: API `/api/market/*`（Vercel Python）**
  - `api/market/list.py` → ticker_master 全件（grid用）。
  - `api/market/ohlcv.py?ticker=&from=&to=` → 日足配列（既存`prices[]`形）。
  - `api/market/financials.py?ticker=` → financials_annual＋ai_comments を年度別に（既存`financials_trend`形）。
  - `api/market/search.py?q=&limit=` → company_name/ticker 部分一致。
  - kakeibo handler形に合わせ、各々 DB接続→SQL→JSON。`Cache-Control: s-maxage=3600`（過去データ不変）。
  - 検証: `vercel dev` or デプロイ後 `curl /api/market/list` 等が既存形と一致。
- [ ] **Task 5: `dataClient.js` shim ＋ index.html 差替**
  - `dataClient.js`: `STOCK_DATA[ticker]` 同期参照を `await getStock(ticker)`（`/api/market/*` 合成→既存形を返す）へ。`getList()`/`searchTickers()`。
  - index.html: データアクセス箇所を shim 経由の async へ。`const REMOTE_ENABLED = true/false`。false で旧 `data.js` 同期読みにフォールバック。
  - 検証(Playwright): REMOTE_ENABLED=true で grid/チャート/財務/AIコメント/検索が既存同等に表示・**初回ロードがdata.js無し（数KB）**。false で完全に従来通り（リグレッション0）。
- [ ] **Task 6: 本番反映**: `REMOTE_ENABLED` を段階導入（既定falseでマージ→検証後true）。ExitWorktree→main→push。

## 受け入れ基準（Slice 1）
- 見た目・操作が v1 と同一のまま、`REMOTE_ENABLED=true` で 100銘柄のgrid/チャート/財務3表/AIコメント/検索が API 駆動で動く。
- 初回ロードから21MB `data.js` が消える（数KB）。
- `REMOTE_ENABLED=false` で旧来動作に完全フォールバック（本番を壊さない安全弁）。
- 個人データ・認証は一切登場しない（公開可能な器）。
