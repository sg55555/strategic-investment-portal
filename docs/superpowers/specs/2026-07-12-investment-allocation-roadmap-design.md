# 設計書: 投資枠配分推奨 #1 — 3バケツ フェーズ型ロードマップ（Allocation Roadmap）

- date: 2026-07-12
- status: draft（ユーザーレビュー待ち）
- project: investment-portal
- 由来: 将来 backlog **B「投資枠配分推奨」#1（3バケツ間の金額配分）**（所有ノート `Projects/investment-portal.md`）
- 関連: [[strategy-personal-finance-advice-intent]]（2層規制安全の唯一の型）/ [[investment-portal-dual-deploy-persona]] / [[finance-descriptor-sign-gating]] / [[cross-task-async-stale-response-guard]]
- 設計手法: ultracode design panel（3独立方針→judge統合＝ハイブリッド）＋ユーザー製品判断6件確定

---

## §0 目的・背景・非目標

### 目的
お金の司令室（`#money-view`）に、投資余力を **バッファ→コア→サテライト** の3バケツへどう振るかを示す **フェーズ型ロードマップ＋今月の具体額** を追加する。答えが当面「ほぼ全額バッファ」でも、①今どのフェーズにいて②次に何が解放され③この余力ペースなら約何ヶ月で到達するか、を見せることで**未来志向・規律・教育**のMCC思想を体現する。

### 背景（実測・現状）
- **本リポが実体的に「お金の司令室v2」のコードベース**（v2 は spec/Obsidian 上のラベル）。3バケツの決定論エンジンと2層規制アーキは既に稼働。
- **既に在るもの（再利用必須）**:
  - 状態モデル `defaultState()`（`money-rules.js:80`）: `buckets:{buffer:{amount},core:{amount},satellite:{amount}}`、`monthlyExpense`、`bufferMonths`(既定6)、`satelliteCapPct`(既定10)、`goals[]`（`{targetAmount,deadline}`）、`reserves[]`（sinking fund）、`CURRENT_VERSION=2`。
  - 派生純関数（`money-rules.js:143-153`）: `bufferTarget(s)`=monthlyExpense×bufferMonths、`bufferProgress(s)`、`investable(s)`=core+satellite、`satelliteCap(s)`=investable×capPct/100、`satelliteOver(s)`、`totalAssets(s)`=buffer+investable、`goalProgress(goal,total)`。
  - `cashflowDerived(rows,s,nowMs)`（`money-rules.js:302`）戻り: `available`, `monthlySurplus`（直近3確定月median・赤字clamp）, `toBuffer`, `toReserves`, `reserveAlloc`, `investableSurplus`, `toCore`, `toSatellite`(=0 固定), `monthsToBufferComplete`。※`toSatellite=0` を固定（cf-1不変）＝サテライトへ自動配分しない。
  - `nextAllocation(s)`（`:166`）: フェーズ判定 setup/buffer/rebalance/core（`NEXT_TARGETS`=4・凍結）。Python鏡像 `_next_target`（`advice.py`）。
  - 2層プラミング（`api/me/advice.py`）: `ADVICE_MODE` env gating（production/personal）、`SYS_PRODUCTION`/`SYS_PERSONAL`、出力スキャナ `_AMOUNT_RE/_TRADE_RE/_FORECAST_RE/_SECURITY_RE`＋動的ticker照合（production のみ）、DB backed cache（`facts_hash`）＋cooldown＋rate＋監査ログ、`wc_session` cookie 認証（bcrypt）、`session.py` の `insightEnabled` 可視ゲート。
  - `FACTS_SCHEMA_VERSION`（state の `CURRENT_VERSION` とは**別**の facts 形状版）。
- **投資余力の入力**: kakeibo ETL（`scripts/etl_cashflow.py`→`me.cashflow_snapshots`）→ `cashflowDerived` の `monthlySurplus`/`investableSurplus`。既に本機能の「配分する額」として直接使える。
- **Vercel Hobby 関数枠 = 11/12（空き1）**。

### ギャップ（本機能が埋める＝新規設計）
1. **コアに「達成/目標」概念が無い**（buffer は目標、satellite は上限のみ）。
2. **サテライトは自動積立されない**（＝最後のコマ）。解禁条件と今月分割が無い。
3. **将来投影／フェーズ型ロードマップが無い**（buffer→core→satellite の道のり・現在地・各フェーズ具体額・ETA）。
4. **このロードマップを意味づける layer-2 AI コーチ**（現状 advice.py は単発の next-action nudge のみ）。

### 非目標（今回やらない）
1. **#2 資産クラス/地域比率・#3 NISA/iDeCo枠・#4 個別銘柄ポジションサイジング**（将来。設計は妨げないが作らない）。
2. **新規 Vercel Function の増設**（枠11/12維持＝advice.py 拡張のみ）。
3. **state schema 変更**（`CURRENT_VERSION` 2→? / Neon `mcc_state` migrate / LWWクラウド同期の改修は**しない**。コア目標年数は state に持たず**モジュール定数＋goals逆算で導出**）。
4. **`cashflowDerived` の改変**（cf-1不変＝既存fixture/fuzz600 無傷。サテライト分割は新関数側だけに載せる）。
5. **運用リターンの仮定**（将来投影は積立のみ・0%＝_FORECAST圏回避）。
6. **サテライトへの自動資金移動**（`applySurplus` はコアのみ・サテライトは表示のみ＝手動）。

---

## §1 全体設計（2層・データフロー）

```
[層1: 決定論・クライアント・教育]  money-rules.js（純関数群）
   state(mcc_state) + cashflowDerived(rows) ──▶ roadmap(s,cd,nowMs)  ── UI描画 ─▶ #money-view roadmapSection
                                              （フェーズ配列 / 今月配分 / ETA / マイルストーン）
   ※ログイン本人の自分のデータをクライアントで描画（ネットワーク送信なし）。¥表示可。免責はグローバル。

[層2: 本人専用・server-gated AI]   api/me/advice.py（拡張・新api関数なし）
   POST /api/me/advice {}  ──▶ server が state+cashflow を権威的に読取
      production: facts.roadmap = 集約のみ（phase / coreProgressPct / bool / etaBucket）＝生¥ゼロ／出力スキャナ作動
      personal : facts.raw.roadmap に生¥も同梱／スキャナ無効
   ──▶ Claude(sonnet-4-6) がロードマップの意味づけを教育的に語る（達成時期は確約しない）
```

- **層1が層2の入力 facts**（[[strategy-personal-finance-advice-intent]] の型）。層1の決定論値が最優先で、AIはそれを否定・上書きしない（既存 next_target precedence を踏襲）。
- **`roadmap()` リッチVMは JS 専用**（`cashflowViewModel` と同じくパリティ不要）。Python 鏡像は **facts に載る小関数群だけ**（下記§5）＝ドリフト源を最小化。

---

## §2 層1 決定論エンジン（純関数の契約）

`money-rules.js` に追加。全て純関数・`num()/clamp()/r()` で coerce・ゼロ除算ガード。**state 追加なし**。

### 定数（モジュール定数・state に持たない）
```js
var CORE_FALLBACK_MONTHS = 24;        // goals未宣言時のコア目標＝月支出×24（2年分）※ユーザー確定
var SATELLITE_UNLOCK_CORE_PCT = 50;   // サテライト解放＝コア目標の50% ※ユーザー確定
```

### コア目標（goals逆算＋定数フォールバック）
```
northStarTarget(s) -> number
  = goals[] のうち targetAmount>0 の最大 targetAmount。無ければ 0。
  （goals は goalProgress で総資産 totalAssets に対して測る＝同一曲線上のマイルストーン。最大が到達点）

coreTarget(s) -> number   // コアバケツの目標額
  bt = bufferTarget(s)
  if bt <= 0: return 0                         // setup 未完（monthlyExpense未設定）
  ns = northStarTarget(s)
  if ns > bt: return ns - bt                   // 目標逆算：安全網を超える"成長資本"をコアが担う
  return num(s.monthlyExpense) * CORE_FALLBACK_MONTHS   // フォールバック：月支出×24
  // 規律的仮定：目標到達はコア単独で担う（サテライトの寄与を0とみなす）＝discipline-first

coreTargetSource(s) -> 'setup' | 'goal' | 'fallback'
  = bt<=0 ? 'setup' : (northStarTarget(s) > bt ? 'goal' : 'fallback')
  // UXの出し分け（'fallback'時は「実目標を宣言すると逆算に変わる」nudge）
```

### コア進捗
```
coreProgress(s) -> { progress, pct, remaining, established }
  ct = coreTarget(s); core = num(s.buckets.core.amount)
  progress   = ct>0 ? clamp(core/ct, 0, 1) : 0
  pct        = round(progress*100)
  remaining  = ct>0 ? max(0, ct-core) : 0
  established = progress >= 1
```

### サテライト解放（リスク許容度＝コア50%）
```
satelliteUnlocked(s) -> boolean
  = bufferProgress(s) >= 1 && coreProgress(s).progress >= SATELLITE_UNLOCK_CORE_PCT/100
```

### ロードマップ・フェーズ（NEXT_TARGETS とは別 enum・凍結の4種は不変）
```
roadmapPhase(s) -> 'setup' | 'buffer' | 'rebalance' | 'core' | 'satellite' | 'independence'
  if bufferTarget(s) <= 0        : 'setup'
  if bufferProgress(s) < 1       : 'buffer'
  if satelliteOver(s) > 0        : 'rebalance'      // 上限超過（既存 rebalance 概念）
  cp = coreProgress(s).progress
  if cp >= 1                     : 'independence'
  if satelliteUnlocked(s)        : 'satellite'      // buffer達成・コア50%以上・コア未達
  return 'core'                                     // buffer達成・コア50%未満
```

### 投影ヘルパ（積立のみ・0%・§4）
```
projectMonths(gapYen, rateYen) -> number | null
  = rateYen <= 0 ? null : ceil( max(0, gapYen) / rateYen )

etaBucket(months) -> 'none'|'lt6'|'6_12'|'1_3y'|'3_10y'|'over_10y'   // facts用に生月数を粗化
```

---

## §3 今月の配分プラン（サテライトは表示のみ・手動）

`cashflowDerived` は改変しない（`toSatellite=0` 固定のまま）。今月分割は新関数で cd を後段分配：

```
allocationPlan(s, cd) -> { phase, satelliteUnlocked, toBuffer, toReserves, reserveAlloc, toCore, toSatellite, monthlySurplus }
  surplus = cd.investableSurplus            // バッファ→確保枠を引いた残り（cashflowDerived が算出済）
  if satelliteUnlocked(s):
    room   = max(0, satelliteCap(s) - num(s.buckets.satellite.amount))   // 現 investable ベースの余地
    toSat  = min(room, r(surplus * num(s.satelliteCapPct)/100))
    toCore = surplus - toSat
  else:
    toSat = 0; toCore = surplus
  return { phase: roadmapPhase(s), satelliteUnlocked, toBuffer: cd.toBuffer,
           toReserves: cd.toReserves, reserveAlloc: cd.reserveAlloc,
           toCore, toSatellite: toSat, monthlySurplus: cd.monthlySurplus }
```

- **二重上限**：`satelliteCap`（総枠）と `capPct×新規余剰`（今月分）の両方で抑える＝コアが常に多数派。
- **表示のみ**：`money.js` の `applySurplus`（既存）は**コアのみ加算のまま変更しない**。サテライトへの移動は本人が手動でバケツ額を調整する意図的操作（`toSatellite` はロードマップ上の「目安」として提示）。※ユーザー確定「表示のみ・手動」。
- 現状（buffer再建中・未解放）は `toSatellite=0`・`toCore=surplus` ＝**挙動不変で安全に導入**。

---

## §4 将来投影（積立のみ・0%・確保枠ドラッグ）

- **レート** = `cd.monthlySurplus`（既存の3確定月median・パリティ済）。運用リターンは仮定しない（0%）。※ユーザー確定。
- **バッファ**：`monthsToBuffer = cd.monthsToBufferComplete`（既存）。バッファは全余剰を受ける。
- **確保枠ドラッグ**：コアの月次寄与 `coreMonthlyContribution = max(0, monthlySurplus - reserveMonthlyTotal)`。`reserveMonthlyTotal = Σ reserveMonthly(rv, nowMs)`（既存export `reserveMonthly` で各確保枠の月次コミットを合算＝定常寄与。※ `cd.reserveAlloc` はper-reserve**配列**・`cd.toReserves` は**今月**の実配分スカラーで phase 依存ゆえ**投影には使わない**）。＝確保枠の積立中はコアがゆっくり。※ユーザー確定「確保枠を同時進行ドラッグ」。
- **コア**：`coreRemaining = coreProgress(s).remaining`；`monthsToCore = projectMonths(coreRemaining, coreMonthlyContribution)`；累積 `cumulativeToCore = monthsToBuffer + monthsToCore`。
- **degrade**：`coreMonthlyContribution<=0`（＝余剰が確保枠で食われ尽くす）or `monthlySurplus<=0` or `!cd.available` → 月数 null（「収支連携でタイムラインが表示されます」）。金額は出せる場合は出す。
- **精度の錯覚防止**：全ETAに**「概算・積立のみ・運用益は含めない」**ラベルを UI とプロンプト両方で強制。reserves は有限 sinking fund だが flat 近似では `reserveMonthlyTotal` を継続適用（完了後の加速は無視＝悲観側に倒れる正直さ・注記）。

---

## §5 層2 personal-gated AI（advice.py 拡張・新api関数なし）

### Python 鏡像（facts に載る小関数のみ・共有fixtureでパリティ固定）
`_north_star_target` / `_core_target` / `_core_target_source` / `_core_progress` / `_satellite_unlocked` / `_project_months` / `_eta_bucket` / `_roadmap_phase` ＋定数 `CORE_FALLBACK_MONTHS=24` / `SATELLITE_UNLOCK_CORE_PCT=50`。`allocationPlan`/`roadmap`（リッチVM）は**鏡像しない**（facts は下記の集約＋生額だけで足りる）。

### facts 形状（`mode_a_facts` に `roadmap` ブロック追加）
- **production（集約のみ・生¥ゼロを構造保証）**:
  ```
  facts['roadmap'] = {
    phase: roadmapPhase, coreProgressPct: <coarsen>, coreEstablished: bool,
    satelliteUnlocked: bool, coreTargetSource: 'setup'|'goal'|'fallback',
    etaToCoreBucket: etaBucket(monthsToCore)
  }
  ```
  `coarsen_facts` の粗化ループに `coreProgressPct` を追加（ログ指紋の解像度低下）。
- **personal（`ADVICE_MODE=personal`）**: 既存 `facts['raw']['cashflow']` と同型で
  ```
  facts['raw']['roadmap'] = {
    coreTarget, coreRemaining, coreMonthlyContribution, monthsToCore, northStarTarget,
    thisMonth: { toBuffer, toReserves, toCore, toSatellite }
  }
  ```

### system prompt（両モードに1節追加・出力JSON形/字数は不変）
> 「ロードマップは本人の余剰からの機械的な概算であり相場予測ではない。段階（バッファ→コア→サテライト）の意味は教育的に説明してよいが、達成時期を確約しない。金額はサーバから与えられた事実のみ（production は与えない）。」

### スキャナ・版・DB
- **新スキャナ不要**：ETAは「ヶ月」表現（円/万円/¥/ドル無し）で `_AMOUNT_RE` 非該当。phase名は証券非該当。production で AI が誤って¥を書けば既存 `_AMOUNT_RE` が捕捉して deterministic-only に degrade。
- **`FACTS_SCHEMA_VERSION` を +1**（facts 形状変更）。**`CURRENT_VERSION`（state）は不変＝DB migration 不要**。
- cache/cooldown/rate/監査ログ/免責/degrade は既存機構をそのまま流用。

---

## §6 安全境界（規制2層・金額・証券・免責）

- **証券（個別銘柄）は層1に一切入れない**＝ロードマップはバケツ粒度（buffer/core/satellite）のみ・ticker を扱わない。
- **金額の線引き**（※ユーザー確定＝既存 `cashflowViewModel` と同一信頼境界）:
  - 層1決定論クライアントVMは**ログイン済み本人の自分のデータ**として¥を表示してよい（`cashflowViewModel` が `toBuffer/toCore` を¥表示している前例と同一）。**未ログインは¥非表示**（フェーズ構造・%のみ）＝収支カードと同一ゲート・送信ゼロ境界を崩さない。
  - 層2 production AI 生成テキストからは `_AMOUNT_RE` が¥を strip（AIに金額を語らせない）。**personal のみ AI も生¥可**（env gated・クライアント切替不可）。
  - production の `facts.roadmap` は pct/bool/bucket だけ＝**生¥ゼロを構造テストで保証**（`test_advice_facts.py` の allowlist 再帰に roadmap を含める）。
- **免責**：既存 `R.DISCLAIMER` 定数を常時同梱・欠落時 fail-closed（既存 `adviceSection` の挙動を流用）。
- **可視ゲート**：personal 専用UI（AIカード）は既存 `insightEnabled` と同じく production では痕跡ゼロ。ロードマップ自体（決定論）はログイン本人に表示（personal/production 両モードで安全）。

---

## §7 UX（`#money-view` roadmapSection）

`money.js` に `roadmapSection(rm)` を追加（業務mathは書かず `R.roadmap(...)` 由来VMを描画）。配置＝**バッファゲージの下・`adviceSection` の上**（AIコーチが直上のロードマップを視覚的に意味づける）。テーマD（ネオン・ターミナル）トークン＋既存 `.mcc-wf-*`/`.mcc-goal-bar`/`.mcc-rsv-bar` を再利用。

1. **水平フェーズレール**：`守る(バッファ) → 育てる(コア) → 攻める(サテライト)`。現フェーズはネオン発光＋「今ここ」、完了は✓、未解放は薄く＋🔒。buffer→core の継ぎ目に「先取り(確保枠)」チップ。
2. **コア目標ラベル**：
   - `goal` 時：「目標『〇〇』から逆算 → コア目標 ¥X（あと ¥Y）」。
   - `fallback` 時：「仮の目安：月支出×24ヶ月（2年分）。実際の目標を宣言するとここが逆算に変わります」＋ goals セクションへのジャンプリンク。
3. **今月の配分プラン**（`allocationPlan`）：`バッファ ¥ / 確保枠 ¥ / コア ¥ /（解放時のみ）サテライト ¥`。buffer期はほぼバッファ・後段フェーズは薄く先出し（未来志向）。サテライト額は「手動で移す目安」と明示。
4. **タイムライン**：「この余力ペースなら コア目標到達まで約 N ヶ月（概算・積立のみ／運用益は含めない）」。途中目標があればマイルストーンとして描画（現状 goals 無し＝非表示）。`!available` は「収支連携でタイムラインが表示されます」に degrade。
5. **サテライト状態チップ**：未解放「🔒 解放条件：バッファ達成＋コア50%（現在 X%）」／解放後は cap 余地表示。
6. **各フェーズ1行の規律マイクロコピー**（守る/育てる/攻める・GLOSSARY 言語を再利用）。免責はグローバル。

---

## §8 テスト計画

- **Node 単体（`tests/money-rules.test.js` 追補）**：
  - `coreTarget`：setup(bt=0)／goal(ns>bt)／fallback(goals無 or ns≤bt→月支出×24) の3分岐。
  - `coreProgress`：ゼロ除算ガード・established 閾値。
  - `satelliteUnlocked`：buffer未達/コア49%/50%/51% の境界。
  - `allocationPlan`：未解放(toSat=0)／解放時 cap二重上限／room=0。
  - `projectMonths`：rate≤0→null・端数 ceil。`etaBucket` 境界。
  - `roadmapPhase`：全6分岐（setup/buffer/rebalance/core/satellite/independence）。
  - `roadmap` VM 形状（phases/milestones/thisMonth/northStar/timelineAvailable）。
- **Python パリティ（`tests/test_advice_facts.py` ＋ `tests/fixtures/advice_facts_cases.json`）**：
  - 新 roadmap ケースを追加し JS `modeAFacts` ↔ Py `mode_a_facts` を同一 expected で突合。
  - **allowlist 再帰**に `roadmap` を含め、**production facts に生¥が無い**ことを構造保証。personal `facts.raw.roadmap` に生¥がある事も固定。
  - 小関数（`_core_target` 等）を JS 実装値と同一 fixture で assert。
- **不変性**：`cashflowDerived`（cf-1）の既存 fixture／fuzz600 は無改変で緑を維持（サテライト分割は `allocationPlan` 側のみ）。
- **Playwright 実ブラウザ**：roadmapSection 描画・フェーズ表示・**未ログインで¥非表示**・`applySurplus` がコアのみ・免責存在・JSエラー0。
- **検証ハーネス**：`scratchpad/mock_prod_server.py`＋snapshot 突合（detail 系と同様、money-view 差分を確認）。

---

## §9 リスクと緩和

1. **フォールバック(24mo)が本人の"コア完成"心象とズレ得る** → 「仮の目安」明示＋goals宣言で自動的に逆算へ上書き（source駆動UX）。
2. **flat 0% 投影が reserve完了後の加速/市場リターンを無視** → 「概算・積立のみ・運用益含めず」を UI/プロンプト両方で強制・`surplus≤0` は null degrade。
3. **サテライト分割が current-investable headroom で過小配分** → 規律側（守り優先）の誤差ゆえ許容・表示のみで実害小。
4. **facts.roadmap 追加のパリティドリフト** → リッチVMをJS専用にし鏡像面を小関数に限定＋共有fixtureで固定。
5. **`FACTS_SCHEMA_VERSION` bump と `coarsen_facts` への `coreProgressPct` 追加漏れ** → チェックリスト化・構造テストで検出。
6. **phase enum が NEXT_TARGETS(4) の外** → deterministic next_target は既存4のまま。`adviceSection` の mismatch ガード/`DETERMINISTIC_TEXT` が壊れないことを確認（roadmap phase は別フィールド）。
7. **production の生¥漏れ** → allowlist 再帰＋構造テストで facts.roadmap に生¥ゼロを保証。
8. **クライアント¥描画の送信ゼロ境界** → ログインゲート内のみ描画（未ログイン非描画・収支と同一）。

---

## §10 実装順序（SDD タスク粒度の目安）

1. `money-rules.js`：定数＋純関数（northStarTarget/coreTarget/coreTargetSource/coreProgress/satelliteUnlocked/roadmapPhase/projectMonths/etaBucket/allocationPlan/roadmap）＋公開API追加。→ Node 単体テスト。
2. `advice.py`：鏡像小関数＋定数＋`mode_a_facts` の roadmap ブロック（production集約／personal raw）＋`coarsen_facts`＋`FACTS_SCHEMA_VERSION` bump＋system prompt 1節。→ 共有fixtureパリティ＋allowlist構造テスト。
3. `money.js` + `money.css`：`roadmapSection` 描画（`applySurplus` は不変）＋テーマD/既存クラス再利用。→ Playwright。
4. 検証ハーネス突合＋whole-branch 敵対検証（ultracode wf・観点＝規制境界/パリティ/送信ゼロ/cf-1不変/stale描画）。
5. 実機サニティ（司令室ログイン×収支×ロードマップ）→ push（GitHub連携で通常URL＋persona 両デプロイ・各URL curl 反映確認・ルート`/`）。

---

## §11 決定ログ（ユーザー確定・2026-07-12）

| # | 判断 | 確定 |
|---|------|------|
| 配分対象 | どの「枠」か | **#1 3バケツ間の金額配分**から。#2/#3/#4は将来（設計は妨げない） |
| 主出力 | 何を返すか | **フェーズ型ロードマップ＋具体額（両方）** |
| 1 | コア達成ラインの定義 | **目標逆算＋定数フォールバック**（goals宣言で自動的に逆算へ） |
| goals | 現在の宣言状況 | **まだ無い（バッファ集中）**＝当面フォールバック支配・宣言後に逆算へ |
| 24mo | フォールバックのコア目標 | **月支出×24ヶ月（2年分）** |
| 2 | サテライト解放条件 | **バッファ達成＋コア目標の50%**（`SATELLITE_UNLOCK_CORE_PCT=50`・定数で変更可） |
| 3 | サテライト資金移動 | **表示のみ・手動**（`applySurplus` はコアのみ） |
| 4 | 将来投影の前提 | **運用リターン0%＋確保枠を同時進行ドラッグ** |
| 5 | 金額表示境界 | **既存 cashflowViewModel と同一**（ログイン本人・クライアント限定・production AIは¥strip） |
| 6 | コア目標年数を state に持つか | **持たない**（goals＋モジュール定数で導出＝migrate/クラウド同期の改修ゼロ） |
| north-star | 目標の選び方 | **最大額**＋将来セレクタのフック／途中目標はマイルストーン描画 |
| effort | 設計深度 | **xhigh**（ultracode 幅ON）で設計 |
