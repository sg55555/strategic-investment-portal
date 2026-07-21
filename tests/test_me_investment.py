"""plan0: api/me/investment.py の _read_snapshots 分類（DB 不要・fake cursor）。

列/テーブル不在（migration 未適用）= schema_ok False、その他読取失敗 = None、
本当に 0 件 = True（空配列だが schema は正常）を固定。silent に空へ潰さない。
"""
import datetime as dt
import importlib.util
import os
from decimal import Decimal

import psycopg
from psycopg import errors as pg_errors

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location(
    "me_investment", os.path.join(ROOT, "api", "me", "investment.py"))
inv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(inv)


class FakeCur:
    """execute で例外を投げるか、fetchall で固定 rows を返す最小 cursor。"""
    def __init__(self, rows=None, exc=None):
        self._rows = [] if rows is None else rows
        self._exc = exc

    def execute(self, *a, **k):
        if self._exc is not None:
            raise self._exc

    def fetchall(self):
        return self._rows


def _full_row():
    # COLUMNS 順（12 要素）: period, invest_cash_flow, principal_core_delta, principal_sat_delta,
    # realized_gain, is_complete, holdings, pulled_at, nisa_tsumitate_delta, nisa_growth_delta,
    # nisa_tsumitate_sold_at_cost, nisa_growth_sold_at_cost
    return (
        dt.date(2026, 5, 1), Decimal("-1000000"), Decimal("1000000"), Decimal("0"),
        Decimal("0"), True, {"VOO|NISA成長": {"qty": 10}},
        dt.datetime(2026, 5, 10, tzinfo=dt.timezone.utc),
        Decimal("0"), Decimal("1000000"), Decimal("0"), Decimal("0"),
    )


def test_missing_column_flags_schema_false():
    rows, ok = inv._read_snapshots(FakeCur(exc=pg_errors.UndefinedColumn("column ... does not exist")))
    assert rows == [] and ok is False


def test_missing_table_flags_schema_false():
    rows, ok = inv._read_snapshots(FakeCur(exc=pg_errors.UndefinedTable("relation ... does not exist")))
    assert rows == [] and ok is False


def test_generic_read_failure_flags_schema_none():
    rows, ok = inv._read_snapshots(FakeCur(exc=ValueError("boom")))
    assert rows == [] and ok is None


def test_empty_is_schema_ok_true():
    rows, ok = inv._read_snapshots(FakeCur(rows=[]))
    assert rows == [] and ok is True


def test_rows_parsed_and_schema_ok():
    rows, ok = inv._read_snapshots(FakeCur(rows=[_full_row()]))
    assert ok is True
    r = rows[0]
    assert r["period"] == "2026-05-01"
    assert r["nisa_growth_delta"] == 1000000
    assert r["invest_cash_flow"] == -1000000
    assert r["is_complete"] is True
    assert r["holdings"] == {"VOO|NISA成長": {"qty": 10}}


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
