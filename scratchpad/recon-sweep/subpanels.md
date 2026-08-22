# subpanels（recon実測 2026-08-21・HEAD 8e44298）

## summary
C1〜C4 は全て現HEADでも未修正のまま有効（直近wave spec §12 で「サブパネル形状は本wave非対象」と明記・§14 backlogに残置）。ただし監査の file:line は 32eb0ae→8e44298 の4 commit（f306028/5b5e024/280b353/6fcdf8f）で約+19行シフト済＝全参照の張り替えが必要。C1 は監査記載の3本に加え RSI 50線・MACD/OBV 0線も axisLabelVisible 既定true で「50.00」「0.00」軸ラベルを出しており修正対象を5→7本に拡張すべき。C4 は「最下段のみ時間軸ON」を detail-charts.js 側の新関数 `_updateSubTimeAxes()`（mount/unmount 双方から呼ぶ・DOM順は _subMounted[k].host.compareDocumentPosition で判定）で実装でき、展開状態は detail.js `_accItems[].expanded` を読まず chart側 `_subMounted`（=mounted が展開の真実）だけで足りる。軸幅揃えは「OBV priceFormat:volume ＋ subBaseOpts に rightPriceScale.minimumWidth（lightweight-charts 4.2.3 は v4.1+ の minimumWidth 対応）」の併用を推奨。全体工数=半日（C1/C3極小・C2小・C4小）。

## notes
■ 前提変化（監査 HEAD 32eb0ae → 現 8e44298）
- detail-charts.js は4 commit で変更（f306028 単位バッジ/5b5e024 S/R窓統一+A-mini/280b353・6fcdf8f BS吹き出し）。サブパネル節（buildRSI〜ensureSubSync）は**ロジック不変・行番号のみ約+19シフト**。32eb0ae の buildOBV と現物を git show で突合し完全同一を確認（OBV の「表示窓先頭を0に再アンカー」は監査時点で既にあった＝監査の『生値2桁小数・軸幅~115px』は再アンカー後も窓内純増減が±数千万規模のため成立し続ける）。
- 直近wave（2026-08-20-theme-a-chart-fixes-design.md）§12:288「サブパネル形状: 本wave非対象」・§14:311 backlog に「サブパネル二重ラベル・OBV生値軸・時間軸位置」残置＝**C1-C4 は意図的未修正**。
- 同wave で監査A（S/R軸ラベル渋滞）の A-mini は実装済（detail-charts.js:247-255・axisLabelVisible: i<2）＝サブパネルとは別項目だが「axisLabelVisible を絞る」同型パターンの先行実装として参照可。
- アコーディオンUI（detail.js Task8・SOFT_CAP=2・既定 adx+atr 展開）は監査**以前**から存在（330e02f は 32eb0ae の祖先と ancestry 確認済）＝監査の「5枚全展開」検証条件は現HEADでも再現可能。
- data/investment.db は main 実DBへ symlink 済を確認したが、schema 実査で financial_data_v2/financial_data に**価格・出来高カラムは無い**（OHLCV は mock_prod_server.py が ticker sha256 で決定論合成／本番は api 経由）＝C2 の値域は DB でなく合成/実APIの volume 累計（1e7〜1e8 オーダー）で監査実測どおり。DB での SELECT 実測は本項目には寄与しないため省略。

■ C1: 基準線の「タイトル+軸ラベル」二重表示 — 有効・対象拡張
- lightweight-charts v4 の PriceLineOptions.axisLabelVisible 既定は true。現物:
  - RSI 70: detail-charts.js:287（title:"70"・axisLabelVisible未指定=true→「70」+「70.00」）
  - RSI 50: :288（title無し・未指定=true→軸に「50.00」が出る。監査は未記載だが同根）
  - RSI 30: :289（title:"30"・未指定=true）
  - MACD 0線: :309（title無し・未指定=true→「0.00」軸ラベル。監査未記載・同根）
  - ADX 25: :335（**明示 axisLabelVisible:true**・title:"25"）
  - ATR 中央値: :363（**明示 axisLabelVisible:true**・title:"中央 x.x%" ＋ series の lastValueVisible:true バッジで3連渋滞）
  - OBV 0線: :372（title無し・未指定=true→「0.00」軸ラベル。監査未記載・同根）
- 監査の修正方針（axisLabelVisible:false でタイトルのみ残す）は今も有効。対象を上記7本に拡張するのが正。

■ C2: OBV軸が生値2桁小数で軸幅~115px — 有効
- buildOBV=detail-charts.js:367-383（監査の :348-353 から+19）。addLineSeries（:368-371）に priceFormat 無し→既定 {type:'price', precision:2}。再アンカー後も値は±数千万で「-58416942.00」級。
- メイン出来高ヒストグラムは既に priceFormat:{type:'volume'} を使用（detail-charts.js:631）＝コードベース内に前例あり。volume型は 58.42M / -12.3M 形式で負値も可。
- 軸幅揃え: subBaseOpts（:267-274）の rightPriceScale（:270）に minimumWidth を足せる（v4.1で追加・本番は 4.2.3 を index.html:44 でCDNロード＝利用可）。比較は proposal 参照。

■ C3: 小型パネル上下端ティック半クリップ — 有効
- scaleMargins {top:0.1, bottom:0.1} は subBaseOpts の :270（監査の :251 から+19）。高さは SUBPANEL_REGISTRY :385-389（rsi 100/macd 110/adx 132/atr 104/obv 104）。
- **監査後の新事実**: 高さが detail.js SUBPANEL_META :291-295 にも重複定義されている（host のCSS高さを chart生成前に確保するため必須と :288-289 コメント明記）＝「高さ+16px」案を採る場合は**両ファイルのミラー修正必須**。margins拡大案（:270 の1行）なら片側のみで済む。

■ C4: 時間軸がMACDのみ固定ON — 有効・実装点を具体化
- 現実装: SUBPANEL_REGISTRY の timeAxis フラグ（:385-389・macdのみtrue）→ mountSubpanel の createChart で timeScale:{visible: def.timeAxis}（:406）に静的反映。以後変更なし＝展開順によりMACDが中段でも軸持ち・最下段（OBV等）に軸無し。
- 生成/破棄/積み順の現実装:
  - mount: mountSubpanel :396-417（0x0罠回避で rAF 待ち→createChart :405-407→def.build→_subMounted[key] 登録 :409→_subOrder push :410→ensureSubSync→setData→range同期）。
  - unmount: unmountSubpanel :418-425（chart.remove→delete _subMounted[key]→_subOrder splice）。
  - 積み順（DOM）: detail.js addSubpanelItem :350-404 が .acc-item を #subpanel-accordion 末尾へ append（:379-380）・removeSubpanelItem :405-413 で wrap.remove()＝**DOM順=追加順（再追加は末尾）**。一方 chart側 _subOrder は**mount順**（畳む→開くで並びが変わる）＝**最下段判定に _subOrder は使えない**。DOM順判定が必須。
  - 展開状態: detail.js _accItems[key].expanded（:298 宣言・expandSubpanel :325 / collapseSubpanel :337 で更新）。ただし collapse は必ず unmountSubpanel を呼ぶ（:340）ので、**chart側では「_subMounted に居る=展開中」が常に成立**＝detail.js の状態を跨いで読む必要なし。
  - 呼び出し経路: expandSubpanel :322-333（host display/height 設定 :330-331→mount :332）／collapseSubpanel :334-343／removeSubpanelItem :408／初期は initSubpanelUI :444-445 で adx+atr。
- 高さの含み: MACD の 110px は時間軸(~28px)込みでペイン~82px、他は全高ペイン＝動的切替を入れると「最下段になったパネルのペインが28px縮む」問題が出る。高さ補償の要否は proposal で両案比較。

## proposal
実装順は C1→C3→C2→C4（依存なし・検証は1束で Playwright ハーネス1回）。

### C1（極小・7行編集）
detail-charts.js の7本の createPriceLine に axisLabelVisible:false を統一付与:
- :287/:288/:289（RSI 70/50/30）・:309（MACD 0）・:335（ADX 25=trueをfalseへ）・:363（ATR中央=trueをfalseへ）・:372（OBV 0）。
- title は現状維持（70/30/25/中央x.x%）。ATR は series lastValueVisible:true バッジのみ軸に残る＝渋滞解消。

### C3（極小・1行）
- :270 subBaseOpts.rightPriceScale.scaleMargins を {top:0.16, bottom:0.16} へ（100pxパネルで上下16px＝ティックラベル高~11pxを収容）。
- 高さ+16px 案は SUBPANEL_REGISTRY :385-389 と detail.js SUBPANEL_META :291-295 の**二重ミラー修正**が要るため次点（margins で不足が実測されたときのフォールバック）。

### C2（小・1-2行＋軸幅揃え）
- buildOBV :368-371 の addLineSeries に `priceFormat: { type: "volume" }` を追加（:631 の前例と同型・±58.4M 形式）。
- 軸幅揃えの比較:
  | 案 | 変更 | 効果 | 残差/リスク |
  |---|---|---|---|
  | X フォーマッタ桁揃え | OBV volume化＋（任意）RSI/ADX/ATRに precision:1 | 115px→~60px・横ズレほぼ解消 | パネル間±数px・メイン価格軸との差は残る。工数極小 |
  | Y minimumWidth固定 | :270 rightPriceScale に `minimumWidth: 72` を追加（メイン :609 rightPriceScale にも同値） | 自然幅≤72の限りサブ間で完全一致 | 高価格銘柄でメイン軸が72超→メインとサブの残差。全チャートで軸が数px太る |
  | Z 動的同期 | refreshSubpanels :428-432 の末尾で `priceChart.priceScale("right").width()` を読み全サブへ applyOptions({rightPriceScale:{minimumWidth:w}}) | メイン含め完全整列 | applyOptions→再レイアウトの往復（min≥自然幅なら1回で収束）。工数小 |
- 推奨=X+Y の静的併用（決定論・再レイアウト無し）。Z は完全整列が要求されたときの追加段。

### C4（小・新関数~20行＋呼び出し2箇所＋registry整理）
1) :406 の createChart を常に `timeScale: { ..., visible: false }` で生成し、SUBPANEL_REGISTRY :385-389 の timeAxis フラグを削除（macd の特別扱い廃止）。
2) detail-charts.js に新関数 `_updateSubTimeAxes()` を追加（unmountSubpanel :425 の直後が置き場所）:
```js
const TIME_AXIS_H = 28;   // lightweight-charts 時間軸の実測高（ハーネスで確定）
function _updateSubTimeAxes() {
  const keys = Object.keys(_subMounted).filter((k) => _subMounted[k]);
  if (!keys.length) return;
  keys.sort((a, b) => (_subMounted[a].host.compareDocumentPosition(_subMounted[b].host)
      & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);   // DOM順（#subpanel-accordion の積み順）
  const bottom = keys[keys.length - 1];
  for (const k of keys) {
    const m = _subMounted[k], on = (k === bottom);
    if (m.axisOn === on) continue;                      // 冪等
    m.axisOn = on;
    m.chart.applyOptions({ timeScale: { visible: on } });
    const h = m.height + (on ? TIME_AXIS_H : 0);        // 高さ補償（案b）
    m.host.style.height = h + "px";
    m.chart.resize(m.host.clientWidth, h);
  }
}
```
3) 呼び出し点: mountSubpanel の create() 内・_subOrder push（:410）の後（rAF完了後=登録済みの地点。rAF前だと _subMounted 未登録で判定から漏れる）／unmountSubpanel の splice（:424）の後。collapse/remove/すべて畳む は全て unmountSubpanel 経由（detail.js :340/:408）なので他の呼び出し点は不要。
4) resizeSubpanels :436 の `m.chart.resize(m.host.clientWidth, m.height)` を `m.height + (m.axisOn ? TIME_AXIS_H : 0)` に修正（リサイズで軸分が失われるのを防止）。
5) 高さ補償の両案: (a)補償なし=chart高さ固定・最下段ペインが28px縮む（変更は1)-3)のみ・detail.js 非接触・極小）／(b)補償あり=上記コード（ペイン高一定・アコーディオン高さが切替で±28px動く）。**推奨=(b)**（ATR 104px→ペイン76pxは窮屈すぎる）。(b)でも detail.js 側は非接触で成立（expandSubpanel :331 が base 高を設定→mount後に _updateSubTimeAxes が上書き。collapse :342 は 0 に戻すので整合）。
6) MACD の登録高 110（時間軸込みで設計された値）は base=104 に正規化し、detail.js SUBPANEL_META :292 の 110 も 104 へミラー（二重定義のため両方必須）。

### 検証
テスト無し領域（tests/ にサブパネル関連 0 件）＝Playwright ハーネス（scratchpad/recon-uiux/harness.md の手順・mock鯖 PLAN2_PORT + NODE_PATH=/home/shugo/node_modules）で「5枚全展開→中段畳む→再展開→最下段を外す」を回し、①時間軸が常に最下段のみ ②全サブパネル priceScale('right').width() 一致 ③軸ラベル二重の消滅 ④上下端ティック非クリップ を DOM/スクショで数値アサート。detail-snapshot.js は canvasCount/windowApi/pageErrors 不変ゲート＋再baseline運用。

## risks
- **mount の rAF 遅延との競合**: expand→即collapse すると create() が pending のまま host が display:none になり clientWidth=0 で30フレーム後に静かに諦める。再expand で2本目の create ループが走り、旧ループも復活すると二重 createChart（1個リーク）の**既存潜在バグ**があり、C4 の呼び出し点を create() 内に置く分この経路を踏む頻度は変えないが、修正時に create に世代トークン（もしくは host.dataset ガード）を足す小改修を同梱推奨。
- TIME_AXIS_H=28 は目安（フォント/デバイス依存）。ハーネスで `chart.timeScale().height()` 実測して確定させること。ズレると最下段ペインだけ数px 不揃いになる（機能破壊はしない）。
- 高さ補償(b)は切替時にアコーディオン全体の高さが±28px 動く＝レイアウトシフト。許容できなければ(a)へ退避（1行の差）。
- minimumWidth はメインチャート（:609 rightPriceScale）にも入れないと「サブ間は揃うがメインとズレ」が残る。メインは価格帯で自然幅が72を超える銘柄があり得る＝完全整列は案Zまで行かないと保証されない（推奨はX+Yで妥協点を明記して着地）。
- C1 で RSI 50線・MACD/OBV 0線の軸ラベル(50.00/0.00)も消える＝目盛りとしての情報が僅かに減る。線自体（破線）は残るため実害は無い想定だが、受入時に太田さん実機で違和感確認。
- 高さ・timeAxis の registry 変更は detail.js SUBPANEL_META（:291-295）との**二重定義ミラー**を忘れると 0x0罠 or 高さ不一致（chart が host からはみ出す/余白）になる。監査時点にはこの結合の明記が無い＝spec に必須注記。
- 監査 file:line は全シフト済＝監査docをそのまま実装指示に使うと旧行番号（:268-270/:316/:344/:348-353/:365-371/:251）で誤編集する。spec には本ファイルの現行番号を正として書くこと。

## sites
- detail-charts.js:267-274 — subBaseOpts（全サブパネル共通オプション・:270 に scaleMargins 0.1 と rightPriceScale=C3/軸幅揃えの変更点）
- detail-charts.js:287-289 — RSI 70/50/30 の createPriceLine（C1・axisLabelVisible 未指定=true）
- detail-charts.js:309 — MACD 0線 priceLine（C1 追加対象・「0.00」軸ラベル）
- detail-charts.js:335 — ADX 25線（C1・明示 axisLabelVisible:true）
- detail-charts.js:363 — ATR 中央値線（C1・明示 true＋lastValueVisible バッジで3連渋滞）
- detail-charts.js:367-383 — buildOBV（C2・:368-371 addLineSeries に priceFormat 無し・:372 0線・:379-381 窓先頭0再アンカーは監査時点から存在）
- detail-charts.js:384-390 — SUBPANEL_REGISTRY（高さ・timeAxis フラグ=C4 で廃止対象・macd のみ true :386）
- detail-charts.js:391-393 — _subMounted/_subOrder/_subSyncBound（_subOrder は mount順=最下段判定に不適・DOM順判定が必要）
- detail-charts.js:396-417 — mountSubpanel（rAF create・:406 timeScale visible 静的設定=C4 変更点・:410 _subOrder push 直後が _updateSubTimeAxes 呼び出し点）
- detail-charts.js:418-425 — unmountSubpanel（:424 splice 直後が第2の呼び出し点）
- detail-charts.js:428-432 — refreshSubpanels（案Z 動的軸幅同期の実装点）
- detail-charts.js:433-438 — resizeSubpanels（:436 高さ補償の反映が必要）
- detail-charts.js:439-446 — ensureSubSync（メイン→サブの range 同期・C4 と独立で変更不要）
- detail-charts.js:631 — メイン出来高の priceFormat:{type:'volume'}（C2 の同型前例）
- detail-charts.js:608-614 — メインチャート timeScale/rightPriceScale（軸幅揃え案Y でメイン側 minimumWidth を足す位置）
- detail-charts.js:247-255 — S/R A-mini（直近wave実装済・axisLabelVisible i<2 の同型先行例）
- detail.js:290-296 — SUBPANEL_META（高さの二重定義・C3/C4 でミラー必須）
- detail.js:298 — _accItems（expanded 状態・chart側は _subMounted で代替可＝跨ぎ読み不要）
- detail.js:322-333 — expandSubpanel（:330-331 host display/height→:332 mount）
- detail.js:334-343 — collapseSubpanel（:340 unmount 経由＝C4 は unmountSubpanel 内のフックで網羅）
- detail.js:350-404 — addSubpanelItem（:379-380 accordion 末尾 append=DOM積み順の根拠）
- detail.js:405-413 — removeSubpanelItem（:408 unmount）
- detail.js:415-448 — initSubpanelUI（:444-445 既定 adx+atr 展開）
- index.html:44 — lightweight-charts 4.2.3 CDN（minimumWidth=v4.1+ 利用可の根拠）
- index.html:1243-1249 — subpanel-bar/chips/accordion の DOM
- docs/superpowers/audits/2026-08-09-chart-callout-audit.md:152-156 — 監査C1-C4 原文（旧行番号）
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:288,311 — サブパネル非対象宣言と backlog 残置
