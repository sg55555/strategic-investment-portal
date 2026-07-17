# NISA枠 Stage2（年別履歴）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NISA の入力源を年別履歴（`nisa.source:'history'`）に差し替え、復活タイミングを年別に正確化して「精密な再利用/監査」を成立させる。

**Architecture:** 新規純関数 `nisaHistoryFold` が年別履歴を Stage1 と同じ5スカラーへ畳み、`nisaEffective` が `nisaDerive` 冒頭で実効値に差し替える。下流（各Pct・over・ETA・`nisaFacts`・`nisaRaw`・coarsen・facts schema）は**全て無改修**で、既存 facts の精度だけが上がる。UI は入力源トグル＋年別テーブル＋差分リコンサイルを追加し、`render()` に open/フォーカス復元の汎用パッチを入れる。

**Tech Stack:** Vanilla JS（`money-rules.js` 純関数 / `money.js` 描画）、Python（`api/me/advice.py` byte-parity 鏡像）、node:test、pytest、Playwright。

## Global Constraints

- **spec**: `docs/superpowers/specs/2026-07-17-nisa-stage2-history-design.md`（本 plan の唯一の要件源）。
- **`FACTS_SCHEMA_VERSION` は 5 据置**（money-rules.js:15）。**`SCHEMA_VERSION` は 5 据置**（api/me/advice.py:30）。**`RULES_VERSION`/`CURRENT_VERSION` も据置**。**bump 禁止**＝facts 形状不変が本 Stage の中心的主張。
- **facts に新キーを足さない**。`facts.nisa` / `facts.raw.nisa` のキー集合は Stage1 と完全同一。
- **`history` というキー名を production facts に出さない**（DENY 既収載＝tests/test_advice_facts.py:50・DENYLIST_KEYS＝tests/money-rules.test.js:223）。
- **JS↔Py byte-parity**：`money-rules.js` の NISA 純関数を変えたら `api/me/advice.py` の `_nisa_*` 鏡像を**同じ変更で同時に**直す。
- **数値 coerce は共有 `num()`（money-rules.js:52）/ `_num()`（api/me/advice.py:200-202）のみ**。独自の `Number()`/`int()`/`float()` 禁止（2026-07-15 の scalar-coerce パリティ堅牢化を巻き戻すため）。`_num` は**常に float を返す**（`n + 0.0`）が、fixture 比較は Python の `3000000.0 == 3000000` と JS の `===` で両方通るため型差は問題にならない。
- **現在時刻由来の年は `nisaNow`（money-rules.js:415-420）/ `_nisa_now`（api/me/advice.py:853-865）経由のみ**。`datetime` を新規に触らない（OverflowError 捕捉漏れで 500）。
- **money.js に業務math を書かない**（money.js:1057-1058 の明文規律）。集計・%・over・差分・年の絞り込みは全て `money-rules.js` の純関数/VM leaf。
- **生¥は `sync.loggedIn` ゲートの内側でのみ HTML に入れる**（readout gate であって input gate ではない＝未ログインでも入力欄は出す）。
- 新しい `MCC.*` 関数は **money.js の公開 return（money.js:1398-1406）** に、新しい純関数は **money-rules.js の exports（money-rules.js:1209-1216）** に追加する（漏れ＝無言故障）。
- inline handler に値を埋める箇所は **`esc()` を通す**（money.js:641-647 が先例）。
- 検証3点セット：`node --test 'tests/*.test.js'`（**末尾スラッシュ不可**）／`PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q`／`node scratchpad/b2-parity-fuzz.js` で `mismatches: 0`。

## 定数・命名（全タスク共通・型整合の単一源）

| 名前 | 値 | 場所 | 備考 |
|---|---|---|---|
| `NISA_SOURCES` | `["manual","history","ledger"]` | money-rules.js:22 / advice.py:41 | **既存・変更不要**（`history` は既に含む） |
| `NISA_MIN_YEAR` | `2024` | 新規（両言語） | 新NISA開始年＝履歴年の下限。facts 非出力 |
| `NISA_HISTORY_MAX` | `50` | 新規（両言語） | 履歴件数上限（reserves 流儀 money-rules.js:303-305） |
| `normalizeNisaYear(e)` | → `{year,tsumitate,growth,soldTsumitate,soldGrowth}` | money-rules.js | Py: `_normalize_nisa_year(e)` |
| `normalizeNisaHistory(raw)` | → 上記の配列（年昇順・年一意） | money-rules.js | Py: `_normalize_nisa_history(raw)` |
| `nisaHistoryFold(history, currentYear)` | → `{tsumitateThisYear,growthThisYear,tsumitateLifetime,growthLifetime,soldThisYearAtCost}` | money-rules.js | Py: `_nisa_history_fold(history, current_year)` |
| `nisaEffective(n, currentYear)` | → normalizeNisa と同形状（history なら5スカラー差替） | money-rules.js | Py: `_nisa_effective(n, current_year)` |
| `nisaAvailableYears(history, currentYear)` | → 年の昇順配列 | money-rules.js | UI専用・Py 鏡像**不要** |
| `d.stored` | `nisaDerive` 返り値の新キー | money-rules.js | 正規化済み**未畳み**値（VM のリコンサイル参照用・facts 非出力） |

## File Structure

| ファイル | 責務 | 変更 |
|---|---|---|
| `money-rules.js` | 純関数・VM・facts 生成の単一計算源 | 定数2・純関数5追加、`normalizeNisa`/`nisaDerive`/`nisaViewModel`/exports 変更 |
| `api/me/advice.py` | JS 純関数の byte-parity 鏡像 | 定数2・関数4追加、`_normalize_nisa`/`_nisa_derive` 変更 |
| `tests/money-rules.test.js` | JS 純関数の unit + 構造テスト | 追加のみ |
| `tests/test_advice_facts.py` | Py 鏡像の unit + 共有 fixture パリティ + 構造テスト | 追加のみ |
| `tests/fixtures/advice_facts_cases.json` | JS↔Py 共有 fixture（単一源） | `nisa-j`〜`nisa-q` 追加 |
| `scratchpad/b2-parity-fuzz.js` | パリティ fuzz ハーネス | `genState()` の nisa ブロックに history 生成器追加 |
| `money.js` | 描画（業務math 禁止） | `render()` 汎用パッチ、`nisaSection` 拡張、`MCC` 関数4追加 |
| `money.css` | theme D 二層 CSS | 年別テーブルのスタイル追加 |

---

## Task 1: 定数 + `normalizeNisaYear` + `normalizeNisaHistory`（JS）

**Files:**
- Modify: `money-rules.js:22`（定数追加）, `money-rules.js:72-83`（`normalizeNisa` 拡張）
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: 既存 `num`（:52）, `NISA_SOURCES`（:22）
- Produces: `NISA_MIN_YEAR=2024`, `NISA_HISTORY_MAX=50`, `normalizeNisaYear(e)`, `normalizeNisaHistory(raw)`, `normalizeNisa(raw).history`（常に配列）

- [ ] **Step 1: Write the failing test**

`tests/money-rules.test.js` の NISA テスト群の末尾に追記：

```javascript
test("normalizeNisaHistory: 非配列→[] / 要素filter / slice(50) / 無効年除去 / 後勝ち畳み / 年昇順", () => {
  // 非配列入力
  assert.deepEqual(R.normalizeNisa({ history: "x" }).history, []);
  assert.deepEqual(R.normalizeNisa({ history: null }).history, []);
  assert.deepEqual(R.normalizeNisa(null).history, []);

  // 要素 filter（null/配列/プリミティブは落ちる）＋無効年除去
  assert.deepEqual(
    R.normalizeNisa({ history: [null, [1], 5, { year: 2024, tsumitate: 100 }] }).history,
    [{ year: 2024, tsumitate: 100, growth: 0, soldTsumitate: 0, soldGrowth: 0 }]
  );

  // 無効年（0/2023/10000/全角）は行ごと落ちる。ASCII decimal 文字列 "2024" は num() が通す＝残る
  const invalid = R.normalizeNisa({
    history: [{ year: 0 }, { year: 2023 }, { year: 10000 }, { year: "２０２４" }, { year: "2024" }],
  }).history;
  assert.deepEqual(invalid, [{ year: 2024, tsumitate: 0, growth: 0, soldTsumitate: 0, soldGrowth: 0 }]);

  // 後勝ち畳み（合算しない）＋年昇順
  const dup = R.normalizeNisa({
    history: [{ year: 2025, tsumitate: 1 }, { year: 2024, tsumitate: 2 }, { year: 2025, tsumitate: 3 }],
  }).history;
  assert.deepEqual(dup.map((e) => [e.year, e.tsumitate]), [[2024, 2], [2025, 3]]);

  // slice(0,50) は filter の後・map の前（51件目以降は捨てられる）
  const many = [];
  for (let i = 0; i < 60; i++) many.push({ year: 2024, tsumitate: i });
  assert.equal(R.normalizeNisa({ history: many }).history.length, 1);      // 全て同年→畳んで1件
  assert.equal(R.normalizeNisa({ history: many }).history[0].tsumitate, 49); // 50件目(index49)が後勝ち

  // 金額は共有 num()（単一要素配列/NaN/hex/全角→0）
  const coerced = R.normalizeNisa({
    history: [{ year: 2024, tsumitate: [5], growth: NaN, soldTsumitate: "0x10", soldGrowth: "１" }],
  }).history[0];
  assert.deepEqual(coerced, { year: 2024, tsumitate: 0, growth: 0, soldTsumitate: 0, soldGrowth: 0 });

  // 未知キー破棄・固定5キー骨格
  assert.deepEqual(Object.keys(R.normalizeNisa({ history: [{ year: 2024, bogus: 1 }] }).history[0]),
    ["year", "tsumitate", "growth", "soldTsumitate", "soldGrowth"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'tests/*.test.js' 2>&1 | grep -A 3 "normalizeNisaHistory"`
Expected: FAIL（`R.normalizeNisa({history:"x"}).history` が `undefined`＝`deepEqual` が落ちる）

- [ ] **Step 3: Write minimal implementation**

`money-rules.js:22` の `NISA_SOURCES` の直後に定数を追加：

```javascript
  var NISA_MIN_YEAR = 2024;      // Stage2: 新NISA開始年＝履歴年の下限（facts非出力・年度改定時はここ）
  var NISA_HISTORY_MAX = 50;     // Stage2: 履歴件数上限（reserves 流儀・Python 側と同値必須）
```

`money-rules.js` の `normalizeNisa`（:72-83）の**直前**に2関数を追加：

```javascript
  // B#3 Stage2: 履歴1行の固定形状（年は normalizeBirthYear 型の範囲gate・金額は共有 num()・未知キー破棄）。
  function normalizeNisaYear(e) {
    var s = (e && typeof e === "object" && !Array.isArray(e)) ? e : {};
    var y = Math.floor(num(s.year));
    return {
      year: (y >= NISA_MIN_YEAR && y <= 9999) ? y : 0,
      tsumitate: num(s.tsumitate),
      growth: num(s.growth),
      soldTsumitate: num(s.soldTsumitate),
      soldGrowth: num(s.soldGrowth),
    };
  }
  // B#3 Stage2: 年別履歴の正規化。reserves 流儀（filter→slice→map）＋無効年除去→年で後勝ち畳み→年昇順。
  // 順序は Python _normalize_nisa_history と厳密一致させること（畳む前にソートすると後勝ちの意味が変わる）。
  function normalizeNisaHistory(raw) {
    var arr = Array.isArray(raw) ? raw : [];
    var rows = [], i;
    var kept = arr.filter(function (e) { return e && typeof e === "object" && !Array.isArray(e); })
      .slice(0, NISA_HISTORY_MAX);
    for (i = 0; i < kept.length; i++) {
      var row = normalizeNisaYear(kept[i]);
      if (row.year > 0) rows.push(row);
    }
    var byYear = {};
    for (i = 0; i < rows.length; i++) byYear[rows[i].year] = rows[i];   // 後勝ち（合算しない）
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    return years.map(function (y) { return byYear[y]; });
  }
```

`normalizeNisa` の返り値（:81 `soldThisYearAtCost` の次）に1行追加：

```javascript
      history: normalizeNisaHistory(s.history),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test 'tests/*.test.js' 2>&1 | tail -12`
Expected: PASS（`# fail 0`）。既存 NISA テストも全緑（`history` 追加は既存 assertion の `deepEqual` を壊し得るため、壊れたら**既存テスト側に `history: []` を足す**＝正規化の骨格が増えたことの正しい反映）。

- [ ] **Step 5: Commit**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(nisa): Stage2 履歴の正規化（normalizeNisaYear/normalizeNisaHistory・Task1）"
```

---

## Task 2: `nisaHistoryFold` + `nisaEffective`（JS純コア）

**Files:**
- Modify: `money-rules.js`（`nisaDerive`:423 の直前に追加）
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: `NISA_MIN_YEAR`, `normalizeNisaHistory`（Task1）
- Produces: `nisaHistoryFold(history, currentYear)` → `{tsumitateThisYear, growthThisYear, tsumitateLifetime, growthLifetime, soldThisYearAtCost}`（全て number）／`nisaEffective(n, currentYear)` → `normalizeNisa` と同形状

- [ ] **Step 1: Write the failing test**

```javascript
test("nisaHistoryFold: 当年売却は生涯枠から控除しない／過去年売却は復活済み／枠別", () => {
  const h = R.normalizeNisa({ history: [
    { year: 2024, tsumitate: 1200000, growth: 2400000, soldTsumitate: 0, soldGrowth: 0 },
    { year: 2025, tsumitate: 1000000, growth: 1000000, soldTsumitate: 200000, soldGrowth: 500000 },
    { year: 2026, tsumitate: 600000, growth: 300000, soldTsumitate: 100000, soldGrowth: 400000 },
  ] }).history;

  const f = R.nisaHistoryFold(h, 2026);
  // 当年（2026）の拠出はそのまま
  assert.equal(f.tsumitateThisYear, 600000);
  assert.equal(f.growthThisYear, 300000);
  // 当年売却は合算して soldThisYearAtCost（翌年復活の予定）
  assert.equal(f.soldThisYearAtCost, 500000);
  // 生涯＝Σ拠出 − Σ(過去年の売却)。当年(2026)の売却は控除しない
  assert.equal(f.tsumitateLifetime, 1200000 + 1000000 + 600000 - 200000);
  assert.equal(f.growthLifetime, 2400000 + 1000000 + 300000 - 500000);

  // 翌年に進むと 2026 の売却が復活＝生涯が減る
  const g = R.nisaHistoryFold(h, 2027);
  assert.equal(g.tsumitateLifetime, 1200000 + 1000000 + 600000 - 200000 - 100000);
  assert.equal(g.growthLifetime, 2400000 + 1000000 + 300000 - 500000 - 400000);
  assert.equal(g.tsumitateThisYear, 0);   // 2027 の行が無い＝当年拠出0（年ロールオーバーが自動）
  assert.equal(g.soldThisYearAtCost, 0);
});

test("nisaHistoryFold: 未来年は無視／currentYear=0（無効時刻）は全0／売却>拠出は0クランプ", () => {
  const h = R.normalizeNisa({ history: [
    { year: 2024, tsumitate: 100 }, { year: 2030, tsumitate: 999999 },
  ] }).history;
  assert.equal(R.nisaHistoryFold(h, 2026).tsumitateLifetime, 100);   // 2030 は無視
  assert.equal(R.nisaHistoryFold(h, 0).tsumitateLifetime, 0);        // 無効時刻→全0 degrade
  assert.equal(R.nisaHistoryFold(h, 0).tsumitateThisYear, 0);

  const over = R.normalizeNisa({ history: [{ year: 2024, tsumitate: 100, soldTsumitate: 500 }] }).history;
  assert.equal(R.nisaHistoryFold(over, 2026).tsumitateLifetime, 0);  // 負値にしない
});

test("nisaEffective: manual は素通し／history は5スカラーだけ差替（source/anchorYear/history は保持）", () => {
  const manual = R.normalizeNisa({ source: "manual", tsumitateThisYear: 50, history: [{ year: 2024, tsumitate: 999 }] });
  assert.equal(R.nisaEffective(manual, 2026).tsumitateThisYear, 50);   // 履歴があっても manual なら無視

  const hist = R.normalizeNisa({ source: "history", anchorYear: 2024, tsumitateThisYear: 50,
    history: [{ year: 2026, tsumitate: 999 }] });
  const e = R.nisaEffective(hist, 2026);
  assert.equal(e.tsumitateThisYear, 999);   // 履歴が勝つ（排他）
  assert.equal(e.source, "history");
  assert.equal(e.anchorYear, 2024);
  assert.equal(e.history.length, 1);
  assert.deepEqual(Object.keys(e).sort(), Object.keys(hist).sort());   // 形状同一
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'tests/*.test.js' 2>&1 | grep -c "not ok"`
Expected: FAIL（`R.nisaHistoryFold is not a function`）

- [ ] **Step 3: Write minimal implementation**

`money-rules.js` の `nisaDerive`（:423）の**直前**に追加：

```javascript
  // B#3 Stage2: 年別履歴 → Stage1 と同じ5スカラーへの畳み込み（唯一の Stage2 計算）。
  // 制度モデル：売却簿価は「翌年1/1」に生涯枠へ復活する＝当年(currentYear)の売却は生涯枠から控除しない。
  // 未来年の行は無視（currentYear=0＝無効時刻なら全行が対象外＝全0へ degrade）。
  function nisaHistoryFold(history, currentYear) {
    var h = Array.isArray(history) ? history : [];
    var tThis = 0, gThis = 0, soldThis = 0, tLife = 0, gLife = 0;
    for (var i = 0; i < h.length; i++) {
      var row = h[i];
      if (!(row.year > 0) || row.year > currentYear) continue;
      tLife += row.tsumitate;
      gLife += row.growth;
      if (row.year === currentYear) {
        tThis = row.tsumitate;
        gThis = row.growth;
        soldThis = row.soldTsumitate + row.soldGrowth;
      } else {
        tLife -= row.soldTsumitate;   // 過去年の売却＝翌年1/1に復活済み
        gLife -= row.soldGrowth;
      }
    }
    return {
      tsumitateThisYear: tThis, growthThisYear: gThis, soldThisYearAtCost: soldThis,
      tsumitateLifetime: Math.max(0, tLife), growthLifetime: Math.max(0, gLife),
    };
  }
  // B#3 Stage2: 実効値（source='history' なら履歴の畳み込みで5スカラーを差替）。
  // これにより nisaDerive 以降の下流（Pct/over/ETA/facts/raw/VM）は d.n.* を読むだけで無改修のまま精度が上がる。
  function nisaEffective(n, currentYear) {
    if (n.source !== "history") return n;
    var f = nisaHistoryFold(n.history, currentYear);
    return {
      source: n.source, anchorYear: n.anchorYear, history: n.history,
      tsumitateThisYear: f.tsumitateThisYear, growthThisYear: f.growthThisYear,
      tsumitateLifetime: f.tsumitateLifetime, growthLifetime: f.growthLifetime,
      soldThisYearAtCost: f.soldThisYearAtCost,
    };
  }
```

`money-rules.js:1209-1216` の exports に追加：

```javascript
    normalizeNisaYear: normalizeNisaYear, normalizeNisaHistory: normalizeNisaHistory,
    nisaHistoryFold: nisaHistoryFold, nisaEffective: nisaEffective,
    NISA_MIN_YEAR: NISA_MIN_YEAR, NISA_HISTORY_MAX: NISA_HISTORY_MAX,
    NISA_SOURCES: NISA_SOURCES,   // Stage1 では未export＝Task9 の setNisaSource が R.NISA_SOURCES を使うため追加
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test 'tests/*.test.js' 2>&1 | tail -8`
Expected: PASS（`# fail 0`）

- [ ] **Step 5: Commit**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(nisa): Stage2 履歴→スカラー畳み込み（nisaHistoryFold/nisaEffective・Task2）"
```

---

## Task 3: `nisaDerive` 配線（実効値差替 + configured 拡張 + stale 縮退）（JS）

**Files:**
- Modify: `money-rules.js:423-456`
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: `nisaEffective`（Task2）
- Produces: `nisaDerive(state, nowMs)` の返り値に `stored`（正規化済み**未畳み**値）を追加。既存キーは全て維持（`n` は**実効値**になる）

- [ ] **Step 1: Write the failing test**

```javascript
test("nisaDerive: history モードで facts 相当の値が履歴から導出される（形状は不変）", () => {
  const st = { nisa: { source: "history", history: [
    { year: 2024, tsumitate: 1200000, growth: 2400000 },
    { year: 2025, tsumitate: 0, growth: 0, soldTsumitate: 1200000, soldGrowth: 0 },
    { year: 2026, tsumitate: 600000, growth: 0, soldTsumitate: 0, soldGrowth: 300000 },
  ] } };
  const now = Date.UTC(2026, 5, 10);
  const d = R.nisaDerive(st, now);

  assert.equal(d.configured, true);                    // 履歴だけでも configured
  assert.equal(d.atUsed, 600000);                      // 当年つみたて＝2026行
  assert.equal(d.agUsed, 0);
  // 生涯つみたて＝1200000+0+600000 − (2025の売却1200000) ＝ 600000
  assert.equal(d.n.tsumitateLifetime, 600000);
  assert.equal(d.n.growthLifetime, 2400000);           // 当年(2026)の成長売却300000は控除しない
  assert.equal(d.hasRestorationPending, true);         // 当年売却あり
  assert.equal(d.restoresYear, 2027);
});

test("nisaDerive: configured は history のみでも true（スカラー全0）", () => {
  const st = { nisa: { source: "history", history: [{ year: 2024, tsumitate: 1 }] } };
  assert.equal(R.nisaDerive(st, Date.UTC(2026, 0, 1)).configured, true);
  // 履歴が空なら従来どおり false
  assert.equal(R.nisaDerive({ nisa: { source: "history", history: [] } }, Date.UTC(2026, 0, 1)).configured, false);
});

test("nisaDerive: staleAnchorYear は history モードで常に false（意味の縮退）", () => {
  const st = { nisa: { source: "history", anchorYear: 2024, history: [{ year: 2024, tsumitate: 1 }] } };
  assert.equal(R.nisaDerive(st, Date.UTC(2026, 5, 10)).staleAnchorYear, false);
  // manual では従来どおり true
  const stM = { nisa: { source: "manual", anchorYear: 2024, tsumitateThisYear: 1 } };
  assert.equal(R.nisaDerive(stM, Date.UTC(2026, 5, 10)).staleAnchorYear, true);
});

test("nisaDerive: stored は未畳みの正規化値（VM のリコンサイル参照用）", () => {
  const st = { nisa: { source: "history", tsumitateLifetime: 5000000,
    history: [{ year: 2024, tsumitate: 1000000 }] } };
  const d = R.nisaDerive(st, Date.UTC(2026, 5, 10));
  assert.equal(d.stored.tsumitateLifetime, 5000000);   // 手入力の参照値は保持
  assert.equal(d.n.tsumitateLifetime, 1000000);        // 実効値は履歴由来
});

test("nisaDerive: manual モードは Stage1 と完全に同じ（回帰なし）", () => {
  const st = { nisa: { tsumitateThisYear: 600000, growthLifetime: 3000000, history: [{ year: 2024, tsumitate: 9 }] } };
  const d = R.nisaDerive(st, Date.UTC(2026, 5, 10));
  assert.equal(d.atUsed, 600000);
  assert.equal(d.n.growthLifetime, 3000000);           // 履歴は無視される
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'tests/*.test.js' 2>&1 | grep -c "not ok"`
Expected: FAIL（`d.configured` が false／`d.n.tsumitateLifetime` が 0／`d.stored` が undefined）

- [ ] **Step 3: Write minimal implementation**

`money-rules.js:423-427` を置換：

```javascript
  function nisaDerive(state, nowMs) {
    var stored = normalizeNisa(state && state.nisa);
    var now = nisaNow(nowMs);
    var n = nisaEffective(stored, now.year);   // Stage2: history なら履歴の畳み込みに差替（下流は無改修）
    // configured は「今有効な入力源にデータがあるか」＝source 別（spec §4）。source 非依存にすると
    // 「履歴モードで記録→手入力へ戻す」状態（スカラー全0・履歴残存）で「枠を全く使っていない」と
    // facts が嘘をつく。'ledger'（Stage3・未実装）は当面 manual と同じ枝。
    var configured = stored.source === "history"
      ? stored.history.length > 0
      : (stored.anchorYear > 0 || stored.tsumitateThisYear > 0 || stored.growthThisYear > 0 ||
         stored.tsumitateLifetime > 0 || stored.growthLifetime > 0 || stored.soldThisYearAtCost > 0);
```

`money-rules.js:437` の返り値先頭に `stored` を追加：

```javascript
      configured: configured, n: n, stored: stored, year: now.year, monthIndex: now.monthIndex, valid: now.valid,
```

`money-rules.js:450` の `staleAnchorYear` を置換（履歴モードでは年ロールオーバーが自動解決＝誤警報にしない）：

```javascript
      staleAnchorYear: n.source !== "history" && now.valid && n.anchorYear > 0 && n.anchorYear < now.year,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test 'tests/*.test.js' 2>&1 | tail -8`
Expected: PASS（`# fail 0`・既存 NISA テストも全緑＝manual 経路は不変）

- [ ] **Step 5: Commit**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(nisa): Stage2 nisaDerive に実効値差替/configured拡張/stale縮退（Task3）"
```

---

## Task 4: `nisaViewModel` 拡張（reconcile + availableYears）（JS・UI専用）

**Files:**
- Modify: `money-rules.js:498-517`（`nisaViewModel`）, exports
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: `nisaDerive().stored`（Task3）, `NISA_MIN_YEAR`（Task1）
- Produces: `nisaViewModel(state, cd, nowMs)` に `source`（string）, `history`（配列）, `availableYears`（number配列）, `reconcile: {available, manualLifetime, derivedLifetime, diff, matched}` を追加。**facts 非出力・Py 鏡像不要**

- [ ] **Step 1: Write the failing test**

```javascript
test("nisaViewModel: reconcile（手入力の生涯簿価残 vs 履歴からの導出）", () => {
  const base = { source: "history", tsumitateLifetime: 3000000, growthLifetime: 2000000 };
  // 履歴が未完成＝手入力5,000,000 に対し導出1,000,000 → diff 4,000,000
  const st = { nisa: Object.assign({}, base, { history: [{ year: 2024, tsumitate: 1000000 }] }) };
  const vm = R.nisaViewModel(st, null, Date.UTC(2026, 5, 10));
  assert.equal(vm.reconcile.available, true);
  assert.equal(vm.reconcile.manualLifetime, 5000000);
  assert.equal(vm.reconcile.derivedLifetime, 1000000);
  assert.equal(vm.reconcile.diff, 4000000);
  assert.equal(vm.reconcile.matched, false);

  // 一致すると matched
  const st2 = { nisa: Object.assign({}, base, { history: [{ year: 2024, tsumitate: 3000000, growth: 2000000 }] }) };
  const vm2 = R.nisaViewModel(st2, null, Date.UTC(2026, 5, 10));
  assert.equal(vm2.reconcile.diff, 0);
  assert.equal(vm2.reconcile.matched, true);

  // manual モードでは available:false（参照値の突き合わせは history モードの話）
  const st3 = { nisa: { source: "manual", tsumitateLifetime: 3000000 } };
  assert.equal(R.nisaViewModel(st3, null, Date.UTC(2026, 5, 10)).reconcile.available, false);

  // 手入力の生涯簿価残が一度も入っていなければ参照値なし＝available:false
  const st4 = { nisa: { source: "history", history: [{ year: 2024, tsumitate: 1 }] } };
  assert.equal(R.nisaViewModel(st4, null, Date.UTC(2026, 5, 10)).reconcile.available, false);
});

test("nisaViewModel: availableYears は NISA_MIN_YEAR〜当年から既存行の年を除いた昇順", () => {
  const st = { nisa: { source: "history", history: [{ year: 2025, tsumitate: 1 }] } };
  const vm = R.nisaViewModel(st, null, Date.UTC(2026, 5, 10));
  assert.deepEqual(vm.availableYears, [2024, 2026]);
  assert.equal(vm.source, "history");
  assert.equal(vm.history.length, 1);

  // 無効時刻（year=0）→ 追加できる年は無い
  assert.deepEqual(R.nisaViewModel(st, null, 8.64e15 * 2).availableYears, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'tests/*.test.js' 2>&1 | grep -c "not ok"`
Expected: FAIL（`vm.reconcile` が undefined）

- [ ] **Step 3: Write minimal implementation**

`money-rules.js` の `nisaViewModel`（:498）の**直前**に追加：

```javascript
  // B#3 Stage2: 追加できる年（NISA_MIN_YEAR〜当年のうち履歴に無い年・昇順）。UI の year select 用＝
  // 「既存年は選べない」で重複行を作らせない（純関数側の後勝ち畳みと二重防衛）。UI専用ゆえ Py 鏡像不要。
  function nisaAvailableYears(history, currentYear) {
    var used = {}, out = [], i, y;
    for (i = 0; i < history.length; i++) used[history[i].year] = true;
    for (y = NISA_MIN_YEAR; y <= currentYear; y++) if (!used[y]) out.push(y);
    return out;
  }
```

`nisaViewModel` の返り値（:515 `monthsLeft: d.monthsLeft, year: d.year,` の次）に追加：

```javascript
      source: d.n.source, history: d.n.history,
      availableYears: nisaAvailableYears(d.n.history, d.year),
      // Stage2 リコンサイル：手入力の生涯簿価残（参照値・stored）と履歴からの導出（lifeUsed）の突き合わせ。
      // 「数字が落ちた」を「埋めるべき残り」に変える＝手入力が一度も無ければ available:false（差を語らない）。
      reconcile: {
        available: d.n.source === "history" && (d.stored.tsumitateLifetime + d.stored.growthLifetime) > 0,
        manualLifetime: d.stored.tsumitateLifetime + d.stored.growthLifetime,
        derivedLifetime: d.lifeUsed,
        diff: (d.stored.tsumitateLifetime + d.stored.growthLifetime) - d.lifeUsed,
        matched: (d.stored.tsumitateLifetime + d.stored.growthLifetime) - d.lifeUsed === 0,
      },
```

exports に追加：

```javascript
    nisaAvailableYears: nisaAvailableYears,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test 'tests/*.test.js' 2>&1 | tail -8`
Expected: PASS（`# fail 0`）

- [ ] **Step 5: Commit**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(nisa): Stage2 VM に reconcile/availableYears（Task4）"
```

---

## Task 5: Python 鏡像（`_normalize_nisa_year` / `_normalize_nisa_history` / `_nisa_history_fold` / `_nisa_effective` / `_nisa_derive`）

**Files:**
- Modify: `api/me/advice.py:41`（定数）, `:839-851`（`_normalize_nisa`）, `:868-901`（`_nisa_derive`）
- Test: `tests/test_advice_facts.py`

**Interfaces:**
- Consumes: 既存 `_num`（:200-202）, `_nisa_now`（:853-865）, `math`
- Produces: JS Task1-3 の byte-parity 鏡像。`_nisa_derive` の返り値に `"stored"` 追加（`"n"` は実効値）

- [ ] **Step 1: Write the failing test**

`tests/test_advice_facts.py` の NISA テスト群の末尾に追記：

```python
def test_nisa_history_normalize_mirrors_js():
    """_normalize_nisa_history：非list→[] / 要素filter / slice(50) / 無効年除去 / 後勝ち / 年昇順。"""
    assert advice._normalize_nisa({"history": "x"})["history"] == []
    assert advice._normalize_nisa(None)["history"] == []

    got = advice._normalize_nisa({"history": [None, [1], 5, {"year": 2024, "tsumitate": 100}]})["history"]
    assert got == [{"year": 2024, "tsumitate": 100.0, "growth": 0.0, "soldTsumitate": 0.0, "soldGrowth": 0.0}]

    # 無効年は行ごと落ちる。ASCII decimal 文字列 "2024" は _num が通す＝残る
    got = advice._normalize_nisa({"history": [
        {"year": 0}, {"year": 2023}, {"year": 10000}, {"year": "２０２４"}, {"year": "2024"}]})["history"]
    assert [e["year"] for e in got] == [2024]

    # 後勝ち（合算しない）＋年昇順
    got = advice._normalize_nisa({"history": [
        {"year": 2025, "tsumitate": 1}, {"year": 2024, "tsumitate": 2}, {"year": 2025, "tsumitate": 3}]})["history"]
    assert [(e["year"], e["tsumitate"]) for e in got] == [(2024, 2.0), (2025, 3.0)]

    # slice(0,50) は filter の後（51件目以降は捨てる）
    many = [{"year": 2024, "tsumitate": i} for i in range(60)]
    got = advice._normalize_nisa({"history": many})["history"]
    assert len(got) == 1 and got[0]["tsumitate"] == 49.0

    # 金額は共有 _num（list/NaN/hex/全角→0）
    got = advice._normalize_nisa({"history": [
        {"year": 2024, "tsumitate": [5], "growth": float("nan"), "soldTsumitate": "0x10", "soldGrowth": "１"}]})["history"]
    assert got[0] == {"year": 2024, "tsumitate": 0.0, "growth": 0.0, "soldTsumitate": 0.0, "soldGrowth": 0.0}


def test_nisa_history_fold_mirrors_js():
    """_nisa_history_fold：当年売却は非控除／過去年売却は復活済み／枠別／未来年無視／0クランプ。"""
    h = advice._normalize_nisa({"history": [
        {"year": 2024, "tsumitate": 1200000, "growth": 2400000},
        {"year": 2025, "tsumitate": 1000000, "growth": 1000000, "soldTsumitate": 200000, "soldGrowth": 500000},
        {"year": 2026, "tsumitate": 600000, "growth": 300000, "soldTsumitate": 100000, "soldGrowth": 400000},
    ]})["history"]

    f = advice._nisa_history_fold(h, 2026)
    assert f["tsumitateThisYear"] == 600000
    assert f["soldThisYearAtCost"] == 500000
    assert f["tsumitateLifetime"] == 1200000 + 1000000 + 600000 - 200000
    assert f["growthLifetime"] == 2400000 + 1000000 + 300000 - 500000

    g = advice._nisa_history_fold(h, 2027)
    assert g["tsumitateLifetime"] == 1200000 + 1000000 + 600000 - 200000 - 100000
    assert g["tsumitateThisYear"] == 0

    future = advice._normalize_nisa({"history": [{"year": 2024, "tsumitate": 100}, {"year": 2030, "tsumitate": 999999}]})["history"]
    assert advice._nisa_history_fold(future, 2026)["tsumitateLifetime"] == 100
    assert advice._nisa_history_fold(future, 0)["tsumitateLifetime"] == 0

    over = advice._normalize_nisa({"history": [{"year": 2024, "tsumitate": 100, "soldTsumitate": 500}]})["history"]
    assert advice._nisa_history_fold(over, 2026)["tsumitateLifetime"] == 0


def test_nisa_derive_history_mode_mirrors_js():
    """_nisa_derive：history 実効値／configured 拡張／stale 縮退／stored 保持。"""
    now = 1780963200000  # 2026-06-10T00:00:00Z
    st = {"nisa": {"source": "history", "history": [
        {"year": 2024, "tsumitate": 1200000, "growth": 2400000},
        {"year": 2025, "tsumitate": 0, "growth": 0, "soldTsumitate": 1200000, "soldGrowth": 0},
        {"year": 2026, "tsumitate": 600000, "growth": 0, "soldTsumitate": 0, "soldGrowth": 300000},
    ]}}
    d = advice._nisa_derive(st, now)
    assert d["configured"] is True
    assert d["atUsed"] == 600000
    assert d["n"]["tsumitateLifetime"] == 600000
    assert d["n"]["growthLifetime"] == 2400000     # 当年の成長売却は控除しない
    assert d["hasRestorationPending"] is True
    assert d["restoresYear"] == 2027

    # configured は history のみでも True／空なら False
    assert advice._nisa_derive({"nisa": {"source": "history", "history": [{"year": 2024, "tsumitate": 1}]}}, now)["configured"] is True
    assert advice._nisa_derive({"nisa": {"source": "history", "history": []}}, now)["configured"] is False

    # staleAnchorYear は history で False / manual で True
    assert advice._nisa_derive({"nisa": {"source": "history", "anchorYear": 2024,
                                         "history": [{"year": 2024, "tsumitate": 1}]}}, now)["staleAnchorYear"] is False
    assert advice._nisa_derive({"nisa": {"source": "manual", "anchorYear": 2024,
                                         "tsumitateThisYear": 1}}, now)["staleAnchorYear"] is True

    # stored は未畳み（VM 参照用）
    d2 = advice._nisa_derive({"nisa": {"source": "history", "tsumitateLifetime": 5000000,
                                       "history": [{"year": 2024, "tsumitate": 1000000}]}}, now)
    assert d2["stored"]["tsumitateLifetime"] == 5000000
    assert d2["n"]["tsumitateLifetime"] == 1000000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q -k nisa 2>&1 | tail -5`
Expected: FAIL（`KeyError: 'history'` / `AttributeError: module 'advice' has no attribute '_nisa_history_fold'`）

- [ ] **Step 3: Write minimal implementation**

`api/me/advice.py:41`（`NISA_SOURCES` の直後）に定数を追加：

```python
NISA_MIN_YEAR = 2024  # Stage2: 新NISA開始年＝履歴年の下限（facts非出力・money-rules.js と同値必須）
NISA_HISTORY_MAX = 50  # Stage2: 履歴件数上限（money-rules.js NISA_HISTORY_MAX と同値必須）
```

`api/me/advice.py:839` の `_normalize_nisa` の**直前**に2関数を追加：

```python
def _normalize_nisa_year(e):
    """money-rules.js normalizeNisaYear の鏡像（年は範囲gate・金額は共有 _num・未知キー破棄）。"""
    s = e if isinstance(e, dict) else {}
    y = math.floor(_num(s.get("year")))
    return {
        "year": y if NISA_MIN_YEAR <= y <= 9999 else 0,
        "tsumitate": _num(s.get("tsumitate")),
        "growth": _num(s.get("growth")),
        "soldTsumitate": _num(s.get("soldTsumitate")),
        "soldGrowth": _num(s.get("soldGrowth")),
    }


def _normalize_nisa_history(raw):
    """money-rules.js normalizeNisaHistory の鏡像。順序を厳密に一致させること＝
    filter → slice(0,NISA_HISTORY_MAX) → map → 無効年除去 → 年で後勝ち畳み → 年昇順。"""
    arr = raw if isinstance(raw, list) else []
    kept = [e for e in arr if isinstance(e, dict)][:NISA_HISTORY_MAX]
    rows = [row for row in (_normalize_nisa_year(e) for e in kept) if row["year"] > 0]
    by_year = {}
    for row in rows:
        by_year[row["year"]] = row  # 後勝ち（合算しない）
    return [by_year[y] for y in sorted(by_year.keys())]
```

`_normalize_nisa` の返り dict（`"soldThisYearAtCost"` の次）に1行追加：

```python
        "history": _normalize_nisa_history(s.get("history")),
```

`api/me/advice.py:868` の `_nisa_derive` の**直前**に2関数を追加：

```python
def _nisa_history_fold(history, current_year):
    """money-rules.js nisaHistoryFold の鏡像。売却簿価は翌年1/1に復活＝当年の売却は生涯枠から控除しない。
    未来年は無視（current_year=0＝無効時刻なら全0へ degrade）。"""
    h = history if isinstance(history, list) else []
    t_this = g_this = sold_this = 0.0
    t_life = g_life = 0.0
    for row in h:
        y = row["year"]
        if not (y > 0) or y > current_year:
            continue
        t_life += row["tsumitate"]
        g_life += row["growth"]
        if y == current_year:
            t_this = row["tsumitate"]
            g_this = row["growth"]
            sold_this = row["soldTsumitate"] + row["soldGrowth"]
        else:
            t_life -= row["soldTsumitate"]  # 過去年の売却＝翌年1/1に復活済み
            g_life -= row["soldGrowth"]
    return {
        "tsumitateThisYear": t_this, "growthThisYear": g_this, "soldThisYearAtCost": sold_this,
        "tsumitateLifetime": max(0.0, t_life), "growthLifetime": max(0.0, g_life),
    }


def _nisa_effective(n, current_year):
    """money-rules.js nisaEffective の鏡像（history なら5スカラーを畳み込みで差替・下流は無改修）。"""
    if n["source"] != "history":
        return n
    f = _nisa_history_fold(n["history"], current_year)
    return {
        "source": n["source"], "anchorYear": n["anchorYear"], "history": n["history"],
        "tsumitateThisYear": f["tsumitateThisYear"], "growthThisYear": f["growthThisYear"],
        "tsumitateLifetime": f["tsumitateLifetime"], "growthLifetime": f["growthLifetime"],
        "soldThisYearAtCost": f["soldThisYearAtCost"],
    }
```

`api/me/advice.py:870-873` を置換（**`now` の算出を `configured` より前に移す**＝fold が `now["year"]` を必要とするため）：

```python
    stored = _normalize_nisa(state.get("nisa") if isinstance(state, dict) else None)
    now = _nisa_now(now_ms)
    n = _nisa_effective(stored, now["year"])  # Stage2: history なら履歴の畳み込みに差替（下流は無改修）
    # configured は「今有効な入力源にデータがあるか」＝source 別（spec §4・JS nisaDerive と同一分岐）。
    if stored["source"] == "history":
        configured = len(stored["history"]) > 0
    else:
        configured = (stored["anchorYear"] > 0 or stored["tsumitateThisYear"] > 0 or stored["growthThisYear"] > 0
                      or stored["tsumitateLifetime"] > 0 or stored["growthLifetime"] > 0
                      or stored["soldThisYearAtCost"] > 0)
```

`api/me/advice.py:884` の返り dict 先頭に `stored` を追加：

```python
        "configured": configured, "n": n, "stored": stored, "year": now["year"],
        "monthIndex": now["monthIndex"], "valid": now["valid"],
```

`api/me/advice.py:896` の `staleAnchorYear` を置換：

```python
        "staleAnchorYear": n["source"] != "history" and now["valid"] and n["anchorYear"] > 0 and n["anchorYear"] < now["year"],
```

- [ ] **Step 4: Run test to verify it passes**

Run（この1行で1コマンド）:

```bash
PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q 2>&1 | tail -5
```

Expected: PASS（全緑・既存 NISA テストが `history` キー追加で落ちたら**既存 assertion 側に `"history": []` を足す**）

- [ ] **Step 5: Commit**

```bash
git add api/me/advice.py tests/test_advice_facts.py
git commit -m "feat(nisa): Stage2 Python 鏡像（fold/effective/derive・Task5）"
```

---

## Task 6: 共有 fixture + 形状不変の構造テスト

**Files:**
- Modify: `tests/fixtures/advice_facts_cases.json`（`nisa-j`〜`nisa-q` 追加）
- Modify: `tests/money-rules.test.js`（構造テスト追加）, `tests/test_advice_facts.py`（構造テスト追加）

**Interfaces:**
- Consumes: Task1-5 の実装
- Produces: JS↔Py 共有 fixture の新8ケース。**facts 形状不変の機械的証明**

**fixture の形**（既存 49 ケースと同じ）：`{"name":..., "state":..., "nowIso":..., "production":{...}, "personal":{...}}`。`production`/`personal` は modeAFacts のトップレベル**全体**を書く（`schemaVersion` は **5 のまま**）。

- [ ] **Step 1: 既存が全緑であることを先に確認（configured 拡張の波及チェック）**

Run（この1行で1コマンド）:

```bash
node --test 'tests/*.test.js' 2>&1 | tail -4 && PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q 2>&1 | tail -3
```

Expected: 両方 PASS。**落ちたら configured 拡張が既存 fixture に波及している**＝Task3/5 の実装バグ（既存 fixture は `history` を持たないため判定は不変のはず）。先に直す。

- [ ] **Step 2: Write the failing fixture cases**

`tests/fixtures/advice_facts_cases.json` の `cases` 配列末尾に追加する8ケース。**expected は手計算で書く**（実装出力をコピーしない＝契約の pin にならないため）。既存 `nisa-b-annual-tsumitate-full` の `production`/`personal` ブロックを雛形に、以下の `state`/`nowIso` と NISA 部分の期待値で作る：

| name | state.nisa | nowIso | 要点（期待値の核） |
|---|---|---|---|
| `nisa-j-history-only` | `{source:"history", history:[{year:2024,tsumitate:1200000,growth:2400000}]}` | `2026-06-10T00:00:00Z` | **configured:true**（スカラー全0でも facts.nisa が出る）。`lifetimeUsedPct=20`（3,600,000/18,000,000）、`annualTsumitateUsedPct=0`（2026行なし＝当年拠出0） |
| `nisa-k-current-year-sale-not-deducted` | `{source:"history", history:[{year:2026,tsumitate:1200000,soldTsumitate:1200000}]}` | `2026-06-10T00:00:00Z` | **当年売却は非控除**＝`lifetimeUsedPct=7`（1,200,000/18,000,000=6.67→7）。`hasRestorationPending:true`、`raw.restoresYear=2027` |
| `nisa-l-past-year-sale-restored` | `{source:"history", history:[{year:2024,tsumitate:1200000,growth:2400000},{year:2025,soldTsumitate:0,soldGrowth:2400000}]}` | `2026-06-10T00:00:00Z` | **過去年売却は復活済み**＝`growthCapUsedPct=0`（成長2,400,000が全額復活）、`lifetimeUsedPct=7`（1,200,000のみ残） |
| `nisa-m-duplicate-year-last-wins` | `{source:"history", history:[{year:2024,tsumitate:1000000},{year:2024,tsumitate:3000000}]}` | `2026-06-10T00:00:00Z` | **後勝ち（合算しない）**＝`lifetimeUsedPct=17`（3,000,000/18,000,000=16.67→17。合算4,000,000なら22＝この差が pin） |
| `nisa-n-invalid-years-dropped` | `{source:"history", history:[{year:0,tsumitate:9e9},{year:2023,tsumitate:9e9},{year:10000,tsumitate:9e9},{year:"２０２４",tsumitate:9e9},{year:"2024",tsumitate:1800000}]}` | `2026-06-10T00:00:00Z` | 無効年は行ごと落ちる／`"2024"` は num() が通す＝`lifetimeUsedPct=10` |
| `nisa-o-history-stale-false` | `{source:"history", anchorYear:2024, history:[{year:2024,tsumitate:1200000}]}` | `2026-06-10T00:00:00Z` | **`staleAnchorYear:false`**（manual なら true になる条件で false＝意味の縮退） |
| `nisa-p-history-adversarial` | `{source:"history", history:"nope"}` ＋ 別ケースで `history:[null,[1],{year:2024,tsumitate:[5],growth:"0x10"}]` を1ケースに統合 | `2026-06-10T00:00:00Z` | 非配列→`[]`／要素filter／金額 coerce→0。`history:"nope"` は **configured:false**＝`facts.nisa` キー**省略** |
| `nisa-q-history-invalid-nowms` | `{source:"history", history:[{year:2024,tsumitate:1200000}]}` | `nowMs` を域外（`nowIso` でなく既存 `nisa-g` と同じ手法で巨大値を渡すケースがあればそれに倣う。無ければ `"nowIso": "+275760-09-13T00:00:00Z"` 相当が表現できないため**本ケースは JS/Py の unit テスト（Task2/5 で実施済）に委ね、fixture では扱わない**） | — |

**注**：`nisa-q` は fixture の `nowIso` が有効な ISO 文字列しか表現できない場合、**追加しない**（Task2 Step1 と Task5 Step1 の unit テストで `currentYear=0` の degrade は既に固定済み）。fixture に無効 nowMs を渡す既存の仕組み（`nisa-g` 等）があればそれに倣って追加する。

- [ ] **Step 3: Run to verify the new fixtures pass**

Run（この1行で1コマンド）:

```bash
node --test 'tests/*.test.js' 2>&1 | tail -4 && PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q 2>&1 | tail -3
```

Expected: PASS。**落ちたら手計算の期待値と実装のどちらが正しいか spec §2 に照らして判断する**（実装出力を機械的に貼り付けて緑にしない＝fixture が契約の pin である意味が消える）。

- [ ] **Step 4: 形状不変の構造テストを書く（本 Stage の中心的主張の機械的証明）**

`tests/money-rules.test.js` に追加：

```javascript
test("Stage2: facts 形状不変（schemaVersion 5 据置・manual と history でキー集合同一・history 非出力）", () => {
  assert.equal(R.FACTS_SCHEMA_VERSION, 5);   // Stage2 は bump しない＝facts 形状不変

  // 署名は modeAFacts(rawState, opts)。opts = {includeRawAmounts, nowMs, cashflow}（money-rules.js:980-986）
  const now = Date.UTC(2026, 5, 10);
  const manual = R.modeAFacts({ nisa: { source: "manual", tsumitateThisYear: 600000 } }, { nowMs: now });
  const hist = R.modeAFacts({ nisa: { source: "history", history: [{ year: 2026, tsumitate: 600000 }] } }, { nowMs: now });
  assert.deepEqual(Object.keys(manual.nisa).sort(), Object.keys(hist.nisa).sort());

  const manualP = R.modeAFacts({ nisa: { source: "manual", tsumitateThisYear: 600000 } },
    { includeRawAmounts: true, nowMs: now });
  const histP = R.modeAFacts({ nisa: { source: "history", history: [{ year: 2026, tsumitate: 600000 }] } },
    { includeRawAmounts: true, nowMs: now });
  assert.deepEqual(Object.keys(manualP.raw.nisa).sort(), Object.keys(histP.raw.nisa).sort());

  // history そのものは production facts に出さない（DENYLIST_KEYS 既収載の再確認＝深い再帰で1つも無いこと）
  const seen = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    Object.keys(o).forEach(function (k) { seen.push(k); walk(o[k]); });
  })(hist);
  assert.equal(seen.indexOf("history"), -1);
});
```

`tests/test_advice_facts.py` に追加：

```python
def test_stage2_facts_shape_unchanged():
    """Stage2: SCHEMA_VERSION 5 据置・manual と history でキー集合同一・history 非出力。"""
    assert advice.SCHEMA_VERSION == 5

    # 署名は mode_a_facts(raw_state, include_raw, now_ms, cashflow=None)（api/me/advice.py:958）
    now = 1780963200000  # 2026-06-10T00:00:00Z
    manual = advice.mode_a_facts({"nisa": {"source": "manual", "tsumitateThisYear": 600000}}, False, now)
    hist = advice.mode_a_facts({"nisa": {"source": "history", "history": [{"year": 2026, "tsumitate": 600000}]}},
                               False, now)
    assert sorted(manual["nisa"].keys()) == sorted(hist["nisa"].keys())

    seen = []

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                seen.append(k)
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(hist)
    assert "history" not in seen


def test_stage2_coarsen_unchanged_for_history():
    """coarsen_facts は無改修で history 由来の facts も粗化する（生解像度の *UsedPct を残さない）。"""
    now = 1780963200000
    facts = advice.mode_a_facts({"nisa": {"source": "history", "history": [
        {"year": 2024, "tsumitate": 1234567}]}}, False, now)
    coarse = advice.coarsen_facts(facts)
    assert coarse["nisa"]["lifetimeUsedPct"] % 25 == 0
```

**注**：`coarsen_facts` の粗化キー列（api/me/advice.py:1214-1221）は **Stage2 では追記不要**（新キーを足さないため）＝このテストはそれを証明する。`nowIso` から nowMs を作る既存ヘルパ（`_case_now` / `caseNow`）が fixture テストにあるので、上記の生の epoch 値と食い違わないか実装時に確認する。

- [ ] **Step 5: Run the structural tests**

Run（この1行で1コマンド）:

```bash
node --test 'tests/*.test.js' 2>&1 | tail -4 && PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q 2>&1 | tail -3
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/advice_facts_cases.json tests/money-rules.test.js tests/test_advice_facts.py
git commit -m "test(nisa): Stage2 共有 fixture + facts 形状不変の構造テスト（Task6）"
```

---

## Task 7: パリティ fuzz（`genState` に history 生成器）

**Files:**
- Modify: `scratchpad/b2-parity-fuzz.js:184-194`（既存の nisa ブロック）

**Interfaces:**
- Consumes: 既存 `genScalarAdversarial()`, `pick()`, `maybe()`, `rnd`（同ファイル内）
- Produces: history を含む state を生成する fuzz（0 mismatch が完了条件）

- [ ] **Step 1: 現状の 0 mismatch を先に確認（基準線）**

Run（この1行で1コマンド）:

```bash
node scratchpad/b2-parity-fuzz.js 400 42
```

Expected: `mismatches: 0`（Task1-5 実装後でも既存 fuzz が緑＝manual 経路の非破壊を確認）

- [ ] **Step 2: Write the history generator**

`scratchpad/b2-parity-fuzz.js` の `genState()` 内、既存の nisa ブロック（`if (maybe(0.4)) ni.source = pick([...]);` の直後・`s.nisa = ni;` の直前）に追加：

```javascript
    // Stage2: 年別履歴（非配列/要素異常/重複年/域外年/順序シャッフル/件数境界50を踏む）
    if (maybe(0.6)) {
      if (maybe(0.15)) {
        ni.history = pick(["nope", 123, null, {}]);          // 非配列 → []
      } else {
        const rows = [];
        const nRows = Math.floor(rnd() * 55);                 // 0〜54（slice(0,50) 境界を跨ぐ）
        for (let k = 0; k < nRows; k++) {
          const row = {};
          if (maybe(0.9)) row.year = pick([2024, 2025, 2026, 2027, 2023, 0, 10000, "2024", "２０２４", [2024]]);
          if (maybe(0.9)) row.tsumitate = genScalarAdversarial();
          if (maybe(0.9)) row.growth = genScalarAdversarial();
          if (maybe(0.7)) row.soldTsumitate = genScalarAdversarial();
          if (maybe(0.7)) row.soldGrowth = genScalarAdversarial();
          if (maybe(0.1)) row.bogus = "x";                    // 未知キー破棄
          rows.push(maybe(0.08) ? pick([null, [1], 5, "x"]) : row);   // 要素 filter
        }
        ni.history = rows;                                    // 年の重複と順序ずれは pick の性質上まとめて発生
      }
    }
```

- [ ] **Step 3: Run the fuzz**

Run（この1行で1コマンド）:

```bash
node scratchpad/b2-parity-fuzz.js 800 42
```

Expected: `mismatches: 0`。mismatch が出たら **`scratchpad/b2-parity-fuzz-mismatches.json` を読み、JS/Py どちらが spec §3.2 の順序（filter→slice→map→無効年除去→後勝ち→昇順）から外れているかを特定して直す**（fuzz ハーネス側を緩めない）。

- [ ] **Step 4: Run with a different seed（シード依存でないことの確認）**

Run（この1行で1コマンド）:

```bash
node scratchpad/b2-parity-fuzz.js 800 7
```

Expected: `mismatches: 0`

- [ ] **Step 5: Commit**

```bash
git add scratchpad/b2-parity-fuzz.js
git commit -m "test(nisa): Stage2 パリティ fuzz に history 生成器（0 mismatch・Task7）"
```

---

## Task 8: `render()` 汎用パッチ（open な details + フォーカス復元）

**Files:**
- Modify: `money.js:385-389`（`moneyInput` に `data-mcc-focus`）, `money.js:1354` 付近（`render()`）
- Test: `tests/` に DOM テストは無いため **Task 10 の Playwright smoke で検証**（ここでは手動確認のみ）

**Interfaces:**
- Consumes: なし
- Produces: `render()` が再描画後に「open だった id 付き `<details>`」と「フォーカス位置＋キャレット」を復元する

**なぜ必要か**：入力は `onchange`（確定時）で `MCC.setField` → `render()` が `root.innerHTML` を丸ごと差し替える（money.js:1354, 392-400）。`<details>` に open 保持機構が無い（:1182/:957/:1339）ため、**1項目確定するたびにアコーディオンが閉じフォーカスが飛ぶ**。N年×5項目のテーブルでは実用不能。

- [ ] **Step 1: `moneyInput` に同定用の属性を足す**

`money.js:385-389` を置換：

```javascript
  function moneyInput(label, path, value) {
    return '<label class="mcc-field"><span>' + label + '</span>' +
      '<input type="number" min="0" step="1000" value="' + value + '" data-mcc-focus="' + esc(path) + '" ' +
      'onchange="MCC.setField(\'' + path + '\', this.value)"></label>';
  }
```

- [ ] **Step 2: `render()` に状態復元を足す**

`money.js` の `render()` 内、`root.innerHTML = ...`（:1354）の**直前**に追加：

```javascript
    // 全再描画方式は維持しつつ、確定(onchange)のたびにアコーディオンが閉じ・フォーカスが飛ぶのを防ぐ
    // （id 付き <details> と data-mcc-focus 要素のみが対象＝id 無し details の既存挙動は変えない）。
    var openIds = [];
    var dets = root.querySelectorAll("details[id]");
    for (var di = 0; di < dets.length; di++) if (dets[di].open) openIds.push(dets[di].id);
    var active = document.activeElement;
    var focusKey = (active && active.getAttribute) ? active.getAttribute("data-mcc-focus") : null;
    var selStart = (focusKey && typeof active.selectionStart === "number") ? active.selectionStart : null;
    var selEnd = (focusKey && typeof active.selectionEnd === "number") ? active.selectionEnd : null;
```

`root.innerHTML = ...`（:1354）の**直後**に追加：

```javascript
    for (var oi = 0; oi < openIds.length; oi++) {
      var d = document.getElementById(openIds[oi]);
      if (d) d.open = true;
    }
    if (focusKey) {
      var next = root.querySelector('[data-mcc-focus="' + focusKey.replace(/"/g, '\\"') + '"]');
      if (next) {
        next.focus();
        if (selStart !== null && typeof next.setSelectionRange === "function") {
          try { next.setSelectionRange(selStart, selEnd); } catch (e) { /* number input は選択範囲非対応 */ }
        }
      }
    }
```

- [ ] **Step 3: 手動確認**

Run（この1行で1コマンド）:

```bash
python3 -m http.server 8765 >/dev/null 2>&1 & sleep 1 && echo "http://localhost:8765/ を開き #money-view の「使用状況を入力」を開いて1項目入力→Tab。アコーディオンが開いたままか確認"
```

Expected: 入力確定後もアコーディオンが開いたまま。確認後にサーバを停止（`kill %1`）。

- [ ] **Step 4: 既存テストの非破壊を確認**

Run: `node --test 'tests/*.test.js' 2>&1 | tail -4`
Expected: PASS（`money.js` は node テストの対象外だが、`money-rules.js` の回帰が無いことを確認）

- [ ] **Step 5: Commit**

```bash
git add money.js
git commit -m "fix(money): render で open な details とフォーカスを復元（Stage2 前提・Task8）"
```

---

## Task 9: UI（入力源トグル + 年別テーブル + リコンサイル + CSS）

**Files:**
- Modify: `money.js:1072-1190`（`nisaSection`）, `money.js:1398-1406`（公開 return）, `money.css`
- Test: Task 10 の Playwright smoke

**Interfaces:**
- Consumes: `R.nisaViewModel().source/history/availableYears/reconcile`（Task4）, `R.normalizeNisaYear`（Task1）, `R.NISA_MIN_YEAR`（Task1）
- Produces: `MCC.setNisaSource(src)`, `MCC.addNisaYear()`, `MCC.removeNisaYear(year)`, `MCC.setNisaYearField(year, field, value)`

- [ ] **Step 1: 4つのアクションを実装**

`money.js` の `setReserveField`（:345-352）の直後に追加（**reserves の行編集の形に倣う**）：

```javascript
  // ---- B#3 Stage2 NISA 年別履歴 ----
  // enum セッター（acSetScope:817 の形＋state 保存）。history へ初回切替時のみ当年3値を当年行へ1回転記する
  // （生涯簿価残は「残高」であって当年拠出ではないので転記しない＝当年枠 over の誤発火を避ける。
  //  手入力スカラーは消さない＝manual に戻せば元通り・リコンサイルの参照値になる）。
  function setNisaSource(src) {
    if (!state) load();
    if (R.NISA_SOURCES.indexOf(src) < 0) return;               // fail-closed
    var n = R.normalizeNisa(state.nisa);
    if (src === "history" && n.history.length === 0) {
      var now = R.nisaNow(Date.now());
      if (now.valid) {
        state.nisa.history = [R.normalizeNisaYear({
          year: now.year,
          tsumitate: n.tsumitateThisYear,
          growth: n.growthThisYear,
          soldTsumitate: n.soldThisYearAtCost,                 // 枠別内訳が不明ゆえ保守的につみたて側へ
          soldGrowth: 0,
        })];
      }
    }
    state.nisa.source = src;
    save(); render();
  }

  function addNisaYear() {
    if (!state) load();
    var sel = document.getElementById("mcc-nisa-addyear");
    var year = sel ? Number(sel.value) : 0;
    if (!(year > 0)) return;
    var rows = R.normalizeNisa(state.nisa).history.slice();
    rows.push(R.normalizeNisaYear({ year: year }));            // 生の値を state に入れない
    state.nisa.history = rows;
    save(); render();
  }

  function removeNisaYear(year) {
    if (!state) load();
    state.nisa.history = R.normalizeNisa(state.nisa).history.filter(function (e) { return e.year !== Number(year); });
    save(); render();
  }

  function setNisaYearField(year, field, value) {
    if (!state) load();
    var rows = R.normalizeNisa(state.nisa).history;
    var y = Number(year);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].year === y) {
        rows[i] = R.normalizeNisaYear({
          year: y,
          tsumitate: field === "tsumitate" ? value : rows[i].tsumitate,
          growth: field === "growth" ? value : rows[i].growth,
          soldTsumitate: field === "soldTsumitate" ? value : rows[i].soldTsumitate,
          soldGrowth: field === "soldGrowth" ? value : rows[i].soldGrowth,
        });
        break;
      }
    }
    state.nisa.history = rows;
    save(); render();
  }
```

- [ ] **Step 2: 公開 return に追加**

`money.js:1398-1406` の return に追加（**漏れると無言故障**）：

```javascript
    setNisaSource: setNisaSource, addNisaYear: addNisaYear,
    removeNisaYear: removeNisaYear, setNisaYearField: setNisaYearField,
```

- [ ] **Step 3: `nisaSection` にトグル・テーブル・リコンサイルを足す**

`money.js:1171-1185`（`fieldsHtml` / `inputHtml`）を置換：

```javascript
    // 入力源トグル（手入力/年別履歴）＝本PJ初の入力源切替UI。以降（Stage3 ledger・B#2/B#4）の先例になる。
    var srcToggle =
      '<div class="mcc-nisa-srctoggle">' +
        '<button class="mcc-nisa-srcbtn' + (vm.source === "manual" ? " on" : "") + '" ' +
          'onclick="MCC.setNisaSource(\'manual\')">手入力</button>' +
        '<button class="mcc-nisa-srcbtn' + (vm.source === "history" ? " on" : "") + '" ' +
          'onclick="MCC.setNisaSource(\'history\')">年別履歴</button>' +
      '</div>';

    var manualFieldsHtml =
      '<div class="mcc-nisa-fields">' +
        moneyInput("当年つみたて拠出", "nisa.tsumitateThisYear", n.tsumitateThisYear) +
        moneyInput("当年成長拠出", "nisa.growthThisYear", n.growthThisYear) +
        moneyInput("当年売却(簿価)", "nisa.soldThisYearAtCost", n.soldThisYearAtCost) +
        moneyInput("生涯つみたて簿価残", "nisa.tsumitateLifetime", n.tsumitateLifetime) +
        moneyInput("生涯成長簿価残", "nisa.growthLifetime", n.growthLifetime) +
        '<label class="mcc-field"><span>アンカー年</span><input type="number" min="1900" max="9999" value="' +
          (n.anchorYear > 0 ? n.anchorYear : "") + '" placeholder="例: ' + currentYear +
          '" data-mcc-focus="nisa.anchorYear" onchange="MCC.setField(\'nisa.anchorYear\', this.value)"></label>' +
      '</div>';

    // 年別テーブル：1行＝年/つみたて/成長/売却(つ)/売却(成)。年は select で既存年を出さない＝重複を作らせない。
    var historyRows = "";
    for (var hi = 0; hi < vm.history.length; hi++) {
      var row = vm.history[hi];
      var yEsc = esc(String(row.year));
      historyRows +=
        '<tr><th>' + row.year + '</th>' +
          _nisaCell(yEsc, "tsumitate", row.tsumitate) +
          _nisaCell(yEsc, "growth", row.growth) +
          _nisaCell(yEsc, "soldTsumitate", row.soldTsumitate) +
          _nisaCell(yEsc, "soldGrowth", row.soldGrowth) +
          '<td><button class="mcc-nisa-rowdel" onclick="MCC.removeNisaYear(\'' + yEsc + '\')">削除</button></td>' +
        '</tr>';
    }
    var addYearOpts = "";
    for (var ai = 0; ai < vm.availableYears.length; ai++) {
      addYearOpts += '<option value="' + vm.availableYears[ai] + '">' + vm.availableYears[ai] + '年</option>';
    }
    var reconcileHtml = "";
    if (vm.reconcile.available) {
      reconcileHtml = vm.reconcile.matched
        ? '<div class="mcc-nisa-recon ok">手入力の生涯簿価残と履歴が一致しています</div>'
        : '<div class="mcc-nisa-recon warn">履歴が未完成：差 ' +
            (loggedIn ? R.yen(Math.abs(vm.reconcile.diff)) : "（ログインで金額表示）") +
            (vm.reconcile.diff > 0 ? '（過去年を埋めると 0 になります）' : '（履歴が手入力を上回っています）') + '</div>';
    }
    var historyHtml =
      '<div class="mcc-nisa-history">' +
        '<table class="mcc-nisa-table"><thead><tr>' +
          '<th>年</th><th>つみたて拠出</th><th>成長拠出</th><th>売却(つみたて)</th><th>売却(成長)</th><th></th>' +
        '</tr></thead><tbody>' + historyRows + '</tbody></table>' +
        (vm.availableYears.length
          ? '<div class="mcc-nisa-addrow">' +
              '<select id="mcc-nisa-addyear">' + addYearOpts + '</select>' +
              '<button class="mcc-nisa-addbtn" onclick="MCC.addNisaYear()">＋ 年を追加</button>' +
            '</div>'
          : '<div class="mcc-nisa-addrow muted">追加できる年はありません</div>') +
        reconcileHtml +
      '</div>';

    var inputHtml =
      '<details class="mcc-nisa-input" id="mcc-nisa-input"><summary>使用状況を入力（クラウド同期）</summary>' +
        srcToggle +
        (vm.source === "history" ? historyHtml : manualFieldsHtml) +
        '<div class="mcc-nisa-gate">¥はログイン時のみ表示（未ログインは%のみ）。入力は未ログインでも可能です。</div>' +
      '</details>';
```

`_nisaStat`（:1066）の直後にセル用ヘルパを追加（**行セルは¥が最も漏れやすい面**）：

```javascript
  // 年別テーブルの1セル。input の value は readout ではない＝未ログインでもゲートしない（Stage1 と同じ
  // 「readout gate であって input gate ではない」規律）。business math は書かない＝値は VM 由来をそのまま。
  function _nisaCell(yearEsc, field, value) {
    return '<td><input type="number" min="0" step="1000" value="' + value + '" ' +
      'data-mcc-focus="nisa.history.' + yearEsc + '.' + field + '" ' +
      'onchange="MCC.setNisaYearField(\'' + yearEsc + '\', \'' + field + '\', this.value)"></td>';
  }
```

- [ ] **Step 4: CSS を足す**

`money.css` の baseline 層（構造/寸法＋`var()` 色のみ）に追加：

```css
.mcc-nisa-srctoggle { display: flex; gap: 8px; margin-bottom: 10px; }
.mcc-nisa-srcbtn { flex: 0 0 auto; padding: 6px 14px; border: 1px solid var(--rim-cyan-1, rgba(120,220,255,0.35));
  background: transparent; color: var(--text-secondary); border-radius: 6px; cursor: pointer; font-size: 12px; }
.mcc-nisa-srcbtn.on { color: var(--text-primary); border-color: var(--c-violet); }
.mcc-nisa-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mcc-nisa-table th, .mcc-nisa-table td { padding: 4px 6px; text-align: right; }
.mcc-nisa-table thead th { color: var(--text-secondary); font-weight: normal; font-size: 11px; }
.mcc-nisa-table tbody th { text-align: left; color: var(--text-primary); }
.mcc-nisa-table input { width: 100%; min-width: 72px; }
.mcc-nisa-addrow { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.mcc-nisa-addrow.muted { color: var(--text-secondary); font-size: 11px; }
.mcc-nisa-recon { margin-top: 10px; font-size: 12px; }
@media (max-width: 600px) {
  .mcc-nisa-table, .mcc-nisa-table tbody, .mcc-nisa-table tr, .mcc-nisa-table td, .mcc-nisa-table th { display: block; }
  .mcc-nisa-table thead { display: none; }
  .mcc-nisa-table tr { border: 1px solid var(--border); border-radius: 8px; padding: 8px; margin-bottom: 8px; }
  .mcc-nisa-table td::before { content: attr(data-label); float: left; color: var(--text-secondary); font-size: 11px; }
}
```

`[data-theme="D"] #money-view` 配下（money.css:965-1001 の隣）に glow/縁のみ追加：

```css
[data-theme="D"] #money-view .mcc-nisa-srcbtn.on { box-shadow: 0 0 10px -2px var(--c-violet); }
[data-theme="D"] #money-view .mcc-nisa-recon.warn { color: var(--c-amber, #fbbf24); }
[data-theme="D"] #money-view .mcc-nisa-recon.ok { color: var(--c-emerald, #10b981); }
```

**注**：`--rim-cyan-1` / `--c-violet` / `--c-amber` / `--c-emerald` は実在を `grep -n "\-\-c-violet\|--rim-cyan" money.css` で確認し、無ければ既存 NISA セクションが使っているトークンに合わせること（**新トークンを増やさない**）。モバイルの `data-label` を使うなら `_nisaCell` の `<td>` に `data-label="つみたて拠出"` 等を付ける。

- [ ] **Step 5: 手動確認 → Commit**

Run（この1行で1コマンド）:

```bash
python3 -m http.server 8765 >/dev/null 2>&1 & sleep 1 && echo "http://localhost:8765/ で #money-view → 年別履歴トグル → 年追加 → セル入力 を確認"
```

Expected: トグルが効き、年を追加でき、セル入力後もテーブルが開いたまま。確認後 `kill %1`。

```bash
git add money.js money.css
git commit -m "feat(nisa): Stage2 UI（入力源トグル/年別テーブル/リコンサイル・Task9）"
```

---

## Task 10: 統合検証ゲート（全緑 + Playwright smoke + 敵対検証wf + 本番）

**Files:** 検証のみ（smoke スクリプトは `scratchpad/` に置く）

**Interfaces:**
- Consumes: Task1-9 の全成果

- [ ] **Step 1: 検証3点セットを全部走らせる**

実行1（この1行で1コマンド・JS）:

```bash
node --test 'tests/*.test.js' 2>&1 | tail -5
```

実行2（この1行で1コマンド・Python）:

```bash
PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q 2>&1 | tail -3
```

実行3（この1行で1コマンド・パリティ fuzz）:

```bash
node scratchpad/b2-parity-fuzz.js 800 42
```

Expected: JS `# fail 0` / pytest 全緑 / fuzz `mismatches: 0`

- [ ] **Step 2: Playwright smoke**

`scratchpad/nisa-stage2-smoke.js` を作り、以下を検証する（既存の smoke スクリプトがあれば流儀を合わせる）：

1. `#money-view` を開き `#mcc-sec-nisa` が存在する
2. `#mcc-nisa-input` を開き「年別履歴」ボタンを押す → テーブルが出る
3. 「＋ 年を追加」→ 行が増える
4. セルに値を入れて Tab → **`#mcc-nisa-input` が open のまま**・フォーカスが `[data-mcc-focus]` 上にある（**Task8 の直接検証**）
5. 未ログインで readout（HUD の¥）が出ず、**入力欄は出る**
6. `pageerror` が 0

Run（この1行で1コマンド）:

```bash
node scratchpad/nisa-stage2-smoke.js
```

Expected: 全ゲート緑・pageerror 0

- [ ] **Step 3: 敵対検証 workflow（ultracode・whole-branch）**

spec §10.6 の6観点で whole-branch の敵対検証 workflow を回す：①facts 形状不変の実証 ②JS↔Py パリティ（順序・後勝ち・ソート・slice 境界）③復活タイミングの制度整合 ④生¥非漏洩 ⑤cf-1 不変 ⑥render パッチの回帰。

Expected: Critical / Important 0（出たら直して再実行）

- [ ] **Step 4: 統合（main へ merge → push → 両URL curl）**

実行1（統合拠点へ戻って merge・この3行で3コマンド）:

```bash
cd /home/shugo/apps/investment-portal
git fetch && git merge worktree-nisa-stage2-history
git push
```

実行2（この1行で1コマンド・**本番ルート `/` を見る**＝`/index.html` は15Bスタブ）:

```bash
curl -s https://strategic-investment-portal.vercel.app/ | grep -c "setNisaSource"
```

実行3（この1行で1コマンド・**persona 側も確認**）:

```bash
curl -s https://strategic-investment-portal-persona.vercel.app/ | grep -c "setNisaSource"
```

Expected: 両方 1 以上（0 なら片デプロイ漏れ＝[[investment-portal-dual-deploy-persona]]）

- [ ] **Step 5: 本人実機サニティを依頼**

theme D の glow/glass・年別テーブルの狭幅カード化・リコンサイル表示の見た目は **GPU/実機依存で headless 非authoritative**（spec §10.5）。太田さんに実機確認を依頼し、FB を受けて微調整する。

---

## Self-Review（plan 完成後・spec 突合）

**1. Spec coverage:**

| spec | 対応 Task |
|---|---|
| §1-1 履歴5項目 | Task1（`normalizeNisaYear`） |
| §1-2 排他＋初回移行 | Task2（`nisaEffective`）／Task9（`setNisaSource`） |
| §1-3 facts 非出力・形状不変 | Task6（構造テスト・schema 5 据置 assert） |
| §1-4 stale 縮退 | Task3 / Task5 |
| §1-5 render 汎用パッチ | Task8 |
| §1-6 後勝ち＋UIで作らせない | Task1（後勝ち）／Task4（`availableYears`）／Task9（select） |
| §1-7 リコンサイル | Task4（VM leaf）／Task9（表示） |
| §2 fold | Task2 |
| §3.2 正規化パイプライン | Task1 / Task5 |
| §4 configured 拡張 | Task3 / Task5 |
| §5 移行 | Task9 |
| §6 reconcile | Task4 |
| §7 UI | Task9 |
| §8 render | Task8 |
| §9 パリティ | Task5 / Task7 |
| §10 テスト | Task1-7, Task10 |

**gap なし**（§11 リスクは各 Task の注記に反映済み）。

**2. Placeholder scan:** `nisa-q`（無効 nowMs の fixture）だけが条件付き（fixture が無効 nowMs を表現できる仕組みの有無で決まる）。これは **Task6 Step2 の注に「無ければ追加しない・unit テストで担保済」と明記**しており、実装者が判断できる。他に TBD なし。

**3. Type consistency:**
- `nisaHistoryFold` の返りキー（`tsumitateThisYear`/`growthThisYear`/`tsumitateLifetime`/`growthLifetime`/`soldThisYearAtCost`）は Task2 の定義と Task5 の Py 鏡像で一致。
- `nisaEffective` は `normalizeNisa` と同形状（`source`/`anchorYear`/`history`＋5スカラー）＝Task2 のテストで `Object.keys` 一致を assert。
- `d.stored`（Task3）→ `vm.reconcile`（Task4）で参照。Py 側も `"stored"`（Task5）。
- `data-mcc-focus` の値：`moneyInput` は `path`（Task8）、テーブルは `nisa.history.<year>.<field>`（Task9 `_nisaCell`）＝衝突なし。
- `MCC.setNisaYearField(year, field, value)` の署名は Task9 の実装と `_nisaCell` の呼び出しで一致。
