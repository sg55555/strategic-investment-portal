# 次テクニカル指標追加：Keltner Channel / OBV / VWAP 設計書

- date: 2026-07-08
- project: investment-portal（銘柄詳細ビュー detail-view のチャート層）
- status: 設計承認済（本人確認 2026-07-08）
- related: `2026-07-08-phase2-bundleC3-discipline-technical-design.md`（ADX/ATR＋可視サブパネルアコーディオン＝直近の前例）

## 1. 目的とスコープ

detail-view のチャートに、既存指標（MA / Bollinger / S-R / T-R / RSI / MACD / ADX / ATR / 出来高）へ 3 指標を追加する：

- **Keltner Channel**（価格オーバーレイ／エンベロープ）
- **OBV: On-Balance Volume**（新サブパネル）
- **VWAP: Volume-Weighted Average Price**（価格オーバーレイ／期間アンカー）

いずれも**チャート専用**（スクリーナー非統合＝ADX/ATR と同じ）。既存の 4 タッチポイント・パターンに完全準拠し、アーキテクチャの新規性は持ち込まない。

### スコープ外（YAGNI）
- スクリーナー軸への追加（`screener-rules.js` AXIS_REGISTRY はファンダ 8 軸のみ・非変更）
- Keltner のスクイーズ検出（BB と Keltner の収束＝視覚で目視可能・自動判定は付けない）
- OBV のシグナル移動平均線（絶対値は任意なので単線のみ）
- パラメータの UI 可変化（EMA20 / ATR14 / mult2 固定）
- Python ミラー（チャート指標に Py 対応物は無い・パリティ不要）
- Service Worker バージョン up（本 PJ に SW は無い）

## 2. 前提（確定事実）

- データ = **日足 OHLCV**。価格オブジェクト = `{time:"YYYY-MM-DD", open, high, low, close, volume}`、time 昇順・文字列比較でウィンドウ切り出し。通貨は native（JPY/USD 混在・正規化なし）。
- `volume` は常に数値 int（`api/market/ohlcv.py:35` が NULL→0 に強制）。**0 出来高の日があり得る**ためガードが要る。約 1220 本/銘柄（≒5 年）。イントラデイ無し。
- 純計算は `detail-rules.js`、描画/ライフサイクルは `detail-charts.js`（IIFE closure）、UI は `detail.js`。inline onclick は `window.*` 露出が必須（欠落＝無言故障）。
- **唯一の技術制約 = 0x0罠**（`display:none → createChart` が 0x0 固定）。サブパネルは `mountSubpanel`（`detail-charts.js:341`）が clientWidth>0 の rAF ポーリングで既にガード済。
- **規制安全（ハード）**：glossary の `def`・signalDigest の `state`/`readout` は中立の事実表現のみ。売買/推奨/予測語を含めない。`tests/fixtures/forbidden_terms.js` の正規表現でテスト機械ゲート。descriptor に数値スコア（value/score/weight）を持たせない。
- ローソク up=赤/down=青、ZigZag は逆規約（up=teal/down=pink）＝**意味付けは不変**。新オーバーレイの線色はこれらと衝突しない別ヒュー。

## 3. 指標ごとの設計

### 3.1 Keltner Channel（価格オーバーレイ・BB 複製）

**計算（`detail-rules.js` 新規純関数）**

```
calcKeltner(prices, emaPeriod=20, atrMult=2, atrPeriod=14) -> { upper, mid, lower }
  mid   = calcEMA(prices.map(p => p.close), emaPeriod)   // 既存 calcEMA を流用（closes 配列を渡す）
  atr   = calcATR(prices, atrPeriod)                     // 既存 calcATR の絶対 value を使用（pct でなく）
  band  = atrMult * atr.value
  upper = mid + band, lower = mid - band
  各 {time, value:parseFloat(x.toFixed(2))}、BB と同形の {upper,mid,lower}
```

- **整列の注意**：`calcEMA` は全長 null 埋め配列（period-1 まで null）を返し、`calcATR` は index `period` から始まる短い配列＋独自 `{time,value}`。**index でなく time で突き合わせる**（両者の time が一致するバーのみ upper/mid/lower を出力）。
- パラメータ既定 = EMA20 ± 2×ATR(14)（既存 ADX/ATR パネルと期間 14 を共有）。

**描画（`detail-charts.js`）**
- `DR` destructure に `calcKeltner` 追加（`:25-27`）。
- モジュール private `let kcUpperSeries, kcMidSeries, kcLowerSeries` ＋ `let kcState=false`（`:36-40` 付近）。
- `initPriceChart` で BB の `addLineSeries`（`:583-594`）を複製し 3 本作成、`visible:false`、色 = **amber/orange 系**（既存 price overlay の MA=pink `#ff5ca8`/blue `#3aa6ff`/purple `#a35cff`・BB=cyan・candle 赤青・ZigZag teal/pink と非衝突。⚠️violet は ma75 と衝突するので不可）。upper/lower は淡い破線（`lineStyle:2`）、mid はやや濃い実線。
- `toggleKeltner()`（`toggleBB` `:200-204` 複製）＝ `kcState` フリップ＋`#ind-btn-keltner` に `.active`＋3 本の `applyOptions({visible:kcState})`。
- `updateMaAndVolume` の BB ブロック（`:473-479`）を複製：base（全履歴 or displayPrices）で `calcKeltner`、`[startTime,endTime]` で filter、`kcXSeries?.setData(...)`。
- `window.toggleKeltner` を露出（`:1333-1336`）。

**UI**：`index.html` のオーバーレイ・ツールバー（`:1183-1192`）に `<button id="ind-btn-keltner" class="ma-btn" onclick="toggleKeltner()">` ＋隣接 `<span class="ma-label" data-term="keltner">` を追加。

### 3.2 OBV（新サブパネル）

**計算（`detail-rules.js` 新規純関数）**

```
calcOBV(prices) -> [{time, value}]
  obv = 0
  for i in 1..n-1:
    if close[i] > close[i-1]: obv += volume[i]
    elif close[i] < close[i-1]: obv -= volume[i]
    else: obv += 0
    push {time: prices[i].time, value: obv}
  prices.length < 2 -> []
```

- 累計は**全履歴で継続**（表示ウィンドウ内は連続に見える。絶対値は任意＝傾き/ダイバージェンスを見る）。value は整数のまま（丸め不要・巨大値可、サブパネルは独自オートスケール）。

**描画（`detail-charts.js`）**
- `buildOBV(chart)`（`buildATR` `:312-329` を雛形）：単線 `addLineSeries`（例 `#5cf0ff` 等の中立ネオン）、`chart.__setData=(display,all)=>{ calcBase=(all?.length>50)?all:display; inRange=d=>d.time>=start&&d.time<=end; series.setData(calcOBV(calcBase).filter(inRange)); }`。
- `SUBPANEL_REGISTRY`（`:330-335`）に `obv:{height:104, timeAxis:false, build:buildOBV}` を追加。
- `detail.js` `SUBPANEL_META`（`:288-293`）に `{key:'obv', label:'OBV', sub:'', term:'obv', height:104, desc:'終値方向×出来高の累計線。傾き・価格との食い違いを見る目安。'}` を追加（height は registry と一致＝意図的二重管理／desc は中立文言）。
- **既定オープンには入れない**（`addSubpanelItem('adx')/('atr')` の SOFT_CAP=2 を超えない・OBV は opt-in チップ）。
- `refreshSubpanels`/`ensureSubSync`/`resizeSubpanels`/`repaint` はキーを汎用反復＝**追加変更ゼロ**。
- `.acc-item` の `overflow:visible`（`detail.css:583-591`）は維持（term-help ツールチップのクリップ防止）。

### 3.3 VWAP（価格オーバーレイ・期間アンカー）

**計算（`detail-rules.js` 新規純関数）**

```
calcVWAP(prices) -> [{time, value}]         // prices[0] を起点に累積
  cumPV = 0, cumV = 0
  for each bar:
    tp = (high + low + close) / 3
    cumPV += tp * volume; cumV += volume
    if cumV > 0: push {time, value: parseFloat((cumPV/cumV).toFixed(2))}   // cumV==0 のバーはスキップ（push しない）
  総出来高 0（全バー volume=0）-> []（無出来高銘柄は静かに縮退）
```

- **アーキ上の唯一の逸脱**：他オーバーレイは「全履歴算出→window filter」だが、期間アンカー VWAP は path-dependent。`updateMaAndVolume` で `calcVWAP(displayPrices)` を**表示ウィンドウ直接**に算出（filter しない）。`displayPrices[0]` = 期間先頭 = アンカー。年/期間切替（`priceWindow()` の US=暦年 / JP=年度）で `updateMaAndVolume` が再呼びされ起点が自然にリセットされる。
- 先頭に volume=0 のバーが続く場合は cumV=0 の間だけ点を出さず（LightweightCharts に null を渡さない＝線の途切れ防止）、最初に出来高が付いたバーから線が始まる。以降に単発の volume=0 が挟まっても cumV は据え置きで割れない。

**描画（`detail-charts.js`）**：Keltner と同じ骨格の単線 `vwapSeries` ＋ `vwapState` ＋ `toggleVWAP()` ＋ `#ind-btn-vwap` ＋ `window.toggleVWAP`。色 = **gold 系**（例 `#ffd84d`・単線・`lineWidth:2`。Keltner の amber/orange とは暖色内で分離＋線形状が別[単線 vs 破線チャネル]）。`initPriceChart` で `visible:false` 作成、`updateMaAndVolume` で `vwapSeries?.setData(calcVWAP(displayPrices))`。色は改善対象＝実機 FB で微調整前提。

**UI**：`index.html` ツールバーに `<button id="ind-btn-vwap" ...>` ＋ `data-term="vwap"` span。

## 4. signalDigest（中立読み取り・3 行追加）

`signalDigest`（`detail-rules.js:534-674`）に 3 ブロック追加。`_atDisplayEnd(series, endTime)` で表示末尾値を取得し `{key,label,term,state,readout}` を push。closed-vocab の中立 state のみ・売買/予測/圧力/シグナル語禁止。

| key | label | state（closed set） | readout |
|---|---|---|---|
| keltner | ケルトナー | 上限チャネルの外側 / チャネル内側 / 下限チャネルの外側 | `中心線比 +X.X%`（close/mid−1） |
| obv | OBV | 直近20日で上向き / ほぼ横ばい / 直近20日で低下 | （省略可） |
| vwap | VWAP | 終値がVWAPの上 / VWAP近辺 / 終値がVWAPの下 | `乖離 +X.X%`（close/vwap−1） |

**state 判定の閾値（実装時にコメント明記）**
- **Keltner**：`close < lower`→下限の外側／`close > upper`→上限の外側／それ以外→内側（バンドに対する binary・ε 不要）。
- **VWAP 近辺**：`|close/vwap − 1| ≤ 0.3%` を「近辺」、超えたら上/下。
- **OBV**：直近 20 バーの純変化 `d = OBV[end] − OBV[end−20]` を同区間の総出来高 `gross` で正規化した比 `ratio = d/gross ∈ [−1,1]`（OBV 絶対値は任意なので総出来高でスケール）。`|ratio| < 0.2` を「ほぼ横ばい」、それ以外は符号で上向き/低下。表示窓が 21 バー未満は state 省略（データ不足）。
- 「買い圧力」等の含意語は使わない（線の傾きの純事実のみ）。

## 5. glossary（term-help・3 語追加）

`INDICATOR_GLOSSARY`（`detail-rules.js:49`）に `{term, read, def}` を 3 件追加。ADX/ATR のトーン（`:79-80`）踏襲＝中立・平易・「よくある誤解」1 文・売買/予測語なし。案（実装時に forbidden_terms を通して微調整）：

- **keltner**：「移動平均（EMA）を中心に、値幅（ATR）の一定倍を上下に加えたバンド。価格が上限/下限の外側か内側かは事実であり、外側であること自体が方向を決めるものではない。」
- **obv**：「終値が前日より上がった日は出来高を足し、下がった日は引いて積み上げた累計線。傾きや価格との食い違い（ダイバージェンス）を見る目安で、絶対値の大きさ自体に意味はなく、上向きが上昇を保証するものではない。」
- **vwap**：「表示期間の出来高加重の平均価格。終値がその上か下かは事実であり、水準だけで方向が決まるものではない。」

`tests/detail-rules.test.js` の required-terms リスト（`:299-311`）に `keltner`/`obv`/`vwap` を追加。

## 6. テスト & 検証

- **単体（`tests/detail-rules.test.js`, node:test）**：`calcKeltner`/`calcOBV`/`calcVWAP` 各 3 パターン ＝ ①短入力/退化入力 → `[]` ②解析既知の小合成配列で末尾値を `Math.round` 照合 ③flat-price で全出力 `Number.isFinite`。加えて **volume=0 ケース**（OBV は加減 0、VWAP は総出来高 0→`[]`）。既存 calcATR/calcADX テスト（`:604-647`）の書式に合わせる。
- **required-terms / forbidden-words**：3 語追加後も required-terms 通過・forbidden-words（売買/予測語）非検出を確認。
- **snapshot**：`node scratchpad/detail-snapshot.js`（`NODE_PATH=/home/shugo/node_modules`、mock は `scratchpad/mock_prod_server.py`）。3 指標追加で canvas/DOM が変わるため **意図的に再ベースライン**（追加分を確認した上で capture）。
- **実ブラウザ**：Playwright で CDN 実ロードし、3 トグル ON/OFF・OBV チップ展開（0x0/黒 canvas 回帰なし）・年/期間切替での再描画・term-help ツールチップ表示を目視（GPU 依存は headless 不可＝実機/本人 FB）。
- **全体**：`node --test`（detail-rules / finance-rules / money-rules）緑。
- **デプロイ検証**：push 後 `vercel inspect <url> --logs | grep Commit` で実コミット照合＋本番 `/` ルート（`/index.html` は 15B スタブ）を curl。

## 7. 触るファイル

| ファイル | 変更 |
|---|---|
| `detail-rules.js` | +calcKeltner/calcOBV/calcVWAP、+3 glossary、+3 signalDigest ブロック、export 追加 |
| `detail-charts.js` | DR destructure、Keltner 3 series+toggle+update、VWAP 1 series+toggle+update、window 露出、buildOBV+registry |
| `detail.js` | SUBPANEL_META に obv 行（既定オープン非追加） |
| `index.html` | Keltner/VWAP ボタン 2 個（data-term span 付き） |
| `tests/detail-rules.test.js` | 3 calc テスト＋required-terms 更新 |
| （scratchpad snapshot baseline） | 再ベースライン |

## 8. リスクと対策

- **EMA/ATR の time 整列ミス**（Keltner）→ index 依存を排し time キーで突合。単体テストで先頭 null 区間と末尾値を検証。
- **VWAP 0/0**（起点直後・無出来高）→ cumV>0 ガード＋総出来高 0 は `[]`。テストで担保。
- **0x0罠**（OBV サブパネル）→ 既存 `mountSubpanel` の rAF ガードに乗る（新規プランなし）。FHD 初回黒 canvas は既知の別件パターン（別途 forceChartRepaint 対象）＝実機で回帰確認。
- **window 露出忘れ**（Keltner/VWAP トグル）→ `:1333-1336` に追加。snapshot/実ブラウザで無言故障を検出。
- **規制ワード混入**→ forbidden-words テストで機械検出（RSI が「買われ過ぎ/売られ過ぎ」を許容している通り、判定は directive 語ベース。抵触時は文言調整）。
- **snapshot 差分の取り違え**→ 3 指標追加による差分のみか目視確認してから再 capture（無関係差分を焼き込まない）。

## 9. 実装順（writing-plans で詳細化）

共有ファイル（detail-rules.js / detail-charts.js / index.html）を 3 指標が同時に触るため**並列 worktree での指標別分担は不可＝直列**。TDD で純関数から進める：

1. `detail-rules.js`：calcKeltner/calcOBV/calcVWAP ＋テスト（TDD）→ 単体緑。
2. glossary 3 語＋required-terms 更新 → 緑。
3. signalDigest 3 ブロック → 緑（forbidden-words 通過）。
4. `detail-charts.js`：Keltner/VWAP オーバーレイ＋buildOBV/registry＋window 露出。
5. `detail.js` SUBPANEL_META、`index.html` ボタン。
6. snapshot 再ベースライン＋実ブラウザ検証。
7. ExitWorktree（keep）→ main merge → push → 本番 `/` 検証。実機 UI サニティは本人 FB。
