# harness（recon実測 2026-08-09・HEAD 143df86・wf_1876fa2c-3ac）

## summary
検証面は揃っているが2つの実測ギャップあり。(1) 本worktreeの data/investment.db が0バイト（git-ignored・mock_prod_server.py はこれを読むため起動しても全API失敗する）＝過去worktree(phase2-bundleD-layer2)は main の86KB実DBへの symlink で解決しており、同じ前処理が今回も必須。(2) `node --test tests/` はNode v24でMODULE_NOT_FOUNDで死ぬ＝正しい起動は `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`（実行済・331 pass/0 fail）。pytest は `PYTHONPATH=<worktree root> /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q` で 228 passed（PYTHONPATH無しだと scripts import で collection error 2件）。Playwright 1.60.0＋chromium-1223/1228 が /home/shugo/node_modules に導入済で実ブラウザ検証可。detail-snapshot.js の baseline(scratchpad/detail-baseline.json) は本worktreeに存在しない＝変更前に capture を1回走らせて before-baseline を作るのが再ベースライン手順の起点。SDD ledger は本worktreeに無く、/home/shugo/apps/investment-portal/.superpowers/sdd/progress.md（B#2）が踏襲すべき形式。

## notes
■ mock_prod_server.py の全容: stdlibのみ・ThreadingHTTPServer。静的=worktreeルート全ファイルをバイトそのまま毎回ディスク読み（キャッシュ無し→CSS/JS編集が再起動不要で反映）。API=list.py/financials.py/ohlcv.pyと同型JSON（_GRID_FIN_FIELDS 7項目/_FIN_FIELDS 16項目をSQLiteから、market_cap/per/pbrとOHLCV 600本はticker sha256で完全決定論合成・無シード乱数ゼロ＝実行ごとバイト同一）。POST /api/me/insight はMOCK_ADVICE_MODE=personalでAI読み解きの固定応答。
■ detail-snapshot.js のMATCHゲート運用（意図した見た目変更がある今回向け・実測に基づく手順）: compareの突合は computedStyles/domHash/chartContainerDims がJSON全体一致なので、テーマA(CSS変更)では computedStyles・チャート修正(paddingやDOM)では domHash/chartContainerDims が「意図どおり」diffになりexit 1する＝MATCH恒常維持は不可能。正しい運用は3段階: (a)変更前に `node scratchpad/detail-snapshot.js capture` でbefore-baselineを作る（現在baseline無し＝これが第一歩）→(b)変更後 compare を走らせ、diffs出力を目視で「意図キーのみか」検分（不変であるべきキー=windowApi 16/16 true・canvasCount・pageErrors 0 は無条件ゲートとして維持）→(c)検分OKなら capture を再実行して after を新baselineに昇格し、以後のタスク内リグレッションは compare のMATCHで機械判定。タスク粒度ごとに (b)(c) を繰り返す（監査:130の示唆どおり同系修正は1束で1回の突合に）。注意: compareのdiffs出力は computedStyles の中身までは出さない（キー名のみ）＝検分時はbaseline JSONとの手動diff（jq等）が要る。
■ ポート系譜: 8200=既定/detail-snapshot・8207=portal-money-smoke・8231=cockpit-e2e(自前httpサーバでmock_prod_server不使用)・8241/8242/8243=監査3観点。並行セッション時はPLAN2_PORTで衝突回避が確立済の慣行。
■ テスト実測値(2026-08-09・HEAD=143df86): node 331 pass（うちwave直結=detail-rules.test.js 96・finance-rules.test.js 32）、pytest 228 pass。どちらも今回変更対象の detail-rules.js/finance-rules.js の純関数を直接叩く＝チャート修正のロジック部（例: fmtUnitValue目盛・デフォルト年選択をrules層に置くなら）の一次ゲート。
■ Playwright: /home/shugo/node_modules に playwright/playwright-core/@playwright 1.60.0、~/.cache/ms-playwright に chromium-1223/1228+headless_shell あり＝`NODE_PATH=/home/shugo/node_modules` で require('playwright') 即可。過去監査・全e2eがこのパターン。
■ 変更対象ファイルは全てindex.htmlから参照確認済: detail.css(:1015)/money.css(:1016)/finance-rules.js(:1591)/detail-rules.js(:1594)。detail.js/detail-charts.jsも同梱。index.html:1596-1633にcross-script共有束縛（currentTicker=IIFE外hoist・selectedYear/pageUnitはdetail.js closureへprivate化済）のgotchaコメントあり＝JS変更時に触れる可能性。

## proposal
【受入マトリクス案: 変更領域×検証手段】前提セットアップ（spec冒頭に必須と明記）: ①`rm data/investment.db && ln -s /home/shugo/apps/investment-portal/data/investment.db data/investment.db`（現0バイト空ファイルの差替・phase2-bundleD-layer2と同方式） ②変更前に mock鯖起動(PLAN2_PORT=8200)→`NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture` でbefore-baseline作成。

| 変更領域 | 必須ゲート（機械判定） | 意図diff検分（人/エージェント判定） |
|---|---|---|
| テーマA CSS: index.html(inline style/トークン) | portal-money-smoke.js 9 assert全PASS（横断動線pageerror 0）＋ detail-snapshot compare の windowApi16/canvasCount/pageErrors0 不変 | compare の computedStyles diff＝意図セレクタのみか baseline JSON手動diff→OKなら capture で再baseline |
| テーマA CSS: detail.css | 同上＋ detail-snapshot compare（#detail-view系18セレクタが監視対象＝最も感度が高い） | 同上 |
| テーマA CSS: money.css | **cockpit-e2e.js 212 check全PASS（CLAUDE.md必須）**＋portal-money-smoke.js | money系はSTYLE_SELECTORS外＝cockpit-e2eのC5等が実質ゲート |
| チャート修正: detail-rules.js/finance-rules.js（純関数: 全ゼロFY判定・fmtUnitValue・S/R窓・pageUnit） | `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js` 331+新規テスト全pass（TDD: 修正ごとにdetail-rules/finance-rules.test.jsへ追加）＋pytest 228 pass不変（PYTHONPATH付き） | 不要 |
| チャート修正: detail-charts.js（datalabels anchor/offset/padding） | detail-snapshot compare: canvasCount/windowApi/pageErrors不変。chartContainerDims/domHashは意図diff許容 | **Playwright実ブラウザで監査再現スクリプト**: 監査P1-P5の代表銘柄（6861.T全ゼロ/6758.T低棒/8306.T銀行/7203.T正常/4755.T極小両方）をmock鯖で開き `$datalabels` の `$layout._box._rect` を抽出→クリップ0・バー重なり0を数値アサート（監査と同手法＝受入基準が監査の症状定義と1:1対応） |
| チャート修正: detail.js（デフォルト年選択・updateFinancialViews） | node --test（rules層に切出した分）＋detail-snapshot compare＋smoke-zigzag-range.js（8200接続・pageerror 0） | 全ゼロFY 12銘柄のうち2-3銘柄で「最新の非ゼロ年が既定選択される」DOM実測 |
| 全変更共通（各タスク完了時） | node 331+/pytest 228 不変・portal-money-smoke PASS・detail-snapshot 再baseline後 compare MATCH | — |

SDD ledgerは /home/shugo/apps/investment-portal/.superpowers/sdd/progress.md の形式（総括→branch/plan/base→Task状態→Minorロールアップ）を本worktree .superpowers/sdd/progress.md に新規作成して踏襲。

## risks
- data/investment.db が本worktreeで0バイト＝mock_prod_server.py は起動するが全 /api/market/* が500になり、e2e/スモーク/snapshot全部が偽陰性で落ちる。spec のセットアップ手順に symlink 差替を必須タスクとして明記しないと最初のタスクで詰まる
- detail-snapshot.js の computedStyles 突合はJSON全体一致＝テーマAでは必ずdiffる。『MATCH必須』を機械的ゲートにするとテーマA実装が全部failする＝spec で「不変キー(windowApi/canvasCount/pageErrors)のみ無条件・computedStyles/domHash/chartContainerDimsは検分→再baseline」の2層ゲートに再定義する必要がある
- compare の diffs 出力はキー名だけで中身を出さない＝『意図したdiffか』の検分には baseline JSON の手動比較(jq)が別途要る。検分を省くと意図外のCSS崩れがcomputedStyles diffに紛れて素通りする
- node --test はディレクトリ渡し（tests/）だと Node v24.15.0 で MODULE_NOT_FOUND＝過去ドキュメントのコマンド例をそのまま書くと落ちる。glob形 tests/*.test.js を spec に明記
- pytest は PYTHONPATH=<worktree root> 必須（無いと scripts import で collection error 2件）。またvenvは main 側 /home/shugo/apps/investment-portal/.venv を使う（worktree内 .venv 無し）
- detail-snapshot.js は URL が localhost:8200 ハードコード＝並行セッションで PLAN2_PORT を変えるとsnapshotだけ8200を見に行きズレる。並行時は snapshot 用鯖を8200で立てるか、スクリプトのポートも合わせて意識する
- 監査の file:line（detail-charts.js:851/850/801/detail.js:598-601等）は32eb0ae→143df86でチャート系コード変更なしの前提だが、本任務では実コードの行番号裏取りまでは行っていない（別任務の担当）。spec執筆時に該当行の現物確認を挟むこと
- cockpit-e2e.js(port 8231)は自前サーバでmoney系APIをモック＝mock_prod_server.pyと独立。money.cssの変更が detail-snapshot の STYLE_SELECTORS に波及しない保証はない（index.html は両CSSを常時ロード）＝money.css変更時も detail-snapshot compare を回すのが安全
- GPU発色・グロー等の視覚品質は headless 非authoritative（smoke-zigzag-range.js の規約コメント・過去B#2でも同判断）＝テーマAの最終見た目は太田さん実機サニティを受入条件に残す

## sites
- scratchpad/mock_prod_server.py:332 — 起動ポート決定 `port = int(os.environ.get("PLAN2_PORT") or 8200)`。起動=『PLAN2_PORT=82xx python3 scratchpad/mock_prod_server.py』の1行1コマンド。127.0.0.1のみbind・log静音(:326)
- scratchpad/mock_prod_server.py:25 — _DB_PATH = <worktree>/data/investment.db。本worktreeでは0バイト(空・sqlite_master 0行)＝要実DB(symlink or copy from main)
- scratchpad/mock_prod_server.py:288 — _handle_static: index.html＋worktreeルート配下の全静的ファイル(detail.css/money.css/detail.js/detail-charts.js等)を毎リクエストでディスクから読む＝編集が即反映・パストラバーサル防御あり
- scratchpad/mock_prod_server.py:246 — _handle_api: /api/market/{list,ohlcv,financials}(SQLite実財務＋sha256決定論合成の600本OHLCV・終端2026-06-30固定)＋/api/auth/session＋POST /api/me/insight(MOCK_ADVICE_MODE=personal既定)
- scratchpad/detail-snapshot.js:55 — mode = argv[2] || 'capture'。capture=scratchpad/detail-baseline.jsonへ保存、compare=突合しdiffsありでexit 1(:79)。対象URLはlocalhost:8200固定(:61)＝PLAN2_PORT変更時はここも要注意
- scratchpad/detail-snapshot.js:7 — 突合キー: windowApi 16関数(:7-9)・computedStyles=STYLE_SELECTORS 18セレクタ×STYLE_PROPS 15プロパティ(:11-18)・domHash(正規化innerHTML長+outerHTML先頭200字)・canvasCount(#detail-view内)・chartContainerDims(chart/rsi/macd-container)・pageErrors(goto前に登録:59-60)。7203.T詳細を開いて計測
- scratchpad/cockpit-e2e.js:4 — 起動=『NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js』(サーバ自前起動/停止・port 8231)。check()呼び出し212個。money.css変更時必須。実index.html+実money.js/money-rules.js/money.cssを無改造配信・fetch/routeレベルのみ差替・シナリオ毎に新BrowserContext
- scratchpad/portal-money-smoke.js:4 — 起動=『NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js』(mock_prod_server.pyをPLAN2_PORT=8207でspawn)。assert 9個。#portal→#detail→#money→タブ切替→戻るの横断動線でpageerror 0を確認＝今回のindex.html/CSS変更の横断回帰ゲートに最適
- scratchpad/smoke-zigzag-range.js:7 — チャート系スモークの既存規約例: 合否ゲートはpageerrorのみ・console errorは参考ログ(mock鯖の/_vercel/insights 404は既知無害ノイズ)。8200接続前提＝mock鯖を別途起動しておく型
- tests:1 — node --test 対象8ファイル(cross-section/detail-rules[96 test呼]/detail-termhelp/finance-rules[32]/insight-facts/money-rules/screener-rules)。実行実測: `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js` → 331 pass/0 fail/193ms。`node --test tests/`(ディレクトリ渡し)はMODULE_NOT_FOUNDで不可
- tests/test_refresh_market.py:1 — pytest対象15ファイル。実行実測: `PYTHONPATH=<worktree root> /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q` → 228 passed/0.58s。PYTHONPATH無しは本ファイルとtest_seed_universe.pyが `No module named 'scripts'` でcollection error
- /home/shugo/apps/investment-portal/.superpowers/sdd/progress.md:1 — 踏襲すべきSDD ledger形式（本worktreeには.superpowers/sdd/無し＝新規作成）。形式=『# <束名> SDD 進捗 ledger』→総括(レビュー結果/テスト数/本番状態)→branch/plan/base(実装開始前HEAD)→『## タスク状態』Task N: complete (commits, review結果)→『## Minor findings ロールアップ』。nisa-stage2-history/nisa-stage4/phase2-bundleD-layer2の各worktreeにも同形式の実例あり
- /home/shugo/apps/investment-portal/.claude/worktrees/phase2-bundleD-layer2/data/investment.db:1 — 先例: mainの実DB(86016バイト・/home/shugo/apps/investment-portal/data/investment.db)へのsymlink。今回worktreeも同じ前処理が必要（現状0バイトの空ファイルが置かれている点に注意＝上書きでなくrm→ln -s）
- docs/superpowers/audits/2026-08-09-chart-callout-audit.md:11 — 監査自身の検証パターン=mock_prod_server.py(PLAN2_PORT=8241/8242/8243)＋Playwright直書きスクリプトで実DB銘柄を開きスクショ＋Chart.js内部($datalabels $layout._box._rect)実測。監査:130に『パターン2/7/8は同一リリースで束ねるとdetail-snapshot.js突合が1回で済む』の運用示唆あり
