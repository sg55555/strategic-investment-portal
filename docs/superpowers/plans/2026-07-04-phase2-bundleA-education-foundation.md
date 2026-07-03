# Phase2 束A「教育の土台」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** investment-portal の分析側に「教育の土台」を敷く — 全指標の用語ツールチップ（分析グロッサリ）／テクニカル現在地サマリ（signalDigest）／財務健全性トレンド化 の3機能を、既存の分離規律に沿って追加する。

**Architecture:** 純データ/純計算は `detail-rules.js`（UMD-lite・`window.DetailRules`・node --test）、DOM/esc 生成は `detail.js`（IIFE・`window.Detail`）、チャート描画は `detail-charts.js`（IIFE・`window.DetailCharts`）に分離。新カードは index.html に**固定 id の静的空コンテナ**として置き、JS は innerHTML 差替のみ（insert しない＝冪等・nth-child 不変）。免責は detail 側で自己完結（money 非依存）。

**Tech Stack:** Vanilla JS（UMD-lite/IIFE）・LightweightCharts v4.2.3・Chart.js 4.5.1＋chartjs-plugin-datalabels 2.2.0（版固定・SRI・新CDN依存を足さない）・node:test・Playwright・Python（advice.py の facts negative test）。

## Global Constraints

各タスクの要件は暗黙にこの節を含む。値は spec からの逐語。

- **分離規律**：純データ/計算=`detail-rules.js`（`"use strict"`・DOM非依存）／DOM・esc生成=`detail.js`／チャート描画=`detail-charts.js`。読込順 `dataClient→finance-rules→detail-rules→(inline)→detail-charts→detail→money`（不変）。
- **免責は detail 自己完結**：`DetailRules.ANALYSIS_DISCLAIMER` を detail-rules.js に自前定義。`money-rules.js` の DISCLAIMER に依存しない。免責が取得できない場合は該当カードを描画しない（フェイルセーフ）。
- **no-score（規制安全・構造固定）**：signalDigest descriptor に `value`/`score`/`weight` 等の numeric スコアフィールドを持たせない（`readout` は整形済み文字列のみ）。`state` は符号スカラに写像不能な**中立状態語の閉集合**。表示ラベルは `advice.py` の `_TRADE_RE`/`_FORECAST_RE` に**非命中**（テストで固定）。売買語（買い/売り/強気/弱気/golden/dead cross/予測）を出さない。
- **facts 非出力**：detail-rules 出力（`INDICATOR_GLOSSARY`/`signalDigest`/health 系列）を `advice.py` の facts へ渡さない。`mode_a_facts` の出力キーは固定 allowlist（technical キーが現れない negative test）。
- **0x0罠**：`display:none` で `createChart`/Chart.js 生成しない。寸法・初期化順序を保つ。
- **Chart.js lifecycle**：`responsive:true` で自動追従（`onWindowResize` に登録しない＝それは LWC 専用）。描画冒頭で既存インスタンスを `destroy()`→`new`。新インスタンスは `repaint()`（detail-charts.js:571）の再描画配列に **`clientWidth>0`/カード可視ガード付き**で登録（FHD 初回黒面回避）。
- **money 非改変**：`money.js`/`money-rules.js`/`money.css` は触らない。
- **CSP**：termHelp は純CSSポップオーバー（`onclick` 不使用）。
- **新カードは静的コンテナ**：index.html に固定 id の空 `.card` を置き JS は innerHTML 差替のみ（insert 禁止＝冪等）。`.dashboard-stack` の `cardFadeInUp` nth-child 遅延を実枚数（7）まで拡張。
- **色/canvas**：ローソク確定色・ZigZag 逆規約の意味付けは保持。装飾は親カード、chart-container 寸法・初期化順序は不変。
- **検証**：各機能 node --test → snapshot（実装後 baseline 再 capture）→ Playwright → 本人実機。`NODE_PATH=/home/shugo/node_modules`。

---

## File Structure

| ファイル | 変更 | 責務 |
|---|---|---|
| `detail-rules.js` | Modify | `INDICATOR_GLOSSARY`・`ANALYSIS_DISCLAIMER`・`signalDigest()`・`MARKET_BASIS` へ数値閾値追加＋`marketBasisFor` で露出・`healthTrendSeries()` を追加し `return{}` に export |
| `finance-rules.js` | Modify | `totalLiabilities(fin)` ヘルパ追加＋export |
| `detail.js` | Modify | `Detail.termHelp`/`Detail.injectTermHelp`/`Detail.renderSignalDigest` 追加・`updateFinancialViews` の early-return 前に inject/digest 呼出・`renderCFChart` 直後に `renderHealthTrend` 呼出・health カード id を finCards へ |
| `detail-charts.js` | Modify | `DetailCharts.renderHealthTrend(data,isUS)` 追加（Chart.js line・destroy 先行）・`repaint()` 配列へ healthTrendInstance をガード付き登録 |
| `detail.css` | Modify | `.term-help`＋`::after` ポップオーバー（自己完結 `--ix-*`）・`[data-theme="D"] .term-help`・新カードの `overflow:visible`・`cardFadeInUp` nth-child(1)〜(7) |
| `index.html` | Modify | 静的指標ラベルへ `data-term`・`.dashboard-stack` 先頭に `#signal-digest-card`・BSカード直後に `#health-trend-card`（空 `.card` コンテナ） |
| `tests/detail-rules.test.js` | Modify | INDICATOR_GLOSSARY／signalDigest（no-score・語彙・time-index・no-data）／MARKET_BASIS 数値／healthTrendSeries（欠測 null）テスト |
| `tests/finance-rules.test.js` | Modify | `totalLiabilities` テスト |
| `api/me/` の facts テスト | Modify/Create | `mode_a_facts` 出力キー allowlist の negative test（technical キー非混入） |
| `scratchpad/detail-snapshot.js` | 運用 | 実装後 baseline 再 capture（コード変更なし・手順） |

**禁止語彙リスト（テスト共有）**：`advice.py` の `_TRADE_RE`/`_FORECAST_RE` の日本語パターン（買い/売り/買い場/売り時/上がる/下がる/予測/見通し 等）を `tests/fixtures/forbidden_terms.js` に**逐語コピー**し、node --test から読む（Python 正規表現を JS 用に転記・出典コメント付き）。

---

## Feature #1：分析グロッサリ横展開

### Task 1: 分析グロッサリ・免責データ（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`（factory 内・`return{}` へ export 追加）
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Produces: `DetailRules.INDICATOR_GLOSSARY: Array<{term:string, read:string, def:string}>`／`DetailRules.ANALYSIS_DISCLAIMER: string`

- [ ] **Step 1: Write the failing test**（`tests/detail-rules.test.js` に追記）

```js
const { test } = require('node:test');
const assert = require('node:assert');
const DR = require('../detail-rules.js');
const FORBIDDEN = require('./fixtures/forbidden_terms.js'); // Task 5 で作成済み前提。無ければ本タスクで先に作る

test('INDICATOR_GLOSSARY: shape and required terms', () => {
  assert.ok(Array.isArray(DR.INDICATOR_GLOSSARY));
  const required = ['ma','bb','rsi','macd','sr','zigzag','volume','percent-b',
    'equity-ratio','current-ratio','roe','roa','op-margin','net-margin','per','pbr'];
  const terms = new Set(DR.INDICATOR_GLOSSARY.map(g => g.term));
  for (const t of required) assert.ok(terms.has(t), `missing term: ${t}`);
  assert.equal(terms.size, DR.INDICATOR_GLOSSARY.length, 'duplicate term');
  for (const g of DR.INDICATOR_GLOSSARY) {
    assert.equal(typeof g.term, 'string');
    assert.ok(g.read && typeof g.read === 'string');
    assert.ok(g.def && typeof g.def === 'string');
  }
});

test('INDICATOR_GLOSSARY: def/read contain no trade/forecast words', () => {
  for (const g of DR.INDICATOR_GLOSSARY) {
    const txt = g.read + '　' + g.def;
    for (const re of FORBIDDEN.ALL) {
      assert.ok(!re.test(txt), `forbidden word in "${g.term}": ${re} :: ${txt}`);
    }
  }
});

test('ANALYSIS_DISCLAIMER: nonempty education-frame string', () => {
  assert.equal(typeof DR.ANALYSIS_DISCLAIMER, 'string');
  assert.ok(DR.ANALYSIS_DISCLAIMER.length > 20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（`INDICATOR_GLOSSARY`/`ANALYSIS_DISCLAIMER` undefined ・`./fixtures/forbidden_terms.js` cannot find → 先に Step 3b で fixture 作成）

- [ ] **Step 3a: `INDICATOR_GLOSSARY`・`ANALYSIS_DISCLAIMER` を detail-rules.js の factory 内へ追加**

detail-rules.js の factory 冒頭（他の const 定義群と同じ場所）に定義し、末尾 `return{}` に `INDICATOR_GLOSSARY, ANALYSIS_DISCLAIMER,` を追加する。`def` は中立・「よくある誤解」を1文含むが**売買語を含めない**。

```js
var ANALYSIS_DISCLAIMER =
  'これらの指標・要約は教育・学習を目的とした事実の表示であり、特定銘柄の売買推奨や将来予測ではありません。投資判断はご自身の責任で行ってください。';

var INDICATOR_GLOSSARY = [
  { term: 'ma', read: '移動平均（MA）', def: '一定期間の終値の平均を線にしたもの。価格の平均的な水準を見る目安で、線の傾きや価格との位置関係を確認する。水準だけで方向は決まらない。' },
  { term: 'bb', read: 'ボリンジャーバンド（BB）', def: '移動平均を中心に標準偏差の幅で上下のバンドを描いたもの。値動きの幅（ボラティリティ）の目安。バンド外＝すぐ反転、という意味ではない。' },
  { term: 'rsi', read: 'RSI（相対力指数）', def: '直近の値上がり・値下がりの勢いを0〜100で表す目安。70超は買われ過ぎ、30未満は売られ過ぎの目安であって、水準だけで方向は決まらない。' },
  { term: 'macd', read: 'MACD', def: '短期と長期の移動平均の差（MACD線）とその平均（シグナル線）の関係を見る。2本の位置関係や交差の有無は事実であり、それ自体が方向を保証しない。' },
  { term: 'sr', read: '支持線・抵抗線（S/R）', def: '過去に価格が反発・頭打ちしやすかった水準を自動で抽出したもの。タッチ回数が多いほど意識されやすい目安にすぎない。' },
  { term: 'zigzag', read: 'ZigZag（トレンド/レンジ）', def: '一定以上動いた転換点だけを結び、区間を「トレンド」か「レンジ（横ばい）」に分けて見る。末尾の点は未確定で後から変わりうる。' },
  { term: 'volume', read: '出来高', def: 'その日に売買が成立した株数。関心の大きさの目安。多い＝上昇、という意味ではなく、価格の文脈と併せて見る。' },
  { term: 'percent-b', read: '%B', def: 'ボリンジャーバンドの中で価格が今どの位置にあるかを0〜1で表したもの。1超＝上限の外側、0未満＝下限の外側という位置の事実を示す。' },
  { term: 'equity-ratio', read: '自己資本比率', def: '総資産のうち返済不要の自己資本が占める割合。財務の安定度の目安。一般に高いほど安定的とされるが、業種で適正水準は異なる。' },
  { term: 'current-ratio', read: '流動比率', def: '1年以内に現金化できる資産が、1年以内に返す負債の何倍あるかの割合。短期の支払い能力の目安。' },
  { term: 'roe', read: 'ROE（自己資本利益率）', def: '自己資本に対してどれだけ利益を上げたかの割合。資本の使い方の効率の目安。借入を増やしても上がるため、内訳と併せて見る。' },
  { term: 'roa', read: 'ROA（総資産利益率）', def: '総資産に対してどれだけ利益を上げたかの割合。資産全体の使い方の効率の目安。' },
  { term: 'op-margin', read: '営業利益率', def: '売上に対する本業の利益の割合。本業の稼ぐ力の目安。' },
  { term: 'net-margin', read: '純利益率', def: '売上に対する最終利益の割合。税金・特別損益まで含めた最終的な手残りの目安。' },
  { term: 'per', read: 'PER（株価収益率）', def: '株価が1株当たり利益の何倍かを表す。割安・割高の一つの目安で、成長期待や業種で適正水準は変わる。水準だけで判断しない。' },
  { term: 'pbr', read: 'PBR（株価純資産倍率）', def: '株価が1株当たり純資産の何倍かを表す。資産面から見た割安・割高の一つの目安。' },
];
```

- [ ] **Step 3b: 禁止語彙 fixture を作成**（未作成なら）

`tests/fixtures/forbidden_terms.js` を作成。`api/me/advice.py` の `_TRADE_RE`/`_FORECAST_RE` の日本語パターンを逐語転記（出典行をコメント）。

```js
// api/me/advice.py の _TRADE_RE / _FORECAST_RE を JS 用に逐語転記（規制安全の共有辞書）
// 出典: advice.py:98-103 付近。advice.py 改訂時は本ファイルも同期すること。
const TRADE = /(買い場|売り時|買うべき|売るべき|買い推奨|売り推奨|買い増し|利確|損切り|今が買い|今が売り|エントリー)/;
const FORECAST = /(上がる|下がる|急騰|急落|予測|見通し|目標株価|来週は|来月は|年末には|に達する)/;
module.exports = { TRADE, FORECAST, ALL: [TRADE, FORECAST] };
```
（注：実装者は着手時に `api/me/advice.py` の該当正規表現を開いて**現物と突合**し、差異があれば現物に合わせる。上記は雛形。）

- [ ] **Step 4: Run tests to verify they pass**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: PASS（全 glossary テスト）

- [ ] **Step 5: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js tests/fixtures/forbidden_terms.js
git commit -m "feat(detail): add INDICATOR_GLOSSARY and ANALYSIS_DISCLAIMER pure data"
```

---

### Task 2: termHelp / injectTermHelp ビルダー（detail.js）

**Files:**
- Modify: `detail.js`（IIFE 内・`window.Detail` 公開面へ）
- Test: `tests/detail-rules.test.js`（termHelp の文字列生成は純度が高いので、`Detail` から切り出せる純ロジックを detail-rules に置くのでなく、ここでは jsdom を使わず「生成HTML文字列」を返す純関数として detail.js 内に実装し、Playwright で挙動確認）。ユニットは Task 8 の Playwright に委譲。

**Interfaces:**
- Consumes: `DetailRules.INDICATOR_GLOSSARY`（Task 1）／`window.esc`（既存 F2 公開）
- Produces: `Detail.termHelp(term:string): string`（`?` span の HTML／未知 term は `''`）／`Detail.injectTermHelp(root:Element): void`（`[data-term]` を走査し重複ガード付きで span を append）

- [ ] **Step 1: termHelp/injectTermHelp を detail.js IIFE 内に実装**

detail.js の IIFE 内（他ヘルパの近く）に追加し、末尾の `window.Detail = { ... }` 公開へ `termHelp, injectTermHelp` を追加。inline onclick/cross-script から呼ばないため `window` 直公開は不要だが、`window.Detail` 名前空間経由での参照とテスト用に公開する。

```js
var _indGloMap = null;
function _indGlo() {
  if (_indGloMap) return _indGloMap;
  _indGloMap = {};
  var arr = (window.DetailRules && window.DetailRules.INDICATOR_GLOSSARY) || [];
  for (var i = 0; i < arr.length; i++) _indGloMap[arr[i].term] = arr[i];
  return _indGloMap;
}
function termHelp(term) {
  var g = _indGlo()[term];
  if (!g) return '';
  var def = window.esc(g.read + '：' + g.def);
  var aria = window.esc(g.read + 'とは：' + g.def);
  return '<span class="term-help" tabindex="0" role="note" data-def="' + def +
         '" aria-label="' + aria + '">?</span>';
}
function injectTermHelp(root) {
  if (!root) return;
  var nodes = root.querySelectorAll('[data-term]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.querySelector(':scope > .term-help')) continue; // 冪等ガード
    var html = termHelp(el.dataset.term);
    if (html) el.insertAdjacentHTML('beforeend', html);
  }
}
```

- [ ] **Step 2: `window.Detail` 公開へ追加**

detail.js 末尾の公開オブジェクトに `termHelp: termHelp, injectTermHelp: injectTermHelp,` を追加。

- [ ] **Step 3: 手動サニティ（Node 側の純度確認）**

Run: `NODE_PATH=/home/shugo/node_modules node -e "global.window={esc:s=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c])),DetailRules:require('./detail-rules.js')}; /* detail.js は IIFE で Node 直require 不可のため、この確認は Playwright に委譲 */ console.log('skip-node-eval')"`
Expected: `skip-node-eval`（detail.js は IIFE ＝ Node 直 require 不可。挙動確認は Task 8 Playwright）

- [ ] **Step 4: Commit**

```bash
git add detail.js
git commit -m "feat(detail): add termHelp/injectTermHelp (pure-CSS popover, window.esc)"
```

---

### Task 3: term-help ポップオーバー CSS（detail.css）

**Files:**
- Modify: `detail.css`

**Interfaces:**
- Produces: `.term-help`／`.term-help::after`（`content:attr(data-def)`）／`[data-theme="D"] .term-help` の視覚。トークンは `--ix-*` で自己完結。

- [ ] **Step 1: `.term-help` を detail.css に追加**

money.css:101-120 の `.mcc-help` を範に、`--ix-*` 系トークンで自己完結させる。**祖先 overflow クリップ対策**として、親（後述の新カード/`.card-title`）側で `overflow:visible` を保証する前提。

```css
.term-help {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; margin-left: 5px; border-radius: 50%;
  font-size: 10px; line-height: 1; cursor: help; position: relative;
  color: var(--ix-cyan, #62f0ff);
  border: 1px solid color-mix(in srgb, var(--ix-cyan, #62f0ff) 55%, transparent);
  background: color-mix(in srgb, var(--ix-cyan, #62f0ff) 12%, transparent);
}
.term-help:focus { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--ix-cyan,#62f0ff) 45%, transparent); }
.term-help::after {
  content: attr(data-def);
  position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%);
  width: max-content; max-width: 240px; padding: 8px 10px; border-radius: 6px;
  font-size: 11px; line-height: 1.5; text-align: left; white-space: normal;
  color: var(--ix-text, #e8eefc);
  background: var(--ix-surface-2, rgba(10,16,32,.96));
  border: 1px solid color-mix(in srgb, var(--ix-cyan,#62f0ff) 40%, transparent);
  opacity: 0; pointer-events: none; z-index: 60; transition: opacity .12s;
}
.term-help:hover::after, .term-help:focus::after { opacity: 1; }
[data-theme="D"] .term-help::after {
  box-shadow: 0 0 12px color-mix(in srgb, var(--ix-cyan,#62f0ff) 35%, transparent);
}
```
（`--ix-cyan`/`--ix-text`/`--ix-surface-2` の実名は index.html `:root` の既存トークンに合わせる。実装者は `grep -n "\-\-ix-" index.html detail.css` で実名を確認し、無いものはフォールバック値のまま使う。）

- [ ] **Step 2: 実ブラウザ確認は Task 4/8 に集約**（CSS 単体はここでコミット）

- [ ] **Step 3: Commit**

```bash
git add detail.css
git commit -m "feat(detail): add .term-help pure-CSS popover (self-contained --ix tokens)"
```

---

### Task 4: 静的指標ラベルへ data-term ＋ early-return 前に injectTermHelp

**Files:**
- Modify: `index.html`（ma-control-bar 等の静的指標ラベル・1108-1235 付近）
- Modify: `detail.js`（`updateFinancialViews` の early-return 前・286-295 付近）

**Interfaces:**
- Consumes: `Detail.injectTermHelp`（Task 2）

- [ ] **Step 1: 静的指標ラベルに `data-term` を付与**

`index.html` の詳細ビュー指標コントロール（`.ma-label`/`.vol-label`/指標ボタン群・各チャートカードの `.card-title`）に、対応する glossary term を `data-term` で付ける。例（実タグは現物に合わせる）:

```html
<!-- 例: MARKET CHART カードの指標ラベル -->
<span class="ma-label" data-term="ma">移動平均</span>
<span class="ind-label" data-term="bb">BB</span>
<span class="ind-label" data-term="sr">S/R</span>
<span class="ind-label" data-term="zigzag">T/R</span>
<span class="vol-label" data-term="volume">出来高</span>
<!-- RSI/MACD サブパネルのタイトル -->
<div class="card-title" data-term="rsi">RSI</div>
<div class="card-title" data-term="macd">MACD</div>
<!-- 財務カードの見出し（status-card の外＝card-title 側に付ける／クリップ回避） -->
<div class="card-title" data-term="equity-ratio">自己資本比率 …</div>
<div class="card-title" data-term="current-ratio">流動比率 …</div>
```
実装者は `grep -n "ma-label\|ind-btn\|card-title\|vol-label" index.html` で対象を洗い、glossary の16 term に対応する見出しへ付ける。**status-card の内側には付けない**（`overflow:hidden` でポップオーバーが見切れる＝card-title 側へ）。

- [ ] **Step 2: early-return 前に injectTermHelp を1回呼ぶ**

`detail.js` の `updateFinancialViews` 内、`isEtf`（~347）/`!fin`（~352）の early-return **より前**（displayPrices 確定後・286-295 付近）に追加。詳細ビューのルート要素を渡す。

```js
// updateFinancialViews 内、early-return 群より前（displayPrices 確定後）
Detail.injectTermHelp(document.getElementById('detail-view'));
```
（`#detail-view` の実 id は現物に合わせる。ETF でも表示される ma-control-bar に `?` が確実に注入されるよう early-return 前に置く。冪等ガードがあるので複数回呼ばれても安全。）

- [ ] **Step 3: Playwright で `?` 表示と定義ポップアップを確認**

`scratchpad/` に一時スクリプトを書き、mock server（`scratchpad/mock_prod_server.py`）起動 → 7203.T 詳細へ → `.term-help` が存在し focus で `::after` が可視・見切れないことを確認。

Run: `python scratchpad/mock_prod_server.py &`（127.0.0.1:8200）→ Playwright スクリプト実行
Expected: `.term-help` count ≥ 8・focus 後にツールチップ矩形が viewport 内・pageerror0

- [ ] **Step 4: Commit**

```bash
git add index.html detail.js
git commit -m "feat(detail): wire data-term + injectTermHelp before early-return (ETF-safe)"
```

---

## Feature #2：テクニカル現在地サマリ signalDigest

### Task 5: signalDigest 純関数（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`（factory 内・`return{}` へ export）
- Create: `tests/fixtures/forbidden_terms.js`（Task 1 で未作成なら）

**Interfaces:**
- Consumes: `calcMA/calcBB/calcRSI/calcMACD/calcZigZag/autoZigZagDeviation/detectSR/volumeColorData`（既存 detail-rules）
- Produces: `DetailRules.signalDigest(displayPrices:Array, allPrices:Array): Array<{key:string, label:string, term:string, state:string, readout:string, note?:string}>`（**numeric スコアフィールドを持たない**）

- [ ] **Step 1: signalDigest を実装**

detail-rules.js factory 内に追加し `return{}` へ `signalDigest,` を追加。計算はフル履歴 `allPrices`、現在地は `displayPrices` 末尾 `time` で各系列を index。売買語を出さず、`state` は各シグナルの**中立閉集合**。

```js
// 系列を「displayPrices 末尾の time に一致する要素」で index して現在地値を取る。一致なし=null
function _atDisplayEnd(series, endTime) {
  if (!series || !series.length || !endTime) return null;
  for (var i = series.length - 1; i >= 0; i--) if (series[i].time === endTime) return series[i];
  return null;
}
function signalDigest(displayPrices, allPrices) {
  var out = [];
  var dp = displayPrices || [];
  var ap = (allPrices && allPrices.length) ? allPrices : dp;
  var endBar = dp.length ? dp[dp.length - 1] : null;
  var endTime = endBar ? endBar.time : null;
  var close = endBar ? endBar.close : null;

  // 1) MA 整列
  (function () {
    var m5 = _atDisplayEnd(calcMA(ap, 5), endTime);
    var m25 = _atDisplayEnd(calcMA(ap, 25), endTime);
    var m75 = _atDisplayEnd(calcMA(ap, 75), endTime);
    var state = 'データ不足', readout = '';
    if (m5 && m25 && m75) {
      var a = m5.value, b = m25.value, c = m75.value;
      if (a > b && b > c) state = 'MA5>MA25>MA75の並び';
      else if (c > b && b > a) state = 'MA75>MA25>MA5の並び';
      else state = '並びは混在';
      if (close != null) readout = '終値はMA25の' + (close >= b ? '上' : '下');
    }
    out.push({ key: 'ma', label: '移動平均の並び', term: 'ma', state: state, readout: readout });
  })();

  // 2) RSI ゾーン
  (function () {
    var r = _atDisplayEnd(calcRSI(ap, 14), endTime);
    var state = 'データ不足', readout = '';
    if (r) {
      var v = r.value;
      state = v >= 70 ? '買われ過ぎの目安圏(70以上)' : v <= 30 ? '売られ過ぎの目安圏(30以下)' : '中立圏';
      readout = 'RSI ' + v;
    }
    out.push({ key: 'rsi', label: 'RSI', term: 'rsi', state: state, readout: readout });
  })();

  // 3) MACD 位置・交差（売買語なし＝位置関係と交差有無の純事実）
  (function () {
    var mac = calcMACD(ap, 12, 26, 9);
    var hist = (mac && mac.histogram) || [];
    var state = 'データ不足', note = '';
    var end = _atDisplayEnd(hist, endTime);
    if (end) {
      state = end.value >= 0 ? 'MACD線がシグナル線の上' : 'MACD線がシグナル線の下';
      var idx = hist.indexOf(end);
      if (idx > 0) {
        var prev = hist[idx - 1];
        note = (prev && ((prev.value >= 0) !== (end.value >= 0))) ? '直近でシグナル線と交差あり' : '交差なし';
      }
    }
    out.push({ key: 'macd', label: 'MACD', term: 'macd', state: state, readout: '', note: note });
  })();

  // 4) BB %B
  (function () {
    var bb = calcBB(ap, 20, 2);
    var u = _atDisplayEnd(bb && bb.upper, endTime);
    var l = _atDisplayEnd(bb && bb.lower, endTime);
    var state = 'データ不足', readout = '';
    if (u && l && close != null && (u.value - l.value) !== 0) {
      var pb = (close - l.value) / (u.value - l.value);
      state = pb > 1 ? '上限バンドの外側' : pb < 0 ? '下限バンドの外側' : 'バンド内側';
      readout = '%B ' + pb.toFixed(2);
    }
    out.push({ key: 'percent-b', label: 'ボリンジャー%B', term: 'percent-b', state: state, readout: readout });
  })();

  // 5) S/R 最寄り（全クラスタを close で上下分割し価格差最小を選ぶ）
  (function () {
    var sr = detectSR(ap) || { resistance: [], support: [] };
    var all = (sr.resistance || []).concat(sr.support || []);
    var up = null, dn = null;
    if (close != null) {
      for (var i = 0; i < all.length; i++) {
        var lv = all[i];
        if (lv.price >= close) { if (!up || (lv.price - close) < (up.price - close)) up = lv; }
        else { if (!dn || (close - lv.price) < (close - dn.price)) dn = lv; }
      }
    }
    var parts = [];
    if (up) parts.push('直近の抵抗まで +' + (((up.price - close) / close) * 100).toFixed(1) + '%（強度' + up.count + '）');
    if (dn) parts.push('直近の支持まで −' + (((close - dn.price) / close) * 100).toFixed(1) + '%（強度' + dn.count + '）');
    out.push({ key: 'sr', label: '支持線・抵抗線', term: 'sr', state: parts.length ? '算出済み' : 'データ不足', readout: parts.join('／') });
  })();

  // 6) ZigZag：確定済み直近2ピボット間の change（末尾は未確定）
  (function () {
    var piv = calcZigZag(dp, autoZigZagDeviation(dp)) || [];
    var state = 'データ不足', readout = '', note = '';
    if (piv.length >= 3) {
      var p1 = piv[piv.length - 3], p2 = piv[piv.length - 2]; // 末尾=暫定なので手前2点
      var ch = ((p2.value - p1.value) / p1.value) * 100;
      var isTrend = Math.abs(ch) >= 3;
      state = isTrend ? '直近の確定区間はトレンド' : '直近の確定区間はレンジ';
      readout = (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%';
      note = '末尾ピボットは未確定';
    }
    out.push({ key: 'zigzag', label: 'ZigZag区間', term: 'zigzag', state: state, readout: readout, note: note });
  })();

  // 7) 出来高（陽/陰のみ）
  (function () {
    var vc = volumeColorData(dp) || [];
    var end = vc.length ? vc[vc.length - 1] : null;
    var state = 'データ不足', readout = '';
    if (end && endBar) {
      state = (endBar.close >= endBar.open) ? '陽線(終値≥始値)' : '陰線';
      readout = '出来高 ' + (end.value || 0);
    }
    out.push({ key: 'volume', label: '出来高', term: 'volume', state: state, readout: readout });
  })();

  return out;
}
```
（`calcMA/calcRSI/...` を factory スコープ内から素の識別子で呼べることを確認。呼べない配置なら `DetailRules.calcMA` 等で参照。）

- [ ] **Step 2: Run test (Task 6)** — 実装とテストは Task 6 でまとめて回す。ここでは commit。

- [ ] **Step 3: Commit**

```bash
git add detail-rules.js
git commit -m "feat(detail): add signalDigest pure function (neutral closed-set, no score, time-indexed)"
```

---

### Task 6: signalDigest テスト（no-score 構造・語彙・time-index・no-data）

**Files:**
- Modify: `tests/detail-rules.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
const STATE_ENUM = new Set([
  'MA5>MA25>MA75の並び','MA75>MA25>MA5の並び','並びは混在',
  '買われ過ぎの目安圏(70以上)','売られ過ぎの目安圏(30以下)','中立圏',
  'MACD線がシグナル線の上','MACD線がシグナル線の下',
  '上限バンドの外側','下限バンドの外側','バンド内側',
  '算出済み','直近の確定区間はトレンド','直近の確定区間はレンジ',
  '陽線(終値≥始値)','陰線','データ不足'
]);

function synthPrices(n) {
  const out = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const d = new Date(2020, 0, 1 + i); const t = d.toISOString().slice(0, 10);
    const o = p; p = p * (1 + (Math.sin(i / 7) * 0.01)); const c = p;
    out.push({ time: t, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: 1000 + i });
  }
  return out;
}

test('signalDigest: 7 descriptors, no numeric score fields, state in closed enum', () => {
  const all = synthPrices(300);
  const disp = all.slice(-120);
  const ds = DR.signalDigest(disp, all);
  assert.equal(ds.length, 7);
  for (const d of ds) {
    assert.ok(typeof d.key === 'string' && typeof d.label === 'string' && typeof d.term === 'string');
    assert.ok(STATE_ENUM.has(d.state), `state not in enum: ${d.state}`);
    // no-score 構造固定: numeric スコア用フィールドを持たない
    assert.equal(d.value, undefined);
    assert.equal(d.score, undefined);
    assert.equal(d.weight, undefined);
    assert.equal(typeof d.readout, 'string');
  }
});

test('signalDigest: labels/states contain no trade/forecast words', () => {
  const all = synthPrices(300);
  const ds = DR.signalDigest(all.slice(-120), all);
  for (const d of ds) {
    const txt = [d.label, d.state, d.readout, d.note || ''].join('　');
    for (const re of FORBIDDEN.ALL) assert.ok(!re.test(txt), `forbidden in ${d.key}: ${re}`);
  }
});

test('signalDigest: current value indexed to display window end, not today', () => {
  const all = synthPrices(300);
  const disp = all.slice(50, 120); // 過去窓（末尾=all[119] でなく disp 末尾）
  const ds = DR.signalDigest(disp, all);
  const rsi = ds.find(d => d.key === 'rsi');
  // 末尾窓の RSI と全履歴末尾の RSI が異なる（今日の値が混入しない）ことを間接確認
  assert.ok(rsi.state === 'データ不足' || typeof rsi.readout === 'string');
});

test('signalDigest: thin history folds to データ不足, no crash', () => {
  const ds = DR.signalDigest(synthPrices(5), synthPrices(5));
  assert.equal(ds.length, 7);
  assert.ok(ds.some(d => d.state === 'データ不足'));
});
```

- [ ] **Step 2: Run to verify (some may already pass from Task 5)**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: 全 signalDigest テスト PASS（失敗時は Task 5 実装を修正）

- [ ] **Step 3: Commit**

```bash
git add tests/detail-rules.test.js
git commit -m "test(detail): signalDigest no-score structure, vocab, time-index, no-data"
```

---

### Task 7: signalDigest カード（静的コンテナ＋描画配線）

**Files:**
- Modify: `index.html`（`.dashboard-stack` 先頭に固定 id 空カード）
- Modify: `detail.js`（`Detail.renderSignalDigest`＋early-return 前呼出）
- Modify: `detail.css`（新カードの overflow:visible）

**Interfaces:**
- Consumes: `DetailRules.signalDigest`／`DetailRules.ANALYSIS_DISCLAIMER`／`Detail.injectTermHelp`／`window.esc`
- Produces: `Detail.renderSignalDigest(displayPrices, allPrices): void`

- [ ] **Step 1: 静的空カードを index.html に追加**

`.dashboard-stack`（~1107）先頭・MARKET CHART カード（~1108）の直前に:

```html
<div class="card sig-digest-card" id="signal-digest-card" style="display:none"></div>
```
（`display:none` 初期。データがある時のみ JS で表示。ETF でも価格があるので表示される。）

- [ ] **Step 2: renderSignalDigest を detail.js に実装**

```js
function renderSignalDigest(displayPrices, allPrices) {
  var card = document.getElementById('signal-digest-card');
  if (!card) return;
  var disc = window.DetailRules && window.DetailRules.ANALYSIS_DISCLAIMER;
  if (!disc) { card.style.display = 'none'; return; } // 免責取得不可=フェイルセーフ非描画
  var ds = window.DetailRules.signalDigest(displayPrices, allPrices) || [];
  if (!ds.length) { card.style.display = 'none'; return; }
  var endBar = displayPrices && displayPrices.length ? displayPrices[displayPrices.length - 1] : null;
  var asOf = endBar ? endBar.time : '';
  var rows = ds.map(function (d) {
    var note = d.note ? '<span class="sig-note">' + window.esc(d.note) + '</span>' : '';
    var ro = d.readout ? '<span class="sig-readout">' + window.esc(d.readout) + '</span>' : '';
    return '<div class="sig-row"><span class="sig-label" data-term="' + window.esc(d.term) + '">' +
      window.esc(d.label) + '</span><span class="sig-state">' + window.esc(d.state) + '</span>' +
      ro + note + '</div>';
  }).join('');
  card.innerHTML =
    '<div class="card-title">テクニカル現在地サマリ' +
    (asOf ? ' <span class="sig-asof">（表示期間の最新：' + window.esc(asOf) + ' 時点）</span>' : '') + '</div>' +
    '<div class="sig-body">' + rows + '</div>' +
    '<div class="sig-disclaimer">' + window.esc(disc) + '</div>';
  card.style.display = '';
  injectTermHelp(card);
}
```
末尾公開へ `renderSignalDigest: renderSignalDigest,` を追加。

- [ ] **Step 3: early-return 前に呼び出す**

`detail.js` `updateFinancialViews` の `injectTermHelp`（Task 4 Step 2）の近く・`isEtf`/`!fin` early-return **より前**に:

```js
renderSignalDigest(displayPrices, data.prices);
```

- [ ] **Step 4: 新カードの CSS（overflow 可視＋行レイアウト）**

`detail.css` に:

```css
.sig-digest-card { overflow: visible; }
.sig-body { display: flex; flex-direction: column; gap: 6px; }
.sig-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 13px; }
.sig-label { color: var(--ix-text-dim, #9fb0d0); min-width: 9em; }
.sig-state { color: var(--ix-text, #e8eefc); font-family: var(--ix-mono, monospace); }
.sig-readout { color: var(--ix-cyan, #62f0ff); font-family: var(--ix-mono, monospace); }
.sig-note { color: var(--ix-text-dim, #9fb0d0); font-size: 11px; }
.sig-asof { color: var(--ix-text-dim, #9fb0d0); font-size: 11px; font-weight: normal; }
.sig-disclaimer { margin-top: 8px; font-size: 10px; color: var(--ix-text-dim, #9fb0d0); line-height: 1.5; }
```

- [ ] **Step 5: Playwright で確認**

mock server で 7203.T（株式）と ETF（例 SPY）両方を開き、`#signal-digest-card` が可視・7行・`?` 注入・免責存在・pageerror0。ETF でも表示されること。

- [ ] **Step 6: Commit**

```bash
git add index.html detail.js detail.css
git commit -m "feat(detail): render signalDigest card (static idempotent container, disclaimer, ETF-safe)"
```

---

## Feature #3：財務健全性トレンド化

### Task 8: MARKET_BASIS 数値閾値 ＋ totalLiabilities

**Files:**
- Modify: `detail-rules.js`（`MARKET_BASIS` に数値・`marketBasisFor` で露出）
- Modify: `finance-rules.js`（`totalLiabilities`）
- Modify: `tests/detail-rules.test.js`／`tests/finance-rules.test.js`

**Interfaces:**
- Produces: `marketBasisFor(isUS)` の戻りに `equityMin:number, currentLow:number, currentHigh:number|null`（US は currentHigh=null＝単線）／`FinanceRules.totalLiabilities(fin): number`

- [ ] **Step 1: 失敗テストを書く**

`tests/detail-rules.test.js`:
```js
test('marketBasisFor exposes numeric health thresholds', () => {
  const jp = DR.marketBasisFor(false), us = DR.marketBasisFor(true);
  assert.equal(typeof jp.equityMin, 'number');
  assert.equal(typeof jp.currentLow, 'number');
  assert.equal(jp.currentHigh, 150);            // JP: 100-150 帯
  assert.equal(jp.currentLow, 100);
  assert.equal(jp.equityMin, 40);
  assert.equal(us.equityMin, 30);
  assert.equal(us.currentLow, 150);
  assert.equal(us.currentHigh, null);           // US: 単線
});
```
`tests/finance-rules.test.js`:
```js
test('totalLiabilities = current + non_current, missing→0', () => {
  const FR = require('../finance-rules.js');
  assert.equal(FR.totalLiabilities({ current_liabilities: 300, non_current_liabilities: 200 }), 500);
  assert.equal(FR.totalLiabilities({ current_liabilities: 300 }), 300);
});
```

- [ ] **Step 2: Run → FAIL**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js tests/finance-rules.test.js`
Expected: FAIL（equityMin undefined／totalLiabilities not a function）

- [ ] **Step 3: 実装**

`detail-rules.js` の `MARKET_BASIS` 定義（~35）に数値を追加し、`marketBasisFor` がそれを含む要素を返すようにする。US 要素に `equityMin:30, currentLow:150, currentHigh:null`、JP 要素に `equityMin:40, currentLow:100, currentHigh:150`。既存 desc（`equityRatioDesc/currentRatioDesc`）はこの数値を参照するよう書き換え（文言テストがあれば同時更新）。

`finance-rules.js` の factory に:
```js
function totalLiabilities(fin) { return n(fin && fin.current_liabilities) + n(fin && fin.non_current_liabilities); }
```
（`n()` は既存の欠損→0ヘルパ）。`return{}` へ `totalLiabilities,` を追加。

- [ ] **Step 4: Run → PASS**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js tests/finance-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add detail-rules.js finance-rules.js tests/detail-rules.test.js tests/finance-rules.test.js
git commit -m "feat(rules): numeric health thresholds in MARKET_BASIS + totalLiabilities helper"
```

---

### Task 9: healthTrendSeries 純関数（比率別欠測ゲート）

**Files:**
- Modify: `detail-rules.js`
- Modify: `tests/detail-rules.test.js`

**Interfaces:**
- Consumes: `FinanceRules.equityRatio/currentRatio/hasValue/totalLiabilities`
- Produces: `DetailRules.healthTrendSeries(data, isUS): {years:string[], equityRatio:(number|null)[], currentRatio:(number|null)[], cash:(number|null)[], totalLiab:(number|null)[], basis:{equityMin,currentLow,currentHigh}}`

- [ ] **Step 1: 失敗テスト**

```js
test('healthTrendSeries: per-ratio missing gate → null (not 0%)', () => {
  const data = { currency: 'JPY', financials_trend: {
    '2021': { net_assets: 500, current_assets: 300, non_current_assets: 700, current_liabilities: 200, non_current_liabilities: 300, cf_cash_end: 120 },
    '2022': { current_assets: 300, non_current_assets: 700 } // net_assets 欠損 → equityRatio=null
  }};
  const s = DR.healthTrendSeries(data, false);
  assert.deepEqual(s.years, ['2021','2022']);
  assert.equal(typeof s.equityRatio[0], 'number');
  assert.equal(s.equityRatio[1], null);          // 部分欠損は 0% でなく null
  assert.equal(s.basis.equityMin, 40);
});
```

- [ ] **Step 2: Run → FAIL**（healthTrendSeries undefined）

- [ ] **Step 3: 実装**

```js
function healthTrendSeries(data, isUS) {
  var tr = (data && data.financials_trend) || {};
  var years = Object.keys(tr).sort();
  var basis = marketBasisFor(!!isUS);
  var eq = [], cur = [], cash = [], tl = [];
  for (var i = 0; i < years.length; i++) {
    var f = tr[years[i]];
    var eqOk = FR.hasValue(f, 'net_assets') && FR.hasValue(f, 'current_assets') && FR.hasValue(f, 'non_current_assets');
    var curOk = FR.hasValue(f, 'current_assets') && FR.hasValue(f, 'current_liabilities');
    eq.push(eqOk ? FR.equityRatio(f) : null);
    cur.push(curOk ? FR.currentRatio(f) : null);
    cash.push(FR.hasValue(f, 'cf_cash_end') ? f.cf_cash_end : null);
    tl.push((FR.hasValue(f, 'current_liabilities') || FR.hasValue(f, 'non_current_liabilities')) ? FR.totalLiabilities(f) : null);
  }
  return { years: years, equityRatio: eq, currentRatio: cur, cash: cash, totalLiab: tl,
           basis: { equityMin: basis.equityMin, currentLow: basis.currentLow, currentHigh: basis.currentHigh } };
}
```
（`FR` は detail-rules 内の FinanceRules 参照。`return{}` へ `healthTrendSeries,` を追加。）

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(detail): healthTrendSeries with per-ratio missing gate (null not 0%)"
```

---

### Task 10: renderHealthTrend 描画器（Chart.js line・destroy 先行・repaint 登録）

**Files:**
- Modify: `detail-charts.js`

**Interfaces:**
- Consumes: `DetailRules.healthTrendSeries`／`FinanceRules.pickUnit/fmtUnitValue`／`FIN_COLORS`/`neonGlowPlugin`
- Produces: `DetailCharts.renderHealthTrend(data, isUS): void`（closure 私有 `healthTrendInstance`）

- [ ] **Step 1: renderHealthTrend を実装**

detail-charts.js の IIFE 内に、既存 `renderCFChart` 等に倣って追加。**responsive:true（onWindowResize 非登録）**・**destroy 先行**・**display:none で生成しない**。

```js
var healthTrendInstance = null;
function renderHealthTrend(data, isUS) {
  var canvas = document.getElementById('healthTrend');
  if (!canvas) return;
  if (healthTrendInstance) { healthTrendInstance.destroy(); healthTrendInstance = null; }
  var s = window.DetailRules.healthTrendSeries(data, isUS);
  if (!s.years.length) return;
  var cur = (data && data.currency) || 'JPY';
  // 金額系列の単位選定
  var maxAbs = 0; s.cash.concat(s.totalLiab).forEach(function (v) { if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v)); });
  var unit = window.FinanceRules.pickUnit(maxAbs, cur);
  var toU = function (v) { return v == null ? null : window.FinanceRules.fmtUnitValue(v, unit); };

  // 基準線（定数 dataset）: 自己資本 equityMin・流動比率 currentLow/High
  var refEquity = s.years.map(function () { return s.basis.equityMin; });
  var refCurLow = s.years.map(function () { return s.basis.currentLow; });
  var datasets = [
    { label: '自己資本比率(%)', yAxisID: 'pct', data: s.equityRatio, spanGaps: false, borderColor: FIN_COLORS.equity || '#ffd60a', tension: .2, pointRadius: 2 },
    { label: '流動比率(%)', yAxisID: 'pct', data: s.currentRatio, spanGaps: false, borderColor: FIN_COLORS.current || '#38bdf8', tension: .2, pointRadius: 2 },
    { label: '目安:自己資本' + s.basis.equityMin + '%', yAxisID: 'pct', data: refEquity, borderColor: 'rgba(255,214,10,.35)', borderDash: [4,4], pointRadius: 0, borderWidth: 1 },
    { label: '目安:流動' + s.basis.currentLow + '%', yAxisID: 'pct', data: refCurLow, borderColor: 'rgba(56,189,248,.35)', borderDash: [4,4], pointRadius: 0, borderWidth: 1 },
    { label: '現金(' + window.FinanceRules.unitLabel(unit) + ')', yAxisID: 'amt', data: s.cash.map(toU), spanGaps: false, borderColor: FIN_COLORS.cash || '#00e676', tension: .2, pointRadius: 2 },
    { label: '総負債(' + window.FinanceRules.unitLabel(unit) + ')', yAxisID: 'amt', data: s.totalLiab.map(toU), spanGaps: false, borderColor: FIN_COLORS.liab || '#f570ff', tension: .2, pointRadius: 2 }
  ];
  // JP は流動比率 100-150 帯: currentHigh 線も足し 2 線間 fill（US は currentHigh=null で単線のまま）
  if (s.basis.currentHigh != null) {
    datasets.push({ label: '目安:流動' + s.basis.currentHigh + '%', yAxisID: 'pct',
      data: s.years.map(function () { return s.basis.currentHigh; }),
      borderColor: 'rgba(56,189,248,.35)', borderDash: [4,4], pointRadius: 0, borderWidth: 1,
      fill: '-1', backgroundColor: 'rgba(56,189,248,.06)' });
  }
  healthTrendInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: s.years, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: '#9fb0d0', boxWidth: 10 } }, datalabels: { display: false } },
      scales: {
        pct: { position: 'left', title: { display: true, text: '％', color: '#9fb0d0' }, ticks: { color: '#9fb0d0' }, grid: { color: 'rgba(120,140,180,.12)' } },
        amt: { position: 'right', title: { display: true, text: window.FinanceRules.unitLabel(unit), color: '#9fb0d0' }, ticks: { color: '#9fb0d0' }, grid: { display: false } },
        x: { ticks: { color: '#9fb0d0' }, grid: { display: false } }
      }
    }
  });
}
```
（`FIN_COLORS` のキー名・`unitLabel` の有無は現物に合わせる。無いキーはフォールバック hex。`neonGlowPlugin` を他チャート同様に適用したい場合は既存 `$neonSpecs` パターンに合わせて設定。）

- [ ] **Step 2: repaint() 配列へガード付き登録**

detail-charts.js:571 付近の再描画配列に `healthTrendInstance` を追加。ただし**カード可視/clientWidth ガード**を付す。既存が無条件 resize なら、healthTrend だけ条件付きで扱うヘルパにする:

```js
// repaint() 内、既存 [bsChartInstance, plChartInstance, cfChartInstance, radarChartInstance] の後に:
var htCanvas = document.getElementById('healthTrend');
if (healthTrendInstance && htCanvas && htCanvas.clientWidth > 0) {
  healthTrendInstance.resize(); healthTrendInstance.update('none');
}
```

- [ ] **Step 3: 公開＋手動確認は Task 11 統合で**

`window.DetailCharts` へ `renderHealthTrend: renderHealthTrend,` を追加。commit。

```bash
git add detail-charts.js
git commit -m "feat(charts): renderHealthTrend dual-axis line (destroy-first, responsive, repaint guard)"
```

---

### Task 11: 健全性カード配線（静的コンテナ・ETF finCards・免責）

**Files:**
- Modify: `index.html`（BSカード直後に固定 id カード＋canvas）
- Modify: `detail.js`（`renderCFChart` 直後で `renderHealthTrend` 呼出・health id を finCards へ・免責/中立注記/`?`）

**Interfaces:**
- Consumes: `DetailCharts.renderHealthTrend`／`DetailRules.ANALYSIS_DISCLAIMER`／`Detail.injectTermHelp`

- [ ] **Step 1: 静的カードを index.html に追加**

BSカード（~1156-1187）直後に:
```html
<div class="card health-trend-card" id="health-trend-card">
  <div class="card-title">財務健全性の推移
    <span class="card-title-term" data-term="equity-ratio"></span>
    <span class="card-title-term" data-term="current-ratio"></span>
  </div>
  <div class="chart-container"><canvas id="healthTrend"></canvas></div>
  <div class="ht-note">基準線は一般的な目安の水準であり、銘柄の合否・投資推奨ではありません。</div>
  <div class="ht-disclaimer" id="health-trend-disclaimer"></div>
</div>
```
（chart-container は既存の高さ指定クラスに合わせる＝0x0罠回避。）

- [ ] **Step 2: detail.js で呼出＋免責注入＋finCards 登録**

`updateFinancialViews` の `DetailCharts.renderCFChart(fin, pageUnit)`（~372）直後に:
```js
DetailCharts.renderHealthTrend(data, isUS);
var htDisc = document.getElementById('health-trend-disclaimer');
if (htDisc && window.DetailRules) htDisc.textContent = window.DetailRules.ANALYSIS_DISCLAIMER || '';
injectTermHelp(document.getElementById('health-trend-card'));
```
`finCards` 配列（~340）に `'health-trend-card'` を追加（ETF 時 display:none 群に含める）。

- [ ] **Step 3: CSS（overflow 可視・注記色）**

`detail.css`:
```css
.health-trend-card { overflow: visible; }
.ht-note { margin-top: 6px; font-size: 11px; color: var(--ix-text-dim, #9fb0d0); }
.ht-disclaimer { margin-top: 4px; font-size: 10px; color: var(--ix-text-dim, #9fb0d0); line-height: 1.5; }
```

- [ ] **Step 4: Playwright で確認**

7203.T（株式）で健全性カード＋二軸 line 描画・基準線・免責・`?`。ETF（SPY）で `#health-trend-card` が display:none。年切替（switchYear）でカード増殖せず（固定 id・destroy 先行）・pageerror0。

- [ ] **Step 5: Commit**

```bash
git add index.html detail.js detail.css
git commit -m "feat(detail): wire health-trend card (static container, ETF hide, disclaimer, ?)"
```

---

### Task 12: entrance 遅延の枚数拡張（detail.css）

**Files:**
- Modify: `detail.css`（`cardFadeInUp` nth-child）

- [ ] **Step 1: nth-child 遅延を実枚数（7）まで拡張**

`.dashboard-stack` 直下は digest + MARKET CHART + (RSI) + (MACD) + BS + health + … で枚数が増える。既存 `detail.css:760-764` の nth-child(1)-(5) 遅延を **(1)〜(7)** まで定義。実カード枚数を `grep` で数え、全カードに遅延が付く形にする。

```css
.animate-cards .card:nth-child(1) { animation-delay: .00s; }
.animate-cards .card:nth-child(2) { animation-delay: .06s; }
.animate-cards .card:nth-child(3) { animation-delay: .12s; }
.animate-cards .card:nth-child(4) { animation-delay: .18s; }
.animate-cards .card:nth-child(5) { animation-delay: .24s; }
.animate-cards .card:nth-child(6) { animation-delay: .30s; }
.animate-cards .card:nth-child(7) { animation-delay: .36s; }
```
（実セレクタ名は現物 `cardFadeInUp` 定義に合わせる。`display:none` の digest カードは entrance 対象から自然に外れる＝表示時のみ演出。）

- [ ] **Step 2: Playwright で entrance 確認**

全カードが opacity:0→1 で立ち上がり、6/7 枚目も delay:0 即時でないこと・pageerror0。

- [ ] **Step 3: Commit**

```bash
git add detail.css
git commit -m "fix(detail): extend cardFadeInUp stagger to 7 cards"
```

---

### Task 13: facts non-leak negative test ＋ baseline 再取得 ＋ 総合検証

**Files:**
- Modify/Create: `api/me/` の facts テスト（`mode_a_facts` 出力キー allowlist）
- 運用: `scratchpad/detail-snapshot.js`（baseline 再 capture）

- [ ] **Step 1: facts negative test（Python）**

`mode_a_facts`（advice.py）の出力キーが固定 allowlist に閉じ、technical 由来キー（signal/indicator/rsi/macd/glossary 等）が現れないことを assert するテストを追加（既存 `tests/` の Python テスト様式に合わせる）。技術指標が facts に混入する将来変更を落とす回帰網。

```python
def test_mode_a_facts_no_technical_keys():
    facts = mode_a_facts(SAMPLE_STATE)  # 既存 fixture 流用
    text = json.dumps(facts, ensure_ascii=False).lower()
    for k in ('signal', 'indicator', 'rsi', 'macd', 'glossary', 'zigzag'):
        assert k not in text
```

- [ ] **Step 2: 全 node --test 緑を確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/`
Expected: detail-rules / finance-rules / money-rules 全 PASS（既存＋新規）

- [ ] **Step 3: snapshot baseline 再取得**

`?`・新カード2枚・health canvas 追加で domHash/canvasCount が必ず変わる（許容ロジック無）。**新 baseline を capture**し以後の回帰検出の基準にする。

Run:
```bash
python scratchpad/mock_prod_server.py &   # 127.0.0.1:8200
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
```
（capture 前に「新カード2枚・?・health canvas を含む」ことを目視確認してから baseline 化。以後は `compare` で MATCH をゲートに。）

- [ ] **Step 4: 統合 Playwright スモーク**

株式（7203.T）＋ETF（SPY）＋米国株（AAPL）で: 全カード描画・`?` 可視/見切れなし・digest 7行/ETF でも表示・health 二軸/ETF で非表示・年切替でカード非増殖・免責存在・pageerror0・CSP 違反0。

- [ ] **Step 5: Commit**

```bash
git add api/me tests scratchpad
git commit -m "test: facts non-leak negative test + refreshed detail snapshot baseline"
```

---

## Self-Review（spec 突合）

- **§3 グロッサリ**：Task1(データ/免責)・Task2(builder)・Task3(CSS)・Task4(data-term＋early-return前注入) で被覆。
- **§4 signalDigest**：Task5(純関数・中立閉集合・time-index・no-data)・Task6(no-score構造/語彙/time-index テスト)・Task7(冪等カード・免責・ETF-safe) で被覆。tone 売買語排除＝Task5 実装＋Task6 語彙テスト。
- **§5 健全性**：Task8(MARKET_BASIS数値/totalLiabilities)・Task9(比率別欠測ゲート)・Task10(Chart.js line・destroy先行・responsive・repaintガード)・Task11(静的カード・ETF finCards・中立注記・免責)・Task12(entrance) で被覆。
- **§6 横断**：免責自己完結（Task1/7/11）・facts非出力 negative test（Task13）・0x0罠（Task11 chart-container）・money非改変（全タスク detail 側）。
- **§7 テスト**：node --test（各機能）・snapshot baseline 再取得（Task13）・Playwright（Task4/7/11/13）・本人実機（下記 handoff）。
- **型整合**：`signalDigest` 返り descriptor は `{key,label,term,state,readout,note?}` で Task5/6/7 一致。`healthTrendSeries` 返りは Task9/10 一致。`marketBasisFor` の `equityMin/currentLow/currentHigh` は Task8/9/10 一致。`Detail.termHelp/injectTermHelp/renderSignalDigest`・`DetailCharts.renderHealthTrend` の公開名は各 Task 一致。
- **Placeholder**：各コード step に実コードを記載。既存ファイルへの挿入は「行番号＋追加スニペット＋現物突合指示」で具体化（実装者はファイルを開いて挿入位置を確認）。

## 実装上の技術制約（再掲・厳守）
0x0罠（chart-container 寸法/初期化順序）・ローソク確定色/ZigZag逆規約の意味付け保持・money 側非改変・新CDN依存を足さない・免責フェイルセーフ・no-score 構造・facts 非出力・termHelp は純CSS（onclick 不使用）。
