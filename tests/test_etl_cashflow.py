"""Slice4 収支連携 ETL の純関数テスト（DB/Notion 不要）。

loud-fail 型検証(etl-1)・source_hash 決定性(etl-5)・パース・write-only-good-rows を固定。
pytest でも `.venv/bin/python tests/test_etl_cashflow.py` 直実行でも動く。
"""
import importlib.util
import os
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("etl_cashflow", os.path.join(ROOT, "scripts", "etl_cashflow.py"))
etl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(etl)


def _formula(num):
    return {"type": "formula", "formula": {"type": "number", "number": num}}


def _datep(iso):
    return {"type": "date", "date": {"start": iso}}


def _monthly_page(iso, income, expense, fixed, var, balance, salary=0, misc=0, sr=0.3):
    props = {
        "収入合計": _formula(income), "支出合計": _formula(expense), "固定支出": _formula(fixed),
        "変動支出": _formula(var), "収支": _formula(balance), "貯蓄率": _formula(sr),
        "給与収入": _formula(salary), "雑収入": _formula(misc), "日付": _datep(iso),
    }
    return {"properties": props}


def _tx(iso, amount, category):
    return {"properties": {
        "日付": {"date": {"start": iso}}, "金額": {"number": amount},
        "系統_LINK": {"rollup": {"array": [{"type": "select", "select": {"name": category}}]}},
    }}


def _expect_systemexit(fn):
    try:
        fn()
    except SystemExit:
        return True
    return False


def test_validate_monthly_empty_aborts():
    assert _expect_systemexit(lambda: etl.validate_monthly([]))


def test_validate_monthly_missing_prop_aborts():
    page = _monthly_page("2026-05-01", 300000, 220000, 120000, 100000, 80000)
    del page["properties"]["収支"]
    assert _expect_systemexit(lambda: etl.validate_monthly([page]))


def test_validate_monthly_wrong_type_aborts():
    # 収入合計 が formula でなく number 型に差し替えられた（型崩れ・etl-1）
    page = _monthly_page("2026-05-01", 300000, 220000, 120000, 100000, 80000)
    page["properties"]["収入合計"] = {"type": "number", "number": 300000}
    assert _expect_systemexit(lambda: etl.validate_monthly([page]))
    # 日付 が date でない
    page2 = _monthly_page("2026-05-01", 300000, 220000, 120000, 100000, 80000)
    page2["properties"]["日付"] = {"type": "rich_text", "rich_text": []}
    assert _expect_systemexit(lambda: etl.validate_monthly([page2]))


def test_validate_monthly_valid_ok():
    page = _monthly_page("2026-05-01", 300000, 220000, 120000, 100000, 80000)
    etl.validate_monthly([page])  # 例外なし


def test_formula_number():
    assert etl._formula_number(_formula(1234)) == 1234
    assert etl._formula_number({"type": "string", "formula": {"type": "string", "string": "12%"}}) == 0.12
    assert etl._formula_number({"type": "string", "formula": {"type": "string", "string": "1,234"}}) == 1234
    assert etl._formula_number({"type": "string", "formula": {"type": "string", "string": "x"}}) is None
    assert etl._i(None) == 0 and etl._i("abc") == 0 and etl._i(80000.4) == 80000


def test_period_parsing():
    assert etl._period_from_row({"日付": _datep("2026-05-13")}) == date(2026, 5, 1)
    assert etl._period_from_row({"年": {"type": "select", "select": {"name": "2026"}},
                                 "月": {"type": "rich_text", "rich_text": [{"plain_text": "5"}]}}) == date(2026, 5, 1)
    assert etl._period_from_row({}) is None
    assert etl._row_period({"日付": {"date": {"start": "2026-05-13"}}}) == "2026-05-01"


def test_build_headline_skips_none_authoritative_and_marks_complete():
    pages = [
        _monthly_page("2026-04-01", 300000, 220000, 120000, 100000, 80000),
        _monthly_page("2026-06-01", 300000, 220000, 120000, 100000, 80000),  # 当月＝未確定
        _monthly_page("2026-05-01", None, 0, 0, 0, None),  # 権威2つとも None → skip
    ]
    out = etl.build_headline(pages, (2026, 6))
    assert "2026-04-01" in out and out["2026-04-01"]["is_complete"] is True
    assert out["2026-06-01"]["is_complete"] is False  # 当月
    assert "2026-05-01" not in out  # write-only-good-rows


def test_build_breakdown_deterministic_and_positive_only():
    txs_a = [_tx("2026-05-02", 5000, "食費"), _tx("2026-05-03", 5000, "日用品"),
             _tx("2026-05-04", -100, "返金"), _tx("2026-05-05", 8000, "交通")]
    txs_b = list(reversed(txs_a))  # 挿入順を変える
    ba = etl.build_breakdown(txs_a, [])
    bb = etl.build_breakdown(txs_b, [])
    assert ba == bb  # ページ順非依存（etl-5）＝決定的
    cats = ba["2026-05-01"]["categories"]
    names = [c["name"] for c in cats]
    amounts = [c["amount"] for c in cats]
    assert "返金" not in names  # 金額<=0 は除外
    assert amounts == sorted(amounts, reverse=True)  # 金額降順
    # 同額(5000)のタイブレークは name 昇順で決定的（(-amount, name)）
    same = [c["name"] for c in cats if c["amount"] == 5000]
    assert same == sorted(same)


def test_source_hash_order_independent():
    h = {"period": date(2026, 5, 1), "balance": 80000, "total_income": 300000}
    b1 = etl.build_breakdown([_tx("2026-05-02", 5000, "A"), _tx("2026-05-03", 3000, "B")], [])["2026-05-01"]
    b2 = etl.build_breakdown([_tx("2026-05-03", 3000, "B"), _tx("2026-05-02", 5000, "A")], [])["2026-05-01"]
    assert etl._source_hash(h, b1) == etl._source_hash(h, b2)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print("  OK  " + fn.__name__)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(" FAIL " + fn.__name__ + " :: " + repr(e))
    print("\n" + ("ALL PASS" if not failed else f"FAILED: {failed}"))
    raise SystemExit(1 if failed else 0)
