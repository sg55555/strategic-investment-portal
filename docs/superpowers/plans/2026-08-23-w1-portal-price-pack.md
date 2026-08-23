# W1「ポータル一目パック」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ポータル（銘柄一覧）に価格・値動きの次元を入れ、「今日どれが動いたか」「52週高値に近いのはどれか」から知らない銘柄を発掘できるようにする。

**Architecture:** `market.ohlcv`（既存・292銘柄 235万行）から**発掘4点セット＋30日スパークライン**を `api/market/list.py` の1クエリで集計し、既存の `list` レスポンスに `px` として同梱する（新エンドポイントなし＝Vercel 関数は 11/12 のまま）。クライアントは新設の純関数レイヤ `portal-price-rules.js`（DOM 非依存 UMD）を通して、**案① 発掘ストリップ**（表の上・4タブ・上位12件）と**案② 値動きモード**（[財務]/[値動き] トグル・業種セクションを畳んだ1枚表・列ヘッダで横断ソート）を描画する。数値計算はサーバ側だけで行い、JS は表示整形と並べ替えのみ＝**JS↔Py の鏡像パリティ義務を新設しない**。

**Tech Stack:** Vanilla JS（classic script・UMD rules 層）／Python 3.12 + psycopg3（Vercel Python zero-config）／Neon Postgres／node:test（node --test）／pytest／Playwright（構造スモーク）

**Spec:** `docs/superpowers/specs/2026-08-23-w1-portal-price-pack-design.md`

## Global Constraints

- **Vercel 関数は 11/12 使用中＝新規 API ファイルを作らない**（`api/**/*.py` に `class handler` を増やさない）。
- **`api/market/list.py` の `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` は変更しない**。
- **`root requirements.txt` に依存を足さない**（全関数が bloat する。標準ライブラリ＋既存 psycopg のみ）。
- **`.portal-table` のレスポンシブ列非表示（`td:nth-child(N)`／≤1024px:4,9,10 ／≤768px:3,5,7 ／≤480px:1 ／≤375px:first-child）には手を触れない。** 値動き表は `portal-table` クラスを**付けず** `.portal-px-table` 単独にする。
- **inline `onclick` を新規に書かない**（既存 `#rk-table` と同じく委譲リスナー＋`data-*` 属性。inline handler は esc() を貫通する latent XSS）。
- **文字サイズの床は 12px**（テーマA）。**グロー 14px 未満は使わない**。
- **文言は中立語のみ**：「値上がり／値下がり／出来高急増／52週高値に接近」。**推奨・買い時・狙い目・注目・シグナル等の指示的語を使わない**。各面に免責1行を置く。
- **サーバ由来文字列（社名/業種）は必ず `esc()` を通す**。
- **既存テストを1件も落とさない**：node 357 pass／pytest 228 pass が下限。
- **payload 上限**: `/api/market/list` の gzip サイズ **≤ 60KB**（実測 54.6KB）。
- 触ってはいけない領域（本 wave 非接触）：`money*.js/css`・`detail*.js/css`・`cross-section-rules.js`・`#ranking` 画面・`finance-rules.js`。

## File Structure

| ファイル | 役割 | 変更 |
|----------|------|------|
| `api/market/list.py` | list API。既存の master/financials に加え、価格集計 `px` と `market_asof` を返す | 変更（追記のみ・既存フィールドは不変） |
| `portal-price-rules.js` | **新規**。価格表示の純関数（鮮度判定・ランキング・列定義・SVG幾何・整形）。DOM 非依存 UMD | 新規 |
| `dataClient.js` | `market_asof` / `px_error` をグローバルへ受け渡す | 変更（3行） |
| `index.html` | ストリップ host・値動き表・トグル・CSS・script 読み込み | 変更 |
| `tests/test_market_list_px.py` | **新規**。`_px_row` 等の純関数 pytest | 新規 |
| `tests/portal-price-rules.test.js` | **新規**。rules 層の node テスト | 新規 |
| `scratchpad/w1-smoke.js` | 構造スモーク（モック用 → 本実装用に改訂） | 変更 |
| `scratchpad/w1-payload-check.py` | **新規**。list payload の gzip サイズ回帰 | 新規 |
| `.claude/CLAUDE.md` | 恒久運用注意の追記 | 変更 |

**依存順**: Task 1（サーバ）→ Task 2（rules 層）→ Task 3（ストリップ）→ Task 4（値動きモード）→ Task 5（検証と記録）。Task 1 と Task 2 は互いに独立なので並行可。Task 3/4 は Task 2 に依存する。

---

### Task 1: サーバ — `list.py` に価格集計 `px` と `market_asof` を追加

**Files:**
- Modify: `api/market/list.py`（現状 106 行・`fetch_list()` は 30-82 行）
- Test: `tests/test_market_list_px.py`（新規）

**Interfaces:**
- Consumes: `market.ohlcv(ticker, date, open, high, low, close, volume)`（既存テーブル・インデックス `ohlcv_pkey(ticker,date)` / `idx_ohlcv_ticker_date(ticker,date DESC)` 済）
- Produces:
  - `_px_row(row: tuple) -> dict | None` — row = `(ticker, last, last_date, prev, base5, last_vol, avg20, hi52, lo52, spark_list, n_rows)`。返す dict のキーは `last, date, c1, c5, vr, dh, hi52, lo52, pos52, spark`
  - `_normalize_spark(closes: list) -> list[int] | None`
  - `_market_of(ticker: str, entry: dict) -> "JP" | "US"`
  - `_market_asof(stocks: dict) -> dict[str, str]`
  - `fetch_list()` の戻り値に `market_asof: dict`, `px_error: bool` が増え、各銘柄に `px`（履歴不足なら欠落）が付く

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_market_list_px.py` を新規作成：

```python
"""W1 ポータル一目パック — list.py の価格集計 純関数テスト（DB 非依存）。

_px_row / _normalize_spark / _market_of / _market_asof のみを検証する。
SQL 自体は別レーン（実 DB での疎通は scratchpad/w1-payload-check.py）。
pytest でも `python tests/test_market_list_px.py` 直実行でも動く。
"""
import datetime
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location(
    "market_list", os.path.join(ROOT, "api", "market", "list.py"))
market_list = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(market_list)

D = datetime.date(2026, 8, 21)


def _row(**kw):
    """(ticker,last,last_date,prev,base5,last_vol,avg20,hi52,lo52,spark,n) の既定行。"""
    base = dict(ticker="AAA", last=110.0, last_date=D, prev=100.0, base5=100.0,
                last_vol=2_000_000, avg20=1_000_000.0, hi52=120.0, lo52=80.0,
                spark=[100.0, 105.0, 110.0], n=300)
    base.update(kw)
    return (base["ticker"], base["last"], base["last_date"], base["prev"], base["base5"],
            base["last_vol"], base["avg20"], base["hi52"], base["lo52"], base["spark"], base["n"])


def test_px_row_basic():
    px = market_list._px_row(_row())
    assert px["last"] == 110.0
    assert px["date"] == "2026-08-21"
    assert px["c1"] == 10.0          # 110/100 - 1
    assert px["c5"] == 10.0
    assert px["vr"] == 2.0           # 2,000,000 / 1,000,000
    assert px["dh"] == -8.33         # 110/120 - 1 = -8.333...
    assert px["hi52"] == 120.0 and px["lo52"] == 80.0
    assert px["pos52"] == 75         # (110-80)/(120-80)


def test_px_row_returns_none_when_history_too_short():
    assert market_list._px_row(_row(n=5)) is None


def test_px_row_52w_fields_null_when_window_too_small():
    px = market_list._px_row(_row(n=59))
    assert px is not None
    assert px["hi52"] is None and px["lo52"] is None
    assert px["dh"] is None and px["pos52"] is None
    assert px["c1"] == 10.0          # 52週系以外は出る


def test_px_row_null_denominators():
    assert market_list._px_row(_row(prev=0))["c1"] is None
    assert market_list._px_row(_row(prev=None))["c1"] is None
    assert market_list._px_row(_row(base5=0))["c5"] is None
    assert market_list._px_row(_row(avg20=0))["vr"] is None
    assert market_list._px_row(_row(avg20=None))["vr"] is None


def test_px_row_flat_52w_range():
    px = market_list._px_row(_row(last=100.0, hi52=100.0, lo52=100.0))
    assert px["pos52"] == 50         # hi==lo は中央に置く
    assert px["dh"] == 0.0


def test_normalize_spark_endpoints_and_flat():
    assert market_list._normalize_spark([10.0, 20.0, 15.0]) == [0, 100, 50]
    assert market_list._normalize_spark([7.0, 7.0, 7.0]) == [50, 50, 50]
    assert market_list._normalize_spark([1.0]) is None
    assert market_list._normalize_spark([]) is None


def test_market_of_prefers_country_then_suffix():
    assert market_list._market_of("7203.T", {"country": "JP"}) == "JP"
    assert market_list._market_of("AAPL", {"country": "US"}) == "US"
    assert market_list._market_of("7203.T", {}) == "JP"      # country 欠落は末尾 .T
    assert market_list._market_of("AAPL", {}) == "US"


def test_market_asof_takes_max_date_per_market():
    stocks = {
        "7203.T": {"country": "JP", "px": {"date": "2026-08-20"}},
        "6758.T": {"country": "JP", "px": {"date": "2026-08-19"}},
        "AAPL": {"country": "US", "px": {"date": "2026-08-21"}},
        "EA": {"country": "US", "px": {"date": "2026-08-10"}},
        "NOPX": {"country": "US"},                            # px 無しは無視
    }
    assert market_list._market_asof(stocks) == {"JP": "2026-08-20", "US": "2026-08-21"}


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
```

- [ ] **Step 2: テストを走らせて落ちることを確認**

Run: `.venv/bin/python -m pytest tests/test_market_list_px.py -v`
Expected: FAIL（`AttributeError: module 'market_list' has no attribute '_px_row'`）

- [ ] **Step 3: `list.py` に純関数と SQL を実装**

`api/market/list.py` の `_GRID_FIN_FIELDS` 定義（16-20行）の直後に追記：

```python
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `.venv/bin/python -m pytest tests/test_market_list_px.py -v`
Expected: PASS（9 tests）

- [ ] **Step 5: `fetch_list()` に結線（劣化つき）**

`api/market/list.py` の `fetch_list()` 末尾（現 78-82 行の `updated_at` 取得〜`return`）を次のように置き換える：

```python
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
```

同じ関数の冒頭（`out: dict[str, dict] = {}` の隣・現 34-35 行）に `px_error = False` を追加する。

- [ ] **Step 6: 実 DB で疎通と所要時間を確認**

Run:
```
.venv/bin/python -c "
import importlib.util, os, time, json, gzip
for line in open('.env', encoding='utf-8'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1); os.environ.setdefault(k.strip(), v.strip().strip('\"').strip(\"'\"))
s = importlib.util.spec_from_file_location('m', 'api/market/list.py'); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
t0 = time.time(); d = m.fetch_list(); dt = (time.time()-t0)*1000
b = json.dumps(d, ensure_ascii=False, separators=(',',':')).encode()
n = sum(1 for e in d['stocks'].values() if 'px' in e)
print(f'{dt:.0f}ms  px={n}/{len(d[\"stocks\"])}  asof={d[\"market_asof\"]}  px_error={d[\"px_error\"]}  gzip={len(gzip.compress(b))/1024:.1f}KB')
"
```
Expected: `1000〜2500ms  px=292/292  asof={'JP': ..., 'US': ...}  px_error=False  gzip=54〜56KB`（コールド時は初回のみ大幅に遅い＝2回走らせて2回目を見る）

- [ ] **Step 7: 既存 pytest が全部通ることを確認**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: 既存 228 + 新規 9 = 237 passed

- [ ] **Step 8: コミット**

```bash
git add api/market/list.py tests/test_market_list_px.py
git commit -m "feat(list): 価格集計 px と market_asof を list API に同梱（400日境界SQL・失敗時は劣化）"
```

---

### Task 2: 純関数レイヤ `portal-price-rules.js`

**Files:**
- Create: `portal-price-rules.js`
- Create: `tests/portal-price-rules.test.js`
- Modify: `index.html:1600` の直後（`<script src="screener-rules.js"></script>` の次の行）に `<script src="portal-price-rules.js"></script>` を追加

**Interfaces:**
- Consumes: Task 1 の `px` 形（`{last, date, c1, c5, vr, dh, hi52, lo52, pos52, spark}`）と `market_asof`
- Produces（`window.PortalPriceRules` / CommonJS 両対応）:
  - `PRICE_KEYS: {last:1, c1:1, c5:1, vr:1, pos52:1}`
  - `TABS: [{key,label,metric,dir}]`（`gain|lose|vol|high`）
  - `marketOf(ticker, raw) -> "JP"|"US"`
  - `isStale(px, marketAsof, market) -> boolean`
  - `rankTop(items, tabKey, n, marketAsof) -> {rows: item[], excludedStale: number}`
  - `priceColumns(isNarrow) -> [{key,label,width,sortable}]`
  - `sparkGeometry(spark, w, h) -> {points: string, area: string} | null`
  - `fmtSigned(v, digits, unit) -> string`
  - `fmtVolRatio(vr) -> string`
  - `fmtDistHigh(dh) -> string`
  - `clampPos(pos) -> number`（0-100 に収める。null は 0 でなく null）

- [ ] **Step 1: 失敗するテストを書く**

`tests/portal-price-rules.test.js` を新規作成：

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../portal-price-rules.js");

const ASOF = { JP: "2026-08-20", US: "2026-08-21" };
function item(ticker, px, market) {
  return { ticker: ticker, name: ticker, market: market || (ticker.endsWith(".T") ? "JP" : "US"), px: px };
}
function px(o) {
  return Object.assign({ last: 100, date: "2026-08-21", c1: 1, c5: 1, vr: 1, dh: -5, hi52: 120, lo52: 80, pos52: 50, spark: [0, 50, 100] }, o);
}

test("isStale: 同日は false・自市場より古い日は true・px 無しは false", () => {
  assert.equal(R.isStale(px({ date: "2026-08-21" }), ASOF, "US"), false);
  assert.equal(R.isStale(px({ date: "2026-08-10" }), ASOF, "US"), true);
  assert.equal(R.isStale(px({ date: "2026-08-20" }), ASOF, "JP"), false);  // JP の最新は 8/20
  assert.equal(R.isStale(px({ date: "2026-08-20" }), ASOF, "US"), true);   // US では古い
  assert.equal(R.isStale(null, ASOF, "US"), false);                        // データ無しは stale ではない
  assert.equal(R.isStale(px({}), {}, "US"), false);                        // asof 不明なら判定しない
});

test("marketOf: country 優先・欠落時は末尾 .T で JP", () => {
  assert.equal(R.marketOf("7203.T", { country: "JP" }), "JP");
  assert.equal(R.marketOf("AAPL", {}), "US");
  assert.equal(R.marketOf("7203.T", {}), "JP");
});

test("rankTop(gain): c1 降順・上位N・stale 除外を件数で返す", () => {
  const items = [
    item("A", px({ c1: 5 })), item("B", px({ c1: 9 })),
    item("EA", px({ c1: 99, date: "2026-08-10" })),   // stale
    item("C", px({ c1: 7 })),
  ];
  const r = R.rankTop(items, "gain", 2, ASOF);
  assert.deepEqual(r.rows.map((x) => x.ticker), ["B", "C"]);
  assert.equal(r.excludedStale, 1);
});

test("rankTop(lose): c1 昇順", () => {
  const items = [item("A", px({ c1: -1 })), item("B", px({ c1: -8 })), item("C", px({ c1: 3 }))];
  assert.deepEqual(R.rankTop(items, "lose", 3, ASOF).rows.map((x) => x.ticker), ["B", "A", "C"]);
});

test("rankTop(high): dh は 0 に近い順（高値更新=0 が先頭）", () => {
  const items = [item("A", px({ dh: -12 })), item("B", px({ dh: 0 })), item("C", px({ dh: -3 }))];
  assert.deepEqual(R.rankTop(items, "high", 3, ASOF).rows.map((x) => x.ticker), ["B", "C", "A"]);
});

test("rankTop: 指標が null / px 無しの銘柄は落とす", () => {
  const items = [item("A", px({ vr: null })), item("B", null), item("C", px({ vr: 3 }))];
  const r = R.rankTop(items, "vol", 5, ASOF);
  assert.deepEqual(r.rows.map((x) => x.ticker), ["C"]);
  assert.equal(r.excludedStale, 0);
});

test("rankTop: 同値は ticker 昇順で安定（描画のたびに順序が変わらない）", () => {
  const items = [item("ZZZ", px({ c1: 4 })), item("AAA", px({ c1: 4 })), item("MMM", px({ c1: 4 }))];
  assert.deepEqual(R.rankTop(items, "gain", 3, ASOF).rows.map((x) => x.ticker), ["AAA", "MMM", "ZZZ"]);
});

test("priceColumns: wide は8列・narrow は4列・spark はソート不可", () => {
  const wide = R.priceColumns(false), narrow = R.priceColumns(true);
  assert.deepEqual(wide.map((c) => c.key), ["ticker", "name", "last", "c1", "c5", "vr", "pos52", "spark"]);
  assert.deepEqual(narrow.map((c) => c.key), ["name", "last", "c1", "spark"]);
  assert.equal(wide[wide.length - 1].sortable, false);
  assert.equal(narrow[0].sortable, true);
});

test("sparkGeometry: 点数分の座標を返す・平坦データは水平線・2点未満は null", () => {
  const g = R.sparkGeometry([0, 100], 100, 20);
  assert.equal(g.points.split(" ").length, 2);
  assert.match(g.area, /^M/);
  const flat = R.sparkGeometry([50, 50, 50], 100, 20);
  const ys = flat.points.split(" ").map((p) => Number(p.split(",")[1]));
  assert.equal(new Set(ys).size, 1);            // 全部同じ y = 水平
  assert.equal(R.sparkGeometry([1], 100, 20), null);
  assert.equal(R.sparkGeometry(null, 100, 20), null);
});

test("fmt*: null は -- ・正の値に + が付く・単位が付く", () => {
  assert.equal(R.fmtSigned(1.234, 2, "%"), "+1.23%");
  assert.equal(R.fmtSigned(-1.2, 1, "%"), "-1.2%");
  assert.equal(R.fmtSigned(null, 2, "%"), "--");
  assert.equal(R.fmtVolRatio(2.415), "2.42倍");
  assert.equal(R.fmtVolRatio(null), "--");
  assert.equal(R.fmtDistHigh(0), "高値更新");
  assert.equal(R.fmtDistHigh(-3.14), "高値まで 3.1%");
  assert.equal(R.fmtDistHigh(null), "--");
});

test("clampPos: 0-100 に収める・null は null", () => {
  assert.equal(R.clampPos(-5), 0);
  assert.equal(R.clampPos(140), 100);
  assert.equal(R.clampPos(42), 42);
  assert.equal(R.clampPos(null), null);
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認**

Run: `node --test tests/portal-price-rules.test.js`
Expected: FAIL（`Cannot find module '../portal-price-rules.js'`）

- [ ] **Step 3: `portal-price-rules.js` を実装**

```javascript
// portal-price-rules.js — ポータルの価格表示レイヤの純関数（DOM非依存・副作用なし）。
// 数値の算出はサーバ(api/market/list.py)側だけで行い、ここは「並べ替え・鮮度判定・列定義・
// 幾何・整形」だけを持つ＝JS↔Py の鏡像パリティ義務を作らない（意図的な設計・spec D9）。
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PortalPriceRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 値動きモードのソートキー集合。モード切替のキー整合と NULL_LAST_KEYS 拡張に使う。
  var PRICE_KEYS = { last: 1, c1: 1, c5: 1, vr: 1, pos52: 1 };

  // 発掘タブ。dir=desc は降順。high は dh(=52週高値からの距離・0以下)の降順＝0に近い順。
  var TABS = [
    { key: "gain", label: "値上がり", metric: "c1", dir: "desc" },
    { key: "lose", label: "値下がり", metric: "c1", dir: "asc" },
    { key: "vol", label: "出来高急増", metric: "vr", dir: "desc" },
    { key: "high", label: "52週高値に接近", metric: "dh", dir: "desc" },
  ];
  var TAB_BY_KEY = {};
  TABS.forEach(function (t) { TAB_BY_KEY[t.key] = t; });

  function _fin(v) { return typeof v === "number" && isFinite(v); }

  function marketOf(ticker, raw) {
    var country = (raw || {}).country;
    if (country) return country;
    return String(ticker).slice(-2) === ".T" ? "JP" : "US";
  }

  // px.date が自市場の最新終値日より前なら stale。px 無し・asof 不明のときは判定しない(false)。
  function isStale(px, marketAsof, market) {
    if (!px || !px.date) return false;
    var asof = (marketAsof || {})[market];
    return !!asof && px.date < asof;
  }

  // items = [{ticker, market, px, ...}]。tabKey のタブ定義で並べ替え、上位 n 件を返す。
  // 除外: px 無し / 指標が非有限 / stale。同値は ticker 昇順で安定化（再描画で順序が揺れない）。
  function rankTop(items, tabKey, n, marketAsof) {
    var tab = TAB_BY_KEY[tabKey] || TABS[0];
    var excludedStale = 0;
    var rows = (items || []).filter(function (it) {
      var px = it && it.px;
      if (!px || !_fin(px[tab.metric])) return false;
      if (isStale(px, marketAsof, it.market || marketOf(it.ticker, it))) { excludedStale++; return false; }
      return true;
    });
    rows.sort(function (a, b) {
      var va = a.px[tab.metric], vb = b.px[tab.metric];
      if (va !== vb) return tab.dir === "asc" ? va - vb : vb - va;
      return String(a.ticker) < String(b.ticker) ? -1 : (String(a.ticker) > String(b.ticker) ? 1 : 0);
    });
    return { rows: rows.slice(0, n), excludedStale: excludedStale };
  }

  // 値動き表の列定義（描画・テスト・受入の単一源）。
  // ⚠ .portal-table の nth-child 列非表示には依存しない＝列セットごと差し替える方式。
  var COLS_WIDE = [
    { key: "ticker", label: "コード", width: "8%", sortable: true },
    { key: "name", label: "企業名", width: "26%", sortable: true },
    { key: "last", label: "終値", width: "11%", sortable: true },
    { key: "c1", label: "前日比", width: "11%", sortable: true },
    { key: "c5", label: "5日", width: "10%", sortable: true },
    { key: "vr", label: "出来高倍率", width: "11%", sortable: true },
    { key: "pos52", label: "52週レンジ", width: "13%", sortable: true },
    { key: "spark", label: "30日", width: "10%", sortable: false },
  ];
  var COLS_NARROW = [
    { key: "name", label: "銘柄", width: "44%", sortable: true },
    { key: "last", label: "終値", width: "20%", sortable: true },
    { key: "c1", label: "前日比", width: "20%", sortable: true },
    { key: "spark", label: "30日", width: "16%", sortable: false },
  ];
  function priceColumns(isNarrow) { return isNarrow ? COLS_NARROW : COLS_WIDE; }

  // 0-100 の正規化 spark → SVG の polyline points と塗り path。幾何の正規化のみ（業務math非該当）。
  function sparkGeometry(spark, w, h) {
    if (!spark || spark.length < 2) return null;
    var pad = 2, n = spark.length, dx = (w - pad * 2) / (n - 1), pts = [];
    for (var i = 0; i < n; i++) {
      var y = pad + (100 - spark[i]) / 100 * (h - pad * 2);
      pts.push((pad + i * dx).toFixed(1) + "," + y.toFixed(1));
    }
    var points = pts.join(" ");
    var area = "M" + pts[0] + " L" + points.split(" ").join(" L") +
      " L" + (w - pad).toFixed(1) + "," + (h - pad) + " L" + pad + "," + (h - pad) + " Z";
    return { points: points, area: area };
  }

  function fmtSigned(v, digits, unit) {
    if (!_fin(v)) return "--";
    return (v > 0 ? "+" : "") + v.toFixed(digits == null ? 2 : digits) + (unit || "");
  }
  function fmtVolRatio(vr) { return _fin(vr) ? vr.toFixed(2) + "倍" : "--"; }
  function fmtDistHigh(dh) {
    if (!_fin(dh)) return "--";
    return dh >= 0 ? "高値更新" : "高値まで " + Math.abs(dh).toFixed(1) + "%";
  }
  function clampPos(pos) { return _fin(pos) ? Math.max(0, Math.min(100, pos)) : null; }

  return {
    PRICE_KEYS: PRICE_KEYS, TABS: TABS, marketOf: marketOf, isStale: isStale,
    rankTop: rankTop, priceColumns: priceColumns, sparkGeometry: sparkGeometry,
    fmtSigned: fmtSigned, fmtVolRatio: fmtVolRatio, fmtDistHigh: fmtDistHigh, clampPos: clampPos,
  };
});
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/portal-price-rules.test.js`
Expected: PASS（11 tests）

- [ ] **Step 5: `index.html` に script を読み込む**

`index.html:1600` の `<script src="screener-rules.js"></script>` の直後に1行追加：

```html
    <script src="screener-rules.js"></script>
    <script src="portal-price-rules.js"></script>
    <script src="detail-rules.js"></script>
```

- [ ] **Step 6: 既存 node テストが全部通ることを確認**

Run: `node --test tests/`
Expected: 既存 357 + 新規 11 = 368 pass

- [ ] **Step 7: コミット**

```bash
git add portal-price-rules.js tests/portal-price-rules.test.js index.html
git commit -m "feat(rules): portal-price-rules.js 新設（鮮度/ランキング/列定義/幾何/整形の純関数）"
```

---

### Task 3: 案① 発掘ストリップ

**Files:**
- Modify: `dataClient.js`（`DATA_UPDATED_AT` の隣にグローバル2本を追加・`bootData()` 内で代入）
- Modify: `index.html`
  - `1180` 行 `<div id="portal-container"></div>` の直前に `<div id="portal-strip"></div>` を追加
  - inline `<style>`（`1019` 行 `</style>` の直前）にストリップ CSS を追加
  - IIFE 内（`filterAndRenderPortal` の近傍）に `renderPortalStrip()` とタブ状態を追加
  - `filterAndRenderPortal` の**2箇所**（0件 early-return の前・通常経路）で `renderPortalStrip(list)` を呼ぶ
- Test: `scratchpad/w1-smoke.js`（Task 5 で本実装向けに改訂・このタスクでは手動＋簡易確認）

**Interfaces:**
- Consumes: `PortalPriceRules.{TABS, rankTop, sparkGeometry, fmtSigned, fmtVolRatio, fmtDistHigh, marketOf}`、`STOCK_DATA[t].px`、`DATA_MARKET_ASOF`
- Produces: `renderPortalStrip(list)` — `filterAndRenderPortal` が作った**フィルタ適用後の item 配列**を受け取り `#portal-strip` を描き替える。item は `{ticker, name, currency, country, industry, px, ...}` を持つ（px の合流は Task 4 Step 3 で行うため、**このタスクでは `STOCK_DATA[item.ticker].px` を引く**）。

- [ ] **Step 1: `dataClient.js` に `market_asof` / `px_error` を受け渡す**

`dataClient.js:15-16` の宣言に2行追加し、`bootData()` の remote 分岐で代入する：

```javascript
let STOCK_DATA = {};
let DATA_UPDATED_AT = "";
let DATA_MARKET_ASOF = {};   // W1: 市場ごとの最新終値日 {"JP":"2026-08-20","US":"2026-08-21"}
let DATA_PX_ERROR = false;   // W1: 価格集計だけが失敗した（一覧は表示できる）
```

```javascript
    if (raw && raw.stocks) {
      STOCK_DATA = raw.stocks;
      DATA_UPDATED_AT = raw.updated_at || "";
      DATA_MARKET_ASOF = raw.market_asof || {};
      DATA_PX_ERROR = !!raw.px_error;
    } else {
```

- [ ] **Step 2: ストリップの CSS を追加**

`index.html` の `</style>`（1019行）直前に追加：

```css
      /* ── W1 発掘ストリップ ── */
      #portal-strip { margin: 0 0 18px; }
      #portal-strip:empty { display: none; }
      .pstrip-head { font-size: 12px; color: var(--ix-text-dim); margin: 0 0 8px; }
      .pstrip-head b { color: var(--ix-text); font-weight: 600; }
      .pstrip-panel { background: var(--ix-surface-panel); border: 1px solid var(--ix-border);
                      border-radius: 12px; padding: 12px 12px 14px; }
      .pstrip-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
      .pstrip-tab { font-size: 12px; padding: 7px 12px; min-height: 32px; border-radius: 999px;
                    cursor: pointer; background: transparent; color: var(--ix-text-dim);
                    border: 1px solid var(--ix-border-mid); font-family: inherit; }
      .pstrip-tab.active { color: var(--ix-text-hi); border-color: rgba(0, 229, 255, 0.45);
                           background: rgba(0, 229, 255, 0.08); }
      .pstrip-cards { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px;
                      scroll-snap-type: x proximity; }
      .pstrip-card { flex: 0 0 158px; scroll-snap-align: start; background: var(--ix-surface-chart);
                     border: 1px solid var(--ix-border); border-radius: 10px; padding: 9px 10px;
                     cursor: pointer; transition: border-color 0.15s, transform 0.15s; }
      .pstrip-card:hover { border-color: rgba(0, 229, 255, 0.4); transform: translateY(-2px); }
      .pstrip-card.row-busy { opacity: 0.55; }
      .pstrip-code { font-family: var(--ix-mono); font-size: 12px; color: var(--ix-cyan); letter-spacing: 0.04em; }
      .pstrip-name { font-size: 12px; color: var(--ix-text); white-space: nowrap; overflow: hidden;
                     text-overflow: ellipsis; margin: 2px 0 4px; }
      .pstrip-main { font-size: 17px; font-weight: 700; font-family: var(--ix-mono); line-height: 1.1; }
      .pstrip-sub { font-size: 12px; color: var(--ix-text-dim); font-family: var(--ix-mono); }
      .pstrip-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 6px; }
      .pstrip-note { font-size: 12px; color: var(--ix-slate); margin-top: 9px; line-height: 1.5; }
      .pstrip-empty { font-size: 12px; color: var(--ix-slate); padding: 10px 2px; }
      @media (max-width: 760px) { .pstrip-card { flex-basis: 142px; } }
```

- [ ] **Step 3: ストリップの host を置く**

`index.html:1180` を次のように変更：

```html
        <div id="portal-strip"></div>
        <div id="portal-container"></div>
```

- [ ] **Step 4: `renderPortalStrip()` を実装**

`index.html` の IIFE 内、`_makePortalSentinel()` の定義の直前（現 2233 行付近）に追加：

```javascript
      // ── W1 発掘ストリップ（表の上・4タブ・上位12件）──
      const PSTRIP_N = 12;
      let pstripTab = localStorage.getItem("sip_pstrip_tab") || "gain";

      function _pstripAsofLabel() {
        const a = (typeof DATA_MARKET_ASOF !== "undefined" && DATA_MARKET_ASOF) || {};
        const parts = [];
        if (a.JP) parts.push("日本株 " + a.JP.slice(5).replace("-", "/"));
        if (a.US) parts.push("米国株 " + a.US.slice(5).replace("-", "/"));
        return parts.length ? parts.join(" ／ ") + " 終値" : "終値";
      }

      function _pstripCard(it, tab) {
        const px = it.px;
        const tone = px.c1 > 0 ? "#00e676" : (px.c1 < 0 ? "#ff5c7a" : "var(--ix-slate)");
        let main = "", sub = "";
        if (tab.key === "vol") { main = PortalPriceRules.fmtVolRatio(px.vr); sub = "前日比 " + PortalPriceRules.fmtSigned(px.c1, 2, "%"); }
        else if (tab.key === "high") { main = PortalPriceRules.fmtDistHigh(px.dh); sub = "前日比 " + PortalPriceRules.fmtSigned(px.c1, 2, "%"); }
        else { main = PortalPriceRules.fmtSigned(px.c1, 2, "%"); sub = "5日 " + PortalPriceRules.fmtSigned(px.c5, 1, "%"); }
        const mainColor = (tab.key === "vol") ? (px.vr >= 1.5 ? "#ffca3a" : "var(--ix-text)")
          : (tab.key === "high") ? (px.dh >= -1 ? "#00e676" : "#ffca3a") : tone;
        const g = PortalPriceRules.sparkGeometry(px.spark, 136, 30);
        const svg = g ? `<svg width="136" height="30" viewBox="0 0 136 30" aria-hidden="true">
            <polyline points="${g.points}" fill="none" stroke="${tone}" stroke-width="1.4"
              stroke-linejoin="round" stroke-linecap="round"></polyline></svg>` : "";
        const price = px.last == null ? "--"
          : (it.currency === "USD" ? "$" : "¥") + (px.last >= 1000 ? Math.round(px.last).toLocaleString() : px.last.toFixed(2));
        return `<div class="pstrip-card" data-ticker="${esc(it.ticker)}">
            <div class="pstrip-code">${esc(it.ticker)}</div>
            <div class="pstrip-name" title="${esc(it.name)}">${esc(it.name)}</div>
            ${svg}
            <div class="pstrip-row"><div class="pstrip-main" style="color:${mainColor}">${main}</div>
              <div class="pstrip-sub">${price}</div></div>
            <div class="pstrip-sub">${sub}</div>
          </div>`;
      }

      // list = filterAndRenderPortal がフィルタ/スクリーニング後に作った item 配列（表と同じ母集合）。
      function renderPortalStrip(list) {
        const host = document.getElementById("portal-strip");
        if (!host) return;
        if (dataLoadState !== "ready") { host.innerHTML = ""; return; }
        if (typeof DATA_PX_ERROR !== "undefined" && DATA_PX_ERROR) {
          host.innerHTML = `<div class="pstrip-panel"><div class="pstrip-empty">値動きは一時的に取得できません（一覧は表示できます）。</div></div>`;
          return;
        }
        const asof = (typeof DATA_MARKET_ASOF !== "undefined" && DATA_MARKET_ASOF) || {};
        const items = (list || []).map((it) => ({
          ticker: it.ticker, name: it.name, currency: it.currency,
          market: PortalPriceRules.marketOf(it.ticker, it),
          px: (STOCK_DATA[it.ticker] || {}).px || null,
        }));
        const tab = PortalPriceRules.TABS.filter((t) => t.key === pstripTab)[0] || PortalPriceRules.TABS[0];
        const r = PortalPriceRules.rankTop(items, tab.key, PSTRIP_N, asof);
        const tabsHtml = PortalPriceRules.TABS.map((t) =>
          `<button type="button" class="pstrip-tab${t.key === tab.key ? " active" : ""}" data-tab="${t.key}">${esc(t.label)}</button>`).join("");
        const body = r.rows.length
          ? `<div class="pstrip-cards">${r.rows.map((it) => _pstripCard(it, tab)).join("")}</div>`
          : `<div class="pstrip-empty">該当する銘柄がありません</div>`;
        const staleNote = r.excludedStale
          ? `（${r.excludedStale}銘柄は価格が古いため除外）` : "";
        host.innerHTML = `
          <div class="pstrip-head">今日の動き　<b>${esc(_pstripAsofLabel())}</b>　/　${list.length}銘柄${esc(staleNote)}</div>
          <div class="pstrip-panel">
            <div class="pstrip-tabs">${tabsHtml}</div>
            ${body}
            <div class="pstrip-note">終値ベースの事実の並べ替えです（推奨・売買判断ではありません）。出来高倍率＝当日出来高 ÷ 直近20営業日平均。</div>
          </div>`;
      }

      // 委譲リスナー（inline onclick を作らない＝data-* は属性値として読むだけ）。1回だけ張る。
      function _initPortalStripDelegation() {
        const host = document.getElementById("portal-strip");
        if (!host || host.dataset.wired === "1") return;
        host.dataset.wired = "1";
        host.addEventListener("click", (e) => {
          const tabBtn = e.target.closest(".pstrip-tab");
          if (tabBtn && tabBtn.dataset.tab) {
            pstripTab = tabBtn.dataset.tab;
            localStorage.setItem("sip_pstrip_tab", pstripTab);
            filterAndRenderPortal();
            return;
          }
          const card = e.target.closest(".pstrip-card");
          if (card && card.dataset.ticker) navigateToDetail(card.dataset.ticker, card);
        });
      }
```

- [ ] **Step 5: `filterAndRenderPortal` から呼ぶ（0件経路も忘れずに）**

`index.html` の `filterAndRenderPortal` 内、**2箇所**に差し込む。

(a) 0件 early-return（現 2071-2076 行）の直前：

```javascript
        if (sectorOrder.length === 0) {
          renderPortalStrip(list);            // 0件でも見出し＋「該当なし」を出す
          const marketOn = screeningMarkets.length > 0;
```

(b) 窓化セットアップの直前（現 2078-2079 行の `const flat = [], sectorLen = {};` の直前）：

```javascript
        renderPortalStrip(list);
        // Plan 2: セクター束ね順にフラット化 → 先頭チャンク描画 → sentinel + IntersectionObserver で増分。
```

さらに `window.onload`（現 1926 行）の中、`filterAndRenderPortal()` を最初に呼ぶ箇所の**前**で `_initPortalStripDelegation();` を1回呼ぶ。

- [ ] **Step 6: モック鯖で実データ描画を確認**

Run:
```
.venv/bin/python scratchpad/w1-dump.py
```
Run（別ターミナル・この1行で1コマンド）:
```
W1_PORT=8210 .venv/bin/python scratchpad/w1-mock-server.py
```
Expected: `http://127.0.0.1:8210/` で 4タブのカードが12枚出る。**注意**: `w1-mock-server.py` は `w1-variants.js` を注入するモック用なので、本実装の確認では `scratchpad/mock_prod_server.py`（8200・注入なし）を使うか、`w1-mock-server.py` の `SCRIPT_TAG` 注入を外す。`/api/market/list` は dump JSON（`px` 入り）を返すので本実装のコードパスがそのまま動く。

- [ ] **Step 7: 構造をヘッドレスで確認**

Run: `NODE_PATH=/home/shugo/node_modules node -e "$(cat <<'EOF'
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://127.0.0.1:8210/", { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  console.log("cards", await p.locator(".pstrip-card").count(), "tabs", await p.locator(".pstrip-tab").count(), "errs", errs);
  await b.close();
})();
EOF
)"`
Expected: `cards 12 tabs 4 errs []`

- [ ] **Step 8: コミット**

```bash
git add dataClient.js index.html
git commit -m "feat(portal): 発掘ストリップ（4タブ・上位12件・stale 除外・委譲リスナー）"
```

---

### Task 4: 案② 値動きモード（トグル・1枚表・横断ソート）

**Files:**
- Modify: `index.html`
  - inline `<style>` に値動き表 CSS（`.portal-px-table` ほか）
  - `filterAndRenderPortal`: item に px フィールドを合流／px モードは業種束ねをスキップ
  - `NULL_LAST_KEYS` に価格キーを追加
  - `_renderPortalChunk`: 1枚表分岐
  - `_makePortalPriceSection()` / `_makePortalPriceRow(item)` を新設
  - モードトグルの描画と状態（`sip_portal_table_mode`）／`setSort` のキー整合
  - `Object.assign(window, {...})` に `setPortalTableMode` を追加（トグルは委譲リスナー経由なので公開は最小限）

**Interfaces:**
- Consumes: `PortalPriceRules.{priceColumns, PRICE_KEYS, sparkGeometry, fmtSigned, fmtVolRatio, fmtDistHigh, clampPos, isStale, marketOf}`、Task 3 の `DATA_MARKET_ASOF`
- Produces: `portalTableMode`（`"fin"|"px"`）、`setPortalTableMode(mode)`、`_makePortalPriceSection()`、`_makePortalPriceRow(item)`

- [ ] **Step 1: 値動き表の CSS を追加**

`index.html` の `</style>` 直前（Task 3 で足したストリップ CSS の後）に追加：

```css
      /* ── W1 値動きモード ── */
      .pmode-bar { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; flex-wrap: wrap; }
      .pmode-seg { display: inline-flex; border: 1px solid var(--ix-border-mid); border-radius: 999px; overflow: hidden; }
      .pmode-seg button { font-size: 12px; padding: 7px 14px; min-height: 32px; background: transparent;
                          color: var(--ix-text-dim); border: 0; cursor: pointer; font-family: inherit; }
      .pmode-seg button.active { background: rgba(0, 229, 255, 0.12); color: var(--ix-text-hi); }
      .pmode-hint { font-size: 12px; color: var(--ix-text-dim); }
      /* ⚠ .portal-table を付けない：既存の nth-child 列非表示（1024/768/480/375px）が別の列を消すため */
      table.portal-px-table { width: 100%; border-collapse: collapse; background: var(--ix-surface-panel);
                              border: 1px solid var(--ix-border-strong); border-radius: 2px; overflow: hidden; }
      table.portal-px-table th { position: sticky; top: 0; z-index: 2; background: var(--ix-surface-panel);
                                 font-size: 12px; color: var(--ix-text-dim); text-align: left; padding: 9px 8px;
                                 border-bottom: 1px solid var(--ix-border-strong); cursor: pointer; white-space: nowrap; }
      table.portal-px-table th.active-sort { color: var(--ix-cyan); }
      /* .sort-icon 自体は global だが、点灯色は .portal-table th.active-sort .sort-icon に scope されている */
      table.portal-px-table th.active-sort .sort-icon { color: var(--ix-cyan); opacity: 1; }
      table.portal-px-table td { padding: 8px; border-bottom: 1px solid rgba(20, 32, 43, 0.7);
                                 font-size: 13px; white-space: nowrap; }
      table.portal-px-table tbody tr:nth-child(even) { background: rgba(255, 255, 255, 0.012); }
      table.portal-px-table tbody tr:hover td { background: rgba(0, 229, 255, 0.04); cursor: pointer; }
      .pnum { font-family: var(--ix-mono); font-weight: 600; }
      .prangebar { position: relative; width: 84px; height: 6px; border-radius: 3px; background: #16222c; }
      .prangebar i { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--ix-cyan); border-radius: 1px; }
      .p52 { font-size: 12px; color: var(--ix-text-dim); font-family: var(--ix-mono); }
      .pstale { font-size: 12px; font-family: var(--ix-mono); color: #ffca3a; border: 1px solid rgba(255, 202, 58, 0.35);
                border-radius: 4px; padding: 0 4px; margin-left: 6px; }
      tr.is-stale td { opacity: 0.62; }
      @media (max-width: 760px) {
        table.portal-px-table th, table.portal-px-table td { padding: 8px 5px; }
        table.portal-px-table td .company-clickable { display: block; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
      }
```

- [ ] **Step 2: モード状態とトグル描画を追加**

`index.html` の IIFE 内・Task 3 の `renderPortalStrip` 群の直後に追加：

```javascript
      // ── W1 値動きモード ──
      const PORTAL_NARROW_MAX = 760;                 // この幅以下は列セットを絞る（4列）
      let portalTableMode = localStorage.getItem("sip_portal_table_mode") === "px" ? "px" : "fin";
      function _portalIsNarrow() { return window.innerWidth <= PORTAL_NARROW_MAX; }

      function setPortalTableMode(mode) {
        portalTableMode = (mode === "px") ? "px" : "fin";
        localStorage.setItem("sip_portal_table_mode", portalTableMode);
        // モードとソートキーの整合：値動きは前日比の降順で開き、財務へ戻す時はコード順へ戻す。
        if (portalTableMode === "px" && !PortalPriceRules.PRICE_KEYS[sortKey]) { setSort("c1"); return; }
        if (portalTableMode === "fin" && PortalPriceRules.PRICE_KEYS[sortKey]) { setSort("ticker"); return; }
        filterAndRenderPortal();
      }

      function renderPortalModeBar() {
        const host = document.getElementById("portal-modebar");
        if (!host) return;
        if (dataLoadState !== "ready" || (typeof DATA_PX_ERROR !== "undefined" && DATA_PX_ERROR)) { host.innerHTML = ""; return; }
        const px = portalTableMode === "px";
        host.innerHTML = `
          <div class="pmode-bar">
            <div class="pmode-seg">
              <button type="button" data-mode="fin" class="${px ? "" : "active"}">財務</button>
              <button type="button" data-mode="px" class="${px ? "active" : ""}">値動き</button>
            </div>
            <span class="pmode-hint">${px
              ? "値動きモード：業種セクションを畳んで1枚表にし、列ヘッダで全銘柄を横断して並べ替えます。"
              : "財務モード：業種セクションごとの財務指標一覧です。"}</span>
          </div>`;
        if (host.dataset.wired !== "1") {
          host.dataset.wired = "1";
          host.addEventListener("click", (e) => {
            const b = e.target.closest("button[data-mode]");
            if (b) setPortalTableMode(b.dataset.mode);
          });
        }
      }

      // 幅の閾値をまたいだら列セットが変わるので描き直す（またがない resize では何もしない）。
      let _portalWasNarrow = null;
      window.addEventListener("resize", () => {
        clearTimeout(window.__portalResizeTimer);
        window.__portalResizeTimer = setTimeout(() => {
          const now = _portalIsNarrow();
          if (_portalWasNarrow === now) return;
          _portalWasNarrow = now;
          if (portalTableMode === "px" && dataLoadState === "ready") filterAndRenderPortal();
        }, 200);
      });
```

`index.html:1180`（Task 3 で追加した `#portal-strip` の直後）に host を追加：

```html
        <div id="portal-strip"></div>
        <div id="portal-modebar"></div>
        <div id="portal-container"></div>
```

- [ ] **Step 3: item に px を合流（ソートを既存 `setSort` に乗せるため）**

`index.html` の `filterAndRenderPortal` 内 item リテラル（現 2020-2040 行）の末尾に追記：

```javascript
            salesYoY: growth.net_sales.yoy, salesCagr: growth.net_sales.cagr,
            niYoY: growth.net_income.yoy, niCagr: growth.net_income.cagr,
            // W1: 価格集計（値動きモードの列とソートが読む。px 無し銘柄は全て null）
            px: company.px || null,
            last: company.px ? company.px.last : null,
            c1: company.px ? company.px.c1 : null,
            c5: company.px ? company.px.c5 : null,
            vr: company.px ? company.px.vr : null,
            pos52: company.px ? company.px.pos52 : null,
          };
```

同関数の `NULL_LAST_KEYS`（現 2049 行）を価格キー込みに変更：

```javascript
        const NULL_LAST_KEYS = Object.assign(
          { eqRatio: 1, opMargin: 1, roe: 1, curRatio: 1, netMargin: 1, salesCagr: 1, niCagr: 1 },
          PortalPriceRules.PRICE_KEYS);   // W1: px 無し銘柄が昇順で先頭に来ないようにする
```

- [ ] **Step 4: 値動きモードでは業種束ねをスキップして1枚表にする**

`filterAndRenderPortal` の束ね部（現 2063-2069 行）と窓化セットアップ（現 2078-2087 行）を、モードで分岐させる：

```javascript
        renderPortalModeBar();
        const singleTable = (portalTableMode === "px");

        // Plan 2: sectorOrder を明示構築（integer-like key の並び替え罠回避・挿入順=ソート内初出順で視覚順と一致）。
        // W1: 値動きモードは業種で束ねない（横断ソートが目的なので1枚表にする）。
        const groups = {}, sectorOrder = [];
        if (!singleTable) {
          list.forEach((item) => {
            if (!groups[item.industry]) { groups[item.industry] = []; sectorOrder.push(item.industry); }
            groups[item.industry].push(item);
          });
        }

        if (list.length === 0) {
          renderPortalStrip(list);
          const marketOn = screeningMarkets.length > 0;
          const sectorOn = (activeSectorFilter !== "all" && activeSectorFilter !== "stock_only");
          const hint = (marketOn && sectorOn) ? "<br><span style='font-size:0.8rem;color:#5a6c78'>セクター条件と市場条件が重複している可能性があります</span>" : "";
          container.innerHTML = `<div style="text-align:center; color:var(--ix-slate); padding:40px;">該当する企業が見つかりません${hint}</div>`;
          return;
        }

        renderPortalStrip(list);
        const flat = [], sectorLen = {};
        if (singleTable) {
          list.forEach((it) => flat.push(it));
        } else {
          sectorOrder.forEach((ind) => {
            sectorLen[ind] = groups[ind].length;
            groups[ind].forEach((it) => flat.push(it));
          });
        }
        const sentinel = flat.length > PORTAL_CHUNK ? _makePortalSentinel() : null;
        portalWin = { flat, sectorLen, rendered: 0, curIndustry: null, curTbody: null,
                      sentinel, observer: null, container, single: singleTable };
```

⚠ 0件判定を `sectorOrder.length === 0` から **`list.length === 0`** に変えている（値動きモードでは `sectorOrder` を作らないため）。財務モードでは両者は同値。

- [ ] **Step 5: `_renderPortalChunk` を1枚表に対応させる**

`index.html:2247-2260` のループを次のように変更：

```javascript
        for (let i = w.rendered; i < end; i++) {
          const item = w.flat[i];
          if (!w.curTbody || (!w.single && item.industry !== w.curIndustry)) {
            w.curIndustry = item.industry;
            const sec = w.single ? _makePortalPriceSection() : _makePortalSection(item.industry, w.sectorLen[item.industry]);
            if (w.sentinel) w.container.insertBefore(sec.sectionEl, w.sentinel);
            else w.container.appendChild(sec.sectionEl);
            w.curTbody = sec.tbody;
            if (window.Detail && typeof window.Detail.injectTermHelp === "function") window.Detail.injectTermHelp(sec.sectionEl);
          }
          w.curTbody.appendChild(w.single ? _makePortalPriceRow(item) : _makePortalRow(item));
        }
```

- [ ] **Step 6: `_makePortalPriceSection()` と `_makePortalPriceRow()` を実装**

`index.html` の `_makePortalRow` 定義の直後に追加：

```javascript
      // W1: 値動きモードの1枚表（業種見出し無し・列ヘッダで横断ソート）。
      function _makePortalPriceSection() {
        const wrap = document.createElement("div");
        wrap.className = "sector-section";
        const scrollWrap = document.createElement("div");
        scrollWrap.style.cssText = "overflow-x: auto; -webkit-overflow-scrolling: touch; width: 100%; background-color: #0a0f17; border-radius: 10px;";
        const table = document.createElement("table");
        table.className = "portal-px-table";
        const cols = PortalPriceRules.priceColumns(_portalIsNarrow());
        table.innerHTML = "<thead><tr>" + cols.map((c) => {
          const on = sortKey === c.key;
          const icon = c.sortable ? `<span class="sort-icon">${on ? (sortAsc ? "▲" : "▼") : "↕"}</span>` : "";
          return `<th style="width:${c.width}" class="${on ? "active-sort" : ""}"${c.sortable ? ` data-sort="${c.key}"` : ""}>${esc(c.label)}${icon}</th>`;
        }).join("") + "</tr></thead><tbody></tbody>";
        table.querySelector("thead").addEventListener("click", (e) => {
          const th = e.target.closest("th[data-sort]");
          if (th) setSort(th.dataset.sort);
        });
        table.querySelector("tbody").addEventListener("click", (e) => {
          const tr = e.target.closest("tr[data-ticker]");
          if (tr) navigateToDetail(tr.dataset.ticker, tr);
        });
        scrollWrap.appendChild(table);
        wrap.appendChild(scrollWrap);
        return { sectionEl: wrap, tbody: table.querySelector("tbody") };
      }

      function _makePortalPriceRow(item) {
        const R = PortalPriceRules;
        const px = item.px;
        const tr = document.createElement("tr");
        tr.dataset.ticker = item.ticker;               // 委譲リスナーが読む（inline onclick を作らない）
        const narrow = _portalIsNarrow();
        const cols = R.priceColumns(narrow);
        if (!px) {
          tr.innerHTML = `<td colspan="${cols.length}" style="color:var(--ix-slate)">${esc(item.name)}（価格データなし）</td>`;
          return tr;
        }
        const market = R.marketOf(item.ticker, item);
        const asof = (typeof DATA_MARKET_ASOF !== "undefined" && DATA_MARKET_ASOF) || {};
        const stale = R.isStale(px, asof, market);
        if (stale) tr.className = "is-stale";
        const tone = px.c1 > 0 ? "#00e676" : (px.c1 < 0 ? "#ff5c7a" : "var(--ix-slate)");
        const price = px.last == null ? "--"
          : (item.currency === "USD" ? "$" : "¥") + (px.last >= 1000 ? Math.round(px.last).toLocaleString() : px.last.toFixed(2));
        const staleBadge = stale ? `<span class="pstale">${esc(String(px.date).slice(5).replace("-", "/"))}</span>` : "";
        const g = R.sparkGeometry(px.spark, narrow ? 52 : 84, narrow ? 22 : 24);
        const svg = g ? `<svg width="${narrow ? 52 : 84}" height="${narrow ? 22 : 24}" viewBox="0 0 ${narrow ? 52 : 84} ${narrow ? 22 : 24}" aria-hidden="true">
            <polyline points="${g.points}" fill="none" stroke="${tone}" stroke-width="1.4"
              stroke-linejoin="round" stroke-linecap="round"></polyline></svg>` : "";
        const pos = R.clampPos(px.pos52);
        const cell = {
          ticker: `<td><span class="ticker-code">${esc(item.ticker)}</span></td>`,
          name: narrow
            ? `<td><div class="company-clickable" style="font-size:13px">${esc(item.name)}</div><span class="ticker-code" style="font-size:12px">${esc(item.ticker)}</span>${staleBadge}</td>`
            : `<td><span class="company-clickable" title="${esc(item.name)}">${esc(item.name)}</span>${currencyBadge(item.currency)}${staleBadge}</td>`,
          last: `<td class="pnum" style="color:var(--ix-text)">${price}</td>`,
          c1: `<td class="pnum" style="color:${tone}">${R.fmtSigned(px.c1, 2, "%")}</td>`,
          c5: `<td class="pnum" style="color:${px.c5 > 0 ? "#00e676" : (px.c5 < 0 ? "#ff5c7a" : "var(--ix-slate)")}">${R.fmtSigned(px.c5, 1, "%")}</td>`,
          vr: `<td class="pnum" style="color:${px.vr >= 1.5 ? "#ffca3a" : "var(--ix-text-dim)"}">${R.fmtVolRatio(px.vr)}</td>`,
          pos52: `<td>${pos == null ? '<span class="p52">--</span>'
            : `<div class="prangebar"><i style="left:${pos}%"></i></div><div class="p52">${R.fmtDistHigh(px.dh)}</div>`}</td>`,
          spark: `<td>${svg}</td>`,
        };
        tr.innerHTML = cols.map((c) => cell[c.key]).join("");
        return tr;
      }
```

- [ ] **Step 7: 公開面に `setPortalTableMode` を足す**

`index.html:2584` の `Object.assign(window, {` に追加（末尾の行に足す）：

```javascript
        saveScreenerPreset, onScreenerPresetChange, deleteScreenerPreset, loadScreenerPreset,
        setPortalTableMode,
      });
```

- [ ] **Step 8: 実ブラウザで往復を確認**

Run（モック鯖 8210 を起動した状態で）:
```
NODE_PATH=/home/shugo/node_modules node scratchpad/w1-smoke.js
```
Expected: この時点ではモック用のアサートなので落ちてよい。**手動確認が本体**：
1. [財務]/[値動き] を往復して列と並びが崩れない
2. 値動きモードで前日比▼→出来高倍率▼→コード▲と並べ替えできる
3. 財務へ戻すとコード順・業種セクションが復活する
4. 390px（DevTools）で4列になる
5. EA に日付バッジが出る（`is-stale`）

- [ ] **Step 9: 既存テストが全部通ることを確認**

Run: `node --test tests/` と `.venv/bin/python -m pytest tests/ -q`
Expected: node 368 pass / pytest 237 pass

- [ ] **Step 10: コミット**

```bash
git add index.html
git commit -m "feat(portal): 値動きモード（1枚表・列ヘッダ横断ソート・narrow4列・stale バッジ）"
```

---

### Task 5: 検証ハーネスと記録

**Files:**
- Modify: `scratchpad/w1-smoke.js`（モック3案用 → 本実装用に書き換え）
- Create: `scratchpad/w1-payload-check.py`
- Modify: `.claude/CLAUDE.md`（恒久運用注意）
- Modify: `docs/superpowers/specs/2026-08-23-w1-portal-price-pack-design.md`（実装差分メモの追記）

**Interfaces:**
- Consumes: Task 1-4 の成果物すべて
- Produces: `scratchpad/w1-smoke.js`（本実装の受入スモーク）、`scratchpad/w1-payload-check.py`（payload 回帰）

- [ ] **Step 1: payload 回帰チェックを書く**

`scratchpad/w1-payload-check.py` を新規作成：

```python
#!/usr/bin/env python3
"""W1: /api/market/list の gzip サイズ回帰（上限 60KB）＋ px カバレッジの確認。

    .venv/bin/python scratchpad/w1-payload-check.py
Neon への SELECT のみ（書込ゼロ）。fetch_list() を直接呼ぶので Vercel は不要。
"""
import gzip
import importlib.util
import json
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LIMIT_KB = 60.0

for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

spec = importlib.util.spec_from_file_location("market_list", os.path.join(ROOT, "api", "market", "list.py"))
market_list = importlib.util.module_from_spec(spec)
spec.loader.exec_module(market_list)

t0 = time.time()
payload = market_list.fetch_list()
elapsed = (time.time() - t0) * 1000
body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
gz = len(gzip.compress(body)) / 1024
stocks = payload["stocks"]
with_px = sum(1 for e in stocks.values() if "px" in e)
spark_ok = all(len(e["px"]["spark"]) <= 30 for e in stocks.values() if e.get("px") and e["px"].get("spark"))

print(f"fetch_list: {elapsed:.0f}ms  gzip={gz:.1f}KB  px={with_px}/{len(stocks)}  "
      f"asof={payload['market_asof']}  px_error={payload['px_error']}")
fail = []
if gz > LIMIT_KB:
    fail.append(f"payload {gz:.1f}KB > 上限 {LIMIT_KB}KB")
if payload["px_error"]:
    fail.append("px_error=True（価格集計が失敗している）")
if with_px < len(stocks) * 0.9:
    fail.append(f"px カバレッジが低い（{with_px}/{len(stocks)}）")
if not spark_ok:
    fail.append("spark が30点を超えている")
if not payload["market_asof"]:
    fail.append("market_asof が空")
print("❌ " + " / ".join(fail) if fail else "✅ payload OK")
sys.exit(1 if fail else 0)
```

- [ ] **Step 2: payload チェックを走らせる**

Run: `.venv/bin/python scratchpad/w1-payload-check.py`
Expected: `✅ payload OK`（gzip 54〜56KB・px=292/292）

- [ ] **Step 3: 本実装用スモークに書き換える**

`scratchpad/w1-smoke.js` を次の内容に置き換える（モック3案の切替は不要になる）：

```javascript
// scratchpad/w1-smoke.js — W1 本実装の構造スモーク（PC 1440 / 390px × 財務/値動き）。
// 使い方:
//   .venv/bin/python scratchpad/w1-mock-server.py &     # /api/market/list は px 入り dump を返す
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w1-smoke.js ; kill %1
// GPUのグロー/色の見え方は対象外（実機の仕事）。DOM/例外/件数だけ見る。
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8210/";
const OUT = "scratchpad/w1-shots";
const VIEWS = [{ name: "pc", width: 1440, height: 1000 }, { name: "mb", width: 390, height: 844 }];
const MODES = ["fin", "px"];

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let fail = 0;
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    for (const mode of MODES) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate((m) => localStorage.setItem("sip_portal_table_mode", m), mode);
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForSelector("#portal-container tbody tr", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(700);
      const s = await page.evaluate(() => ({
        cards: document.querySelectorAll(".pstrip-card").length,
        tabs: document.querySelectorAll(".pstrip-tab").length,
        pxTables: document.querySelectorAll("table.portal-px-table").length,
        finTables: document.querySelectorAll("#portal-container table.portal-table").length,
        cols: document.querySelectorAll("table.portal-px-table thead th").length,
        rows: document.querySelectorAll("#portal-container tbody tr").length,
        stale: document.querySelectorAll("tr.is-stale").length,
        sortedByC1: (document.querySelector("table.portal-px-table th.active-sort") || {}).textContent || "",
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }));
      await page.screenshot({ path: `${OUT}/impl-${mode}-${v.name}.png` });
      const bad = [];
      if (s.cards !== 12) bad.push("ストリップのカード " + s.cards);
      if (s.tabs !== 4) bad.push("タブ " + s.tabs);
      if (mode === "px") {
        if (s.pxTables !== 1) bad.push("値動き表が " + s.pxTables + " 枚");
        if (s.finTables !== 0) bad.push("財務表が残っている " + s.finTables);
        if (s.cols !== (v.name === "mb" ? 4 : 8)) bad.push("列数 " + s.cols);
        if (!/前日比/.test(s.sortedByC1)) bad.push("既定ソートが前日比でない: " + s.sortedByC1);
      } else {
        if (s.pxTables !== 0) bad.push("財務モードなのに値動き表がある");
        if (s.finTables < 1) bad.push("財務表が無い");
      }
      if (s.overflowX) bad.push("横スクロール発生");
      if (bad.length) fail++;
      console.log(`${v.name}/${mode}: cards=${s.cards} pxTables=${s.pxTables} finTables=${s.finTables} ` +
        `cols=${s.cols} rows=${s.rows} stale=${s.stale} ` + (bad.length ? "❌ " + bad.join(" / ") : "✅"));
    }
    const real = errs.filter((e) => !/_vercel\/insights/.test(e));
    if (real.length) { console.log(`  [${v.name}] JSエラー:`); real.slice(0, 8).forEach((e) => console.log("   - " + e)); fail++; }
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `\n❌ ${fail} 件の要確認` : "\n✅ 全ケース構造OK");
  process.exit(fail ? 1 : 0);
})();
```

⚠ `w1-mock-server.py` の `SCRIPT_TAG` 注入（`w1-variants.js`）と `HOOKS` 注入は**本実装のスモークでは邪魔**なので、このステップで `w1-mock-server.py` から2つの注入を外す（`patched_index()` を `/api/market/list` の差し替えだけにする）。dump JSON は `px` を含むので本実装コードがそのまま動く。

- [ ] **Step 4: スモークを走らせる**

Run（実行1・モック鯖を起動）: `.venv/bin/python scratchpad/w1-mock-server.py`
Run（実行2・別ターミナル）: `NODE_PATH=/home/shugo/node_modules node scratchpad/w1-smoke.js`
Expected: `✅ 全ケース構造OK`（4ケース）

- [ ] **Step 5: 全テストを通す**

Run: `node --test tests/`
Expected: 368 pass
Run: `.venv/bin/python -m pytest tests/ -q`
Expected: 237 passed

- [ ] **Step 6: プロジェクト CLAUDE.md に恒久注意を追記**

`.claude/CLAUDE.md` の「チャート技術メモ」節の末尾に追加：

```markdown
### ポータル価格レイヤ（W1・2026-08-23）
- **`market.ohlcv` を window 関数で集計する時は必ず日付境界を入れる**（`date >= MAX(date) - INTERVAL '400 days'`）。境界なしは 235万行を舐めて 2.8〜3.8秒（コールド35秒）＝Vercel 10秒制限に対して危険。境界ありで 730ms。
- **`.portal-table` のレスポンシブ列非表示は `td:nth-child(N)` 依存**（≤1024px:4,9,10／≤768px:3,5,7／≤480px:1／≤375px:first-child）。**列構成の違う表に `portal-table` クラスを付けると別の列が消える**。値動き表が `.portal-px-table` 単独なのはこのため。
- **銘柄ごとに最終終値日が違う**（JP と US で市場カレンダーが異なる＋ETL の取り残しが起きる）。「全銘柄が同じ日付」を前提にした集計・表示を書かない。鮮度は `market_asof`（市場ごとの最新日）と `PortalPriceRules.isStale` で判定する。
- **`list` の価格集計は失敗しても 200 を返す**（`px_error: true`）。価格が取れないだけで一覧全体を落とさない。
```

- [ ] **Step 7: spec に実装差分メモを追記してコミット**

`docs/superpowers/specs/2026-08-23-w1-portal-price-pack-design.md` の末尾に「## 16. 実装差分メモ」を作り、実装中に spec と変えた点（あれば）を記録する。無ければ「差分なし」と明記する。

```bash
git add scratchpad/w1-smoke.js scratchpad/w1-payload-check.py scratchpad/w1-mock-server.py .claude/CLAUDE.md docs/superpowers/specs/2026-08-23-w1-portal-price-pack-design.md
git commit -m "test(w1): 本実装スモーク＋payload回帰チェック／恒久運用注意を CLAUDE.md へ"
```

---

## 完了条件（wave クロージャ）

1. `node --test tests/` = 368 pass／`.venv/bin/python -m pytest tests/ -q` = 237 passed
2. `.venv/bin/python scratchpad/w1-payload-check.py` = ✅（gzip ≤ 60KB・px 292/292）
3. `node scratchpad/w1-smoke.js` = ✅ 全4ケース
4. `money.js` / `money-rules.js` / `money.css` / `detail*.js` / `detail.css` / `cross-section-rules.js` / `finance-rules.js` が**無接触**であることを機械確認：
   ```bash
   git diff --name-only main...HEAD
   ```
   期待される変更ファイル: `api/market/list.py` / `portal-price-rules.js` / `dataClient.js` / `index.html` / `tests/*` / `scratchpad/*` / `docs/*` / `.claude/CLAUDE.md` のみ
5. 本人 実機サニティ（spec §12-5 の5項目）
6. main へ FF merge → push → **両デプロイ（通常 / persona）の実資産を curl で突合**（`/` と `portal-price-rules.js` の md5 一致）
