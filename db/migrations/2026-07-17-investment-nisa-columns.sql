-- B#3 Stage3（投資台帳ledger連携）: NISA 枠別の per-period delta を追加。
-- 単位＝円・簿価(取得価額)・非負。累積（生涯簿価残）は書かない＝nisaLedgerFold が単一源。
-- 既存0行＋DEFAULT 0 ゆえ再適用・後追い適用とも安全（.vercelignore で自動適用されない＝手動適用）。
ALTER TABLE me.investment_snapshots
  ADD COLUMN IF NOT EXISTS nisa_tsumitate_delta        NUMERIC(16,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nisa_growth_delta           NUMERIC(16,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nisa_tsumitate_sold_at_cost NUMERIC(16,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nisa_growth_sold_at_cost    NUMERIC(16,0) NOT NULL DEFAULT 0;
