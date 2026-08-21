# zeroFy（recon実測 2026-08-09・HEAD 143df86・wf_1876fa2c-3ac）

## summary
availableYears は detail.js:598-601 でのみ構築されるローカル const で、消費者は「既定年選択（:601）」と「年ボタンUI（:605-611）」の2つだけ。ただし年ボタン＝価格チャートのFY窓切替そのもの（switchYear→priceWindow）であり、FY2026 を配列から除外すると12銘柄の価格チャート既定窓が FY2025（JP: 2024-04〜2025-03）へ1年後退し、FY2026 窓（2025-04〜2026-03＝最新の選択可能窓）自体が選択不能になる副作用が確定。財務3表/レーダー/AI年ラベル/CSV/KPI比較/健全性トレンド/DuPont/FCF/ポータルグリッド/相対ポジションは availableYears を参照せず、各自 Object.keys(financials_trend) を独立に列挙するため、availableYears の除外だけでは KPI比較列・健全性0%落ち・FCFの0点・CSVのゼロ列・CrossSection の最新年汚染は残る。DB実測では述語「売上=0 AND 総資産=0」が対象12銘柄のFY2026行に過不足なく一致（偽陽性0・銀行は売上>0かつ固定資産巨大で安全・NULLは全293行で0件・除外後に空になる銘柄なし）。側パネル0.0%の実書込箇所は detail-charts.js:716-727（finance-rules.js の ratio() が分母0で0を返す）。

## notes
【DB実測（読み取りSELECT・重要：worktree の data/investment.db は 0 バイトの空ファイル（Aug 9 10:34 作成）で使用不能。実測は main 側 /home/shugo/apps/investment-portal/data/investment.db（86KB・May 19）を mode=ro で実施。この worktree で mock_prod_server.py を使う検証は実DBコピーが前提】 (1) financial_data_v2: 293行・95ticker・fiscal_year 2022-2026・fiscal_period 全行'FY'・PK(ticker,fiscal_year,fiscal_period)。全18データ列に NULL は0件（COALESCE不要だが述語には付けて損なし）。(2) 述語「COALESCE(net_sales,0)=0 AND COALESCE(current_assets,0)+COALESCE(non_current_assets,0)=0」のヒット＝指定12銘柄のFY2026行と完全一致（12行・過不足0）。該当12行は18列すべて0（gross_profit/ordinary/ibt/financing_cf/cf_cash_start/end含む）。(3) 偽陽性検証: 「売上=0かつ総資産>0」の行は0件＝銀行(8306.T/8411.T/8308.T)は net_sales>0（経常収益系の値・例8306.T 2025=6,838,439）かつ current_assets=0 でも non_current_assets が巨大（8306.T 2025=413,113,501）で総資産>0＝誤除外なし。「総資産=0かつ売上>0」も0件。つまり現データでは net_sales=0 単独でも12行に一致するが、AND述語が最も保守的。(4) 除外後に availableYears が空になる銘柄は0件（12銘柄は2023or2024〜2025が残る。6301.T/6762.T/6981.T/8267.T は残2年）。(5) データフロー: DB→（本番）Neon market.financials_annual→api/market/financials.py（Noneのみ省略・0は配信）→dataClient.js:65 が financials_trend を差替→detail.js。ローカル検証系は scratchpad/mock_prod_server.py が同DBを配信。JS側では 0 は hasValue=true なので、JS述語は数値判定必須（例: FinanceRules.n(fin.net_sales)===0 && FinanceRules.totalAssets(fin)===0）。監査BS-P1案の「!fin.net_assets」は 0/undefined 両方 true で現データでは等価だが、DB検証と同軸（売上∧総資産）に揃えるのが安全。(6) 側パネル0.0%経路: detail.js:650 fin取得→772素通り→789 renderBSChart→detail-charts.js:716-717（FinanceRules.equityRatio/currentRatio・finance-rules.js:32-39→ratio():19-22 が分母0で0返し）→:725/:727 animateNumber で「0.0%」書込。監査の「detail.js:772…側パネル0.0%」という因果記述は正しいが、書込サイトは detail-charts.js 側。(7) 監査file:line裏取り: detail.js:598-601✓（ただし:601は `|| 2025` 付き）・:772✓・detail-charts.js:716-727✓。ズレなし。(8) 銀行の流動比率0.0%は全年で起きる既存の別問題（current_assets=0/current_liabilities=0→ratio=0）＝全ゼロ行対策と混同しないこと（ポータル側は ratioOrNull で null 化済・詳細側パネルは未ゲート）。

## proposal
①共有述語の新設: finance-rules.js に純関数 hasFinSubstance(fin)（実装例: `n(fin.net_sales)>0 || totalAssets(fin)>0 || n(fin.net_assets)!==0`。現DBでは `n(net_sales)===0 && totalAssets(fin)===0` の否定と等価・12行に過不足なく一致をSELECTで実証済）を追加し tests/finance-rules.test.js に単体テスト（全ゼロ行/銀行行/通常行/欠損行）。index.html:1968 の既存 hasFinData 述語（net_sales>0||net_assets>0）もこれへ置換して単一源化。②既定年選択: detail.js:601 を「hasFinSubstance な最新年」へ（`selectedYear = availableYears.find(y=>FinanceRules.hasFinSubstance(data.financials_trend[y])) || availableYears[0] || 2025`）。③年ボタン: 推奨は【除外しない】＝FY2026ボタンは残し（価格FY窓 2025-04〜2026-03 の閲覧手段を保存）、updateFinancialViews 冒頭（detail.js:650）で `const fin = hasFinSubstance(raw) ? raw : null` として既存 !fin 経路（:772）へ合流。ただしこの経路は財務DOMのクリアが未整備なので、772の return 前に finCards（:756 の配列を流用）を isEtf と同様に非表示化 or「この年度は決算未確定」プレースホルダ表示を追加（前銘柄/前年の残像防止・必須）。もし監査PLCF-3案どおり availableYears から除外（detail.js:598 に .filter）するなら、12銘柄の既定価格窓がFY2025へ後退しFY2026価格窓が閲覧不能になる副作用を仕様として明記の上で選ぶこと（実装は1行で最小・stale問題も回避できるトレードオフ）。④残汚染の同時修正（availableYears では直らない）: healthTrendSeries（detail-rules.js:877-882 の eqOk/curOk に hasFinSubstance を AND）・fcfTrendSeries（:906-913 で !hasFinSubstance の年は全系列 null push）・renderKpiCompare（detail.js:529 で hasFinSubstance フィルタ or 列に「未確定」表示）・cross-section-rules.js:_latestFin（:63-69 を「hasFinSubstance な最大年」へ）・CSV（detail.js:156・任意＝生データとして残す選択も可）。⑤本命のデータ側（別Task・ETL）: 主要項目全0の行を保存しない/DELETE。表示側は前方防御として残す。

## risks
- 価格チャートFY窓の後退（最重要）: 年ボタン＝価格FY窓切替を兼ねるため、availableYears からFY2026を除外すると12銘柄の詳細初期表示の価格窓が FY2025（JP: 2024-04〜2025-03）になり約1年古いローソクが既定表示になる。FY2026窓（2025-04〜2026-03＝現在選べる最新窓）も閲覧不能化。除外方式を採るなら仕様として明示的に許容判断が必要
- !fin経路のstale残像: 株式で !fin（detail.js:772）は現状実質到達不能のため、この経路に全ゼロ年を合流させると前回描画の財務チャート/KPIグリッド/側パネル値/AI分析カードがそのまま画面に残る（クリア処理なし）。合流方式ならfinCards非表示化等のDOM後始末を必ず追加
- 部分修正のミスマッチ: availableYears/既定年だけ直しても KPI比較ストリップ（detail.js:526）・CSV（:156）・健全性トレンド0%急落（detail-rules.js:872, hasValue(0)=true）・FCFトレンドの0点（:904）・ポータルグリッド最新年（index.html:1964）・CrossSection分布からの12銘柄脱落（cross-section-rules.js:63）にはFY2026ゼロ行が残る＝監査『3チャート全壊』の完治には④が要る
- 述語の将来リスク: 現DBでは売上=0∧総資産=0が全ゼロ行と1:1だが、将来ETLが部分確定行（例: PLのみ先行入力）を作ると分類が揺れる。述語は『主要3軸（売上/総資産/純資産）いずれも実質値なし』の形にし単体テストで固定すること。またNULL混入時のJS挙動（hasValue=false）とSQL挙動（COALESCE）を揃えておく
- 本番はNeon: 実測できたのはローカルSQLite（main側86KB・May 19）のみ。Neonは同一系譜（restore 293行）ゆえ12ゼロ行の存在は濃厚だが未確認＝本番で1銘柄（例 6861.T）の /api/market/financials 応答を確認してから完了判定すべき
- 検証環境の罠: この worktree の data/investment.db は0バイトの空ファイル。mock_prod_server.py での再現・回帰確認には main 側DBのコピーが必要（空DBだと『全銘柄財務なし』となり誤った緑になる）
- 銀行の流動比率0.0%（別問題）を今回の述語で『欠損扱い』にしないこと: 銀行は売上>0・総資産>0で述語は正しく素通りするが、側パネル流動比率0.0%は残る（分母0→ratio()=0の既存挙動・直すなら ratioOrNull 化の別修正）
- selectedYear フォールバック `|| 2025`: フィルタで配列が空になる銘柄は現データでは存在しないが、防御としてこのフォールバックの挙動（2025固定）を仕様に残すか要判断
- availableYears.reverse()（detail.js:605）は破壊的変更。リファクタでフィルタ後の配列を後続でも使う場合、605以降は昇順になっている点に注意
- ETL再実行で全ゼロ行が再生成される可能性（来期FY2027行）: 表示側防御はこのための恒久ガードであり、データ側DELETEのみで済ませない

## sites
- detail.js:598 — availableYears 構築: Object.keys(data.financials_trend).sort((a,b)=>b-a)。監査の行番号どおり有効。除外フィルタの挿入点
- detail.js:601 — selectedYear = availableYears[0] || 2025（監査は「[0]」とだけ記載だが実際は || 2025 フォールバック付き。除外で配列が空になった時の挙動は2025固定）
- detail.js:605 — availableYears.reverse().forEach で年ボタン(.time-btn)生成。reverse() は配列を破壊的に昇順化（現状は以後の参照なし）。availableYears の消費者はこの601/605の2箇所のみ
- detail.js:638 — switchYear(year): selectedYear 更新→updateFinancialViews()。年ボタンが財務チャートと価格FY窓の両方を駆動する唯一のUI
- detail.js:674 — DetailRules.priceWindow(data.prices, selectedYear, isUS)＝価格チャートのFY窓。availableYears から2026を除外すると12銘柄の既定価格窓がFY2025へ後退（最重要副作用）
- detail-rules.js:433 — priceWindow 実装: JP=前年4/1〜当年3/31、US=暦年。filteredPrices 0件なら prices.slice(-200) フォールバック
- detail.js:650 — const fin = data.financials_trend[selectedYear]。全ゼロ行は値0のオブジェクトとして存在するため truthy
- detail.js:656 — _maxAbs = fin ? DetailRules.financialMaxAbs(fin) : 0 → pageUnit。全ゼロ行では maxAbs=0 → pickUnit(0) が「百万」既定＝監査P1のY軸「1百万円」重複の起点
- detail.js:772 — if (!fin) return（監査どおり）。全ゼロ行は素通りし789-801の財務描画へ到達。逆に、全ゼロ年をこの経路へ合流させると『前回描画の財務DOM/チャートが残留する』未整備経路（株式で!finは現状ほぼ到達不能・DOMクリア処理なし）
- detail.js:789 — DetailCharts.renderBSChart(fin, pageUnit)〜:801 renderFCFTrend まで、772ガード配下の財務描画列（レーダー:790・PL:791・CF:792・健全性:795・DuPont:800・FCF:801）
- detail.js:781 — AI分析年ラベル aiYearEl.innerText = selectedYear + " FY"（772ガード配下・fin.ai_analysis があるときのみ表示）
- detail-charts.js:716 — equityRatio/currentRatio = FinanceRules.equityRatio/currentRatio(fin)。全ゼロ行で両者0を算出
- detail-charts.js:725 — animateNumber(#equity-ratio, equityRatio, "%")＝側パネル『自己資本比率0.0%』の実書込点。:727 が #current-ratio『流動比率0.0%』
- finance-rules.js:19 — ratio(): 分母>0 でなければ 0 を返す＝『偽の0.0%』の根。equityRatio=:32-35, currentRatio=:36-39, totalAssets=:24-27(欠損0補完)
- detail.js:526 — renderKpiCompare: years = Object.keys(financials_trend).sort(昇順)＝availableYears 非参照。除外してもFY2026のゼロ列（売上0/YoY-100%バッジ）はKPI比較ストリップに残る
- detail.js:156 — exportCSV: years = Object.keys(financials_trend).sort()＝availableYears 非参照。CSVにFY2026ゼロ列が残る
- detail-rules.js:872 — healthTrendSeries: 全年ループ・hasValue は 0 を有効値扱い（finance-rules.js:65-67）→ 全ゼロ年は eq=0%/cur=0% の実点として描画（nullでない）＝健全性トレンドが2026で0%へ急落
- detail-rules.js:893 — dupontFactorSeries: FR.dupont は分母>0ゲートで全ゼロ年は4因数とも null＝欠測点になり無害（finance-rules.js:204-211）
- detail-rules.js:904 — fcfTrendSeries: fcf() は operating_cf/investing_cf が存在(=0)すれば 0 を返す→FY2026にFCF=0・営業CF=0・投資CF=0 の実点が描画される（fcfMargin/cashConversion は null）
- index.html:1964 — ポータルグリッド: finYears 降順 [0]=最新年を採用→12銘柄は全ゼロ2026行を掴む。:1968 に既存の同型述語 hasFinData = (net_sales>0 || net_assets>0) あり＝除外述語の先行事例（ただし年フォールバックはせず）
- cross-section-rules.js:63 — _latestFin = 最大年の fin を無条件採用→12銘柄は全ゼロ行。_finRatio(:52-62)の分母ゲートで比率は null＝相対ポジション/比較モーダルの分布母集団から12大型銘柄が脱落中（availableYears修正では直らない隣接汚染）
- api/market/financials.py:50 — None のみ省略し 0 はそのまま配信（_FIN_FIELDS 16項目）。本番Neonでも全ゼロ行は値0のオブジェクトとしてフロントへ届く（hasValue(0)=true）
- detail.js:607 — 年ボタン active 判定 yr == selectedYear（loose）。:532 は String比較。年の型（number/string）混在に依存＝リファクタ時の罠
