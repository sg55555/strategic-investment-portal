# bsCallout（recon実測 2026-08-09・HEAD 143df86・wf_1876fa2c-3ac）

## summary
監査doc観点1のP2/P3/P4/P5/P7のfile:lineを実コードで全数照合し、すべて現行HEAD(143df86)で有効と確認（ズレなし・補足2点のみ: チップの内側paddingは:834-840、監査P7の「プロット幅約180px」はy軸幅≈72px未控除の近似）。anchor 'left'/'right'不正値→バー中心線フォールバックの件は、CDN固定版 chartjs-plugin-datalabels@2.2.0 の非圧縮distを取得して compute$1/positioners.bar/aligned/coordinates をソースレベルで裏取り済み＝監査の記述は正確。幾何は canvasW=vw−560（1024≤vw≤1540）で監査実測（1440→880px/1024→464px）と厳密一致し、バー半幅=chartArea.width/4（1440で≈132px）。提案式 offset=chartArea.width/4+12 は coordinates の式（align'right'時ラベルframe左端=アンカーx+offset）から「バー右端+12px」が padding 値に依存せず常に成立することを確認。ラベルは横逃がし後パディング帯に全載りするため、低棒が居る側のパディングは frame実測最大112.6px+12≈125px 以上が必須（P4案の right:100/left:8 では USD 2行ラベルが欠ける）。

## notes
【監査file:line照合結果】観点1 P2/P3/P4/P5/P7の全参照行（:711/:713-715/:801/:809-812/:818-833/:841-879/:850/:851/:864/:870-879/:875/:876/:881）は現行コードと完全一致（32eb0ae→143df86で対象コード無変更の前提どおり）。補正2点のみ＝①チップの内側padding定義は:834-840（監査の:818-833は背景/縁/borderWidth/borderRadiusまで）②P7「プロット幅約180px」はy軸幅未控除の近似（実プロット幅≈464−280−72≈112px）。

【プラグイン裏取り（推測でなくソース確認済）】読込=CDN jsdelivr、SRI sha384でv2.2.0固定（index.html:46）。ローカルソース無し→非圧縮dist（https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.js）をscratchpadへ取得し確認: (a) compute$1（dist L263-284）は anchor==='start'→(x0,y0)、'end'→(x1,y1)、**それ以外すべて**（'center'も不正値'left'/'right'も同一）→セグメント中点。(b) positioners.bar（L318-340）は縦棒で x0=x1=el.x＝バー中心線（sx=0）、y0=底/y1=頂 ⇒ 不正anchorの実挙動=「バー中心線上のセグメント中点」＝監査の記述どおり。(c) aligned（L141-180）: align'right'→vx=1,vy=0／'left'→vx=-1／**数値を渡すと時計回り角度(度)としても解釈可**（リード線不要の斜め逃がしという設計オプションあり）。(d) coordinates（L840-870）: ラベル中心=アンカー点+frame半幅(w/2)·v+offset·v ⇒ align'right'時 **frame左端=アンカーx+offset が厳密に成立**（frameはboundingRects L358-380でテキスト+チップpadding+border×2込み）。(e) 自動間引きはlayout.update（L968-984）で _hidable=display==='auto' のみ有効→現行display:true(:812)では衝突回避完全無効（監査P5どおり）。(f) ChartDataLabels本体のafterDatasetsDraw（L1304-1306）がlayout.draw→毎フレーム coordinates再計算→state._box.update→label.draw。_boxはHitBox（L748-773）で **_rect={x,y,w,h}の絶対canvas座標**。(g) expando: chart.$datalabels._labels（全ラベル配列・L1090/1298）と **el.$datalabels**（要素ごとのLabel配列・L1257/1278）→P5は `chart.getDatasetMeta(di).data[bi].$datalabels[0].$layout` で `_visible` 確認後 `_box._rect` が最短。監査が使った$layout._box._rectはこの内部API（非公開・v2.2.0 SRI pinで固定なので安定）。

【幾何・現行値】canvasW=vw−40(body:144)−48−2(.card:577/579)−440(.side-panel detail.css:86)−30(gap:60)=vw−560 ⇒ 1440→880px・1024→464px（監査実測と厳密一致・row layoutは@media≥1024のみ、768-1023は縦積みでcanvas=vw−90と逆に広い＝P7の圧殺帯は実質1024〜1200）。chartArea.width=canvasW−100−180−y軸幅（実測逆算≈72px、ticks font13+fmtUnitValue）⇒1440で528→バー半幅=chartArea/4≈132px（監査「半幅≒132px」一致）。現行offset75<132だからバー内、frame幅実測max112.6px（NVDA USD2行）→75+112.6−132≈55px突出＝監査「20-64px」と整合。**offset=chartArea.width/4+12 の幾何検証: バーは各カテゴリ幅いっぱい（catPct=barPct=1.0）なので右列バーの右端=chartArea.right、フォールバックアンカー=バー中心線 ⇒ frame左端=バー右端+12がパディング設定値に依存せず恒等的に成立**（パディングを変えるとchartAreaが縮み半幅も縮むが式が追従）。ラベルはパディング帯に全載りするため、低棒が居る側の予約幅≥frame(≤112.6)+12≈125px が必要条件。チップ高さ≈14px×1.2×2行+padding12+border3≈49px（監査「吹き出し高約50px」一致・P3代替の下パディング根拠）。

【hasLow判定に使える5値（renderBSChartスコープ内変数名）】fin.current_assets／fin.non_current_assets／fin.current_liabilities／fin.non_current_liabilities／displayNetAssets(:715)、分母totalAssets(:712)。列対応: 左列(dataIndex0)={current_assets, non_current_assets}、右列(dataIndex1)={current_liabilities, non_current_liabilities, displayNetAssets}。totalAssets===0（P1全ゼロ年）ではv/totalAssets=NaN→全比較false→center経路＋formatter nullで無害だが、hasLow式はtotalAssets>0ガードを付けること。

【データフロー/ライフサイクル】updateFinancialViews(detail.js:646)→pageUnit算出(:656-657)→ETFガード(:765)→!finガード(:772)→renderBSChart(:789)。呼出契機=navigateToDetail/switchYear。毎回destroy→new Chart(:730-732)なのでoptionsは都度再構築＝isMobileや動的paddingはrender時評価で自然に効く。onWindowResize/repaint(:683-684)はresize()+update('none')のみでoptions再評価なし＝ウィンドウリサイズで768/1024境界をまたいでも次のrender契機まで旧paddingのまま（既存挙動・退行ではない）。Chart.js 4.5.1のlayout.paddingはtoPadding(options.layout.padding)直読み（minified確認）＝スクリプタブル不可→関数でなく値をrender時に計算して渡すこと。datalabelsのanchor/align/offset/背景系はresolve経由＝コールバック可（現行もコールバック）。offsetコールバック内のcontext.chart.chartAreaは_modelize（afterDatasetUpdate中＝layout確定後）に解決されるため利用可だが、neonBarBg(:83-88)と同様のフォールバック（ca未定義なら定数132等）を推奨。

## proposal
【P2+P3+P4+P7一括（:801と:841-879に閉じる）】renderBSChart冒頭（:717付近）で幾何と低棒判定を1回算出:
```js
const LOW = 0.12;
const lowLeft  = totalAssets > 0 && [fin.current_assets, fin.non_current_assets].some(v => v > 0 && v/totalAssets < LOW);
const lowRight = totalAssets > 0 && [fin.current_liabilities, fin.non_current_liabilities, displayNetAssets].some(v => v > 0 && v/totalAssets < LOW);
const hostW = document.getElementById("bsChart").parentElement.clientWidth || 880; // :1254のwidth:100% div・ETF→株式切替でも:756-760の表示復帰が同期ブロック先行で>0
const CALLOUT_PAD = Math.min(140, Math.max(126, Math.round(hostW * 0.16))); // frame実測max112.6+gap12+余裕（P7の幅比例をここに内包）
```
:801 → `layout: { padding: isMobile ? {left:4,right:4,top:10,bottom:4} : { left: lowLeft ? CALLOUT_PAD : 8, right: lowRight ? CALLOUT_PAD : 16, top: 65, bottom: 20 } }`（モバイルarm不変・P4のデッドスペース解消とP7の圧殺解消を同時に満たす。低棒無し銘柄はleft8/right16でプロット幅+約250px）。
anchor(:841-854) → 低棒分岐を全廃し `return "center";` に統一（:851の不正値も:850の'start'も廃止。フォールバック挙動＝center と同一なので視覚回帰ゼロでコードが正直になる）。
align(:855-868) → 低棒(<LOW)は全科目 `return context.dataIndex === 0 ? "left" : "right";`（P3=純資産:864の'bottom'廃止・流動系:862-863の'top'も横統一するかは選択。横統一なら上空浮遊(P5の一因)も同時に消える。縦位置はアンカー=セグメント中点なので科目ごとに自然分離）。
offset(:870-879) → `if (totalAssets > 0 && val > 0 && val/totalAssets < LOW) { const ca = context.chart.chartArea; return (ca ? ca.width/4 : 132) + 12; } return 0;`（frame左端=バー外+12pxが恒等成立・検証済）。
【P5リード線】detail-charts.js:128直後に新プラグイン登録（登録順=ChartDataLabels(index.html:1602)→neonGlow(:128)→bsLeader → afterDatasetsDrawがラベル描画・_box更新後に走る）:
```js
const bsLeaderPlugin = { id: "bsLeader", afterDatasetsDraw(chart) {
  const specs = chart.$bsLeaders; if (!specs) return;   // renderBSChartが:909同様に [{di, bi}] を設定（低棒のみ）
  const c = chart.ctx; c.save();
  specs.forEach(({di, bi}) => {
    const el = chart.getDatasetMeta(di).data[bi]; if (!el) return;
    const lab = (el.$datalabels || [])[0]; if (!lab || !lab.$layout || !lab.$layout._visible) return;
    const r = lab.$layout._box._rect;                    // 絶対座標frame（datalabels内部API・v2.2.0 SRI pin前提）
    const p = el.getProps(["x", "y", "base"]);          // live値（final=true不可: アニメ中ラベルはlive el追従のため）
    const segY = (p.y + p.base) / 2;
    const fromX = r.x + r.w / 2 < p.x ? r.x + r.w : r.x; // チップのセグメント側縁
    c.strokeStyle = "rgba(0,229,255,0.55)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(fromX, r.y + r.h / 2); c.lineTo(p.x, segY); c.stroke();
  });
  c.restore();
} };
Chart.register(bsLeaderPlugin);
```
renderBSChart側: `bsChartInstance.$bsLeaders = lowIndices;`（:909の$neonSpecs直後・datasets順は:739-795の固定順なのでdi=0純資産…4流動資産、biは低棒の列）。他チャートは$bsLeaders未設定でno-op（neonGlowと同じgate方式）。
【非影響確認】モバイル(<768): :809-811の0.15表示ゲートで低棒ラベル自体が非表示→<LOW分岐は不到達、表示ラベル(≥15%)はcenter/center/0経路のみ＝上記変更で不変（paddingのモバイルarmを触らないこと）。ETF: detail.js:765 returnでrenderBSChart不到達。財務欠損年: :772 return。検証はscratchpad/detail-snapshot.js突合＋監査該当銘柄（6758.T/7974.T/4519.T=P2、8306.T/4755.T=P3、7203.T=P4、1024px幅=P7、SPY=ETF非影響）の再撮影。

## risks
- P4監査案の right:hasLow?100:16 / left:8 は不足: 横逃がし後のラベルはパディング帯に全載りし、frame実測最大112.6px(USD2行・NVDA)+gap12≈125px必要。左列に低棒(固定資産<12%: 6758.T等)がある銘柄でleft:8だとラベルほぼ全欠け。低棒の居る側だけ≥126px確保するside-aware動的化が必須
- $layout._box._rect / el.$datalabels / chart.$datalabels はdatalabels非公開内部API。SRI pin(index.html:46)でv2.2.0固定の間は安定だが、プラグイン更新時にP5リード線が無言で消える（gateがno-opになるだけでエラーは出ない）。バージョン更新時の再確認をspecに明記すべき
- anchor:851の'left'/'right'→'center'化は単独では視覚不変（フォールバック=center挙動と同一）だが、offset式の変更とセットにしないと現行の「たまたまバー上に載って読める」状態が変わらない＝P2は:851と:870-879を必ず同時に変える
- 同一列に低棒が2つ(4755.T=流動負債+純資産、6954.T等)あると横逃がし統一でチップ(高さ≈49px)が縦に近接・重複し得る。display:trueのため自動間引きは無効(ソースで確認: _hidable=display:'auto'のみ)。セグメント中点の縦距離<50px時のstagger(offsetのY成分は無いのでalign角度数値指定か、リード線前提で縦ずらし)をspecで決める必要
- layout.paddingはChart.js 4.5.1でtoPadding直読み＝関数を渡すと壊れる（minifiedで確認）。動的paddingは必ずrender時に数値化して渡す。またリサイズで768/1024境界をまたいでも次のrender(年切替/銘柄切替)までpadding/isMobileは再評価されない＝既存挙動と同じだが、幅比例式を入れると「リサイズ後だけ比率が古い」状態が新たに目視され得る（onWindowResizeからのre-render追加は別判断）
- リード線のセグメント座標をneonGlowPlugin同様getProps(...,true)（final値）で取るとアニメ1500ms中(:802-805)にラベル(live el追従)と線がズレる。live値(getProps(props)のfinal無し)で統一すること
- P3を横逃がし統一すると銀行系で純資産チップが右パディング帯の下方に来る＝X軸ラベル「調達源泉」帯(bottom:20)との干渉は解消するが、canvas下端に近い低セグメント(純資産が最下段)ではチップ下半分がcanvas外に出る可能性が残る（セグメント中点が低すぎる場合）。チップ中心Yをmax(chartArea.top+r.h/2, min(segY, chartArea.bottom−r.h/2))へクランプする追加式を検討（datalabelsに縦クランプは無い＝offsetでは表現不可、リード線があれば多少の縦ズレは帰属明示できる）
- hasLow判定はtotalAssets===0（P1全ゼロ年）でNaN比較になるためtotalAssets>0ガード必須（現行anchor/align/offsetも同穴だがfalse評価+formatter nullで偶然無害）。P1修正（全ゼロ年スキップ）が先に入ればこの経路自体が消える＝実施順は監査どおりP1先行が安全
- 検証ハーネス制約: scratchpad/detail-snapshot.jsのbefore-after突合はDOM/寸法/canvasCountでcanvas描画内容までは比較しない。吹き出し位置の回帰はPlaywright再撮影+$datalabels._box._rect数値比較（監査と同手法）をspecの受入条件に含めるべき
- 監査docとの軽微なズレ2点（誤りではなく精度）: チップ内側paddingの定義行は:834-840（:818-833表記の続き）／P7の「プロット幅約180px」はy軸幅≈72px未控除で実際は≈112px＝圧殺はより深刻

## sites
- detail-charts.js:709 — renderBSChart(fin, pageUnit) 開始（〜910行）。修正④⑤の主対象関数。pageUnitは引数で受ける（detail.js closure私有）
- detail-charts.js:711 — const isMobile = window.innerWidth < 768（二値判定・render時に1回評価。P7の中間幅問題の根）
- detail-charts.js:712 — const totalAssets = FinanceRules.totalAssets(fin)＝current_assets+non_current_assets（欠損0・finance-rules.js:24-27）。低棒判定の分母
- detail-charts.js:713 — hasNegativeEquity = fin.net_assets < 0、:715 displayNetAssets = 負なら0（P6と連動・hasLow判定5値の一つはこのdisplayNetAssetsを使う）
- detail-charts.js:737 — labels: ["運用形態","調達源泉"]＝2カテゴリ構成。dataIndex 0=資産列/1=調達列
- detail-charts.js:739 — datasets 5本（〜795）: 純資産[0,displayNetAssets]/固定負債[0,v]/流動負債[0,v]/固定資産[v,0]/流動資産[v,0]・全て stack:"Stack0"・categoryPercentage:1.0・barPercentage:1.0＝バー幅=chartArea.width/2、半幅=width/4
- detail-charts.js:801 — layout.padding: isMobile ? {left:4,right:4,top:10,bottom:4} : {left:100,right:180,top:65,bottom:20}。P4/P7/P3(bottom:20不足)の変更点＝唯一のパディング定義
- detail-charts.js:802 — animation: duration 1500ms easeOutQuart（〜805）。P5リード線はアニメ中の座標同期に関わる
- detail-charts.js:809 — datalabels.display（〜812）: モバイル=val>0 && val/totalAssets>=0.15（15%ゲート）/ デスクトップ=true（固定true→datalabelsの自動間引き_hidableが無効＝P5監査の裏取り済）
- detail-charts.js:813 — clamp:true＝アンカー点のみchartAreaへクリップ（ソースcompute$1で確認・ラベル箱はクランプされない→P3の下端11pxはみ出しの機構）
- detail-charts.js:818 — 吹き出し風チップ: backgroundColor(818-822 <12%→#0a0f17)/borderColor(823-827 →#00e5ff)/borderWidth(828-832 →1.5)/borderRadius:6(833)/チップ内padding(834-840 <12%→{top:6,bottom:6,left:10,right:10})※監査:818-833表記の+α
- detail-charts.js:841 — anchorコールバック（〜854）: :844 val=0→'center'、:849 流動資産/流動負債→'end'、:850 純資産→'start'、:851 return context.dataIndex===0?'left':'right'＝不正値（有効はstart/center/end）
- detail-charts.js:855 — alignコールバック（〜868）: :862-863 流動系→'top'、:864 純資産→'bottom'（P3変更点）、:865 固定負債→'right'、:866 固定資産→'left'
- detail-charts.js:870 — offsetコールバック（〜879）: :875 固定資産/固定負債→75、:876 その他low→15、:878 それ以外0。P2の主変更点（chartArea.width/4+12へ）
- detail-charts.js:881 — formatter: if(value===0) return null（無ラベル化・銀行の欠損0値とdataIndex反対列の0を正しく非表示化）。:883-886 label+改行+FinanceRules.fmtUnitValue(value,pageUnit)の2行ラベル
- detail-charts.js:909 — bsChartInstance.$neonSpecs = [...] ＝new Chart直後にexpandoを付ける先行例。P5の chart.$bsLeaders 登録はこの直後が同型
- detail-charts.js:104 — neonGlowPlugin定義（〜127）: beforeDatasetsDraw=$lineGlow用save/shadow設定 or $neonSpecsバーbloom（:113-115 bar.getProps(["x","y","base","width"],true)でセグメント矩形取得＝P5のセグメント中心取得の雛形）。afterDatasetsDrawは$lineGlowのrestoreのみ＝BS($neonSpecs)ではno-op
- detail-charts.js:128 — Chart.register(neonGlowPlugin)。ChartDataLabels登録(index.html:1602)の後に実行される（detail-charts.jsはindex.html:2584で読込）＝フック発火順は登録順。P5リード線プラグインもこの直後にregisterすればdatalabelsのラベル描画後にafterDatasetsDrawが走る
- index.html:46 — chartjs-plugin-datalabels@2.2.0 CDN読込（jsdelivr・SRI sha384 pin・crossorigin）。:45はchart.js@4.5.1同形式。ローカルにソース無し（node_modulesに当該pkg不在）→CDN distで裏取り実施
- index.html:1602 — Chart.register(ChartDataLabels)（inline script内・detail-charts.jsより先に実行）
- index.html:1255 — <canvas id="bsChart">。親=width:100%/height:100%のdiv(:1254)→.chart-main-area(:1250)→.grid-layout(:1249)→.card(:1247)。renderBSChart冒頭の幅実測は canvas.parentElement.clientWidth が最短
- index.html:144 — body padding:20px。:146-147 .container max-width:1500px。:574-577 .card padding:24px+border1px ⇒ canvasW=vw−560（1024≤vw≤1540・row layout時）＝1440→880px/1024→464px（監査実測と一致）
- detail.css:57 — .grid-layout: flex column gap:30px(:60)。:64-69 @media(min-width:1024px)でrow化。:71-76 .chart-main-area flex:1 height:530px min-width:320px。:84-88 .side-panel width:440px(≥1024)
- detail.css:453 — @media(max-width:480px) .chart-main-area{height:280px}（P8の乖離指摘の基準値・:415は768px→320px）。モバイル経路のCSSはP2-P7変更で非接触
- detail.js:755 — const isEtf = data.type==="etf"。:756-760 finCards（"bs-title"含む8枚）を.closest(".card")でdisplay none。:765-768 if(isEtf)return＝ETFはrenderBSChart不到達（非影響を確認）
- detail.js:772 — if(!fin) return＝財務欠損年もrenderBSChart不到達。:789 DetailCharts.renderBSChart(fin, pageUnit)呼出（年切替switchYear/navigateごとに:730-732でdestroy→new Chart）
