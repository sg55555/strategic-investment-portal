---
date: 2026-07-04
type: design-spec
status: APPROVED（本人「このまま進めて」2026-07-04）＋敵対検証24確定修正を反映済 → writing-plans へ
project: investment-portal
feature: Phase2 束A「教育の土台を敷く」（分析グロッサリ横展開 / テクニカル現在地サマリ signalDigest / 財務健全性トレンド化）
related: [[investment-portal]] [[wealth-cockpit-v2]]
supersedes_context: docs/superpowers/specs/2026-07-03-phase2-analysis-ideation-menu.md
grounded_by: ultracode wf ip-bundleA-understand（run wf_8904a097-603）
hardened_by: ultracode wf ip-bundleA-spec-critique（run wf_a6282951-823・4レンズ×実コード突合・30 findings→24確定修正を本版に反映）
---

# Phase2 束A「教育の土台を敷く」設計仕様（改訂版・敵対検証反映済）

## 0. 確定した前提
- **成功基準＝両方**：まず自分用に正確・簡潔。構造（単一源グロッサリ／decision-complete descriptor／純な系列生成）は将来の発信・教材に転用できる形にする。**教材エクスポートUIは本バンドルで作らない（YAGNI）＝構造耐性のみ**。
- **範囲＝3機能で1 spec・実装は段階**（#1 グロッサリ → #2 signalDigest → #3 財務健全性トレンド化）。
- 本版は初版に対し敵対検証（wf_a6282951-823）の High7/Medium10/Low8→確定24件を反映。主な硬化＝早期return前注入・カード冪等化・ETF非表示登録・売買語彙排除と中立閉集合化・現在地の time-index 整合・Chart.js lifecycle 訂正・免責の自己完結化・ポップオーバーのクリップ回避・entrance 遅延の枚数拡張。

## 1. 目的・成功基準・規制安全
- **目的**：散在する分析指標に「これは何／どう読む／よくある誤解」の一貫した教育レイヤーを与え、スナップショット止まりの読み取りを「現在地の要約」「時系列トレンド」へ格上げ。以後の Phase2 候補が参照する共通土台。
- **成功基準**：①各指標に `?` で中立な定義がタップ/キーボードで出る。テクニカル現在地が1枚で把握でき、財務健全性が推移で見える。②各コンテンツが単一源の純データ／純関数に集約され将来教材へ転用できる構造（エクスポートは作らない）。
- **規制安全（hard constraint）**：全機能に教育フレーム＋免責を同梱。**総合売買スコア・売買判断語・予測を出さない**。表示ラベルは**中立語彙の閉集合**に固定し `advice.py` の `_TRADE_RE`/`_FORECAST_RE` に命中しないことをテストで固定。detail-rules 出力を LLM facts（`modeAFacts`/`mode_a_facts`）に一切流さない。投資助言業の境界（無償・本人利用・教育フレーム）を越えない。

## 2. アーキテクチャ原則（既存の分離規律を踏襲）
- **純データ／純計算 = `detail-rules.js`**（`"use strict"`・DOM非依存・`window.DetailRules`・node --test 対象）。
- **DOM生成・esc依存HTML = `detail.js`**（IIFE・`window.Detail`・`window.esc`/`window.ICO` 使用）。
- **チャート描画/lifecycle = `detail-charts.js`**（IIFE・LWC/Chart.js を closure 私有・`window.DetailCharts`）。
- **読込順（依存）**：dataClient→finance-rules→detail-rules→(inline)→detail-charts→detail→money（不変）。
- **免責は detail 側で自己完結**（M2 反映）：免責文言は `DetailRules.ANALYSIS_DISCLAIMER` として **detail-rules.js に自前定義**（`money-rules.js` の `DISCLAIMER` に依存しない＝cross-module の silent failure を排除）。money-rules への新規読込順依存は作らない。
- 本バンドルは detail-rules/detail.js/detail-charts.js 内に閉じ、inline onclick を新設しない → **index.html の F2 公開面 `Object.assign` 追加は不要**。

---

## 3. 機能#1：分析グロッサリ横展開（工数 S）

### 3.1 データ（新設・単一源）
`detail-rules.js` に **`INDICATOR_GLOSSARY`** を新規 export（`{term, read, def}` 配列）。**money 側 `GLOSSARY` に相乗りさせない**（ドメイン disjoint）。
- 収録語（初版）：MA／BB／RSI／MACD／S・R／ZigZag T/R／出来高／%B／自己資本比率／流動比率／ROE／ROA／営業利益率／純利益率／PER／PBR。
- `def` は**中立・平易・「よくある誤解」を1文含むが売買語を含まない**（M4 反映）。例：RSI＝「買われ過ぎ/売られ過ぎの目安。**70超は買われ過ぎの目安であって、水準だけで方向は決まらない**」。「即売り」等の売買語は使わない。
- **DuPont は本バンドルで surface しない**（将来束D予約・L6）。
- `modeAFacts` の戻り値に含めない（facts 非出力）。

### 3.2 ビルダー（再実装・共有utilにしない）
`money.js termHelp` は private＋money 硬結合で昇格不可 → `detail.js` IIFE 内に **`Detail.termHelp(term)`** を再実装：
- 遅延キャッシュ `_indGloMap` を `DetailRules.INDICATOR_GLOSSARY` から構築。未ヒットは空文字（no-op）。
- 生成DOM は単一 span：`<span class="term-help" tabindex="0" role="note" data-def="{esc(read＋'：'＋def)}" aria-label="{esc(term＋'とは：'＋def)}">?</span>`。
- **XSS**：`window.esc` でエスケープ。**CSP フレンドリー**：`onclick` 不使用の純CSSポップオーバー（`:hover`＋`:focus`）。

### 3.3 注入パターン（静的markup対応・early-return 前に実行）（H1 反映）
指標ラベル/ボタンは静的HTML（index.html:1108-1135 の `.ma-btn`/`.ma-label`/`.card-title` 等）。→ **`data-term` 属性 ＋ 1パス注入**：
- 対象要素に `data-term="rsi"` 等を付与。
- `Detail.injectTermHelp(root)`：`root.querySelectorAll('[data-term]')` を走査し `Detail.termHelp(el.dataset.term)` を append（**重複注入ガード**＝既に `.term-help` 子があればskip＝冪等）。
- **呼び出し位置＝`updateFinancialViews` の `isEtf`(347)/`!fin`(352) early-return より前の無条件区間（displayPrices 確定後・286-295 付近）で1回**（ma-control-bar は ETF でも表示されるため early-return 後段に置くと ETF で `?` が欠落する＝H1）。
- 動的カード（signalDigest／健全性）の `?` は各カード描画直後に個別注入（早期return後段に置かない）。

### 3.4 CSS（中立クラス・自己完結トークン・クリップ回避）
- base ポップオーバー（`.term-help` / `.term-help::after content:attr(data-def)` / `:hover,:focus` 表示）を **`detail.css`** に定義。theme-D neon 強調は `[data-theme="D"] .term-help`（`#money-view` 非スコープ）。
- **参照トークンは `--ix-*` 系で自己完結**（money.css `--c-*` に暗黙依存しない・L5）。
- **クリップ回避（M9 反映）**：`.status-card` は `overflow:hidden`。自己資本比率/流動比率の `?` は **status-card の中に置かず、その上位の `.card-title`（panel見出し側・overflow 制限なし）に付ける**。signalDigest/健全性の新カードは自前CSSで `overflow:visible`（ポップオーバー用）にする。

### 3.5 テスト（M8 反映）
- node --test（`tests/detail-rules.test.js`）：`INDICATOR_GLOSSARY` が配列・全エントリ `{term,read,def}`・term 重複なし・必須語存在・**`def`/`read` が売買禁止語彙（`_TRADE_RE` 相当）に非命中**。
- snapshot（`scratchpad/detail-snapshot.js`）：`?`/新カードで domHash・canvasCount が必ず変わる＝**実装後に baseline を再 capture し、以後の回帰検出は新 baseline に対して行う**（許容ロジックが無いため・M8）。
- Playwright：`?` にホバー/フォーカスで定義が可視・見切れない（overflow 回避確認）。

---

## 4. 機能#2：テクニカル現在地サマリ signalDigest（工数 M）

### 4.1 純関数（新設・中立閉集合）
`detail-rules.js` に **`DetailRules.signalDigest(displayPrices, allPrices)`** を追加（`plSteps` と同型・DOM非依存）。
- 内部で `calcMA(allPrices,5/25/75)`／`calcBB(allPrices)`／`calcRSI(allPrices)`／`calcMACD(allPrices)`／`calcZigZag(displayPrices, autoZigZagDeviation(displayPrices))`／`detectSR(allPrices)`／`DetailRules.volumeColorData(displayPrices)`（インライン複製でなく純関数を使い単一源化）を呼ぶ。
- **現在地の time-index 整合（H7 反映）**：計算はフル履歴 `allPrices`、**現在地値は各系列を `displayPrices[last].time に一致する要素で index して取得**（一致なし＝`no-data`）。allPrices 系列の末尾（＝今日）を無条件採用しない（過去 selectedYear で「今日の値」が混入するのを防ぐ）。
- 各シグナルを**独立 descriptor** `{key, label, term, state, readout, note}` で並べる。**`value`/`score`/`weight` 等の numeric スコア用フィールドを持たない**（`readout` は整形済み文字列のみ）。**重み付け・合算・単一スコアを作らない**（H6）。
- **`state` は符号スカラに変換不能な中立状態語の閉集合**（H4/H5 反映・enum）：
  1. **MA整列**：`state ∈ {"MA5>MA25>MA75の並び","MA75>MA25>MA5の並び","並びは混在","データ不足"}`＋`readout`「終値はMA25の上／下」（純事実・「上昇/下降トレンド」と命名しない）。
  2. **RSI**：`state ∈ {"買われ過ぎの目安圏(70以上)","売られ過ぎの目安圏(30以下)","中立圏","データ不足"}`＋`readout`「RSI 72」。
  3. **MACD**：`state ∈ {"MACD線がシグナル線の上","MACD線がシグナル線の下","データ不足"}`＋`note`「直近でシグナル線と交差（有/無）」（**bullish/bearish・golden/dead・cross-up/down 等の売買語を使わない**＝位置関係と交差有無の純事実のみ・H4）。
  4. **BB %B**：`state ∈ {"上限バンドの外側","バンド内側","下限バンドの外側","データ不足"}`＋`readout`「%B 0.85」（`(close-lower)/(upper-lower)` を自前算出・派生量）。
  5. **S/R 距離**：`readout`「直近の抵抗まで +2.1%（強度3）／直近の支持まで −1.8%（強度2）」。**`detectSR` の全クラスタを現在 close で上/下に振り分け価格差最小を最寄り選択**（count 降順 top-3 slice の外も対象・count は強度表示に留める・M7）。
  6. **ZigZag 方向**：**確定済み直近2ピボット間**の change を `readout`「直近の確定区間 +X%（絶対値≥3%=トレンド／<3%=レンジ）」＋`note`「末尾ピボットは未確定」（`calcZigZag` は末尾に暫定ランニング極値を push するため・M5）。
  7. **出来高**：`state ∈ {"陽線(終値≥始値)","陰線"}`＋`readout` 出来高数値（「水準」の高低判定は本バンドルで作らない＝陽/陰のみ・L4）。
- **空ガード**：`calcRSI`<period+1 で[]／MA75 は75本未満で空／`calcZigZag`<2 で[]／`detectSR` は直近252本を lookback 上限とし**ピボット不足で空**（本数 early-return ではない・L2）。欠損シグナルは `state:'データ不足'` で畳む（クラッシュ禁止）。
- **表示ラベル写像も中立語彙の閉集合**（自由文字列を出さない・H5）。純関数側に「横断合成しない・結論を出さない」設計コメント。**同モジュール `radarScores`（意図的な0-100スコア）とは役割が別**である旨をコメントで明記（H6・混同防止）。

### 4.2 描画（detail.js）
- `updateMaAndVolume(...)` 直後・`repaint()` 付近で `DetailRules.signalDigest(displayPrices, data.prices)` を呼び固定 id カードへ書込（`window.esc` 使用）。**isEtf/!fin early-return より前**（価格のみで成立・ETF でも有効）。
- **冪等（H2 反映）**：カードは**固定 id で初回のみ生成、以後は同一ノードの innerHTML/データ置換のみ（insert しない）**（switchYear/navigate で複数回呼ばれても増殖しない）。
- 各 descriptor の `label` に `data-term` を付け `Detail.injectTermHelp` で `?` 注入（#1 接続）。
- **免責同梱**：`DetailRules.ANALYSIS_DISCLAIMER` をカード内に常時表示（欠落時は**カードを描画しない**フェイルセーフ・M2）。

### 4.3 DOM・entrance
- `.dashboard-stack`（1108）先頭＝MARKET CHART カード直前に固定 id の新 `.card`。`finCards`（340）に含めない＝ETF でも表示。inline onclick/toggle 無し＝window 公開不要。
- **entrance（M10 反映）**：先頭挿入で全カード nth-child が繰り上がる＋総数7化。**`detail.css` の `cardFadeInUp` 遅延規則を nth-child(1)〜(7) まで拡張**し全カードに遅延を定義（6/7 が delay:0 即時発火にならないように）。

### 4.4 「今日」でなく「表示期間の最新足」
`priceWindow` が selectedYear・US/JP で窓を変えるため、現在地は**表示中期間の末尾足**。カードに「（表示期間の最新：YYYY-MM-DD 時点）」を明示。§4.1 の time-index 整合と一致（H7）。

### 4.5 テスト
- node --test：合成価格列で各 descriptor（MA整列/RSIゾーン/MACD位置・交差有無/%B/S-R最寄り/ZigZag確定区間/出来高陽陰）を固定。**no-score 構造固定**＝「descriptor に `value`/`score`/`weight` 等 numeric スコアフィールドが無い」「`state` が数値符号に写像可能でない閉集合に属する」を検証（H6）。**表示ラベルが `_TRADE_RE`/`_FORECAST_RE` に非命中**（H5）。**過去 selectedYear で現在地値が displayPrices 末尾日付に一致し今日の値でない**不変条件（H7）。薄い履歴・ETF空で `データ不足` に畳む。signalDigest テストは `FinanceRules` を global 注入する既存パターンを踏襲（FR=null で TypeError にしない・L7）。
- snapshot／Playwright：カード描画・`?` 可視・pageerror0・ETF 詳細でも表示・免責の存在を gate（M2）。

---

## 5. 機能#3：財務健全性トレンド化（工数 S）

### 5.1 計算（全年ループ・比率別欠測ゲート）
既存 `FinanceRules.equityRatio/currentRatio/roe/roa/opMargin`（fin→number）を `Object.keys(data.financials_trend).sort().map(...)` で全年ループ→系列化。
- 金額系列：現金＝`cf_cash_end`。総負債＝`current_liabilities+non_current_liabilities`（小ヘルパ `FinanceRules.totalLiabilities(fin)` を追加）。
- **比率別の欠測ゲート（M6 反映）**：`hasValue` は単一キー判定で、`equityRatio` は net_assets＋current/non_current の合成、`currentRatio` は current_assets＋current_liabilities 依存。`totalAssets` は `n()` で欠損を0補完するため**片側欠損年が"部分合計"で誤比率**を出す。→ **各比率の全入力キーが `hasValue` の年のみ算出、1つでも欠ければ `null`（欠測点）**。実0% と区別。ETF は `financials_trend={}` で系列ゼロ。

### 5.2 基準しきい値の単一ソース化
基準（自己資本 JP40%/US30%・流動比率 JP100-150%/US150%）は現状 `equityRatioDesc/currentRatioDesc` の**文言に文字列埋込**。→ **`MARKET_BASIS`（detail-rules.js）に数値を追加**（`equityMin`, `currentLow`, `currentHigh`）し **`DetailRules.marketBasisFor(isUS)` 経由で取得**（`MARKET_BASIS` は現状未 export＝marketBasisFor が唯一の到達路・L1）。desc 文言も帯もこの単一源を参照（数値化に伴い desc の該当テストを同時更新・L7）。

### 5.3 描画（新規折れ線描画器・Chart.js）
`detail-charts.js` に **`DetailCharts.renderHealthTrend(data, isUS)`** を新設（**Chart.js line**・既存 `FIN_COLORS`/`neonGlowPlugin`/`NEON_TEXT_GLOW` に統一）。折れ線描画器は現状ゼロ。
- **二軸で%と金額を分離**：
  - 左軸（%）：自己資本比率・流動比率の折れ線＋**基準線/帯**（`chartjs-plugin-annotation` 未導入＝**定数値の line dataset**で基準線／流動比率は **JP=100-150% 帯を2定数line間 `fill`／US=150% 単線** と market 別に描き分け・L6・新CDN依存を足さない）。
  - 右軸（金額・通貨別）：現金・総負債を `FinanceRules.pickUnit/fmtUnitValue` に `data.currency` を通した単位で。
- **基準帯は「一般的な目安の水準線」として中立化**（L8 反映）：「健全企業水準/安全圏＝良い銘柄」と結びつく文言にしない＋「水準は投資判断・推奨ではない」注記＋`ANALYSIS_DISCLAIMER` 同梱。
- **ネットデット誤読回避**：総負債はグロス。現金と同一チャートでも「ネットデット」と表記しない。
- **負の自己資本**：`net_assets<0` の年は負値プロット＋注記（推移の事実を隠さない）。
- **選択年ハイライト**（任意・既存 renderKpiCompare と一貫）。

### 5.4 Chart.js lifecycle（層の訂正・destroy 先行・0x0 ガード）（M1 反映）
- **`onWindowResize` に登録しない**（それは LightweightCharts 専用。Chart.js は `responsive:true` で自動追従＝bs/pl/cf/radar と同じ・M1）。
- **`healthTrendInstance` を closure 私有し、描画冒頭で既存あれば `destroy()`→`new`**（「Canvas is already in use」例外回避・display:none で生成しない）。
- **`repaint()` の再描画配列（detail-charts.js:571）に追加**（FHD 初回黒面回避）。ただし **`clientWidth>0`／カード可視ガードを付す**（既存配列は無条件 resize で、ETF 非表示時 0x0 空チャート化の恐れ・M1）。

### 5.5 呼び出し位置（detail.js）・ETF 非表示
- `renderCFChart(fin, pageUnit)`（372）**直後**に `renderHealthTrend(data, isUS)`。`!fin` return（352）後段＋ETF は `financials_trend={}` で早期スキップ。引数は **`data`（全年）＋`isUS`**。
- **ETF カード非表示（H3 反映）**：health カードに title id を与え、その id を **`finCards`（or ETF非表示リスト）に追加**して ETF 時 `display:none`（renderHealthTrend の描画スキップだけでは「健全性推移」カードが空/株式の残線で残るため）。

### 5.6 DOM・接続
- 固定 id の新 `.card`＋canvas を BSカード（index.html 1156-1187）の直後（冪等挿入＝§4.2 と同じく初回のみ生成・以後データ置換・H2）。
- タイトル「財務健全性の推移」＋自己資本比率/流動比率ラベルの `?` は **`.card-title`（panel見出し側）に付ける**（status-card クリップ回避・M9）＋`data-term`（#1接続）＋`ANALYSIS_DISCLAIMER`＋非推奨注記（L8）。

### 5.7 テスト
- node --test：全年ループ系列（**片側成分欠損年が0%でなく null**・M6）・`MARKET_BASIS` の equityMin/currentLow/currentHigh 存在・`totalLiabilities` 加算・負 net_assets の負値プロット・`marketBasisFor` 経由取得。
- snapshot／Playwright：新チャート描画・**repaint 到達（fcrCalls）**・**ETF で健全性カード非表示**・リサイズ追従・pageerror0。**FHD 初回黒面は headless 非再現＝本人実機サニティ必須**。

---

## 6. 横断事項
- **教育フレーム＋免責**を3機能に同梱（`DetailRules.ANALYSIS_DISCLAIMER`・欠落時フェイルセーフ）。
- **教材耐性（構造のみ）**：単一源 pure-data／decision-complete descriptor／純な系列生成。エクスポートUIは作らない。
- **facts 非出力（M3 反映）**：detail-rules 出力（`INDICATOR_GLOSSARY`/`signalDigest`/health-trend 系列）を `advice.py` facts へ渡さない**明示制約**。`mode_a_facts`/`_build_user` payload に technical 由来キーが現れない **negative テスト**を追加。将来「チャート説明」を LLM に渡す機能は**別 spec に法務前提付きで隔離**。
- **色/canvas 制約**：チャート改変の固定ルールは2026-07-01 解除済。唯一の技術制約＝`display:none→createChart 0x0罠`。ローソク確定色/ZigZag逆規約の**意味付け**は保持。
- **module 境界維持**：純データ/計算=detail-rules、DOM/esc=detail.js、描画=detail-charts。読込順不変・money 側（money.js/money-rules.js/money.css）は触らない。

## 7. テスト戦略（全体）
1. **node --test**（pure）：INDICATOR_GLOSSARY／signalDigest（no-score 構造固定・ラベル禁止語彙非命中・time-index 整合）／health-trend 系列（比率別欠測 null）／MARKET_BASIS 数値／facts negative test。
2. **snapshot**：3機能追加後、**baseline を再 capture**（許容ロジック無・M8）。以後は新 baseline に対し回帰検出。
3. **Playwright 実ブラウザ**：`?` 可視・見切れなし・digest/健全性カード描画・ETF 経路（健全性カード非表示）・リサイズ・免責存在・pageerror0。
4. **本人実機サニティ**（headless 非再現）：FHD 初回黒面（renderHealthTrend が repaint 到達か）。

## 8. リスクと対策（敵対検証反映後の残リスク）
| リスク | 対策 |
|---|---|
| 詳細ビューの過密（カード7枚化） | 要約1枚ずつ・entrance 遅延を7まで拡張・必要なら折畳 |
| 欠損年が実0%の急落に化ける | 比率別欠測ゲートで null 化・ETF は系列ゼロでガード |
| FHD 初回黒面（新Chart.js） | repaint 配列に追加＋clientWidth ガード・本人実機で確認 |
| no-score 逸脱 | state 中立閉集合・numeric スコアフィールド不在をテスト固定 |
| 教育文言が助言に読める | 中立語彙閉集合・ラベル禁止語彙非命中テスト・免責＋非推奨注記 |
| ポップオーバー見切れ | status-card 外（card-title 側）配置／新カードは overflow:visible |
| カード増殖/演出破綻 | 固定 id 冪等挿入・nth-child 遅延拡張 |
| money モジュール破壊 | money 側非改変・免責は detail 自己完結・CSS 中立クラス |

## 9. 実装順序（段階・1 spec 内）
1. **#1 グロッサリ（S）**：`INDICATOR_GLOSSARY`＋`ANALYSIS_DISCLAIMER`＋`Detail.termHelp`＋`injectTermHelp`（early-return 前）＋`.term-help` CSS（自己完結トークン・クリップ回避）。→ #2/#3 のラベルが `?` を持てる土台。
2. **#2 signalDigest（M）**：純関数（中立閉集合・time-index 整合・no-score 構造）＋固定 id 冪等カード＋#1 接続＋免責＋禁止語彙テスト。
3. **#3 健全性トレンド（S）**：`MARKET_BASIS` 数値化＋`totalLiabilities`＋`renderHealthTrend`（二軸 line・destroy 先行・repaint 登録・ETF finCards）＋比率別欠測ゲート＋#1 接続＋中立化＋免責。
各段：node --test → snapshot（baseline 更新）→ Playwright → 敵対検証（ultracode wf）→ 本人実機サニティ → 本番デプロイ判断（push＝Vercel 発火・本番 curl 確認）。

## 10. スコープ外（YAGNI）
教材エクスポートUI／グロッサリ自分語り生成／新テクニカル指標（ADX/ATR/VWAP＝束C・別候補）／指標パラメータUI／マルチタイムフレーム／束B/C/D／DuPont surface／money `.mcc-help`→`.term-help` 統合／出来高「水準」判定／chart-explain の LLM 連携。
