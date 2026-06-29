# データ基盤の再設計 ＋ 規律モデル（確保枠）— 実装計画

- date: 2026-06-29
- project: investment-portal v2（お金の司令室）
- status: 設計ロック済（ultracode 設計wf 2本＝Slice4.5 `we3lh2d67` ＋ データ基盤 `wpl1616cz`・本人 AskUserQuestion で全論点確定）
- 由来: 太田さんの気づき（2026-06-29）＝「その時点の現金（バッファ）の定点を定めるのが難しい／賞与・計画支出で判断が変わる／余剰反映後もバケツ＋貯蓄額が次回開くと変動するジレンマ」＋「貯蓄額を自動算出したい」「投資をNotionにどう記録するか統一したい」。
- 推奨設計名: **定点アンカー導出cash × 分離投資台帳（二目的会計・期初保有シード・段階additive）**

---

## 1. 核心と確定決定

**核心＝フロー（日々動く現金）とストック（意図した配分）を分ける**。司令室＝意図的配分の台帳（低頻度・熟慮）／kakeibo＝フローの記録。**投資余力は「リアルタイム残高」でなく「月次判断の後ろ向き平滑シグナル」**（median(3確定月)・当月除外）。

### Slice4.5 確保枠の決定（`we3lh2d67`）
- 確保枠＝**独立エンティティ `reserves[]`（独立プール・ファンド別 saved・自動分配なし）**。goals(資産目標)とは別。buffer.amount は純粋な生活防衛資金のまま、totalAssets 無改造。
- **NEXT_TARGETS 4据え置き ＋ 確保枠は補足advisory**（enum連鎖を触らない・教育的に正確）。
- **totalAssets除外 ＋ netWorth別表示**（確保枠で資産目標進捗を水増ししない）。
- **経常＝自動配分／臨時（賞与）＝手動・額制御**（賞与は確定月と非同期＝二重計上を値設定で構造回避）。賞与は直近年データから期待値を推測し充当を*提案*。
- 月次儀式（pending時のみ最上位・赤字月は「確認のみ」で締める）。

### データ基盤の決定（`wpl1616cz`）
- **OD1 売却益/配当＝ETL派生・kakeibo非書込**（売却行から自動算出・単一源・kakeibo の貯蓄率/収支は不変）。
- **OD3 投資取引DB＝戦略区分(コア/サテライト)タグ＋数量を必須**（core/satellite実額の自動分割・Slice5時価join・売却按分の前提）。
- **OD4 売却益＝経常余剰(median)から除外（windfall別建て）**（貯蓄率がスパイクしない）。
- **OD7 外貨建て＝約定金額をJPY換算で記録**（現金追跡も取得原価もJPYで閉じる・native時価FXはSlice5へ）。
- デフォルト採用: **OD2 アンカーは `mcc_state` 単一**（Notionチェックポイントは将来optional）／**OD5 kakeibo画面の投資可視化は当面なし**（式に触れない）／**OD6 取得原価＝移動平均法**（税務正確値は証券会社の年間報告書を別途）。

---

## 2. 投資の二目的会計（設計の肝）

投資取引DB の1行＝{日付・種別(購入|売却|配当|期初保有)・戦略区分(コア|サテライト)・ティッカー・数量・約定金額(JPY)・手数料任意}。ETL が約定日昇順に走査し、ティッカー別 **移動平均**(qty,cost) を保持して2系統を導出：

| 種別 | 現金追跡（buffer導出） | 投資元本（principal） | 実現益（gain・金融所得） |
|---|---|---|---|
| 購入¥X | cash −X（全額流出） | principal[戦略] +X | — |
| 売却(proceeds P) | cash +P（全額流入） | principal[戦略] −按分原価C | realized_gain +(P−C) |
| 配当 | cash +配当 | 不変 | realized_gain +配当 |
| 期初保有 | **cash 0**（基準日前の取得は anchor に内包済） | principal[戦略] +取得原価 | — |

- **経常勘定（kakeibo balance/貯蓄率）には投資フローを一切載せない** → 投資しても貯蓄率が悪化しない。
- **realized_gain は経常median から除外**（windfall扱い・売却月にスパイクしない）。netWorth/金融所得ラインで別途可視化。
- **正準 identity（fixture/property test 母体）**:
  - `cash = anchor.amount + Σ_{p≥anchorMonth, is_complete}(balance_kakeibo[p] + invest_cash_flow[p])`
  - `principal_cum = Σ購入原価 + Σ期初保有原価 − Σ売却按分原価`
  - 二重計上不発生: `netWorth(原価)=cash+principal_cum`／実現益は proceeds 経由で cash に1度のみ。
- **期初保有シード**＝基準日前から保有する元本を cash_flow=0 で principal にseed（無いと principal_cum 過少→core/satellite/Slice5 母数が誤る）。**hard precondition**。

---

## 3. 貯蓄額の自動算出（定点アンカー）

- `mcc_state.anchor = {date:"YYYY-MM-01", amount}`（基準月初の全円現金＝銀行+流動性貯蓄・投資口座評価額は除外）を司令室UIで1回入力。
- 純関数 `cashDerived(cashflowRows, investmentRows, anchor, nowMs)` が確定月のみ累積し `derivedCash` を導出。**手入力 buffer.amount のドリフト（次回開くと現実が乖離）を機械的に除去**＝痛点1の核を機械化。
- 当月は is_complete=false で除外（最大1ヶ月ラグ）。当月部分は `derivedCashLive` で参考表示・権威は確定値。
- 乖離が溜まったら新 {date,amount} を打ち直すだけで累積起点が前進＝誤差リセット。`drift = 実残高 − 導出cash` を advisory 表示（記帳漏れ点検をコーチが促す）。

---

## 4. buffer/core 自動導出（段階opt-in・後方互換）

- `reservedCash = Σ reserves[].saved`／`freeCash = max(0, derivedCash − reservedCash)`（＝旧 buffer.amount の置換）。`bufferProgress = freeCash / bufferTarget`。
- `investable = principal_core_cum + principal_sat_cum = principal_cum`（取得原価）。core/satellite を手入力廃止して台帳由来に。satelliteCap/Over は取得原価ベース（時価精緻化は Slice5）。
- **二軸フラグ**: `cashSource("anchor"|"manual")` / `investmentSource("ledger"|"manual")`。各次元を独立opt-in。**未設定の既存ユーザは旧 buckets 手入力をそのまま使い1bit不変（完全後方互換・段階移行）**。
- `totalAssets = freeCash + investable`（goals進捗基準・reserves除外）。`netWorth = derivedCash + 投資時価`（別表示）。
- ウォーターフォール拡張: monthlySurplus を **toBuffer → toReserves → investableSurplus(=toCore)**。

---

## 5. 実装フェーズ

### Phase 0（設計確定・本人作業）✅設計ロック済 / 🔲本人作業残
- plan 作成（本書）。spec 追記。
- **本人の Notion 作業**（§7 build steps）: 投資取引DB作成＋プロパティ＋**期初保有行**投入＋**事前クリーンアップ**（基準日以降の投資購入が kakeibo 変動費/固定費に混入していたら削除）。ETL用 read-only integration に新DBを共有。
- **アンカー**は Notion でなく司令室UIから `mcc_state.anchor` に入力（Phase1で実装）。

### Phase 1（ドリフト解消・先行・パリティ不変・effort=low可）
- `mcc_state` v3 migrate（anchor/reserves/cashSource/investmentSource をデフォルト付き additive・既存v2は manual fallback で1bit不変・CURRENT_VERSION 2→3）。
- 純関数 `cashDerived`（anchor+Σ確定月balance・investment無しでも空配線で動く）。
- `/api/me/cashflow` を investment LEFT JOIN で additive 拡張（テーブル未適用は degrade）。
- 司令室UIにアンカー入力カード＋導出cash表示。**新facts ゼロ＝既存14パリティ不変**（modeAFacts/advice.py 無改修）。
- → ドリフトを先に体感。本番LIVE money-rules.js の一括改修を避ける。

### Phase 2（投資台帳・元本/gain分離・本丸・🛑effort band停止後に着手）
- 新テーブル `me.investment_snapshots`（独立 source_hash）。
- 新規 `scripts/etl_investment.py`（**別スクリプト・別失敗ドメイン**＝cashflow pull を巻き込まない）＋ `build_investment`（日付昇順移動平均・期初保有seed・配当・**売却数量必須 loud-fail**）。`.github/workflows/cashflow-pull.yml` で逐次実行。
- 純関数 `investmentDerived` ＋ viewModel の cashSource/investmentSource 分岐。
- **Mode A 新facts**（modeAFacts↔mode_a_facts 同方向＋coarsen `_bucket25` 登録＋`advice_facts_cases.json` 再固定＋FACTS_SCHEMA/CURRENT/SCHEMA bump）。production集約のみ（生額ゼロ）／personal生額。
- ウォーターフォール buffer→確保枠→core ＋ reservesSection/ritualSection UI（Slice4.5）。
- fuzz＋敵対実装レビュー wf でパリティ再固定（**cf-1/cf-2/par-2 回帰維持**）。

### Phase 3（Slice5 時価接続・effort=中）
- holdings JSONB × `investment.db` 最新price で market_value/unrealized_gain（NULL予約列）を充填。netWorth(時価)。satelliteCap 時価判定の要否決定。

---

## 6. Notion 構築手順（additive・§7）→ 本人 or 書込integ経由で私が作成

1. 既存6資産（月別集計 d05a2ae0／変動費 d4b5b08c／固定費 a47cf927／固定費マスター e3365c3f／給与・雑収入リスト）は**一切変更しない**（式/プロパティ/ロールアップ/リレーション不変）。
2. 新規DB『**投資取引（Investment Transactions）**』を同ワークスペースに1本作成。**MONTHLY へのリレーションは絶対に張らない**（式波及を構造的に不能化）。
3. プロパティ: 名前(title)／日付(date=約定日)／種別(select: 購入|売却|配当|期初保有)／戦略区分(select: コア|サテライト)／ティッカー(select推奨)／数量(number)／約定金額(number=動いた円)／手数料(number任意)／年(select)／月(rich_text)／メモ(任意)。**式プロパティは作らない**（数値はETLが会計処理）。
4. **期初保有行**を投入（基準日前から保有の各銘柄を 種別=期初保有・約定金額=取得原価・数量・戦略区分で1行ずつ）。
5. **事前クリーンアップ**（hard precondition）: 基準日以降の投資購入が kakeibo 変動費/固定費に混入していたら削除。今後の投資は投資取引DBのみに記録する運用を確定。
6. ETL用 read-only integration に新DBを共有。プロパティ名/型を実機確認し ETL の loud-fail REQUIRED に登録。
7. アンカーは Notion でなく司令室UIから `mcc_state.anchor` に入力（Phase1）。
8.（将来optional）残高チェックポイントDB／kakeibo画面の read-only 投資ロールアップ。

**Notion作成は私が書込integ経由でも可**（太田さんがローカル `.env` に書込トークンを置けば、私が構造を正確に作成。期初保有/クリーンアップは本人）。

---

## 7. リスクと緩和

- 記帳漏れ→導出cashドリフト → 再アンカー（値打ち直し）＋drift advisory＋（将来）チェックポイントDB。
- パリティ破れ（JS↔Py） → 新facts は Phase2 に集約・fuzz＋敵対レビュー＋fixture再固定（cf-1/cf-2/par-2 回帰維持）。
- 本番LIVE中核純関数の回帰 → **追加層化**（derived経由・未設定時は s.buckets 直読に完全フォールバック）で既存14fixture 1bit不変・Phase1は新facts ゼロ。
- pre-anchor 保有の principal 過少 → 期初保有行で seed（Phase0必須）。
- 基準日以降の投資購入が kakeibo 支出に混入→二重控除 → Phase0 事前クリーンアップ（hard precondition）。
- 投資ETL失敗が cashflow pull を巻き込む → `etl_investment.py` 分離（別失敗ドメイン）。
- 移動平均≠税務正確値 → 概算と割り切り（税は年間取引報告書）。
- 規制安全 → Mode A（production集約/personal生額）・4本柱・決定論最上位+免責・advice_log 生額非保存を全Phase踏襲。

## 8. 工数
Phase1=小〜中（純関数1＋migrate＋API additive＋UIカード・中核改修なし・パリティ不変）。Phase2=大（新ETL＋純関数2＋ウォーターフォール＋Mode A新facts のパリティ＋fuzz＋敵対レビューが支配的・着手前に effort band停止）。Phase3=小〜中（Slice5 time価接続）。
</content>
