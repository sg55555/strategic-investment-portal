# チャート吹き出し/ラベル 横断監査（2026-08-09・main 32eb0ae）

> 太田さん指摘「銘柄によっては吹き出し表示が不格好」を受けた3観点並列監査。
> 各観点とも実財務DB＋Playwrightで20〜26銘柄を実際に開き、スクショ＋DOM/Chart.js内部実測で裏取り済み。
> スクショ＝セッションscratchpad `callout-audit-*.png`（一時領域・本ドキュメントが恒久記録）。

## 観点1: BS積み上げチャートの吹き出し

# BS積み上げチャート吹き出し監査（ポート8241・main 32eb0ae・読取専用）

**手法**: scratchpad/mock_prod_server.py を PLAN2_PORT=8241 で起動（終了時kill済・8242/8243の並行セッションは非接触）→ Playwright で 26銘柄デスクトップ1440 + 2銘柄1024 + 4銘柄モバイル390 = 32キャプチャ。スクショに加え Chart.js `$datalabels` 内部（`$layout._box._rect`=最終ラベル絶対矩形）とバー矩形を抽出し、クリップ/重なり/余白利用率を数値検証。プラグイン実装（chartjs-plugin-datalabels@2.2.0 の compute$1/aligned/coordinates）も読み、位置決定ロジックを裏取りした。全データ: `/tmp/claude-1000/-home-shugo-apps/d2c8b3b8-9c24-427b-857e-9939d514e25f/scratchpad/bs-audit-results.json`、スクショ同ディレクトリ `callout-audit-<観点>-<ticker>.png`。制約（2軸配置・barPercentage=1.0不変）はすべての修正案で遵守可能（吹き出し/ラベル/パディングのみ）。

## パターン分類（重症度順）

### P1【観点c】全ゼロ年度がデフォルト表示＝空チャート＋壊れたY軸＋偽の0.0%（最重症）
- **発生条件**: financial_data_v2 の最新年度(2026)が全項目0の銘柄。**12銘柄該当**=6861.T(キーエンス)/8035.T(東エレク)/6501.T(日立)/4063.T/8001.T/8058.T/7741.T/9020.T/6762.T/8267.T/6981.T/6301.T。詳細を開いた瞬間のデフォルト年がこれになる。
- **症状**: バー0本の空チャート、Y軸目盛が「1百万円」×6連続の重複ナンセンス表示、側パネルは自己資本比率0.0%/流動比率0.0%と実在データのような偽値。スクショ: `callout-audit-zeroyear-6861.T.png` / `callout-audit-zeroyear-8035.T.png`。
- **原因**: ①detail.js:598-601 `selectedYear = availableYears[0]`（最新年を無条件採用）②detail.js:772 `if (!fin) return` ガードは行が存在（値0）するため素通り ③finance-rules.js:120-130 `fmtUnitValue` の小数桁エスカレーションは「0に丸まる時だけ」発動→0.5〜1.0の目盛が全部「1百万円」に潰れる。
- **修正方針**: updateFinancialViews で `FinanceRules.totalAssets(fin)===0 && !fin.net_assets` を欠損と同格に扱い財務チャートをスキップ（既存 !fin 経路へ合流）＋デフォルト年選択を「totalAssets>0 の最新年」へ（detail.js:601）。fmtUnitValue の隣接目盛衝突は suggestedMax か dec引き上げで別途。**工数: 1-2h＋テスト**。⚠本番はNeon読みだが同一ETL系譜のため再現濃厚（本番確認1件推奨）。

### P2【観点b】低棒(<12%)横逃がし吹き出しがバーの上に載る＝「右の宇宙」設計が不発
- **発生条件**: 固定負債(または固定資産)が総資産12%未満。6758.T(ソニー・重なり52%)/NVDA/6954.T/4507.T/7974.T/4519.T/AMD等。
- **症状**: 「右へ75px飛ばす」はずの吹き出しがバー右半分に被さり、極小段（7974.T 2.2%/4519.T 1.3%）では**隣の純資産・流動負債セグメントの上に30%超浮いて誤帰属に見える**。スクショ: `callout-audit-lowbar-6758.T.png` / `callout-audit-doublelow-4519.T.png` / `callout-audit-doublelow-7974.T.png`。
- **原因**: detail-charts.js:851 `return context.dataIndex === 0 ? "left" : "right"` — **anchor に 'left'/'right' は datalabels の不正値**（有効値は start/center/end。プラグイン compute$1 がフォールバックで segment中点=バー中心線を採用）。バー中心から offset75（:875）では極太バー（半幅≒132px）の外に出られない。結果、確保した右180pxパディングへの突出は実測20-64pxのみ。
- **修正方針**: offset コールバック（:870-879）で `context.chart.chartArea.width/4 + 12` （バー半幅+ギャップ）を返し確実にバー外へ出す（anchor は 'center' のままで可・:851 の不正値も 'center' に正す）。**工数: 1-2h**。P4のリード線と併せた再設計が本筋。

### P3【観点b/e】純資産低棒の下向き吹き出しが canvas 下端で欠け＋「調達源泉」軸ラベルを隠す
- **発生条件**: 純資産が総資産12%未満＝**メガバンク・金融の定常形**。8306.T/8411.T/8308.T/JPM（＋未撮影の8309.T/8750.Tも同構成）と4755.T(楽天)。
- **症状**: 吹き出し矩形が y=492.5〜541.1 で canvas(530px)を**11pxはみ出し文字が欠け**、かつX軸カテゴリラベル「調達源泉」の真上に被って読めない。スクショ: `callout-audit-bank-8306.T.png` / `callout-audit-tinyboth-4755.T.png`。
- **原因**: detail-charts.js:850 anchor'start'＋:864 align'bottom'＋:876 offset15 の組で軸ラベル帯（bottom padding はわずか20px・:801）へ突入。
- **修正方針**: 純資産の低棒も横（右）逃がしへ変更（P2の offset 補正と同式）or 下パディングを吹き出し高(約50px)ぶん確保。**工数: 30min-1h**（P2と同時実施推奨）。

### P4【観点a】右パディング180px固定＝吹き出しの無い銘柄では純デッドスペース
- **発生条件**: 全デスクトップ表示。低棒なし銘柄（7203.T/9432.T/AAPL/MSFT/META/9022.T/SBUX/銀行等、実測26銘柄中14）は**利用0px**、吹き出しありでも最大64px。左100px+軸で計約280px＝canvas880pxの32%が常時非プロット領域、チャートが左に寄って見える。スクショ: `callout-audit-normal-7203.T.png`（右の空白帯が顕著）。
- **原因**: detail-charts.js:801 `padding: {left:100, right:180, ...}` 固定。P2のanchorバグで「飛ばす」前提が崩れているのに予約だけ残った構図。
- **修正方針**: renderBSChart 冒頭で構成比は既知なので `hasLow = 5値のいずれかが0<v/totalAssets<0.12` を判定し `right: hasLow ? 100 : 16, left: 8`（軸ラベルはChart.jsが自動確保）へ動的化。P2の「バー半幅+ギャップ」化とセットなら予約は吹き出し実幅+マージンで足りる。**工数: 1h**。

### P5【観点b】吹き出しにリード線が無く帰属曖昧・重なり回避も無制御
- **発生条件**: 低棒吹き出し全般。上逃がし（流動負債/流動資産）は棒の上空に浮遊（9022.T/META/MCD/4755.T）、横逃がしは隣接段上（P2）。複数吹き出し時の衝突回避は display:true のため datalabels の collision 機構も無効。
- **症状**: どのスライバーの値か視線で辿れない。スクショ: `callout-audit-lowbar-9022.T.png` / `callout-audit-doublelow-6954.T.png` / `callout-audit-negequity-MCD.png`。
- **原因**: detail-charts.js:841-879 に結線描画なし（吹き出し風の枠 :818-833 のみ）。
- **修正方針**: 小さな afterDatasetsDraw プラグインで吹き出し縁→セグメント中心に1pxシアンの結線（既存 neonGlowPlugin と同居可・chart.$bsLeaders 的な spec を renderBSChart で登録）。theme D の HUD 感とも整合。**工数: 2-3h**。P2/P3/P4と合わせ「吹き出しレイアウト一括再設計」として0.5-1日が現実的。

### P6【観点c】債務超過（純資産マイナス）がチャート上で完全に無痕跡
- **発生条件**: net_assets<0。**MCD/SBUX** が該当。
- **症状**: 純資産セグメント・ラベルとも消滅し、調達源泉列=負債のみ。SBUXは左右列高が25%不一致（資産32.0 vs 調達40.1十億ドル）だがチャート上の説明ゼロ（側パネルの「マイナス」表記のみ）。BSが釣り合って見えない。スクショ: `callout-audit-negequity-SBUX.png` / `callout-audit-negequity-MCD.png`。
- **原因**: detail-charts.js:713-715 `displayNetAssets = hasNegativeEquity ? 0 : ...`＋:881 `if (value === 0) return null`（負値を0化→ラベルも消える）。
- **修正方針**: hasNegativeEquity 時のみ調達源泉列上部に「純資産 ▲x.x兆円（債務超過）」の注記吹き出しを追加描画（データは0のままラベルだけ、P5のプラグインに相乗り可）。**工数: 1-2h**。
- 派生: :811/:821等の構成比分母が totalAssets のため負値時の調達源泉列では閾値意味がずれる（軽微・上記対応に内包）。

### P7【観点d/a】中間幅(≈1024px)で固定280pxパディングがプロットを圧殺
- **発生条件**: 768px≦ウィンドウ幅<1200px程度（isMobile二値判定のためデスクトップ扱い）。全銘柄。
- **症状**: canvas464pxに対しL100+R180固定→プロット幅約180px。バー内ラベルがバー幅を超えて背景と隣列へ溢れ（7203.T narrowで流動負債×流動資産ラベルが171px²重複）、6954.Tでは「運用形態」が斜め回転・「調達源泉」がautoSkipで消失、吹き出しはデッドスペース中央に浮遊。スクショ: `callout-audit-narrow1024-6954.T.png` / `callout-audit-narrow1024-7203.T.png`。
- **原因**: detail-charts.js:711 `isMobile = window.innerWidth < 768` の二値と :801 固定px。
- **修正方針**: パディングを canvas 幅比例（例 `right: Math.min(180, w*0.15)`）にするか、P4の動的化に幅係数を含める。**工数: 1h**（P4と同一変更点）。
- 該当銘柄補足（(d)本来の長文字列）: 折返し/はみ出しの破綻は不検出（ラベルは2行固定・最大幅112.6px=NVDA「17.3十億ドル」）。USD「十億ドル」表記の幅がJPY比1.6倍で、この中間幅問題を悪化させる増悪因子ではある。

### P8【観点e/軽微】モバイルで低棒情報が全損＋チャート高の縮み疑い
- **発生条件**: <768px。閾値15%未満はラベル自体非表示（detail-charts.js:809-812）のため、銀行の純資産（8306.T=5.3%）や楽天の流動負債/純資産が「無ラベルの極小スライバー」化し情報ゼロ。加えて実測 canvas 高150px vs detail.css:453 の280px指定と乖離（縮み疑い・別途実機確認推奨）。スクショ: `callout-audit-mobile390-8306.T.png` / `callout-audit-mobile390-4755.T.png`。
- **修正方針**: モバイルはチャート外（カード下）に「純資産 21.7兆円 (5.3%)」式の1行サマリを低棒分だけ出す。**工数: 2h**。

## 該当なし（健全確認）
- ETF（SPY/1306.T）はBSカード自体が非表示で吹き出し問題なし（`callout-audit-etf-SPY.png`）。
- 欠損項目（銀行の流動資産/流動負債=0）は formatter の null 返し（:881）で正しく無ラベル化されており0値の捏造表示なし。
- デスクトップ1440では吹き出し同士の直接重なりは不検出（重なるのは「バー/隣接セグメントと」P2、「軸ラベルと」P3）。

## 推奨実施順
①P1（誤情報・即効/低リスク）→②P2+P3+P4+P7一括（同一ブロック detail-charts.js:801-879 の吹き出しレイアウト再設計・0.5-1日）→③P5リード線（theme D仕上げ）→④P6/P8。すべて BS2軸・barPercentage=1.0 非接触。

---

## 観点2: PL棒/CFウォーターフォールのdatalabel・レーダー・pageUnit

# PL棒/CFウォーターフォール datalabel・レーダー・pageUnit 監査報告（観点担当・ポート8242）

**実施内容**: mock_prod_server.py（実DB data/investment.db・PLAN2_PORT=8242）+ Playwright で 24銘柄（日/米・大型/中小型・ETF2・金融6・非金融）を実際に開き、plChart/cfChart/radarChart の canvas を撮影（1600px幅＋1024px幅の狭幅パス）。スクショは scratchpad/callout-audit-{pl|cf|radar|etf|pl1024|cf1024}-<ticker>.png（scratchpad=/tmp/claude-1000/-home-shugo-apps/d2c8b3b8-9c24-427b-857e-9939d514e25f/scratchpad）。サーバは終了済（他観点エージェントのサーバは温存）。pageerror 0。正常系（NVDA/SBUX/6506.T/COST/4502.T/V/NFLX/8604.T/9984.T-CF/7201.T-CF）は概ね良好で、ETF（1306.T/SPY）は財務チャート非表示＝崩れなしを確認。

---

## パターン1【最重要・単位精度崩壊】pageUnit がBS/CF最大値で選定され PL/CF ラベルが「0.01兆円」「0.1兆ドル」に潰れる
- **発生条件**: 総資産・期首現金が損益より2桁以上大きい銘柄（銀行・楽天型金融混業・BRK）。pageUnit は financialMaxAbs（総資産/現金含む15項目の一括max）で決まるため、PLの実スケールと乖離。特にUSDは pickUnit に「億ドル」層がなく 十億→兆 が1000倍ギャップ。
- **該当例**: BRK-B（PL全段「0.1兆ドル」×4連発＋y軸目盛「0.1兆ドル」が4本重複＝callout-audit-pl-BRK-B.png、CFは「+0.002兆ドル」「+0.0005兆ドル」＝cf-BRK-B.png）／JPM（純利益$57Bが「0.1兆ドル」＝約2倍に見える丸め・pl-JPM.png）／4755.T楽天（銀行預金6.2兆が単位を兆円にし営業利益144億円→「0.01兆円」・pl-4755.T.png）／8306.T（営業CF64億円→「+0.01兆円」・cf-8306.T.png）／7974.T（cf-7974.T.png）。対照群: 6506.T「403億円/565億円」（cf-6506.T.png）は億円単位で自然＝単位さえ合えば美しい。
- **原因**: detail-rules.js:453-462 financialMaxAbs（15項目一括max）→ detail.js:656-657（ページ統一単位）→ finance-rules.js:104-115 pickUnit（1e6百万以上で兆・dec=1固定・USDに億層なし）＋ finance-rules.js:120-130 fmtUnitValue（dec自動拡張が 0.0005兆ドル を生む）＋ detail-charts.js:1097/1228（軸callbackも同整形＝目盛重複）。
- **修正方針**: ①チャート別単位（PLはPL項目max・CFはCF項目maxで pickUnit）へ分離しヘッダは「単位: チャート毎」表記 or 各チャートタイトル脇に単位表示 ②pickUnit に USD「億ドル」層追加＋軸目盛は目盛間隔から小数桁を動的算出（重複目盛根絶）。finance-rules は単体テストあり（tests/finance-rules.test.js）で安全に変更可。**工数: 中（1-2日）**。「10.6十億ドル」という読みにくい和文もこの層で「106億ドル」に直る。

## パターン2【銀行で営業利益0の無意味ラベルが宙に浮く】
- **発生条件**: operating_income=0 の実データ（銀行は勘定科目が存在しない）。plSteps で営業利益は core:true=常時表示、formatter が0でも「0␤営業利益率: 0.0%␤(基準値4-5%前後)」の3行を出す。棒が無いので黄色ラベルだけが中空に浮遊。
- **該当例**: 8306.T MUFG（pl-8306.T.png）・8411.T・JPM（pl-JPM.png）・BRK-B（pl-BRK-B.png）。レーダーも同根で銀行は収益性0点に潰れる（radar-8306.T.png）。
- **原因**: detail-rules.js:518（core:true）・detail-charts.js:1064-1082（formatter に銀行分岐なし・9984.Tのみ HOLDING_COMPANIES 特例 detail-rules.js:33）・radarScores detail-rules.js:593（op固定）。
- **修正方針**: HOLDING_COMPANIES 特例と同型で「金融業種 or (op=0∧経常>0)」を判定し、営業利益段を「N/A(銀行・金融)」表示 or 段省略＋レーダー収益性は経常利益率で代替。**工数: 小（半日）**。

## パターン3【全ゼロ年度（FY2026未確定行）が既定表示→3チャート全壊】
- **発生条件**: DB financial_data_v2 に全項目0のFY2026行が存在する12銘柄（6861.T/8035.T/4063.T/8001.T/8058.T/6501.T/7741.T/9020.T/6762.T/8267.T/6981.T/6301.T）。詳細を開くと最新年が既定選択され全ゼロを描画。
- **該当例**: 6861.T キーエンス（PL: 「0」ラベル6個がx軸ラベルに重畳＋y軸「1百万円」が4本重複＝pl-6861.T.png、CF: 空チャートに0ラベル列＝cf-6861.T.png、レーダー: 25点/20点/0点が中心で団子＝radar-6861.T.png）・8035.T 東エレ同様。
- **原因**: （データ）ETLが未確定年度を全0で保存＋（表示）detail.js:601 `selectedYear = availableYears[0]`＋detail-charts.js:1056-1057 `Math.abs(val)/max` が max=0 で NaN→align "bottom"=軸領域へ落下。
- **修正方針**: 本命はデータ側＝ETLで主要項目全0の行を保存しない/削除。表示側の防御として availableYears 構築時に「売上・総資産とも0の年」を除外（detail.js:598-601）。**工数: 小**。

## パターン4【CFウォーターフォールのラベル衝突（狭幅で全壊・広幅でも接触）】
- **発生条件**: ①canvas幅 ~700px未満（1024px viewport で cfChart は462px＝実際に起こる通常デスクトップ幅）で 6-7段×2行ラベルが横衝突 ②負diff段の下端が0付近（期末現金が小さい）でラベルがx軸ラベルに重畳。
- **該当例**: JPM@1024（「その他・調整+0.02兆ドル」と「期末現金残高0.3兆ドル」が合体・投資活動CFラベルが軸と重畳＝cf1024-JPM.png）／MCD@1024（財務活動CF「-7.1十億ドル」が回転軸ラベルと判読不能に混合・右端見切れ＝cf1024-MCD.png）／MCD@1600でも財務活動CFラベルが軸ラベルと衝突（cf-MCD.png）／JPM@1600 投資活動CFが軸に接触（cf-JPM.png）。
- **原因**: detail-charts.js:1181-1215（formatter が段名を含む＝x軸ラベルと二重表示で幅を倍消費・1203-1213）＋1188-1201（diff<0 は anchor "start"+align "bottom"＝下方向に逃がす設計で下端近傍の退避なし）＋1182（desktopは幅に関わらず常時表示・clamp なし）。
- **修正方針**: ①ラベルから段名を削除し「+10.6」等の値のみに（段名はx軸が持つ）＝幅半減で横衝突ほぼ解消 ②下端が chartArea.bottom 近傍なら align を "top" に反転するガード＋clamp:true ③canvas幅<600px は isMobile 同様ラベル省略。**工数: 小〜中（1日）**。

## パターン5【銀行の巨大期首現金でフロー段が不可視・ゼロ段の空白波形】
- **該当例**: 8306.T（期首110兆 vs 営業CF64億＝営業段の棒が完全消滅しラベルのみ浮遊・投資/財務は1-2pxヘアライン＝cf-8306.T.png）・8411.T（cf-8411.T.png）・2503.T キリンFY2025（op=inv=fin=0で塔2本の間に「0」ラベル3個が浮遊＝cf-2503.T.png※データ側の0埋めも疑い）。
- **原因**: detail-rules.js:552-585 cfWaterfall の絶対値積み上げ設計（期首・期末を0起点の塔で描く）は銀行の現金規模で破綻。
- **修正方針**: 期首が |フロー|max の N倍（例10倍）超なら「フロー専用表示」へ自動切替（期首/期末塔を波線断裁 or 純増減のみの4段波形＋期首/期末は数値カードで表示）。**工数: 中**。

## パターン6【「その他・調整」段がデータ不整合で巨大化＝誤誘導】
- **該当例**: 7203.T トヨタ（+3.7兆円＝財務CFの6倍の紫塔・cf-7203.T.png）・9984.T SBG（-0.7兆円・DBの cf_cash_start/end が3年間同一値＝明らかに古い静的値・cf-9984.T.png）。
- **原因**: DBの cf_cash_start/end がフローと年連鎖しない（detail-rules.js:563-573 は差額を全て「その他・調整」へ吸収）。表示ロジックは正しくデータが誤り。
- **修正方針**: ETL/restore に年連鎖検証（start[y]≒end[y-1]）を追加しデータ再取得。表示側は |fxOther| がフロー合計の50%超なら「※データ差異を含む可能性」注記。**工数: データ側中・表示側小**。

## パターン7【持株会社 N/A ラベル・浮遊「0」の軸衝突】
- **該当例**: 9984.T FY2025（「N/A␤(持株会社仕様)」がx軸「営業利益」ラベルに重畳＝全値正で基線が下端のとき・pl-9984.T.png。経常利益=0 も「0」が中空浮遊＝IFRSで経常が存在しないのに0保存）。FY2023は基線が上がるため衝突せず（pl-9984.T-2023.png）。
- **原因**: detail-charts.js:1054-1055/1066-1068（zero-height barに center 配置）・detail-rules.js:517（ordinary_income=0 が hasValue 通過）。
- **修正方針**: val=0 の段は anchor "end"+align "top"+offset固定で基線上方へ統一退避。ordinary=0∧ibt≠0 は段省略（IFRS判定）。**工数: 小**。

## パターン8【レーダー: 低スコア時に点数ラベルが中心で団子】
- **該当例**: 6861.T（3つの「0点」+25点/20点が中心に密集重畳・radar-6861.T.png）・7201.T（0点/5点が合体・radar-7201.T.png）・8306.T（0点/11点重畳・radar-8306.T.png）。
- **原因**: detail-charts.js:967-973 の radar datalabels に anchor/align/offset 指定なし＝点の真上に中央配置→低スコア点は全て中心付近に集合。
- **修正方針**: 各頂点の放射角に応じた align/offset で外向きに退避（datalabels の align は関数で角度指定可）＋同値重畳時は表示間引き。**工数: 小（数時間）**。

## パターン9【theme D 可読性: 明色ネオン棒内の明色文字】
- **該当例**: NVDA 売上総利益「153.5十億ドル」白on明ミント・7201.T 売上高「12.6兆円」白on明シアン（pl-NVDA.png/pl-7201.T.png）。高い棒は anchor"end"+align"bottom"=棒内上端に描かれ、neonBarBg 上端 alpha0.90 の明色と #eaf4ff/#67e8f9 が近接。textShadow で辛うじて読めるが theme D の中で一番曖昧。
- **原因**: detail-charts.js:1050-1057（高棒は棒内配置）＋89-93 neonBarBg（上端0.90明色）＋1037-1042（ラベル色固定）。
- **修正方針**: BS吹き出しで実績のある「#0a0f17 チップ+シアン縁」背景（detail-charts.js:818-833 と同型）を高棒内ラベルにも適用 or 全段 align"top" 統一（グラフ上余白は grace35% 済で収まる）。**工数: 小**。

---
**優先順位の提案**: P1=パターン1（誤読リスク＝JPM純利益が2倍に見える）→ P2=パターン3（12銘柄の既定表示が全壊）→ P3=パターン2・4（衝突/浮遊の頻出）→ P4=パターン6（データ整備）→ P5=5・7・8・9。パターン2/7/8 は同一リリースで束ねると検証（detail-snapshot.js 突合）が1回で済む。なおETF詳細は財務チャート非表示で崩れなし（ヘッダ「単位: 百万円」の無意味表示のみナノ指摘・etf-1306.T.png）。

---

## 観点3: 価格チャート系の注記・凡例・サブパネル

## 価格チャート系（注記・凡例・サブパネル）不格好ケース監査報告【ポート8243・完了/サーバkill済】

検証法: scratchpad/mock_prod_server.py を PLAN2_PORT=8243 で起動し、日米・大小・ETF・金融/非金融の26銘柄（JP株13/JP ETF2/US株8/US ETF3、例: 7203.T/8306.T/8309.T/9983.T/1306.T/AAPL/NVDA/GOOGL/JPM/BRK-B/SPY/QQQ/VTI）を Playwright で実際に開き、典型状態（MA×3+S/R+T/R ON）・全トグルON・サブパネル5枚全展開・FY切替（疎窓/フォールバック）・比較8銘柄×3期間・480px幅を撮影（計108枚+拡大crop、/tmp/claude-1000/-home-shugo-apps/d2c8b3b8-9c24-427b-857e-9939d514e25f/scratchpad/callout-audit-*.png、DOM計測 callout-audit-price-report.json）。pageerror 0。※合成OHLCVのため波形は銘柄間相似（比較チャートの線重なり密度は誇張）だが、以下は全てレイアウト/ラベル機構の欠陥で実データ非依存に再現する。

### A.【a】S/R線の右軸バッジ渋滞・重なり・クリップ（最頻・視認性最悪）
- 発生条件: S/R線ON。片側最大3クラスタ×2＋終値バッジ＋タイトルチップ(R×n/S×n)が右軸に縦積み。レベル近接(±1%未満)で相互に重なり、窓の高安端でバッジが上下クリップ。480px（チャート高220px）では右軸の約半分がバッジ列になり終値バッジが埋没。
- 例: callout-audit-chart-SPY.png（7バッジ・1672.41/1662.57隣接）/ subpanel-NVDA.png（R×1 5414.35とS×2 5409.96が重なり）/ narrowchart-GOOGL.png（5483.39/5480.80重なり+終値埋没）/ narrowchart-8306.T.png（上端クリップ）/ fy-8306.T.png。
- 原因: detail-charts.js:227-238（createPriceLine を axisLabelVisible:true+title で全レベルに発行・近接マージ無し）。
- 修正: ①近接レベル（±0.5〜1%）をマージしcount合算 ②最強度上位2本/側のみ axisLabel 表示（残りは線+タイトルのみ）③端クランプ。工数: 半日。

### B.【a】S/R線が「全履歴の直近252本」算出で表示窓・サマリと不整合（先読みリーク＝正確性も毀損）
- 発生条件: S/R ON＋過年度FY窓。チャート側は applySRLines(base)＝全履歴を detectSR が slice(-252)→「今日から直近1年」で算出するため、FY2025窓（〜2025-03）にも2026年のレベルを描く。結果「S線が現値の上・R線が下」の逆転表示が常態化し、テクニカル現在地サマリ（displayPrices・maxPerSide=Infinityで別算出）と数値不一致。
- 例: chart-7203.T.png（S×2 3648.99 が窓高値の上に浮く）/ chart-SPY.png（R×3線が終値の下）/ fy-7203.T.png（S×2 3648.99 が出来高帯に食い込む）。
- 原因: detail-charts.js:508（applySRLines(base)・base=全履歴 483行）vs detail-rules.js:707（digest は detectSR(dp, Infinity)）、detail-rules.js:118（slice(-252)）。detail-rules.js:707 直上の「チャート描画のS/R線と整合」コメントは事実と不一致（stale）。
- 修正: チャート側も displayPrices 基準へ統一・maxPerSide を揃え単一源化・コメント更新。工数: 1-2時間+目視回帰。優先度最高（見た目と意味の両方を直す）。

### C.【d】サブパネルの二重ラベル・生値軸・端クリップ・軸幅不揃い（全銘柄で常時）
- C1 基準線の「タイトル+軸ラベル」二重表示: RSI「70 70.00」「30 30.00」（detail-charts.js:268-270）、ADX「25 25.00」（:316）、ATR「中央 1.0%」+「1.03」+最終値バッジの3連渋滞（:344）。例: subpanel-NVDA.png/fy-7203.T.png。修正: axisLabelVisible:false（タイトルのみ残す）。工数: 極小。
- C2 OBV軸が生値2桁小数「-58416942.00」で軸幅~115px（他パネル66px）→パネル間で同一日のx座標が横ズレ+醜い。原因: buildOBV detail-charts.js:348-353（priceFormat未指定）。修正: priceFormat:{type:'volume'} か 百万/億の自前フォーマッタ+全パネルの軸桁を揃える。工数: 小。
- C3 小型パネル（RSI100px/ATR104px・scaleMargins0.1 detail-charts.js:251/365-371）で上下端ティックが半クリップ（「0.60」「80.00」等）。修正: margins拡大 or 高さ+16px。工数: 極小。
- C4 時間軸がMACDのみ固定ON（detail-charts.js:365-371）のため、展開順によりスタック中段に時間軸が挟まり最下段（OBV等）に無い。例: subpanel-NVDA.png。修正: mount/unmount時に「最下段のみ時間軸ON」を applyOptions で動的切替。工数: 小。

### D.【c】トグルバーの迷子「?」・説明文の二重表示
- 空の `.ma-label`（data-termのみ）に?が注入され、MA75/KC20/S-R線/T-R線/VWAPの後ろに無所属の?チップが浮遊。「エンベロープ」はラベル側に?＋KC分が別に浮く＝紐付け規則が不統一。480pxの3行折返し（実測97px）で悪化。例: zoom-7203-toolbar.png/narrowchart-8306.T.png。原因: index.html:1220/1226/1231-1233（空span）+detail.js:224-231（injectTermHelp）。修正: ?を各ボタン/ラベルに内包し空spanを廃止。工数: 小。
- アコーディオンヘッダの acc-desc と展開直後の acc-full-desc が同文二重（narrowはヘッダ側が「…」省略+直下に全文）。原因: detail.js:359-370。修正: `.acc-item.expanded .acc-desc{display:none}`。工数: 極小。

### E.【b】テクニカル現在地サマリの折返し崩れ（narrowのみ・desktopははみ出し無しを計測確認）
- 480pxで「支持線・抵抗線」行のreadout（…／…連結）と「ZigZag区間」行noteが2行目へ左端フル幅で折返し、ラベル列整列が崩れる（DOM計測: 全4銘柄で行4-5折返し）。タイトルas-ofが「時 点)」で中途折れ。例: narrowdigest-8306.T.png。原因: detail.css:895-896（.sig-row flex-wrap+min-width 9em）・detail.js:274-276。修正: .sig-row を grid（ラベル固定列+内容列）化しhanging indent、as-ofは nowrap/短縮。工数: 小。

### F.【e】比較チャートの右軸バッジ8連スタックと凡例の二重リスト
- 8系列全て lastValueVisible:true → 線が近づく局面で右軸にバッジ8連縦積みが目盛りを遮蔽（compare-3m/-36m.png、narrowcompare.png。収束密度はモック誇張だが badge積層の機構は実データでも発生）。上部chips（銘柄名）と下部legend（色dot+銘柄名のみ・数値なし）が同名の二重リストで、narrowでは計16行に縦膨張。原因: detail-charts.js:166（lastValueVisible）/:168（legend生成）/detail.js:79-84（chips）。修正: lastValueVisible:false化し legend に最終リターン%を併記（chipsは削除操作用に徹する）。工数: 小-中。参考: setComparePeriod が window.event 依存（detail.js:91）でプログラム呼出し不可＝脆い。

### G.【注記】タイトルの銘柄依存の不格好（「銘柄によっては」の直接該当）
- G1 括弧入り社名でティッカー二重: 「S&P 500 ETF (SPY) (SPY)」「Invesco QQQ (NASDAQ 100) (QQQ)」「Alphabet (Google) (GOOGL)」（DB照会で該当3銘柄を確定）。ヘッダ detail.js:663 とチャートタイトル detail-rules.js:446-448 の双方。例: chart-SPY.png/narrowchart-GOOGL.png。修正: company_name に「(ticker)」を含む場合は付加省略 or DB社名整理。工数: 極小。
- G2 選択FYに価格が無いと直近200本へフォールバックするが、年ボタン/年表示は選択年のまま（タイトルだけ「直近市場ローソク足時系列」）＝注記と実窓の不一致。原因: detail-rules.js:436-437+detail.js:638-643。修正: フォールバック時の明示注記。工数: 小。ETFの「経営期間トレンド」文言も不自然。
- G3 長タイトルがnarrowで「ローソク足時/系列」等の3行中途折れ。修正: narrowは期間注記を副題行に分離。工数: 小。

### H.【a/全般】本体チャートの fitContent 不在→左側大余白
- バー数×barSpacing6px<コンテナ幅の窓（US暦年の進行中年・データ欠け期間・fallback200本＝FHDで概ね240本未満）で左30-40%が空白グリッドのまま右寄せ描画。例: chart-7203.T.png（145本・左36%空白）/chart-1306.T.png/subpanel-NVDA.png。比較チャートは fitContent 済（detail-charts.js:171）で本体のみ欠落。原因: setCandleData detail-charts.js:1238-1240（setDataのみ）。修正: setData後に timeScale().fitContent()（サブパネルはsync済で追従）+少数バー時の maxBarSpacing クランプ。工数: 半日（ズーム操作との干渉確認込み）。

### 低確度メモ（実機確認要・断定しない）
- 規律カード等の「が」が濁点分離風に描画される件（zoom-7203-disc2.png）は headless/WSL のフォントフォールバック起因の可能性が高く、太田さんの実機（Windows）での再確認を推奨。

### 優先順位提案
B（意味の誤り込み）→ A（最頻視認）→ C1/C2（全銘柄常時の二重・生値）→ H → F → E/D/G。既知制約（ローソク確定色/ZigZag逆規約の意味・0x0罠の初期化順序）はいずれの修正案でも不変。
