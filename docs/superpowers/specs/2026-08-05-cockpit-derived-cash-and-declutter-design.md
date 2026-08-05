# 司令室：貯蓄額の自動連動（実効値方式）＋2タブ再編（H1）＋鮮度・更新の信頼性 — 設計spec

date: 2026-08-05
status: ユーザーレビュー待ち
関連: docs/superpowers/specs/2026-06-27-wealth-cockpit-v2-architecture.md／Obsidian Projects/wealth-cockpit-v2.md

## 0. 背景（今回の診断結果＝実装の動機）

太田さんの報告「前月の貯蓄額を入力したのに今月の貯蓄額が前月のまま」を系統デバッグした結論：

- **データ経路（kakeibo→Neon ETL→/api/me/cashflow→cashDerived）は全て健全**。8/2のETLで2026-07が確定(is_complete=true)済み・API実応答も正・純関数も正（どの歴代版も正）。
- 実際の原因は2つの**設計ギャップ**：
  1. **開きっぱなしタブの古データ残留**＝cloudFlush 401時は同期バーのみ部分再描画（money.js:110→262-266）で古い収支DOMが残り、「↻最新に更新」は `!sync.loggedIn` guard（money.js:208）で**無言の死にボタン**になる。クライアント取得時刻の表示・自動再取得も無い（F5で解消を実機確認済）。
  2. **導出貯蓄額が表示専用**＝cashDerived.derivedCash は収支セクション内の参考表示のみで、バッファ達成率・総資産・投資余力は手入力 buffer.amount（cashSource フラグは宣言のみのdead）のまま＝「達成率が最初に入れたバケツ額のまま」。
- 加えて「1ページの情報量が多い」（常時展開13ブロック縦積み・A層情報が10番目に埋没・重複表示3系統）。

## 1. ユーザー承認済みの要件（2026-08-05・AskUserQuestionで個別確認）

1. **バッファの権威＝自動算出**（基準＋確定収支）。実装方式は**A: 実効値方式**（保存データは書き換えない）。
2. **日次ETL化**して当月も参考表示（確定値の権威は月次のまま）。
3. レイアウトは**H1: 2タブハイブリッド**（モック `docs/superpowers/specs/assets/2026-08-05-mock-hybrid.html` で実物確認・確定）。
4. 鮮度・更新の信頼性修正（無言失敗の可視化・再ログイン導線・自動再取得）。

## 2. 設計A：実効値連動（cashSource="anchor"の結線）

### 2.1 核＝migrate直後の単一境界で buffer.amount を実効値へ差替

- **money-rules.js に純関数 `effectiveState(s, cashflowRows, investmentRows, nowMs)` を新設**：
  - `s.cashSource === "anchor"` かつ `cashDerived(...).anchorConfigured` かつ rows が非空 → `buffer.amount = r(derivedCash)` に差し替えた**コピー**を返す（r() は既存の単一丸め＝par-2 規律・丸めはこの1回のみ）。
  - それ以外（manual／anchor未設定／rows空=未ログイン等）→ **入力 s をそのまま返す（no-op）**＝後方互換の機械証明点。
- 表示・facts はすべて実効値経由。**保存 state（localStorage/Neon mcc_state）は書き換えない**＝LWW・多端末同期と安全に共存し、毎回再計算なのでズレが構造的に溜まらない。

### 2.2 cashSource の遷移（state v3 migration）

- `saveAnchor()` → `cashSource = "anchor"`／`editAnchor()`（基準解除）→ `"manual"`。
- **migration**: anchor.date が設定済みの既存 state は `cashSource := "anchor"` へ一度だけ昇格（これまでフラグはdeadで誰も意図選択していない＝anchor設定こそが意図。手動に戻したい場合は基準解除で戻る）。anchor未設定は従来どおり manual。

### 2.3 適用点

- **money.js render() 冒頭で `eff = R.effectiveState(state, _cashflowRows, _investmentRows, Date.now())` を1回生成**し、viewModel／cashflowViewModel／cashflowDerived／roadmap／nisaViewModel へ渡す（derivedCash の算出は render 入口の1回に統合＝現状の2重算出も解消）。
- **modeAFacts**: opts（既に cashflow/investmentRows を受領）から内部で同じ実効化を適用（**署名変更なし**）。
- **advice.py（鏡像・同時変更必須）**: `_migrate` に anchor＋cashSource を追加（normalizeAnchor の Python 鏡像・ASCII `[0-9]` 正規表現）／`_cash_derived`（cashDerived 鏡像）を新設（do_POST が既に読む cf_rows/inv_rows を入力）／mode_a_facts 冒頭で実効化。
- **FACTS_SCHEMA_VERSION 5→6 を JS/Py lockstep bump**（同一 state でも facts 値が変わり得るため）。
- facts に `cashSource`（"anchor"|"manual" enum・coarsen素通し）を追加。**production の DENYLIST（生額禁止）は不変**＝derivedCash 生値は facts raw（personal）以外に出さない。

### 2.4 applySurplus（余剰反映）の扱い

- **anchorモードではボタンを非表示**にし「基準連動中は貯蓄額が自動追従するため反映操作は不要」と注記。
  - 理由: derivedCash は当該確定月の balance を既に含む → `buffer.amount += toBuffer` は**二重計上**。core への実移動は投資台帳の `invest_cash_flow` が cashDerived に結線済み（初購入後に自動反映）。
- 確保枠の積立は既存の個別ボタン（満額確保/編集）を継続。manualモードは現行どおり（applyPeriod冪等含め不変）。

### 2.5 バケツUI

- バッファ欄＝**read-only 表示＋「自動連動中（収支連携から自動算出）」バッジ＋「基準を変更」リンク**（設定タブのアンカーへジャンプ）。
- fallback（未ログイン/rows無し）＝保存値を表示し「ログインすると自動算出」注記。コア/サテライトは従来どおり手入力。

### 2.6 テスト・パリティ

- 既存 fixture 65ケースは manual 既定で**期待値不変のまま緑**（no-op の機械証明）。
- 新規 fixture: anchorモード（未達/達成/半端丸め half-up 境界/anchor未設定 degrade/adversarial coercion/invest_cash_flow 合算/rows空 fallback）。
- parity fuzz 再実証。回帰不変条件: cf-1（バッファ→コア）/cf-2（trend 絶対比較）/par-2（単一丸め）/保存則 toBuffer+Σallocated+toCore==monthlySurplus（manualモード）。

## 3. 設計B：鮮度・更新の信頼性

1. **クライアント取得時刻の可視化**: `_cfFetchedAt`/`_cfFetchErr` を記録し、鮮度行に「この端末での最終取得 N分前」＋直前更新の失敗（HTTP xxx/通信エラー）を表示。ETL時刻（pulled_at 由来の既存表示）と並記し役割を明確化。
2. **無言の死にボタン解消**: refreshData の `!sync.loggedIn` 分岐で無言 return せず、収支セクション位置に「セッションが切れました → ログインへ」導線（既存 jumpTo("sync") 流用）。背景401（cloudFlush）時も鮮度行を差分更新して状態を可視化（入力フォーカス保護は維持＝フル再描画はしない）。
3. **自動再取得**: visibilitychange の visible 復帰時、最終取得から10分超なら checkSession→refreshData を自動実行（`_sessionChecked` の「ページ寿命1回」をTTL化）。
4. 小修正: guide／確保枠編集の `<details>` に id を付与し開状態を保持（既存 id 保持機構に乗せる）。

## 4. 設計C：日次ETL＋当月参考値

- `.github/workflows/cashflow-pull.yml` の cron を `0 21 2 * *` → **`0 21 * * *`（毎日 06:50 JST 頃）**へ。冪等 skip 済み（実測: 直後再実行で upsert=0）なので通常日は書込ゼロ・1回約20秒。
- ヒーローに**当月込み参考値（derivedCashLive）を常設**・「暫定・毎日自動更新」チップで確定値と格差付け。
- **既知の依存（仕様として明記・非スコープ）**: kakeibo の Notion 月別集計DBに当月行が存在しない期間は参考値が動かない（8/5時点で8月行なし＝行が生えれば翌朝から自動反映）。当月行の自動生成はスコープ外。

## 5. 設計D：H1 2タブ再編（確定モック準拠）

- `#money-view` 内部に2タブ「**ダッシュボード / 設定・ガイド**」（sticky タブバー・中央ルーターの `#money` ハッシュは不変・タブ状態は localStorage 保持）。
- **ダッシュボード**（入力欄ゼロ）: 先頭ヒーロー（確定貯蓄額・当月込み参考値・バッファ達成率＋自動連動バッジ・投資余力・次の一手・鮮度行）→ 1行ダイジェスト付き折りたたみ6本（収支の詳細[既定open]／ロードマップ／NISA／資産クラス／確保枠・資産目標[統合]／AIコーチ）。
- **設定・ガイド**: 基準（アンカー）／生活費（実支出平均の採用含む）／バケツ保有額（バッファ=自動連動read-only）／資産クラス入力／NISA入力／確保枠追加／エクスポート・インポート／ログイン欄／ガイド・用語集。
- **重複3系統の統合**: 次アクション文言→ヒーローの「次の一手」に一本化（banner と advice 決定論行の重複解消）／配分ウォーターフォールチップ→収支の詳細のみ／derivedCash 算出→render 入口1回。
- `<details>` 開状態保持は全て id ベースへ。既存 jumpTo はタブ自動切替＋スクロールに拡張（ガイド内リンク・ゲージヒント等の既存6リンクは互換維持）。
- 免責（R.DISCLAIMER）は各カード従来どおり（規制安全の表示要件は不変）。

## 6. 検証・デプロイ

- unit: money-rules（effectiveState/新fixture）＋ advice.py（鏡像・パリティ）。node --test 全緑・pytest 全緑・parity fuzz mismatch 0。
- E2E（Playwright・fetchモック）: anchorモードで達成率/総資産/投資余力が自動追従・タブ切替とジャンプ・再ログイン導線・visible復帰の自動再取得・manualモード無回帰。
- 敵対レビューwf（HIGH 0 まで）→ 本人push認可 → push（2プロジェクト自動デプロイ・追加env不要）→ 本番curl（money.js/money-rules.js マーカー・両URL byte一致）→ 本人実機サニティ（ログイン×収支はheadless不可）。
- ETL cron変更はコード同梱（同一push）。デプロイ後に `gh workflow run cashflow-pull.yml` で1回疎通確認。

## 7. 非スコープ

- Notion 月別集計の当月行自動生成／投資台帳ETL（etl_investment）の起動／ポータル（index.html）側の変更／NISA Stage4 有効化チェックリスト（別タスク）。

## 8. リスクと対処

- **state v3 migration（cashSource昇格）**: anchor設定済みユーザーの挙動が変わる（意図どおりだが）→ 基準解除で即 manual に戻せる導線を明示。
- **facts 値の変化（LLM入力）**: SCHEMA_VERSION bump＋新旧fixtureで機械固定。cache/cooldown は facts_hash 由来で自然無効化。
- **タブ化のリンク互換**: 既存 jumpTo ターゲット7種はタブ跨ぎで動くことをE2Eで固定。
- **保存則**: anchorモードでは applySurplus 撤去により保存則テストは manualモード限定である旨をテスト側に明記。
