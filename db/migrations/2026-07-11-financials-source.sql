-- financials_annual に source 列を追加し既存行(=EDINET seed 由来)を 'edinet' に確定。
-- 冪等: 既に列があれば ADD COLUMN IF NOT EXISTS が no-op。
ALTER TABLE market.financials_annual
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'edinet';
