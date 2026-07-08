# Keltner / OBV / VWAP テクニカル指標追加 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** detail-view のチャートに Keltner Channel（価格オーバーレイ）・OBV（新サブパネル）・VWAP（期間アンカー価格オーバーレイ）を、既存の 4 タッチポイント・パターンで追加する。

**Architecture:** 純計算は `detail-rules.js` の DOM 非依存純関数（`calcKeltner`/`calcOBV`/`calcVWAP`）として追加し `node --test` で錠。描画は `detail-charts.js` の IIFE closure（オーバーレイ 2 本＋新サブパネル 1 個）。UI は `detail.js` の SUBPANEL_META と `index.html` のトグルボタン。中立読み取りは `signalDigest` に 3 行追加。スクリーナー非統合・Python ミラー無し。

**Tech Stack:** Vanilla JS（classic script / UMD-lite）、LightweightCharts v4.2.3、node:test、Vercel 静的配信。

## Global Constraints

- 規制安全（ハード）：`INDICATOR_GLOSSARY` の `def`/`read` と `signalDigest` の `label`/`state`/`readout`/`note` は `tests/fixtures/forbidden_terms.js` の `TRADE`/`FORECAST` 正規表現に非命中であること（売買・タイミング・相場予測語なし）。descriptor に数値スコア（`value`/`score`/`weight`）を持たせない。
- `signalDigest` の `state` は閉集合。新 state 語は必ず `tests/detail-rules.test.js` の `STATE_ENUM` に追加する（テストが全 state の enum 所属を assert）。
- 純関数は必ず `detail-rules.js` 末尾の `return {…}` export（`:818-831`）に追加する（未 export＝`D.calcX` undefined でテスト・実行時に無言故障）。`detail-charts.js` で使う純関数は `:25-27` の `DR` destructure にも追加する。
- inline onclick が呼ぶ関数は `detail-charts.js:1333-1336` で `window.*` に露出する（露出漏れ＝クリック無言 no-op）。
- 唯一の技術制約＝0x0罠（`display:none → createChart` が 0x0 固定）。新サブパネルは既存 `mountSubpanel`（`:341` の clientWidth>0 rAF ガード）に乗るため追加のプランは不要。オーバーレイは既に寸法確定済の priceChart 上なので 0x0罠の対象外。
- 色：新オーバーレイは既存の price overlay（MA pink `#ff5ca8`/blue `#3aa6ff`/purple `#a35cff`・BB cyan `rgba(92,240,255)`・candle 赤青・ZigZag teal/pink）と非衝突。Keltner=amber/orange、VWAP=gold。色は改善対象＝実機 FB で微調整可。
- 価格オブジェクト＝`{time:"YYYY-MM-DD", open, high, low, close, volume}`（日足・native 通貨・`volume` は常に int で 0 あり得る）。
- `SUBPANEL_META`（detail.js）の `height` は `SUBPANEL_REGISTRY`（detail-charts.js）の `height` と同値にする（意図的二重管理）。OBV は既定オープンに入れない（SOFT_CAP=2）。
- テスト実行：`NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`（worktree ルートで）。

---

## Task 1: calcKeltner 純関数 ＋ export ＋ テスト

**Files:**
- Modify: `detail-rules.js`（`calcADX` の直後 `:269` 付近に関数追加／export `:820` に追記）
- Test: `tests/detail-rules.test.js`（`calcADX` テスト群 `:647` の直後に追加）

**Interfaces:**
- Consumes: 既存 `calcEMA(closes, period)`（全長 null 埋め配列を返す）、`calcATR(prices, period)`（`[{time,value,pct}]` を index `period` から返す）
- Produces: `calcKeltner(prices, emaPeriod=20, atrMult=2, atrPeriod=14) -> { upper:[{time,value}], mid:[{time,value}], lower:[{time,value}] }`（BB と同形）

- [ ] **Step 1: 失敗するテストを書く** — `tests/detail-rules.test.js` の `calcADX` フラット価格テスト（`:647`）の直後に追加：

```js
// ── calcKeltner: EMA中心 ± mult×ATR チャネル ──
test("calcKeltner: 長さ不足は空の{upper,mid,lower}", () => {
  assert.deepEqual(D.calcKeltner([{ time: "d0", high: 1, low: 1, close: 1 }]), { upper: [], mid: [], lower: [] });
});
test("calcKeltner: ATR=0（定数価格）なら upper=mid=lower=価格", () => {
  const prices = [];
  for (let i = 0; i < 40; i++) prices.push({ time: "d" + i, high: 100, low: 100, close: 100, volume: 1000 });
  const r = D.calcKeltner(prices, 20, 2, 14);
  assert.ok(r.mid.length > 0);
  const lm = r.mid[r.mid.length - 1], lu = r.upper[r.upper.length - 1], ll = r.lower[r.lower.length - 1];
  assert.equal(lm.value, 100);
  assert.equal(lu.value, 100);
  assert.equal(ll.value, 100);
});
test("calcKeltner: バンド幅 = 2×ATR（既知値）", () => {
  // high=110 low=90 close=100 一定 → TR=20 → ATR=20 → band=2×20=40, mid=EMA(100)=100
  const prices = [];
  for (let i = 0; i < 40; i++) prices.push({ time: "d" + i, high: 110, low: 90, close: 100, volume: 1000 });
  const r = D.calcKeltner(prices, 20, 2, 14);
  const lm = r.mid[r.mid.length - 1], lu = r.upper[r.upper.length - 1], ll = r.lower[r.lower.length - 1];
  assert.equal(lm.value, 100);
  assert.equal(lu.value, 140);
  assert.equal(ll.value, 60);
  // time 整列: 3系列の末尾は同一 time
  assert.equal(lu.time, lm.time);
  assert.equal(ll.time, lm.time);
});
test("calcKeltner: フラット価格で NaN/Inf を出さない", () => {
  const prices = [];
  for (let i = 0; i < 40; i++) prices.push({ time: "d" + i, high: 50, low: 50, close: 50, volume: 0 });
  const r = D.calcKeltner(prices, 20, 2, 14);
  [...r.upper, ...r.mid, ...r.lower].forEach((o) => assert.ok(Number.isFinite(o.value)));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（`D.calcKeltner is not a function`）

- [ ] **Step 3: 純関数を実装** — `detail-rules.js` の `calcADX` 関数の閉じ `}`（`:269`）の直後に追加：

```js
  // ── ケルトナーチャネル：EMA(emaPeriod) を中心に ± atrMult×ATR(atrPeriod) のバンド ──
  //  mid=EMA(close)（全長 null 埋め）と ATR（index atrPeriod 起点の短い配列）を **time で整列** する。
  function calcKeltner(prices, emaPeriod = 20, atrMult = 2, atrPeriod = 14) {
    const upper = [], mid = [], lower = [];
    if (!prices || prices.length < Math.max(emaPeriod, atrPeriod + 1)) return { upper, mid, lower };
    const closes = prices.map(p => p.close);
    const ema = calcEMA(closes, emaPeriod);            // 全長・period-1 まで null
    const atr = calcATR(prices, atrPeriod);            // [{time,value,pct}]・index atrPeriod 起点
    const atrByTime = new Map(atr.map(o => [o.time, o.value]));
    for (let i = 0; i < prices.length; i++) {
      const t = prices[i].time, m = ema[i], a = atrByTime.get(t);
      if (m == null || a == null) continue;            // EMA・ATR 双方が揃うバーのみ出力
      const band = atrMult * a;
      mid.push({ time: t, value: parseFloat(m.toFixed(2)) });
      upper.push({ time: t, value: parseFloat((m + band).toFixed(2)) });
      lower.push({ time: t, value: parseFloat((m - band).toFixed(2)) });
    }
    return { upper, mid, lower };
  }
```

- [ ] **Step 4: export に追記** — `detail-rules.js:820`「テクニカル純関数」行の `calcATR, calcADX, disciplineDigest,` を次に置換：

```js
    calcATR, calcADX, calcKeltner, disciplineDigest,
```

- [ ] **Step 5: テストが通ることを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: PASS（calcKeltner 4 件緑・既存も緑）

- [ ] **Step 6: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): add calcKeltner pure fn + tests"
```

---

## Task 2: calcOBV 純関数 ＋ export ＋ テスト

**Files:**
- Modify: `detail-rules.js`（`calcKeltner` の直後に追加／export `:820`）
- Test: `tests/detail-rules.test.js`（Task1 テストの直後）

**Interfaces:**
- Produces: `calcOBV(prices) -> [{time, value}]`（value=累計整数。終値 up=+volume/down=−volume/eq=±0。`prices.length<2` は `[]`）

- [ ] **Step 1: 失敗するテストを書く** — Task1 の calcKeltner テスト直後に追加：

```js
// ── calcOBV: On-Balance Volume（累計） ──
test("calcOBV: 長さ不足は空配列", () => {
  assert.deepEqual(D.calcOBV([{ time: "d0", close: 1, volume: 100 }]), []);
});
test("calcOBV: up=+vol / down=−vol / eq=±0 の累計", () => {
  const prices = [
    { time: "d0", close: 10, volume: 100 },
    { time: "d1", close: 11, volume: 50 },  // up  → +50 → 50
    { time: "d2", close: 10, volume: 40 },  // down → −40 → 10
    { time: "d3", close: 10, volume: 30 },  // eq  → ±0 → 10
    { time: "d4", close: 12, volume: 20 },  // up  → +20 → 30
  ];
  const r = D.calcOBV(prices);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((o) => o.value), [50, 10, 10, 30]);
  assert.equal(r[3].time, "d4");
});
test("calcOBV: 全バー出来高0でも NaN を出さず 0 累計", () => {
  const prices = [
    { time: "d0", close: 10, volume: 0 },
    { time: "d1", close: 11, volume: 0 },
    { time: "d2", close: 9, volume: 0 },
  ];
  const r = D.calcOBV(prices);
  r.forEach((o) => assert.ok(Number.isFinite(o.value)));
  assert.equal(r[r.length - 1].value, 0);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（`D.calcOBV is not a function`）

- [ ] **Step 3: 純関数を実装** — `detail-rules.js` の `calcKeltner` 直後に追加：

```js
  // ── OBV（On-Balance Volume）：終値方向で出来高を加減した累計線。絶対値は任意・傾きを見る ──
  function calcOBV(prices) {
    const out = [];
    if (!prices || prices.length < 2) return out;
    let obv = 0;
    for (let i = 1; i < prices.length; i++) {
      const c = prices[i].close, pc = prices[i - 1].close;
      if (c > pc) obv += (prices[i].volume || 0);
      else if (c < pc) obv -= (prices[i].volume || 0);
      // c === pc: 変化なし
      out.push({ time: prices[i].time, value: obv });
    }
    return out;
  }
```

- [ ] **Step 4: export に追記** — `detail-rules.js:820` を次に置換：

```js
    calcATR, calcADX, calcKeltner, calcOBV, disciplineDigest,
```

- [ ] **Step 5: テストが通ることを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): add calcOBV pure fn + tests"
```

---

## Task 3: calcVWAP 純関数 ＋ export ＋ テスト

**Files:**
- Modify: `detail-rules.js`（`calcOBV` の直後／export `:820`）
- Test: `tests/detail-rules.test.js`（Task2 テストの直後）

**Interfaces:**
- Produces: `calcVWAP(prices) -> [{time, value}]`（typical=(H+L+C)/3。prices[0] 起点の累積 Σ(tp×vol)/Σvol。cumV=0 のバーは push しない＝総出来高 0 は `[]`）

- [ ] **Step 1: 失敗するテストを書く** — Task2 の calcOBV テスト直後に追加：

```js
// ── calcVWAP: 期間アンカー（prices[0]起点）出来高加重平均 ──
test("calcVWAP: 空・総出来高0は空配列", () => {
  assert.deepEqual(D.calcVWAP([]), []);
  const zv = [
    { time: "d0", high: 1, low: 1, close: 1, volume: 0 },
    { time: "d1", high: 1, low: 1, close: 1, volume: 0 },
  ];
  assert.deepEqual(D.calcVWAP(zv), []);
});
test("calcVWAP: Σ(typical×vol)/Σvol の累積（既知値）", () => {
  const prices = [
    { time: "d0", high: 12, low: 8, close: 10, volume: 100 },  // tp=10 → cum=1000/100=10
    { time: "d1", high: 24, low: 16, close: 20, volume: 100 }, // tp=20 → cum=3000/200=15
  ];
  const r = D.calcVWAP(prices);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((o) => o.value), [10, 15]);
});
test("calcVWAP: 先頭の出来高0バーはスキップし出来高が付くバーから開始", () => {
  const prices = [
    { time: "d0", high: 10, low: 10, close: 10, volume: 0 },   // cumV=0 skip
    { time: "d1", high: 20, low: 20, close: 20, volume: 100 }, // tp=20 → 20
  ];
  const r = D.calcVWAP(prices);
  assert.equal(r.length, 1);
  assert.equal(r[0].time, "d1");
  assert.equal(r[0].value, 20);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（`D.calcVWAP is not a function`）

- [ ] **Step 3: 純関数を実装** — `detail-rules.js` の `calcOBV` 直後に追加：

```js
  // ── VWAP（期間アンカー）：prices[0] を起点に typical=(H+L+C)/3 の出来高加重平均を累積 ──
  //  日足のためセッション VWAP 不可。呼び出し側は「表示ウィンドウ」を prices として渡す（起点=期間先頭）。
  function calcVWAP(prices) {
    const out = [];
    if (!prices || !prices.length) return out;
    let cumPV = 0, cumV = 0;
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      const tp = (p.high + p.low + p.close) / 3;
      const v = p.volume || 0;
      cumPV += tp * v;
      cumV += v;
      if (cumV > 0) out.push({ time: p.time, value: parseFloat((cumPV / cumV).toFixed(2)) });
    }
    return out;
  }
```

- [ ] **Step 4: export に追記** — `detail-rules.js:820` を次に置換：

```js
    calcATR, calcADX, calcKeltner, calcOBV, calcVWAP, disciplineDigest,
```

- [ ] **Step 5: テストが通ることを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): add calcVWAP (period-anchored) pure fn + tests"
```

---

## Task 4: glossary 3 語追加（keltner/obv/vwap）＋ required-terms テスト更新

**Files:**
- Modify: `detail-rules.js`（`INDICATOR_GLOSSARY` `:80` の `atr` エントリ直後）
- Test: `tests/detail-rules.test.js:301-302`（required リスト）

**Interfaces:**
- Produces: `INDICATOR_GLOSSARY` に `{term:'keltner'|'obv'|'vwap', read, def}` 3 件（中立・「よくある誤解」含意・売買/予測語なし）

- [ ] **Step 1: 失敗するテストを書く** — `tests/detail-rules.test.js:301-302` の required 配列に 3 語追加：

```js
  const required = ["ma", "bb", "rsi", "macd", "sr", "zigzag", "volume", "percent-b",
    "keltner", "obv", "vwap",
    "equity-ratio", "current-ratio", "roe", "roa", "op-margin", "net-margin", "per", "pbr"];
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（`missing term: keltner`）

- [ ] **Step 3: glossary エントリを追加** — `detail-rules.js` の `{ term: "atr", … }` 行（`:80`）の直後、`]`（`:81`）の前に追加：

```js
    { term: "keltner", read: "ケルトナーチャネル", def: "移動平均（EMA）を中心に、値幅（ATR）の一定倍を上下に加えたバンド。価格が上限・下限の外側か内側かは位置の事実であり、外側であること自体が方向を決めるものではない。" },
    { term: "obv", read: "OBV（オンバランスボリューム）", def: "終値が前日より上がった日は出来高を足し、下がった日は引いて積み上げた累計線。傾きや価格との食い違い（ダイバージェンス）を見る目安で、絶対値の大きさ自体には意味がなく、線の向きだけで方向が決まるものではない。" },
    { term: "vwap", read: "VWAP（出来高加重平均）", def: "表示している期間の出来高で重みづけした平均価格。終値がその上か下かは位置の事実であり、水準だけで方向が決まるものではない。" },
```

- [ ] **Step 4: テストが通ることを確認**（required-terms ＋ forbidden-words 両方）

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: PASS（`INDICATOR_GLOSSARY: shape and required terms` / `def/read contain no trade/forecast words` 緑）

- [ ] **Step 5: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): add keltner/obv/vwap glossary terms (neutral)"
```

---

## Task 5: signalDigest に 3 行追加 ＋ STATE_ENUM/length テスト更新

**Files:**
- Modify: `detail-rules.js`（`signalDigest` の block 9=ATR `:671` の直後、`return out;` `:673` の前）
- Test: `tests/detail-rules.test.js`（`STATE_ENUM` `:334-344` と length assert `:360-361`）

**Interfaces:**
- Consumes: `calcKeltner`/`calcOBV`/`calcVWAP`（Task1-3）、`_atDisplayEnd`
- Produces: `signalDigest` が 12 件返す（keltner/vwap/obv の中立 descriptor 追加）

- [ ] **Step 1: 失敗するテストを書く** — `STATE_ENUM`（`:344` の `'振れ大きめ', '通常', '静穏',` 直後、`]);` の前）に追加：

```js
  // Task(keltner/obv/vwap descriptor)の中立状態語
  '上限チャネルの外側', 'チャネル内側', '下限チャネルの外側',
  '終値がVWAPの上', 'VWAP近辺', '終値がVWAPの下',
  '直近20日で上向き', 'ほぼ横ばい', '直近20日で低下',
```

そして length assert（`:360-361`）を次に置換：

```js
  // Task4(adx/atr)で 7→9、本Task(keltner/vwap/obv)で 9→12。
  assert.equal(ds.length, 12);
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（`signalDigest: 9 descriptors…` で `ds.length` が 9≠12）

- [ ] **Step 3: signalDigest に 3 ブロックを追加** — `detail-rules.js` の block 9（ATR）の IIFE 閉じ `})();`（`:671`）の直後、`return out;`（`:673`）の前に追加：

```js
    // 10) ケルトナーチャネル（終値のチャネル内外・純事実）
    (function () {
      var kc = calcKeltner(ap);
      var u = _atDisplayEnd(kc && kc.upper, endTime);
      var m = _atDisplayEnd(kc && kc.mid, endTime);
      var l = _atDisplayEnd(kc && kc.lower, endTime);
      var state = 'データ不足', readout = '';
      if (u && m && l && close != null) {
        state = close > u.value ? '上限チャネルの外側' : close < l.value ? '下限チャネルの外側' : 'チャネル内側';
        readout = '中心線比 ' + (close >= m.value ? '+' : '') + ((close / m.value - 1) * 100).toFixed(1) + '%';
      }
      out.push({ key: 'keltner', label: 'ケルトナー', term: 'keltner', state: state, readout: readout });
    })();

    // 11) VWAP（表示期間の出来高加重平均・終値の上下）
    (function () {
      var vw = calcVWAP(dp);   // 期間アンカー＝表示ウィンドウ dp（signalDigest の他ブロックと異なり ap でなく dp）
      var end = vw.length ? vw[vw.length - 1] : null;
      var state = 'データ不足', readout = '';
      if (end && close != null && end.value > 0) {
        var dev = (close / end.value - 1) * 100;
        state = Math.abs(dev) <= 0.3 ? 'VWAP近辺' : (dev > 0 ? '終値がVWAPの上' : '終値がVWAPの下');
        readout = '乖離 ' + (dev >= 0 ? '+' : '') + dev.toFixed(1) + '%';
      }
      out.push({ key: 'vwap', label: 'VWAP', term: 'vwap', state: state, readout: readout });
    })();

    // 12) OBV（累計出来高線の傾き・純事実。純変化/総出来高で正規化＝絶対値は任意）
    (function () {
      var obv = calcOBV(ap);
      var end = _atDisplayEnd(obv, endTime);
      var state = 'データ不足', readout = '';
      if (end && dp.length >= 21) {
        var back = _atDisplayEnd(obv, dp[dp.length - 21].time);
        if (back) {
          var d = end.value - back.value;
          var gross = 0;
          for (var i = dp.length - 20; i < dp.length; i++) gross += (dp[i].volume || 0);
          var ratio = gross > 0 ? d / gross : 0;
          state = Math.abs(ratio) < 0.2 ? 'ほぼ横ばい' : (ratio > 0 ? '直近20日で上向き' : '直近20日で低下');
        }
      }
      out.push({ key: 'obv', label: 'OBV', term: 'obv', state: state, readout: readout });
    })();
```

- [ ] **Step 4: テストが通ることを確認**（length 12・全 state が enum・forbidden 非命中）

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: PASS（`signalDigest: 12 descriptors…` / `…no trade/forecast words` / `…indexed to display window end` 緑）

- [ ] **Step 5: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail-rules): add keltner/vwap/obv neutral signalDigest rows"
```

---

## Task 6: detail-charts.js 価格オーバーレイ（Keltner ＋ VWAP）

**Files:**
- Modify: `detail-charts.js`（destructure `:25-27`／private lets `:39-40` 付近／`toggleBB` 直後 `:204`／`updateMaAndVolume` `:479` 付近／`initPriceChart` `:594` 付近／window 露出 `:1336`）

**Interfaces:**
- Consumes: `DR.calcKeltner`/`DR.calcVWAP`（Task1,3）
- Produces: `window.toggleKeltner()` / `window.toggleVWAP()`（inline onclick 用）／priceChart 上のオーバーレイ

- [ ] **Step 1: DR destructure に追加** — `detail-charts.js:27` の行末を置換：

```js
        calcZigZag = DR.calcZigZag, autoZigZagDeviation = DR.autoZigZagDeviation,
        calcKeltner = DR.calcKeltner, calcVWAP = DR.calcVWAP;
```

（元の `:27` 末尾は `autoZigZagDeviation = DR.autoZigZagDeviation;` なので `;` を `,` に変えて 2 つ追記）

- [ ] **Step 2: private series/state を宣言** — `detail-charts.js:40` の `let bbState = false;` の直後に追加：

```js
      let kcUpperSeries = null, kcMidSeries = null, kcLowerSeries = null;
      let kcState = false;
      let vwapSeries = null;
      let vwapState = false;
```

- [ ] **Step 3: トグル関数を追加** — `detail-charts.js:204` の `toggleBB` 閉じ `}` の直後に追加（`toggleBB` を複製）：

```js
      function toggleKeltner() {
        kcState = !kcState;
        document.getElementById("ind-btn-keltner").classList.toggle("active", kcState);
        [kcUpperSeries, kcMidSeries, kcLowerSeries].forEach(s => s?.applyOptions({ visible: kcState }));
      }
      function toggleVWAP() {
        vwapState = !vwapState;
        document.getElementById("ind-btn-vwap").classList.toggle("active", vwapState);
        vwapSeries?.applyOptions({ visible: vwapState });
      }
```

- [ ] **Step 4: series を initPriceChart で作成** — `detail-charts.js:594` の `bbLowerSeries = priceChart.addLineSeries({…});` ブロック閉じの直後（`:594` の `});` の後、`}`（`:595`）の前）に追加：

```js
        // ── ケルトナーチャネル シリーズ（amber/orange・初期非表示。BB=cyan / ma75=purple と非衝突） ──
        kcUpperSeries = priceChart.addLineSeries({
          color: "rgba(255,163,64,0.5)", lineWidth: 1, lineStyle: 2, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        kcMidSeries = priceChart.addLineSeries({
          color: "rgba(255,163,64,0.85)", lineWidth: 1, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        kcLowerSeries = priceChart.addLineSeries({
          color: "rgba(255,163,64,0.5)", lineWidth: 1, lineStyle: 2, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        // ── VWAP シリーズ（gold・単線太め・初期非表示） ──
        vwapSeries = priceChart.addLineSeries({
          color: "#ffd84d", lineWidth: 2, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
```

- [ ] **Step 5: updateMaAndVolume に setData を追加** — `detail-charts.js:479` の BB ブロック（`bbLowerSeries?.setData(bb.lower.filter(f));`）の直後に追加：

```js
        // ── ケルトナーチャネル（BB と同じ全履歴算出→window filter） ──
        const kcBase = base.length >= 20 ? base : displayPrices;
        const kc = calcKeltner(kcBase);
        kcUpperSeries?.setData(kc.upper.filter(f));
        kcMidSeries?.setData(kc.mid.filter(f));
        kcLowerSeries?.setData(kc.lower.filter(f));

        // ── VWAP（期間アンカー＝表示ウィンドウ先頭起点。全履歴算出→filter ではなく displayPrices 直接） ──
        vwapSeries?.setData(calcVWAP(displayPrices));
```

- [ ] **Step 6: window に露出** — `detail-charts.js:1336` の `window.toggleTR = toggleTR;` の直後に追加：

```js
  window.toggleKeltner = toggleKeltner;
  window.toggleVWAP = toggleVWAP;
```

- [ ] **Step 7: 構文健全性を確認**（detail-charts.js は unit 対象外＝構文チェック＋既存テスト非破壊）

Run: `node --check detail-charts.js && NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: detail-charts.js 構文 OK・detail-rules テスト全緑（描画確認は Task 9 の実ブラウザ）

- [ ] **Step 8: コミット**

```bash
git add detail-charts.js
git commit -m "feat(detail-charts): Keltner + VWAP price overlays (toggle + window export)"
```

---

## Task 7: detail-charts.js OBV サブパネル

**Files:**
- Modify: `detail-charts.js`（`buildATR` `:329` の直後に `buildOBV`／`SUBPANEL_REGISTRY` `:330-335`）

**Interfaces:**
- Consumes: `DR.calcOBV`（Task2・DR destructure に要追加）
- Produces: `SUBPANEL_REGISTRY.obv = {height:104, timeAxis:false, build:buildOBV}`（`refreshSubpanels`/`mountSubpanel`/`ensureSubSync`/`resizeSubpanels` が自動配線）

- [ ] **Step 1: DR destructure に calcOBV を追加** — Task6 Step1 で作った `:27` の行を再置換（calcOBV を追記）：

```js
        calcZigZag = DR.calcZigZag, autoZigZagDeviation = DR.autoZigZagDeviation,
        calcKeltner = DR.calcKeltner, calcVWAP = DR.calcVWAP, calcOBV = DR.calcOBV;
```

- [ ] **Step 2: buildOBV を追加** — `detail-charts.js:329` の `buildATR` 閉じ `}` の直後、`const SUBPANEL_REGISTRY`（`:330`）の前に追加（`buildRSI` を雛形に・単線・0 基準線）：

```js
      // OBV（累計出来高線・自動スケール／buildRSI 雛形。0基準の破線を1本＝符号の目安）
      function buildOBV(chart) {
        const series = chart.addLineSeries({
          color: "#5cf0ff", lineWidth: 1.8,
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
        });
        series.createPriceLine({ price: 0, color: "rgba(148,163,184,0.25)", lineWidth: 1, lineStyle: 3 });
        chart.__setData = (display, all) => {
          if (!display?.length || !calcOBV) return;
          const startTime = display[0].time, endTime = display[display.length - 1].time;
          const calcBase = (all?.length > 50) ? all : display;   // 全履歴で累積し窓に filter（窓内は連続）
          const inRange = (d) => d.time >= startTime && d.time <= endTime;
          series.setData(calcOBV(calcBase).filter(inRange));
        };
      }
```

- [ ] **Step 3: SUBPANEL_REGISTRY に登録** — `detail-charts.js:334` の `atr:  { height: 104, timeAxis: false, build: buildATR },` の直後に追加：

```js
        obv:  { height: 104, timeAxis: false, build: buildOBV },
```

- [ ] **Step 4: 構文健全性を確認**

Run: `node --check detail-charts.js`
Expected: OK

- [ ] **Step 5: コミット**

```bash
git add detail-charts.js
git commit -m "feat(detail-charts): OBV subpanel (buildOBV + registry)"
```

---

## Task 8: UI 配線（index.html トグルボタン ＋ detail.js SUBPANEL_META）

**Files:**
- Modify: `index.html`（エンベロープ群 `:1184-1186` に Keltner／分析群 `:1188-1192` に VWAP）
- Modify: `detail.js`（`SUBPANEL_META` `:292-293` に obv 行）

**Interfaces:**
- Consumes: `window.toggleKeltner`/`window.toggleVWAP`（Task6）、`SUBPANEL_REGISTRY.obv`（Task7）
- Produces: ユーザー操作可能な 3 指標（Keltner/VWAP ボタン・OBV チップ）

- [ ] **Step 1: Keltner ボタンを追加** — `index.html:1185` の `<button class="ma-btn" id="ind-btn-bb" onclick="toggleBB()">BB 20</button>` の直後（同じ「エンベロープ」ctrl-group 内）に追加：

```html
                <button class="ma-btn" id="ind-btn-keltner" onclick="toggleKeltner()">KC 20</button><span class="ma-label" data-term="keltner"></span>
```

- [ ] **Step 2: VWAP ボタンを追加** — `index.html:1191` の `<button class="ma-btn" id="ind-btn-tr" onclick="toggleTR()">T/R線</button><span class="ma-label" data-term="zigzag"></span>` の直後（同じ「分析」ctrl-group 内）に追加：

```html
                <button class="ma-btn" id="ind-btn-vwap" onclick="toggleVWAP()">VWAP</button><span class="ma-label" data-term="vwap"></span>
```

- [ ] **Step 3: SUBPANEL_META に obv 行を追加** — `detail.js:292` の `{ key: "atr", … },` 行の直後に追加（height=104 は registry と一致）：

```js
    { key: "obv",  label: "OBV",     sub: "",           term: "obv",  height: 104, desc: "終値方向×出来高の累計線。傾き・価格との食い違いを見る目安。" },
```

- [ ] **Step 4: 構文健全性を確認**

Run: `node --check detail.js`
Expected: OK

- [ ] **Step 5: コミット**

```bash
git add index.html detail.js
git commit -m "feat(detail-ui): Keltner/VWAP toggle buttons + OBV subpanel chip"
```

---

## Task 9: 検証（node --test 全緑・snapshot 再ベースライン・実ブラウザ）

**Files:**
- 変更なし（検証のみ。snapshot baseline は scratchpad で git 管理外の可能性あり＝再 capture）

- [ ] **Step 1: 全 node テスト緑を確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test`
Expected: detail-rules / finance-rules / money-rules 全緑（新規 calc 11 件＋glossary＋signalDigest 含む）

- [ ] **Step 2: detail-snapshot で差分を確認（3 指標追加分のみか目視）**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare`（mock は `scratchpad/mock_prod_server.py`）
Expected: signalDigest DOM に 3 行追加・チャートに新 series の差分。**無関係差分が無いこと**を確認後、`node scratchpad/detail-snapshot.js capture` で意図的に再ベースライン。

- [ ] **Step 3: 実ブラウザ（Playwright・CDN 実ロード）で描画を検証** — playwright-skill で以下を確認：
  - Keltner（KC 20）トグル ON/OFF で amber チャネル 3 本が表示/非表示
  - VWAP トグル ON/OFF で gold 単線が表示/非表示（期間アンカー＝先頭から線が始まる）
  - OBV チップ選択でサブパネル mount（0x0/黒 canvas 回帰なし）・時間軸同期・チップ再選択で unmount
  - 年/期間切替で 3 指標が再描画（VWAP の起点がリセット）
  - 各 data-term（keltner/vwap/obv）の「?」ツールチップが表示（`.acc-item` クリップなし）
  - JS コンソールエラー 0

- [ ] **Step 4: 実機サニティは本人 FB**（GPU/glow/globe 依存は headless 不可）— 色の見え方・チャネル可読性は太田さん実機で確認・微調整。

（Task 9 はコミット不要＝検証。snapshot baseline を再 capture した場合のみ `git add scratchpad/… && git commit -m "test: rebaseline detail snapshot for keltner/obv/vwap"`。ただし scratchpad が .gitignore 対象なら不要）

---

## Self-Review（この計画 vs spec）

- **Spec coverage**：Keltner=Task1(calc)+Task5(digest)+Task6(overlay)+Task8(button)+Task4(glossary)。OBV=Task2+Task5+Task7(subpanel)+Task8(META)+Task4。VWAP=Task3+Task5+Task6(overlay)+Task8(button)+Task4。テスト/検証=各 calc タスク＋Task9。全 spec 節に対応タスクあり。
- **Placeholder scan**：TBD/TODO なし。全コードブロックは実コード。glossary/state 文言は確定（forbidden 非命中を Task4/5 の既存テストで機械検証）。
- **Type consistency**：`calcKeltner`→`{upper,mid,lower}`（BB 同形・Task1 定義／Task5,6 消費一致）。`calcOBV`/`calcVWAP`→`[{time,value}]`（Task2,3 定義／Task5,7 消費一致）。`toggleKeltner`/`toggleVWAP` は Task6 定義＝Task8 の onclick と一致。`SUBPANEL_REGISTRY.obv.height=104`＝`SUBPANEL_META.obv.height=104` 一致。DR destructure（Task6 Step1＋Task7 Step1）で calcKeltner/calcVWAP/calcOBV を全て追加。
- **共有ファイル直列**：detail-rules.js（Task1-5）→detail-charts.js（Task6-7）→UI（Task8）→検証（Task9）の順で、同一ファイルの並行編集を避ける。
