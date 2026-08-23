# SDD ledger — plan: docs/superpowers/plans/2026-08-22-uiux-quickfix-sweep.md

- Spec: `docs/superpowers/specs/2026-08-22-uiux-quickfix-sweep-design.md`（binding authority・D13〜D27）
- Branch: `worktree-uiux-chart-sweep`・base main `8e44298`・plan commit `ec426db`
- Tasks: 0-16（17個）＋wave クロージャ C-1〜C-7

## Pre-flight conflict scan（2026-08-22・Task 0 dispatch 前）

### 共有ファイル/インターフェースのタスクペア

| ペア | produces → consumes | 所見 |
|---|---|---|
| T0 → T8 | `TIME_AXIS_H`（B0 実測値）→ C4 の高さ補償定数 | ✅ Part A/B 双方が実機で 28px を先行実測済（MACD host rows=[82,28]）。T0 は再確認で済む |
| T0 → 全タスク | before-baseline（detail-baseline.json）→ 2層ゲートの起点 | ✅ T0 が最初＝コード変更前に capture する順序が守られている |
| T0 → T8 | canvasCount ON/OFF 不変性 → 層1ゲートの例外要否 | ✅ Part A/B 双方が「不変（軸OFFも7 canvas 保持）」を実測＝例外不要見込み。T0 の `invariant:true` で確定 |
| T2 → T14 | `DetailRules.isFinancialPL(fin)` → PL formatter の N/A 分岐 | ✅ 名前・シグネチャ一致。T14 は再実装禁止と明記済 |
| T4 → T10 | `srLabelPlan(r,s,close) -> {resistance:bool[],support:bool[]}`・`srNearest(sr,close) -> {up,dn}` → applySRLines 適用/和集合描画 | ✅ 一致。T10 は `axisLabelVisible: plan.resistance[i]` の形で消費 |
| T5 → T15 | `periodLabelParts(...) -> {main,period}`・`displayName(name,ticker)` → detail.js 配線 | ✅ 一致。T15 は period 空文字ガード付き（Part C 逸脱1＝妥当・空 span の余白防止） |
| T6 → T9 | `fitLogicalRange(bars,width,max=15)` → updateMaAndVolume 末尾の分岐 | ✅ 一致 |
| T1 → T14 | healthTrendSeries の curOk 分母条件 → Playwright「8306.T 流動比率実線なし」 | ✅ 依存順 1→14 が正しい |
| T7 → T8 | `chart.__host`（mount 時設定）→ unmount 時のバッジクリア/DOM 順判定 | ✅ 同一ファイル・T7 が先。T8 の DOM 順判定は host.compareDocumentPosition で独立 |
| T12 → T13 | `chart.$bsNote` / `$bsNoteRect` → bs-callout-verify のモバイル側アサート（MCD の noteRect null） | ✅ 一致。T13 は同 verify を拡張 |
| T4 ↔ T10 | `sr-window-verify.js:11` の `axisLabelVisible: i < 2` ソース固定アサート | ✅ T4 時点では applySRLines 未変更＝ゲート通る。T10 が適用と同時にゲート書換＝順序が正しい |
| T9 ↔ 前wave受入6本 | mock 鯖の検証専用 ticker `ZZFIT35` | ✅ Part B が「list には載せず ohlcv/financials のみ・verify が STOCK_DATA へ stub 注入」に具体化＝非波及（受入で `curl /api/market/list` 機械確認） |
| T7 ↔ T16 | detail.css（`.acc-metric` vs `.acc-item.expanded .acc-desc`）／detail.js acc-head innerHTML | ⚠️→✅ 別ルール・別領域。T16 は「acc-head の innerHTML 非接触」を Interfaces に明文化済 |
| T9 ↔ T15 | detail.js の近接行（T9=:682-688 コメント／T15=:665-677 配線） | ⚠️ 行番号ズレの可能性。T9 のコメント修正は行数不変（内容のみ）＝影響なし。T15 は実装時に現物確認するため実害なし |
| T14 ↔ T12/T13 | detail-charts.js renderBSChart（T14=側パネル :789/:799／T12,13=注記・サマリ） | ⚠️ 同一関数を別タスクが触る。実行順 12→13→14 で順次＝競合なし。**T14 の受入に bs-callout-verify 再走を必須化**（下記 Ruling 2） |
| T11 ↔ T16 | index.html（T11=onclick :1486-1489／T16=トグルバー :1222-1238） | ✅ 別領域 |
| T1-T6 | tests/detail-rules.test.js（全タスクが追加） | ✅ 追記のみ・重複なし（T5 のみ既存3本のうち1本を書換＝Part A が実測訂正済） |

### 各タスクの自己整合性

| Task | 自己整合 |
|---|---|
| T0 | ✅ 計測→記録→ベースライン確認。プロダクトコード非接触 |
| T1,T3 | ✅ 1条件追加＋TDD 1本ずつ。同型 |
| T2 | ✅ 新関数＋export＋targetOp 変更＋TDD 2本。レーダー形状の大変化は意図変更と明記 |
| T4 | ✅ TDD 9本。既存 S/R 錠4本の無改変緑を Part A が実測確認済（synthSRSeries はマージ後も `[{150,3},{160,3},{170,3},{122,1}]` 不変） |
| T5 | ✅ TDD 5本＋既存1本書換（3本→1本の訂正は実測根拠付き） |
| T6 | ✅ TDD 5本 |
| T7-T11 | ✅ 検証先行（受入スクリプトを先に書き FAIL 確認→実装→PASS）。node テストが効かない描画層の TDD 代替 |
| T12-T16 | ✅ 同上。T12 は roundRect 初出のフォールバック（手書き path）を明記 |
| 全体 | ✅ プレースホルダ0件・Global Constraints と矛盾なし（finance-rules.js 無改変／window 直下公開なし／money 系非接触） |

### Rulings（Task 0 dispatch 前）

- **Ruling 1: Task 1 と Task 3 をバッチ化して1ディスパッチ・1レビューにする** — 理由＝どちらも「detail-rules.js の既存関数に1条件追加＋TDD 1本」の同型・最小変更で、レビュー単位としてまとめても焦点がぼけない（skill の batch small same-shape work）。Task 2 は新関数＋レーダー形状の意図変更を含むため単独のまま。**コストが外れた場合**＝片方だけ却下したいレビュー判断が発生したときに fix 対象の切り分けが1段増える（差し戻し粒度が粗くなる）程度。
- **Ruling 2: Task 14 の受入に `bs-callout-verify.js` の再走を必須ゲートとして追加する** — 理由＝T14 が触る側パネル（detail-charts.js:789/:799）は renderBSChart 内にあり、T12/T13 が同関数に入れた注記・サマリを壊しうる。plan の T14 受入には明記がない（回帰束の「推奨」に留まる）。**コストが外れた場合**＝T14 のレビューが1本余分に走るだけ（60秒以内）。
- **Ruling 3: Task 0 のレビューは cheap model で軽く回す** — 理由＝プロダクトコード非接触（scratchpad の計測スクリプトと baseline JSON のみ）だが、skill は task review のスキップを禁じている。**コストが外れた場合**＝計測スクリプトの欠陥を見逃し、T8 が誤った TIME_AXIS_H を使う（ただし Part A/B の二重実測 28px と突き合わせるため検出可能）。

## タスク状態

- Task 0: complete（B0 前処理・2026-08-23）
  - 8200 専有確認: lsof 無出力(exit1) → mock 鯖起動 → curl 200
  - before-baseline capture: `scratchpad/detail-baseline.json` canvases=27 pageErrors=0 windowApi=15/17（非コミット）
  - B0 実測（`scratchpad/b0-measure.js`）: **TIME_AXIS_H=28px**・**canvasCount 不変=true**
    （adx+atr=27→+rsi(軸OFF)=34→+macd(軸ON)=41→+obv=48／deltaAxisOFF=7=deltaAxisON=7）
    → pre-flight scan の見込み値（28px・不変）と完全一致・spec §12.1 に例外追記不要
  - 付随実測: サブパネル右軸幅 adx52/atr46/rsi52/macd58/obv92px、メイン右軸(`#chart-container`)66px
    （詳細は `scratchpad/plan-parts/b0-measured.md`）
  - ベースライン確認: node 334 pass/0 fail・pytest 228 passed・前wave受入6本 ALL PASS
    （theme-floor-check checked=77/145 を記録・後続でのセレクタリネーム検出用）
  - pageErrors: 全ステップで 0
  - commit: chore(sweep) B0 前処理（`scratchpad/b0-measure.js` + `scratchpad/plan-parts/b0-measured.md`）
  - 逸脱・懸念: なし（プロダクトコード非接触を維持）

- Task 0: complete (commits ec426db..550920e, review clean — 仕様適合✅/Approved/Minor のみ)
  - controller が解決した「⚠️ Cannot verify from diff」3件: ①Co-Authored-By 行あり（git log 確認）②`scratchpad/detail-baseline.json` は untracked で残存（12,601 bytes）③8200 解放済み（ss 確認）＝PID kill 成功
  - Minor（deferred なし・全て解消済み）

- Task 1: complete (commits 550920e..deae2aa, review clean — 仕様適合✅/Approved/Issues なし)
- Task 3: complete (commits deae2aa..658e2d7, review clean — 仕様適合✅/Approved/Issues なし)
  - バッチ実装（Ruling 1）・node 334→336 pass / pytest 228 不変・finance-rules.js 無改変を実測確認
  - core:true 3段が key 非保持ゆえ経常段省略条件に一切マッチしないことをレビューが確認
- Task 2: complete (commits 658e2d7..262a12d, review clean — 仕様適合✅/Approved・Important 1件は下記 Ruling 4 で解決)
  - node 336→338 pass / pytest 228・finance-rules.js 無改変・window 直下公開なし（レビュアーが実測確認）
  - HOLDING 判定が isFinancialPL より先＝9984.T の税引前代替は不変（radarScores holding テストで実証）
- Task 4: complete (commits 262a12d..88f21fd, review clean — 仕様適合✅/Approved/Issues なし)
  - node 338→347 pass[+9] / pytest 228（controller が実測再確認＝レビュアー環境の .venv 未整備による ⚠️ を解決）
  - レビュアーが実機検証: マージは sort+slice の前・境界1%は厳密不等号で非マージ・連鎖マージは last 加重平均更新で決定論・digest 側 for ループは 0 件（単一源化の実証）・sr-window-verify 14項目 ALL PASS（prefix 性含む）・既存テスト無改変
- Task 5: complete (commits 88f21fd..64fdd7f, review clean — 仕様適合✅/Approved/Issues なし)
- Task 6: complete (commits 64fdd7f..af9fdf4, review clean — 仕様適合✅/Approved/Issues なし)
  - node 347→357 pass[+10] / pytest 228（レビュアーが独立実行で確認）
  - displayName は `(${ticker})` の完全括弧一致のみ＝QQQ 型括弧連鎖で誤爆しない（D14 準拠）／periodLabelParts の4分岐（US/JP/ETF/フォールバック）とも仕様どおり／fitLogicalRange は境界等号込み・pad 対称（from+to = barCount-1）・無効入力5種すべて null
  - 既存 periodLabel テスト書換は1本のみ（US/JP の2本は無改変で緑＝退行検出の錠として機能）
- Task 7: complete (commits af9fdf4..c092169, review clean — 仕様適合✅/Approved/Issues なし)
  - 検証先行が機能: subpanel-verify.js 実装前 FAIL 14件 → 実装後 ALL PASS 17項目（レビュアーが独立再実行して 17/17 再現）
  - 軸幅 before 52/46/52/58/92 → **after 全パネル 72px 統一**（OBV volume 化を先に入れる順序制約どおり）
  - ATR バッジ: textContent 書込（XSS 面拡大なし）・ATR 以外は空・unmount でクリア・銘柄/FY 切替で再計算
  - 0x0 罠ガード（mountSubpanel の clientWidth>0・createChart 順序）はこの diff で未接触とレビュアーが行番号で確認
  - 層1 無条件 MATCH・層2 は `.acc-metric` 空 span 由来の domHash のみ→再 baseline 昇格（chartContainerDims は price-scale 内部配分を捉えない構造とソースで確認）
  - node 357 / pytest 228 不変（レビュアーが独立実行で再現）
- Task 8: complete (commits c092169..3485231, review clean — 仕様適合✅/Approved/Issues なし)
  - 実装者は DONE_WITH_CONCERNS で報告（受入コードの「連打後も軸は最下段1枚」チェックを既存 SOFT_CAP との干渉でテスト側限定修正）→ **レビューが妥当と検証**: ①除外条件は「chart 不在で軸を持ちえない未マウント項目」のみの狭い条件で二重軸・誤配置の検出力は温存 ②SOFT_CAP は diff 外の既存ロジック（detail.js は macd height 1行のみ変更）③`_updateSubTimeAxes` は `_subMounted`（マウント済みキーのみ）を走査＝実装側の不足ではなく元テストの前提ミス
  - subpanel-verify 31件 ALL PASS（Task7分16＋C4分15）・層1無条件 MATCH・node 357 / pytest 228 不変（レビュアー独立実行で再現）
  - MACD 104 の二重定義ミラー・host.style.height の ON/OFF 同期・rAF 世代ガードが 0x0 罠構造を壊していないことを確認・Task 7 の成果は全て温存
- Task 9: complete (commits 3485231..c0e2aeb, review clean — 仕様適合✅/Approved/Issues なし)
  - fit-range-verify ALL PASS（12チェック）・実測 NVDA 181本→from=0/to=180（左余白ゼロ）・ZZFIT35→from=-25.1/to=59.1（from+to=34=barCount-1 の中央対称と数学的に整合・bar幅15.18px）
  - ズーム退行なし: fit 評価は updateMaAndVolume（唯一の呼び出し元 detail.js:680＝navigate/年切替経路）のみで、ズーム時の subscribeVisibleLogicalRangeChange はサブパネル同期のみ＝fit を呼ばないことをレビュアーが確認
  - `maxBarSpacing` は純関数のパラメータ名としてのみ存在し LWC API には未使用（v4.2.3 に無い API を呼んでいない＝D20 準拠）
  - `getPriceVisibleRange` は DetailCharts 名前空間のみ・WINDOW_API 固定17名に含まれないため windowApi 15/17 不変が構造的に保証（層1・層2とも無条件 MATCH＝再 baseline 不要）
  - ZZFIT35 は `/api/market/list` に非掲載（100件・非含有を curl 確認）＝前 wave 受入6本 ALL PASS 維持
  - node 357 / pytest 228 不変（レビュアー独立実行で再現）
- Task 10: complete (commits c0e2aeb..5e99ca2, review clean — 仕様適合✅/Approved/Issues なし)
  - sr-window-verify 実装前 FAIL 2件 → 書換後 ALL PASS 27チェック（代表3銘柄で labelR≤2・ペア間≥1%・終値±1%抑制・digest引用線の存在を実データで数値検査）・`:32-33` subset アサートは diff 上 context 行のみ＝無改変
  - 和集合: `drawn` Set で価格キー重複除外・追加線は axisLabelVisible:false 固定・実測 100銘柄平均+0.89本/最大+2本/71銘柄該当（定義と整合）
  - 選抜ロジックの再実装なし（applySRLines は detectSR→slice(0,3)→srLabelPlan/srNearest を呼ぶのみ）・R/S 取り違えなし
  - 層1 domHash 差分の説明をレビュアーが検算: 用語集追記87文字 × `data-term="sr"` 2箇所（index.html:1236 の静的チップ／detail.js:270 の digest 行）× `data-def`+`aria-label` 2属性 = 348文字増と厳密一致＝S/R 線（canvas 描画）は DOM 非影響
  - node 357 / pytest 228 不変・前 wave 受入6本＋新規 verify 全て ALL PASS
- Task 11: complete (commits 5e99ca2..ae2dfae, review clean — 仕様適合✅/Approved/Issues なし)
  - 480px モーダル総縦高 816→787px（chipsH 122→56・legendH 68→105＝-66+37=-29 で内訳整合）・before はコード変更前の Step1 で取得済み（証跡あり）
  - F-2 は `normalizeForCompare` の末尾 value を toFixed(1) するのみ＝新規取得/再計算なし・data 長0の系列は系列と legend を同一ループでスキップ＝不整合なし
  - F-4 は `(months, btn)` 引数化＋`window.event` フォールバック保持・onclick 4箇所が全量（grep 確認）・programmatic 呼出しは optional chaining で無害 no-op
  - 層2「完全同一」の妥当性を構造で確認: `#compare-modal`(index.html:1474) は `#detail-view`(1183) の**兄弟**＝domHash の対象外（見逃しではない）
  - node 357 / pytest 228 不変・回帰束＋前 wave 受入6本 ALL PASS
- Task 12: complete (commits ae2dfae..0df1924, review clean — 仕様適合✅/Approved/Issues なし)
  - bs-callout-verify 実装前 8 FAILED → ALL PASS（レビュアーが独立再現）・roundRect はフォールバック不要で実描画成功・**失敗時は非サイレント**（例外→pageerror／`$bsNoteRect` が非 null に進まない）構造をレビュアーが確認
  - D22 準拠を確認: `bsNotePlugin` は `$datalabels`/`$layout._box._rect` を一切参照せず `bsLeaderPlugin` と完全分離・`$bsNoteRect` は afterDatasetsDraw 冒頭で毎フレーム明示クリア（残留なし）
  - 単位整合をレビュアーが実データで独立検算: MCD FY2025 net_assets -1791(百万ドル)→「▲18億ドル」・SBUX -8089→「▲81億ドル」・`unit` は `pickUnit(bsAxisMax, currency)` を軸と共有
  - モバイル 375px では `!isMobile && hasNegativeEquity` ゲートで `$bsNote`/`$bsNoteRect` とも null（＝Task 13 のサマリが兼務する設計）をレビュアーが実機確認
  - 層1/層2とも MATCH（canvas 描画内容は detail-snapshot の測定対象外＝構造的に妥当）・node 357 / pytest 228 不変
- **Ruling 6: Task 12 と 13 をバッチ化しようとしたが、controller のブリーフ生成漏れで Task 13 が NEEDS_CONTEXT となり分離実行に切り替え** — 実装者は「brief 無しでの推測実装はリスクが高い」（renderBSChart は行番号ドリフト実績あり＝$bsLeaders 書込行が :966→:1040 へ移動）と判断して Task 13 を実装せず報告した。これは**正しい判断**（controller のミス＝task-brief 13 の生成漏れ）。task-13-brief.md を生成し Task 13 は単独で再ディスパッチする。**コストが外れた場合**＝バッチ化の狙い（同一ファイル・同一 verify を1回のレビューで済ませる）が失われレビューが1回増えるが、Task 12 の diff が確定した状態で 13 を積む方が差分は読みやすい。
- Task 13: complete (commits 0df1924..ec2a75e, review clean — 仕様適合✅/Approved/Issues なし)
  - bs-callout-verify 実装前 5 FAIL（モバイル新規分）→ ALL PASS（レビュアーが独立再実行）
  - `lowTuples` 2段化は述語・配列順序とも無変更＝**機能等価**（デスクトップのチップ/リード線ブロックが全件 PASS のまま）
  - 閾値の非対称（desktop 0.12 / mobile summary 0.15）はコード内に D21 の意図コメントあり・`MOBILE_NOTE_LOW=0.15` が実際の datalabels 表示ゲート `>= 0.15` と数値一致することをレビュアーが確認
  - 実測: 8306.T「純資産 21.7兆円 (5.3%)」・MCD 先頭が「純資産 ▲18億ドル（債務超過）」かつ `$bsNoteRect === null`（Task 12 のモバイルゲートと整合）・7203.T は最小 29.2% で hidden
  - stale 経路なし（ETF/欠損は `.card` ごと display:none に包含）・銘柄/FY 切替で renderBSChart フル実行＝残留なし
  - 層1 無条件 MATCH・層2 は index.html 1行追加分の domHash のみ→昇格・node 357 / pytest 228 不変
- Task 14: 実装 DONE（commit b35422b）→ レビュー **Changes requested**（Important 2件）→ fix round 1/5 進行中
  - 実装は4件とも仕様適合✅（isFinancialPL / ratioOrNull を呼ぶのみ・finance-rules.js 無改変・9984.T の持株会社特例は維持・7203.T 非退行をレビュアーが再現確認）
  - **Important 1（実バグ）**: レーダー offset 8→16 の逸脱により、ROE 軸（真上・-90°）が最大値100のときラベルが canvas 上端から約6.6px はみ出す。実データ32銘柄サンプルで **4519.T（全軸100）・9984.T（ROE=100）** で再現。受入は低スコア側の交差0のみ検証し高スコア側のクリップ未検証＝**カバレッジ不足が主因**
  - **Important 2**: レポートの「全ケースで副作用なし」が過大な安全主張（8306.T は低スコアで当該経路を踏まない）
  - fix 指示: クリップ解消（offset の動的決定 or r scale への padding 確保）＋受入に 4519.T/9984.T の**クリップ0アサート追加**（検証先行）＋レポート表現の修正
- Task 14: fix round 1/5 (2 addressed, 0 open — Finding1 レーダークリップ / Finding2 レポート過大主張; commits b35422b..c3f80ba)
  - 採用方針: align 式・offset:16 は無改変のまま **`layout.padding: 20`** を radar options に追加（Chart.js の chartArea 全周縮小＝標準機構）。スコア依存の条件分岐を持ち込まず満点軸のクリップだけを一様解消
  - 幾何整合をレビュアーが確認: 修正前 +6.6px → 修正後 **-13.4px**（`6.6 - 20 = -13.4`）＝恣意的な数値でないことの裏付け
  - 低スコア側の団子解消は維持（8306.T/9984.T/4519.T/7201.T いずれも相互交差 0 を実機再現）
  - 受入は空虚でない: `radarClipCount` は `_box._rect` の4辺を chart.width/height と数値比較する幾何判定・18/18 PASS
  - 新規破損なし（bs-callout-verify ALL PASS・node 357 / pytest 228 不変・detail-snapshot 層1/層2とも MATCH）
- Task 14: complete (commits ec2a75e..c3f80ba, 2 findings addressed in 1 fix round)
- Task 15: complete (commits c3f80ba..986667a, review clean — 仕様適合✅/Approved)
- Task 16: complete (commits 986667a..bc6a21b, review clean — 仕様適合✅/Approved)
  - **esc() 適用漏れなし**（最重要確認項目）＝`titleParts.main`/`period` とも esc 経由・innerHTML に生データなし
  - D27（wide でも副題 block）は media 分岐なしの無条件指定で 1440/480 とも block・色は `--ix-text-dim`（AA 寄り）
  - `.ctrl-pair > .term-help` 4件（keltner/sr/zigzag/vwap）・各 previousElementSibling が BUTTON・空 span 全廃・ボタン内包（nested interactive）は不採用どおり未使用
  - D2 は CSS 1行のみで acc-head innerHTML 非接触＝Task 7 の `.acc-metric` を保護
  - titles-verify 9/9・toolbar-terms-verify 9/9（`:empty` 判定は不使用）・theme-floor-check checked=77/145 非減少
- Task 15: minor (deferred): detail.js のヘッダ三項演算子が `DetailRules.displayName` と同じ述語（`name.includes("(ticker)")`）を1行再掲＝将来ドリフトの芽。実害ゼロ（brief 指定コードどおり）。次回 brief で `hasTickerSuffix` 等のヘルパーに寄せるのが望ましい。

## wave クロージャ（2026-08-23・全16タスク完了後）

- **C-1 全 suite**: ✅ node **357 pass / 0 fail**・pytest **228 passed**（controller 実測）
- **C-2 前 wave 受入6本**: ✅ ALL PASS（bs-callout / sr-window / unit-badge / zerofy / zerofy-portal / theme-floor）
- **C-3 本 wave 新規 verify 6本**: ✅ ALL PASS（subpanel / fit-range / compare / finviz-labels / titles / toolbar-terms）
- **C-3b 横断スモーク**: ✅ portal-money-smoke 8/8・smoke-zigzag-range pageerror 0
- **C-4 detail-snapshot**: ✅ **MATCH**（層1/層2とも差分なし・pageerror 0）
- **C-5 money 非接触**: ✅ 機械確認「非接触 → cockpit-e2e 不要」
- **C-6 変更面棚卸し**: ✅ プロダクトコード6ファイル（detail-charts.js +220 / detail-rules.js +135 / detail.css +28 / detail.js +23 / index.html ±22 / tests/detail-rules.test.js +218）・**finance-rules.js 無改変**・19 commits（8e44298..bc6a21b）
- 実行スクリプト＝`scratchpad/wave-closure.sh`（8200 専有チェック→mock 鯖起動→14本＋snapshot→PID kill）

## 全ブランチレビュー（2026-08-23・opus・19 commits 通し）＝**Ready to merge**

- D13〜D27 の全27決定が実装に正しく反映・「後のタスクが前の意図を静かに壊した箇所」ゼロ・不可侵制約すべて維持
- Findings: Important 2（I-1 null 非安全 / I-2 animateNumber 競合）＋Minor 7 → **1回の fix wave で I-1/I-2/M-6 を処理**、残 Minor は次 wave へ triage
- fix commit `3ac1500`（bc6a21b の子）＝**再レビューで3件とも ADDRESSED・新規破損なし・Ready to merge**
  - I-1: `hasTickerSuffix(companyName, ticker)` を rules 層に切り出し `displayName` と共有＋配線側も一本化（null 安全化＋同一述語の2実装を解消）
  - I-2: `el.__animSeq` 世代トークン（同期採番→tick 冒頭で不一致 return）＋`bumpAnimSeq()` を静的書込み**4箇所**（current-ratio N/A・equity-ratio マイナス・txt-per-val "--"・txt-pbr-val "--"）。**正常系（同一要素の連続 animate）は後着ち優先で完走**することをレビュアーがロジックで確認
  - M-6: `radar-clip-375-verify.js` 新設＋`wave-closure.sh` 組込み。**375px で 4519.T/9984.T/7201.T ともクリップ0・交差0**＝実装変更不要（実測が根拠・空虚でない）
- 最終クロージャ: `wave-closure.sh` **ALL GREEN**（受入15本＋detail-snapshot MATCH）・node **357 pass** / pytest **228 passed**・money 系3ファイル＋finance-rules.js 無接触

### 次 wave 送りの Minor（全ブランチレビューの triage）
- M-1 `roundRect` の無ガード呼び出し（Safari<16.4/Chrome<99 で債務超過銘柄の BS 描画が止まる・対象ブラウザ実質なし）＝1行で `c.roundRect ? … : c.rect(…)`
- M-2 プラグイン例外の遮断なし（`bsLeaderPlugin` が throw すると後続の `bsNotePlugin` も実行されない＝D22 の分離は「ガード済み故障モードに限り」成立）＝両プラグインを try/catch で包む
- M-3 `periodLabel` が製品コードから未使用（テストのみが生かす互換ラッパ）
- M-4 `host.style.height` 書込みのガード位置が `_updateSubTimeAxes` と `resizeSubpanels` で不一致（実害なし・流儀の統一）
- M-7 D16（`isFinancialPL`＝op=0∧経常>0）と D17（`ratioOrNull`＝分母0）が別述語なのに同じ「銀行・金融」文言を出す。**現データでは外延一致を実測**（`current_liabilities=0` の48件＝金融12銘柄×3年36件＋全ゼロFY12件[hasFinSubstance が弾く]）＝誤文言は出ない。次 wave で desc 側も `isFinancialPL` ゲートにし他の null 原因は中立文言へ
- 検証 viewport の偏り（`subpanel-verify`/`fit-range-verify`/`finviz-labels-verify` は 1440px のみ）＝M-6 で radar は 375px を追加済み、他も同様に広げる余地

### 構造的な申し送り（レビュアーの所見）
- **Task 7 と Task 16 が偶然噛み合っている**: `.acc-metric`（ATR 中央値）が非空になるのは展開中の ATR のみで、そのとき `.acc-desc` は D2 で消えている＝`flex-wrap` を持たない `.acc-head` が 375px で詰まらない。**片方だけ次 wave に送っていたら押し出しが起きていた**組み合わせ。今後どちらかを触る際の注意。
- **`_updateSubTimeAxes` の高さ残留は `expandSubpanel` が毎回 base 高さを書き戻すことで打ち消されている**（この不変条件はコメント未記載＝将来 `expandSubpanel` の高さ書込みを消すと 28px の空白が復活）。
- **`srLabelPlan` の「plan パターン」は良い前例**（入力と同長の boolean 配列を返し、描画・node テスト・受入が同一実装を参照＝選抜ロジックの二重実装によるドリフト根絶）。今後「描画判断を rules 層の plan 関数に出す」第一候補として明文化の価値あり。
- 新設8純関数は rules 層規約に適合（副作用なし・縮退入力は例外でなく null/空/false・export 漏れなし）。流儀の揺れ3点＝既定値の書き方（デフォルト引数 vs `== null` 旧イディオム）／しきい値の名前付け（`MERGE_TOL` は名前付き・`srLabelPlan` 内の同概念 0.01 はベタ書き）／`fitLogicalRange` だけ3値の判別付きオブジェクトで呼び出し側に二段判定を要求。

- **rules 層（Task 1-6）完了＝新設純関数8点が出揃う**: hasFinSubstance系curOk強化 / plSteps IFRS filter / isFinancialPL / detectSR二次マージ / srNearest / srLabelPlan / displayName+periodLabelParts / fitLogicalRange
- **Ruling 5: タスク単位の「変更面確認」は money 系3ファイルの不在を実質判定とし、ファイル数の厳密一致は求めない** — plan の一部タスク受入に `git diff --name-only 8e44298` が「4ファイル」等と書かれているが、ベース 8e44298 には本 wave の spec/plan/recon 文書コミット（ec426db）が含まれるためファイル数の一致は原理的に成立しない（Task 5+6 実装者がこの不一致を懸念として報告）。**コストが外れた場合**＝タスク単位でのスコープ逸脱検出が1段緩くなるが、wave クロージャ C-5/C-6 の棚卸しと各タスクのレビュー（触ってよいファイルの明示）で二重に担保済み。
- **Ruling 4: Task 2 の `isFinancialPL` は spec D16 の式のまま維持（`FR.n()` の欠損=0 正規化を変えない）** — レビュー Important「`FR.n()` は null を 0 に正規化するため欠損と実0を区別できず、`operating_income` 欠損×`ordinary_income>0` の非金融行があれば誤判定」に対し、**controller が実DBで検証**: ①`isFinancialPL=true` になる行は 36行・12銘柄で**全て金融業種**（銀行5/保険3/証券2/US金融2）＝非金融の誤判定 0件 ②`operating_income` が NULL の行は **DB 全体で 0行**＝欠損と実0の混同は現行データで発生しない。よって実害ゼロ・spec 準拠の実装を変更しない。**コストが外れた場合**＝将来 ETL が `operating_income` に NULL を入れるようになり、かつ同じ行の `ordinary_income>0` だと非金融銘柄が「N/A(銀行・金融)」と誤表示される（検出は容易・`FR.hasValue` ゲート追加の1行で修正可能）。次 wave 積み残しへ申し送り。

（以下、各タスクの完了・fix round・parked を追記）
