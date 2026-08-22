# B0 実測（Task 0・HEAD ec426db・コード変更前）

- 実行: `NODE_PATH=/home/shugo/node_modules node scratchpad/b0-measure.js`（viewport 1920x1080・mock 8200）
- **TIME_AXIS_H = 28 px**（LWC v4.2.3 の time-axis 行＝host > .tv-lightweight-charts > table の rows[1] 実高）
  - 根拠: macd host（登録高 110）の rowHeights = [82, 28]／他4枚（adx/atr/rsi/obv）は軸行 高さ0（rowHeights[1]=0）
  - 先行実測（plan 執筆時の同型 probe・28px 見込み）と完全一致
- **canvasCount 不変性 = true**（adx+atr=27 → +rsi(軸OFF)=34 → +macd(軸ON)=41 → +obv=48／
  deltaAxisOFF=7 deltaAxisON=7）＝軸 ON/OFF で canvas 要素数は変わらない
  - 各サブパネル host の canvases もすべて 7（adx/atr/rsi/macd/obv 個別確認済）
  - 先行実測（canvasCount 不変の見込み）と完全一致
  - **spec §12.1 層1ゲート（canvasCount 無条件不変）に例外不要** → Part B Task 8（C4）は canvasCount 不変が必須ゲートのまま
- 付随: サブパネル右 price-axis セル幅 = adx 52 / atr 46 / rsi 52 / macd 58 / obv 92 px
  - 先行見込み（adx52/atr46/rsi52/macd58/obv92）と完全一致
  - **Part B 申し送り（D24）**: OBV は生値軸のため他より広い＝`priceFormat:{type:"volume"}`（C2）で縮めた後に
    `minimumWidth:72` が効く順序。volume 化前に minimumWidth だけ入れても OBV だけ揃わない。
- 付随（補足実測・b0-measure.js には未含有・別途一時スクリプトで実測）: メインチャート（`#chart-container`）の
  右 price-axis 幅 = **66 px**（hostH=450, rowHeights=[422, 28]）。先行見込み（66）と一致。
  Task 7 の `minimumWidth:72` はメイン軸（66px）より広い＝メイン軸にも影響する点に留意（サブパネル側だけの
  変更ではなくメイン右軸も 72px 未満から拡張される）。
- pageErrors: []

## rows 詳細（b0-measure.js 生出力）

| key  | hostH | rowHeights | priceAxisW | canvases |
|------|-------|------------|------------|----------|
| adx  | 132   | [132, 0]   | 52         | 7        |
| atr  | 104   | [104, 0]   | 46         | 7        |
| rsi  | 100   | [100, 0]   | 52         | 7        |
| macd | 110   | [82, 28]   | 58         | 7        |
| obv  | 104   | [104, 0]   | 92         | 7        |
