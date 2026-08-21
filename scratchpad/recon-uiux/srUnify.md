# srUnify（recon実測 2026-08-09・HEAD 143df86・wf_1876fa2c-3ac）

## summary
監査 価格-B の主張は実コードで全て裏取りできた（HEAD=143df86・監査時点からズレなし、ただしstaleコメントの正確な位置は detail-rules.js:707「直上」でなく 706-707 の2行コメントで、detectSR 呼び出しは 709）。チャート側 S/R は updateMaAndVolume が base（実質ほぼ常に全履歴 data.prices）を applySRLines→detectSR に渡し、detectSR 内部の slice(-252) が「今日から直近252本」を切るため、FY窓表示でも常に最新1年基準のレベルを描く（先読みリーク）。一方サマリ digest は detectSR(dp=displayPrices, Infinity) で表示窓基準＝両者は入力窓と maxPerSide（3 vs Infinity）の二重不一致。単一源化は detail-charts.js:508 を applySRLines(displayPrices)、:244 を applySRLines(currentDisplayPrices) に変えるだけで入力窓が揃い、maxPerSide 差は「チャート=count降順 top-3 描画のみ」の意図的差として維持可（detectSR は同一入力なら決定論で同一クラスタ列を返す）。副作用はローソクglow・T/R線とは無干渉だが、監査A（右軸バッジ渋滞）は窓統一でレベルが可視レンジ内に集まり悪化し得るため同時修正推奨。

## notes
【データフロー実測】(1)描画経路: detail.js updateFinancialViews(:646)→priceWindow(:674)で displayPrices（FY窓 or fallback末尾200本）→updateMaAndVolume(displayPrices, data.prices)(:678)→detail-charts.js:483 base=全履歴→:508 applySRLines(base)→:226 detectSR(base, 既定3)→detail-rules.js:118 slice(-252)＝『今日から直近252本』固定。FY窓が何年でも S/R レベルは不変（FY切替で再実行はされるが入力が全履歴なので結果同一）。(2)トグル経路: toggleSR(:240)は STOCK_DATA[currentTicker].prices（全履歴）を直渡し＝base 分岐すら通らない別実装。(3)digest経路: detail.js:696→signalDigest(displayPrices, data.prices)→detail-rules.js:709 detectSR(dp, Infinity)＝表示窓の末尾252本（fallback時は200本全部）。窓・maxPerSide の両方が不一致。(4)displayPrices のチャート側入手手段: updateMaAndVolume の引数＋closure 変数 currentDisplayPrices(:52・:511 と refreshSubpanels:410 で更新)。⚠:511 の代入は :508 applySRLines より後＝applySRLines 内で closure を読む実装は1世代前の窓になる。引数渡し（:508 を applySRLines(displayPrices)）が安全。(5)detectSR 戻り値: {resistance:[{price,count}], support:[{price,count}]}・cluster は pivot高安(n=3フラクタル)を1.5%帯で束ね平均price+count・count降順ソート済→maxPerSide で切る。同一入力なら決定論＝チャートと digest が別々に detectSR を呼んでも入力を揃えれば数値は一致する（物理的に1回の呼び出しに統合する必要はないが、統合するなら updateFinancialViews で detectSR(displayPrices, Infinity) を1回呼び両者へ配る形が可能）。(6)チャート本数上限: 片側3×2=最大6本・全部に axisLabelVisible:true。digest は Infinity から最寄り1本/側を選ぶ（M7=top-3外の近い水準も拾う意図・detail-rules.js:114-115 に明記）。(7)S/R OFF 時(srState 既定 false :48)も applySRLines は毎回呼ばれ :225 で素通り＝コスト小。

## proposal
最小差分の窓統一（推奨）: ①detail-charts.js:508 `applySRLines(base)` → `applySRLines(displayPrices)`（MA/BB/KC の base(:483-502) は不変のまま）②detail-charts.js:244 `applySRLines(data.prices)` → `applySRLines(currentDisplayPrices)`（toggleSR 時点で currentDisplayPrices は必ず設定済み＝navigateToDetail→updateFinancialViews が先行。防御的に `currentDisplayPrices || data.prices` フォールバック可）③detail-rules.js:706-707 コメントを事実化（『チャート・サマリ共に表示期間 displayPrices 基準＝整合』へ更新）。これで両者の detectSR 入力が同一配列になり、slice(-252) は FY窓(通常245本前後)ほぼ全体、fallback時は200本全体で一致。maxPerSide 差は仕様として維持: チャート=同一クラスタ列の count降順 top-3 のみ描画（detectSR 既定3・cluster がソート済なので現行コード無変更で成立）、digest=Infinity で最寄り選択（M7 意図保持）。この場合 digest が top-3 外の弱い水準（強度1等）を引用しチャートに線が無いケースは残る＝完全一致にしたければ (a) applySRLines 側を detectSR(prices, Infinity) にして全レベル描画・axisLabel は上位2-3本のみ（監査Aの修正①②と合流）か (b) digest を top-3 に絞る（M7 撤回）のどちらかだが、監査Bの範囲では窓統一のみで『S線が現値の上/R線が下』の逆転と数値不一致は解消する。単一呼び出しへの物理統合案: updateFinancialViews(detail.js:674 付近)で `const sr = DetailRules.detectSR(displayPrices, Infinity)` を1回計算し、DetailCharts.updateMaAndVolume に引数追加で渡し applySRLines は受領クラスタの slice(0,3)/側を描画、renderSignalDigest にも渡す——ただし signalDigest(:709) と applySRLines(:226) の両シグネチャ変更＋toggleSR 用に sr のキャッシュ保持が必要で差分が膨らむ。決定論性により入力統一だけで数値一致が保証されるため、最小差分案で十分。検証=scratchpad/detail-snapshot.js 突合＋FY切替(過年度JP銘柄で S/R が窓内レンジに収まること)目視。

## risks
- 監査Aとの相互作用: 現状は全履歴基準ゆえ過年度FY窓では S/R レベルが可視価格レンジ外に外れ軸端にクリップされて『見えない』ことがあるが、窓統一後は最大6レベル全てが可視レンジ内に入り右軸バッジ渋滞（監査A）が窓によっては悪化する。A の修正（近接マージ/axisLabel上位2本/端クランプ）と同一リリースで束ねるのが安全
- toggleSR(:244)の直し忘れ: :508 だけ変えると『FY切替後は窓基準・トグルOFF→ONで全履歴基準』の状態依存不整合が生まれる。両呼び出し口を必ず同時に変更
- applySRLines 内部で currentDisplayPrices を読む実装にする場合、:511 の代入が :508 の後にある順序罠で1世代前の窓を読む（引数渡しなら回避）
- fallback 200本窓(priceWindow:437)では detectSR が200本で算出＝現行の252本より母数が減り検出クラスタが変わる（正しい挙動だが before/after でレベル数・位置が変わるためスナップショット比較は『変わって正しい』確認が必要）
- 疎データFY窓（US暦年の進行中年など窓が数十本）では pivot 検出(n=3, :121)の母数不足で S/R が0本になり得る＝『線が消えた』と perceived regression になり得る。digest 側は既に同条件で『データ不足』を出す設計なので整合はする
- maxPerSide 差を残す場合、digest が『強度1』の最寄り水準を引用してもチャートに該当線が無い不一致は残存（窓統一では解消しない別軸の差＝spec で明示的に scope in/out を決めるべき）
- MA/BB/KC の base（全履歴算出→窓filter）を巻き込んで displayPrices に変えるとウォームアップ切れで指標線が窓先頭で欠ける退行＝:483-502 は不可侵
- detectSR は tests/detail-rules.test.js の対象（33テスト）＝detectSR 本体のシグネチャ/既定値を変えないこの案ではテスト影響なしだが、単一呼び出し統合案を採るとテスト改修が発生
- ローソクglow primitive(:519)・T/R線(drawTRLines:428・既に displayPrices 基準)・価格ラベルとは描画機構が別で直接干渉なし（実測確認済）

## sites
- detail-charts.js:222 — applySRLines(prices) 定義。既存 srLines(closure let :47)を candleSeries.removePriceLine で全除去→再生成。:225 で srState OFF か prices 空なら素通り（線ゼロ）
- detail-charts.js:226 — detectSR(prices) 呼び出し。第2引数省略＝detail-rules.js:117 の既定 maxPerSide=3 が適用（片側最大3クラスタ）
- detail-charts.js:227 — :227-238 R線 rgba(255,102,153,0.85)/S線 rgba(52,245,207,0.85) を createPriceLine（lineStyle:2 破線・axisLabelVisible:true・title R×count/S×count）。監査Aの右軸バッジ渋滞の発生源＝全レベルに軸ラベル発行
- detail-charts.js:240 — toggleSR。:244 で applySRLines(STOCK_DATA[currentTicker].prices)＝常に全履歴を渡す（updateMaAndVolume の base フォールバック分岐すら通らない）。窓統一時はここを applySRLines(currentDisplayPrices) に変える必要
- detail-charts.js:483 — const base = allPrices && allPrices.length >= 75 ? allPrices : displayPrices。allPrices=data.prices（全履歴）なので実質ほぼ常に全履歴。MA/BB/KC のウォームアップ用（全履歴算出→窓filter）としては正しいが S/R には不適
- detail-charts.js:508 — applySRLines(base)＝修正②の本丸。ここを applySRLines(displayPrices) に変えるのが最小差分。MA/BB/KC(:484-502)は base のまま維持すること（あちらは filter で窓に切るので正しい）
- detail-charts.js:511 — currentDisplayPrices = displayPrices の代入は applySRLines(:508) の後。applySRLines 内部で currentDisplayPrices を読む実装にすると1世代前の窓を読む罠＝引数渡しにするか代入を :508 より前へ移動
- detail-charts.js:519 — makeCandleGlowPrimitive（:519-547）。currentDisplayPrices を draw 時に読む Series Primitive。S/R は priceLine（別描画機構）で相互干渉なし＝修正②の影響ゼロ
- detail-rules.js:116 — detectSR(prices, maxPerSide) 定義。:117 既定3。:118 recent = prices.slice(-Math.min(252, prices.length))＝『渡された配列の末尾252本』であり時刻フィルタなし→全履歴を渡すと常に直近1年（先読みリークの機構）
- detail-rules.js:131 — cluster()：n=3 フラクタルpivot高安(:120-130)を昇順ソート→基準値から+1.5%以内をグルーピング(:140)→{price:平均, count:件数}(:143)→count降順ソート→slice(0,_maxPerSide)(:146)。戻り値 {resistance:[{price,count}...], support:[...]}（count降順で並び済＝上位N切り出しに再ソート不要）
- detail-rules.js:114 — :114-115 detectSR ヘッダコメント『既定 3(チャート描画=強い順 top-3)／signalDigest は Infinity(M7)』＝maxPerSide 差の意図を記述（こちらは正確・修正後も有効）
- detail-rules.js:706 — staleコメント（:706-707 の2行・監査の『707直上』は実際はこの2行）。原文=『// 5) S/R 最寄り（表示期間 dp から算出＝チャート描画のS/R線・as-ofキャプションと整合／全クラスタを』『//    close で上下分割し価格差最小を選ぶ＝count 降順 top-3 の外の近い水準も対象[M7]・count は強度表示のみ）』。『チャート描画のS/R線…と整合』が現状事実と不一致→修正②適用で真になる（文言更新推奨）
- detail-rules.js:709 — var sr = detectSR(dp, Infinity)。dp=signalDigest 第1引数 displayPrices(:641)。:710-722 で全クラスタを close 上下に分割し価格差最小の1本ずつを『直近の抵抗/支持まで±x%（強度count）』として出力
- detail-rules.js:433 — priceWindow(prices, selectedYear, isUS)：US=暦年/JP=前年4月〜3月で filter(:436)、0件なら displayPrices=prices.slice(-200) フォールバック(:437)。displayPrices の唯一の生成源
- detail.js:674 — updateFinancialViews 内で DetailRules.priceWindow(data.prices, selectedYear, isUS) から displayPrices 生成→:677 setCandleData(displayPrices)→:678 DetailCharts.updateMaAndVolume(displayPrices, data.prices)。FY切替(switchYear :638-644)と銘柄遷移(navigateToDetail の setTimeout 150ms :627-629)は共にここを全再実行
- detail.js:696 — renderSignalDigest(displayPrices, data.prices)→:263 DetailRules.signalDigest(displayPrices, allPrices)。digest 側の dp は既に表示窓＝修正はチャート側だけで窓が揃う
- docs/superpowers/audits/2026-08-09-chart-callout-audit.md:1 — 観点3 セクションB＝本任務の監査記述。file:line は 707 の記述を除き全て実コードと一致確認済み
