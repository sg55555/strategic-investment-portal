-- お金の司令室 v2 / Slice 1 — market スキーマ（公開市場データ・個人データなし）
-- 適用: psql "$DATABASE_URL" -f db/schema.sql
-- TimescaleDB は任意（後付け可）。素のPostgres＋(ticker,date)索引でSlice1は十分。

CREATE SCHEMA IF NOT EXISTS market;

-- 銘柄マスタ（investment.db ticker_master ＋ data.js の info[marketCap/per/pbr]）
CREATE TABLE IF NOT EXISTS market.ticker_master (
  ticker        TEXT PRIMARY KEY,
  company_name  TEXT,
  industry      TEXT,
  currency      TEXT,
  country       TEXT,
  type          TEXT,                       -- 'stock' | 'etf'
  market_cap    DOUBLE PRECISION,
  per           DOUBLE PRECISION,
  pbr           DOUBLE PRECISION,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  nisa_growth_status TEXT NOT NULL DEFAULT 'unknown',  -- 'eligible'|'excluded'|'conditional'|'unknown'
  market_alert       TEXT NOT NULL DEFAULT 'none',     -- 'none'|'supervision'|'liquidation'
  nisa_source        TEXT NOT NULL DEFAULT '',
  nisa_checked_at    TIMESTAMPTZ DEFAULT NULL
);

-- 株価日足（data.js prices[]）。将来 TimescaleDB hypertable 化可。
CREATE TABLE IF NOT EXISTS market.ohlcv (
  ticker  TEXT   NOT NULL,
  date    DATE   NOT NULL,
  open    REAL,
  high    REAL,
  low     REAL,
  close   REAL,
  volume  BIGINT,
  PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_ohlcv_ticker_date ON market.ohlcv (ticker, date DESC);

-- 財務3表 年次（investment.db financial_data_v2 を 1:1）
CREATE TABLE IF NOT EXISTS market.financials_annual (
  ticker                  TEXT NOT NULL,
  fiscal_year             INT  NOT NULL,
  fiscal_period           TEXT NOT NULL DEFAULT 'FY',
  -- BS
  current_assets          DOUBLE PRECISION,
  non_current_assets      DOUBLE PRECISION,
  current_liabilities     DOUBLE PRECISION,
  non_current_liabilities DOUBLE PRECISION,
  net_assets              DOUBLE PRECISION,
  -- PL
  net_sales               DOUBLE PRECISION,
  gross_profit            DOUBLE PRECISION,
  operating_income        DOUBLE PRECISION,
  ordinary_income         DOUBLE PRECISION,
  income_before_taxes     DOUBLE PRECISION,
  net_income              DOUBLE PRECISION,
  -- CF
  operating_cf            DOUBLE PRECISION,
  investing_cf            DOUBLE PRECISION,
  financing_cf            DOUBLE PRECISION,
  cf_cash_start           DOUBLE PRECISION,
  cf_cash_end             DOUBLE PRECISION,
  source                  TEXT NOT NULL DEFAULT 'edinet',   -- 'edinet'(コアJP・保護) | 'yfinance'(拡張)
  PRIMARY KEY (ticker, fiscal_year, fiscal_period)
);

-- AI財務コメント（analysis_cache.json。週次Haiku再生成の初期値）
CREATE TABLE IF NOT EXISTS market.ai_comments (
  ticker        TEXT NOT NULL,
  fiscal_year   INT  NOT NULL,
  comment       TEXT,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, fiscal_year)
);

-- 銘柄検索の前方一致/部分一致を軽くするための索引（company_name / ticker）
CREATE INDEX IF NOT EXISTS idx_ticker_master_name ON market.ticker_master (lower(company_name) text_pattern_ops);

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
