---
date: 2026-07-05
type: design-spec
status: hardened（設計承認済 / 敵対検証wf pre-mortem 21確定findings 反映済 / 本人specレビュー前）
project: investment-portal
phase: Phase2「分析力の深化」束C「規律の道具化」
scope: ①成長率エンジン ②保存できるスクリーナー（③規律テクニカル ADX/ATR は別セッション）
related: [[investment-portal]] [[2026-07-03-phase2-analysis-ideation-menu]] [[2026-07-05-phase2-bundleB-relative-view-design]]
---

# 束C「規律の道具化」設計 — ①成長率エンジン ②保存できるスクリーナー

## 0. 背景・方向性

Phase2「分析力の深化」の第3束。芯は**規律（discipline）の道具化**＝「ブレない判断軸を、保存でき・単年の近視を超えて見られる道具にする」。束A（教育の土台＝グロッサリ/signalDigest/健全性トレンド）と束B（相対で見る目＝`cross-section-rules.js`）が本番稼働済で、その土台（`FinanceRules` 単社getter・`CrossSection` 統計・`INDICATOR_GLOSSARY` 単一源・termHelp・ANALYSIS_DISCLAIMER）を再利用する。

**本セッションのスコープ = ①②のみ。** ③規律テクニカル（ADX/DMI・ATR/Keltner）は「可視サブパネル選択UIを先に設計する」横断課題を別セッションに切り離す。

> **本 spec は敵対検証 workflow（run wf_7a64ba15・5次元 find→refute verify）で 21 件の確定 findings を pre-mortem 反映済み。** 主要決定：(D1) 全 ratio 軸を欠測→null 化で統一（本人決定）。(D2) 市場フィルタは既存チップと市場チェックの両系統を残して整合（本人決定）。詳細は各節と §11 に記録。

## 1. スコープと非スコープ

### スコープ（本 spec）
- **① 成長率エンジン**：list 直近3期から**売上・純利益**の **YoY**（前年比）と **3期CAGR** を純関数で算出し、ポータル一覧の**ソート/スクリーニング軸（売上CAGRのみ）**＋「3期トレンド」列のバッジ（売上CAGR）として露出。
- **② 保存できるスクリーナー**：現行4軸（PER/PBR/自己資本比率/営業利益率）を **8軸**（＋ROE/流動比率/売上成長率(CAGR)/純利益率）へ拡張。**市場（JP/US）複数選択**を追加。**名前付きプリセット**を localStorage 永続化（保存/呼出/削除）。

### 非スコープ
- ③規律テクニカル（ADX/ATR）— 別セッション。
- **純利益成長（niYoY/niCagr）のスクリーナー軸・ソート列・専用グリッド列**（過密回避）。純利益成長は**「3期トレンド」列バッジの tooltip でのみ露出**（算出はする＝§4.1）。※旧 spec L27 の「純利益成長はスクリーナー軸で露出」は AXIS_REGISTRY に該当軸が無い矛盾だったため**削除**（finding 15）。
- 詳細ビューへの成長率カード新設（本束は「一覧＋スクリーナー」に集中）。
- LWC/Chart.js の新規 canvas（本束は inline SVG バッジ＋テキスト＋入力UIのみ＝0x0罠の新規発生なし）。
- サーバ/DB/ETL 変更（list.py が既に直近3期を返す＝クライアント算出で完結）。money/advice/収支/investment 台帳レイヤーは非接触。

## 2. 土台と再利用（実コード確認済み・行番号は 005362e 時点）

- **`list.py`** は各銘柄 `financials_trend` に**直近3会計年度**を返す（`_GRID_FIN_FIELDS` = net_sales / net_assets / current_assets / non_current_assets / current_liabilities / operating_income / net_income）。**値が NULL の項目はキー自体を落とす**（list.py:73 `if v is not None`）＝「年キーは在るが net_sales 欠測」が実データで生じ得る（finding 14）。ETF は `financials_trend={}`（list.py:56）。
- **`finance-rules.js`**（`window.FinanceRules`・UMD-lite・node --test）＝`ratio()` は分母≤0 で **0 を返す**（finance-rules.js:19-22）。**この 0 が「欠測」と「実データ0」を区別できない**のが finding 1/3 の根因＝本 spec は欠測→null ゲート（§4.2）で解決。
- **`cross-section-rules.js`**（`window.CrossSection`）＝`_finRatio(fin, fn, needKeys, denomKeys)`（52-62・hasValue＋正分母ゲートで欠測→null）が同じ罠を既に解決済み。**本束はこの規約を踏襲**（§2 の「欠測=母集団除外」を全 ratio/growth 軸で一貫させる）。
- **index.html**：`screening` state（4軸 min/max）→ inline `passesScreening(item)`（1589-1600）→ `filterAndRenderPortal()`。item は flat（sort は `item[sortKey]`・比較器 1838-1848、`setSort()` 2004-2016・**未列挙キーは既定で降順**）。`resetScreening`（1583-1586）は入力ID をハードコード列挙。結果数バッジは `Object.values(screening).some(v=>v!==null)`（1834）。localStorage は watchlist（`sip_watchlist`・1602-1619）で既に使用。F2 で inline `<script>` は IIFE 隔離済＝**新公開関数は末尾 `Object.assign(window, …)` へ**（1258 付近）。
- **termHelp 機構は既にポータルで有効**（finding 9/12/18）：`.term-help` 純CSSポップオーバーは `detail.css`（~809-832）にあり、detail.css は `<head>` で常時 `<link>`（index.html:963）＝ポータルでも効く。`window.Detail.termHelp / injectTermHelp`（detail.js:214-231, 578）は公開済で `[data-term]` を冪等注入。グロッサリ単一源 `INDICATOR_GLOSSARY`（detail-rules.js:49・要素は `{term, read, def}`・termHelp は `read + "：" + def` を描画）。**detail.js は inline(1475) より後の 2275 でロード**＝`window.Detail.*` は inline パース時は未定義。データfetch後のポータル描画時に呼ぶ限り解決済（§5.4 で明記）。
- **既存 YoY**：`DetailRules.yoyBadge(curr, prev)`（detail-rules.js:325-331・`if(!prev||prev===0) return ""` 後 `((curr-prev)/Math.abs(prev))*100`）＝**負基準は abs 分母で数値**。本束の新 `yoy` は**これと数値一致させ単一源方針を守る**（§4.1・finding 16）。
- **`window.esc`**（index.html:1489・サーバ由来文字列のエスケープ単一源）。本束は**ユーザ由来のプリセット名も esc/textContent で通す**（finding 10/20・§5.3）。

## 3. アーキテクチャ

| 層 | ① 成長率 | ② スクリーナー |
|---|---|---|
| 純ロジック | `finance-rules.js` に growth（`yoy`/`cagr`/`growthRates`）＋**欠測ゲート `ratioOrNull`**＋テスト | **新 `screener-rules.js`**（`AXIS_REGISTRY`〔domId 付き〕・`passesScreening`/`passesMarket`/`normalizeMarkets`/`normalizeCriteria`/`hasAnyConstraint`・プリセット `validatePreset`/`migratePreset`/`loadPresets`/`savePresets`）＋テスト |
| DOM/UI | index.html：item に null安全な ratio値＋flat 成長 key、「3期トレンド」列のソート化＋バッジ、null-last 比較器 | index.html：8軸パネル・市場チェック・プリセット行、`applyScreening` 拡張、`passesScreening` を `ScreenerRules` 呼出へ置換、`<script src="screener-rules.js">` 追加 |
| 教育/規制 | `INDICATOR_GLOSSARY` に cagr/growth-rate（read 付き）、バッジは `--ix-text-dim` 単色固定 | 各軸ラベルに `data-term`＋`Detail.injectTermHelp`、パネルに中立注記 |

**cross-module 依存（境界表に明記）**：screener-rules.js は `item` の算出済フィールドのみ読む＝FinanceRules 非依存（ロード順自由）。ただし **`<script src="screener-rules.js">` は index.html inline script が `ScreenerRules` を参照する前にロード**（finance-rules.js／cross-section-rules.js と同じ `<head>`/`<body>` 前方）。termHelp は `window.Detail.injectTermHelp`（detail.js:2275 ロード）に依存＝**呼び出しは fetch 後のポータル描画時**（inline 同期初期化時に呼ばない）。

**設計原則**：純ロジックは DOM 非依存・副作用なし・node --test で固定。index.html は「入力→criteria 構築→純述語→描画」の薄層。`screener-rules.js` 新設で inline `passesScreening`（拡張で肥大化）をテスト可能な単一源へ集約＝監査F1と同型の「触る箇所の土台化」。

## 4. ① 成長率エンジン 詳細仕様

### 4.1 純関数（`finance-rules.js` 追加）

```js
// yoy(prev, curr): 前年比 %。基準0/欠測は null。負基準は abs 分母（DetailRules.yoyBadge と数値一致＝単一源方針）。
function yoy(prev, curr) {
  var p = n(prev), c = n(curr);
  if (p === 0) return null;                 // 基準0＝算出不能（yoyBadge の !prev||prev===0 と一致）
  return ((c - p) / Math.abs(p)) * 100;     // 負基準も符号を保った直近増減率（yoyBadge と同式）
}

// cagr(begin, end, periods): 年平均成長率 %。両端が正・periods>=1 のときのみ算出
//  （両端正で符号反転/0基準/負ratioの非実数化を根絶。yoy と base 処理が異なるのは意図的＝§11 D3）。
function cagr(begin, end, periods) {
  var b = n(begin), e = n(end);
  if (!(b > 0) || !(e > 0) || !(periods >= 1)) return null;
  return (Math.pow(e / b, 1 / periods) - 1) * 100;
}

// growthRates(trend, fields): 各 field の {yoy, cagr, beginYear, endYear} を返す純関数。fields 既定=["net_sales","net_income"]。
//  手順（field ごと）：
//   1. trend の各年 obj から「その field を値として持つ (year,value) 対」を年昇順に収集（欠測年はスキップ＝list.py:73 で該当キーが落ちる年を除外）。
//   2. yoy = 最新年 y_n と、そのちょうど1年前 (y_n - 1) の対が両方存在すれば yoy(prev,curr)、無ければ null（非連続の飛び年は yoy 対象にしない＝honest）。
//   3. cagr = 収集対の最古(begin,beginYear) と 最新(end,endYear)、periods = endYear - beginYear（>=1）。1対のみ/periods<1 は null。
//  返り値例：{ net_sales:{yoy, cagr, beginYear, endYear}, net_income:{...} }。
```

**罠ガード（テストで固定する不変条件・§7）**：cagr は基準/末尾が **≤0** で null（純利益赤字基準→無意味）／符号反転は両端>0要求で自動 null／年数不足（有効1対）→yoy/cagr とも null／欠測年は暦年 span で扱う。yoy は基準0で null・負基準は abs 分母（yoyBadge と一致）。

### 4.2 item への付与（index.html `filterAndRenderPortal`）

**(a) ratio 値の欠測→null 化（D1・全 ratio 軸統一）**：`finance-rules.js` に欠測ゲート付き getter を追加し、item は **0埋めでなく null** を持つ。
```js
// ratioOrNull(fin, fn, needKeys, denomKeys): CrossSection._finRatio 同型。needKeys 全て hasValue かつ denomKeys 合計>0 の時のみ fn(fin)、
//  そうでなければ null。fn は既存 FinanceRules.equityRatio/opMargin/roe/currentRatio/netMargin。
```
item：`eqRatio` / `opMargin` / `roe` / `curRatio` / `netMargin` を **`ratioOrNull` 経由で number|null**（ETF・財務欠損株は null）。
- **グリッド表示の null 安全化**：健全性(eqRatio)・営業利益率(opMargin)・ROE 列は **null→「—」**、閾値バッジ（opMargin≥25 の sparkle・roe<0 の赤・roe≥15 の金 等 index.html:1931-1941）は **null を「非該当（装飾なし）」** に扱う。ETF/欠損行は該当列のみ「—」・**行自体は描画継続**（§7 で回帰確認）。※これは「0.0% と偽表示」より正直（ETF に自己資本比率は無い）。

**(b) 成長 flat key**：`FinanceRules.growthRates(company.financials_trend, ["net_sales","net_income"])` を1回呼び、`salesYoY` / `salesCagr` / `niYoY` / `niCagr`（number|null）を付与。

### 4.3 グリッド見せ方（過密回避＝専用列を足さない）

- **「3期トレンド」列**（現状 `width:9%`・`cursor:default`・非ソート）を **売上CAGR でソート可能**化：ヘッダに `売上3期 ↕` 相当＋`onclick="setSort('salesCagr')"`。
  - **ソート方向**：`salesCagr` は setSort の未列挙キーゆえ**既定で降順**（setSort 2009-2013 は無改変・finding 13/21。※`|| key==="salesCagr"` を足すと逆に昇順になり誤り＝追記しない）。
- **バッジ**：既存の売上スパークライン（inline SVG）の下に `CAGR ↑X.X%` / `↓X.X%`（`salesCagr`。null は「—」）。
  - **色（decision-complete・finding 6）**：上昇/下降とも **`--ix-text-dim` 単色**＋方向記号（↑/↓）と**不透明度差のみ**。緑/赤/金の hue は**禁止**（隣接セルの緑=良/赤=悪セマフォアに合わせない＝§8 不可侵）。
  - **tooltip（title 属性・数値のみゆえ esc 不要）**：`売上YoY {salesYoY}% ／ 純利益CAGR {niCagr}% ／ 純利益YoY {niYoY}%`（null は「—」）。純利益成長はここでのみ露出。
  - **スパークラインとバッジの欠測年差（finding 14・意図的）**：スパークラインは欠測年を 0 描画（既存 `net_sales||0`）、バッジ CAGR は欠測年スキップで暦年 span 準拠。欠測がある銘柄で折れ線とバッジ値が一致しないことがある旨を実装コメントに残し、§7 で欠測年ケースを確認。
- **null-last 比較器（finding 1/21・方向独立）**：sort 比較で **null/NaN は sortAsc に依らず常に末尾**。対象＝null を持ち得る数値キー（`eqRatio`/`opMargin`/`roe`/`curRatio`/`netMargin`/`salesCagr`/`niCagr`）。文字列キー（ticker/name）と 0埋めキー（per/pbr/marketCap/sales）は既存挙動のまま。実装は既存比較器（1838-1848）の `typeof valA==="string"` 分岐より前に null 判定を置く。

## 5. ② 保存できるスクリーナー 詳細仕様

### 5.1 軸レジストリ（`screener-rules.js`・domId 付き）

```js
// key（criteria/preset キー）・label・termKey（グロッサリ・cagr のみ有効）・unit・field（item プロパティ）・kind・group・dom{min,max}。
// dom は既存 ID を温存（finding 8＝eqRatio≠scr-eq の命名スキュー回避）。normalizeCriteria の読取・loadScreenerPreset の書戻し・
// resetScreening のクリアは全て AXIS_REGISTRY.dom 由来の単一マップから導く（key 派生で scr-eqRatio-min 等を生成しない）。
// kind = "positive"（PER/PBR：0以下=欠損・既存の非対称挙動を保存＝§8）
//      | "nullable"（ratio+growth：value は number|null・欠測=null・制約時 null は除外＝D1 で統一）
AXIS_REGISTRY = [
  { key:"per",       label:"PER",               termKey:null,  unit:"倍", field:"per",       kind:"positive", group:"割安", dom:{min:"scr-per-min", max:"scr-per-max"} },
  { key:"pbr",       label:"PBR",               termKey:null,  unit:"倍", field:"pbr",       kind:"positive", group:"割安", dom:{min:"scr-pbr-min", max:"scr-pbr-max"} },
  { key:"opMargin",  label:"営業利益率",         termKey:"op-margin",     unit:"%", field:"opMargin",  kind:"nullable", group:"収益", dom:{min:"scr-op-min",  max:"scr-op-max"} },
  { key:"roe",       label:"ROE",               termKey:"roe",           unit:"%", field:"roe",       kind:"nullable", group:"収益", dom:{min:"scr-roe-min", max:"scr-roe-max"} },
  { key:"netMargin", label:"純利益率",           termKey:"net-margin",    unit:"%", field:"netMargin", kind:"nullable", group:"収益", dom:{min:"scr-nm-min",  max:"scr-nm-max"} },
  { key:"eqRatio",   label:"自己資本比率",       termKey:"equity-ratio",  unit:"%", field:"eqRatio",   kind:"nullable", group:"安全", dom:{min:"scr-eq-min",  max:"scr-eq-max"} },
  { key:"curRatio",  label:"流動比率",           termKey:"current-ratio", unit:"%", field:"curRatio",  kind:"nullable", group:"安全", dom:{min:"scr-cur-min", max:"scr-cur-max"} },
  { key:"salesCagr", label:"売上成長率(3期CAGR)", termKey:"cagr",         unit:"%", field:"salesCagr", kind:"nullable", group:"成長", dom:{min:"scr-cagr-min",max:"scr-cagr-max"} },
];
```
> 既存 `per/pbr/opMargin(scr-op)/eqRatio(scr-eq)` の DOM ID を温存し、新軸のみ新 ID。`resetScreening` の旧ハードコード配列（index.html:1584）も **§9 Task4 で AXIS_REGISTRY.dom 由来へ置換**（新 ID 追加と同時）。

### 5.2 述語（純関数）

`criteria` = `{ axisKey: { min:Number|null, max:Number|null }, … }`（制約のある軸のみ）。

`passesScreening(item, criteria)` — 各軸で：
- **positive**（PER/PBR・既存挙動を保存＝§8）：`value = item.per|pbr`。`min` 設定時 `value<=0`（欠損）→除外 & `value<min`→除外。`max` 設定時 `value>0 && value>max`→除外（`value<=0` は max のみでは除外しない＝既存と同一・§11 D1 の非対称は意図的）。
- **nullable**（ratio+growth・D1 で統一）：`value = item.<field>`（number|null）。**その軸に制約（min か max）があり `value===null`（欠測/ETF/算出不能）→ 除外**。以降 `min` 設定 & `value<min`→除外、`max` 設定 & `value>max`→除外。

`normalizeMarkets(markets)`（finding 5/11・無制約の正準化を1つに固定）：`[]` または `["JP","US"]`（全集合）→ **`[]`（無制約）**。`["JP"]`→`["JP"]`、`["US"]`→`["US"]`。以後 length===2 は入り得ない。

`passesMarket(item, markets)`（D2＝市場チェックも ETF 除外でチップと統一）：正規化後 `markets.length===0` → true（無制約・ETF含む）。それ以外は **`item` が ETF なら false**（市場指定＝株式のみ）かつ `markets.includes(item.country)`。

`hasAnyConstraint(criteria, markets)`（結果数バッジ判定・finding 2/5/11）：`(criteria に min|max が有限な軸が1つ以上)` **または** `(normalizeMarkets(markets).length > 0)` で true。→ 「市場のみ絞込」でバッジ表示・「両チェック（=[]）」で非表示。

`normalizeCriteria(inputs)`：8軸 min/max の生入力（AXIS_REGISTRY.dom で読む）→ 有限数のみ拾い `{axisKey:{min,max}}` を構築（min/max とも null の軸は落とす）。

### 5.3 プリセット schema と永続化（`screener-rules.js`）

```
Preset = { name: string(trim後 1..40), criteria: {axisKey:{min,max}}, markets: string[](正規化済), v: 1 }
```
- `validatePreset(p)`：`name` は **trim 後 1..40**（空白のみ→不正・finding 19）・criteria キー ∈ AXIS_REGISTRY・min/max は有限数 or null・markets ⊆ ["JP","US"]（保存時は normalizeMarkets 済）。不正は false。
- `migratePreset(p)`：`v` 欠落/旧形 → v:1（未知キー破棄・将来耐性）。
- `loadPresets()` / `savePresets(list)`：localStorage `sip_screener_presets`（JSON 配列）。**try/catch で破損時 []・quota 超過は握り潰し警告**（watchlist 同型・送信ゼロ）。同名保存は上書き（confirm 不要・明記）。

**プリセット呼出手順 `loadScreenerPreset`（finding 4・clear-first）**：
1. **全 8軸16入力＋市場チェックを既定へリセット**（AXIS_REGISTRY.dom を全周回・resetScreening と共通化）＋ **`activeSectorFilter` を `"all"` にリセット**（D2＝プリセット再現性・finding 17）。
2. `preset.criteria` の軸だけ min/max を該当 dom へ setValue。
3. `preset.markets`（正規化済）で市場チェックを復元（`[]`→両チェック表示、`["JP"]`→JPのみ）。
4. `applyScreening()`。

**プリセット名の安全描画（finding 10/20）**：`<select>` option・呼出中ラベル等**ユーザ名を出す全箇所は `textContent` または `window.esc`**。呼出/削除は名前を onclick へ内挿せず **`<select>` の value / data-index ＋委譲リスナー**（既存 compare-search inline onclick XSS と同型の穴を新設しない）。

### 5.4 UI（index.html screening-panel 拡張）

- **軸グリッド**：既存 `.screening-grid` に4軸追加＝計8。**グループ見出し（割安/収益/安全/成長）**で区切り、各軸は既存 min〜max range 入力パターン。モバイル `≤480px` は既存 `.screening-grid{grid-template-columns:1fr}` で1列。
- **市場チェック**：パネル上部に `JP / US` の2チェック（**既定=両チェック=無制約**）。`applyScreening` が読み `normalizeMarkets` を通して `screeningMarkets` に格納。
- **プリセット行**：`<select>`（保存済・**0件時は disabled プレースホルダ option**・プレースホルダ選択では load しない）＋「現在の条件を保存」ボタン（`prompt()`→**キャンセル(null)/空白のみ名は no-op**・trim 後 validate・**40字超は可視 reject**）＋「削除」（**confirm() を挟む**・finding 19）。
- **termHelp（finding 9/12/18・確定）**：各軸ラベルに `data-term="op-margin|roe|net-margin|equity-ratio|current-ratio|cagr"`（PER/PBR は termKey:null＝付けない or 既存 glossary の per/pbr があれば付与）を付け、**パネル描画後に `window.Detail.injectTermHelp(panelRoot)` を呼ぶ**（`.term-help` CSS 再利用）。`INDICATOR_GLOSSARY` へ cagr/growth-rate を**先に追加**してから inject（未知 term は no-op ゆえ順序必須）。`title=` フォールバック・新規機構は不採用。
- **中立注記（規制・finding 7 と整合）**：パネル末尾に1行「スクリーニングは条件による抽出であり、売買を推奨するものではありません」（ANALYSIS_DISCLAIMER トーン）。
- **矛盾組合せの空状態（D2・finding 17）**：セクターチップ（例 us_only）×市場チェック（JP のみ）で0件になり得るため、空表示（index.html:1856）に「セクター条件と市場条件が重複している可能性があります」等の理由ヒントを出す（無説明の0件を避ける）。

### 5.5 index.html 配線変更点

- **state 形状を確定（criteria ベース・finding 11）**：`applyScreening()` は AXIS_REGISTRY.dom で全8軸を読み `normalizeCriteria` で **`screeningCriteria`（criteria オブジェクト）**、市場チェックを `normalizeMarkets` で **`screeningMarkets`** を構築。フィルタ＝`ScreenerRules.passesScreening(item, screeningCriteria) && ScreenerRules.passesMarket(item, screeningMarkets)`。結果数バッジ＝`ScreenerRules.hasAnyConstraint(screeningCriteria, screeningMarkets)`。
- `resetScreening()`：AXIS_REGISTRY.dom 全周回で8軸クリア＋市場チェックを既定（両チェック＝正規化後 `[]`）へ。
- `filterAndRenderPortal`：item に §4.2 の null安全 ratio 値＋`netMargin`＋成長 flat key を付与。
- 新公開関数（`saveScreenerPreset`/`loadScreenerPreset`/`deleteScreenerPreset`/`onScreenerPresetChange` 等・inline onclick/onchange から呼ぶもの）は**末尾 `Object.assign(window, …)`** へ（F2 規律）。

## 6. 教育・規制フレーム

- **中立語・no-score**：成長バッジは方向記号＋数値のみ（色は `--ix-text-dim` 単色）。スクリーナーは条件抽出（合否スコア化しない）。
- **グロッサリ追加（`INDICATOR_GLOSSARY`・単一源・`{term, read, def}` 完備・finding 9）**：各要素に **read を必ず付与**（termHelp が `read + "：" + def` を描画するため read 欠落は「undefined：…」表示）。
  - `{ term:"cagr", read:"CAGR（年平均成長率）", def:"複数年の増減を1年あたりの平均ペースに均した成長率。" }` — salesCagr 軸の `data-term` から参照。
  - `{ term:"growth-rate", read:"成長率", def:"売上や利益が前年（または数年平均）に対しどれだけ増減したか。将来の株価を保証するものではない。" }` — 「3期トレンド」列見出しの `?` から参照。
  - ※単独 `yoy` term は参照点が無いため追加しない（YoY は tooltip 内でラベル付き数値として表示・finding 9）。
- **免責**：スクリーナー注記1行＋既存 ANALYSIS_DISCLAIMER トーン。facts非出力（LLM 非経由・個人データ非接触・public market データをクライアント算出）。

## 7. 検証計画（束A/B と同水準・pre-mortem 反映）

- **node --test**
  - `finance-rules.test.js` 追補：
    - `yoy`：正常／基準0→null／**負基準→abs分母で数値**／`DetailRules.yoyBadge` と同一入力で**数値一致**（式一致の回帰固定・finding 16）。
    - `cagr`：正常／両端正のみ（片端≤0→null）／periods<1→null／符号反転→null。
    - `growthRates`：3期正常／欠測年（非連続 y の yoy=null・cagr は span）／有効1対→両 null／純利益赤字基準→cagr null／売上と純利益の独立。
    - `ratioOrNull`：needKeys 欠落/分母≤0→null／正常算出。
  - `screener-rules.test.js`（新規）：
    - `passesScreening` positive（min時 0以下除外／**max-only は 0以下を保持**＝既存挙動固定）・nullable（**制約時 null 除外**／min/max 境界／**max-only/負min でも欠測null除外**＝D1・finding 3）。
    - `passesMarket`（無制約=全通過・**ETF は市場指定時 false**・単一市場一致）＋`normalizeMarkets`（[]・[JP,US]→[]／[JP]保持）。
    - `hasAnyConstraint`（**市場のみ絞込→true**／**両チェック=[]→軸無ければ false**・finding 2）。
    - `normalizeCriteria`（dom 読取・空軸落とし）・`validatePreset`（空白のみ名 reject・40字超 reject・不正 criteria/markets 拒否）・`migratePreset`（旧形移行）・localStorage round-trip（破損→[]）。
- **Playwright（実ブラウザ・headless＋本番 curl）**
  - グリッド：売上CAGRバッジ表示・**バッジ色に緑/赤 hex が無い**（色 grep・finding 6）・「3期トレンド」列ソート（昇降・**null 末尾**）・tooltip・**ratio列 null→「—」でETF行が描画継続**（finding 3/エラーなし）。
  - スクリーナー：8軸フィルタ各々・**max-only/負min で ETF/欠損が除外**（D1）・**市場AND**（JP チェック×US チップで空＋理由ヒント）・**市場のみ絞込でバッジ表示／両チェックで非表示**（finding 2）。
  - プリセット：保存→select 出現→**呼出で clear-first 復元（旧値残留なし・activeSectorFilter=all）**→削除（confirm）。空白名/40字超/キャンセル/0件 placeholder。localStorage 反映。プリセット名に `<>'"` を入れても option 破損/注入なし（esc・finding 10/20）。
  - 回帰：`pageerror0`・既存4軸フィルタ挙動不変（positive の非対称・nullable の eqRatio/opMargin は §11 D1 で「より正しく」変わる点を除く）・ソート既存キー不変・money/detail ビュー無影響。
- **規制安全 grep（finding 7・範囲と語彙を確定）**：
  - **走査範囲＝本束の新規追加のみ**（成長バッジ・スクリーナー注記・新グロッサリ2語・screener-rules.js）。既存 val-badge（割安/割高/解散値以下/高評価 index.html:1907-1918）・既存免責は**スコープ外**。
  - **禁止語彙リスト**（買い/売り/買い時/売り時/推奨/割安/割高/予測 の**肯定用法**）。免責の否定形（「〜を推奨するものではありません」「〜ではありません」）は誤検知しないパターン（肯定用法のみ検出）。
  - バッジのインライン色に緑/赤/金 hex（#00e676/#ff5c7a/#ff1744/金系）が無いことを確認。
- **ultracode 運用**：本 spec（pre-mortem 反映済）→ 本人 spec レビュー → writing-plans → 実装（subagent-driven＋機能ごと敵対検証wf）→ 統合 whole-branch 敵対レビューwf。

## 8. 制約（不可侵）

- **0x0罠**：新規 LWC/Chart canvas を追加しない（成長=inline SVG バッジ＋テキスト、スクリーナー=入力UI）。既存チャート/スパークライン SVG の寸法・初期化順序は無改変。
- **F2 IIFE 隔離**：index.html inline `<script>` のグローバル汚染を増やさない＝新公開関数は末尾 `Object.assign(window, …)`。`currentTicker`/`currentView` の生束縛には触れない。
- **成長バッジ色（finding 6）**：上昇/下降とも `--ix-text-dim` 単色＋不透明度差のみ。**既存セルの緑=良/赤=悪セマフォアには合わせない**（緑/赤/金 hue 禁止）。
- **facts非出力・個人データ非接触**：money/advice/収支/investment 台帳レイヤーに触れない。LLM 非経由。
- **既存挙動保存**：positive 軸（PER/PBR）の非対称挙動（max-only は 0以下を保持）はテストで固定。※nullable の eqRatio/opMargin は D1 で欠測 null 化＝max-only/負min の稀なエッジで挙動が「より正しく」変わる（本人決定・§11 D1）。
- **チャート改変**：2026-07-01 に freeze 解除済だが本束はチャート非改変。

## 9. 実装段階（writing-plans で TDD 化）

1. `finance-rules.js`：growth（`yoy`/`cagr`/`growthRates`）＋`ratioOrNull`＋テスト（yoyBadge 数値一致含む）。
2. `screener-rules.js` 新設（AXIS_REGISTRY〔domId〕・`passesScreening`/`passesMarket`/`normalizeMarkets`/`normalizeCriteria`/`hasAnyConstraint`・プリセット schema）＋テスト。既存 positive 挙動を移植し同一性をテスト固定。
3. index.html ①：item に null安全 ratio 値＋`netMargin`＋成長 flat key。グリッドのバッジ（`--ix-text-dim`）＋トレンド列ソート＋**null-last 比較器**＋ratio列 null 表示フォールバック。
4. index.html ②：8軸パネル（グループ見出し）＋市場チェック＋プリセット CRUD（clear-first 復元・esc・confirm）＋`passesScreening` を `ScreenerRules` 呼出へ置換＋結果数バッジを `hasAnyConstraint` へ＋`resetScreening` を dom 由来へ（旧ハードコード配列置換）＋`<script src="screener-rules.js">` 追加＋空状態ヒント。
5. `INDICATOR_GLOSSARY` に cagr/growth-rate（read 付き）＋`data-term`＋`Detail.injectTermHelp` 配線（fetch 後呼出・glossary 先行）＋スクリーナー中立注記。
6. 統合検証（Playwright＋本番 curl）＋規制 grep（範囲/語彙/色）＋回帰（既存ビュー/既存軸/ETF行描画）。

## 10. 再開の合図

「investment 束C の spec レビュー後、writing-plans から」／「束C 実装の続き＝Task N から」。所有ノート = Obsidian Projects/investment-portal.md。

## 11. 主要決定の記録（pre-mortem 由来）

- **D1（本人決定）＝全 ratio 軸を欠測→null 化で統一**：eqRatio/opMargin（既存）＋roe/curRatio/netMargin（新）を `ratioOrNull` で欠測 null 化し、nullable kind で「制約時 null は除外」に統一。ETF/財務欠損を確実に除外し §2「欠測=母集団除外」・§7 ETF除外検証・束B `_finRatio` と整合。代償＝既存 eqRatio/opMargin の max-only/負min の稀なエッジ挙動が「より正しく」変わる（§8 で明記）。PER/PBR（positive）は既存の非対称を保存。
- **D2（本人決定）＝市場フィルタは両系統を残して整合**：既存 jp_only/us_only チップ（クイック閲覧）を残しつつ、スクリーナーに市場チェック（JP/US 複数）を追加。チェックも **ETF 除外をチップと統一**（`passesMarket`）・既存チップと **AND** 重畳・**プリセット呼出時は `activeSectorFilter="all"` にリセット**（再現性）・**矛盾組合せは空状態に理由ヒント**。
- **D3＝yoy と cagr の base 処理差は意図的**：yoy は abs 分母で負基準も数値（既存 yoyBadge と一致・単一源方針）、cagr は両端正要求で符号反転を null 化（非実数回避）。同一銘柄で yoy=数値・cagr=null が併存し得るのは正当（別指標）。
- **REFUTED（採用しなかった finder 主張の例）**：null-last の方向独立性は spec §4.3/L100 で既定義（追加不要）／termHelp「機構が無ければ」は偽の未確定（機構は既存＝§2/§5.4 で再利用確定）。

## 12. 実装差分メモ（実装で確定した点・spec 反映済）

- **バッジ色トークン**：spec 起草時の `--ix-text-secondary` は実コードに非実在と判明（Task8）。中立の実在トークン **`--ix-text-dim`（#8ba2af・グレーブルー・既存で dim/secondary テキストに広用）** に置換。緑/赤/金の hue でなく規制意図（成長を売買シグナル化しない）を満たす（本 spec は §3/§4.3/§8 とも `--ix-text-dim` に統一済）。
- **AXIS_REGISTRY group ラベル "割安"**：最終レビューで規制精査。裁定＝**許容**（PER/PBR の**指標カテゴリ見出し**＝セクション名であり個別銘柄への「割安=買い」推奨ではない・既存本番 `cross-section-rules.js` の `grp("割安度",[per,pbr])` と同種）。規制 grep の禁止語彙は「個別銘柄への肯定的売買/バリュエーション断定」を対象とし、カテゴリ見出し語は対象外と明確化。
- **最終 whole-branch 敵対レビュー（wf_7ae9a596・4次元）**：9 findings→2 CONFIRMED（両 LOW・同一問題）。確定＝成長列見出しの termHelp `?` クリックがソート発火（clickable な `<th>` に data-term を付与したのは束Cが初）→ `onclick="if(!event.target.closest('.term-help'))setSort('salesCagr')"` ガードで解消（index.html のみ・detail.js 無改変・統合スモーク再PASS）。
- **PER/PBR の termKey**：spec §5.1 は `termKey:null` としたが、`INDICATOR_GLOSSARY` に per/pbr が実在するため実装は `termKey:"per"/"pbr"` を採用（PER/PBR 軸にも `?` help が付く＝より良い）。
