"""GitHub Actions/手動用: yfinance → Neon market スキーマ更新。

純関数（map_*）は network 非依存で fixture テスト可能。IO(fetch/upsert)は下部。
--prices: 日次 EOD 株価バッチ＋info(marketCap/per/pbr)。
--financials: 週次 財務(yfinance)。既存 source='edinet' 行は upsert で保護。
"""
from __future__ import annotations
import math
import sys

# yfinance 財務ラベル → schema 列名（欠損はそのまま None）。
YF_TO_SCHEMA = {
    "Total Current Assets": "current_assets",
    "Total Non Current Assets": "non_current_assets",
    "Total Current Liabilities": "current_liabilities",
    "Total Non Current Liabilities": "non_current_liabilities",
    "Stockholders Equity": "net_assets",
    "Total Revenue": "net_sales",
    "Gross Profit": "gross_profit",
    "Operating Income": "operating_income",
    "Pretax Income": "income_before_taxes",
    "Net Income": "net_income",
    "Operating Cash Flow": "operating_cf",
    "Investing Cash Flow": "investing_cf",
    "Financing Cash Flow": "financing_cf",
    "Beginning Cash Position": "cf_cash_start",
    "End Cash Position": "cf_cash_end",
}

_FIN_COLS = (
    "current_assets", "non_current_assets", "current_liabilities",
    "non_current_liabilities", "net_assets", "net_sales", "gross_profit",
    "operating_income", "ordinary_income", "income_before_taxes", "net_income",
    "operating_cf", "investing_cf", "financing_cf", "cf_cash_start", "cf_cash_end",
)


def _finite(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def map_ohlcv_rows(ticker: str, hist: list[dict]) -> list[tuple]:
    out = []
    for h in hist:
        o, hi, lo, c = _finite(h.get("open")), _finite(h.get("high")), _finite(h.get("low")), _finite(h.get("close"))
        if None in (o, hi, lo, c):
            continue
        vol = _finite(h.get("volume")) or 0
        out.append((ticker, h["date"], o, hi, lo, c, int(vol)))
    return out


def map_info_fields(info: dict) -> dict:
    per = info.get("trailingPE")
    if per is None:
        per = info.get("forwardPE")
    return {
        "market_cap": _finite(info.get("marketCap")),
        "per": _finite(per),
        "pbr": _finite(info.get("priceToBook")),
    }


def map_financials_rows(ticker: str, fin: dict) -> list[tuple]:
    rows = []
    for fy, items in fin.items():
        vals = {col: None for col in _FIN_COLS}
        for label, v in items.items():
            col = YF_TO_SCHEMA.get(label)
            if col:
                vals[col] = _finite(v)
        rows.append((ticker, int(fy), "FY", *[vals[c] for c in _FIN_COLS], "yfinance"))
    return rows
