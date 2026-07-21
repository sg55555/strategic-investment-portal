-- B#3 Stage4a（適格判定データ基盤・公開データ・inert・規制非該当）。
-- 冪等: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS ゆえ後追い/再適用安全。
-- .vercelignore が db/ と *.sql を配信除外 → 自動適用されない = 手動適用。
ALTER TABLE market.ticker_master
  ADD COLUMN IF NOT EXISTS nisa_growth_status TEXT NOT NULL DEFAULT 'unknown',  -- 'eligible'|'excluded'|'conditional'|'unknown'
  ADD COLUMN IF NOT EXISTS market_alert       TEXT NOT NULL DEFAULT 'none',     -- 'none'|'supervision'|'liquidation'（将来 JPX 監理整理差込点）
  ADD COLUMN IF NOT EXISTS nisa_source        TEXT NOT NULL DEFAULT '',         -- 判定根拠
  ADD COLUMN IF NOT EXISTS nisa_checked_at    TIMESTAMPTZ DEFAULT NULL;         -- 判定鮮度

-- つみたて対象投信（金融庁公表・約360本＝証券コードなし・価格系列なし）。
-- ticker_master/ohlcv/screener 経路に混ぜない（PK=serial・投信は証券コード無し）。
CREATE TABLE IF NOT EXISTS market.nisa_tsumitate (
  id               SERIAL PRIMARY KEY,
  fund_name        TEXT NOT NULL UNIQUE,   -- 自然キー。ON CONFLICT(fund_name) で serial 安定（refs 参照先を版間保持）
  mgmt_company     TEXT,
  category         TEXT,                   -- 'index' | 'active' | 'etf'
  index_name       TEXT,
  domestic_foreign TEXT,
  fund_code        TEXT,                   -- IMAJ left-join 補完（null 許容）
  etf_ticker       TEXT,                   -- ETF 区分のみ（null 許容）
  list_updated_at  DATE,                   -- FSA リスト改定日（r0 Excel シリアル由来）
  nisa_source      TEXT NOT NULL DEFAULT 'fsa-tsumitate-xlsx'
);

-- ── 本番投入 SQL 検証（手動適用後・inert・読取のみ・§3.6）──
-- 適用（破壊系は手動）:
--   psql "$DATABASE_URL" -f db/migrations/2026-07-21-nisa-eligibility.sql
--   DATABASE_URL=... IMAJ_XLSX=... python scripts/refresh_nisa.py
--   DATABASE_URL=... FSA_XLSX=... IMAJ_XLSX=... python scripts/refresh_nisa_tsumitate.py
-- 検証:
--   SELECT distinct nisa_growth_status FROM market.ticker_master;
--     期待: JP stock=eligible / US=conditional / 該当 JP ETF=eligible(imaj-listed) / 他=unknown
--   SELECT nisa_growth_status, count(*) FROM market.ticker_master GROUP BY 1;
--   SELECT category, count(*) FROM market.nisa_tsumitate GROUP BY 1;
--     期待: index≈286 / active≈65 / etf≈9（loud-fail レンジ内）
--   SELECT max(list_updated_at) FROM market.nisa_tsumitate;  -- FSA r0 シリアル由来の改定日
--   -- 再取込で serial 不変（UNIQUE upsert）:
--   SELECT id, fund_name FROM market.nisa_tsumitate ORDER BY id LIMIT 3;  -- 再実行前後で id 一致
--   -- 書き手分離: GHA market-refresh 実行後も NISA 列が保持されることを確認:
--   SELECT ticker, nisa_growth_status, nisa_checked_at FROM market.ticker_master
--     WHERE nisa_checked_at IS NOT NULL ORDER BY nisa_checked_at DESC LIMIT 5;
