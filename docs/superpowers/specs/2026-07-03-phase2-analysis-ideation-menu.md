---
date: 2026-07-03
type: ideation-menu
status: 方向性=「分析力の深化」確定 / 束の選択待ち（未 spec 化）
target: investment-portal Phase2（監査 2026-06-30 が定義した「整った土台に新機能を載せる」段）
method: ultracode workflow `ip-phase2-analysis-ideation`（run wf_5a7fff08-d0c）— 現状棚卸し3並列 → 5サブテーマ発散 → 統合ランク付け（30候補 → 14集約 → 4束）
project: investment-portal
related: [[investment-portal]] [[wealth-cockpit-v2]]
---

# investment-portal Phase2「分析力の深化」候補メニュー

ポータル監査（`docs/superpowers/audits/2026-06-30-portal-index-audit.md`）が定義したフェーズ2＝「ティッカー/新指標/新ビューを整った土台に載せる」。土台整備（フェーズ0/1/3＋F2 IIFE隔離）は全て本番LIVE済。**方向性は本人が「分析力の深化」を選択（2026-07-03）**。以下は実コードベースの棚卸しに基づく深化候補メニュー。**束の選択はまだ・spec 化は未着手**。

## 現状の主な穴（棚卸しで判明）
- **テクニカル**: EMA/一目均衡表なし。オシレーターがRSI/MACDのみ（ADX/DMI・ATR・ストキャス・CCI・SAR・MFI なし）。出来高系（VWAP/OBV/A-D/出来高プロファイル）なし。ボラティリティはBBのみ（ATR/Keltnerなし）。Fib/ピボットなし。指標パラメータ全固定（UIで変更不可）。クロス/ダイバージェンスのマーカー検出なし。汎用時間レンジ/ズームプリセットなし（決算期年度ウィンドウのみ）。週足/月足なし。対ベンチマークβ/相対力/相関の**数値統計**なし（比較は終値%正規化の視覚重ねのみ）。
- **財務**: スナップショット止まりで**時系列化が弱い**。バリュエーション倍率の時系列（PER/PBR/PSR/EV）なし。成長率/CAGRなし。ROE分解（DuPont）なし。FCF/現金変換率なし。配当分析（利回り/性向/連続増配）なし。同業パーセンタイル比較なし。
- **スクリーニング/横断**: 保存できるスクリーナーなし。複合条件（財務×テクニカル）なし。ランキング/セクターマップ/ヒートマップなし。相対位置（percentile）なし。

## 土台（載せ先）
- 純計算＝`detail-rules.js`／`finance-rules.js`（DOM非依存・node --test 付き）
- 描画＝`detail-charts.js`（IIFE・LWC/Chart.js instance を closure私有）
- オーケストレーション＝`detail.js`／ポータルUI＝`index.html`（F2 で IIFE 隔離済・新公開関数は末尾 `Object.assign(window,…)` へ）
- 教育機構の単一源＝money側 `GLOSSARY`/`termHelp`/`DISCLAIMER`（分析側へ横展開可）
- データ＝`/api/market/{list,ohlcv,financials}`（OHLCV全件＋financials_trend 各年）

## マスターメニュー（着手価値が高い順・上位12）

| 順 | 候補 | 要約 | 価値(芯) | データ | 載る場所 | 工数 | 主リスク | score |
|---|---|---|---|---|---|---|---|---|
| 1 | 分析グロッサリ横展開 | money側 GLOSSARY/termHelp を分析側全指標へ。全候補が参照する辞書の単一源 | 教育の土台 | existing | finance-rules.js(ANALYSIS_GLOSSARY)＋termHelp再利用 | S | 文言中立トーン推敲のみ | 9 |
| 2 | 財務健全性トレンド化 | 自己資本比率/流動比率/現金/総負債を全年度折れ線＋市場別基準帯 | 守りの規律・教育 | new-derivable | finance-rules.js再利用＋detail-rules/charts | S | ネットデット誤読回避・過密は推移束ね | 8 |
| 3 | 成長率エンジン(YoY＋3期CAGR)＋成長軸 | list既存3期から growth/cagr 純関数→列/ソート/スクリーニング軸に露出 | 単年比の近視克服 | new-derivable | finance-rules.js＋index.html(setSort/passesScreening) | S | CAGR符号反転/基準0の罠→テストで封じる | 8 |
| 4 | 財務指標 横並び比較テーブル | 比較セットをPER/ROE/各マージン/健全性で列並置。netMargin 初露出 | 多面評価・事実並置で助言安全 | existing | 既存純関数＋比較モーダルのタブ | M | 規模系は通貨混在→比率中心・欠損/実0区別 | 8 |
| 5 | セクター相対位置カード | 業種/市場内パーセンタイル＋中央値比を分布バー(percentileRank/sectorStats) | 文脈内の位置＝判断支援 | new-derivable | detail-rules.js＋detail.js/index.html | M | 小N縮退・null→0除外前処理必須 | 8 |
| 6 | テクニカル現在地サマリ(signalDigest) | 計算済MA/RSI/MACD/%B/S-R距離/ZigZag方向を1枚に状態記述 | 「まず全体→個別」の判断順序を型化 | existing | detail-rules.js:signalDigest＋detail.js | M | 総合売買スコア化しない・過密→折畳 | 7 |
| 7 | FCF＆収益の質トレンド | 営業CF＋投資CF＝概算FCF、FCFマージン/現金変換率をコンボで全年度 | 「黒字でも危うい」を語れる教材核 | new-derivable | finance-rules.js(fcf等)＋detail-charts.js | M | 「概算FCF」明示・純利益≤0で反転→ガード | 7 |
| 8 | DuPont分解＋財務ストーリー | ROE=純利益率×回転率×レバレッジに分解＋平易ナラティブ | 見かけ高ROEを切り分ける | new-derivable | finance-rules.js(dupont)＋detail-charts/detail.js | M | 債務超過で発散→ガード・radar/KPIと役割分離 | 7 |
| 9 | 保存できるスクリーナー | 4軸→ROE/ROA/流動比率/safety/規模へ拡張＋市場×セクター複数選択＋名前付きプリセット永続化 | 保存できる規準＝規律の道具 | existing | index.html screening拡張＋localStorage | M | パネル過密→折畳/チップ・規模軸通貨混在 | 7 |
| 10 | 横断ランキング＆セクターマップ | 指標選択で全銘柄をパーセンタイル/decile順位＋バリュー×クオリティ散布 | 相対バリュエーション教育・発信映え | new-derivable | finance-rules.js(percentile等)＋showView専用サブビュー | M | 通貨混在は比率限定・小N中央値不安定 | 7 |
| 11 | 規律テクニカル(ADX/DMI・ATR/Keltner) | トレンド強度(ADX)とリスク幅(ATR/Keltner)を新規サブパネル | 過度な値幅期待の抑制＝規律芯 | new-derivable | detail-rules.js(calcADX/ATR)＋サブパネル同型 | M | サブパネル逼迫→可視数UI前提・0x0罠・損切り推奨にしない | 6 |
| 12 | 出来高系(アンカーVWAP＋OBV) | 平均コスト目安VWAPオーバーレイ＋OBVサブパネル | 出来高の質・教育 | new-derivable | detail-rules.js(calcAnchoredVWAP/OBV)＋サブパネル | M | 「近似VWAP」明示・分割未調整で段差・過密 | 6 |

## 第2段・保留（上位が片付いてから／条件付き）
マージン＆CAGRトレンド(M,6)／文脈教育レイヤー[なぜこの値・レジーム判定](M,6・#1前提)／異常検知フラグスキャン(M,6)／分析チェックリスト(L,6・合否スコア化しない設計必須)／マルチタイムフレーム＋汎用レンジ[週月足/ズーム](L,6・**回帰リスク最大＝2期間パラダイム整合・独立トラック**)／比較モーダル拡張[レーダー重ね/相関β/ペア比価](M〜L,5・ペアトレード助言接近)／パターン検出マーカー・Fib＆ピボット(L/M,5・誤検出/過密)／仮想バスケット集計(L,5・ポートフォリオ追跡へスコープ膨張)／財務×テクニカル夜間スキャン(L,4・**助言境界最接近＋新precompute鮮度/コスト＝最高リスク**)／配当分析(L,3・**唯一の new-external＝schema拡張＋年次ETL新設→正直に最後・着手可否は単独判断**)。

## 横断リスク（共通の前提整備）
1. テクニカル系を複数出す前に「可視サブパネルの選択UI（アコーディオン/最大同時数）」を先に設計（RSI/MACD＋ADX/ATR/OBVで縦圧迫）。
2. 新規サブパネル/LWCは全て `display:none→rAF→resize` の0x0罠回避を踏襲。
3. クロスセクション系は `list.py` の null→0 潰しを「欠損＝母集団除外」する前処理を共通化（誤ランキング防止）。
4. 全候補で「割安=買い/型の名称=売買推奨」に読ませない教育フレーム＋DISCLAIMER 同梱（投資助言業の境界＝無償・本人利用・教育フレーム）。

## 4つの束（各束＝1〜2セッションで完結）
- **束A｜教育の土台を敷く**（低リスク即効・foundation-first）: ①分析グロッサリ横展開 → ②signalDigest → ③財務健全性トレンド化。以後の全候補が参照する土台。
- **束B｜相対で見る目**（高レバレッジ）: ①セクター相対位置カード → ②横並び比較テーブル → ③横断ランキング＆セクターマップ。一組の純関数(percentile/median/sectorStats)で3〜4面同時駆動・既存データ完結。
- **束C｜規律の道具化**（規律芯直結）: ①成長率エンジン(YoY＋CAGR軸) → ②保存できるスクリーナー →（③規律テクニカルADX/ATR）。
- **束D｜財務を物語に**（二本目の柱＝発信/教材化）: ①DuPont分解＋財務ストーリー → ②FCF＆収益の質トレンド →（③マージン＆CAGRトレンド）。

## 推奨（観点付き）
- **リスク最小・即効・後続を軽くする観点** → **束A** 最初（foundation-first で辞書・要約・トレンド化の共通土台が先に立つ）。
- **少ない実装で価値最大化＝レバレッジ観点** → **束B**（純関数1塊が詳細カード/比較タブ/ランキングの3面を同時に埋める・既存データ完結）。
- **規律に最短で刺す観点** → 束C／**発信・教材化を意識する観点** → 束D。
- **最有力の初手＝束A → 束B の順**。C/D は土台（グロッサリ＋クロスセクション純関数）が立った後に載せると教育フレーム/純関数を再利用でき工数が目減り。

## 次のステップ
1. 本人が着手する束を選択（AskUserQuestion 提示済・離席で保留中）。
2. 選んだ束を brainstorming で深掘り → `docs/superpowers/specs/YYYY-MM-DD-<束名>-design.md` に spec 化。
3. writing-plans で実装計画 → 実装（この段は機械寄り＝effort 引き下げ検討）。
