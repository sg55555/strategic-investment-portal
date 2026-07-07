"""POST /api/me/insight — per-stock AI読み解き（personal-gated・束D層2）。認証必須。

server 権威：client は {ticker} のみ送る。server が market.financials_annual を読み
DuPont/FCF を算出（finance-rules.js 鏡像）＋同市場 peer percentile＋market universe を接地して
claude-sonnet-4-6 へ。personal（ADVICE_MODE=personal）でのみ助言可・production は 403。
免責は client 定数（DetailRules.ANALYSIS_DISCLAIMER）。個人資産 state は読まない（public 市場データのみ）。
"""
import math

def n(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.0
    return x if math.isfinite(x) else 0.0  # 非負強制しない（赤字/CF流出は正当）

def ratio(numer, denom):
    d = n(denom)
    return (n(numer) / d) * 100 if d > 0 else 0.0

def div_or_null(numer, denom):
    return (numer / denom) if (isinstance(numer, (int, float)) and isinstance(denom, (int, float))
                               and math.isfinite(numer) and math.isfinite(denom) and denom > 0) else None

def has_value(fin, key):
    return fin is not None and fin.get(key) is not None

def total_assets(fin):
    fin = fin or {}
    return n(fin.get("current_assets")) + n(fin.get("non_current_assets"))

def net_margin(fin):
    return ratio((fin or {}).get("net_income"), (fin or {}).get("net_sales"))

def op_margin(fin):
    return ratio((fin or {}).get("operating_income"), (fin or {}).get("net_sales"))

def roe(fin):
    return ratio((fin or {}).get("net_income"), (fin or {}).get("net_assets"))

def asset_turnover(fin):
    if not fin: return None
    if not (has_value(fin, "net_sales") and has_value(fin, "current_assets") and has_value(fin, "non_current_assets")):
        return None
    return div_or_null(n(fin.get("net_sales")), total_assets(fin))

def equity_multiplier(fin):
    if not fin: return None
    if not (has_value(fin, "current_assets") and has_value(fin, "non_current_assets") and has_value(fin, "net_assets")):
        return None
    return div_or_null(total_assets(fin), n(fin.get("net_assets")))

def dupont(fin):
    fin = fin or {}
    nm = net_margin(fin) if (has_value(fin, "net_income") and has_value(fin, "net_sales") and n(fin.get("net_sales")) > 0) else None
    re = roe(fin) if (has_value(fin, "net_income") and has_value(fin, "net_assets") and n(fin.get("net_assets")) > 0) else None
    return {"net_margin": nm, "asset_turnover": asset_turnover(fin), "equity_multiplier": equity_multiplier(fin), "roe": re}

def fcf(fin):
    if not fin: return None
    if not (has_value(fin, "operating_cf") and has_value(fin, "investing_cf")): return None
    return n(fin.get("operating_cf")) + n(fin.get("investing_cf"))

def fcf_margin(fin):
    if not fin: return None
    for k in ("operating_cf", "investing_cf", "net_sales"):
        if not has_value(fin, k): return None
    if not (n(fin.get("net_sales")) > 0): return None
    return ratio(fcf(fin), fin.get("net_sales"))

def cash_conversion(fin):
    if not fin or not has_value(fin, "operating_cf"): return None
    c = div_or_null(n(fin.get("operating_cf")), n(fin.get("net_income")))
    return None if c is None else c * 100
