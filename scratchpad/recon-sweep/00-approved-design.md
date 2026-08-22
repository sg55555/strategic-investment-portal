# UIUX刷新 wave「小工数頻出系一掃」承認済み設計（2026-08-22 本人承認）

> **✅spec 本人承認済み（2026-08-22・要点承認方式）**＝`docs/superpowers/specs/2026-08-22-uiux-quickfix-sweep-design.md`（325行・敵対検証5レンズ30件反映済み・D13〜D27）。次アクション＝**writing-plans→SDD**（model=Opus・effort=high で実施と本人確定）。

> recon 9観点（本ディレクトリの subpanels / toolbar-terms / titles / finviz-labels / sr-merge /
> fitcontent / compare / bs-additions / harness）の実測に基づく設計提示を太田さんが承認済み。
> **次アクション＝この内容で spec 執筆**（`docs/superpowers/specs/2026-08-22-uiux-quickfix-sweep-design.md`）
> →敵対検証→本人レビュー→writing-plans→SDD。
> 実測の詳細（現HEAD file:line・引用・DB実測・リスク）は recon 9ファイルが正。spec はそれらを典拠に書く。

## wave 範囲（2026-08-21 本人確定＋2026-08-22 追加1件）

前wave spec§12 リストのうち **#1〜10＋BS相乗り#12/#13 の12項目＋recon新発見1件**。
次回送り＝#11 CFウォーターフォールラベル衝突／#14 銀行CF専用表示。
データ側レーン（本人ローカル作業・本waveスコープ外）＝全ゼロFY2026 ETL除去・cf_cash_start/end 年連鎖・**GOOGL社名整理（G1で追加）**。

| # | 項目 | recon | 確定方針 |
|---|------|-------|---------|
| 1 | サブパネル C1-C4 | subpanels.md | C1は7本に拡大（RSI70/50/30・ADX25・ATR中央＋MACD0・OBV0）axisLabelVisible:false。C2=OBV priceFormat:volume＋rightPriceScale.minimumWidth 72 で全パネル軸幅揃え。C3=scaleMargins拡大。C4=新関数 `_updateSubTimeAxes()`（**DOM順判定**・compareDocumentPosition・mount/unmount両所から呼ぶ）＋TIME_AXIS_H=28px高さ補償＋resizeSubpanels修正。SUBPANEL_META/REGISTRY の二重定義ミラー修正必須 |
| 2 | トグルバー迷子「?」＋説明二重 D1/D2 | toolbar-terms.md | D1=空span全廃・グループ?はグループラベル内包（data-term="ma"）・ボタン固有?（KC/SR/TR/VWAP）は `.ctrl-pair` inline-flexラッパで密着（JS無改修）。ボタン内包はnested interactive不採用。D2=`.acc-item.expanded .acc-desc{display:none}` 1行 |
| 3 | タイトル G1-G3 | titles.md | **G1=SPY型（(ticker)重複省略）のみ表示側・GOOGLはデータレーン送り（本人確定）**。displayName ヘルパ＋detail.js:665/detail-rules.js:447,449。G2=periodLabelParts 分離・フォールバック明示注記（latent・2027年頃顕在化に先回り）・ETF「経営期間トレンド」→「年間市場トレンド」。G3=narrowは期間注記を `.stock-title-sub` 副題行分離（esc必須）。tests/detail-rules.test.js:54-70 の periodLabel 文字列一致3本は期待値書換必須 |
| 4-7 | 財務ラベル4件（銀行N/A・浮遊0・レーダー団子・流動比率） | finviz-labels.md | 銀行判定=**値ベース（op=0∧経常>0）単独で確定**（実DBで金融12銘柄36行と完全外延一致・industry文字列不採用）＋N/A表示はHOLDING同型＋レーダー収益性は経常利益率代替。浮遊0=PL val=0段の統一退避（BS分は解消済・CFは任意）＋IFRS経常段省略。レーダー団子=放射角align（BS staggerで実績ある数値align機構）。流動比率=**ratioOrNull は finance-rules.js:174 既存＝呼び替えのみ**（詳細側パネル detail-charts.js:789/799）＋animateNumber(null) 分岐必須 |
| 8 | S/R近接マージ | sr-merge.md | **3点セット＋D9和集合（本人確定）**＝①同側マージ（detectSR cluster内二次マージ・tol=1%・count加重平均＋count合算・digest波及1/100）②cross-sideラベルgreedy dedup③終値バッジ近接の抑制。④D9=チャートに **top-3∪digest引用** を追加描画（平均+0.89本・digest→top-3案は不採用[引用距離1.20%→2.79%悪化＋M7錠テスト破壊]）。⑤端クランプ=**計測アサートのみ・コード保留**（窓統一+scaleMarginsで構造解消済）。sr-window-verify.js:11 の axisLabelVisible出現数==2 ゲート更新必須 |
| 9 | fitContent | fitcontent.md | `DetailRules.fitLogicalRange` 純関数＋updateMaAndVolume末尾で fit/クランプ分岐＋initPriceChart に lockVisibleTimeRangeOnResize:true。**LWC v4.2.3 に maxBarSpacing は存在しない**（CDN実バンドルgrep 0件）→setVisibleLogicalRange パディング手実装。FY切替/navigate限定＝ズーム非干渉・repaint([300,700,1100,1500,1900]ms)非リセット・ensureSubSync追従は裏取り済。受入=合成35本OHLCV |
| 10 | 比較チャートバッジ8連 | compare.md | lastValueVisible:false（detail-charts.js:185）＋legend に normalizeForCompare 最終値=期間リターン%を符号付きtoFixed(1)併記（:187）＋narrow legend 2列grid。**setComparePeriod の window.event 依存も this引数化7行で同時解消**（onclick 4個 index.html:1486-1489・Playwright受入に必要） |
| 12 | P6 債務超過注記 | bs-additions.md | **別プラグイン `bsNotePlugin`（datalabels内部API非依存）**・gate方式は neonGlow/bsLeader と同型3例目・`chart.$bsNoteRect` 書き戻しで bs-callout-verify の X() 交差判定に乗せ受入機械化。文言「純資産 ▲x.x億ドル（債務超過）」（チャート別単位と自動整合）。desktop top:65帯は wave後完全空き＝置き場良化。モバイルは P8 サマリが兼務。実DB該当=MCD/SBUX 計6行のみ（全USD） |
| 13 | P8 モバイル低棒サマリ | bs-additions.md | `#bs-mobile-note` DOM 1行（index.html:1262・chart-main-area 閉じ直後）・renderBSChart の lowTuples 2段化から生成・**閾値はモバイル表示ゲートと同じ 0.15**（0.12流用は12-15%帯取りこぼし）・12px床準拠・カードごと非表示に包含（ETF/!fin stale なし） |
| NEW | 健全性トレンドの分母0→0%偽値（recon新発見・detail-rules.js:867 curOk に分母>0条件なし） | finviz-labels.md | **今回に含める（本人確定）**＝#7 ratioOrNull 呼び替えと同一パターン・同一タスクに同梱 |

## 敵対検証後の追加承認（2026-08-22・verify-findings.json H3/M9/L18 検出後に本人決定）
- **H1（C1）＝基準線7本 axisLabelVisible:false・title 同時消失を受入**（LWC v4.2.3 実測で「軸ラベルを消すと pane title も消える」が確証されたため）。線自体は全本残る（点線グリッド）。RSI70/30・ADX25 は慣習固定値で自明＝消失可。**動的値の ATR 中央値のみ代替表示（方式は plan で確定・側パネル併記等）**。
- **H2（D13）＝縮小修正で続行**。3点セット＋D9和集合は不変・情報保持根拠を「線のみ残る（title はラベルと運命共同）・digest 引用値はテクニカルサマリの数値表示が担保」へ縮小。**title 代替（series marker 等）は次 wave 積み残しに記録**。現行 A-mini でも3本目以降の title は既に非表示＝現状からの後退ではない。
- **H3（受入到達不能）＝rules 層純関数切り出し（S/R ラベル選抜 srLabelPlan 等）＋ソース照合＋DOM 計測へ置換で確定**。IIFE 公開面は広げない（唯一の例外＝#9 `DetailCharts.getPriceVisibleRange` の名前空間ゲッターのみ・windowApi 15/17 は全タスク不変）。

## 受入・検証（harness.md が正）
- 前処理は「mock鯖8200起動→ `node scratchpad/detail-snapshot.js capture` で before-baseline 作成」の1手のみ（DB symlink 済）。
- **前wave受入6本（bs-callout/sr-window/unit-badge/zerofy/zerofy-portal/theme-floor）は現HEADで ALL PASS 実測済＝無料の回帰ゲートとして全数流用**。bs-callout-verify は BS系タスクの安い保険として全タスク推奨。
- node 334 pass（detail-rules 84/finance-rules 34）・pytest 228 pass・portal-money-smoke 8/8 実測済。
- **money.css 非接触見込み＝cockpit-e2e(212) は必須ゲート外**（触った場合のみ昇格・CLAUDE.md 条件どおり）。
- 2層ゲート＝windowApi15/17・canvasCount・pageErrors0 無条件 MATCH＋computedStyles/domHash/chartContainerDims は意図diff検分→再baseline（前wave方式踏襲）。
- SDD ledger＝`.superpowers/sdd/<plan名>/progress.md`（per-plan workspace 規約）。

## 工数見積（recon 実測ベース）
#1 半日／#2 半日未満／#3 半日弱／#4-7+NEW 束ね1日／#8 フル1日／#9 半日／#10 小／#12+#13 計1日 ≒ **合計4-5日相当（SDD並列で圧縮）**。

## 環境
- worktree: `/home/shugo/apps/investment-portal/.claude/worktrees/uiux-chart-sweep`（branch `worktree-uiux-chart-sweep`・base main 8e44298）。
- data/investment.db は main 実DBへ symlink 済み。
- recon元 workflow＝wf_dfe4859a-05b（journal: ~/.claude/projects/-home-shugo-apps-investment-portal--claude-worktrees-uiux-chart-sweep/*/subagents/workflows/）。
