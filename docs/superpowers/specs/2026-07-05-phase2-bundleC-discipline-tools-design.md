---
date: 2026-07-05
type: design-spec
status: draft（設計承認済 / spec 自己レビュー前）
project: investment-portal
phase: Phase2「分析力の深化」束C「規律の道具化」
scope: ①成長率エンジン ②保存できるスクリーナー（③規律テクニカル ADX/ATR は別セッション）
related: [[investment-portal]] [[2026-07-03-phase2-analysis-ideation-menu]] [[2026-07-05-phase2-bundleB-relative-view-design]]
---

# 束C「規律の道具化」設計 — ①成長率エンジン ②保存できるスクリーナー

## 0. 背景・方向性

Phase2「分析力の深化」の第3束。芯は**規律（discipline）の道具化**＝「ブレない判断軸を、保存でき・単年の近視を超えて見られる道具にする」。束A（教育の土台＝グロッサリ/signalDigest/健全性トレンド）と束B（相対で見る目＝`cross-section-rules.js`）が本番稼働済で、その土台（`FinanceRules` 単社getter・`CrossSection` 統計・`INDICATOR_GLOSSARY` 単一源・termHelp・ANALYSIS_DISCLAIMER）を再利用する。

**本セッションのスコープ = ①②のみ。** ③規律テクニカル（ADX/DMI・ATR/Keltner）は「可視サブパネル選択UIを先に設計する」横断課題（ideation 横断リスク#1）を抱えるため別セッションに切り離す。

## 1. スコープと非スコープ

### スコープ（本 spec）
- **① 成長率エンジン**：list 直近3期から売上・純利益の **YoY**（前年比）と **3期CAGR** を純関数で算出し、ポータル一覧のソート/スクリーニング軸＋「3期トレンド」列のバッジとして露出。
- **② 保存できるスクリーナー**：現行4軸（PER/PBR/自己資本比率/営業利益率）を **8軸**（＋ROE/流動比率/売上成長率(CAGR)/純利益率）へ拡張。**市場（JP/US）複数選択**を追加。**名前付きプリセット**を localStorage 永続化（保存/呼出/削除）。

### 非スコープ
- ③規律テクニカル（ADX/ATR）— 別セッション。
- 純利益成長率の**一覧専用列**追加（過密回避のため一覧視認は売上CAGRバッジのみ・純利益成長はバッジ tooltip とスクリーナー軸で露出）。
- 詳細ビューへの成長率カード新設（本束は「一覧＋スクリーナー」に集中。詳細への露出は将来の束D/追補）。
- LWC/Chart.js の新規 canvas（本束は inline SVG バッジ＋テキスト＋入力UIのみ＝0x0罠の新規発生なし）。
- サーバ/DB/ETL 変更（list.py が既に直近3期を返す＝クライアント算出で完結）。money/advice/収支レイヤーは非接触。

## 2. 土台と再利用（実コード確認済み）

- **`list.py`** は各銘柄 `financials_trend` に**直近3会計年度**を返す（`_GRID_FIN_FIELDS` = net_sales / net_assets / current_assets / non_current_assets / current_liabilities / operating_income / net_income）。→ 売上・純利益とも3年分あり、YoY（N vs N−1）と3期CAGR（begin〜end）を算出可能。
- **`finance-rules.js`**（`window.FinanceRules`・UMD-lite・node --test）＝単社スナップショットの比率getter（`equityRatio`/`currentRatio`/`opMargin`/`netMargin`/`roe`/`roa`）＋`n()`（NaN→0）。**ここに成長セクションを追加**。
- **`cross-section-rules.js`**（`window.CrossSection`）＝統計・METRIC_REGISTRY・欠測ゲート。本束の直接依存はしないが**欠測=母集団除外の規約を踏襲**。
- **index.html**：`screening` state（4軸 min/max）→ inline `passesScreening(item)` → `filterAndRenderPortal()`。item は flat（sort は `item[sortKey]`、`setSort()` 駆動）。localStorage は watchlist（`sip_watchlist`）で既に使用＝プリセットも同型。F2 で inline `<script>` は IIFE 隔離済＝**新公開関数は末尾 `Object.assign(window, …)` へ**（グローバル汚染を増やさない）。
- **`detail-rules.js` `INDICATOR_GLOSSARY`**（分析側グロッサリ単一源）＋`detail.js` の termHelp `?` ポップオーバー。**成長用語をここへ追加**。
- **`money.js` esc / window.esc**（F2公開）＝サーバ由来文字列のエスケープ単一源。

## 3. アーキテクチャ

| 層 | ① 成長率 | ② スクリーナー |
|---|---|---|
| 純ロジック | `finance-rules.js` に growth セクション（`yoy`/`cagr`/`growthRates`）＋テスト | **新 `screener-rules.js`**（`AXIS_REGISTRY`＋`passesScreening`/`passesMarket`/`normalizeCriteria`＋プリセット schema `validatePreset`/`migratePreset`/`loadPresets`/`savePresets`）＋テスト |
| DOM/UI | index.html：item に flat 成長 key、「3期トレンド」列のソート化＋バッジ | index.html：8軸パネル・市場チェック・プリセット行、`applyScreening` 拡張、`passesScreening` を `ScreenerRules` 呼出へ置換、`<script src="screener-rules.js">` 追加 |
| 教育/規制 | `INDICATOR_GLOSSARY` に cagr/yoy/growth-rate、バッジ中立トーン | 各軸ラベルに `?`、パネルに1行の中立注記（スクリーニング=条件抽出であり売買推奨ではない） |

**設計原則**：純ロジックは DOM 非依存・副作用なし・node --test で固定。index.html は「入力→criteria 構築→純述語→描画」の薄層。`screener-rules.js` 新設で inline `passesScreening`（拡張で肥大化する）をテスト可能な単一源へ集約＝監査F1（inline 複製の集約）と同型の「触る箇所の土台化」。

## 4. ① 成長率エンジン 詳細仕様

### 4.1 純関数（`finance-rules.js` 追加）

```js
// yoy(prev, curr): 前年比 %。基準(prev)が非正なら算出不能→null（符号反転・0基準を排除）。
function yoy(prev, curr) {
  var p = n(prev), c = n(curr);
  if (!(p > 0)) return null;
  return ((c - p) / p) * 100;
}

// cagr(begin, end, periods): 年平均成長率 %。両端が正・periods>=1 のときのみ算出（両端正で
//  符号反転/0基準/負CAGRの非実数化を根絶）。periods は年数の差（会計年度の差）。
function cagr(begin, end, periods) {
  var b = n(begin), e = n(end);
  if (!(b > 0) || !(e > 0) || !(periods >= 1)) return null;
  return (Math.pow(e / b, 1 / periods) - 1) * 100;
}

// growthRates(trend, fields): 各 field の {yoy, cagr, beginYear, endYear, periods} を返す純関数。
//  trend = { "2023": {net_sales,...}, "2024": {...}, "2025": {...} }（list の financials_trend）。
//  各 field について「値が存在する (year,value) 対」を年昇順に収集し:
//   - yoy   = 最新年 と (最新年-1) の対（直近の連続する会計年度）が両方存在すれば yoy()、なければ null。
//   - cagr  = 収集した最古年(begin) と 最新年(end)、periods = endYear - beginYear（>=1）。
//  欠測年はスキップ（詰めるのでなく実在年で span を測る＝CAGR は暦年ベースで正しい）。
//  fields 既定 = ["net_sales", "net_income"]。返り値は field 名キーのオブジェクト。
```

**罠ガード（テストで固定する不変条件）**
- 基準（prev / begin）が **≤0** → null（純利益が基準年に赤字/ゼロ→成長率は無意味）。
- 両端の**符号が違う**ケースは `cagr` が両端>0 要求で自動的に null 化。
- **年数不足**：trend に有効年が1つ→yoy/cagr とも null。2つ→yoy 可（連続年なら）・cagr は periods=年差で算出。3つ→通常。
- **欠測年**：net_income が特定年のみ欠落しても、その field の存在年だけで begin/end/yoy を決める。
- **NaN/非数**：`n()` で 0 化された後に `>0` ゲート＝欠損は算出不能扱い。

### 4.2 item への flat key（index.html `filterAndRenderPortal`）

`item` 構築時に `FinanceRules.growthRates(company.financials_trend, ["net_sales","net_income"])` を1回呼び、以下を付与（すべて number | null）：
- `salesYoY`, `salesCagr`（= 売上）
- `niYoY`, `niCagr`（= 純利益）
- `netMargin`（= `FinanceRules.netMargin(fin)`。スクリーナー②の純利益率軸で使用＝item に追加）

### 4.3 グリッド見せ方（過密回避＝専用列を足さない）

- **「3期トレンド」列**（現状 `width:9%`・`cursor:default`・非ソート）を **売上CAGR でソート可能**化：ヘッダを `売上3期 ↕`（またはトレンド見出しにソートアイコン）にし `onclick="setSort('salesCagr')"`。
- セル：既存の売上スパークライン（inline SVG）の下に**成長バッジ** `CAGR ↑X.X%` / `↓X.X%`（`salesCagr`。null は「—」）。
  - **中立トーン**：上昇/下降は方向記号（↑/↓）＋控えめな色（緑=買い/赤=売りに読ませない・既存ローソク確定色とは無関係の淡色 `var(--ix-*)` トークン、上昇/下降で同系の明暗差のみ）。
  - **tooltip（title 属性）**：`売上YoY {salesYoY}% ／ 純利益CAGR {niCagr}% ／ 純利益YoY {niYoY}%`（null は「—」・`window.esc` 不要＝数値のみ）。
- **ソート null 処理**：`salesCagr`/`niCagr` は null を含む。sort 比較で null/NaN は**方向に依らず常に末尾**（既存 `valA - valB` は null→0 で混ざるため、成長 key 用に null-last ヘルパを導入＝「値のある銘柄が上、算出不能は下」）。
- `setSort('salesCagr')` の既定方向：**降順**（成長率は高い順が自然）。既存 `setSort` の初期 `sortAsc` 判定に growth key を追加（growth = false=降順）。

## 5. ② 保存できるスクリーナー 詳細仕様

### 5.1 軸レジストリ（`screener-rules.js`）

```js
// 各軸：key（criteria/preset キー）・label・termKey（グロッサリ）・unit・field（item のプロパティ名）・kind。
// kind = "positive"（PER/PBR：0以下=欠損、既存の割安フィルタ挙動を保存）
//      | "ratio"（比率%：item に number で入る＝欠損は FinanceRules で 0・負も正当）
//      | "growth"（null 可＝算出不能は制約時に除外）
AXIS_REGISTRY = [
  { key:"per",        label:"PER",              termKey:"per",           unit:"倍", field:"per",       kind:"positive", group:"割安" },
  { key:"pbr",        label:"PBR",              termKey:"pbr",           unit:"倍", field:"pbr",       kind:"positive", group:"割安" },
  { key:"opMargin",   label:"営業利益率",        termKey:"op-margin",     unit:"%",  field:"opMargin",  kind:"ratio",    group:"収益" },
  { key:"roe",        label:"ROE",              termKey:"roe",           unit:"%",  field:"roe",       kind:"ratio",    group:"収益" },
  { key:"netMargin",  label:"純利益率",          termKey:"net-margin",    unit:"%",  field:"netMargin", kind:"ratio",    group:"収益" },
  { key:"eqRatio",    label:"自己資本比率",      termKey:"equity-ratio",  unit:"%",  field:"eqRatio",   kind:"ratio",    group:"安全" },
  { key:"curRatio",   label:"流動比率",          termKey:"current-ratio", unit:"%",  field:"curRatio",  kind:"ratio",    group:"安全" },
  { key:"salesCagr",  label:"売上成長率(3期CAGR)", termKey:"cagr",        unit:"%",  field:"salesCagr", kind:"growth",   group:"成長" },
];
```

### 5.2 述語（`passesScreening(item, criteria)`）

`criteria` = `{ axisKey: { min:Number|null, max:Number|null }, … }`（制約のある軸のみ）。各軸で：
- **positive**（PER/PBR）：既存挙動を保存＝
  - `min` 設定時：`value<=0`（欠損）→ 除外、`value<min` → 除外。
  - `max` 設定時：`value>0 && value>max` → 除外（`value<=0` は max のみでは除外しない＝既存と同一）。
- **ratio**（eqRatio/opMargin/roe/curRatio/netMargin）：`value` は number（FinanceRules が欠損を0化）。
  - `min` 設定時：`value<min` → 除外（ETF/欠損=0 は min>0 で自然に除外）。
  - `max` 設定時：`value>max` → 除外。
- **growth**（salesCagr）：`value` は number|null。
  - **制約（min か max のいずれか）が設定されているのに `value===null`（算出不能） → 除外**（欠測=母集団除外）。
  - `min` 設定 & `value<min` → 除外、`max` 設定 & `value>max` → 除外。

`passesMarket(item, markets)`：`markets` = `["JP"]|["US"]|["JP","US"]|[]`。空配列 → 常に true。それ以外は `markets.includes(item.country)` のみ通す。**既存セクタークイックチップ（`activeSectorFilter`）とは AND**（両方を満たす銘柄のみ）。

`normalizeCriteria(inputs)`：8軸 min/max の生入力（文字列/空）→ 有限数のみ拾って `{axisKey:{min,max}}` を構築（min/max とも null の軸は落とす）。`hasAnyConstraint(criteria, markets)` で結果数バッジの表示判定。

### 5.3 プリセット schema と永続化（`screener-rules.js`）

```
Preset = { name: string(1..40), criteria: {axisKey:{min,max}}, markets: string[], v: 1 }
```
- `validatePreset(p)`：name 非空・criteria キー ∈ AXIS_REGISTRY・min/max は有限数 or null・markets ⊆ ["JP","US"]。不正は false。
- `migratePreset(p)`：`v` 欠落/旧形 → v:1 へ寄せる（将来の schema 変更耐性・未知キーは捨てる）。
- `loadPresets()` / `savePresets(list)`：localStorage `sip_screener_presets`（JSON 配列）。**try/catch で破損時 []・quota 超過は握り潰して警告**（watchlist と同型・個人設定ゆえ送信ゼロ）。
- 同名保存は上書き（confirm 不要・プロンプト名で管理）。

### 5.4 UI（index.html screening-panel 拡張）

- **軸グリッド**：既存 `.screening-grid`（`repeat(auto-fit, minmax(200px,1fr))`）に4軸追加＝計8。**グループ見出し**（割安 / 収益 / 安全 / 成長）で区切り、各軸は既存の min〜max range 入力パターンを踏襲。モバイル `≤480px` は既存 `.screening-grid{grid-template-columns:1fr}` で1列。
- **市場チェック**：パネル上部に `JP / US` の2チェック（既定=両方チェック=無制約と等価、または両オフ=無制約に正規化）。`applyScreening` が読む `screeningMarkets`。
- **プリセット行**：`<select>`（保存済プリセット）＋「現在の条件を保存」ボタン（`prompt()` で名前）＋「削除」。呼出＝select 変更で `loadScreenerPreset(name)`（入力欄と市場チェックを復元→`applyScreening`）。
- **中立注記**：パネル末尾に1行「スクリーニングは条件による抽出であり、売買を推奨するものではありません」（`ANALYSIS_DISCLAIMER` と同トーン・規制安全）。
- **`?` 用語**：各軸ラベルに termHelp（`INDICATOR_GLOSSARY` 参照）。ポータル側に termHelp ポップオーバー機構が無ければ、最小実装（`title` 属性 or 既存 detail の termHelp 部品の再利用）で対応＝**実装時に既存機構の有無を確認して最小差分で配線**。

### 5.5 index.html 配線変更点

- `screening` state：4軸 → 8軸（criteria 形へ寄せる or 既存 flat を維持しつつ `normalizeCriteria` で criteria 化）。`screeningMarkets` 追加。
- `applyScreening()` / `resetScreening()`：8軸＋市場を読む/クリアへ拡張。
- `passesScreening(item)`（inline）→ `ScreenerRules.passesScreening(item, criteria) && ScreenerRules.passesMarket(item, markets)` へ置換。
- `filterAndRenderPortal`：item に `netMargin` / `salesYoY` / `salesCagr` / `niYoY` / `niCagr` を付与。結果数バッジは `hasAnyConstraint` で判定。
- 新公開関数（`saveScreenerPreset`/`loadScreenerPreset`/`deleteScreenerPreset` 等 inline onclick から呼ぶもの）は**末尾 `Object.assign(window, …)`** へ（F2 規律）。

## 6. 教育・規制フレーム

- **中立語・no-score**：成長バッジは方向＋数値のみ（「割安/買い時」語を出さない）。スクリーナーは条件抽出（合否スコア化しない）。
- **グロッサリ追加**（`INDICATOR_GLOSSARY`・単一源）：
  - `cagr`：「年平均成長率。複数年の増減を1年あたりの平均ペースに均した指標。」
  - `yoy`：「前年比。直近1年の増減率。」
  - `growth-rate`（成長率）：「売上や利益が前年（または数年平均）に対しどれだけ増減したか。将来の株価を保証するものではない。」
- **免責**：スクリーナー注記1行＋既存 `ANALYSIS_DISCLAIMER` トーン踏襲。facts非出力（LLM 非経由・個人データ非接触・public market データのみをクライアント算出）。

## 7. 検証計画（束A/B と同水準）

- **node --test**
  - `finance-rules.test.js` 追補：`yoy`（正常/基準0/基準負/等値）・`cagr`（正常/両端正のみ/periods<1/end負）・`growthRates`（3期正常/欠測年/2期のみ/1期のみ/純利益赤字基準→null/売上と純利益の独立）。
  - `screener-rules.test.js`（新規）：各 kind の境界（min/max・positive の 0以下・growth の null 除外）・`passesMarket`（空=全通過/単一/AND）・`normalizeCriteria`・`validatePreset`/`migratePreset`（不正拒否・旧形移行）・localStorage round-trip（破損→[]）。
- **Playwright（実ブラウザ・headless＋本番 curl）**
  - グリッド：売上CAGRバッジ表示・「3期トレンド」列ソート（昇降・null 末尾）・tooltip。
  - スクリーナー：8軸フィルタ各々・**ETF 除外**（成長/比率軸制約時）・**市場AND**（JP チェック×US チップで空）・結果数バッジ。
  - プリセット：保存→select 出現→呼出で入力復元＆再フィルタ→削除。localStorage 反映。
  - 回帰：`pageerror0`・既存4軸フィルタ挙動不変・ソート既存キー不変・money/detail ビュー無影響。
- **規制安全 grep**：バッジ/注記/グロッサリに売買・予測・推奨語彙が無いこと。
- **ultracode 運用**：spec 完成 → **敵対検証 workflow で pre-mortem**（correctness/regression/regulatory/boundaries の4次元×refute）→ 確定 findings を spec に反映 → 本人 spec レビュー → writing-plans → 実装（subagent-driven＋機能ごと敵対検証wf）。

## 8. 制約（不可侵）

- **0x0罠**：本束は新規 LWC/Chart canvas を追加しない（成長=inline SVG バッジ＋テキスト、スクリーナー=入力UI）。既存チャートの寸法/初期化順序は無改変。
- **F2 IIFE 隔離**：index.html inline `<script>` のグローバル汚染を増やさない＝新公開関数は末尾 `Object.assign(window,…)`。`currentTicker`/`currentView` の生束縛には触れない。
- **facts非出力・個人データ非接触**：money/advice/収支/investment 台帳レイヤーに触れない。LLM 非経由。
- **既存挙動保存**：現行4軸スクリーニングの境界挙動（PER/PBR の 0以下＝欠損扱い等）を `screener-rules.js` に移しても**同一**に保つ（テストで固定）。
- **チャート改変**：2026-07-01 に freeze 解除済だが本束はチャート非改変。

## 9. 実装段階（writing-plans で TDD 化）

1. `finance-rules.js` に growth（`yoy`/`cagr`/`growthRates`）＋テスト。
2. `screener-rules.js` 新設（AXIS_REGISTRY・`passesScreening`/`passesMarket`/`normalizeCriteria`・プリセット schema）＋テスト。既存 inline `passesScreening` の挙動を移植し同一性をテストで固定。
3. index.html：item に成長 flat key＋`netMargin`。① グリッドのバッジ＋トレンド列ソート（null 末尾・降順既定）。
4. index.html：② スクリーナー 8軸パネル＋市場チェック＋プリセット CRUD＋`passesScreening` を `ScreenerRules` 呼出へ置換＋`<script>` 追加。
5. `INDICATOR_GLOSSARY` に cagr/yoy/growth-rate＋`?` 配線＋スクリーナー注記。
6. 統合検証（Playwright＋本番 curl）＋規制 grep＋回帰（既存ビュー/既存軸）。

## 10. 再開の合図

「investment 束C の spec レビュー後、writing-plans から」／「束C 実装の続き＝Task N から」。所有ノート = Obsidian Projects/investment-portal.md。
