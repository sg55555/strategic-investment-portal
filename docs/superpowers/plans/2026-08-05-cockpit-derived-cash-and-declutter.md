# 司令室：実効値連動＋鮮度信頼性＋日次ETL＋H1 2タブ再編 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基準（アンカー）設定済みなら貯蓄額＝自動算出値がバッファの実効値として達成率・総資産・投資余力へ全連動し、古データ残留と無言失敗を解消し、司令室を「ダッシュボード／設定・ガイド」2タブに再編する。

**Architecture:** spec `docs/superpowers/specs/2026-08-05-cockpit-derived-cash-and-declutter-design.md` 準拠。核＝`effectiveState`（migrate 直後の単一境界で buffer.amount を `r(derivedCash)` に差し替えた**コピー**を返す純関数・保存 state 不変）を money-rules.js と advice.py に同位置で鏡像実装。UI は #mcc-root 内 2 タブ（index.html 無改造）。確定モック `docs/superpowers/specs/assets/2026-08-05-mock-hybrid.html` が視覚仕様。

**Tech Stack:** Vanilla JS（money.js IIFE / money-rules.js UMD 純関数）・Vercel Python（api/me/advice.py）・node --test / pytest・Playwright（scratchpad ハーネス）・GitHub Actions cron。

## Global Constraints（全タスク共通・spec から逐語）

- **money.js に業務 math 禁止**＝決定論ルールは money-rules.js（viewModel/純関数）のみ。
- **money-rules.js ↔ advice.py は鏡像**：数値 coercion は `parseNum`/`_parse_num` 基底・正規表現は ASCII `[0-9]`（`\d`/`\s` 厳禁）・丸めは単一適用（par-2）。変更は `tests/fixtures/advice_facts_cases.json` ＋ parity fuzz で固定。
- **既存 fixture 65 ケースは期待値バイト不変のまま緑**（manual 既定 no-op の機械証明）。
- **production facts に生 ¥ 禁止**（DENYLIST 維持・derivedCash 生値は personal raw のみ）。
- **FACTS_SCHEMA_VERSION（JS）と SCHEMA_VERSION（advice.py）は lockstep**（このplanで 5→6）。
- **回帰不変**: cf-1（バッファ→コア・サテライト自動配分なし）／cf-2（trend rb<=0 絶対比較）／par-2（単一丸め）／保存則 `toBuffer+Σallocated+toCore==monthlySurplus`（manual モード）。
- **index.html は無改造**（全 UI は #mcc-root に money.js が描画）。Vercel 関数は増やさない（12上限）。
- テスト実行: `node --test tests/money-rules.test.js`（グロブ・末尾スラッシュ不可）／`.venv/bin/python -m pytest tests/test_advice_facts.py -q`。
- コミットは各タスク末尾で（メッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）。

## File Structure

- Modify: `money-rules.js` — migrate（cashSource 導出）・`effectiveState` 新設・modeAFacts 実効化＋`cashSource` キー・FACTS_SCHEMA_VERSION 6
- Modify: `api/me/advice.py` — `_migrate`（anchor/cashSource 保持）・`_normalize_anchor`・`_cash_derived`・`_effective_state`・mode_a_facts 実効化＋cashSource・SCHEMA_VERSION 6・coarsen 素通し
- Modify: `money.js` — render() 実効化配線・applySurplus ゲート・鮮度/信頼性（_cfFetchedAt 等）・2 タブ再編・ヒーロー・ダイジェスト折りたたみ
- Modify: `money.css` — タブバー・ヒーロー・ダイジェスト折りたたみ・自動連動バッジ（テーマ D 準拠＝モック写経）
- Modify: `.github/workflows/cashflow-pull.yml` — cron 日次化（1行）
- Modify: `tests/money-rules.test.js` / `tests/fixtures/advice_facts_cases.json` / `tests/test_advice_facts.py`
- Test harness: `scratchpad/cockpit-e2e.js`（新規・Playwright スモーク。既存 `scratchpad/mock_prod_server.py` 型の fetch モックパターンを流用）

**タスク順序**: A1→A2→A3→A4（ロジック＋パリティ）→ A5（money.js 配線）→ B1→B2→B3（信頼性）→ D1→D2→D3（タブ再編）→ C1（cron）→ E1（統合検証）→ E2（敵対レビュー→デプロイ準備）

---

### Task A1: money-rules.js — cashSource 導出 migration ＋ effectiveState 純関数

**Files:**
- Modify: `money-rules.js`（migrate ≈:333・cashDerived 直後 ≈:1061 に新関数・公開 ≈:1349）
- Test: `tests/money-rules.test.js`（末尾に追記）

**Interfaces:**
- Produces: `R.effectiveState(s, cashflowRows, investmentRows, nowMs) -> state`
  — anchor 未設定（`!s.anchor.date`）／rows 空／`cashDerived(...).anchorConfigured===false` のとき**入力 `s` をそのまま返す（同一参照＝no-op 証明）**。適用時は `buffer.amount = r(cd.derivedCash)` に差し替えた**shallow copy**（`s`・`s.buckets`・`s.buckets.buffer` を新オブジェクトに、他キーは参照共有）を返す。丸めヘルパは cashflowDerived が使う既存 `r`（half-up・この1回のみ適用）。
- Produces: migrate 後の `state.cashSource` は **anchor.date の有無から導出**（`normalizeAnchor(raw.anchor).date ? "anchor" : "manual"`）。raw の値は無視（dead フラグの一本化。基準解除＝editAnchor で date="" になれば自動で manual）。`investmentSource` は現行のまま。

- [ ] **Step 1: 失敗するテストを書く**（`tests/money-rules.test.js` 末尾に追記。既存 test() のスタイル・require 方法は同ファイル冒頭に合わせる）

```js
test("effectiveState: anchor設定+確定rowsで buffer 実効値が derivedCash になる（保存stateは不変）", () => {
  const s = R.migrate({ anchor: { date: "2026-07-01", amount: 1000000 },
    buckets: { buffer: { amount: 111 }, core: { amount: 50 }, satellite: { amount: 0 } } });
  const rows = [{ period: "2026-07-01", balance: 70000, is_complete: true, pulled_at: "2026-08-02T21:50:28Z" }];
  const eff = R.effectiveState(s, rows, [], 1754400000000);
  assert.equal(eff.buckets.buffer.amount, 1070000);
  assert.equal(s.buckets.buffer.amount, 111);          // 保存 state 不変
  assert.equal(eff.buckets.core, s.buckets.core);       // 他バケツは参照共有
  assert.notEqual(eff, s);
});
test("effectiveState: no-op 3経路は同一参照を返す", () => {
  const sManual = R.migrate({ buckets: { buffer: { amount: 500 } } });   // anchor 無し
  const rows = [{ period: "2026-07-01", balance: 1, is_complete: true }];
  assert.equal(R.effectiveState(sManual, rows, [], 0), sManual);
  const sAnchor = R.migrate({ anchor: { date: "2026-07-01", amount: 100 } });
  assert.equal(R.effectiveState(sAnchor, [], [], 0), sAnchor);           // rows 空
  assert.equal(R.effectiveState(sAnchor, null, [], 0), sAnchor);         // rows 不正
});
test("effectiveState: invest_cash_flow を合算し r() は1回だけ", () => {
  const s = R.migrate({ anchor: { date: "2026-07-01", amount: 100000.4 } });
  const rows = [{ period: "2026-07-01", balance: 1000.3, is_complete: true }];
  const inv = [{ period: "2026-07-01", invest_cash_flow: -500 }];
  const eff = R.effectiveState(s, rows, inv, 0);
  assert.equal(eff.buckets.buffer.amount, Math.round(100000.4 + 1000.3 - 500)); // 単一丸め＝合算後1回
});
test("migrate: cashSource は anchor.date から導出（raw値は無視）", () => {
  assert.equal(R.migrate({ anchor: { date: "2026-07-01", amount: 1 } }).cashSource, "anchor");
  assert.equal(R.migrate({ anchor: { date: "2026-07-01", amount: 1 }, cashSource: "manual" }).cashSource, "anchor");
  assert.equal(R.migrate({ cashSource: "anchor" }).cashSource, "manual"); // anchor 無しは常に manual
});
```

- [ ] **Step 2: 失敗確認** — Run: `node --test tests/money-rules.test.js` → 新規4件 FAIL（`effectiveState is not a function` ほか）・既存72+緑のまま。
- [ ] **Step 3: 実装**

```js
// migrate ≈:333 の1行を置換（normalizeAnchor 済みの値を使うため、既存 :335 の anchor 正規化より前に
// 導出する場合は normalizeAnchor(raw.anchor) を直接呼ぶ）:
cashSource: normalizeAnchor(raw.anchor).date ? "anchor" : "manual",
```

```js
// cashDerived（:1035-1061）の直後に追加:
// 実効値方式（spec §2.1）: 基準（アンカー）設定済み＋確定rowsありなら buffer の実効値を
// r(derivedCash) に差し替えたコピーを返す。保存 state は不変（LWW 安全）。適用不能は入力を
// そのまま返す（同一参照＝完全 no-op が後方互換の機械証明点）。丸めはここで1回のみ（par-2）。
function effectiveState(s, cashflowRows_in, investmentRows_in, nowMs) {
  if (!s || !s.anchor || !s.anchor.date) return s;
  if (!Array.isArray(cashflowRows_in) || !cashflowRows_in.length) return s;
  var cd = cashDerived(cashflowRows_in, investmentRows_in, s.anchor, nowMs);
  if (!cd.anchorConfigured) return s;
  var eff = {};
  for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) eff[k] = s[k];
  eff.buckets = {
    buffer: { amount: r(cd.derivedCash) },
    core: s.buckets.core,
    satellite: s.buckets.satellite,
  };
  return eff;
}
```

公開 API（≈:1349 の export 群）に `effectiveState: effectiveState,` を追加。※ `r` が cashflowDerived 内ローカルの場合はモジュールスコープへ引き上げ（既存呼出は不変）。

- [ ] **Step 4: 成功確認** — Run: `node --test tests/money-rules.test.js` → 全緑（既存回帰含む）。
- [ ] **Step 5: Commit** — `git add money-rules.js tests/money-rules.test.js && git commit -m "feat(cockpit): effectiveState 純関数＋cashSource を anchor 由来に一本化（実効値方式・保存state不変）"`

---

### Task A2: advice.py — anchor/cashSource 保持・_normalize_anchor・_cash_derived・_effective_state（鏡像）

**Files:**
- Modify: `api/me/advice.py`（`_migrate` ≈:455-473・`_cashflow_derived` ≈:732 の手前に新関数群）
- Test: `tests/test_advice_facts.py`（末尾に追記）

**Interfaces:**
- Consumes: JS 仕様＝`money-rules.js` の `normalizeAnchor`（:306-312）・`cashDerived`（:1035-1061）・Task A1 の `effectiveState`。**実装前に必ず JS 本体を読み、分岐・境界（YYYY-MM→月初スナップ・不正date→""・負amount→0・アンカー月より前の period 除外・isComplete のみ加算）を1対1で写す**。
- Produces:
  - `_normalize_anchor(a) -> {"date": str, "amount": num}`（JS normalizeAnchor 鏡像・正規表現は ASCII `[0-9]`）
  - `_cash_derived(cf_rows, inv_rows, anchor, now_ms) -> {"anchorConfigured": bool, "derivedCash": num, "derivedCashLive": num, "monthsCovered": int}`（cf_rows は do_POST が読む cashflow_snapshots 行 dict・inv_rows は _read_investment_ledger 行。period 昇順ソートは JS cashflowRows と同流儀）
  - `_effective_state(s, cf_rows, inv_rows, now_ms) -> dict`（JS effectiveState 鏡像・no-op 時は入力 dict をそのまま返す・適用時は buckets を差し替えた shallow copy・丸めは既存 `_r` を合算後1回）
  - `_migrate` の出力に `"anchor": _normalize_anchor(raw.get("anchor"))` と `"cashSource": "anchor" if <normalize後のdate非空> else "manual"` を追加（現在は両キーとも drop している）。

- [ ] **Step 1: 失敗するテストを書く**（`tests/test_advice_facts.py` 末尾・既存の import 方法に合わせる）

```python
def test_cash_derived_mirror_basic():
    cf = [{"period": "2026-07-01", "balance": 70000, "is_complete": True}]
    cd = advice._cash_derived(cf, [], {"date": "2026-07-01", "amount": 1000000}, 0)
    assert cd["anchorConfigured"] is True
    assert cd["derivedCash"] == 1070000
    assert cd["monthsCovered"] == 1

def test_effective_state_noop_paths():
    s = advice._migrate({"buckets": {"buffer": {"amount": 500}}})
    cf = [{"period": "2026-07-01", "balance": 1, "is_complete": True}]
    assert advice._effective_state(s, cf, [], 0) is s          # anchor無し
    s2 = advice._migrate({"anchor": {"date": "2026-07-01", "amount": 100}})
    assert advice._effective_state(s2, [], [], 0) is s2        # rows空

def test_effective_state_applies_and_migrate_keeps_anchor():
    s = advice._migrate({"anchor": {"date": "2026-07", "amount": 100000.4},   # YYYY-MM→月初スナップ
                         "buckets": {"buffer": {"amount": 111}}})
    assert s["anchor"]["date"] == "2026-07-01"
    assert s["cashSource"] == "anchor"
    cf = [{"period": "2026-07-01", "balance": 1000.3, "is_complete": True}]
    inv = [{"period": "2026-07-01", "invest_cash_flow": -500}]
    eff = advice._effective_state(s, cf, inv, 0)
    assert eff["buckets"]["buffer"]["amount"] == advice._r(100000.4 + 1000.3 - 500)
    assert s["buckets"]["buffer"]["amount"] == 111
```

- [ ] **Step 2: 失敗確認** — Run: `.venv/bin/python -m pytest tests/test_advice_facts.py -q` → 新規3件 FAIL・既存緑。
- [ ] **Step 3: 実装** — 上記 Interfaces どおり。`_normalize_anchor`／`_cash_derived` は JS 本体を読みながら1対1移植（例: `if r_period[0:7] < anchor_ym: continue`・live/complete の2積算・icf dict）。`_migrate` に2キー追加。
- [ ] **Step 4: 成功確認** — Run: pytest 全緑 ＋ `python -m py_compile api/me/advice.py` ＋ `ruff check api/me/advice.py`。
- [ ] **Step 5: Commit** — `git commit -m "feat(advice): _normalize_anchor/_cash_derived/_effective_state 鏡像＋_migrate が anchor/cashSource を保持"`

---

### Task A3: facts 実効化の両側配線＋`cashSource` キー＋SCHEMA_VERSION 5→6（lockstep・既存65ケース不変）

**Files:**
- Modify: `money-rules.js`（`FACTS_SCHEMA_VERSION` ≈:15・`modeAFacts` ≈:1126 冒頭）
- Modify: `api/me/advice.py`（`SCHEMA_VERSION` ≈:31・`mode_a_facts` ≈:1074 冒頭・`coarsen_facts` ≈:1308）
- Modify: `tests/money-rules.test.js`（PROD_TOP_KEYS ≈:205-218）
- Test: 既存 fixture 65 ケースがそのまま緑であること自体がこのタスクの回帰ゲート

**Interfaces:**
- Consumes: `effectiveState`（A1）／`_effective_state`（A2）。modeAFacts の `opts` は既に `cashflow`（rows）と `investmentRows` を受けている（:1135）＝**署名変更なし**。
- Produces: facts トップレベルに `cashSource: "anchor"|"manual"`（production 許可・enum・coarsen 素通し）。modeAFacts／mode_a_facts は**冒頭の migrate 直後に実効化を1回だけ適用**し、以降の全 buffer 由来値（bufferProgressPct/totalAssets/goals/cashflow ブロック…）が実効値で計算される。

- [ ] **Step 1: 失敗するテストを書く**（JS 側）

```js
test("modeAFacts: anchorモードで bufferProgressPct が実効値由来・cashSource=anchor", () => {
  const s = R.migrate({ anchor: { date: "2026-07-01", amount: 600000 },
    monthlyExpense: 100000, bufferMonths: 6,           // 目標 600000
    buckets: { buffer: { amount: 0 }, core: { amount: 0 }, satellite: { amount: 0 } } });
  const rows = [{ period: "2026-07-01", balance: 0, is_complete: true }];
  const f = R.modeAFacts(s, { cashflow: rows, investmentRows: [], nowMs: 0 });
  assert.equal(f.cashSource, "anchor");
  assert.equal(f.bufferProgressPct, 100);              // 実効 600000/600000（保存値0のままなら0になるはず）
});
test("modeAFacts: manual（anchor無し）は cashSource=manual・従来値", () => {
  const f = R.modeAFacts(R.migrate({}), {});
  assert.equal(f.cashSource, "manual");
});
```

※ `opts` のキー名（cashflow/investmentRows/nowMs）は modeAFacts 実装（:1126-1135）を読み、**実在の名前に合わせて**書くこと。

- [ ] **Step 2: 失敗確認** — node --test → 新規 FAIL（cashSource undefined）。
- [ ] **Step 3: 実装（両側同時）**
  - JS: `FACTS_SCHEMA_VERSION` 5→6。modeAFacts 冒頭（migrate 直後）に `s = effectiveState(s, opts の cashflow rows, opts の investmentRows, nowMs);` を挿入し、facts に `cashSource: s.cashSource,` を追加。**production DENYLIST（tests :220-224）に生額キーを足さないこと**。
  - Py: `SCHEMA_VERSION` 5→6。mode_a_facts 冒頭（_migrate 直後）に `s = _effective_state(s, cf_rows, inv_rows, now_ms)`（cf_rows/inv_rows は do_POST が既に取得し mode_a_facts へ渡している変数名に合わせる。渡っていなければ引数を追加し呼出側 :1472-1490 付近を配線）。facts に `"cashSource": s["cashSource"]`。`coarsen_facts` は enum 素通し（変更不要なら確認のみ・allowlist 方式なら追加）。
  - `tests/money-rules.test.js` PROD_TOP_KEYS に `"cashSource"` を追加。
- [ ] **Step 4: 成功確認** — `node --test tests/money-rules.test.js` 全緑（**既存 fixture 65 ケース不変で緑＝no-op 証明**）＋ pytest 全緑（lockstep version テスト含む）。
- [ ] **Step 5: Commit** — `git commit -m "feat(facts): 実効値適用＋cashSource enum＋SCHEMA_VERSION 6 lockstep（既存65ケース不変）"`

---

### Task A4: anchor モードのパリティ fixture 追加＋fuzz 再実証

**Files:**
- Modify: `tests/fixtures/advice_facts_cases.json`（既存パターン踏襲・tests/money-rules.test.js:192-233 と tests/test_advice_facts.py:21,229 が全ケースを両言語で照合する仕組みに乗せる）
- Test: 両テストが新ケースを自動で拾う

**Interfaces:**
- Consumes: A3 までの facts 経路（opts に cashflow/investmentRows を渡す形は既存 cashflow-* ケースが手本）。

- [ ] **Step 1: 新ケースを設計し fixture に追加（期待値は一旦仮置き）**。ケース名と入力の骨子（金額は境界検証を含む）:
  - `anchor-live-basic`: anchor{2026-07-01, 1,000,000}・rows=[7月 balance 70,000 complete]・buffer 保存値 111 → 実効 1,070,000（bufferProgressPct 等が実効値由来）
  - `anchor-unachieved`: 目標 1,320,000・実効 700,000 → Pct 53（half-up 境界は .5 を含む金額で）
  - `anchor-halfup-boundary`: anchor amount 599,999.5・balance 0 → r() half-up の 600,000 化を固定
  - `anchor-no-rows-degrade`: anchor 設定済み・rows=[] → manual 挙動（保存値のまま）・cashSource は "anchor"（フラグと実効の独立を固定）
  - `anchor-invest-cashflow`: inv rows の invest_cash_flow 合算（負値）
  - `anchor-adversarial`: anchor.amount="NaN"／date="2026-13" 等の敵対 coercion（normalizeAnchor が落とすこと）
- [ ] **Step 2: 期待値生成** — JS 還元器で期待 facts を生成して fixture に確定（既存ケース追加時と同じ手順: `node -e` で `R.modeAFacts(input, opts)` を JSON 出力→目視妥当性確認→fixture へ）。
- [ ] **Step 3: 両言語で緑を確認** — `node --test tests/money-rules.test.js` ＋ pytest 全緑（Python 鏡像が同じ facts を出す＝パリティ機械証明）。
- [ ] **Step 4: parity fuzz** — 既存 fuzz スクリプト（scratchpad の b2-parity-fuzz 系が手本）を anchor フィールドを含む乱数 state で 600 比較実行し mismatch 0 を確認。実行コマンドと結果件数をコミットメッセージに記録。
- [ ] **Step 5: Commit** — `git commit -m "test(parity): anchorモード fixture 6ケース＋fuzz600 mismatch0"`

---

### Task A5: money.js 配線 — render 実効化・applySurplus ゲート・バッファ欄 read-only 化

**Files:**
- Modify: `money.js`（render ≈:1593-1599・applySurplus :218-235・バケツ欄 ≈:1626・cashflowSection 内 anchor ブロック :748-767）
- Modify: `money.css`（`.mcc-auto-badge` 追加のみ）
- Test: `scratchpad/cockpit-e2e.js`（新規・後述の検証ステップで作成）

**Interfaces:**
- Consumes: `R.effectiveState`（A1）。
- Produces: render() 冒頭で `var now = Date.now(); var eff = R.effectiveState(state, _cashflowRows, _investmentRows, now); var anchorLinked = (eff !== state);` を生成し、**viewModel/cashflowViewModel/cashflowDerived/roadmap/nisaViewModel/onboardingSteps への state 引数をすべて `eff` に**（cashDerived の第3引数 anchor も `eff.anchor`）。`anchorLinked` は後続タスク（D2 ヒーロー）も参照する module 変数 `_anchorLinked` に保存。

- [ ] **Step 1: 配線実装**
  - render(): 上記のとおり。derivedCash の算出は render 冒頭の1回（`var cdMain = R.cashDerived(...)`）に統合し、cashflowSection（:748）と reservesSection（:820）へは引数渡しに変更（2重算出の解消）。
  - applySurplus（:218）: 先頭に防衛ゲートを追加＋UI 側もボタン非表示:

```js
// anchor連動中は buffer/core への加算が二重計上になる（derivedCash が当該月 balance を既に含む）
if (R.effectiveState(state, _cashflowRows, _investmentRows, Date.now()) !== state) return;
```

  cashflowSection の applyBtn 生成（:716-718 付近）を `_anchorLinked` 分岐にし、連動中は `<div class="mcc-cf-autonote">基準連動中は貯蓄額が自動追従するため反映操作は不要です</div>` を表示。
  - バケツ欄（:1626）: `_anchorLinked` のとき buffer 行を `<div class="mcc-bucket-auto"><span class="mcc-auto-badge">自動連動中</span> ¥<実効値> <button class="mcc-jump" onclick="MCC.jumpTo('cashflow')">基準を変更</button></div>`（read-only 表示）に、未連動時は現行 input。fallback（未ログイン/rows無し）は現行 input のまま＋「ログインすると自動算出」注記1行。
- [ ] **Step 2: unit 無回帰** — `node --test tests/money-rules.test.js` 全緑（money.js は unit 対象外だが R 呼出契約が変わっていないことの確認として）。
- [ ] **Step 3: E2E スモーク作成＋実行** — `scratchpad/cockpit-e2e.js` を新規作成（Playwright・`python3 -m http.server` でリポ直下配信＋`page.route` で `/api/auth/session`→`{ok:true}`・`/api/me/state`→anchor 設定済み state・`/api/me/cashflow`→7月 complete rows・`/api/me/investment`→`[]` をモック。既存ハーネス `scratchpad/detail-snapshot.js` の起動パターンを流用）。アサート:
  1. バッファ達成率ゲージの表示値が実効値由来（例: 100%・¥1,070,000）
  2. バケツのバッファ欄が read-only 表示＋「自動連動中」バッジ
  3. 余剰反映ボタンが無く autonote が出る
  4. anchor 無し state をモックした場合は従来 UI（input・反映ボタン）＝manual 無回帰
  5. pageerror 0
- [ ] **Step 4: Commit** — `git commit -m "feat(cockpit): render実効化配線＋applySurplusゲート＋バッファ自動連動UI"`

---

### Task B1: クライアント取得時刻の可視化（_cfFetchedAt/_cfFetchErr）

**Files:**
- Modify: `money.js`（:38 付近の module 変数・loadCashflow :190-195・loadInvestment :197-202・鮮度行 :738-745）
- Modify: `money.css`（`.mcc-cf-fetchinfo` / `.mcc-cf-fetcherr`）

**Interfaces:**
- Produces: module 変数 `_cfFetchedAt`（ms・0=未取得）/`_cfFetchErr`（""=正常）。鮮度行に「この端末での最終取得: N分前」（`fmtAgo(ms)` 新設・<60s は「たった今」・<60m は「N分前」・以降「N時間前」「N日前」）と、`_cfFetchErr` 非空時の警告行。後続 B3 が `_cfFetchedAt` を TTL 判定に使う。

- [ ] **Step 1: 実装**

```js
function loadCashflow() {
  return apiJSON("GET", "/api/me/cashflow").then(function (res) {
    if (res.ok && res.data && Array.isArray(res.data.cashflow)) {
      _cashflowRows = res.data.cashflow; _cfFetchedAt = Date.now(); _cfFetchErr = "";
    } else if (res.status === 401) { sync.loggedIn = false; _cfFetchErr = "セッションが切れています"; }
    else { _cfFetchErr = "更新に失敗しました（HTTP " + res.status + "）・直前のデータを表示中"; }
  }).catch(function () { _cfFetchErr = "通信エラー・直前のデータを表示中"; });
}
```

loadInvestment も同型（時刻/エラーは同じ変数を共有でよい＝ユーザー向けには「データ取得」1概念）。鮮度行（:738-745）に `<span class="mcc-cf-fetchinfo">この端末での最終取得: ' + fmtAgo(_cfFetchedAt) + '</span>` を追加し、`_cfFetchErr` 非空なら `<div class="mcc-cf-fetcherr">⚠ ' + esc(_cfFetchErr) + '</div>`。既存の「最終取得 N日前」（ETL pulled_at 由来）は「クラウド更新: N日前（毎日 朝6時ごろ自動）」へ文言変更（C1 の日次化前提の文言はこのタスクで先に入れてよい）。
- [ ] **Step 2: E2E** — `scratchpad/cockpit-e2e.js` に追加: 正常時 fetchinfo 表示／`/api/me/cashflow` を 500 でモックした再取得後に fetcherr 表示＋rows 温存（¥表示が消えない）。
- [ ] **Step 3: Commit** — `git commit -m "feat(cockpit): この端末での最終取得時刻と取得失敗の可視化"`

---

### Task B2: 死にボタン解消＋背景401の可視化

**Files:**
- Modify: `money.js`（refreshData :207-213・cloudFlush 401 分岐 :110・repaintSyncBar 群 :254-266）

**Interfaces:**
- Consumes: B1 の `_cfFetchErr`。
- Produces: `repaintStaleNotice()`＝id `mcc-cf-fetchnote`（B1 で鮮度行に付与）だけを差分更新する部分描画（フルrender しない＝入力フォーカス保護維持）。

- [ ] **Step 1: 実装**

```js
function refreshData() {
  if (_refreshing) return;
  if (!sync.loggedIn) {                    // 死にボタン→再ログイン導線（無言 return を廃止）
    _cfFetchErr = "セッションが切れています。再ログインしてください";
    render(); jumpTo("sync"); return;
  }
  ...既存...
}
```

cloudFlush の 401 分岐（:110）: `repaintSyncBar()` に加え `_cfFetchErr = "セッションが切れています..."; repaintStaleNotice();` を追加（収支セクションの鮮度行に警告が出る＝古い額の残留が「切れている」と分かる）。
- [ ] **Step 2: E2E** — ①ログイン状態で描画→ `/api/me/state` PUT を 401 にして編集保存→鮮度行に警告が出る（フル再描画無しで）②`sync.loggedIn=false` の状態で ↻ ボタン相当（`MCC.refreshData()`）→ ログイン欄へスクロール＋flash・警告表示。
- [ ] **Step 3: Commit** — `git commit -m "fix(cockpit): 更新ボタンの無言no-op廃止＋背景401を鮮度行に可視化"`

---

### Task B3: タブ復帰時の自動再取得（TTL 10分）

**Files:**
- Modify: `money.js`（visibilitychange :1748-1750・checkSession/_sessionChecked :275-290, :484-490）

**Interfaces:**
- Consumes: `_cfFetchedAt`（B1）・`refreshData`（B2）。
- Produces: visible 復帰時、money ビュー表示中＋`Date.now()-_cfFetchedAt > 600000` なら `checkSession()` 後に自動 `refreshData()`。

- [ ] **Step 1: 実装** — 既存 listener を拡張:

```js
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") { cloudFlushBeacon(); return; }
  // visible 復帰: 10分以上古ければセッション再確認→再取得（開きっぱなしタブの古データ対策）
  if (document.getElementById("money-view") && document.getElementById("money-view").classList.contains("active")
      && sync.loggedIn && _cfFetchedAt && Date.now() - _cfFetchedAt > 600000) {
    checkSession().then(function () { if (sync.loggedIn) refreshData(); else render(); });
  }
});
```

※ checkSession が Promise を返さない実装なら then 可能な形に整える（既存呼出 :486-489 の互換維持）。
- [ ] **Step 2: E2E** — `_cfFetchedAt` を古い値に注入→`document.dispatchEvent(new Event("visibilitychange"))`（visibilityState は Playwright の `page.evaluate` で `Object.defineProperty` スタブ）→ `/api/me/cashflow` が再フェッチされること（route カウンタ）。
- [ ] **Step 3: Commit** — `git commit -m "feat(cockpit): タブ復帰時の自動再取得（TTL10分・セッション再確認付き）"`

---

### Task D1: 2タブ骨格（ダッシュボード／設定・ガイド）＋機械的再配置

**Files:**
- Modify: `money.js`（render :1578-1697・jumpTo :1516-1526・_JUMP_TARGETS :1510）
- Modify: `money.css`（タブバー＝モックの `.mcc-tabbar` 系を写経）

**Interfaces:**
- Produces: `_activeTab`（"dash"|"config"・localStorage `mcc_tab` 保持）・`switchTab(name)`（公開 API 追加→`MCC.switchTab`）・render() は `tabBar() + '<div id="mcc-tab-dash"' + (dash時 '' : ' hidden') + '>' + <ダッシュボード連結> + '</div>' + '<div id="mcc-tab-config"' + ... + '>' + <設定連結> + '</div>'`。
  - ダッシュボード側（この時点では既存セクションを機械的に振り分けるだけ・見た目の再設計は D2/D3）: syncBar / saveWarn / stepper / gauge / banner / roadmap / assetClass(入力details含む・移動はD3) / nisa / cashflow / reserves / advice / goals
  - 設定側: guide / buckets / settings / tools
  - `jumpTo(key)`: `_JUMP_TARGETS` に各 key の属するタブを持たせ、`switchTab(そのタブ)` してからスクロール（`<details>` open・flash は現行踏襲）。
- **中央ルーターの `#money` ハッシュ・`show()`/`backToPortal()` は無改造**。タブは #mcc-root 内部状態。

- [ ] **Step 1: 実装** — 上記。タブバーの視覚は `docs/superpowers/specs/assets/2026-08-05-mock-hybrid.html` の `.tabbar`/`.tab` CSS を `.mcc-tabbar`/`.mcc-tab` として money.css に移植（`[data-theme="D"] #money-view` スコープ）。
- [ ] **Step 2: E2E** — タブ切替（クリック→hidden 切替・localStorage 保持・リロード後復元）／jumpTo("settings")（config タブへ自動切替＋details open＋flash）／jumpTo("cashflow")（dash タブへ）／既存ガイド内 6 リンクが全て動く／pageerror 0。
- [ ] **Step 3: Commit** — `git commit -m "feat(cockpit): #mcc-root 内2タブ骨格（dash/config）＋jumpToタブ対応"`

---

### Task D2: ダッシュボードヒーロー＋重複3系統の統合

**Files:**
- Modify: `money.js`（新関数 `heroSection(vm, cv, cd)`・banner/advice 決定論行の整理・cashflowSection から anchor 表示ブロックをヒーローへ移動）
- Modify: `money.css`（ヒーロー＝モックの hero 系 CSS を写経）

**Interfaces:**
- Consumes: `_anchorLinked`・render 冒頭の `eff/vm/cv/cdMain`（A5）・`_cfFetchedAt/_cfFetchErr`（B1）。
- Produces: `heroSection()`＝モック「ダッシュボード」タブのヒーローと同構成:
  - 左: 確定貯蓄額 `cdMain.derivedCash`（anchor 連動時）または `vm.bufferAmount`（manual・ラベルは「バッファ（現金）」）＋基準内訳行（`基準=2026年7月のはじめ ¥X ＋ 確定Nヶ月 +¥Y`）＋**当月込み参考値 `cdMain.derivedCashLive`**（「暫定・毎日自動更新」チップ・確定値と差が無いときは非表示）
  - 右: バッファ達成率バー（`vm.bufferProgressPct`・anchor 連動時は「収支連携から自動算出」バッジ）＋投資余力 `cv.investableSurplus`＋次の一手（`vm.next.message`）
  - 下端: 鮮度行（B1 の fetchinfo/fetcherr＋クラウド更新表記＋↻ボタン移設）
  - 未ログイン時: 保存値ベース表示＋「ログインすると自動算出・収支が反映されます → ログイン」（jumpTo("sync")）
- **重複統合**: ①`banner`（:1613-1617）を廃止し次の一手はヒーローのみ（adviceSection の決定論行 :612-614 は AI カード文脈なので残す）②配分ウォーターフォールチップは cashflowSection のみに（`_rmThisMonth` :914-923 からチップを削除しテキスト1行に）③cashflowSection 内の anchor 自動算出ブロック（:748-767）は削除しヒーローへ一本化（**anchor 設定フォーム（未設定時 :758-766）は config タブの「貯蓄の基準」カードへ移設**＝D3）。

- [ ] **Step 1: 実装**（マークアップ詳細はモック写経・ダミー値を実 VM 値に置換）
- [ ] **Step 2: E2E** — anchor 連動モック: ヒーローに確定額/参考値/自動算出バッジ/次の一手/鮮度行が出る・banner が無い・チップ重複が無い。manual モック: ヒーローが保存値表示＋設定誘導。pageerror 0。
- [ ] **Step 3: Commit** — `git commit -m "feat(cockpit): ダッシュボードヒーロー（確定/参考/達成率/次の一手/鮮度）＋重複3系統統合"`

---

### Task D3: ダイジェスト折りたたみ6本＋入力系の設定タブ移設＋details 全id化

**Files:**
- Modify: `money.js`（各セクション関数の再構成）
- Modify: `money.css`（`.mcc-fold` ダイジェスト折りたたみ＝モック写経）

**Interfaces:**
- Consumes: D1 のタブ骨格・D2 のヒーロー。
- Produces:
  - ダッシュボード＝ヒーロー直下に `<details class="mcc-fold" id="...">` 6本（summary に1行ダイジェスト）:
    1. `mcc-sec-cashflow` 収支の詳細（**既定 open**・digest 例 `fmtAnchorMonth(cv.latestPeriod)+" "+yen(cv.monthlySurplus)+"・貯蓄率"+cv.savingsRatePct+"%"`）＝4stat/スパークライン/カテゴリ/ウォーターフォール/鮮度詳細
    2. `mcc-sec-roadmap` ロードマップ（digest=現フェーズ名）
    3. `mcc-sec-nisa` NISA（digest=生涯残・つみたて%。**入力 details は config へ移設**）
    4. `mcc-sec-assets` 資産クラス（digest=上位3クラス%。**保有額入力15欄・生年入力は config へ移設**）
    5. `mcc-sec-reserves-goals` 確保枠・資産目標（reservesSection＋goalsSection を1カードに統合表示・**追加フォーム2つは config へ**）
    6. `mcc-sec-advice` AIコーチ（相談ボタン・応答・免責は現行のまま）
  - 設定・ガイドタブ＝カード順: 貯蓄の基準（anchor フォーム＋設定済み表示＋基準を変更）／月の生活費（実支出平均採用含む settings）／バケツ保有額（A5 の自動連動表示含む buckets）／資産クラス入力／NISA入力／確保枠・目標の追加フォーム／エクスポート・インポート（tools）／ガイド・用語集（guide）
  - `<details>` 開状態保持: 既存機構（:1671-1682）を全 fold の id に適用（guide にも `mcc-sec-guide`、確保枠編集にも `mcc-rsv-edit-<id>` を付与）＋ fold の既定 open は「保存された開閉が無いときのみ収支 open」。
  - `_JUMP_TARGETS` 更新（reserves-goals 統合・assets/nisa の入力系 key は config タブへ）。
- [ ] **Step 1: 実装**（セクション関数は「表示部」と「入力部」に分割し、表示部→dash fold・入力部→config カードに配置換え。**業務ロジック・計算は一切変更しない**＝表示の再配置のみ）
- [ ] **Step 2: E2E** — fold 6本の digest 文字列・開閉保持（リロード復元）・入力系が dash に無い・config タブに全入力がある・stepper/オンボの導線（jumpLink）がタブを跨いで動く・pageerror 0。**manual モード（anchor無し）でも全 UI が成立**（従来入力が config で可能・dash は保存値表示）。
- [ ] **Step 3: Commit** — `git commit -m "feat(cockpit): ダイジェスト折りたたみ6本＋入力系を設定・ガイドタブへ移設＋details全id化"`

---

### Task C1: ETL 日次化

**Files:**
- Modify: `.github/workflows/cashflow-pull.yml`（cron 1行）

- [ ] **Step 1: 変更** — `cron: "0 21 2 * *"` → `cron: "0 21 * * *"`（毎日 06:50 JST 頃・冪等 skip 実測済み: 直後再実行 upsert=0）。yml コメントに「日次＝当月参考値（derivedCashLive）の鮮度用・確定は月次で従来どおり」を追記。
- [ ] **Step 2: 検証** — `python -c "import yaml,sys;yaml.safe_load(open('.github/workflows/cashflow-pull.yml'))"` で構文確認（デプロイ後に `gh workflow run cashflow-pull.yml` 1回疎通は E2 で）。
- [ ] **Step 3: Commit** — `git commit -m "chore(etl): cashflow-pull を日次cron化（冪等skip前提・当月参考値の鮮度用）"`

---

### Task E1: 統合検証（全スイート＋統合E2E＋モック比較）

**Files:**
- Test: 全テスト＋`scratchpad/cockpit-e2e.js` 統合実行

- [ ] **Step 1: 全 unit** — `node --test tests/money-rules.test.js`・`node --test tests/finance-rules.test.js tests/detail-rules.test.js`（無回帰確認）・pytest（advice/ETL）全緑。
- [ ] **Step 2: parity fuzz 再実行** — mismatch 0。
- [ ] **Step 3: 統合 E2E** — cockpit-e2e.js 全シナリオ（anchor 連動・manual 無回帰・タブ・ジャンプ・死にボタン解消・visible 復帰・fetcherr）＋ ポータル側スモーク（#portal→#money 遷移・戻る・pageerror 0）。
- [ ] **Step 4: 視覚確認準備** — `python3 -m http.server` でモックと実装（モックデータ注入版）を並べ、太田さん実機比較用 URL を用意（実機確認自体は本人作業）。
- [ ] **Step 5: Commit（fixがあれば）**

---

### Task E2: 敵対レビュー→デプロイ準備（push は本人認可後）

- [ ] **Step 1: 敵対実装レビュー wf**（ultracode・観点=①パリティ/facts 安全（DENYLIST・coarsen・SCHEMA lockstep）②二重計上（applySurplus/材料照合）③タブ再編の無言故障（公開 API・jumpTo・details 保持・未ログイン経路）④信頼性ロジック（TTL/401経路）⑤manual 後方互換）→ HIGH/MED を修正し確定 LOW を反映。
- [ ] **Step 2: ドキュメント** — `.claude/CLAUDE.md` の司令室節に「実効値方式（effectiveState 単一境界・保存値不変・cashSource は anchor 由来）」「2タブ構成」「日次 ETL」を追記。Obsidian 所有ノート更新は統合セッション（本セッション）が push 後に実施。
- [ ] **Step 3: 本人確認** — push 認可を得て main へ merge→push（2プロジェクト自動デプロイ・追加 env 不要）→ 本番 curl（money.js に `effectiveState`/`mcc-tabbar` マーカー・両 URL byte 一致）→ `gh workflow run cashflow-pull.yml` 疎通 → 本人実機サニティ（ログイン×収支・タブ・自動連動）。

---

## Self-Review 結果（plan 作成時実施）

- **Spec coverage**: §2実効値連動=A1-A5／§3信頼性=B1-B3＋（details id は D3）／§4日次ETL=C1＋ヒーロー参考値は D2／§5 H1=D1-D3／§6検証=各タスク＋E1-E2／§7-8=E2 とタスク内注記。ギャップ無し。
- **Placeholder scan**: 「モック写経」はin-repoの具体物参照（assets/2026-08-05-mock-hybrid.html）＝可。行番号は現 HEAD（15d5c55）基準の目安であり、実装者は必ず実ファイルを読んで位置を確定すること。
- **Type consistency**: `effectiveState`/`_effective_state`・`_cfFetchedAt`/`_cfFetchErr`・`_anchorLinked`・`switchTab`・fold id 群は全タスクで同名。
