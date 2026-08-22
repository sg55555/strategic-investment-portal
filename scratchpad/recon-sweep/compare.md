# compare（recon実測 2026-08-21・HEAD 8e44298）

## summary
監査3-F（比較チャート右軸バッジ8連＋凡例二重）は現HEADでも**症状・修正方針とも完全に有効**（spec§14残課題リストに「比較チャートバッジ8連」明記＝直近waveは比較チャート非接触）。file:lineのみズレ: detail-charts.js は BS吹き出しwave（280b353/6fcdf8f の bsLeaderPlugin 追加）で**+19行シフト**＝lastValueVisible 旧:166→**現:185**・legend生成 旧:168→**現:187**・fitContent 旧:171→**現:190**。detail.js 側は不変＝chips 旧:79-84→現:77-86（実質同位置）・setComparePeriod の window.event 依存は**今も :91**（Task3で暗黙global→window.event明示化のみ・脆さ不変）。修正設計＝lastValueVisible:false化＋legendに期間リターン%併記（データは normalizeForCompare 戻り値の末尾要素＝追加取得ゼロ）＋chipsティッカー化＋setComparePeriod引数化（呼出し元は index.html:1486-1489 の onclick 4箇所のみ＝引数化コスト極小・推奨=今回同梱）。工数=小（20行前後＋CSS 10行・検証込み半日弱）。

## notes

### (a) 症状該当箇所の現HEAD裏取り
- **右軸バッジ8連の根**: detail-charts.js:185
  `const series = compareChart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });`
  ＝8系列全て lastValueVisible:true。監査記載（旧:166）から+19シフト。シフト源=同waveの BS吹き出しコミット 280b353（低棒動的パディング）/6fcdf8f（bsLeaderPlugin :100-147 追加）。`git show 32eb0ae:detail-charts.js` の166行目が同一行であることを実測確認済（コード内容は当時と1字も変わらず）。
- **凡例生成（数値なし・chipsと同名二重）**: detail-charts.js:187
  `legendEl.innerHTML += `<div class="compare-legend-item"><div class="compare-legend-dot" …></div><span>${esc(STOCK_DATA[ticker]?.company_name || ticker)}</span></div>`;`
  ＝色dot＋社名のみ。fitContent は :190。renderCompareChart 本体= detail-charts.js:165-191（compareSet/comparePeriodMonths は detail.js closure私有→引数で受ける seam。コメント :163-164）。
- **上部chips（削除✕付き・社名フル表示）**: detail.js:77-86 renderCompareChips。:82 で `${esc(STOCK_DATA[t]?.company_name || t)}` ＝legend と同じ社名を二重表示。色も同じ COMPARE_COLORS[i]（detail.js:80 ↔ detail-charts.js:182 とも `[...compareSet]` の index 順で一致・データ空系列も色indexを消費する点まで両者同挙動＝色ズレなし）。
- **setComparePeriod の window.event 依存**: detail.js:88-93。:91 `window.event.target.classList.add("active");`。`git show 32eb0ae:detail.js` と diff ゼロ（監査時と完全同一・Task3コメント含む）。プログラム呼出し（console/テスト/将来のURL復元）では window.event が null → :91 で TypeError → :92 の renderCompareChart に到達せず**期間切替ごと失敗**する脆さは不変。
- **markup側**: index.html:1484 `#compare-chips`・:1485-1491 `.compare-period-bar`（onclick 4箇所 :1486-1489）・:1493-1494 cmp-tabs（指標比較タブ=2026-07-05 e39fb59 で監査前から存在）・:1496 `#compare-chart-container`・:1498 `#compare-legend`（タブコンテナ外＝表タブでも表示され続ける）。
- **CSS**: detail.css:328-333 `.compare-chips`（flex-wrap）・:334-344 `.compare-chip`（0.76rem 社名フル）・:372-377 `.compare-legend`（flex-wrap）・:378-384 `.compare-legend-item`（0.76rem）・:371 `#compare-chart-container` height 400px 固定・narrow は :443（@768 で modal-box 幅 min(429px, calc(100vw-24px)) のみ＝chips/legend の縦膨張対策は無し）。

### (b) 監査前提の有効性・直近waveでの変化
- **有効**: spec 2026-08-20-theme-a-chart-fixes-design.md:311 の残課題リストに「比較チャートバッジ 8 連」が明記＝今回waveのスコープ外として意図的に据え置き。detail-charts.js の比較チャート関数群（normalizeForCompare :152-161 / renderCompareChart :165-191）・detail.js の比較モーダル群（:27-93）はwave 18コミットで**無変更**（git show 32eb0ae 比較で確認）。修正方針（lastValueVisible:false＋legend%併記＋chips削除操作特化）はそのまま適用可能。
- **変化はfile:lineのみ**: detail-charts.js +19（上記）。detail.js はシフトゼロ。
- **検証系の前提**: scratchpad/detail-snapshot.js:8 WINDOW_API に 'setComparePeriod' 含む＝**存在チェックのみ**（シグネチャ変更OK）。tests/・recon-uiux/ に renderCompareChart/compare-legend/compare-chip を参照するテストは**皆無**（grep実測0件）＝既存テスト回帰リスク極小。
- **実データ面**: prices はローカル sqlite に無い（data/investment.db のテーブル= ticker_master/financial_data/financial_data_v2/weather_logs のみ）。実体は Neon `market.ohlcv`（api/market/ohlcv.py:26-28）→ addToCompare 時に getStock でハイドレート（detail.js:56・dataClient.js:64）。**legend用リターン%は normalizeForCompare の戻り値末尾（{time,value}[] の value=期間リターン%そのもの・toFixed(2)丸め済 :160）から取れる＝追加のデータ取得・API変更ゼロ**。filtered.length<2 の銘柄は現行どおり系列/legendともスキップ（:158, :184）で安全。
- **社名長の実測**（ticker_master 95銘柄）: 最長=「Vanguard Total Market ETF」25字・「NEXT FUNDS TOPIX連動型上場投信」23字・「MS&ADインシュアランスグループHD」19字等。480px幅で chips 8個が3-4行、legend 8行と併せて監査の「計16行」縦膨張の主因は**社名フル表示の二重**＝chipsティッカー化で chips は約2行に収まる見込み。

## proposal

### F-1 右軸バッジ抑止（1行）
detail-charts.js:185 `lastValueVisible: true` → `false`。priceLineVisible は既に false。

### F-2 legend に期間リターン%併記（±4行）
detail-charts.js:181-188 の forEach 内、:186 の後に
```js
const last = data[data.length - 1].value;
const pct = (last >= 0 ? "+" : "") + last.toFixed(1) + "%";
```
を置き、:187 の legend HTML を
`…<span>${esc(name)}</span><span class="compare-legend-val" style="color:${color}">${pct}</span></div>`
に変更（value は normalizeForCompare :160 で期間リターン%として算出済＝そのまま表示。符号は toFixed(1) 表示で統一）。CSS追加= detail.css:378-389 近傍に `.compare-legend-val { font-family: var(--ix-mono); font-weight: bold; margin-left: 2px; }`（約4行）。crosshair 時の系列別値は lightweight-charts のツールチップに委ねず現状維持（スコープ外）。

### F-3 chips を削除操作用に特化（1行＋任意CSS）
detail.js:82 `${esc(STOCK_DATA[t]?.company_name || t)}` → `${esc(t)}`（ティッカーのみ表示・✕と色枠は現状維持）。社名は legend（F-2でリターン%付き）が担う＝同名二重リスト解消。narrow 480px で chips 3-4行→約2行。任意で detail.css @media(max-width:768px) ブロック（:405-）に `.compare-legend { display:grid; grid-template-columns:1fr 1fr; gap:4px 10px; }`（約3行）で legend 8行→4行＝**縦膨張は監査の計16行→約6行**の見込み。

### F-4 setComparePeriod の window.event 解消（引数化・6行・今回同梱を推奨）
- **呼出し元の全列挙（現状）**: index.html:1486-1489 の onclick 4箇所のみ（`setComparePeriod(3)`/`(12)`/`(36)`/`(60)`）。JS内からの呼出しゼロ・window露出は detail.js:913（WINDOW_API は存在チェックのみ）。
- **判断材料**: 実クリック経路では window.event が入り production 動作は正常＝放置可。ただし修正コスト極小（4 onclick＋関数2行）で、受入テスト（Playwright evaluate からの期間切替）・将来のパーマリンク期間復元が可能になる。**推奨=今回同梱**（比較モーダルを触る唯一の機会に脆さも刈る）。
- **実装**: index.html:1486-1489 を `onclick="setComparePeriod(3, this)"` 等に。detail.js:88-91 を
```js
function setComparePeriod(months, btn) {
  comparePeriodMonths = months;
  document.querySelectorAll(".compare-period-btn").forEach(b => b.classList.remove("active"));
  (btn || (window.event && window.event.target))?.classList.add("active");
```
（フォールバック付き＝古い呼出し形も壊さない。btn無し・event無しでも throw せず :92 renderCompareChart に必ず到達）。

### 検証
detail-snapshot compare（windowApi 16/16・canvasCount・pageErrors 0 不変・legend変更は domHash 意図diff→検分→再baseline）＋Playwright で compare-modal 8銘柄×3M/1Y: 右軸バッジ0・legend 8行に%表示・480px で modal 総縦高の before/after 実測。工数=**小（実装20行前後＋CSS 10行・検証込み半日弱）**。

## risks
- lastValueVisible:false で「線の現在値を右軸で読む」手掛かりが消える→F-2 の legend% が代替（期間リターン軸なので終端%＝legend%と同値・情報損失なし）。
- legend の %値は期間開始日基準（normalizeForCompare :159 base）＝「基準: 選択期間開始日 = 0%」注記（index.html:1490）と整合するが、データ疎の銘柄は filtered[0] が期間途中始まり＝銘柄間で基準日が微妙に異なる（現行チャートも同じ性質・新規リスクではないが legend に数値が出ると気づかれやすくなる）。
- chips ティッカー化で銘柄検索直後の「追加された社名」フィードバックが弱まる→legend が直下で社名+%を出すため実害小。ETF等ティッカーだけで判別しづらい利用者には legend 参照動線。
- setComparePeriod 引数化は index.html markup 変更＝detail-snapshot の domHash が意図diffになる（F-2/F-3 と同束で1回の再baseline に載せる）。
- compare-table タブ（指標比較）表示中も #compare-legend は表示され続ける（index.html:1498 がタブコンテナ外）＝%付きlegendが表タブでも見える。現行も同じ構造で退行ではないが、気になるなら setCompareTab（detail.js:134）で legend 表示切替を追加（+2行・任意）。

## sites
- detail-charts.js:152-161 — normalizeForCompare（value=期間リターン%・toFixed(2)済＝legend%のデータ源）
- detail-charts.js:165-191 — renderCompareChart 本体（compareSet/period は引数seam・コメント:163-164）
- detail-charts.js:185 — lastValueVisible:true（監査旧:166・+19シフト・F-1修正点）
- detail-charts.js:187 — legend生成（色dot+社名のみ・監査旧:168・F-2修正点）
- detail-charts.js:190 — fitContent（監査旧:171・比較チャートは適用済＝観点Hの対比参照）
- detail-charts.js:100-147 — bsLeaderPlugin（今wave追加＝+19シフトの原因・比較とは無関係）
- detail.js:27-28 — compareSet/comparePeriodMonths closure私有
- detail.js:53-63 — addToCompare（上限8・getStock ハイドレート:56）
- detail.js:77-86 — renderCompareChips（:82 社名フル表示＝F-3修正点・監査旧:79-84）
- detail.js:88-93 — setComparePeriod（:91 window.event.target 依存＝F-4修正点・監査時と同一行）
- detail.js:134 — setCompareTab（タブ切替・legend表示切替の任意追加先）
- detail.js:907-914 — window露出（:913 setComparePeriod）
- index.html:1484 — #compare-chips
- index.html:1486-1489 — setComparePeriod onclick 4箇所（window.event 依存の全呼出し元）
- index.html:1490 — 「基準: 選択期間開始日 = 0%」注記
- index.html:1493-1497 — cmp-tabs/チャート/表コンテナ（表タブは e39fb59 2026-07-05＝監査前から存在）
- index.html:1498 — #compare-legend（タブコンテナ外）
- detail.css:328-351 — chips/chip/remove スタイル
- detail.css:371 — #compare-chart-container height 400px 固定
- detail.css:372-389 — legend スタイル（F-2 の .compare-legend-val 追加先）
- detail.css:405/443 — @768 media（narrow legend 2列グリッド化の追加先）
- scratchpad/detail-snapshot.js:8 — WINDOW_API に setComparePeriod（存在チェックのみ＝シグネチャ変更可）
- api/market/ohlcv.py:26-28 — prices の実体は Neon market.ohlcv（ローカルsqliteに無し＝SELECT検証不能を確認）
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:311 — 「比較チャートバッジ8連」残課題明記＝wave非接触の根拠
