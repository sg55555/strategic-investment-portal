---
date: 2026-07-07
type: design-spec
status: 設計確定（本人承認 2026-07-07・提案デフォルト3点込み）/ 実装前
project: investment-portal
phase: Phase2「分析力の深化」束D「財務を物語に」層1
method: brainstorming（understand wf wf_d8f74a5d-bf3 で現状マップ→設計）
related: [[investment-portal]] [[wealth-cockpit-v2]] Decisions/2026-07-07-bundleD-two-layer-personal-advice.md
---

# 束D「財務を物語に」層1 設計 — DuPont恒等式カード ＋ FCF&収益の質コンボカード

## 0. 位置づけ（2層アーキの層1）

束D は Phase2「分析力の深化」の第4束で、**発信/教材化を意識した束**。ただし本人の本音は「対外＝教育／本質＝本人利用で投資助言が欲しい」（Decisions/2026-07-07-bundleD-two-layer-personal-advice.md）。これを規制安全に両立するため **2層** で設計する：

- **層1（本spec・今セッション）＝公開・決定論・client-side**。DuPont分解＋FCF/収益の質トレンドを**中立descriptor**で。全員に配信される顔＝教育・事実表示・no-score・免責。
- **層2（次セッション・本specの対象外）＝本人専用・server-side・`ADVICE_MODE=personal` gated**。DuPont/FCF facts を market schema 接地でLLMへ→踏み込んだ個別銘柄の読み解き。production は中立/非表示。既存 `api/me/advice.py` の型を per-stock へ横展開。

層1 は層2 の入力 facts にもなる。**本spec は層1 のみを扱う**。

スコープ（本人選択 2026-07-07）：**①DuPont分解 ＋ ②FCF&収益の質トレンド の両方**（③マージン&CAGRトレンドは対象外＝束A健全性/束C成長率と重複のため）。

## 1. データ前提（understand wf で本番Neon直検証済）

- **単位**：全財務フィールドは「自国通貨の百万単位」で統一。1銘柄内で通貨/単位混在なし。通貨は `ticker_master.currency`（JPY76/USD24）外付け。比率（純利益率/回転率/レバレッジ/FCFマージン/現金変換率）は無次元で通貨非依存。FCF絶対額表示のみ `pickUnit`/`fmtUnitValue` で通貨別整形。
- **トレンドは3〜4年のみ**（87銘柄=3年/8銘柄=4年）。恒等式カードは選択年、スパークライン/トレンドは全年（点3〜4個）。
- **DuPont入力**（全て本番Neon NULL=0・grid/detail両方に在）：`net_income` / `net_sales` / `net_assets` / `current_assets` / `non_current_assets`。
  - ⚠️**代理2つ**：総資産＝`current_assets + non_current_assets`（専用カラム無・既存 `FinanceRules.totalAssets` finance-rules.js:24 と同流儀）。equity＝`net_assets`（**純資産・少数株主持分含む**＝厳密な自己資本でない）。既存 `roe`(finance-rules.js:48 = net_income/net_assets) と恒等式が閉じる。→**「純資産ROE分解」とラベル必須**（自己資本ROEでない）。
- **FCF入力**：`operating_cf` / `investing_cf`（本番NULL=0）。ただし**`financials.py`(detail)のみ・`list.py`(grid)に無い** → FCFはポータル横断不可＝**詳細ビュー限定**（層1でも横断ランキングは作らない）。
- **分母0以下の実在行**（`ratioOrNull` でnull化必須）：net_assets≤0=18行 / net_sales≤0=12行 / total_assets≤0=12行 / net_income≤0=20行。**`||0` で0%潰し禁止**（欠測=null点、実0と区別）。
- **負のFCFは正当**（55行＝設備投資先行）。FCF値自体は負を保持し、比率の分母（売上/純利益）だけをゲート。
- **ETF**（5銘柄）は `financials_trend={}` → DuPont/FCFカードは非表示（finCards登録・detail.js:517型）。

## 2. 規制安全（層1 の不変条件・実装で厳守）

understand の edu リーダー結論に基づく。層1 は **client-side 配信＝全員が見る**ため、助言フレーバー（個別銘柄の売買含意）は一切置かない。

1. **no-score**：DuPont3因数・FCFを単一の合成スコア/格付けに畳まない（`signalDigest` detail-rules.js:434 と同じ・意図的スコアの `radarScores` とは役割別）。
2. **中立語閉集合の driver句**：状態語は固定中立句のみ（`cfFlowStatus`/`_band` 型）。売買語・予測語ゼロ。「高い/低い」に良否を断定しない。
3. **因果は一般論のみ**：`INDICATOR_GLOSSARY` の ROE 既存def「借入を増やしても上がるため内訳と併せて見る」型の誤解注記を DuPont/レバレッジ/FCF へ拡張。「レバレッジ上昇はROEを押し上げるが財務リスクも高める（一般論）」は可、「この銘柄は割安だから買い」は不可。
4. **予測を出さない**：`ANALYSIS_DISCLAIMER`(detail-rules.js:45「将来予測ではない」)と整合。過去〜現在の事実推移のみ。
5. **免責 fail-closed・不可分同梱**：各カード描画の冒頭で `var disc = DetailRules.ANALYSIS_DISCLAIMER; if(!disc){ card非表示; return; }`（`renderSignalDigest` detail.js:240 型）。免責div は分析本体と同一 innerHTML 内。
6. **facts非出力**：グロッサリ/descriptor 追加は `modeAFacts`/`advice.py` パリティに非接触（`GLOSSARY`/`DISCLAIMER` と同型の純データ）。
7. **ラベル明示**：「純資産ROE分解」「概算FCF」を画面文言に明示。

## 3. 共有プリミティブ（最大の不足を埋める）

`finance-rules.js` の既存 `ratio`(:19)/`ratioOrNull`(:149) は全て **×100を焼込み** ＝ %専用。回転率・レバレッジ・現金変換率の「倍/率」に使えない。**新設**：

- **`divOrNull(numer, denom)`**：`Number.isFinite(numer) && Number.isFinite(denom) && denom > 0` の時 `numer / denom`、他は `null`。×1（倍率）の共通ゲート。
  - ※分母>0 のみ許容（≤0 は算出不能=null）。`ratioOrNull` の denom合計>0 ゲートと同思想。

## 4. Feature ① DuPont恒等式カード

### 4.1 純関数（finance-rules.js・UMD return[:186-210] に追加・self-contained維持）
- **`assetTurnover(fin)`** = `divOrNull(net_sales, totalAssets(fin))`（倍）。needKeys=net_sales/current_assets/non_current_assets、denom=totalAssets>0。
- **`equityMultiplier(fin)`** = `divOrNull(totalAssets(fin), net_assets)`（倍）。denom=net_assets>0。
- **`dupont(fin)`** = `{ netMargin, assetTurnover, equityMultiplier, roe }`（各 null 可）。
  - `netMargin`=既存 `netMargin(fin)`（finance-rules.js:44・%・NI/売上×100）、`roe`=既存 `roe(fin)`（:48・%・NI/純資産×100）を委譲。
  - **恒等式**：`netMargin(%) × assetTurnover × equityMultiplier ≈ roe(%)`（NI/売上×100 × 売上/TA × TA/純資産 = NI/純資産×100）。**テストで一致固定**（浮動小数許容誤差）。いずれかの因数が null なら該当因数のみ null（恒等式検証はスキップ）。

### 4.2 descriptor（detail-rules.js・return[:584-595] に追加・DOM非依存・FR委譲）
- **`dupontDescriptor(fin)`** → `{ factors:[{key,label,termKey,value,unit}], roe:{value,unit}, driver:{text} }`。
  - factors＝純利益率(%)/総資産回転率(倍)/財務レバレッジ(倍)。value は null 可（表示側で「--」）。
  - **driver句（中立・no-score）**：3因数の相対的な高低を事実記述する閉集合句。生成規則＝算出可能な因数のうち、**同種銘柄基準でなく因数の性質語**で「ROEは主に○○が高い/○○が低い構成」と述べる。売買/予測語ゼロ。「純資産ベース（少数株主持分を含む）」を必ず含める。欠測時は「一部の因数が欠損のため分解は参考値」等の中立フォールバック句。
  - ⚠️driver句の閉集合は実装時に固定文リストとして列挙し、`tests/detail-rules.test.js` で禁止語彙0を検証。
- **`dupontFactorSeries(data)`** → `{ years:[], netMargin:[], assetTurnover:[], equityMultiplier:[], roe:[] }`（`healthTrendSeries` detail-rules.js:564 型・全年ループ・欠測 null 点）。スパークライン用。ETFは空系列。

### 4.3 描画（detail-charts.js・IIFE内・`window.DetailCharts` export[:1196] に追加）
- **`renderDuPont(fin, data)`**：
  - 恒等式 KPI 行（HTML・`純利益率 × 回転率 × レバレッジ = ROE`・各値＋単位・null は「--」）。
  - 各因数の**スパークライン＝inline SVG**（canvas不使用＝0x0罠/FHD黒面を構造的に回避）。系列は `DetailRules.dupontFactorSeries(data)`。
    - **実装判断（plan で確定）**：既存 `buildSparklineSVG`（ポータルPhase3 P2・index.html inline）が window 到達可能なら再利用。到達不可なら (a) IIFE公開面 `Object.assign(window,…)` へ追加 か (b) detail-charts.js に小さな純SVGビルダー `sparklineSVG(values,{w,h,color})` を新設。**推奨=(b)**（module境界を跨がず detail 側で完結／buildSparklineSVGは価格用途に結合している可能性）。
  - driver句テキスト＋免責div＋`data-term`。
- **注**：恒等式カードは canvas を持たない（スパークライン=SVG）ので `repaint()`（FHD黒面対策）対象外。

### 4.4 カード（index.html dashboard-stack・固定id静的コンテナ）
- `#dupont-card`（`.card`）＝ card-title（`data-term="dupont"`＋「純資産ROE分解」）＋恒等式行コンテナ＋スパークライン行＋driver句＋`#dupont-disclaimer`（空div・免責注入先）。
- base `.card`/`.card-title` グラス様式は index.html:534/555 で自動継承（新規CSS最小）。

### 4.5 グロッサリ（detail-rules.js INDICATOR_GLOSSARY[:49]）
追加 term（中立def＋誤解注記1文）：`dupont` / `asset-turnover` / `financial-leverage`。`net-margin`(:63)/`roe` は既存＝再利用。

## 5. Feature ② FCF&収益の質コンボカード

### 5.1 純関数（finance-rules.js）
- **`fcf(fin)`** = `hasValue(fin,'operating_cf') && hasValue(fin,'investing_cf')` の時 `n(operating_cf) + n(investing_cf)`、他は `null`。**負値保持**（`n` は NaN のみ0化）。
- **`fcfMargin(fin)`** = `ratioOrNull(fin, f=>ratio(fcf(f), f.net_sales), needKeys=[operating_cf,investing_cf,net_sales], denomKeys=[net_sales])`（%）。
- **`cashConversion(fin)`** = 営業CF÷純利益（%）※**本人承認**（利益の現金化＝収益の質の王道）。**null伝播に注意した厳密定義**：
  ```
  if (!hasValue(fin,'operating_cf')) return null;        // 営業CF欠測→null（n()で0化させない）
  const c = divOrNull(fin.operating_cf, fin.net_income); // net_income>0 のみ（赤字年null）
  return c === null ? null : c * 100;                     // ← null*100=0 の落とし穴を回避
  ```
  ⚠️`n(operating_cf)` は欠測を0化しゲートを素通りする／`divOrNull(...)*100` は `null*100=0` で欠測が0%に化ける。両方を上記で塞ぐ。同型の null→×100 は他の%変換でも踏襲。

### 5.2 descriptor / 系列（detail-rules.js）
- **`fcfTrendSeries(data)`** → `{ years:[], fcf:[], fcfMargin:[], cashConversion:[], operatingCf:[], investingCf:[] }`（全年・欠測 null 点・ETF空）。
- **`fcfQualityDescriptor(data)`** → 中立句。閉集合＝「営業CFは純利益を上回り現金化は良好（現金変換率>100%の年）」「投資先行の年はFCFが縮小」等の**事実記述**。売買/予測語ゼロ。「概算FCF＝営業CF＋投資CF」を明示。欠測時フォールバック句。

### 5.3 描画（detail-charts.js・`renderFCFTrend(data, isUS)`）
- **`renderHealthTrend` detail-charts.js:1133 型 二軸コンボ**（Chart.js mixed）：
  - **bar（左軸 amt）**＝FCF金額（`fcfTrendSeries.fcf`・**負値対応**）。pickUnit/fmtUnitValue で単位統一。`neonBarBg`/`$neonSpecs`。
  - **line（右軸 pct%）**＝現金変換率・FCFマージン。`$lineGlow`。基準線（例100%）は定数dataset borderDash（healthTrend型）。
  - ⚠️Chart data には**数値 `v/unit.div`** を渡す（`fmtUnitValue` 整形済み文字列は NaN 化＝renderHealthTrend detail-charts.js:1143 の教訓）。単位表示は軸タイトル。
  - destroy先行・null化・`responsive:true`/`maintainAspectRatio:false`/`animation:false`・`datalabels` は line で `display:false`。
  - instance private let 追加・`window.DetailCharts` export・**`repaint()`（detail-charts.js:563）対象に追加**（`getElementById('fcfTrend').clientWidth>0` ガード付き resize+update('none')）。

### 5.4 カード（index.html）
- `#fcf-trend-card`（`.card`）＝ card-title（`data-term="fcf"`＋「FCF＆収益の質（概算）」）＋`.ht-chart`（**明示高さ wrapper**・`<canvas id="fcfTrend">`）＋`fcfQualityDescriptor` 句＋`.ht-note`（「概算FCF＝営業CF＋投資CF」注記）＋`#fcf-trend-disclaimer`（空div）。
- `.ht-chart{height:300px}`（detail.css:789）相当を再利用（0x0罠回避＝canvas は明示高さ wrapper 必須）。

### 5.5 グロッサリ
追加 term：`fcf` / `fcf-margin` / `cash-conversion`（中立def＋誤解注記＝例「FCFは設備投資の年に一時的に縮小しうる」「現金変換率は赤字年に無意味」）。

## 6. 配線（detail.js updateFinancialViews[:416-559]）

- `renderHealthTrend`(detail.js:552) 直後、**`if(!fin)return`(529) の後**（＝財務カード＝パターンA）に：
  - `DetailCharts.renderDuPont(fin, data)`
  - `DetailCharts.renderFCFTrend(data, isUS)`
  - 免責注入：`getElementById('dupont-disclaimer').textContent = DetailRules.ANALYSIS_DISCLAIMER`／`'fcf-trend-disclaimer'` 同様（detail.js:553 型）。
  - `injectTermHelp(getElementById('dupont-card'))`／`injectTermHelp(getElementById('fcf-trend-card'))`（`updateFinancialViews` 末尾の document 全域 injectTermHelp でも回収されるが規約としてカード単位でも呼ぶ）。
- **`finCards` 配列**(detail.js:517) に `"dupont-card"`, `"fcf-trend-card"` 追加（ETF時 display:none）。
- **免責 fail-closed**：各 render の冒頭で disc 欠落チェック→非表示 return。

## 7. CSS / entrance（detail.css）

- `#dupont-card` の恒等式行/スパークライン行の最小レイアウト（既存 `.card` グラス継承・新規最小）。
- `#fcf-trend-card` は `.ht-chart` を再利用（新規最小）。
- **entrance `cardFadeInUp` nth-child**(detail.css:752-772・現在(8)=0.96sまで)：dashboard-stack が 8→**10カード**。`(9){delay:1.09s}`/`(10){delay:1.22s}` を +0.13s刻みで追加（末尾カード delay:0 即時発火を防ぐ）。
- **配置（本人承認）＝末尾に「物語(synthesis)セクション」**：… → CF → 健全性トレンド → **DuPont分解(9)** → **FCF&収益の質(10)**。
- **`repaint()` timeout配列**(detail-charts.js:585 `[300,700,1100,1500]`)：末尾カード増でentrance完了が ≈1.22+0.45≈1.67s に伸びるため **`1900` を追加**（FHD黒面予防・FCFカードのcanvas対象）。

## 8. 成功基準

- DuPont恒等式カード：選択年の3因数＋ROE＋恒等式が表示され、`netMargin%×assetTurnover×equityMultiplier ≈ roe%` が数値一致。各因数の3〜4年スパークライン（SVG）。中立driver句。「純資産ベース」明示。欠測因数は「--」。
- FCFコンボカード：全年 FCF(bar・負値可)＋現金変換率/FCFマージン(line右軸%)。「概算FCF」明示。中立quality句。
- 両カード：ETF非表示・免責fail-closed・?termHelp・pageerror0・0x0罠/FHD黒面非再発。
- 規制安全：no-score・中立語閉集合・売買/予測語0（grep検証）・facts非出力（Python negativeテスト）。
- 「自分用（本人が実際に判断材料にできる）」と「教材耐性（公開しても規制安全）」の両立。

## 9. 制約 / 不可侵

- **0x0罠**（唯一の技術制約）：FCF canvas は明示高さ wrapper、resize は clientWidth>0 ガード、destroy先行。
- **canvas色/ローソク確定色/ZigZag**：本 feature は新カードのみ＝既存チャート無改変（move-not-rewrite・描画本体に触れない）。
- **money非改変**：money-rules/money.js に触れない。`modeAFacts`/`advice.py` パリティ非影響。
- **新CDN依存なし**（Chart.js/LWC は版固定済を利用）。
- **UMD公開面の足し忘れ＝無言故障**：新純関数は finance-rules.js return[:186] に、descriptor は detail-rules.js return[:584] に、描画は DetailCharts export[:1196] に必ず追加。

## 10. 検証

- `node --test`：新純関数（divOrNull/assetTurnover/equityMultiplier/dupont恒等式一致/fcf負値保持/fcfMargin・cashConversion分母ゲート）＋descriptor（driver/quality句の禁止語彙0・欠測フォールバック）＋系列（欠測null点）。TOYOTA fixture（tests/finance-rules.test.js:6）流用。
- `scratchpad/detail-snapshot.js` before/after 突合（既存カード無変化＋新カード出現）。
- 統合スモーク：equity銘柄（JP/US）＋ETF×多幅（1920/1024/768）でDuPont/FCFカード可視/ETF非表示/免責/?注入/pageerror0。
- Python negativeテスト：グロッサリ/descriptor が `modeAFacts` に流出しない（束A test_advice_facts.py 型）。
- **本人FHD実機サニティ**（FCF canvas黒面・スパークライン可読性・恒等式行の桁揃え・10カード密度＝headless非再現）。

## 11. 対象外（層2＝次セッション）

- per-stock AI読み解き endpoint（`ADVICE_MODE=personal` gated・SYS_PRODUCTION/PERSONAL・出力スキャナ・免責・degrade・cache）。
- FCF横断ランキング（`list.py` の `_GRID_FIN_FIELDS` に operating_cf/investing_cf 追加が前提のAPI変更）。
- ③マージン&CAGRトレンド（束A健全性/束C成長率と重複）。
- DuPont/FCF を cross-section-rules.js の相対比較（METRIC_REGISTRY追加）へ載せる拡張。

## 12. 決定記録（本人承認 2026-07-07）

- スコープ＝①DuPont＋②FCF 両方。
- ストーリー方式＝ハイブリッド（層1決定論・層2本人専用AI＝次）。
- DuPont形＝A 恒等式分解カード（+因数スパークライン+中立driver句）。
- FCF形＝A コンボ1枚（FCF bar + 現金変換率/FCFマージン line二軸）。
- 現金変換率＝営業CF÷純利益。
- スパークライン＝inline SVG。
- 配置＝末尾の物語(synthesis)セクション（健全性→DuPont→FCF）。
