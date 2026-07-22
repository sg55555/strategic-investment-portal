-- B#3 Stage4b: NISA 口座配置助言の監査ログ。生¥は facts_coarsened で bucket 化済み・ai_response は
-- personal では NULL 固定・eligible_products/残枠¥は非保存。手動適用（.vercelignore が *.sql 非配信）。
-- TTL: 180日（cron で `DELETE FROM me.nisa_log WHERE created_at < now() - interval '180 days'`）。
CREATE TABLE IF NOT EXISTS me.nisa_log (
    id              serial PRIMARY KEY,
    session_hash    text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    facts_coarsened jsonb,
    ai_response     jsonb,
    ai_status       text,
    prompt_version  text,
    refs_count      int,
    degrade_reason  text
);
CREATE INDEX IF NOT EXISTS nisa_log_created ON me.nisa_log (created_at DESC);
