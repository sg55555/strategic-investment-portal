"""plan0: api/me/advice.py の _read_investment_ledger 分類（DB 不要・fake cursor）。

列/テーブル不在（migration 未適用）= (None, False)、その他読取失敗 = (None, None)、
本当に 0 件 = ([], True) を固定。degrade は従来どおり inv_rows=None に潰すが、
分類（schema_ok）で silent 化を露出する。
"""
import datetime as dt
import importlib.util
import os

import psycopg
from psycopg import errors as pg_errors

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location(
    "advice", os.path.join(ROOT, "api", "me", "advice.py"))
advice = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(advice)


class FakeCur:
    def __init__(self, rows=None, exc=None):
        self._rows = [] if rows is None else rows
        self._exc = exc

    def execute(self, *a, **k):
        if self._exc is not None:
            raise self._exc

    def fetchall(self):
        return self._rows


def test_missing_column_returns_none_and_schema_false():
    rows, ok = advice._read_investment_ledger(FakeCur(exc=pg_errors.UndefinedColumn("column ... does not exist")))
    assert rows is None and ok is False


def test_missing_table_returns_none_and_schema_false():
    rows, ok = advice._read_investment_ledger(FakeCur(exc=pg_errors.UndefinedTable("relation ... does not exist")))
    assert rows is None and ok is False


def test_generic_read_failure_returns_none_and_schema_none():
    rows, ok = advice._read_investment_ledger(FakeCur(exc=ValueError("boom")))
    assert rows is None and ok is None


def test_empty_returns_empty_list_and_schema_true():
    rows, ok = advice._read_investment_ledger(FakeCur(rows=[]))
    assert rows == [] and ok is True


def test_rows_parsed_and_schema_true():
    rec = (dt.date(2026, 5, 1), 120000, 0, 0, 0)
    rows, ok = advice._read_investment_ledger(FakeCur(rows=[rec]))
    assert ok is True
    assert rows[0]["period"] == "2026-05-01"
    assert rows[0]["nisa_tsumitate_delta"] == 120000
    assert rows[0]["nisa_growth_delta"] == 0


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
