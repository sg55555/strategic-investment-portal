# W2「詳細の時間軸パック」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 銘柄詳細ビューに「期間切替バー（FY|1M|3M|6M|YTD|1Y|5Y|MAX）／52週レンジバー／ベンチマーク重ね描き」を入れる。

**Architecture:** 純計算は `detail-rules.js`（DOM 非依存・UMD）、チャート lifecycle は `detail-charts.js`（IIFE closure）、
オーケストレーションと DOM は `detail.js`（IIFE closure・`window.Detail` に公開）という既存の分業をそのまま踏襲する。
期間切替は **`setData` で窓を差し替える**（`setVisibleLogicalRange` で見た目だけ動かすのは禁止＝spec §13 R1）。
新しい Vercel 関数はゼロ（既存 `/api/market/ohlcv` と `/api/market/list` だけで賄う）。

**Tech Stack:** Vanilla JS（classic script・UMD-lite）／Lightweight Charts v4.2.3／node:test／Playwright／Python 標準ライブラリ（モック鯖）

**Spec:** `docs/superpowers/specs/2026-08-23-w2-detail-time-axis-design.md`

## Global Constraints

- **作業ディレクトリは worktree `/home/shugo/apps/investment-portal/.claude/worktrees/w2-time-axis`**。ここ以外を編集しない。
- **新しい Vercel 関数を作らない**（現在 11/12・上限12）。`api/` 配下は一切触らない。
- **純計算は `detail-rules.js`**（DOM 非依存・descriptor を返す）。`detail.js` / `detail-charts.js` に業務計算を書かない。
- **`window` 公開面を勝手に増やさない**（F2 規律）。inline `onclick` 属性を新設しない。ボタンは JS 生成＋closure `onclick`。
- **`.ctrl-pair` / `.term-help` の構造を `.ma-control-bar` 周辺に増やさない**（`toolbar-terms-verify.js` が件数を固定アサート）。
- **テーマA の文字床 12px を守る**（`computed font-size >= 12px`）。色は `--ix-*` トークンのみ（生 hex を新設しない）。
- **`repaint()` を期間切替から呼ばない**（多重再描画・再入ガード無し）。
- **ベンチ系列には必ず `autoscaleInfoProvider: () => null`**（付けないと異常値で主銘柄のローソクが潰れる）。
- **`STOCK_DATA` / `currentTicker` / `DATA_MARKET_ASOF` は top-level `let`＝`window` プロパティではない**。bare 参照で読む。
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。
- 各タスクの最後に必ず `node --test tests/*.test.js` が緑であることを確認してからコミットする。

### 用語（このプランで使う固定名）

| 名前 | 意味 |
|------|------|
| `PERIODS` | `["FY","1M","3M","6M","YTD","1Y","5Y","MAX"]`（この順で描画） |
| ローリング窓 | FY 以外の期間。`prices` の**最終バー日**を起点に遡った窓 |
| covered | ベンチの履歴が主銘柄の窓を完全に覆っているか |

---

## File Structure

| ファイル | 責務 | 変更 |
|----------|------|------|
| `detail-rules.js` | 純計算。窓の切り出し・文言・リベース | `rollingWindow` `rollingLabelParts` `benchRebase` `benchFor` を追加 |
| `detail-charts.js` | チャート instance の lifecycle | benchSeries を1本持ち、`setBenchData` / `clearBench` を公開 |
| `detail.js` | DOM とオーケストレーション | `selectedPeriod` / `benchOn` 状態、`applyPriceWindow()` 抽出、レール UI の生成と配線 |
| `index.html` | markup | MARKET CHART カード内にレール1行 |
| `detail.css` | スタイル | レールの CSS（案A・12px 床） |
| `tests/detail-rules.test.js` | 純関数のユニット | 新関数のテスト |
| `scratchpad/w2-smoke.js` | ブラウザ受入（新規） | 期間切替・52週・ベンチ・劣化経路 |
| `scratchpad/w2-mock-server.py` | 受入用モック鯖 | `W2_INJECT=0` スイッチを追加 |
| `scratchpad/titles-verify.js` | 既存受入 | ローリング時の副題を許容する2ケースへ |
| `scratchpad/theme-floor-check.js` | 既存受入 | W2 の新セレクタを床チェックに追加 |
| `scratchpad/wave-closure.sh` | 受入一括 | stale な `cd` 先と起動ゲートを修正 |

---

## Task 1: `rollingWindow` — ローリング窓の切り出し

**Files:**
- Modify: `detail-rules.js`（`priceWindow`（:485-491）の直後に追加、UMD export（:1077 付近）に追記）
- Test: `tests/detail-rules.test.js`（`priceWindow` のテスト群の直後に追加）

**Interfaces:**
- Consumes: なし
- Produces: `DetailRules.rollingWindow(prices, periodKey) → { periodKey, startDate, endDate, displayPrices, fallback }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/detail-rules.test.js` の `priceWindow` テスト群の直後に追加:

```js
// ── rollingWindow: ローリング窓（アンカーは wall-clock でなく prices の最終バー日）──
const RW = [
  { time: "2024-02-29", close: 1 }, { time: "2025-01-06", close: 2 },
  { time: "2025-08-20", close: 3 }, { time: "2026-01-05", close: 4 },
  { time: "2026-03-30", close: 5 }, { time: "2026-08-20", close: 6 },
];

test("rollingWindow: MAX は全件・startDate は先頭バー", () => {
  const r = D.rollingWindow(RW, "MAX");
  assert.equal(r.startDate, "2024-02-29");
  assert.equal(r.endDate, "2026-08-20");
  assert.equal(r.displayPrices.length, 6);
  assert.equal(r.fallback, false);
});

test("rollingWindow: 1Y は最終バー日から1年（境界は含む）", () => {
  const r = D.rollingWindow(RW, "1Y");
  assert.equal(r.startDate, "2025-08-20");
  assert.deepEqual(r.displayPrices.map((p) => p.time), ["2025-08-20", "2026-01-05", "2026-03-30", "2026-08-20"]);
});

test("rollingWindow: YTD は最終バーの年の 1/1 起点", () => {
  const r = D.rollingWindow(RW, "YTD");
  assert.equal(r.startDate, "2026-01-01");
  assert.deepEqual(r.displayPrices.map((p) => p.time), ["2026-01-05", "2026-03-30", "2026-08-20"]);
});

test("rollingWindow: 月末クランプ（3/31 の1ヶ月前は 2/28・うるう年は 2/29）", () => {
  const p2025 = [{ time: "2025-02-28", close: 1 }, { time: "2025-03-31", close: 2 }];
  assert.equal(D.rollingWindow(p2025, "1M").startDate, "2025-02-28");
  const p2024 = [{ time: "2024-02-29", close: 1 }, { time: "2024-03-31", close: 2 }];
  assert.equal(D.rollingWindow(p2024, "1M").startDate, "2024-02-29");
});

test("rollingWindow: 窓が2本未満なら全件へフォールバックし fallback=true", () => {
  const r = D.rollingWindow(RW, "1M");     // 2026-07-20 以降は 1 本しかない
  assert.equal(r.fallback, true);
  assert.equal(r.displayPrices.length, 6);
  assert.equal(r.startDate, "2026-07-20");  // 起点は「求めた窓」を保持する（表示側が事情を説明できる）
});

test("rollingWindow: 空配列と未知キー", () => {
  const e = D.rollingWindow([], "1Y");
  assert.deepEqual(e.displayPrices, []);
  assert.equal(e.startDate, null);
  assert.equal(e.endDate, null);
  const u = D.rollingWindow(RW, "7X");
  assert.equal(u.displayPrices.length, 6);   // 未知キーは全件（壊さない）
  assert.equal(u.startDate, null);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL（`D.rollingWindow is not a function`）

- [ ] **Step 3: 最小の実装を書く**

`detail-rules.js` の `priceWindow`（:485-491）の直後に追加:

```js
  // 月を引く（ISO 文字列 → ISO 文字列）。JS の Date は 3/31 の1ヶ月前を 3/3 に溢れさせるので、
  //  溢れたら対象月の末日へクランプする（2026-03-31 の 1M 前 = 2026-02-28 / うるう年は 02-29）。
  function _minusMonths(iso, months) {
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    let tm = m - months, ty = y;
    while (tm <= 0) { tm += 12; ty -= 1; }
    const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();   // 対象月の末日
    const td = Math.min(d, last);
    return `${String(ty).padStart(4, "0")}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
  }

  // ローリング窓（W2）。**アンカーは wall-clock ではなく prices の最終バー日**。
  //  理由: ①ETL が止まってデータが stale でも窓が実データより先を指さない ②テストが決定論になる。
  //  （detail-charts.js の normalizeForCompare は new Date() 基準だが、それは踏襲しない＝spec §4.1）
  //  窓が2本未満なら全件へフォールバックする（空チャートを出さない）。startDate は求めた値を保持し、
  //  表示側が「データ不足のため全期間」と説明できるようにする。
  const ROLL_MONTHS = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "5Y": 60 };
  function rollingWindow(prices, periodKey) {
    const src = Array.isArray(prices) ? prices : [];
    if (!src.length) return { periodKey, startDate: null, endDate: null, displayPrices: [], fallback: false };
    const endDate = src[src.length - 1].time;
    if (periodKey === "MAX") {
      return { periodKey, startDate: src[0].time, endDate, displayPrices: src.slice(), fallback: false };
    }
    let startDate;
    if (periodKey === "YTD") startDate = `${endDate.slice(0, 4)}-01-01`;
    else if (ROLL_MONTHS[periodKey]) startDate = _minusMonths(endDate, ROLL_MONTHS[periodKey]);
    else return { periodKey, startDate: null, endDate, displayPrices: src.slice(), fallback: false };
    const win = src.filter((p) => p.time >= startDate && p.time <= endDate);
    const fallback = win.length < 2;
    return { periodKey, startDate, endDate, displayPrices: fallback ? src.slice() : win, fallback };
  }
```

UMD export（:1077 付近の `priceWindow, fitLogicalRange, ...` の行）に `rollingWindow` を足す:

```js
    priceWindow, rollingWindow, fitLogicalRange, periodLabel, periodLabelParts, displayName, hasTickerSuffix, marketBasisFor, perStatus, pbrStatus,
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS（既存分も含め全緑）

- [ ] **Step 5: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(w2): ローリング窓の純関数 rollingWindow（最終バー日アンカー・月末クランプ）"
```

---

## Task 2: `rollingLabelParts` — ローリング窓の見出し文言

**Files:**
- Modify: `detail-rules.js`（`periodLabelParts`（:521-536）の直後）＋ UMD export
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Consumes: `rollingWindow` の戻り値（Task 1）
- Produces: `DetailRules.rollingLabelParts(companyName, ticker, win, isEtf) → { main, period }`

- [ ] **Step 1: 失敗するテストを書く**

```js
// ── rollingLabelParts: ローリング窓の見出し（FY 用 periodLabelParts とは別関数）──
test("rollingLabelParts: 1Y は「直近1年」と実期間を書く", () => {
  const win = { periodKey: "1Y", startDate: "2025-08-20", endDate: "2026-08-20", displayPrices: [1, 2], fallback: false };
  const r = D.rollingLabelParts("トヨタ自動車", "7203.T", win, false);
  assert.equal(r.main, "トヨタ自動車 (7203.T) - 歴史的ローソク足時系列");
  assert.equal(r.period, "[直近1年 2025年8月 〜 2026年8月]");
});

test("rollingLabelParts: YTD / MAX の呼び名", () => {
  const ytd = { periodKey: "YTD", startDate: "2026-01-01", endDate: "2026-08-20", fallback: false };
  assert.equal(D.rollingLabelParts("A", "A", ytd, false).period, "[年初来 2026年1月 〜 2026年8月]");
  const max = { periodKey: "MAX", startDate: "2009-01-05", endDate: "2026-08-20", fallback: false };
  assert.equal(D.rollingLabelParts("A", "A", max, false).period, "[全期間 2009年1月 〜 2026年8月]");
});

test("rollingLabelParts: fallback は理由を書く", () => {
  const win = { periodKey: "1M", startDate: "2026-07-20", endDate: "2026-08-20", fallback: true };
  assert.equal(D.rollingLabelParts("A", "A", win, false).period, "[1M のデータが不足のため全期間を表示]");
});

test("rollingLabelParts: 社名が (ticker) を含むなら二重にしない", () => {
  const win = { periodKey: "1Y", startDate: "2025-08-20", endDate: "2026-08-20", fallback: false };
  assert.equal(D.rollingLabelParts("S&P 500 ETF (SPY)", "SPY", win, true).main, "S&P 500 ETF (SPY) - 歴史的ローソク足時系列");
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL（`D.rollingLabelParts is not a function`）

- [ ] **Step 3: 実装を書く**

`detail-rules.js` の `periodLabelParts` の直後に追加:

```js
  // ローリング窓の見出し（W2）。FY は periodLabelParts のまま＝**この関数を通さない**（FY 文言は不変）。
  //  main は FY と同じ（社名＋時系列種別）。period だけが窓の実体を語る。
  const ROLL_NAME = { "1M": "直近1ヶ月", "3M": "直近3ヶ月", "6M": "直近6ヶ月", "YTD": "年初来", "1Y": "直近1年", "5Y": "直近5年", "MAX": "全期間" };
  function rollingLabelParts(companyName, ticker, win, isEtf) {
    const main = `${displayName(companyName, ticker)} - 歴史的ローソク足時系列`;
    if (!win || !win.startDate || !win.endDate) return { main, period: "" };
    if (win.fallback) return { main, period: `[${win.periodKey} のデータが不足のため全期間を表示]` };
    const ym = (iso) => `${+iso.slice(0, 4)}年${+iso.slice(5, 7)}月`;
    const name = ROLL_NAME[win.periodKey] || win.periodKey;
    return { main, period: `[${name} ${ym(win.startDate)} 〜 ${ym(win.endDate)}]` };
  }
```

> `isEtf` は引数に取るが本文では使わない（FY 側は「経営期間トレンド」を ETF で避ける必要があったが、
> ローリング窓の文言に経営期間の概念が無いため分岐が要らない）。呼び出し側の対称性のために残す。

UMD export に `rollingLabelParts` を追加（`periodLabelParts,` の直後）。

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(w2): ローリング窓の見出し純関数 rollingLabelParts"
```

---

## Task 3: `benchRebase` / `benchFor` — ベンチの正規化と選択

**Files:**
- Modify: `detail-rules.js`（`rollingLabelParts` の直後）＋ UMD export
- Modify: `tests/detail-rules.test.js`（冒頭の global 注入に `PortalPriceRules` を追加）

**Interfaces:**
- Consumes: `PortalPriceRules.marketOf(ticker, entry)`（`portal-price-rules.js:26-30`）
- Produces:
  - `DetailRules.benchRebase(benchPrices, mainWindow) → { points: [{time, value}], anchorTime, covered }`
  - `DetailRules.benchFor(ticker, entry) → { ticker, label } | null`

- [ ] **Step 1: テストの前提配線を足し、失敗するテストを書く**

`tests/detail-rules.test.js` の冒頭（`global.FinanceRules = FinanceRules;` の直後）に追加:

```js
// W2: benchFor が PortalPriceRules.marketOf に委譲するため、detail-rules.js より先に global へ注入する
//（FinanceRules と同じ classic-script global 参照の作法）。
global.PortalPriceRules = require("../portal-price-rules.js");
```

テスト本体:

```js
// ── benchRebase: ベンチを主銘柄の軸へリベース（アンカーは両者が揃う最初の日）──
const MAIN = [
  { time: "2026-01-05", close: 1000 }, { time: "2026-02-05", close: 1100 }, { time: "2026-03-05", close: 900 },
];
const BENCH = [
  { time: "2026-01-05", close: 200 }, { time: "2026-02-05", close: 210 }, { time: "2026-03-05", close: 190 },
];

test("benchRebase: 窓先頭で揃うとき covered=true・先頭が主銘柄の終値に一致", () => {
  const r = D.benchRebase(BENCH, MAIN);
  assert.equal(r.covered, true);
  assert.equal(r.anchorTime, "2026-01-05");
  assert.equal(r.points[0].value, 1000);
  assert.equal(r.points[1].value, 1050);        // 1000 * 210/200
});

test("benchRebase: ベンチの履歴が窓より短いとき、共通開始日へアンカーをずらし covered=false", () => {
  const shortBench = [{ time: "2026-02-05", close: 210 }, { time: "2026-03-05", close: 190 }];
  const r = D.benchRebase(shortBench, MAIN);
  assert.equal(r.covered, false);
  assert.equal(r.anchorTime, "2026-02-05");
  assert.equal(r.points[0].value, 1100);        // 窓先頭(1000)ではなく共通開始日の主銘柄終値に貼る
});

test("benchRebase: 営業日がズレてもアンカー以降の最初のバー同士で貼る", () => {
  const jpHoliday = [{ time: "2026-01-06", close: 200 }, { time: "2026-02-05", close: 220 }];
  const r = D.benchRebase(jpHoliday, MAIN);
  assert.equal(r.anchorTime, "2026-01-06");
  assert.equal(r.points[0].value, 1100);        // 主銘柄は 01-06 以降の最初＝02-05 の 1100
  assert.equal(r.covered, false);
});

test("benchRebase: 描けない入力は空を返す", () => {
  for (const bad of [[], [{ time: "2026-01-05", close: 200 }], null]) {
    const r = D.benchRebase(bad, MAIN);
    assert.deepEqual(r.points, []);
    assert.equal(r.covered, false);
  }
  assert.deepEqual(D.benchRebase(BENCH, [MAIN[0]]).points, []);          // 主銘柄が1本
  assert.deepEqual(D.benchRebase([{ time: "2026-01-05", close: 0 }, { time: "2026-02-05", close: 1 }], MAIN).points, []);
});

test("benchRebase: 外れ値は落とさない（データを黙って捨てない＝軸側で守る）", () => {
  const spiked = [
    { time: "2026-01-05", close: 200 }, { time: "2026-02-05", close: 20 }, { time: "2026-03-05", close: 190 },
  ];
  const r = D.benchRebase(spiked, MAIN);
  assert.equal(r.points.length, 3);
  assert.equal(r.points[1].value, 100);         // 1000 * 20/200 ＝ 異常値がそのまま出る
});

// ── benchFor: 市場からベンチ銘柄を選ぶ ──
test("benchFor: JP は TOPIX / US は S&P500", () => {
  assert.deepEqual(D.benchFor("7203.T", { country: "JP" }), { ticker: "1306.T", label: "vs TOPIX" });
  assert.deepEqual(D.benchFor("AAPL", { country: "US" }), { ticker: "SPY", label: "vs S&P500" });
});

test("benchFor: country 欠落は末尾 .T で判定（PortalPriceRules.marketOf に委譲）", () => {
  assert.equal(D.benchFor("6758.T", {}).ticker, "1306.T");
  assert.equal(D.benchFor("NVDA", {}).ticker, "SPY");
});

test("benchFor: ベンチ自身を開いているときは null", () => {
  assert.equal(D.benchFor("1306.T", { country: "JP" }), null);
  assert.equal(D.benchFor("SPY", { country: "US" }), null);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL（`D.benchRebase is not a function`）

- [ ] **Step 3: 実装を書く**

`detail-rules.js` の `rollingLabelParts` の直後に追加:

```js
  // ベンチマークを主銘柄の価格軸へリベースする（W2）。
  //  ⚠ アンカーは「両者が揃う最初の日」。窓先頭の主銘柄終値に貼ると、ベンチの履歴が窓より短いとき
  //     （MAX で 7203.T は 1999年〜／1306.T は 2009年〜）「2009年の TOPIX を1999年のトヨタ株価に
  //     一致させた線」を描いてしまう。ずらしたことは covered=false で呼び出し側へ渡し、UI が明示する。
  //  ⚠ 外れ値の除去はしない（無言でデータを捨てない＝spec D8）。異常値による軸の破壊は描画側の
  //     autoscaleInfoProvider で防ぐ（spec D4）。
  function benchRebase(benchPrices, mainWindow) {
    const empty = { points: [], anchorTime: null, covered: false };
    const bench = Array.isArray(benchPrices) ? benchPrices : [];
    const main = Array.isArray(mainWindow) ? mainWindow : [];
    if (bench.length < 2 || main.length < 2) return empty;
    const s = main[0].time, e = main[main.length - 1].time;
    const w = bench.filter((p) => p.time >= s && p.time <= e);
    if (w.length < 2) return empty;
    const anchorTime = w[0].time > s ? w[0].time : s;
    const mainAnchor = main.find((p) => p.time >= anchorTime);
    const benchAnchor = w.find((p) => p.time >= anchorTime);
    if (!mainAnchor || !benchAnchor) return empty;
    const base = benchAnchor.close, mainBase = mainAnchor.close;
    if (!(base > 0) || !(mainBase > 0)) return empty;
    return {
      points: w.map((p) => ({ time: p.time, value: Math.round(mainBase * (p.close / base) * 10000) / 10000 })),
      anchorTime,
      covered: anchorTime === s,
    };
  }

  // 銘柄に対応するベンチマーク（W2）。市場判定は PortalPriceRules.marketOf に委譲して規則を二重に書かない。
  const BENCH_BY_MARKET = { JP: { ticker: "1306.T", label: "vs TOPIX" }, US: { ticker: "SPY", label: "vs S&P500" } };
  function benchFor(ticker, entry) {
    const market = (typeof PortalPriceRules !== "undefined" && PortalPriceRules.marketOf)
      ? PortalPriceRules.marketOf(ticker, entry)
      : (String(ticker).endsWith(".T") ? "JP" : "US");
    const b = BENCH_BY_MARKET[market];
    if (!b || b.ticker === ticker) return null;      // 未知市場・ベンチ自身は出さない
    return b;
  }
```

UMD export に `benchRebase, benchFor` を追加。

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS

- [ ] **Step 5: 全スイートを回す**

Run: `node --test tests/*.test.js`
Expected: PASS（既存 381 ＋ 新規分）

- [ ] **Step 6: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(w2): ベンチの純関数 benchRebase（共通アンカー）/ benchFor"
```

---

## Task 4: ベンチ系列（`detail-charts.js`）

**Files:**
- Modify: `detail-charts.js`（`initPriceChart`（:688-）の `volumeSeries` 生成の直後／薄いラッパ群（:1456 付近）／`window.DetailCharts`（:1634））
- Modify: `scratchpad/w2-mock-server.py`（比較ハーネスの注入 OFF スイッチ＝これ以降の全ブラウザ検証で使う）

**Interfaces:**
- Consumes: なし
- Produces: `DetailCharts.setBenchData(points)` / `DetailCharts.clearBench()`

- [ ] **Step 0: モック鯖に注入 OFF スイッチを足す（これ以降の検証の前提）**

`scratchpad/w2-mock-server.py` は index.html に比較ハーネス `w2-variants.js` を**必ず**注入する。実装した
期間バーとモックの期間バーが二重に mount され、`localStorage` キー（`sip_detail_period`）も奪い合うので、
**本実装の検証は必ず注入 OFF で行う**。環境変数とクエリの両方で切れるようにする:

```python
INJECT_DEFAULT = os.environ.get("W2_INJECT", "1") != "0"
```

`</body>` 直前へ `<script src="/scratchpad/w2-variants.js"></script>` を差し込む処理を、

```python
        q = urlparse(self.path).query
        inject = INJECT_DEFAULT and "w2mock=off" not in q
        if inject:
            body = body.replace(b"</body>", b'<script src="/scratchpad/w2-variants.js"></script></body>', 1)
```

の形に変える（`body` の変数名は既存実装に合わせる）。docstring に「**本実装の受入・検証は
`W2_INJECT=0` か `?w2mock=off` で起動する**（案A のモックと実装が二重に mount されるため）」と追記する。

確認:

```bash
python3 scratchpad/w2-mock-server.py &
curl -s "http://127.0.0.1:8220/" | grep -c "w2-variants.js"            # → 1
curl -s "http://127.0.0.1:8220/?w2mock=off" | grep -c "w2-variants.js" # → 0
```

- [ ] **Step 1: benchSeries の宣言と生成を書く**

`detail-charts.js` の instance 宣言（`let currentDisplayPrices = null;` があるあたり、:52 付近）に追加:

```js
  let benchSeries = null;          // W2: ベンチマーク重ね描き（銘柄・期間をまたいで1本を使い回す）
```

`initPriceChart()` 内、`volumeSeries = priceChart.addHistogramSeries({...});` の直後に追加:

```js
        // W2: ベンチマーク（TOPIX/S&P500）の重ね描き。右軸を共有するが **軸の範囲決定には参加させない**。
        //  ⚠ autoscaleInfoProvider を外すと、ベンチ側の1本の異常値（例: 1306.T の分割未調整バー）で
        //     軸が引き伸ばされ主銘柄のローソクが縦に潰れる（実測: 軸 -1325〜4209／ローソクは縦23%）。
        //     null を返すとこの系列は autoscale に寄与しない（LWC v4.2.3 で実機確認済み）。
        benchSeries = priceChart.addLineSeries({
          color: "#8aa0ff",              // --ix-indigo-bright 相当（canvas は CSS 変数を読めないので値で管理）
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,       // 右軸バッジを増やさない
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        });
```

- [ ] **Step 2: 薄いラッパを足す**

`setCandleData`（:1456 付近）の直後に追加:

```js
  // W2: ベンチ系列の出し入れ（instance は closure 私有のまま・detail.js からは値だけ渡す）。
  function setBenchData(points) {
    if (benchSeries) benchSeries.setData(points || []);
  }
  function clearBench() {
    if (benchSeries) benchSeries.setData([]);
  }
```

`window.DetailCharts` の export に追加:

```js
    repaint, onWindowResize, renderCompareChart, resizePrice, getPriceVisibleRange, setBenchData, clearBench,
```

- [ ] **Step 3: 構文チェックと既存スイート**

Run: `node --check detail-charts.js && node --test tests/*.test.js`
Expected: 両方 PASS

- [ ] **Step 4: ブラウザで「何も壊れていない」ことを確認**

```bash
python3 scratchpad/w2-mock-server.py &   # :8220（別ターミナル可）
NODE_PATH=/home/shugo/node_modules node -e "
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://127.0.0.1:8220/?w2mock=off',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>typeof STOCK_DATA!=='undefined'&&Object.keys(STOCK_DATA).length>0,{timeout:30000});
await p.evaluate(()=>window.navigateToDetail('7203.T'));
await p.waitForSelector('#chart-container canvas');
await p.waitForTimeout(1500);
console.log('setBenchData:',await p.evaluate(()=>typeof window.DetailCharts.setBenchData));
console.log('errors:',errs);
await b.close();})();"
```

Expected: `setBenchData: function` / `errors: []`

- [ ] **Step 5: コミット**

```bash
git add detail-charts.js scratchpad/w2-mock-server.py
git commit -m "feat(w2): ベンチ系列を price chart に1本追加（autoscale 不参加）＋モック鯖の注入OFFスイッチ"
```

---

## Task 5: `applyPriceWindow()` の抽出（挙動不変リファクタ）

**Files:**
- Modify: `detail.js`（`updateFinancialViews`（:668-850）の価格系ブロック）

**Interfaces:**
- Consumes: `DetailRules.priceWindow` / `DetailRules.rollingWindow`（Task 1）
- Produces: closure private `applyPriceWindow()`

> このタスクは**まだ期間バーを足さない**。現行の FY 経路の挙動を1ピクセルも変えずに、価格系の描画を
> 1関数へ寄せるだけ。ここで `detail-snapshot` を突合し「抽出で何も変わっていない」ことを確定させる。

- [ ] **Step 1: 抽出前のスナップショットを取る**

```bash
ln -sfn ../../../data/investment.db data/investment.db     # worktree には gitignore された DB が無い
python3 scratchpad/mock_prod_server.py &                   # :8200
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
```

Expected: `captured` と表示され `scratchpad/detail-baseline.json` が更新される

- [ ] **Step 2: `applyPriceWindow()` を作る**

`detail.js` の `updateFinancialViews` の**手前**に新設:

```js
  // W2: 価格系の描画をまとめた単一の入口。updateFinancialViews（財務も含む全体再描画）と
  //  期間バー（価格だけの再描画）の両方がここを通る。
  //  ⚠ 空窓でも描画を止めない。現行は価格が空でも #stock-title 書換・setCandleData([])・
  //     renderSignalDigest([], …) まで無条件に走る。ここに early-return を足すと、価格ゼロの銘柄へ
  //     遷移したときに**前銘柄のタイトル・ローソク・解析カードが残る**（api/market/list.py:165 が
  //     全銘柄に prices: [] を入れ、navigateToDetail は getStock の失敗を握って続行する＝到達する）。
  function applyPriceWindow() {
    const data = STOCK_DATA[currentTicker];
    if (!data) return;
    const isUS = data.country === "US";
    const prices = data.prices || [];
    const win = selectedPeriod === "FY"
      ? DetailRules.priceWindow(prices, selectedYear, isUS)
      : DetailRules.rollingWindow(prices, selectedPeriod);
    const dp = win.displayPrices;

    // 見出し（FY は既存関数のまま＝文言不変。ローリングは新関数）
    const titleParts = selectedPeriod === "FY"
      ? DetailRules.periodLabelParts(
          data.company_name, currentTicker, selectedYear, isUS, win.filteredPrices.length > 0, data.type === "etf")
      : DetailRules.rollingLabelParts(data.company_name, currentTicker, win, data.type === "etf");
    document.getElementById("stock-title").innerHTML =
      `${esc(titleParts.main)}${titleParts.period ? `<span class="stock-title-sub">${esc(titleParts.period)}</span>` : ""}`;

    DetailCharts.setCandleData(dp);
    DetailCharts.updateMaAndVolume(dp, prices);
    renderSignalDigest(dp, prices);
    renderDisciplineCard(dp, prices);
  }
```

- [ ] **Step 3: `updateFinancialViews` から価格系を取り除く**

`detail.js:691-701` の以下のブロックを削除し、

```js
    // 米国株は暦年、日本株は4月〜翌3月の決算期でフィルタ（priceWindow で単一ソース化）
    const isUS = data.country === "US";
    const { filteredPrices, displayPrices } = DetailRules.priceWindow(data.prices, selectedYear, isUS);
    const titleParts = DetailRules.periodLabelParts(...);
    document.getElementById("stock-title").innerHTML = ...;
    DetailCharts.setCandleData(displayPrices);
    DetailCharts.updateMaAndVolume(displayPrices, data.prices);
```

代わりに:

```js
    const isUS = data.country === "US";     // 後段（marketBasisFor 等）が使うので残す
    applyPriceWindow();
```

`detail.js:719` の `renderSignalDigest(displayPrices, data.prices);` と `:728` の
`renderDisciplineCard(displayPrices, data.prices);` を削除する（`applyPriceWindow` へ移動済み）。
**直前のコメントブロック（「isEtf/!fin early-return より前で無条件に描画」の理由説明）も一緒に
`applyPriceWindow` の該当行の上へ移す**（理由がコードから離れると次の改修者が配置規律を壊す）。
`initSubpanelUI()`（:727）は価格系ではない（チップ/アコーディオンの DOM を1度だけ組む）ので
`updateFinancialViews` に残す。

> **`DetailCharts.repaint()`（:710）・`injectTermHelp`（:713）・`initSubpanelUI()`（:727）・
> `renderRelativePosition()`（:734）は現在の位置のまま**。`repaint` は entrance アニメ対策で
> navigate 経路にだけ必要（期間切替からは呼ばない）。

- [ ] **Step 4: 一時的に `selectedPeriod` を定義する**

`detail.js` の state 宣言（`let selectedYear = 2025;` の付近・:22）に追加:

```js
  let selectedPeriod = "FY";      // W2: Task 6 で LS 復元と UI を足す
```

- [ ] **Step 5: スナップショットで挙動不変を確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```

Expected: `✅ MATCH`（**DIFF が出たら抽出が挙動を変えている**。直してから進む）

- [ ] **Step 6: 既存受入を回す**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/titles-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/fit-range-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/sr-window-verify.js
```

Expected: すべて PASS（この時点では UI を足していないので全部緑のはず）

- [ ] **Step 7: コミット**

```bash
git add detail.js
git commit -m "refactor(w2): 価格系の描画を applyPriceWindow() へ抽出（挙動不変・snapshot MATCH）"
```

---

## Task 6: 期間切替バー（markup・CSS・状態・配線）

**Files:**
- Modify: `index.html`（:1354 `<div class="card-title" id="stock-title">` と :1355 `<div class="ma-control-bar">` の間）
- Modify: `detail.css`（`.ma-control-bar`（:476）の直前にレールの CSS を追加）
- Modify: `detail.js`（state・LS・ボタン生成・`setPeriod`・`switchYear`）

**Interfaces:**
- Consumes: `applyPriceWindow()`（Task 5）
- Produces: closure private `setPeriod(key)` / `paintPeriodButtons()` / `readPeriod()` / `writePeriod(v)`

- [ ] **Step 1: markup を入れる**

`index.html` の `<div class="card-title" id="stock-title">MARKET CHART</div>` の直後に追加:

```html
            <div class="w2-rail" role="group" aria-label="表示期間と52週レンジ">
              <span class="w2-rail-label">期間</span>
              <div class="w2-seg" id="w2-period-box" title="FY＝決算年度（財務3表と同期）／1M〜MAX＝価格・指標のみのローリング窓"></div>
              <div class="w2-52w" id="w2-52w" title="直近52週レンジ内の現在地（期間切替とは独立）">
                <span class="w2-52w-tag">52W</span>
                <span class="w2-52w-num" data-w2="lo">—</span>
                <span class="w2-52w-track"><span class="w2-52w-marker" data-w2="marker"></span></span>
                <span class="w2-52w-num" data-w2="hi">—</span>
                <span class="w2-52w-pos" data-w2="pos">—</span>
                <span class="w2-52w-dist" data-w2="dist">—</span>
                <span class="w2-52w-note" data-w2="note"></span>
              </div>
              <button class="w2-bench" id="w2-bench-btn" type="button"><span data-w2="benchLabel">vs TOPIX</span></button>
            </div>
```

> ボタン列（`#w2-period-box` の中身）は **JS で生成する**（`#year-controller-box` と同じ流儀・inline onclick を作らない）。

- [ ] **Step 2: CSS を移植する**

案A の CSS は `scratchpad/w2-variants.js` の先頭 `window.__W2_VARIANT_DEFS__.a.css` にある。これを `detail.css` の
`.ma-control-bar`（:476）の直前へ移植する。**移植時の必須変更**:

1. すべてのセレクタから `body[data-w2v="a"] ` の接頭辞を外す。
2. クラス名を markup に合わせて改名: `.w2a-rail`→`.w2-rail` / `.w2a-label`→`.w2-rail-label` /
   `.w2a-seg`→`.w2-seg` / `.w2a-sep`→`.w2-seg-sep` / `.w2a-tag`→`.w2-52w-tag` / `.w2a-num`→`.w2-52w-num` /
   `.w2a-track`→`.w2-52w-track` / `.w2a-marker`→`.w2-52w-marker` / `.w2a-pos`→`.w2-52w-pos` /
   `.w2a-dist`→`.w2-52w-dist` / `.w2a-note`→`.w2-52w-note`。
3. **文字サイズを 12px 床に上げる**（テーマA の不変条件。案A の原案は 9〜11px で床を破っている）:
   `.w2-52w-tag` `.w2-52w-num` `.w2-52w-dist` `.w2-52w-note` を `font-size: 12px` に、
   `.w2-52w-pos` を `font-size: 13px` に、`@media (max-width:480px)` 内の `font-size:9px` の2行を削除する。
4. `.w2-p` / `.w2-bench` の `font-size` は `.72rem`（≒11.5px）なので **`12px` に置換**する。
5. `.w2-seg-sep` は `<span class="w2-seg-sep">` を JS が生成しないため、CSS 側は
   `.w2-p[data-p="FY"] { margin-right: 10px; }` に置き換える（区切りは余白で表現）。

- [ ] **Step 3: state・LS・ボタン生成・setPeriod を書く**

`detail.js` の state（Task 5 で足した `let selectedPeriod = "FY";` を置換）:

```js
  // W2: 期間切替（FY＝決算年度と同期／1M〜MAX＝価格だけのローリング窓）。銘柄をまたいで保持する。
  const PERIODS = ["FY", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"];
  const LS_PERIOD = "sip_detail_period";
  function readPeriod() {
    let v = null;
    try { v = localStorage.getItem(LS_PERIOD); } catch (e) { /* Safari プライベート等 */ }
    return PERIODS.indexOf(v) >= 0 ? v : "FY";      // 未知値・壊れた値は必ず FY へ正規化
  }
  function writePeriod(v) { try { localStorage.setItem(LS_PERIOD, v); } catch (e) { /* noop */ } }
  let selectedPeriod = readPeriod();
```

ボタン生成と塗り（`switchYear` の手前に新設）:

```js
  // 期間バーのボタン列を1度だけ組む（銘柄をまたいで再利用＝冪等）。
  function initPeriodBar() {
    const box = document.getElementById("w2-period-box");
    if (!box || box.childElementCount) return;
    PERIODS.forEach((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "w2-p";
      btn.dataset.p = key;
      btn.innerText = key;
      btn.onclick = () => setPeriod(key);          // closure 参照（window 公開面を増やさない）
      box.appendChild(btn);
    });
  }

  function paintPeriodButtons() {
    document.querySelectorAll("#w2-period-box .w2-p").forEach((b) => {
      b.classList.toggle("active", b.dataset.p === selectedPeriod);
    });
  }

  // 期間ボタン：価格系だけを描き直す（財務3表・KPI・AI コメントには触らない）。
  //  ⚠ repaint() は呼ばない（entrance アニメ対策で navigate 経路にだけ要る・連打で多重再描画になる）。
  function setPeriod(key) {
    if (PERIODS.indexOf(key) < 0) return;
    selectedPeriod = key;
    writePeriod(key);
    paintPeriodButtons();
    applyPriceWindow();
  }
```

- [ ] **Step 4: FY ボタンで期間バーを FY へ戻す（last-click-wins）**

`switchYear`（:660-666）を書き換え:

```js
  function switchYear(year, event) {
    selectedYear = year;
    document.querySelectorAll(".time-btn").forEach((b) => b.classList.remove("active"));
    event.target.classList.add("active");
    document.getElementById("selected-year-display").innerText = year + " FY";
    // W2: FY を押した＝「決算年度の窓で見る」宣言。期間バーも FY へ戻す（2つの入力の優先順位を
    //  「最後に押した方」に一本化する。片方が無言で相手を上書きする状態を作らない）。
    selectedPeriod = "FY";
    writePeriod("FY");
    paintPeriodButtons();
    updateFinancialViews();
  }
```

- [ ] **Step 5: navigate 経路で初期化と塗りを呼ぶ**

`updateFinancialViews` の中、`applyPriceWindow()` の**手前**に追加:

```js
    initPeriodBar();          // 冪等（1度だけ組む）
    paintPeriodButtons();     // LS 復元した期間を UI に反映する
```

- [ ] **Step 6: ブラウザで動作を確認**

```bash
python3 scratchpad/w2-mock-server.py &   # :8220
NODE_PATH=/home/shugo/node_modules node -e "
const {chromium}=require('playwright');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch();const p=await b.newPage();
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://127.0.0.1:8220/?w2mock=off',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>typeof STOCK_DATA!=='undefined'&&Object.keys(STOCK_DATA).length>0,{timeout:30000});
await p.evaluate(()=>window.navigateToDetail('7203.T'));
await p.waitForSelector('#chart-container canvas');await sleep(1500);
const bars={};
for (const k of ['FY','1M','1Y','5Y','MAX']){
  await p.evaluate(x=>document.querySelector('#w2-period-box .w2-p[data-p=\"'+x+'\"]').click(),k);
  await sleep(800);
  bars[k]=await p.evaluate(()=>{const r=window.DetailCharts.getPriceVisibleRange();return Math.round(r.to-r.from);});
}
console.log('可視バー数:',JSON.stringify(bars));
console.log('副題:',await p.evaluate(()=>document.querySelector('.stock-title-sub').textContent));
console.log('errors:',errs);
await b.close();})();"
```

Expected: `1M < 1Y < 5Y < MAX` の順に増える／MAX の副題が `[全期間 ...]`／`errors: []`

- [ ] **Step 7: 文字床とレイアウトを確認**

```bash
NODE_PATH=/home/shugo/node_modules node -e "
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();
for (const w of [1440,1024,390]) {
  const p=await b.newPage({viewport:{width:w,height:900}});
  await p.goto('http://127.0.0.1:8220/?w2mock=off',{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof STOCK_DATA!=='undefined'&&Object.keys(STOCK_DATA).length>0,{timeout:30000});
  await p.evaluate(()=>window.navigateToDetail('7203.T'));
  await p.waitForSelector('#chart-container canvas');await p.waitForTimeout(1200);
  const r=await p.evaluate(()=>{
    const sizes=[...document.querySelectorAll('.w2-rail *')].map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Boolean);
    return {min:Math.min(...sizes), overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
            railH:Math.round(document.querySelector('.w2-rail').getBoundingClientRect().height)};
  });
  console.log(w+'px', JSON.stringify(r));
  await p.close();
}
await b.close();})();"
```

Expected: 各幅で `min >= 12`（テーマA 床）・`overflow <= 1`（横はみ出しなし）・`railH` は PC で 40px 前後

- [ ] **Step 8: 既存受入とスイート**

```bash
node --test tests/*.test.js
NODE_PATH=/home/shugo/node_modules node scratchpad/toolbar-terms-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/fit-range-verify.js
```

Expected: すべて PASS（`toolbar-terms-verify` は `.ctrl-pair > .term-help` を4件で数えるので、レールがこの構造を
使っていなければ緑のまま）

- [ ] **Step 9: コミット**

```bash
git add index.html detail.css detail.js
git commit -m "feat(w2): 期間切替バー（FY|1M..MAX・LS永続・FY復帰）"
```

---

## Task 7: 52週レンジバーの描画

**Files:**
- Modify: `detail.js`（`applyPriceWindow` の直後に `paint52wBar` を追加し、`applyPriceWindow` から呼ぶ）

**Interfaces:**
- Consumes: `PortalPriceRules.fmtDistHigh(dh)` / `clampPos(pos)` / `isStale(px, asof, market)` / `marketOf(ticker, entry)`
- Produces: closure private `paint52wBar(data)`

- [ ] **Step 1: 実装を書く**

`detail.js` の `applyPriceWindow` の直後に追加:

```js
  // W2: 52週レンジバー。**数値は list API のサーバ計算値（px）をそのまま使い、JS で再計算しない**
  //  （portal-price-rules.js 冒頭の D9 原則＝JS↔Py の鏡像パリティ義務を新設しない。ポータル一覧・
  //   ヒートマップと同じ数字が出ることも同時に保証される）。**期間切替とは独立＝常に直近52週**。
  function paint52wBar(data) {
    const root = document.getElementById("w2-52w");
    if (!root) return;
    const px = data && data.px;
    const ok = px && px.pos52 != null && px.hi52 != null && px.lo52 != null;
    root.style.display = ok ? "" : "none";          // 新規上場等（_PX_MIN_52W_ROWS 未満）はバーごと非表示
    if (!ok) return;
    const cur = data.currency === "USD" ? "$" : "¥";
    const set = (k, v) => { const el = root.querySelector(`[data-w2="${k}"]`); if (el) el.textContent = v; };
    const fmt = (v) => (v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2));
    set("lo", cur + fmt(px.lo52));
    set("hi", cur + fmt(px.hi52));
    set("pos", Math.round(px.pos52) + "%");
    set("dist", PortalPriceRules.fmtDistHigh(px.dh));      // dh は負が「高値より下」＝符号規約を自前で書かない
    const marker = root.querySelector('[data-w2="marker"]');
    if (marker) marker.style.left = PortalPriceRules.clampPos(px.pos52) + "%";
    const market = PortalPriceRules.marketOf(currentTicker, data);
    const stale = PortalPriceRules.isStale(px, DATA_MARKET_ASOF, market);
    set("note", stale ? `終値 ${px.date}（更新待ち）` : "");
  }
```

`applyPriceWindow` の末尾（`renderDisciplineCard(...)` の直後）に追加:

```js
    paint52wBar(data);
```

- [ ] **Step 2: ブラウザで実データ表示を確認**

```bash
NODE_PATH=/home/shugo/node_modules node -e "
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://127.0.0.1:8220/?w2mock=off',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>typeof STOCK_DATA!=='undefined'&&Object.keys(STOCK_DATA).length>0,{timeout:30000});
for (const t of ['7203.T','SPY']) {
  await p.evaluate(x=>window.navigateToDetail(x),t);
  await p.waitForSelector('#chart-container canvas');await p.waitForTimeout(1200);
  console.log(t, await p.evaluate(()=>({
    lo:document.querySelector('[data-w2=lo]').textContent,
    hi:document.querySelector('[data-w2=hi]').textContent,
    pos:document.querySelector('[data-w2=pos]').textContent,
    dist:document.querySelector('[data-w2=dist]').textContent,
    left:document.querySelector('[data-w2=marker]').style.left,
  })));
}
console.log('errors:',errs);
await b.close();})();"
```

Expected: 7203.T が `¥2,601 / ¥3,886 / 36% / 高値まで 21.1%`、SPY が `$` 建てで出る／`errors: []`

- [ ] **Step 3: px 欠損時に非表示になることを確認**

```bash
NODE_PATH=/home/shugo/node_modules node -e "
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
await p.goto('http://127.0.0.1:8220/?w2mock=off',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>typeof STOCK_DATA!=='undefined'&&Object.keys(STOCK_DATA).length>0,{timeout:30000});
await p.evaluate(()=>{ STOCK_DATA['7203.T'].px = { last: 1, date: '2026-08-20' }; });  // pos52 欠損を細工
await p.evaluate(()=>window.navigateToDetail('7203.T'));
await p.waitForSelector('#chart-container canvas');await p.waitForTimeout(1200);
console.log('display:',await p.evaluate(()=>getComputedStyle(document.getElementById('w2-52w')).display));
await b.close();})();"
```

Expected: `display: none`

- [ ] **Step 4: コミット**

```bash
git add detail.js
git commit -m "feat(w2): 52週レンジバー（px のサーバ計算値をそのまま表示・欠損は非表示）"
```

---

## Task 8: ベンチマークの配線

**Files:**
- Modify: `detail.js`（`paint52wBar` の直後に `applyBench` / `paintBenchChip` / `toggleBench` を追加、`applyPriceWindow` から呼ぶ、`initPeriodBar` でチップに配線）

**Interfaces:**
- Consumes: `DetailRules.benchFor` / `DetailRules.benchRebase`（Task 3）、`DetailCharts.setBenchData` / `clearBench`（Task 4）、`getStock(ticker)`
- Produces: closure private `applyBench(displayPrices, data)` / `toggleBench()`

- [ ] **Step 1: 実装を書く**

`detail.js` の `paint52wBar` の直後に追加:

```js
  // W2: ベンチマーク（TOPIX/S&P500）の重ね描き。
  const LS_BENCH = "sip_detail_bench";
  function readBench() { try { return localStorage.getItem(LS_BENCH) === "1"; } catch (e) { return false; } }
  function writeBench(v) { try { localStorage.setItem(LS_BENCH, v ? "1" : "0"); } catch (e) { /* noop */ } }
  let benchOn = readBench();
  let benchGen = 0;

  function paintBenchChip(b, anchorTime) {
    const chip = document.getElementById("w2-bench-btn");
    if (!chip) return;
    chip.style.display = b ? "" : "none";           // ベンチ自身を開いているときはチップごと消す
    chip.classList.toggle("active", !!b && benchOn);
    const label = chip.querySelector('[data-w2="benchLabel"]');
    if (label && b) label.textContent = anchorTime ? `${b.label}（${anchorTime.slice(0, 4)}年〜）` : b.label;
  }

  // ⚠ 世代トークンは全経路の先頭で進める。「ON のときだけ進める」書き方だと
  //   ①ON で fetch 開始(gen=1) ②すぐ OFF（gen は 1 のまま） ③着弾で gen 一致 → **消した線が復活する**。
  //   着弾側では benchOn と currentTicker も見て三重に塞ぐ（別銘柄への描画は束D層2 で実際に踏んだ穴）。
  function applyBench(displayPrices, data) {
    const gen = ++benchGen;
    const ticker = currentTicker;
    const b = DetailRules.benchFor(currentTicker, data);
    paintBenchChip(b);
    if (!b || !benchOn || !displayPrices.length) { DetailCharts.clearBench(); return; }
    Promise.resolve(typeof getStock === "function" ? getStock(b.ticker) : null).then((bd) => {
      if (gen !== benchGen || currentTicker !== ticker || !benchOn) return;
      const r = DetailRules.benchRebase((bd && bd.prices) || [], displayPrices);
      DetailCharts.setBenchData(r.points);
      paintBenchChip(b, r.covered ? null : r.anchorTime);   // 履歴が足りない分をラベルで明示（黙ってずらさない）
    }).catch((e) => {
      if (gen !== benchGen) return;
      console.error("bench fetch failed", e);
      DetailCharts.clearBench();
      benchOn = false; writeBench(false); paintBenchChip(b);   // 押下状態を残さない
    });
  }

  function toggleBench() {
    benchOn = !benchOn;
    writeBench(benchOn);
    applyPriceWindow();       // 窓は変えずにベンチだけ張り直す（同じ入口を通す＝経路を増やさない）
  }
```

- [ ] **Step 2: `applyPriceWindow` から呼ぶ**

`applyPriceWindow` の末尾（`paint52wBar(data);` の直後）に追加:

```js
    applyBench(dp, data);
```

- [ ] **Step 3: チップに配線する**

`initPeriodBar()` の末尾に追加:

```js
    const chip = document.getElementById("w2-bench-btn");
    if (chip && !chip.dataset.wired) {
      chip.dataset.wired = "1";
      chip.onclick = () => toggleBench();
    }
```

- [ ] **Step 4: ブラウザで確認（線が出る・軸が潰れない・OFF で復活しない）**

```bash
NODE_PATH=/home/shugo/node_modules node -e "
const {chromium}=require('playwright');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch();const p=await b.newPage();
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://127.0.0.1:8220/?w2mock=off',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>typeof STOCK_DATA!=='undefined'&&Object.keys(STOCK_DATA).length>0,{timeout:30000});
await p.evaluate(()=>{try{localStorage.setItem('sip_detail_bench','0')}catch(e){}});
await p.evaluate(()=>window.navigateToDetail('7203.T'));
await p.waitForSelector('#chart-container canvas');await sleep(1500);
await p.evaluate(()=>document.querySelector('#w2-period-box .w2-p[data-p=\"1Y\"]').click());await sleep(800);
// ON → 線が出る
await p.evaluate(()=>document.getElementById('w2-bench-btn').click());await sleep(3000);
console.log('ON  chip=',await p.evaluate(()=>document.querySelector('[data-w2=benchLabel]').textContent));
// ON→即OFF で復活しないこと
await p.evaluate(()=>{document.getElementById('w2-bench-btn').click();document.getElementById('w2-bench-btn').click();});
await sleep(200);
await p.evaluate(()=>document.getElementById('w2-bench-btn').click());   // 最終状態 OFF
await sleep(3000);
console.log('OFF active=',await p.evaluate(()=>document.getElementById('w2-bench-btn').classList.contains('active')));
// MAX で covered=false のラベル
await p.evaluate(()=>document.getElementById('w2-bench-btn').click());await sleep(2000);
await p.evaluate(()=>document.querySelector('#w2-period-box .w2-p[data-p=\"MAX\"]').click());await sleep(3000);
console.log('MAX chip=',await p.evaluate(()=>document.querySelector('[data-w2=benchLabel]').textContent));
console.log('errors:',errs);
await b.close();})();"
```

Expected: `ON chip= vs TOPIX` ／ `OFF active= false` ／ `MAX chip= vs TOPIX（2009年〜）` ／ `errors: []`

- [ ] **Step 5: 軸が潰れないことを数値で確認**

```bash
NODE_PATH=/home/shugo/node_modules node -e "
const {chromium}=require('playwright');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch();const p=await b.newPage();
await p.goto('http://127.0.0.1:8220/?w2mock=off',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>typeof STOCK_DATA!=='undefined'&&Object.keys(STOCK_DATA).length>0,{timeout:30000});
await p.evaluate(()=>{try{localStorage.setItem('sip_detail_bench','1')}catch(e){}});
await p.evaluate(()=>window.navigateToDetail('7203.T'));
await p.waitForSelector('#chart-container canvas');await sleep(3000);
await p.evaluate(()=>document.querySelector('#w2-period-box .w2-p[data-p=\"1Y\"]').click());await sleep(3000);
// 主銘柄の窓内最安値と、チャートの縦位置から軸の下端を推定する
const r = await p.evaluate(()=>{
  const w = DetailRules.rollingWindow(STOCK_DATA[currentTicker].prices,'1Y').displayPrices;
  const lo = Math.min(...w.map(p=>p.low));
  return { lo };
});
console.log('窓内最安値', r.lo, '（軸下端がこの 0.5 倍を下回らないこと＝目視でローソクが潰れていないこと）');
await p.screenshot({path:'scratchpad/w2-shots/bench-axis.png'});
await b.close();})();"
```

Expected: `scratchpad/w2-shots/bench-axis.png` でローソクがペインを満たしている（潰れていない）

- [ ] **Step 6: コミット**

```bash
git add detail.js
git commit -m "feat(w2): ベンチマーク重ね描きの配線（世代ガード三重・履歴不足はラベルで明示）"
```

---

## Task 9: ブラウザ受入 `w2-smoke.js`

**Files:**
- Create: `scratchpad/w2-smoke.js`

**Interfaces:**
- Consumes: 実装済みの UI 一式。注入 OFF スイッチ（`W2_INJECT=0` / `?w2mock=off`）は **Task 4 Step 0 で実装済み**
- Produces: `node scratchpad/w2-smoke.js` が ALL PASS / FAIL を返す受入

- [ ] **Step 1: 受入スクリプトを書く**

`scratchpad/w2-smoke.js` を新規作成:

```js
/* W2「詳細の時間軸パック」受入。
 *
 *   1) W2_INJECT=0 python3 scratchpad/w2-mock-server.py     # :8220（比較ハーネスを注入しない）
 *   2) NODE_PATH=/home/shugo/node_modules node scratchpad/w2-smoke.js
 *
 * ⚠ 合成データのモック鯖（mock_prod_server.py・600本）ではなく **本番 API のプロキシ**を使う。
 *   合成 600 本では 5Y と MAX が同じ窓になり「切り替わっていないのに緑」になるため。
 */
const { chromium } = require("playwright");

const BASE = process.env.W2_BASE || "http://127.0.0.1:8220";
const fail = [];
function check(cond, label) {
  console.log((cond ? "  ✅ " : "  ❌ ") + label);
  if (!cond) fail.push(label);
}

async function open(page, ticker, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForFunction(() => typeof STOCK_DATA !== "undefined" && Object.keys(STOCK_DATA).length > 0, { timeout: 30000 });
  await page.evaluate((t) => window.navigateToDetail(t), ticker);
  await page.waitForSelector("#chart-container canvas", { timeout: 30000 });
  await page.waitForTimeout(1200);
}
const clickPeriod = (page, k) =>
  page.evaluate((x) => document.querySelector(`#w2-period-box .w2-p[data-p="${x}"]`).click(), k);
const range = (page) =>
  page.evaluate(() => { const r = window.DetailCharts.getPriceVisibleRange(); return r ? Math.round(r.to - r.from) : null; });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/_vercel\/insights|Failed to load resource/.test(m.text())) return;   // モック鯖は Analytics を配信しない
    errors.push("console: " + m.text());
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T");

  console.log("=== 期間バー ===");
  const keys = await page.evaluate(() => [...document.querySelectorAll("#w2-period-box .w2-p")].map((b) => b.dataset.p));
  check(keys.join(",") === "FY,1M,3M,6M,YTD,1Y,5Y,MAX", `8個がこの順で並ぶ (${keys.join("/")})`);
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="FY"]').classList.contains("active")),
    "既定は FY（初回・LS 空）");
  check(await page.evaluate(() => !document.querySelector(".w2-variants-injected")), "比較ハーネスが注入されていない");

  const bars = {};
  for (const k of ["1M", "1Y", "5Y", "MAX"]) { await clickPeriod(page, k); await page.waitForTimeout(800); bars[k] = await range(page); }
  console.log("   可視バー数:", JSON.stringify(bars));
  check(bars["1M"] < bars["1Y"] && bars["1Y"] < bars["5Y"] && bars["5Y"] < bars["MAX"], "1M < 1Y < 5Y < MAX");

  console.log("=== FY 復帰（last-click-wins）===");
  await clickPeriod(page, "1Y"); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll("#year-controller-box .time-btn")[0].click());
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="FY"]').classList.contains("active")),
    "FY ボタンを押すと期間バーが FY に戻る");

  console.log("=== 永続 ===");
  await clickPeriod(page, "6M"); await page.waitForTimeout(600);
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "6758.T");
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="6M"]').classList.contains("active")),
    "リロード＋別銘柄でも 6M が復元される");
  await page.evaluate(() => { try { localStorage.setItem("sip_detail_period", "9Z"); } catch (e) {} });
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "6758.T");
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="FY"]').classList.contains("active")),
    "未知値を書き込んでも FY へ正規化される");

  console.log("=== 52週レンジ ===");
  await open(page, "7203.T");
  const w52 = await page.evaluate(() => ({
    lo: document.querySelector('[data-w2="lo"]').textContent,
    hi: document.querySelector('[data-w2="hi"]').textContent,
    pos: document.querySelector('[data-w2="pos"]').textContent,
    dist: document.querySelector('[data-w2="dist"]').textContent,
  }));
  check(/^¥[\d,]+$/.test(w52.lo) && /^¥[\d,]+$/.test(w52.hi), `実データで埋まる (${w52.lo} 〜 ${w52.hi} ${w52.pos} ${w52.dist})`);
  const before = JSON.stringify(w52);
  await clickPeriod(page, "1M"); await page.waitForTimeout(700);
  const after = await page.evaluate(() => JSON.stringify({
    lo: document.querySelector('[data-w2="lo"]').textContent, hi: document.querySelector('[data-w2="hi"]').textContent,
    pos: document.querySelector('[data-w2="pos"]').textContent, dist: document.querySelector('[data-w2="dist"]').textContent,
  }));
  check(before === after, "期間を変えても 52週レンジは変わらない（独立）");
  await page.evaluate(() => { STOCK_DATA["7203.T"].px = { last: 1, date: "2026-08-20" }; });
  await open(page, "7203.T");
  check(await page.evaluate(() => getComputedStyle(document.getElementById("w2-52w")).display) === "none",
    "pos52 欠損ならバーごと非表示");

  console.log("=== ベンチマーク ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T");
  await clickPeriod(page, "1Y"); await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());
  await page.waitForTimeout(3000);
  check(await page.evaluate(() => document.getElementById("w2-bench-btn").classList.contains("active")), "ベンチ ON");
  const axis = await page.evaluate(() => {
    const w = DetailRules.rollingWindow(STOCK_DATA[currentTicker].prices, "1Y").displayPrices;
    return { lo: Math.min(...w.map((p) => p.low)) };
  });
  console.log(`   窓内最安値 ${axis.lo}（軸がこの 0.5 倍を下回らないこと）`);
  await page.evaluate(() => { document.getElementById("w2-bench-btn").click(); document.getElementById("w2-bench-btn").click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());
  await page.waitForTimeout(3000);
  check(!(await page.evaluate(() => document.getElementById("w2-bench-btn").classList.contains("active"))),
    "ON→即OFF を繰り返しても最後の OFF が残る（線が復活しない）");
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());
  await page.waitForTimeout(2500);
  await clickPeriod(page, "MAX"); await page.waitForTimeout(3000);
  check(/（\d{4}年〜）/.test(await page.evaluate(() => document.querySelector('[data-w2="benchLabel"]').textContent)),
    "MAX ではベンチ履歴の開始年がラベルに出る");
  await open(page, "1306.T");
  check(await page.evaluate(() => getComputedStyle(document.getElementById("w2-bench-btn")).display) === "none",
    "ベンチ自身を開くとチップごと非表示");

  console.log("=== 劣化経路 ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T");
  const titleBefore = await page.evaluate(() => document.getElementById("stock-title").textContent);
  await page.evaluate(() => { STOCK_DATA["6758.T"].prices = []; });
  await open(page, "6758.T");
  const titleAfter = await page.evaluate(() => document.getElementById("stock-title").textContent);
  check(titleAfter !== titleBefore && titleAfter.includes("6758.T"),
    `価格ゼロの銘柄でも前銘柄の残像を残さない (${titleAfter.slice(0, 40)})`);

  console.log("=== レスポンシブ ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T", 390);
  const resp = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    minFont: Math.min(...[...document.querySelectorAll(".w2-rail *")].map((e) => parseFloat(getComputedStyle(e).fontSize)).filter(Boolean)),
  }));
  check(resp.overflow <= 1, `390px で横はみ出しなし (${resp.overflow}px)`);
  check(resp.minFont >= 12, `390px でも文字床 12px を守る (${resp.minFont}px)`);

  check(errors.length === 0, `pageerror ゼロ (${errors.length})`);
  if (errors.length) console.log("   " + errors.slice(0, 5).join("\n   "));

  await browser.close();
  console.log(fail.length ? `\n❌ FAIL ${fail.length}件\n - ` + fail.join("\n - ") : "\n✅ ALL PASS");
  process.exit(fail.length ? 1 : 0);
})();
```

- [ ] **Step 2: 受入を回す**

```bash
W2_INJECT=0 python3 scratchpad/w2-mock-server.py &
NODE_PATH=/home/shugo/node_modules node scratchpad/w2-smoke.js
```

Expected: `✅ ALL PASS`

- [ ] **Step 3: コミット**

```bash
git add scratchpad/w2-smoke.js
git commit -m "test(w2): ブラウザ受入 w2-smoke.js（期間・52週・ベンチ・劣化経路）"
```

---

## Task 10: 既存受入の更新と wave クロージャ

**Files:**
- Modify: `scratchpad/titles-verify.js`（ローリング時の副題を許容）
- Modify: `scratchpad/theme-floor-check.js`（W2 の新セレクタを床チェックに追加）
- Modify: `scratchpad/wave-closure.sh`（`cd` 先・起動ゲート）
- Modify: `scratchpad/detail-baseline.json`（再ベースライン）

- [ ] **Step 1: `titles-verify.js` を2ケースへ拡張**

現在 `.stock-title-sub` を `/^\[.*経営期間トレンド\]$/` で固定アサートしている（:32 付近）。W2 で
ローリング窓を選ぶと文言が変わるため、**期間ごとに期待値を変える**形へ直す:

```js
// W2: FY は従来の「経営期間トレンド」、ローリング窓は rollingLabelParts の文言。
//  ⚠ 「どちらでも緑」にしてはいけない（正規表現を緩めるだけだと D2＝FY 復帰の回帰が検出できなくなる）。
//  期間を明示的に切り替え、その期間に対応する文言だけを許すこと。
const EXPECT = {
  FY:  /^\[.*経営期間トレンド\]$/,
  "1Y": /^\[直近1年 \d{4}年\d{1,2}月 〜 \d{4}年\d{1,2}月\]$/,
  MAX: /^\[全期間 \d{4}年\d{1,2}月 〜 \d{4}年\d{1,2}月\]$/,
};
for (const [key, re] of Object.entries(EXPECT)) {
  await page.evaluate((k) => document.querySelector(`#w2-period-box .w2-p[data-p="${k}"]`).click(), key);
  await page.waitForTimeout(700);
  const sub = await page.evaluate(() => document.querySelector(".stock-title-sub").textContent);
  check(re.test(sub), `${key} の副題: ${sub}`);
}
```

（既存の check ヘルパ・ページ起動部はそのまま使う。既存の FY 用アサートはこのループに吸収する）

- [ ] **Step 2: `theme-floor-check.js` に W2 のセレクタを足す**

このスクリプトは `theme-a-tuning.css` に列挙されたセレクタしか見ないので、W2 の新クラスは**素通りする**。
セレクタ抽出の直後に追加:

```js
// W2（2026-08-23）で足したレールのセレクタ。theme-a-tuning.css には載っていないので明示的に足す
//  （床チェックが「列挙されたものしか見ない」ため、新クラスは黙って素通りする）。
selectors.push(".w2-rail-label", ".w2-52w-tag", ".w2-52w-num", ".w2-52w-pos", ".w2-52w-dist",
               "#w2-period-box .w2-p", "#w2-bench-btn");
```

- [ ] **Step 3: `wave-closure.sh` を直す**

```bash
# 4行目の cd 先（削除済み worktree uiux-chart-sweep）を、このスクリプト自身の位置から解決する形に変える
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
```

> `git rev-parse --show-toplevel` は使わない（main チェックアウトから叩くと W2 を含まないツリーを
> 検査して ALL GREEN を返す）。

起動ゲートを「200 が返る」から「中身がある」に変える:

```bash
# ⚠ worktree には gitignore された data/investment.db が無い。鯖は起動できるが全 API が 500 を返し、
#   受入15本が「鯖は上がっているのに空」で落ちる。DB を symlink してから起動し、中身で判定する。
[ -e data/investment.db ] || ln -sfn ../../../data/investment.db data/investment.db
curl -sf "http://127.0.0.1:8200/api/market/list" | grep -q '"stocks"' || { echo "❌ mock 鯖が実データを返していない（data/investment.db を確認）"; exit 1; }
```

- [ ] **Step 4: 受入15本を回す**

```bash
bash scratchpad/wave-closure.sh
```

Expected: `detail-snapshot` 以外の14本が PASS。`detail-snapshot` は **DIFF**（レールの DOM が増えたため＝正当）

- [ ] **Step 5: スナップショットを再ベースラインする**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```

Expected: 2回目は `✅ MATCH`

- [ ] **Step 6: 全部を一度に回して締める**

```bash
node --test tests/*.test.js
bash scratchpad/wave-closure.sh
W2_INJECT=0 python3 scratchpad/w2-mock-server.py &   # 別ポート:8220
NODE_PATH=/home/shugo/node_modules node scratchpad/w2-smoke.js
```

Expected: node テスト全緑／wave-closure 15本 ALL PASS／w2-smoke ALL PASS

- [ ] **Step 7: コミット**

```bash
# detail-baseline.json は git 追跡外のローカル成果物なのでコミットしない
git add scratchpad/titles-verify.js scratchpad/theme-floor-check.js scratchpad/wave-closure.sh
git commit -m "test(w2): 既存受入の更新（titles 2ケース・床チェック拡張・wave-closure の DB ゲート）"
```

---

## 完了条件

- [ ] `node --test tests/*.test.js` 全緑（既存 381 ＋ W2 の新規分）
- [ ] `bash scratchpad/wave-closure.sh` が 15本 ALL PASS ＋ `detail-snapshot` MATCH
- [ ] `node scratchpad/w2-smoke.js` が ALL PASS
- [ ] PC 1440 / 1024 / 390px で横はみ出しゼロ・文字床 12px
- [ ] **本人の実機サニティ**（期間切替の体感・52週の読みやすさ・ベンチ線の見え方・モバイル）
- [ ] merge 前に whole-branch の敵対レビュー（過去 wave と同じ手順）

## 実装後に本人へ渡す申し送り

- §14 のデータレーン（1306.T の異常バー3本）は W2 のブロッカーではないが、直すまで JP 銘柄の
  ベンチ線に 1/10 のスパイクが出る（ローソクは潰れない）。
- `scratchpad/w2-variants.js` は案 B/C を含む比較資産として残す（採用は案A）。次の UI 比較で再利用できる。
