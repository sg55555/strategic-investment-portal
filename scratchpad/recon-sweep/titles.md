# titles（recon実測 2026-08-21・HEAD 8e44298）

## summary
- G1 二重ティッカー: 実DB照会で括弧入り社名は3件（SPY/QQQ/GOOGL）。文字どおりの「(ticker) (ticker)」二重は **SPY のみ**（QQQ/GOOGL は括弧連鎖の見苦しさで別質）。該当箇所は detail.js:665（ヘッダ）と detail-rules.js:447,449（チャートタイトル）＝直近waveで行番号のみズレ・症状は現存（spec の残backlog「タイトル二重ティッカー」に明記＝wave では意図的に未修正）。
- G2 フォールバック注記: priceWindow は detail-rules.js:433-439 に純関数化済（displayPrices 統一）。フォールバック時のタイトル「直近市場ローソク足時系列」に年ズレ注記なし＝症状現存。ただし**現データでは空窓が発生する組合せゼロ**（価格 2021-05-19〜2026-05-18・最古FY2022 JP 窓は 2021-04〜2022-03 で重なる）＝latent bug。ETF は financials_trend={} → selectedYear=2025 固定で「経営期間トレンド [2025年…]」＋年ボタン0本＋「2025 FY」表示＝不自然文言は現存・実害あり。
- G3 narrow 3行折れ: #stock-title は .card-title（index.html:598/930・≦768px で 12px/letter-spacing:1px）1行 innerText のまま＝症状現存。期間注記の副題行分離は未実装。
- 監査の修正方針3件とも有効。前提変化は「行番号ズレ」「priceWindow/displayPrices 純関数化（修正の実装点が detail-rules.js に集約され楽になった）」「G2 が現データでは latent」の3点。
- 見積り: G1=極小（〜20行+テスト）・G2=小（文言分岐+ETF専用文言）・G3=小（2span化+CSS 10行+テスト書換）。合計 半日弱。

## notes

### G1 二重ティッカー（実DB照会）
```sql
SELECT ticker, company_name FROM ticker_master WHERE company_name LIKE '%(%';
-- GOOGL|Alphabet (Google)
-- SPY|S&P 500 ETF (SPY)
-- QQQ|Invesco QQQ (NASDAQ 100)
```
- 監査どおり3銘柄該当。ただし内訳を精査すると:
  - **SPY**: 社名内括弧＝ティッカーそのもの → 「S&P 500 ETF (SPY) (SPY)」= 真の二重。監査の修正案「company_name に (ticker) が含まれる場合は付加省略」が文字どおり効くのは **SPY のみ**。
  - **QQQ**: 括弧内は「NASDAQ 100」→ 「Invesco QQQ (NASDAQ 100) (QQQ)」。二重ではなく括弧連鎖。
  - **GOOGL**: 括弧内は「Google」→ 「Alphabet (Google) (GOOGL)」。同上。
- 表示箇所（現HEAD実測）:
  - detail.js:665 — ヘッダ `company-title-main`。`${esc(data.company_name)} <span style="...font-size:12px;">(${currentTicker})</span>`（監査の :663 から2行ズレ・ticker span は今waveで 12px インラインスタイル化済＝監査注記どおり）。
  - detail-rules.js:442-450 `periodLabel` — 両分岐とも `${companyName} (${ticker}) - ...`（監査の :446-448 → 現 :447/:449）。
  - 副次サイト（監査対象外だが同根）: detail.js:49（比較検索リスト `${t} — ${company_name}` → 「SPY — S&P 500 ETF (SPY)」は許容範囲）・detail.js:82（比較チップ＝社名のみで無害）。
- financial_data_v2 に SPY/QQQ の行なし（ETF）＝ GOOGL のみ FY2023-2025 の3行。

### G2 フォールバック窓と注記の不一致
- 現実装（displayPrices 統一後）:
  - detail-rules.js:433-439 `priceWindow(prices, selectedYear, isUS)` — US=暦年/JP=前年4月〜3月で filter、`displayPrices = filteredPrices.length > 0 ? filteredPrices : prices.slice(-200)`。
  - detail.js:674-677 — `priceWindow` の戻りを分割代入し、`periodLabel(..., filteredPrices.length > 0)` でタイトル決定。監査の「detail-rules.js:436-437 + detail.js:638-643」は現HEADでこの2箇所に対応（detail.js 側は :674-679 へ移動）。
  - フォールバック時のタイトル＝detail-rules.js:449「`${name} (${ticker}) - 直近市場ローソク足時系列`」のみ。年ボタン active・`selected-year-display`（detail.js:671「`${selectedYear} FY`」）は選択年のまま＝**注記と実窓の不一致は現存**。
- **現データでの発生条件を実測**: data-bundle.js の価格は全銘柄 2021-05-19〜2026-05-18（1255本・5年ローリング）。FY分布は FY2022:2銘柄(2502.T/9843.T・JP)〜FY2026:15銘柄。最悪ケース JP FY2022 の窓=2021-04-01〜2022-03-31 は価格開始 2021-05-19 と重なり **filteredPrices 非空**。US に FY2021 以前なし。→ **現在フォールバック分岐に入る実データの組合せは0件（latent）**。ただし価格窓が5年ローリングで前進するため、2027年頃に JP FY2022 窓が空になり顕在化する。監査時点(32eb0ae)も同様に latent だった可能性が高い（監査はコードリーディング＋人工条件由来とみられる）。
- **ETF の「経営期間トレンド」**（顕在・実害あり）: SPY/QQQ は `financials_trend={}` → detail.js:605-606 で `availableYears=[]` → `selectedYear=2025`（ハードコードfallback）→ 2025暦年窓は非空 → タイトル「S&P 500 ETF (SPY) (SPY) - 歴史的ローソク足時系列 [2025年1月 〜 2025年12月 経営期間トレンド]」。ETF に「経営期間」は不自然＝監査指摘どおり現存。加えて年ボタン0本なのに `time-control-bar` は表示され「2025 FY」が出る（detail.js:671）。
- テスト: tests/detail-rules.test.js:23-70 に priceWindow×3・periodLabel×3 の文字列一致アサートあり＝文言変更時は書換必須。

### G3 narrow 3行中途折れ
- #stock-title は index.html:1219 `<div class="card-title" id="stock-title">`。スタイルは .card-title（index.html:598-607: 0.8rem/uppercase/letter-spacing:2px、narrow ≦768px は index.html:930: 12px/letter-spacing:1px）。detail.css 側に #stock-title 固有セレクタは無し。
- タイトル全文（例 GOOGL）は約60字。CJK は任意点で折返すため narrow(≦480px, #chart-container 220px)で「ローソク足時/系列」等の中途折れ3行＝監査指摘の構図は現存。書込みは detail.js:676-677 の innerText 1箇所のみ（他に #stock-title を書く箇所なし・data-term span も無いので innerHTML 化は安全）。

## proposal

### G1: 表示名ヘルパ + DB社名整理の併用（工数: 極小）
1. detail-rules.js に純関数追加（periodLabel 直上・:441 付近、約6行）:
   ```js
   // 社名が既に "(ticker)" を含む場合は付加を省略（SPY 型の二重表示防止）
   function displayName(companyName, ticker) {
     return companyName.includes(`(${ticker})`) ? companyName : `${companyName} (${ticker})`;
   }
   ```
   - periodLabel :447/:449 の `${companyName} (${ticker})` を `${displayName(companyName, ticker)}` に置換。exports（:986）に displayName 追加。
2. detail.js:665 ヘッダ: `(${currentTicker})` span を `data.company_name.includes(`(${currentTicker})`)` のとき出力しない（テンプレート内3項演算子・2行変更）。
3. QQQ/GOOGL の括弧連鎖は挙動仕様として維持（社名の括弧は情報・ticker 付加は検索性）。気になる場合のみ DB 側 `UPDATE ticker_master SET company_name='Invesco QQQ Trust' WHERE ticker='QQQ'` 型の整理を別レーン（データ側・本人確認要）で。
4. テスト: detail-rules.test.js に displayName×2（含む/含まない）+ periodLabel SPY ケース1本追加。

### G2: フォールバック明示注記 + ETF 専用文言（工数: 小）
1. detail-rules.js periodLabel のシグネチャ拡張 `periodLabel(companyName, ticker, year, isUS, hasFiltered, isEtf)`（後方互換: isEtf undefined→falsy でOK）:
   - フォールバック分岐（:449）→ `` `${displayName(...)} - 直近市場ローソク足時系列 [${year}FY の価格データ未収録のため直近200営業日を表示]` `` に変更＝実窓との不一致を注記で解消。
   - `hasFiltered && isEtf` → `[...市場価格トレンド]`（「経営期間トレンド」を ETF では使わない）。株式は現行文言維持。
2. detail.js:677 呼び出しに第6引数 `data.type === "etf"` を追加（isEtf 定数 :757 は後方定義のため式を直書き）。
3. 任意（推奨・+3行）: ETF では time-control-bar の見た目調整＝detail.js:671 で `availableYears` 0件時に「----」表示 or バー非表示。ただし年ボタンDOM構築は navigate 側（:608-616）なので、対応するなら :609 直後で `ctrlBox.parentElement` 制御が実装点。
4. テスト: periodLabel 既存3本の期待値見直し（フォールバック文言変更で1本書換）+ ETF ケース1本追加。
5. 注意: フォールバックは現データで latent（notes 参照）だが、ETF 文言修正は同関数・同リリースで実施するのが合理的。

### G3: 期間注記の副題行分離（工数: 小）
1. detail-rules.js に `periodLabelParts(...)` を新設し `{ main, period }` を返す（main=`displayName() - 歴史的ローソク足時系列`、period=`[...]` 部 or フォールバック注記）。periodLabel は `parts.main + (parts.period ? " " + parts.period : "")` の薄いラッパに書換（既存テスト互換）。約15行。
2. detail.js:676-677 を innerHTML 化:
   ```js
   document.getElementById("stock-title").innerHTML =
     `${esc(p.main)}<span class="stock-title-period">${esc(p.period)}</span>`;
   ```
3. detail.css に追加（:679 付近・約8行）: `.stock-title-period { display:block; font-size:0.68rem; color:var(--ix-border-mid); letter-spacing:1px; margin-top:2px; text-transform:none; }`（wide でも副題行分離で可読性向上・narrow 個別対応不要になる。wide は inline 維持したい場合のみ ≦768px で display:block に限定）。
4. テスト: periodLabelParts×3（US/JP/フォールバック）追加。

実装順序の提案: G1→G2→G3 の順で同一 wave 可（すべて periodLabel 系に集約されるため G3 の parts 化を先にやると G1/G2 がその上に乗り重複編集が減る＝実装時は G3 骨格→G1→G2 の順も可）。

## risks
- periodLabel の文字列一致テスト3本（tests/detail-rules.test.js:54-70）が文言変更で必ず割れる＝期待値書換を同コミットで。
- #stock-title innerText→innerHTML 化: company_name は DB 由来だが esc() 必須（現行 innerText は自動エスケープだった）。上記案は esc 適用済み。
- injectTermHelp は #stock-title に data-term が無いため干渉なし（実測）。ただし将来 stock-title に「?」を足す場合は innerHTML 上書きタイミング（updateFinancialViews 毎回）に注意。
- G2 フォールバック注記は現データで発火経路なし＝目視受入が困難。テスト（純関数）+ 人工データ（prices を未来年だけにする）での確認が必要。
- ETF の selectedYear=2025 ハードコード（detail.js:606）は2026年以降のデータ更新で「2025暦年窓」が価格5年窓から外れると突然フォールバック文言に変わる時限的挙動。恒久対応（ETF は常に直近N本+専用文言）はこの wave で G2 と同時に決めるのが安全。
- DB社名整理（QQQ/GOOGL）は data-bundle.js 再生成・Neon 側との整合が絡むため本人作業レーン＝コード修正と混ぜない。

## sites
- detail.js:665 — ヘッダ社名+ticker span（G1 実装点・監査 :663 から移動・12px化済）
- detail.js:671 — selected-year-display「N FY」（G2 ETF/フォールバック時も選択年のまま）
- detail.js:674-677 — priceWindow 分割代入 + periodLabel 呼び出し（G2/G3 実装点・監査 :638-643 から移動）
- detail.js:605-606 — ETF availableYears=[] → selectedYear=2025 ハードコード（G2 ETF 文言の根）
- detail.js:757,782 — isEtf 判定と early-return（periodLabel より後方＝式直書きが必要）
- detail-rules.js:433-439 — priceWindow（フォールバック slice(-200)・displayPrices 統一済）
- detail-rules.js:442-450 — periodLabel（G1/G2/G3 の主実装点・監査 :446-448 から移動）
- detail-rules.js:986 — exports（displayName/periodLabelParts 追加点）
- index.html:598-607 — .card-title base スタイル（uppercase/letter-spacing:2px）
- index.html:930 — narrow .card-title 12px（G3 の現折返し環境）
- index.html:1219 — #stock-title マークアップ（card-title・data-term なし）
- detail.css:674-679 — .company-title-year（副題行スタイルの参考先例・G3 新セレクタ追加位置）
- tests/detail-rules.test.js:23-70 — priceWindow/periodLabel 文字列一致テスト（文言変更で要書換）
- data/investment.db ticker_master — 括弧入り社名3件（SPY=真二重/QQQ・GOOGL=括弧連鎖）
