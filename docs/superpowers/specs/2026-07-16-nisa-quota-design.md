---
date: 2026-07-16
project: investment-portal
backlog: "B #3 NISA枠（非課税枠トラッキング＋口座振り分け助言）"
規制フレーム: 2層必須（[[strategy-personal-finance-advice-intent]]）＝層1公開・決定論・教育／層2本人専用・server・ADVICE_MODE=personal gated
前提: decision-complete（ユーザー確定済み・§11決定ログ参照）
related: 2026-07-12-investment-allocation-roadmap-design.md, 2026-07-14-asset-class-ratio-design.md
改訂履歴:
  - 2026-07-16 初版（ブレスト確定→spec化。UIはビジュアルコンパニオンでレイアウトD確定）
---

# NISA枠（非課税投資枠）— B#3 設計書

## §0 目的と戦略文脈

お金の司令室（`#money-view`）に、**新NISA(2024)の非課税枠の消化状況**を可視化し、積立と結びつけ、将来は口座振り分けを助言する新セクションを足す。芯は **B#1/B#2 と同じく「規律・教育」**（勝ち銘柄当てではない）。

NISA枠は **バケツ（時間軸＝いつ使うか：buffer/core/satellite）・資産クラス（中身＝何を買うか：cash/jpEq/…/gold）と直交する第3の軸**＝「**どの口座で持つか**（課税口座／NISAつみたて／NISA成長）」。同じ「先進国株をコアに」を「NISA成長枠か課税口座か」で持てる独立軸。

%配分（B#2）にない **「枠＝quota/capacity(¥)」概念** を新規モデル化するのが最大の設計論点。制度事実（枠額・生涯枠・簿価復活）は**公開の税制ゆえ層1（教育）に自然に載る**。個別銘柄の口座配置（tax-location）だけが層2（本人助言）。

**規制安全（[[strategy-personal-finance-advice-intent]]）**：層1＝公開client・`money-rules.js`純関数・決定論・教育・no-score・免責fail-closed（ログイン本人¥表示可／未ログイン%のみ／送信ゼロ）。層2＝本人専用server・`ADVICE_MODE=personal` gated・具体助言・出力スキャナ。**層1が層2の入力facts**。金商法の安全圏＝無償＋本人利用＋非公開＋教育フレームの4本柱。

## §1 確定事項（製品判断・変更不可）

| # | 論点 | 確定 |
|---|---|---|
| 1 | スコープ | 能力4つ全て（枠可視化／積立接続／口座振り分け助言／生涯枠再利用追跡）。ただし**段階実装**（§8）。 |
| 2 | 今セッションの本番化範囲 | **層1フルを本番LIVE、層2（口座振り分け助言）は本specに設計しendpointは作らずdormant**（束D/B#1/B#2と同じ）。 |
| 3 | データモデル（最終形） | **3方式を段階で共存**：Stage1=累計スカラー手入力／Stage2=年別履歴／Stage3=投資台帳ledger連携。`nisa.source` 切替軸をStage1から埋め、後段は純関数の入力源差替のみでUI/facts契約不変。 |
| 4 | Stage1のデータ源 | **累計スカラー手入力**（当年つみたて/成長拠出・生涯つみたて/成長簿価残・当年売却簿価・アンカー年の6+1値）。 |
| 5 | facts連携 | **Stage1で `facts.nisa` を既存AI規律コーチ（`advice.py` mode_a_facts）に載せる**（assetClassesと同型）。`FACTS_SCHEMA_VERSION 4→5`＋共有fixture＋coarsen一式を含む。 |
| 6 | production facts の生¥非漏洩 | 生¥（枠額・使用額・残額）は**production factsに一切出さない**。法定枠は module 定数、使用は%/bool/enumで表現、生¥は `personal` の `facts.raw.nisa` のみ。 |
| 7 | ¥表示ゲート | roadmap/assetClassと同一：**¥はloggedInのみ／%・バー・構造・入力欄は常時**（readout gateでありinput gateでない）。 |
| 8 | 復活モデル | Stage1は**スカラーで表現**（生涯簿価残＝保有簿価としてユーザー維持・売却で減／`soldThisYearAtCost`が「来年¥X万復活予定」factsを駆動）。年別厳密版はStage2。 |
| 9 | UIレイアウト | **レイアウトD**（上部HUD＋生涯枠ヒーロー・ドーナツ＋生涯総枠/成長内数の2段フルワイドバー＋当年2ゲージ＋アクションチップ）。ビジュアルコンパニオンで実物比較し確定。円グラフ横並び案Eは冗長・面禁則逆行で不採用。 |
| 10 | セクション配置 | `assetClassSection` の直後（バケツ→資産クラス→口座 の粒度進行）。 |
| 11 | 法定枠の保守先 | Stage1は **module 定数**（`NISA_ANNUAL_TSUMITATE` 等・facts非出力）。年度で変わり得るためコメントで「年度改定時はここ」を明示。env/DB化は将来（YAGNI）。 |

## §2 データモデル

### 2.1 state.nisa（新規・前方互換既定）
`defaultState()`（money-rules.js）＋`migrate()`（money-rules.js）＋`_migrate()`（advice.py）の**三所に同型追加**（片方漏れ＝ロード時無言消失＝reserves/goals同型の既知落とし穴）。

```
nisa: {
  source: 'manual',          // enum 'manual'|'history'|'ledger'（Stage1=manualのみ・enum coerce・不正→'manual'）
  anchorYear: 0,             // int 暦年（0=未設定）
  tsumitateThisYear: 0,      // ¥ 当年つみたて拠出
  growthThisYear: 0,         // ¥ 当年成長拠出
  tsumitateLifetime: 0,      // ¥ 生涯つみたて簿価残高
  growthLifetime: 0,         // ¥ 生涯成長簿価残高
  soldThisYearAtCost: 0,     // ¥ 当年売却簿価（→翌年1/1 生涯枠へ復活）
  // Stage2: history: []     // 年別履歴配列（将来・normalizeReserve型 filter→slice(0,50)→map）
}
```

- `normalizeNisa(raw)`＝`normalizeAssetHoldings`/`normalizeAnchor` 型：**固定形状・allowlist・完全骨格を常に返す・未知キー破棄・scalar-only coerce**。¥フィールドは共有 `num()`（非負・単一要素配列/NaN/hex/underscore/全角数字を両言語同一にreject）、`anchorYear` も `num()`（int化）、`source` は enum coerce（許可集合外→`'manual'`）。
- **CURRENT_VERSION は据置**（birthYear/assetHoldings と同じ前方互換既定追加。migrate加算coercionで処理＝全fixtureのrulesVersion churn回避）。
- クラウドは Neon `me.mcc_state`（id=1 シングルトンJSONB）に丸ごと乗る＝**DDL不要**。`advice_log.facts` は coarsen 後保存ゆえ生¥非永続。

### 2.2 版方針
- `FACTS_SCHEMA_VERSION`（money-rules.js）＝4→**5**、`SCHEMA_VERSION`（advice.py）＝4→**5**、`money-rules.test.js` の schema assertion＝4→**5** の**三点 lockstep bump**。
- 共有fixture `advice_facts_cases.json` の全ケース×production/personal に埋まった `schemaVersion:4` を **5 へ一括機械置換**（jq/スクリプト・手打ち禁止＝漏れると全パリティtest RED）。
- `RULES_VERSION`/`CURRENT_VERSION`（state migrate版）は**据置**。

## §3 層1ロジック（money-rules.js 純関数・決定論・教育・no-score・免責fail-closed）

**業務mathは全て money-rules.js の純関数へ**（money.js/money.css には書かない）。money.js に置けるのは「facts非出力の表示専用集計/色計算」のみ（既存規律・必ずコメント明記）。

### 3.1 定数（module const・facts非出力・公開既知値ゆえtemplate/LLMが知る）
```
NISA_ANNUAL_TSUMITATE     = 1_200_000
NISA_ANNUAL_GROWTH        = 2_400_000
NISA_ANNUAL_TOTAL         = 3_600_000
NISA_LIFETIME             = 18_000_000
NISA_GROWTH_LIFETIME_CAP  = 12_000_000
```
`advice.py` 側も同値 const（byte-parity 鏡像）。

### 3.2 `nisaViewModel(state, cd, nowMs)` → money.js 描画用VM（¥＋%を含む）
- `currentYear`＝nowMsからUTC導出＋`cy∈[1,9999]` ガード（glidePath/reserveMonthly と同じ対称化）。
- `n = normalizeNisa(state.nisa)`。
- **annual**（当年枠・暦年リセット）:
  - `tsumitate`: {cap:1.2M, used:n.tsumitateThisYear, remaining:max(0,cap−used), usedPct:clamp(r(used/cap*100),0,100), over:used>cap}（VM/facts の usedPct は**同一定義＝clamp済**・over 判定は別bool）
  - `growth`: cap 2.4M で同型
  - `total`: cap 3.6M, used=tsumitateThisYear+growthThisYear, remaining, usedPct, over
- **lifetime**（生涯枠・簿価・無期限）: {cap:18M, used:tsumitateLifetime+growthLifetime, remaining, usedPct, over}。合成 `tsumitatePortion=tsumitateLifetime`, `growthPortion=growthLifetime`（バーのセグメント幅＝portion/cap*100）。
- **growthCap**（成長内数上限）: {cap:12M, used:growthLifetime, remaining, usedPct, over}
- **restoration**: {sold:n.soldThisYearAtCost, restoresYear:currentYear+1, hasPending:sold>0}
- **staleYear**: `anchorYear>0 && anchorYear<currentYear`（当年枠は暦年リセットの促し）
- **monthlyPace**: `cd && cd.investableSurplus>0 ? cd.investableSurplus : null`（¥・cashflow由来の月次投資余力）
- **fillEta**: `etaBucket(projectMonths(lifetime.remaining, monthlyPace))`（monthlyPace null→'none' degrade）。
- **積立接続（能力2）**: `monthsLeftInYear = 12 − utcMonthIndex(nowMs)`（Jan=0→12, Dec=11→1）。`monthlyToFillTsumitate = monthsLeftInYear>0 ? ceilYen(annual.tsumitate.remaining / monthsLeftInYear) : null`（つみたて枠を年末までに満額にする月額）。`monthlyToFillAnnualTotal` も同型。
- バー幅＝`usedPct`（clamp済）、`over` は別チップ/色で警告（>100% は幅100固定で over 表示）。

### 3.3 `nisaFacts(state, nowMs, monthlyPaceYen)` → mode_a_facts 用（configured時のみ）
- **configured判定**: `anchorYear>0 || (いずれかの¥フィールド>0)`。**非configured→undefined/None を返し `if (nf) facts.nisa = nf`** でキー自体を省く（assetClasses と同契約＝未設定 state の既存 fixture を壊さない）。
- **production keys（全て 整数[-100,150] / bool / enum・生¥ゼロ）**:
  - `source`（enum 'manual'|'history'|'ledger'）
  - `annualTsumitateUsedPct` / `annualGrowthUsedPct` / `annualTotalUsedPct` / `lifetimeUsedPct` / `growthCapUsedPct`（各 `clamp(r(used/cap*100),0,100)`）
  - `annualRoomRemaining`（bool・`annual.total.remaining>0`）/ `lifetimeRoomRemaining`（bool・`lifetime.remaining>0`）/ `growthCapRoomRemaining`（bool・`growthCap.remaining>0`）
  - `overContribution`（bool・いずれかの当年拠出がcap超過）
  - `hasRestorationPending`（bool・soldThisYearAtCost>0）
  - `lifetimeFillEtaBucket`（enum 'none'|'lt6'|'6_12'|'1_3y'|'3_10y'|'over_10y'）
  - `staleAnchorYear`（bool・anchorYear<currentYear）
  - `rulesVersion`/`schemaVersion` は modeAFacts トップから継承（nisa サブ木内には持たない）
- **personal のみ `facts.raw.nisa`**: `tsumitateThisYear`/`growthThisYear`/`tsumitateLifetime`/`growthLifetime`/`soldThisYearAtCost`/`annualTsumitateRemaining`/`annualGrowthRemaining`/`lifetimeRemaining`/`growthCapRemaining`/`monthlyToFillTsumitate`/`restoresYear` の生¥・生年。
- `monthlyPaceYen` は**入力**（出力はenum bucketのみ）ゆえproduction安全。client=`cd.investableSurplus`、server=cashflow rows由来の月次余力を mode_a_facts が算出して渡す。null時 eta='none'。

### 3.4 復活・年アンカーモデル（決定論）
- 生涯簿価残（tsumitate/growthLifetime）＝**現在NISA口座に保有する簿価**としてユーザーが維持（売却時に減らす）。`lifetimeRemaining = 18M − used` が売却で増える。
- `soldThisYearAtCost` は「**今年売却した簿価分の枠が翌年1/1に再拠出可能へ復活**」の facts（`restoresYear=currentYear+1`）を駆動＝能力4のStage1表現。
- 当年拠出（tsumitate/growthThisYear）は暦年でリセット。`staleAnchorYear` が真なら UI が「新年度の当年枠にリセットするか」を促す（自動ゼロ化はしない＝ユーザー確認）。

### 3.5 免責・no-score・中立語
免責 `DISCLAIMER`（client単一源定数）は全経路で決定論と不可分に常時表示・fail-closed。NISAは税制口座の**中立教育フレーム**（「非課税枠が残っています」等の位置/中立語のみ・買え/売れの推奨語を層1に出さない＝`cross-section-rules._band` と同じ閉集合規律）。

## §4 層2（本人助言）— Stage1は mode_a_facts 配線のみ実装／NISA専用助言endpointは dormant 設計

### 4.1 Stage1で実装する層2接点（＝facts配線）
`advice.py` の `mode_a_facts` に `_nisa_facts` 鏡像を配線（assetClasses ブロック直後）。これで**既存のAI規律コーチ（`/api/me/advice`）が NISA 使用状況を facts として加味**できる。production=集約%/bool/enum（生¥ゼロ）、personal=`facts.raw.nisa`。coarsen/スキャナ/免責/degrade は既存契約のまま。**新endpointは作らない**。

### 4.2 dormant設計：NISA専用「口座振り分け助言」endpoint（将来・別セッション）
- **型**＝`insight.py` 骨格（**personal-only ハードゲート・production=403 完全遮断**・degradeでなくブロック）。理由：口座配置助言は個別銘柄×口座最適化で production に意味ある中立degraded版が無く、`advice.py` の4カテゴリ決定論契約/パリティfixtureを膨らませない。
- **入力**＝`mode_a_facts(personal)` の `facts.nisa`＋`facts.assetClasses`（drift）＋`investment_snapshots.holdings`（実保有）＋`_market_universe`（成長枠候補接地）。決定論アンカー（サーバ計算のNISA枠残・適格区分）を「金額はサーバ与件のみ」でプロンプト同梱＝LLMに枠額を発明させない。
- **出力（案）**＝{つみたて枠の推奨インデックス構成／成長枠の個別銘柄候補／課税口座への振り分け}の3ブロック（insight型 {headline,story,assessment,watch} をNISA向けに再定義）。
- **ログ**＝`advice_log` 型（coarsen＋personal は ai_response NULL）で `me.nisa_log` 新設（`insight_log` 平文型は不可＝個人保有を含む）。
- **⚠️実装前の hard precondition**：
  1. **Vercel関数12上限**（現状 me:advice/insight/cashflow/state/investment=5 ＋ auth:login/logout/session=3 ＋ market:list/ohlcv/financials=3 ＝**11**）→ `api/me/nisa.py` 新設で**丁度12**。着手前に実カウント再確認（超過でデプロイ失敗）。上限なら既存への統合 or 退役を検討。
  2. **法務レビュー（金商法・投資助言業）**＝口座配置助言は最も踏み込む。本人専用デプロイ・production 403固定・機能フラグ無効を維持し、他者提供/課金化の前に法務レビュー必須。

## §5 UI（#money-view nisaSection・theme D・レイアウトD）

- `nisaSection(vm)` を money.js に新設し、`render()` のセクション連結（`root.innerHTML=`）で **`assetClassSection` の直後**に挿入（index.html 無改造）。ラッパ `<div class="mcc-nisa" id="mcc-sec-nisa">`。`id` を `_JUMP_TARGETS` に登録。
- 見出し＝HUDスタイル（英語コード名 `NISA_QUOTA`＋日本語 `非課税枠`＋`termHelp('NISA枠')`）＋`mcc-section-desc` 一行説明。`R.GLOSSARY` に `NISA枠`/`つみたて投資枠`/`成長投資枠`/`生涯投資枠`/`簿価` を追加（JS単一源・Python鏡像不要）。
- **レイアウトD構成**（上から）:
  1. **上部HUD**（`年間枠残`/`生涯枠残`/`成長内数残`/`充填ペース`/`来年復活`）
  2. **生涯枠ヒーロー card**：左＝ドーナツ（`lifetimeUsedPct`・conic-gradient・violet glow）／右＝2段フルワイドバー＝(a)生涯総枠バー（つみたて分cyan＋成長分emeraldの色分けセグメント・凡例）(b)成長内数枠バー（¥1,200万上限）
  3. **当年枠 grid2**：つみたてゲージ／成長ゲージ
  4. **アクションチップ**：`つみたて満額まで 月¥X`（積立接続）／`売却¥X→翌年復活`／`暦年リセット`警告（staleYear時）／`over`警告（over時）
  5. **入力アコーディオン**（`<details>`・6+1フィールド・`MCC.setField('nisa.<field>',…)` 経由 setField→save→render）
- **¥ゲート**＝`sync.loggedIn` 時のみ ¥readout（未ログインは%・バー・構造・入力欄は常時）。
- money.js に業務mathを書かない＝全数値は `R.nisaViewModel()` 由来。表示専用の色ストップ/幅clampのみ money.js 可（コメント明記）。

## §6 デザイン確定値（theme D・レイアウトD）

- 全 `.mcc-nisa-*` は **money.css baseline（構造/寸法）＋ `[data-theme="D"] #money-view .mcc-nisa-*`（色/glow/等幅/blur）の二層**。`applyTheme()` が常に `data-theme=D` を付与ゆえ色は必ずD層に。
- **面禁則**＝線/グロー/縁（半透明地 `rgba(6,12,20,0.72)`＋ネオン細枠1px＋inset/外側 box-shadow glow＋backdrop-filter blur(3px)＋角丸2-3px＋`--mcc-mono` 等幅＋tabular-nums）。ドーナツは既存assetClass同様の低alpha conic-gradientの例外。
- **意味色トークン流用**（`:root[data-theme="D"]`）：`--c-cyan #00e5ff`（基準/データ/つみたて）・`--c-emerald #00e676`（成長/ポジ）・`--c-violet #f570ff`（生涯枠ヒーロー強調）・`--c-amber #ffb300`（残枠/積立アクション）・`--c-danger #ff1744`（over超過）・`--c-indigo #4d5dff`（規律）。
- 具体レンダは確定mock（`.superpowers/brainstorm/…/nisa-layout-v2.html` OPTION D）を参照。GPU依存（glow/blur/ドーナツ）は headless非authoritative＝**実装後に太田さん実機サニティ**で最終確認。

## §7 パリティ計画（money-rules.js ↔ advice.py・共有fixture単一源）

1. **鏡像ペア**（docstringに「money-rules.js xxx の鏡像」明記）：`nisaFacts`↔`_nisa_facts`、`normalizeNisa`↔`_normalize_nisa`、NISA定数、mode_a_facts配線（assetClasses直後）、coarsen_facts の nisa 走査。
2. **共有fixture** `tests/fixtures/advice_facts_cases.json` に nisa ケース追加（§9.2）＋全ケースの `schemaVersion 4→5` 一括置換。
3. **allowlist/denylist**：`PROD_TOP_KEYS`（JS）/`ALLOW`（Py）に nisa 系トップキーを追加、生¥系キー名（*Remaining の¥等）は raw に隔離しdenylist扱い。`facts.nisa` の全number leaf を **整数[-100,150]** に収める（生¥・年数を production に出さない）。
4. **coarsen_facts**（非再帰）に facts.nisa 明示走査ブロック追加：`*UsedPct` を `_bucket25`、bool/enum は透過。**追加し忘れると監査ログに生指紋残**（assetClasses/cashflow と同型の穴）。
5. **coercion**：新num入力（¥/year）は必ず共有 `num()`/`_num()`（ASCII限定 `_DECIMAL_RE`）を通す。`Number()`/`float()` 直呼び・配列unbox禁止（fuzz発散源）。
6. **lockstep bump**：`FACTS_SCHEMA_VERSION`/`SCHEMA_VERSION`/テスト assertion の三点を 4→5 同時。

## §8 段階構成（Stage 1→4）

| Stage | 内容 | データモデル | 層 | 状態 |
|---|---|---|---|---|
| **Stage 1** | 枠可視化＋積立接続＋復活の基本追跡＋facts配線 | 累計スカラー手入力（§2.1） | 層1フル＋mode_a_facts接点 | **本spec・今セッション本番** |
| Stage 2 | 精密な再利用/監査 | 年別履歴配列（`nisa.source:'history'`） | 層1拡張 | 将来 |
| Stage 3 | 自動導出 | 投資台帳ledger連携（holdingsに口座タグ・`nisa.source:'ledger'`） | 層1拡張・**B#4隣接** | 将来 |
| Stage 4 | 口座振り分け助言 | tax-location助言 | **層2・personal gated**（§4.2） | 将来・別セッション |

**接続点**＝`nisa.source` 切替軸をStage1のstateに埋めるので、Stage2/3は純関数の入力源差替のみでUI/facts契約不変。Stage3はB#4（個別ポジション）と同じ `investment_snapshots` タグ付けを共有。

## §9 テスト/検証

### 9.1 検証3点セット（締め）
- `node --test 'tests/*.test.js'` 全緑（**末尾スラッシュ不可**＝`node --test tests/` はこの環境で `Cannot find module tests`）
- `PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q` 全緑
- `node scratchpad/nisa-parity-fuzz.js`（または b2-fuzz に genNisa 追加）で **mismatches:0**

### 9.2 fixture追加ケース（RED-first）
実装前に nisa-* ケースを追記し `nisa mismatch` で RED 確認→鏡像実装→GREEN：
- `nisa-a` 未設定（全0/anchorYear0）→ `facts.nisa` **省略**（キーなし・production/personal両方）
- `nisa-b` 当年つみたて満額(120万)/成長0 → `annualTsumitateUsedPct=100`, `annualRoomRemaining=true`（成長残あり）
- `nisa-c` 生涯枠ほぼ満額 → `lifetimeUsedPct` 高・`lifetimeRoomRemaining` 境界
- `nisa-d` 成長内数cap到達(growthLifetime=1200万) → `growthCapUsedPct=100`, `growthCapRoomRemaining=false`
- `nisa-e` 売却あり(soldThisYearAtCost>0) → `hasRestorationPending=true`, personal.raw.restoresYear=年+1
- `nisa-f` 年境界（anchorYear=2025, nowMs=2026-01 UTC）→ `staleAnchorYear=true`
- `nisa-g` adversarial-coercion（配列/NaN/負/hex/全角を各フィールドに）→ 全て num→0/enum→'manual'
- `nisa-h` over-contribution（当年つみたて>120万）→ `overContribution=true`, `annualTsumitateUsedPct` は clamp 100
- 各ケース personal は `facts.raw.nisa` の生¥を deepEqual 固定

### 9.3 構造テスト
- production facts生¥ゼロを allowlist再帰の構造テストで保証（`facts.nisa` の全 number leaf が整数[-100,150]）
- coarsen決定性（pre-coarsen が JS↔Py 同値→Py coarsen で生の非粗化 *UsedPct がゼロ件 assert）
- SYS_PRODUCTION 禁則語トリップ0（NISA語彙が `_TRADE_RE/_FORECAST_RE/_SECURITY_RE` を誤発火しない・advice.py:117 の既存「ETF/NISA/PER誤検出回避」コメント整合）

### 9.4 UI/実機
- Playwright smoke（¥ログインゲート＝readout gateであってinput gateでない・pageerror0・セクション挿入位置・jumpTo）
- **本人実機サニティ**（theme D glow/glass/ドーナツ発色＝GPU依存headless非authoritative）＝レイアウトD確定mockに対する実装差の目視
- 本番curl検証は**本番ルート `/`**（`/index.html` は15Bスタブ）＋**通常URL と persona の両デプロイ**（`vercel git connect` 済でpush→両自動・機能追加後は各URL curl で反映確認）

### 9.5 whole-branch 敵対検証wf（ultracode）
観点＝規制境界（生¥非漏洩・personal gate）／JS↔Pyパリティ（byte一致）／送信ゼロ（client空body）／cf-1不変（既存機能非破壊）／stale描画（full re-render整合）／facts数値範囲。

## §10 リスク

- **SCHEMA lockstep漏れ**（3点のどれか未bump）→全パリティtest RED。→機械置換＋assertionで担保。
- **coarsen非再帰の穴**→facts.nisa 明示走査を忘れると監査ログに生指紋。→§7-4を実装チェックリスト化。
- **num coerce非対称**（単一要素配列 `num([5])=5` vs `_num([5])=0`）→分母に載るとbyte不一致。→共有scalar-only coerce厳守＋fuzz genNisa。
- **簿価復活の暦年境界**→`cy∈[1,9999]` ガードと `staleAnchorYear` で対称化。自動ゼロ化しない（ユーザー確認）。
- **Vercel関数上限**（層2実装時に12丁度）→§4.2 hard precondition。
- **既存 compare-search inline onclick XSS**（detail.js:47/81・未修正）→NISA UIは新規inline handlerを委譲/textContentで書き**同じ轍を踏まない**。
- **LWW消失**（stale ブラウザキャッシュJSの古migrate）→重要キーはLWW前reconcile（既存機構踏襲・NISAは新規キーゆえ衝突小）。

## §11 Non-goals（Stage1）

- iDeCo（掛金上限が職業依存）は本specスコープ外（NISA単独）。
- 年別履歴・投資台帳ledger自動導出（Stage2/3）。
- 口座振り分けの本人助言endpoint（Stage4・§4.2 dormant設計のみ）。
- 個別銘柄の売買推奨・NISA適格投信の具体選定（層2・法務precondition先）。
- 為替/評価損益/配当課税シミュレーション（枠＝簿価トラッキングに限定）。

---

## 決定ログ（ユーザー確定・ブレスト 2026-07-16）
1. スコープ＝能力4つ全て・段階実装（※確定）
2. 今セッション＝層1フル本番／層2 dormant（※確定）
3. データモデル＝3方式段階共存・Stage1スカラー手入力・`nisa.source`軸を最初から（※確定）
4. Stage1で `facts.nisa` をAI規律コーチに載せる（SCHEMA 4→5・フルパリティ）（※確定）
5. UIレイアウト＝D（HUD＋生涯枠ヒーロードーナツ＋2段バー＋当年ゲージ）・円グラフ横並びE不採用（※確定・ビジュアルコンパニオン実物比較）
