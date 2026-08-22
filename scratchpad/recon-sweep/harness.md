# harness（recon実測 2026-08-21・HEAD 8e44298）

## summary
検証面は前回reconより整備が進み、前提ギャップ2件のうち1件（DB）は解消済み。(1) data/investment.db は main 実DB(86,016B・financial_data_v2 95銘柄・FY2026行15件)への symlink 済＝mock_prod_server.py は即起動可（8260/8200で実測・全API 200）。(2) detail-baseline.json は本worktreeに無く、前wave worktree(uiux-theme-a-charts)も削除済＝**capture起点は今回も必須**（テーマA後の見た目が新baselineになる）。テスト実測: node 334 pass（前回331→+3・detail-rules 84/finance-rules 34）・pytest 228 pass 不変。前waveが残した受入スクリプト6本（bs-callout/sr-window/unit-badge/zerofy/zerofy-portal/theme-floor）は**全て現HEADでALL PASS を実測済**＝今回sweepの無料の回帰ゲートとして全数流用可（全部 8200 ハードコード）。portal-money-smoke は 8 assert（旧9・spec§13-4どおり）で ALL PASS。money.css 非接触なら cockpit-e2e(212 check) は必須ゲートから外せる（CLAUDE.md の必須条件=司令室3ファイル接触時のみ）。

## notes
■ ①node --test 実測（2026-08-22・HEAD 8e44298）: `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js` → **334 pass / 0 fail**（前回recon 331→+3。前waveで tests/detail-rules.test.js +38行・finance-rules.test.js +36行・cross-section-rules.test.js +12行）。個別実測: detail-rules.test.js=84 tests・finance-rules.test.js=34 tests（前回reconの「96/32」は test() 呼び出し静的カウントで、実行数とは別勘定）。ディレクトリ渡し `node --test tests/` は引き続き不可（Node v24 MODULE_NOT_FOUND）＝glob形必須。
■ ②pytest 実測: `PYTHONPATH=<worktree root> /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q` → **228 passed / 0.65s**（前waveでPy側変更なし＝数も不変）。PYTHONPATH必須・venvはmain側、の2注意点は前回どおり有効。
■ ③受入スクリプト8本の流用可否（6本は本セッションで実走・ALL PASS 確認済）:
- bs-callout-verify.js — 修正④⑤（BS吹き出し）回帰ゲート。7銘柄(6758.T/8306.T/7203.T/4755.T/NVDA/BRK-B/MCD)×幅2種(1440/1024)で `$layout._box._rect` を実測しクリップ/相互重なり/軸帯/バー交差=0 を数値アサート＝監査と同手法。**実走ALL PASS**。sweepでBS吹き出し周辺(detail-charts.js)を触るタスクの必須ゲート。約60秒。
- sr-window-verify.js — 修正②（S/R窓統一）回帰ゲート。ソース照合4本＋7203.T/8306.T/NVDAのFY2024窓で S/R がレンジ内＋chart⊆digest 決定論。**実走ALL PASS**。S/R・priceWindow に触るなら必須。
- unit-badge-verify.js — 修正③（単位バッジ3枚・D10両スタック和max・冪等）。**実走ALL PASS**。単位系(fmtUnitValue/pickUnit)に触るなら必須。
- zerofy-verify.js — 修正①詳細側（6861.T既定年/プレースホルダ/カード隠し/復帰/SPY）14 check。**実走ALL PASS**。全ゼロFY・年選択に触るなら必須。
- zerofy-portal-verify.js — 修正①ポータル側（substTrendフィルタ/実CAGR）5 check。**実走ALL PASS**。
- theme-floor-check.js — テーマA①⑧フォント床（docs/superpowers/specs/assets/theme-a-tuning.css のセレクタ列挙→computed font-size>=12px）。**実走ALL PASS（width=1440 checked=77/145）**。detail.css/index.html のフォント系を触るタスクの安価な床ゲート。注意: 検証対象セレクタ列挙を「specアセットのCSSファイル」から読む間接構造＝実装本体(detail.css等)を書き換えてもアセットは不変なので列挙は安定。
- portal-money-smoke.js — 横断動線。**8 assert（spec§13-4どおり・旧9は無効値）ALL PASS**。8207自前spawn＝8200と独立で常用可。
- smoke-zigzag-range.js — pageerrorのみゲートの軽量スモーク（8200前提）。従来どおり流用可。
■ ④detail-snapshot.js baseline: scratchpad/detail-baseline.json は**本worktreeに存在しない**。前wave worktree uiux-theme-a-charts も削除済（現存worktree=date-overflow-parity/nisa-stage2-history/nisa-stage4/num-scalar-parity/phase2-bundleD-layer2/uiux-chart-sweep）＝前waveのbaselineは引き継げず、**sweep着手前に capture 1回が起点**（テーマA適用後の現ルックが before-baseline になる。前回reconの2層ゲート運用＝不変キーのみ無条件・style/domは検分→再baseline、は引き続き有効）。WINDOW_API は源泉17個（detail-snapshot.js:7-9）だが**実測は15/17が正**（spec§13-4・recon期の「16/16」は無効値）＝ゲートは「baselineから不変」で運用。
■ ⑤mock_prod_server.py 起動実測: `PLAN2_PORT=8260 python3 scratchpad/mock_prod_server.py` → GET / =200・/api/market/list=200（実DB由来のトヨタ等95銘柄）・/api/market/financials?ticker=7203.T=200。8200でも起動し受入6本が全通し＝**DB前提含め完全動作**。前回reconの「0バイトDBで全API 500」リスクは解消済（data/investment.db → main実DBへのsymlink・2026-08-21作成済）。
■ ⑥今回sweep waveの変更対象見込みと必須ゲート: spec§12積み残しリストの症状は detail-charts.js（ラベル/軸/レーダー/CFウォーターフォール/サブパネル）・detail-rules.js/finance-rules.js（ratioOrNull・銀行N/A判定）・detail.js（表示切替）・detail.css/index.html（バッジ8連・トグルバー・タイトル）に収まり、**money.css/money.js/money-rules.js は非接触見込み**＝CLAUDE.mdの「司令室3ファイルを触ったらcockpit-e2e必須」条件に当たらず cockpit-e2e(212 check・実測で現存) は任意。ただしindex.htmlは両CSSを常時ロードするため、index.htmlのinline style断片を触るタスクがある回だけ portal-money-smoke（money画面遷移を含む）+theme-floor-check（money画面のfont床を含む）で代替監視するのが軽量で十分。
■ ⑦ポート系譜（現HEAD実測）: 8200=既定（mock_prod_server.py:332）・detail-snapshot.js:61・**前wave受入6本すべて（bs-callout/sr-window/unit-badge/zerofy/zerofy-portal/theme-floor、全部ハードコードでPLAN2_PORT非対応）**・smoke-zigzag-range・b2-ui-smoke・nisa-ui-smoke・roadmap-ui-smoke・task系verify群／8207=portal-money-smoke(自前spawn)／8231=**plan2-window-verify と cockpit-e2e の共用**（各自前spawn・直列なら無害・並走のみ禁止）／8232=mobile-e2e(自前spawn)／8233=nav-busy-e2e(自前spawn)／8241-8243=監査3観点（過去）。
■ SDD ledger: 本worktreeに .superpowers/ 無し。**パス規約が前waveで変更**＝`.superpowers/sdd/<plan名>/progress.md`（per-plan workspace・spec§13-6。前回recon記載のflat形 `.superpowers/sdd/progress.md` は旧形式）。

## proposal
【sweep wave 受入マトリクス（更新版）】前提セットアップ: DB symlink は**済**（作業ゼロ）。残る前処理は「mock鯖8200起動→ `node scratchpad/detail-snapshot.js capture` でbefore-baseline作成」の1手のみ。

| 変更領域 | 必須ゲート（機械判定） | 前wave受入スクリプトの回帰束 |
|---|---|---|
| detail-rules.js/finance-rules.js 純関数（ratioOrNull・銀行N/A・S/R近接マージ等） | node --test tests/*.test.js 334+新規 全pass（TDDで対応test追加）＋pytest 228 不変 | sr-window-verify（S/R触時）・zerofy-portal-verify（growthRates触時） |
| detail-charts.js（ラベル退避・レーダー・CFウォーターフォール・サブパネル軸） | detail-snapshot compare: windowApi15/17・canvasCount・pageErrors0 不変（domHash/chartContainerDims は検分→再baseline） | **bs-callout-verify（BS吹き出し系不変の証明・全タスクで安い保険として推奨）**＋unit-badge-verify（単位層触時） |
| detail.js（表示切替・fitContent等） | 同上＋smoke-zigzag-range（pageerror 0） | zerofy-verify（年選択・カード表示系触時） |
| detail.css/index.html（バッジ8連・トグルバー・タイトル二重等） | portal-money-smoke 8/8＋detail-snapshot compare（computedStyles は検分→再baseline） | theme-floor-check（font-size触時・1440/375両幅） |
| money.css（**非接触見込み**） | 触らない限りゲート不要。触った場合のみ cockpit-e2e 212 check 全PASS（CLAUDE.md必須）に昇格 | — |
| 全タスク共通クロージャ | node 334+/pytest 228・portal-money-smoke 8/8・detail-snapshot 再baseline後 compare MATCH | 触った領域の該当verify再走（各60秒以内） |

- 新規受入スクリプトを書く場合は前wave verify の型（chromium直・check()カウンタ・pageerror収集・8200前提・ALL PASS/exit code）を踏襲し scratchpad/ に置く。監査再現の数値アサート（`$layout._box._rect` 交差判定）は bs-callout-verify.js:14 の X() 関数がそのまま流用できる。
- SDD ledger は `.superpowers/sdd/<今回plan名>/progress.md` に新規作成（per-plan workspace 規約・spec§13-6）。
- 工数見積: ハーネス整備は capture 1回＋（必要なら）新verify 1-2本のみ＝**極小（既存資産が全部生きているため）**。

## risks
- baseline不在＝capture前にコードを触ると before が失われ、テーマA意図diffと今回sweepの意図外diffが区別不能になる。**最初のタスクより前に capture を必ず1回**（前wave worktree削除済でリカバリ不可）。
- 前wave受入6本は 8200 ハードコード（PLAN2_PORT非対応）＝並行セッションで8200が他worktreeに取られると偽陰性。sweep実行中は8200を本worktree専有にする運用（または起動時にポート衝突を検知して即中断）。
- theme-floor-check.js はセレクタ列挙を docs/superpowers/specs/assets/theme-a-tuning.css から読む＝sweepで実装側のセレクタ名を変える（クラスリネーム等）と「未マウント扱いスキップ」で**静かに検証対象から漏れる**（checked=77/145 のスキップ分に紛れる）。リネーム系タスクでは checked 数の減少を目視確認。
- detail-rules.test.js の実行数(84)と test() 静的数の乖離があるため、「テスト数不変」ゲートは必ず実行結果の `ℹ tests` 値で判定（grep -c "test(" で数えない）。
- 8231 は plan2-window-verify と cockpit-e2e の共用ポート＝両方を同時に走らせない（直列なら無害）。
- compare の diffs 出力はキー名のみ（前回reconどおり）＝意図diff検分には baseline JSON の jq 手動比較が引き続き必要。
- GPU発色・グロー等は headless 非authoritative＝見た目系タスクの最終受入は本人実機サニティを残す（前回reconどおり有効）。

## sites
- scratchpad/mock_prod_server.py:332 — `port = int(os.environ.get("PLAN2_PORT") or 8200)`。8260/8200で起動実測済・実DB由来の /api/market/* 全200
- data/investment.db — main実DB(/home/shugo/apps/investment-portal/data/investment.db・86,016B)へのsymlink**設定済**(2026-08-21)。financial_data_v2: 95銘柄・FY2026行15件（sqlite3実測）
- scratchpad/detail-snapshot.js:7-9 — WINDOW_API 17個（実測15/17が正常値・spec§13-4）。:61 localhost:8200固定・baseline=scratchpad/detail-baseline.json（**現在不在＝capture起点**）
- scratchpad/bs-callout-verify.js:14 — 矩形交差判定 X()（監査同手法の数値アサート・新verify流用元）。:20 8200固定。7銘柄×2幅・実走ALL PASS
- scratchpad/sr-window-verify.js:9-12 — ソース照合4アサート（displayPrices呼出/フォールバック/A-mini axisLabelVisible/MA-BB-KC base不可侵）＝sweepでdetail-charts.jsを触った時の構造回帰ゲート。実走ALL PASS
- scratchpad/unit-badge-verify.js:15-17 — 単位バッジ3枚＋D10両スタック和max自己整合。実走ALL PASS
- scratchpad/zerofy-verify.js:17-27 — 6861.T既定年/プレースホルダ/カード隠し14 check。実走ALL PASS
- scratchpad/zerofy-portal-verify.js:13-24 — substTrendフィルタ/実CAGR 5 check。実走ALL PASS
- scratchpad/theme-floor-check.js:6-9 — セレクタ列挙を docs/superpowers/specs/assets/theme-a-tuning.css から抽出（実装側リネームで静かに漏れるリスク箇所）。実走ALL PASS(checked=77/145)
- scratchpad/portal-money-smoke.js:45 — PLAN2_PORT=8207自前spawn。**8 assert**（旧9は無効値）実走8/8 PASS
- scratchpad/cockpit-e2e.js:28 — PORT=8231・check() 212個現存。money.css非接触なら不要（CLAUDE.md必須条件=司令室3ファイル接触時のみ）
- scratchpad/plan2-window-verify.js:9 — PORT=8231（cockpit-e2eと共用＝並走禁止）
- scratchpad/mobile-e2e.js:18 / scratchpad/nav-busy-e2e.js:13 — PLAN2_PORT=8232/8233 自前spawn（前回recon系譜への追加）
- tests/*.test.js — `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js` → **334 pass/0 fail**実測（detail-rules 84・finance-rules 34）。ディレクトリ渡し不可は継続
- tests/ (pytest) — `PYTHONPATH=<worktree root> /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q` → **228 passed/0.65s**実測。PYTHONPATH必須・main側.venv使用は継続
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:313-321 — §13実装差分メモ＝ハーネス実測の正（windowApi 15/17・smoke 8 assert・SDD per-planパス・stagger常時方式・6758.T誤記→MCD）
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:310-311 — §12 次wave積み残しリスト＝今回sweepのスコープ源泉（変更対象見込みの根拠）
