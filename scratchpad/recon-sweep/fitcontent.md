# fitcontent（recon実測 2026-08-21・HEAD 8e44298）

## summary
- 症状は現HEADでも未修正で有効：setCandleData（detail-charts.js:1300-1302）は `candleSeries.setData` のみで fitContent 無し。比較チャートの先例は :190 に移動（旧:171/旧:1238-1240 は stale）。
- **監査の修正方針に1点重大な無効化**：lightweight-charts **v4.2.3（index.html:44 SRI pin）に `maxBarSpacing` オプションは存在しない**（CDN実バンドル grep で0件・v5系機能）。クランプは `setVisibleLogicalRange` の左右パディングで手実装する必要がある。
- 干渉3点はすべて解決可能と裏取り済：①fitはFY切替/navigate経路（updateFinancialViews）限定でズームと非干渉 ②repaint（旧forceChartRepaint・現:697-723・遅延は[300,700,1100,**1500,1900**]msに延長済）は resize のみで fit をリセットしない（同寸resizeはno-op・念のため `lockVisibleTimeRangeOnResize:true` を追加） ③サブパネルは ensureSubSync（:441-447）＋mount時seed（:413-414）で自動追従。
- 全オーバーレイ系列（vol/MA/BB/KC/VWAP）は displayPrices 窓に filter 済（:490-536）・S/Rは createPriceLine（時間軸範囲なし・:241-258）＝fitContent が広い系列に引っ張られる罠は無い。
- 再現窓は「US銘柄で 2026 FY 手動選択」（2026-01-01〜データ末尾≈160営業日 < FHD閾値≈(paneWidth)/6≈220本）が最確実。工数=小（2-3h・干渉裏取りは本reconで消化済）。

## notes
### (a) 現HEADの該当箇所裏取り
- **setCandleData**: detail-charts.js:1300-1302。「薄いラッパ」コメント付きで `if (candleSeries) candleSeries.setData(displayPrices);` のみ。監査の旧:1238-1240 から+62行シフト（直近wave detail-charts.js 166行変更の影響）。
- **比較チャートの先例**: detail-charts.js:190 `compareChart.timeScale().fitContent();`（renderCompareChart 末尾・旧:171）。
- **initPriceChart**: detail-charts.js:593-。timeScale オプションは :608 `timeScale: { borderColor: "#2a3a44" }` のみ＝barSpacing 既定6px・fitなし・lock系オプション未指定。
- **呼び出し経路（唯一）**: detail.js:678 `DetailCharts.setCandleData(displayPrices)` → :679 `DetailCharts.updateMaAndVolume(displayPrices, data.prices)`。updateFinancialViews 内＝navigate（初回、150ms遅延 detail.js:631-633）と switchYear（detail.js:643-649）の2契機のみ。ユーザーのズーム/パン中に走る経路は無い。
- **窓ロジック**: detail-rules.js:433-439 priceWindow。US=暦年 `${year}-01-01..${year}-12-31`／JP=`${year-1}-04-01..${year}-03-31`。filtered 0件なら `prices.slice(-200)` フォールバック（=200本固定）。
- **オーバーレイの窓整合（fitContentの安全条件）**: detail-charts.js:490-536 updateMaAndVolume。volume=displayPrices 直接、MA/BB/KC=全履歴算出後 `d.time >= startTime && <= endTime` filter（:504-506, :511-514, :519-522）、VWAP=displayPrices 直接（:525）、S/R=candleSeries.createPriceLine（:241-258・水平線で時間範囲を持たない）。→ **fitContent が candle 窓より広い範囲に fit する系列は存在しない**。
- **サブパネル同期**: ensureSubSync detail-charts.js:441-447（priceChart の subscribeVisibleLogicalRangeChange → 全 mount 済みサブパネルへ setVisibleLogicalRange）。後mount時は :413-414 で priceChart の現 range を seed。→ fitContent/手動 setVisibleLogicalRange どちらも range change イベントを発火しサブパネルは自動追従。
- **repaint（旧 forceChartRepaint・改称済）**: detail-charts.js:697-723。`priceChart.resize(cc.clientWidth, cc.clientHeight)`＋resizeSubpanels＋Chart.js resize/update。スケジュールは rAF×2＋**[300,700,1100,1500,1900]ms**（:721-722）＝監査記載の[300,700,1100]から束D対応で2発延長済（detail.js:682-688 のコメントは旧値のまま stale）。resize は同寸なら視域に影響せず、fitContent を呼ばないので fit をリセットしない。
- **onWindowResize**: detail-charts.js:198-（150ms debounce で priceChart.resize）。幅が実際に変わる resize では lightweight-charts 既定（lockVisibleTimeRangeOnResize:false）＝barSpacing 維持・右端維持で **fit が崩れ左余白が再発**しうる → 提案でオプション追加。
- **barSpacing 依存の描画**: candle glow primitive の `bw = ts.options().barSpacing*0.72`（:546）は draw 時読み＝fit 後の実 barSpacing に自動追従（安全）。T-R帯（:568-）も timeToCoordinate ベースで安全。
- **ライブラリ検証（重要）**: index.html:44 = lightweight-charts@4.2.3（SRI pin）。CDN 実バンドルを取得し grep → `maxBarSpacing` **0件**・`fitContent` あり・`lockVisibleTimeRangeOnResize` あり。→ 監査の「maxBarSpacing クランプ」は **このバージョンではオプションとして実装不可**。手動クランプ（下記 proposal）に置換する。minBarSpacing 既定0.5はあるため多数バー側の fitContent は問題なし（例: モバイル350pxで200本→spacing1.75）。

### 再現窓の特定（実DB＋窓ロジック）
- data/investment.db（symlink 済・実測）: `financial_data_v2` の max(fiscal_year) は **JP=2026・US=2026**（ticker_master join で確認）。価格（OHLCV）は Neon 側 `market.ohlcv`（api/market/ohlcv.py:27）で SQLite に無く本数の直接 SELECT は不可。
- **主再現（実データ）**: US銘柄の「2026 FY」ボタン手動選択。窓=2026-01-01〜データ末尾（today≈08-21）≈**160営業日**。FHD の #chart-container（detail.css:53-56 width:100%・height450px、カード幅≈1300-1400px）で閾値=paneWidth/6px≈**約215-225本** → 160本は不足し左≈25-30%空白。※既定年は spec §5.2 の hasFinSubstance で「実質値のある最新年」に落ちるため、FY2026 が全ゼロ行の銘柄では**手動クリックが必要**（監査時 2026-08-09 は US 暦年進行が浅く自動でも該当した＝前提が季節でずれる点に注意）。
- **副再現（fallback 200本）**: 価格履歴の無い古FYボタン（例: 履歴3年の銘柄で最古FY）→ filtered 0件→slice(-200)=200本 < 閾値≈220本（FHD広カード時のみ僅かに不足）。
- **合成OHLCV（決定的再現）**: モック STOCK_DATA で prices を 2026-07-01 起点≈35本にした US 銘柄を作り 2026 FY を開く → 35本×6px=210px ≪ paneWidth＝少数バー・クランプ分岐の受入に使う。

## proposal
方針: 監査H の骨子（setData 後 fit＋少数バークランプ）は維持し、クランプを **v4.2.3 互換の setVisibleLogicalRange パディング方式**に置換。fit 実行点は setCandleData でなく **updateMaAndVolume 末尾**（全 setData 完了後・refreshSubpanels 後＝:536 直後）に置く（系列 setData による視域再調整の後で一度だけ確定させるため。呼び出しは detail.js:678-679 で常に対になっており経路は同一）。

1. **detail-rules.js に純関数追加**（テスト対象・+10行程度、priceWindow :439 の直後あたり）:
   ```js
   // fitcontent: 表示窓の logical range を決める（barCount×maxSpacing<width なら中央寄せパディング）
   function fitLogicalRange(barCount, paneWidth, maxBarSpacing = 15) {
     if (!barCount || !(paneWidth > 0)) return null;
     if (barCount * maxBarSpacing >= paneWidth) return { fit: true };
     const pad = (paneWidth / maxBarSpacing - barCount) / 2;
     return { fit: false, from: -pad, to: barCount - 1 + pad };
   }
   ```
   exports（detail-rules.js:986 の並び）に追加。
2. **detail-charts.js updateMaAndVolume 末尾（:536 refreshSubpanels の後）に+7行**:
   ```js
   const ts = priceChart.timeScale();
   const w = ts.width() || (document.getElementById("chart-container")?.clientWidth || 0);
   const r = DetailRules.fitLogicalRange(displayPrices.length, w);
   if (r) r.fit ? ts.fitContent() : ts.setVisibleLogicalRange({ from: r.from, to: r.to });
   ```
   ※ `ts.width()` は price 軸を除いた pane 幅（v4 に存在・clientWidth より正確）。0（非表示）なら skip＝0x0罠と同じガード思想。
3. **initPriceChart :608 の timeScale オプションに `lockVisibleTimeRangeOnResize: true` を追加**（+1語）: onWindowResize（:198）・repaint（:697）の幅変化 resize で fit（および ユーザーのズーム位置）を時間範囲基準で保存する。サブパネル（:406）は sync 受信側なので追加不要（付けても無害）。
4. **受入テスト**:
   - node: tests/detail-rules.test.js に fitLogicalRange 5-6アサート（fit境界・pad対称性・0本/幅0→null）。
   - Playwright（監査再現手法と同型）: モック鯖で ①US銘柄 2026 FY クリック→左端第1バーの描画確認 ②合成35本銘柄→クランプ分岐確認。アサート手段は (i) canvas 左端10%領域のピクセルサンプリング（背景#05080f以外の存在）か (ii) `DetailCharts.getPriceVisibleRange()` デバッグゲッター新設（+3行・resizePrice と同型の薄ラッパ・windowApi 数が変わるので detail-snapshot の windowApi キー再baseline要）。(ii) 推奨（数値アサート可能: `from<=0.5 && to>=n-1`）。
   - detail-snapshot: chartContainerDims/domHash は意図diff→検分→再baseline（harness.md の2層ゲート運用どおり）。canvasCount/pageErrors=0 は不変ゲート維持。
   - 本人実機サニティ: FHD 実GPU で 7203.T（正常年）→ズレなし／US銘柄 2026 FY→左余白解消／ズーム→FY切替→視域リセット（意図仕様）→ウィンドウリサイズで fit 維持。
- 挙動変更の明示（退行でなく意図変更として spec に書く）: (a) FY切替のたび視域リセット（従来も setData で右端寄せリセット相当・一貫性は向上） (b) モバイル/フォールバック200本窓が「右端スクロール」から「全窓圧縮表示」に変わる (c) 少数バー時のローソク幅が最大 maxBarSpacing×0.72≈10.8px にクランプ。
- 工数見積: **小（2-3時間）**。コード≈20行＋テスト＋Playwright受入。監査の「半日（ズーム干渉確認込み）」のうち干渉確認は本reconで消化済。

## risks
- **maxBarSpacing=15 の値決め**: 見た目の好み依存（候補12-18px）。本人実機サニティで最終確定（デザイン好み: リッチ・グラス系ローソクなので過大バーは間延びする）。
- **lockVisibleTimeRangeOnResize の副作用**: ウィンドウリサイズ時の挙動が「barSpacing維持・右端固定」→「時間範囲維持」に変わる。ズーム中のユーザーには時間範囲維持の方が自然だが、既存挙動の変化として検分対象。付けない選択肢もある（その場合リサイズで fit が崩れる既知制約として明記）。
- **setVisibleLogicalRange の負from**: lightweight-charts はデータ外 logical index を whitespace として扱い正常描画（比較チャート等で既知の標準動法）だが、candle glow primitive のカリング（:549 `x<-bw` skip）とレンジ帯 primitive が負域で座標 null を返すのは確認済経路。念のため Playwright で pageErrors=0 を確認。
- **windowApi キー数の変化**: デバッグゲッター新設（受入案ii）は detail-snapshot の windowApi 16→17 になり不変ゲートに触れる＝再baseline 1回必要。避けたければ受入案(i)ピクセルサンプリングに倒す。
- **detail.js:682-688 の stale コメント**（repaint 遅延[300,700,1100]と記載・実体は+1500,1900）: 本修正と無関係だが同ファイルを触るなら序でに事実化を推奨（コメントのみ）。
- **季節依存の再現性**: US 2026 FY の barCount は日付とともに増え、2026年11月頃（≈220本超）以降は実データ再現が消える。受入は合成OHLCVを正とし実データは補助。

## sites
- detail-charts.js:1300-1302 — setCandleData（現状 setData のみ・監査旧:1238-1240）
- detail-charts.js:490-536 — updateMaAndVolume（全オーバーレイの窓filter・fit挿入位置=末尾:536直後）
- detail-charts.js:190 — 比較チャートの fitContent 先例（監査旧:171）
- detail-charts.js:593/:608 — initPriceChart／timeScale オプション（lockVisibleTimeRangeOnResize 追加点）
- detail-charts.js:198-215 — onWindowResize（幅変化 resize・fit 崩れの現リスク源）
- detail-charts.js:697-723 — repaint（旧forceChartRepaint・rAF×2+[300,700,1100,1500,1900]ms・fit非干渉）
- detail-charts.js:441-447 — ensureSubSync（サブパネル時間軸 sync・fit 自動追従の根拠）
- detail-charts.js:413-414 — サブパネル後mount時の range seed
- detail-charts.js:406 — サブパネル createChart の timeScale オプション
- detail-charts.js:546 — candle glow の bw=barSpacing×0.72（draw時読み＝fit追従・安全）
- detail-charts.js:241-258 — applySRLines（createPriceLine＝時間範囲なし・fit非干渉）
- detail.js:678-679 — setCandleData/updateMaAndVolume の唯一の呼び出し対（updateFinancialViews 内）
- detail.js:643-649 — switchYear（FY切替契機）
- detail.js:682-688 — repaint 呼び出し＋stale コメント（[300,700,1100]表記）
- detail-rules.js:433-439 — priceWindow（US暦年/JP4-3月/fallback slice(-200)）
- detail-rules.js:986 — DetailRules exports（fitLogicalRange 追加点）
- detail.css:53-56 — #chart-container（width:100%/450px・FHD閾値算定の根拠）
- index.html:44 — lightweight-charts@4.2.3 SRI pin（maxBarSpacing 非搭載の根拠）
- docs/superpowers/audits/2026-08-09-chart-callout-audit.md:173-174 — 監査 観点3-H 原文
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:311 — fitContent は次wave繰越と明記
