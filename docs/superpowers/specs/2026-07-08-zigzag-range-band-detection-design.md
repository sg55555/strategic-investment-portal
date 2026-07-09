# ZigZag レンジ帯検出改善 — 設計 (spec)

- **date**: 2026-07-08
- **project**: investment-portal（詳細ビュー チャート／規律テクニカル）
- **owner note**: Obsidian `Projects/investment-portal.md`
- **関連**: 束C③（規律テクニカル ADX/ATR・`disciplineDigest`/`renderDisciplineCard`）／次テクニカル（Keltner/OBV/VWAP）
- **effort/mode**: xhigh ＋ ultracode（spec 敵対検証 wf → plan → SDD 実装）

## §0 目的
詳細ビューの ZigZag T/R 線を改善し、**複数ピボットにまたがる横ばい帯（consolidation）を1つの水平バンド（支持帯/抵抗帯）として検出・描画**する。芯は本アプリ一貫の**規律・教育**（no-score・中立語・免責 fail-closed）＝「今は横ばい帯か／トレンドか」を落ち着いて読ませる。

## §1 現状と根因
- 現状 `detail-charts.js drawTRLines`（426-483）は `calcZigZag` のピボット列を取り、**連続ピボット対（セグメント）を1つずつ独立判定**：`|変化率|≥3%`→斜めトレンド線／`<3%`→その区間内だけの水平 hi/lo（amber）。
- `detail-rules.js signalDigest`『ZigZag区間』行（675-688）も**末尾2確定ピボットの単区間**でトレンド/レンジを判定。
- **根因**：横ばい帯は本来「複数ピボットにまたがり、高値群が抵抗帯・安値群が支持帯で往復」する。だが単区間判定では、往復の各スイングが3%を超えると**小さな斜めトレンド線が上下にギザギザ並ぶ**だけで、1つの帯として認識されない（モック `scratchpad/zigzag-range-mock.html` の「現状」パネルで再現＝11本の斜め線／新方式＝2帯に集約を確認済）。
- **方針の裏取り**：プロジェクト CLAUDE.md「ローソク足カラー」節（2026-07-01 全面解除）で「ZigZag のレンジ検出ロジック」は明示的に改善対象。唯一の技術制約は `display:none→createChart 0x0罠` 回避のみ。ZigZag 逆規約（up=緑 teal/down=赤 pink）の**上下の意味は不変**。

## §2 スコープ（本人確定）
検出方式＝**ピボット後処理で帯化**（既存 `calcZigZag` は不変、後段で束ねる純関数を追加）。3出力すべて＝**フルスコープ**：
1. **チャート描画**（`drawTRLines`）：レンジ帯を支持/抵抗の水平線＋**淡いグロー帯**（案B）で全区間に1帯として描画。
2. **signalDigest『ZigZag区間』行**：末尾セグメントで「直近は横ばい帯（帯幅X%・N点接触）」or「直近はトレンド区間（+X%）」。
3. **規律ミニカード**：既存 `disciplineDigest`/`renderDisciplineCard` を**拡張**（新カードを増やさず「レンジ」チップ追加）。

見せ方＝**案B（線＋淡いグロー帯）**。厳しさ＝**既定（自動適応・近接許容≈2.5-2.8%・各サイド2タッチ・トレンド3%）**。
- **非スコープ**：S/R 検出（`detectSR`）との統合・ADX レジーム併用（補助注記に留め、本改修では未使用）・ローソク確定色/ZigZag逆規約の意味変更・スクリーナー統合。

## §3 検出アルゴリズム（純関数 `zigzagSegments`）
`detail-rules.js` に純関数を追加（DOM 非依存・`detectSR`/`disciplineDigest` と同型・**単一源**＝描画層/digest 双方がこれを消費）。

```
zigzagSegments(prices, pivots, opts?) -> Segment[]
```
- `prices`：OHLC 配列（`{time,open,high,low,close}`）。`pivots`：`calcZigZag(prices, deviation)` の出力 `[{idx,value,type:'high'|'low'}]`。
- `opts`（省略時は既定）：`trendPct=0.03`、`minTouches=2`、`clusterTol=autoClusterTol(prices)`。
- **`autoClusterTol(prices)`**（新・`autoZigZagDeviation` と同思想）＝`clamp(autoZigZagDeviation(prices) * 0.5, 0.02, 0.045)`。**帯の高値/安値のばらつき許容はスイング幅（≈deviation）の半分**＝トレンド（連続して切り上がる高値）を誤って帯化しないための下限保証。
- **アルゴリズム**（左から貪欲・最大 run）：
  1. `i=0` から走査。位置 `i` から `k=i+(2*minTouches-1)` 以降へ run を伸ばし、window `pivots[i..k]` について `highs=type==='high'.value`、`lows=type==='low'.value` を集計。
  2. `highs.length≥minTouches && lows.length≥minTouches` かつ **`spread(highs)/mid ≤ clusterTol && spread(lows)/mid ≤ clusterTol`**（`spread=max-min`、`mid=(mean(highs)+mean(lows))/2`）かつ `mean(highs)>mean(lows)` なら帯として `k` を拡張。条件を破った `k` で停止（＝最大クリーン run）。
  3. 帯成立（`bestK≥0`）→ `{type:'range', startIdx:pivots[i].idx, endIdx:pivots[bestK].idx, support:mean(lows), resistance:mean(highs), touchHigh:highs.length, touchLow:lows.length, pivots:pivots[i..bestK]}` を push、`i=bestK`（**帯を抜けたピボットが次セグメント起点＝ブレイクアウト**）。
  4. 帯非成立→ピボット対 `(i,i+1)`：`|change|≥trendPct && (idx差≥3)` なら `{type:'trend', startIdx,endIdx,startVal,endVal,change}`、そうでなければ**何も push しない**（＝下記の設計判断）、`i=i+1`。
- **設計判断（明示）**：帯にも明確トレンドにもならない**単発の浅い区間（|Δ|<3%・非グループ）は非描画**。従来は区間ごと amber を引いていたが、複数ピボット帯へ統合する方針では単発の浅い区間はノイズとして描かずチャートをすっきりさせる。
- **support/resistance＝クラスタ済みピボットの平均**（外縁 max/min でなく代表タッチ水準＝S/R ゾーンの芯）。noise で一部ローソクが線を突き抜けるのは S/R として正常。

## §4 チャート描画（`detail-charts.js drawTRLines` 改修＋案B グロー帯 primitive）
- `drawTRLines(displayPrices)`（426-483）：`autoZigZagDeviation`→`calcZigZag`→**`zigzagSegments`** を呼び、返るセグメント列を反復。
  - `trend`：既存どおり斜め線（up=teal `rgba(52,245,207,0.9)`/down=pink `rgba(255,102,153,0.9)`・意味不変）。始点/終点2点で addLineSeries。
  - `range`：**支持・抵抗の水平線を帯の全区間**（`startIdx..endIdx`）に amber 破線1本ずつ（`rgba(255,216,77,*)`・lineStyle:2）。従来の「区間ごと」を「複数ピボット帯」へ拡張。
- **案B グロー帯 primitive**（`makeCandleGlowPrimitive` 537 と同型＝`candleSeries.attachPrimitive`・`target.useMediaCoordinateSpace`）：新 `makeRangeBandPrimitive()` を**候補チャート初期化時に1回 attach**（600 の candle glow 併存）。closure 変数 `trRangeBands=[]` を読み、各帯を `timeToCoordinate/priceToCoordinate` で矩形化し**縦グラデーション淡色 fill**（`rgba(255,216,77,0.16)`→`0.05`→`0.16`）。`trState` が false または `trRangeBands` 空なら描画しない（面でなく光＝テーマD整合）。
- **state 管理**（既存 closure `let trState/trSeries/currentDisplayPrices` 48-50）：`drawTRLines` 冒頭で `trSeries` 除去＋`trRangeBands.length=0`。range セグメントごとに水平線を `trSeries` に push＋帯を `trRangeBands` に push。末尾で primitive の `requestUpdate()` を叩き再描画。`toggleTR`（484-488）と `!trState` early-return で `trRangeBands` も空化。
- **0x0罠**：primitive は既存 candle glow と同機構＝寸法/初期化順序を変えない（唯一の技術制約を遵守）。

## §5 signalDigest『ZigZag区間』行（`detail-rules.js` 675-688）
- 末尾2ピボット判定を **`zigzagSegments` の末尾セグメント**へ置換（単一源）。`dp` から `calcZigZag(dp, autoZigZagDeviation(dp))`→`zigzagSegments(dp, pivots)`→`segs[segs.length-1]`。
- **state は既存 STATE_ENUM の値を維持**（no-score 閉集合を変えない＝pre-mortem REG-1 反映・新 state を足さず enum 改修不要で回帰ゼロ）。改善は **readout** に載せる：
  - 末尾が `range`：`state='直近の確定区間はレンジ'`（既存値）、`readout='帯幅 '+((resistance-support)/support*100).toFixed(1)+'%・'+(touchHigh+touchLow)+'点接触'`。
  - 末尾が `trend`：`state='直近の確定区間はトレンド'`（既存値）、`readout=(change>=0?'+':'')+(change*100).toFixed(1)+'%'`。
  - セグメント無し：`state='データ不足'`。
  - `note='末尾ピボットは未確定'` は保持（末尾セグメントが窓末尾から離れる稀ケースの"直近"の弱さを注記でカバー＝pre-mortem C2 の許容・Minor）。
- **通貨非依存**：絶対価格でなく帯幅%と接触数で表現（S/R 行が%表記なのと整合・US/JP 分岐不要）。

## §6 規律ミニカード（`disciplineDigest` 拡張／`renderDisciplineCard` レンジチップ）
- **`disciplineDigest(displayPrices, allPrices)`**（778-796）の戻り値に `range` を追加。**recency ゲート（pre-mortem C1 反映＝過去の古い帯を"直近の上抜け"と誤ラベルしない）＝(1)末尾セグメント位置＋(2)bar-distance の二重錠**：
  - `segs = zigzagSegments(dp, calcZigZag(dp, autoZigZagDeviation(dp)))`。`n=segs.length`、`last=segs[n-1]`、`prev=segs[n-2]`。
  - **band 選択**：`last.type==='range'`→`band=last`（今まさに帯の中）／`last.type==='trend' && prev && prev.type==='range'`→`band=prev`（帯を抜けた直後）／それ以外→`band=null`。
  - **bar-distance 錠**：`recencyBars = Math.max(10, Math.round(dp.length*0.2))`。`band && closeV!=null && (dp.length-1 - band.endIdx) <= recencyBars`（**帯の終端が窓末尾近傍＝ブレイクが最近**）でなければ `range={ok:false}`。これが C1 の核＝「窓前半でレンジ→その後ずっとトレンドで現値が大きく離れた」ケースを、last=trend/prev=range でも `band.endIdx` が窓末尾から遠いので `ok:false` に落とし、月遅れブレイクを"直近上抜け"と誤ラベルしない。
  - **成立時**：末尾 close(`closeV=endBar.close`) と band 比較：`closeV>resistance`→`state='上抜け（直近）'`／`closeV<support`→`state='下抜け（直近）'`／それ以外→`state='横ばい帯の中'`。`range={ok:true, state, widthPct, touches}`。
  - `widthPct=((resistance-support)/support*100)`、`touches=touchHigh+touchLow`。**通貨非依存**＝絶対価格を返さない（純関数を通貨から独立に保つ）。
- **`renderDisciplineCard`**（detail.js 450-469）：既存「トレンド強度／値幅」チップの後に**「レンジ」チップ**を1つ追加。`d.range.ok` の時のみ描画し、`state`＋`（帯幅X%・N点接触）` を表示。tone クラスは中立＝`state.indexOf('横ばい')>=0` は `calm`、`上抜け/下抜け` は無印（方向的良否を色で含意しない・束B のマーカー中立化と同方針）。`d.range.ok===false` はチップ非表示（帯なし＝トレンド局面）。免責 fail-closed・`injectTermHelp` は現状のまま。

## §7 グロッサリ・規制安全
- glossary `zigzag`（55）def を横ばい帯へ言及するよう微修正（例：「…同じ価格帯で複数回往復する区間は1つの横ばい帯（支持帯/抵抗帯）として見る。末尾の点は未確定。」）＝中立・no-score。
- **禁止語ゲート**：新規の全 readout/state/glossary は `tests/fixtures/forbidden_terms.js FORBIDDEN.ALL`（TRADE/FORECAST）に非該当を**テストで実証**。採用語彙＝`横ばい帯/上抜け/下抜け/トレンド区間/帯幅/接触/支持帯/抵抗帯`（買売/損切り/急騰暴落/上昇下落する 等を含まない）。
- **no-score**：数値スコア化しない（帯幅%・接触数は事実の丸め表示）。**免責**は `renderDisciplineCard` の `ANALYSIS_DISCLAIMER` fail-closed を維持。**facts 非出力**（advice.py/money-rules.js 非接触＝助言層に触れない・層1教育のみ）。

## §8 テスト（TDD・`tests/detail-rules.test.js`）
- `zigzagSegments`：①明確な横ばいピボット列→`range`1件（support/resistance/touch 正）②連続切り上げ→`trend` のみ・`range`0（誤帯化しない）③混在→トレンド/レンジ交互④`<2*minTouches` ピボット→帯なし⑤clusterTol 境界（スイング幅≈deviation で誤帯化しないこと）⑥帯→ブレイクの reconciliation（帯終端の次が trend）。
- `autoClusterTol`：clamp 境界（低/高ボラで [0.02,0.045] に収まる）。
- `disciplineDigest.range`（**recency 含む・pre-mortem C1**）：(a)末尾が帯＝横ばい帯の中／上抜け／下抜け(b)帯直後のトレンド＝ブレイク（直近）(c)**古い帯＋その後トレンド継続→`ok:false`（誤って"上抜け（直近）"にしない）**(d)帯なし→`ok:false`。widthPct/touches 正・通貨非依存（絶対価格を含まない）。
- signalDigest『zigzag』行：range/trend/データ不足の readout 文字列。**state は既存 STATE_ENUM 値のまま**＝閉集合を変えない（pre-mortem REG-1／新 state を足さない設計に修正済ゆえ STATE_ENUM 改修不要・既存 test 361-376 は緑のまま）。
- **FORBIDDEN スキャン拡張（pre-mortem REG-2）**：glossary（318 型）＋ signalDigest digest（383 型）に加え、**`disciplineDigest` の trend/vol/dir/range.state もまとめて `FORBIDDEN.ALL` で 0 ヒットをアサート**（既存 780 の `d.note` 限定を拡張・range 経路を規制ゲートに含める）。
- 既存 206 緑を回帰させない（STATE_ENUM 非改修で担保）。

## §9 検証
- **headless smoke**（Playwright・`scratchpad/`・GPU グローは非authoritative）：詳細ビュー実描画で pageerror0／T/R トグルで帯が1本化（旧ギザギザ非再発）／signalDigest 行文言／ミニカード「レンジ」チップ／ETF セーフ／年切替。
- **snapshot**：`detail-snapshot.js`／`f2-snapshot.js` で非チャート領域一致（T/R 描画領域は意図的変更＝再ベースライン）。
- **本人実機（authoritative）**：FHD で①グロー帯の見え（案B・面でなく光）②線/candle 重なりの可読性③帯の妥当性（実銘柄で横ばい局面を帯化できているか）。

## §10 不変条件・境界・リスク
- **不変**：ローソク確定色（up=赤/down=青）・ZigZag 逆規約（up=teal/down=pink・上下の意味）・0x0罠回避の寸法/初期化順序・candle glow primitive。
- **境界（単一源）**：帯化ロジックは `zigzagSegments` の1箇所。描画・signalDigest・disciplineDigest は**すべてこれを消費**（判定の二重実装を作らない）。
- **リスク**：①`clusterTol` が緩いとトレンド途中の踊り場を帯化（`dev*0.5` 下限で抑制・テスト⑤で担保）②実データで横ばいのスイングが `deviation` 未満だとピボットが立たず帯化されない（＝ZigZag 分解能の限界・実窓は1年で概ね妥当・本人実機で確認）③primitive 追加による再描画コスト（帯は少数・candle glow と同機構で許容）。

## §11 単一源・依存・読込順
- 追加：`detail-rules.js`（`zigzagSegments`/`autoClusterTol`・exports へ追記 921-922）／`detail-charts.js`（`makeRangeBandPrimitive`・`trRangeBands`・`drawTRLines` 改修・attach 600 付近）／`detail.js`（`renderDisciplineCard` レンジチップ）／`detail.css`（必要なら `.disc-chip .v` 中立クラスのみ・新規最小）。
- 読込順不変（dataClient→finance-rules→detail-rules→inline→detail-charts→detail）。`zigzagSegments` は detail-rules で定義し detail-charts/detail が `DetailRules.*` で参照。

## §12 決定記録（本ブレスト確定）
1. 検出＝ピボット後処理で帯化（ADX 併用/全点クラスタリングは不採用・補助止まり）。
2. スコープ＝描画＋signalDigest＋規律ミニカード（フル）。ミニカードは**既存 disciplineDigest 拡張**（新カード非新設）。
3. 見せ方＝**案B（線＋淡いグロー帯）**。
4. 厳しさ＝**既定（自動適応・clusterTol≈2.5-2.8%・2タッチ・3%）**。
5. 通貨非依存の readout（帯幅%・接触数）。単発の浅い非グループ区間は非描画。

## §13 pre-mortem（敵対検証 wf）反映（2026-07-08 実施・一部 usage limit で中断）
wf `wf_e57c269a-4f6`（4次元 find→refute）。**週次 usage limit で boundaries 次元の find と一部 verify が未完**（候補8・CONFIRMED1・他は finder 根拠の妥当性を main で採否判断＝receiving-code-review 規律）。反映：
- **REG-1（CONFIRMED・Important）**：signalDigest の新 state 文字列が既存テスト `STATE_ENUM`（no-score 閉集合・test 361-376）に無く回帰→**設計修正＝signalDigest の state は既存値を維持し改善は readout に載せる**（enum 非改修＝回帰なし）。§5/§8 反映。
- **C1（Important・verify 未完だが根拠妥当・採用）**：disciplineDigest の 上抜け/下抜け（直近）が過去の帯と現 close を比較し月遅れのブレイクを"直近"と誤ラベル→**recency ゲート（末尾セグメント位置で判定）**を §6 に追加。
- **C2（Minor・許容）**：signalDigest 末尾セグメントが窓末尾から離れる稀ケース→`note='末尾ピボットは未確定'` で注記（過剰機構は入れない）。
- **REG-2（Minor・低コストゆえ採用）**：disciplineDigest.range.state を FORBIDDEN スキャンに明示追加。§8 反映。
- **C3＝REG-1 の重複**。
- **⚠️未完＝boundaries 次元**（single-source/primitive 干渉/state クリア漏れ/F2 露出）は wf 未実行分。§10/§11 の自己分析でカバー済だが、**実装時の whole-branch 敵対検証 wf で boundaries を重点再検証**（usage limit reset 後）。
