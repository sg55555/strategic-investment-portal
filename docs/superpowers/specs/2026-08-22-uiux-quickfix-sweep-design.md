# UIUX刷新 wave「小工数頻出系一掃」設計 spec

- **日付**: 2026-08-22（設計承認 2026-08-22・本人）
- **worktree**: `/home/shugo/apps/investment-portal/.claude/worktrees/uiux-chart-sweep`（branch `worktree-uiux-chart-sweep`・base main `8e44298`）
- **典拠（正）**: `scratchpad/recon-sweep/` の 9 ファイル（subpanels / toolbar-terms / titles / finviz-labels / sr-merge / fitcontent / compare / bs-additions / harness・全 file:line は 8e44298 実測値）＋承認済み設計 `scratchpad/recon-sweep/00-approved-design.md`
- **監査元**: `docs/superpowers/audits/2026-08-09-chart-callout-audit.md`（**旧 file:line は stale＝recon の現行値が正**）・前 wave spec `docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md`（§12 積み残しリスト＝本 wave のスコープ源泉）
- **敵対検証**: 5レンズ（coverage/vs-recon/vs-code/feasibility/deviations）findings 30件（High 3/Medium 9/Low 18・`scratchpad/recon-sweep/verify-findings.json`）を全件検分・反映済（2026-08-22）。High 3件は 00-approved-design「敵対検証後の追加承認」の本人決定どおり＝§15 D25/D26＋受入手段の置換（H3）。
- 本 spec のコード案は recon proposal の要点引用＝**SDD 実装時に必ず現物（現 HEAD の該当行）を確認**してから編集する。

## 0. 背景・経緯

前 wave「テーマA本実装＋チャート修正①〜⑤」（main merge 済・8e44298 に含む）が §12 付録に残した「小工数頻出系一掃」候補リストから、2026-08-21 に本人が範囲を確定（#1〜10＋BS相乗り #12/#13）。2026-08-22 の recon 9 観点（現 HEAD 実測・実DB SELECT・決定論 mock 100銘柄計測）に基づく設計提示を本人が承認し、recon 新発見 1 件（健全性トレンドの分母0）も同梱で確定した。本 spec はその承認済み設計を decision-complete に固定する。

## 1. 確定事項（本人決定・AskUserQuestion）

1. **S/R＝3点セット＋D9和集合**（2026-08-22）＝①同側近接マージ ②cross-side ラベル greedy dedup ③終値バッジ近接抑制、＋④チャートに top-3∪digest引用レベルを追加描画（D9 再訪の決着）。⑤端クランプは**計測アサートのみ・コード保留**。
2. **G1 タイトル二重＝SPY型（社名が既に `(ticker)` を含む場合の付加省略）のみ表示側で修正**（2026-08-22）。QQQ/GOOGL の括弧連鎖は表示側で触らず、**GOOGL 社名整理はデータ側レーン**（本人ローカル作業）へ送る。
3. **健全性トレンドの分母0→0%偽値（recon 新発見）を本 wave に同梱**（2026-08-22）＝#7 流動比率 ratioOrNull 化と同一パターン・同一タスク。

## 2. スコープ / 非スコープ

### スコープ（12項目＋新発見1件）
| # | 項目 | 主対象ファイル | 工数見積 |
|---|------|------|------|
| 1 | サブパネル C1-C4（二重ラベル/OBV生値軸/端クリップ/時間軸位置） | detail-charts.js（＋detail.js ミラー） | 半日 |
| 2 | トグルバー迷子「?」D1＋説明二重 D2 | index.html・detail.css | 半日未満 |
| 3 | タイトル G1-G3（二重ティッカー/フォールバック注記/narrow折れ） | detail-rules.js・detail.js・detail.css | 半日弱 |
| 4-7 | 財務ラベル4件（銀行N/A・浮遊0・レーダー団子・流動比率） | detail-rules.js・detail-charts.js | 束ね1日 |
| NEW | 健全性トレンド分母0（detail-rules.js:867） | detail-rules.js | #7同梱 |
| 8 | S/R 近接マージ＋D9和集合 | detail-rules.js・detail-charts.js | フル1日 |
| 9 | fitContent（少数バー左余白） | detail-rules.js・detail-charts.js | 半日 |
| 10 | 比較チャートバッジ8連＋凡例二重＋setComparePeriod引数化 | detail-charts.js・detail.js・index.html | 小 |
| 12 | P6 債務超過注記（bsNotePlugin） | detail-charts.js | 半日 |
| 13 | P8 モバイル低棒サマリ（#bs-mobile-note） | detail-charts.js・index.html・detail.css | 半日 |

合計 4-5 日相当（SDD 並列で圧縮・recon 実測ベース）。

### 非スコープ（明示）
- **次回送り**: #11 CF ウォーターフォールラベル衝突／#14 銀行 CF 専用表示。
- **データ側レーン（本人ローカル作業・コード修正と混ぜない）**: 全ゼロ FY2026 行の ETL 除去・cf_cash_start/end 年連鎖不整合・**GOOGL 社名整理（G1 で追加）**。
- レーダー「短期支払」軸の銀行 null 化（5軸構造の再設計が要る＝次 wave へ明示残し。#4 の収益性代替とは別軸）。
- US 銘柄の経常=税引前 同値二重段（データ仕様・別件）。
- カードタイトル側の空 `data-term` span 群（index.html:1253 等・タイトル直後に並ぶため実害小＝D1 のスコープ外）。
- CF の diff=0 浮遊「0」＝**既定は現状維持**（データ側0埋め由来・表示側で消す1行案は ETL 是正との二重対応リスクがあるため plan で採否確定）。

## 3. 実施順（提案・バッチ分割は plan で確定）

**B0 前処理（最初の SDD タスク・必須）**: mock 鯖 8200 起動→`NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture` で before-baseline 作成（1手のみ。DB symlink は設定済・前 wave worktree は削除済で baseline 引き継ぎ不可＝**capture 前にコードを触ると before が失われる**）。

**B1 純関数系（rules 層のみ・受入=node テストで完結・依存なし並列可）**: NEW curOk 分母条件（detail-rules.js:867）→ #4 isFinancialPL＋targetOp → #5 plSteps IFRS 段省略 filter（:509）→ #8(1a) detectSR マージ＋srNearest＋**srLabelPlan**（§8.2）→ #3 periodLabelParts 骨格→G1 displayName→G2 文言（titles recon の順序推奨どおり parts 化を先に）→ #9 fitLogicalRange。

**B2 detail-charts/detail.js 系（受入=Playwright＋baseline 検分）**: #1 サブパネル → #9 fit 配線 → #8(1b) srLabelPlan 適用＋和集合描画 → #10 比較 F1-F4 → #12/#13 BS 追補 → #4-7 の描画側（PL formatter/align・レーダー・**#7 側パネル呼び替え＝detail-charts.js:789/:799 の null 分岐と DOM 書込はここ（B1 は rules 側 curOk のみ）**）→ **#3 の detail.js 配線（:665 ヘッダ・:677 第6引数・:676-677 innerHTML 化）**。

**B3 CSS/DOM 系**: #2 トグルバー → #3 G3 副題行 CSS（**B2 の innerHTML 化と同タスクか後＝CSS 先行は span 不在で inert**）→ #13 CSS。

順序根拠: B1 は受入が安価（node のみ）で B2 の土台（#8(1b) は (1a) の戻り値形に依存・#3 G1/G2 は parts 骨格に乗る）。#9 fit を #8 端クランプ計測より先に入れると残余ケース(a)が消える（sr-merge recon ②の順序推奨）。B2 内の再 baseline はタスク粒度ごとに繰り返す（§12）。

## 4. #1 サブパネル C1-C4

### 4.1 C1: 基準線の二重ラベル（7本に拡大・約7行）
- detail-charts.js の createPriceLine 7本に `axisLabelVisible: false` を統一付与: **:287/:288/:289**（RSI 70/50/30）・**:309**（MACD 0線）・**:335**（ADX 25＝明示 true→false）・**:363**（ATR 中央＝明示 true→false）・**:372**（OBV 0線）。監査記載の**4本（RSI70/30・ADX25・ATR中央）に RSI50/MACD0/OBV0 の3本**（未指定=true で「50.00」「0.00」が出る同根）を加えた計7本が正。
- **title も同時に消える（D25・本人追加承認済み）**: LWC v4.2.3 は `axisLabelVisible:false` で pane 内 title の描画も行わない（SRI 一致の CDN 実バンドルで title 代入前 early-return・headless 実測で title 画素 96→0）。線（破線）自体は全本残る。RSI70/30・ADX25 は慣習固定値で自明＝消失を受入。**動的値の ATR 中央値のみ代替表示を用意（方式＝側パネル併記等・plan で確定）**。

### 4.2 C2: OBV 生値軸＋軸幅揃え（1-2行＋2箇所）
- buildOBV :368-371 の addLineSeries に `priceFormat: { type: "volume" }`（メイン出来高 :631 と同型前例・±58.4M 形式）。
- subBaseOpts :270 の rightPriceScale に `minimumWidth: 72` を追加し、メインチャート :609 の rightPriceScale にも同値（案X+Y 静的併用＝D24）。

### 4.3 C3: 上下端ティック半クリップ（1行）
- subBaseOpts :270 の scaleMargins `{top:0.1, bottom:0.1}` → `{top:0.16, bottom:0.16}`。高さ+16px 案は SUBPANEL_REGISTRY（detail-charts.js:384-390）と detail.js SUBPANEL_META（:290-296）の**二重定義ミラー修正**が要るためフォールバック扱い。

### 4.4 C4: 時間軸を常に最下段のみ（新関数 ~20行＋呼出2＋registry）
- :406 の createChart を常に `timeScale:{visible:false}` で生成し SUBPANEL_REGISTRY の timeAxis フラグ（:386 macd のみ true）を廃止。
- 新関数 `_updateSubTimeAxes()`（unmountSubpanel :425 直後に配置）: `_subMounted` のキーを **DOM 順（`host.compareDocumentPosition` で判定）**にソートし最下段のみ `timeScale.visible:true`＋高さ補償（`TIME_AXIS_H=28` を加算・chart.resize）。**`m.host.style.height` も `base + (axisOn ? TIME_AXIS_H : 0)` へ同期（OFF 復帰時は base へ戻す）＝chart.resize だけでは canvas が host を 28px はみ出す**（detail.js:331 が base 固定・`.subpanel-host` に高さ規定なし・`.acc-item` は overflow:visible）。冪等ガード（`m.axisOn` 記録）付き。展開状態は「`_subMounted` に居る=展開中」が常に成立するため detail.js `_accItems` の跨ぎ読みは不要。
- 呼出点: mountSubpanel の `_subOrder` push（:410）の後（rAF 完了後=登録済みの地点）／unmountSubpanel の splice（:424）の後の2箇所のみ（collapse/remove/全畳みは全て unmountSubpanel 経由）。
- resizeSubpanels :436 の resize 高さを `m.height + (m.axisOn ? TIME_AXIS_H : 0)` に修正（**host.style.height も同式で同期**）。
- MACD の登録高 110（時間軸込み設計値）を base=104 へ正規化し、**detail.js SUBPANEL_META :292 の 110 も 104 へミラー（二重定義のため両方必須・忘れると 0x0 罠/高さ不一致）**。
- **rAF 世代トークンガード＝同梱する（必須・C4 タスクに含める）**: mountSubpanel（:396-417）の rAF create ループに世代トークン（or host.dataset ガード）を追加。理由＝expand→即 collapse→再 expand で2本の create が並走し二重 createChart になる潜在バグが現物で実在（pending ループの再入ガードなし）・C4 が同一関数を書き換える唯一の機会。
- 既知トレードオフ（recon risks）: 高さ補償で軸切替時にアコーディオン全体が ±28px 動くレイアウトシフト＝許容不可なら補償なし案(a)（chart 高固定・最下段ペイン 28px 縮む）へ退避可（1行差）。
- `TIME_AXIS_H=28` は目安＝**B0 直後のハーネスで LWC が生成する time-axis 行の DOM 高を実測して確定**（私有 chart インスタンスの `timeScale().height()` は page から到達不能＝H3）。

### 4.5 受入基準（#1）
受入手段は **DOM 計測＋ソース照合**（LWC インスタンス/priceLine は IIFE 私有で page から到達不能・軸ラベルは canvas 描画で DOM に無い＝H3）:
- Playwright（mock 8200）で「5枚全展開→中段畳む→再展開→最下段を外す」を回し機械アサート: ①時間軸が常に最下段のみ＝各 host 内の LWC time-axis 行の有無＋`host.clientHeight`（base / base+TIME_AXIS_H）の DOM 計測 ②軸幅揃え＝LWC が生成する右軸（price-axis）セルの DOM 幅が全サブパネルで一致 ③二重ラベル解消＝**ソース照合**（対象7箇所の createPriceLine すべてに `axisLabelVisible: false` が出現＝sr-window-verify 同型）＋スクショ検分 ④`host.clientHeight` と canvas 描画高の一致（高さ補償の検収・はみ出し検出）。
- C3（上下端ティック非クリップ）は scaleMargins 0.16 のソース照合＋**担い手＝本人実機サニティ（§14 項目7）**（canvas 描画のため DOM 文字列計測不可）。
- detail-snapshot: pageErrors0 不変・chartContainerDims は意図 diff→検分→再 baseline。**canvasCount は B0 直後（TIME_AXIS_H 実測と同タイミング）に時間軸 ON/OFF 前後で不変かを実測**し、LWC が軸 canvas を追加する場合のみ C4 タスクの意図 diff として §12.1 に例外を明記（低確度・未実証のため）。tests/ にサブパネル関連テストは 0 件＝node 回帰なし。

## 5. #2 トグルバー迷子「?」D1＋説明二重 D2

（本節の D1/D2 は toolbar-terms recon 由来の**項目ラベル**＝§15・前 wave spec の決定番号 D1〜 系とは別名前空間）

### 5.1 D1: 空 span 全廃＋密着ラッパ（index.html 約7行＋detail.css 約3行・JS 無改修）
- index.html:1222 「移動平均」`.ma-label` に `data-term="ma"` を付与し、:1225 の空 span `data-term="ma"` を削除（:1229 「エンベロープ」bb と同形＝グループ概念はグループラベル内包）。
- ボタン固有概念（KC :1231・S/R線/T/R線/VWAP :1236-1238）は `<span class="ctrl-pair" data-term="...">` で各ボタンをラップし空 span を削除。injectTermHelp（detail.js:224-233）が beforeend でラッパ末尾＝ボタン直後に「?」を注入・冪等ガード `:scope > .term-help` もそのまま効く。
- detail.css に `.ctrl-pair { display:inline-flex; align-items:center; }`＋`.ctrl-pair > .term-help { margin-left:3px; }`＝480px の flex-wrap でもボタンと「?」が同一行に固定。
- **ボタン内包（button 内に tabindex=0 span）は不採用**: nested interactive で ?クリックが toggle を誘発・focus 破綻。
- --th-shift クランプ（index.html:2608-2633）は位置計測ベース＝DOM 移設に追従（無改修）。

### 5.2 D2: 説明二重（detail.css 1行）
- `.acc-desc` 定義（detail.css:621-628）直後に `.acc-item.expanded .acc-desc { display: none; }` を追加。`.expanded` は detail.js:326/:338 で既に付与/除去済＝CSS のみで出し分け。

### 5.3 受入基準（#2）
- 機械（`:empty` 判定は不採用＝injectTermHelp 注入後は修正前でも常に 0 件で識別力なし）: ①`.ma-control-bar .ma-label[data-term]` が全てテキスト非空（data-term を持つのはグループラベルのみ＝空 span 全廃の検収）②`.ctrl-pair > .term-help` が4件存在し各 `previousElementSibling` が button ③アコーディオン展開時に `.acc-desc` の computed display=none/折り畳みで復帰。tests/detail-termhelp.test.js（termHelp 文字列のみ検証）は非破壊。
- スクショ: 1280px/480px のツールバー・tooltip hover のクランプ動作。

## 6. #3 タイトル G1-G3

### 6.1 G1: 二重ティッカー（SPY型のみ・約20行+テスト）
- detail-rules.js periodLabel（:442-450）直上に純関数 `displayName(companyName, ticker)` を新設: `companyName.includes(`(${ticker})`)` なら付加省略、さもなくば `` `${companyName} (${ticker})` ``。:447/:449 の `${companyName} (${ticker})` を置換・exports（:986）追加。
- detail.js:665 ヘッダ: company_name が `(${currentTicker})` を含むとき ticker span を出力しない（テンプレート内3項演算子・2行）。
- 実DB該当は SPY のみ真の二重（QQQ/GOOGL は括弧連鎖＝表示側維持・GOOGL はデータレーン＝確定事項2）。

### 6.2 G2: フォールバック注記＋ETF 文言（小）
- periodLabel のシグネチャ拡張 `(..., hasFiltered, isEtf)`（isEtf undefined→falsy で後方互換）。
  - フォールバック分岐（:449）→ `` `${displayName(...)} - 直近市場ローソク足時系列 [${year}FY の価格データ未収録のため直近200営業日を表示]` ``＝実窓との不一致を注記で解消。**現データで発火経路ゼロの latent**（価格5年ローリングで 2027 年頃 JP FY2022 窓が空になり顕在化）に先回り。
  - `hasFiltered && isEtf` → 期間注記の「経営期間トレンド」を**「年間市場トレンド」**へ（本人承認済み文言＝00-approved-design が正）。株式は現行文言維持。
- detail.js:677 の呼び出しに第6引数 `data.type === "etf"` を追加（isEtf 定数 :757 は後方定義のため式直書き）。
- **ETF がフォールバック分岐に入った場合の文言（本 spec で決定）**: ETF の selectedYear=2025 ハードコード（detail.js:605-606）は 2027 年頃に 2025 暦年窓が価格5年窓から外れ突然フォールバックへ落ちる時限挙動（titles recon risks）。このとき FY 表記の注記は ETF に不自然なため、`isEtf` 時のフォールバック注記は **FY 表記を避けた `[価格データ未収録のため直近200営業日を表示]`** とする（periodLabelParts 内 +1 分岐）。恒久対応（ETF は常に直近N本＋専用文言）は §16 積み残し。
- 任意（+3行・plan で採否確定）: ETF の `selected-year-display`（detail.js:671）を availableYears 0 件時「----」化 or バー非表示。

### 6.3 G3: 期間注記の副題行分離（小）
- detail-rules.js に `periodLabelParts(...)` を新設し `{ main, period }` を返す。periodLabel は `main + " " + period` の薄いラッパへ書換（既存テスト互換の足場）。約15行。
- detail.js:676-677 を innerHTML 化: `` `${esc(p.main)}<span class="stock-title-sub">${esc(p.period)}</span>` ``（**esc 必須**＝現行 innerText の自動エスケープを失うため。クラス名は承認済み設計の `.stock-title-sub` が正）。
- detail.css に `.stock-title-sub { display:block; font-size:12px; color:var(--ix-text-dim); letter-spacing:1px; margin-top:2px; text-transform:none; }` 相当（約8行・12px 床準拠。**色は 12px 本文として AA 寄りの `--ix-text-dim` を採用**＝`--ix-border-mid` #2a3a44 は背景比 ≈1.6:1 で期間情報を担う本文には不足・既存用途も装飾のみ）。
- **wide でも副題行分離＝デスクトップでタイトルが2行化する**（承認済み表の「narrow は…分離」からの適用拡大＝**D27**・narrow 個別 media 分岐が不要になる。意図変更として実機サニティ項目10で wide も検分）。

### 6.4 受入基準（#3）
- node: displayName×2（含む/含まない）・periodLabelParts×3（US/JP/フォールバック）・ETF ケース1本・periodLabel SPY ケース1本を追加。**既存 periodLabel 文字列一致3本（tests/detail-rules.test.js:54-70）の期待値書換は同一コミット必須**（§13）。
- Playwright: SPY 詳細の #stock-title innerText に `(SPY) (SPY)` を**含まない**・ETF タイトルに「経営期間トレンド」を**含まない**（機械判定）・480px で `.stock-title-sub` が block 表示。
- G2 フォールバック文言は人工データ（prices を未来年のみ化）＋純関数テストで確認（実データで目視不能な latent）。

## 7. #4-7＋NEW 財務ラベル一掃

4件＋NEW は同一リリースで束ねる（同じ detail-rules/detail-charts 帯・検証1回）。

### 7.1 #4 (P2) 銀行の営業利益 N/A 化＋レーダー収益性の経常代替（半日）
- **判定＝値ベース単独（D16）**: `isFinancialPL(fin) = FR.n(fin.operating_income) === 0 && FR.n(fin.ordinary_income) > 0` を detail-rules.js（plSteps :498-510 直上）に新設＋export。実DBで金融12銘柄36行（銀行5/保険3/証券2/US2）と**過不足なく外延一致**・非金融の該当0行・9984.T（経常=0）は自動排除＝HOLDING 特例（:33）と非衝突。
- 表示: detail-charts.js PL formatter（:1125-1143）の HOLDING 分岐（:1127-1129）と同型で `value===0 && label==="営業利益" && isFinancialPL(fin)` → `"N/A\n(銀行・金融)"`。配置は 7.2 の val=0 統一退避に乗せる。段省略案は不採用（HOLDING と一貫の6段構造＋教育文脈で「なぜ無いか」を示す）。
- レーダー: detail-rules.js:581 の targetOp を `HOLDING ? ibt : (isFinancialPL ? ordinary_income : operating_income)` に（1行）。score レンジ 0-12 据置（8306.T 2025 経常率 37.3%→100点）。**形状が0点→ほぼ100点へ大変化＝退行でなく意図変更**（実機サニティ対象）。
- 既知トレードオフ（recon risks・採否は D16 のまま値ベース単独）: 非金融で営業利益ちょうど 0 の年が将来入ると N/A 誤表示（現DB 0件）。堅くする場合の追加条件 `FR.n(fin.current_liabilities) === 0`（金融の「流動区分なし」構造とセット判定・現12銘柄全行合致）を選択肢として温存。

### 7.2 #5 (P7) val=0 統一退避＋IFRS 経常段省略（極小〜小）
- detail-charts.js align（:1112-1119）: 先頭に `if (val === 0) return "top";` を置き HOLDING center 分岐（:1115-1116）を削除。offset（:1120-1124）: `if (val === 0) return 12;`（現行6→12 で軸帯から確実に離す）。
- detail-rules.js:509 の plSteps filter に「`ordinary_income===0 && income_before_taxes!==0` の経常段は省略」を追加（IFRS 判定・実DB該当は 9984.T の3行のみ）。

### 7.3 #6 (P8) レーダー団子の放射退避（小）
- detail-charts.js radar datalabels（:1025-1031）に `align: (ctx) => ctx.dataIndex * (360 / ctx.chart.data.labels.length) - 90, offset: 8` を追加（頂点0=真上=-90°・時計回り72°刻み＝各ラベルが自軸の外向きへ退避）。**数値 align は前 wave BS stagger（:920-921）で本番実績のある機構**。間引きは初回不要（受入アサートで残余重なりが出た場合のみ）。

### 7.4 #7 流動比率 0.0%＋NEW 健全性トレンド（小・同一タスク）
- **ratioOrNull は finance-rules.js:174 に既存＝呼び替えのみ（D17）**。detail-charts.js:789 を `FinanceRules.ratioOrNull(fin, FinanceRules.currentRatio, ["current_assets","current_liabilities"], ["current_liabilities"])` へ（ポータル index.html:1980 と同引数・cross-section-rules.js:90-91 に続く3例目）。
- detail-charts.js:799 は **null 分岐必須**: null なら `#current-ratio` に "N/A" 直書き、else 従来 animateNumber（**animateNumber(null) は "0.0%" を無言表示する**＝detail.js:189-199 実測）。任意: null 時 `#desc-current-ratio` を「▶ 銀行・金融は流動/固定区分がなく適用外」へ上書き（detail.js:753 が先・renderBSChart 側が後＝上書き成立は実行順で確認済）。
- **NEW（確定事項3）**: detail-rules.js:867 healthTrendSeries の curOk に `&& FR.n(f.current_liabilities) > 0` を追加＝銀行の流動比率 0% 偽実線を null 欠測化（spanGaps:false で線が消える）。
- currentRatio 本体（finance-rules.js:36-39）と ratio の 0 返し（:19-22）は**変えない**（tests/finance-rules.test.js:37 の既存挙動固定を維持）。

### 7.5 受入基準（#4-7+NEW）
- node: isFinancialPL×3（金融 true/9984.T false/通常 false）・plSteps 9984.T 型（経常段省略）・radarScores 銀行フィクスチャ・healthTrendSeries 銀行型（流動比率 null）を tests/detail-rules.test.js（:188-215/:450-470 帯）へ追加。
- Playwright（mock 8200・機械アサート）: 8306.T＝PL に「N/A\n(銀行・金融)」・#current-ratio="N/A"・健全性トレンドに流動比率実線なし／9984.T＝経常段なし＋val=0 退避／7201.T・8306.T＝レーダー datalabels `$layout._box._rect` 相互交差 0（bs-callout-verify.js:13 の X() 流用）／7203.T＝非金融の非退行。

## 8. #8 S/R 近接マージ＋D9和集合（3点セット・確定事項1）

前提: 監査A②（軸ラベル上位2本/側）と監査B（窓統一）は前 wave 実装済＝残スコープは①近接マージ・③端クランプ・D9 再訪。mock 全100銘柄実測で、A-mini 後の渋滞主因は同側近接（<1%＝13/100）でなく **cross-side R/S 近接（50/100）と終値バッジ近接（61/100）**＝3点セットが必要。

### 8.1 (1a) detectSR cluster 内の二次マージ（detail-rules.js +8行程度）
- 挿入位置: cluster() 内・groups 構築（:143-145・価格昇順）と `sort+slice(0,_maxPerSide)`（:146）の**間**。隣接クラスタが `MERGE_TOL=0.01`（1%）未満なら **count 加重平均＋count 合算**で束ねる（要点: `last.price=(last.price*last.count+g.price*g.count)/(last.count+g.count)`）。
- tol=1% の根拠: 一次帯1.5%（:140）の greedy 分割断片の是正に閉じる下限（0.5% は実測ヒット0・監査 SPY 例 0.59% を拾えない）。
- **slice 前に置く**ため chart top-3 ⊆ digest 全クラスタの prefix 性が維持され sr-window-verify.js:32-33 の subset アサート不変。digest の強度表示も自動で合算（単一源）。digest readout 波及は実測 1/100 銘柄のみ。
- 既知の限界（recon risks・既定は非採用）: 連鎖マージ（A-B<1%∧B-C<1% で累計 >1%）のドリフトは加重平均基準で抑制されるが理論上可能＝気になる場合のみ「チェーン先頭基準で span 上限 1.5%」の +2 行オプション（plan で採否）。

### 8.2 (1b) applySRLines のラベル greedy dedup（detail-charts.js:245-257 改・+12行程度）
- **選抜ロジックは rules 層純関数 `srLabelPlan(resistance, support, close)` として detail-rules.js に新設＋export（H3 の本人決定）**: R/S 各 top-2 を count 降順→終値に近い順→R 優先で走査し、(i) **終値±1% 内は抑制**（終値バッジ埋没対策）(ii) 既採用と <1% は抑制、のラベル付与集合を返す。全段決定論（tie-break 明記）。applySRLines は `axisLabelVisible: i < 2`（:249/:255）を srLabelPlan の適用に置換するだけ＝**実装・node テスト・verify が同一実装を参照**（選抜ロジックの重複実装によるドリフト根絶・§14「純計算=rules」規律とも整合）。
- 効果（実測）: ラベルペア <1% 衝突 28/100→0・終値バッジ埋没 61/100→0。**線は全本不変だが、ラベル抑制線の title（R×n/S×n）はラベルと運命共同で消える（LWC v4.2.3 実挙動＝D26。現行 A-mini でも i≥2 の title は既に非表示＝現状からの後退ではない）**。digest 引用値の数値情報はテクニカルサマリの表示が担保。
- 閾値 0.6% への緩和選択肢は不採用＝**1% で確定**（終値ゾーンの読み取り性優先・線と digest 数値は残る。敵対検証の再実測でも 0.6% 緩和は埋没問題が約半分残存＝1% を支持）。

### 8.3 (2) 端クランプ＝計測アサートのみ（コード保留）
- 窓統一済＋scaleMargins top:0.05/bottom:0.25（detail-charts.js:612-614）で既定ビューの静的クリップは構造解消済み。sr-window-verify.js に「既定ビューでラベル級レベルが可視 autoscale レンジ内」の数値アサートを追加するのみ。#9 fitContent を同 wave で先に入れるため残余ケース(a)も消える。実害が出た場合の動的切替（+15行）は次 wave。

### 8.4 (3) D9和集合＝top-3∪digest引用の追加描画
- detail-rules.js に `srNearest(sr, close)` を新設（digest の最寄り選択 :697-710 を関数化・digest と共用＝単一源）＋export。applySRLines は `detectSR(prices, Infinity)` の全クラスタから top-3 slice＋srNearest（up/dn 各1）の**和集合**を描画。追加線は `axisLabelVisible:false` 固定＝**title も非描画・線のみ**（D26）。実測: 追加は平均 +0.89 本/最大 +2 本＝クラッタ増ほぼ無し・「digest の数値には必ず対応する**線**がある」を保証（乖離常態 72/100 の解消・数値の照合はテクニカルサマリ側が担う）。
- digest の側呼称ねじれ（「支持」が R クラスタ由来 74/100＝M7 既存仕様）が見えやすくなるため、INDICATOR_GLOSSARY "sr"（detail-rules.js:50-83）に一文追加。

### 8.5 受入基準（#8）
- node: 既存 S/R 錠4本（tests/detail-rules.test.js:270/:418-426/:428-435/:437-448・fixture 間隔 >1.5% でマージ非影響）を**無改変で全緑維持**＋新規（マージ加重平均/≥1%非マージ/digest 強度合算/srNearest/**srLabelPlan**＝§13）。
- **sr-window-verify.js:11 のソース固定アサート（`axisLabelVisible: i < 2` 出現数==2）の書換が必須**（忘れると偽 FAIL・§13）。subset アサート（:32-33）は不変。
- 受入手段は「**ソース照合＋純関数評価**」（sr-window-verify 同型・LWC priceLine は IIFE 私有で列挙 API も無く直接観測不能＝H3）: ①ソース照合＝applySRLines が `DetailRules.srLabelPlan` を適用し和集合描画（srNearest）を含むこと ②純関数評価＝代表銘柄の displayPrices（page から取得 or verify 内で mock 系列を再構築）に対し srLabelPlan／detectSR＋srNearest を評価し「ラベル ≤2/側・ペア間 ≥1%・終値±1% にラベル無し・digest 引用値に対応する線が描画集合（和集合）に存在」を数値アサート。before/after の top-3 顔ぶれ変化は「変わって正しい」検分（前 wave §6.3 と同扱い）。

## 9. #9 fitContent（少数バー左余白）

- **LWC v4.2.3（index.html:44 SRI pin）に `maxBarSpacing` オプションは存在しない**（CDN 実バンドル grep 0件・v5系機能）＝監査案は本バージョンで実装不可→ `setVisibleLogicalRange` パディング手実装（D20）。
- detail-rules.js に純関数 `fitLogicalRange(barCount, paneWidth, maxBarSpacing=15)` を新設（priceWindow :439 直後・+10行程度）: `barCount*maxBarSpacing >= paneWidth` なら `{fit:true}`、未満なら中央寄せパディング `{fit:false, from:-pad, to:barCount-1+pad}`、無効入力は null。export 追加。
- detail-charts.js updateMaAndVolume 末尾（refreshSubpanels 呼出 :534・関数終端 :535 の直前後）に +7行: `ts.width()`（price 軸除きの pane 幅）で fitLogicalRange を評価し `fitContent()` / `setVisibleLogicalRange()` を分岐。width 0（非表示）は skip＝0x0 罠と同じガード思想。実行点を updateMaAndVolume 末尾に置く理由＝全系列 setData 完了後に一度だけ確定（detail.js:678-679 で setCandleData と常に対）。
- initPriceChart :608 の timeScale に `lockVisibleTimeRangeOnResize: true` を追加（リサイズで fit/ズーム位置を時間範囲基準で保存）。
- 裏取り済の非干渉: fit は FY切替/navigate 経路（updateFinancialViews）限定＝ズーム非干渉／repaint（:697-723・[300,700,1100,1500,1900]ms）は resize のみで fit 非リセット／サブパネルは ensureSubSync（:439-446）＋seed（:413-414）で自動追従／全オーバーレイは displayPrices 窓 filter 済＝広い系列に引かれる罠なし。
- 挙動変更の明示（退行でなく意図変更）: (a) FY切替のたび視域リセット (b) fallback 200本窓が右端寄せ→全窓圧縮表示 (c) 少数バー時のローソク幅が最大 ≈10.8px にクランプ (d) **lockVisibleTimeRangeOnResize でウィンドウリサイズ挙動が「barSpacing 維持・右端固定」→「時間範囲維持」へ変わる**（recon risks の検分対象＝サニティ項目8で体感確認）。`maxBarSpacing=15` は候補12-18px＝**本人実機サニティで最終確定**。

### 受入基準（#9）
- node: fitLogicalRange 5-6本（fit 境界・pad 対称性・0本/幅0→null）。
- Playwright: **合成35本 OHLCV 銘柄＝scratchpad/mock_prod_server.py（build_ohlcv :167-210）に検証専用 ticker を追加**（既存銘柄の合成系列は不変＝前 wave 受入6本など他ゲートへ非波及）でクランプ分岐・US 銘柄 2026 FY で左余白解消。アサートは `page.evaluate(() => DetailCharts.getPriceVisibleRange())`（デバッグゲッター新設 +3行・resizePrice と同型）の数値判定（`from<=0.5 && to>=n-1`）。**windowApi は不変**（ゲッターは DetailCharts 名前空間＝detail-snapshot の WINDOW_API は window 直下 17 名の固定リストのみ検査・再 baseline 不要。window 直公開への変更は §14 の IIFE 規律違反＝禁止）。ゲッターの存在検収はこのアサート自身が兼ねる。
- 序で（任意・コメントのみ）: detail.js:682-688 の stale コメント（repaint 遅延 [300,700,1100] 表記）の事実化。

## 10. #10 比較チャートバッジ8連

- **F-1**: detail-charts.js:185 `lastValueVisible: true` → `false`（1行）。
- **F-2**: legend 生成（:187）に期間リターン%を併記。データ源は normalizeForCompare（:152-161）戻り値の末尾 value（=期間リターン%算出済）＝**追加データ取得ゼロ**。符号付き `toFixed(1)+"%"`・系列色で `.compare-legend-val`（detail.css:378-389 近傍に mono/bold 約4行）。
- **F-3**: detail.js:82 chips の社名フル表示 → ティッカーのみ（✕と色枠は維持・社名は legend が担う＝同名二重解消）。narrow は detail.css @768 に `.compare-legend { display:grid; grid-template-columns:1fr 1fr; }`（約3行）＝監査の計16行縦膨張→約6行。
- **F-4（同梱・D23）**: setComparePeriod の window.event 依存解消＝index.html:1486-1489 の onclick 4箇所を `setComparePeriod(3, this)` 型へ・detail.js:88-91 を `(months, btn)` 引数化（`(btn || (window.event && window.event.target))?.classList.add("active")` のフォールバック付き＝旧呼出し形も非破壊）。呼出し元は onclick 4箇所が全量（grep 実測）。

### 受入基準（#10）
- Playwright: compare モーダル 8銘柄×3M/1Y で①右軸バッジ抑止＝**ソース照合（detail-charts.js:185 に `lastValueVisible: false` が存在。compareChart は IIFE 私有で直接観測不能＝H3）**②legend 8項目に符号付き%（DOM 計測）③480px の modal 総縦高 before/after 実測＝**before は #10 タスク冒頭・コード変更前に同手順で先に実測して確保**（B0 の detail-snapshot は compare モーダル非対象＝後からは取れない）④`page.evaluate` からの `setComparePeriod(12)` が throw せず再描画（F-4 の検収）。
- detail-snapshot: windowApi は**存在チェックのみ＝シグネチャ変更 OK**（scratchpad/detail-snapshot.js:9 実測）。index.html 変更で domHash 意図 diff→F-2/F-3 と同束で再 baseline 1回。tests/ に compare 系参照 0 件＝node 回帰なし。

## 11. #12/#13 BS 追補（P6 債務超過注記・P8 モバイル低棒サマリ）

実DB該当: 債務超過（net_assets<0）は **MCD/SBUX の各 FY2023-2025 計6行のみ（全 USD）**。前 wave の横逃がし統一で desktop top:65 帯（:873）は完全空き＝注記の置き場は良化。

### 11.1 P6: `bsNotePlugin` 別プラグイン（D22・~18行＋renderBSChart ~4行）
- detail-charts.js:147（`Chart.register(bsLeaderPlugin)`）直後に登録。gate 方式は neonGlow/bsLeader と同型の**3例目**（`chart.$bsNote` 無しなら no-op）。**datalabels 内部 API 非依存**＝プラグイン更新でリード線が死んでも注記は生存（bsLeader 相乗り不採用の理由）。
- 描画要点: 調達源泉列の中心x（`getDatasetMeta(0).data[1].x`）基準・`y = chartArea.top - h - 16`（top:65 帯内・低棒チップ上端越え ~12px と非干渉）・端クランプ・12px bold（テーマA 床）・#ff5c7a 枠/#ff8fa5 文字（側パネル「マイナス」:793 と統一）。**描画矩形を `chart.$bsNoteRect` に書き戻し**＝受入が bs-callout-verify の X() 交差判定にそのまま乗る。
- renderBSChart 側（:967 `$bsLeaders` 直後）: `!isMobile && hasNegativeEquity`（:747）のとき `text: "純資産 ▲" + FinanceRules.fmtUnitValue(Math.abs(fin.net_assets), unit) + "（債務超過）"`。**unit はチャート別単位（:756）＝バッジ/軸/ラベルと自動整合**（MCD 2025=「▲18億ドル」・SBUX 2025=「▲81億ドル」実DB検算済）。モバイルは非表示＝P8 サマリが兼務。
- 互換注意: Canvas2D `roundRect` はコードベース初出（Chrome 99+/Safari 16+）。SDD 時に手書き path 化（+6行）を判断。

### 11.2 P8: `#bs-mobile-note`（DOM 1行＋lowTuples 2段化＋書込 ~10行＋CSS 1ルール）
- index.html:1262（chart-main-area 閉じ直後・side-panel の前）に `<div id="bs-mobile-note" class="bs-mobile-note" hidden></div>` を1行追加。ETF/!fin はカードごと非表示（detail.js:757-762）に包含＝stale 経路なし。
- renderBSChart の lowIndices 構築（:767-774）をラベル付き lowTuples→filter の2段化（機能等価・lowIndices の 0.12 判定は不変）。
- 書込（:967 付近）: **対象条件はモバイル表示ゲート（:881-884）と同じ 0.15**（D21・0.12 流用は 12-15% 帯の「表示もサマリも無い」取りこぼし）。`ラベル + fmtUnitValue(v, unit) + " (x.x%)"` を「・」連結、債務超過行は unshift で先頭。`hidden = !(isMobile && items.length > 0)`。例: 8306.T→「純資産 21.7兆円 (5.3%)」・7203.T→hidden（最小 29.2%）。
- CSS: `.bs-mobile-note { font-size:12px; color:var(--ix-text-dim); line-height:1.5; margin:6px 2px 0; }`（.sig-disclaimer/.fin-pending-note と同規約・detail.css 側＝money.css 非接触）。
- 明記（レビュー矛盾指摘の予防）: **desktop 吹き出し 0.12／モバイルサマリ 0.15 の非対称は意図的**（モバイル情報全損の定義が表示ゲート 0.15 だから）。

### 11.3 受入基準（#12/#13・bs-callout-verify.js 拡張）
- 銘柄セットに **SBUX を追加**（8銘柄目・非低棒側の債務超過対照）。
- desktop 1440/1024: MCD/SBUX で `$bsNoteRect` 非 null・canvas 内クリップ0・全チップ/バー矩形/axisBand との X() 交差0・noteText が `/^純資産 ▲\d+(\.\d+)?億ドル（債務超過）$/` に一致。非該当6銘柄（7203.T/8306.T/6758.T/4755.T/NVDA/BRK-B）は `$bsNoteRect` null。
- モバイル 375: 8306.T＝`#bs-mobile-note` 非 hidden かつ `/純資産 21\.7兆円 \(5\.3%\)/`・MCD＝「債務超過」を含む＋`$bsNoteRect` null・7203.T＝hidden。既存「padding arm 不変（left=4）」維持。
- 1024px 幅で注記がチップ/軸 tick と近接するリスク＝axisBand の判定域を `y: ca.top-8` へ広げて検出余裕を持たせる。干渉検出時は `y` オフセット 16→24（top:65 帯内で余裕あり）。

## 12. 検証計画（harness.md が正）

### 12.0 前提セットアップ
- data/investment.db は main 実DBへ symlink 済（作業ゼロ）。残る前処理は**「mock 鯖 8200 起動→ `node scratchpad/detail-snapshot.js capture` で before-baseline 作成」の1手のみ**（§3 B0・capture 前にコードを触らない）。B0 直後のハーネス実測（同タイミングで1回）: ①TIME_AXIS_H＝LWC time-axis 行の DOM 高（§4.4）②時間軸 ON/OFF 前後の canvasCount 不変性（§4.5）。
- **8200 専有の検知手順**: mock 鯖起動前に `lsof -i :8200`（or 既存応答の curl 確認）で使用中なら**即中断**＝並行セッションによる前 wave 受入6本（全て 8200 ハードコード）の偽陰性防止。
- 前 wave 受入6本（bs-callout/sr-window/unit-badge/zerofy/zerofy-portal/theme-floor）は**現 HEAD で ALL PASS 実測済＝無料の回帰ゲートとして全数流用**。
- **f2-snapshot は本 wave のゲート外**（f2-baseline.json は worktree に不在。recon finviz-labels/bs-additions の「detail/f2 2層ゲート」「portalDomLen が diff る」言及は前 wave 期の運用記述＝本 wave で使う場合のみ B0 で f2 capture を追加してから）。

### 12.1 2層ゲート（前 wave §9.1 方式踏襲）
- 層1（無条件 MATCH）: **windowApi 15/17 は全タスク不変**（#9 の getPriceVisibleRange は DetailCharts 名前空間＝WINDOW_API の window 直下 17 名 typeof チェックの観測対象外。「ゲートを変化させるため」の window 直公開は §14 の IIFE 規律違反＝禁止）・canvasCount・pageErrors 0。canvasCount の唯一の留保＝C4 の時間軸動的切替（§12.0 の B0 実測で変動が確認された場合のみ、C4 タスクの意図 diff として本節に例外を明記してから進む）。
- 層2（意図 diff 検分→再 baseline）: computedStyles / domHash / chartContainerDims は diffs キー＋baseline JSON の jq 検分→OK なら capture 昇格。タスク粒度ごとに繰り返す。

### 12.2 受入マトリクス（変更領域×検証手段）
| 変更領域 | 必須ゲート（機械判定） | 前 wave 受入スクリプトの回帰束 |
|---|---|---|
| detail-rules.js/finance-rules.js 純関数（curOk 分母条件・銀行判定・S/R マージ/srLabelPlan・titles・fitLogicalRange） | `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js` **334+新規 全pass**（ディレクトリ渡し不可・テスト数は実行結果の `ℹ tests` で判定）＋`PYTHONPATH=<worktree> .venv(main側)/bin/pytest tests/ -q` **228 不変** | sr-window-verify（S/R 触時・:11 ゲート更新後）・zerofy-portal-verify（growthRates 触時） |
| detail-charts.js（サブパネル・fit 配線・S/R dedup 適用・compare・BS 追補・ラベル退避・レーダー・側パネル ratioOrNull 呼替） | detail-snapshot compare: windowApi/canvasCount/pageErrors0 不変（domHash/chartContainerDims は検分→再 baseline） | **bs-callout-verify（全タスクで安い保険として推奨）**＋unit-badge-verify（単位層触時） |
| detail.js（配線・chips・setComparePeriod） | 同上＋smoke-zigzag-range（pageerror 0） | zerofy-verify（年選択・カード表示系触時） |
| detail.css/index.html（トグルバー・G3・ctrl-pair・bs-mobile-note・compare CSS） | portal-money-smoke **8/8**＋detail-snapshot compare（computedStyles 検分→再 baseline） | theme-floor-check（font-size 触時・checked 数の減少を目視確認＝セレクタリネームの静かな漏れ対策） |
| money.css（**非接触見込み**） | 触らない限りゲート不要。**触った場合のみ cockpit-e2e 212 check 全PASS に昇格**（CLAUDE.md 条件） | — |
| 全タスク共通クロージャ | node 334+/pytest 228・portal-money-smoke 8/8・再 baseline 後 compare MATCH。**wave クロージャで `git diff --name-only <base 8e44298>` に money.js/money-rules.js/money.css が含まれないことを機械確認**（含まれたら cockpit-e2e 212 check へ昇格＝CLAUDE.md 条件の手順化） | 触った領域の該当 verify 再走（各60秒以内） |

- 新規受入スクリプトは前 wave verify の型（chromium 直・check() カウンタ・pageerror 収集・8200・ALL PASS/exit code）を踏襲し scratchpad/ に配置。rect 数値アサートは bs-callout-verify.js:13 の X() を流用。
- GPU 発色・グロー等は headless 非 authoritative＝見た目系の最終受入は §14 の本人実機サニティ。
- SDD ledger: `.superpowers/sdd/<本 plan 名>/progress.md`（per-plan workspace 規約）。

## 13. テスト影響（書換必須の明細）

1. **tests/detail-rules.test.js:54-70**: periodLabel 文字列一致3本＝G1/G2/G3 の文言・構造変更で**期待値書換必須**（同一コミットで）。
2. **scratchpad/sr-window-verify.js:11**: `axisLabelVisible: i < 2` 出現数==2 のソース固定アサート＝#8(1b) で**ゲート更新必須**（「srLabelPlan 適用のソース照合＋純関数評価の数値アサート」＝§8.5 の型へ書換）。:32-33 の subset アサートは不変（マージを slice 前に置く限り）。
3. 追加テスト: detail-rules 系（displayName/periodLabelParts/isFinancialPL/plSteps 9984.T 型/radarScores 銀行/healthTrendSeries 銀行/detectSR マージ3本/srNearest/**srLabelPlan 3-4本＝ラベル ≤2/側・<1% 相互抑制・終値±1% 抑制・tie-break 決定論**/fitLogicalRange）。finance-rules 系は**既存挙動固定を維持**（currentRatio/ratio の 0 返しテストを変えない＝消費者側 ratioOrNull 化の証明）。
4. tests/detail-termhelp.test.js・compare 系・サブパネル系は非破壊（DOM 検証は Playwright 委譲済/参照ゼロ）。

## 14. 制約（不可侵）と実機サニティ項目

- **0x0 罠**: display:none コンテナで createChart しない（C4 の高さミラー・rAF ガードを含め初期化順序不変）。
- **MA/BB/KC の base 算出（全履歴算出→窓 filter のウォームアップ機構）不可侵**（#8/#9 は applySRLines/fit 配線のみに触れる）。
- **detail 分離規律**: 純計算=detail-rules/finance-rules・描画 lifecycle=detail-charts・配線=detail.js（displayName/periodLabelParts/isFinancialPL/fitLogicalRange/srNearest/マージは必ず rules 層へ）。
- **IIFE 公開面**: 新規 window 公開なし（例外＝#9 受入用 `getPriceVisibleRange` デバッグゲッター1本のみ・resizePrice と同型の薄ラッパとして DetailCharts 名前空間へ）。
- **money.js/money-rules.js/advice.py 非接触**。money.css も非接触見込み（#13 CSS は detail.css 側）＝cockpit-e2e は必須ゲート外・触ったら昇格。
- **bsLeaderPlugin の datalabels 内部 API（`$datalabels`/`$layout._box._rect`）依存は SRI pin v2.2.0（index.html:46）の間のみ安定**＝bsNotePlugin を非依存で設計する理由（D22）。プラグイン更新時の再確認事項に「bsNote は影響圏外・リード線のみ再確認」を明記。
- **ローソク確定色・ZigZag 逆規約の意味保持**（本 wave はどちらの算出にも触れない）。

**本人実機サニティ項目（受入の最終段）**:
1. **8306.T（銀行）**: PL 営業利益「N/A (銀行・金融)」・レーダー収益性が経常代替で高得点化（形状大変化の体感確認）・側パネル流動比率 N/A・健全性トレンドの流動比率線消滅・モバイルで BS サマリ「純資産 21.7兆円 (5.3%)」。
2. **MCD/SBUX**: BS チャート上部の債務超過注記チップ（単位「▲x.x億ドル」の読みやすさ）・モバイルサマリの債務超過行・リード線との共存。
3. **SPY**: タイトル「(SPY) (SPY)」解消・「年間市場トレンド」文言・年ボタン0本の見た目。
4. **9984.T**: 経常段省略＋val=0 退避後の PL の見た目（意図変更の確認）。
5. **7201.T 等低スコア銘柄**: レーダーラベルの放射分離。
6. **比較チャート 8 銘柄**: 右軸すっきり・legend の%・narrow 2列・chips ティッカー化の違和感有無。
7. **サブパネル 5 枚全展開→畳み/再展開**: 時間軸が常に最下段・軸幅の揃い・上下端ティック非クリップ（C3 の担い手＝§4.5）・軸ラベルと **pane title の消滅**（RSI70/50/30・ADX25 等＝D25）の違和感有無・ATR 中央値の代替表示・アコーディオン展開時にヘッダ説明が消え折り畳みで復帰（D2）・軸切替時の ±28px レイアウトシフトの許容。
8. **US 銘柄 2026 FY**: 左余白解消・`maxBarSpacing=15` のローソク幅の見た目（候補12-18px から最終確定）・ズーム→FY切替→視域リセット（意図仕様）・**ウィンドウリサイズで fit 維持**（lockVisibleTimeRangeOnResize の体感＝§9(d)）。
9. **S/R（NVDA/SPY 等）**: マージ後の top-3 変化の納得感・終値近傍ラベル抑制・digest 引用値に対応する線の存在・側呼称ねじれ注記。
10. **トグルバー 480px＋タイトル**: 「?」がボタンに密着し迷子ゼロ・narrow タイトルの副題行・**wide（デスクトップ）でのタイトル2行化の違和感有無（D27 の意図変更検分）**。

## 15. 主要決定の記録

前 wave spec の D1-D12 からの連番（D9「S/R maxPerSide 差維持」は本 wave D13 で再訪・決着）。※§5 の D1/D2 は toolbar-terms recon の項目ラベルで本決定番号系とは別。

- **D13 S/R＝3点セット＋D9和集合（本人確定）**: 同側マージ（tol=1%・count 加重平均＋合算）＋cross-side ラベル greedy dedup＋終値±1% 抑制＋top-3∪digest引用の追加描画。端クランプは計測アサートのみ。**情報保持根拠＝線の存在＋テクニカルサマリの数値表示（title はラベルと運命共同で消える＝D26 で縮小訂正）**。不採用=digest→top-3 完全一致化（引用距離 1.20%→2.79% 悪化＋M7 錠テスト破壊）／Infinity 全描画（線倍増で監査Aに逆行）。
- **D14 G1＝SPY型のみ表示側・GOOGL はデータレーン（本人確定）**: 不採用=QQQ/GOOGL 括弧連鎖の表示側整形（社名の括弧は情報・整理は DB 側が根治で表示ロジックを複雑化させない）。
- **D15 健全性トレンド分母0＝本 wave 同梱（本人確定）**: 不採用=次 wave 送り（#7 と同一パターン・同一タスクなら 1 行で済み検証も同回）。
- **D16 銀行判定＝値ベース（op=0∧経常>0）単独**: 実DBで金融12銘柄36行と完全外延一致。不採用=industry 文字列 Set 判定（fin 行に industry が無く純関数から外れる・4値管理・新銘柄追随漏れ）。
- **D17 流動比率＝既存 ratioOrNull（finance-rules.js:174）への呼び替えのみ**: 不採用=currentRatio/ratio 本体の null 返し化（tests/finance-rules.test.js:37 の既存挙動固定を破壊し全消費者へ波及）。
- **D18 C1＝7本に拡大**: 監査記載の4本（RSI70/30・ADX25・ATR中央）に RSI50/MACD0/OBV0 の3本を追加。不採用=監査4本のみ（「50.00」「0.00」軸ラベルが同根で残る）。
- **D19 C4 最下段判定＝DOM 順（compareDocumentPosition）**: 不採用=_subOrder（mount 順＝畳む→開くで並びが崩れ誤判定）。
- **D20 fit クランプ＝setVisibleLogicalRange 手実装**: LWC v4.2.3 に maxBarSpacing 無し（CDN 実バンドル grep 0件）。不採用=maxBarSpacing オプション（v5系機能＝本バージョンで実装不可・監査案の無効化）。
- **D21 P8 閾値＝0.15**: モバイル表示ゲートと同値。不採用=lowIndices の 0.12 流用（12-15% 帯が「表示もサマリも無い」取りこぼしになる）。
- **D22 P6＝bsNotePlugin 別プラグイン**: gate 方式3例目・datalabels 内部 API 非依存・$bsNoteRect 書き戻しで受入機械化。不採用=bsLeader 相乗り（内部 API 依存に注記を巻き込み更新時に共倒れ）／DOM 注記（canvas 幾何の逆写像が複雑・列上部という監査意図から外れる）。
- **D23 compare 同梱で setComparePeriod 引数化**: onclick 4箇所＋関数2行の極小コストで Playwright 受入と将来のパーマリンク期間復元を可能化。不採用=放置（プログラム呼出しが TypeError のまま・比較モーダルを触る唯一の機会を逃す）。
- **D24 サブパネル軸幅揃え＝X+Y 静的併用（OBV volume 化＋minimumWidth:72 をサブ/メイン両方）**: 決定論・再レイアウト無し。不採用=案Z 動的同期（applyOptions 往復・完全整列が要求された時の追加段として温存）。高価格銘柄でメイン軸が 72 超のときサブとの残差が出る妥協点は明記の上で着地。
- **D25 C1 の title 同時消失を受入（本人追加承認・敵対検証 H1）**: LWC v4.2.3 は axisLabelVisible:false で pane title も非描画（SRI 一致実バンドルの early-return＋headless 実測）。慣習固定値（RSI70/30・ADX25）は自明＝消失可・**動的値の ATR 中央値のみ代替表示（方式は plan で確定）**。不採用=title 温存のため axisLabelVisible:true 維持（二重ラベル症状が直らない）／7本全部への代替表示（過剰・情報価値があるのは ATR 中央のみ）。
- **D26 S/R の情報保持根拠を「線のみ残る」へ縮小（本人追加承認・敵対検証 H2）＋選抜の rules 層純関数化（H3）**: title はラベルと運命共同・digest 引用値はテクニカルサマリの数値表示が担保・選抜は srLabelPlan として rules 層へ（実装=検証の単一源）。現行 A-mini でも3本目以降の title は既に非表示＝現状からの後退ではない。不採用=series marker 等による title 代替の同時実装（工数増・必要性は実機サニティで判断＝§16 積み残しへ）。
- **D27 G3 副題行は全幅適用（wide も2行化）**: 承認済み表の「narrow は分離」記述からの適用拡大（titles recon の推奨に沿う・narrow 個別 media 分岐が不要・wide でも長文タイトルの可読性向上）。不採用=≦768px 限定 display:block（分岐が増え wide の1行詰まりが残る）。意図変更として実機サニティ項目10で wide を検分。

## 16. 付録: 次 wave 積み残し

（wave 完了時に Obsidian 所有ノート Projects/investment-portal.md 🎨UIUX刷新スレッド節へ本体転記）

- #11 CF ウォーターフォールラベル衝突／#14 銀行 CF 専用表示（本人確定の次回送り）。
- レーダー「短期支払」軸の銀行 null 化（5軸構造の再設計・§7.1 の残存明記）。
- S/R 端クランプの動的切替（E2・§8.3 の計測アサートで実害が出た場合のみ）。
- サブパネル軸幅の完全整列（案Z 動的同期・D24 の残差が気になった場合）。
- CF diff=0 ラベルの表示側省略（データ側 ETL 是正の結果を見て採否）。
- カードタイトル側の空 data-term span 群の統一（タイトル内包化のみ・ctrl-pair 不要）。
- S/R・基準線の pane title 代替表示（series marker 等＝D25/D26 で消える title の代替。必要性は実機サニティの結果で判断）。
- ETF selectedYear=2025 時限挙動の恒久対応（ETF は常に直近N本＋専用文言・detail.js:605-606。本 wave は G2 のフォールバック専用文言で実害を緩和済み）。
- **データ側レーン（本人ローカル）**: 全ゼロ FY2026 行の ETL 除去・cf_cash_start/end 年連鎖・GOOGL 社名整理（＋任意で QQQ「Invesco QQQ Trust」化）。

## 17. 再開の合図

- spec 承認後: 「**quickfix-sweep の writing-plans から**」（→SDD 実装。バッチ分割・任意項目の採否は plan で確定）。
- 実装中断後: `.superpowers/sdd/<plan名>/progress.md` の Task 状態から再開。
