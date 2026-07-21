# NISA Account-Allocation Advice (Stage4b / plan B) Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development でtask毎に実装

## Goal

`spec 2026-07-21-nisa-stage4-account-allocation-design.md` §4/§6/§7/§8/§13 の **plan B**（層2・口座振り分け助言 endpoint）を **inert 先行**で実装する。`api/me/insight.py` に `kind='nisa_allocation'` 分岐を相乗りさせ（handler .py を増やさず 11/12 維持）、personal かつ独立 killswitch `NISA_ADVICE_ENABLED` ON のときだけ、本人の実 NISA 残枠（`me.mcc_state`）と plan A が作った適格判定テーブル（`market.nisa_tsumitate` / `ticker_master.nisa_growth_status`）に接地して「新規資金をどの口座に置くか」を助言する。production は killswitch 評価前に 403（痕跡ゼロ）。捏造ガードは「LLM は id 配列でのみ参照・突合は exact set-membership・prose の商品語/売却語は検出→degrade」。

## Architecture

- **本番実行環境**: Vercel serverless Python（`BaseHTTPRequestHandler`）＋ Neon Postgres ＋ psycopg3。
- **層分離厳守**: 層1（`money.js` = 両 URL 配信の公開クライアント）は適格商品リストを一切常駐しない。適格リスト・商品名は personal-gated endpoint 経由のみ。決定論 decline 文言は §8 教育原則のみ（商品名なし）。
- **逐語複製規約**（`insight.py:254` コメント準拠）: 制度モデル（残枠算出 `_nisa_derive` 依存木）と検出器（`_security_market_hit`/`_market_terms`）は cross-file import せず `advice.py` から `insight.py` へ逐語複製し、ドリフトは `advice.py↔insight.py` パリティテストで機械証明する。
- **gate 順序固定**: `_valid_session`→401 / `mode!=personal`→403（production 完全遮断＝killswitch 評価前）/ ANTHROPIC 鍵無→503 / `kind=='nisa_allocation'` かつ `NISA_ADVICE_ENABLED` off→403 `nisa-advice-disabled`。nisa 分岐は ticker 不要。
- **捏造ガード多層**: ①出力構造化（商品名を prose に書かせない）②parse で `ref∈eligible_ids` ＋ prefix 整合（`ts:`/`gw:`）exact-match・違反 drop ③第2ベルト（実在 ticker/社名 ＋ 投信名様トークン ＋ 売却動詞を prose 検出→degrade）。
- **監査ログ** `me.nisa_log` 新設: `facts_coarsened`（生¥を bucket 化）・`ai_response` は personal で NULL 固定・`eligible_products`/残枠¥は非保存。180日 TTL コメント。

## Tech Stack

- Python 3.14（`/home/shugo/apps/investment-portal/.venv/bin/python`・worktree に .venv は無く元 main の .venv を絶対パスで使う）。
- テスト: pytest（`api/me/insight.py` / `api/me/advice.py` を `importlib.util.spec_from_file_location` でロード＝既存 `tests/test_advice_facts.py` / `tests/test_insight_facts.py` と同型）＋ node `--test`（`money-rules.js`）。
- fixtures: `tests/fixtures/advice_facts_cases.json`（nisa 25 ケース・うち ledger 6・`state`＋`nowIso`/`nowMs`＋`investment`）。
- 破壊系 migration は `.vercelignore`（`db/`・`*.sql` を配信除外）ゆえ手動適用。

## Global Constraints

- テスト実行はすべて worktree ルートから: `cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4`。
  - Python: `/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/<file> -v`
  - JS: `NODE_PATH=/home/shugo/node_modules node --test tests/<file>`（`node --test tests/`（ディレクトリ）は本 Node 環境で `Cannot find module tests` になるため必ずファイル指定）。
- 既存 `insight.py` の `SCHEMA_VERSION=1` / `PROMPT_VERSION="insight-sys-v1"` / `n()` / `parse_ai()` / `handler.do_POST` の ticker 経路を **壊さない**（回帰）。NISA 用は別名定数（`NISA_PROMPT_VERSION`・`NISA_SCHEMA_VERSION`・`NISA_MAX_TOKENS`）・別関数で足す。
- 逐語複製した制度モデル関数の**本体を編集しない**（advice.py と byte 一致を保つ＝パリティテストが守る）。
- plan A 完了に依存（`market.nisa_tsumitate` テーブルと `ticker_master.nisa_growth_status/market_alert/nisa_source/nisa_checked_at` 列が存在する前提）。plan B のコードは inert（killswitch OFF・production 403）で先に投入。
- 本番読取専用検証のみ（共有 singleton state `me.mcc_state id=1` に破壊テスト禁止）。

---

### Task 1: capability を `api/auth/session.py` に追加（nisaAdviceEnabled 論理積）

`ADVICE_MODE==personal AND NISA_ADVICE_ENABLED∈{'1','true','on'}` の判定関数を足し、`do_GET` の 200 body（既存 `{ok, insightEnabled}`）に `nisaAdviceEnabled: bool` を加える。UI は fail-closed でこの値を可視ゲートに使う。

Files:
- Modify: `api/auth/session.py`
- Test: `tests/test_session_capability.py` (Create)

Interfaces:
- Consumes: なし（env のみ）。
- Produces:
  - `nisa_advice_enabled() -> bool` ＝ `insight_enabled() and (os.environ.get("NISA_ADVICE_ENABLED","").strip().lower() in ("1","true","on"))`（`insight_enabled()` は session.py 既存＝`ADVICE_MODE==personal`。Step3 の最小実装は同値をインラインで書く）
  - `do_GET` の JSON body に `"nisaAdviceEnabled": nisa_advice_enabled()` を追加（既存キー `ok`/`insightEnabled` は不変）。

TDD steps:
- [ ] Step1 失敗テストを書く（`tests/test_session_capability.py`）:
  ```python
  import importlib.util, os
  HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
  _spec = importlib.util.spec_from_file_location("session", os.path.join(ROOT, "api", "auth", "session.py"))
  session = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(session)

  def _set(mode, ks):
      if mode is None: os.environ.pop("ADVICE_MODE", None)
      else: os.environ["ADVICE_MODE"] = mode
      if ks is None: os.environ.pop("NISA_ADVICE_ENABLED", None)
      else: os.environ["NISA_ADVICE_ENABLED"] = ks

  def test_nisa_advice_enabled_logic():
      _set("personal", "1");   assert session.nisa_advice_enabled() is True
      _set("personal", "true"); assert session.nisa_advice_enabled() is True
      _set("personal", "on");  assert session.nisa_advice_enabled() is True
      _set("personal", "0");   assert session.nisa_advice_enabled() is False   # killswitch off
      _set("personal", None);  assert session.nisa_advice_enabled() is False   # 未設定=off
      _set("production", "1"); assert session.nisa_advice_enabled() is False   # production 遮断
      _set(None, "1");         assert session.nisa_advice_enabled() is False

  def test_insight_enabled_unchanged():
      _set("personal", "0"); assert session.insight_enabled() is True          # 既存挙動不変
  ```
- [ ] Step2 失敗確認: `cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4 && /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_session_capability.py -v` → `AttributeError: module 'session' has no attribute 'nisa_advice_enabled'` で FAIL。
- [ ] Step3 最小実装（`api/auth/session.py`・`insight_enabled` の直後に追加）:
  ```python
  def nisa_advice_enabled():
      # capability 論理積: personal かつ独立 killswitch ON。既定 off（未設定は off）。
      if os.environ.get("ADVICE_MODE", "production").strip().lower() != "personal":
          return False
      return os.environ.get("NISA_ADVICE_ENABLED", "").strip().lower() in ("1", "true", "on")
  ```
  `do_GET` の最終行を差し替え:
  ```python
          self.wfile.write(json.dumps(
              {"ok": ok, "insightEnabled": insight_enabled(), "nisaAdviceEnabled": nisa_advice_enabled()}
          ).encode())
  ```
- [ ] Step4 成功確認: `cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4 && /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_session_capability.py -v` → 2 passed。
- [ ] Step5 commit: `git add api/auth/session.py tests/test_session_capability.py && git commit -m "planB Task1: session.py nisaAdviceEnabled capability (personal AND killswitch)"`

---

### Task 2: 制度モデルを `insight.py` へ逐語複製＋残枠パリティテスト

残枠算出 `_nisa_derive` の依存木（`_parse_num`/`_num`/`_clamp`/`_r`/`_DECIMAL_RE`/NISA 法定枠定数/`_normalize_nisa_year`/`_normalize_nisa_history`/`_normalize_nisa`/`_nisa_now`/`_nisa_history_fold`/`_nisa_ledger_year`/`_nisa_ledger_fold`/`_nisa_effective`/`_nisa_derive`/`_nisa_raw`）を `advice.py:176-1056` から `insight.py` へ **逐語複製**し、同一 state で `advice._nisa_raw` と `insight._nisa_raw` の 11 フィールドが一致することを機械証明する。

Files:
- Modify: `api/me/insight.py`
- Test: `tests/test_nisa_alloc.py` (Create)

Interfaces:
- Consumes: `advice._nisa_raw(state, now_ms, ledger_rows) -> dict|None`（パリティ基準）。
- Produces（`insight` に新設・advice と同一シグネチャ・同一本体）:
  - `_nisa_derive(state: dict, now_ms: float, ledger_rows: list|None) -> dict`
  - `_nisa_raw(state: dict, now_ms: float, ledger_rows: list|None) -> dict|None` — 11 フィールド `tsumitateThisYear/growthThisYear/tsumitateLifetime/growthLifetime/soldThisYearAtCost/annualTsumitateRemaining/annualGrowthRemaining/lifetimeRemaining/growthCapRemaining/monthlyToFillTsumitate/restoresYear`。
  - 法定枠定数 `NISA_ANNUAL_TSUMITATE=1200000 / NISA_ANNUAL_GROWTH=2400000 / NISA_ANNUAL_TOTAL=3600000 / NISA_LIFETIME=18000000 / NISA_GROWTH_LIFETIME_CAP=12000000 / NISA_SOURCES=("manual","history","ledger") / NISA_MIN_YEAR=2024 / NISA_HISTORY_MAX=50`。
  - **既存 `_call_llm` を後方互換拡張**（複製とは別の小改修・topFix#2）＝`def _call_llm(system, user_text, max_tokens=INSIGHT_MAX_TOKENS)` にし `messages.create(..., max_tokens=max_tokens, ...)` へ差し替える。既存 per-stock insight 呼び出しは引数省略で `INSIGHT_MAX_TOKENS` のまま不変（回帰なし）・Task9 の nisa 経路のみ `NISA_MAX_TOKENS` を渡す。

TDD steps:
- [ ] Step1 失敗テストを書く（`tests/test_nisa_alloc.py`・既存 `test_advice_facts.py` の importlib パターン流用）:
  ```python
  import importlib.util, json, os
  HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)

  def _load(name, rel):
      spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, *rel))
      mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod

  advice = _load("advice", ("api", "me", "advice.py"))
  insight = _load("insight", ("api", "me", "insight.py"))

  with open(os.path.join(HERE, "fixtures", "advice_facts_cases.json"), encoding="utf-8") as f:
      CASES = json.load(f)["cases"]
  NISA_CASES = [c for c in CASES if c["name"].startswith("nisa")]

  def _now(c):
      if c.get("nowMs") is not None: return c["nowMs"]
      iso = c.get("nowIso")
      if iso:
          import datetime as dt
          return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000
      return 0

  RAW_FIELDS = ("tsumitateThisYear", "growthThisYear", "tsumitateLifetime", "growthLifetime",
                "soldThisYearAtCost", "annualTsumitateRemaining", "annualGrowthRemaining",
                "lifetimeRemaining", "growthCapRemaining", "monthlyToFillTsumitate", "restoresYear")

  def test_nisa_raw_parity_advice_vs_insight():
      assert NISA_CASES, "no nisa fixture cases"
      for c in NISA_CASES:
          a = advice._nisa_raw(c["state"], _now(c), c.get("investment"))
          b = insight._nisa_raw(c["state"], _now(c), c.get("investment"))
          assert (a is None) == (b is None), c["name"] + " None-parity"
          if a is None: continue
          for k in RAW_FIELDS:
              assert a[k] == b[k], "%s field %s: advice=%r insight=%r" % (c["name"], k, a[k], b[k])

  def test_nisa_constants_parity():
      for k in ("NISA_ANNUAL_TSUMITATE","NISA_ANNUAL_GROWTH","NISA_ANNUAL_TOTAL","NISA_LIFETIME",
                "NISA_GROWTH_LIFETIME_CAP","NISA_MIN_YEAR","NISA_HISTORY_MAX"):
          assert getattr(advice, k) == getattr(insight, k), k
  ```
- [ ] Step2 失敗確認: `cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4 && /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_nisa_alloc.py -v` → `AttributeError: module 'insight' has no attribute '_nisa_raw'` で FAIL。
- [ ] Step3 最小実装: `insight.py` の import 節に `import re` と `from decimal import Decimal` を追加（既存 import の直後）。`# ---- NISA 制度モデル（advice.py から逐語複製・パリティテストがドリフト防止／本体編集禁止）----` の見出しコメントの下に、`advice.py` から下記を **一字一句そのまま**貼り付ける:
  - 定数: `NISA_ANNUAL_TSUMITATE / NISA_ANNUAL_GROWTH / NISA_ANNUAL_TOTAL / NISA_LIFETIME / NISA_GROWTH_LIFETIME_CAP / NISA_SOURCES / NISA_MIN_YEAR / NISA_HISTORY_MAX`（advice.py:36-43）。
  - 正規表現/数値: `_DECIMAL_RE`（advice.py:176）・`_parse_num`（182-198）・`_num`（202-204）・`_clamp`（232-233）・`_r`（236-237）。
  - NISA 関数: `_normalize_nisa_year`（841-851）・`_normalize_nisa_history`（854-863）・`_normalize_nisa`（866-878）・`_nisa_now`（881-893）・`_nisa_history_fold`（896-918）・`_nisa_ledger_year`（921-926）・`_nisa_ledger_fold`（929-947）・`_nisa_effective`（950-968）・`_nisa_derive`（971-1016）・`_nisa_raw`（1041-1056）。
  - 注意: `_nisa_now` は `datetime.fromtimestamp` を使う（insight.py も advice.py も `from datetime import datetime, timezone` 済＝そのまま動く）。`_r`/`_num` は insight.py 既存の `n()`（line 24）と別物ゆえ名前衝突しない。
  - **`_call_llm` に max_tokens 引数を追加（後方互換・topFix#2）**：`insight.py:376` の `def _call_llm(system, user_text):` を `def _call_llm(system, user_text, max_tokens=INSIGHT_MAX_TOKENS):` へ、直後の `messages.create(..., max_tokens=INSIGHT_MAX_TOKENS, ...)` を `max_tokens=max_tokens` へ変更する（`INSIGHT_MAX_TOKENS` は既に module 定数ゆえ既定値に使える）。既存 per-stock 呼び出し（`if not ticker` 経路）は引数省略＝`INSIGHT_MAX_TOKENS` のまま不変。Task8 が定義する `NISA_MAX_TOKENS` は Task9 で本経路に渡すことで初めて実効化する（この改修が無いと dead）。
- [ ] Step4 成功確認: `cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4 && /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_nisa_alloc.py tests/test_insight_facts.py -v` → parity 2 passed ＋ 既存 insight テスト緑（回帰なし）。
- [ ] Step5 commit: `git add api/me/insight.py tests/test_nisa_alloc.py && git commit -m "planB Task2: verbatim NISA institution model into insight.py + advice<->insight raw parity"`

---

### Task 3: eligible_products 決定論ビルダー（統一 id 名前空間 ts:/gw:・cap 截断）

`market.nisa_tsumitate` 全件（つみたて）と `ticker_master WHERE nisa_growth_status IN('eligible','conditional')`（成長・ETF は status フィルタで自然に含まれる＝market_cap top80 に依存しない）から、統一 id（`ts:<serial>`/`gw:<ticker>`）付き適格商品配列を組む。token 予算超過時は決定論截断順序で cap（定数）し、截断フラグを返す（caller が cautions 注記）。

Files:
- Modify: `api/me/insight.py`
- Test: `tests/test_nisa_alloc.py` (Modify)

Interfaces:
- Consumes: なし（純関数＝行 dict のリストを受ける）。
- Produces:
  - `NISA_TSUMITATE_CAP = 60`・`NISA_GROWTH_CAP = 60`（定数）。
  - `build_eligible_products(tsumitate_rows: list[dict], growth_rows: list[dict], caps=(NISA_TSUMITATE_CAP, NISA_GROWTH_CAP)) -> dict`
    - 入力 tsumitate 行 = `{"id": serial, "fund_name", "mgmt_company", "category", "index_name"}`。成長行 = `{"ticker", "company_name", "industry", "type", "market", "nisa_growth_status"}`。
    - 返り値 `{"products": [ {id, kind, name, extra, status} ... ], "tsumitate_truncated": bool, "growth_truncated": bool}`。
    - product 形: つみたて＝`{"id": "ts:"+str(serial), "kind": "tsumitate", "name": fund_name, "extra": {"mgmtCompany", "category", "indexName"}, "status": "eligible"}` / 成長＝`{"id": "gw:"+ticker, "kind": "growth", "name": company_name, "extra": {"ticker", "industry", "market"}, "status": nisa_growth_status}`。
    - 截断順序: つみたて = `category` rank(index<active<etf) then `fund_name` 昇順、上位 caps[0]。成長 = `market`(JP<US) then `ticker` 昇順、上位 caps[1]。
  - `eligible_ids(products) -> set[str]`（id 集合＝whitelist 突合の基盤）。
  - `_read_eligible_products(cur) -> dict`（DB 読取: 2 SELECT → `build_eligible_products`。plan A のテーブル/列を読む・失敗時は空で degrade）。

TDD steps:
- [ ] Step1 失敗テストを追加（`tests/test_nisa_alloc.py` へ append）:
  ```python
  def _ts(i, name, cat="index"): return {"id": i, "fund_name": name, "mgmt_company": "運用A", "category": cat, "index_name": "TOPIX"}
  def _gw(tk, mkt="JP", st="eligible"): return {"ticker": tk, "company_name": tk+"社", "industry": "情報", "type": "stock", "market": mkt, "nisa_growth_status": st}

  def test_build_eligible_ids_and_prefix():
      out = insight.build_eligible_products([_ts(1, "A"), _ts(2, "B")], [_gw("7203"), _gw("AAPL", "US", "conditional")])
      ids = insight.eligible_ids(out["products"])
      assert "ts:1" in ids and "ts:2" in ids and "gw:7203" in ids and "gw:AAPL" in ids
      byid = {p["id"]: p for p in out["products"]}
      assert byid["ts:1"]["kind"] == "tsumitate" and byid["ts:1"]["name"] == "A"
      assert byid["gw:AAPL"]["status"] == "conditional" and byid["gw:AAPL"]["extra"]["market"] == "US"

  def test_build_eligible_truncation_deterministic():
      ts_rows = [_ts(i, "F%02d" % i) for i in range(70)]      # 70 > cap 60
      out = insight.build_eligible_products(ts_rows, [], caps=(60, 60))
      tprods = [p for p in out["products"] if p["kind"] == "tsumitate"]
      assert len(tprods) == 60 and out["tsumitate_truncated"] is True
      assert [p["name"] for p in tprods] == sorted(p["name"] for p in tprods)   # fund_name 昇順で截断

  def test_build_eligible_category_then_name_order():
      out = insight.build_eligible_products(
          [_ts(1, "Zzz", "index"), _ts(2, "Aaa", "active"), _ts(3, "Mmm", "etf")], [], caps=(2, 60))
      names = [p["name"] for p in out["products"] if p["kind"] == "tsumitate"]
      assert names == ["Zzz", "Aaa"] and out["tsumitate_truncated"] is True   # index(Zzz)→active(Aaa) が etf(Mmm)より優先
  ```
- [ ] Step2 失敗確認: `... -m pytest tests/test_nisa_alloc.py -v` → `AttributeError: ... 'build_eligible_products'` で FAIL。
- [ ] Step3 最小実装（`insight.py`・Task2 の複製ブロックの後）:
  ```python
  NISA_TSUMITATE_CAP = _envint("NISA_TSUMITATE_CAP", 60)
  NISA_GROWTH_CAP = _envint("NISA_GROWTH_CAP", 60)
  _TS_CAT_RANK = {"index": 0, "active": 1, "etf": 2}

  def build_eligible_products(tsumitate_rows, growth_rows, caps=None):
      cap_t, cap_g = caps if caps else (NISA_TSUMITATE_CAP, NISA_GROWTH_CAP)
      ts = sorted((r for r in (tsumitate_rows or []) if isinstance(r, dict)),
                  key=lambda r: (_TS_CAT_RANK.get((r.get("category") or ""), 9), str(r.get("fund_name") or "")))
      ts_trunc = len(ts) > cap_t
      ts_prods = [{
          "id": "ts:" + str(r.get("id")), "kind": "tsumitate", "name": r.get("fund_name"),
          "extra": {"mgmtCompany": r.get("mgmt_company"), "category": r.get("category"), "indexName": r.get("index_name")},
          "status": "eligible",
      } for r in ts[:cap_t]]
      gw = sorted((r for r in (growth_rows or []) if isinstance(r, dict)),
                  key=lambda r: (0 if (r.get("market") or "JP") == "JP" else 1, str(r.get("ticker") or "")))
      gw_trunc = len(gw) > cap_g
      gw_prods = [{
          "id": "gw:" + str(r.get("ticker")), "kind": "growth", "name": r.get("company_name"),
          "extra": {"ticker": r.get("ticker"), "industry": r.get("industry"), "market": r.get("market")},
          "status": r.get("nisa_growth_status") or "unknown",
      } for r in gw[:cap_g]]
      return {"products": ts_prods + gw_prods, "tsumitate_truncated": ts_trunc, "growth_truncated": gw_trunc}

  def eligible_ids(products):
      return {p["id"] for p in (products or []) if isinstance(p, dict) and p.get("id")}

  def _read_eligible_products(cur):
      ts_rows, gw_rows = [], []
      try:
          cur.execute("SELECT id, fund_name, mgmt_company, category, index_name FROM market.nisa_tsumitate")
          for i, fn, mc, cat, idx in cur.fetchall():
              ts_rows.append({"id": i, "fund_name": fn, "mgmt_company": mc, "category": cat, "index_name": idx})
      except Exception:
          ts_rows = []
      try:
          cur.execute(
              "SELECT ticker, company_name, industry, type, "
              "CASE WHEN (country='US' OR currency='USD') THEN 'US' ELSE 'JP' END AS market, nisa_growth_status "
              "FROM market.ticker_master WHERE nisa_growth_status IN ('eligible','conditional')")
          for tk, nm, ind, typ, mkt, st in cur.fetchall():
              gw_rows.append({"ticker": tk, "company_name": nm, "industry": ind, "type": typ, "market": mkt, "nisa_growth_status": st})
      except Exception:
          gw_rows = []
      return build_eligible_products(ts_rows, gw_rows)
  ```
- [ ] Step4 成功確認: `... -m pytest tests/test_nisa_alloc.py -v` → 追加 3 テスト passed（parity も緑維持）。
- [ ] Step5 commit: `git add api/me/insight.py tests/test_nisa_alloc.py && git commit -m "planB Task3: deterministic eligible_products builder (ts:/gw: ids, cap truncation)"`

---

### Task 4: prompt 構築（制度アンカー §8・売却 negative constraint・接地）

`SYS_NISA_ALLOC` system プロンプト（§8 の制度事実を決定論同梱・LLM に発明させない ＋ 売却/移し替え禁止の negative constraint ＋ 出力 JSON スキーマ）と、`_build_nisa_user`（本人残枠 nisa_raw ＋ eligible_products カタログ ＋ 可変本数注入）を作る。

Files:
- Modify: `api/me/insight.py`
- Test: `tests/test_nisa_alloc.py` (Modify)

Interfaces:
- Consumes: `build_eligible_products`（Task3）の `products`。
- Produces:
  - `SYS_NISA_ALLOC: str`（system プロンプト定数）。
  - `_build_nisa_user(nisa_raw: dict, products: list, counts: dict) -> str` — `counts={"tsumitate": int, "growth": int}`（可変本数＝SELECT count 由来）。返り値 JSON に nisa_raw（残枠）・products（`id`/`kind`/`name`/`status` のみ・extra 一部）・counts を含む。

TDD steps:
- [ ] Step1 失敗テストを追加:
  ```python
  def test_sys_nisa_alloc_anchors_and_negative_constraint():
      s = insight.SYS_NISA_ALLOC
      assert "20.315" in s                       # 税率一律アンカー(§8)
      assert "1800" in s and "1200" in s         # 生涯枠1800万/成長内数1200万
      assert "損益通算" in s and "繰越" in s        # 損益通算・繰越控除不可
      assert "外国税額控除" in s                    # US 二重課税アンカー
      assert "売却" in s and "移し替え" in s         # 売却 negative constraint(§13)
      assert "新規資金" in s                        # 助言は新規資金配分のみ
      assert '"cautions"' in s                      # 出力スキーマ強制（cautions は LLM 生成）
      assert '"newMoneyNote"' not in s              # topFix #1: newMoneyNote はサーバ固定文＝LLM 非生成

  def test_build_nisa_user_injects_counts_and_ids_not_prose_names():
      out = insight.build_eligible_products([_ts(1, "実在ファンド名")], [_gw("7203")])
      raw = {"annualTsumitateRemaining": 500000, "annualGrowthRemaining": 2400000, "lifetimeRemaining": 18000000,
             "growthCapRemaining": 12000000, "monthlyToFillTsumitate": 50000, "restoresYear": 2027,
             "tsumitateThisYear": 700000, "growthThisYear": 0, "tsumitateLifetime": 700000,
             "growthLifetime": 0, "soldThisYearAtCost": 0}
      user = insight._build_nisa_user(raw, out["products"], {"tsumitate": 360, "growth": 190})
      assert "ts:1" in user and "gw:7203" in user      # id は渡る
      assert "360" in user                              # 可変本数注入
  ```
- [ ] Step2 失敗確認: `... -m pytest tests/test_nisa_alloc.py -v` → `AttributeError: ... 'SYS_NISA_ALLOC'` で FAIL。
- [ ] Step3 最小実装（`insight.py`）:
  ```python
  SYS_NISA_ALLOC = (
      "あなたは本人専用の NISA 口座配置コーチです（本人が自分のためだけに使う非公開ツール）。"
      "役割は、与えられた適格商品（eligible_products）と本人の NISA 残枠に基づき、"
      "つみたて投資枠／成長投資枠／課税口座の使い分けを教育的に助言することです。"
      "次の制度事実は与件であり、これに反する説明や新たな数値の発明をしないこと："
      "①NISA口座と課税口座は損益通算・繰越控除ができない（下振れ時の税務救済ゼロ）"
      "②NISA非課税口座内の配当は外国税額控除の対象外（米国株配当の現地源泉は取り戻せない）"
      "③上場株式等の配当・譲渡益の税率は一律20.315%（資産クラス間の税率差はない）"
      "④生涯投資枠1800万（うち成長投資枠の内数上限1200万）・簿価残高ベース・売却分は翌年復活（年間枠に上乗せされない）"
      "⑤年間枠はつみたて120万・成長240万（繰越不可・同年内再利用不可）。"
      "商品は eligible_products の id でのみ参照し、リストに無い商品名/ティッカー/ファンド名を新たに作らないこと。"
      "適格性判定はサーバ与件であり、あなたは判定しない。"
      "既存保有の売却・移し替え・買い直しには一切言及しないこと（助言は新規資金の配分のみ）。"
      "出力は次のJSONオブジェクトのみ（前後に文章やコードフェンスを付けない）："
      '{"headline":"…","tsumitate_plan":{"note":"…","refs":["ts:…"]},'
      '"growth_candidates":{"note":"…","refs":["gw:…"],"conditionalDisclaimer":"…"},'
      '"taxable_note":"…","cautions":["…"]} '
      "headline は60字以内、各 note と taxable_note は240字以内、cautions は各80字以内・日本語。"
      "cautions には少なくとも損益通算不可・下振れ時の税務救済ゼロを含めること。"
  )
  # newMoneyNote はサーバ注入の固定文（下 Task5 の NISA_NEW_MONEY_NOTE）＝LLM に生成させない
  # （生成させると売却否定の定型文が Task6 の売却動詞ガードに自ヒットして恒常 degrade する＝topFix #1）。
  # ゆえに SYS_NISA_ALLOC の出力スキーマ・指示に newMoneyNote を含めない。

  def _build_nisa_user(nisa_raw, products, counts):
      catalog = [{"id": p["id"], "kind": p["kind"], "name": p["name"], "status": p["status"]} for p in products]
      payload = {"nisa_remaining": nisa_raw, "eligible_products": catalog, "counts": counts}
      return ("次の JSON は本人の NISA 残枠と適格商品カタログです。これに基づき、新規資金の口座振り分けを助言してください。\n"
              + json.dumps(payload, ensure_ascii=False))
  ```
- [ ] Step4 成功確認: `... -m pytest tests/test_nisa_alloc.py -v` → 追加 2 テスト passed。
- [ ] Step5 commit: `git add api/me/insight.py tests/test_nisa_alloc.py && git commit -m "planB Task4: SYS_NISA_ALLOC prompt (institution anchors, sell negative-constraint) + user builder"`

---

### Task 5: parse ＋ whitelist（exact set-membership・prefix 整合・文字数 degrade）

`parse_nisa_ai(text, eligible_id_set)` = JSON パース → 各 ref を `ref∈eligible_ids` かつ prefix 整合（tsumitate_refs は `ts:` のみ・growth_refs は `gw:` のみ）で exact-match フィルタ → cautions 欠落 or 文字数超過は None（degrade・切詰しない）。newMoneyNote は LLM から読まず**サーバ固定文 `NISA_NEW_MONEY_NOTE` を注入**（topFix #1・売却動詞ガードとの自己矛盾解消）。

Files:
- Modify: `api/me/insight.py`
- Test: `tests/test_nisa_alloc.py` (Modify)

Interfaces:
- Consumes: `eligible_ids(products)`（Task3）の集合。
- Produces:
  - `NISA_NEW_MONEY_NOTE: str`（サーバ固定文＝「新規資金の配分のみで、既存保有の売却・移し替え指示ではありません。」・topFix #1）。
  - `parse_nisa_ai(text: str, eligible: set) -> dict|None` — 返り値 `{"headline", "newMoneyNote", "tsumitate_plan": {"note", "refs"}, "growth_candidates": {"note", "refs", "conditionalDisclaimer"}, "taxable_note", "cautions": [str]}`。`newMoneyNote` は常に `NISA_NEW_MONEY_NOTE`（LLM 出力を無視して注入）。drop された ref は返り値から除去。None＝degrade（cautions 欠落 or 文字数超過）。

TDD steps:
- [ ] Step1 失敗テストを追加:
  ```python
  import json as _json
  ELIG = {"ts:1", "ts:2", "gw:7203", "gw:AAPL"}
  def _mk(**over):
      base = {"headline": "配分の考え方", "newMoneyNote": "新規資金の配分のみで売却指示ではありません",
              "tsumitate_plan": {"note": "つみたて枠を優先", "refs": ["ts:1"]},
              "growth_candidates": {"note": "成長枠候補", "refs": ["gw:7203"]},
              "taxable_note": "課税口座は損益通算可", "cautions": ["損益通算不可", "下振れ時の税務救済なし"]}
      base.update(over); return _json.dumps(base, ensure_ascii=False)

  def test_parse_drops_nonmember_and_wrong_prefix_refs():
      p = insight.parse_nisa_ai(_mk(tsumitate_plan={"note": "x", "refs": ["ts:1", "ts:999", "gw:7203"]},
                                    growth_candidates={"note": "y", "refs": ["gw:AAPL", "gw:NOPE", "ts:1"]}), ELIG)
      assert p["tsumitate_plan"]["refs"] == ["ts:1"]      # ts:999 非member / gw:7203 prefix不整合を drop
      assert p["growth_candidates"]["refs"] == ["gw:AAPL"] # gw:NOPE 非member / ts:1 prefix不整合を drop

  def test_parse_missing_cautions_degrades():
      assert insight.parse_nisa_ai(_mk(cautions=[]), ELIG) is None            # cautions 欠落は degrade

  def test_parse_newmoneynote_is_server_injected_constant():
      # topFix #1: newMoneyNote は LLM 出力を無視してサーバ固定文を注入＝空/別文言でも degrade しない。
      p = insight.parse_nisa_ai(_mk(newMoneyNote=""), ELIG)
      assert p is not None and p["newMoneyNote"] == insight.NISA_NEW_MONEY_NOTE
      p2 = insight.parse_nisa_ai(_mk(newMoneyNote="LLMの勝手な文言"), ELIG)
      assert p2 is not None and p2["newMoneyNote"] == insight.NISA_NEW_MONEY_NOTE

  def test_parse_char_overflow_degrades_not_truncated():
      assert insight.parse_nisa_ai(_mk(headline="あ" * 61), ELIG) is None            # headline>60
      assert insight.parse_nisa_ai(_mk(taxable_note="い" * 241), ELIG) is None        # note>240
      assert insight.parse_nisa_ai(_mk(cautions=["う" * 81, "ok"]), ELIG) is None     # caution>80

  def test_parse_valid_passes():
      p = insight.parse_nisa_ai(_mk(), ELIG)
      assert p is not None and p["tsumitate_plan"]["refs"] == ["ts:1"] and p["cautions"]
  ```
- [ ] Step2 失敗確認: `... -m pytest tests/test_nisa_alloc.py -v` → `AttributeError: ... 'parse_nisa_ai'` で FAIL。
- [ ] Step3 最小実装（`insight.py`）:
  ```python
  # newMoneyNote はサーバ注入の固定文（topFix #1）＝LLM 生成に依存させない。売却否定の定型文を LLM に
  # 書かせると Task6 の売却動詞ガード（売却/移し替え）に必ず自ヒットして恒常 degrade するため、
  # サーバが固定文を注入し、走査対象からも外す（Task6 _nisa_prose_fields）。
  NISA_NEW_MONEY_NOTE = "新規資金の配分のみで、既存保有の売却・移し替え指示ではありません。"

  def _nisa_refs_filter(refs, prefix, eligible):
      out = []
      if isinstance(refs, list):
          for r in refs:
              if isinstance(r, str) and r.startswith(prefix) and r in eligible and r not in out:
                  out.append(r)
      return out

  def parse_nisa_ai(text, eligible):
      try:
          obj = json.loads(text)
      except Exception:
          return None
      if not isinstance(obj, dict):
          return None
      def _s(v):
          return v.strip() if isinstance(v, str) else ""
      headline = _s(obj.get("headline"))
      tp = obj.get("tsumitate_plan") if isinstance(obj.get("tsumitate_plan"), dict) else {}
      gc = obj.get("growth_candidates") if isinstance(obj.get("growth_candidates"), dict) else {}
      tp_note, gc_note = _s(tp.get("note")), _s(gc.get("note"))
      taxable = _s(obj.get("taxable_note"))
      cond = _s(gc.get("conditionalDisclaimer"))
      cautions = [_s(c) for c in obj.get("cautions")] if isinstance(obj.get("cautions"), list) else []
      cautions = [c for c in cautions if c]
      # 構造強制: cautions 欠落は degrade（両論併記の構造強制）。newMoneyNote はサーバ固定文ゆえ欠落判定しない。
      if not cautions:
          return None
      # 文字数超過は切詰でなく degrade（意味毀損防止）。newMoneyNote は固定文ゆえ長さ検査対象外。
      if len(headline) > 60 or len(tp_note) > 240 or len(gc_note) > 240 \
         or len(taxable) > 240 or len(cond) > 240 or any(len(c) > 80 for c in cautions):
          return None
      return {
          "headline": headline, "newMoneyNote": NISA_NEW_MONEY_NOTE,   # サーバ固定文を注入（LLM 出力は無視）
          "tsumitate_plan": {"note": tp_note, "refs": _nisa_refs_filter(tp.get("refs"), "ts:", eligible)},
          "growth_candidates": {"note": gc_note, "refs": _nisa_refs_filter(gc.get("refs"), "gw:", eligible),
                                "conditionalDisclaimer": cond},
          "taxable_note": taxable, "cautions": cautions,
      }
  ```
- [ ] Step4 成功確認: `... -m pytest tests/test_nisa_alloc.py -v` → 追加 4 テスト passed。
- [ ] Step5 commit: `git add api/me/insight.py tests/test_nisa_alloc.py && git commit -m "planB Task5: parse_nisa_ai whitelist (set-membership + prefix) + char-overflow degrade"`

---

### Task 6: 第2ベルト（検出器逐語複製＋投信名様トークン＋売却動詞→degrade）

`_security_market_hit`/`_market_terms` を `advice.py` から `insight.py` へ逐語複製（成長 ticker/社名の prose 混入検出）。加えて投信名様トークン検出器（カタカナ長連・『ファンド』『インデックス』）と売却動詞検出器を新設し、**LLM 生成 prose フィールド（headline/各note/taxable_note）のみ**に適用して命中で degrade（newMoneyNote/cautions 等サーバ固定文は走査対象外＝topFix #1）。

Files:
- Modify: `api/me/insight.py`
- Test: `tests/test_nisa_alloc.py` (Modify)

Interfaces:
- Consumes: `parse_nisa_ai`（Task5）の返り値 dict。
- Produces:
  - `_market_terms(cur) -> {"tickers": set, "names": list}`（advice 逐語複製）・`_security_market_hit(text, terms) -> bool`（逐語複製）。
  - `_NISA_FUND_TOKEN_RE`（`カタカナ6連以上|ファンド|インデックス|ｅ?ＭＡＸＩＳ` 等）・`_SELL_VERB_RE`（`売る|売却|移す|移し替え|乗り換え|買い直|buy ?back`）。
  - `nisa_prose_clean(parsed: dict, terms: dict) -> bool` — **LLM 生成 prose のみ**（headline/tsumitate note/growth note/taxable_note）に 3 検出器を適用し、いずれか命中で False（＝degrade）。newMoneyNote/cautions/conditionalDisclaimer はサーバ固定文/免責ゆえ走査対象外（topFix #1）。

TDD steps:
- [ ] Step1 失敗テストを追加:
  ```python
  TERMS = {"tickers": {"7203", "AAPL"}, "names": ["トヨタ自動車"]}
  def _parsed(**o):
      base = {"headline": "配分", "newMoneyNote": "新規資金のみ",
              "tsumitate_plan": {"note": "枠を優先", "refs": []},
              "growth_candidates": {"note": "候補", "refs": [], "conditionalDisclaimer": ""},
              "taxable_note": "課税口座", "cautions": ["損益通算不可"]}
      base.update(o); return base

  def test_prose_clean_passes_neutral():
      assert insight.nisa_prose_clean(_parsed(), TERMS) is True

  def test_prose_ticker_or_name_hit_degrades():
      assert insight.nisa_prose_clean(_parsed(taxable_note="7203を課税口座で"), TERMS) is False   # 裸ticker
      assert insight.nisa_prose_clean(_parsed(headline="トヨタ自動車を軸に"), TERMS) is False       # 社名

  def test_prose_fund_name_token_degrades():
      assert insight.nisa_prose_clean(_parsed(growth_candidates={"note": "オルカンインデックスが良い", "refs": [], "conditionalDisclaimer": ""}), TERMS) is False
      assert insight.nisa_prose_clean(_parsed(tsumitate_plan={"note": "このファンドを推す", "refs": []}), TERMS) is False

  def test_prose_sell_verb_degrades():
      assert insight.nisa_prose_clean(_parsed(taxable_note="含み損の銘柄を売却して"), TERMS) is False   # taxable_note は走査対象
      assert insight.nisa_prose_clean(_parsed(tsumitate_plan={"note": "課税口座からNISAへ移し替え", "refs": []}), TERMS) is False  # tsumitate note も走査対象

  def test_prose_clean_ignores_server_fixed_fields():
      # topFix #1: newMoneyNote 固定文・cautions は走査対象外＝売却/移し替え語を含んでも degrade しない（恒常 degrade 回避）。
      assert insight.nisa_prose_clean(_parsed(newMoneyNote="新規資金の配分のみで、既存保有の売却・移し替え指示ではありません。"), TERMS) is True
      assert insight.nisa_prose_clean(_parsed(cautions=["近く売却予定の資産は非課税枠に不向きです"]), TERMS) is True
  ```
- [ ] Step2 失敗確認: `... -m pytest tests/test_nisa_alloc.py -v` → `AttributeError: ... 'nisa_prose_clean'` で FAIL。
- [ ] Step3 最小実装（`insight.py`）: `advice.py:1259-1288` の `_MARKET_TERMS`/`_market_terms`/`_security_market_hit` を逐語複製（`import re` は Task2 で追加済）。続けて:
  ```python
  # 投信ファンド名は NER 不能ゆえ「固有名詞様トークン」を保守的検出（カタカナ長連・商品語）→ degrade。
  _NISA_FUND_TOKEN_RE = re.compile(r"[ァ-ヶー]{6,}|ファンド|インデックス|ｅ?ＭＡＸＩＳ|eMAXIS|オルカン")
  # 売却/移し替え動詞（最上位 Non-goal の出力側担保）。
  _SELL_VERB_RE = re.compile(r"売る|売却|売り(?:払|に出)|移す|移し替え|乗り換え|買い直|買い替え|buy ?back", re.IGNORECASE)

  def _nisa_prose_fields(parsed):
      # topFix #1: 売却/商品語ガードは LLM が自由記述する prose のみ＝headline/tsumitate note/growth note/
      # taxable_note に適用する。サーバ固定文/免責は走査対象外にする：
      #   - newMoneyNote＝サーバ注入の固定文（売却否定の定型文）＝走査すると必ず売却動詞に自ヒットして恒常 degrade。
      #   - cautions＝「近く売却予定の資産は非課税枠に不向き」等の正当な両論注意が売却語を含みうる（誤 degrade）。
      #   - conditionalDisclaimer＝build_nisa_response がサーバ固定文を強制注入（そもそも gc.note のみ走査で対象外）。
      tp = parsed.get("tsumitate_plan") or {}
      gc = parsed.get("growth_candidates") or {}
      fields = [parsed.get("headline", ""), tp.get("note", ""), gc.get("note", ""),
                parsed.get("taxable_note", "")]
      return [f for f in fields if isinstance(f, str) and f]

  def nisa_prose_clean(parsed, terms):
      for f in _nisa_prose_fields(parsed):
          if _security_market_hit(f, terms):
              return False
          if _NISA_FUND_TOKEN_RE.search(f):
              return False
          if _SELL_VERB_RE.search(f):
              return False
      return True
  ```
- [ ] Step4 成功確認: `... -m pytest tests/test_nisa_alloc.py -v` → 追加 4 テスト passed。
- [ ] Step5 commit: `git add api/me/insight.py tests/test_nisa_alloc.py && git commit -m "planB Task6: second belt (security-hit verbatim + fund-name token + sell-verb) -> degrade"`

---

### Task 7: `me.nisa_log` migration ＋ coarsen（生¥ leaf 粗化）＋ `_log_nisa`

`db/migrations/2026-07-21-nisa-log.sql`（`me.nisa_log` 新設・180日 TTL コメント）と、nisa_raw の生¥ leaf を bucket 化する `coarsen_nisa_facts`、および INSERT ヘルパ `_log_nisa` を作る。`ai_response` は personal で NULL 固定・`eligible_products`/残枠¥は非保存。

Files:
- Create: `db/migrations/2026-07-21-nisa-log.sql`
- Modify: `api/me/insight.py`
- Test: `tests/test_nisa_alloc.py` (Modify)

Interfaces:
- Consumes: `_nisa_raw`（Task2）の 11 フィールド dict。
- Produces:
  - `me.nisa_log(id serial PK, session_hash text NOT NULL, created_at timestamptz default now(), facts_coarsened jsonb, ai_response jsonb, ai_status text, prompt_version text, refs_count int, degrade_reason text)`。
  - `coarsen_nisa_facts(nisa_raw: dict|None) -> dict|None` — 各残枠¥を対応 cap でのパーセンテージ→`_bucket25`（0/25/50/75/100）に、`restoresYear` は年のまま透過、生¥ leaf（`monthlyToFillTsumitate`/`soldThisYearAtCost` 等）は排除。`source` は非保存（`_nisa_raw` に source フィールドが無い＝topFix #4）。
  - `_log_nisa(cur, session_hash, nisa_raw, ai_status, refs_count, degrade_reason)` — `facts_coarsened=coarsen_nisa_facts(nisa_raw)`・`ai_response=NULL`（personal 固定）で INSERT（失敗は握って print）。

TDD steps:
- [ ] Step1 失敗テストを追加:
  ```python
  def test_coarsen_nisa_facts_buckets_and_drops_raw_yen():
      raw = {"tsumitateThisYear": 700000, "growthThisYear": 0, "tsumitateLifetime": 700000,
             "growthLifetime": 0, "soldThisYearAtCost": 123456,
             "annualTsumitateRemaining": 500000, "annualGrowthRemaining": 2400000,
             "lifetimeRemaining": 17300000, "growthCapRemaining": 12000000,
             "monthlyToFillTsumitate": 55000, "restoresYear": 2027}
      c = insight.coarsen_nisa_facts(raw)
      # bucket 化された leaf は 0/25/50/75/100 のみ
      for k in ("annualTsumitateUsedBucket", "lifetimeUsedBucket", "growthCapUsedBucket"):
          assert c[k] in (0, 25, 50, 75, 100), (k, c[k])
      # 生¥ leaf は非保存（監査指紋を残さない）
      assert "monthlyToFillTsumitate" not in c and "soldThisYearAtCost" not in c
      assert "annualTsumitateRemaining" not in c and "lifetimeRemaining" not in c
      # restoresYear（年・非¥）は透過
      assert c["restoresYear"] == 2027
      # 生¥そのものが値として現れない
      import json as _j
      assert "123456" not in _j.dumps(c) and "700000" not in _j.dumps(c) and "17300000" not in _j.dumps(c)

  def test_coarsen_nisa_none_is_none():
      assert insight.coarsen_nisa_facts(None) is None
  ```
- [ ] Step2 失敗確認: `... -m pytest tests/test_nisa_alloc.py -v` → `AttributeError: ... 'coarsen_nisa_facts'` で FAIL。
- [ ] Step3 最小実装:
  - `db/migrations/2026-07-21-nisa-log.sql`:
    ```sql
    -- B#3 Stage4b: NISA 口座配置助言の監査ログ。生¥は facts_coarsened で bucket 化済み・ai_response は
    -- personal では NULL 固定・eligible_products/残枠¥は非保存。手動適用（.vercelignore が *.sql 非配信）。
    -- TTL: 180日（cron で `DELETE FROM me.nisa_log WHERE created_at < now() - interval '180 days'`）。
    CREATE TABLE IF NOT EXISTS me.nisa_log (
        id              serial PRIMARY KEY,
        session_hash    text NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        facts_coarsened jsonb,
        ai_response     jsonb,
        ai_status       text,
        prompt_version  text,
        refs_count      int,
        degrade_reason  text
    );
    CREATE INDEX IF NOT EXISTS nisa_log_created ON me.nisa_log (created_at DESC);
    ```
  - `insight.py`（Task2 の `_bucket*` は insight に無いため小さく足す）:
    ```python
    def _bucket25(p):
        return int(round(_num(p) / 25.0)) * 25  # 0/25/50/75/100（advice.coarsen と同方針）

    def coarsen_nisa_facts(nisa_raw):
        if not isinstance(nisa_raw, dict):
            return None
        at, ag = nisa_raw.get("tsumitateThisYear", 0), nisa_raw.get("growthThisYear", 0)
        life = _num(nisa_raw.get("tsumitateLifetime")) + _num(nisa_raw.get("growthLifetime"))
        # topFix #4: source は載せない。_nisa_raw の 11 フィールドに source は存在せず（advice.py:1041-1056）、
        # 載せるには _handle_nisa 側で _nisa_derive を二重計算して n['source'] を別途渡す必要がある。
        # 入力源ラベル（manual/history/ledger）は観測価値が低く、単一射影（_nisa_raw 1 本）を崩す対価に見合わない。
        # 監査に必要な残枠は bucket 化した leaf のみで足りる。
        return {
            "annualTsumitateUsedBucket": _bucket25(at / NISA_ANNUAL_TSUMITATE * 100),
            "annualGrowthUsedBucket": _bucket25(ag / NISA_ANNUAL_GROWTH * 100),
            "lifetimeUsedBucket": _bucket25(life / NISA_LIFETIME * 100),
            "growthCapUsedBucket": _bucket25(_num(nisa_raw.get("growthLifetime")) / NISA_GROWTH_LIFETIME_CAP * 100),
            "restoresYear": nisa_raw.get("restoresYear", 0),
        }

    def _log_nisa(cur, session_hash, nisa_raw, ai_status, refs_count, degrade_reason):
        try:
            cur.execute(
                "INSERT INTO me.nisa_log (session_hash, facts_coarsened, ai_response, ai_status, "
                "prompt_version, refs_count, degrade_reason) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (session_hash, Jsonb(coarsen_nisa_facts(nisa_raw)) if nisa_raw is not None else None,
                 None, ai_status, NISA_PROMPT_VERSION, refs_count, degrade_reason))
        except Exception as e:  # noqa: BLE001
            print(f"nisa log error: {type(e).__name__}", file=sys.stderr)
    ```
    （`NISA_PROMPT_VERSION="nisa-alloc-v1"` を定数節で定義。`Jsonb` は insight.py 冒頭で import 済み。）
- [ ] Step4 成功確認: `... -m pytest tests/test_nisa_alloc.py -v` → 追加 2 テスト passed。
- [ ] Step5 commit: `git add db/migrations/2026-07-21-nisa-log.sql api/me/insight.py tests/test_nisa_alloc.py && git commit -m "planB Task7: me.nisa_log migration + coarsen_nisa_facts (bucket raw yen, drop yen leaves)"`

---

### Task 8: kind dispatch ＋ gate 順序 ＋ killswitch（production 403 を killswitch 評価前に固定）

`do_POST` に `kind` を読む分岐を入れ、gate を固定順（session→mode→ANTHROPIC→nisa killswitch）で通した後にのみ nisa ハンドラへ dispatch する。純関数 `nisa_gate` で「production は killswitch 評価前に 403」を機械証明する。

Files:
- Modify: `api/me/insight.py`
- Test: `tests/test_nisa_alloc.py` (Modify)

Interfaces:
- Consumes: env `NISA_ADVICE_ENABLED`。
- Produces:
  - env 定数 `NISA_ADVICE_ENABLED`（bool）・`NISA_MAX_TOKENS=_envint("NISA_MAX_TOKENS",1200)`・`NISA_RATE_WINDOW_MIN=_envint("NISA_RATE_WINDOW_MIN",10)`・`NISA_RATE_MAX=_envint("NISA_RATE_MAX_PER_WINDOW",30)`・`NISA_COOLDOWN_SEC=_envint("NISA_COOLDOWN_SEC",4)`。
  - `nisa_gate(valid_session: bool, mode: str, has_key: bool, killswitch: bool) -> (str, str|None)` — 返り値 `("ok",None)` / `("401","unauthorized")` / `("403","personal-only")` / `("503","not configured")` / `("403","nisa-advice-disabled")`。順序固定＝mode!=personal は killswitch より前。
  - `do_POST` で `kind = (req.get("kind") or "").strip()`。gate 通過後 `if kind == "nisa_allocation": return self._handle_nisa(cur, started)`（Task9 で本体）。既存 ticker 経路（`kind` 空/その他）は不変。

TDD steps:
- [ ] Step1 失敗テストを追加:
  ```python
  def test_nisa_gate_order_production_403_before_killswitch():
      # production は killswitch ON でも 403（状態を探れない＝killswitch 評価前に遮断）
      assert insight.nisa_gate(True, "production", True, True) == ("403", "personal-only")
      # 未認証は最優先で 401
      assert insight.nisa_gate(False, "personal", True, True) == ("401", "unauthorized")
      # personal + 鍵無は 503
      assert insight.nisa_gate(True, "personal", False, True) == ("503", "not configured")
      # personal + 鍵あり + killswitch off は nisa-advice-disabled（403）
      assert insight.nisa_gate(True, "personal", True, False) == ("403", "nisa-advice-disabled")
      # 全通過
      assert insight.nisa_gate(True, "personal", True, True) == ("ok", None)
  ```
- [ ] Step2 失敗確認: `... -m pytest tests/test_nisa_alloc.py -v` → `AttributeError: ... 'nisa_gate'` で FAIL。
- [ ] Step3 最小実装（`insight.py`）: 定数節に env 定数を追加:
  ```python
  NISA_PROMPT_VERSION = "nisa-alloc-v1"
  NISA_MAX_TOKENS = _envint("NISA_MAX_TOKENS", 1200)
  NISA_RATE_WINDOW_MIN = _envint("NISA_RATE_WINDOW_MIN", 10)
  NISA_RATE_MAX = _envint("NISA_RATE_MAX_PER_WINDOW", 30)
  NISA_COOLDOWN_SEC = _envint("NISA_COOLDOWN_SEC", 4)

  def _nisa_killswitch():
      return os.environ.get("NISA_ADVICE_ENABLED", "").strip().lower() in ("1", "true", "on")

  def nisa_gate(valid_session, mode, has_key, killswitch):
      if not valid_session:
          return ("401", "unauthorized")
      if mode != "personal":
          return ("403", "personal-only")     # production 完全遮断＝killswitch 評価前
      if not has_key:
          return ("503", "not configured")
      if not killswitch:
          return ("403", "nisa-advice-disabled")
      return ("ok", None)
  ```
  `do_POST` を最小改修: body パース直後に `kind = (req.get("kind") or "").strip() if isinstance(req, dict) else ""` を追加。既存の gate ブロック（`_valid_session`→`mode!=personal`→ANTHROPIC）は共有のまま活かし、その ANTHROPIC 判定の**直後**に:
  ```python
                  if kind == "nisa_allocation":
                      if not _nisa_killswitch():
                          return self._json(403, {"error": "nisa-advice-disabled"})
                      return self._handle_nisa(cur, started)
  ```
  を挿入（既存 `if not ticker:` 以降の ticker 経路は kind 空のとき従来どおり）。`_handle_nisa` は Task9 で実装（この Task では `return self._respond(mode, None, "not_applicable", applicable=False)` の暫定スタブでよいが、Task9 で置換する旨コメント）。
- [ ] Step4 成功確認: `... -m pytest tests/test_nisa_alloc.py tests/test_insight_facts.py -v` → gate テスト passed ＋ 既存 insight 緑（ticker 経路回帰なし）。
- [ ] Step5 commit: `git add api/me/insight.py tests/test_nisa_alloc.py && git commit -m "planB Task8: kind dispatch + fixed gate order (prod 403 before killswitch) + nisa env"`

---

### Task 9: nisa ハンドラ本体＋200 レスポンス整形（resolvedRefs join・conditional 強制・degrade）

`_handle_nisa` を実装: `me.mcc_state`＋ledger を読み `_nisa_raw` で残枠算出（未設定は decline）→`_read_eligible_products`→rate/cooldown→LLM→`parse_nisa_ai`→`nisa_prose_clean`→200 整形。純関数 `build_nisa_response`（resolvedRefs の id→name join・conditional 免責注入・cap 截断 cautions）をテストする。

Files:
- Modify: `api/me/insight.py`
- Test: `tests/test_nisa_alloc.py` (Modify)

Interfaces:
- Consumes: `build_eligible_products`/`eligible_ids`/`parse_nisa_ai`/`nisa_prose_clean`/`coarsen_nisa_facts`（Task3-7）・`_call_llm(system, user, NISA_MAX_TOKENS)`（Task2 で max_tokens 引数を追加済＝topFix #2）。
- Produces:
  - `NISA_CONDITIONAL_DISCLAIMER: str`（固定文＝成長枠取扱いは証券会社依存）。
  - `build_nisa_response(deterministic, ai: dict|None, ai_status: str, products: list, eligible: set, truncated: dict) -> dict` — 返り値 `{"deterministic", "ai", "aiStatus", "resolvedRefs": [{"id","name","extra","status"}]}`。resolvedRefs は ai の tsumitate/growth refs を products から join。解決 growth ref に `status=='conditional'` があれば `ai["growth_candidates"]["conditionalDisclaimer"]` を `NISA_CONDITIONAL_DISCLAIMER` で強制上書き（プロンプト非依存）。cap 截断（`truncated`）時は cautions に非網羅注記を append。
  - `_handle_nisa(self, cur, started) -> None`（handler メソッド・DB/LLM 統合。personal 前提＝gate 通過後のみ到達）。

TDD steps:
- [ ] Step1 失敗テストを追加:
  ```python
  def test_build_nisa_response_resolves_refs_and_injects_conditional():
      out = insight.build_eligible_products([_ts(1, "つみA")], [_gw("AAPL", "US", "conditional")])
      elig = insight.eligible_ids(out["products"])
      ai = {"headline": "h", "newMoneyNote": "新規のみ",
            "tsumitate_plan": {"note": "n", "refs": ["ts:1"]},
            "growth_candidates": {"note": "g", "refs": ["gw:AAPL"], "conditionalDisclaimer": ""},
            "taxable_note": "t", "cautions": ["損益通算不可"]}
      resp = insight.build_nisa_response({"text": "x"}, ai, "ok", out["products"], elig,
                                         {"tsumitate_truncated": False, "growth_truncated": False})
      byid = {r["id"]: r for r in resp["resolvedRefs"]}
      assert byid["ts:1"]["name"] == "つみA" and byid["gw:AAPL"]["status"] == "conditional"
      assert resp["ai"]["growth_candidates"]["conditionalDisclaimer"] == insight.NISA_CONDITIONAL_DISCLAIMER

  def test_build_nisa_response_truncation_appends_caution():
      out = insight.build_eligible_products([_ts(1, "A")], [])
      elig = insight.eligible_ids(out["products"])
      ai = {"headline": "h", "newMoneyNote": "新規のみ", "tsumitate_plan": {"note": "n", "refs": ["ts:1"]},
            "growth_candidates": {"note": "", "refs": [], "conditionalDisclaimer": ""},
            "taxable_note": "", "cautions": ["損益通算不可"]}
      resp = insight.build_nisa_response({}, ai, "ok", out["products"], elig,
                                         {"tsumitate_truncated": True, "growth_truncated": False})
      assert any("網羅" in c or "全" in c for c in resp["ai"]["cautions"])   # 非網羅注記が追加される

  def test_build_nisa_response_degrade_null_ai():
      resp = insight.build_nisa_response({"x": 1}, None, "degraded", [], set(), {"tsumitate_truncated": False, "growth_truncated": False})
      assert resp["ai"] is None and resp["resolvedRefs"] == [] and resp["aiStatus"] == "degraded"
  ```
- [ ] Step2 失敗確認: `... -m pytest tests/test_nisa_alloc.py -v` → `AttributeError: ... 'build_nisa_response'` で FAIL。
- [ ] Step3 最小実装（`insight.py`）:
  ```python
  NISA_CONDITIONAL_DISCLAIMER = (
      "※成長投資枠での取扱いは証券会社により異なります。ご利用の証券会社の対象銘柄をご確認ください。")

  def build_nisa_response(deterministic, ai, ai_status, products, eligible, truncated):
      if ai is None:
          return {"deterministic": deterministic, "ai": None, "aiStatus": ai_status, "resolvedRefs": []}
      byid = {p["id"]: p for p in (products or [])}
      ref_ids = list((ai.get("tsumitate_plan") or {}).get("refs") or []) + \
                list((ai.get("growth_candidates") or {}).get("refs") or [])
      resolved, seen = [], set()
      for rid in ref_ids:
          if rid in byid and rid not in seen:
              p = byid[rid]; seen.add(rid)
              resolved.append({"id": p["id"], "name": p["name"], "extra": p["extra"], "status": p["status"]})
      # US conditional 強制注入（描画層 = サーバの status 列根拠・プロンプト非依存）。
      if any(r["id"].startswith("gw:") and r["status"] == "conditional" for r in resolved):
          gc = dict(ai.get("growth_candidates") or {})
          gc["conditionalDisclaimer"] = NISA_CONDITIONAL_DISCLAIMER
          ai = {**ai, "growth_candidates": gc}
      # cap 截断時は非網羅注記を cautions に追加。
      if truncated.get("tsumitate_truncated") or truncated.get("growth_truncated"):
          cautions = list(ai.get("cautions") or [])
          cautions.append("表示は全適格商品を網羅していません（一部のみ）。")
          ai = {**ai, "cautions": cautions}
      return {"deterministic": deterministic, "ai": ai, "aiStatus": ai_status, "resolvedRefs": resolved}
  ```
  `_handle_nisa`（handler メソッド・Task8 のスタブを置換）:
  ```python
      def _handle_nisa(self, cur, started):
          import hashlib as _h
          token = _cookie_token(self.headers)
          session_hash = _h.sha256((token or "").encode("utf-8")).hexdigest()
          cur.execute("SELECT state FROM me.mcc_state WHERE id = 1")
          row = cur.fetchone()
          raw_state = row[0] if row and isinstance(row[0], dict) else {}
          cur.execute("SELECT extract(epoch from now()) * 1000")
          now_ms = float(cur.fetchone()[0])
          ledger_rows = None
          try:
              cur.execute("SELECT period, nisa_tsumitate_delta, nisa_growth_delta, "
                          "nisa_tsumitate_sold_at_cost, nisa_growth_sold_at_cost "
                          "FROM me.investment_snapshots ORDER BY period DESC LIMIT 120")
              ledger_rows = [{"period": r[0].isoformat() if hasattr(r[0], "isoformat") else r[0],
                              "nisa_tsumitate_delta": r[1], "nisa_growth_delta": r[2],
                              "nisa_tsumitate_sold_at_cost": r[3], "nisa_growth_sold_at_cost": r[4]}
                             for r in cur.fetchall()]
          except Exception:
              ledger_rows = None
          nisa_raw = _nisa_raw(raw_state, now_ms, ledger_rows)
          det = {"note": "NISA残枠に応じた口座配分の考え方は下の教育原則をご参照ください。"}
          if nisa_raw is None:   # NISA 未設定＝残枠不明 → 決定論 decline（残枠依存の順位付けを出さない）
              self._log_and_respond(cur, session_hash, None, det, None, "not_configured", [], set(), 0)
              return
          bundle = _read_eligible_products(cur)
          products, eligible = bundle["products"], eligible_ids(bundle["products"])
          counts = {"tsumitate": sum(1 for p in products if p["kind"] == "tsumitate"),
                    "growth": sum(1 for p in products if p["kind"] == "growth")}
          # rate → cooldown（advice/insight 同順・nisa_log 独立窓）。
          cur.execute("SELECT count(*) FROM me.nisa_log WHERE created_at > now() - make_interval(mins => %s)",
                      (NISA_RATE_WINDOW_MIN,))
          if cur.fetchone()[0] >= NISA_RATE_MAX:
              return self._json(429, {"error": "too many requests"})
          cur.execute("SELECT 1 FROM me.nisa_log WHERE ai_status IN ('ok','failed','refusal','truncated','filtered') "
                      "AND created_at > now() - make_interval(secs => %s) LIMIT 1", (NISA_COOLDOWN_SEC,))
          if cur.fetchone():
              self._log_and_respond(cur, session_hash, nisa_raw, det, None, "cooldown", products, eligible, 0)
              return
          status, parsed = "ok", None
          try:
              text, stop, _rid, _u = _call_llm(SYS_NISA_ALLOC, _build_nisa_user(nisa_raw, products, counts), NISA_MAX_TOKENS)
              if stop == "max_tokens":
                  status = "truncated"
              elif stop not in ("end_turn", None):
                  status = "refusal"
              else:
                  parsed = parse_nisa_ai(text, eligible)
                  if parsed is None:
                      status = "failed"
                  elif not nisa_prose_clean(parsed, _market_terms(cur)):
                      parsed, status = None, "filtered"
          except Exception as e:  # noqa: BLE001
              print(f"nisa LLM error: {type(e).__name__}", file=sys.stderr)
              status, parsed = "failed", None
          self._log_and_respond(cur, session_hash, nisa_raw, det, parsed, status, products, eligible,
                                bundle)

      def _log_and_respond(self, cur, session_hash, nisa_raw, det, parsed, status, products, eligible, truncated):
          refs_count = 0
          if isinstance(parsed, dict):
              refs_count = len((parsed.get("tsumitate_plan") or {}).get("refs") or []) + \
                           len((parsed.get("growth_candidates") or {}).get("refs") or [])
          trunc = truncated if isinstance(truncated, dict) else {"tsumitate_truncated": False, "growth_truncated": False}
          _log_nisa(cur, session_hash, nisa_raw, status, refs_count,
                    None if status == "ok" else status)
          resp = build_nisa_response(det, parsed if status == "ok" else None, status, products, eligible, trunc)
          return self._json(200, {**resp, "generatedAt": datetime.now(timezone.utc).isoformat()})
  ```
  （`_cookie_token`/`_json` は insight.py 既存。`_call_llm` は Task2 で `max_tokens` 引数を追加済＝ここで `NISA_MAX_TOKENS` を渡して初めて NISA_MAX_TOKENS が実効化する（topFix #2）。`build_nisa_response` の `truncated` 引数は `_read_eligible_products` の返り dict をそのまま渡す＝`tsumitate_truncated`/`growth_truncated` キーを持つ。）
- [ ] Step4 成功確認: `... -m pytest tests/test_nisa_alloc.py -v` → 追加 3 テスト passed（DB/LLM 非依存の純関数部）。
- [ ] Step5 commit: `git add api/me/insight.py tests/test_nisa_alloc.py && git commit -m "planB Task9: _handle_nisa + build_nisa_response (resolvedRefs join, conditional force, degrade)"`

---

### Task 10: UI — `money.js` nisaSection に助言カード（capability 可視ゲート・DISCLAIMER 常時・resolvedRefs join）

`money-rules.js` に決定論 decline 教育文言（§8・商品名なし）を単一源で足し、`money.js` の `nisaSection`（`money.js:1198`）に助言カードを追加する（`adviceSection`（`money.js:568`）と同型の構造＝ルール文言＋AI ブロック＋ボタン＋err＋DISCLAIMER）。capability `nisaAdviceEnabled` を `/api/auth/session` probe（`detail.js:234-246` の `probeInsightCap`/`_insightCap` パターン）で取得し fail-closed 可視ゲート（`cap.ok && cap.nisaAdviceEnabled` の AND＝OFF で痕跡ゼロ・`detail.js:820` の可視ゲートと同型）。DISCLAIMER 常時同梱・商品表示名は 200 レスポンスの `resolvedRefs` から id→name join。

Files:
- Modify: `money-rules.js`
- Modify: `money.js`
- Test: `tests/money-rules.test.js` (Modify)

Interfaces:
- Consumes: 200 レスポンス `{deterministic, ai, aiStatus, resolvedRefs}`（Task9）・capability `nisaAdviceEnabled`（Task1）。
- Produces:
  - `money-rules.js`: `nisaAllocEducation() -> str`（§8 教育原則・商品名を含まない決定論 decline 文言）を追加し `return` オブジェクトに `nisaAllocEducation: nisaAllocEducation` を export（`DISCLAIMER: DISCLAIMER,` の並び）。
  - `money.js`（すべて IIFE クロージャ内）:
    - 状態変数（`var advice` 近傍・money.js:27-34）: `var nisaAdvice = null; var nisaAdviceBusy = false; var nisaAdviceErr = ""; var _nisaCap = null;`。
    - `probeNisaCap() -> Promise<{ok, insightEnabled, nisaAdviceEnabled}>`＝`/api/auth/session` を叩き成功時のみ `_nisaCap` にキャッシュ（negative は非キャッシュ＝mid-session login を再 probe で拾う・`detail.js:234-246` 同型）。
    - `requestNisaAdvice()`＝`flushNow()`→`apiJSON("POST","/api/me/insight",{kind:"nisa_allocation"})`（`requestAdvice` fe-4 同型＝401/403/429/503/一過性 出し分け・状態変数 `nisaAdvice`/`nisaAdviceBusy`/`nisaAdviceErr`）。
    - `nisaAdviceCard(vm) -> str`＝`if (!(_nisaCap && _nisaCap.ok && _nisaCap.nisaAdviceEnabled)) return "";`（fail-closed 可視ゲート）。DISCLAIMER（`esc(R.DISCLAIMER)`）常時・`R.nisaAllocEducation()` 決定論文言・`nisaAdvice.ai` の note/cautions/conditionalDisclaimer 描画・`resolvedRefs` を id→name join で商品名表示。
    - `MCC` export（money.js:1659-1669）に `requestNisaAdvice: requestNisaAdvice,` を追加。
    - `nisaSection` の最終 `return`（money.js:1397-1401）を `bodyHtml + inputHtml + nisaAdviceCard(vm)` に変更。
    - `show()`（money.js:431）で `probeNisaCap().then(...render)` を配線（成功のみキャッシュ＝再 probe で mid-session login を拾う）。

TDD steps:
- [ ] Step1 失敗テストを追加（`tests/money-rules.test.js` の**末尾へ append**。ファイル冒頭で `test`/`assert`(=`node:assert/strict`)/`R`(=`require("../money-rules.js")`) は既に宣言済みゆえ **再 require しない**・`test(...)` ブロックだけ足す）:
  ```javascript
  test("nisaAllocEducation is product-name-free institutional text", () => {
    const t = R.nisaAllocEducation();
    assert.ok(typeof t === "string" && t.length > 0);
    assert.ok(t.includes("損益通算") || t.includes("非課税"));   // §8 教育原則
    assert.ok(!/ファンド|eMAXIS|オルカン|インデックス/.test(t)); // 商品名/商品語を含まない（層1 公開クライアント）
  });
  ```
- [ ] Step2 失敗確認: `cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4 && NODE_PATH=/home/shugo/node_modules node --test tests/money-rules.test.js` → `nisaAllocEducation is not a function` で FAIL。
- [ ] Step3 最小実装:
  - `money-rules.js`（`DISCLAIMER` 付近＝単一源ゾーンに）:
    ```javascript
    // B#3 Stage4b: NISA 口座配置の決定論 decline 教育文言（§8・商品名を含まない＝層1 公開クライアント常駐可）。
    function nisaAllocEducation() {
      return "NISA枠は損益通算・繰越控除ができず、下振れ時の税務救済がありません。米国株配当は外国税額控除が使えない点にも注意します。"
        + "非課税メリットが大きい長期保有・分配課税の重い資産を優先的に非課税枠へ寄せる考え方が基本ですが、"
        + "売却予定・含み損益・投資期間を踏まえてご自身で判断してください。具体的な適格商品の候補はログイン後に表示されます。";
    }
    ```
    export オブジェクトに `nisaAllocEducation: nisaAllocEducation,` を追加（`DISCLAIMER: DISCLAIMER,` の並び）。
  - `money.js`（No-Placeholders・実ソースに厳密準拠。挿入位置を明示）:
    - **(a) 状態変数**（money.js:27-34 の `var advice = null; var adviceBusy = false; var adviceErr = "";` の直後に追加）:
      ```javascript
      var nisaAdvice = null;       // 直近の 200 レスポンス {deterministic, ai, aiStatus, resolvedRefs}（fe-4 同型で温存）
      var nisaAdviceBusy = false;
      var nisaAdviceErr = "";
      var _nisaCap = null;         // {ok, insightEnabled, nisaAdviceEnabled}（probe 済み・成功のみキャッシュ）
      ```
    - **(b) probeNisaCap**（`checkSession`（money.js:247）付近に追加＝detail.js:234-246 の probeInsightCap 同型・capability を 1 キーだけ拡張）:
      ```javascript
      // B#3 Stage4b: NISA 助言 capability probe（detail.js probeInsightCap 234-246 同型）。
      //  /api/auth/session を叩き {ok, insightEnabled, nisaAdviceEnabled} を成功時のみキャッシュ。
      //  production(非personal)/killswitch OFF では nisaAdviceEnabled=false → 可視ゲートで完全非描画（痕跡ゼロ）。
      //  fetch 失敗/非2xx はすべて fail-closed（nisaAdviceEnabled:false）で隠す側に倒す。
      function probeNisaCap() {
        if (_nisaCap && _nisaCap.ok) return Promise.resolve(_nisaCap);   // 成功のみ短絡（negative は毎回再 probe）
        return fetch("/api/auth/session", { credentials: "same-origin" })
          .then(function (r) { return r.ok ? r.json() : { ok: false, nisaAdviceEnabled: false }; })
          .then(function (j) {
            var cap = { ok: !!j.ok, insightEnabled: !!j.insightEnabled, nisaAdviceEnabled: !!j.nisaAdviceEnabled };
            if (cap.ok) _nisaCap = cap;   // 成功のみキャッシュ（未ログイン/失敗はキャッシュせず mid-session login を拾う）
            return cap;
          })
          .catch(function () { return { ok: false, nisaAdviceEnabled: false }; });
      }
      ```
    - **(c) requestNisaAdvice**（`requestAdvice`（money.js:139-158）の直後に追加＝fe-4 出し分けを踏襲。403 は capability 失効ゆえ再 probe で隠す）:
      ```javascript
      // B#3 Stage4b: NISA 口座配分助言をオンデマンド取得。最新 state を Neon へ反映してからサーバに集約・LLM させる。
      function requestNisaAdvice() {
        if (nisaAdviceBusy) return;
        if (!sync.loggedIn) { nisaAdvice = null; nisaAdviceErr = "セッションが切れました。再ログインしてください"; render(); return; }
        nisaAdviceBusy = true; nisaAdviceErr = ""; render();
        flushNow().then(function () {
          return apiJSON("POST", "/api/me/insight", { kind: "nisa_allocation" });
        }).then(function (res) {
          nisaAdviceBusy = false;
          // fe-4: 401 以外（403/429/503/一過性）は直前の良好な助言を破棄せず nisaAdviceErr のみ表示。
          if (res.status === 401) { sync.loggedIn = false; nisaAdvice = null; nisaAdviceErr = "セッションが切れました。再ログインしてください"; }
          else if (res.status === 403) { nisaAdvice = null; nisaAdviceErr = ""; _nisaCap = null; }   // capability 失効＝可視ゲートで隠す（次 probe で再判定）
          else if (res.status === 429) { nisaAdviceErr = "短時間に相談が多すぎます。少し待って再試行してください"; }
          else if (res.status === 503) { nisaAdviceErr = "AIコーチは未設定です（教育原則は上に表示）"; }
          else if (!res.ok || !res.data) { nisaAdviceErr = "候補の取得に失敗しました"; }
          else { nisaAdvice = res.data; nisaAdvice._stateTs = (state && Number(state.updatedAt)) || 0; }
          render();
        }).catch(function () { nisaAdviceBusy = false; nisaAdviceErr = "通信エラー"; render(); });
      }
      ```
    - **(d) nisaAdviceCard**（`nisaSection`（money.js:1198）の直前に追加＝adviceSection 568-609 と同型の構造。fail-closed 可視ゲートは detail.js:820 と同型の AND）:
      ```javascript
      // B#3 Stage4b: NISA 口座配分助言カード（capability 可視ゲート・DISCLAIMER 常時・resolvedRefs で id→name join）。
      //  fail-closed＝probe 未完/未ログイン/killswitch OFF では空文字＝痕跡ゼロ（detail.js wireInsightCard 820 同型）。
      function nisaAdviceCard(vm) {
        if (!(_nisaCap && _nisaCap.ok && _nisaCap.nisaAdviceEnabled)) return "";   // 可視ゲート (cap.ok && nisaAdviceEnabled)
        var edu = '<div class="mcc-nisa-alloc-edu">' + esc(R.nisaAllocEducation()) + '</div>';
        var aiHtml = '';
        if (nisaAdvice && nisaAdvice.ai) {
          var a = nisaAdvice.ai;
          var byId = {};
          (nisaAdvice.resolvedRefs || []).forEach(function (r) { byId[r.id] = r; });   // resolvedRefs で id→name join（LLM は表示名を出さない）
          var nameList = function (refs) {
            return (refs || []).map(function (id) { return byId[id] ? esc(byId[id].name) : ""; })
              .filter(function (s) { return s; }).join("・");
          };
          var tp = a.tsumitate_plan || {}, gc = a.growth_candidates || {};
          var tsNames = nameList(tp.refs), gwNames = nameList(gc.refs);
          var cond = gc.conditionalDisclaimer ? '<div class="mcc-nisa-alloc-cond">' + esc(gc.conditionalDisclaimer) + '</div>' : '';
          var cautions = (a.cautions || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join("");
          aiHtml =
            '<div class="mcc-nisa-alloc-ai">' +
              '<div class="mcc-nisa-alloc-head">' + esc(a.headline || "") + '</div>' +
              '<div class="mcc-nisa-alloc-note">' + esc(a.newMoneyNote || "") + '</div>' +
              (tp.note ? '<div class="mcc-nisa-alloc-block"><div class="mcc-nisa-alloc-blabel">つみたて投資枠</div><div>' + esc(tp.note) + '</div>' +
                (tsNames ? '<div class="mcc-nisa-alloc-prods">' + tsNames + '</div>' : '') + '</div>' : '') +
              (gc.note ? '<div class="mcc-nisa-alloc-block"><div class="mcc-nisa-alloc-blabel">成長投資枠</div><div>' + esc(gc.note) + '</div>' +
                (gwNames ? '<div class="mcc-nisa-alloc-prods">' + gwNames + '</div>' : '') + cond + '</div>' : '') +
              (a.taxable_note ? '<div class="mcc-nisa-alloc-block"><div class="mcc-nisa-alloc-blabel">課税口座</div><div>' + esc(a.taxable_note) + '</div></div>' : '') +
              (cautions ? '<ul class="mcc-nisa-alloc-cautions">' + cautions + '</ul>' : '') +
            '</div>';
        } else if (nisaAdvice && !nisaAdvice.ai) {
          // degrade（LLM 失敗/cooldown/残枠未設定）＝教育原則のみ（商品名なし・層1 文言）。
          var why = nisaAdvice.aiStatus === "cooldown" ? "少し時間を置いてから、もう一度お試しください。"
            : nisaAdvice.aiStatus === "not_configured" ? "NISA残枠が未設定です。上で残枠を入力すると候補を出せます。"
            : "候補は今取得できませんでした（教育原則は上に表示）。";
          aiHtml = '<div class="mcc-nisa-alloc-ai mcc-nisa-alloc-ai-muted">' + esc(why) + '</div>';
        }
        var btn = sync.loggedIn
          ? '<button class="mcc-nisa-alloc-btn" onclick="MCC.requestNisaAdvice()"' + (nisaAdviceBusy ? ' disabled' : '') + '>' +
              (nisaAdviceBusy ? '取得中…' : (nisaAdvice ? '再取得' : '口座配分の候補を見る')) + '</button>'
          : '<span class="mcc-nisa-alloc-login">ログインすると適格商品の候補を表示できます</span>';
        var err = nisaAdviceErr ? '<div class="mcc-nisa-alloc-err">' + esc(nisaAdviceErr) + '</div>' : '';
        var disc = '<div class="mcc-nisa-alloc-disclaimer">' + esc(R.DISCLAIMER) + '</div>';   // 常時同梱（fail-closed 免責）
        return '<div class="mcc-nisa-alloc">' +
          '<div class="mcc-section-title mcc-section-title-gap">口座振り分けの候補（個人モード）</div>' +
          '<div class="mcc-section-desc">新規資金をどの口座（つみたて/成長/課税）に置くかの候補です。売却・移し替えの助言ではありません。</div>' +
          edu + aiHtml +
          '<div class="mcc-nisa-alloc-actions">' + btn + '</div>' + err + disc +
        '</div>';
      }
      ```
    - **(e) nisaSection 連結**（money.js:1400 の最終 return の本文連結を書き換え）:
      ```javascript
      // 変更前: bodyHtml + inputHtml +
      // 変更後:
          bodyHtml + inputHtml + nisaAdviceCard(vm) +
      ```
    - **(f) MCC export**（money.js:1663 の `requestAdvice: requestAdvice, applySurplus: applySurplus,` 行の並びに追加）:
      ```javascript
          requestAdvice: requestAdvice, requestNisaAdvice: requestNisaAdvice, applySurplus: applySurplus,
      ```
    - **(g) show() 配線**（money.js:448 の `_sessionChecked` ブロックの直後・`show()` 末尾に追加）:
      ```javascript
          // B#3 Stage4b: NISA capability probe（成功のみキャッシュ＝再 probe で mid-session login を拾う）。
          probeNisaCap().then(function (cap) { if (cap.ok) render(); });
      ```
- [ ] Step4 成功確認: `cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4 && NODE_PATH=/home/shugo/node_modules node --test tests/money-rules.test.js` → passed。`money.js` は DOM 依存で実行できないため構文のみ確認: `node --check money.js` が exit 0。
- [ ] Step5 commit: `git add money-rules.js money.js tests/money-rules.test.js && git commit -m "planB Task10: nisaSection advice card (fail-closed cap gate, DISCLAIMER, resolvedRefs join) + product-free decline text"`

---

### Task 11: E2E 捏造貫通ゼロ パイプライン受入テスト（4a データ＋personal 経路の統合）

DB/LLM を介さず、eligible_products 構築→prompt→（捏造 ref・conditional ref・売却語を含む）擬似 LLM JSON→parse+whitelist→第2ベルト→200 整形 の全経路を stitch し、①捏造 ref が全て drop され resolvedRefs が実在適格商品のみに解決 ②conditional 免責が強制注入 ③cautions が描画 ④売却語混入は degrade、を機械証明する（spec §9 E2E の offline 版＝inert 段階で成立）。

Files:
- Test: `tests/test_nisa_alloc.py` (Modify)

Interfaces:
- Consumes: Task3-9 の全公開関数。
- Produces: なし（受入テストのみ）。

TDD steps:
- [ ] Step1 失敗テストを追加（新規 assert のみ・実装は既存関数の合成）:
  ```python
  def test_e2e_fabrication_zero_and_conditional_injected():
      out = insight.build_eligible_products([_ts(1, "つみA"), _ts(2, "つみB")],
                                            [_gw("7203", "JP", "eligible"), _gw("AAPL", "US", "conditional")])
      products, elig = out["products"], insight.eligible_ids(out["products"])
      # 擬似 LLM 応答: 実在 ts:1 / gw:AAPL + 捏造 ts:999・gw:FAKE・prefix 不整合 gw:1
      llm = json.dumps({
          "headline": "新規資金の配分",
          "newMoneyNote": "新規資金の配分のみで売却指示ではありません",
          "tsumitate_plan": {"note": "つみたて枠を優先的に埋めます", "refs": ["ts:1", "ts:999"]},
          "growth_candidates": {"note": "成長枠の候補です", "refs": ["gw:AAPL", "gw:FAKE", "gw:1"], "conditionalDisclaimer": ""},
          "taxable_note": "課税口座は損益通算ができます",
          "cautions": ["損益通算・繰越控除ができません", "下振れ時の税務救済はありません"],
      }, ensure_ascii=False)
      parsed = insight.parse_nisa_ai(llm, elig)
      assert parsed is not None
      assert parsed["newMoneyNote"] == insight.NISA_NEW_MONEY_NOTE  # topFix #1: サーバ固定文注入（売却動詞ガードと非衝突）
      assert parsed["tsumitate_plan"]["refs"] == ["ts:1"]        # ts:999 捏造を drop
      assert parsed["growth_candidates"]["refs"] == ["gw:AAPL"]  # gw:FAKE 捏造 / gw:1 prefix 不整合を drop
      assert insight.nisa_prose_clean(parsed, {"tickers": set(), "names": []}) is True
      resp = insight.build_nisa_response({}, parsed, "ok", products, elig, out)
      ids = {r["id"] for r in resp["resolvedRefs"]}
      assert ids == {"ts:1", "gw:AAPL"}                          # 実在適格のみ解決（捏造ゼロ）
      assert {r["name"] for r in resp["resolvedRefs"]} == {"つみA", "AAPL社"}  # id→name join
      assert resp["ai"]["growth_candidates"]["conditionalDisclaimer"] == insight.NISA_CONDITIONAL_DISCLAIMER
      assert resp["ai"]["cautions"]                               # cautions 描画

  def test_e2e_sell_verb_slips_in_degrades():
      out = insight.build_eligible_products([_ts(1, "つみA")], [])
      elig = insight.eligible_ids(out["products"])
      llm = json.dumps({
          "headline": "配分", "newMoneyNote": "新規資金のみ",
          "tsumitate_plan": {"note": "含み損の課税口座分を売却してNISAへ移し替えます", "refs": ["ts:1"]},
          "growth_candidates": {"note": "", "refs": [], "conditionalDisclaimer": ""},
          "taxable_note": "", "cautions": ["損益通算不可"]}, ensure_ascii=False)
      parsed = insight.parse_nisa_ai(llm, elig)
      assert parsed is not None                                   # 構造は通る
      assert insight.nisa_prose_clean(parsed, {"tickers": set(), "names": []}) is False  # 売却語で degrade
  ```
- [ ] Step2 失敗確認: `... -m pytest tests/test_nisa_alloc.py::test_e2e_fabrication_zero_and_conditional_injected -v` → 既存実装で通る想定だが、まず未実装分岐があれば FAIL を観測（本 Task は Task3-9 完了後に走らせ、通らなければ該当 Task の欠陥として戻る）。
- [ ] Step3 最小実装: 追加コード無し（Task3-9 の合成で成立）。もし FAIL したら根本原因を該当 Task で修正（このステップでは新規プロダクションコードを足さない＝受入が既存実装の正しさを検証する意図）。
- [ ] Step4 成功確認: `cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4 && /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_nisa_alloc.py -v && NODE_PATH=/home/shugo/node_modules node --test tests/money-rules.test.js` → 全 nisa テスト passed ＋ money-rules 緑。加えて回帰: `/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_advice_facts.py tests/test_insight_facts.py -v` が緑。
- [ ] Step5 commit: `git add tests/test_nisa_alloc.py && git commit -m "planB Task11: E2E offline pipeline acceptance (fabrication-zero, conditional inject, sell-verb degrade)"`

---

## 実装後の運用メモ（plan 外・実行者向け）

- 本番投入は killswitch OFF（`NISA_ADVICE_ENABLED` 未設定）・production 403 で痕跡ゼロ。`me.nisa_log` migration は手動適用（`.vercelignore` が `*.sql` 非配信）。破壊系適用時は日本語で安全根拠を併記（`CREATE TABLE IF NOT EXISTS`＝既存 0 影響・非破壊）。
- persona で `NISA_ADVICE_ENABLED=1`（＋既存 `ADVICE_MODE=personal`）を設定後に本人実機受入。両 URL（通常/persona）で `/money.js`・`/money-rules.js` を直接 curl して反映確認（`/` を grep しても markers は出ない）。
