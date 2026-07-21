"""GET /api/me/investment — 司令室の投資スナップショット（投資台帳の素データ）。認証必須・読取専用。

→ {"investment": [ {period, invest_cash_flow, principal_core_delta, principal_sat_delta,
                    realized_gain, is_complete, holdings, pulled_at,
                    nisa_tsumitate_delta, nisa_growth_delta,
                    nisa_tsumitate_sold_at_cost, nisa_growth_sold_at_cost}, ... ]}
（NISA 4列は B#3 Stage3・per-period delta。nisaLedgerFold が年別に畳んで NISA 枠導出の入力にする。）
業務 math は持たない（元本/実現益/investable の算出は money-rules.js investmentDerived が担う＝単一源）。
書込は ETL（GitHub Actions / scripts/etl_investment.py）のみ＝この endpoint に PUT は無い（state.py の LWW 同期に乗せない）。
セッション無効は 401。テーブル未適用/読取失敗は investment:[] で degrade（保有ゼロ/未配線でも UI/Mode A は investable=0 で正常）。
cashflow.py と同形・別ファイル＝投資読取失敗が収支/中核 sync を巻き込まない（故障隔離・D1）。
"""
from http.server import BaseHTTPRequestHandler
from decimal import Decimal
import hashlib
import json
import os
import sys

import psycopg
from psycopg import errors as pg_errors

COOKIE = "wc_session"
MAX_MONTHS = 120  # 直近10年分（月次・元本累積は全期間だが payload を抑制）

COLUMNS = ("period", "invest_cash_flow", "principal_core_delta", "principal_sat_delta",
           "realized_gain", "is_complete", "holdings", "pulled_at",
           # B#3 Stage3: NISA 枠別 per-period delta（nisaLedgerFold の入力・業務 math はここに持たない）。
           "nisa_tsumitate_delta", "nisa_growth_delta",
           "nisa_tsumitate_sold_at_cost", "nisa_growth_sold_at_cost")


def _conn():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg.connect(url)


def _cookie_token(headers, name=COOKIE):
    cookie = headers.get("Cookie", "") or ""
    for part in cookie.split(";"):
        p = part.strip()
        if p.startswith(name + "="):
            return p[len(name) + 1:]
    return None


def _valid_session(cur, token) -> bool:
    if not token:
        return False
    cur.execute(
        "SELECT 1 FROM me.sessions WHERE token = %s AND expires_at > now()",
        (hashlib.sha256(token.encode("utf-8")).hexdigest(),),
    )
    return cur.fetchone() is not None


def _num(v):
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v


def _row_to_dict(rec):
    """COLUMNS 順の tuple → dict。period/pulled_at は isoformat、Decimal は int/float へ。"""
    out = {}
    for name, val in zip(COLUMNS, rec):
        if name in ("period", "pulled_at"):
            out[name] = val.isoformat() if hasattr(val, "isoformat") else val
        else:
            out[name] = _num(val)
    return out


def _read_snapshots(cur):
    """me.investment_snapshots を読み (rows, schema_ok) を返す。例外は投げない。

    schema_ok=True  → 列/テーブルが存在（rows が空でも「本当にデータ 0 件」＝正常）。
    schema_ok=False → UndefinedColumn/UndefinedTable＝NISA 列 migration 未適用（silent 化せず可視化）。
    schema_ok=None  → その他の読取失敗（未知・degrade）。
    いずれも呼び出し側は 200 で degrade（空配列）を返せる。
    """
    try:
        cur.execute(
            "SELECT " + ", ".join(COLUMNS) + " FROM me.investment_snapshots "
            "ORDER BY period DESC LIMIT %s",
            (MAX_MONTHS,),
        )
        return [_row_to_dict(rec) for rec in cur.fetchall()], True
    except (pg_errors.UndefinedColumn, pg_errors.UndefinedTable) as e:
        print(f"me/investment schema not applied (migration pending): {e!r}", file=sys.stderr)
        return [], False
    except Exception as e:  # noqa: BLE001
        print(f"me/investment read degraded: {e!r}", file=sys.stderr)
        return [], None


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        token = _cookie_token(self.headers)
        try:
            with _conn() as conn, conn.cursor() as cur:
                if not _valid_session(cur, token):
                    return self._json(401, {"error": "unauthorized"})
                # 列/テーブル不在（migration 未適用）・読取失敗・0 件を _read_snapshots が分類し
                # schemaOk で可視化（false=migration 未適用の silent degrade を露出）。
                rows, schema_ok = _read_snapshots(cur)
                return self._json(200, {"investment": rows, "schemaOk": schema_ok})
        except Exception as e:  # noqa: BLE001
            print(f"me/investment do_GET error: {e!r}", file=sys.stderr)
            return self._json(500, {"error": "internal"})

    def _json(self, status: int, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
