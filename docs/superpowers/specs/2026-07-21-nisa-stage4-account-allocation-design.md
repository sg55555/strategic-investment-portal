---
date: 2026-07-21
project: investment-portal
backlog: "B #3 NISA枠 — Stage4（口座振り分け助言 / tax-location・層2 personal gated）"
規制フレーム: 2層必須（[[strategy-personal-finance-advice-intent]]）＝層1公開・決定論・教育／層2本人専用・server・ADVICE_MODE=personal gated。本specは層2（最も踏み込む類型）。
前提: decision-complete（ユーザー確定済み・§15決定ログ参照）。着手前に understand 7次元＋feasibility 5次元＋self-review 4観点の計3wf（840k+579k+467k tok）で実装・制度・整合を実測。
related: 2026-07-16-nisa-quota-design.md, 2026-07-17-investment-ledger-foundation-design.md, 2026-07-07-phase2-bundleD-layer2-personal-insight-design.md, 2026-07-14-asset-class-ratio-design.md
改訂履歴:
  - 2026-07-21 初版（ブレスト確定→spec化。2wf実測で「商品名を出す＝適格判定データ基盤の創設が前提」と判明しStage4を4a/4bへ段階分離）
  - 2026-07-21 self-review wf（4観点34件）反映＝blocker6件（FSA形式/ETF除外判定/_nisa_derive参照3制約/plan過大/gate順序/tsumitate捏造盲点）＋important主要を解消。plan分割・gate通過後dispatch・統一id名前空間・coarsen生¥leaf粗化・層分離厳守を確定。
  - 2026-07-21 writing-plans wf 実測反映＝§6を**逐語複製＋パリティテスト**に確定（insight.py:254規約準拠・共有モジュール案を撤回）。§3.1成長枠ETF判定を imaj_listed 銘柄コード突合＋決算回数（毎月分配）で精緻化。§3.7の (b)ETF除外・(c)制度モデルを実データで解消（(a)FSA構造も3シート判明・列詳細のみ残）。
---

# NISA口座振り分け助言（tax-location）— Stage4 / B#3 層2 設計書

## §0 目的と戦略文脈

`2026-07-16-nisa-quota-design.md`（B#3）§8 段階構成の **Stage 4＝口座振り分け助言（tax-location）**。Stage1-3（層1フル＋台帳連携）は本番LIVE済み。本specは **層2（本人専用server・personal gated）** で、「**どの資産を NISA口座（つみたて枠／成長枠）に置き、どれを課税口座に置くか**」を、本人の実NISA残枠と**適格な実在商品**に接地して助言する。芯は規律・教育＝「非課税枠という希少資源の割当」意思決定支援。

**助言対象は「新規資金の振り分け」のみ**（台帳0行＝まだ初購入前の実態に整合）。既存保有の口座間移し替え（＝売却してNISAで買い直し）は売却指示に踏み込み規制/設計規模が段違いゆえ**非スコープ**（§13）。

**3wf実測で確定した設計の要**：
1. **商品名を出す＝NISA適格性を判定できるデータ基盤の創設が前提**（現ユニバースは type=`stock|etf` の2値のみ・つみたて対象投信0件・適格判定列なし＝商品名を出すには捏造しか手段がない）。
2. データ基盤(4a)は**公開データのみ・完全 inert・規制に触れない**。助言(4b)だけが助言領域。**段階を切ればリスクを綺麗に隔離**でき、4a は単独で本番投入・SQL検証まで完結。
3. 捏造ガードの核＝**LLMに商品名をプロースで書かせず、構造化ID配列でのみ参照させ、突合をNERでなく exact set-membership に還元**する（日本語ファンド名NERがコードに不在）。

**規制安全**：NISA口座配置助言は金商法上**最も踏み込む登録リスク類型**。本人利用・無償・非公開・教育の4本柱＋`ADVICE_MODE=personal` gate＋**独立killswitch既定OFF**が登録不要の技術的担保。他者提供/課金の前に金商法レビュー必須（hard precondition）。

## §1 確定事項（製品判断・変更不可）

| # | 論点 | 確定 |
|---|---|---|
| 1 | 助言対象 | **新規資金の振り分けのみ**。既存保有の移し替え・売却指示は非スコープ（出力側でも negative constraint＋セマンティックガードで担保・§4.4）。 |
| 2 | endpoint配置 | **`api/me/insight.py` に相乗り**（`kind='nisa_allocation'` 判別・**3ゲート通過後にdispatch**）。実測11関数→**11/12維持**（新規handler .pyを足さない）。 |
| 3 | 商品名 | personal では**含める**。そのため**NISA適格判定データ基盤を創設**（Stage4a）。プロースには書かせず ID参照＋描画層join。 |
| 4 | 法務レビュー | **inert先行**（production 403固定・killswitch無効でコードだけ先に作る）。personal有効化は本人利用の4本柱で登録不要圏。他者提供/課金の前に金商法レビューを hard precondition として置く。 |
| 5 | killswitch | **独立env `NISA_ADVICE_ENABLED`（既定OFF）**。NISA助言だけを即時停止でき advice/insight は生存。 |
| 6 | 既存 silent degrade | **この機会に潰す**が、**独立 plan0 として先行**（Stage3残の既存バグ＝NISA助言と無関係ゆえ blast radius を分離）。 |
| 7 | 監査ログ | **`me.nisa_log` 新設**（`insight_log`流用不可）。coarsen粗化・personalは ai_response/生¥永続化しない・rate/cooldown独立。 |
| 8 | 決定論アンカー | **facts非出力・制度モデルleafを読む**（SCHEMA_VERSION据置）。制度モデルは**insight.py へ逐語複製**し advice.py↔insight.py パリティテストでドリフト防止（§6・既存 me/ 規約 insight.py:254 準拠）。 |
| 9 | US個別株166・ETF18 | **`conditional`注記付きで候補に出す**（証券会社取扱い依存・単一公開ソースなし）。注記は**描画層でstatus列根拠に強制注入**（プロンプト依存にしない・§4.5）。 |
| 10 | 4b入力源 | **`me.mcc_state` の NISA残枠を読む**（本人実枠に接地）。insight.py が初めて個人資産stateを読む結合＝me.nisa_log の coarsen で PII 担保。 |
| 11 | JP監理・整理 | 当面 **「JP個別株=一律`eligible`」割り切り**（現該当0件で真）。`nisa_source`列に根拠記録・将来JPX差込余地。 |
| 12 | つみたて信託報酬 | **MVPは信託報酬なし**。**将来タスクとして確実に記録**（§14）＝コスト順位付けは別フェーズ。 |
| 13 | 出力の商品名 | **プロースから剥がし、統一id名前空間の `refs:[id]` でのみ参照**。表示名は描画層が id→name join（LLMは表示文字列を出さない）。 |

## §2 全体アーキ — 規制リスクで段階分離＋plan分割

Stage4 は**3つの独立 plan** に割る（Stage1/2/3 も各独立planだった。1ブランチに規模15-19タスク・デプロイ2回・規制posture2種を同居させない）：

| plan | 成果物 | 規制 | 依存/順序 |
|---|---|---|---|
| **plan0** 既存穴 | §5 silent degrade 修正（NISA4列migration本番適用＋列不在/0件分岐＋configured診断軸） | 非該当（既存バグ） | 独立先行・NISA無関係・小PR |
| **plan A** = Stage4a データ基盤 | 適格判定テーブル2本＋取込3スクリプト＋migration（§3） | **非該当**（公開データ・inert） | plan0 後・SQL検証で単独完結 |
| **plan B** = Stage4b 助言endpoint | insight.py kind分岐・personal-gated・killswitch・me.nisa_log（§4） | 助言領域（**inert先行**） | plan A 完了に依存（4bクエリが4aテーブルを読む） |

## §3 Stage4a（plan A）— 適格判定データ基盤（inert・公開データ・規制非該当）

### §3.1 データモデル①: `ticker_master` 列追加（成長投資枠・ティッカーあり）

既存292銘柄（JP/US/ETF＝ティッカー・価格系列あり）に成長枠適格性を付与。`db/migrations/` に **`ADD COLUMN IF NOT EXISTS`＋DEFAULT**（既存0影響・後追い安全）。

| 列 | 型/値域 | 意味 |
|---|---|---|
| `nisa_growth_status` | text: `eligible`｜`excluded`｜`conditional`｜`unknown`（default `unknown`） | 成長枠適格性 |
| `market_alert` | text: `none`｜`supervision`｜`liquidation`（default `none`） | 東証アラート |
| `nisa_source` | text（default `''`） | 判定根拠 |
| `nisa_checked_at` | timestamptz（default null） | 判定鮮度 |

**判定ルール（`refresh_nisa.py`・実データで確定済み・universe.csv 289件＝JP105/US184・stock266/etf23）**：
- **JP個別株**（stock/JP）→ `eligible`（`nisa_source='jp-negative-list'`・監理整理は現該当0＝§1-11。将来 `market_alert!=none` なら `excluded`）。
- **US個別株・USETF**（US全184）→ `conditional`（`nisa_source='us-broker-conditional'`・成長枠取扱いは証券会社依存）。
- **JP ETF**（5件：1306/1321/1343/1348/2558.T）→ 投信協会 成長枠上場対象リスト（`imaj_listed.xlsx`・419本）に**銘柄コード突合**で該当すれば `eligible`（`nisa_source='imaj-listed'`）、非該当は `unknown`。
- **レバレッジ/インバース/毎月分配 ETF** → `excluded`。**実測で現ユニバースETF23件に該当0**（全て通常インデックス/セクターETF）＝空集合で真。将来混入に備え name パターン（`レバレッジ|インバース|ブル|ベア|ダブル|2倍|日々|毎月`）でガードし該当を `excluded`（`nisa_source='etf-rule-excluded'`）。毎月分配は投信協会リストの「決算回数」列で機械判定可（§3.4）。
- 判定不能 → `unknown`（安全側）。

### §3.2 データモデル②: `market.nisa_tsumitate` 新テーブル（つみたて投資枠・ティッカーなし）

つみたて対象投信（金融庁公表・約360本＝**証券コードなし・価格系列なし**）。**`ticker_master`/`ohlcv`/screener 経路に混ぜない**（PK=ticker・投信は証券コード無し）＝別テーブルで完全分離。

| 列 | 型 | 備考 |
|---|---|---|
| `id` | serial PK | 内部ID。§4.3の `ts:<id>` refs 参照先 |
| `fund_name` | text NOT NULL | ファンド名。**UNIQUE制約**（§3.4-2 ON CONFLICT対象・再取込でserial振り直しを防ぎrefs参照先を版間安定化） |
| `mgmt_company` | text | 運用会社 |
| `category` | text: `index`｜`active`｜`etf` | 区分（指定インデックス286＋アクティブ等65＋ETF9） |
| `index_name` | text null | 対象指数 |
| `domestic_foreign` | text null | 国内/海外/内外 |
| `fund_code` | text null | 協会コード（IMAJ left-join補完・null許容） |
| `etf_ticker` | text null | ETF区分のみ |
| `list_updated_at` | date | FSAリスト改定日（セル日付シリアル由来・版管理） |
| `nisa_source` | text | `fsa-tsumitate-xlsx` |

**信託報酬列は持たない**（§1-12・将来 §14）。**自然キー=`fund_name`（fund_code非null時は fund_code 併用）に UNIQUE**、`ON CONFLICT(fund_name) DO UPDATE` で既存 serial を保持（refs参照安定）。

### §3.3 ETL書き手分離（絶対・GHAクロバー防止）

NISA列/テーブルは**専用updaterのみ**が更新。既存GHA（`market-refresh`）の書き手にNISA列を**足さない**：
- `refresh_market.py` の `UPDATE ... SET market_cap,per,pbr` にNISA列を足さない。
- `seed_universe.py` の `ON CONFLICT ... SET(...)` にNISA列を足さない。
- 根拠＝financials `source='edinet'` 保護と同型。さもないと平日日次 market-refresh がNISA判定を毎回クロバー。

### §3.4 取込スクリプト（urllib+openpyxl・yfinance非依存・非破壊upsert・`seed_universe.py`同型）

1. **`scripts/refresh_nisa.py`**（成長枠フラグ）：292銘柄を market/type で走査→§3.1判定→`ticker_master` のNISA列のみ UPDATE。JP監理整理は当面空集合（将来 JPX差込点をコメント明示）。
2. **`scripts/refresh_nisa_tsumitate.py`**（つみたて）：FSA index ページ取得→最新xlsxリンクを regex抽出→openpyxl で3シート正規化→`market.nisa_tsumitate` に `ON CONFLICT(fund_name)` upsert。**loud-failガード必須**（想定シート名／本数レンジ＝構造変更で無言破損を防ぐ）。**取込形式の詳細は §3.7-a で実データ確定**。IMAJ 直リンクを `fund_name` left-join で `fund_code`/`etf_ticker` 補完（FSA完全性が権威＝IMAJはコード補完のみ）。
3. **ETF接地スロット化**（4bクエリ側の設計・§4.3）：接地を `ORDER BY market_cap top80` に依存させず、`type='etf' AND nisa_growth_status IN('eligible','conditional')` を**専用スロットで UNION 露出**。**AUMで market_cap を上書きしない**（JP ETFのAUMは円建てで巨大＝既存stock順位を乱す）。AUMバックフィルは任意（`market_cap`を汚さない専用`aum`列・§14）。

### §3.5 マイグレーション

`db/migrations/2026-07-21-nisa-eligibility.sql`（`ADD COLUMN IF NOT EXISTS`＋`CREATE TABLE IF NOT EXISTS market.nisa_tsumitate`＋UNIQUE）。`.vercelignore` が `*.sql` 非配信ゆえ**手動適用**（Stage3同運用）。

### §3.6 検証（inert・LLM/個人state不要）

- `SELECT distinct nisa_growth_status` → JP stock=eligible／US=conditional／該当ETF=excluded。
- `market.nisa_tsumitate` 取込行数がガードレンジ内・`list_updated_at`=セル日付・再取込で serial 不変（UNIQUE upsert）。
- **GHA market-refresh 実行後もNISA列が保持される**（書き手分離）ことをSQL確認。
- ここまで単独で本番投入し検証可能（規制露出ゼロ）。

### §3.7 実データ確定状況（writing-plans wf で実測・穴を推測で埋めない）

feasibility＋writing-plans wf で下記を実測。**(b)(c) は解消済み**、(a) は構造判明・列詳細のみ実装plan Task に残す：
- **(a) FSA取込形式（構造判明・列詳細のみ残）**：`scratchpad/nisa_shisan.xlsx`（つみたて枠対象・金融庁公式）＝3シート確定＝「指定インデックス投資信託」(286本・rows≈294)／「指定インデックス投資信託以外の投資信託（アクティブ運用投信等）」(rows≈72)／「上場株式投資信託（ETF）」(9本・rows≈16)。**r0-r3 はメタ行**（r0=日付シリアル 46219＝Excel serial／r1=金融庁／r2=タイトル／r3=本数）＝**実データ列ヘッダは r4以降**。実装plan Task で r4以降の列名→フィールド対応（fund_name/mgmt_company/index_name/domestic_foreign/etf_ticker）と `list_updated_at`（r0 の 46219 を date 変換＝2026年頃）を確定。loud-failレンジ＝インデックス260-320本／アクティブ50-90本／ETF5-15本。**xlsx取得元URL**＝FSA「つみたて投資枠対象商品」ページ（indexページを毎回スクレイプし日付付きリンク抽出）。
- **(b) ETF除外判定（確定・解消）**：現ユニバースETF23件はレバ/インバ/毎月分配**該当0**（全て通常インデックス/セクターETF）＝空集合で真。将来ガードは §3.1 の name パターン。
- **(c) 制度モデル方式（確定・解消）**：共有モジュールでなく**逐語複製＋パリティテスト**（§6・§15決定）＝Vercel関数計上リスク回避。

## §4 Stage4b（plan B）— 口座振り分け助言 endpoint（personal-gated）

### §4.1 `insight.py` 相乗り（kind分岐・11/12維持・**gate通過後dispatch**）

`kind='nisa_allocation'` を追加。**冒頭分岐は禁止**（nisa経路が403前に走ると production 貫通）。do_POST のゲートを固定順で通過後にのみ dispatch：
1. `_valid_session`（未認証→401）
2. `ADVICE_MODE != personal` → **403**（production はここで遮断＝killswitch評価前・状態を探れない）
3. `NISA_ADVICE_ENABLED` OFF/未設定 → **capability無効**（§4.2）
通過後に nisa_allocation ハンドラへ dispatch。**テストで「production は killswitch評価前に403」を固定**。新規handler .pyなし＝11/12維持。

### §4.2 三重ゲート（fail-closed・capability論理積）

`session.py` が返す capability＝`nisaAdviceEnabled = (ADVICE_MODE==personal) AND (NISA_ADVICE_ENABLED ON) AND (有効セッション)` の**論理積**。**productionで常にfalseをテスト固定**。UIはfalseで最初から非描画（endpoint消費なし）。killswitch OFF/未設定＝**capability非描画**（403でなくUIに出さない・§4.7の決定論描画とは**別物**）。

### §4.3 入力（facts.nisa残枠 + eligible_products）

- **NISA残枠 facts**：`me.mcc_state`→制度モデルleaf（残枠スカラー）を取得。**取得方式は insight.py へ逐語複製した `_nisa_derive`**（§6・「同ファイル内取得可」「共有モジュール」案はいずれも撤回）。NISA未設定（facts.nisa None＝mcc_stateにNISA設定なし）時は**残枠依存の順位付けを出さず** §4.7 decへ分岐。
- **eligible_products**（サーバ構築・決定論）：
  - **統一id名前空間**：`ts:<serial>`（つみたて）／`gw:<ticker>`（成長）のプレフィックス付き str（int/str混在解消・種別跨ぎ衝突を原理的に不能化・kind整合検査を全域化）。
  - つみたて＝`market.nisa_tsumitate`／成長＝`ticker_master WHERE nisa_growth_status IN('eligible','conditional')`＋ETF専用スロット（§3.4-3）。
  - 形＝`[{id, kind:'tsumitate'|'growth', name, mgmt_company|ticker, category|index_name, market, status}]`。
  - **cap確定**：token予算超過時は**決定論的截断順序**（つみたて=category(index→active→etf)→fund_name昇順／成長=market(JP→US)→ticker昇順）でcap。cap値は定数。**截断時は「全適格商品ではない」非網羅性注記を出力必須**（§4.5 cautions）。

### §4.4 接地・捏造ガード（多層・tsumitate構造一本化・売却negative constraint）

制度事実（§8）と適格リストは**サーバ与件**。LLMは判定・発明しない（「金額はサーバ与件のみ」を「適格性・商品名」へ横展開）：

> 「商品は eligible_products の id でのみ参照し、リストに無い商品名/ティッカー/ファンド名を新たに作らない。適格性判定はサーバ与件であなたは判定しない。役割は列挙済み適格商品の順位付けと、つみたて/成長/課税口座の使い分け説明のみ。**既存保有の売却・移し替え・買い直しには一切言及しない（助言は新規資金の配分のみ）**。」

**多層防御**：
1. 出力を構造化し**商品名をプロースに書かせない**（§4.5スキーマ）。
2. parse段で各 `ref∈eligible_ids` かつ **kind整合**（tsumitate_refs は id が `ts:` 始まりのみ・growth_refs は `gw:` のみ）を **exact set-membership** 検証・範囲外/種別違いはdrop（NER不使用）。id自体の捏造は集合非所属で自動drop。
3. **tsumitate捏造の盲点対処（構造側一本化）**：既存 `_security_market_hit`（advice.py:1283・ticker_masterのみ読む）は**投信ファンド名を検出不能**。ゆえに tsumitate 領域は「**refs＋描画層join・proseに商品語を一切書かせない**」を強制し、note内の**固有名詞様トークン（カタカナ長連・「ファンド」「インデックス」＋固有名）を保守的検出→degrade**。検出器（`_security_market_hit`/`_market_terms`）は成長ticker/社名の prose 混入検出に流用（§6の複製禁止は**制度モデル限定**＝検出器は複製可）。
4. **売却negative constraint**：prose に売却動詞（売る/売却/移す/乗り換え/buy back 等）の簡易セマンティックガード→検出時degrade（最上位Non-goalの出力側担保・§13）。`taxable_note` は税務教育に限定。**売却動詞ガードは LLM 生成 prose フィールド（headline／tsumitate_plan.note／growth_candidates.note／taxable_note）のみに適用し、サーバ固定文（newMoneyNote／cautions／conditionalDisclaimer）は走査対象外**とする。理由＝`newMoneyNote` は「売却/移し替え指示ではない」旨の**サーバ注入固定文**ゆえ走査すると必ず自ヒットして恒常degradeする（自己矛盾）／`cautions` は「近く売却予定の資産は非課税枠に不向き」等の**正当な両論注意**が売却語を含みうる（誤degrade）／`conditionalDisclaimer` はサーバ強制注入の免責文。固定文の内容担保はサーバ側で行う。
5. **既保有非考慮の枠付け**：growth候補は既存保有を除外しない（holdings非参照）＝「一般的適格候補・売却を勧めない」注記を付す（de facto移し替え示唆を防ぐ）。
6. do_POST の **personal専用検証パス**（production 403 は外側で不変）。

### §4.5 出力スキーマ・UI描画（cautions必須・new-money免責・文字数確定）

```
{ headline,
  newMoneyNote,              // サーバ注入の固定文「新規資金の配分のみ・売却/移し替え指示ではない」（LLM非生成＝売却動詞ガードと非衝突・§4.4／常に注入ゆえ空にならない）
  tsumitate_plan: { note, refs:[id] },
  growth_candidates: { note, refs:[id], conditionalDisclaimer? },
  taxable_note,              // 税務教育に限定
  cautions:[ ... ] }         // 必須・欠落→parse失敗→degrade
```
- **cautions 必須**（両論の**構造強制**）＝損益通算・繰越控除不可／下振れ時の税務救済ゼロ／外国税額控除不可（US含む時）／cap截断時の非網羅性。欠落は degrade（プロンプト依存にしない）。
- **US conditional 強制**：解決後refに status='conditional' があれば描画層が **conditionalDisclaimer を必ず注入**（省略時degrade・サーバのstatus列根拠＝プロンプト非依存）。
- **per-field文字数（数値確定・コード実効化）**：headline≤60／各note≤240／taxable_note≤240／cautions各≤80。超過は**切詰でなくdegrade**（意味毀損防止）。
- **200レスポンス形**＝`{deterministic, ai, aiStatus, resolvedRefs:[{id,name,mgmt_company|ticker,category,status}]}`（描画層が id→name join するため解決済みrefsを同梱・LLMは表示名を出さない）。
- UI＝nisaSection内（新URL不可＝catch-all rewrite は inert）。`nisaSection` に**DISCLAIMER描画を補完**（現状無い・assetClassSection同型・fail-closed）＋newMoneyNote。¥は loggedIn ゲート。

### §4.6 監査ログ `me.nisa_log`（DDL確定・生¥leaf粗化）

`db/migrations/` に新設（`insight_log`/`advice_log` 流用不可＝無関係列/生保存）：
```
me.nisa_log(
  id serial PK,
  session_hash text NOT NULL,
  created_at timestamptz NOT NULL default now(),
  facts_coarsened jsonb,      -- 生¥leaf は bucket化/除外済み
  ai_response jsonb,          -- personal では NULL 固定
  ai_status text,
  prompt_version text,
  refs_count int,
  degrade_reason text )       -- 180日TTL（コメント明記・cronで purge）
```
- **coarsen拡張（生¥漏洩の穴を塞ぐ）**：既存 coarsen_facts の nisaブロックは `*UsedPct`（比率）しか粗化せず、§4.3が読む生¥leaf（`annualTotalRemaining`/`monthlyToFillGrowth`/`lifetimeRemaining`/成長内数残）を**素通しする**。nisa_logに載せる各¥leafを **bucket化/除外**するルールを coarsen の nisa明示走査ブロックに**列挙追加**（足し忘れ＝生¥漏洩の唯一の穴）。**eligible_products は生ログ非保存**（DDL/コードで固定）。
- rate/cooldown 独立env＝`NISA_RATE_WINDOW_MIN`/`NISA_RATE_MAX_PER_WINDOW`/`NISA_COOLDOWN_SEC`（既定値は実装plan）。`PROMPT_VERSION='nisa-alloc-v1'`／nisa用 `SCHEMA_VERSION`／`max_tokens`（insightは1000固定＝nisa用に別割当）。

### §4.7 degrade・決定論フォールバック（層分離厳守）

- **決定論版は §8教育原則のみ・商品名を含まない**（money.jsは両URL配信の**層1公開クライアント**＝360本の動的適格リスト[=層2 personal]を静的常駐に載せない）。**適格リストは personal-gated endpoint の eligible_products 経由に限定**。
- degradeトリガー＝**killswitch ONで実際にendpointを叩いた後の** LLM失敗/refusal/filter/cooldown/突合失敗/**NISA未設定（残枠不明）**。**killswitch OFF/未設定は§4.2 capability非描画**（degradeでない＝二重定義を解消）。
- 突合失敗/未設定時＝免責つき§8教育原則の決定論描画（残枠依存の順位付けを出さない）。`insight.py` の `DETERMINISTIC_FALLBACK`（ハンドラ未呼出のデッドコード）はコピーせず、money.js 常駐文言に委ねる。

## §5 plan0 — silent degrade 修正（既存の穴・独立先行）

Stage4と独立に既に本番で起きている穴（Stage3残・NISA助言と無関係）を**独立小PRで先行**（blast radius分離）：
- **NISA 4列 migration（`2026-07-17-investment-nisa-columns.sql`）を本番適用**。
- `investment.py`/`advice.py` の SELECT except を**「列不在（UndefinedColumn）」と「0件」で分岐**し、`configured` 判定に**「列/テーブルが正常か」の診断軸を1本追加**して可視化。
- **正確化**：Stage4b の**助言ロジックは holdings 個別行を読まず新規資金配分のみ**。ただし残枠スカラーは過去のNISA消化（ledger/history由来）に依存する（「holdings完全非依存」でなく「holdings個別行非参照」が正確）。

## §6 決定論アンカー・制度モデル複製・パリティ方針

- **制度モデル（当年売却非控除・翌年復活・成長内数cap・残枠算出＝`_nisa_derive` 依存木）は既存 me/ 規約に従い insight.py へ逐語複製**する。実測＝`insight.py:254`「me/ グループ規約で advice.py を逐語複製・cross-file import 回避」＝insight.py は既に `build_facts`/`peer_context`/`facts_hash`/`_valid_session` 等を advice.py から逐語複製済みの**確立パターン**。共有モジュール/cross-import は Vercel 関数計上の不確実性を負うため採らない（§15決定）。
  - **複製サブセット**＝Stage4b が残枠算出に要する最小関数群＝`_nisa_derive` とその依存 `_normalize_nisa`/`_nisa_now`/`_nisa_effective`/`_nisa_history_fold`/`_nisa_ledger_fold`/`_nisa_ledger_year`/`_nisa_year`/`_num`/`_clamp`（advice.py:841-1017 相当）＋残枠射影 `_nisa_raw` 相当。
  - **ドリフト防止＝advice.py↔insight.py パリティテスト**（既存 `tests/fixtures/advice_facts_cases.json` 基盤流用＝同一 state 入力で両者の残枠スカラーが一致することを機械証明）。spec 当初の「単一源」理想は捨てるが、**ドリフト防止という当初意図はテストで維持**。
- **Stage4b は me.mcc_state を読み、複製した `_nisa_derive` で残枠スカラーを算出**（`_nisa_raw` 相当の11フィールド＝`tsumitateThisYear`/`growthThisYear`/`tsumitateLifetime`/`growthLifetime`/`soldThisYearAtCost`/`annualTsumitateRemaining`/`annualGrowthRemaining`/`lifetimeRemaining`/`growthCapRemaining`/`monthlyToFillTsumitate`/`restoresYear`）。insight.py は facts を持たないため facts 経由でなく直接算出。
- **advice.py 側は無改修**（facts 形状不変・SCHEMA_VERSION据置＝Stage2/3の「形状不変で通す」継承）。
- Stage4a データ基盤は JS↔Py パリティ非対象（サーバ専用・純市場データ）。eligible_products 構築・whitelist突合は fixture で担保（§9）。

## §7 規制ガード（4本柱・法務precondition・killswitch）

- **登録不要の技術的担保**＝`ADVICE_MODE=personal`＋セッション認証＋**独立killswitch既定OFF**。production は 403＋denylist 固定。
- **4本柱**＝無償＋本人利用＋非公開＋教育。**教育フレームは補助**（主柱は無償・本人利用・非公開）。
- **hard precondition**（金商法2条8項11号=相手方+報酬要件・28条3項・監督指針VII-3-1）＝他者提供/課金/不特定多数配信/教材IFAバンドルの前に**金商法レビュー必須**。
- inert 運用＝コードは production 403固定・killswitch無効で先に作り、personal有効化は本人利用の枠内。

## §8 制度知識アンカー（tax-location 教育原則・両論併記・LLM非発明・陳腐化対策）

understand wf D7/D5 で一次情報確認済み。**決定論アンカーとしてプロンプトに同梱**しLLMに発明させない：

- **損益通算・繰越控除が不可**（NISA口座と課税口座は通算不可・国税庁タックスアンサー No.1535）＝下振れ時の税務救済ゼロ。
- **外国税額控除が使えない**（NISA非課税口座内配当は控除対象外・No.1240）＝米国株配当の現地源泉が取り戻せない二重課税。
- **上場株式等の配当・譲渡益は一律20.315%**（資産クラス間の税率差なし）＝**米国 tax-location の定説は税率差駆動ゆえ直輸入できない**。
- **生涯枠1800万（成長内数1200万）・簿価残高ベース・売却の翌年復活**。復活枠は**年間投資枠に上乗せされない**（年360万律速・金融庁）。
- **年間枠つみたて120万/成長240万・繰越不可・同年内再利用不可**（日証協FAQ）。
- **つみたて対象**＝金融庁指定の長期・積立・分散投信（届出制）。**成長枠除外**＝整理・監理銘柄／信託期間20年未満／毎月分配型／ヘッジ目的外デリバティブ。
- **教育原則は両論併記**：期待リターンが高い・分配課税が重い資産を非課税枠へ寄せる考え ⇔ 損益通算不可ゆえ下振れ時救済ゼロというリスク。断定的な「買うべき」でなく前提（投資期間・課税口座の含み損益・売却予定・外国税の有無）を明示。
- **陳腐化対策**：「約360本」等の**可変数はプロンプト直書きせず SELECT count 由来で注入**。税率/枠/除外要件テキストは**施行日付きバージョン管理**＋施行後レビューフック（令和8年度改正＝2027-01・§11）。

## §9 テスト/検証

- **plan0（§5）**：列不在 vs 0件の分岐・configured診断軸（既存回帰を壊さない）。
- **Stage4a（inert・SQL/openpyxl）**：§3.6＋loud-failガード発火・UNIQUE upsert で serial 不変。
- **Stage4b gate順序**：production は killswitch評価前に403（状態を探れない）／capability論理積が production 常時false。
- **whitelist突合**：`refs⊆eligible_ids`＋kind整合（`ts:`/`gw:` プレフィックス）exact-match・範囲外/種別違い/id捏造をdrop。
- **tsumitate捏造**：投信ファンド名を prose に出させ固有名詞様トークン検出→degrade（構造側防御）。
- **売却指示**：売却動詞を prose に出させ semantic guard→degrade。
- **cautions 欠落**：parse失敗→degrade（両論併記の構造強制の実証）。**newMoneyNote はサーバ固定文注入**ゆえ LLM が空/別文言でも常に固定文になる（degradeでなく上書き・§4.4）。
- **文字数超過**：切詰でなくdegrade。
- **層分離**：killswitch OFF で money.js 決定論版に商品名が出ない（§8教育のみ）。
- **敵対 whole-branch wf（ultracode）**：捏造貫通/生¥ログ漏洩/production漏れ/書き手クロバー/degrade健全性/売却滑り込み の多観点。
- **E2E**（4a完了＋personal後にのみ成立）：persona＋適格テーブル＋killswitch ON→`POST {kind:'nisa_allocation'}`→refs が全て実在適格商品に解決（捏造0）・conditional免責注入・cautions描画。
- node/pytest 全緑・両URL curl 反映確認（`/money.js`等リポ直下を直接curl）。

## §10 デプロイ順序

1. **plan0（§5）** → migration適用（`ADD COLUMN IF NOT EXISTS`＝既存0影響・非破壊・本番でも安全）→ 診断軸 → 本番投入。
2. **plan A（Stage4a・§3）** → migration適用 → 取込3スクリプト実行 → **SQL検証**（inert・安全）→ 本番投入。
3. **plan B（Stage4b・§4）**（killswitch OFF・production 403＝**痕跡ゼロ**）→ 本番投入（両URL）。
4. **persona で `NISA_ADVICE_ENABLED` ON**（＋ADVICE_MODE=personal 既存）→ **本人実機受入**。

破壊系（migration適用）は日本語で安全根拠を併記。

## §11 リスク

- **「ちょうど12」未検証**は回避（11/12維持＝新規handler .py足さない・制度モデルは逐語複製ゆえ新規.py不要）。
- **FSA直リンクの日付可変**→index毎回スクレイプ＋loud-failガード。
- **US conditional の誠実さ**＝描画層で免責注入強制（プロンプト非依存）。
- **JP監理整理の当面割り切り**＝現該当0で真・拡張時に JPX差込（§14）。
- **令和8年度税制改正**（2027-01）＝可変数はSELECT count注入・テキストは施行日バージョン・施行後レビュー（先取り実装しない）。
- **persona env 設定漏れ**が「機能が出ない」形（403と区別しにくい）→運用ノート明記。
- **逐語複製の保守負担**＝advice.py↔insight.py パリティテスト（advice_facts_cases.json 流用）でドリフトを機械検知（§6）。

## §12 Non-goals（本スコープ）

- 既存保有の口座間移し替え・売却してNISAで買い直し（売却指示＝規制/設計規模が段違い・出力側でもガード§4.4）。
- 個別銘柄の売買推奨・価格予測・利回り約束。
- 信託報酬によるコスト順位付け/絞り込み（§14）。
- 旧NISA残高分離、外国税額控除逸失額シミュレータ（holdings×外国株判定前提）。
- production での NISA助言（403固定）。他者提供/課金（法務precondition）。

## §13 出力側の Non-goal 担保（売却指示を出させない）

最上位 Non-goal（売却指示）は名前ゼロでも自由文で滑り込むため、捏造ガード（ID参照/exact-match/検出器）だけでは不足。§4.4 の通り：①プロンプト negative constraint、②`taxable_note` を税務教育に限定、③売却動詞 semantic guard→degrade、で出力側を担保。

## §14 将来タスク（確実に記録）

- **信託報酬データ源の確認＋コスト順位付け**（§1-12・ユーザー明示要望）＝別ソース発見＋ToS確認＋取込実装＋プロンプト/出力拡張。
- **US個別株/ETFの証券会社取扱い確認の精緻化**（`conditional`→実データ化）。
- **JPX監理・整理データの自動取込**（現状403・データポータルCSVの手動/定期投入）。
- **令和8年度税制改正追従**（2027-01・つみたて本数増/公社債要件緩和/指定指数追加）。
- **ETF AUM バックフィル**（`market_cap`を汚さない専用`aum`列・任意）。
- **金商法レビュー**（他者提供/課金化の hard precondition）。

## §15 決定ログ（ユーザー確定・2026-07-19〜21・AskUserQuestion）

- effort=max で初期設計（着手前band-stop）／ultracode ON で understand 7次元＋feasibility 5次元＋self-review 4観点 wf。
- 助言対象＝**新規資金の振り分けのみ**。endpoint＝**insight.py 相乗り**（11/12維持）。商品名＝**personalで含める・適格判定機能を創設**。
- 法務＝**inert先行**／killswitch＝**独立env**／silent degrade＝**この機会に潰す**（plan0独立先行）。
- US＝**conditional注記付き**／4b入力源＝**me.mcc_state のNISA残枠**／JP監理整理＝**当面一律eligible割り切り**／信託報酬＝**MVPなし＋将来タスク確実記録**。
- 監査ログ＝me.nisa_log新設／決定論アンカー＝facts非出力・制度モデルは insight.py へ逐語複製＋advice↔insight パリティ（§6・writing-plans wf で共有モジュール案を撤回）。
- self-review反映＝plan分割（0/A/B）・gate通過後dispatch・統一id名前空間（ts:/gw:）・coarsen生¥leaf粗化・層分離厳守（money.js商品名なし）・cautions構造強制・tsumitate捏造の構造側一本化・売却negative constraint。
