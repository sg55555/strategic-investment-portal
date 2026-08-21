# UIUX刷新 wave「テーマA本実装＋チャート修正①〜⑤」承認済み設計（2026-08-20 本人承認）

> brainstorming の設計提示を太田さんが承認済み。**次アクション＝この内容で spec 執筆**
> （`docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md`）→自己レビュー→本人レビュー→writing-plans→SDD。
> 実測の詳細（file:line・現行コード引用・幾何検証・リスク）は同ディレクトリの 6 ファイル
> （themeA / zeroFy / srUnify / pageUnit / bsCallout / harness）が正。spec はそれらを典拠に書く。

## 確定事項（AskUserQuestion で本人決定）
1. **wave範囲＝監査推奨順①〜⑤**（2026-08-09 決定）＋**小工数頻出系一掃は次waveタスクとして spec 付録と Obsidian に明記**（本人指示）。
2. **全ゼロFY行の防御＝合流方式**（2026-08-20 決定）＝FY2026ボタンは残す（最新価格窓 2025-04〜2026-03 の閲覧を保存）・既定年は「実質値のある最新年」・FY2026手動選択時は財務カード群を「この年度は決算未確定」プレースホルダ（!fin経路にDOM後始末を追加）。
3. **監査A最小緩和（A-mini）を同梱**（2026-08-20 決定）＝S/R軸ラベルを強度上位2本/側のみに限定（線は全本維持・約30分）。理由＝②窓統一でレベルが可視レンジ内に集まりバッジ渋滞が悪化し得るため。監査Aフル版（近接マージ等）は次wave。

## 設計の骨子（承認済み・詳細は各reconファイル参照）
- **テーマA**：「overrideの移植」でなく**発生源修正＋in-place編集**。!important 4ルールは本体に持ち込まない（JS直書き色4種→var()化・inline font-size→12px直接書換）。**media内縮小宣言の同時書換が必須**（index.html:903/924/928・detail.css:408/439・money.css:331/555/565/741）。細部3点＝detail.js:663ティッカーは12px維持（承認済みの見た目に忠実）／「標準」val-badgeは opacity:0.35（非表示化しない）／非D側トークンは保険値のみ。
- **修正①全ゼロFY**：`hasFinSubstance(fin)` を finance-rules.js に新設（SQLite実測で12銘柄FY2026行に過不足なく一致・銀行誤除外なし）。残汚染の同時修正＝健全性トレンド0%急落・FCF偽0点・KPI比較ゼロ列・cross-section最新年汚染・ポータルグリッド。**データ側ETL除去は別レーン**（本人ローカル作業）。
- **修正②S/R窓統一**：detail-charts.js:508 と toggleSR:244 の2口を displayPrices 化（detectSR決定論＝入力統一で数値一致）・staleコメント事実化・**MA/BB/KCのbaseは不可侵**。＋A-mini同梱。
- **修正③pageUnit**：チャート別単位（renderPL/CF/BS各内で算出・healthTrend/fcfTrend同型）・pageUnit引数とヘッダ「単位:X」廃止（ETF無意味表示も解消）・**各チャートタイトル末尾に単位バッジ（分離と表示追加は不可分の1リリース）**・USD十億層→**億ドル層**（JPY鏡像・JPY不変）・軸用新関数 `fmtTickValue(val, unit, ticks)`（目盛間隔から小数桁動的算出）。finance-rules.test.js USD系5アサート書換。
- **修正④⑤BS吹き出し**：side-aware動的パディング（低棒側のみ約126-140px・監査案right:100は**USD2行ラベル112.6pxが欠けるため上方修正**）・anchor'center'統一（不正値廃止）・低棒は全科目横逃がし（P3下向きも横へ）・offset=`chartArea.width/4+12`（幾何恒等成立をプラグインソースで検証済）・**bsLeaderPlugin**（afterDatasetsDraw・チップ縁→セグメント中心1pxシアン・datalabels内部API `$layout._box._rect` 依存＝SRI pin v2.2.0固定の間安定・プラグイン更新時再確認をspecに明記）・同側低棒2つはalign角度数値でstagger。モバイル/ETFは非影響実測済。
- **検証**：①実DB symlink差替（worktreeのdata/investment.dbは**0バイト空ファイル**＝`rm`→`ln -s` main側86KB・phase2-bundleD-layer2と同方式）②変更前 detail-snapshot capture で before-baseline 作成（baseline現存せず）③**2層ゲート**＝不変キー（windowApi16/canvasCount/pageErrors0）無条件MATCH＋computedStyles/domHash/chartContainerDimsは意図diff検分→再baseline昇格 ④node 331+新規（`NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`・ディレクトリ渡しは不可）／pytest 228（`PYTHONPATH=<worktree> main側.venv/bin/pytest tests/ -q`）／cockpit-e2e（money.css変更のため必須）／portal-money-smoke ⑤Playwright監査再現＝代表銘柄（6861.T全ゼロ/6758.T低棒/8306.T銀行/7203.T正常/4755.T極小両方/BRK-B単位/SPY ETF）で `_box._rect` 数値アサート ⑥最終見た目は本人実機サニティ（headless非authoritative）。
- **実施順**：P1全ゼロFY先行（BS hasLowのNaN穴も消える）→テーマA→③pageUnit→②S/R＋A-mini→④⑤BS。SDDタスク分割は plan で。

## 次wave積み残し（spec付録に転記すること・本人指示で明記必須）
銀行営業利益0のN/A化／CFウォーターフォールラベル衝突／浮遊「0」退避／レーダー団子／S/R近接マージ（監査Aフル版）／サブパネル二重ラベル・OBV生値軸・時間軸位置／fitContent／比較チャートバッジ8連／トグルバー迷子「?」／タイトル二重ティッカー／P6債務超過注記／P8モバイル低棒サマリ／銀行CF専用表示／cf_cash_start/end年連鎖（データ側）。

## 環境メモ
- worktree: `/home/shugo/apps/investment-portal/.claude/worktrees/uiux-theme-a-charts`（branch `worktree-uiux-theme-a-charts`・base main 143df86・2026-08-20時点mainと同一＝rebase不要）。
- 監査doc＝`docs/superpowers/audits/2026-08-09-chart-callout-audit.md`・テーマA仕様実体＝`docs/superpowers/specs/assets/theme-a-tuning.css`・カタログ＝`specs/2026-08-08-uiux-proposal-catalog.md`。
- recon元ワークフロー＝wf_1876fa2c-3ac（journal: ~/.claude/projects/-home-shugo-apps/bb61cca4-*/subagents/workflows/）。
