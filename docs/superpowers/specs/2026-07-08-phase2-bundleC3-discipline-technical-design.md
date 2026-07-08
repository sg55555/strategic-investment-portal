---
date: 2026-07-08
tags: [investment-portal, phase2, technical-indicators, adx, atr, subpanel, design-spec]
project: investment-portal
related: [[investment-portal]] [[2026-07-03-phase2-analysis-ideation-menu]] [[strategy-personal-finance-advice-intent]]
status: 設計確定（本人承認 2026-07-08）／spec → writing-plans 待ち
---

# Phase2 束C③ 規律テクニカル（ADX/ATR）＋ 可視サブパネル選択UI — 設計

## 1. 背景・目的
Phase2「分析力の深化」束C（規律の道具化）の3本目。棚卸しメニュー #11「規律テクニカル(ADX/DMI・ATR/Keltner)」に対応。

- **芯**＝**過度な値幅期待の抑制＝規律**。ADX は「トレンドの“強さ”」を、ATR% は「1日の値幅の目安」を定量化し、"今どれだけ動きうるか／方向感があるか" を事実として見せる。
- **副次効果**＝ADX はトレンド/レンジを定量判定する標準指標。既存 ZigZag の視覚的レンジ検出（別件・改善は将来タスク）とは別レイヤーだが、「今トレンドかレンジか」を数値で補完する。
- **前提（棚卸しメニュー横断リスク #1）**＝テクニカル系サブパネルを RSI/MACD に足すと縦圧迫。よって **可視サブパネル選択UI を本セッションで先に設計・実装**（本 spec に同梱）。UI方式は実物モック3案（A/B/C）比較で **案C アコーディオン** を本人採用（2026-07-08）。

## 2. スコープ
### In（本セッション）
1. **ADX/DMI サブパネル**（ADX線 ＋ +DI/-DI ＋ 25基準線）
2. **ATR% サブパネル**（ATR% 線 ＋ 中央値基準線・**正規化%を主表現**）
3. **可視サブパネル選択UI = 案C アコーディオン**（チップ複数選択→折り畳みスタック・ソフト上限2枠・「すべて開く/畳む」）
4. **signalDigest 統合**（束A のテクニカル現在地サマリに ADX/ATR の2 descriptor を追加）
5. **現在地ミニ解説カード**（サブパネル領域先頭・ADX/ATR にフォーカスした平易解説）
6. **分析グロッサリ拡張**（ADX・ATR% の用語定義を単一源へ追加）
7. サブパネル系の**汎用レジストリ化**（RSI/MACD もこの仕組みに載せ替え・将来拡張の土台）

### Out（将来 backlog・spec に明記のみ）
- **Keltner Channel**（ATRベースのメインチャート・オーバーレイ／BB=標準偏差 との役割対比）
- **出来高系 OBV / アンカーVWAP**（サブパネル／オーバーレイ）
- **ZigZag レンジ検出ロジックの改善**（別件・既存トラック＝`.claude/CLAUDE.md` チャート節。根因＝ピボット間1レッグは構造上 deviation 以上動くため、単一セグメント判定ではレンジ＝多ピボット横ばい帯を束ねられない。将来「複数ピボットを水平バンドにグルーピングする別パス」で対応）

## 3. 規制フレーム（強制・全成果物に適用）
- **層1（公開・決定論・client・教育）**。ADX/ATR は記述的テクニカル値ゆえ `ADVICE_MODE` ゲート**不要**。ただし [[strategy-personal-finance-advice-intent]] の2層設計に整合＝**client 側に助言（売買含意）を置かない**。
- **文言規律**（signalDigest の既存規律を踏襲＝`state` は「符号スカラに写像不能な中立状態語の閉集合」・売買語/予測語なし・数値スコアフィールド[value/score/weight]なし）：
  - ADX は「トレンドの**強さ**（向きは示さない）」。+DI/-DI の優劣は「上向き/下向き**圧力**が優勢」という**事実**として readout に置く（買い/売りにしない）。
  - ATR% は「**値幅の目安**」。**損切り水準の推奨にしない**（"ここで損切り" 等の語を出さない）。
- **免責**＝既存 `DISCLAIMER`（教育目的・特定銘柄の売買/損切り推奨でない）を該当UIに同梱（money側 DISCLAIMER と同型の単一源を分析側にも適用）。

## 4. アーキテクチャ（既存 detail 分離規律を遵守）
```
detail-rules.js  純計算(DOM非依存・UMD・node --test)
  ├ calcADX(prices, period=14)           新規
  ├ calcATR(prices, period=14)           新規
  ├ _adxState() / _atrVolState()         新規(分類ヘルパ・単一源)
  ├ signalDigest(...)                    拡張(adx/atr descriptor 2件追加)
  ├ disciplineDigest(dp, ap)             新規(ミニ解説カード用の focused 純関数)
  └ ANALYSIS 用語定義に adx/atr 追加       (termHelp/グロッサリ単一源)
detail-charts.js  描画/lifecycle(IIFE・closure私有・0x0罠不変)
  ├ SUBPANEL_REGISTRY                    新規(汎用サブパネル定義・mock-engine.js 検証済の形)
  ├ mountSubpanel(key,hostEl,opts)       新規(rAFで幅>0待ち・冪等)
  ├ unmountSubpanel(key)                 新規
  ├ (既存 toggleRSI/toggleMACD/initSubCharts/updateSubCharts を registry へ移行)
  └ 時間軸連動を汎用サブパネル集合へ拡張(メイン→各サブ)
index.html / detail.js / detail.css  UI/orchestration
  ├ サブパネル選択UI(案C アコーディオン)   置換(旧 RSI/MACD トグル+固定container を撤去)
  ├ 現在地ミニ解説カード                  新規
  └ F2 公開面(Object.assign(window,…))    新規公開関数を追加
```
**参照実装**＝本セッションのモック `scratchpad/subpanel-mock/mock-engine.js`（mount/unmount/registry/time-sync/digest の形を検証済）＋ `live-C.html`（案C の視覚・挙動リファレンス）。実装はこの検証済アーキを detail-* に持ち込む。

## 5. データ層 `detail-rules.js`

### 5.1 `calcADX(prices, period = 14)` → `[{time, adx, plusDI, minusDI}]`
Wilder DMI/ADX（標準）。
- TR = max(high−low, |high−prevClose|, |low−prevClose|)
- +DM = (up>down && up>0) ? up : 0（up=high−prevHigh）／ −DM = (down>up && down>0) ? down : 0（down=prevLow−low）
- TR・+DM・−DM を Wilder 平滑（初項=先頭 period の単純和、以降 `s = s − s/period + x`）
- +DI = 100·smPlusDM/smTR ／ −DI = 100·smMinusDM/smTR
- DX = 100·|+DI − −DI| / (+DI + −DI)（分母0→0）
- ADX = DX の Wilder 平滑（初項=先頭 period DX の平均、以降 `(prev·(period−1)+dx)/period`）
- **要件**: `prices.length < 2·period+1` は `[]`。分母0ガード。返り値は price index に対応した time 付き。

### 5.2 `calcATR(prices, period = 14)` → `[{time, value, pct}]`
Wilder ATR。
- TR 同上。初項 ATR=先頭 period TR の平均、以降 `(prev·(period−1)+tr)/period`。
- `value`=絶対ATR（円/ドル）、`pct`=`value/close·100`（**表示主体**）。
- **要件**: `prices.length < period+1` は `[]`。

### 5.3 分類ヘルパ（単一源・signalDigest と disciplineDigest の両方が使用）
- `_adxState(adx)` → `'方向感が強い(25以上)' | 'やや方向感あり(20〜25)' | '弱い・レンジ気味(20未満)'`（境界は `Math.round(adx)` で表示と一致）
- `_atrVolState(pct, median)` → `'振れ大きめ' | '通常' | '静穏'`（pct ≥ median·1.3 / ≤ median·0.75 / else）

### 5.4 `signalDigest` 拡張（既存配列に2件 push・既存descriptor形 `{key,label,term,state,readout,note?}`）
- **ADX**: `{key:'adx', label:'トレンド強度', term:'adx', state:_adxState(adx), readout:'ADX '+round(adx)+'（'+ (+DIと−DIの優劣を「上向き圧力優勢/下向き圧力優勢/拮抗」) +'）', note?}`（データ不足=`'データ不足'`）
- **ATR%**: `{key:'atr', label:'値幅(ATR%)', term:'atr', state:_atrVolState(pct,med), readout:'ATR% '+pct.toFixed(1)+'%（中央値 '+med.toFixed(1)+'%）'}`
- 現在地値は既存規律どおり `_atDisplayEnd`（displayPrices 末尾 time で index・当日値混入を回避）。ATR中央値は表示期間 dp から算出（チャートの中央値ラインと整合）。

### 5.5 `disciplineDigest(displayPrices, allPrices)` → focused object（ミニ解説カード用）
```
{ adx, plusDI, minusDI, atrPct, atrMedian,
  trend: _adxState(adx), dir: '上向き圧力優勢|下向き圧力優勢|拮抗', vol: _atrVolState(atrPct, atrMedian),
  note: '平易な一行（例: ADXが低い局面は方向感が乏しくレンジ気味。ATR%で日々の振れの荒さを見る。まず全体像→気になる指標を開く、の順で読むと迷いにくい）' }
```
`note` は教育文言（売買/損切り語なし）。**数値スコア化しない**（総合売買スコアを作らない）。

### 5.6 グロッサリ（用語定義の単一源に追加）
- `adx`: 「ADXはトレンドの強度(0〜100)。+DI/−DIは上昇/下降の圧力。ADXが低い=横ばい、高い=一方向に動きやすい局面の目安。強弱は売買推奨ではない。」
- `atr`: 「ATR(平均的な1日の値幅)を株価で割った%。大きいほど日々の振れが大きい=荒い相場の目安。銘柄をまたいで比べられる。損切り水準の推奨ではない。」

### 5.7 tests（`tests/detail-rules.test.js` 追加）
- calcADX/calcATR：既知データでの Wilder 値検証（手計算 or 固定フィクスチャ）、`[]` 返す長さ境界、フラット価格（TR=0→ATR=0・ADX分母0）でクラッシュしない。
- `_adxState`/`_atrVolState` の境界（round境界 20/25、median×1.3/0.75）。
- signalDigest：adx/atr descriptor が push され `state` が閉集合語・数値スコアフィールド非出力（value/score/weight を持たない）を assert（既存規制テストの拡張）。
- disciplineDigest：データ不足/フラットでの degrade。

## 6. 描画層 `detail-charts.js`

### 6.1 汎用サブパネル・レジストリ（`SUBPANEL_REGISTRY`）
各エントリ `{key, label, sub, glossary, height, build(chart, DATA)}`。key=`rsi|macd|adx|atr`。**RSI/MACD も本レジストリへ載せ替え**（現状のハードコード toggle を撤去し統一）。
- `adx`: ADX線（`#5cf0ff`）、+DI（teal `rgba(52,245,207,0.85)`）、−DI（pink `rgba(255,102,153,0.85)`）、25基準線。height≈140。
- `atr`: ATR% 線（amber `#ffd84d`）、中央値基準線（破線）。height≈116。
- 既存 RSI（`#ffca3a`＋70/50/30線）、MACD（hist＋MACD線`#f570ff`＋シグナル`#8a7bff`）はそのまま registry 化（色/係数は現状維持）。

### 6.2 `mountSubpanel(key, hostEl, opts)` / `unmountSubpanel(key)`
- mount：hostEl の `clientWidth>0` を rAF で待ってから `createChart`（**0x0罠回避**）。冪等。opts.height で上書き可。生成後、価格チャートの現在 visibleLogicalRange に合わせる。
- unmount：`chart.remove()`＋内部状態から除去。**折り畳み=unmount / 展開=mount**（0サイズchartを残さない）。
- 時間軸連動：メインチャートの `subscribeVisibleLogicalRangeChange` で mount 済み全サブパネルへ `setVisibleLogicalRange`（既存 `subChartsTimeSyncBound` を汎用集合へ拡張・一方向 メイン→サブ）。
- リサイズ：`onWindowResize`（既存 P4）に mount 済みサブパネルの `resize(clientWidth, height)` を汎用ループ化（`currentView==='detail'` & `clientWidth>0` ガード不変）。

### 6.3 不変条件
- **0x0罠の寸法/初期化順序**＝唯一の技術制約（`.claude/CLAUDE.md`）。装飾は親カードに付け、chart-container 寸法・初期化順序は不変。
- 既存ローソク確定色・overlay 意味色・ZigZag 逆規約は無改変。
- move-not-rewrite：RSI/MACD の描画本体は registry へ移設するが描画ロジックは verbatim relocate（挙動不変）。

## 7. UI層 `index.html` / `detail.js` / `detail.css`（案C アコーディオン）

### 7.1 撤去
- 旧 RSI/MACD トグルボタン（`ind-btn-rsi`/`ind-btn-macd`）と固定 `#rsi-container`/`#macd-container`（`.sub-chart-wrap`）。
- 旧 `window.toggleRSI`/`toggleMACD` の inline onclick 依存。

### 7.2 新設（案C）
- **サブパネル・チップ行**（複数選択・オーバーレイ群 MA/BB/SR/TR とは別グループ）：RSI / MACD / ADX/DMI / ATR%。＋「すべて開く / すべて畳む」小リンク。
- **アコーディオン・スタック**：選択チップごとに項目追加。各項目＝ヘッダ（キャレット ▸/▾ ＋ label ＋ sub ＋ 用語? ＋ 一行desc ＋ ×）＋ ボディ（chart host）。
  - **ソフト上限=展開2枠**。超過は畳んで追加＋控えめヒント（トースト等）。ヘッダクリックで開閉。
  - 展開=`mountSubpanel` / 折り畳み・×=`unmountSubpanel`。
- **現在地ミニ解説カード**：サブパネル領域先頭。`disciplineDigest()` を描画＝トレンド強度(ADX)・向き・値幅(ATR%)チップ＋一行note＋ADX/ATRの用語?（統合＋専用解説の体現）。
- **用語ツールチップ**：既存 termHelp（`data-def`＋CSSポップオーバー・tap/keyboard対応）を分析側に流用。

### 7.3 規律
- 分離規律：純計算は detail-rules、描画/lifecycle は detail-charts、DOM/orchestration は detail.js。state は detail.js closure私有→detail-charts へ引数化。
- **F2 公開面**：新たに inline onclick / cross-script 参照される関数・定数は IIFE 末尾 `Object.assign(window,{…})` に追加（足し忘れ=無言故障）。アコーディオンのイベントは可能な限り委譲リスナー（inline onclick を増やさない）。
- スタイルは detail.css＋テーマD（`--ix-*`/`--c-*`）トークン・ネオンターミナル調（矩形3px・cyan縁・mono・グロー）。

## 8. コンポーネント境界（各ユニットの what / use / depends）
- **calcADX/calcATR**（rules）：what=OHLCVから Wilder指標系列。use=`DetailRules.calcADX(prices)`。depends=なし（純関数）。
- **disciplineDigest**（rules）：what=ADX/ATRの現在地 descriptor。use=カード描画側が呼ぶ。depends=calcADX/calcATR/_state ヘルパ。
- **SUBPANEL_REGISTRY / mountSubpanel**（charts）：what=サブパネルchartの生成/破棄/連動。use=UIがkey指定でmount/unmount。depends=LWC・DetailRules.calc*・価格チャートinstance。
- **アコーディオンUI**（detail.js/index.html）：what=選択状態と開閉の管理。use=ユーザ操作。depends=mount/unmount・disciplineDigest・termHelp。

## 9. データフロー
`/api/market/ohlcv`（既存）→ STOCK_DATA.prices → DetailRules.calc{ADX,ATR}／disciplineDigest／signalDigest → mount時に chart へ setData／カードへ descriptor 描画。財務系APIには非依存（価格のみ）。

## 10. エラー処理・エッジ
- 短系列（`<2·period+1` / `<period+1`）→ 空系列。サブパネルは「データ不足」表示 or 空chart（クラッシュしない）。
- フラット価格（TR=0）→ ATR=0・ADX分母0ガード（NaN/Infを出さない）。
- **ETF経路**：価格はあるので ADX/ATR/サブパネルは通常描画（財務欠損 early-return より前で価格チャート描画済＝既存 `forceChartRepaint` 経路と整合）。
- 0x0罠：折り畳み中の非mount・展開時のrAF幅待ちで回避。
- 免責/カードは `disciplineDigest` が degrade（データ不足時も安全表示）。

## 11. 検証計画
- **unit**：detail-rules.test.js に calcADX/calcATR/_state/disciplineDigest/signalDigest拡張（Wilder既知値・境界・規制negative）。
- **snapshot 再突合**（`scratchpad/detail-snapshot.js`）：**サブパネル領域は意図的に構造変更**＝その領域はベースライン更新。他領域（価格チャート・財務・compare 等）は `✅MATCH` 維持を確認。F2 公開面 typeof も再確認。
- **実ブラウザ**：開閉の0x0非再発（反復操作＝2回目/別サブパネル後の再クリック）・時間軸連動・ソフト上限・ミニカード・用語ツールチップ・ETF銘柄・複数幅（1920/1024/768）。**本セッションのモック live-C を視覚リファレンス**に。GPU/canvas実描画は headless 非authoritative＝**本人実機サニティが最終**（mistakes.md）。
- **敵対検証**（実装後・whole-branch wf）：無言故障（window公開漏れ）・0x0再発・規制文言（売買/損切り語混入）・digest数値スコア化・パリティ（表示丸めと分類の一致）を観点に。

## 12. モック資産（本セッション成果・実装リファレンス）
- `scratchpad/subpanel-mock/mock-engine.js`：汎用サブパネル・エンジンの検証済アーキ（Wilder ADX/ATR 実装含む＝実装へ移植可）。
- `scratchpad/subpanel-mock/live-{A,B,C}.html`：3案比較。**live-C が採用案の視覚・挙動リファレンス**。
- ※モックは session scratchpad 配下（.vercelignore 対象外・repo外）。実装時に必要部分を detail-* へ移植する。

## 13. 実装順（writing-plans で詳細化）
1. rules：calcADX/calcATR/_state/disciplineDigest/signalDigest拡張/グロッサリ＋unit（TDD）。
2. charts：SUBPANEL_REGISTRY＋mount/unmount＋時間軸連動（RSI/MACD 移行含む・move-not-rewrite）。
3. UI：案C アコーディオン＋ミニ解説カード＋termHelp流用＋F2公開面（旧トグル撤去）。
4. 検証：snapshot再突合＋実ブラウザ＋敵対wf → 本人実機サニティ → merge/push。
