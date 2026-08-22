# finviz-labels（recon実測 2026-08-21・HEAD 8e44298）

担当＝監査 観点2 パターン2（銀行 営業利益0 ラベル）/ パターン7（持株会社 N/A・浮遊「0」）/ パターン8（レーダー団子）＋ spec §12「銀行の側パネル流動比率0.0%」。実DB data/investment.db（symlink 実体あり）で SELECT 実測済み。

## summary

- 4症状とも現HEADで再現構造が残存（直近waveは単位系・BS吹き出しのみ変更＝PL/CF/レーダーの datalabels 配置ロジックと側パネル比率経路は無改修。ただし file:line は全面シフト）。
- 銀行判定は実DB実測で**値ベース `op=0∧経常>0` が金融12銘柄36行と過不足なく外延一致**（非金融の該当0行・9984.Tは経常=0で不干渉）＝industry文字列判定（4 distinct値のSet管理）は不要と確定。
- 流動比率は**ポータル(index.html:1980)/cross-section(:90-91)が既に ratioOrNull 化済み**で、残るのは詳細側パネル（detail-charts.js:789/799）＋**健全性トレンド（detail-rules.js:867・監査/spec未記載の同根新発見）**。ratioOrNull 本体は finance-rules.js:174 に実装済＝新設不要・呼び替えのみ。
- 修正方針は4件とも監査のまま有効。4件を1リリースで束ね（検証1回・bs-callout-verify.js の rect アサート手法を流用）、合計 約1日。

## notes

### 共通（直近waveによる前提変化）
- pageUnit（ページ統一単位）は廃止済み＝PL/CF/BS 各 render 冒頭でチャート別 `pickUnit`（detail-charts.js:1069-1071 / :1216-1218 / :750-757）。datalabel は `fmtUnitValue(value, unit)`・軸は `fmtTickValue`（finance-rules.js:143-155）。**症状（0ラベル/N/A配置/団子/0.0%）自体は単位系と独立で不変**。
- 全ゼロFY行は合流方式（hasFinSubstance=finance-rules.js:72-75・detail.js 既定年/プレースホルダ）で PL/CF/レーダーに到達しない＝監査の 6861.T 系「全ゼロでの団子/0ラベル」事例は消滅済み。P8 は低スコア実データ（8306.T 0点/11点・7201.T 0点/5点）で残存。
- BS の浮遊0/低棒はwave §8 で横逃がし統一済＝P7 の残対象は PL（＋CF は任意）。

### P2: 銀行の営業利益0（実DB実測）
- 金融12銘柄＝銀行5（8306.T/8308.T/8309.T/8316.T/8411.T）・保険3（8725.T/8750.T/8766.T）・証券2（8591.T/8604.T）・US2（JPM/BRK-B）。**全36行（FY2023-2025）で operating_income=0 ∧ ordinary_income>0 ∧ current_assets=0 ∧ current_liabilities=0**。
- `op=0 ∧ ordinary<>0 ∧ 非金融 industry` の行は**0件**＝値ベース判定式が industry 判定と完全に外延一致。industry の distinct は「銀行・金融」「保険」「証券・金融サービス」「US - 銀行・金融」の4値に跨り、かつ fin 行オブジェクトに industry は無い（ticker_master 側）＝値ベースが純関数として自然。
- 9984.T は op=0 ∧ ordinary=0 ∧ ibt≠0（2023:-980000/2024:-450000/2025:3086701）＝`ordinary>0` 条件で金融判定から自動排除・HOLDING_COMPANIES 特例（detail-rules.js:33）と衝突しない。
- 現コード: plSteps の営業利益は core:true（detail-rules.js:506）で常出・PL formatter に銀行分岐なし（detail-charts.js:1125-1143・HOLDING 特例 :1127-1129 のみ）→ 銀行では「0␤営業利益率: 0.0%␤(基準値4-5%前後)」の黄ラベルが棒なしで浮く構造が現存。レーダーは targetOp=operating_income（detail-rules.js:581）→ opMargin=0 → 収益性 score(0,0,12)=0点。

### P7: 持株会社 N/A・浮遊「0」（現実装裏取り）
- PL（detail-charts.js）: anchor は固定 "end"（:1111）。align 関数（:1112-1119）は **val=0∧営業利益∧HOLDING のみ "center"**（:1115-1116）＝ラベル中心が基線上＝全値正の年（9984.T FY2025）は基線=チャート下端でX軸ラベル「営業利益」と衝突（監査再現構造そのまま）。それ以外の val=0 は `0/max<0.15` で "top"+offset6（:1117-1123）＝基線6px上に「0」が浮遊。
- 経常利益=0 の浮遊「0」: 9984.T の ordinary_income=0 は hasValue(0)=true で段が出る（detail-rules.js:505/:509）。**ordinary=0∧ibt≠0 の該当は実DBで 9984.T の3行のみ**＝IFRS判定の段省略は影響範囲が閉じている。
- CF（detail-charts.js）: anchor :1250-1258（中間段 diff<0→"start"）・align :1259-1263（diff>=0→"top"）・offset 15（:1264）・formatter :1265-1275（段名+値・diff=0 でも「0」を出す）。diff=0 の浮遊「0」（2503.T 等）はデータ側0埋め由来＝表示側は任意対応（下記 proposal 参照）。
- なお US 銘柄は ordinary=ibt の同値重複保存（AAPL/MCD/NVDA で確認）＝経常/税引前の二重段は別件（今回スコープ外）。

### P8: レーダー低スコア団子
- detail-charts.js:1025-1031 の radar datalabels に anchor/align/offset 指定なし＝点の中央にラベル配置。低スコア（銀行=収益性0点＋短期支払0点、7201.T 等）は点が中心付近に集まりラベル重畳＝監査構造そのまま。
- 直近waveの BS stagger（:920-921/:932-933）で **datalabels の「align=数値（時計回り度）」が本番実績化済み**＝P8 の放射角 align 化は同じ機構の適用で低リスク。

### 流動比率 0.0%（側パネル）
- 値の経路: detail-charts.js renderBSChart :789 `FinanceRules.currentRatio(fin)`（ratio は分母0→0＝finance-rules.js:19-22/:36-39）→ :799 `animateNumber(#current-ratio, 0, "%")` → 銀行で「0.0%」の偽値表示。DOM は index.html:1283（#current-ratio）・基準テキストは detail.js:749-753（currentRatioDesc）。
- **animateNumber（detail.js:189-199）は null を渡すと `(null*eased).toFixed` = "0.0%" を無言表示**＝ratioOrNull 化には呼び出し前の null 分岐が必須。
- 既にゲート済みの箇所: ポータル index.html:1979-1980（ratioOrNull）・cross-section-rules.js:90-91（_finRatio→null）。
- **新発見（同根の残存・監査/spec §12 未記載）**: healthTrendSeries（detail-rules.js:858-877）の curOk（:867）は hasValue ゲートのみ＝銀行の 0/0（0は非null）を通し **健全性トレンドチャートに流動比率0%の実線を描画**。分母>0 条件が無い。
- レーダーの短期支払 score(currentRatio=0,50,160)=0点 も同根（P2 の収益性代替と別軸・今回スコープ外として残存を明記）。

## proposal

4件は同一リリースで束ねる（監査「パターン2/7/8は束ねると検証1回」＝現在も有効。流動比率も同じ detail-charts/detail-rules 帯）。

### (1) P2: 銀行の営業利益 N/A 化＋レーダー収益性の経常代替（見積: 半日）
- **判定式（確定提案）**: 値ベース `isFinancialPL(fin) = FR.n(fin.operating_income) === 0 && FR.n(fin.ordinary_income) > 0` を detail-rules.js に新設（:497 plSteps 直上・約3行）＋ export（:987）。DB実測で金融12銘柄36行と過不足なく一致・industry 文字列判定は不採用（fin 純関数から外れ・4値Set管理・新銘柄追随漏れ）。
- **表示＝N/A（HOLDING 同型・推奨）**: detail-charts.js:1126-1129 の formatter に分岐追加 `if (value === 0 && label === "営業利益" && DetailRules.isFinancialPL(fin)) return "N/A\n(銀行・金融)";`（fin は renderPLChart closure で参照可）。配置は (2) の val=0 統一退避に乗せる。
  - 代替案=段省略（plSteps :509 の filter に `&& !(s.label === "営業利益" && isFinancialPL(fin))` 追加）も1行で可だが、HOLDING の N/A 表示と一貫させ6段構造を保つ N/A 案を推奨（教育文脈で「なぜ無いか」を示せる）。
- **レーダー**: detail-rules.js:581 を `const targetOp = HOLDING_COMPANIES.has(ticker) ? fin.income_before_taxes : (isFinancialPL(fin) ? fin.ordinary_income : fin.operating_income);` に（1行）。score レンジ 0-12 は据置（8306.T 2025 経常率37.3%→100点）。
- テスト: tests/detail-rules.test.js:202-215 に銀行フィクスチャ（op=0/ordinary>0）追加＋isFinancialPL 単体（金融true/9984.T false/通常false）＝約+20行。

### (2) P7: val=0 統一退避＋IFRS 段省略（見積: 極小〜小 1-2h）
- detail-charts.js:1112-1119 align: 先頭に `if (val === 0) return "top";` を置き **HOLDING center 分岐（:1115-1116）を削除**（label/HOLDING 参照ごと消える）。
- detail-charts.js:1120-1124 offset: `if (val === 0) return 12;` を追加（固定退避・現行6より上げ軸帯から確実に離す）。
- detail-rules.js:509 の filter を `(s.core || FR.hasValue(fin, s.key)) && !(s.key === "ordinary_income" && FR.n(fin.ordinary_income) === 0 && FR.n(fin.income_before_taxes) !== 0)` に拡張＝IFRS判定の段省略（実DBで 9984.T 3行のみに作用）。テスト: plSteps に 9984.T 型ケース追加。
- CF は現状維持を既定（diff=0「0」はデータ側0埋め由来＝ETL別レーン）。表示側で消すなら formatter :1268 の直後に `if (diff === 0 && idx !== 0 && idx !== cfLastIdx) return null;` の1行（任意・データ是正との二重対応に注意）。

### (3) P8: レーダーラベルの放射退避（見積: 小・数時間）
- detail-charts.js:1025-1031 の datalabels に追加: `align: (ctx) => ctx.dataIndex * (360 / ctx.chart.data.labels.length) - 90, offset: 8`（頂点0=真上=-90°・時計回り72°刻み＝各ラベルが自軸の外向きへ退避。数値 align は BS stagger :921 で本番実績済みの機構）。anchor は点要素のため不要。
- 低スコア同値の重畳は放射方向が軸ごとに異なるため原理的に分離＝間引き実装は初回不要（受入アサートで残余重なりが出た場合のみ追加）。
- 受入: Playwright で `$datalabels...$layout._box._rect` 相互交差=0（scratchpad/bs-callout-verify.js の手法流用・8306.T/7201.T/6861.T）。

### (4) 流動比率 ratioOrNull 化（見積: 小 1-2h）
- detail-charts.js:789 を `const currentRatio = FinanceRules.ratioOrNull(fin, FinanceRules.currentRatio, ["current_assets","current_liabilities"], ["current_liabilities"]);`（index.html:1980 と同引数・単一源）。
- detail-charts.js:799 を null 分岐化: `const crEl = document.getElementById("current-ratio"); if (currentRatio === null) { crEl.innerText = "N/A"; } else { animateNumber(crEl, currentRatio, "%", 1, 900); }`（**animateNumber(null) は "0.0%" を無言表示するため分岐必須**）。任意: null 時に `#desc-current-ratio` を「▶ 銀行・金融は流動/固定区分がなく適用外」へ上書き（detail.js:753 が先・renderBSChart :802 が後＝上書き成立を実行順で確認済）。
- **隣接同根（新発見・同時修正推奨）**: detail-rules.js:867 の curOk に `&& FR.n(f.current_liabilities) > 0` を追加＝銀行の健全性トレンド流動比率線を null 欠測化（spanGaps:false で線が消える＝偽0%線の根絶）。テスト: tests/detail-rules.test.js:450-470 帯に銀行型フィクスチャ追加。
- **currentRatio 本体（finance-rules.js:36-39）と ratio の 0 返し（:19-22）は変えない**＝tests/finance-rules.test.js:37 の既存挙動固定を維持し、消費者側で ratioOrNull を選ぶ既存パターン（portal/cross-section）に揃える。

### 束ね方・検証
- 実施順は任意（相互依存なし）だが (1)(2) は同じ align/formatter 帯＝同一コミット推奨。
- 検証1回で束ねる: node --test（rules 追加分）＋ mock鯖8200 Playwright で 8306.T（銀行: PL N/A・レーダー・側パネル N/A・健全性トレンド）/ 9984.T（N/A退避・経常段省略）/ 7201.T（レーダー分離）/ 7203.T（非金融の非退行）＋ detail-snapshot/f2-snapshot の2層ゲート（spec §9.1 運用・意図 diff 検分→再 baseline）。

## risks

- **値ベース判定の将来誤爆**: 非金融で営業利益ちょうど0の年が将来入ると N/A 誤表示（現DB 0件）。堅くするなら `&& FR.n(fin.current_liabilities) === 0` を追加条件に（金融の「流動区分なし」構造とセットで判定・現12銘柄も全行合致）。
- **レーダー形状の大変化**: 収益性の経常代替で銀行は0点→ほぼ100点へ振れる＝意図変更として before/after を明示し本人実機サニティに含める。
- **9984.T の見た目変化**: N/A 退避＋経常段省略で FY2025 のPLが変わる＝退行でなく意図変更（受入期待値を更新）。
- **レーダー短期支払は残存**: 銀行は currentRatio 概念なし→0点のまま（(4) は側パネル/トレンドのみ）。radarScores の null 軸化は5軸構造の再設計が要るため次waveへ明示的に残す。
- **CF diff=0 ラベル省略（任意案）を採る場合**: データ側0埋め是正（ETL別レーン）と二重対応にならないよう採否を明示すること。
- 検証は spec §9.1 の2層ゲート運用（baseline は git 非追跡＝before capture を変更前に必ず取る）。datalabels 内部API（`$layout._box._rect`）依存の受入スクリプトは SRI pin v2.2.0 前提（既存 bs-callout-verify.js と同条件）。

## sites

- finance-rules.js:19-22 — ratio: 分母0以下→0（0.0%偽値の根・本体は変更しない方針）
- finance-rules.js:36-39 — currentRatio（tests/finance-rules.test.js:37 が 0 挙動を固定）
- finance-rules.js:72-75 — hasFinSubstance（銀行行は net_sales>0 で素通り＝誤除外なしを確認）
- finance-rules.js:174-184 — ratioOrNull 既存実装（新設不要・(4) はこれへの呼び替え）
- detail-rules.js:33 — HOLDING_COMPANIES（9984.T・isFinancialPL と実データ上排他）
- detail-rules.js:498-510 — plSteps（営業利益 core:true=:506・経常段=:505・filter=:509＝(1)(2) の rules 側変更点）
- detail-rules.js:576-594 — radarScores（targetOp=:581・opMargin=:582・収益性score=:589・短期支払score=:591）
- detail-rules.js:858-877 — healthTrendSeries（curOk=:867 に分母>0 条件が無い＝銀行で流動比率0%実線の新発見）
- detail-charts.js:788-799 — renderBSChart 側パネル書込（currentRatio算出=:789・#current-ratio 書込=:799＝(4) の変更点）
- detail-charts.js:1025-1031 — radar datalabels（anchor/align/offset 無指定＝(3) の変更点）
- detail-charts.js:1111-1124 — PL anchor/align/offset（HOLDING center 分岐=:1115-1116・val=0 top+offset6=:1117-1123＝(2) の変更点）
- detail-charts.js:1125-1143 — PL formatter（HOLDING N/A=:1127-1129・(1) の銀行 N/A 分岐追加点）
- detail-charts.js:1250-1275 — CF anchor/align/offset/formatter（diff=0「0」浮遊の現構造・任意対応点）
- detail.js:189-199 — animateNumber（null→"0.0%" 無言表示＝(4) で呼出前分岐必須の根拠）
- detail.js:749-753 — desc-current-ratio 基準テキスト書込（renderBSChart より先に実行）
- index.html:1279-1290 — 側パネル流動比率 markup（#current-ratio=:1283）
- index.html:1979-1980 — ポータルの ratioOrNull 既適用（(4) が揃えるべき先例）
- cross-section-rules.js:90-91 — cross-section の currentRatio null ゲート既適用
- tests/detail-rules.test.js:188-215 / :450-470 / :916-925 — plSteps/radarScores/healthTrendSeries 既存テスト（追加ケースの挿入先）
- scratchpad/bs-callout-verify.js — rect 数値アサート受入の既存手法（P8/P7 受入で流用）
