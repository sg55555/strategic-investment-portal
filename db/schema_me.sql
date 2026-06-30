-- お金の司令室 v2 / Slice 2 — me スキーマ（認証必須・私的データ）
-- 適用: psql "$DATABASE_URL" -f db/schema_me.sql
-- market スキーマ（公開・Slice1）とは分離。ここに乗るのは太田さん本人のデータのみ。
-- 単一ユーザ前提（mcc_state は id=1 のシングルトン行）。

CREATE SCHEMA IF NOT EXISTS me;

-- ログインセッション。cookie には生トークン、DB には sha256(token) のみ保存
-- （DB流出時に保存値をそのまま cookie として使い回せない＝パスワードハッシュの env 分離と整合）。
CREATE TABLE IF NOT EXISTS me.sessions (
  token       TEXT PRIMARY KEY,            -- sha256(secrets.token_urlsafe(32)) hex
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,        -- 既定 30 日
  label       TEXT                          -- 端末識別（User-Agent 先頭・任意）
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON me.sessions (expires_at);

-- ログイン失敗のスロットリング（IP別・短窓の失敗数で bcrypt 前に 429）。
CREATE TABLE IF NOT EXISTS me.login_attempts (
  ip  TEXT NOT NULL,
  ts  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_ts ON me.login_attempts (ip, ts);

-- 司令室の state（money-rules.js の mcc_state を丸ごと JSONB で保持）。
-- 目標(goals)も state JSON 内に同梱＝同期経路は state 1 本（Slice3 で AI が構造化を要したら正規化）。
CREATE TABLE IF NOT EXISTS me.mcc_state (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- 単一ユーザのシングルトン
  state       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Slice3 AI規律コーチ — 監査ログ（append-only）。
-- 保存するのは Mode A 集約のみ（比率・bool・カテゴリ・件数・期限バケツ）。progress 系は粗バケツ(0/25/50/75/100)。
-- 生額（monthlyExpense/各バケツ実額/targetAmount/remaining 等）・goal.label・生 deadline・state.history は
-- production/personal いずれのモードでも一切保存しない（personal で LLM へ生額を出しても、ログには出さない）。
-- 不変条件の担保: facts=coarsen 後（粗バケツ・raw 除去）／facts_hash=その coarsen 後 facts の sha256（生額指紋を残さない）／
--   ai_response=production のみ保存・personal は NULL（生額/銘柄を本文に含み得るため＝coerce-4）。
-- → このテーブルはエクスポートしても Mode A 遵守を破らない（生額・PII ゼロの証跡）。
CREATE TABLE IF NOT EXISTS me.advice_log (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  advice_mode         TEXT    NOT NULL,        -- 'production' | 'personal'（どちらのモードで生成したか）
  facts               JSONB   NOT NULL,        -- coarsen 後の Mode A 集約（progress 粗バケツ・raw 除去・生額/PII/label ゼロ）
  facts_hash          TEXT    NOT NULL,        -- sha256(coarsen 後 facts)＝cache/cooldown キー（生額指紋を残さない）
  next_target         TEXT    NOT NULL,        -- 決定論カテゴリ enum {setup|buffer|rebalance|core}
  deterministic       JSONB   NOT NULL,        -- サーバ生成の yen-free 決定論ルール（AI の上に出した権威レイヤ）
  model               TEXT    NOT NULL,        -- 'claude-sonnet-4-6'
  prompt_version      TEXT    NOT NULL,        -- system+テンプレのバージョンタグ
  rules_version       INT     NOT NULL,        -- money-rules.js CURRENT_VERSION
  schema_version      INT     NOT NULL,        -- facts スキーマ版
  ai_status           TEXT    NOT NULL,        -- 'ok'|'failed'|'refusal'|'filtered'|'truncated'|'cached'|'cooldown'|'disabled'
  ai_response         JSONB,                   -- 構造化 AI 出力。production の ok 時のみ保存／personal は常に NULL／非 ok・filtered は NULL
  filter_verdict      TEXT    NOT NULL,        -- 'ok'|'blocked:amount'|'blocked:security'|'blocked:trade'|'blocked:forecast'|'n/a'
  precedence_enforced BOOLEAN NOT NULL DEFAULT true,  -- 決定論を AI 上位に配置したか（常時 true・統制立証）
  disclaimer_version  TEXT    NOT NULL,        -- 表示した免責版タグ
  request_id          TEXT,                    -- anthropic response._request_id（トレース）
  usage               JSONB,                   -- {input_tokens, output_tokens}
  latency_ms          INT
);
CREATE INDEX IF NOT EXISTS idx_advice_log_created ON me.advice_log (created_at);
CREATE INDEX IF NOT EXISTS idx_advice_log_hash    ON me.advice_log (facts_hash, created_at);  -- cache/cooldown 窓 SELECT
-- 保持方針（決定）: 財務指紋の無期限累積を避け 180日 TTL。cron 無いため当面手動 prune。
--   DELETE FROM me.advice_log WHERE created_at < now() - interval '180 days';

-- Slice4 収支連携 — 月次収支スナップショット（機械書込専用・ETL のみ INSERT/UPDATE）。
-- ハイブリッド粒度: 見出し数値(income/expense/balance)は kakeibo 月別集計DB(権威・式プロパティ済)、
--   breakdown JSONB は生取引DB(変動費/固定費/給与/雑収入)から ETL が集計した自由な内訳。
-- 投資余力は見出し数値のみ使用 → 生取引集計のズレが規律数字に波及しない。
-- 生額は mcc_state.monthlyExpense と同じ信頼境界（認証必須・非公開）。
-- LLM へは生額を渡さない（production は Mode A 集約のみ／personal のみ生額可）。advice_log は両モード生額非保存。
-- mcc_state(id=1 シングルトン)と異なり時系列（median 平滑/トレンド/バッファ充填月数に履歴が要る）。
-- ユーザ編集の mcc_state PUT(LWW)とは別テーブル＝書込競合なし。.vercelignore で db/*.sql は配信除外。
CREATE TABLE IF NOT EXISTS me.cashflow_snapshots (
  period           DATE PRIMARY KEY,                 -- 月初(YYYY-MM-01)・冪等 upsert の自然キー
  total_income     NUMERIC(14,0) NOT NULL DEFAULT 0, -- 月別集計DB(権威)
  salary_income    NUMERIC(14,0) NOT NULL DEFAULT 0, -- 経常収入
  misc_income      NUMERIC(14,0) NOT NULL DEFAULT 0, -- 臨時収入(windfall・経常へ外挿しない)
  fixed_expense    NUMERIC(14,0) NOT NULL DEFAULT 0, -- 内訳/負担比率表示のみ・余剰から二重控除しない
  variable_expense NUMERIC(14,0) NOT NULL DEFAULT 0,
  total_expense    NUMERIC(14,0) NOT NULL DEFAULT 0, -- = fixed+variable(kakeibo算出)
  balance          NUMERIC(14,0) NOT NULL DEFAULT 0, -- = total_income - total_expense(=月次余剰の基底)
  savings_rate     NUMERIC(6,2),                     -- %(参考保持・Mode Aは balance/income から再計算して単一源)
  is_complete      BOOLEAN NOT NULL DEFAULT true,    -- 当月途中(部分月)は false で rolling/規律から除外
  breakdown        JSONB,                            -- 生取引DBから集計した自由な内訳(カテゴリ別変動費/固定費明細等)
  source           TEXT NOT NULL DEFAULT 'kakeibo-notion-hybrid',
  source_hash      TEXT,                             -- sha256(正規化済元行)=無変化skip/改ざん検知
  pulled_at        TIMESTAMPTZ NOT NULL DEFAULT now()-- 鮮度(UIバッジ/Mode A staleDays算出元)
);
CREATE INDEX IF NOT EXISTS idx_cashflow_period ON me.cashflow_snapshots (period DESC);

-- データ基盤Phase2 投資台帳 — 月次投資スナップショット（機械書込専用・etl_investment.py のみ INSERT/UPDATE）。
-- 二目的会計（plan 2026-06-29 §2）: 投資の1取引が「現金追跡」と「規律(元本/実現益分離)」の二目的に効く。
--   invest_cash_flow = 現金影響（購入 −全額 / 売却 +proceeds全額 / 配当 +額 / 期初保有 0=基準日前取得は anchor 内包）。
--   principal_core_delta / principal_sat_delta = 元本(取得原価)増減（戦略区分別・売却は移動平均の按分原価を控除）。
--   realized_gain = 実現益（売却(proceeds−按分原価)+配当）=金融所得 windfall。経常median から除外し netWorth/金融所得で別表示。
-- cashflow_snapshots と別 source_hash・別失敗ドメイン（etl_investment.py は cashflow pull を巻き込まない）。
-- 純関数 investmentDerived がこの per-period delta を累積し principal/investable/realizedGainTtm を導出（移動平均はETL側）。
-- 生額は cashflow_snapshots / mcc_state と同じ信頼境界（認証必須・非公開）。LLM へは production=Mode A集約のみ／personal のみ生額。
CREATE TABLE IF NOT EXISTS me.investment_snapshots (
  period               DATE PRIMARY KEY,                 -- 月初(YYYY-MM-01)・冪等 upsert の自然キー
  invest_cash_flow     NUMERIC(16,0) NOT NULL DEFAULT 0, -- 現金影響: −購入 +売却proceeds +配当（期初保有=0）
  principal_core_delta NUMERIC(16,0) NOT NULL DEFAULT 0, -- コア元本(取得原価)増減
  principal_sat_delta  NUMERIC(16,0) NOT NULL DEFAULT 0, -- サテライト元本増減
  realized_gain        NUMERIC(16,0) NOT NULL DEFAULT 0, -- 実現益(売却益+配当)・windfall（負=損失あり）
  is_complete          BOOLEAN NOT NULL DEFAULT true,    -- 当月(部分月)は false で確定累積/TTMから除外（元本累積は全期間）
  holdings             JSONB,                            -- 期末の移動平均状態 {ticker:{qty,avg_cost,strategy}}（Slice5 時価join用・任意）
  source               TEXT NOT NULL DEFAULT 'investment-notion',
  source_hash          TEXT,                             -- sha256(正規化済元行)=無変化skip/改ざん検知
  pulled_at            TIMESTAMPTZ NOT NULL DEFAULT now()-- 鮮度（UIバッジ/Mode A staleDays算出元）
);
CREATE INDEX IF NOT EXISTS idx_investment_period ON me.investment_snapshots (period DESC);
