import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _src(rel):
    return open(os.path.join(ROOT, rel), encoding="utf-8").read()


def test_seed_universe_never_writes_nisa_columns():
    s = _src("scripts/seed_universe.py")
    for forbidden in ("nisa_growth_status", "market_alert", "nisa_source",
                      "nisa_checked_at", "nisa_tsumitate"):
        assert forbidden not in s, f"{forbidden} must not be in seed_universe.py (GHA クロバー防止)"


def test_refresh_market_never_writes_nisa_columns():
    s = _src("scripts/refresh_market.py")
    for forbidden in ("nisa_growth_status", "market_alert", "nisa_source",
                      "nisa_checked_at", "nisa_tsumitate"):
        assert forbidden not in s, f"{forbidden} must not be in refresh_market.py (GHA クロバー防止)"


def test_migration_has_production_verification_queries():
    s = _src("db/migrations/2026-07-21-nisa-eligibility.sql").lower()
    assert "select distinct nisa_growth_status" in s   # §3.6 検証クエリを migration 内に記録
