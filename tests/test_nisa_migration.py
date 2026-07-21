import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG = os.path.join(ROOT, "db", "migrations", "2026-07-21-nisa-eligibility.sql")
SCHEMA = os.path.join(ROOT, "db", "schema.sql")


def _sql(path):
    return open(path, encoding="utf-8").read()


def test_migration_adds_four_ticker_master_columns_idempotent():
    s = _sql(MIG).lower()
    assert "alter table market.ticker_master" in s
    for col, default in [
        ("nisa_growth_status", "'unknown'"),
        ("market_alert", "'none'"),
        ("nisa_source", "''"),
        ("nisa_checked_at", "null"),
    ]:
        assert re.search(rf"add column if not exists\s+{col}\b", s), f"missing add {col}"
    assert s.count("add column if not exists") >= 4


def test_migration_creates_nisa_tsumitate_with_unique_fund_name():
    s = _sql(MIG).lower()
    assert "create table if not exists market.nisa_tsumitate" in s
    assert "fund_name" in s and "unique" in s
    assert "nisa_source" in s and "'fsa-tsumitate-xlsx'" in s
    for col in ("mgmt_company", "category", "index_name", "domestic_foreign",
                "fund_code", "etf_ticker", "list_updated_at"):
        assert col in s, f"missing column {col}"


def test_schema_sql_carries_same_ddl_for_fresh_creates():
    s = _sql(SCHEMA).lower()
    assert "nisa_growth_status" in s and "market_alert" in s
    assert "create table if not exists market.nisa_tsumitate" in s
