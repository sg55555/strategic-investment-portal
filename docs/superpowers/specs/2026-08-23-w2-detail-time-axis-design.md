# W2「詳細の時間軸パック」設計 — 期間切替バー／52週レンジ／ベンチマーク重ね描き

- 日付: 2026-08-23
- ブランチ: `w2-time-axis`（worktree `.claude/worktrees/w2-time-axis`・base `2d17381`）
- 前提スレッド: UIUX刷新（W1「ポータル一目パック」→ W1.5「セクターヒートマップ」に続く W2）
- 所有ノート: Obsidian `Projects/investment-portal.md`「🎨 UIUX刷新スレッド」

---

## §1 目的とスコープ

銘柄詳細ビュー（`#detail-view`）に「時間軸を自分で選ぶ」手段を入れる。現状、価格チャートの表示期間は
**決算年度（FY）ボタンだけ**が決めており、業界標準の 1M/3M/6M/YTD/1Y/5Y/MAX が存在しない。

入れるもの（3点）:

1. **期間切替バー** — `FY | 1M | 3M | 6M | YTD | 1Y | 5Y | MAX`。FY 以外を選ぶと価格チャートと価格由来の
   カード（シグナルダイジェスト／規律テクニカル）だけがローリング窓に切り替わる。**財務3表・KPI比較・
   AI コメントは動かない**。
2. **52週レンジバー** — 直近52週の安値〜高値の中で現在値がどこにいるか。**期間切替とは独立**（常に52週）。
3. **ベンチマーク重ね描き** — JP 銘柄は 1306.T（TOPIX 連動 ETF）、US 銘柄は SPY を、**メインの価格チャートに
   同一軸で重ねる**。ON/OFF のみ（銘柄は選ばせない）。

### 非目標（YAGNI）

- 既存「⊕ 比較チャート」モーダルの期間セット拡張（3M/1Y/3Y/5Y のまま。W2 では触らない）。
- 週足・月足への間引き（§12 の実測により不要と確定）。
- 決算・配当イベントマーカー、配当情報（W4 候補）。
- FY バー（`.time-control-bar`）自体の UI 改変。
- 新しい Vercel 関数（**関数数 11/12 を維持**。既存 `/api/market/ohlcv` と `/api/market/list` だけで足りる）。

---

## §2 決定（本人承認済み・2026-08-23）

| # | 決定 | 理由 |
|---|------|------|
| **D1** | 期間バーは**チャートカード内**に置き、**既定は FY** | 既存受入（`fit-range-verify` 等）と「初期表示＝財務年度と一致した窓」という現行の意味を守る。1Y 既定にすると『チャート窓＝選択中の決算年度』という現行仕様が既定から消える |
| **D2** | FY ボタンを押したら期間バーは FY に戻る（**last-click-wins**） | 2つの入力が同じ窓を奪い合うので、優先順位を「最後に押した方」に一本化する。どちらかが無言で相手を上書きする状態を作らない |
| **D3** | ベンチマークは**メインチャートへ重ね描き**（compare モーダル拡張ではない） | 「見ているチャートに直接重なる」ことが W2 の新規価値。compare モーダルは多銘柄比較の道具として無改変で残す |
| **D4** | ベンチは**両者の共通開始日でリベース**して同一価格軸に載せる。ただし**ベンチ系列は軸の autoscale に参加させない**（`autoscaleInfoProvider: () => null`） | 無次元化されるので円建て／ドル建ての混在でも安全。乖離がそのまま相対パフォーマンスとして読める。**軸から外す理由＝ベンチ側の1本の異常値が主銘柄のローソクを潰すから**（§12.3 で実測。1306.T の異常バーで軸が -1325〜4209 まで広がりローソクが縦23%に潰れた） |
| **D5** | 期間選択は **localStorage 永続**（`sip_detail_period`・未知値は FY へ正規化） | W1.5 の `sip_*` 前例を踏襲。銘柄をまたいで同じ期間で見比べられる |
| **D6** | 52週レンジの数値は **`STOCK_DATA[ticker].px`（list API のサーバ計算値）をそのまま使う** | `portal-price-rules.js` 冒頭が明示する D9 原則＝**JS↔Py の鏡像パリティ義務を新設しない**。ポータル一覧・ヒートマップと同じ数字が出ることも同時に保証される |
| **D7** | レイアウトは**案A「デンシティ・レール」**（3案の実物比較で本人選定） | `ma-control-bar` の真上に1行だけ足す。既存ツールバー群と同族に見え、チャート高さを削らない |
| **D8** | 1306.T の異常バーは**データ側で直す**。W2 に外れ値フィルタを入れない | 無言でデータを捨てる実装は「壊れているのに緑」を生む。§14 にデータレーンの作業として切り出す。**D4 の autoscale 除外と併せることで、異常値は「線が画面外へ出る」形で見えたまま、ローソクの読みやすさだけを守れる**（データを捨てずに軸を守る） |
| **D9** | ベンチの履歴が窓より短いとき、**アンカーを共通開始日へずらし、チップに `（2009年〜）` と明示する**（描画を諦めない） | 窓先頭に貼ると「2009年の TOPIX を1999年のトヨタ株価に一致させた線」になる（実測で 7203.T の MAX が該当）。ずらしたことを黙らせない |

---

## §3 状態モデル

`detail.js` の closure private に1つ足すだけ。

```js
let selectedPeriod = readPeriod();   // 'FY' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'MAX'
let benchOn = readBench();           // boolean（既定 false）
```

- `selectedYear`（既存）は**財務年度の選択**という本来の意味だけを持ち続ける。W2 はこの変数の意味を変えない。
- 永続キー: `sip_detail_period` / `sip_detail_bench`。**読み出しは必ず正規化**する（`PERIODS` に無い値・
  `JSON` でない値は既定へ倒す）。W1.5 の次wave送り Minor「`heatMetricKey` 以外の LS 正規化」を再発させない。
- 銘柄を切り替えても期間・ベンチはリセットしない（D5）。

### 状態遷移

| 操作 | selectedYear | selectedPeriod | 再描画される範囲 |
|------|--------------|----------------|------------------|
| 銘柄を開く（`navigateToDetail`） | 実質値のある最新年へ再設定（既存） | LS から復元（変えない） | 全体（財務＋価格） |
| FY ボタン（`switchYear`） | 押した年 | **`'FY'` へ戻す**（D2） | 全体（財務＋価格） |
| 期間ボタン（1M〜MAX） | 変えない | 押した期間 | **価格系のみ** |
| 期間ボタン（FY） | 変えない | `'FY'` | 価格系のみ |
| ベンチ ON/OFF | 変えない | 変えない | ベンチ系列のみ |

---

## §4 純関数（`detail-rules.js`・既存 `priceWindow` は無改変）

すべて DOM 非依存・副作用なし。`tests/detail-rules.test.js` に `assert.deepEqual` 形式で追加する。

### 4.1 `rollingWindow(prices, periodKey)`

```
→ { periodKey, startDate, endDate, displayPrices, fallback }
```

- **アンカーは wall-clock ではなく `prices` の最終バー日**。理由: ①ETL が止まってデータが stale でも窓が
  実データより先を指さない ②テストが決定論になる。既存 `normalizeForCompare`（`detail-charts.js:174`）は
  `new Date()` 基準だが、**これは踏襲しない**（同関数は W2 では触らない）。
- `MAX` は全件（`startDate = prices[0].time`）。
- `YTD` は最終バーの年の `-01-01` 起点。
- `1M/3M/6M/1Y/5Y` は最終バー日から月を引く。**月末クランプ必須**（3/31 の1ヶ月前は 3/3 ではなく 2/28|29）。
- 窓の本数が 2 未満なら `fallback: true` として**全件**を返す（空チャートにしない）。
- `prices` が空なら `displayPrices: []`・`fallback: false`（呼び出し側が描画を skip）。

### 4.2 `rollingLabelParts(periodKey, win, isEtf)`

```
→ { main, period }   // periodLabelParts と同じ形
```

- `main` は既存 `periodLabelParts` と同じ（社名＋「歴史的ローソク足時系列」）。
- `period` は窓の実体を書く: `[直近1年 2025年8月 〜 2026年8月]` / `[年初来 2026年1月 〜 2026年8月]` /
  `[全期間 2009年1月 〜 2026年8月]`。`fallback` のときは `[データ不足のため全期間を表示]`。
- **FY のときはこの関数を通さず既存 `periodLabelParts` をそのまま使う**（FY の文言は1文字も変えない）。

### 4.3 `benchRebase(benchPrices, mainWindow)`

```
→ { points: [{ time, value }], anchorTime, covered }
```

- `mainWindow` の `[先頭.time, 末尾.time]` で `benchPrices` を切る。
- **アンカーは「両者が揃う最初の日」**（D9）＝ `anchorTime = max(mainWindow[0].time, 窓内のベンチ初日)`。
  その日以降で最初の主銘柄バーの終値 `mainBase` と、最初のベンチバーの終値 `benchBase` を使い
  `value = mainBase * bench.close / benchBase`。
- `covered = (anchorTime === mainWindow[0].time)`。`false` は「ベンチの履歴が窓より短い」ことを意味し、
  呼び出し側がチップに `（YYYY年〜）` を付ける。**黙ってずらさない**。
- 2点未満、`benchBase <= 0`、`mainBase <= 0`、主銘柄側にアンカー以降のバーが無い場合は
  `{ points: [], anchorTime: null, covered: false }`（線を描かない）。
- 丸めは小数4桁（LWC に渡す値の安定のため）。
- **外れ値の除去はしない**（D8）。異常値は線が画面外へ出る形で見えたままにし、軸は D4 の autoscale 除外で守る。

### 4.4 `benchFor(ticker, entry)`

```
→ { ticker: '1306.T'|'SPY', label: 'vs TOPIX'|'vs S&P500' } | null
```

- 市場判定は `entry.country` を優先し、無ければ末尾 `.T` で JP（`portal-price-rules.js` の `marketOf` と
  同じ規則。**ただし同関数を呼ぶ**＝規則を二重に書かない）。
- 自分自身がベンチ銘柄なら `null`（1306.T を開いているときにチップを出さない）。

---

## §5 描画パイプライン

### 5.1 `applyPriceWindow()` の抽出（`detail.js`）

現在 `updateFinancialViews()`（`detail.js:668-850`）の中に、価格系と財務系が一本の流れで混ざっている。
このうち**価格系だけ**を関数に切り出す。**move-not-rewrite**（呼び出し順・引数は現状のまま動かす）。

```js
function applyPriceWindow() {
  const data = STOCK_DATA[currentTicker];
  if (!data) return;                       // ← ガードはここだけ（現行 detail.js:670 と同じ）
  const isUS = data.country === "US";
  const prices = data.prices || [];
  const win = selectedPeriod === "FY"
    ? DetailRules.priceWindow(prices, selectedYear, isUS)
    : DetailRules.rollingWindow(prices, selectedPeriod);
  const dp = win.displayPrices;            // 空でも下へ進む（★下の注記）

  // タイトル副題（FY は既存関数・ローリングは新関数）
  paintStockTitle(win, data, isUS);

  DetailCharts.setCandleData(dp);          // [] ならローソクが消える＝正しい
  DetailCharts.updateMaAndVolume(dp, prices);
  renderSignalDigest(dp, prices);
  renderDisciplineCard(dp, prices);
  paint52wBar(data);                       // §8
  applyBench(dp, data);                    // §7
}
```

> ★**空窓でも描画を止めてはいけない**。現行 `updateFinancialViews` は価格が空でも `#stock-title` 書換・
> `setCandleData([])`・`renderSignalDigest([], …)` まで**無条件に**走る（`detail.js:696-728`）。ここで
> `if (!dp.length) return;` のような早期 return を足すと、価格ゼロの銘柄へ遷移したときに**前銘柄の
> タイトル・ローソク・シグナルカードが残る**（別会社の画面に前の銘柄のチャートが出る）。
> `data.prices` は `api/market/list.py:165` が全銘柄に `"prices": []` を入れており、`navigateToDetail`
> は `getStock` の失敗を握って続行する（`detail.js:613`）ので、**ohlcv の通信エラー1回で到達する**。
>
> ⚠ **訂正（最終レビューで判明・2026-08-24）**: 当初ここには「`updateMaAndVolume` は自身が空を早期
> return するので、そこは現状のままでよい」と書いていたが、**その早期 return（`detail-charts.js:579`）
> こそが残像の本体**だった。空で return すると出来高・MA・BB・KC・VWAP・S/R 価格線・ZigZag・サブパネル・
> `currentDisplayPrices` が一切更新されず、**「Apple」という見出しの下にトヨタの円建てチャートが出る**
> （実測で再現）。W2 起因ではない既存欠陥だが、W2 の受入が「残像を残さない」と主張した以上、主張と実態を
> 一致させる必要がある。→ 空入力では**全系列を空でクリアしてから return** する。

`updateFinancialViews()` は該当ブロックを `applyPriceWindow()` の呼び出しに置き換える。**`repaint()`・
`injectTermHelp()`・`initSubpanelUI()`・`renderRelativePosition()` は現在の位置のまま**（`repaint` は
entrance アニメ対策で navigate 経路にだけ要る＝期間切替では呼ばない。§13 参照）。

### 5.2 期間ボタンのハンドラ

```js
function setPeriod(key) {           // 期間バーのボタンから（closure onclick）
  if (!PERIODS.includes(key)) return;
  selectedPeriod = key;
  writePeriod(key);
  paintPeriodButtons();
  applyPriceWindow();               // 財務3表には触らない
}
```

`switchYear(year, event)` の末尾で `selectedPeriod = "FY"; writePeriod("FY"); paintPeriodButtons();` を
行ってから `updateFinancialViews()` を呼ぶ（D2）。

### 5.3 窓に追従するもの／しないもの（現行仕様の確認・W2 で変えない）

| 系統 | 計算 | 期間切替での挙動 |
|------|------|------------------|
| S/R・ZigZag(T/R)・VWAP・出来高の陽陰 | **窓を直接消費** | 窓が変わると検出結果そのものが変わる（意図どおり） |
| MA5/25/75・BB・KC・RSI・MACD・ADX・ATR・OBV | 全履歴で計算→窓境界で filter | 値は窓に依存しない。表示範囲だけ変わる |
| OBV | 全履歴計算→窓先頭で 0 に再アンカー | 期間を変えるたび 0 基準が移る（`detail-charts.js:427` のコメントどおりの意図的仕様。W2 でも維持） |
| VWAP | 窓先頭がアンカー | 「選んだ期間の起点からの VWAP」になり、期間バーの意味と一致 |

**この2系統を混同した実装をしない**こと。特に「窓を直接消費」する4系統は、`setVisibleLogicalRange` で
見た目だけ動かす実装にすると解析結果と画面が食い違う（§13 R1）。

---

## §6 UI（案A「デンシティ・レール」）

`index.html` の MARKET CHART カード内、`#stock-title` と `.ma-control-bar` の**間**に1行足す。

```
期間 │ FY │ 1M 3M 6M YTD 1Y 5Y MAX │ 52W ¥2,601 ▬▮▬ ¥3,886 36% 高値まで 21.1% │    [— vs TOPIX]
```

- ボタンは `#year-controller-box` と同じ **JS 生成＋closure onclick**（`detail.js:625-633` のパターン）。
  inline `onclick` 属性を増やさない＝`window` 公開面（F2 規律）を増やさない。
- **`.ctrl-pair` / `.term-help` の構造は使わない**（`toolbar-terms-verify.js` が `.ma-control-bar` 内の
  `.ctrl-pair > .term-help` を4件に固定アサートしているため）。用語ヘルプが要るなら別クラスで足す。
- FY ボタンだけアンバー系、1M〜MAX はシアン系（**FY だけ意味が違う**＝財務3表と同期している唯一の状態、を
  色で示す）。
- 390px: 期間セグメントは横スクロール（タップ標的 36px 以上）、52週は次の行へ折り返す。**横スクロール禁止**
  （ページ全体の `scrollWidth` は増やさない）。
- 実測カード高さ: PC **+37px**（1208→1245）／390px **+45px**。`#chart-container` の高さ（450/260/220/190px）
  には触れない。
- CSS は `detail.css` に追加する（モックの `body[data-w2v="a"]` 接頭辞は**外す**）。色は `--ix-*` トークンのみ。

---

## §7 ベンチマーク重ね描き

### 7.1 系列の持ち方（`detail-charts.js`）

- `initPriceChart()` で `benchSeries = priceChart.addLineSeries({...})` を**1本だけ**作る（銘柄・期間を
  またいで使い回す。生成/破棄を繰り返さない）。
- 見た目: `color: var(--ix-indigo-bright)` 相当 `#8aa0ff` / `lineWidth: 1` / `lineStyle: Dotted` /
  `priceLineVisible: false` / `lastValueVisible: false` / `crosshairMarkerVisible: false`。
  **右軸にバッジを出さない**（W1.5 直前の wave で compare の「バッジ8連」を潰した判断と同じ向き）。
- **`autoscaleInfoProvider: () => null` を必ず付ける**（D4）。ベンチ系列は右軸を共有するが、**軸の範囲決定には
  参加しない**。付けないと、ベンチ側の1本の異常値（§14）で軸が引き伸ばされ、主銘柄のローソクが縦に潰れる。
  実測（7203.T・1Y・ベンチON）＝参加させると軸 `-1325〜4209`（ローソクは縦23%）、外すと `2112〜4031`。
  LWC v4.2.3 で動作することを実機で確認済み（`scratchpad/w2-variants.js` の `benchOptions()`）。
  代償＝ベンチが主銘柄から大きく乖離した窓では線がペイン外にはみ出して見切れる。これは**許容**（軸の主権は
  常に主銘柄にある、が正しい）。
- 公開 API を2つ足す: `setBenchData(points)` / `clearBench()`。`window.DetailCharts` の export に追加。

### 7.2 取得と世代ガード（`detail.js`）

```js
let benchGen = 0;
function applyBench(displayPrices, data) {
  const gen = ++benchGen;                  // ★ 全経路の先頭で進める（下の注記）
  const ticker = currentTicker;
  const b = DetailRules.benchFor(currentTicker, data);
  paintBenchChip(b);                       // ベンチ自身を開いていればチップごと非表示
  if (!b || !benchOn || !displayPrices.length) { DetailCharts.clearBench(); return; }
  getStock(b.ticker).then((bd) => {
    if (gen !== benchGen || currentTicker !== ticker || !benchOn) return;   // ← 三重ガード
    const r = DetailRules.benchRebase(bd?.prices || [], displayPrices);
    DetailCharts.setBenchData(r.points);
    paintBenchChip(b, r.covered ? null : r.anchorTime);   // 非カバー時は「（2009年〜）」を付ける
  }).catch(() => {
    // ⚠ .then と同じガードを掛ける（gen だけだと下の★2の穴が開く）
    if (gen !== benchGen || currentTicker !== ticker) return;
    DetailCharts.clearBench();
    benchOn = false; writeBench(false); paintBenchChip(b);   // 押下状態を残さない
  });
}
```

> ★1 **世代トークンは早期 return より前で進める**。`++benchGen` を「ON のときだけ」進める書き方にすると、
> ①ON にする → fetch 開始（gen=1）→ ②すぐ OFF（clearBench だけで gen は 1 のまま）→ ③fetch 着弾で
> `gen === benchGen` が成立して**消したはずの線が復活する**。着弾側で `!benchOn` も見て二重に塞ぐ。
> 銘柄をまたぐ取り違えは束D層2 で実際に踏んでいる（`cross-task-async-stale-response-guard`）。
>
> ★2 **`.catch` にも `.then` と同じガードを掛ける**（Task 8 のレビューで捕捉）。`navigateToDetail` は
> `currentTicker` を `await getStock()` より**前**に同期更新する（`detail.js:622`）のに対し、遷移先の
> `applyPriceWindow`（＝`benchGen` を進める唯一の経路）は `getStock` 解決後さらに 150ms 遅延で走る
> （`detail.js:659-661`）。この間は **`currentTicker` は新銘柄・`benchGen` は旧銘柄のまま**という空白に
> なる。ここで旧銘柄のベンチ fetch が reject すると、`gen` だけのガードは素通りし
> `benchOn = false; writeBench(false)` が走って**遷移先の銘柄のベンチが、ユーザー操作なしに OFF になる**
> （localStorage にも "0" が書かれて持続する）。`.then` と `.catch` はどちらも同じ非同期操作の着弾なので、
> ガードを非対称にしない。

- **世代トークン＋ticker 照合の二重ガードは必須**。束D層2 で「銘柄 A の非同期結果が銘柄 B の画面に描かれる」
  実バグを踏んでいる（`cross-task-async-stale-response-guard`）。ベンチは fetch を伴うので同じ穴が開く。
- 取得失敗（ネットワーク・404）は**線を消すだけ**でチャート全体は落とさない。チップは押下状態のまま
  残さず OFF に戻す。
- `getStock` は `_mktHydrated` でメモ化されるため、**ベンチの ohlcv 取得はセッション中1回**。

### 7.3 転送量（実測・§12）

| ベンチ | 行数 | 履歴 | 圧縮後 |
|--------|------|------|--------|
| 1306.T | 4,329 | 2009-01-05〜 | 約105KB |
| SPY | 8,448 | 1993-01-29〜 | 約231KB |

チップを初めて ON にしたときだけ発生する。boot・銘柄遷移では発生しない。

---

## §8 52週レンジバー

- データ源は `STOCK_DATA[currentTicker].px`（D6）。`hi52` / `lo52` / `pos52` / `dh` / `last` / `date`。
- 整形は `PortalPriceRules.fmtDistHigh(dh)` と `clampPos(pos52)` を**そのまま呼ぶ**（自前で書かない。
  実装中に `dh` の符号を取り違えた＝`dh` は負が「高値より下」）。
- `pos52 == null`（`_PX_MIN_52W_ROWS = 60` 未満の新規上場等）は**バーごと非表示**。
- 鮮度は `PortalPriceRules.isStale(px, DATA_MARKET_ASOF, marketOf(...))` で判定し、stale なら終値日を注記。
- **期間バーとは独立**（1M を選んでも 5Y を選んでも常に直近52週）。この独立性を UI 上も誤解させない
  （レールの中で視覚的に区切る）。

---

## §9 劣化と例外

| 状況 | 挙動 |
|------|------|
| `data.prices` が空（価格未収録・ohlcv 取得失敗） | **空窓で描き直す**＝タイトルは新銘柄の「価格データ未収録」文言、ローソクは消える、解析カードは「データ不足」。前銘柄の残像を残さない（§5.1 の★） |
| ベンチの履歴が窓より短い（MAX で TOPIX が 2009年〜） | アンカーを共通開始日へずらし、チップに `（2009年〜）` を付ける（D9）。線は 2009年から描かれる |
| ベンチが主銘柄から大きく乖離（MAX で指数が数十倍等） | 線がペイン外へ出て見切れる。**軸は主銘柄が持つ**（D4）。潰れた読めないローソクより見切れた線を選ぶ |
| 窓の本数が 2 未満（1M で薄い銘柄） | `fallback: true` → 全件を描き、副題に「データ不足のため全期間を表示」 |
| `px` 欠損 / `px_error: true` | 52週バーのみ非表示。期間バーとベンチは動く |
| ベンチ取得失敗 | 線を消し、チップを OFF に戻す。チャート本体は無傷 |
| ベンチ自身を開いている（1306.T / SPY） | チップごと非表示 |
| 財務欠損年・ETF | 期間バー・52週・ベンチはすべて動く（価格だけで成立するので `!fin` の early-return より前で処理する。既存 `renderSignalDigest` と同じ配置規律） |

---

## §10 既存受入への影響

| 受入 | 影響 | 対応 |
|------|------|------|
| `fit-range-verify.js` | **無傷**（既定 FY＝現行挙動を変えないため） | そのまま |
| `titles-verify.js` | `.stock-title-sub` を `^\[.*経営期間トレンド\]$` で固定アサート。ローリング時は文言が変わる | **意図的に更新**＝FY 時は現行の正規表現、ローリング時は `^\[(直近|年初来|全期間|データ不足).*\]$` を検査する2ケースに拡張 |
| `toolbar-terms-verify.js` | `.ma-control-bar` 内 `.ctrl-pair > .term-help` = 4件 | 期間バーはこの構造を使わないので**無傷**（§6） |
| `detail-snapshot.js` | `#detail-view` に DOM が増えるので必ず DIFF | 実装後に `capture` で**再ベースライン**（正当な差分） |
| `compare-verify.js` | compare モーダルに触らないので無傷 | そのまま |
| `wave-closure.sh` | 4行目の `cd` 先が既に削除済みの worktree `uiux-chart-sweep` を指す**stale 参照** | **この worktree の絶対パスへ書き換える**（`git rev-parse --show-toplevel` は main から叩くと W2 を含まないツリーを検査して ALL GREEN を返すので使わない）。加えて下の★ |

> ★**worktree で `wave-closure.sh` を回す前に `data/investment.db` を用意する**。この DB は gitignore されて
> いるので worktree には存在せず、`mock_prod_server.py`（:8200）が全 API で 500 を返して受入15本が全滅する。
> main チェックアウトの実体を symlink する（`ln -s ../../../data/investment.db data/investment.db`）。
> 併せて `wave-closure.sh` の起動ゲートを「200 が返る」ではなく
> `curl -sf http://127.0.0.1:8200/api/market/list | grep -q '"stocks"'` にして、DB 欠落なら即 ABORT させる
> （**鯖は上がっているが中身が空**という「起動できたから緑」の穴を塞ぐ）。

---

## §11 テスト計画

### 11.1 node ユニット（`tests/detail-rules.test.js`）

- `rollingWindow`: 各キーの境界（含む/含まない）、YTD の年跨ぎ、MAX 全件、**月末クランプ**（3/31→2/28・
  うるう年 2/29）、2本未満の fallback、空配列、未知キー。
- `rollingLabelParts`: 各キーの文言、fallback 文言、ETF 分岐。
- `benchRebase`: 正常（`covered: true`）、**ベンチ履歴が窓より短い（`covered: false` とアンカー日）**、
  窓外のみ、1点、`benchBase<=0`、`mainBase<=0`、窓の端一致、主銘柄とベンチで営業日がズレる場合
  （JP/US の祝日差＝アンカー日に相手のバーが無い）。
- `benchFor`: JP/US/`country` 欠落時の `.T` フォールバック、自分自身が bench のとき `null`。

### 11.2 ブラウザ受入（`scratchpad/w2-smoke.js`）

モック鯖 `scratchpad/w2-mock-server.py`（**本番 API を GET プロキシ**）の上で実行する。合成データを使わない
理由＝`mock_prod_server.py` の合成価格は 600 本（約1.64年）しかなく、**5Y と MAX が区別できず「切り替わって
いないのに緑」になる**（受入ハーネスの fixture ドリフト）。

> ⚠ `w2-mock-server.py` は index.html に**比較ハーネス `w2-variants.js` を必ず注入する**。本実装の受入を
> そのまま回すと、実装した期間バーと案A のモック期間バーが**二重に mount され、LS キーも同じ**ものを奪い合う。
> **`W2_INJECT=0` の環境変数スイッチを鯖に足し、`w2-smoke.js` は必ず注入 OFF で起動する**こと
> （§15 の変更ファイルに `w2-mock-server.py` を含める）。

- 期間8個が揃う／既定が FY ／押すと可視レンジのバー数が単調に増える（1M < 1Y < 5Y < MAX）。
- **FY ボタンを押すと期間バーが FY に戻る**（D2 の回帰）。
- LS 復元（リロード後も期間が残る／未知値を書き込んでも FY に落ちる）。
- 52週バーが実データで埋まる／`pos52` null 銘柄で非表示。
- ベンチ ON で線が実データで描かれる（点数 > 0）・OFF で消える・**銘柄を素早く切り替えても前銘柄のベンチが
  残らない**（世代ガードの回帰）・**ON→即OFF で線が復活しない**（§7.2 の★の回帰）。
- **価格ゼロの銘柄へ遷移したとき、前銘柄のタイトル／ローソク／解析カードが残らない**（§5.1 の★の回帰）。
  `STOCK_DATA[t].prices = []` に細工して遷移させる。
- **ベンチ ON でも主銘柄のローソクが潰れない**＝軸の下端が主銘柄の窓内最安値の 0.5 倍を下回らない
  （D4 の autoscale 除外の回帰。`series.coordinateToPrice` で軸レンジを読む手口は
  `w2-variants.js` の `axisProbe()` を流用）。
- PC 1440px と 390px の両方で構造検査＋**横はみ出し 0**。
- pageerror ゼロ。

### 11.3 既存スイート

- `node --test tests/*.test.js`（現在 381 pass）／`pytest`（236・API 非接触なので不変のはず）。
- `scratchpad/wave-closure.sh`（受入15本＋detail-snapshot）を **cd 修正後・`data/investment.db` を
  symlink してから**一括実行（§10 の★）。**`w2-smoke.js` はこれに含めない**＝別の鯖（:8220・本番プロキシ）
  と別ポートで動くため。wave-closure とは独立に走らせ、両方の緑を wave の完了条件にする。

---

## §12 実測値（設計判断の根拠・2026-08-23 に本番データで測定）

`scratchpad/w2-data-probe.py` と Playwright 実測。

- **ohlcv は全履歴が返る**（日付境界なし・`api/market/ohlcv.py:26-29`）。1306.T=4,329本／SPY=8,448本／
  AAPL=11,515本。**MAX 期間に追加 API は不要**。
- **MAX 窓の再描画コスト**: 7203.T（6,818本）**150ms**／SPY（8,448本）**179ms**（1M は 73-94ms）。
  S/R・ZigZag を全件で回しても同期 200ms 未満 → **週足への間引きは不要**（非目標に確定）。
### 12.1 圧縮率（ベンチのリベース後値域 ÷ ローソク値域。1.0 なら影響なし）

**⚠ この表は §14 の異常バーを除いた「データが正しければ」の値**（`w2-data-probe.py` が測定前に除去している）。

  | | 1M | 6M | 1Y | 5Y | MAX |
  |---|---|---|---|---|---|
  | 7203.T vs 1306.T | 0.50 | 0.59 | 0.91 | 1.01 | 0.17 |
  | 6758.T vs 1306.T | 0.36 | 0.72 | 0.96 | 1.09 | 0.85 |
  | AAPL vs SPY | 0.48 | 0.58 | 0.44 | 0.69 | 0.01 |
  | NVDA vs SPY | 0.35 | 0.58 | 0.57 | 0.10 | 0.00 |

### 12.2 同じ測定を**異常バー込み**（＝今の本番データ）でやり直すと

  | | 6M | 1Y | 5Y | MAX |
  |---|---|---|---|---|
  | 7203.T vs 1306.T | **3.02** | **2.88** | 1.49 | 0.18 |
  | 6758.T vs 1306.T | **3.69** | **3.04** | 1.61 | 0.90 |

JP 銘柄は 6M/1Y/5Y と**既定の FY 窓**（JP は前年4月〜当年3月＝2026-03-30/31 を含む）が汚染される。
つまり「異常バーは JP のベンチをほぼ全期間で壊す」。**§12.1 だけを根拠に D4 を『安全』と結論するのは誤り**
だった（spec 敵対レビューで捕捉。3レンズが独立に同じ穴を指摘）。

### 12.3 軸の autoscale を実測（7203.T・ベンチON・異常バーを含む今の本番データ）

| 窓 | ベンチを autoscale に参加させる（既定） | `autoscaleInfoProvider: () => null` |
|----|------------------------------|-------------------------------|
| 1Y | 軸 `-1325 〜 4209`（ローソクは縦の約23%に潰れる） | 軸 `2112 〜 4031`（ローソクがペインを満たす） |
| FY | 軸 `-1299 〜 4199` | 軸 `1347 〜 4069` |

→ **D4 の結論は「同一軸に載せるが、軸決定には参加させない」**。これならデータを捨てず（D8）、軸も守れる。
§14 のデータ修正は依然として必要だが、**W2 のブロッカーではなくなる**。

---

## §13 リスクと申し送り

- **R1（最重要）**: 期間切替を `setVisibleLogicalRange` だけで実装してはいけない。S/R・ZigZag・
  `renderSignalDigest`・`renderDisciplineCard` は **displayPrices 配列そのもの**を窓として受け取るため、
  見た目だけズームすると「チャートは1ヶ月・解析は1年」という無言の食い違いになる。必ず `setData` 差し替え。
- **R2**: `renderSignalDigest` / `renderDisciplineCard` は `updateMaAndVolume` の**外**で呼ばれている
  （`detail.js:719,728`）。期間切替の経路でこの2つの再呼び出しを落とすと、チャートだけ新しい窓・カードだけ
  古い窓、という無言の不整合になる。`applyPriceWindow()` に必ず含める（§5.1）。
- **R3**: `DetailCharts.setCandleData()` だけを呼んで `updateMaAndVolume()` を経由しない実装にすると、
  `detail-charts.js:52` の `currentDisplayPrices` が更新されず、ローソク発光・S/R トグルの再描画・新規
  マウントするサブパネルの初期データが**1つ前の窓のまま**ズレる（クラッシュしないので気づきにくい）。
- **R4**: `repaint()`（`forceChartRepaint`）は最大1900ms の多重再描画。期間ボタンから呼ばない（連打で
  積み上がる。再入ガードが無い）。FHD 黒面は entrance アニメ由来なので期間切替とは無関係。
- **R5**: `navigateToDetail` は `resizePrice(container.clientWidth, 450)` の 450 を**ハードコード**しており
  CSS（`detail.css:53-56`）と二重管理。期間バーでカード構成は変わるが `#chart-container` の高さには触れない
  ため今回は無害。触らないこと。
- **R9**（最終レビューで発見・要修正）: LWC v4.2.3 の **`minBarSpacing` 既定 0.5px/bar** が `fitContent()` を
  クランプするため、**`ペイン幅 ÷ 0.5` 本より多い窓は先頭が切り捨てられる**。副題は窓の論理的な始点を
  書くので、**表示と文言がずれる**（実測: 1440px で MAX は常に 2,555本＝7203.T の左端が 1999年でなく
  2016-04-05／**390px では 5Y と MAX がどちらも 535本＝画面が1ピクセルも変わらない**のに別の期間を名乗る）。
  → `timeScale` に `minBarSpacing: 0.02` を指定して解消（実測で全ケース主張どおりになることを確認）。
  受入の単調性検査（`1M < 1Y < 5Y < MAX`）は 1440px でしか走っていなかったため検知できなかった＝
  **390px でも回すこと**。
- **R6**: LWC v4.2.3 は `maxBarSpacing` 非対応。少数バー（1M で薄い銘柄）のローソク幅は既存
  `DetailRules.fitLogicalRange` が吸収する（`updateMaAndVolume` 末尾で毎回再計算されるので追加改修不要）。
- **R8**（Task 3 のレビューで発見・実装は現状のまま）: `covered: true` は「アンカーが窓先頭から動かなかった」
  ことだけを意味し、**アンカー当日のベンチ終値が健全であることは保証しない**。異常バーが窓の中盤にあれば
  その1点だけが飛ぶが、**アンカー当日に一致すると系列全体が定数倍ズレる**（1/10 の異常値がアンカーなら
  線全体が10倍に浮く）。現データでは到達しない（1306.T の異常日 2015-01-05／2026-03-30／2026-03-31 は、
  標準の窓起点にも 1306.T の初日 2009-01-05 にも一致しない）が、**§14 のデータ修正が済むまでは
  「ベンチ線が丸ごと不自然な高さにある」という壊れ方があり得る**ことを承知しておく。D8（無言でデータを
  捨てない）を維持するため純関数側では手当てしない。
- **R7**: `benchFor` が `PortalPriceRules.marketOf` を呼ぶなら、`detail-rules.js` が node テストから
  そのシンボルへ到達できる配線を**同じ変更で**用意する（`tests/detail-rules.test.js` は
  `global.FinanceRules = require("../finance-rules.js")` を先に置く流儀。`PortalPriceRules` も同様に
  注入する）。到達できないまま書くと §11.1 のユニットが即落ちる。
- **申し送り（モック由来の知見）**: `LightweightCharts` の名前空間オブジェクトは凍結されており、
  `createChart` を差し替えられない（Proxy も不変条件違反で不可）。**本実装では不要**だが、将来テスト用に
  チャート実体を掴みたくなったら「名前空間の浅いコピーで置き換える」しかない（`w2-variants.js` に実装例）。

---

## §14 データレーン（W2 の外・本人ローカル作業）

**1306.T に異常バーが3本ある**（`scratchpad/w2-data-probe.py` で検出）。

| 日付 | 終値 | 前後中央値 | 比 |
|------|------|-----------|-----|
| 2015-01-05 | 98.05 | 541.65 | 0.181 |
| 2026-03-30 | 36.93 | 375.63 | 0.098 |
| 2026-03-31 | 36.44 | 376.07 | 0.097 |

- 分割の未調整と思われる（1日だけ 1/10 になって翌日戻る）。
- **今の本番でも 1306.T 自身のチャートに刺さって見えているはず**で、W2 とは独立に直す価値がある。
- W2 のベンチは全 JP 銘柄で 1306.T を使うため、直すまでは JP 銘柄のベンチ線に同じスパイクが出る
  （D4 の autoscale 除外により**ローソクは潰れない**。線が一瞬ペイン外へ落ちる形で見える）。
- 他7銘柄（7203/6758/8306/9984/SPY/AAPL/NVDA）は異常ゼロ。ユニバース全体の走査は未実施。
- D8 のとおり **W2 側に外れ値フィルタは入れない**（無言でデータを捨てない）。

---

## §15 変更するファイル

| ファイル | 変更 |
|----------|------|
| `detail-rules.js` | `rollingWindow` / `rollingLabelParts` / `benchRebase` / `benchFor` を追加＋UMD export |
| `detail-charts.js` | `initPriceChart` に benchSeries を1本追加／`setBenchData` `clearBench` を追加＋export |
| `detail.js` | `selectedPeriod` / `benchOn` 状態、`applyPriceWindow()` 抽出、`setPeriod` / `toggleBench` / 期間バー生成 / 52週バー描画 / `switchYear` の FY 復帰 |
| `index.html` | MARKET CHART カード内にレール1行の markup |
| `detail.css` | 案A の CSS（`body[data-w2v]` 接頭辞を外して移植） |
| `tests/detail-rules.test.js` | §11.1 のユニット |
| `scratchpad/w2-smoke.js` | §11.2 の受入（新規） |
| `scratchpad/titles-verify.js` | ローリング時の副題を許容する2ケースへ拡張 |
| `scratchpad/wave-closure.sh` | stale な `cd` 先をこの worktree の絶対パスへ修正／起動ゲートを `"stocks"` 検査に変更（`w2-smoke.js` は**含めない**＝別鯖・別ポート） |
| `scratchpad/w2-mock-server.py` | `W2_INJECT=0` で比較ハーネスの注入を止めるスイッチを追加（受入はこれで起動） |

### 実物比較の資産（リポに残す）

- `scratchpad/w2-mock-server.py` — 本番 API を GET プロキシするモック鯖（:8220）
- `scratchpad/w2-variants.js` — 3案の markup/CSS＋配線（**採用は案A**。B/C は比較資産として残す）
- `scratchpad/gen-w2-defs.py` — 案定義の貼付スクリプト
- `scratchpad/w2-mock-smoke.js` — 3案が動くことの検査
- `scratchpad/w2-data-probe.py` — §12・§14 の実測
