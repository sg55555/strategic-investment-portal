# W3「司令室PFMパック」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お金の司令室（`#money-view`）に「資産の推移（月次導出・SVG）」「前月比バッジ」「runway チップ」「目標の達成見通し」「NISA・確保枠のリマインド帯」を、既存 state／API／facts を一切変えずに足す。

**Architecture:** 導出ロジックは全て `money-rules.js` の純関数（UI 専用・`modeAFacts` 非接触＝`advice.py` 鏡像義務なし）。`money.js` は `render()` 冒頭で1回だけ VM を作り、各セクションに**引数で**配って HTML 文字列を組む（既存の全再描画方式・`root.innerHTML` 差替）。グラフは inline SVG（`sparkline()` と同型・インスタンス管理なし）。検証は node ユニット（純関数）＋ Playwright 受入 `scratchpad/w3-smoke.js`（合成 fixture を返す `scratchpad/w3-mock-server.py` を `W3_VARIANTS=0` で配信）。

**Tech Stack:** Vanilla JS（ES5 風の `var`/`function`・UMD-lite）、CSS（theme D トークン `--c-*`）、node:test、Playwright（`NODE_PATH=/home/shugo/node_modules`）、Python 3 標準ライブラリ（モック鯖）。

**Spec:** `docs/superpowers/specs/2026-08-27-w3-cockpit-pfm-design.md`

## Global Constraints

- **非接触**: `index.html`／`api/**`／`db/**`／`scripts/**`／`tests/fixtures/advice_facts_cases.json`／`vercel.json`。`git diff --stat -- api/` は常に空。
- **無改変**: `money-rules.js` の既存関数（`defaultState`／`migrate`／`normalize*`／`modeAFacts`／`nisaFacts`／`cashflowDerived`／`cashDerived`／`effectiveState`／`reserveMonthly`）。追加のみ。
- **`FACTS_SCHEMA_VERSION` は 6 のまま**。`tests/test_advice_facts.py` 106 件・パリティ fixture 71 ケースは不変で緑。
- **`money.js` に業務 math を書かない**（判定・計算は `money-rules.js`）。`money.js` は文字列整形と DOM のみ。
- **`window.MCC` に新ハンドラを足したら return（`money.js` 末尾）に追記**（忘れると無音故障）。
- **localStorage の新キーは `mcc_series_period` のみ**・クラウド state に混ぜない。
- **文言は spec §7 を逐語**。指示・推奨語（「使い切るべき」「買い足しましょう」）禁止。マイナスは U+2212「−」。
- **既存 E2E `scratchpad/cockpit-e2e.js`（235）と `scratchpad/portal-money-smoke.js` は常に緑**（`.mcc-hero-amount` の中身は金額のみを維持）。
- テスト実行: `node --test tests/*.test.js`（末尾スラッシュ禁止）／pytest は `/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_advice_facts.py -q`（worktree に .venv は無い）。
- Playwright 系は `NODE_PATH=/home/shugo/node_modules node <script>`。
- コミットは worktree ブランチ `worktree-w3-cockpit-pfm` に小さく（push しない）。

---

## ファイル構成

| ファイル | 役割 | 変更 |
|---|---|---|
| `money-rules.js` | 純関数（系列・見通し・リマインド） | 追加（`cashflowViewModel` の後・`return {` の前） |
| `tests/money-pfm.test.js` | 新純関数のユニット | 新規 |
| `money.js` | 推移カード／ヒーロー差込／リマインド帯／fold 内の行／`setSeriesPeriod`／hover | 追加＋既存関数の引数追加 |
| `money.css` | `.mcc-series-*`／`.mcc-hero-mom`／`.mcc-hero-runway`／`.mcc-rail*`／`.mcc-*-outlook`／`.mcc-nisa-reminder` | 末尾に追加＋2規則変更 |
| `scratchpad/w3-mock-server.py` | 受入の配信役（`W3_VARIANTS=0` で注入停止） | 1箇所変更 |
| `scratchpad/w3-smoke.js` | Playwright 受入 | 新規 |
| `.claude/CLAUDE.md` | 司令室節に W3 の規律を追記 | 追記 |

---

### Task 1: 月次系列の純関数（`assetSeries`／`seriesWindow`／`momDelta`／`spanDelta`）

**Files:**
- Modify: `money-rules.js`（`cashflowViewModel` 終端＝`return {` の直前に追加／UMD return に追記）
- Test: `tests/money-pfm.test.js`（新規）

**Interfaces:**
- Consumes: 既存 `normalizeAnchor(a)`／`cashflowRows(rows)`／`cfNum`／`num`／`investable(s)`／`cashDerived(rows, invRows, anchor)`。
- Produces（後続 Task が使う）:
  - `R.SERIES_PERIODS: ["6M","1Y","2Y","ALL"]`
  - `R.normalizeSeriesPeriod(key) → "6M"|"1Y"|"2Y"|"ALL"`（未知は `"1Y"`）
  - `R.seriesWindow(points, key) → points[]`
  - `R.assetSeries(eff, cashflowRows, investmentRows) → { available, reason, anchorPeriod, points:[{period, cash, invest, total, isComplete, beforeAnchor, isAnchor}], truncatedForward, truncatedBackward, latestCompleteIndex, liveIndex }`
  - `R.momDelta(points) → { available, prevPeriod, curPeriod, delta, pct|null, sign }`
  - `R.spanDelta(points, months) → { available, delta, fromPeriod, toPeriod }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/money-pfm.test.js` を新規作成:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../money-rules.js");

// ---- fixture ヘルパ（整数のみ・決定論）----
// startYM="2024-06" から balances.length ヶ月の API 生行を作る。opts.partialLast=true なら末尾行を is_complete:false に。
function mkRows(startYM, balances, opts) {
  opts = opts || {};
  var y = parseInt(startYM.slice(0, 4), 10), m = parseInt(startYM.slice(5, 7), 10) - 1;
  return balances.map(function (bal, i) {
    var mm = m + i, yy = y + Math.floor(mm / 12); mm = ((mm % 12) + 12) % 12;
    var period = yy + "-" + ("0" + (mm + 1)).slice(-2) + "-01";
    return {
      period: period, total_income: 350000, salary_income: 350000, misc_income: 0,
      fixed_expense: 140000, variable_expense: 350000 - 140000 - bal, total_expense: 350000 - bal,
      balance: bal, savings_rate: 0, is_complete: !(opts.partialLast && i === balances.length - 1),
      breakdown: null, pulled_at: "2026-08-27T00:00:00Z",
    };
  });
}
function mkState(extra) {
  return R.migrate(Object.assign({
    version: 2, currency: "JPY", monthlyExpense: 220000, bufferMonths: 6,
    buckets: { buffer: { amount: 0 }, core: { amount: 600000 }, satellite: { amount: 0 } },
    satelliteCapPct: 10, goals: [], reserves: [], updatedAt: 1,
    anchor: { date: "2025-03-01", amount: 1000000 },
  }, extra || {}));
}
// 2024-06 〜 2026-02 の21ヶ月確定＋2026-03 暫定。アンカー 2025-03（index 9）。
const BAL = [50000, 60000, -20000, 70000, 80000, 30000, 40000, 90000, -10000, 60000, 70000, 50000, 80000, 20000, 60000, 90000, 30000, 70000, 40000, 60000, 50000, 15000];
const ROWS = mkRows("2024-06", BAL, { partialLast: true });
const EFF = mkState();

test("assetSeries: 前方累積＝アンカー月から確定行を足す（不変条件: 最後の確定点 cash === derivedCash）", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  assert.equal(s.available, true);
  assert.equal(s.anchorPeriod, "2025-03-01");
  const cd = R.cashDerived(ROWS, [], EFF.anchor);
  const lastComplete = s.points[s.latestCompleteIndex];
  assert.equal(lastComplete.period, "2026-02-01");
  assert.equal(lastComplete.cash, cd.derivedCash);
  assert.equal(s.liveIndex, s.points.length - 1);
  assert.equal(s.points[s.liveIndex].isComplete, false);
  assert.equal(s.points[s.liveIndex].cash, cd.derivedCashLive);
  assert.equal(s.truncatedForward, false);
});

test("assetSeries: アンカー点＝アンカー月初＝前月末 = anchor.amount（isAnchor・beforeAnchor）", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  const a = s.points.find((p) => p.isAnchor);
  assert.equal(a.period, "2025-02-01");
  assert.equal(a.cash, 1000000);
  assert.equal(a.beforeAnchor, true);
  assert.equal(a.isComplete, true);
  // アンカー月（2025-03）の点 = anchor.amount + flow(2025-03)
  const m = s.points.find((p) => p.period === "2025-03-01");
  assert.equal(m.cash, 1000000 + BAL[9]);
});

test("assetSeries: 後方累積＝前月末 = 当月末 − flow(当月)・period 昇順・invest は全点同値", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  const jan = s.points.find((p) => p.period === "2025-01-01");  // = 2025-02 末 − flow(2025-02)
  assert.equal(jan.cash, 1000000 - BAL[8]);
  const first = s.points[0];
  assert.equal(first.period, "2024-05-01");  // 2024-06 の行から逆算した 2024-05 末
  assert.equal(first.cash, 1000000 - BAL.slice(0, 9).reduce((a, b) => a + b, 0));
  for (let i = 1; i < s.points.length; i++) assert.ok(s.points[i - 1].period < s.points[i].period);
  assert.ok(s.points.every((p) => p.invest === 600000 && p.total === p.cash + 600000));
  assert.equal(s.truncatedBackward, false);
});

test("assetSeries: 欠月で打切（前方は truncatedForward・後方は truncatedBackward）", () => {
  const gapF = ROWS.filter((r) => r.period !== "2025-08-01");
  const sf = R.assetSeries(EFF, gapF, []);
  assert.equal(sf.truncatedForward, true);
  assert.equal(sf.points[sf.points.length - 1].period, "2025-07-01");
  const gapB = ROWS.filter((r) => r.period !== "2024-10-01");
  const sb = R.assetSeries(EFF, gapB, []);
  assert.equal(sb.truncatedBackward, true);
  assert.equal(sb.points[0].period, "2024-10-01");  // 2024-11 の行から逆算した 2024-10 末まで
});

test("assetSeries: 途中の暫定行は打切・末尾の暫定行だけ liveIndex", () => {
  const rows = ROWS.map((r) => (r.period === "2025-10-01" ? Object.assign({}, r, { is_complete: false }) : r));
  const s = R.assetSeries(EFF, rows, []);
  assert.equal(s.truncatedForward, true);
  assert.equal(s.liveIndex, -1);
  assert.equal(s.points[s.points.length - 1].period, "2025-09-01");
});

test("assetSeries: invest_cash_flow は cashDerived と同じく flow に合流", () => {
  const inv = [{ period: "2025-06-01", invest_cash_flow: -100000 }];
  const s = R.assetSeries(EFF, ROWS, inv);
  const cd = R.cashDerived(ROWS, inv, EFF.anchor);
  assert.equal(s.points[s.latestCompleteIndex].cash, cd.derivedCash);
  const jun = s.points.find((p) => p.period === "2025-06-01"), may = s.points.find((p) => p.period === "2025-05-01");
  assert.equal(jun.cash - may.cash, BAL[12] - 100000);
});

test("assetSeries: 非 available の reason", () => {
  assert.equal(R.assetSeries(mkState({ anchor: null }), ROWS, []).reason, "noAnchor");
  assert.equal(R.assetSeries(EFF, [], []).reason, "noRows");
  assert.equal(R.assetSeries(EFF, mkRows("2026-03", [1000], { partialLast: true }), []).reason, "noCompleteRows");
  assert.equal(R.assetSeries(mkState({ currency: "USD" }), ROWS, []).reason, "currency");
  assert.deepEqual(R.assetSeries(EFF, [], []).points, []);
});

test("seriesWindow / normalizeSeriesPeriod", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  assert.deepEqual(R.SERIES_PERIODS, ["6M", "1Y", "2Y", "ALL"]);
  assert.equal(R.seriesWindow(s.points, "6M").length, 6);
  assert.equal(R.seriesWindow(s.points, "1Y").length, 12);
  assert.equal(R.seriesWindow(s.points, "2Y").length, s.points.length);  // 23点 < 24
  assert.equal(R.seriesWindow(s.points, "ALL").length, s.points.length);
  assert.equal(R.seriesWindow(s.points, "6M")[5].period, s.points[s.points.length - 1].period);
  assert.equal(R.normalizeSeriesPeriod("bogus"), "1Y");
  assert.equal(R.normalizeSeriesPeriod(null), "1Y");
  assert.equal(R.normalizeSeriesPeriod("ALL"), "ALL");
});

test("momDelta: 直近2確定点の差・暫定点は無視・pct・符号", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  const m = R.momDelta(s.points);
  assert.equal(m.available, true);
  assert.equal(m.curPeriod, "2026-02-01");
  assert.equal(m.prevPeriod, "2026-01-01");
  assert.equal(m.delta, BAL[20]);
  assert.equal(m.sign, 1);
  const prev = s.points.find((p) => p.period === "2026-01-01");
  assert.ok(Math.abs(m.pct - (BAL[20] / prev.total) * 100) < 1e-9);
  assert.equal(R.momDelta([{ period: "2026-01-01", total: 1, isComplete: true }]).available, false);
  assert.equal(R.momDelta([{ period: "2025-12-01", total: 0, isComplete: true }, { period: "2026-01-01", total: 5, isComplete: true }]).pct, null);
  assert.equal(R.momDelta([{ period: "2025-12-01", total: 5, isComplete: true }, { period: "2026-01-01", total: 5, isComplete: true }]).sign, 0);
});

test("spanDelta: 最新確定点と months 個前の点", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  const d = R.spanDelta(s.points, 12);
  assert.equal(d.available, true);
  assert.equal(d.toPeriod, "2026-02-01");
  assert.equal(d.fromPeriod, "2025-02-01");
  assert.equal(d.delta, BAL.slice(9, 21).reduce((a, b) => a + b, 0));
  assert.equal(R.spanDelta(s.points, 100).available, false);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/money-pfm.test.js`
Expected: FAIL（`R.assetSeries is not a function` 等）

- [ ] **Step 3: 実装（`money-rules.js`・`cashflowViewModel` の閉じ `}` の直後、`  return {` の直前に挿入）**

```js
  // ==== W3 司令室PFMパック（spec docs/superpowers/specs/2026-08-27-w3-cockpit-pfm-design.md §3）====
  // すべて UI 専用の純関数（facts 非出力＝advice.py 鏡像なし）。時刻は呼び元（render）が1回取った nowMs を受ける。

  var SERIES_PERIODS = ["6M", "1Y", "2Y", "ALL"];
  var _SERIES_POINTS = { "6M": 6, "1Y": 12, "2Y": 24 };
  function normalizeSeriesPeriod(key) { return SERIES_PERIODS.indexOf(key) >= 0 ? key : "1Y"; }
  function seriesWindow(points, key) {
    var pts = Array.isArray(points) ? points : [];
    var n = _SERIES_POINTS[normalizeSeriesPeriod(key)];
    return n ? pts.slice(-n) : pts.slice();
  }
  // "YYYY-MM-01" を delta ヶ月ずらす（UTC 暦・純粋）。
  function _shiftYM(period, delta) {
    var y = parseInt(period.slice(0, 4), 10), m = parseInt(period.slice(5, 7), 10) - 1 + delta;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return String(y) + "-" + ("0" + (m + 1)).slice(-2) + "-01";
  }

  // §3.2 月次系列。アンカー月初の現金 = anchor.amount を固定点に、cashDerived と同じ flow（balance + invest_cash_flow）を
  // アンカー月以降は前方（+Σ）・アンカー月より前は後方（−Σ）に累積。連続月のみ（欠月で打切）。invest は現在値で固定。
  function assetSeries(eff, cashflowRows_in, investmentRows_in) {
    function empty(reason) {
      return { available: false, reason: reason, anchorPeriod: "", points: [],
        truncatedForward: false, truncatedBackward: false, latestCompleteIndex: -1, liveIndex: -1 };
    }
    if (!eff || typeof eff !== "object") return empty("noAnchor");
    var a = normalizeAnchor(eff.anchor);
    if (!a.date) return empty("noAnchor");
    if (eff.currency === "USD") return empty("currency");
    var rows = cashflowRows(cashflowRows_in);
    if (!rows.length) return empty("noRows");
    var byPeriod = {}, anyComplete = false;
    rows.forEach(function (rr) { byPeriod[rr.period] = rr; if (rr.isComplete) anyComplete = true; });
    if (!anyComplete) return empty("noCompleteRows");
    var icf = {};
    if (Array.isArray(investmentRows_in)) {
      investmentRows_in.forEach(function (r) { if (r && typeof r.period === "string") icf[r.period] = cfNum(r.invest_cash_flow); });
    }
    function flow(p) { return byPeriod[p].balance + (icf[p] || 0); }
    function pt(period, cash, isComplete, beforeAnchor, isAnchor) {
      return { period: period, cash: cash, invest: inv, total: cash + inv, isComplete: isComplete, beforeAnchor: beforeAnchor, isAnchor: isAnchor };
    }
    var inv = investable(eff);
    var anchorP = a.date, prevP = _shiftYM(anchorP, -1);
    var firstPeriod = rows[0].period, lastPeriod = rows[rows.length - 1].period;

    // 後方: P(prevP) = anchor.amount。P(p−1) = P(p) − flow(p)（行 p が確定なら）。
    var back = [], cash = a.amount, p = prevP, truncatedBackward = false;
    while (true) {
      var br = byPeriod[p];
      if (!br || !br.isComplete) { truncatedBackward = (p >= firstPeriod); break; }
      cash = cash - flow(p);
      p = _shiftYM(p, -1);
      back.push(pt(p, cash, true, true, false));
    }
    back.reverse();
    var points = back.concat([pt(prevP, a.amount, true, true, true)]);

    // 前方: P(anchorP) = anchor.amount + flow(anchorP) …。暫定行は末尾の1件だけ許す。
    var truncatedForward = false, liveIndex = -1;
    cash = a.amount; p = anchorP;
    while (true) {
      var fr = byPeriod[p];
      if (!fr) { truncatedForward = (p <= lastPeriod); break; }
      if (!fr.isComplete && p !== lastPeriod) { truncatedForward = true; break; }
      cash = cash + flow(p);
      points.push(pt(p, cash, fr.isComplete, false, false));
      if (!fr.isComplete) { liveIndex = points.length - 1; break; }
      p = _shiftYM(p, 1);
    }
    var latestCompleteIndex = -1;
    for (var i = points.length - 1; i >= 0; i--) { if (points[i].isComplete) { latestCompleteIndex = i; break; } }
    return { available: true, reason: "", anchorPeriod: anchorP, points: points,
      truncatedForward: truncatedForward, truncatedBackward: truncatedBackward,
      latestCompleteIndex: latestCompleteIndex, liveIndex: liveIndex };
  }

  // §3.3 前月比＝直近2つの確定点の total 差。
  function momDelta(points) {
    var pts = (Array.isArray(points) ? points : []).filter(function (q) { return q && q.isComplete; });
    if (pts.length < 2) return { available: false, prevPeriod: "", curPeriod: "", delta: 0, pct: null, sign: 0 };
    var prev = pts[pts.length - 2], cur = pts[pts.length - 1];
    var d = cur.total - prev.total;
    return { available: true, prevPeriod: prev.period, curPeriod: cur.period, delta: d,
      pct: prev.total !== 0 ? (d / prev.total) * 100 : null, sign: d > 0 ? 1 : (d < 0 ? -1 : 0) };
  }
  // §3.3 最新確定点と months 個前の点の total 差（fold digest の「直近12ヶ月」・選択窓に依存しない）。
  function spanDelta(points, months) {
    var pts = Array.isArray(points) ? points : [];
    var n = Math.max(1, Math.floor(num(months)));
    var ci = -1;
    for (var i = pts.length - 1; i >= 0; i--) { if (pts[i] && pts[i].isComplete) { ci = i; break; } }
    if (ci < 0 || ci - n < 0) return { available: false, delta: 0, fromPeriod: "", toPeriod: "" };
    return { available: true, delta: pts[ci].total - pts[ci - n].total, fromPeriod: pts[ci - n].period, toPeriod: pts[ci].period };
  }
```

UMD return（`money-rules.js` 末尾の `return {` ブロック）の最後、`nisaAvailableYears: nisaAvailableYears,` の直後に追記:

```js
    // W3 司令室PFMパック（UI 専用・facts 非出力）
    SERIES_PERIODS: SERIES_PERIODS, normalizeSeriesPeriod: normalizeSeriesPeriod, seriesWindow: seriesWindow,
    assetSeries: assetSeries, momDelta: momDelta, spanDelta: spanDelta,
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/money-pfm.test.js`
Expected: 10 pass

Run: `node --test tests/*.test.js`
Expected: 既存 178（money-rules）を含め全 pass・fail 0

- [ ] **Step 5: コミット**

```bash
git add money-rules.js tests/money-pfm.test.js
git commit -m "feat(w3): 月次系列の純関数 assetSeries/seriesWindow/momDelta/spanDelta（UI専用・facts非出力）"
```

---

### Task 2: 見通し・リマインドの純関数

**Files:**
- Modify: `money-rules.js`（Task 1 の追加分の直後に追加／UMD return に追記）
- Test: `tests/money-pfm.test.js`（追記）

**Interfaces:**
- Consumes: `projectMonths(gap, rate)`／`nisaNow(nowMs)`／`num`／`_DATE_RE`／`_shiftYM`（Task 1）。
- Produces:
  - `R.monthsBetweenYM(nowMs, ymd) → number|null`
  - `R.runwayMonths(eff) → { available, months, target, low }`
  - `R.goalOutlook(goal, total, monthlySurplus, nowMs) → { remaining, etaMonths|null, etaPeriod:"YYYY-MM"|"", monthsLeft|null, requiredMonthly|null, status:"achieved"|"overdue"|"onTrack"|"behind"|"noDeadline"|"noPace" }`
  - `R.reserveOutlook(ra, nowMs, hasSurplusCtx) → { monthsLeft|null, projectedSaved, projectedShortfall, status:"unknown"|"complete"|"noDeadline"|"overdue"|"short"|"onTrack" }`
  - `R.nisaReminder(nvm, nowMs) → { level:"none"|"info"|"warn"|"urgent", year, monthsLeft, remainingTotal, remainingTsumitate, remainingGrowth, monthlyToFillTotal, monthlyToFillTsumitate, monthlyToFillGrowth }`
  - `R.reminders({ nisa, reserves:[{id,label,deadline,allocated,outlook}] }) → [{ key:"nisa"|"reserve", id, label?, deadline?, allocated?, level:"warn"|"urgent", jump:"nisa"|"reserves", data }]`

- [ ] **Step 1: 失敗するテストを書く（`tests/money-pfm.test.js` 末尾に追記）**

```js
const NOW_AUG = Date.UTC(2026, 7, 15);   // 2026-08-15
const NOW_NOV = Date.UTC(2026, 10, 15);  // 2026-11-15
const NOW_DEC = Date.UTC(2026, 11, 15);  // 2026-12-15

test("monthsBetweenYM: 同月0・翌月1・前月−1・年跨ぎ・不正null・reserveMonthly と同じ暦", () => {
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2026-08-31"), 0);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2026-09-01"), 1);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2026-07-31"), -1);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2027-01-15"), 5);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2026-11"), 3);
  assert.equal(R.monthsBetweenYM(NOW_AUG, ""), null);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "bogus"), null);
  assert.equal(R.monthsBetweenYM(0, "2026-11-30"), null);
  assert.equal(R.monthsBetweenYM(NaN, "2026-11-30"), null);
  // reserveMonthly（無改変）との一致: ceil(残額 / max(1, 月差))
  ["2026-11-30", "2026-08-31", "2027-06-30"].forEach((dl) => {
    const rv = R.normalizeReserve({ target: 300000, saved: 120000, deadline: dl }, 0);
    assert.equal(R.reserveMonthly(rv, NOW_AUG), Math.ceil(180000 / Math.max(1, R.monthsBetweenYM(NOW_AUG, dl))));
  });
});

test("runwayMonths: buffer/monthlyExpense・小数1桁・low の境界・生活費0は非available", () => {
  const s = mkState({ buckets: { buffer: { amount: 946000 }, core: { amount: 0 }, satellite: { amount: 0 } } });
  const rw = R.runwayMonths(s);
  assert.deepEqual(rw, { available: true, months: 4.3, target: 6, low: true });
  const eq = R.runwayMonths(mkState({ buckets: { buffer: { amount: 1320000 }, core: { amount: 0 }, satellite: { amount: 0 } } }));
  assert.equal(eq.months, 6); assert.equal(eq.low, false);
  assert.equal(R.runwayMonths(mkState({ monthlyExpense: 0 })).available, false);
});

test("goalOutlook: 各 status と eta/requiredMonthly", () => {
  const g = (target, deadline) => R.normalizeGoal({ label: "x", targetAmount: target, deadline: deadline || "" }, 0);
  assert.equal(R.goalOutlook(g(1000000, ""), 1000000, 50000, NOW_AUG).status, "achieved");
  assert.equal(R.goalOutlook(g(1000000, "2026-03-31"), 500000, 50000, NOW_AUG).status, "overdue");
  const on = R.goalOutlook(g(1000000, "2027-08-31"), 400000, 50000, NOW_AUG);   // 残600000 / 12ヶ月 = 50000 <= 50000
  assert.equal(on.status, "onTrack"); assert.equal(on.requiredMonthly, 50000); assert.equal(on.monthsLeft, 12);
  assert.equal(on.etaMonths, 12); assert.equal(on.etaPeriod, "2027-08");
  const be = R.goalOutlook(g(1000000, "2027-02-28"), 400000, 50000, NOW_AUG);   // 残600000 / 6 = 100000 > 50000
  assert.equal(be.status, "behind"); assert.equal(be.requiredMonthly, 100000);
  const nd = R.goalOutlook(g(1000000, ""), 400000, 50000, NOW_AUG);
  assert.equal(nd.status, "noDeadline"); assert.equal(nd.requiredMonthly, null); assert.equal(nd.etaPeriod, "2027-08");
  const np = R.goalOutlook(g(1000000, ""), 400000, 0, NOW_AUG);
  assert.equal(np.status, "noPace"); assert.equal(np.etaMonths, null); assert.equal(np.etaPeriod, "");
  // 期限あり・余剰0 → behind（必要月額は出る）
  const bz = R.goalOutlook(g(1000000, "2027-02-28"), 400000, 0, NOW_AUG);
  assert.equal(bz.status, "behind"); assert.equal(bz.requiredMonthly, 100000); assert.equal(bz.etaMonths, null);
  // 年跨ぎの etaPeriod
  assert.equal(R.goalOutlook(g(1000000, ""), 400000, 100000, Date.UTC(2026, 10, 1)).etaPeriod, "2027-05");
});

test("reserveOutlook: unknown/complete/noDeadline/overdue/short/onTrack・monthsLeft=0", () => {
  const ra = (o) => Object.assign({ id: "r", label: "r", target: 300000, saved: 120000, deadline: "2026-11-30", suggestedMonthly: 60000, allocated: 60000, complete: false }, o);
  assert.equal(R.reserveOutlook(ra({}), NOW_AUG, false).status, "unknown");
  assert.equal(R.reserveOutlook(ra({ complete: true, saved: 300000 }), NOW_AUG, true).status, "complete");
  assert.equal(R.reserveOutlook(ra({ deadline: "" }), NOW_AUG, true).status, "noDeadline");
  const od = R.reserveOutlook(ra({ deadline: "2026-06-30" }), NOW_AUG, true);
  assert.equal(od.status, "overdue"); assert.equal(od.projectedShortfall, 180000);
  const sh = R.reserveOutlook(ra({ allocated: 30000 }), NOW_AUG, true);   // 120000 + 30000×3 = 210000 → 不足 90000
  assert.equal(sh.status, "short"); assert.equal(sh.projectedShortfall, 90000); assert.equal(sh.projectedSaved, 210000);
  const ok = R.reserveOutlook(ra({}), NOW_AUG, true);                      // 120000 + 60000×3 = 300000
  assert.equal(ok.status, "onTrack"); assert.equal(ok.projectedShortfall, 0);
  const z = R.reserveOutlook(ra({ deadline: "2026-08-31", allocated: 180000 }), NOW_AUG, true);  // 今月が期日 → max(1,0)=1
  assert.equal(z.monthsLeft, 0); assert.equal(z.status, "onTrack");
});

test("nisaReminder: none / info / warn / urgent の月境界と monthlyToFillTotal", () => {
  const st = mkState({ nisa: { source: "manual", anchorYear: 2026, tsumitateThisYear: 300000, growthThisYear: 0, tsumitateLifetime: 300000, growthLifetime: 0 } });
  const cd = R.cashflowDerived(ROWS, st, NOW_AUG);
  const nvmAt = (now) => R.nisaViewModel(st, cd, now, []);
  assert.equal(R.nisaReminder(nvmAt(NOW_AUG), NOW_AUG).level, "info");
  assert.equal(R.nisaReminder(nvmAt(Date.UTC(2026, 8, 30)), Date.UTC(2026, 8, 30)).level, "info");   // 9月
  assert.equal(R.nisaReminder(nvmAt(Date.UTC(2026, 9, 1)), Date.UTC(2026, 9, 1)).level, "warn");     // 10月
  const nov = R.nisaReminder(nvmAt(NOW_NOV), NOW_NOV);
  assert.equal(nov.level, "warn"); assert.equal(nov.monthsLeft, 2); assert.equal(nov.remainingTotal, 3300000);
  assert.equal(nov.monthlyToFillTotal, 1650000); assert.equal(nov.remainingTsumitate, 900000); assert.equal(nov.remainingGrowth, 2400000);
  assert.equal(R.nisaReminder(nvmAt(NOW_DEC), NOW_DEC).level, "urgent");
  assert.equal(R.nisaReminder(R.nisaViewModel(mkState(), cd, NOW_NOV, []), NOW_NOV).level, "none");   // 未設定
  const full = mkState({ nisa: { source: "manual", anchorYear: 2026, tsumitateThisYear: 1200000, growthThisYear: 2400000, tsumitateLifetime: 3600000, growthLifetime: 2400000 } });
  assert.equal(R.nisaReminder(R.nisaViewModel(full, cd, NOW_NOV, []), NOW_NOV).level, "none");       // 残0
  assert.equal(R.nisaReminder(null, NOW_NOV).level, "none");
});

test("reminders: warn/urgent のみ・urgent→warn 順・同レベルは入力順・目標は含めない", () => {
  const out = R.reminders({
    nisa: { level: "warn", remainingTotal: 1 },
    reserves: [
      { id: "a", label: "A", deadline: "2026-11-30", allocated: 1, outlook: { status: "short", projectedShortfall: 1 } },
      { id: "b", label: "B", deadline: "2026-06-30", allocated: 0, outlook: { status: "overdue", projectedShortfall: 2 } },
      { id: "c", label: "C", deadline: "", allocated: 0, outlook: { status: "onTrack", projectedShortfall: 0 } },
    ],
  });
  assert.deepEqual(out.map((x) => x.key + ":" + (x.id) + ":" + x.level), ["reserve:b:urgent", "nisa:nisa:warn", "reserve:a:warn"]);
  assert.equal(out[0].jump, "reserves"); assert.equal(out[1].jump, "nisa"); assert.equal(out[2].deadline, "2026-11-30");
  assert.deepEqual(R.reminders({ nisa: { level: "info" }, reserves: [] }), []);
  assert.deepEqual(R.reminders(null), []);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/money-pfm.test.js`
Expected: 新規 6 件が FAIL（`R.monthsBetweenYM is not a function` 等）

- [ ] **Step 3: 実装（Task 1 の `spanDelta` の直後に追加）**

```js
  // §3.3 期限月 − 今月（UTC 暦・reserveMonthly と同じ式・不正は null）。reserveMonthly 自体は無改変。
  function monthsBetweenYM(nowMs, ymd) {
    if (typeof ymd !== "string" || !/^\d{4}-\d{2}/.test(ymd) || !(num(nowMs) > 0)) return null;
    var nd = new Date(num(nowMs));
    if (!isFinite(nd.getTime())) return null;
    var cy = nd.getUTCFullYear();
    if (cy < 1 || cy > 9999) return null;
    var nowYM = cy * 12 + nd.getUTCMonth();
    var dlYM = parseInt(ymd.slice(0, 4), 10) * 12 + (parseInt(ymd.slice(5, 7), 10) - 1);
    return dlYM - nowYM;
  }
  // §3.3 runway＝バッファ ÷ 月の生活費（小数1桁）。
  function runwayMonths(eff) {
    var exp = num(eff && eff.monthlyExpense), target = num(eff && eff.bufferMonths);
    if (exp <= 0) return { available: false, months: 0, target: target, low: false };
    var buf = num(eff.buckets && eff.buckets.buffer && eff.buckets.buffer.amount);
    var m = Math.round(buf / exp * 10) / 10;
    return { available: true, months: m, target: target, low: m < target };
  }
  // §3.3 目標の見通し。pace（monthlySurplus）は roadmap.milestones と同じ単一源（D7）。
  function goalOutlook(goal, total, monthlySurplus, nowMs) {
    var target = num(goal && goal.targetAmount), t = num(total), pace = num(monthlySurplus);
    var remaining = Math.max(0, target - t);
    var deadline = (goal && typeof goal.deadline === "string" && _DATE_RE.test(goal.deadline)) ? goal.deadline : "";
    var etaMonths = remaining > 0 ? projectMonths(remaining, pace) : 0;
    var etaPeriod = "";
    if (etaMonths !== null && num(nowMs) > 0) {
      var nd = new Date(num(nowMs));
      if (isFinite(nd.getTime())) {
        var nowP = nd.getUTCFullYear() + "-" + ("0" + (nd.getUTCMonth() + 1)).slice(-2) + "-01";
        etaPeriod = _shiftYM(nowP, etaMonths).slice(0, 7);
      }
    }
    var monthsLeft = deadline ? monthsBetweenYM(nowMs, deadline) : null;
    var requiredMonthly = (deadline && monthsLeft !== null) ? Math.ceil(remaining / Math.max(1, monthsLeft)) : null;
    var status;
    if (remaining === 0) status = "achieved";
    else if (deadline && monthsLeft !== null && monthsLeft < 0) status = "overdue";
    else if (deadline && monthsLeft !== null) status = (pace > 0 && requiredMonthly <= pace) ? "onTrack" : "behind";
    else status = pace > 0 ? "noDeadline" : "noPace";
    return { remaining: remaining, etaMonths: etaMonths, etaPeriod: etaPeriod, monthsLeft: monthsLeft, requiredMonthly: requiredMonthly, status: status };
  }
  // §3.3 確保枠の見通し。ra は cashflowDerived().reserveAlloc[i]。hasSurplusCtx=false は語らない（unknown）。
  function reserveOutlook(ra, nowMs, hasSurplusCtx) {
    var target = num(ra && ra.target), saved = num(ra && ra.saved), allocated = num(ra && ra.allocated);
    var deadline = (ra && typeof ra.deadline === "string" && _DATE_RE.test(ra.deadline)) ? ra.deadline : "";
    var monthsLeft = deadline ? monthsBetweenYM(nowMs, deadline) : null;
    var out = { monthsLeft: monthsLeft, projectedSaved: saved, projectedShortfall: Math.max(0, target - saved), status: "unknown" };
    if (!hasSurplusCtx) return out;
    if (ra && ra.complete) { out.status = "complete"; out.projectedShortfall = 0; return out; }
    if (!deadline || monthsLeft === null) { out.status = "noDeadline"; return out; }
    if (monthsLeft < 0) { out.status = "overdue"; return out; }
    var projectedSaved = saved + allocated * Math.max(1, monthsLeft);
    var shortfall = Math.max(0, target - projectedSaved);
    return { monthsLeft: monthsLeft, projectedSaved: projectedSaved, projectedShortfall: shortfall, status: shortfall > 0 ? "short" : "onTrack" };
  }
  // §3.3 NISA 年内残枠のリマインド（月 1-9 info / 10-11 warn / 12 urgent・残枠>0 のみ）。
  function nisaReminder(nvm, nowMs) {
    var none = { level: "none", year: 0, monthsLeft: 0, remainingTotal: 0, remainingTsumitate: 0, remainingGrowth: 0,
      monthlyToFillTotal: 0, monthlyToFillTsumitate: 0, monthlyToFillGrowth: 0 };
    if (!nvm || !nvm.configured || !nvm.annual || !nvm.annual.total) return none;
    var now = nisaNow(nowMs);
    if (!now.valid) return none;
    var remaining = num(nvm.annual.total.remaining);
    if (remaining <= 0) return none;
    var monthsLeft = num(nvm.monthsLeft);
    var level = now.monthIndex <= 8 ? "info" : (now.monthIndex <= 10 ? "warn" : "urgent");
    return { level: level, year: now.year, monthsLeft: monthsLeft, remainingTotal: remaining,
      remainingTsumitate: num(nvm.annual.tsumitate && nvm.annual.tsumitate.remaining),
      remainingGrowth: num(nvm.annual.growth && nvm.annual.growth.remaining),
      monthlyToFillTotal: monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : 0,
      monthlyToFillTsumitate: num(nvm.monthlyToFillTsumitate), monthlyToFillGrowth: num(nvm.monthlyToFillGrowth) };
  }
  // §3.3 リマインド帯の項目（warn/urgent のみ・urgent→warn・同レベルは入力順・目標は含めない）。
  function reminders(input) {
    var out = [];
    var nisa = input && input.nisa;
    if (nisa && (nisa.level === "warn" || nisa.level === "urgent")) {
      out.push({ key: "nisa", id: "nisa", level: nisa.level, jump: "nisa", data: nisa });
    }
    var rs = (input && Array.isArray(input.reserves)) ? input.reserves : [];
    rs.forEach(function (rv) {
      var st = rv && rv.outlook && rv.outlook.status;
      if (st !== "short" && st !== "overdue") return;
      out.push({ key: "reserve", id: rv.id, label: rv.label, deadline: rv.deadline, allocated: num(rv.allocated),
        level: st === "overdue" ? "urgent" : "warn", jump: "reserves", data: rv.outlook });
    });
    var rank = { urgent: 0, warn: 1 };
    return out.map(function (it, i) { return { it: it, i: i }; })
      .sort(function (x, y) { return (rank[x.it.level] - rank[y.it.level]) || (x.i - y.i); })
      .map(function (w) { return w.it; });
  }
```

UMD return の Task 1 追記行の直後に追記:

```js
    monthsBetweenYM: monthsBetweenYM, runwayMonths: runwayMonths, goalOutlook: goalOutlook,
    reserveOutlook: reserveOutlook, nisaReminder: nisaReminder, reminders: reminders,
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/money-pfm.test.js` → 16 pass
Run: `node --test tests/*.test.js` → 全 pass
Run: `/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_advice_facts.py -q` → 106 passed（非接触の確認）
Run: `git diff --stat -- api/` → 出力なし

- [ ] **Step 5: コミット**

```bash
git add money-rules.js tests/money-pfm.test.js
git commit -m "feat(w3): 見通し/リマインドの純関数 monthsBetweenYM/runwayMonths/goalOutlook/reserveOutlook/nisaReminder/reminders"
```

---

### Task 3: 推移カード（SVG）＋期間切替＋受入ハーネスの土台

**Files:**
- Modify: `scratchpad/w3-mock-server.py`（`_send_index` に `W3_VARIANTS` トグル）
- Create: `scratchpad/w3-smoke.js`
- Modify: `money.js`（定数／`setSeriesPeriod`／`seriesSection`／`seriesSvg`／hover／`render()` 配線／`_FOLD_DEFAULT_OPEN`／`_JUMP_TARGETS`／公開面）
- Modify: `money.css`（末尾に `.mcc-series-*`）

**Interfaces:**
- Consumes: `R.assetSeries`／`R.seriesWindow`／`R.normalizeSeriesPeriod`／`R.SERIES_PERIODS`／`R.momDelta`／`R.spanDelta`／`R.yen`／既存 `foldSection`／`jumpLink`／`esc`／`fmtAnchorMonth`／`sync.loggedIn`。
- Produces: `MCC.setSeriesPeriod(key)`、DOM: `details#mcc-sec-series.mcc-fold.mcc-fold-series` ＞ `.mcc-series` ＞ `.mcc-series-bar button.mcc-series-btn[data-period][aria-pressed]`／`svg.mcc-series-svg`（`circle.mcc-series-pt.complete|live`・`rect.mcc-series-hit[data-cap]`・`line.mcc-series-anchor`・`text.mcc-series-anchor-lbl`）／`.mcc-series-cap`／`.mcc-series-note`／非 available 時 `.mcc-series-empty`。`fmtDeltaYen(n)`（Task 4 が使う）。

- [ ] **Step 1: モック鯖に注入トグルを追加（`scratchpad/w3-mock-server.py` `_send_index`）**

```python
    def _send_index(self):
        with open(os.path.join(ROOT, "index.html"), "rb") as f:
            html = f.read().decode("utf-8")
        # W3_VARIANTS=0 なら比較用オーバーレイ（w3-variants.js）を注入しない＝本実装の money.js だけを検証する（受入用）。
        if os.environ.get("W3_VARIANTS", "1") != "0":
            i = html.rfind("</body>")
            html = (html[:i] + "  " + INJECT_TAG + "\n" + html[i:]) if i >= 0 else (html + INJECT_TAG)
        raw = html.encode("utf-8")
```
（以降の `send_response` 以下は既存のまま）

- [ ] **Step 2: 受入ハーネスの土台＋推移カードのシナリオを書く（`scratchpad/w3-smoke.js` 新規）**

```js
// scratchpad/w3-smoke.js — W3 司令室PFMパック 受入（spec §10.2）。
// 使い方（この1行で1コマンド。モック鯖は自前で起動/停止・W3_VARIANTS=0 で本実装だけを検証）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }
const R = require("../money-rules.js");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8242;
const BASE = "http://127.0.0.1:" + PORT;
const results = [];
function check(name, cond, detail) { results.push({ name, pass: !!cond, detail }); if (!cond) console.log("  ✗ " + name + (detail ? " — " + detail : "")); }

function startServer() {
  return spawn("python3", [path.join(ROOT, "scratchpad", "w3-mock-server.py"), "--port", String(PORT)],
    { stdio: ["ignore", "ignore", "ignore"], env: Object.assign({}, process.env, { W3_VARIANTS: "0" }) });
}
function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on("error", reject);
  });
}
function waitForServer(ms) {
  const dl = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => getJSON("/api/auth/session").then(resolve, () => (Date.now() > dl ? reject(new Error("server not ready")) : setTimeout(tick, 120)));
    tick();
  });
}
// Date を固定（money.js の render() は Date.now() を1回取る＝ここを固定すれば全 VM が同じ月を見る）。
async function fixDate(context, fixedMs) {
  await context.addInitScript((fixed) => {
    const RealDate = Date;
    function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed); }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => fixed; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
  }, fixedMs);
}
async function newPage(browser, viewport, fixedMs, loggedIn) {
  const context = await browser.newContext({ viewport });
  if (fixedMs) await fixDate(context, fixedMs);
  if (!loggedIn) await context.route("**/api/auth/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"unauthorized"}' }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/?diag=off#money", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#mcc-root .mcc-hero", { timeout: 15000 });
  if (loggedIn) await page.waitForFunction(() => !!document.querySelector("#mcc-sec-cashflow .mcc-cashflow"), null, { timeout: 15000 });
  return { context, page, errors };
}
const PC = { width: 1440, height: 900 }, SP = { width: 390, height: 844 };
const NOW_AUG = Date.UTC(2026, 7, 15, 3), NOW_NOV = Date.UTC(2026, 10, 15, 3), NOW_DEC = Date.UTC(2026, 11, 15, 3);

async function main() {
  const server = startServer();
  let browser;
  try {
    await waitForServer(15000);
    // 期待値は money-rules.js から直接算出（二重実装しない）。fixture は鯖から取る。
    const state = (await getJSON("/api/me/state")).state;
    const rows = (await getJSON("/api/me/cashflow")).cashflow;
    const eff = R.effectiveState(R.migrate(state), rows, [], NOW_AUG);
    const series = R.assetSeries(eff, rows, []);
    const completeN = series.points.filter((p) => p.isComplete).length;
    browser = await chromium.launch();

    // ---- S1 推移カード（PC・ログイン済）----
    {
      const { context, page, errors } = await newPage(browser, PC, NOW_AUG, true);
      await page.waitForSelector("#mcc-sec-series");
      const info = await page.evaluate(() => ({
        open: document.getElementById("mcc-sec-series").open,
        pressed: document.querySelector(".mcc-series-btn[aria-pressed='true']")?.dataset.period,
        complete: document.querySelectorAll(".mcc-series-pt.complete").length,
        live: document.querySelectorAll(".mcc-series-pt.live").length,
        hits: document.querySelectorAll(".mcc-series-hit").length,
        anchorLine: document.querySelectorAll(".mcc-series-anchor").length,
        anchorLbl: document.querySelectorAll(".mcc-series-anchor-lbl").length,
        cap: document.querySelector(".mcc-series-cap")?.textContent || "",
        digest: document.querySelector("#mcc-sec-series .mcc-fold-dg")?.textContent || "",
        notes: Array.from(document.querySelectorAll(".mcc-series-note")).map((n) => n.textContent).join("|"),
      }));
      check("S1 fold は既定 open", info.open === true);
      check("S1 既定期間は 1Y", info.pressed === "1Y", info.pressed);
      const win1y = R.seriesWindow(series.points, "1Y");
      check("S1 1Y の確定点数", info.complete === win1y.filter((p) => p.isComplete).length, info.complete);
      check("S1 暫定点 1", info.live === 1, info.live);
      check("S1 ヒット矩形＝点数", info.hits === win1y.length, info.hits);
      // fixture のアンカー(2025-09)は 1Y 窓の先頭 → 点線のみ・ラベル無し（spec §6 注意1）
      const aIdx = win1y.findIndex((p) => p.isAnchor);
      check("S1 アンカー線（窓内なら1本）", info.anchorLine === (aIdx >= 0 ? 1 : 0), info.anchorLine);
      check("S1 アンカーラベル（先頭なら省略）", info.anchorLbl === (aIdx > 0 ? 1 : 0), info.anchorLbl);
      const last = win1y[win1y.length - 1];
      check("S1 初期キャプション＝最新点", info.cap.indexOf(R.yen(last.total)) >= 0 && info.cap.indexOf("暫定") >= 0, info.cap);
      const mom = R.momDelta(series.points), span = R.spanDelta(series.points, 12);
      check("S1 digest に前月比", info.digest.indexOf(R.yen(Math.abs(mom.delta))) >= 0, info.digest);
      check("S1 digest に直近12ヶ月", !span.available || info.digest.indexOf(R.yen(Math.abs(span.delta))) >= 0, info.digest);
      check("S1 注記: 投資分固定", info.notes.indexOf("現在値で固定") >= 0, info.notes);
      check("S1 注記: 逆算は窓内に前点がある時だけ", (info.notes.indexOf("逆算") >= 0) === win1y.some((p) => p.beforeAnchor && !p.isAnchor), info.notes);
      // 期間切替 → 点数と LS
      await page.evaluate(() => document.querySelector(".mcc-series-btn[data-period='6M']").click());
      await page.waitForFunction(() => document.querySelector(".mcc-series-btn[aria-pressed='true']")?.dataset.period === "6M");
      const c6 = await page.evaluate(() => ({ hits: document.querySelectorAll(".mcc-series-hit").length, ls: localStorage.getItem("mcc_series_period"), notes: Array.from(document.querySelectorAll(".mcc-series-note")).map((n) => n.textContent).join("|"), anchor: document.querySelectorAll(".mcc-series-anchor").length }));
      check("S1 6M で6点", c6.hits === 6, c6.hits);
      check("S1 LS に保存", c6.ls === "6M", c6.ls);
      check("S1 6M はアンカー窓外＝線なし・逆算注記なし", c6.anchor === 0 && c6.notes.indexOf("逆算") < 0, c6.notes);
      await page.evaluate(() => document.querySelector(".mcc-series-btn[data-period='ALL']").click());
      await page.waitForFunction(() => document.querySelector(".mcc-series-btn[aria-pressed='true']")?.dataset.period === "ALL");
      const cAll = await page.evaluate(() => ({ hits: document.querySelectorAll(".mcc-series-hit").length, lbl: document.querySelectorAll(".mcc-series-anchor-lbl").length }));
      check("S1 ALL で全点", cAll.hits === series.points.length, cAll.hits);
      check("S1 ALL ではアンカーラベルあり", cAll.lbl === 1, cAll.lbl);
      // リロード後も維持・未知値は 1Y
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#mcc-sec-series .mcc-series-btn[aria-pressed='true']");
      check("S1 リロード後も ALL", (await page.evaluate(() => document.querySelector(".mcc-series-btn[aria-pressed='true']").dataset.period)) === "ALL");
      await page.evaluate(() => localStorage.setItem("mcc_series_period", "bogus"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#mcc-sec-series .mcc-series-btn[aria-pressed='true']");
      check("S1 未知値は 1Y", (await page.evaluate(() => document.querySelector(".mcc-series-btn[aria-pressed='true']").dataset.period)) === "1Y");
      // hover でキャプション
      const hit = await page.$(".mcc-series-hit");
      const capWant = await hit.getAttribute("data-cap");
      await hit.hover();
      const capGot = await page.evaluate(() => document.querySelector(".mcc-series-cap").textContent);
      check("S1 hover でキャプション差替", capGot === capWant, capGot);
      check("S1 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
    }
    // ---- S2 390px・タップ ----
    {
      const { context, page, errors } = await newPage(browser, SP, NOW_AUG, true);
      await page.waitForSelector("#mcc-sec-series svg.mcc-series-svg");
      const w = await page.evaluate(() => ({ view: document.getElementById("money-view").scrollWidth, svg: document.querySelector(".mcc-series-svg").getBoundingClientRect().width }));
      check("S2 横あふれなし", w.view <= 390, String(w.view));
      check("S2 SVG 幅追従", w.svg > 200 && w.svg <= 390, String(w.svg));
      const hits = await page.$$(".mcc-series-hit");
      const want = await hits[2].getAttribute("data-cap");
      await hits[2].dispatchEvent("touchstart");
      check("S2 tap でキャプション差替", (await page.evaluate(() => document.querySelector(".mcc-series-cap").textContent)) === want);
      check("S2 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
    }
    // ---- S3 未ログイン ----
    {
      const { context, page, errors } = await newPage(browser, PC, NOW_AUG, false);
      const e = await page.evaluate(() => ({ empty: document.querySelector("#mcc-sec-series .mcc-series-empty")?.textContent || "", svg: document.querySelectorAll(".mcc-series-svg").length }));
      check("S3 未ログインは案内文（ログイン）", e.empty.indexOf("ログイン") >= 0 && e.svg === 0, e.empty);
      check("S3 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
    }
    // ---- 後続 Task がここにシナリオを追加（S4 ヒーロー/帯・S5 fold 内の行）----
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.pass);
  console.log(results.length - failed.length + "/" + results.length + " asserts passed");
  console.log(failed.length ? "FAIL" : "ALL PASS");
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
```

- [ ] **Step 3: 失敗を確認**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js`
Expected: S1 の `page.waitForSelector("#mcc-sec-series")` がタイムアウト → 例外で exit 2（推移カードが未実装）

- [ ] **Step 4: `money.js` を実装**

(a) `_FOLD_DEFAULT_OPEN`（`money.js:1829`）を差し替え:

```js
  var _FOLD_DEFAULT_OPEN = { "mcc-sec-cashflow": true, "mcc-sec-series": true, "mcc-sec-settings": true, "mcc-ac-input": true, "mcc-nisa-input": true };
```

(b) `_JUMP_TARGETS`（`money.js:1951`）の `nisa:` 行の直後に追加:

```js
    series:      { id: "mcc-sec-series",         tab: "dash" },
```

(c) `sparkline()`（`money.js:727`）の直前に追加:

```js
  // ==== W3 司令室PFMパック: 推移カード（spec §4.2）。業務値は R.assetSeries の points をそのまま描く（表示幾何のみ）====
  var _SERIES_KEY = "mcc_series_period";   // 端末ローカル（mcc_tab と同じ扱い・クラウド state に混ぜない）
  function _loadSeriesPeriod() {
    try { return R.normalizeSeriesPeriod(localStorage.getItem(_SERIES_KEY)); } catch (e) { return R.normalizeSeriesPeriod(null); }
  }
  var _seriesPeriod = _loadSeriesPeriod();
  function setSeriesPeriod(key) {
    _seriesPeriod = R.normalizeSeriesPeriod(key);
    try { localStorage.setItem(_SERIES_KEY, _seriesPeriod); } catch (e) { /* 保存不可でもセッション内は保持 */ }
    render();
  }
  // 符号付き¥（前月比・差分表示用）。マイナスは U+2212。0 は ±¥0。
  function fmtDeltaYen(n) {
    var v = Math.round(Number(n) || 0);
    return (v > 0 ? "+" : (v < 0 ? "−" : "±")) + R.yen(Math.abs(v));
  }
  // 軸ラベル用の短縮¥（120万／1.2億）。
  function fmtYenShort(n) {
    var v = Math.round(Number(n) || 0), a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 100000000) return s + (Math.round(a / 10000000) / 10).toLocaleString("ja-JP") + "億";
    if (a >= 10000) return s + Math.round(a / 10000).toLocaleString("ja-JP") + "万";
    return s + a.toLocaleString("ja-JP");
  }
  function _niceStep(raw) {
    if (!(raw > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return (f <= 1 ? 1 : (f <= 2 ? 2 : (f <= 5 ? 5 : 10))) * p;
  }
  function _seriesCap(p) {
    return fmtAnchorMonth(p.period) + "：総資産 " + R.yen(p.total) + "（現金 " + R.yen(p.cash) + "・投資 " + R.yen(p.invest) + "）" + (p.isComplete ? "" : "（当月・暫定）");
  }
  // 積み上げエリア（現金の上に投資）＋Y目盛＋X ラベル＋点＋アンカー線＋ヒット矩形。
  function seriesSvg(pts) {
    var W = 640, H = 220, padL = 60, padR = 14, padT = 14, padB = 26, n = pts.length;
    if (!n) return "";
    var maxV = 0, minV = 0;
    pts.forEach(function (p) { maxV = Math.max(maxV, p.total, p.cash); minV = Math.min(minV, p.cash); });
    var step = _niceStep(Math.max(1, maxV - minV) / 3);
    var top = step * Math.ceil(Math.max(1, maxV) / step), lo = step * Math.floor(minV / step);
    if (top === lo) top = lo + step;
    var iw = W - padL - padR, ih = H - padT - padB;
    function x(i) { return n > 1 ? padL + iw * i / (n - 1) : padL + iw / 2; }
    function y(v) { return padT + ih * (1 - (v - lo) / (top - lo)); }
    function f(v) { return Math.round(v * 10) / 10; }
    var grid = "";
    for (var g = lo; g <= top + 1e-9; g += step) {
      grid += '<line class="mcc-series-grid" x1="' + padL + '" y1="' + f(y(g)) + '" x2="' + (W - padR) + '" y2="' + f(y(g)) + '"></line>' +
        '<text class="mcc-series-ylbl" x="' + (padL - 6) + '" y="' + f(y(g) + 4) + '" text-anchor="end">' + esc(fmtYenShort(g)) + '</text>';
    }
    var cashTop = pts.map(function (p, i) { return f(x(i)) + "," + f(y(p.cash)); });
    var totalTop = pts.map(function (p, i) { return f(x(i)) + "," + f(y(p.total)); });
    var base = f(y(Math.max(lo, 0)));
    var cashArea = "M" + f(x(0)) + "," + base + " L" + cashTop.join(" L") + " L" + f(x(n - 1)) + "," + base + " Z";
    var investArea = "M" + cashTop.join(" L") + " L" + totalTop.slice().reverse().join(" L") + " Z";
    var xl = "";
    var idx = n <= 4 ? pts.map(function (_, i) { return i; }) : [0, Math.round((n - 1) / 3), Math.round((n - 1) * 2 / 3), n - 1];
    idx.forEach(function (i) {
      xl += '<text class="mcc-series-xlbl" x="' + f(x(i)) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? "start" : (i === n - 1 ? "end" : "middle")) + '">' +
        esc(pts[i].period.slice(0, 4) + "/" + pts[i].period.slice(5, 7)) + '</text>';
    });
    var anchor = "";
    pts.forEach(function (p, i) {
      if (!p.isAnchor) return;
      anchor += '<line class="mcc-series-anchor" x1="' + f(x(i)) + '" y1="' + padT + '" x2="' + f(x(i)) + '" y2="' + (H - padB) + '"></line>';
      if (i > 0) anchor += '<text class="mcc-series-anchor-lbl" x="' + f(x(i) + 4) + '" y="' + (padT + 10) + '">基準</text>';
    });
    var dots = "", hits = "";
    pts.forEach(function (p, i) {
      dots += '<circle class="mcc-series-pt ' + (p.isComplete ? "complete" : "live") + '" cx="' + f(x(i)) + '" cy="' + f(y(p.total)) + '" r="2.8"></circle>';
      var x0 = i === 0 ? padL : f((x(i - 1) + x(i)) / 2), x1 = i === n - 1 ? (W - padR) : f((x(i) + x(i + 1)) / 2);
      hits += '<rect class="mcc-series-hit" data-i="' + i + '" data-cap="' + esc(_seriesCap(p)) + '" x="' + x0 + '" y="' + padT + '" width="' + f(x1 - x0) + '" height="' + ih + '"></rect>';
    });
    return '<svg class="mcc-series-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="資産の推移">' +
      grid + '<path class="mcc-series-cash" d="' + cashArea + '"></path>' + '<path class="mcc-series-invest" d="' + investArea + '"></path>' +
      '<polyline class="mcc-series-cashline" points="' + cashTop.join(" ") + '"></polyline>' +
      '<polyline class="mcc-series-totalline" points="' + totalTop.join(" ") + '"></polyline>' +
      anchor + xl + dots + hits + '</svg>';
  }
  // 推移カード本体。series=R.assetSeries／mom=R.momDelta／span=R.spanDelta(points,12)／periodKey=_seriesPeriod。
  function seriesSection(series, mom, span, periodKey) {
    var digest, body;
    if (!series || !series.available) {
      var msg;
      if (!sync.loggedIn) msg = 'ログインすると推移が表示されます → ' + jumpLink("sync", "ログイン");
      else if (series && series.reason === "noAnchor") msg = jumpLink("anchor", "「貯蓄の基準」") + 'で基準（アンカー）を設定すると推移が表示されます';
      else if (series && series.reason === "currency") msg = 'JPY 以外の通貨には対応していません';
      else msg = '収支データが連携されると推移が表示されます';
      digest = '<b>未表示</b>';
      body = '<div class="mcc-series"><div class="mcc-series-empty">' + msg + '</div></div>';
    } else {
      var key = R.normalizeSeriesPeriod(periodKey);
      var win = R.seriesWindow(series.points, key);
      var parts = [];
      if (mom && mom.available) parts.push('前月比 <b class="' + (mom.sign > 0 ? "pos" : (mom.sign < 0 ? "neg" : "")) + '">' + esc(fmtDeltaYen(mom.delta)) + '</b>');
      if (span && span.available) parts.push('直近12ヶ月 <b>' + esc(fmtDeltaYen(span.delta)) + '</b>');
      digest = parts.length ? parts.join("・") : '推移を表示';
      var bar = '<div class="mcc-series-bar"><span class="mcc-series-bar-lbl">期間</span>' + R.SERIES_PERIODS.map(function (k) {
        return '<button type="button" class="mcc-series-btn" data-period="' + k + '" aria-pressed="' + (k === key ? "true" : "false") + '" onclick="MCC.setSeriesPeriod(\'' + k + '\')">' + k + '</button>';
      }).join("") + '</div>';
      var last = win[win.length - 1];
      var notes = ['<div class="mcc-series-note">投資分（コア＋サテライト）は現在値で固定・時価ではありません</div>'];
      if (win.some(function (p) { return p.beforeAnchor && !p.isAnchor; })) {
        notes.push('<div class="mcc-series-note">基準（' + esc(fmtAnchorMonth(series.anchorPeriod)) + '）より前は収支から逆算</div>');
      }
      if (series.truncatedBackward && win.length && win[0] === series.points[0]) {
        notes.push('<div class="mcc-series-note">' + esc(fmtAnchorMonth(series.points[0].period)) + '以前は収支データが無いため表示していません</div>');
      }
      body = '<div class="mcc-series">' + bar + seriesSvg(win) +
        '<div class="mcc-series-cap">' + esc(_seriesCap(last)) + '</div>' +
        '<div class="mcc-series-legend"><span class="cash">■ 現金</span><span class="invest">■ 投資（現在値）</span><span class="live">○ 当月（暫定）</span></div>' +
        notes.join("") + '</div>';
    }
    return foldSection("mcc-sec-series", "mcc-fold-series", "資産の推移", digest, body);
  }
  // hover/tap/focus で最寄り列のキャプションを差し替える（data-cap のコピーのみ・math なし）。
  function _onRootSeriesPoint(e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains("mcc-series-hit")) return;
    var host = t.closest ? t.closest(".mcc-series") : null;
    var cap = host ? host.querySelector(".mcc-series-cap") : null;
    if (cap) cap.textContent = t.getAttribute("data-cap") || "";
  }
```

(d) `render()` の VM 生成部（`var cdMain = R.cashDerived(...)` の直後）に追加:

```js
    // W3: 推移カードの VM（全て純関数・facts 非出力）。
    var series = R.assetSeries(eff, _cashflowRows, _investmentRows);
    var mom = R.momDelta(series.points);
    var span = R.spanDelta(series.points, 12);
```

(e) `render()` の `dashHtml` を差し替え（`heroSection(vm, cv, cdMain)` の直後に推移カードを挿入）:

```js
    var dashHtml = syncBar() + saveWarn + stepperSection(ob) + heroSection(vm, cv, cdMain) +
      seriesSection(series, mom, span, _seriesPeriod) +
      cashflowSection(cv) + roadmapSection(rm, sync.loggedIn) + nisaSection(nvm) +
      assetClassSection(vm) + reservesGoalsSection(vm, cv, cdMain) + adviceSection(vm);
```

(f) `init()`（`money.js:2248-2256`）の `if (root) root.addEventListener("toggle", _onRootToggle, true);` の直後に3行追加:

```js
    if (root) root.addEventListener("mousemove", _onRootSeriesPoint);                      // W3: 推移カードのキャプション差替
    if (root) root.addEventListener("touchstart", _onRootSeriesPoint, { passive: true });
    if (root) root.addEventListener("focusin", _onRootSeriesPoint);
```

(g) 公開面（`money.js` 末尾 `return {`）の `switchTab: switchTab,` の直後に追加:

```js
    setSeriesPeriod: setSeriesPeriod,
```

- [ ] **Step 5: `money.css` 末尾に追加**

```css
/* ==== W3 司令室PFMパック: 推移カード（spec §5）==== */
.mcc-fold-series > summary .mcc-fold-mk { color: var(--c-cyan-bright); }
.mcc-series { display: block; }
.mcc-series-empty { color: var(--c-text-dim); font-size: 0.8rem; padding: 6px 0 4px; line-height: 1.6; }
.mcc-series-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
.mcc-series-bar-lbl { color: var(--c-text-dim); font-size: 12px; letter-spacing: 1px; margin-right: 4px; }
.mcc-series-btn {
  background: rgba(0,0,0,0.3); border: 1px solid rgba(129,140,248,0.3); color: var(--c-text-dim);
  border-radius: 3px; padding: 3px 9px; font-size: 12px; font-weight: 700; letter-spacing: 1px; cursor: pointer;
}
.mcc-series-btn:hover { color: var(--c-cyan-pale); }
.mcc-series-btn[aria-pressed="true"] { color: var(--c-cyan-bright); border-color: var(--c-cyan); box-shadow: 0 0 8px -2px var(--c-cyan); }
.mcc-series-svg { display: block; width: 100%; height: auto; }
.mcc-series-grid { stroke: rgba(255,255,255,0.08); stroke-width: 1; }
.mcc-series-ylbl, .mcc-series-xlbl { fill: var(--c-text-mute); font-size: 11px; font-family: var(--ix-mono, monospace); }
.mcc-series-cash { fill: rgba(56,189,248,0.22); }
.mcc-series-invest { fill: rgba(129,140,248,0.25); }
.mcc-series-cashline { fill: none; stroke: var(--c-cyan); stroke-width: 1.5; }
.mcc-series-totalline { fill: none; stroke: var(--c-indigo-bright); stroke-width: 1.2; }
.mcc-series-anchor { stroke: var(--c-cyan-pale); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.7; }
.mcc-series-anchor-lbl { fill: var(--c-cyan-pale); font-size: 11px; }
.mcc-series-pt.complete { fill: var(--c-indigo-pale); }
.mcc-series-pt.live { fill: var(--c-surface-solid); stroke: var(--c-cyan-bright); stroke-width: 1.5; }
.mcc-series-hit { fill: transparent; cursor: crosshair; }
.mcc-series-hit:hover { fill: rgba(255,255,255,0.03); }
.mcc-series-cap { color: var(--c-text-bright); font-size: 12px; margin-top: 6px; min-height: 1.4em; }
.mcc-series-legend { display: flex; flex-wrap: wrap; gap: 12px; color: var(--c-text-dim); font-size: 12px; margin-top: 4px; }
.mcc-series-legend .cash { color: var(--c-cyan); } .mcc-series-legend .invest { color: var(--c-indigo-bright); } .mcc-series-legend .live { color: var(--c-cyan-bright); }
.mcc-series-note { color: var(--c-text-faint); font-size: 12px; line-height: 1.5; margin-top: 4px; font-family: var(--ix-sans); letter-spacing: 0; }
```
（digest の `<b class="pos|neg">` は既存 `.mcc-fold-dg .pos/.neg`（money.css 150-151行）がそのまま効く＝追加不要。）

- [ ] **Step 6: 構文と受入**

Run: `node --check money.js && echo OK` → OK
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js` → `ALL PASS`（S1〜S3・失敗があれば `✗` 行の detail を読んで直す）
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js` → `ALL PASS`（235 asserts）
Run: `node --test tests/*.test.js` → 全 pass

- [ ] **Step 7: コミット**

```bash
git add money.js money.css scratchpad/w3-mock-server.py scratchpad/w3-smoke.js
git commit -m "feat(w3): 資産の推移カード（SVG 積み上げ・期間切替・hover）＋受入 w3-smoke の土台"
```

---

### Task 4: ヒーロー（前月比バッジ・runway チップ）＋リマインド帯

**Files:**
- Modify: `money.js`（`heroSection` の署名と2箇所／`reminderRail` 新設／`render()` の VM と配線）
- Modify: `money.css`（末尾に追加＋`.mcc-hero-amount`／`.mcc-hero-gauge-row` の2規則変更）
- Modify: `scratchpad/w3-smoke.js`（S4 追加）

**Interfaces:**
- Consumes: `R.runwayMonths`／`R.nisaReminder`／`R.reserveOutlook`／`R.reminders`／`fmtDeltaYen`（Task 3）／`R.yen`／`fmtAnchorMonth`／`jumpLink`。
- Produces: DOM `.mcc-hero-mom.pos|neg|flat`（`.mcc-hero-amount` の兄弟）、`.mcc-hero-runway.ok|low`（`.mcc-hero-gauge-row` 末尾）、`.mcc-rail > .mcc-rail-item.warn|urgent[data-key][data-id]`（0件なら DOM なし）。`render()` 内の変数 `rw`／`nrem`／`rol`／`rem`（Task 5 が `nrem`／`rol` を使う）。

- [ ] **Step 1: 受入シナリオ S4 を追加（`scratchpad/w3-smoke.js` の「後続 Task がここに」コメントの直後）**

```js
    // ---- S4 ヒーロー（前月比・runway）＋リマインド帯 ----
    {
      const cd = R.cashflowDerived(rows, eff, NOW_AUG);
      const hasSurplusCtx = cd.available && cd.monthlySurplus > 0;
      const mom = R.momDelta(series.points), rw = R.runwayMonths(eff);
      // 8月: NISA は info（帯に出ない）。確保枠の short/overdue だけが帯に出る想定。
      const remAug = R.reminders({ nisa: R.nisaReminder(R.nisaViewModel(eff, cd, NOW_AUG, []), NOW_AUG),
        reserves: cd.reserveAlloc.map((ra) => ({ id: ra.id, label: ra.label, deadline: ra.deadline, allocated: ra.allocated, outlook: R.reserveOutlook(ra, NOW_AUG, hasSurplusCtx) })) });
      const { context, page, errors } = await newPage(browser, PC, NOW_AUG, true);
      const h = await page.evaluate(() => ({
        amount: document.querySelector(".mcc-hero-amount")?.textContent || "",
        momText: document.querySelector(".mcc-hero-mom")?.textContent || "", momCls: document.querySelector(".mcc-hero-mom")?.className || "",
        rwText: document.querySelector(".mcc-hero-runway")?.textContent || "", rwCls: document.querySelector(".mcc-hero-runway")?.className || "",
        rail: Array.from(document.querySelectorAll(".mcc-rail-item")).map((n) => n.className + "|" + n.dataset.key + "|" + n.dataset.id + "|" + n.textContent),
      }));
      check("S4 金額ノードは金額のみ", h.amount.trim() === R.yen(eff.buckets.buffer.amount), h.amount);
      check("S4 前月比バッジの文言", h.momText === "前月比 " + (function () { const v = Math.round(mom.delta); return (v > 0 ? "+" : (v < 0 ? "−" : "±")) + R.yen(Math.abs(v)); })() + (mom.pct === null ? "" : "（" + (mom.sign > 0 ? "+" : (mom.sign < 0 ? "−" : "")) + Math.abs(mom.pct).toFixed(1) + "%）"), h.momText);
      check("S4 前月比バッジの色クラス", h.momCls.indexOf(mom.sign > 0 ? "pos" : (mom.sign < 0 ? "neg" : "flat")) >= 0, h.momCls);
      check("S4 runway チップ", h.rwText === "生活費 " + rw.months.toFixed(1) + "ヶ月分" && h.rwCls.indexOf(rw.low ? "low" : "ok") >= 0, h.rwText + " " + h.rwCls);
      check("S4 8月の帯の件数＝期待", h.rail.length === remAug.length, JSON.stringify(h.rail));
      remAug.forEach((it, i) => check("S4 帯[" + i + "] key/id/level", (h.rail[i] || "").indexOf(it.level + "|" + it.key + "|" + it.id) >= 0, h.rail[i]));
      if (remAug.some((it) => it.key === "reserve" && it.level === "warn")) {
        const it = remAug.find((x) => x.key === "reserve" && x.level === "warn");
        check("S4 確保枠 short の本文", h.rail.some((t) => t.indexOf(R.yen(it.data.projectedShortfall) + " 不足の見込み") >= 0 && t.indexOf("→ 確保枠") >= 0), JSON.stringify(h.rail));
      }
      // 帯のリンクで fold が開く
      if (h.rail.length) {
        await page.evaluate(() => document.querySelector(".mcc-rail-item .mcc-jump").click());
        await page.waitForTimeout(300);
        check("S4 帯リンクで fold が open", await page.evaluate(() => document.getElementById("mcc-sec-reserves-goals")?.open === true || document.getElementById("mcc-sec-nisa")?.open === true));
      }
      check("S4 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
      // 11月: NISA warn が加わる（urgent→warn 順）
      const cdN = R.cashflowDerived(rows, eff, NOW_NOV);
      const remNov = R.reminders({ nisa: R.nisaReminder(R.nisaViewModel(eff, cdN, NOW_NOV, []), NOW_NOV),
        reserves: cdN.reserveAlloc.map((ra) => ({ id: ra.id, label: ra.label, deadline: ra.deadline, allocated: ra.allocated, outlook: R.reserveOutlook(ra, NOW_NOV, cdN.available && cdN.monthlySurplus > 0) })) });
      const nov = await newPage(browser, PC, NOW_NOV, true);
      const railNov = await nov.page.evaluate(() => Array.from(document.querySelectorAll(".mcc-rail-item")).map((n) => n.className + "|" + n.dataset.key + "|" + n.dataset.id + "|" + n.textContent));
      check("S4 11月の帯の件数", railNov.length === remNov.length && remNov.some((it) => it.key === "nisa"), JSON.stringify(railNov));
      remNov.forEach((it, i) => check("S4 11月 帯[" + i + "] 順序", (railNov[i] || "").indexOf(it.level + "|" + it.key + "|" + it.id) >= 0, railNov[i]));
      const nisaIt = remNov.find((it) => it.key === "nisa");
      if (nisaIt) check("S4 NISA warn の本文", railNov.some((t) => t.indexOf(R.yen(nisaIt.data.remainingTotal) + " 残っています") >= 0 && t.indexOf("翌年に繰り越せません") >= 0 && t.indexOf("→ NISA") >= 0), JSON.stringify(railNov));
      check("S4 11月 pageerror 0", nov.errors.length === 0, nov.errors.join(" / "));
      await nov.context.close();
      // 12月: urgent
      const dec = await newPage(browser, PC, NOW_DEC, true);
      const railDec = await dec.page.evaluate(() => Array.from(document.querySelectorAll(".mcc-rail-item")).map((n) => n.className + "|" + n.textContent));
      check("S4 12月は NISA urgent", railDec.some((t) => t.indexOf("urgent") >= 0 && t.indexOf("今月が最後") >= 0), JSON.stringify(railDec));
      check("S4 12月 pageerror 0", dec.errors.length === 0, dec.errors.join(" / "));
      await dec.context.close();
      // 390px: ゲージ行が折り返して溢れない
      const sp = await newPage(browser, SP, NOW_AUG, true);
      const ov = await sp.page.evaluate(() => ({ view: document.getElementById("money-view").scrollWidth, row: document.querySelector(".mcc-hero-gauge-row").scrollWidth, rowW: document.querySelector(".mcc-hero-gauge-row").clientWidth }));
      check("S4 390px 横あふれなし", ov.view <= 390 && ov.row <= ov.rowW + 1, JSON.stringify(ov));
      await sp.context.close();
    }
```

- [ ] **Step 2: 失敗を確認**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js`
Expected: S4 の「前月比バッジ」「runway チップ」「帯の件数」が ✗（要素が無い）。S1〜S3 は緑のまま。

- [ ] **Step 3: `money.js` 実装**

(a) `heroSection(vm, cv, cd)` の署名を `heroSection(vm, cv, cd, mom, rw)` に変更し、関数内の `var amount = ...` の直後に追加:

```js
    // W3: 前月比バッジ（確定月ベース）。.mcc-hero-amount の**兄弟**に置く（金額ノードの中身は金額のみ＝既存 E2E 契約）。
    var momHtml = "";
    if (linked && mom && mom.available) {
      var momCls = mom.sign > 0 ? "pos" : (mom.sign < 0 ? "neg" : "flat");
      var pctTxt = mom.pct === null ? "" : "（" + (mom.sign > 0 ? "+" : (mom.sign < 0 ? "−" : "")) + Math.abs(mom.pct).toFixed(1) + "%）";
      momHtml = '<span class="mcc-hero-mom ' + momCls + '">前月比 ' + esc(fmtDeltaYen(mom.delta)) + esc(pctTxt) + '</span>';
    }
    // W3: runway チップ（バッファ ÷ 月の生活費）。
    var runwayHtml = (vm.bufferConfigured && rw && rw.available)
      ? '<span class="mcc-hero-runway ' + (rw.low ? "low" : "ok") + '" title="目標 ' + esc(String(vm.bufferMonths)) + 'ヶ月分">生活費 ' + esc(rw.months.toFixed(1)) + 'ヶ月分</span>'
      : "";
```

同関数の return 内、`'<div class="mcc-hero-amount">' + amount + '</div>' +` を次に差し替え:

```js
        '<div class="mcc-hero-amount-row"><div class="mcc-hero-amount">' + amount + '</div>' + momHtml + '</div>' +
```

同 return 内、`'<span class="mcc-hero-gauge-pct">' + gaugePct + '%</span>' + doneBadge +` を次に差し替え:

```js
            '<span class="mcc-hero-gauge-pct">' + gaugePct + '%</span>' + doneBadge + runwayHtml +
```

(b) `seriesSection` の直後に `reminderRail` を追加:

```js
  // W3: リマインド帯（spec §4.4・§7）。rem=R.reminders(...)。0件なら DOM を作らない。
  function reminderRail(rem) {
    if (!rem || !rem.length) return "";
    var items = rem.map(function (it) {
      var text, jumpLabel;
      if (it.key === "nisa") {
        var d = it.data;
        text = it.level === "urgent"
          ? '今年の NISA 非課税枠 ' + R.yen(d.remainingTotal) + ' が未使用です（今月が最後・翌年に繰り越せません）。'
          : '今年の NISA 非課税枠が ' + R.yen(d.remainingTotal) + ' 残っています（月 ' + R.yen(d.monthlyToFillTotal) + ' で年内満額・残 ' + d.monthsLeft + 'ヶ月）。年内に使わなかった枠は翌年に繰り越せません。';
        jumpLabel = "→ NISA";
      } else {
        var o = it.data, nm = '「' + esc(it.label || "（無題）") + '」', dl = '期日（' + esc(fmtAnchorMonth(it.deadline)) + '）';
        text = it.level === "urgent"
          ? nm + 'は' + dl + 'を過ぎていますが ' + R.yen(o.projectedShortfall) + ' 未達です。'
          : nm + 'は' + dl + 'までに ' + R.yen(o.projectedShortfall) + ' 不足の見込みです（今のペース 月 ' + R.yen(it.allocated) + '）。';
        jumpLabel = "→ 確保枠";
      }
      return '<div class="mcc-rail-item ' + it.level + '" data-key="' + esc(it.key) + '" data-id="' + esc(String(it.id)) + '">' +
        '<span class="mcc-rail-ico">●</span><span class="mcc-rail-text">' + text + '</span>' + jumpLink(it.jump, jumpLabel) + '</div>';
    });
    return '<div class="mcc-rail" role="status">' + items.join("") + '</div>';
  }
```

(c) `render()` の Task 3 追加分（`var span = ...`）の直後に追加:

```js
    var rw = R.runwayMonths(eff);
    var nrem = R.nisaReminder(nvm, now);
    var hasSurplusCtx = cv.available && cv.surplusPositive;
    var rol = cd.reserveAlloc.map(function (ra) { return R.reserveOutlook(ra, now, hasSurplusCtx); });
    var rem = R.reminders({ nisa: sync.loggedIn ? nrem : null,
      reserves: cd.reserveAlloc.map(function (ra, i) { return { id: ra.id, label: ra.label, deadline: ra.deadline, allocated: ra.allocated, outlook: rol[i] }; }) });
```
⚠ `nvm` は現状 `dashHtml` 直前で宣言されている（`var nvm = R.nisaViewModel(eff, cd, now, _investmentRows);`）。**その行を上記ブロックより前（`var rm = R.roadmap(...)` の直後）へ移動**する（同じ式・同じ引数）。

(d) `render()` の `dashHtml` を差し替え:

```js
    var dashHtml = syncBar() + saveWarn + stepperSection(ob) + heroSection(vm, cv, cdMain, mom, rw) +
      reminderRail(rem) + seriesSection(series, mom, span, _seriesPeriod) +
      cashflowSection(cv) + roadmapSection(rm, sync.loggedIn) + nisaSection(nvm) +
      assetClassSection(vm) + reservesGoalsSection(vm, cv, cdMain) + adviceSection(vm);
```

- [ ] **Step 4: `money.css`**

`.mcc-hero-amount { ... }`（84-87行）に `display: inline-block;` を追加し、`.mcc-hero-gauge-row { display: flex; align-items: center; gap: 10px; }` を `.mcc-hero-gauge-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }` に変更。末尾に追加:

```css
/* ==== W3: ヒーローの前月比バッジ・runway チップ・リマインド帯（spec §5）==== */
.mcc-hero-amount-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
.mcc-hero-mom { font-size: 12px; font-weight: 700; letter-spacing: 0.5px; border: 1px solid; border-radius: 4px; padding: 2px 8px; white-space: nowrap; }
.mcc-hero-mom.pos { color: var(--c-emerald-bright); border-color: rgba(16,185,129,0.5); }
.mcc-hero-mom.neg { color: var(--c-danger-soft); border-color: rgba(255,0,61,0.45); }
.mcc-hero-mom.flat { color: var(--c-text-dim); border-color: rgba(255,255,255,0.15); }
.mcc-hero-runway { font-size: 12px; font-weight: 700; border: 1px solid rgba(56,189,248,0.45); border-radius: 4px; padding: 1px 7px; color: var(--c-cyan-pale); white-space: nowrap; }
.mcc-hero-runway.low { color: var(--c-amber-pale); border-color: rgba(251,191,36,0.55); }
.mcc-rail { margin: 12px 0 0; display: flex; flex-direction: column; gap: 6px; }
.mcc-rail-item {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 6px;
  border: 1px solid rgba(129,140,248,0.2); border-left-width: 3px; background: rgba(15,20,34,0.5);
  color: var(--c-text); font-size: 0.8rem; line-height: 1.5; font-family: var(--ix-sans); letter-spacing: 0;
}
.mcc-rail-item.warn { border-left-color: var(--c-amber); } .mcc-rail-item.warn .mcc-rail-ico { color: var(--c-amber); }
.mcc-rail-item.urgent { border-left-color: var(--c-danger-soft); background: rgba(255,0,61,0.08); } .mcc-rail-item.urgent .mcc-rail-ico { color: var(--c-danger-soft); }
.mcc-rail-text { flex: 1 1 240px; min-width: 0; }
.mcc-rail-item .mcc-jump { white-space: nowrap; }
```

- [ ] **Step 5: 受入**

Run: `node --check money.js && echo OK`
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js` → `ALL PASS`
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js` → `ALL PASS`（`.mcc-hero-amount` の中身は金額のみ＝既存アサート維持）

- [ ] **Step 6: コミット**

```bash
git add money.js money.css scratchpad/w3-smoke.js
git commit -m "feat(w3): ヒーローに前月比バッジ・runway チップ、ヒーロー直下にリマインド帯（NISA/確保枠）"
```

---

### Task 5: fold 内の行（目標の見通し／確保枠の見通し／NISA 残枠）＋ NISA digest

**Files:**
- Modify: `money.js`（`goalsSection`／`reservesSection`／`reservesGoalsSection`／`nisaSection` の署名と本文／`render()` 配線）
- Modify: `money.css`（末尾）
- Modify: `scratchpad/w3-smoke.js`（S5 追加）

**Interfaces:**
- Consumes: `R.goalOutlook`／`rol`・`nrem`（Task 4 の render 変数）／`cd.monthlySurplus`／`R.yen`／`fmtAnchorMonth`。
- Produces: DOM `.mcc-goal-outlook[.behind|.overdue]`（各 `.mcc-goal` 内・`.mcc-goal-stat` の直後）、`.mcc-rsv-outlook[.short|.overdue|.ok]`（各 `.mcc-rsv` 内・`.mcc-rsv-sub` の直後）、`.mcc-nisa-reminder.info|warn|urgent`（`.mcc-nisa` 本文先頭）、NISA digest 末尾の `・残枠 ¥X`。

- [ ] **Step 1: 受入シナリオ S5 を追加（S4 ブロックの直後）**

```js
    // ---- S5 fold 内の行（goals/reserves/nisa）----
    {
      const cd = R.cashflowDerived(rows, eff, NOW_AUG);
      const vm = R.viewModel(eff);
      const gol = vm.goals.map((g) => R.goalOutlook(g, vm.totalAssets, cd.monthlySurplus, NOW_AUG));
      const hasSurplusCtx = cd.available && cd.monthlySurplus > 0;
      const rol = cd.reserveAlloc.map((ra) => R.reserveOutlook(ra, NOW_AUG, hasSurplusCtx));
      const nrem = R.nisaReminder(R.nisaViewModel(eff, cd, NOW_AUG, []), NOW_AUG);
      const { context, page, errors } = await newPage(browser, PC, NOW_AUG, true);
      const f = await page.evaluate(() => ({
        goals: Array.from(document.querySelectorAll(".mcc-goal")).map((g) => (g.querySelector(".mcc-goal-outlook")?.className || "") + "|" + (g.querySelector(".mcc-goal-outlook")?.textContent || "")),
        rsv: Array.from(document.querySelectorAll(".mcc-rsv")).map((r) => (r.querySelector(".mcc-rsv-outlook")?.className || "") + "|" + (r.querySelector(".mcc-rsv-outlook")?.textContent || "")),
        nisa: document.querySelector(".mcc-nisa-reminder")?.className + "|" + (document.querySelector(".mcc-nisa-reminder")?.textContent || ""),
        nisaDigest: document.querySelector("#mcc-sec-nisa .mcc-fold-dg")?.textContent || "",
      }));
      gol.forEach((o, i) => {
        const t = f.goals[i] || "";
        if (o.status === "achieved") check("S5 goal[" + i + "] achieved は行なし", t === "|", t);
        else if (o.status === "onTrack") check("S5 goal[" + i + "] onTrack", t.indexOf("期限に間に合う見込み") >= 0 && t.indexOf(R.yen(o.requiredMonthly)) >= 0, t);
        else if (o.status === "behind") check("S5 goal[" + i + "] behind", t.indexOf("behind") >= 0 && t.indexOf("間に合わせるには 月 " + R.yen(o.requiredMonthly)) >= 0, t);
        else if (o.status === "noDeadline") check("S5 goal[" + i + "] noDeadline", t.indexOf("達成見込み") >= 0 && t.indexOf("期限") < 0, t);
        else if (o.status === "overdue") check("S5 goal[" + i + "] overdue", t.indexOf("overdue") >= 0 && t.indexOf("過ぎています") >= 0, t);
        else check("S5 goal[" + i + "] noPace", t.indexOf("見込みが立ちません") >= 0, t);
      });
      rol.forEach((o, i) => {
        const t = f.rsv[i] || "";
        if (o.status === "short") check("S5 reserve[" + i + "] short", t.indexOf("short") >= 0 && t.indexOf(R.yen(o.projectedShortfall) + " 不足の見込み") >= 0, t);
        else if (o.status === "onTrack") check("S5 reserve[" + i + "] onTrack", t.indexOf("確保できる見込み") >= 0, t);
        else if (o.status === "overdue") check("S5 reserve[" + i + "] overdue", t.indexOf("overdue") >= 0, t);
        else check("S5 reserve[" + i + "] " + o.status + " は行なし", t === "|", t);
      });
      if (nrem.level !== "none") {
        check("S5 NISA 行のレベル", f.nisa.indexOf(nrem.level) >= 0, f.nisa);
        check("S5 NISA 行の文言", f.nisa.indexOf("翌年に繰り越せません") >= 0 && f.nisa.indexOf(R.yen(nrem.remainingTotal)) >= 0 && f.nisa.indexOf("残 " + nrem.monthsLeft + "ヶ月") >= 0, f.nisa);
        check("S5 NISA digest に残枠", f.nisaDigest.indexOf("残枠 " + R.yen(nrem.remainingTotal)) >= 0, f.nisaDigest);
      }
      check("S5 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
    }
```

- [ ] **Step 2: 失敗を確認**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js`
Expected: S5 の goal/reserve/NISA の行が ✗（要素なし）。S1〜S4 は緑。

- [ ] **Step 3: `money.js` 実装**

(a) `goalsSection(vm)` → `goalsSection(vm, gol, pace)`。`items` の map 内で `sub` の直後に追加し、return の `'<div class="mcc-goal-stat">' + sub + (dl ? ' ' + dl : '') + '</div>' +` の直後に `outlook +` を挿入:

```js
      var o = (gol && gol[idx]) || null;
      var outlook = "";
      if (o && !g.achieved) {
        var eta = o.etaPeriod ? '達成見込み ' + esc(fmtAnchorMonth(o.etaPeriod)) + 'ごろ（現ペース 月 ' + R.yen(pace) + '）' : '';
        var txt = "", cls = "";
        if (o.status === "onTrack") txt = eta + '・期限に間に合う見込み（必要 月 ' + R.yen(o.requiredMonthly) + '）';
        else if (o.status === "behind") { cls = " behind"; txt = (eta || '現ペースでは見込みが立ちません') + '・期限（' + esc(fmtAnchorMonth(g.deadline)) + '）に間に合わせるには 月 ' + R.yen(o.requiredMonthly); }
        else if (o.status === "noDeadline") txt = eta;
        else if (o.status === "overdue") { cls = " overdue"; txt = '期限（' + esc(fmtAnchorMonth(g.deadline)) + '）を過ぎています・あと ' + R.yen(o.remaining); }
        else txt = '現ペースでは見込みが立ちません（余剰が 0 の月が続いています）';
        if (txt) outlook = '<div class="mcc-goal-outlook' + cls + '">' + txt + '</div>';
      }
```
（map のコールバックを `function (g, idx)` にして `idx` を受ける。）

(b) `reservesSection(cv, cd)` → `reservesSection(cv, cd, rol)`。`cards` の map を `function (rv, idx)` にし、`alloc` の直後に追加、return の `'<div class="mcc-rsv-sub">' + monthly + alloc + '</div>' +` の直後に `outlook +` を挿入:

```js
      var o = (rol && rol[idx]) || null;
      var outlook = "";
      if (o && o.status === "short") outlook = '<div class="mcc-rsv-outlook short">期日までに ' + cv.fmt(o.projectedShortfall) + ' 不足の見込み（今のペース 月 ' + cv.fmt(rv.allocated) + '）</div>';
      else if (o && o.status === "overdue") outlook = '<div class="mcc-rsv-outlook overdue">期日（' + esc(fmtAnchorMonth(rv.deadline)) + '）を過ぎていますが ' + cv.fmt(o.projectedShortfall) + ' 未達です</div>';
      else if (o && o.status === "onTrack") outlook = '<div class="mcc-rsv-outlook ok">期日までに確保できる見込み</div>';
```

(c) `reservesGoalsSection(vm, cv, cd)` → `reservesGoalsSection(vm, cv, cd, gol, rol, pace)`。末尾の `reservesSection(cv, cd) + goalsSection(vm)` を `reservesSection(cv, cd, rol) + goalsSection(vm, gol, pace)` に。

(d) `nisaSection(vm)` → `nisaSection(vm, nrem)`。`bodyHtml` 確定後（`else { ... bodyHtml = hud + heroHtml + grid2Html + chipsHtml; }` の閉じ直後）に追加:

```js
    // W3: 年内残枠の行（¥はログイン時のみ＝既存の表示方針と同じ）。
    var remHtml = "";
    if (nrem && nrem.level !== "none" && loggedIn) {
      remHtml = '<div class="mcc-nisa-reminder ' + esc(nrem.level) + '">今年の非課税枠は翌年に繰り越せません。残り ' + R.yen(nrem.remainingTotal) +
        '（つみたて ' + R.yen(nrem.remainingTsumitate) + '・成長 ' + R.yen(nrem.remainingGrowth) + '）・月 ' + R.yen(nrem.monthlyToFillTotal) +
        ' で年内満額（残 ' + nrem.monthsLeft + 'ヶ月）</div>';
    }
```
`digest` の算出の直後に追加:

```js
    if (nrem && nrem.level !== "none" && loggedIn) digest += '・残枠 <b>' + esc(R.yen(nrem.remainingTotal)) + '</b>';
```
return の `'<div class="mcc-section-desc">...</div>' +` の直後（`bodyHtml +` の前）に `remHtml +` を挿入。

(e) `render()`: Task 4 のブロック（`var rem = ...`）の直後に追加:

```js
    var gol = vm.goals.map(function (g) { return R.goalOutlook(g, vm.totalAssets, cd.monthlySurplus, now); });
```
`dashHtml` の `nisaSection(nvm)` を `nisaSection(nvm, nrem)`、`reservesGoalsSection(vm, cv, cdMain)` を `reservesGoalsSection(vm, cv, cdMain, gol, rol, cd.monthlySurplus)` に。

- [ ] **Step 4: `money.css` 末尾に追加**

```css
/* ==== W3: fold 内の見通し行 ==== */
.mcc-goal-outlook, .mcc-rsv-outlook { color: var(--c-text-dim); font-size: 12px; margin-top: 4px; line-height: 1.5; font-family: var(--ix-sans); letter-spacing: 0; }
.mcc-goal-outlook.behind, .mcc-rsv-outlook.short { color: var(--c-amber-pale); }
.mcc-goal-outlook.overdue, .mcc-rsv-outlook.overdue { color: var(--c-danger-soft); }
.mcc-rsv-outlook.ok { color: var(--c-emerald-soft); }
.mcc-nisa-reminder {
  margin: 0 0 12px; padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(129,140,248,0.2); border-left-width: 3px;
  background: rgba(15,20,34,0.5); color: var(--c-text); font-size: 0.8rem; line-height: 1.5; font-family: var(--ix-sans); letter-spacing: 0;
}
.mcc-nisa-reminder.info { border-left-color: var(--c-cyan); }
.mcc-nisa-reminder.warn { border-left-color: var(--c-amber); }
.mcc-nisa-reminder.urgent { border-left-color: var(--c-danger-soft); background: rgba(255,0,61,0.08); }
```

- [ ] **Step 5: 受入**

Run: `node --check money.js && echo OK`
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js` → `ALL PASS`
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js` → `ALL PASS`
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js` → 緑（既存の合格表示）

- [ ] **Step 6: コミット**

```bash
git add money.js money.css scratchpad/w3-smoke.js
git commit -m "feat(w3): 目標の達成見込み・確保枠の不足見込み・NISA 年内残枠の行を各 fold に追加"
```

---

### Task 6: 偽陽性の潰し＋全スイート

**Files:**
- 一時変更（コミットしない）: `money-rules.js`／`money.js`
- 確認のみ: 全スイート

- [ ] **Step 1: 後方累積を壊して赤を見る**

`money-rules.js` の `assetSeries` 内 `cash = cash - flow(p);` を一時的に `cash = cash + flow(p);` に変える。
Run: `node --test tests/money-pfm.test.js` → 「後方累積」テストが FAIL することを確認。
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js` → S1 のキャプション/点数系は緑のままでもよいが、ユニットが赤なら十分。
`git checkout -- money-rules.js` で戻す。

- [ ] **Step 2: reminders の順序を壊して赤を見る**

`money-rules.js` の `reminders` 内 `var rank = { urgent: 0, warn: 1 };` を `{ urgent: 1, warn: 0 }` に。
Run: `node --test tests/money-pfm.test.js` → 「reminders: …順」が FAIL。
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js` → 「S4 11月 帯[i] 順序」が ✗（fixture で urgent と warn が同時に出る 11月）。
`git checkout -- money-rules.js` で戻す。

- [ ] **Step 3: LS 保存を外して赤を見る**

`money.js` の `setSeriesPeriod` 内 `localStorage.setItem(_SERIES_KEY, _seriesPeriod);` をコメントアウト。
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js` → 「S1 LS に保存」「S1 リロード後も ALL」が ✗。
`git checkout -- money.js` で戻す。

- [ ] **Step 4: 全スイート（最終）**

```bash
node --test tests/*.test.js
/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_advice_facts.py -q
NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js
NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
git diff --stat a6a34b3 -- api/ index.html db/ scripts/ tests/fixtures/advice_facts_cases.json vercel.json
```
Expected: 全緑／106 passed／ALL PASS ×3／最後の diff は**出力なし**。

- [ ] **Step 5: 作業ツリーがクリーンなことを確認**

Run: `git status --short` → 出力なし（一時変更が残っていないこと）。

---

### Task 7: ドキュメント（プロジェクト CLAUDE.md・spec 追補）

**Files:**
- Modify: `.claude/CLAUDE.md`（「お金の司令塔／司令室」節の先頭 bullet 群の直後に追記）
- Modify: `docs/superpowers/specs/2026-08-27-w3-cockpit-pfm-design.md`（§3.3 `reminders` の入力形に `deadline`／`allocated` を追補）

- [ ] **Step 1: `.claude/CLAUDE.md` に追記（司令室節の `- **E2Eハーネス**＝…` bullet の直後）**

```markdown
  - **🆕 W3 司令室PFMパック（spec `docs/superpowers/specs/2026-08-27-w3-cockpit-pfm-design.md`）**：資産の推移（月次導出＝`R.assetSeries`・アンカー月初を固定点に前方+Σ/後方−Σ・invest は現在値固定・欠月で打切）／前月比 `momDelta`／runway `runwayMonths`／目標 `goalOutlook`／確保枠 `reserveOutlook`／NISA `nisaReminder`／帯 `reminders`。**全て UI 専用の純関数＝facts 非出力・advice.py 鏡像なし・state 不変**。グラフは inline SVG（`seriesSvg`・インスタンス管理なし）。期間は端末 LS `mcc_series_period`（クラウド非同梱）。⚠**不変条件**＝`assetSeries` の最後の確定点 cash === `cashDerived().derivedCash`（`tests/money-pfm.test.js` が機械証明・`cashDerived` の flow 定義を変えるなら両方同時に）。⚠`.mcc-hero-amount` の中身は金額のみ（前月比バッジは兄弟 `.mcc-hero-mom`）。受入＝`W3_VARIANTS=0 python3 scratchpad/w3-mock-server.py`（w3-smoke が自前起動）＋`NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js`。
```

- [ ] **Step 2: spec §3.3 の `reminders` 行を差し替え**

`| \`reminders(input)\` | \`{nisa: nisaReminder結果, reserves: [{id,label,outlook}]}\` | ...` の行を次に:

```markdown
| `reminders(input)` | `{nisa: nisaReminder結果, reserves: [{id,label,deadline,allocated,outlook}]}` | `[{key,id,label?,deadline?,allocated?,level,jump,data}]` | 帯に出す項目（warn/urgent のみ・urgent→warn 順・同レベルは入力順）。`deadline`／`allocated` は帯の文言用に素通し |
```

- [ ] **Step 3: コミット**

```bash
git add .claude/CLAUDE.md docs/superpowers/specs/2026-08-27-w3-cockpit-pfm-design.md
git commit -m "docs(w3): CLAUDE.md 司令室節に W3 の規律を追記・spec §3.3 reminders 入力形を追補"
```

---

## 完了条件（plan 全体）

- Task 1〜7 のコミットが `worktree-w3-cockpit-pfm` に積まれ、`git status --short` が空。
- `node --test tests/*.test.js` 全緑（既存 + `money-pfm` 16）／pytest `test_advice_facts.py` 106／`w3-smoke.js`・`cockpit-e2e.js`・`portal-money-smoke.js` ALL PASS。
- `git diff --stat a6a34b3 -- api/ index.html db/ scripts/ tests/fixtures/advice_facts_cases.json vercel.json` が空。
- 本人の本番（persona ログイン）実機サニティは merge/push 後（plan の外）。
