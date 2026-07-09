# ZigZag レンジ帯検出改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 詳細ビューの ZigZag T/R を、複数ピボットにまたがる横ばい帯を1つの水平バンド（支持帯/抵抗帯・案B グロー帯）として検出・描画し、signalDigest と規律ミニカードにも中立に反映する。

**Architecture:** `detail-rules.js` に純関数 `zigzagSegments`/`autoClusterTol` を単一源として追加し、`calcZigZag` のピボット列を後段でトレンド区間/レンジ帯のセグメント列へ束ねる。描画（`detail-charts.js drawTRLines`＋新 primitive `makeRangeBandPrimitive`）・signalDigest・disciplineDigest は**すべてこの1関数を消費**（判定の二重実装を作らない）。

**Tech Stack:** Vanilla JS（UMD-lite の detail-rules.js／IIFE の detail-charts.js・detail.js）、Lightweight Charts v4.2.3（Series Primitive）、node --test、Playwright（headless smoke・GPU グローは非authoritative）。

## Global Constraints
（spec §0-13 の全体制約。各タスクの要件に暗黙で含む。値は spec から逐語。）
- **単一源**：レンジ帯化ロジックは `zigzagSegments` の1箇所のみ。drawTRLines/signalDigest/disciplineDigest は同関数を消費（旧 per-segment ロジックの残骸を残さない）。
- **STATE_ENUM 非改修**：signalDigest『ZigZag区間』行の `state` は既存 enum 値 `'直近の確定区間はレンジ'`/`'直近の確定区間はトレンド'`/`'データ不足'` のまま（新 state を足さない）。改善は `readout` に載せる（pre-mortem REG-1）。`tests/detail-rules.test.js` の STATE_ENUM（335-349）と signalDigest test（361-376）は無改修で緑を維持。
- **FORBIDDEN 拡張**：新語彙・glossary・disciplineDigest の trend/vol/dir/range.state を `tests/fixtures/forbidden_terms.js FORBIDDEN.ALL`（TRADE/FORECAST 正規表現）で0ヒットアサート（pre-mortem REG-2）。採用語彙＝`横ばい帯/上抜け/下抜け/トレンド区間/レンジ/帯幅/接触/支持帯/抵抗帯`（買売/損切り/急騰暴落/上昇下落する を含まない）。
- **免責 fail-closed**：`renderDisciplineCard` の `ANALYSIS_DISCLAIMER` 経路を壊さない（免責取得不可＝カード非描画）。
- **facts 非出力**：advice.py / money-rules.js に一切触れない（層1教育のみ）。
- **不変**：ローソク確定色（up=赤 `rgba(218,10,55,0.56)`/縁 `#ff5c7a`・down=青 `rgba(12,62,195,0.56)`/縁 `#4d80ff`）・ZigZag 逆規約（trend up=teal `rgba(52,245,207,0.9)`/down=pink `rgba(255,102,153,0.9)`）・candle glow primitive・`display:none→createChart 0x0罠`回避の寸法/初期化順序。
- **move-not-rewrite**：既存トレンド斜め線の描画（始点→終点の線形補間）と candle 描画は挙動不変。
- **通貨非依存 readout**：絶対価格でなく帯幅%・接触数（US/JP 分岐不要）。
- **読込順不変**：dataClient→finance-rules→detail-rules→inline→detail-charts→detail。`zigzagSegments`/`autoClusterTol` は detail-rules で定義し detail-charts/detail が `DetailRules.*` で参照。
- **テスト実行**：unit＝`node --test tests/detail-rules.test.js`（NODE_PATH 不要・相対 require）。smoke＝Playwright＋mock server（`scratchpad/mock_prod_server.py` 127.0.0.1:8200・`NODE_PATH=/home/shugo/node_modules`）。

## File Structure
- `detail-rules.js`（純計算・UMD-lite）：`autoClusterTol`/`zigzagSegments` 追加、signalDigest zigzag ブロック改修、disciplineDigest に `range` 追加、glossary `zigzag` def 微修正、exports 追記。
- `detail-charts.js`（chart lifecycle・IIFE closure）：closure `trRangeBands` 追加、`makeRangeBandPrimitive` 追加＋attach、`drawTRLines` を `zigzagSegments` 消費へ改修。
- `detail.js`（DOM/オーケストレーション・IIFE）：`renderDisciplineCard` にレンジチップ追加。
- `detail.css`：必要なら `.disc-chip .v.calm` は既存流用（新規CSSは原則なし）。
- `tests/detail-rules.test.js`：`zigzagSegments`/`autoClusterTol`/`disciplineDigest.range` の TDD テスト、FORBIDDEN スキャン拡張。
- `scratchpad/smoke-zigzag-range.js`（新・検証ハーネス）：詳細ビュー実描画で帯1本化・チップ・pageerror0。

---

## Task 1: 純関数 `autoClusterTol` + `zigzagSegments`（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`（`autoZigZagDeviation` 362-369 の直後に追加、exports 921-922 に追記）
- Test: `tests/detail-rules.test.js`（末尾に追記）

**Interfaces:**
- Consumes: 既存 `calcZigZag(prices, deviation)→[{idx,value,type:'high'|'low'}]`、`autoZigZagDeviation(prices)→number`。
- Produces:
  - `autoClusterTol(prices) → number`（[0.02,0.045] にクランプ）
  - `zigzagSegments(prices, pivots, opts?) → Segment[]`。`opts={trendPct=0.03, minTouches=2, clusterTol=autoClusterTol(prices)}`。
    - trend: `{type:'trend', startIdx, endIdx, startVal, endVal, change}`
    - range: `{type:'range', startIdx, endIdx, support, resistance, touchHigh, touchLow, pivots}`

- [ ] **Step 1: 失敗するテストを書く**（`tests/detail-rules.test.js` 末尾に追記）

```javascript
// ── ZigZag レンジ帯検出（zigzagSegments / autoClusterTol）───────────────
function pxOf(pivots, n) {
  // pivots の最大 idx をカバーする最小限の prices（zigzagSegments は pivots 主体・prices は autoClusterTol 用）
  const out = []; const maxIdx = pivots.reduce((m, p) => Math.max(m, p.idx), 0);
  for (let i = 0; i <= Math.max(maxIdx, n - 1); i++) out.push({ time: "2024-01-01", open: 100, high: 101, low: 99, close: 100 });
  return out;
}
const OPT = { trendPct: 0.03, minTouches: 2, clusterTol: 0.025 };

test("zigzagSegments: 明確な横ばい→1つの range 帯（複数ピボットを束ねる）", () => {
  const pivots = [
    { idx: 2, value: 104, type: "low" }, { idx: 8, value: 121, type: "high" },
    { idx: 14, value: 105, type: "low" }, { idx: 20, value: 120, type: "high" },
    { idx: 26, value: 104, type: "low" },
  ];
  const segs = D.zigzagSegments(pxOf(pivots, 30), pivots, OPT);
  const ranges = segs.filter((s) => s.type === "range");
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].startIdx, 2);
  assert.equal(ranges[0].endIdx, 26);
  assert.ok(ranges[0].resistance > ranges[0].support);
  assert.equal(ranges[0].touchHigh + ranges[0].touchLow, 5);
});

test("zigzagSegments: 連続切り上げ→trend のみ・range 0（誤帯化しない）", () => {
  const pivots = [
    { idx: 0, value: 100, type: "low" }, { idx: 5, value: 112, type: "high" },
    { idx: 10, value: 108, type: "low" }, { idx: 15, value: 125, type: "high" },
    { idx: 20, value: 120, type: "low" }, { idx: 25, value: 140, type: "high" },
  ];
  const segs = D.zigzagSegments(pxOf(pivots, 30), pivots, OPT);
  assert.equal(segs.filter((s) => s.type === "range").length, 0);
  assert.ok(segs.some((s) => s.type === "trend"));
});

test("zigzagSegments: 帯→ブレイクの reconciliation（[range, trend]）", () => {
  const pivots = [
    { idx: 2, value: 104, type: "low" }, { idx: 8, value: 121, type: "high" },
    { idx: 14, value: 105, type: "low" }, { idx: 20, value: 120, type: "high" },
    { idx: 26, value: 104, type: "low" }, { idx: 40, value: 150, type: "high" },
  ];
  const segs = D.zigzagSegments(pxOf(pivots, 44), pivots, OPT);
  assert.equal(segs[0].type, "range");
  assert.equal(segs[segs.length - 1].type, "trend");
  assert.equal(segs[segs.length - 1].endIdx, 40);
});

test("zigzagSegments: ピボット不足(<2*minTouches)→range なし", () => {
  const pivots = [{ idx: 0, value: 100, type: "low" }, { idx: 5, value: 120, type: "high" }, { idx: 10, value: 101, type: "low" }];
  const segs = D.zigzagSegments(pxOf(pivots, 12), pivots, OPT);
  assert.equal(segs.filter((s) => s.type === "range").length, 0);
});

test("autoClusterTol: [0.02,0.045] にクランプ", () => {
  const flat = []; for (let i = 0; i < 30; i++) flat.push({ close: 100, high: 100.5, low: 99.5 });
  const t = D.autoClusterTol(flat);
  assert.ok(t >= 0.02 && t <= 0.045, "in range: " + t);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL（`D.zigzagSegments is not a function` / `D.autoClusterTol is not a function`）

- [ ] **Step 3: 最小実装**（`detail-rules.js` の `autoZigZagDeviation`（369行）直後に追加）

```javascript
  // 表示期間ボラティリティに応じた帯の近接許容（autoZigZagDeviation と同思想＝スイング幅の半分・[0.02,0.045]）。
  //  下限保証で「切り上がるトレンド」を誤って帯化しないようにする。
  function autoClusterTol(prices) {
    return Math.max(0.02, Math.min(0.045, autoZigZagDeviation(prices) * 0.5));
  }

  // ピボット列を「トレンド区間」と「レンジ帯（複数ピボットを束ねた水平バンド）」のセグメント列へ後処理。
  //  単一源＝drawTRLines / signalDigest / disciplineDigest がこれを消費（判定の二重実装を作らない）。
  function zigzagSegments(prices, pivots, opts) {
    opts = opts || {};
    var trendPct = opts.trendPct != null ? opts.trendPct : 0.03;
    var minTouches = opts.minTouches != null ? opts.minTouches : 2;
    var clusterTol = opts.clusterTol != null ? opts.clusterTol : autoClusterTol(prices);
    var segs = [];
    var n = pivots.length;
    var i = 0;
    while (i < n - 1) {
      var bestK = -1, bestBand = null;
      for (var k = i + (2 * minTouches - 1); k < n; k++) {
        var highs = [], lows = [];
        for (var w = i; w <= k; w++) { (pivots[w].type === "high" ? highs : lows).push(pivots[w].value); }
        if (highs.length < minTouches || lows.length < minTouches) continue;
        var resistance = _mean(highs), support = _mean(lows), mid = (resistance + support) / 2 || 1;
        var highsSpread = (Math.max.apply(null, highs) - Math.min.apply(null, highs)) / mid;
        var lowsSpread = (Math.max.apply(null, lows) - Math.min.apply(null, lows)) / mid;
        if (highsSpread <= clusterTol && lowsSpread <= clusterTol && resistance > support) {
          bestK = k; bestBand = { support: support, resistance: resistance, touchHigh: highs.length, touchLow: lows.length };
        } else break;
      }
      if (bestK >= 0) {
        segs.push({
          type: "range", startIdx: pivots[i].idx, endIdx: pivots[bestK].idx,
          support: bestBand.support, resistance: bestBand.resistance,
          touchHigh: bestBand.touchHigh, touchLow: bestBand.touchLow, pivots: pivots.slice(i, bestK + 1),
        });
        i = bestK;
      } else {
        var p1 = pivots[i], p2 = pivots[i + 1], change = (p2.value - p1.value) / p1.value;
        if (Math.abs(change) >= trendPct && (p2.idx - p1.idx) >= 3) {
          segs.push({ type: "trend", startIdx: p1.idx, endIdx: p2.idx, startVal: p1.value, endVal: p2.value, change: change });
        }
        i = i + 1;
      }
    }
    return segs;
  }
```

`_mean` ヘルパが未定義なら同ファイルの数値ヘルパ群付近に追加（`_median` は既存・778行 disciplineDigest が使用）：

```javascript
  function _mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }
```

- [ ] **Step 4: exports に追記**（`detail-rules.js` 921-922 の export オブジェクト）

`calcZigZag, autoZigZagDeviation,` の並びに `zigzagSegments, autoClusterTol,` を追加。

- [ ] **Step 5: テスト成功を確認**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS（新5テスト＋既存全緑）

- [ ] **Step 6: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(zigzag): add zigzagSegments/autoClusterTol pure functions (range-band grouping)"
```

---

## Task 2: signalDigest『ZigZag区間』行を zigzagSegments 消費へ（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`（signalDigest の zigzag ブロック 675-688）
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Consumes: `zigzagSegments`（Task 1）、既存 `calcZigZag`/`autoZigZagDeviation`。
- Produces: signalDigest の zigzag descriptor `{key:'zigzag', label, term, state, readout, note}`。state は既存 STATE_ENUM 値。

- [ ] **Step 1: 失敗するテストを書く**（末尾に追記）

```javascript
test("signalDigest zigzag 行: 末尾が横ばい帯なら readout に帯幅・state は既存 enum 値", () => {
  // 末尾が明確な横ばい（±7%・複数往復）になる系列
  const prices = []; const base = Date.UTC(2024, 0, 1); let c = 100;
  for (let i = 0; i < 40; i++) { c += 0.5 + Math.sin(i / 3) * 0.2; prices.push(mkBar(base, i, c)); }
  for (let i = 40; i < 90; i++) { c = 120 + 120 * 0.07 * Math.sin((2 * Math.PI * 3 * (i - 40)) / 50); prices.push(mkBar(base, i, c)); }
  const ds = D.signalDigest(prices, prices);
  const z = ds.find((d) => d.key === "zigzag");
  assert.ok(z);
  assert.ok(["直近の確定区間はレンジ", "直近の確定区間はトレンド", "データ不足"].includes(z.state));
  if (z.state === "直近の確定区間はレンジ") assert.ok(/帯幅/.test(z.readout));
});
```

`mkBar` ヘルパが未定義なら追記：

```javascript
function mkBar(base, i, close) {
  const d = new Date(base + i * 86400000).toISOString().slice(0, 10);
  return { time: d, open: close, high: close * 1.01, low: close * 0.99, close: close, volume: 1000 + i };
}
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL（旧実装は帯幅 readout を出さない／`/帯幅/` 不一致）

- [ ] **Step 3: 実装**（`detail-rules.js` 675-688 の zigzag IIFE ブロックを置換）

```javascript
    // 6) ZigZag：zigzagSegments の末尾セグメント（単一源）。state は既存 enum 値を維持し改善は readout へ。
    (function () {
      var segs = zigzagSegments(dp, calcZigZag(dp, autoZigZagDeviation(dp)) || []) || [];
      var state = 'データ不足', readout = '', note = '';
      var last = segs.length ? segs[segs.length - 1] : null;
      if (last) {
        if (last.type === 'range') {
          state = '直近の確定区間はレンジ';
          readout = '帯幅 ' + ((last.resistance - last.support) / last.support * 100).toFixed(1) + '%・' + (last.touchHigh + last.touchLow) + '点接触';
        } else {
          state = '直近の確定区間はトレンド';
          readout = (last.change >= 0 ? '+' : '') + (last.change * 100).toFixed(1) + '%';
        }
        note = '末尾ピボットは未確定';
      }
      out.push({ key: 'zigzag', label: 'ZigZag区間', term: 'zigzag', state: state, readout: readout, note: note });
    })();
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS。**特に既存 test 361-376（12 descriptors・STATE_ENUM）と 378-385（FORBIDDEN）が緑のまま**（state を enum 値に保ったため回帰なし）。

- [ ] **Step 5: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(zigzag): signalDigest ZigZag row consumes zigzagSegments (band width in readout, enum-stable state)"
```

---

## Task 3: disciplineDigest に `range`（recency 二重錠）＋ glossary 微修正 ＋ FORBIDDEN 拡張（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`（disciplineDigest 778-796、glossary `zigzag` 55）
- Test: `tests/detail-rules.test.js`（disciplineDigest テスト 770-781 拡張＋新テスト）

**Interfaces:**
- Consumes: `zigzagSegments`、`calcZigZag`、`autoZigZagDeviation`。
- Produces: `disciplineDigest(...)` 戻り値に `range:{ok:boolean, state?, widthPct?, touches?}` を追加（通貨非依存＝絶対価格を含まない）。

- [ ] **Step 1: 失敗するテストを書く**（末尾に追記＋既存 780 の拡張は Step 3 で）

```javascript
test("disciplineDigest.range: 末尾が横ばい帯なら ok:true・横ばい帯の中・通貨非依存", () => {
  const prices = []; const base = Date.UTC(2024, 0, 1);
  for (let i = 0; i < 30; i++) prices.push(mkBar(base, i, 100 + i * 0.4)); // 立ち上がり
  for (let i = 30; i < 90; i++) prices.push(mkBar(base, i, 120 + 120 * 0.07 * Math.sin((2 * Math.PI * 3 * (i - 30)) / 60))); // 末尾=横ばい
  const d = D.disciplineDigest(prices, prices);
  assert.equal(d.ok, true);
  assert.ok(d.range && d.range.ok === true);
  assert.ok(["横ばい帯の中", "上抜け（直近）", "下抜け（直近）"].includes(d.range.state));
  assert.equal(typeof d.range.widthPct, "number");
  assert.equal(typeof d.range.touches, "number");
  // 通貨非依存＝絶対価格キーを含まない
  ["support", "resistance", "price"].forEach((k) => assert.ok(!(k in d.range)));
});

test("disciplineDigest.range: 窓前半で横ばい→その後ずっと上昇（帯が古い）なら ok:false（recency 錠・C1）", () => {
  const prices = []; const base = Date.UTC(2024, 0, 1);
  for (let i = 0; i < 30; i++) prices.push(mkBar(base, i, 100 + 100 * 0.06 * Math.sin((2 * Math.PI * 2.5 * i) / 30))); // 前半=横ばい
  for (let i = 30; i < 120; i++) prices.push(mkBar(base, i, 100 + (i - 30) * 1.2)); // 以後ずっと上昇
  const d = D.disciplineDigest(prices, prices);
  assert.equal(d.ok, true);
  assert.equal(d.range.ok, false); // 月遅れブレイクを"上抜け（直近）"にしない
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL（`d.range` undefined）

- [ ] **Step 3: 実装**（`detail-rules.js` disciplineDigest 786 の `if (!a || !at) return { ok: false };` の後、return オブジェクト 789-795 の前に range 算出を挿入し、return に `range: range,` を追加）

```javascript
    // ── レンジ帯（zigzagSegments 単一源）＋ recency 二重錠（末尾セグメント位置＋bar-distance）──
    var range = { ok: false };
    var segs = zigzagSegments(dp, calcZigZag(dp, autoZigZagDeviation(dp)) || []) || [];
    var lastSeg = segs.length ? segs[segs.length - 1] : null;
    var prevSeg = segs.length > 1 ? segs[segs.length - 2] : null;
    var band = null;
    if (lastSeg && lastSeg.type === 'range') band = lastSeg;
    else if (lastSeg && lastSeg.type === 'trend' && prevSeg && prevSeg.type === 'range') band = prevSeg;
    var recencyBars = Math.max(10, Math.round(dp.length * 0.2));
    var closeV = endBar ? endBar.close : null;
    if (band && closeV != null && (dp.length - 1 - band.endIdx) <= recencyBars) {
      var st = closeV > band.resistance ? '上抜け（直近）' : (closeV < band.support ? '下抜け（直近）' : '横ばい帯の中');
      range = { ok: true, state: st, widthPct: parseFloat(((band.resistance - band.support) / band.support * 100).toFixed(1)), touches: band.touchHigh + band.touchLow };
    }
```

return オブジェクト（789-795）に追加：`range: range,`（既存 `note:` の隣）。

glossary `zigzag`（55行）def を横ばい帯へ言及（中立・禁止語なし）：

```javascript
    { term: "zigzag", read: "ZigZag（トレンド/レンジ）", def: "一定以上動いた転換点だけを結び、区間を「トレンド」か「レンジ（横ばい）」に分けて見る。同じ価格帯で複数回往復する区間は1つの横ばい帯（支持帯/抵抗帯）として見る。末尾の点は未確定で後から変わりうる。" },
```

- [ ] **Step 4: FORBIDDEN スキャンを disciplineDigest 全 state へ拡張**（既存 780 を置換）

```javascript
  // trend/vol/dir/range.state と note をまとめて禁止語スキャン（range 経路も規制ゲートに含める）
  const discText = [d.trend, d.vol, d.dir, (d.range && d.range.state) || "", d.note || ""].join("　");
  FORBIDDEN.ALL.forEach((re) => assert.ok(!re.test(discText), "禁止語: " + re));
```

- [ ] **Step 5: テスト成功を確認**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS（新2テスト＋glossary FORBIDDEN test 314-321＋disciplineDigest test 全緑）

- [ ] **Step 6: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(zigzag): disciplineDigest.range with recency gate + glossary/FORBIDDEN coverage"
```

---

## Task 4: drawTRLines を zigzagSegments 消費へ改修＋案B グロー帯 primitive（detail-charts.js）

**Files:**
- Modify: `detail-charts.js`（closure let 48-50 付近、`makeCandleGlowPrimitive` 537-565 の隣、attach 600、`drawTRLines` 426-483）

**Interfaces:**
- Consumes: `zigzagSegments`（`DR.zigzagSegments` として import・27行の分割代入に追加）、既存 `calcZigZag`/`autoZigZagDeviation`。
- Produces: 描画のみ（返り値なし）。closure `trRangeBands`（primitive が draw 時に読む）。

- [ ] **Step 1: import と closure 変数を追加**

27行付近の `calcZigZag = DR.calcZigZag, autoZigZagDeviation = DR.autoZigZagDeviation,` に `zigzagSegments = DR.zigzagSegments,` を追加。
49-50行付近（`let trSeries = [];` の隣）に：`let trRangeBands = [];`

- [ ] **Step 2: `makeRangeBandPrimitive` を追加**（`makeCandleGlowPrimitive` 565行の直後・同型＝draw 時に closure を読む・requestUpdate 不要）

```javascript
      // レンジ帯の淡いグロー（案B・面でなく光）。trState=off / trRangeBands 空なら描かない。
      //  candle glow と同機構＝draw 時に trRangeBands を読む（drawTRLines の series 変更で pane 再描画される）。
      function makeRangeBandPrimitive() {
        const renderer = {
          draw(target) {
            target.useMediaCoordinateSpace((scope) => {
              if (!trState || !trRangeBands.length || !priceChart || !candleSeries) return;
              const ctx = scope.context;
              const ts = priceChart.timeScale();
              for (const b of trRangeBands) {
                const x1 = ts.timeToCoordinate(b.startTime), x2 = ts.timeToCoordinate(b.endTime);
                const yR = candleSeries.priceToCoordinate(b.resistance), yS = candleSeries.priceToCoordinate(b.support);
                if (x1 == null || x2 == null || yR == null || yS == null) continue;
                const g = ctx.createLinearGradient(0, yR, 0, yS);
                g.addColorStop(0, "rgba(255,216,77,0.16)");
                g.addColorStop(0.5, "rgba(255,216,77,0.05)");
                g.addColorStop(1, "rgba(255,216,77,0.16)");
                ctx.fillStyle = g;
                ctx.fillRect(x1, yR, x2 - x1, yS - yR);
              }
            });
          },
        };
        const paneView = { renderer() { return renderer; }, zOrder() { return "bottom"; } };
        return { paneViews() { return [paneView]; } };
      }
```

- [ ] **Step 3: primitive を attach**（600行 `candleSeries.attachPrimitive(makeCandleGlowPrimitive());` の直後）

```javascript
        candleSeries.attachPrimitive(makeRangeBandPrimitive());
```

- [ ] **Step 4: `drawTRLines`（426-483）を zigzagSegments 消費へ改修**

```javascript
      function drawTRLines(displayPrices) {
        trSeries.forEach(s => { try { priceChart.removeSeries(s); } catch(e) {} });
        trSeries = [];
        trRangeBands = [];
        if (!trState || !displayPrices?.length || displayPrices.length < 10) return;

        const dev = autoZigZagDeviation(displayPrices);
        const pivots = calcZigZag(displayPrices, dev);
        if (pivots.length < 2) return;
        const segs = zigzagSegments(displayPrices, pivots);

        for (const seg of segs) {
          if (seg.type === "trend") {
            // ZigZag 逆規約（up=緑 teal/down=赤 pink・意味不変）。始点→終点の線形補間（既存挙動を保存）。
            const color = seg.change > 0 ? "rgba(52,245,207,0.9)" : "rgba(255,102,153,0.9)";
            const s = priceChart.addLineSeries({ color, lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            const segLen = seg.endIdx - seg.startIdx;
            const data = [];
            for (let j = seg.startIdx; j <= seg.endIdx; j++) {
              const t = (j - seg.startIdx) / segLen;
              const v = seg.startVal + (seg.endVal - seg.startVal) * t;
              data.push({ time: displayPrices[j].time, value: parseFloat(v.toFixed(2)) });
            }
            s.setData(data);
            trSeries.push(s);
          } else {
            // レンジ帯：支持・抵抗を帯の全区間に amber 破線1本ずつ（複数ピボットを束ねた1帯）。
            [seg.resistance, seg.support].forEach((val) => {
              const s = priceChart.addLineSeries({ color: "rgba(255,216,77,0.85)", lineWidth: 1.5, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
              const data = [];
              for (let j = seg.startIdx; j <= seg.endIdx; j++) data.push({ time: displayPrices[j].time, value: parseFloat(val.toFixed(2)) });
              s.setData(data);
              trSeries.push(s);
            });
            trRangeBands.push({ startTime: displayPrices[seg.startIdx].time, endTime: displayPrices[seg.endIdx].time, support: seg.support, resistance: seg.resistance });
          }
        }
      }
```

- [ ] **Step 5: 構文チェック**

Run: `node --check detail-charts.js`
Expected: 出力なし（構文OK）

- [ ] **Step 6: Commit**

```bash
git add detail-charts.js
git commit -m "feat(zigzag): drawTRLines consumes zigzagSegments + range-band glow primitive (案B)"
```

---

## Task 5: 規律ミニカードに「レンジ」チップ（detail.js）

**Files:**
- Modify: `detail.js`（`renderDisciplineCard` 450-469）

**Interfaces:**
- Consumes: `disciplineDigest(...).range`（Task 3）、`window.esc`、`injectTermHelp`。
- Produces: DOM のみ。

- [ ] **Step 1: 実装**（`renderDisciplineCard` の innerHTML に「値幅」チップ（464-465）の後・`disc-note`（466）の前へレンジチップを挿入）

`card.innerHTML =` の連結に以下を追加（`'<div class="disc-note">' ...` の直前）：

```javascript
      (d.range && d.range.ok
        ? '<div class="disc-chip"><span class="k">レンジ</span><span class="v ' +
          (d.range.state.indexOf("横ばい") >= 0 ? "calm" : "") + '" data-term="zigzag">' +
          window.esc(d.range.state) + '（帯幅 ' + d.range.widthPct.toFixed(1) + '%・' + d.range.touches + '点接触）</span></div>'
        : "") +
```

（`d.range.ok===false` は空文字＝チップ非表示。tone は `横ばい帯の中`→calm・上抜け/下抜けは無印＝方向的良否を色で含意しない。`data-term="zigzag"` で既存 `injectTermHelp` の用語ポップオーバーに乗る＝468行の `injectTermHelp(card)` は無改修。）

- [ ] **Step 2: 構文チェック**

Run: `node --check detail.js`
Expected: 出力なし

- [ ] **Step 3: Commit**

```bash
git add detail.js
git commit -m "feat(zigzag): discipline mini-card レンジ chip (recency-gated, neutral)"
```

---

## Task 6: 統合スモーク（headless）＋ snapshot 再ベースライン＋全緑確認

**Files:**
- Create: `scratchpad/smoke-zigzag-range.js`
- Run: 既存 `scratchpad/detail-snapshot.js`（再ベースライン）

**Interfaces:** なし（検証のみ）。

- [ ] **Step 1: mock server を起動**（別ターミナル・1回）

Run: `python3 scratchpad/mock_prod_server.py`（127.0.0.1:8200・SQLite実財務＋合成価格を配信）

- [ ] **Step 2: スモークを書く**（`scratchpad/smoke-zigzag-range.js`）

```javascript
// 詳細ビュー実描画で ZigZag レンジ帯を検証（GPU グローは非authoritative・pageerror/構造を錠）
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text()); });
  await p.goto("http://127.0.0.1:8200/", { waitUntil: "networkidle" });
  // 銘柄詳細へ（実装のナビ経路に合わせて調整＝例: 最初の行クリック）
  await p.click(".stock-row, [data-ticker]");
  await p.waitForTimeout(1200);
  // T/R トグル ON
  const tr = await p.$("#ind-btn-tr");
  if (tr) { await tr.click(); await p.waitForTimeout(600); }
  const res = await p.evaluate(() => {
    const chip = Array.from(document.querySelectorAll(".disc-chip .k")).find((e) => e.textContent.includes("レンジ"));
    const chipText = chip ? (chip.parentElement.querySelector(".v") || {}).textContent || "" : "";
    return {
      discipline: !!document.querySelector("#discipline-card"),
      rangeChip: !!chip,
      rangeChipText: chipText, // 例「横ばい帯の中（帯幅…%・…点接触）」＝中立語のみを目視/アサート
      trSeries: document.querySelectorAll("#chart-container canvas").length, // 描画継続
      canvases: document.querySelectorAll("#chart-container canvas").length,
    };
  });
  console.log("result:", JSON.stringify(res));
  console.log("errors:", errs.length ? errs.join("\n") : "(none)");
  await p.screenshot({ path: "scratchpad/zigzag-range-smoke.png", fullPage: true });
  await b.close();
  if (errs.length) process.exit(1);
})();
```

- [ ] **Step 3: スモーク実行**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js`
Expected: `errors: (none)`・`canvases>0`・レンジチップ有（横ばい銘柄）／スクショで帯が1本化（旧ギザギザ非再発）を目視。

- [ ] **Step 4: snapshot 再ベースライン**（T/R 描画領域は意図的変更）

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture`
（非チャート領域が一致することを確認。T/R 帯は再ベースライン。）

- [ ] **Step 5: 全ユニット緑を確認**

Run: `node --test tests/`
Expected: 既存+新テスト全 PASS（206+新規）。

- [ ] **Step 6: Commit**

```bash
git add scratchpad/smoke-zigzag-range.js
git commit -m "test(zigzag): headless smoke + snapshot rebaseline for range-band detection"
```

---

## Self-Review（spec 突合）

**Spec coverage:**
- §3 zigzagSegments/autoClusterTol → Task 1 ✅
- §4 drawTRLines 改修＋案B グロー帯 primitive → Task 4 ✅
- §5 signalDigest（enum 非改修・readout へ） → Task 2 ✅
- §6 disciplineDigest.range（recency 二重錠） → Task 3 ✅
- §6 renderDisciplineCard レンジチップ → Task 5 ✅
- §7 glossary 微修正・FORBIDDEN 拡張・免責 fail-closed → Task 3（glossary/FORBIDDEN）・免責は既存経路無改修 ✅
- §8 テスト（zigzagSegments/autoClusterTol/disciplineDigest.range/FORBIDDEN/STATE_ENUM非改修） → Task 1-3・6 ✅
- §9 headless smoke＋snapshot → Task 6 ✅
- §10 単一源・0x0罠・move-not-rewrite → Global Constraints＋Task 4（primitive 同機構・trend 線形補間保存）✅

**Placeholder scan:** 各 step に実コード・実コマンド・期待出力あり。プレースホルダなし。

**Type consistency:** `zigzagSegments`（Task1 定義）を Task2/3/4 が同名同引数で消費。Segment の `type/startIdx/endIdx/startVal/endVal/change/support/resistance/touchHigh/touchLow` は Task1 の Produces と一致。`disciplineDigest.range.{ok,state,widthPct,touches}`（Task3）を Task5 が同名参照。`trRangeBands`（Task4 closure）を primitive が同名参照。

**未カバー（意図・実装時に確認）:** boundaries 次元 pre-mortem は usage limit で未実行 → 実装完了後の whole-branch 敵対検証 wf（reset 後）で single-source/primitive 干渉/state クリア/ F2 露出を重点再確認（§13）。スモークの銘柄ナビ経路（Step2 の `.stock-row` セレクタ）は mock server の実 DOM に合わせて実装時に確定。
