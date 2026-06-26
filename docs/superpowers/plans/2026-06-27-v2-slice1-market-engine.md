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
- [x] **Task 3: スキーマ適用＋ETL実行（DATABASE_URL投入済）** ✅ 2026-06-27
  - Neon(PostgreSQL 17.10)に `market` スキーマ＋4テーブル投入済を確認。件数＝ticker_master 100 / ohlcv 122,990 / financials_annual 293 / ai_comments 292（期待値と完全一致）。
  - 中身検証OK＝実社名/型/通貨・OHLCV(2021-05-19〜2026-05-19,null close 0)・財務実値・日本語AIコメント実在。
  - 接続=pooled(`-pooler`,us-east-1,channel_binding=require)。ローカルETLは investment-portal `.venv` に `psycopg[binary]` 導入で対応可。
- [x] **Task 4: API `/api/market/*`（Vercel Python）** ✅ 2026-06-27
  - `api/market/list.py` → 全100銘柄の軽量サマリ（master＋直近3期×7項目, **prices空**）。実測 **84KB**（vs data.js 21MB）。
  - `api/market/ohlcv.py?ticker=` → 日足全件（既存`prices[]`形・time昇順）。
  - `api/market/financials.py?ticker=` → financials_annual＋ai_comments を年度別に（`ai_analysis`を各年度内ネスト・欠損None省略）。
  - **検索APIは作らない**（understand判明＝検索はクライアント側で読込済listをincludesフィルタ・未配線。YAGNI＋Hobby関数枠節約）。
  - kakeibo handler形（`class handler(BaseHTTPRequestHandler)`+`_json`）。psycopg＋`DATABASE_URL`。`Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`。root `requirements.txt`=`psycopg[binary]>=3`。
  - **形状照合✅**＝API出力 vs data.js を Neon実接続で厳密比較し不一致ゼロ（OHLCはREAL型でも2小数まで完全一致＝maxΔ0）。
- [x] **Task 5: `dataClient.js` shim ＋ index.html surgery** ✅ 2026-06-27（**遅延ハイドレート方式**＝当初の"全async化"を回避）
  - `dataClient.js`: `STOCK_DATA`/`DATA_UPDATED_AT` を所有（旧const置換）。`bootData()`（remote=軽量list / fallback=`data-bundle.js`一括）＋`getStock(ticker)`（remote時に ohlcv+financials を `STOCK_DATA[ticker]` にその場マージ）。`const REMOTE_ENABLED=false`（安全弁・既定）。
  - **index.html surgery は4点のみ**＝①script `data.js`→`dataClient.js` ②`onload` async化+`await bootData()` ③`navigateToDetail` async化+`await getStock()` ④`addToCompare` async化+`await getStock()`。深部の同期描画(チャート/財務/sparkline)は**無改造**。
  - `data-bundle.js`＝data.jsの`const`を外した代入版（fallback用・sed生成・21MB・REMOTE=true安定後にdata.jsごと退役）。
  - **実ブラウザ検証✅**(Playwright headless 両モード)＝REMOTE 15/15・LOCAL 12/12機能緑（grid100/検索/詳細/AIコメント/財務/比較・network方式・未捕捉例外0※`_vercel/insights`404は本番限定スクリプトの不在のみ）。残=**カードのチャート実描画ピクセルは太田さん実機サニティ**（GPU/canvasはheadless不可・mistakes.md準拠）。
- [ ] **Task 6: 本番反映（段階導入・要ユーザーgo＝外向き本番デプロイ）**
  1. worktree commit → `ExitWorktree(keep)` → main で `git fetch && merge worktree-wealth-cockpit-v2`。
  2. `git push`（**REMOTE_ENABLED=false のまま**＝本番は data-bundle.js で従来動作・MCC v1/portal無傷）。
  3. **本番 curl 検証**＝`/api/market/list`(200,JSON,~84KB)・`/api/market/ohlcv?ticker=7203.T`・`/financials?ticker=7203.T`。⚠️zero-config関数がrewrite catch-allに勝つか要確認（404なら builds+routes へ）。
  4. 200確認後 `REMOTE_ENABLED=true` に1行変更→commit→push→本番で初回ロード削減＆遅延ハイドレートを実機確認（太田さん）。
  5. 安定後の片付け（別タスク）＝data.js/data-bundle.js 退役、Slice2 へ。

## 受け入れ基準（Slice 1）
- 見た目・操作が v1 と同一のまま、`REMOTE_ENABLED=true` で 100銘柄のgrid/チャート/財務3表/AIコメント/検索が API 駆動で動く。
- 初回ロードから21MB `data.js` が消える（数KB）。
- `REMOTE_ENABLED=false` で旧来動作に完全フォールバック（本番を壊さない安全弁）。
- 個人データ・認証は一切登場しない（公開可能な器）。
