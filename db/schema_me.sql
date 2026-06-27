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
