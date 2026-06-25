# お金の司令塔（Money Command Center / MCC）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** investment-portal に「お金の司令塔」プライベートビューを追加し、3バケツ（バッファ/コア/サテライト）の可視化とルールベースの規律ガイダンスを提供する。

**Architecture:** 既存の単一ファイル静的SPA（`index.html`）に3つ目の `.view-section`（`#money-view`）を追加。業務ロジックは環境非依存の純関数モジュール `money-rules.js`（ブラウザ global ＋ Node require の両対応）に隔離してユニットテストし、`money.js`（IIFE `window.MCC`）はその純関数の出力をDOMへ適用する薄い層に徹する。個人実データは `localStorage["mcc_state"]` 限定でサーバ送信ゼロ。

**Tech Stack:** Vanilla HTML/CSS/JS（ビルド工程なし・静的配信）。テストは Node 標準 `node:test`（追加依存なし）。既存CDN（Chart.js 等）は本MVPでは未使用（手入力のみ）。

## Global Constraints

以下は spec（`docs/superpowers/specs/2026-06-26-money-command-center-design.md`）由来の全タスク共通制約。各値は厳守。

- ビルド工程を追加しない。Vanilla JS のみ。新しいランタイム依存（npmパッケージ）を本番に追加しない。
- 個人実データは **`localStorage` 限定**。`fetch`/`XMLHttpRequest`/外部送信を一切追加しない（ネットワーク送信ゼロ）。
- 既存 `data.js`（21MB）には触れない。既存 `index.html` の既存ロジック（チャート/スクリーナー等）も変更しない。追加は「ナビ1ボタン・`#money-view`・head の `<link>`・body末尾の `<script>` 2本」のみ。
- 新コードは隔離：`money-rules.js`（純関数・dual export）／`money.js`（global `window.MCC` の IIFE）／`money.css`（専用CSS）／localStorage 名前空間 `mcc_*`。
- 既定値：バッファ **6ヶ月** ／ サテライト上限 **10%**（investable 比）／ 通貨 **JPY**。すべてユーザー設定で変更可。
- `investable = core + satellite`（バッファは含めない）。優先順位は **バッファ → コア →（余剰のみ上限内）サテライト**。
- デザインは既存トークン流用：背景ダーク紺（`#070c16`→`#0e1422`）、テーマ `#4f46e5`、藍→紫グラデ、`Helvetica Neue, Arial`。

## File Structure

- **Create** `money-rules.js`（リポ直下）… 純関数ロジック。`defaultState` / `migrate` / `bufferTarget` / `bufferProgress` / `bufferRemaining` / `investable` / `satelliteCap` / `satelliteOver` / `nextAllocation` / `viewModel` / `yen`。ブラウザでは `window.MCCRules`、Node では `module.exports`。
- **Create** `money.js`（リポ直下）… `window.MCC` IIFE。state の load/save、ビュー表示切替（show/backToPortal）、`viewModel` を DOM に適用する render、入力イベント、export/import。
- **Create** `money.css`（リポ直下）… `#money-view` 専用スタイル。
- **Create** `tests/money-rules.test.js` … `node:test` による純関数ユニットテスト。
- **Modify** `index.html` … (1) head に `<link rel="stylesheet" href="money.css">`、(2) `portal-header-row`（:1544）に「司令塔」ボタン、(3) `#detail-view` セクション直後に `#money-view` ブロック、(4) `</body>`（:4125）直前に `money-rules.js`→`money.js` の順で `<script>`。

---

### Task 1: ルールエンジン（純関数）＋ ユニットテスト

**Files:**
- Create: `money-rules.js`
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Produces（後続タスクが依存）:
  - `MCCRules.STORAGE_KEY: string` = `"mcc_state"`、`MCCRules.CURRENT_VERSION: number` = `1`
  - `defaultState(): State`、`migrate(raw:any): State`
  - `bufferTarget(s)`, `bufferProgress(s)`, `bufferRemaining(s)`, `investable(s)`, `satelliteCap(s)`, `satelliteOver(s)` : number
  - `nextAllocation(s): {target:"buffer"|"core"|"rebalance", message:string, ...}`
  - `viewModel(s): {currency, monthlyExpense, bufferMonths, bufferAmount, coreAmount, satelliteAmount, bufferTarget, bufferProgress, bufferProgressPct, bufferRemaining, investable, satelliteCap, satelliteOver, satelliteIsOver, satelliteFillPct, next, fmt}`
  - `yen(n): string`
  - State 形: `{version, currency, monthlyExpense, bufferMonths, buckets:{buffer:{amount}, core:{amount}, satellite:{amount}}, satelliteCapPct, history:[]}`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/money-rules.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../money-rules.js");

test("defaultState は6ヶ月バッファ・10%上限・全バケツ0", () => {
  const s = R.defaultState();
  assert.equal(s.version, R.CURRENT_VERSION);
  assert.equal(s.bufferMonths, 6);
  assert.equal(s.satelliteCapPct, 10);
  assert.equal(s.buckets.buffer.amount, 0);
  assert.equal(s.currency, "JPY");
});

test("bufferTarget = monthlyExpense * bufferMonths", () => {
  const s = R.defaultState(); s.monthlyExpense = 300000;
  assert.equal(R.bufferTarget(s), 1800000);
});

test("bufferProgress は 0..1 にclampしゼロ除算を避ける", () => {
  const s = R.defaultState();
  assert.equal(R.bufferProgress(s), 0); // target 0
  s.monthlyExpense = 100000; // target 600000
  s.buckets.buffer.amount = 300000;
  assert.equal(R.bufferProgress(s), 0.5);
  s.buckets.buffer.amount = 600000;
  assert.equal(R.bufferProgress(s), 1);
  s.buckets.buffer.amount = 9999999;
  assert.equal(R.bufferProgress(s), 1); // clamp上限
});

test("bufferRemaining は残額（達成後は0）", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; // target 600000
  s.buckets.buffer.amount = 250000;
  assert.equal(R.bufferRemaining(s), 350000);
  s.buckets.buffer.amount = 700000;
  assert.equal(R.bufferRemaining(s), 0);
});

test("investable=core+satellite、satelliteCap=investable*pct、over算出", () => {
  const s = R.defaultState();
  s.buckets.core.amount = 900000; s.buckets.satellite.amount = 100000; // investable 1,000,000
  assert.equal(R.investable(s), 1000000);
  assert.equal(R.satelliteCap(s), 100000); // 10%
  assert.equal(R.satelliteOver(s), 0);
  s.buckets.satellite.amount = 150000; // investable 1,050,000 cap 105,000 -> over 45,000
  assert.equal(R.satelliteCap(s), 105000);
  assert.equal(R.satelliteOver(s), 45000);
});

test("investable=0 では cap=0・over=0（ゼロ除算なし）", () => {
  const s = R.defaultState();
  assert.equal(R.satelliteCap(s), 0);
  assert.equal(R.satelliteOver(s), 0);
});

test("nextAllocation: バッファ未達 -> buffer", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; s.buckets.buffer.amount = 0;
  const n = R.nextAllocation(s);
  assert.equal(n.target, "buffer");
  assert.equal(n.remaining, 600000);
  assert.match(n.message, /バッファへ/);
});

test("nextAllocation: バッファ達成・サテライト上限内 -> core", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; s.buckets.buffer.amount = 600000;
  s.buckets.core.amount = 900000; s.buckets.satellite.amount = 100000;
  assert.equal(R.nextAllocation(s).target, "core");
});

test("nextAllocation: バッファ達成・サテライト超過 -> rebalance", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; s.buckets.buffer.amount = 600000;
  s.buckets.core.amount = 100000; s.buckets.satellite.amount = 500000; // investable 600000 cap 60000 over 440000
  assert.equal(R.nextAllocation(s).target, "rebalance");
});

test("migrate はゴミ入力を安全なstateに正規化", () => {
  const m = R.migrate({ monthlyExpense: "abc", bufferMonths: -3, buckets: { satellite: { amount: -5 } }, history: "nope", satelliteCapPct: 25 });
  assert.equal(m.monthlyExpense, 0);
  assert.equal(m.bufferMonths, 6);
  assert.equal(m.buckets.satellite.amount, 0);
  assert.equal(m.satelliteCapPct, 25);
  assert.deepEqual(m.history, []);
  assert.equal(m.version, R.CURRENT_VERSION);
});

test("migrate(null) は defaultState 同等", () => {
  assert.deepEqual(R.migrate(null), R.defaultState());
});

test("viewModel は表示用フィールドを公開", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; s.buckets.buffer.amount = 300000;
  const vm = R.viewModel(s);
  assert.equal(vm.bufferProgressPct, 50);
  assert.equal(vm.bufferRemaining, 300000);
  assert.equal(typeof vm.next.message, "string");
  assert.equal(vm.fmt(1234), "¥1,234");
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

Run: `node --test tests/money-rules.test.js`
Expected: FAIL（`Cannot find module '../money-rules.js'`）

- [ ] **Step 3: `money-rules.js` を実装**

Create `money-rules.js`:

```js
// money-rules.js — お金の司令塔(MCC) 純関数ロジック。
// ブラウザ(window.MCCRules) と Node(require) の両対応(UMD-lite)。副作用なし。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MCCRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STORAGE_KEY = "mcc_state";
  var CURRENT_VERSION = 1;

  function num(v) { var n = Number(v); return isFinite(n) && n >= 0 ? n : 0; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function yen(n) { return "¥" + Math.round(num(n)).toLocaleString("ja-JP"); }

  function defaultState() {
    return {
      version: CURRENT_VERSION,
      currency: "JPY",
      monthlyExpense: 0,
      bufferMonths: 6,
      buckets: { buffer: { amount: 0 }, core: { amount: 0 }, satellite: { amount: 0 } },
      satelliteCapPct: 10,
      history: [],
    };
  }

  function migrate(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== "object") return d;
    var b = raw.buckets || {};
    return {
      version: CURRENT_VERSION,
      currency: typeof raw.currency === "string" ? raw.currency : d.currency,
      monthlyExpense: num(raw.monthlyExpense),
      bufferMonths: Number(raw.bufferMonths) > 0 ? num(raw.bufferMonths) : d.bufferMonths,
      buckets: {
        buffer: { amount: num(b.buffer && b.buffer.amount) },
        core: { amount: num(b.core && b.core.amount) },
        satellite: { amount: num(b.satellite && b.satellite.amount) },
      },
      satelliteCapPct: Number(raw.satelliteCapPct) >= 0 ? num(raw.satelliteCapPct) : d.satelliteCapPct,
      history: Array.isArray(raw.history)
        ? raw.history.filter(function (h) { return h && typeof h.date === "string"; })
            .map(function (h) { return { date: h.date, buffer: num(h.buffer), core: num(h.core), satellite: num(h.satellite) }; })
        : [],
    };
  }

  function bufferTarget(s) { return num(s.monthlyExpense) * num(s.bufferMonths); }
  function bufferProgress(s) { var t = bufferTarget(s); return t > 0 ? clamp(num(s.buckets.buffer.amount) / t, 0, 1) : 0; }
  function bufferRemaining(s) { return Math.max(0, bufferTarget(s) - num(s.buckets.buffer.amount)); }
  function investable(s) { return num(s.buckets.core.amount) + num(s.buckets.satellite.amount); }
  function satelliteCap(s) { return investable(s) * num(s.satelliteCapPct) / 100; }
  function satelliteOver(s) { return Math.max(0, num(s.buckets.satellite.amount) - satelliteCap(s)); }

  function nextAllocation(s) {
    if (bufferProgress(s) < 1) {
      return { target: "buffer", remaining: bufferRemaining(s),
        message: "次の余剰はバッファへ。目標まであと " + yen(bufferRemaining(s)) + "（" + num(s.bufferMonths) + "ヶ月分）" };
    }
    if (satelliteOver(s) > 0) {
      return { target: "rebalance", over: satelliteOver(s),
        message: "サテライトが上限超過（" + yen(satelliteOver(s)) + "）。コアへ寄せるか現金化を検討" };
    }
    return { target: "core", cap: satelliteCap(s),
      message: "バッファ達成。次の余剰はコア（長期）へ。サテライトは上限 " + yen(satelliteCap(s)) + " の余剰内のみ" };
  }

  function viewModel(s) {
    var cap = satelliteCap(s);
    var sat = num(s.buckets.satellite.amount);
    return {
      currency: s.currency,
      monthlyExpense: num(s.monthlyExpense),
      bufferMonths: num(s.bufferMonths),
      satelliteCapPct: num(s.satelliteCapPct),
      bufferAmount: num(s.buckets.buffer.amount),
      coreAmount: num(s.buckets.core.amount),
      satelliteAmount: sat,
      bufferTarget: bufferTarget(s),
      bufferProgress: bufferProgress(s),
      bufferProgressPct: Math.round(bufferProgress(s) * 100),
      bufferRemaining: bufferRemaining(s),
      investable: investable(s),
      satelliteCap: cap,
      satelliteOver: satelliteOver(s),
      satelliteIsOver: satelliteOver(s) > 0,
      satelliteFillPct: cap > 0 ? clamp(sat / cap, 0, 1.5) * 100 : (sat > 0 ? 100 : 0),
      next: nextAllocation(s),
      fmt: yen,
    };
  }

  return {
    STORAGE_KEY: STORAGE_KEY, CURRENT_VERSION: CURRENT_VERSION,
    defaultState: defaultState, migrate: migrate,
    bufferTarget: bufferTarget, bufferProgress: bufferProgress, bufferRemaining: bufferRemaining,
    investable: investable, satelliteCap: satelliteCap, satelliteOver: satelliteOver,
    nextAllocation: nextAllocation, viewModel: viewModel, yen: yen,
  };
});
```

- [ ] **Step 4: テストを実行し成功を確認**

Run: `node --test tests/money-rules.test.js`
Expected: PASS（全テスト緑、`# fail 0`）

- [ ] **Step 5: コミット**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(mcc): ルールエンジン純関数+ユニットテスト"
```

---

### Task 2: ビュー雛形・ナビ・include ＋ state永続化（空のrender）

**Files:**
- Modify: `index.html`（head:~1530 / header-row:1544 / #detail-view直後 / body末尾:~4124）
- Create: `money.js`
- Create: `money.css`

**Interfaces:**
- Consumes: `window.MCCRules`（Task 1）
- Produces: `window.MCC.init()`、`window.MCC.show()`、`window.MCC.backToPortal()`、`window.MCC.setField(path, value)`、内部 `state` / `load()` / `save()` / `render()`

- [ ] **Step 1: `index.html` の head に money.css を追加**

`index.html` の `</head>`（:1530）直前に1行追加:

```html
    <link rel="stylesheet" href="money.css">
```

- [ ] **Step 2: ヘッダーに「司令塔」ボタンを追加**

`index.html` の `portal-header-row`（:1544）内、`portal-date`（:1547）の直後に追加:

```html
          <button class="mcc-nav-btn" onclick="MCC.show()" title="お金の司令塔">◎ 司令塔</button>
```

- [ ] **Step 3: `#money-view` ブロックを追加**

`#detail-view`（:1638）セクションの閉じ `</div>` 直後（フッターより前）に挿入:

```html
      <div id="money-view" class="view-section">
        <div class="mcc-wrap">
          <div class="mcc-topbar">
            <button class="back-btn" onclick="MCC.backToPortal()">← ポータルへ戻る</button>
            <h2 class="mcc-title">お金の司令塔</h2>
          </div>
          <div id="mcc-root"><!-- render() がここに描画 --></div>
        </div>
      </div>
```

- [ ] **Step 4: body末尾に script を追加**

`index.html` の主スクリプト閉じ `</script>`（:4124）の直後、`</body>`（:4125）の直前に、`money-rules.js`→`money.js` の順で追加（順序厳守）:

```html
    <script src="money-rules.js"></script>
    <script src="money.js"></script>
```

- [ ] **Step 5: `money.js` の雛形を実装（load/save/show/render空）**

Create `money.js`:

```js
// money.js — お金の司令塔(MCC) ブラウザ層。window.MCCRules(純関数)をDOMへ適用する薄い層。
window.MCC = (function () {
  "use strict";
  var R = window.MCCRules;
  var state = null;

  function load() {
    try {
      var raw = localStorage.getItem(R.STORAGE_KEY);
      state = R.migrate(raw ? JSON.parse(raw) : null);
    } catch (e) { state = R.defaultState(); }
    return state;
  }

  function save() {
    try { localStorage.setItem(R.STORAGE_KEY, JSON.stringify(state)); return true; }
    catch (e) { return false; }
  }

  // path 例: "monthlyExpense" / "bufferMonths" / "satelliteCapPct" / "buckets.buffer.amount"
  function setField(path, value) {
    var parts = path.split(".");
    var obj = state;
    for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = Number(value) >= 0 ? Number(value) : 0;
    save();
    render();
  }

  function show() {
    var views = document.querySelectorAll(".view-section");
    for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
    document.getElementById("money-view").classList.add("active");
    window.scrollTo(0, 0);
  }

  function backToPortal() {
    document.getElementById("money-view").classList.remove("active");
    document.getElementById("portal-view").classList.add("active");
    window.scrollTo(0, 0);
  }

  function render() {
    var root = document.getElementById("mcc-root");
    if (!root) return;
    root.innerHTML = '<p class="mcc-placeholder">司令塔（描画はTask3で実装）</p>';
  }

  function init() {
    if (!R) return;
    load();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { init: init, show: show, backToPortal: backToPortal, setField: setField, load: load, save: save, render: render };
})();
```

- [ ] **Step 6: `money.css` の基盤を実装**

Create `money.css`:

```css
/* money.css — お金の司令塔(MCC) 専用スタイル。既存トークン流用。 */
#money-view .mcc-wrap { max-width: 960px; margin: 0 auto; padding: 16px 14px 60px; }
.mcc-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.mcc-title {
  font-size: 1.05rem; letter-spacing: 2px; font-weight: 700; margin: 0;
  background: linear-gradient(90deg, #60a5fa, #818cf8, #c084fc);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.mcc-nav-btn {
  background: rgba(79,70,229,0.12); border: 1px solid rgba(129,140,248,0.4); color: #c7d2fe;
  padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.74rem; font-weight: 700;
  letter-spacing: 1px; transition: all 0.2s;
}
.mcc-nav-btn:hover { background: rgba(79,70,229,0.25); }
.mcc-placeholder { color: #94a3b8; text-align: center; padding: 40px; }
```

- [ ] **Step 7: ブラウザで検証**

Run（worktree直下で静的サーバ起動・バックグラウンド）: `python3 -m http.server 8765`
ブラウザで `http://localhost:8765` を開き、以下を確認:
- ヘッダーの「◎ 司令塔」ボタンをクリック → `#money-view` が表示され、ポータルが隠れる
- 「← ポータルへ戻る」でポータルに戻る
- DevTools Console: `localStorage.getItem("mcc_state")` が JSON 文字列（`{"version":1,...}`）を返す
- DevTools Console: `MCC.setField("monthlyExpense", 300000)` 実行後、`JSON.parse(localStorage.mcc_state).monthlyExpense === 300000`
- 既存のポータル/銘柄詳細/チャートが従来通り動く（リグレッションなし）

- [ ] **Step 8: コミット**

```bash
git add index.html money.js money.css
git commit -m "feat(mcc): 司令塔ビューの雛形・ナビ・state永続化"
```

---

### Task 3: 本描画（バッファゲージ・3バケツ・設定・サテライト上限/警告・次の一手バナー）

**Files:**
- Modify: `money.js`（`render()` を本実装＋入力ハンドラ）
- Modify: `money.css`（各コンポーネントのスタイル追加）

**Interfaces:**
- Consumes: `R.viewModel(state)`（Task 1）、`MCC.setField`（Task 2）
- Produces: 完成した `render()`（`#mcc-root` に司令塔UIを描画）

- [ ] **Step 1: `money.js` の `render()` を本実装に置換**

`money.js` の `render()` 関数を以下に置換:

```js
  function moneyInput(label, path, value, vm) {
    return '<label class="mcc-field"><span>' + label + '</span>' +
      '<input type="number" min="0" step="1000" value="' + value + '" ' +
      'onchange="MCC.setField(\'' + path + '\', this.value)"></label>';
  }

  function render() {
    var root = document.getElementById("mcc-root");
    if (!root) return;
    var vm = R.viewModel(state);

    var gauge =
      '<div class="mcc-gauge-card">' +
        '<div class="mcc-gauge-label">バッファ目標（生活防衛資金）</div>' +
        '<div class="mcc-gauge-bar"><div class="mcc-gauge-fill" style="width:' + vm.bufferProgressPct + '%"></div></div>' +
        '<div class="mcc-gauge-stat"><strong>' + vm.bufferProgressPct + '%</strong> ' +
          '（' + vm.fmt(vm.bufferAmount) + ' / ' + vm.fmt(vm.bufferTarget) + '）' +
          (vm.bufferRemaining > 0 ? ' ・あと ' + vm.fmt(vm.bufferRemaining) : ' ・達成') +
        '</div>' +
      '</div>';

    var banner =
      '<div class="mcc-banner mcc-banner-' + vm.next.target + '">' +
        '<span class="mcc-banner-icon">▶</span><span>' + vm.next.message + '</span>' +
      '</div>';

    var satWarn = vm.satelliteIsOver
      ? '<div class="mcc-sat-warn">⚠ 上限超過 ' + vm.fmt(vm.satelliteOver) + '</div>' : '';
    var buckets =
      '<div class="mcc-buckets">' +
        '<div class="mcc-bucket"><div class="mcc-bucket-name">バッファ（現金）</div>' +
          moneyInput("金額", "buckets.buffer.amount", vm.bufferAmount, vm) + '</div>' +
        '<div class="mcc-bucket"><div class="mcc-bucket-name">コア（長期）</div>' +
          moneyInput("金額", "buckets.core.amount", vm.coreAmount, vm) + '</div>' +
        '<div class="mcc-bucket' + (vm.satelliteIsOver ? ' mcc-bucket-over' : '') + '">' +
          '<div class="mcc-bucket-name">サテライト（個別株/短期）</div>' +
          moneyInput("金額", "buckets.satellite.amount", vm.satelliteAmount, vm) +
          '<div class="mcc-sat-bar"><div class="mcc-sat-fill' + (vm.satelliteIsOver ? " over" : "") +
            '" style="width:' + Math.min(100, vm.satelliteFillPct) + '%"></div></div>' +
          '<div class="mcc-sat-cap">上限 ' + vm.fmt(vm.satelliteCap) + '（investable比 ' + vm.satelliteCapPct + '%）</div>' +
          satWarn +
        '</div>' +
      '</div>';

    var settings =
      '<details class="mcc-settings"><summary>設定</summary>' +
        moneyInput("月の生活費", "monthlyExpense", vm.monthlyExpense, vm) +
        moneyInput("バッファ目標（ヶ月）", "bufferMonths", vm.bufferMonths, vm) +
        moneyInput("サテライト上限（%）", "satelliteCapPct", vm.satelliteCapPct, vm) +
      '</details>';

    root.innerHTML = gauge + banner + buckets + settings;
  }
```

- [ ] **Step 2: `money.css` にコンポーネントスタイルを追加**

`money.css` の末尾に追記:

```css
.mcc-gauge-card { background: rgba(15,20,34,0.6); border: 1px solid rgba(129,140,248,0.25); border-radius: 12px; padding: 18px; margin-bottom: 14px; box-shadow: 0 0 40px rgba(79,70,229,0.15) inset; }
.mcc-gauge-label { color: #94a3b8; font-size: 0.78rem; letter-spacing: 1px; margin-bottom: 10px; }
.mcc-gauge-bar { height: 14px; background: rgba(255,255,255,0.06); border-radius: 8px; overflow: hidden; }
.mcc-gauge-fill { height: 100%; background: linear-gradient(90deg, #4f46e5, #818cf8, #10b981); transition: width 0.4s ease; }
.mcc-gauge-stat { margin-top: 10px; color: #e2e8f0; font-size: 0.86rem; }
.mcc-gauge-stat strong { color: #c084fc; font-size: 1.1rem; }
.mcc-banner { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-radius: 10px; margin-bottom: 16px; font-size: 0.9rem; color: #e2e8f0; border: 1px solid; }
.mcc-banner-icon { color: #818cf8; }
.mcc-banner-buffer { background: rgba(79,70,229,0.12); border-color: rgba(129,140,248,0.4); }
.mcc-banner-core { background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.35); }
.mcc-banner-rebalance { background: rgba(255,0,61,0.1); border-color: rgba(255,122,157,0.5); }
.mcc-buckets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 640px) { .mcc-buckets { grid-template-columns: 1fr; } }
.mcc-bucket { background: rgba(15,20,34,0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; }
.mcc-bucket-over { border-color: rgba(255,0,61,0.6); box-shadow: 0 0 18px rgba(255,0,61,0.15); }
.mcc-bucket-name { color: #cbd5e1; font-size: 0.78rem; letter-spacing: 1px; margin-bottom: 8px; }
.mcc-field { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; color: #94a3b8; font-size: 0.72rem; }
.mcc-field input { background: rgba(0,0,0,0.3); border: 1px solid rgba(129,140,248,0.3); color: #fff; border-radius: 6px; padding: 7px 9px; font-size: 0.9rem; }
.mcc-sat-bar { height: 8px; background: rgba(255,255,255,0.06); border-radius: 6px; overflow: hidden; margin-top: 10px; }
.mcc-sat-fill { height: 100%; background: #818cf8; }
.mcc-sat-fill.over { background: #ff003d; }
.mcc-sat-cap { color: #94a3b8; font-size: 0.7rem; margin-top: 6px; }
.mcc-sat-warn { color: #ff7a9d; font-size: 0.74rem; font-weight: 700; margin-top: 6px; }
.mcc-settings { margin-top: 18px; color: #cbd5e1; }
.mcc-settings summary { cursor: pointer; font-size: 0.8rem; letter-spacing: 1px; }
```

- [ ] **Step 3: ブラウザで検証**

`python3 -m http.server 8765` 起動済みのまま、`http://localhost:8765` をリロードし「◎ 司令塔」へ:
- 設定で「月の生活費」に `100000` → バッファゲージ目標が `¥600,000` になる
- バッファ金額に `300000` → ゲージ `50%`・「あと ¥300,000」表示、バナーが青（buffer）で「あと ¥300,000」
- バッファ金額に `600000` → ゲージ `100%`、バナーが緑（core）で「コアへ」
- コア `100000`・サテライト `500000` → サテライトカードが赤縁、上限バーが赤、「⚠ 上限超過」表示、バナーが赤（rebalance）
- リロードしても値が保持される（localStorage 復元）

- [ ] **Step 4: コミット**

```bash
git add money.js money.css
git commit -m "feat(mcc): バッファゲージ・3バケツ・上限警告・次の一手バナー"
```

---

### Task 4: エクスポート/インポート・空状態オンボーディング・最終検証

**Files:**
- Modify: `money.js`（export/import、空状態の導入文言）
- Modify: `money.css`（ボタン/オンボーディングのスタイル）

**Interfaces:**
- Consumes: 既存 `state` / `save()` / `render()` / `R.migrate`
- Produces: `MCC.exportJSON()`、`MCC.importJSON(file)`

- [ ] **Step 1: `money.js` に export/import を追加**

`money.js` の `return { ... }` の直前に関数を追加:

```js
  function exportJSON() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mcc_state.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try { state = R.migrate(JSON.parse(reader.result)); save(); render(); }
      catch (e) { alert("読み込みに失敗しました（JSONが不正です）"); }
    };
    reader.readAsText(file);
  }
```

`return { ... }` に `exportJSON: exportJSON, importJSON: importJSON,` を追加。

- [ ] **Step 2: `render()` 末尾に export/import UI と空状態の案内を追加**

`money.js` の `render()` 内、`root.innerHTML = ...` を以下に差し替え（settings の後ろにツールバー・先頭に空状態案内を追加）:

```js
    var isEmpty = vm.monthlyExpense === 0 && vm.bufferAmount === 0 && vm.coreAmount === 0 && vm.satelliteAmount === 0;
    var onboarding = isEmpty
      ? '<div class="mcc-onboard">まず「設定」で月の生活費を、各バケツに現在の金額を入力してください。実データはこの端末（localStorage）にのみ保存され、外部送信されません。</div>'
      : '';
    var tools =
      '<div class="mcc-tools">' +
        '<button class="mcc-tool-btn" onclick="MCC.exportJSON()">↓ エクスポート(JSON)</button>' +
        '<label class="mcc-tool-btn">↑ インポート<input type="file" accept="application/json" style="display:none" ' +
          'onchange="if(this.files[0])MCC.importJSON(this.files[0])"></label>' +
      '</div>';

    root.innerHTML = onboarding + gauge + banner + buckets + settings + tools;
```

- [ ] **Step 3: `money.css` にスタイルを追加**

`money.css` の末尾に追記:

```css
.mcc-onboard { background: rgba(79,70,229,0.1); border: 1px dashed rgba(129,140,248,0.45); border-radius: 10px; padding: 12px 14px; color: #c7d2fe; font-size: 0.8rem; line-height: 1.6; margin-bottom: 14px; }
.mcc-tools { display: flex; gap: 10px; margin-top: 18px; }
.mcc-tool-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); color: #cbd5e1; padding: 7px 12px; border-radius: 7px; cursor: pointer; font-size: 0.74rem; }
.mcc-tool-btn:hover { background: rgba(255,255,255,0.1); }
```

- [ ] **Step 4: 全ユニットテスト再実行**

Run: `node --test tests/money-rules.test.js`
Expected: PASS（`# fail 0`）

- [ ] **Step 5: ブラウザで最終検証（受け入れ基準）**

`http://localhost:8765` をリロードし「◎ 司令塔」へ:
- 初回（`localStorage.removeItem("mcc_state")` 後リロード）で空状態案内が出る
- 一通り入力 → 「↓ エクスポート」で `mcc_state.json` がDLされる
- `localStorage.removeItem("mcc_state")` → リロード → 「↑ インポート」でそのJSONを選択 → 値が復元される
- DevTools Network タブ：司令塔操作中に外部へのリクエストが発生しない（送信ゼロ）
- 既存ポータル/詳細/チャートにリグレッションなし

- [ ] **Step 6: コミット**

```bash
git add money.js money.css
git commit -m "feat(mcc): export/import・空状態オンボーディング"
```

---

## Self-Review（計画 vs spec）

**1. Spec coverage:**
- §3 統合/衛生 → Task 2（head link / header button / #money-view / 末尾script・別ファイル隔離）✅
- §4 データモデル `mcc_state` → Task 1 `defaultState`/`migrate` ＋ Task 2 load/save ✅
- §5 ルールエンジン（全純関数＋`nextAllocation`の3分岐）→ Task 1（ユニットテスト網羅）✅
- §6 UI（ゲージ/バナー/3バケツ/サテライト上限・警告/設定/export-import/空状態）→ Task 3・4 ✅
- §7 エラー処理（非負・ゼロ除算・migrate・localStorage失敗）→ Task 1 migrate/num・Task 2 try-catch・Task 3 input min=0 ✅
- §8 テスト（純関数ユニット＋スモーク）→ Task 1 node:test ＋ Task 2-4 ブラウザ検証 ✅
- §9 デプロイ（静的・data.js不触）→ Global Constraints・各Taskで遵守 ✅
- §11 受け入れ基準 → Task 4 Step 5 で全項目チェック ✅
- スコープ外（AIコーチ・保有明細・多通貨等）→ 本計画に含めない ✅

**2. Placeholder scan:** 各Stepに実コード/実コマンド/期待出力を記載。"TBD/TODO/後で" 無し。

**3. Type consistency:** `viewModel` のフィールド名（`bufferProgressPct`/`satelliteFillPct`/`satelliteIsOver`/`next.target` 等）を Task 1 定義と Task 3 render 利用で一致確認。`setField(path,value)` のpath（`buckets.buffer.amount` 等）は state 形と一致。`STORAGE_KEY`/`CURRENT_VERSION` は Task 1 export を Task 2 が参照。

**4. 既知の割り切り（MVP・spec準拠）:** render は `innerHTML` 全置換のため number入力は `change`（blur時）で確定 → 入力中のフォーカス喪失なし。history/スパークラインは spec で任意のため本MVPでは未実装（受け入れ基準にも含めず）。
