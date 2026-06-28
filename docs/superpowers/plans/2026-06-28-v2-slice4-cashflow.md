# Wealth Cockpit v2 / Slice 4「収支連携 → 投資余力」実装計画

- date: 2026-06-28
- project: investment-portal v2（お金の司令室）
- status: 設計ロック済（ultracode 多観点設計 workflow `wf_f2374c48-548`＋本人 AskUserQuestion で6論点確定）
- 由来: spec `docs/superpowers/specs/2026-06-27-wealth-cockpit-v2-architecture.md` §4-4。MCC「可視化→目標→AI助言」ループの中核（フロー＝収支を司令室に接続）。
- 設計プロセス: 5案（疎結合ETL/最小/再利用/プライバシー厳密/UX自動）を3レンズ（アーキ・セキュリティ・実用）で敵対採点 → Approach4 骨格に他案の最良要素をグラフト。

---

## 1. 確定した6決定（本人選択・2026-06-28）

| # | 論点 | 決定 | 観点 |
|---|---|---|---|
| D1 | 読取配置（Vercel関数 現8/12） | **専用 `api/me/cashflow.py`（GET・raw row のみ・401ガード）= 9/12** | 故障隔離。安定 Slice2 `state.py` を無改造に保ち、cashflow 読取失敗が中核 sync の `core state load` を 500 させない（blast radius ゼロ） |
| D2 | Notion 接続・取込粒度 | **専用 read-only integration 新設 × ハイブリッド粒度**：月別集計DB＝権威の見出し数字 ＋ 生取引DB＝自由な内訳（カテゴリ別等） | 最小権限＋疎結合＋集計の自由度最大。見出しは kakeibo の式と一致（権威）、内訳は ETL で自由集計（将来のリッチ分析に順応） |
| D3 | 投資余力の定義・平滑 | **balance 基底（固定費二重控除を是正）→ 経常余剰=balance−雑収入 → median(3) → ウォーターフォール配分** | 規律接続と実装コストの均衡。median(3)+当月除外+赤字clamp+臨時収入分離の「安価な厳密性」のみ（MAD/trimmed-rolling は単一ユーザに過剰＝不採用） |
| D4 | personal で生額を LLM へ | **personal は常に生額も LLM へ**（production は集約のみ＝Mode A）。**advice_log は両モードとも生額非保存** | 個人専用ツールの利便最大（本人無償自己利用＝登録対象外）。既存 ADVICE_MODE=personal 方針と一貫＝追加フラグ不要 |
| D5 | 取込 cadence | **月次 schedule ＋ 手動 workflow_dispatch**（dispatch 先行 → サニティ後に schedule 後付け） | データ鮮度の現実性（MONTHLY_DB は月次更新）＋段階的本番化の最小リスク。Claude を叩かない純 ETL ＝環境方針上 schedule 自動継続可 |
| D6 | mcc_state.monthlyExpense の自動更新 | **手動維持＋「kakeibo 平均から提案」に留め自動上書きしない** | stock（バッファ目標基準）と flow（月次収支ノイズ）の分離。乖離大は `expenseDivergence` フラグで注意喚起のみ |

---

## 2. データ源（kakeibo Notion・実体確認済）

`api/dashboard.py` から確認した DB と式プロパティ：

- **月別集計DB** `d05a2ae0-9381-4083-b862-d56e72031a88`（= MONTHLY_DB_ID・**権威の見出し**）
  - 1 行 = 1ヶ月。式プロパティ計算済：`給与収入` `雑収入` `収入合計` `固定支出` `変動支出` `支出合計` `貯蓄率`、キー日付プロパティ `日付` / 月ラベル `月`。
  - 1 クエリ（ページング）で投資余力に必要な月次入力が全部揃う。kakeibo の正しい計算ロジック内蔵 ＝ 表示値の権威。
- **生取引DB群**（= **自由な内訳**・ハイブリッドの自由度側）
  - 変動費リスト `d4b5b08c-4892-4d8e-a4f0-272fe2ae179b`（`日付` `金額` ＋カテゴリ）
  - 固定費リスト `a47cf927-0df5-4487-8dd9-63feb8150088`（`金額` ＋ `終了したもの` checkbox。kakeibo は `終了したもの=false` で絞る）
  - 給与収入リスト `7514202c-a952-4e69-94a7-df6a066d2655` / 雑収入リスト（misc-income）
  - 1 取引 = 1 行（日付・金額・カテゴリ）。ETL でカテゴリ別/任意期間/傾向を自由集計。

**接続**: 専用 read-only Notion integration を新設し、上記 DB のみに「コネクト」共有（最小権限）。`NOTION_TOKEN` は GitHub Actions Secret に置く（Vercel env 追加ゼロ＝env-redeploy 罠を回避）。

---

## 3. ストレージ（Neon `me` スキーマ・additive）

`db/schema_me.sql` に追記（CREATE IF NOT EXISTS・既存 sessions/mcc_state/advice_log 無傷）：

```sql
CREATE TABLE IF NOT EXISTS me.cashflow_snapshots (
  period           DATE PRIMARY KEY,                 -- 月初(YYYY-MM-01)・冪等upsertの自然キー
  total_income     NUMERIC(14,0) NOT NULL DEFAULT 0, -- 月別集計DB(権威)
  salary_income    NUMERIC(14,0) NOT NULL DEFAULT 0, -- 経常収入
  misc_income      NUMERIC(14,0) NOT NULL DEFAULT 0, -- 臨時収入(windfall・経常へ外挿しない)
  fixed_expense    NUMERIC(14,0) NOT NULL DEFAULT 0, -- 内訳/負担比率表示のみ・余剰から二重控除しない
  variable_expense NUMERIC(14,0) NOT NULL DEFAULT 0,
  total_expense    NUMERIC(14,0) NOT NULL DEFAULT 0, -- = fixed+variable(kakeibo算出)
  balance          NUMERIC(14,0) NOT NULL DEFAULT 0, -- = total_income - total_expense(=月次余剰の基底)
  savings_rate     NUMERIC(6,2),                     -- %(参考保持・Mode Aは再計算して単一源)
  is_complete      BOOLEAN NOT NULL DEFAULT true,    -- 当月途中(部分月)は false で rolling/規律から除外
  breakdown        JSONB,                            -- 生取引DBから集計した自由な内訳(カテゴリ別変動費/固定費明細等)
  source           TEXT NOT NULL DEFAULT 'kakeibo-notion-hybrid',
  source_hash      TEXT,                             -- sha256(正規化済元行)=無変化skip/改ざん検知
  pulled_at        TIMESTAMPTZ NOT NULL DEFAULT now()-- 鮮度(UIバッジ/Mode A staleDays算出元)
);
CREATE INDEX IF NOT EXISTS idx_cashflow_period ON me.cashflow_snapshots (period DESC);
```

- 見出し数値（income/expense/balance）= 月別集計DB（権威）。`breakdown` JSONB = 生取引DB集計（自由）。**投資余力は見出し数値のみ使用**＝生取引集計のズレが規律数字に波及しない。
- 生額は `mcc_state.monthlyExpense` と同じ信頼境界（認証必須・非公開・Slice2 でクラウド化済・本人合意済）。**LLM へは生額を渡さない（production）／personal のみ生額可（D4）。advice_log は両モード生額非保存**。
- `.vercelignore` で `db/*.sql` は配信除外（内部スキーマ非公開を維持）。

---

## 4. 投資余力ロジック（D3・`money-rules.js` 純関数に単一源化）

入力（`cashflow_snapshots` 直近 N ヶ月 ＋ `mcc_state`）。**業務 math は `money.js`/`advice.py` に書かず `money-rules.js` の純関数に置き、advice.py で鏡像実装**（`tests/fixtures/advice_facts_cases.json` でパリティ固定）。

1. **経常余剰** `recurringNet[m] = balance[m] − misc_income[m]`（臨時収入を経常から除外）
2. **平滑** `investableBase = median( recurringNet の直近 3ヶ月・is_complete=true のみ )`（外れ値1個に強い・当月=進行中は除外。完了月<3 は `insufficientData=true` で外挿しない）
3. **月次余剰** `monthlySurplus = max(0, investableBase)`（赤字clamp）
4. **ウォーターフォール配分**
   - `requiredBuffer = bufferMonths × monthlyExpense`
   - `bufferRemaining = max(0, requiredBuffer − buckets.buffer.amount)`、`bufferAchieved = bufferRemaining == 0`
   - `toBuffer = min(monthlySurplus, bufferRemaining)`
   - `investableSurplus = bufferAchieved ? monthlySurplus : max(0, monthlySurplus − bufferRemaining)`（= バッファ充足まで余剰はまずバッファへ、充足後は投資へ）
   - 投資分は `satelliteRoom = max(0, satelliteCap − satelliteAmount)` 内がサテライト、残りはコア
   - `monthsToBufferComplete = monthlySurplus>0 ? ceil(bufferRemaining / monthlySurplus) : Infinity`
   - 「額」= cashflow 由来 ／「行き先」= 既存 `nextAllocation`(setup/buffer/rebalance/core) と連動
5. **臨時収入** `windfallTtm = 直近12ヶ月 misc_income 合計`（別建て表示・年率換算で混ぜない）

**罠の是正**：余剰 = `balance`（= 収入 − 支出合計。total_expense が固定費を内包済）。spec の「収入−支出−固定費」は**固定費二重控除**ゆえ採らない（コメント＋パリティ fixture で固定）。`fixed_expense` は `fixedBurden`（負担比率）表示のみ。

**edge**：赤字月→余力0＋規律バナー（家計見直し/バッファ防衛）。当月(is_complete=false)→headline/rolling から除外。currency!=JPY→投資余力非表示＋注記（単一ユーザ JPY で当面 defer）。

---

## 5. プライバシー / Mode A（Slice3 と整合）

- **production**: LLM へは `facts.cashflow` 集約のみ。`{ available, savingsRatePct(0-100 clamp・balance/income から再計算=単一源), surplusPositive, surplusToExpensePct, surplusTrend(improving/flat/declining=直近3 median vs 前3 median), monthsCovered, deficitMonthsInLast6, fixedBurdenBucket, windfallPresent(額なし), staleDaysBucket }`。生額・カテゴリ別内訳・period 詳細は出さない。
- **personal**: 上記 ＋ `facts.raw.cashflow` に生額（monthlySurplus/avgIncome/avgExpense 等）を同梱（D4・本人専用）。
- **両モード共通**: `advice_log` は `coarsen_facts` 拡張で新比率も `_bucket25`(0/25/50/75/100)化、`raw.cashflow` 除去 ＝生額指紋ゼロ（facts_hash は coarsen 後から）。
- `FACTS_SCHEMA_VERSION` / `SCHEMA_VERSION` を 1→2 bump（advice_log の版混在は `schema_version` 列で監査時分岐）。`modeAFacts`(JS)↔`mode_a_facts`(Py) を同方向に変更し fixture に cashflow ケース（未取得/赤字/平滑/古い/personal raw）追加 → node/pytest 双方でパリティ固定。
- サーバ権威: `advice.py` が既存 autocommit 接続で `mcc_state` SELECT 直後に `cashflow_snapshots` を SELECT し server-side 集約（クライアント経由で cashflow を LLM へ渡さない）。
- **規制安全（4本柱）は不変**：本 Slice は本人利用の可視化＝圏内。外部提供/課金/教材バンドルの段で金商法 登録要否 法務レビューの hard precondition が掛かる構造は変えない。

---

## 6. UI（`money.js` / `money.css`）

- `render()` の連結式に `cashflowSection(cv)` を **banner 直後・adviceSection 前**に1項追加（余剰文脈をコーチに先行）。
- `money-rules.js viewModel(s)` は**非改造**（1引数のまま）。新たに純関数 `cashflowViewModel(rows, state, nowMs)` を追加し `cv.*` を供給（業務 math は money.js に書かない）。
- データ供給: `show()` 初回に `GET /api/me/cashflow` を fetch しモジュール変数 `_cashflowRows` に保持（read-only・PUT/LWW に乗せない＝書込競合なし・編集UIなし）。
- カード3要素: ①収支カード（直近確定月の 収入/支出（固定+変動内訳）/収支/貯蓄率・当月は「進行中・暫定」チップ）②投資余力ゲージ（monthlySurplus を toBuffer/toInvest 二分割バー・既存 `.mcc-gauge-bar/fill` 流用・赤字赤/健全緑）③推移スパークライン（任意・isolated インライン SVG・Chart.js を `#money-view` に持ち込まない）＋鮮度バッジ（pulled_at）。
- **ループ閉鎖**: ゲージから「今月の余剰¥X をコアへ反映」ワンタップ → `buckets.core.amount` 加算 → 既存 `setField`→`save()` に乗り自動クラウド同期（state 新フィールド不要）。「可視化→配分→目標→AI助言」が端から端まで閉じる＝Slice4 完了定義。
- **5段 degrade ラダー**（UX を空白にしない）: 未ログイン → 未連携（cashflowConfigured=false の CTA）→ stale（鮮度バッジ）→ fetch失敗（try/except で cashflow=null・state描画は不変）→ 当月暫定のみ。
- `esc()` 必須・CSS は `.mcc-cashflow` 接頭辞・既存トークン・640px 1カラム。

---

## 7. 実装フェーズ

0. **設計ロック＋plan＋spec是正** ✅: 本 plan 作成。spec §4-4「収入−支出−固定費」→「収入−支出（=balance）」へ是正（固定費二重控除の罠を明文化）。
1. **スキーマ＋最小権限ロール**: §3 を `db/schema_me.sql` に追記し psycopg で additive 適用。ETL 専用の最小権限 Neon ロール（`me.cashflow_snapshots` への INSERT/UPDATE 限定）を検討（GitHub Actions Secret）。
2. **ETL**: `scripts/etl_cashflow.py`（月別集計DB＋生取引DB 直読み → 期待プロパティ **loud-fail 検証** → `source_hash` skip → 直近6ヶ月 rolling 冪等 upsert・write-only-good-rows・`breakdown` JSONB 構築）＋ `.github/workflows/cashflow-pull.yml`（workflow_dispatch 先行・schedule 後付け）。
3. **money-rules.js**: 純関数 `cashflowViewModel(rows, state)` 追加（viewModel 非改造）。`modeAFacts` に `facts.cashflow` 追加・`FACTS_SCHEMA_VERSION` 1→2。`tests/money-rules.test.js` 拡張 → node --test 緑。
4. **advice.py 鏡像＋パリティ**: autocommit 接続に `cashflow_snapshots` SELECT 追加 → `mode_a_facts` に cashflow 集約（modeAFacts 鏡像）＋`coarsen_facts` に新比率 `_bucket25`＋`SCHEMA_VERSION` 1→2。`advice_facts_cases.json` に cashflow ケース → test_advice_facts.py 緑（JS↔Py パリティ）。
5. **読取endpoint**: `api/me/cashflow.py`（GET・raw row のみ・`_valid_session` 401ガード）= 8→9/12。
6. **UI**: §6。
7. **敵対レビュー（HIGH=0 ゲート）＋本番化**: ultracode 実装レビュー wf → push → `vercel inspect <url> --logs | grep Commit` で実コミット照合＋本番 curl（env-redeploy 罠）→ dispatch サニティ後に schedule 有効化。太田さん実機 end-to-end（ループ閉鎖）→ Obsidian/MEMORY 整理。

**要・本人作業**: ①専用 read-only Notion integration 新設＋対象 DB 共有 ②`NOTION_TOKEN`＋（ETL用）`DATABASE_URL` を GitHub Actions Secret に配置 ③deploy 承認。

## 8. リスクと緩和

- [MED] Notion 式プロパティ名への2リポ重複結合 → ETL 先頭で **loud-fail 検証**（silent `.get() or 0` を廃）＋鮮度バッジ。
- [MED/HIGH] 固定費二重控除（spec §4-4）→ 余剰=balance に確定＋コメント＋パリティ fixture。
- [HIGH] personal で生額の機密度上昇（時系列）→ production 既定堅持＋出力スキャナ二次ベルト＋advice_log 両モード生額非保存（D4 で本人が利便を選択）。
- [MED] 集約の片側のみ変更で生額露出/非対称ドリフト → SCHEMA_VERSION bump＋fixture で node/pytest 双方固定。
- [MED/LOW] `DATABASE_URL`/`NOTION_TOKEN` の Vercel env × Actions Secret 二重管理 → ETL は最小権限ロール＋ローテ runbook。
- [LOW] env 変更が古コミット再デプロイ → push 後 `vercel inspect` で実コミット照合＋本番 curl。
- [LOW] currency!=JPY（将来）→ `currencyMismatch` で非表示＋注記。

## 10. 実装レビュー反映（2026-06-28・ultracode 敵対レビュー wf `wf_35b3467f-58f`）

6観点＋パリティファズ→敵対検証(43agent)→統合。**HIGH=0**（deploy ゲート通過）。36指摘中22実在確認。**JS↔Python パリティ：ファズ600比較 mismatch 0**（fixtures 4ケース外でも完全一致を実証）。

**反映した MED 6件**:
- **cf-1**: ウォーターフォールがサテライト優先で `destination='satellite'` だが `nextTarget='core'`＝自己矛盾→**規律芯（バッファ→コア・サテライト自動配分なし）に統一**し `destination=nextAllocation().target` で単一源一致。
- **cf-balance-zero**: 負の収支が `yen()`/`num()` で ¥0 表示→`yenSigned` 追加、収支は `cv.balanceFmt`。
- **applySurplus 冪等**: 連打で月次余剰を多重計上→`state.lastAppliedCashflowPeriod` で確定月単位ガード＋ボタン「反映済み」disable。
- **cf-2**: trend の±5%相対バンドが負中央値で符号反転（横ばい赤字を improving 誤判定）→`rb<=0` は絶対比較(eps)。
- **cf-5**: 収支カードの貯蓄率が3ヶ月集計で単月の収入/支出と不整合→viewModel は表示行の単月貯蓄率（facts は3ヶ月のまま=LLM意図値）。
- **etl-1**: loud-fail が型を見ず formula 差替で 0 格納→型認識検証（数値=formula/日付=date）＋権威2フィールド None 月は skip（write-only-good-rows）。

**反映した LOW**: par-2（単一丸めで保存則）・par-4（coarsen コメント）・par-6（advice.py SELECT LIMIT 60）・etl-5（source_hash を `(-amount,name)` で決定化）・etl-8（`tests/test_etl_cashflow.py` 追加）・cf-observ-4（degrade ログ `e!r`）・cf-partial-mismatch（表示行とバッジ整合）・cf-6（expenseDivergence ノート）。

**回帰固定**: fixtures に `cashflow-trend-deficit-flat`(cf-2)/`cashflow-buffer-achieved`(cf-1)/`cashflow-bufferrem-half`(par-2) を追加（計14ケース）。

**意図的に未対応（LOW・follow-up 可）**: etl-4（Notion リトライ/バックオフ＝abort-on-error は部分書込防止で意図的）・cf-bg401-stale-dom（背景401で認証DOM残存＝既存Slice3と同挙動・次操作で自己回復）・par-1（万/億の円非共起＝leak-5 の意図的トレードオフ・一次保証は生額アンカー不在）・etl-2（breakdown は表示専用で投資余力に不影響）。

## 9. 工数

中規模（Slice3 と同程度・集中2〜3セッション）。新規発明ほぼゼロ＝既存パターン（me スキーマ/sha256認証/JSONB/autocommit/`money-rules.js` 純関数境界/`modeAFacts`↔`mode_a_facts` 鏡像/`coarsen_facts`/gauge UI/`save()` 自動同期）の総流用。重みの中心はフェーズ2 ETL（loud-fail/rolling/breakdown）とフェーズ3-4 の JS↔Py パリティ拡張。
</content>
</invoke>
