"""GET /api/market/list — 全銘柄の軽量サマリ（grid/検索/フィルタ用・prices無し）。

旧 data.js の STOCK_DATA を「ticker → エントリ」の辞書として再現するが、
prices は空配列・financials_trend は grid が読む直近3期×7項目だけに絞る
（初回ロード 21MB→数十KB）。詳細(prices/全財務)は ohlcv/financials で遅延取得。
認証不要・個人データゼロ（public market データのみ）。
"""
from http.server import BaseHTTPRequestHandler
from datetime import timezone, timedelta
import json
import os

import psycopg

_JST = timezone(timedelta(hours=9))

# grid(filterAndRenderPortal) が financials_trend[year] から読む7項目だけ
_GRID_FIN_FIELDS = (
    "net_sales", "net_assets", "current_assets", "non_current_assets",
    "current_liabilities", "operating_income", "net_income",
)

# ── W1 価格集計（発掘4点セット＋30日スパークライン）──
# 52週=252営業日 ≈ 365暦日。休場・データ欠損の余裕を見て 400暦日で境界を切る。
# ⚠ この境界は必須：無制限の window 関数は ohlcv 235万行を舐めて 2.8〜3.8秒（コールド35秒）かかり、
#    Vercel の10秒制限に対して危険。境界ありで 723〜904ms（2026-08-23 実測）。
_PX_BOUND_DAYS = 400
_PX_MIN_ROWS = 6        # これ未満の履歴（新規上場）は px を作らない
_PX_MIN_52W_ROWS = 60   # 52週系(hi52/lo52/dh/pos52)を名乗れる最低件数
_SPARK_N = 30

_PX_SQL = f"""
WITH bound AS (SELECT (MAX(date) - INTERVAL '{_PX_BOUND_DAYS} days')::date d FROM market.ohlcv),
w AS (SELECT ticker, date, close, volume,
             ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) rn
      FROM market.ohlcv, bound WHERE date >= bound.d),
c AS (SELECT ticker, COUNT(*) n FROM w GROUP BY ticker),
y AS (SELECT ticker, MAX(close) hi52, MIN(close) lo52 FROM w WHERE rn <= 252 GROUP BY ticker),
v AS (SELECT ticker, AVG(volume)::float avg20 FROM w WHERE rn BETWEEN 2 AND 21 GROUP BY ticker),
s AS (SELECT ticker, array_agg(close ORDER BY date ASC) spark FROM w WHERE rn <= {_SPARK_N} GROUP BY ticker),
p AS (SELECT ticker,
        MAX(CASE WHEN rn=1 THEN close  END) last,
        MAX(CASE WHEN rn=1 THEN date   END) last_date,
        MAX(CASE WHEN rn=1 THEN volume END) last_vol,
        MAX(CASE WHEN rn=2 THEN close  END) prev,
        MAX(CASE WHEN rn=6 THEN close  END) base5
      FROM w WHERE rn <= 6 GROUP BY ticker)
SELECT p.ticker, p.last, p.last_date, p.prev, p.base5, p.last_vol,
       v.avg20, y.hi52, y.lo52, s.spark, c.n
FROM p JOIN c USING (ticker)
       LEFT JOIN y USING (ticker) LEFT JOIN v USING (ticker) LEFT JOIN s USING (ticker)
"""


def _num(v):
    """Decimal/None/数値 → float | None（NaN は None 扱い）。"""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f


def _pct(numer, denom, digits=2):
    """(numer/denom - 1) * 100。denom が None/0 なら None。"""
    a, b = _num(numer), _num(denom)
    if a is None or not b:
        return None
    return round((a / b - 1) * 100, digits)


def _normalize_spark(closes):
    """終値配列 → 0..100 の整数配列（形だけを送る＝転送量を抑える）。全点同値は 50 で水平線。"""
    vals = [f for f in (_num(c) for c in (closes or [])) if f is not None]
    if len(vals) < 2:
        return None
    lo, hi = min(vals), max(vals)
    if hi == lo:
        return [50] * len(vals)
    return [round((v - lo) / (hi - lo) * 100) for v in vals]


def _px_row(row):
    """価格集計1行 → px dict。履歴が足りない銘柄は None（部分 null の px を作らない）。"""
    (_ticker, last, last_date, prev, base5, last_vol, avg20, hi52, lo52, spark, n) = row
    last = _num(last)
    if last is None or (n or 0) < _PX_MIN_ROWS:
        return None
    avg20_f = _num(avg20)
    vol = _num(last_vol)
    hi, lo = _num(hi52), _num(lo52)
    has_52w = (n or 0) >= _PX_MIN_52W_ROWS and hi is not None and lo is not None
    if has_52w:
        span = hi - lo
        pos52 = 50 if span == 0 else round((last - lo) / span * 100)
        dh = 0.0 if hi == 0 else round((last / hi - 1) * 100, 2)
    else:
        pos52 = dh = None
    return {
        "last": round(last, 2),
        "date": last_date.isoformat() if last_date is not None else None,
        "c1": _pct(last, prev),
        "c5": _pct(last, base5),
        "vr": None if (not avg20_f or vol is None) else round(vol / avg20_f, 2),
        "dh": dh,
        "hi52": round(hi, 2) if has_52w else None,
        "lo52": round(lo, 2) if has_52w else None,
        "pos52": pos52,
        "spark": _normalize_spark(spark),
    }


def _market_of(ticker, entry):
    """JP/US 判定。cross-section-rules.js の _market() と同一規約（country 優先・末尾 .T で JP）。"""
    country = (entry or {}).get("country")
    if country:
        return country
    return "JP" if str(ticker).endswith(".T") else "US"


def _market_asof(stocks):
    """市場ごとの最新終値日 {"JP": "2026-08-20", "US": "2026-08-21"}（ISO 文字列は辞書順=日付順）。"""
    asof = {}
    for ticker, entry in (stocks or {}).items():
        px = (entry or {}).get("px")
        date = (px or {}).get("date")
        if not date:
            continue
        market = _market_of(ticker, entry)
        if date > asof.get(market, ""):
            asof[market] = date
    return asof


def _conn():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg.connect(url)


def fetch_list() -> dict:
    """STOCK_DATA 互換の軽量辞書 + データ最終更新日時を {stocks, updated_at} で返す。

    updated_at は ticker_master.updated_at の最大値（ETL upsert が now() を入れる＝最終同期時刻）を
    JST "YYYY-MM-DD HH:MM" で整形。値が無ければ空文字（フロントはバッジ非表示にフォールバック）。
    """
    out: dict[str, dict] = {}
    updated_at = ""
    px_error = False
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT ticker, company_name, industry, currency, country, type, "
            "market_cap, per, pbr FROM market.ticker_master"
        )
        for (ticker, name, industry, currency, country, typ,
             mcap, per, pbr) in cur.fetchall():
            out[ticker] = {
                "company_name": name,
                "industry": industry,
                "currency": currency,
                "country": country,
                "type": typ,
                "marketCap": mcap if mcap is not None else 0,
                "per": per if per is not None else 0,
                "pbr": pbr if pbr is not None else 0,
                "prices": [],            # 遅延ハイドレートまで空（grid は prices を読まない）
                "financials_trend": {},  # 直近3期だけ下で詰める（ETFは空のまま）
            }

        # 各銘柄の直近3会計年度のみ（grid の最新KPI＋3期売上スパークライン用）
        cur.execute(
            "SELECT ticker, fiscal_year, "
            + ", ".join(_GRID_FIN_FIELDS) + " FROM ("
            "  SELECT *, ROW_NUMBER() OVER "
            "    (PARTITION BY ticker ORDER BY fiscal_year DESC) AS rn"
            "  FROM market.financials_annual"
            ") t WHERE rn <= 3"
        )
        for row in cur.fetchall():
            ticker, fy = row[0], row[1]
            entry = out.get(ticker)
            if entry is None:
                continue
            year_obj = {f: v for f, v in zip(_GRID_FIN_FIELDS, row[2:]) if v is not None}
            year_obj["year"] = fy
            entry["financials_trend"][str(fy)] = year_obj

        # データ最終更新日時（ETL の ON CONFLICT DO UPDATE SET updated_at=now() で前進する）
        cur.execute("SELECT MAX(updated_at) FROM market.ticker_master")
        row = cur.fetchone()
        if row and row[0] is not None:
            updated_at = row[0].astimezone(_JST).strftime("%Y-%m-%d %H:%M")

        # W1: 価格集計。⚠ ここが落ちても list 本体（財務一覧）は 200 で返す＝
        #     価格が取れないだけでアプリ全体が白画面になるのは退行。
        try:
            cur.execute(_PX_SQL)
            for px_row in cur.fetchall():
                entry = out.get(px_row[0])
                if entry is None:
                    continue
                px = _px_row(px_row)
                if px is not None:
                    entry["px"] = px
        except Exception:  # noqa: BLE001
            px_error = True
            try:
                conn.rollback()      # 失敗した transaction を畳んでから抜ける
            except Exception:        # noqa: BLE001
                pass
    return {
        "stocks": out,
        "updated_at": updated_at,
        "market_asof": {} if px_error else _market_asof(out),
        "px_error": px_error,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            self._json(200, fetch_list())
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _json(self, status: int, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
