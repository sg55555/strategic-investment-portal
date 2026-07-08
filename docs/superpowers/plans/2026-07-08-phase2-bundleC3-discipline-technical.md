# Phase2 束C③ 規律テクニカル（ADX/ATR）＋可視サブパネル選択UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 詳細ビューに ADX/DMI・ATR% サブパネルを追加し、サブパネル選択UIをアコーディオン化（可視サブパネル選択UI）＋現在地ミニ解説カードで規律テクニカルを教育フレームで見せる。

**Architecture:** 既存 detail 分離3層を遵守＝純計算 `detail-rules.js`（calcADX/calcATR/disciplineDigest/signalDigest拡張・DOM非依存・node --test）／描画 `detail-charts.js`（サブパネルを汎用レジストリ化・mount/unmount・IIFE closure私有・0x0罠不変）／UI `index.html`+`detail.js`+`detail.css`（アコーディオン選択＋ミニ解説カード・F2 IIFE公開面遵守）。本セッションのモック `scratchpad/subpanel-mock/`（mock-engine.js＝Wilder実装+汎用エンジンの検証済形／live-C.html＝採用UIの視覚・挙動リファレンス）を移植元とする。

**Tech Stack:** Vanilla JS（UMD純関数 + IIFE）、Lightweight Charts v4.2.3、node:test。

## Global Constraints
- **規制フレーム（層1・教育）**：ADX/ATR は記述的テクニカル値。**売買語・予測語・損切り水準の推奨を出さない**。`signalDigest` の descriptor は既存規律＝`{key,label,term,state,readout,note?}`・`state` は中立状態語の閉集合・**数値スコアフィールド(value/score/weight)を持たない**。免責は `DetailRules.ANALYSIS_DISCLAIMER`（単一源）。禁止語 fixture＝`tests/fixtures/forbidden_terms.js`。
- **0x0罠（唯一の技術制約）**：`display:none→createChart` は 0x0 固定になる。サブパネルは可視（clientWidth>0）になってから生成。折り畳み=unmount／展開=mount。装飾は親カードに付け chart-container 寸法・初期化順序は不変。
- **move-not-rewrite**：既存 RSI/MACD の描画本体・**色は変えない**（RSI線 `#ffd84d`＋70/50/30線、MACD hist＋MACD線 `#ff5ca8`＋シグナル `#3aa6ff`＋0線）。registry へ移設するだけ。
- **F2 公開面**：inline onclick / cross-script 参照される関数・定数は必ず露出（detail-charts は `window.toggle*`＋`window.DetailCharts`、detail.js は bare＋`window.Detail`）。足し忘れ＝無言故障。**新規はできる限り委譲リスナーで inline onclick を増やさない**。
- **テスト規約**：`tests/detail-rules.test.js`＝`node:test`＋`assert/strict`、`global.FinanceRules` 注入後に `require("../detail-rules.js")`。実行 `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`。
- **検証ハーネス**：`scratchpad/detail-snapshot.js`（`NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture|compare`・mock_prod_server.py 前提）。サブパネル領域は意図的変更＝該当領域はベースライン更新、他領域は `✅MATCH` 維持。
- **ATR は %（正規化）主体**、ADX は +DI/-DI 同梱（向きは「圧力」の事実として）。

---

### Task 1: `calcATR`（Wilder ATR・rules）

**Files:**
- Modify: `detail-rules.js`（テクニカル純関数群＝calcMACD の後・行 206 付近に追加）
- Modify: `detail-rules.js` exports（688-690 の技術群に `calcATR` 追加）
- Test: `tests/detail-rules.test.js`（末尾付近に追加）

**Interfaces:**
- Produces: `calcATR(prices, period=14) -> [{time, value, pct}]`（value=絶対ATR、pct=value/close*100）。`prices` 要素は `{time,high,low,close}`。

- [ ] **Step 1: Write the failing test**

```js
// ── calcATR: Wilder ATR（絶対値 + ATR%）──
test("calcATR: 長さ不足は空配列", () => {
  assert.deepEqual(D.calcATR([{ time: "d1", high: 1, low: 1, close: 1 }], 14), []);
});
test("calcATR: 一定TRなら ATR=TR・pct=TR/close*100", () => {
  // 毎バー high-low=10, gap無し（close=100固定）→ TR=10, ATR=10, pct=10
  const prices = [];
  for (let i = 0; i < 20; i++) prices.push({ time: "d" + i, high: 105, low: 95, close: 100 });
  const r = D.calcATR(prices, 5);
  assert.ok(r.length > 0);
  const last = r[r.length - 1];
  assert.equal(Math.round(last.value), 10);
  assert.equal(Math.round(last.pct), 10);
});
test("calcATR: フラット価格で NaN/Inf を出さない", () => {
  const prices = [];
  for (let i = 0; i < 20; i++) prices.push({ time: "d" + i, high: 50, low: 50, close: 50 });
  const r = D.calcATR(prices, 14);
  r.forEach((o) => { assert.ok(Number.isFinite(o.value)); assert.ok(Number.isFinite(o.pct)); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（`D.calcATR is not a function`）

- [ ] **Step 3: Write minimal implementation**（`detail-rules.js`・calcMACD の後に追加）

```js
  // ── ATR (Wilder・period=14)。value=絶対ATR / pct=ATR%(÷close×100) ──
  function calcATR(prices, period = 14) {
    const out = [];
    if (prices.length < period + 1) return out;
    const tr = [];
    for (let i = 1; i < prices.length; i++) {
      const h = prices[i].high, l = prices[i].low, pc = prices[i - 1].close;
      tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    let atr = 0;
    for (let k = 0; k < period; k++) atr += tr[k];
    atr /= period;
    const push = (pi, a) => {
      const cl = prices[pi].close || 0;
      out.push({ time: prices[pi].time, value: parseFloat(a.toFixed(2)), pct: cl ? parseFloat((a / cl * 100).toFixed(2)) : 0 });
    };
    push(period, atr); // tr index period-1 → price index period
    for (let k = period; k < tr.length; k++) { atr = (atr * (period - 1) + tr[k]) / period; push(k + 1, atr); }
    return out;
  }
```

- [ ] **Step 4: Add to exports**（688-690 の技術群へ・**この Task では calcATR のみ**）

```js
    calcMA, calcBB, detectSR, calcRSI, calcEMA, calcMACD, calcZigZag, autoZigZagDeviation, volumeColorData,
    calcATR,
    signalDigest, healthTrendSeries, dupontFactorSeries, fcfTrendSeries,
```
⚠️ `calcADX` は Task2、`disciplineDigest` は Task5 で**各自が実体を追加してから** export に足す（未実装の名前を `return {…}` の shorthand に入れると module load 時 ReferenceError＝全 unit が落ちる）。

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: calcATR 3件 PASS（calcADX/disciplineDigest 未実装なら exports に載るが他テスト無し＝緑）

- [ ] **Step 6: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): calcATR (Wilder ATR + ATR%)"
```

---

### Task 2: `calcADX`（Wilder ADX/DMI・rules）

**Files:**
- Modify: `detail-rules.js`（calcATR の後に追加）
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Produces: `calcADX(prices, period=14) -> [{time, adx, plusDI, minusDI}]`。`prices` 要素は `{time,high,low,close}`。

- [ ] **Step 1: Write the failing test**

```js
// ── calcADX: Wilder ADX/DMI ──
test("calcADX: 長さ不足は空配列", () => {
  const short = [];
  for (let i = 0; i < 10; i++) short.push({ time: "d" + i, high: 2, low: 1, close: 1.5 });
  assert.deepEqual(D.calcADX(short, 14), []);
});
test("calcADX: 一貫上昇では +DI>-DI かつ ADX が高い", () => {
  const prices = [];
  let p = 100;
  for (let i = 0; i < 60; i++) { p += 2; prices.push({ time: "d" + i, high: p + 1, low: p - 1, close: p }); }
  const r = D.calcADX(prices, 14);
  assert.ok(r.length > 0);
  const last = r[r.length - 1];
  assert.ok(last.plusDI > last.minusDI);
  assert.ok(last.adx > 25);
  [last.adx, last.plusDI, last.minusDI].forEach((v) => assert.ok(Number.isFinite(v)));
});
test("calcADX: フラット価格で NaN/Inf を出さない（分母0ガード）", () => {
  const prices = [];
  for (let i = 0; i < 60; i++) prices.push({ time: "d" + i, high: 50, low: 50, close: 50 });
  const r = D.calcADX(prices, 14);
  r.forEach((o) => [o.adx, o.plusDI, o.minusDI].forEach((v) => assert.ok(Number.isFinite(v))));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（`D.calcADX is not a function`）

- [ ] **Step 3: Write minimal implementation**（`detail-rules.js`・calcATR の後）

```js
  // ── ADX/DMI (Wilder・period=14)。{time, adx, plusDI, minusDI} ──
  function calcADX(prices, period = 14) {
    if (prices.length < 2 * period + 1) return [];
    const tr = [], pdm = [], mdm = [];
    for (let i = 1; i < prices.length; i++) {
      const h = prices[i].high, l = prices[i].low, ph = prices[i - 1].high, pl = prices[i - 1].low, pc = prices[i - 1].close;
      const up = h - ph, dn = pl - l;
      pdm.push(up > dn && up > 0 ? up : 0);
      mdm.push(dn > up && dn > 0 ? dn : 0);
      tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    let atr = 0, ap = 0, am = 0;
    for (let k = 0; k < period; k++) { atr += tr[k]; ap += pdm[k]; am += mdm[k]; }
    const dx = [];
    const pushDX = (pi) => {
      const pDI = atr === 0 ? 0 : 100 * ap / atr, mDI = atr === 0 ? 0 : 100 * am / atr;
      const sum = pDI + mDI, d = sum === 0 ? 0 : 100 * Math.abs(pDI - mDI) / sum;
      dx.push({ pi, pDI, mDI, dx: d });
    };
    pushDX(period);
    for (let k = period; k < tr.length; k++) {
      atr = atr - atr / period + tr[k];
      ap = ap - ap / period + pdm[k];
      am = am - am / period + mdm[k];
      pushDX(k + 1);
    }
    if (dx.length < period) return [];
    let adx = 0;
    for (let k = 0; k < period; k++) adx += dx[k].dx;
    adx /= period;
    const res = [];
    const pushRes = (idx, a) => {
      const o = dx[idx];
      res.push({ time: prices[o.pi].time, adx: parseFloat(a.toFixed(2)), plusDI: parseFloat(o.pDI.toFixed(2)), minusDI: parseFloat(o.mDI.toFixed(2)) });
    };
    pushRes(period - 1, adx);
    for (let k = period; k < dx.length; k++) { adx = (adx * (period - 1) + dx[k].dx) / period; pushRes(k, adx); }
    return res;
  }
```

- [ ] **Step 4: Add `calcADX` to exports**（Task1 で追加した `calcATR,` の隣へ）

```js
    calcATR, calcADX,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: calcADX 3件 PASS

- [ ] **Step 6: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): calcADX (Wilder ADX/DMI)"
```

---

### Task 3: 状態ヘルパ `_adxState`/`_atrVolState` ＋ グロッサリ adx/atr ＋ 定数

**Files:**
- Modify: `detail-rules.js`（`INDICATOR_GLOSSARY`＝79行の `]` 直前に2件追加、状態ヘルパを signalDigest 付近の private として追加）
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Produces（module-private・exports しない）: `_adxState(adx) -> '方向感が強い'|'やや方向感あり'|'弱い・レンジ気味'`（境界は `Math.round(adx)`：25以上/20以上/未満）。`_atrVolState(pct, median) -> '振れ大きめ'|'通常'|'静穏'`（pct>=median*1.3 / pct<=median*0.75 / else）。
- Produces（公開・INDICATOR_GLOSSARY 経由）: term `adx`・`atr` の用語定義。
- 注：ヘルパは Task4/5 が呼ぶため、それらより前の行に定義（関数宣言巻き上げで順不同でも可だがアロー const は不可＝**function 宣言で書く**）。

- [ ] **Step 1: Write the failing test**

```js
// ── 状態ヘルパ ＆ グロッサリ ──（FORBIDDEN は regex オブジェクト {TRADE,FORECAST,ALL}）
test("adx/atr グロッサリが存在し中立文言（売買/予測語なし）", () => {
  const g = D.INDICATOR_GLOSSARY;
  const adx = g.find((x) => x.term === "adx"), atr = g.find((x) => x.term === "atr");
  assert.ok(adx && atr, "adx/atr glossary missing");
  assert.ok(adx.read && adx.def && atr.read && atr.def);
  [adx, atr].forEach((e) => FORBIDDEN.ALL.forEach((re) =>
    assert.ok(!re.test(e.read + "　" + e.def), e.term + " に禁止語: " + re)));
});
```
⚠️ 既存テスト（`INDICATOR_GLOSSARY: def/read contain no trade/forecast words`・313行）が**全**グロッサリ def を `FORBIDDEN.ALL` で検査する。よって adx/atr def に「損切り」「買い/売り」等の TRADE/FORECAST 語を**絶対に入れない**（下の def はそれを避けた文言＝否定でも「損切り」の語自体を使わない）。`_adxState`/`_atrVolState` は private ゆえ Task4/5 の descriptor 経由で境界を検証。

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（adx/atr グロッサリ未定義で `adx` が undefined）

- [ ] **Step 3: グロッサリに2件追加**（`detail-rules.js` 78行 `cash-conversion` の後・`]`(79) の前）

```js
    { term: "adx", read: "ADX/DMI（トレンド強度）", def: "ADXはトレンドの強さ（0〜100）を測る目安で、向きは示さない。+DI/−DIは上昇・下降どちらの圧力が優勢かの目安。ADXが低い＝横ばい、高い＝一方向に動きやすい局面の目安であって、強い・弱いはそれ自体が方向を決めるものではない。" },
    { term: "atr", read: "ATR%（値幅の目安）", def: "ATR（平均的な1日の値幅）を株価で割った割合。大きいほど日々の振れが大きい＝荒い相場という目安で、銘柄をまたいで比べられる。値幅の目安であり、それ自体が行動を促すものではない。" },
```

- [ ] **Step 4: 状態ヘルパを追加**（`detail-rules.js`・signalDigest 定義(450)の前＝`_atDisplayEnd` の後あたり）

```js
  // ADX/ATR の中立状態語（signalDigest と disciplineDigest の単一源・売買語なし）
  function _adxState(adx) {
    var a = Math.round(adx);
    return a >= 25 ? "方向感が強い" : a >= 20 ? "やや方向感あり" : "弱い・レンジ気味";
  }
  function _atrVolState(pct, med) {
    if (!(med > 0)) return "通常";
    return pct >= med * 1.3 ? "振れ大きめ" : pct <= med * 0.75 ? "静穏" : "通常";
  }
  function _diDir(pDI, mDI) {
    if (pDI == null || mDI == null) return "";
    var diff = Math.abs(pDI - mDI);
    if (diff < 2) return "上下拮抗";
    return pDI > mDI ? "上向き圧力優勢" : "下向き圧力優勢";
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: グロッサリ PASS

- [ ] **Step 6: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): adx/atr glossary + neutral state helpers"
```

---

### Task 4: `signalDigest` に ADX/ATR descriptor を追加（統合）

**Files:**
- Modify: `detail-rules.js`（`signalDigest` 内・7)出来高 の後、`return out;`(563) の前に 8) ADX・9) ATR を追加）
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Consumes: `calcADX`,`calcATR`,`_adxState`,`_atrVolState`,`_diDir`,`_atDisplayEnd`（既存）。
- Produces: `signalDigest(dp, ap)` の返り配列に `{key:'adx',...}` と `{key:'atr',...}` を追加（既存 descriptor 形）。**score フィールドを持たない**。

- [ ] **Step 1: Write the failing test**

```js
test("signalDigest: adx/atr descriptor を含み score フィールドなし・中立状態", () => {
  const prices = [];
  let p = 100;
  for (let i = 0; i < 80; i++) { p += (i < 50 ? 2 : 0); prices.push({ time: "2024-" + String((i % 12) + 1).padStart(2, "0") + "-01", high: p + 1, low: p - 1, close: p, open: p, volume: 1000 }); }
  const ds = D.signalDigest(prices, prices);
  const adx = ds.find((d) => d.key === "adx"), atr = ds.find((d) => d.key === "atr");
  assert.ok(adx && atr);
  assert.equal(adx.term, "adx"); assert.equal(atr.term, "atr");
  // no-score: value/score/weight を持たない
  [adx, atr].forEach((d) => ["value", "score", "weight"].forEach((k) => assert.ok(!(k in d))));
  // 中立状態語（禁止語なし・FORBIDDEN.ALL は regex 配列）
  const text = [adx, atr].map((d) => (d.state || "") + (d.readout || "")).join(" ");
  FORBIDDEN.ALL.forEach((re) => assert.ok(!re.test(text), "禁止語: " + re));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（adx descriptor が undefined）

- [ ] **Step 3: signalDigest に 8)・9) を追加**（`return out;` の直前）

```js
    // 8) ADX/DMI（トレンド強度・向きは圧力の事実）
    (function () {
      var a = calcADX(ap, 14);
      var end = _atDisplayEnd(a, endTime);
      var state = 'データ不足', readout = '';
      if (end) {
        state = _adxState(end.adx);
        readout = 'ADX ' + Math.round(end.adx) + '（' + _diDir(end.plusDI, end.minusDI) + '）';
      }
      out.push({ key: 'adx', label: 'トレンド強度', term: 'adx', state: state, readout: readout });
    })();

    // 9) ATR%（値幅の目安・中央値比）
    (function () {
      var at = calcATR(ap, 14);
      var end = _atDisplayEnd(at, endTime);
      var win = at.filter(function (o) { return endTime && o.time <= endTime && (!dp.length || o.time >= dp[0].time); });
      var med = _median(win.map(function (o) { return o.pct; }));
      var state = 'データ不足', readout = '';
      if (end) {
        state = _atrVolState(end.pct, med);
        readout = 'ATR% ' + end.pct.toFixed(1) + '%（中央値 ' + (med || 0).toFixed(1) + '%）';
      }
      out.push({ key: 'atr', label: '値幅(ATR%)', term: 'atr', state: state, readout: readout });
    })();
```

- [ ] **Step 4: `_median` ヘルパを追加**（無ければ・`_atDisplayEnd` 付近に）

```js
  function _median(arr) {
    if (!arr || !arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: PASS（既存 signalDigest テストも緑＝descriptor 追加は後方互換）

- [ ] **Step 6: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): integrate ADX/ATR into signalDigest (no-score neutral)"
```

---

### Task 5: `disciplineDigest`（ミニ解説カード用・rules）

**Files:**
- Modify: `detail-rules.js`（signalDigest の後に追加）
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Consumes: `calcADX`,`calcATR`,`_adxState`,`_atrVolState`,`_diDir`,`_atDisplayEnd`,`_median`。
- Produces: `disciplineDigest(displayPrices, allPrices) -> {ok, adx, plusDI, minusDI, atrPct, atrMedian, trend, dir, vol, note}`（データ不足時 `{ok:false}`）。**score なし・売買語なし**。

- [ ] **Step 1: Write the failing test**

```js
test("disciplineDigest: 状態語と note を返し score なし・データ不足で ok:false", () => {
  assert.equal(D.disciplineDigest([], []).ok, false);
  const prices = [];
  let p = 100;
  for (let i = 0; i < 80; i++) { p += (i < 50 ? 2 : 0); prices.push({ time: "2024-" + String((i % 12) + 1).padStart(2, "0") + "-15", high: p + 1, low: p - 1, close: p, open: p, volume: 1 }); }
  const d = D.disciplineDigest(prices, prices);
  assert.equal(d.ok, true);
  assert.ok(["方向感が強い", "やや方向感あり", "弱い・レンジ気味"].includes(d.trend));
  assert.ok(["振れ大きめ", "通常", "静穏"].includes(d.vol));
  ["value", "score", "weight"].forEach((k) => assert.ok(!(k in d)));
  FORBIDDEN.ALL.forEach((re) => assert.ok(!re.test(d.note || ""), "禁止語: " + re));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（`D.disciplineDigest is not a function`）

- [ ] **Step 3: Write implementation**（`detail-rules.js`・signalDigest の後）

```js
  // ── 規律テクニカル現在地（ミニ解説カード用・ADX/ATR フォーカス）──
  function disciplineDigest(displayPrices, allPrices) {
    var dp = displayPrices || [];
    var ap = (allPrices && allPrices.length) ? allPrices : dp;
    var endBar = dp.length ? dp[dp.length - 1] : null;
    var endTime = endBar ? endBar.time : null;
    var a = _atDisplayEnd(calcADX(ap, 14), endTime);
    var atSeries = calcATR(ap, 14);
    var at = _atDisplayEnd(atSeries, endTime);
    if (!a || !at) return { ok: false };
    var win = atSeries.filter(function (o) { return o.time <= endTime && (!dp.length || o.time >= dp[0].time); });
    var med = _median(win.map(function (o) { return o.pct; }));
    return {
      ok: true,
      adx: a.adx, plusDI: a.plusDI, minusDI: a.minusDI,
      atrPct: at.pct, atrMedian: parseFloat((med || 0).toFixed(2)),
      trend: _adxState(a.adx), dir: _diDir(a.plusDI, a.minusDI), vol: _atrVolState(at.pct, med),
      note: "ADXが低い局面は方向感が乏しく（レンジ気味）、ATR%で日々の振れの荒さを見ます。まず全体像（この現在地）→気になる指標を下で開く、の順で読むと迷いにくいです。",
    };
  }
```

- [ ] **Step 4: Add `disciplineDigest` to exports**（`calcATR, calcADX,` の隣へ）

```js
    calcATR, calcADX, disciplineDigest,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: PASS（rules 層 全緑）

- [ ] **Step 6: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): disciplineDigest for mini-explainer card"
```

---

### Task 6: `detail-charts.js` — サブパネル汎用レジストリ＋mount/unmount＋ADX/ATR renderer

**Files:**
- Modify: `detail-charts.js`（state 43-50／toggleRSI/MACD 236-275／initSubCharts 277-329／updateSubCharts 330-347／time-sync／window 露出 1292-1300／onWindowResize 内サブチャート分岐）
- 参照移植元: `scratchpad/subpanel-mock/mock-engine.js`（`buildSubpanel` の adx/atr 分岐＝そのまま移植・ただし RSI/MACD は既存色を使う）

**Interfaces:**
- Produces（window.DetailCharts 経由 ＋ 直接 window 露出）:
  - `mountSubpanel(key, hostEl, opts)`：key∈`'rsi'|'macd'|'adx'|'atr'`。hostEl 内に createChart（rAFで clientWidth>0 待ち・冪等）。生成後 `_currentDisplay`/`_currentAll` があれば setData＋価格チャート現 range に合わせる。
  - `unmountSubpanel(key)`：remove＋内部 map から除去。
  - `isSubpanelMounted(key)`、`activeSubpanels()`（mount順配列）。
  - `refreshSubpanels(displayPrices, allPrices)`：mount 済み全 key に setData（旧 updateSubCharts の役割・レンダ path から呼ぶ）。
- Consumes: `DetailRules.calcRSI/calcMACD/calcADX/calcATR`、`priceChart`（既存 closure）。

- [ ] **Step 1: レジストリ定義を追加**（detail-charts.js・initSubCharts 付近を置換する新セクション）

`SUBPANEL_REGISTRY`（key→定義）を作る。各定義 `{ height, timeAxis, build(chart) }`。`build` は series を生成し `chart.__setData=(display,all)=>{...}` を chart に持たせる（refresh 時に呼ぶ）。**RSI/MACD の build は既存 initSubCharts のロジック・色を verbatim 移植**（RSI `#ffd84d`＋70/50/30線・MACD hist＋`#ff5ca8`＋`#3aa6ff`＋0線）。**ADX/ATR の build は mock-engine.js `buildSubpanel` の該当分岐を移植**（ADX線 `#5cf0ff`＋+DI `rgba(52,245,207,0.85)`＋−DI `rgba(255,102,153,0.85)`＋25線／ATR% 線 `#ffd84d`… ではなく ATR は **amber系だが RSI と被らないよう `#ffb03a`** に変え、中央値破線）。各 `__setData(display, all)` は `calcBase=(all?.length>50)?all:display` を計算し `inRange` で display 時間範囲にフィルタして setData。ADX/ATR も同様に filter。ATR は `.map(o=>({time:o.time,value:o.pct}))`、中央値 priceLine を display 窓の median で更新（`series.applyOptions` でなく生成時 + refresh 時に createPriceLine 貼り直し or 固定中央線を再計算）。

参考骨格（実装者は mock-engine.js を移植しつつ既存 baseOpts=278-285 を使う）:
```js
const SUBPANEL_REGISTRY = {
  rsi:  { height: 100, timeAxis: false, build: buildRSI },   // 既存 initSubCharts の RSI 部を関数化
  macd: { height: 110, timeAxis: true,  build: buildMACD },  // 既存 MACD 部を関数化
  adx:  { height: 132, timeAxis: false, build: buildADX },   // mock buildSubpanel adx 分岐
  atr:  { height: 104, timeAxis: false, build: buildATR },   // mock buildSubpanel atr 分岐（%・中央値線）
};
const _subMounted = {};   // key -> { chart, host, height }
const _subOrder = [];
let _subSyncBound = false;
```

- [ ] **Step 2: mount/unmount/refresh/timesync を実装**

```js
function mountSubpanel(key, hostEl, opts) {
  opts = opts || {};
  if (_subMounted[key]) { resizeSubpanels(); return; }
  const def = SUBPANEL_REGISTRY[key]; if (!def || !hostEl) return;
  const height = opts.height || def.height;
  let tries = 0;
  const create = () => {
    if (!hostEl.clientWidth) { if (tries++ < 30) requestAnimationFrame(create); return; }
    const chart = LightweightCharts.createChart(hostEl, {
      ...subBaseOpts, timeScale: { borderColor: "#2a3a44", visible: def.timeAxis }, height,
    });
    def.build(chart); // chart.__setData をセット
    _subMounted[key] = { chart, host: hostEl, height };
    if (_subOrder.indexOf(key) === -1) _subOrder.push(key);
    ensureSubSync();
    const data = STOCK_DATA[currentTicker];
    if (data && _currentDisplay) chart.__setData(_currentDisplay, data.prices);
    const range = priceChart && priceChart.timeScale().getVisibleLogicalRange();
    if (range) chart.timeScale().setVisibleLogicalRange(range);
  };
  requestAnimationFrame(create);
}
function unmountSubpanel(key) {
  const m = _subMounted[key]; if (!m) return;
  try { m.chart.remove(); } catch (e) {}
  delete _subMounted[key];
  const i = _subOrder.indexOf(key); if (i !== -1) _subOrder.splice(i, 1);
}
function isSubpanelMounted(key) { return !!_subMounted[key]; }
function activeSubpanels() { return _subOrder.filter((k) => _subMounted[k]); }
function refreshSubpanels(displayPrices, allPrices) {
  _currentDisplay = displayPrices;
  for (const k in _subMounted) if (_subMounted[k]) _subMounted[k].chart.__setData(displayPrices, allPrices);
}
function resizeSubpanels() {
  for (const k in _subMounted) { const m = _subMounted[k]; if (m && m.host.clientWidth > 0) m.chart.resize(m.host.clientWidth, m.height); }
}
function ensureSubSync() {
  if (_subSyncBound || !priceChart) return;
  priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range == null) return;
    for (const k in _subMounted) if (_subMounted[k]) _subMounted[k].chart.timeScale().setVisibleLogicalRange(range);
  });
  _subSyncBound = true;
}
```
（`subBaseOpts` = 既存 initSubCharts の baseOpts=278-285 を module const 化。`_currentDisplay` は closure let。旧 `rsiState/macdState/rsiChart/...` 変数と旧 toggleRSI/toggleMACD/initSubCharts/updateSubCharts は削除。）

- [ ] **Step 3: 旧レンダ path を差し替え**

`updateMaAndVolume`(411) 末尾の `updateSubCharts(displayPrices, base)`(445) を `refreshSubpanels(displayPrices, allPrices)` に変更。旧 `updateSubCharts` 定義削除。

- [ ] **Step 4: window 露出を更新**（1292-1300）

旧 `window.toggleRSI`/`window.toggleMACD` を削除し、`window.DetailCharts` に `mountSubpanel, unmountSubpanel, isSubpanelMounted, activeSubpanels, refreshSubpanels, resizeSubpanels` を追加。`onWindowResize`(既存 P4) 内の rsi/macd 個別 resize 分岐を `resizeSubpanels()` 呼び出しに置換。

- [ ] **Step 5: Node 構文チェック＋既存 unit**

Run: `NODE_PATH=/home/shugo/node_modules node -e "require('./detail-rules.js')"` （rules 側健全）
Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: PASS（detail-charts は browser-only ゆえ node 実行不可＝構文は Step 6 の実ブラウザで確認）

- [ ] **Step 6: Commit**

```bash
git add detail-charts.js
git commit -m "refactor(detail-charts): generalized subpanel registry + mount/unmount + ADX/ATR renderers"
```

---

### Task 7: `index.html`＋`detail.css` — アコーディオン markup＋mini-card（旧トグル/固定container撤去）

**Files:**
- Modify: `index.html`（1194-1207＝オシレーター群のRSI/MACDボタン＋`#rsi-container`/`#macd-container` を撤去し、アコーディオン UI へ置換）
- Modify: `detail.css`（`.sub-chart-wrap`/`#rsi-container`/`#macd-container`(515-524) を撤去し、アコーディオン/チップ/mini-card スタイル追加＝`scratchpad/subpanel-mock/shell.css` の該当クラス＋live-C.html `<style>` を detail.css の命名規約に合わせ移植）

**Interfaces:**
- Produces（DOM 契約・detail.js が参照）: `#chart-container`（既存・不変）の下に
  - `#subpanel-chips`（チップ行コンテナ）／`#subpanel-links`（すべて開く/畳む）
  - `#discipline-card`（現在地ミニ解説カード・`display:none` 初期）
  - `#subpanel-accordion`（アコーディオン項目リスト）

- [ ] **Step 1: index.html markup 置換**（1194-1207）

オシレーター群（1194-1198）と `#rsi-container`/`#macd-container`（1202-1207）を撤去し、`#chart-container`(1201) の後に:
```html
            <div id="chart-container"></div>
            <div class="subpanel-bar">
              <span class="ma-label">サブパネル</span>
              <div id="subpanel-chips" class="subpanel-chips"></div>
              <span id="subpanel-links" class="subpanel-links"></span>
            </div>
            <div id="discipline-card" class="discipline-card" style="display:none"></div>
            <div id="subpanel-accordion" class="subpanel-accordion"></div>
```
（RSI/MACD 用の `data-term` ツールチップは各アコーディオン項目ヘッダ内に detail.js が付与。MA/BB/SR/TR のオーバーレイ群 1176-1192 は不変。）

- [ ] **Step 2: detail.css 置換・追加**

`.sub-chart-wrap`/`#rsi-container`/`#macd-container`/`.sub-chart-label`(515-524) を撤去。代替として（`live-C.html` の `<style>` ＋ `shell.css` の `.digest-card/.acc-*/.glossary` を detail.css 命名で移植・テーマD トークン `--ix-*`/既存 detail.css 変数を使用）:
- `.subpanel-bar`（`.ma-control-bar` と同系のフレックス行）
- `.subpanel-chips` / チップは既存 `.ma-btn` を再利用（active=既存 `.ma-btn.active`）
- `.subpanel-links a`（すべて開く/畳む）
- `.discipline-card`（`.sig-digest-card` と同系のガラスカード・cyan縁・`.disc-chip`/`.disc-note`）
- `.acc-item`/`.acc-head`/`.acc-caret`/`.acc-desc`/`.acc-body`/`.acc-close`/`.subpanel-host`（サブパネル host は幅100%・高さは JS が inline 指定）

- [ ] **Step 3: 実ブラウザで markup 反映確認**（mock_prod_server 起動 → 詳細ビュー）

Run:
```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
```
Expected: 新 DOM（#subpanel-chips/#subpanel-accordion/#discipline-card）が存在。旧 #rsi-container 不在。pageerror 0（この時点で detail.js 未配線＝チップ空でも可）。

- [ ] **Step 4: Commit**

```bash
git add index.html detail.css
git commit -m "feat(detail-ui): accordion subpanel markup + mini-card container (remove old RSI/MACD toggles)"
```

---

### Task 8: `detail.js` — アコーディオン制御＋ミニ解説カード描画＋F2公開面

**Files:**
- Modify: `detail.js`（サブパネル制御関数群を追加・`renderSignalDigest` 付近／`window.Detail` 露出 689 更新／`injectTermHelp` は既存流用）
- 参照移植元: `scratchpad/subpanel-mock/live-C.html` の accordion 制御（addItem/removeItem/expand/collapse/toggle/soft-cap/buildChips/renderDigest）

**Interfaces:**
- Consumes: `window.DetailCharts.{mountSubpanel,unmountSubpanel,isSubpanelMounted,activeSubpanels}`、`window.DetailRules.disciplineDigest`、`window.esc`、既存 `injectTermHelp`。
- Produces（`window.Detail` に追加）: `initSubpanelUI()`（チップ生成・既定ADX/ATR展開）、`renderDisciplineCard(displayPrices, allPrices)`。inline onclick は増やさず**委譲リスナー**。

- [ ] **Step 1: サブパネル制御を実装**（live-C.html のロジックを detail.js の IIFE 内へ移植・`SUBPANELS` メタは DetailRules から引かず detail.js 内 const で定義）

```js
  var SUBPANEL_META = [
    { key: "rsi",  label: "RSI",     sub: "(14)",       term: "rsi",  desc: "買われすぎ/売られすぎの目安。70超で過熱・30割れで冷え込み。" },
    { key: "macd", label: "MACD",    sub: "(12,26,9)",  term: "macd", desc: "短期と長期の移動平均の差。勢いの向きと転換の傾向。" },
    { key: "adx",  label: "ADX/DMI", sub: "(14)",       term: "adx",  desc: "トレンドの強さ（向きは示さない）。25超で方向感、20未満はレンジ気味。" },
    { key: "atr",  label: "ATR%",    sub: "(14)",       term: "atr",  desc: "1日の値幅の目安（株価に対する%）。値幅そのものは行動を促すものではない。" },
  ];
  var _accItems = {}; // key -> {wrap, host, expanded}
  var SOFT_CAP = 2;
```
そして live-C.html の `addItem/removeItem/expand/collapse/toggle/countExpanded/buildChips` を移植。差分:
- `MockEngine.mount/unmount` → `window.DetailCharts.mountSubpanel/unmountSubpanel`。
- host 生成後 `injectTermHelp(wrap)` を呼び用語?を有効化。
- ヘッダの `data-term` は `SUBPANEL_META.term`。
- チップは既存 `.ma-btn` クラス（active トグル）。
- expand 時 `mountSubpanel(key, host, {height})`／collapse・×時 `unmountSubpanel(key)`＋host 非表示。
- トースト無しでも可（`.subpanel-links` 横に控えめ text hint でよい）。

- [ ] **Step 2: ミニ解説カード描画**

```js
  function renderDisciplineCard(displayPrices, allPrices) {
    var card = document.getElementById("discipline-card");
    if (!card) return;
    var d = window.DetailRules && window.DetailRules.disciplineDigest(displayPrices, allPrices);
    if (!d || !d.ok) { card.style.display = "none"; return; }
    var trendCls = d.trend === "方向感が強い" ? "warm" : d.trend.indexOf("レンジ") >= 0 ? "calm" : "";
    var volCls = d.vol === "振れ大きめ" ? "hot" : d.vol === "静穏" ? "calm" : "";
    card.style.display = "";
    card.innerHTML =
      '<div class="disc-title">規律テクニカル 現在地</div>' +
      '<div class="disc-chip"><span class="k">トレンド強度</span><span class="v ' + trendCls + '" data-term="adx">' + window.esc(d.trend) + '（ADX ' + Math.round(d.adx) + '・' + window.esc(d.dir) + '）</span></div>' +
      '<div class="disc-chip"><span class="k">値幅</span><span class="v ' + volCls + '" data-term="atr">' + window.esc(d.vol) + '（ATR% ' + d.atrPct.toFixed(1) + '%）</span></div>' +
      '<div class="disc-note">' + window.esc(d.note) + '</div>';
    injectTermHelp(card);
  }
```

- [ ] **Step 3: 露出更新**（`window.Detail` 689 に追加）

```js
  window.Detail = { navigateToDetail, updateFinancialViews, switchYear, termHelp, injectTermHelp, renderSignalDigest, renderRelativePosition, renderInsightCard, fetchInsight, probeInsightCap, initSubpanelUI, renderDisciplineCard };
```
（`initSubpanelUI`＝チップ生成＋委譲リスナー結線＋「すべて開く/畳む」＋既定 adx/atr 展開。navigateToDetail 内で1回呼ぶ＝Task9。）

- [ ] **Step 4: Node 構文チェック**

Run: `NODE_PATH=/home/shugo/node_modules node --check detail.js`
Expected: PASS（構文のみ・DOM は Task9 の実ブラウザ）

- [ ] **Step 5: Commit**

```bash
git add detail.js
git commit -m "feat(detail): accordion subpanel controller + discipline mini-card (delegated listeners, F2 surface)"
```

---

### Task 9: 統合配線＋検証（navigate/switchYear 経路・snapshot 再ベースライン）

**Files:**
- Modify: `detail.js`（`navigateToDetail` に `initSubpanelUI()`＋`renderDisciplineCard(...)`、`updateFinancialViews`/`switchYear` の再描画で `renderDisciplineCard` を再呼、`DetailCharts.refreshSubpanels` は既存レンダ path から Task6 で接続済）
- Modify: `scratchpad/detail-baseline.json`（サブパネル領域変更ぶんの再ベースライン）

- [ ] **Step 1: navigate/switchYear 配線**

`navigateToDetail`（詳細表示の初期化箇所）で、価格チャート描画後に `initSubpanelUI()`（初回のみ・冪等ガード）と `renderDisciplineCard(displayPrices, data.prices)` を呼ぶ。`updateFinancialViews`/`switchYear` の年切替後にも `renderDisciplineCard` を再呼（signalDigest カード再描画と同じ場所）。既定展開の ADX/ATR は `initSubpanelUI` が mount。

- [ ] **Step 2: 実ブラウザ機能検証（反復操作）**

mock_prod_server 起動 → 詳細ビュー（equity 銘柄＋ETF）で:
- チップ RSI/MACD/ADX/ATR の複数選択→アコーディオン積み上げ・**展開2枠ソフト上限**（3つ目は畳んで追加）
- ヘッダ開閉の**反復**（2回目・別サブパネル後の再クリック）で 0x0 非再発（canvas 幅>0）
- 時間軸連動（メインをスクロール→サブ追従）
- ミニ解説カード（ADX/ATR 状態＋note＋用語?）
- ETF（financials 欠損でも価格・サブパネルは通常描画）
- 幅 1920/1024/768 で崩れ無し・pageerror 0

Run:
```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: 価格チャート・財務・compare 等の非サブパネル領域は `✅MATCH`。サブパネル領域は差分（意図的）→ 内容確認後に `capture` で再ベースライン。

- [ ] **Step 3: 再ベースライン＋全 unit**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js
NODE_PATH=/home/shugo/node_modules node --test tests/finance-rules.test.js tests/money-rules.test.js
```
Expected: 全緑。

- [ ] **Step 4: Commit**

```bash
git add detail.js scratchpad/detail-baseline.json
git commit -m "feat(detail): wire subpanel UI + discipline card into navigate/switchYear; rebaseline snapshot"
```

---

## 実装後（この plan の外）
- **敵対検証 wf**（whole-branch・観点＝無言故障[window公開漏れ]／0x0再発／規制文言[売買・損切り語]／digest数値スコア化／表示丸めと分類の一致／ETF経路／時間軸連動）。
- **本人実機サニティ**（GPU/canvas 実描画・FHD・開閉/連動の体感）→ OK後に branch-first で feature ブランチ化 → main merge → push（本番デプロイ）。
- **backlog 明記**（spec §2 Out）：Keltner Channel／OBV・VWAP／ZigZag レンジ検出改善（別件）。

## Self-Review（この plan の点検結果）
- **Spec coverage**：spec §5(rules)=Task1-5／§6(charts)=Task6／§7(UI)=Task7-8／§9-11(配線・検証)=Task9。§3 規制フレームは Global Constraints＋各 no-score テストで担保。§12 モック参照は Task6/8 の移植元指定で反映。**漏れなし**。
- **Placeholder**：各コード step は実コードを掲載。UI（Task6-8）は移植元（mock-engine.js/live-C.html の関数名）を明示＝「TODO」なし。
- **Type consistency**：`calcATR→{time,value,pct}`／`calcADX→{time,adx,plusDI,minusDI}`／`disciplineDigest→{ok,adx,...,trend,dir,vol,note}`／`mountSubpanel(key,hostEl,opts)`/`refreshSubpanels(display,all)` を全 Task で一貫使用。RSI/MACD 既存色は Global Constraints で固定。
