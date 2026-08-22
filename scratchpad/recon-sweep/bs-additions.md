# bs-additions（recon実測 2026-08-21・HEAD 8e44298）

## summary
P6（債務超過注記）/P8（モバイル低棒サマリ）は現HEADでも両方とも未実装＝症状健在（spec §12 の次wave積み残しに明記どおり）。実DB SELECT で債務超過は **MCD/SBUX の各 FY2023-2025 の計6行のみ**（すべて USD・JPY該当なし）。直近waveで renderBSChart は全面再設計済み（anchor全center化・全科目横逃がし・side-aware padding・bsLeaderPlugin）＝監査P6の file:line（:713-715/:881）は :747-749/:937-944 へ移動、単位前提は「ページ統一単位」→「チャート別単位（両スタック和max・USD億層）」に変わり注記文言は MCD=「純資産 ▲18億ドル（債務超過）」/SBUX=「▲81億ドル」になる。desktop top:65 帯は wave後に完全空き（上逃がしラベル廃止）＝注記の置き場として前提はむしろ良化。P6=別gateプラグイン `bsNotePlugin`（datalabels 内部API非依存・$bsNoteRect 書き戻しで受入も機械化）、P8=`#bs-mobile-note` DOM 1行（renderBSChart 内で lowTuples から生成・閾値はモバイル表示ゲートと同じ **0.15**・12px床準拠）を提案。工数=P6半日+P8半日≒合計1日。

## notes

### 現HEADの BS 実装（精読結果）
- `renderBSChart(fin)`（detail-charts.js:744-968）: シグネチャは fin 単独（pageUnit 引数は wave で全廃・detail.js:802 呼出）。
  - :745 `isMobile = window.innerWidth < 768`（二値・render時1回評価）。
  - :747 `hasNegativeEquity = fin.net_assets < 0`、:749 `displayNetAssets = hasNegativeEquity ? 0 : fin.net_assets`（**監査P6の :713-715 はここへ移動**）。
  - :752-756 `bsAxisMax = max(totalAssets, cl+ncl+displayNetAssets)` → `unit = FinanceRules.pickUnit(bsAxisMax, currency)`（spec §7.1 D10・チャート別単位）。:757 `setUnitBadge("bs-title", unit)`。
  - :759-763 `LOW=0.12` / lowLeft / lowRight / `CALLOUT_PAD = min(140, max(126, hostW*0.16))`（side-aware 動的パディング。:873 で適用・モバイル arm は {left:4,right:4,top:10,bottom:4} 不変）。
  - :767-774 `lowIndices` = [di, v, bi] 5タプル→ filter(v>0 && v/totalAssets<LOW) → {di,bi}。**負純資産は v>0 ガードで自動除外**（MCD で実証済＝bs-callout-verify.js コメント）。:967 `bsChartInstance.$bsLeaders = lowIndices`。
  - :778-787 同側2本目以降の角度 stagger（STAGGER_DEG=18・offset /cosθ 補正 :932-933）。
  - :791-798 債務超過の既存表現は**側パネルのみ**: equity-ratio を「マイナス」#ff5c7a、desc を「▶ 純資産マイナス（積極的な自社株買い等による）」。ただし :752-753（detail.js）が毎回 `equityRatioDesc(isUS)` で desc を書くため、renderBSChart :794 が直後に上書き＝表示上は勝つ（呼出順: detail.js:752→:802）。
  - :881-884 モバイル datalabels 表示ゲート: `val > 0 && val / totalAssets >= 0.15`（**監査P8の :809-812 はここへ移動**。閾値 0.15 のまま＝<15% セグメントはモバイルで情報ゼロ、症状健在）。
  - :915 anchor "center" 統一、:916-925 align（低棒=横 left/right or 角度）、:926-936 offset（バー半幅+12・左列は y軸幅加算）、:937-944 formatter（value===0 → null。**監査P6の :881 はここ**）。
- `bsLeaderPlugin`（detail-charts.js:129-147）: gate `chart.$bsLeaders`・afterDatasetsDraw・`el.$datalabels[0].$layout._box._rect`（**datalabels v2.2.0 非公開API依存**・SRI pin index.html:46）→ チップ縁からセグメント中心へ 1px シアン線。**線描画専用**でテキスト描画機能はない。
- desktop top:65 パディング帯（:873）: wave後は align 上逃がし('top'/'end')が全廃され横逃がしのみ＝**帯は完全空き**（旧監査時は流動系ラベルが浮遊していた）。P6 注記の置き場として最適。
- モバイル DOM: BS カード（index.html:1252-1263）は .grid-layout 内に chart-main-area（:1255-1262）→ side-panel（:1263-）。<1024px は縦積み（detail.css:64 @media で ≥1024 のみ row 化）。chart-main-area 高: 768px→320px（detail.css:414）/480px→280px（:452）/375px→240px（:459）。監査P8の「detail.css:453 の280px」は現 **:452**。canvas実測150px乖離疑いは本reconでも未検証のまま（実機確認事項として残る）。
- カード非表示ゲート（detail.js:757-762）: ETF/!fin は BS カードごと display:none＝カード内に注記/サマリ DOM を置けば stale 経路なし（renderBSChart は fin 有りの非ETFで毎回実行＝都度上書き）。

### 実DB 実測（data/investment.db・symlink 済）
債務超過（net_assets<0）全列挙＝**MCD と SBUX のみ・各3年**:

| ticker | FY | net_assets(百万USD) | 総資産 | 負債和 | 備考 |
|---|---|---|---|---|---|
| MCD | 2023 | -4707 | 56147 | 60854 | |
| MCD | 2024 | -3797 | 55182 | 58979 | |
| MCD | 2025 | -1791 | 59515 | 61306 | 流動資産7.0%/流動負債7.3%＝両側低棒 |
| SBUX | 2023 | -7988 | 29445 | 37433 | |
| SBUX | 2024 | -7441 | 31339 | 38780 | |
| SBUX | 2025 | -8089 | 32019 | 40108 | 左右列高25%不一致（監査どおり） |

- 単位実測: MCD 2025 は bsAxisMax=61306百万USD → pickUnit → **{div:100, suffix:"億ドル", dec:0}**（finance-rules.js:118・a≥10000 で dec0）。fmtUnitValue(|−1791|)=**「18億ドル」**。SBUX 2025 → **「81億ドル」**。監査の「▲x.x兆円」書式例は JPY 想定＝現実の該当銘柄は全て USD 億ドル層。
- 代表銘柄比率（P8用）: 8306.T 純資産 **5.3%**（21,728,131百万円=21.7兆円・監査の例示と一致）/4755.T 流動負債2.1%+純資産4.7%/MCD 流動資産7.0%+流動負債7.3%/7203.T は最小29.2%＝サマリ非表示の対照銘柄に最適。
- 12-15%帯の注意: desktop LOW=0.12 と モバイル表示ゲート 0.15 が不一致。モバイル情報全損の定義はゲート側（<15%）なので、P8 サマリの対象条件は **0.15 基準**にする（lowIndices の 0.12 filter を流用すると 12-15% セグメントがモバイルで表示もサマリもない「取りこぼし」になる）。

### 監査の前提が現HEADで変わった点（invalidated 詳細）
1. P6 の file:line: `:713-715`→現 `:747-749`、`:881`（formatter null）→現 `:937-944`。P8 の `:809-812`→現 `:881-884`、`detail.css:453`→現 `:452`。
2. 「P5のプラグインに相乗り可」: bsLeaderPlugin は実装済だが **$bsLeaders gate の線描画専用＋datalabels 非公開API依存**。注記はラベル矩形に依存しないため、同一プラグインに相乗りすると「プラグイン更新でリード線が無言で死ぬ」リスクに注記まで巻き込む。別 gate が適切（下記比較）。
3. 単位: ページ統一単位（pageUnit 引数）は全廃→BS はチャート別単位（両スタック和max・USD億層新設）。注記の金額整形は renderBSChart ローカルの `unit` を使えば自動整合（別計算不要）。
4. 調達源泉列上部の空き: wave前は上逃がしラベルが浮遊していたが、現HEADは横逃がし統一で **top:65 帯は完全空き**＝注記の competing 要素は「低棒チップの上端が chartArea.top を最大~12px 越える可能性」のみ。
5. renderBSChart は毎回 destroy→new Chart（:802-804）＝注記/サマリも render 時評価で自然に再構築（リサイズ跨ぎは次 render まで旧値＝既存挙動と同じ）。
6. 監査P6派生の「構成比分母 totalAssets ゆえ負値時の調達源泉列で閾値意味がずれる」は現HEADも同構造（:761/:893 等）＝軽微・据置。

## proposal

### P6 債務超過注記（工数: 半日＝実装1-2h+受入）
**方式比較**:
- (a) bsLeaderPlugin 相乗り: 差分最小だが id "bsLeader" の意味が濁り、datalabels 内部API 依存ブロックと非依存ブロックが同居。
- (b) **別プラグイン `bsNotePlugin`（推奨・機構分離と頑健性の観点）**: gate 方式は neonGlow/bsLeader と同型で3例目＝規約が立つ。datalabels 内部API 非依存＝プラグイン更新でリード線が死んでも注記は生存。矩形を `chart.$bsNoteRect` に書き戻せば受入が bs-callout-verify.js の X() 交差判定にそのまま乗る。
- (c) DOM 注記: 調達源泉列への位置合わせに canvas 幾何の DOM 逆写像が要り複雑化。カード上部固定なら簡単だが「列上部」という監査意図から外れる。→ 不採用（モバイルは P8 の DOM サマリが兼務）。

**実装（(b)案）**:
1. detail-charts.js:147（`Chart.register(bsLeaderPlugin)`）直後に登録（~18行）:
```js
const bsNotePlugin = { id: "bsNote", afterDatasetsDraw(chart) {
  const note = chart.$bsNote; if (!note) { chart.$bsNoteRect = null; return; }
  const el = chart.getDatasetMeta(0).data[1]; if (!el) return;   // 調達源泉列の中心x（di任意・value0でもxは有効）
  const c = chart.ctx, ca = chart.chartArea;
  c.save();
  c.font = "bold 12px " + (Chart.defaults.font.family || "sans-serif");   // テーマA 12px床
  const tw = c.measureText(note.text).width, padX = 10, padY = 5, h = 12 + padY * 2;
  const cx = Math.max(tw / 2 + padX + 4, Math.min(el.x, chart.width - tw / 2 - padX - 4)); // 端クランプ
  const x = cx - tw / 2 - padX, y = ca.top - h - 16;             // top:65帯内・チップ上端越え(~12px)と非干渉
  c.fillStyle = "#0a0f17"; c.strokeStyle = "#ff5c7a"; c.lineWidth = 1.5;
  c.beginPath(); c.roundRect(x, y, tw + padX * 2, h, 6); c.fill(); c.stroke();
  c.fillStyle = "#ff8fa5"; c.textBaseline = "middle"; c.fillText(note.text, x + padX, y + h / 2);
  c.restore();
  chart.$bsNoteRect = { x, y, w: tw + padX * 2, h };             // 受入アサート用に書き戻し
} };
Chart.register(bsNotePlugin);
```
2. renderBSChart 側（:967 `$bsLeaders` 直後・~4行）:
```js
bsChartInstance.$bsNote = (!isMobile && hasNegativeEquity) ? {
  text: "純資産 ▲" + FinanceRules.fmtUnitValue(Math.abs(fin.net_assets), unit) + "（債務超過）",
} : null;
```
   - `unit` はチャート別単位（:756）＝バッジ/軸/ラベルと自動整合。MCD 2025=「純資産 ▲18億ドル（債務超過）」・SBUX 2025=「純資産 ▲81億ドル（債務超過）」（実DB検算済）。
   - モバイルは非表示（top帯10pxで置き場なし）→ P8 サマリが債務超過行を兼務（下記）。
   - 色は側パネル「マイナス」の #ff5c7a 系（:793 と同・チップ地 #0a0f17 は :893 と同）＝既存の負値表現と統一。

### P8 モバイル低棒サマリ（工数: 半日＝実装1-2h+受入）
1. **DOM 挿入点**: index.html:1262（chart-main-area 閉じ直後・side-panel :1263 の前）に1行:
```html
<div id="bs-mobile-note" class="bs-mobile-note" hidden></div>
```
   <1024px は .grid-layout 縦積み＝チャート直下・側パネルの上に出る。カードごと非表示（detail.js:760-762）に包含されるため ETF/!fin の stale なし。
2. **データ取得点**: renderBSChart の lowIndices 構築部（:767-774）を2段化（filter 前のタプルにラベルを持たせる・機能等価）:
```js
const BS_LABELS = ["純資産", "固定負債", "流動負債", "固定資産", "流動資産"];
const lowTuples = [ [0, displayNetAssets, 1], [1, fin.non_current_liabilities, 1], [2, fin.current_liabilities, 1], [3, fin.non_current_assets, 0], [4, fin.current_assets, 0] ];
const lowIndices = lowTuples.filter(([, v]) => totalAssets > 0 && v > 0 && v / totalAssets < LOW).map(([di, , bi]) => ({ di, bi }));
```
3. **書込**（renderBSChart 末尾 :967 付近・~10行）: モバイル表示ゲート（:881-884）と同じ **0.15** を対象条件にする（0.12 流用は 12-15% 帯の取りこぼし）:
```js
const noteEl = document.getElementById("bs-mobile-note");
if (noteEl) {
  const items = totalAssets > 0 ? lowTuples
    .filter(([, v]) => v > 0 && v / totalAssets < 0.15)
    .map(([di, v]) => BS_LABELS[di] + " " + FinanceRules.fmtUnitValue(v, unit) + " (" + (v / totalAssets * 100).toFixed(1) + "%)") : [];
  if (hasNegativeEquity) items.unshift("純資産 ▲" + FinanceRules.fmtUnitValue(Math.abs(fin.net_assets), unit) + "（債務超過）");
  noteEl.textContent = items.join("・");
  noteEl.hidden = !(isMobile && items.length > 0);
}
```
   例: 8306.T→「純資産 21.7兆円 (5.3%)」（監査の例示書式そのまま）/4755.T→「純資産 0.1兆円 (4.7%)・流動負債 0.0兆円 (2.1%)」※単位は BS チャート別単位に従う/MCD→「純資産 ▲18億ドル（債務超過）・流動負債 45億ドル (7.3%)・流動資産 42億ドル (7.0%)」/7203.T→hidden。
4. **CSS**（detail.css の @media(max-width:768px) ブロック :405-448 内 or base に1ルール・12px床準拠）:
```css
.bs-mobile-note { font-size: 12px; color: var(--ix-text-dim, #9fb0d0); line-height: 1.5; margin: 6px 2px 0; }
```
   （.sig-disclaimer :900 / .fin-pending-note :1022 と同規約。desktop では JS ゲート（isMobile）で hidden 維持＝CSS メディア分岐は不要だが、保険で `@media(min-width:768px){ .bs-mobile-note{display:none} }` を足してもよい）。

### bs-callout-verify.js への追加アサート案（受入）
- 銘柄セットに **SBUX** を追加（MCD は既存。SBUX=非低棒側の債務超過・左右列高25%不一致の対照）。
- デスクトップ 1440/1024 ループ内（page.evaluate の戻りに `noteRect: chart.$bsNoteRect, noteText: (chart.$bsNote||{}).text` を追加）:
  1. MCD/SBUX: `$bsNoteRect` 非null・canvas 内クリップ0（`x>=0 && y>=0 && x+w<=cw && y+h<=ch`）。
  2. MCD/SBUX: noteRect × 全チップ `X()` 交差0・× バー矩形 交差0・× axisBand 交差0。
  3. MCD/SBUX: noteText が `/^純資産 ▲\d+(\.\d+)?億ドル（債務超過）$/` に一致（単位整合の検収）。
  4. 7203.T/8306.T/6758.T/4755.T/NVDA/BRK-B: `$bsNoteRect` が null（非債務超過で不発火）。
- モバイル 375 ブロック（既存 6758.T の padding アサートの後）:
  5. 8306.T: `#bs-mobile-note` が hidden でなく textContent が `/純資産 21\.7兆円 \(5\.3%\)/` に一致。
  6. MCD: textContent に「債務超過」を含む＋`$bsNoteRect` null（モバイルは canvas 注記なし）。
  7. 7203.T: `#bs-mobile-note` hidden（全セグメント≥15%）。
  8. 既存「padding arm 不変（left=4）」は維持（P8 は padding 非接触）。
- 既存 2層ゲート: domHash/chartContainerDims が index.html の1行追加で意図 diff→検分→再 baseline（spec §9.1 の運用どおり）。

## risks
- **注記チップと低棒チップの縦干渉**: 低棒チップはセグメント中点アンカーで上端が chartArea.top を最大 ~12px 越え得る（MCD 右列の流動負債 7.3% が列最上段・列高≒軸max）。提案の `y = ca.top - h - 16`（チップ下端が top-16）でクリアランス ~4px＋受入アサート2で機械検出。干渉が出たら 16→24 に広げる（top:65 帯内で余裕あり）。
- **狭幅での注記幅**: 1024px（canvas 464・MCD は両側 CALLOUT_PAD=126）で chartArea.width≒140＝注記(~210px)は列中心から左右にはみ出し軸帯上空を横断する。垂直帯（axisBand は y∈[ca.top, ca.bottom]）の外なので交差0は保てるが、y軸最上段 tick ラベルの上半分と近接し得る＝受入アサート2の axisBand を `y: ca.top - 8` に広げて検出余裕を持たせるのが安全。
- **roundRect 依存**: Canvas2D roundRect は Chrome 99+/Safari 16+。本アプリの他所は未使用＝初出。互換を厳密にするなら手書き path（+6行）に置換。
- **P8 の 0.15/0.12 二重閾値**: サマリは 0.15・デスクトップ吹き出しは 0.12 で「12-15% はデスクトップ吹き出しなし・モバイルサマリあり」という非対称が生じる（意図的＝モバイル情報全損の定義がゲート 0.15 だから）。spec 化の際に一文明記しないと将来レビューで矛盾指摘され得る。
- **detail-snapshot/f2-snapshot の意図 diff**: index.html 1行追加＝domHash・portalDomLen が diff る。2層ゲート運用（検分→再 baseline）で吸収（spec §9.1）。money 系非接触＝cockpit-e2e は無風だが CLAUDE.md 上 money.css を触らない構成にした（CSS は detail.css 側へ）。
- **P8 の canvas 高150px 乖離疑い（監査の残課題）**: 本recon でも未検証（Playwright 実測が必要）。サマリ実装とは独立だが、モバイル実機サニティ時に併せて確認するのが安い。
- **注記の年次切替**: MCD/SBUX は全3年債務超過＝年切替で常時表示。将来「ある年だけ債務超過」の銘柄でも renderBSChart 毎回再構築（destroy→new）で自然追従＝追加配線不要。
- **bsLeaderPlugin 非公開API リスクとの分離**: 提案(b)により注記は datalabels 更新の影響圏外。逆に「リード線だけ死んで注記は残る」非対称も起こり得る＝プラグイン更新時の再確認事項（既存の spec §8.3 注意書き）に bsNote は含まれない旨を明記すると混乱がない。

## sites
- detail-charts.js:129-147 — bsLeaderPlugin（$bsLeaders gate・afterDatasetsDraw・datalabels 非公開API依存）。P6 新プラグインは :147 直後に登録
- detail-charts.js:744 — renderBSChart(fin) 開始（〜968。pageUnit 引数は wave で全廃）
- detail-charts.js:745 — isMobile = window.innerWidth < 768（P8 のモバイル判定の現実装・render時1回評価）
- detail-charts.js:747-749 — hasNegativeEquity / displayNetAssets（P6 の根・監査 :713-715 の移動先）
- detail-charts.js:752-756 — bsAxisMax（両スタック和max）→ unit = pickUnit(bsAxisMax, currency)＝注記/サマリの金額整形はこの unit を使う
- detail-charts.js:759-763 — LOW=0.12 / lowLeft / lowRight / CALLOUT_PAD（side-aware 動的パディング）
- detail-charts.js:767-774 — lowIndices 構築（P8 データ取得点＝ここを lowTuples 2段化。負純資産は v>0 で自動除外）
- detail-charts.js:791-798 — 債務超過の既存表現（側パネル「マイナス」#ff5c7a のみ＝チャート上は無痕跡のまま）
- detail-charts.js:873 — layout.padding（desktop top:65 帯＝注記の置き場・モバイル arm {top:10} は不変維持）
- detail-charts.js:881-884 — モバイル datalabels 表示ゲート val>0 && ratio>=0.15（P8 症状の根・監査 :809-812 の移動先。サマリ対象条件はこの 0.15 と揃える）
- detail-charts.js:915-936 — anchor center 統一＋横逃がし align＋offset（wave 再設計後＝top帯が空いた理由）
- detail-charts.js:937-944 — formatter value===0 → null（負純資産のラベル消滅点・監査 :881 の移動先）
- detail-charts.js:966-967 — $neonSpecs / $bsLeaders 書込（P6 の $bsNote 書込はこの直後が同型）
- index.html:46 — chartjs-plugin-datalabels@2.2.0 SRI pin（bsLeader の内部API安定性の前提・bsNote は非依存）
- index.html:1252-1263 — BS カード DOM（:1262 chart-main-area 閉じ直後が #bs-mobile-note 挿入点）
- detail.js:757-762 — finVisible ゲート（ETF/!fin でカードごと非表示＝注記/サマリの stale 経路なし）
- detail.js:802 — DetailCharts.renderBSChart(fin) 呼出（毎回 destroy→new＝年/銘柄切替で自然再評価）
- detail.css:405-448 / 452 / 459 — モバイル媒体ブロックと .chart-main-area 高（480px→280px・375px→240px。監査の :453 は現 :452）。.bs-mobile-note の追加先
- detail.css:900 / 1022 — .sig-disclaimer / .fin-pending-note（12px・--ix-text-dim の既存規約＝サマリ CSS の踏襲元）
- finance-rules.js:112-123 / 129-139 — pickUnit（USD 億層 dec0/1）/ fmtUnitValue（注記「▲18億ドル」整形の実体・負値は Math.abs で渡す）
- scratchpad/bs-callout-verify.js:21 — 銘柄ループ（SBUX 追加点）・:24-43 page.evaluate（noteRect/noteText 抽出の追加点）・:64-73 モバイルブロック（サマリ/hidden アサート追加点）
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md §8/§12/§13 — wave 実装の正・P6/P8 が次wave積み残しである根拠
- data/investment.db financial_data_v2 — net_assets<0 は MCD/SBUX×FY2023-2025 の6行のみ（全USD・SELECT 実測 2026-08-21）
