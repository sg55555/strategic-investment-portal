---
date: 2026-07-05
type: design-spec
status: 設計承認済（本人 2026-07-05）／実装前
project: investment-portal
phase: Phase2「分析力の深化」束B（相対で見る目）
related: [[investment-portal]] [[2026-07-03-phase2-analysis-ideation-menu]] [[2026-07-04-phase2-bundleA-education-foundation-design]]
---

# Phase2 束B「相対で見る目」設計

## 0. 概要と位置づけ

束A（教育の土台＝分析グロッサリ/signalDigest/財務健全性トレンド）が本番LIVE（main `2b18064`）した上に載る Phase2 の第2束。**単一の絶対値でなく「分布の中の現在地」で銘柄を見る目**を、共有の純関数コア1塊で **3面同時に** 駆動する高レバレッジ束。

3面：
- **① 相対位置カード**（詳細ビュー）＝この銘柄が自市場内で各比率の何%点か
- **② 財務横並び比較テーブル**（比較モーダル）＝選択セットを PER/ROE/各マージン/健全性で列並置
- **③ 横断ランキング＆散布図＋セクター帯**（新サブビュー `#ranking-view`）＝市場横断ランキング＋バリュー×クオリティ散布＋データ駆動セクター中央値帯

### 承認済みの核心判断（本人 2026-07-05・AskUserQuestion）
1. **母集団＝市場ベース**（同じ市場＝日本株74/米国株21 の中での位置）。理由＝セクター(industry)は38分類・最大N=6・87%がN<5・米国株は全セクターN<5で「同業種内順位」は統計的に不成立。市場ベースは母集団が大きく安定・比率は通貨中立で公平・**スーパーセクター分類表の作成保守が不要**。
2. **範囲＝全束3面を1つのspecで一括**（共有コアを一度に立てて3面を埋める）。
3. **③の可視化＝ランキング表＋バリュー×クオリティ散布図＋データ駆動セクター帯**（N≥3のセクターのみ中央値セル・残りは「その他」に集約＝分類表不要）。38セクター中央値ヒートマップは小Nノイズで割愛。

### 成功基準（束Aと同型）
- 両立＝**自分用**（自分の保有・関心銘柄を分布の中で見る判断支援）＋**教材耐性構造**（規制安全な中立語・免責・?用語ツールチップ）。
- 範囲＝3面を1spec・段階実装（コア→①→②→③）。

### 制約（不可侵・束Aから継承＋束B固有）
- **no-score構造**：総合売買スコア/推奨を作らない。中立の位置記述語のみ（下記 §5）。
- **facts非出力**：本束は money/advice の `mode_a_facts`（Mode A集約）に一切触れない＝LLMパリティ非影響（グロッサリ/免責/相対descriptorは全て表示専用データ）。
- **免責自己完結**：`DetailRules.ANALYSIS_DISCLAIMER` を3面すべてに同梱。
- **0x0罠**：新規 canvas（③散布図）は `display:none→createChart` の寸法0固定を回避（描画前に寸法確保 or rAF+resize）。
- **money非改変**：money-rules.js/money.js/advice.py は触らない（median/mean は money-rules に private だが cross-section-rules に独立再実装＝疎結合維持）。
- **新CDN依存なし**：Chart.js（scatter・版固定済 4.5.1）と Lightweight Charts（既存）のみ。
- **F2 IIFE 公開規律**：inline から新規に参照される関数は index.html 末尾 `Object.assign(window,…)` に追加（漏れ＝無言故障）。detail.js の新規公開は detail.js 側の window ブロックへ。
- **読込順維持**：dataClient → finance-rules → **cross-section-rules（新・finance-rules直後）** → detail-rules → (inline) → detail-charts → detail → money。

---

## 1. アーキテクチャ方針

### 決定：新モジュール `cross-section-rules.js`（UMD）を新設
`finance-rules.js` の直後にロード。`window.CrossSection`（Node は `require`）。DOM非依存・純関数・`node --test tests/cross-section-rules.test.js`。

**なぜ新ファイル（観点＝分離とDRY）**：
- クロスセクション（多銘柄分布）は単社比率getter（finance-rules）とも descriptor（detail-rules）とも別の関心事。
- 3面すべてが**単一の抽出経路**を共有（understand調査が明示推奨＝filterAndRenderPortal のループを3回複製しない）。
- money-rules/detail-rules/finance-rules と同じモジュール規律（純データを rules モジュールに単一源・薄い描画層が参照）に一致。

**却下した代替**：
- finance-rules.js に同居＝「単社getter＋単位整形」の単一責務が濁る。
- 3ファイルに分散＝ranking(inline) が再実装＝DRY最悪。

**依存方向**：`cross-section-rules.js` → `FinanceRules`（既存の単社getter roe/roa/equityRatio/currentRatio/opMargin/netMargin/n/hasValue/ratio を横断集計の部品として消費）。detail-rules.js は cross-section を **参照しない**（逆依存を作らない）。detail.js（①②描画）と index.html inline（③描画）が CrossSection を消費する。

### median/mean の DRY 判断
money-rules.js に private 実装があるが、**parity固定済みの money モジュールを export 昇格で触る利得がない**（advice.py と鏡像・fuzz600で固定）。cross-section-rules に3行で再実装（純粋・パリティ無関係）。

---

## 2. ① 共有コア `cross-section-rules.js`（純関数）

### 2.1 統計プリミティブ
```
median(vals)              // 空配列→null / 単要素→その値 / 偶数個→中央2値平均
mean(vals)                // 空→null
percentileRank(vals, x)   // x が分布の何%点か 0..100。midrank 定義＝(x未満の個数 + 同値の個数/2) / n ×100。
                          //   ∴ 単要素は (0+0.5)/1×100=50、同値が並ぶと両者とも同%になる。空→null
quantile(vals, q)         // q∈[0,1] 線形補間（Q1=0.25/Q3=0.75）。空→null
```
- 入力は昇順ソート前提にせず内部でソート（呼び出し側の負担を減らす）。
- `higherIsBetter` は descriptor 側で解釈（percentileRank 自体は「値の大小の順位」だけを返す純粋関数）。

### 2.2 指標レジストリ `METRIC_REGISTRY`
指標キー → `{ key, label, read, unit, getter(fin, raw), currencyNeutral, higherIsBetter, format(v) }`

| key | label | getter | currencyNeutral | higherIsBetter |
|---|---|---|---|---|
| per | PER | raw.per（0→欠測） | true | false（低いほど割安寄り＝ただし中立記述） |
| pbr | PBR | raw.pbr（0→欠測） | true | false |
| roe | ROE | FinanceRules.roe(fin) | true | true |
| roa | ROA | FinanceRules.roa(fin) | true | true |
| netMargin | 純利益率 | FinanceRules.netMargin(fin) | true | true |
| opMargin | 営業利益率 | FinanceRules.opMargin(fin) | true | true |
| equityRatio | 自己資本比率 | FinanceRules.equityRatio(fin) | true | true |
| currentRatio | 流動比率 | FinanceRules.currentRatio(fin) | true | true |
| marketCap | 時価総額 | raw.marketCap（0→欠測） | **false** | （規模・優劣なし） |

- `higherIsBetter` は「相対的に高い/低い」の**中立語の向き**を決めるためだけに使う（買い/売り含意なし）。PER/PBR は false（値が低い＝分布下位＝「相対的に割安側」だが必ず割安ではない旨を?で補足）。
- `currencyNeutral:false`（marketCap）は**自市場内でのみ**percentile/ランキング（JP/US を跨がない）。他の比率は通貨中立ゆえ理論上は横断可だが、母集団＝市場ベースの判断に従い**常に自市場内**で算出（一貫性）。

### 2.3 母集団構築 `buildUniverse(stockData)`
- `Object.entries(stockData)` を走査（**stocks はティッカーkeyのオブジェクト**・配列でない）。
- `type==='stock'` のみ（ETF除外＝financials_trend={} で比率算出不能）。
- 各銘柄の最新年 financials（`financials_trend` の最大year）を取り、各指標を getter で算出。
- **欠測の扱い**：per/pbr/marketCap は **0を欠測** として除外（list.py の null→0 圧潰の罠）。financials系は `FinanceRules.hasValue` ゲート（キー欠落=欠測 / 実0=有効）。
- 返り値：`{ JP: { per:[…], pbr:[…], roe:[…], … , _members:[{ticker,name,industry,values:{…}}] }, US: {…} }`（市場別＝country）。各指標配列は欠測除外済の数値ベクトル。

### 2.4 集約・順位・descriptor
```
peerStats(universe, market, metric)
  → { n, median, q1, q3, min, max }        // n<1 は null 群として descriptor 側で「サンプル不足」

relativePosition(ticker, stockData)
  → { market, marketLabel, marketN, groups:[
       { title:'割安度', metrics:[ {key,label,value,format,percentile,band,tone,caption,termKey}… ] },
       { title:'収益性', metrics:[…] },
       { title:'安全性', metrics:[…] },
       { title:'規模',   metrics:[ marketCap ] },
     ], disclaimer }
  // 各 metric：percentile=自市場内%ile / band=中立バンド語（§5）/ caption='日本株74銘柄中 上位◯%' /
  //           value欠測時は band='データなし' で bar を出さない。
  // higherIsBetter を見て「上位=高い/低い」の語を選ぶ（買い/売り語は使わない）。

compareMetricsRows(tickers, stockData)
  → [ { ticker, name, market, currency, cells:{ per, pbr, roe, netMargin, opMargin, equityRatio, currentRatio, marketCap } } … ]
  // 各 cell = { value, format, missing:boolean }。ETF は比率 missing:true（N/A表示）。
  //         marketCap は currency badge 付きで表示するが「市場間比較不可」注記（?）。

rankByMetric(universe, market, metric, {dir})
  → [ { rank, ticker, name, industry, value, percentile, decile } … ]  // 自市場内・欠測は末尾除外

scatterPoints(universe, market, xKey, yKey)
  → { points:[{ticker,name,industry,x,y}], xMedian, yMedian, xLabel, yLabel }  // 両軸欠測は除外

sectorMedians(universe, market, metric, {minN:3})
  → [ { sector, n, median } … , { sector:'その他', n, median } ]  // N<minN は「その他」に集約
```

### 2.5 教育フレーム（束A継承・拡張）
- `DetailRules.ANALYSIS_DISCLAIMER` をそのまま3面の免責に流用（新免責系統を作らない）。
- `DetailRules.INDICATOR_GLOSSARY`（16語）に横断用語を追記：`パーセンタイル/順位`（percentile）、`中央値`（median）、`四分位`（quartile/IQR）、`同市場比較`（peer/relative）。**同じ termHelp ?-tooltip で描画**（data-term 属性）。
- グロッサリ追記は detail-rules.js 側（③の inline も `DetailRules.INDICATOR_GLOSSARY` を参照可＝読込順で detail-rules は inline より前）。

---

## 3. ② 相対位置カード（詳細ビュー）

### 配置・描画（束A固定id方式）
- **固定id `#relative-position-card`**：`.dashboard-stack` 内に静的配置（index.html）。初期 `style="display:none"`・空。**テキストのみ＝canvas無し＝FHD黒面バグの対象外**（分布バーは CSS/SVG で描画）。
- `renderRelativePosition(ticker)` を **detail.js** に新設（`renderSignalDigest` 同型）：
  - `document.getElementById("relative-position-card")` を取得。
  - データ/免責欠落・`CrossSection` 未定義でフェイルセーフ `display:none; return`。
  - `CrossSection.relativePosition(ticker, STOCK_DATA)` の descriptor を `window.esc` エスケープで innerHTML。
  - 末尾で `injectTermHelp(card)`（?用語）。
  - **`finCards` 配列に登録**＝ETF（financials_trend={}）では非表示（比率が算出できないため）。呼び出しは `updateFinancialViews` の `if(!fin) return` 後（renderHealthTrend 等と同じ経路）。

### 見せ方
- 7比率を **割安度(PER/PBR)・収益性(ROE/ROA/純利益率/営業利益率)・安全性(自己資本比率/流動比率)** にグルーピング＋規模(marketCap)。
- 各比率＝分布バー `[min ──●── max]`（●＝自銘柄位置・中央値マーカー）＋「日本株74銘柄中 **上位◯%**（中立バンド語）」＋値。
- 欠測比率はバーを出さず「データなし」。サンプル不足（n<5）はバーを出すが「母集団◯銘柄」を明示。
- detail.css の `.dashboard-stack.animate-cards .card:nth-child(N)` を**新カード分だけ拡張**（現状~7まで＝カード増で nth-child(8+) が stagger 0 になるのを防ぐ）。

---

## 4. ② 財務横並び比較テーブル（比較モーダル）

### 配置・描画
- 既存 `#compare-modal`（index.html:1329-1350）内に**タブ切替バー**（チャート/テーブル）を `.compare-period-bar` 付近に追加＋`#compare-table-container`（`#compare-chart-container` の兄弟）。表示は display トグル（新モーダル不要）。
- 純関数 `CrossSection.compareMetricsRows(tickers, STOCK_DATA)`。
- `renderCompareTable(compareSet)` を **detail.js** に新設（`renderCompareChips` 同型・innerHTML into `#compare-table-container`・`window.esc` エスケープ）。
- **compareSet は detail.js の IIFE-private** ゆえテーブル描画も detail.js から。既存の再描画点＝`openCompareModal`/`addToCompare`/`removeFromCompare` から `renderCompareTable` を追加呼び出し。
- **期間(comparePeriodMonths)は指標に無関係**（financials 最新年）＝テーブルは期間非依存。`setComparePeriod` はチャートのみ再描画（テーブル再描画は不要だが冪等なので呼んでも害なし）。
- タブ切替ハンドラは detail.js に定義し **detail.js の window 公開ブロック**（`window.foo=foo`）へ（index.html の Object.assign ではない）。

### 内容
- 列：PER / PBR / ROE / **純利益率（netMargin・初露出）** / 営業利益率 / 自己資本比率 / 流動比率 / 時価総額。
- 欠測/実0区別（`hasValue`）＝欠測は「—」。
- ETF 行は比率 N/A（時価総額のみ表示可）。
- marketCap は currency badge（¥/$）付き＋「市場間比較不可」の?注記（通貨依存）。
- 各列ヘッダに `data-term` で ? 用語。

---

## 5. ③ 横断ランキング＆散布図＋セクター帯（新サブビュー）

### ルーティング（中央ルーター＝データ駆動ゆえ最小追加）
- `VIEW_IDS` に `ranking: "ranking-view"` を追加（index.html:1494）。
- `<div id="ranking-view" class="view-section"> … </div>` を他 view-section の兄弟として追加。
- `navigateToRanking()`（`showView("ranking")` + ランキング描画）を inline に新設し **`Object.assign(window,…)` に追加**。ハッシュ `#ranking` は `_applyView` がテーブル駆動ゆえ自動ルート（onHashChange 改変不要）。
- 入口ボタン：ポータルの `#screening-toggle` 付近 or ナビの ◎司令塔 隣に「▤ ランキング」（onclick=navigateToRanking）。

### UI
- **市場トグル(JP/US)** ＋ **指標セレクタ**（PER/PBR/ROE/ROA/純利益率/営業利益率/自己資本比率/流動比率/時価総額）。
- **ランキング表**：`CrossSection.rankByMetric(universe, market, metric)` → 自市場内順位＋percentile/decile・`getSectorColor` でセクター色。行クリックで既存 `navigateToDetail(ticker)` へ。
- **バリュー×クオリティ散布図**：`CrossSection.scatterPoints(universe, market, 'per', 'roe')`（軸は既定 PER×ROE・切替可）＝**Chart.js scatter**（版固定済）。セクター色ドット・中央値クロスヘア（xMedian/yMedian）。
  - **0x0罠回避**：`#ranking-view` は初期非表示ゆえ、`navigateToRanking` で view を active にした**後**に rAF→ chart 生成 or `resize()`。破棄先行（`chart.destroy()`）で再入時の二重生成を防ぐ。
  - 新サブビューは `.dashboard-stack` の entrance アニメ対象外ゆえ FHD 黒面バグ（entrance合成レイヤ由来）は非該当。ただし通常の描画前寸法0だけは回避。
- **データ駆動セクター帯**：`CrossSection.sectorMedians(universe, market, metric, {minN:3})` → N≥3 セクターの中央値セル＋「その他」集約（記述的）。
- 描画関数はできるだけ純関数（CrossSection）＋薄い DOM 層。inline の新規ハンドラ（市場トグル/指標切替/軸切替/行クリック）は **Object.assign(window) 公開**。

---

## 6. 規制安全・中立語（束A継承）

- **中立バンド語の閉集合**（例）：`上位◯%（相対的に高い）` / `中央値付近` / `下位◯%（相対的に低い）` / `データなし` / `サンプル不足`。売買（買い/売り/割安=買い）・予測（上がる/下がる）語は**出さない**。
- PER/PBR は「下位＝相対的に割安側」だが **「低PER≠必ず割安（成長鈍化の織り込み等）」** の誤解注意を ? tooltip で必ず添える。
- `ANALYSIS_DISCLAIMER`（教育・学習フレームの免責）を①カード・②テーブル・③ビューの各所に同梱。
- 投資助言業の境界（無償＋本人利用＋教育フレーム）を維持。**facts非出力**＝mode_a_facts に本束のデータは一切流れない。

---

## 7. モジュール境界・公開面（F2規律）

| 追加物 | 定義先 | 公開先 |
|---|---|---|
| 統計/レジストリ/universe/descriptor 純関数 | cross-section-rules.js | `window.CrossSection`（UMD return） |
| INDICATOR_GLOSSARY 追記 | detail-rules.js | 既存 DetailRules return |
| renderRelativePosition / renderCompareTable / compareタブ切替 | detail.js | detail.js の `window.foo=foo` ブロック |
| navigateToRanking / ranking inline ハンドラ群 | index.html inline | index.html 末尾 `Object.assign(window,…)` |
| #relative-position-card / #ranking-view / compareタブ markup | index.html | — |
| .dashboard-stack nth-child 拡張 / ranking-view / compare-table スタイル | detail.css | — |

- **currentTicker/currentView は生束縛**（window 値コピー禁止）。
- 読込順：dataClient → finance-rules → **cross-section-rules** → detail-rules → (inline) → detail-charts → detail → money。`<script src="cross-section-rules.js">` を finance-rules の直後・detail-rules の前に置く。

---

## 8. データ取扱いの要点（罠の明文化）

1. **`/api/market/list` の stocks はティッカーkeyのオブジェクト**（配列でない）→ `Object.entries`。1コールで全84銘柄・7比率のクロスセクションが作れる（84回 fetch 不要）。
2. **per/pbr/marketCap は null→0 圧潰**（list.py:52-54）→ 0 を欠測として median/percentile から除外（実0との混同を避ける）。
3. **financials_trend は null キー欠落**（0圧潰でない）→ `hasValue` でクリーンにスキップ。
4. **通貨**：比率は通貨中立・marketCap と生額は通貨依存。母集団＝市場ベースゆえ**常に自市場内**で算出（JP/US を跨がない）。
5. **ETF**（type='etf'・5銘柄）は financials_trend={} → 全比率/ランキング/散布から除外（①カードは finCards で非表示・②テーブルは N/A 行）。
6. **小N**：市場ベースで N=74/21 と十分だが、セクター帯だけは minN=3 ゲート＋「その他」集約。
7. **ハイドレーション**：③ランキングは list レベル指標（per/pbr/marketCap/最新financials）のみで全銘柄可（per-ticker getStock 不要）。②比較は compareSet（≤8）で addToCompare が既に getStock 済。

---

## 9. 検証計画（束A同型・ultracode）

### 単体（node --test）
- `tests/cross-section-rules.test.js` 新設：
  - percentileRank（同値/単要素/空/両端）・median/quantile（偶奇/空）。
  - buildUniverse（ETF除外・per/pbr/marketCap の0欠測・financials欠測スキップ・市場分割）。
  - relativePosition descriptor（**中立語彙の閉集合アサート＝売買/予測語0**・欠測 band='データなし'・higherIsBetter の語向き）。
  - compareMetricsRows（ETF N/A・欠測「—」・marketCap currency）。
  - rankByMetric（欠測末尾除外・decile）。sectorMedians（minN=3 の「その他」集約）。
- 既存 unit（detail-rules/finance-rules/money-rules）緑を維持。

### スナップショット・E2E
- `node scratchpad/f2-snapshot.js compare`（portal/detail/money＋**新 ranking ビュー**の DOM/canvas/style/公開typeof/pageerror 突合・MATCH が gate）。
- Playwright（mock_prod_server）：①カードが equity で表示・**ETF で非表示**／②比較モーダルのタブ切替でテーブル表示・列値・N/A／③ranking で市場トグル/指標切替・散布図描画・セクター帯・pageerror0。

### 敵対検証（ultracode workflow）
- 各機能を敵対検証wf（4観点×refute）でハードニング：**規制安全語彙**（売買/予測語の混入）・**モジュール境界**（CrossSection の逆依存/facts流出）・**null/小N正当性**（0欠測・ETF・minN）・**0x0罠**（③散布図の初期化順序）。
- spec 起草後にも敵対検証wf（束Aと同じ＝spec の穴出し→確定修正を反映）。

---

## 10. 実装順（writing-plans へ渡す粒度）

1. **コア**：cross-section-rules.js（統計→レジストリ→buildUniverse→peerStats/relativePosition/compareMetricsRows/rankByMetric/scatterPoints/sectorMedians）＋ node --test。読込順に script 追加。INDICATOR_GLOSSARY 追記。
2. **①相対位置カード**：#relative-position-card 静的配置＋renderRelativePosition（detail.js・finCards登録・termHelp・nth-child拡張）。
3. **②比較テーブル**：compare-modal タブ＋#compare-table-container＋renderCompareTable＋再描画点配線＋タブハンドラ公開。
4. **③ランキングビュー**：VIEW_IDS/ranking-view markup＋navigateToRanking＋市場/指標/軸UI＋ランキング表＋散布図（0x0罠）＋セクター帯＋inline公開＋入口ボタン。
5. **検証・ハードニング**：f2-snapshot 再突合・Playwright・各機能敵対検証wf・統合スモーク。

各段は TDD（純関数→テスト→描画配線）。新カード/ビューは固定id静的コンテナ（insert しない冪等）。
