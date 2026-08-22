# sr-merge（recon実測 2026-08-21・HEAD 8e44298）

## summary
監査 観点3-A のうち ②軸ラベル上位2本/側は直近waveで A-mini として実装済み（detail-charts.js:249/:255 `axisLabelVisible: i < 2`）・監査Bの窓統一も完了済み（:527/:263・detectSR 入力＝displayPrices）＝残スコープは ①近接マージ ③端クランプ ＋ D9再訪のみ。決定論mock OHLCV 全100銘柄で実測した結果、A-mini 後のバッジ渋滞の主因は監査想定の「同側近接」（<1%＝13%）でなく **cross-side R/S 近接（<1%＝50%）と終値バッジ近接（±1%＝61%）**＝同側マージ単独では渋滞は解消しない。①は detectSR cluster() 内の二次マージ（tol=1%・count加重平均・digest への波及は 1/100 銘柄のみ）＋チャート側ラベル greedy dedup の3点セットを提案。③D9 は乖離が常態（**72/100 銘柄で digest 引用レベルがチャート top-3 に無い**）・digest を top-3 に絞ると平均引用距離が 1.20%→2.79% に悪化し M7 テストも破壊＝不採用、「top-3 ∪ digest引用レベル」の追加描画（平均+0.89本）を推奨。②端クランプは窓統一の副作用で既定ビューの静的クリップがほぼ構造解消済み＝計測アサートのみ追加し実害確認後に対処で足りる。実DB data/investment.db に OHLCV は無い（価格は Neon market.ohlcv）ため S/R の実データ SELECT は不可＝監査と同じ mock 決定論系列（全100銘柄・銘柄別sha256）で計測した。

## notes

### 前提変化（監査 2026-08-09→現HEAD 8e44298 で変わった点）
1. **監査A②は実装済み（A-mini）**: spec §6.2・確定事項3。detail-charts.js:249/:255 で `axisLabelVisible: i < 2`（count降順 index ゲート・線とtitleは top-3/側 全本維持）。監査Aの残スコープ＝①近接マージ・③端クランプのみ（spec §12 の次waveリストに「S/R 近接マージ（監査Aフル版・完全一致化 D9 の再訪含む）」として明記）。
2. **監査Bは完了**: applySRLines 呼出は2口とも displayPrices 系（detail-charts.js:527 `applySRLines(displayPrices)`・:263 toggleSR `applySRLines(currentDisplayPrices || data.prices)`）。detail-rules.js:694-695 の stale コメントも「〔spec §6.1 窓統一済〕」に事実化済み。受入ゲート scratchpad/sr-window-verify.js が ALL PASS 前提で本番入り。
3. **file:line が全面シフト**: 監査の detail-charts.js:227-238（createPriceLine 全レベル発行）→ 現 :241-258（applySRLines 定義・R loop :246-251・S loop :252-257）。:508 applySRLines(base) → 現 :527（かつ base でなく displayPrices）。detail-rules.js:707 → 現 :697（detectSR(dp, Infinity)）。detail-rules.js:116-149（detectSR 本体・:118 slice(-252)・:140 1.5%帯・:146 count降順+slice）は無変更＝監査の記述がそのまま有効。
4. **D9 は spec §11 で「維持」を明示決定済み**（spec:301「チャート top-3 描画・digest Infinity 最寄り（M7）。完全一致化は次 wave 判断」）＝本 recon はその「次 wave 判断」の材料。
5. **③端クランプの前提が消滅気味**: 監査の「窓の高安端でバッジが上下クリップ」は全履歴基準時代（レベルが表示窓レンジ外に出る）の症状。窓統一後は S/R レベル＝窓内 pivot の平均で必ず窓レンジ内、かつ右軸 scaleMargins top:0.05 / bottom:0.25（detail-charts.js:612-614）＝narrow 220px パネルでも窓最高値の y は上端から ~11px（ラベル半高 ~8px より下）→ **既定ビューの静的クリップは構造的にほぼ起き得ない**。残余は (a) fitContent 不在（監査H・未修正）で JP FY窓 ~245営業日 > 可視 ~233本のとき先頭バーの pivot 由来レベルが可視 autoscale レンジ外に出るケース (b) ユーザーのズーム/パン。
6. **受入ゲートの固定アサート**: sr-window-verify.js:11 が `axisLabelVisible: i < 2` の出現数==2 をソース正規表現で固定＝ラベル判定式を変える本修正ではゲート更新が必須（忘れると偽FAIL）。

### 実測（決定論mock OHLCV・全100銘柄・FY2026窓・scratchpad/mock_prod_server.py build_ohlcv を忠実複製）
実DB data/investment.db は financial_data_v2/ticker_master のみで OHLCV 無し（本番価格は api/market/ohlcv.py → Neon market.ohlcv）。監査・受入と同じ mock 合成系列で ticker_master 全100銘柄を計測:
- **D9 乖離は常態**: digest（detectSR(dp,∞) 最寄り）の引用レベルがチャート描画（top-3/側）に存在しない銘柄＝**72/100**（上側のみ 59・下側のみ 30）。例: 1306.T close 4533.55 で digest 上側 4582.33×1 は top-3 外＝チャートに線が無い。
- **digest を top-3 に絞った場合（完全一致化案(c)）**: readout が変わる銘柄 72/100・上側平均引用距離 **1.20% → 2.79%**（2.3倍遠くなり実用性が落ちる）。
- **「top-3 ∪ digest引用」追加描画案(a+)**: 追加線は計 89 本/100銘柄＝**平均 +0.89 本・最大 +2 本**（クラッタ増ほぼ無し）。
- **A-mini 後の残バッジ渋滞の内訳**: ラベル出る top-2/側 ペア間 <1% ＝ 28/100。ただし内訳は同側 <1% が 13/100（<0.5% は 0）に対し **cross-side R/S <1% が 50/100・<0.5% が 15/100**、さらに **終値±1% にラベル級レベルがある銘柄 61/100**（終値バッジ埋没の主因）。監査例も NVDA R×1 5414.35 vs S×2 5409.96（0.08%・cross-side）、SPY 1672.41/1662.57（0.59%・同側）で両型。
- **同側マージ tol=1% の波及**: 全クラスタで同側隣接 <1% を持つ銘柄 36/100（<1.5% は 75/100）だが、digest readout が変わるのは **1/100 のみ**・D9 乖離数も 72→71 でほぼ不変＝マージは低リスク。tol=0.5% だと同側ヒット 0＝無意味、audit SPY 例（0.59%）も拾えない → **tol=1.0% が下限として妥当**。
- **窓端 2% 以内のラベル級レベル**: 上端 5/100・下端 10/100（＝クランプ対象は少数、かつ上記の通り静的にはクリップしない）。
- **digest の側呼称ねじれ（既存仕様の注意点）**: M7 は「全クラスタを close で上下分割」のため「直近の支持」が R クラスタ由来＝74/100、「直近の抵抗」が S クラスタ由来＝28/100。これは現状既に起きている（例: 2801.T の digest 支持 5846.08×6 ＝チャートの R×6 線）＝D9 一致化案(a+) が新たに悪化させる問題ではない。
- detectSR は同一入力で決定論（sort→greedy band→加重前の単純平均→count降順 slice）＝chart top-3 は Infinity 列の厳密 prefix（sr-window-verify.js:32-33 の subset アサートと整合）。

### 既存テストの現状
tests/detail-rules.test.js＝**96テスト・全緑（node --test 実測 fail 0）**。S/R 系は4本: :270（detectSR shape）・:418-426（maxPerSide 既定3 cap / Infinity で全クラスタ・M7）・:428-435（digest が top-3 でなく最寄りを引く・M7 の反例固定＝122 vs 150/160/170）・:437-448（digest は dp 基準で allPrices 末尾に非依存・窓統一の錠）。fixture synthSRSeries（:401-416）はレベル間隔が >1.5% のため **tol=1% の二次マージでは一切影響を受けない**（マージ実装後も4本とも緑のまま＝実測ロジックで確認済み）。

## proposal

### ① 同側近接マージ＋チャート側ラベル greedy dedup（監査A①フル版・推奨セット）
**(1a) detectSR cluster() に二次マージ（detail-rules.js:146 の直前・+8行程度）**
- 位置: `cluster()` 内、groups 構築（:143-145・価格昇順で出来る）と `sort((a,b)=>b.count-a.count).slice(0,_maxPerSide)`（:146）の間に挿入:
  ```js
  const MERGE_TOL = 0.01;   // 近接クラスタ二次マージ（監査A①・1.5%帯 greedy 分割の断片を束ねる）
  const merged = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (last && (g.price - last.price) / last.price < MERGE_TOL) {
      const c = last.count + g.count;
      last.price = (last.price * last.count + g.price * g.count) / c;  // count加重平均
      last.count = c;                                                   // count合算
    } else merged.push({ ...g });
  }
  return merged.sort((a, b) => b.count - a.count).slice(0, _maxPerSide);
  ```
- **マージ幅 1.0% の根拠**: (i) 一次クラスタ帯 1.5%（:140）の greedy base 分割は隣接平均が任意に近づく断片を残す（実測: 同側 <1% 36/100 銘柄・監査 SPY 例 0.59%）(ii) 0.5% では実測ヒット 0＝無意味 (iii) 1.5% 以上にすると一次帯を跨ぐ束ねになり意味が変わる → 1.0% は「一次帯の断片是正」に閉じる下限。
- **代表値**: count加重平均（多数 pivot 側に寄せる＝タッチ回数の意味と整合）・**強度＝count合算**（監査要求どおり）。
- **決定論性**: 価格昇順の単一パス・加重平均・slice の全段が入力決定論。マージを slice(0,_maxPerSide) の**前**（＝Infinity/3 の分岐前）に置くため、chart top-3 ⊆ digest 全クラスタの prefix 性が維持され sr-window-verify.js:32-33 の subset アサートも壊れない。digest の強度表示も自動で count 合算（単一源＝detectSR で完結・二重実装なし）。
- 既知の限界: 連鎖マージ（A-B<1%, B-C<1% で A..C が累計 >1%）は `last.price`（更新後加重平均）基準なのでドリフトは抑制されるが可能。実測で問題例なし・気にするなら「チェーン先頭基準で span 上限 1.5%」を併記実装（+2行）。
**(1b) applySRLines のラベル greedy dedup（detail-charts.js:245-257 改・+12行程度）**
- A-mini の `i < 2` 単独では cross-side（50/100）と終値近接（61/100）が残るため、ラベル判定を greedy 選抜に置換:
  ```js
  const close = prices[prices.length - 1].close;
  const cand = resistance.slice(0, 2).map((l) => ({ ...l, side: "R" }))
    .concat(support.slice(0, 2).map((l) => ({ ...l, side: "S" })))
    .sort((a, b) => b.count - a.count || Math.abs(a.price - close) - Math.abs(b.price - close) || (a.side === "R" ? -1 : 1));
  const labeled = new Set();
  for (const c of cand) {
    if (Math.abs(c.price - close) / close < 0.01) continue;                       // 終値バッジゾーンは抑制（線+titleは残る）
    if ([...labeled].some((p) => Math.abs(p - c.price) / Math.min(p, c.price) < 0.01)) continue;  // 既採用と<1%は抑制
    labeled.add(c.price);
  }
  ```
  R/S 両ループの `axisLabelVisible: i < 2` → `axisLabelVisible: labeled.has(price)` に変更。優先順位＝count降順→close近い順→R優先（全て決定論・price 完全同値はほぼ不可能だが tie-break を明記）。
- 効果（実測ベース）: ラベルペア <1% 衝突 28/100 → 0（構成上ゼロ）・終値バッジ埋没 61/100 → 0。線・title（R×n/S×n）は不変＝情報は失わない。
- **ゲート更新必須**: sr-window-verify.js:11 の `axisLabelVisible: i < 2` ==2 アサートを新式の存在確認＋「ラベル可視本数≤2/側・ペア間≥1%・終値±1%にラベル無し」の Playwright 数値アサートに書換（spec §9.2 の S/R 機械ゲート枠を拡張）。

### ② 右軸バッジの端クランプ＝「計測アサート先行・コード追加は保留」を推奨
- 窓統一（済）＋scaleMargins top:0.05/bottom:0.25（detail-charts.js:612-614）により**既定ビューの静的クリップは構造解消済み**（レベル≦窓高値→y≧pane高の5%≈11px＞ラベル半高8px・下端は25%マージン）。監査のクリップ例は全履歴基準時代の産物＝前提消滅。
- 提案: sr-window-verify.js に「既定ビューでラベル級レベルが可視 autoscale レンジ内」の数値アサートを足すのみ（E1・極小）。残余ケース＝(a) fitContent 不在（監査H・backlog）で先頭 ~12本がビュー外の JP FY窓 (b) ズーム/パン。実害が Playwright で確認されたら E2＝`priceChart.timeScale().subscribeVisibleLogicalRangeChange` で可視レンジ外レベルの axisLabelVisible を落とす動的切替（+15行・view 状態に対し決定論）を次wave で。監査H（fitContent）修正と同一 wave にすると (a) が消えるため順序推奨＝H→クランプ再計測。
### ③ D9 再訪＝「digest は Infinity 維持・チャートを top-3 ∪ digest引用に拡張」（案a+）を推奨
- **完全一致化(c)（digest→top-3）は不採用**: readout 変化 72/100・平均引用距離 1.20%→2.79%（実用性劣化）・M7 の設計意図（detail-rules.js:114-115 に明記）と錠テスト :428-435 を破壊＝製品的後退。
- **チャート→Infinity 全描画(b) も非推奨**: 線 6→12-13本/銘柄でクラッタ倍増（監査Aの逆行）。
- **推奨(a+)**: digest が引用する最寄り up/dn（±各1）を top-3 に無ければ追加描画＝「digest の数値には必ず対応する線がある」を保証し追加は平均 +0.89本。実装＝detail-rules.js に `srNearest(sr, close)`（:697-710 の最寄り選択を関数化・digest と共用＝単一源原則:378 と同型）を新設 export し、applySRLines で `detectSR(prices, Infinity)`→top-3 slice＋srNearest の和集合を描画（追加線は axisLabelVisible:false 固定・title は既存側表記のまま）。detail-rules.js +12行・detail-charts.js +10行・tests +2本。
- 採らない場合＝現状維持（spec §11 D9）でも「digest 数値がチャートに無い」不一致が72%で常態な事実を spec/所有ノートに明記しておくべき（perceived bug 抑止）。
- 注意: digest の「支持」が R クラスタ由来（74/100）等の側呼称ねじれは M7 固有で (a+) の新規問題ではないが、追加線の title（R×n）と digest 呼称（支持）の不一致が「見える」ようになる＝リリースノート/用語集（INDICATOR_GLOSSARY "sr"）に一文追加を推奨。

### 追加テスト設計（tests/detail-rules.test.js・+4本）
1. `detectSR: 近接クラスタ(<1%)を count加重平均+count合算でマージ` — synthSRSeries 型 builder で peaks {100,101.4,101.4}（一次クラスタ・平均100.93×3）と {101.6}（×1・一次帯1.5%の外）→ gap 0.66% → マージ後 {price≈101.10, count:4} を assert。
2. `detectSR: ≥1% 離れたクラスタはマージしない` — peaks {100×2} と {102.5×2} → 2クラスタ維持・count 不変。
3. `signalDigest S/R: マージ後の強度が合算 count を表示` — fixture1 で readout `強度4` を assert（digest 波及の錠）。
4. （③(a+) 採用時）`srNearest: close 上下の最寄りを返す・digest :697-710 と同値` — 既存 synthSRSeries で up=122 を assert。
既存4本（:270/:418/:428/:437）は fixture 間隔 >1.5% のため全て緑のまま（回帰錠として無改変維持）。Playwright 側は sr-window-verify.js を上記①②の数値アサートへ拡張（ラベル本数・ペア間隔・終値ゾーン・レンジ内）。

## risks
- **sr-window-verify.js:11 のソース固定アサート**（`axisLabelVisible: i < 2` ==2）が①(1b)で必ず割れる＝ゲート更新をタスクに含めないと受入が偽FAIL。subset アサート（:32-33）はマージを slice 前に置く限り不変。
- マージで既存描画がシフトする（top-3 の顔ぶれ・価格が変わる）＝before/after スナップショット比較は「変わって正しい」検分が必要（窓統一 wave の §6.3 と同じ扱い）。digest readout 変化は実測 1/100 銘柄のみだが 0 ではない。
- 連鎖マージのドリフト（累計 >1% の束ね）は理論上可能。tol を price 相対でなく「チェーン先頭基準」にすれば span 上限を保証できる（+2行・お好み）。
- ①(1b) の終値±1% 抑制は「今まさに試されている水準」のラベルを消す側面がある（線・title・digest readout は残る）。抑制対象を「終値バッジと物理衝突する場合のみ」に絞るなら価格差 1%→0.6% に緩める選択肢もある＝spec で閾値を明示決定すべき。
- ③(a+) は digest の側呼称ねじれ（支持=R由来 74%）を可視化する。用語集/注記なしで出すと「線の色と summary の呼称が合わない」という新 perceived bug を生む可能性。
- mock 系列は sine+noise の合成（銘柄間相似）＝比率系の実測値（72%・50%・61% 等）は実データで多少ブレる。ただし発生機構（greedy 分割断片・cross-side 独立クラスタ・M7 最寄り選択）はデータ非依存で、監査も同一 mock で撮影済み＝方針判断には十分。実データ最終確認は本番 Neon の ohlcv でのスポット照合を受入に一項目。
- detectSR は screener/cross-section からは未参照（detail-rules 内で digest と chart のみ）＝波及面は狭いが、tests/detail-rules.test.js の 96 本と node 全体スイートは必ず全緑確認。
- ②を「保留」にする判断は fitContent（監査H・backlog）未修正が前提条件に絡む＝H を先に入れる場合は残余(a)が消えるため、wave 順序を spec に明記しないと二度手間。

## sites
- detail-charts.js:241-258 — applySRLines 現定義（監査の :227-238 はここへシフト）。:245 detectSR(prices)＝既定 top-3
- detail-charts.js:249, 255 — A-mini `axisLabelVisible: i < 2`（監査A②実装済み）。①(1b) の書換点
- detail-charts.js:259-264 — toggleSR。:263 `applySRLines(currentDisplayPrices || data.prices)`＝窓統一済み第2口
- detail-charts.js:490 — updateMaAndVolume 定義。:502 base（MA/BB/KC 用・不可侵）
- detail-charts.js:527 — `applySRLines(displayPrices)`＝窓統一済み第1口（監査の :508 はここへシフト）
- detail-charts.js:530 — currentDisplayPrices = displayPrices（:527 より後＝closure 直読み禁止の順序罠は今も有効）
- detail-charts.js:612-614 — 右軸 scaleMargins {top:0.05, bottom:0.25}＝端クランプ「静的には起きない」根拠
- detail-charts.js:619-626 — candleSeries（lastValueVisible 既定 true＝終値バッジの発生源）
- detail-rules.js:114-115 — maxPerSide 差の意図コメント（M7）＝D9 の設計意図の正
- detail-rules.js:116-149 — detectSR 本体（無変更・監査の行番号がそのまま有効）。:118 slice(-252)・:140 一次クラスタ帯 1.5%・:143 平均+count・:146 count降順+slice＝①(1a) マージ挿入点
- detail-rules.js:694-695 — 窓統一済みを明記した更新済コメント（stale 解消済）
- detail-rules.js:697-710 — digest S/R ブロック。:697 detectSR(dp, Infinity)・:700-705 close 上下分割の最寄り選択（③の srNearest 切出し元）・:708-709 強度=count 表示
- detail.js:258, 263 — renderSignalDigest → DetailRules.signalDigest 呼出（digest 側の唯一の口）
- detail.js:675, 679 — priceWindow → updateMaAndVolume（displayPrices の供給経路）
- tests/detail-rules.test.js:270-274 — detectSR shape テスト
- tests/detail-rules.test.js:401-416 — synthSRSeries fixture（レベル間隔 >1.5%＝マージ非影響）
- tests/detail-rules.test.js:418-426 — maxPerSide cap / Infinity（M7）錠
- tests/detail-rules.test.js:428-435 — digest 最寄り選択（M7）錠＝完全一致化案(c) が破壊するテスト
- tests/detail-rules.test.js:437-448 — digest 窓基準（dp）錠
- scratchpad/sr-window-verify.js:11 — `axisLabelVisible: i < 2` ==2 のソース固定アサート＝①で要更新
- scratchpad/sr-window-verify.js:32-33 — chart top-3 ⊆ digest 全クラスタの subset アサート＝マージ位置（slice 前）なら不変
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:137-152 — §6 窓統一+A-mini の実装仕様（完了済）
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:301 — §11 D9「維持・完全一致化は次wave判断」
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:311 — §12 次wave積み残し（S/R近接マージ+D9再訪）
- docs/superpowers/audits/2026-08-09-chart-callout-audit.md:140-150 — 監査A/B 原文（A②とBは実装済み・A①③が残）
- scratchpad/mock_prod_server.py:167-210 — 決定論OHLCV生成（本計測の複製元・実DBに価格が無いための代替）
- api/market/ohlcv.py:23-37 — 本番価格の出所は Neon market.ohlcv（data/investment.db に OHLCV 無しの根拠）
