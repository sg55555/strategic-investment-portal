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
