---
date: 2026-07-17
project: investment-portal
backlog: "B #3 NISA枠 Stage3（投資台帳ledger連携）＝ data-foundation Phase2 の書込経路を含む"
規制フレーム: 層1のみ（決定論・教育）。層2（口座振り分け助言）は Stage4・本spec スコープ外
前提: decision-complete（ユーザー確定済み・末尾の決定ログ参照）
related: 2026-07-16-nisa-quota-design.md, ../plans/2026-06-29-data-foundation-and-discipline-model.md
改訂履歴:
  - 2026-07-17 初版（ブレスト確定→spec化。理解フェーズ wf 6次元マップで既存契約を実測）
---

# 投資台帳基盤（ETL＋口座/枠タグ＋NISA ledger fold）— NISA Stage3 設計書

## §0 目的と戦略文脈

NISA枠 Stage1（累計スカラー手入力）/ Stage2（年別履歴）に続き、**Stage3＝投資台帳からの自動導出**を実装する。
`2026-07-16-nisa-quota-design.md` §8 が定めた段階構成の第3段であり、同 spec §1-3 の「`nisa.source` 切替軸を Stage1 から埋め、後段は純関数の入力源差替のみで UI/facts 契約不変」という設計意図の**最終検証**にあたる。

### 0.1 着手時点の実測（理解フェーズ wf `wf62e6mh8`・6次元・エラー0）

Stage3 は「NISA の作業」ではなく、実質**投資台帳そのものを作る作業**である。着手前の実測：

| 依存 | 実測結果 |
|---|---|
| Notion「投資取引（Investment Transactions）」DB | 作成済（2026-06-30・`38eda3f0-c01c-8142-b8e3-db02c921916b`）だが **口座プロパティが無い** |
| `scripts/etl_investment.py`（書込経路） | **存在しない**（`api/me/investment.py` の docstring が参照しているだけ） |
| `me.investment_snapshots` | DDL は `db/schema_me.sql:100-112` に存在。`.vercelignore` で配信除外＝Neon への自動適用なし。**データ0行** |
| `holdings` JSONB の口座タグ | 無し（`{ticker:{qty,avg_cost,strategy}}`） |
| `investmentDerived`（money-rules.js:1039） | 実装済だが **本番コードから一度も呼ばれていない**（`tests/money-rules.test.js` からのみ） |
| `advice.py` の投資 facts | 無し |
| 本人 hard precondition 3件（期初保有行・kakeibo クリーンアップ・read-only integ 共有） | 未実施 |
| 台帳の実データ | **0件**（初購入前） |

`NISA_SOURCES`（money-rules.js:22 / advice.py:41）は既に `"ledger"` を含む＝enum coerce と export の追加は不要。

### 0.2 スコープ分解（§11 決定1）

「台帳基盤フル」は独立した複数サブシステムに分かれる。**本spec は A+B+D のみ**を扱う。

| | サブシステム | 本spec |
|---|---|---|
| **A** | 投資台帳 ETL（Notion→Neon の書込経路） | ✅ |
| **B** | 口座/枠タグ（Notion プロパティ＋snapshots 4列＋holdings 粒度） | ✅ |
| **D** | NISA ledger fold（`nisaLedgerFold`＋ledger 枝＋UI） | ✅ |
| C | data-foundation Phase2 の残り＝`investmentDerived` の viewModel 配線／`investmentSource` 二軸トグルUI／**Mode A 投資 facts**（principal/realized の鏡像パリティ・重い協調変更） | ❌ 別spec |

**C を切る根拠**＝NISA枠の導出に C は一切要らない。C は「投資元本の表示」の話であり、D は「非課税枠の消化」の話。両者は同じ `investment_snapshots` を読むが依存関係が無い。

### 0.3 非機能の前提

- **データ0での inert 完成**が本specのゴール。初購入の瞬間から正しく動く状態を作る。
- Anthropic 課金ゼロ（純 ETL・Claude API を叩かない）。
- Vercel 関数を増やさない（`api/me/investment.py`・`api/me/advice.py` とも既存）。
- root `requirements.txt` に触れない（Vercel の全 api/* が全依存を install するため＝bloat 禁止）。

---

## §1 確定事項（製品判断・変更不可）

| # | 論点 | 確定 |
|---|---|---|
| 1 | スコープ | **A+B+D**。C（Phase2 の読み配線＋Mode A 投資facts）は別spec（§0.2） |
| 2 | 口座/枠の表現 | Notion に **「口座区分」select 1つ・3値**（`NISAつみたて`/`NISA成長`/`課税`）。必須。2プロパティ（口座×枠）は「課税＋つみたて枠」等の不整合を UI 上で作れてしまうため不採用。既存「戦略区分」への混載は軸が直交するため不採用 |
| 3 | snapshots の形 | **数値列4つを additive 追加**（`NUMERIC(16,0) NOT NULL DEFAULT 0`）。既存 `principal_core_delta`/`principal_sat_delta` と同型＝「per-period delta は数値列」という確立イディオム。JSONB 1列・別テーブルは不採用（§11-3） |
| 4 | fold の実装 | `nisaLedgerFold` は制度モデルを再実装せず **既存 `nisaHistoryFold` に委譲**（§3.2） |
| 5 | ledger 行の届け方 | `nisaDerive(state, nowMs, rows)` / `_nisa_derive(s, now_ms, rows)` の**第3引数**。Py 側は `advice.py` が `me.investment_snapshots` を SELECT（`cashflow` の既存前例と同型・§3.3） |
| 6 | reconcile | **ledger にも広げる**（記帳漏れ検出という ledger 固有の価値・§4.3） |
| 7 | 期初保有×NISA | 「日付」に**実取得日**を入れる運用。ETL はその年の拠出として計上（§2.3） |
| 8 | 検証の受入基準 | 合成 fixture ＋ **Notion 一時テスト行に対する `--dry-run`**（本番 Neon には書かない・§9） |
| 9 | 枠消費の定義 | 拠出＝**約定金額のみ**（手数料は枠を消費しない）。配当は枠不消費 |
| 10 | 軸の直交性 | 戦略区分（コア/サテライト）と口座区分は**直交**＝1購入が `principal_core_delta` と `nisa_growth_delta` の両方に載る |
| 11 | SCHEMA bump | **不要**（`FACTS_SCHEMA_VERSION` は 5 据え置き／`RULES_VERSION`・`CURRENT_VERSION` も据え置き）。理由＝facts 形状も state 形状も変わらない＝Stage2 が実証した「入力源差替だけなら bump しない」と同じ（§7.1） |

---

## §2 サブシステム A＋B：ETL と元データ

### 2.1 Notion「投資取引」DB への追加

既存プロパティ（`../plans/2026-06-29-data-foundation-and-discipline-model.md` §9）に **1つだけ**足す：

| name | type | options | 備考 |
|---|---|---|---|
| `口座区分` | select | `NISAつみたて` / `NISA成長` / `課税` | **必須**。空は ETL が loud-fail |

既存行が0件ゆえ後方互換の考慮は不要。**この追加は初購入より前に完了していることが hard precondition**（後からのタグ埋め戻しは苦痛）。

### 2.2 `me.investment_snapshots` への追加（migration）

```sql
-- db/migrations/2026-07-17-investment-nisa-columns.sql
ALTER TABLE me.investment_snapshots
  ADD COLUMN IF NOT EXISTS nisa_tsumitate_delta        NUMERIC(16,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nisa_growth_delta           NUMERIC(16,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nisa_tsumitate_sold_at_cost NUMERIC(16,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nisa_growth_sold_at_cost    NUMERIC(16,0) NOT NULL DEFAULT 0;
```
`db/schema_me.sql` の CREATE TABLE 側も同時に更新（新規適用時に列が揃うように）。列コメントで「per-period delta・簿価（取得原価）・非負」を明記。

**単位系の不変条件**＝4列とも「円・簿価（取得価額）・非負」。ledger 側で負値（売り越し等）を作ってはいけない（下流の `r()` は全値非負前提の half-up）。

### 2.3 `scripts/etl_investment.py`（新規）

`scripts/etl_cashflow.py` の型を厳守する（追加依存ゼロ＝`urllib`＋標準ライブラリ＋`psycopg` のみ）。

**責務境界（越えてはいけない線）**
- ETL が出すのは **per-period の delta のみ**。累積（principal 残高／investable／realizedGainTtm／生涯簿価残）は純関数側の単一源が導く（`db/schema_me.sql:98` が明文化）。
- 逆に **売却時の按分原価＝移動平均は ETL 側の責務**。`holdings` JSONB に期末の移動平均状態を残す。

**移動平均の粒度＝`(ティッカー, 口座区分)`**。同一銘柄を NISA成長 と 課税 の両方で持てるため、口座をまたぐと簿価が混ざる。`holdings` を拡張する：

```
旧: {"<ticker>": {qty, avg_cost, strategy}}
新: {"<ticker>|<口座区分>": {ticker, account, qty, avg_cost, strategy}}
```
値にも `ticker`/`account` を冗長に持つ（将来 Slice5 の時価 join を楽にする）。**読み手はまだ存在しない**（`investmentDerived` は holdings を読まない・`api/me/investment.py` は素通し）ため破壊リスクは無い。`source_hash` の安定性のため**キーの厳密全順序ソート**必須（`etl_cashflow.py` の `cat_list` と同じ教訓）。

**種別ごとの会計**

| 種別 | principal_*_delta | nisa_*_delta | nisa_*_sold_at_cost | holdings |
|---|---|---|---|---|
| 購入 | +約定金額（戦略区分で振分） | +約定金額（口座区分が NISA* の時） | — | qty+・avg_cost 更新 |
| 売却 | −（簿価按分） | — | +（`avg_cost × 数量`・口座区分が NISA* の時） | qty− |
| 配当 | 0（元本不変） | **0（枠を消費しない）** | — | 不変 |
| 期初保有 | +取得原価 | +取得原価（口座区分が NISA* の時・**「日付」の年に計上**） | — | seed |

課税口座の行は `nisa_*` が全て0（`principal_*_delta` には計上される）。

**loud-fail（`SystemExit("ETL ABORT: …")`）**
- `REQUIRED_INVESTMENT_PROPS` に `口座区分` を含め、欠落/rename を `pages[0]` 代表検査で中止
- `口座区分` が空／既知3値以外 → 中止（**silent に「課税」扱いしない**）
- 売却行の `数量` 欠落 → 中止（既存 plan の要求）
- Notion 取得失敗 → 中止（部分データで Neon を汚さない）
- `NOTION_TOKEN` / `DATABASE_URL` 未設定 → 中止
- `diagnose()` を main 冒頭で呼ぶ（`/users/me` → `/v1/search` で共有漏れを `⚠` 表示・秘密は出さない）

**CLI**＝`--months N` / `--dry-run`（`DATABASE_URL` 無しでも動く・末尾3件を print）。ログは `[etl_investment]` プレフィックス。

**upsert**＝`period` 自然主キー・`source='investment-notion'`・`source_hash` 一致なら skip（既存 hash を一括 SELECT して dict 化）。

**`is_complete`**＝JST 基準で当月のみ false。

### 2.4 `.github/workflows/investment-pull.yml`（新規）

`cashflow-pull.yml` の複製。**別ファイル・別 `concurrency.group: investment-pull`**（schema コメントの「別失敗ドメイン」要求＝投資 ETL の失敗が cashflow pull を巻き込まない）。secrets は既存2本（`NOTION_TOKEN`/`DATABASE_URL`）を再利用し新設しない。

**段階的本番化**＝初手は `workflow_dispatch` のみ。`schedule` はコメントアウトで用意し、初購入後の手動サニティを経てから有効化（有効化日をコメントに残す＝既存慣習）。**台帳0件の今 cron を回す意味は無い**。

### 2.5 `api/me/investment.py`

`COLUMNS` に4列を追加（additive）。`_row_to_dict` も対応。**業務 math は持たない**規律を維持（docstring の宣言どおり）。

---

## §3 サブシステム D：NISA ledger fold

### 3.1 契約＝5スカラーを埋めることに尽きる

`nisaEffective` が `nisaDerive` に渡す5スカラー（全て円・簿価・非負）：

| 名前 | 意味 |
|---|---|
| `tsumitateThisYear` | 当年のつみたて投資枠の拠出額 |
| `growthThisYear` | 当年の成長投資枠の拠出額 |
| `tsumitateLifetime` | 生涯枠のつみたて由来 簿価残（復活反映後） |
| `growthLifetime` | 生涯枠の成長由来 簿価残（成長内数1200万 cap も判定） |
| `soldThisYearAtCost` | 当年に売却した簿価合計（翌年1/1 に復活予定の額） |

### 3.2 `nisaLedgerFold`＝`nisaHistoryFold` への委譲

`nisaHistoryFold` の入力行は `{year, tsumitate, growth, soldTsumitate, soldGrowth}`。**月次 delta を年でグループ化して合計すると、そのまま履歴行の形になる**。

```
nisaLedgerFold(rows, currentYear):
  1. rows（月次 snapshot）から period の年を取り出す（YYYY-MM-01 の先頭4桁・不正は捨てる）
  2. 年別に nisa_tsumitate_delta / nisa_growth_delta / nisa_tsumitate_sold_at_cost /
     nisa_growth_sold_at_cost を合計 → {year, tsumitate, growth, soldTsumitate, soldGrowth}
  3. year >= NISA_MIN_YEAR(2024) のみ残す（NISA 開始前・課税のみの年は NISA delta が0ゆえ捨てて同値）
  4. 年昇順に整列し nisaHistoryFold(rows, currentYear) に委譲 → 5スカラー
```

**これが設計の核**。制度モデル（①当年売却は生涯枠から非控除＝復活は翌年1/1 ②過去年売却は控除済み ③売却を枠別に持つ＝成長内数1200万 cap を正しく戻す）を**二重実装しない**。`nisaHistoryFold` は既に JS↔Py 鏡像で fixture 固定済みゆえ、制度ロジックのドリフトが構造的に起きない。

**ガード**＝`period` が不正・年が域外（<2024 / >9999）・行が object でない・数値が非有限 → 捨てる（`num()` 経由で非負化）。年数は現実的に上限50（`NISA_HISTORY_MAX`）を超えないが、防衛的に `slice` する。

### 3.3 ledger 行の届け方（state の外にあるデータ）

`nisaDerive` は state しか受け取らないが、snapshot は state の外にある。**既存の cashflow が同じ問題を解いている**：

- JS: `modeAFacts(rawState, opts)` の `opts` に行を載せる／`cashDerived(_cashflowRows, _investmentRows, anchor, nowMs)` は既に行を受け取る
- Py: `mode_a_facts(raw_state, include_raw, now_ms, cashflow=None)` ＋ `advice.py:1404` が `SELECT ... FROM me.cashflow_snapshots`

同じ轍に乗せる：

| | 変更 |
|---|---|
| JS | `nisaDerive(state, nowMs, rows)` / `nisaEffective(n, currentYear, rows)` / `nisaViewModel(state, cd, nowMs, rows)`。呼び出し元 `money.js:1556` は保持済みの `_investmentRows` を渡す |
| Py | `_nisa_derive(s, now_ms, rows)` / `_nisa_effective(n, year, rows)`。`mode_a_facts(..., investment=None)` に第5引数。`advice.py` が `me.investment_snapshots` を SELECT（既存 endpoint＝**Vercel 関数は増えない**） |

**Py 側を欠いてはいけない**。欠くと ledger モードで Py が `configured=false` を出し、`facts.nisa` がキーごと消えて **AI 規律コーチに「NISA枠を全く使っていない」と嘘をつく**——Stage2 が `configured` を source 別にして防いだ、まさにその嘘（money-rules.js:498-500 のコメント）。

第3引数は**省略可能**（既定 `[]`）＝manual/history モードの既存呼び出しはバイト不変。

---

## §4 既存コードの「破れ穴」3件

Stage2 は暗黙に「非 history ＝ manual」を前提にしている。ledger を第3の source として足すと意味が破れる箇所が3つある（理解フェーズ wf が実測）。

### 4.1 `configured`（money-rules.js:501-504 / advice.py:940-945）

現状 ledger は else 枝（manual スカラー判定）に落ちる。ledger の実データは manual スカラーを埋めないので、**`source:'ledger'` は永久に `configured:false`**＝`facts.nisa` が消える。

```js
// 変更後
var configured = stored.source === "history" ? stored.history.length > 0
               : stored.source === "ledger"  ? rows.length > 0
               : (stored.anchorYear > 0 || ... );
```
判定は `n`（effective）でなく **`stored` を見る規律**を維持。`rows.length > 0`＝「台帳が配線済み」。台帳に行はあるが全て課税口座なら `facts.nisa` は全0で出る——これは**正しい**（「NISA枠が丸々空いている」は規律コーチにとって有意味な事実）。コメント（:498-500）の「'ledger'（Stage3・未実装）は当面 manual と同じ枝」も更新する。

### 4.2 `staleAnchorYear`（money-rules.js:527 / advice.py:969）

```js
staleAnchorYear: n.source !== "history" && now.valid && n.anchorYear > 0 && n.anchorYear < now.year
```
`!== "history"` ゆえ **ledger でも古アンカー警告が出得る**（`anchorYear` は素通しされるため）。ledger は自動導出でアンカー概念が無く、年ロールオーバーは自動解決する。

→ **`=== "manual"` へ変更**。Stage2 が history に対して下した判断（「年ロールオーバーが自動解決＝誤警報にしない」＝§11-4）と同じ理由。

### 4.3 `reconcile`（money-rules.js:606-612・UI専用/Py鏡像不要）

```js
available: d.n.source === "history" && (d.stored.tsumitateLifetime + d.stored.growthLifetime) > 0
```
ledger では消える。→ **`(source === "history" || source === "ledger")` へ広げる**（§11-6）。

ledger では reconcile の**意味が変わる**：手入力の生涯簿価残（参照値）vs 台帳からの導出値の差＝「手入力では800万と言っていたが台帳からは750万しか出ない＝**50万分の取引が台帳に未記録**」という**データ完全性チェック**になる。サイレントに枠が過少表示されるのを防ぐ。文言は source 別に出し分ける。

### 4.4 その他（UI 出し分け）

- `nisaAvailableYears`（:576）／年 select＝ledger では無意味 → 非表示
- `setNisaSource`（money.js:366-384）＝ledger は**初回転記なし**（台帳が源）。manual スカラーは**消さない**（可逆＋reconcile の参照値＝Stage2 と同じイディオム）
- **ledger トグルは loggedIn 時のみ選択可**（fail-closed）。台帳は認証の向こう側にあり、未ログインでは行が0＝`configured:false` になるため。既に ledger かつ未ログインなら「ログインすると台帳から自動導出されます」と表示（¥ readout gate とは別の、入力源の可用性ゲート）

---

## §5 データフロー（全体）

```
Notion「投資取引」DB（口座区分 select 3値・必須）
  │
  ▼ scripts/etl_investment.py（GHA investment-pull.yml・workflow_dispatch）
  │   build_investment: 日付昇順・(ticker × 口座区分) 単位の移動平均
  │   → per-period delta（既存4列 + NISA 4列）+ holdings（口座タグ付き）
  ▼
me.investment_snapshots
  │
  ├─[JS] money.js: GET /api/me/investment → _investmentRows
  │        → nisaDerive(state, nowMs, rows)
  │           → nisaEffective: source==='ledger' → nisaLedgerFold(rows, year)
  │              → 年別集計 → nisaHistoryFold へ委譲 → 5スカラー
  │                 → 下流（各Pct/over/ETA/facts/coarsen/VM）は**全て無改修**
  │
  └─[Py] advice.py: SELECT ... FROM me.investment_snapshots
           → mode_a_facts(state, include_raw, now_ms, cashflow, investment)
              → _nisa_derive(s, now_ms, rows) → 鏡像
```

---

## §6 エラー処理

| 層 | 方針 |
|---|---|
| ETL | **全て loud-fail**（`SystemExit("ETL ABORT: …")`）。欠落/rename/型崩れ/口座区分の空や未知値/売却の数量欠落/取得失敗。garbage を格納したら読み手の degrade では守れない |
| `api/me/investment.py` | 読取失敗・テーブル未適用は `investment: []` で degrade（既存挙動・維持） |
| `nisaLedgerFold` | 不正行は捨てる（純関数＝例外を投げない）。行0 → 5スカラー全0 かつ `configured:false` → `facts.nisa` 省略 |
| `advice.py` の SELECT | 失敗は `investment=[]` で degrade（cashflow の既存型と同じ＝投資読取失敗が助言全体を落とさない） |

---

## §7 パリティと契約

### 7.1 SCHEMA bump は不要

- `FACTS_SCHEMA_VERSION`（money-rules.js:15 / advice.py:30）＝**5 据え置き**。facts の形状が変わらないため。判断基準は「新キー追加＝bump／**入力源の差替だけなら bump しない**」（Stage2 が `tests/money-rules.test.js:1558-1559` で機械証明済み）。
- `RULES_VERSION`（advice.py:31）／`CURRENT_VERSION`（money-rules.js:11）＝**据え置き**。state 形状が変わらない（`nisa.source` の `'ledger'` は既に `NISA_SOURCES` にあり `normalizeNisa` が coerce 済み）。
- **`coarsen_facts` は改修不要**。`advice.py:1288` の NISA 明示走査は `*UsedPct` をキー名で粗化し enum/bool は透過・`source` は非粗化＝`source:"ledger"` はそのまま通る。
- **ALLOW/DENY 更新も不要**（新キーなし）。

### 7.2 鏡像を同時に変える箇所

| # | money-rules.js | api/me/advice.py |
|---|---|---|
| 1 | `nisaEffective`（:482 ledger 枝） | `_nisa_effective`（:923） |
| 2 | `nisaLedgerFold`（新規） | `_nisa_ledger_fold`（新規） |
| 3 | `nisaDerive`（:494 第3引数＋`configured`:501＋`staleAnchorYear`:527） | `_nisa_derive`（:934 / :940-945 / :969） |
| 4 | `modeAFacts`（:1077 opts に rows） | `mode_a_facts`（:1031 第5引数）＋ SELECT 追加 |

`nisaViewModel`（:584）／`reconcile`（:606）／`setNisaSource`（money.js:366）は **JS のみ**（UI 専用・Py 鏡像不要）。

### 7.3 num/_num scalar coerce パリティ

`nisaLedgerFold` の入力は API 由来の JSON（Py は Neon の `Decimal`）。両言語とも既存の共有 scalar coerce（`num` / `_num`・ASCII decimal regex）を通す。`api/me/investment.py:_num` が `Decimal` を int/float に落とす既存経路を維持。**分母に載る値は無い**（fold は加減算のみ）ため §10 の num 非対称リスクは Stage1 より小さい。

---

## §8 テスト（RED-first）

### 8.1 検証3点セット
- `node --test 'tests/*.test.js'` 全緑（**末尾スラッシュ不可**＝`node --test tests/` はこの環境で `Cannot find module tests`）
- `PYTHONPATH=api/me .venv/bin/python -m pytest tests/ -q` 全緑
- parity fuzz `mismatches:0`（`genNisa` に ledger rows 生成器を追加）

### 8.2 `tests/test_etl_investment.py`（新規・`test_etl_cashflow.py` と同型）
`importlib.util.spec_from_file_location` で `scripts/` から直ロード。純関数のみ（network/DB 非依存）：
- loud-fail：空 / 必須プロパティ欠落 / 型崩れ / **口座区分が空** / **口座区分が未知値** / 売却の数量欠落 → `SystemExit`
- `source_hash` の**ページ順非依存**（holdings ソートの証明）
- write-only-good-rows（権威フィールド全 None → 格納しない）
- `_i` の None/不正 → 0
- 移動平均が **(ticker × 口座区分) 単位で独立**（同一銘柄を NISA成長 と 課税 で持ち、片方の売却が他方の avg_cost を汚さない）
- 期初保有×NISA が「日付」の年の拠出として計上される
- 配当が `nisa_*_delta` を動かさない
- 戦略区分と口座区分の**直交**（1購入が `principal_core_delta` と `nisa_growth_delta` の両方に載る）

### 8.3 fold の fixture（`tests/fixtures/advice_facts_cases.json` に追加・期待値は手書き）
- `nisa-ledger-a` 行0 → `configured:false` → `facts.nisa` **省略**（production/personal 両方）
- `nisa-ledger-b` 課税のみの行あり → `configured:true` かつ全 `*UsedPct:0`（「枠が丸々空いている」を正しく言う）
- `nisa-ledger-c` 当年つみたて満額 → `annualTsumitateUsedPct:100`
- `nisa-ledger-d` 成長内数 cap 到達 → `growthCapUsedPct:100` / `growthCapRoomRemaining:false`
- `nisa-ledger-e` 当年売却あり → `hasRestorationPending:true` / `restoresYear = 年+1`（**生涯枠から非控除**）
- `nisa-ledger-f` 過去年売却あり → 生涯枠から**控除済み**（Stage2 の制度モデルが委譲経由で効いている証明）
- `nisa-ledger-g` adversarial-coercion（period 不正/年域外/非有限/配列）→ 捨てる
- `nisa-ledger-h` **`nisaLedgerFold` と `nisaHistoryFold` の同値性**＝同じ年別実績を history 入力と ledger 入力で与えると5スカラーが一致（委譲の機械証明）

### 8.4 破れ穴の回帰テスト
- `staleAnchorYear` が ledger で **false**（`anchorYear` が過去でも）
- `reconcile.available` が ledger かつ手入力生涯簿価残ありで **true**、手入力ゼロで false
- manual/history の既存 fixture が**バイト不変**（第3引数が既定 `[]` で既存呼び出しに影響しない）

### 8.5 UI/実機
- Playwright smoke：ledger トグルが未ログインで選択不可・pageerror 0・`<details>` open 保持（`money-js-render-focus-details-restore` の機構を壊さない）
- **本人実機サニティ**（GPU 依存の glow/glass は headless 非 authoritative）

### 8.6 whole-branch 敵対検証 wf（ultracode・merge 前）
観点＝①制度モデルの委譲が本当に等価か（`nisaHistoryFold` 経由で当年/過去年売却の非対称が保たれるか）②JS↔Py 鏡像パリティ（byte 一致）③ETL の loud-fail が silent degrade に緩んでいないか ④責務境界の越境（ETL が累積を計算していないか）⑤既存 manual/history のバイト不変（cf-1 相当の非破壊）⑥facts 生¥非漏洩の不変 ⑦口座区分の未知値・移動平均の口座混線。

---

## §9 受入基準（データ0での「完成」）

1. 合成 fixture で fold・ETL 純関数・loud-fail が全緑（§8）
2. **Notion に使い捨てテスト行を数行入れ `--dry-run`（DB 非接続）で ETL を回す**＝実プロパティ名・実 select 値・移動平均・枠別 delta までを実データ構造で実証 → テスト行を削除。**本番 Neon には一切書かない**
3. `db/migrations/` の SQL は用意するが**適用は初購入前の任意タイミング**（`.vercelignore` ゆえ自動適用されない・DEFAULT 0 で既存0行に安全）
4. GHA は `workflow_dispatch` のみ（`schedule` はコメントアウト）
5. merge 前に whole-branch 敵対検証 wf（§8.6）

**明示的に受入基準に含めないもの**＝実 Notion→本番 Neon→API→UI の e2e（データが無いため原理的に不可能・初購入後に実施）。

---

## §10 リスク

- **制度モデルの二重実装**→ `nisaHistoryFold` 委譲で構造的に回避。§8.3 `nisa-ledger-h` が同値性を機械証明。
- **Py 側 SELECT の欠落** → ledger モードで facts.nisa が消え AI コーチに嘘。§4.1 のテストで担保。
- **口座区分の silent 既定化** → 空を「課税」扱いすると NISA 枠が静かに過少計上。ETL loud-fail で禁止。
- **移動平均の口座混線** → 同一銘柄を NISA と課税で持つと簿価が混ざる。粒度 `(ticker × 口座区分)` ＋ §8.2 のテスト。
- **手数料を枠消費に含める誤り** → 枠は約定金額のみ。§1-9 に固定。
- **holdings 形状変更の破壊** → 読み手ゼロ（`investmentDerived` は holdings を読まない・api は素通し）＝リスクほぼ無し。ただし将来 Slice5 が前提にするため spec に形を固定。
- **root `requirements.txt` 汚染** → ETL は `urllib` のみで書く。追加依存が要るなら `scripts/requirements.txt` と GHA の `pip install` 行だけ。
- **ETL 失敗ドメインの混線** → 別ファイル・別 concurrency group。
- **既存 compare-search inline onclick XSS**（detail.js:47/81・未修正）→ 新規 UI は委譲/textContent で書き同じ轍を踏まない。
- **台帳0件ゆえ e2e 未検証** → §9-2 の Notion dry-run で「実プロパティ名の rename/共有漏れ」だけは初購入前に潰す。残余リスク（Neon 書込・UI 描画）は初購入時の手動サニティに送る（spec に明記）。

## §11 Non-goals（本spec）

- **C**＝`investmentDerived` の viewModel 配線／`investmentSource` 二軸トグル UI／**Mode A 投資 facts**（principal/realized の鏡像パリティ）。別spec（§0.2）。
- Stage4＝口座振り分け助言（層2・personal gated・要 Vercel 関数上限＋法務 precondition）。
- Slice5＝時価接続（holdings × 最新 price）。
- iDeCo・旧NISA（2023以前）＝口座区分の4値目以降。現在保有0ゆえ YAGNI。
- 為替／評価損益／配当課税シミュレーション（枠＝簿価トラッキングに限定）。
- `schedule` cron の有効化（初購入後）。

---

## 決定ログ（ユーザー確定・ブレスト 2026-07-17）

1. **台帳の現況＝0件（購入前）**（※確定・実測の起点）
2. **スコープ＝A+B+D のみ**、C は別spec（※確定）
3. **口座/枠＝「口座区分」select 1つ・3値**（不整合を構造的に作れない観点）（※確定）
4. **snapshots＝数値列4つを追加**（既存 per-period delta イディオムとの同型性の観点）（※確定）
5. **検証＝fixture ＋ Notion 一時行で `--dry-run`**（Neon 無傷で鎖を実証できる観点）（※確定）
6. **reconcile を ledger にも広げる**（記帳漏れ検出という ledger 固有の価値の観点）（※確定）
7. **期初保有×NISA＝「日付」に実取得日を入れる運用**（年別拠出が正確になる観点）（※確定）
