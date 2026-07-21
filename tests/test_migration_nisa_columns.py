"""plan0: NISA 4 列 migration の契約ガード（冪等・非破壊・4 列宣言）。

db/migrations/2026-07-17-investment-nisa-columns.sql が将来の誤編集で
ADD COLUMN IF NOT EXISTS（冪等）や 4 列のいずれかを失わないことを固定する。
DB 不要（ファイル内容の静的検査のみ）。pytest でも直実行でも動く。
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SQL_PATH = os.path.join(ROOT, "db", "migrations", "2026-07-17-investment-nisa-columns.sql")

NISA_COLUMNS = (
    "nisa_tsumitate_delta",
    "nisa_growth_delta",
    "nisa_tsumitate_sold_at_cost",
    "nisa_growth_sold_at_cost",
)


def _sql():
    with open(SQL_PATH, encoding="utf-8") as f:
        return f.read()


def test_migration_targets_investment_snapshots():
    assert "ALTER TABLE me.investment_snapshots" in _sql()


def test_migration_declares_four_nisa_columns_idempotently():
    text = _sql()
    for col in NISA_COLUMNS:
        assert f"ADD COLUMN IF NOT EXISTS {col}" in text, col


def test_migration_columns_are_non_negative_defaulted_numeric():
    text = _sql()
    for col in NISA_COLUMNS:
        # 各列が NUMERIC(16,0) NOT NULL DEFAULT 0 で宣言される（生額・簿価・非負）。
        idx = text.index(f"ADD COLUMN IF NOT EXISTS {col}")
        decl = text[idx:idx + 120]
        assert "NUMERIC(16,0) NOT NULL DEFAULT 0" in decl, col


if __name__ == "__main__":
    import sys
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok  {name}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  FAIL {name}: {e!r}")
    print(f"{'FAILED' if fails else 'PASSED'} ({fails} failures)")
    sys.exit(1 if fails else 0)
