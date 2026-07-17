"""投資台帳 ETL の純関数テスト（DB/Notion 不要）。

loud-fail（口座区分の空/未知値・売却の数量欠落・プロパティ欠落/型崩れ）・source_hash 決定性・
移動平均が (ticker × 口座区分) 単位で独立すること・戦略区分と口座区分の直交・配当が枠を消費しないこと・
期初保有が「日付」の年に計上されることを固定。
pytest でも `.venv/bin/python tests/test_etl_investment.py` 直実行でも動く。
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("etl_investment", os.path.join(ROOT, "scripts", "etl_investment.py"))
etl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(etl)

CUR_YM = (2027, 1)  # 「当月」＝2027-01。それ以前は is_complete=True


def _page(iso, kind, account, ticker="VOO", qty=1, amount=100000, strategy="コア", fee=0):
    return {"properties": {
        "日付": {"type": "date", "date": {"start": iso}},
        "種別": {"type": "select", "select": {"name": kind}},
        "戦略区分": {"type": "select", "select": {"name": strategy}},
        "ティッカー": {"type": "select", "select": {"name": ticker}},
        "口座区分": {"type": "select", "select": {"name": account}},
        "数量": {"type": "number", "number": qty},
        "約定金額": {"type": "number", "number": amount},
        "手数料": {"type": "number", "number": fee},
        "名前": {"type": "title", "title": []},
    }}


def _expect_systemexit(fn):
    try:
        fn()
    except SystemExit:
        return True
    return False


# ── loud-fail ──
def test_validate_empty_aborts():
    assert _expect_systemexit(lambda: etl.validate_investment([]))


def test_validate_missing_prop_aborts():
    page = _page("2026-05-10", etl.KIND_BUY, "課税")
    del page["properties"]["口座区分"]
    assert _expect_systemexit(lambda: etl.validate_investment([page]))


def test_validate_wrong_type_aborts():
    page = _page("2026-05-10", etl.KIND_BUY, "課税")
    page["properties"]["口座区分"] = {"type": "rich_text", "rich_text": []}
    assert _expect_systemexit(lambda: etl.validate_investment([page]))


def test_build_empty_account_aborts():
    """口座区分が空＝silent に課税扱いせず中止（NISA 枠の静かな過少計上を防ぐ）。"""
    page = _page("2026-05-10", etl.KIND_BUY, "課税")
    page["properties"]["口座区分"]["select"] = None
    assert _expect_systemexit(lambda: etl.build_investment([page], CUR_YM))


def test_build_unknown_account_aborts():
    page = _page("2026-05-10", etl.KIND_BUY, "NISA")  # 3値のいずれでもない
    assert _expect_systemexit(lambda: etl.build_investment([page], CUR_YM))


def test_build_sell_without_qty_aborts():
    """売却に数量が無いと簿価按分ができない＝中止。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=None, amount=600000)]
    assert _expect_systemexit(lambda: etl.build_investment(pages, CUR_YM))


def test_build_row_without_date_is_dropped():
    """write-only-good-rows: 約定日が無い行は捨てる（0 を格納しない）。"""
    page = _page("2026-05-10", etl.KIND_BUY, "課税")
    page["properties"]["日付"]["date"] = None
    assert etl.build_investment([page], CUR_YM) == {}


# ── 会計 ──
def test_buy_nisa_growth_fills_both_axes():
    """戦略区分（コア）と口座区分（NISA成長）は直交＝1購入が両方の列に載る。"""
    out = etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000)], CUR_YM)
    r = out["2026-05-01"]
    assert r["principal_core_delta"] == 1000000
    assert r["nisa_growth_delta"] == 1000000
    assert r["nisa_tsumitate_delta"] == 0
    assert r["invest_cash_flow"] == -1000000
    assert r["is_complete"] is True


def test_taxable_buy_has_zero_nisa_delta():
    out = etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "課税", qty=10, amount=1000000)], CUR_YM)
    r = out["2026-05-01"]
    assert r["principal_core_delta"] == 1000000
    assert r["nisa_growth_delta"] == 0 and r["nisa_tsumitate_delta"] == 0


def test_sell_uses_moving_average_cost():
    """簿価按分＝avg_cost × 数量。100万で10株→@10万。6株売却で簿価60万・売値70万→実現益10万。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=6, amount=700000)]
    out = etl.build_investment(pages, CUR_YM)
    r = out["2026-06-01"]
    assert r["nisa_growth_sold_at_cost"] == 600000
    assert r["realized_gain"] == 100000
    assert r["principal_core_delta"] == -600000
    assert r["invest_cash_flow"] == 700000


def test_moving_average_is_independent_per_account():
    """同一銘柄を NISA成長 と 課税 で持つ時、片方の売却が他方の avg_cost を汚さない。"""
    pages = [
        _page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),   # @10万
        _page("2026-05-11", etl.KIND_BUY, "課税", qty=10, amount=2000000),        # @20万
        _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=5, amount=600000),     # 簿価 50万
        _page("2026-06-11", etl.KIND_SELL, "課税", qty=5, amount=1100000),        # 簿価 100万
    ]
    out = etl.build_investment(pages, CUR_YM)
    r = out["2026-06-01"]
    assert r["nisa_growth_sold_at_cost"] == 500000       # 課税の@20万に汚染されていない
    assert r["realized_gain"] == 100000 + 100000
    h = out["2026-06-01"]["holdings"]
    assert h["VOO|NISA成長"]["avg_cost"] == 100000
    assert h["VOO|課税"]["avg_cost"] == 200000


def test_dividend_does_not_consume_quota():
    """配当は現金+/実現益+/元本不変/NISA 枠不消費。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_DIV, "NISA成長", qty=0, amount=30000)]
    r = etl.build_investment(pages, CUR_YM)["2026-06-01"]
    assert r["nisa_growth_delta"] == 0
    assert r["principal_core_delta"] == 0
    assert r["invest_cash_flow"] == 30000
    assert r["realized_gain"] == 30000


def test_seed_holding_counts_in_its_date_year_and_moves_no_cash():
    """期初保有は「日付」＝実取得日の年の拠出として計上し、現金は動かさない（schema: 期初保有=0）。"""
    r = etl.build_investment(
        [_page("2025-03-04", etl.KIND_SEED, "NISAつみたて", qty=5, amount=500000)], CUR_YM)["2025-03-01"]
    assert r["nisa_tsumitate_delta"] == 500000
    assert r["principal_core_delta"] == 500000
    assert r["invest_cash_flow"] == 0


def test_fee_is_separate_from_amount():
    """約定金額 A・手数料 F は別建て：枠消費/元本は A のみ・現金流出は A+F（購入）。"""
    r = etl.build_investment(
        [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000, fee=5000)], CUR_YM)["2026-05-01"]
    assert r["nisa_growth_delta"] == 1000000       # 枠は約定金額のみ（手数料を食わない）
    assert r["principal_core_delta"] == 1000000    # 元本も約定金額のみ
    assert r["invest_cash_flow"] == -1005000       # 現金流出は手数料込み


def test_sell_fee_reduces_proceeds_and_gain():
    """売却の手取り＝A−F、実現益＝(A−F)−簿価。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=6, amount=700000, fee=3000)]
    r = etl.build_investment(pages, CUR_YM)["2026-06-01"]
    assert r["invest_cash_flow"] == 697000
    assert r["realized_gain"] == 700000 - 3000 - 600000   # 97000
    assert r["nisa_growth_sold_at_cost"] == 600000        # 簿価は手数料を含めない


def test_dividend_fee_reduces_cash_and_gain():
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_DIV, "NISA成長", qty=0, amount=30000, fee=500)]
    r = etl.build_investment(pages, CUR_YM)["2026-06-01"]
    assert r["invest_cash_flow"] == 29500
    assert r["realized_gain"] == 29500
    assert r["nisa_growth_delta"] == 0


# ── loud-fail 追加（負値・戦略区分）──
def test_negative_amount_aborts():
    """負の約定金額は num() が静かに 0 へ潰し NISA 枠を水増しするため中止。"""
    assert _expect_systemexit(
        lambda: etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", amount=-1000000)], CUR_YM))


def test_negative_fee_aborts():
    assert _expect_systemexit(
        lambda: etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", fee=-100)], CUR_YM))


def test_negative_qty_aborts():
    assert _expect_systemexit(
        lambda: etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=-5)], CUR_YM))


def test_empty_strategy_aborts():
    """戦略区分の空＝silent にサテライト扱いせず中止（口座区分と対称）。"""
    page = _page("2026-05-10", etl.KIND_BUY, "NISA成長")
    page["properties"]["戦略区分"]["select"] = None
    assert _expect_systemexit(lambda: etl.build_investment([page], CUR_YM))


def test_unknown_strategy_aborts():
    assert _expect_systemexit(
        lambda: etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", strategy="foo")], CUR_YM))


def test_sell_uses_holding_strategy_not_row():
    """売却の元本は holdings 保有側の strategy で戻す＝買=コア/売=サテライトの記帳ミスで負化しない（M-1）。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000, strategy="コア"),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=5, amount=600000, strategy="サテライト")]
    r = etl.build_investment(pages, CUR_YM)["2026-06-01"]
    assert r["principal_core_delta"] == -500000   # コア（保有側）から減る
    assert r["principal_sat_delta"] == 0          # サテライト（行の誤値）は動かない


def test_source_hash_same_day_buy_sell_order_independent():
    """同日の購入+売却をページ逆順で与えても hash 一致（sort が load-bearing なことの検証）。"""
    buy = _page("2026-05-10", etl.KIND_BUY, "NISA成長", ticker="VOO", qty=10, amount=1000000)
    sell = _page("2026-05-10", etl.KIND_SELL, "NISA成長", ticker="VOO", qty=4, amount=500000)
    r1 = etl.build_investment([buy, sell], CUR_YM)["2026-05-01"]
    r2 = etl.build_investment([sell, buy], CUR_YM)["2026-05-01"]
    assert etl._source_hash(r1) == etl._source_hash(r2)
    assert r1["nisa_growth_sold_at_cost"] == 400000   # 買→売 の順で処理＝簿価 @10万 × 4


def test_current_month_is_incomplete():
    r = etl.build_investment([_page("2027-01-10", etl.KIND_BUY, "課税")], CUR_YM)["2027-01-01"]
    assert r["is_complete"] is False


# ── source_hash / holdings ──
def test_source_hash_is_page_order_independent():
    """Notion のページ返却順に依存せず hash 安定（etl-5）。"""
    a = _page("2026-05-10", etl.KIND_BUY, "NISA成長", ticker="VOO", qty=10, amount=1000000)
    b = _page("2026-05-11", etl.KIND_BUY, "課税", ticker="VTI", qty=5, amount=500000)
    h1 = etl._source_hash(etl.build_investment([a, b], CUR_YM)["2026-05-01"])
    h2 = etl._source_hash(etl.build_investment([b, a], CUR_YM)["2026-05-01"])
    assert h1 == h2


def test_fully_sold_position_leaves_holdings():
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=10, amount=1200000)]
    out = etl.build_investment(pages, CUR_YM)
    assert "VOO|NISA成長" not in out["2026-06-01"]["holdings"]


def test_i_coerces_none_and_garbage_to_zero():
    assert etl._i(None) == 0 and etl._i("x") == 0 and etl._i(1234.6) == 1235


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
