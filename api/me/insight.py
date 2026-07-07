"""POST /api/me/insight — per-stock AI読み解き（personal-gated・束D層2）。認証必須。

server 権威：client は {ticker} のみ送る。server が market.financials_annual を読み
DuPont/FCF を算出（finance-rules.js 鏡像）＋同市場 peer percentile＋market universe を接地して
claude-sonnet-4-6 へ。personal（ADVICE_MODE=personal）でのみ助言可・production は 403。
免責は client 定数（DetailRules.ANALYSIS_DISCLAIMER）。個人資産 state は読まない（public 市場データのみ）。
"""
import hashlib
import json
import math

SCHEMA_VERSION = 1
PROMPT_VERSION = "insight-sys-v1"
DISCLAIMER_VERSION = "disc-v1"

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

def _dir(prev, curr):
    if prev is None or curr is None: return None
    if prev == 0:
        return "improving" if curr > 0 else ("declining" if curr < 0 else "flat")
    if curr > prev * 1.02: return "improving"
    if curr < prev * 0.98: return "declining"
    return "flat"

def _year_facts(fin):
    dp = dupont(fin)
    return {"dupont": dp, "fcf": fcf(fin), "fcf_margin": fcf_margin(fin), "cash_conversion": cash_conversion(fin)}

def stock_series(trend):
    trend = trend or {}
    pairs = []
    for k, v in trend.items():
        try:
            y = int(k)
        except (TypeError, ValueError):
            continue
        if isinstance(v, dict):
            pairs.append((y, v))
    pairs.sort(key=lambda p: p[0])
    series = [dict(year=y, **_year_facts(v)) for y, v in pairs]
    latest = series[-1] if series else None
    prev = series[-2] if len(series) >= 2 else None
    def pick(row, key):
        if row is None: return None
        return row["dupont"]["roe"] if key == "roe" else row[key]
    direction = {k: _dir(pick(prev, k), pick(latest, k)) for k in ("roe", "fcf_margin", "cash_conversion")}
    return {"series": series, "latest": latest, "direction": direction}

def median(values):
    a = sorted(v for v in values if v is not None)
    if not a: return None
    m = len(a) // 2
    return a[m] if len(a) % 2 else (a[m - 1] + a[m]) / 2

def percentile_rank(values, x):
    """midrank percentile（同順位は 0.5 加算・cross-section percentileRank と同方針）。"""
    a = [v for v in values if v is not None]
    if x is None or not a: return None
    below = sum(1 for v in a if v < x)
    equal = sum(1 for v in a if v == x)
    return (below + 0.5 * equal) / len(a) * 100

def _row_roe(r):
    return roe(r) if (has_value(r, "net_income") and has_value(r, "net_assets") and n(r.get("net_assets")) > 0) else None

def _row_net_margin(r):
    return net_margin(r) if (has_value(r, "net_income") and has_value(r, "net_sales") and n(r.get("net_sales")) > 0) else None

def _row_op_margin(r):
    return op_margin(r) if (has_value(r, "operating_income") and has_value(r, "net_sales") and n(r.get("net_sales")) > 0) else None

def _row_val(r, key):
    v = r.get(key)
    return float(v) if isinstance(v, (int, float)) and v is not None else None

def peer_context(target_ticker, target_market, rows):
    rows = rows or []
    target = next((r for r in rows if r.get("ticker") == target_ticker), None)
    roes = [_row_roe(r) for r in rows]
    nms = [_row_net_margin(r) for r in rows]
    oms = [_row_op_margin(r) for r in rows]
    pers = [_row_val(r, "per") for r in rows]
    pbrs = [_row_val(r, "pbr") for r in rows]
    t_roe = _row_roe(target) if target else None
    t_nm = _row_net_margin(target) if target else None
    t_om = _row_op_margin(target) if target else None
    t_per = _row_val(target, "per") if target else None
    t_pbr = _row_val(target, "pbr") if target else None
    sector = (target.get("industry") if target else None) or None
    sector_rows = [r for r in rows if sector and r.get("industry") == sector]
    sector_n = len(sector_rows)
    sec_median = {"roe": None, "net_margin": None}
    if sector_n >= 3:
        sec_median = {"roe": median([_row_roe(r) for r in sector_rows]),
                      "net_margin": median([_row_net_margin(r) for r in sector_rows])}
    return {
        "market_n": len(rows),
        "roe_percentile": _round1(percentile_rank(roes, t_roe)),
        "net_margin_percentile": _round1(percentile_rank(nms, t_nm)),
        "op_margin_percentile": _round1(percentile_rank(oms, t_om)),
        "per_percentile": _round1(percentile_rank(pers, t_per)),
        "pbr_percentile": _round1(percentile_rank(pbrs, t_pbr)),
        "sector": sector if sector_n >= 3 else None,
        "sector_n": sector_n,
        "sector_median": {k: _round1(v) for k, v in sec_median.items()},
    }

def _round1(x):
    return round(x, 1) if isinstance(x, (int, float)) else None

def build_facts(meta, trend, peer_ctx, universe, neutral_comment):
    """§5 の server 権威 allowlist dict を組み立てる（mode は付けない＝handler が付与）。

    個人資産キー（buffer/satellite/core/monthlyExpense/goals 等）は一切含まない：
    meta/trend/peer_ctx はすべて public 市場データ（財務諸表・同市場 peer）由来。
    """
    ss = stock_series(trend)
    return {
        "ticker": meta.get("ticker"),
        "name": meta.get("name"),
        "industry": meta.get("industry"),
        "currency": "USD" if meta.get("currency") == "USD" else "JPY",
        "market": meta.get("market"),
        "per": meta.get("per"),
        "pbr": meta.get("pbr"),
        "unit": "百万" + ("ドル" if meta.get("currency") == "USD" else "円"),
        "dupont_latest": (ss["latest"] and {"year": ss["latest"]["year"], **ss["latest"]["dupont"]}) or None,
        "dupont_trend": [{"year": s["year"], **s["dupont"]} for s in ss["series"]],
        "fcf_latest": (ss["latest"] and {"year": ss["latest"]["year"], "fcf": ss["latest"]["fcf"],
                                         "fcf_margin": ss["latest"]["fcf_margin"], "cash_conversion": ss["latest"]["cash_conversion"]}) or None,
        "fcf_trend": [{"year": s["year"], "fcf": s["fcf"], "fcf_margin": s["fcf_margin"], "cash_conversion": s["cash_conversion"]} for s in ss["series"]],
        "trend_direction": ss["direction"],
        "peer": peer_ctx,
        "universe": universe or [],
        "neutral_comment": neutral_comment or "",
        "prompt_version": PROMPT_VERSION,
        "schema_version": SCHEMA_VERSION,
    }

def facts_hash(facts):
    return hashlib.sha256(json.dumps(facts, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
