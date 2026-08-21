# pageUnit（recon実測 2026-08-09・HEAD 143df86・wf_1876fa2c-3ac）

## summary
監査PLCF-パターン1のfile:lineは全て実コードと一致（32eb0ae→143df86で対象コード変更なしを実測確認・ズレゼロ）。pageUnitはdetail.js:657でfinancialMaxAbs（15項目一括max・detail-rules.js:453-462）から1回だけ算出され、消費は「ヘッダ単位表示(detail.js:665)＋BS/PL/CFの datalabel formatter と y軸callback の計6箇所（detail-charts.js:885/903/1069/1097/1211/1228）」で全部＝CF側パネルは符号文言のみで金額非表示、レーダー/比較モーダル/ポータルは非消費。pickUnitのUSDは兆(≥1e6)→十億(≥1e3)→百万の3層で億層なし、fmtUnitValueのdec自動拡張while(finance-rules.js:126)が「0.0005兆ドル」を生み、軸目盛重複は非0目盛がdec=1固定で丸まるのが真因（拡張ループは丸め結果が厳密0の時しか発火しない）。チャート別単位のseamは既に存在（pageUnitは引数渡し・healthTrend/fcfTrendは同ファイル内でチャート内pickUnitの先行実装あり＝同型移植で済む）。テストはfinance-rules.test.js:93-136がpickUnit/fmtUnitValue/unitLabelの現行挙動をdeepEqualでピン留めしており、USD億層追加で最低5アサート書き換え必須。

## notes
【データフロー実測】updateFinancialViews(detail.js:646)→656-657でpageUnit算出（fin無=ETFでもmaxAbs=0で算出されヘッダに「単位: 百万円」が出る）→665ヘッダ表示→765/772のETF/!fin early-return→789/791/792で3チャートへ引数渡し。pageUnit消費の全リスト=ヘッダ1＋datalabel3＋軸callback3の計7箇所で閉じる（CF側パネルは符号のみ・レーダー無単位・healthTrend/fcfTrendは独自pickUnit・比較モーダルは価格でpageUnit非関与・index.htmlポータル側はpickUnit/fmtUnitValue/unitLabel未使用=fmtUnit(2188)/fmtMagnitude(2491)/unitWord(1686)のみ）。【0.0005兆ドルの機構】BRK-B等はmaxAbs≥1e6百万ドル→unit={div:1e6,dec:1}。CF diff=+500百万ドル→500/1e6=0.0005→toFixed(1)=0.0→while(126行)がdec=4まで拡張→\"0.0005兆ドル\"。【軸4連重複の機構】Chart.js自動目盛(例 step2万百万ドル)の非0値0.06〜0.14が全てtoFixed(1)=\"0.1\"に丸まる（拡張ループは結果が厳密0の時のみ発火＝非0丸めは救済されない）。同じ軸で微小目盛だけ\"0.02兆ドル\"と桁が伸びる不揃いも同根。【現行値の要点】pickUnit閾値: 兆=1e6百万(通貨共通・dec1固定)、USD十億=1e3(dec1)、JPY億=100(dec: a>=1e4?0:1)。fmtUnitValueはdec0のとき千区切りMath.round(128行)。unitLabel=suffixそのまま。【チャート別化の設計材料】PL母集合=plSteps(fin)の.val（core常出+hasValueゲート後）、CF母集合=cfWaterfall(fin).maxCfScale（571行・累積水準込み=軸レンジと同義でそのまま最適）、BS母集合=displayNetAssets/non_current_liabilities/current_liabilities/non_current_assets/current_assets（負純資産0化後）またはtotalAssets。単位表示先=#bs-title(1248)/#pl-title(1389)/#cf-title(1396)（card-title右端にspan追加が自然・bs/plタイトル内のdata-term spanはinjectTermHelpが「?」を注入するため既存spanの後ろにappendする）。seamは既に引数渡し（renderBSChart(fin, pageUnit)等）なので、detail.jsで3回pickUnitして渡す案と、healthTrend/fcfTrend同型に各render内で算出する案の両方が小改修＝後者ならdetail.jsのpageUnit state(22行)と656-658を削除できる。【Chart.js軸callbackの引数】現行は(v)=>…だがChart.js v4のticks.callbackは(value, index, ticks)を受ける＝ticks[1].value-ticks[0].valueで目盛間隔が取れる（3箇所とも同形）。【dead code】detail-charts.js:710/995/1108のconst unitStr=FinanceRules.fmtUnit(…)は3関数とも未使用（Batch C以前の遺物）。finance-rules.jsのfmtAxis(90-98)もアプリ内消費者ゼロ（テストのみ）。

## proposal
①チャート別単位: healthTrend/fcfTrend同型で各render内算出に統一する案を推奨。renderPLChart内で `const plMax = Math.max(0, ...DetailRules.plSteps(fin).map(s=>Math.abs(FinanceRules.n(s.val))))` → `const unit = FinanceRules.pickUnit(plMax, STOCK_DATA[currentTicker]?.currency)`（既存の引数pageUnitを廃止）。renderCFChartは `DetailRules.cfWaterfall(fin).maxCfScale` をそのままpickUnitへ。renderBSChartは `FinanceRules.totalAssets(fin)` と5値max（実質totalAssetsが最大）で選定。detail.js側は22行のstate・656-658・789/791/792の第2引数を削除し、665のヘッダspanは削除（or「単位: 各チャート表記」）。単位表示は各カードタイトル `#bs-title`/`#pl-title`/`#cf-title` の末尾に `<span class=\"chart-unit-badge\">単位: 億ドル</span>` を各render冒頭でinsert（idを付け冪等に置換・injectTermHelpのdata-term span注入と共存するため既存childの後ろにappend）。②USD億ドル層: pickUnit(finance-rules.js:104-115)のUSD分岐をJPY鏡像に変更 `if (usd) { if (a >= 100) return { div: 100, suffix: \"億\" + cur, dec: a >= 10000 ? 0 : 1 }; return { div: 1, suffix: \"百万\" + cur, dec: 0 }; }`（十億層を廃し億層へ＝監査の「10.6十億ドル→106億ドル」を実現。兆層1e6は通貨共通で維持）。③軸目盛の動的小数桁: 3箇所の軸callback（detail-charts.js:903/1097/1228）を `callback: (v, i, ticks) => FinanceRules.fmtTickValue(v, unit, ticks)` に変更し、finance-rules.jsへ新関数 `fmtTickValue(val, unit, ticks)` を追加: step=ticks.length>1 ? Math.abs(ticks[1].value-ticks[0].value)/unit.div : Math.abs(val)/unit.div、dec=step>0 ? Math.max(unit.dec, Math.min(4, Math.ceil(-Math.log10(step)))) : unit.dec、v===0は\"0\"、以降fmtUnitValueと同整形（datalabel側は値単体の適応精度が必要なので現行fmtUnitValueを維持＝軸だけ目盛間隔基準で桁を揃え重複と桁不揃いを同時に根絶）。検証はtests/finance-rules.test.jsのUSD系5アサート書換＋fmtTickValue新テスト＋scratchpad/detail-snapshot.js突合＋監査スクショ再現銘柄（BRK-B/JPM/4755.T/8306.T/6506.T対照）。

## risks
- テストピン留めとの衝突: finance-rules.test.js:104(pickUnit USD 416161→十億ドル)・106(500 USD→百万ドル・億層閾値a>=100なら億層に変わる)・119("416.2十億ドル")は書き換え必須。105(兆ドル)・111-117/124-130(JPY)は維持できる設計にする（JPY挙動を触らないこと）
- detail-rules.test.js:74-83のfinancialMaxAbsは15項目一括をピン留め。チャート別化で関数自体を残すか（healthTrend等は独自max算出で非依存＝残しても消費者はdetail.js:656のみ）、削除ならdetail-rules.js:993のexportとテストも同時整理が要る
- USD十億→億層変更は正常表示だった銘柄（監査でOKだったNVDA "153.5十億ドル"等）も全て表示が変わる＝退行でなく意図変更だが、detail-snapshot.js突合は必ず差分が出るためbefore-after比較の期待値更新が必要
- ヘッダ「単位: X」削除はETFの無意味表示（監査ナノ指摘）も同時解消するが、ユーザーが慣れた表示位置の変更＝太田さん実機FBで確認すべきUI判断
- チャート別単位化で同一ページ内にPL=億円/BS=兆円が併存し得る＝カード間の暗黙の読み替えが必要になる。各カードタイトルの単位表示を必ず実装しないと現状より誤読が悪化する（単位分離と表示追加は不可分の1リリースにする）
- cfWaterfall.maxCfScaleは最低1にクランプ(571行)されているが全項目0年(監査パターン3)ではpickUnit(1)=百万単位となり「1百万円」目盛4連問題はチャート別化では直らない＝パターン3(全ゼロFY除外)と独立に扱う
- BS単位の母集合をtotalAssetsのみにすると負純資産で純資産バーが0化される仕様(detail-charts.js:713-715)や負債>資産のデータ不整合時に軸上限と単位がズレる可能性＝5値max（displayNetAssets適用後）を推奨
- 軸callbackのticks引数依存: Chart.jsのcallbackはthis=scaleでticks配列を受けるのはv3+の仕様。CDN版4.5.1固定(C5)なので安全だが、arrow関数のままでよい（this非使用の設計にする）
- datalabelと軸で整形関数が分かれる（fmtUnitValue/fmtTickValue）＝将来の改修で片方だけ直す取りこぼしリスク。finance-rules.jsに並置し相互コメントで縛ること
- detail改修の必須ゲート: scratchpad/detail-snapshot.js capture/compare（CLAUDE.md規律）とnode --test（finance-rules/detail-rules）を通すこと。renderBS/PL/CFのシグネチャ変更(pageUnit引数廃止)はdetail.js:789-792との同時変更が必要で、片方だけ変えるとundefined単位でfmtUnitValueが素通し文字列を返す無言故障になる（fmtUnitValueは!unitでString(v)を返す＝例外が出ない点に注意）

## sites
- detail-rules.js:453 — financialMaxAbs(fin)：453-462。15項目=[FR.totalAssets(fin), net_sales, gross_profit, operating_income, ordinary_income, income_before_taxes, net_income, net_assets, current_liabilities, non_current_liabilities, cf_cash_start, cf_cash_end, operating_cf, investing_cf, financing_cf] の max|abs|。監査記載と完全一致。チャート別化ではこれをPL/CF/BS各集合に分割（または各チャートで個別max算出）
- detail.js:22 — let pageUnit = null（closure私有state宣言）。チャート別化なら不要化候補
- detail.js:656 — const _maxAbs = fin ? DetailRules.financialMaxAbs(fin) : 0;（ETF/財務欠損年はmaxAbs=0→pickUnit(0)=百万円/百万ドル）
- detail.js:657 — pageUnit = FinanceRules.pickUnit(_maxAbs, data.currency);（唯一のページ統一単位算出点）
- detail.js:658 — const unitLabel = FinanceRules.unitLabel(pageUnit);（ヘッダ表示用）
- detail.js:665 — ヘッダ「単位: X」のDOM生成JS：active-company-header.innerHTML 内の <span style="font-size:0.7rem;color:#8ba2af;margin-left:4px;">単位: ${unitLabel}</span>。ETFでも到達し「単位: 百万円」無意味表示（監査ナノ指摘）。チャート別化ではここを削除 or「単位: 各チャート表記」へ
- detail.js:789 — DetailCharts.renderBSChart(fin, pageUnit);（引数渡しseam・772のif(!fin)return後＝非ETF+財務ありのみ到達）
- detail.js:791 — DetailCharts.renderPLChart(fin, pageUnit);
- detail.js:792 — DetailCharts.renderCFChart(fin, pageUnit);
- finance-rules.js:104 — pickUnit(maxAbs, currency)：104-115。a>=1e6→{div:1e6,suffix:兆+cur,dec:1}（通貨共通）／USD: a>=1000→{div:1000,suffix:十億ドル,dec:1}・else {div:1,suffix:百万ドル,dec:0}／JPY: a>=100→{div:100,suffix:億円,dec:a>=10000?0:1}・else百万円。USDに億層なし=十億→兆の1000倍ギャップ（監査記載どおり）
- finance-rules.js:120 — fmtUnitValue(val, unit)：120-130。v===0→"0"、x=v/unit.div、while(parseFloat(x.toFixed(dec))===0 && dec<4)dec++（126行）＝丸め結果が厳密0の値だけ小数桁拡張→500百万ドル/1e6=0.0005→"0.0005兆ドル"。非0に丸まる目盛(0.06〜0.14→"0.1")は拡張されずdec=1のまま＝軸重複の真因
- finance-rules.js:133 — unitLabel(unit)：unit ? unit.suffix : ""（ヘッダ・healthTrend/fcfTrend軸タイトル用）
- finance-rules.js:235 — exports：pickUnit(235)/fmtUnitValue(236)/unitLabel(237)。fmtUnit(250)/fmtAxis(252)も輸出されるがfmtAxisのアプリ内消費者ゼロ（テストのみ・遺物）、fmtUnitはindex.html:2188とdetail-charts.js:710/995/1108（後者3つは未使用dead変数）
- detail-charts.js:885 — BS datalabel formatter：context.dataset.label + "\n" + FinanceRules.fmtUnitValue(value, pageUnit)
- detail-charts.js:903 — BS y軸callback：callback: (v) => FinanceRules.fmtUnitValue(v, pageUnit)（軸重複の修正ポイント1/3）
- detail-charts.js:1069 — PL datalabel formatter：let baseStr = FinanceRules.fmtUnitValue(value, pageUnit);（営業利益/純利益は率2行を追記）
- detail-charts.js:1097 — PL y軸callback：callback: (v) => FinanceRules.fmtUnitValue(v, pageUnit)（修正ポイント2/3・BRK-Bの「0.1兆ドル」4連の現場）
- detail-charts.js:1211 — CF datalabel formatter：cfLabels[idx] + "\n" + sign + FinanceRules.fmtUnitValue(diff, pageUnit)
- detail-charts.js:1228 — CF y軸callback：callback: (v) => FinanceRules.fmtUnitValue(v, pageUnit)（修正ポイント3/3）
- detail-charts.js:709 — renderBSChart(fin, pageUnit)。BS5値=displayNetAssets(742・負純資産は0化)/fin.non_current_liabilities(753)/fin.current_liabilities(764)/fin.non_current_assets(775)/fin.current_assets(786)。710のconst unitStr=FinanceRules.fmtUnit(...)は関数内未使用（dead）
- detail-charts.js:994 — renderPLChart(fin, pageUnit)。項目集合はDetailRules.plSteps(fin)（1007）。995のunitStrもdead
- detail-charts.js:1107 — renderCFChart(fin, pageUnit)。段集合はDetailRules.cfWaterfall(fin)（1156）。1108のunitStrもdead。CF側パネル(1120-1145)はtxt-{ope,inv,fin}-sign/descの符号文言のみ＝金額なし→単位非依存
- detail-rules.js:510 — plSteps(fin)：510-522。6段=当期純利益(core)/税引前(income_before_taxes)/経常(ordinary_income)/営業利益(core)/売上総利益(gross_profit)/売上高(core)・core||hasValueフィルタ。PL単位のmax母集合=この.valたち
- detail-rules.js:552 — cfWaterfall(fin)：552-585。返り値にmaxCfScale(571行=max|期首,累積step1-3,期末,1|)が既にあり＝CF単位選定のmaxAbsにそのまま流用可（累積水準込みで軸レンジと一致）
- index.html:1183 — ヘッダDOM：<div class="active-company-title" id="active-company-header">（detail.js:662がinnerHTML全置換・単位spanの現在の親）
- index.html:1248 — BSカードタイトル：<div class="card-title" id="bs-title">BALANCE SHEET ANALYSIS + data-term span×2（単位表示の設置先候補）
- index.html:1389 — PLカードタイトル：<div class="card-title" id="pl-title">PROFIT & LOSS STATEMENT + data-term span×2
- index.html:1396 — CFカードタイトル：<div class="card-title" id="cf-title">CASH FLOW ANALYSIS（data-termなし）
- detail-charts.js:1261 — 先行実装パターン：renderHealthTrendはチャート内で独自maxAbs(cash/totalLiab)→pickUnit→軸タイトル・凡例ラベルにunitStr表示（1259-1265/1288-1289/1299）＝チャート別単位の同一ファイル内実例
- detail-charts.js:1370 — 同上：renderFCFTrendも独自maxAbs(fcf)→pickUnit→凡例「概算FCF(単位)」（1368-1376）
- tests/finance-rules.test.js:93 — pickUnitピン留め：95-106のdeepEqual 7本。USD3本=104{416161,USD}→{div:1000,suffix:十億ドル,dec:1}・105{1500000,USD}→兆ドル・106{500,USD}→{div:1,suffix:百万ドル,dec:0}。億ドル層追加で104は確実に、閾値次第で106も書き換え
- tests/finance-rules.test.js:109 — fmtUnitValueピン留め：111-119。USD=119 "416.2十億ドル"（億層追加なら"4,162億ドル"等へ書き換え）。JPY=111-117は維持対象
- tests/finance-rules.test.js:122 — dec自動拡張ピン留め：124-130（"0.01兆円"/"-0.01兆円"/"0.3兆円"/"0"/"-0.4億円"/"3億円"）。拡張ループの挙動変更（軸用に別関数化なら不変で済む）
- tests/finance-rules.test.js:133 — unitLabelピン留め：134-136（兆円/億円/null→""）
- tests/detail-rules.test.js:74 — financialMaxAbsピン留め：81-83（15項目max/負絶対値/空→0）。項目分割時はこのテストの扱い（据置or分割関数の新テスト追加）を決める
