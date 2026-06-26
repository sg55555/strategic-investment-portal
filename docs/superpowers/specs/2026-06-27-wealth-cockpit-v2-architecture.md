# お金の司令室 v2（Wealth Cockpit）— アーキテクチャ設計仕様

- date: 2026-06-27
- project: investment-portal v2（「お金の司令塔」MVPの本設計化）
- status: アーキ承認済み（Slice 1 から実装着手）
- 由来: 太田さんのキャリア／資産ロードマップ。MCC v1（本番LIVE・main 300ecad）の学びを踏まえた本設計。
- 設計プロセス: ultracode 設計探索workflow（データ源/DB/プライバシー研究＋3アーキ並行設計＋統合）。※AI助言研究1本は失敗（prompt too long）→ プライバシー研究＋統合が論点を補完。AI層の詳細は Slice 3 で詰める。

---

## 1. ビジョン

「現在の貯蓄・投資余力を可視化 → 目標設定 → 目標に向けたAIアドバイス（資産配分・銘柄の判断支援）」を、**フル自動・完成度高く**回す個人ファイナンスの司令室。太田さんの**二本目の柱（金融×教育の発信→将来IFA/教材）の旗艦**であり、「完璧に作り切ること」自体がモチベーション源。

恒久方針（v1から継承）：AIは「勝ち銘柄当て」でなく**「規律を守らせる・教育する・判断を支援する」**。規制安全圏（金融教育・判断支援 > 個別投資助言の登録業）。決定論ルール（`money-rules.js`）をAI出力より上位表示。

## 2. 確定した決定（2026-06-27・本人選択）

| 論点 | 決定 |
|---|---|
| アーキ | **C ハイブリッド**（共有バックエンド基盤＋用途別フロント2枚：公開可能な"市場リサーチ器"／認証必須の"司令室"）。独立が確定要件になれば C→A 昇格が安い＝後悔最小 |
| プライバシー転換 | **認証付きバックエンドへの移行を受け入れる（Slice 2 で初発生）**。Slice 1（公開器）は個人データゼロ。LLMへは**集約値のみ（Mode A：達成率・比率・next target）**。生額は出さない |
| データ源/コスト | 本番 **J-Quants Light（¥1,650/月）＋US無料（yfinance）**、月**約¥2,000**まで許容。**開発は全て無料（yfinance）で先行**、契約は本番化（Slice 6）時 |
| 次の一手 | このアーキを spec 化 → **Slice 1 から着手** |
| リアルタイム | 日次EOD基準＋保有確認時の**15分遅延気配**。秒単位ストリームは意図的に持たない（高額＋反FX規律と矛盾） |
| AI助言の安全線 | 「金融教育・判断支援」フレーミングに固定、**個別銘柄の売買推奨はしない**（投資助言業の登録回避） |

## 3. 推奨アーキ：C ハイブリッド

```
┌── GitHub (Public repo) — Actions cron: 日次EOD/週次財務+AIコメント/月次kakeibo ──┐
│     ↓ J-Quants Light(JP) / yfinance(US補完)                                      │
├── Neon Postgres + TimescaleDB拡張 ───────────────────────────────────────────────┤
│     market: ohlcv(hypertable) / financials_annual / ticker_master / ai_comments  │
│     me:     sessions / portfolio_entries / goals / mcc_state / cashflow_snapshots│
├── Vercel (SPA + Python Functions) ───────────────────────────────────────────────┤
│     /api/market/*  (OHLCV/財務/検索/AIコメント・認証不要・個人データゼロ)        │
│     /api/auth/*    (login/logout/session・password→httpOnly cookie)              │
│     /api/me/*      (PF/目標/余力/AI助言・認証必須・L3生値はサーバ内)             │
├── Front A「市場リサーチ器」: 個人データゼロ＝公開可(fork)                          │
└── Front B「司令室」: 認証必須・私的                                                │
```

**基盤スタック（全スライス共通）**：Neon Postgres＋TimescaleDB／J-Quants Light(JP本番)・yfinance(開発/US)／GitHub Actions cron（Public化で無料無制限・orbis実績）／Vercel Python Functions（kakeibo/nexus流用・10秒制限はSQL絞りで回避）／httpOnly cookie認証＋Neon `sessions`（kakeibo移植）／Claude Haiku(公開財務コメント)＋Sonnet(私的コーチ)。

**コスト**：開発 ¥0（yfinance）／本番 約¥1,750〜2,200/月（J-Quants Light＋Claude従量）。Neonは〜2,500銘柄無料・超過も$0.35/GBと激安。

**なぜC（観点）**：①プライバシー/公開両立を**構造で担保**（公開器＝個人データゼロ／司令室＝認証）②規律エンジン`money-rules.js`を**ブラウザ＋サーバ単一ソース**化しドリフト防止 ③独立化が確定したらC→A昇格が安い＝**未確定の独立を前払いしない** ④各スライスが面で完結＝**誇れる完成物**を積める ⑤既存エコシステム（kakeibo認証/investment-portalチャート・財務）と整合。
**妥協点（正直）**：送信ゼロの放棄はSlice2以降で実質後戻り困難／構成要素が多い（2フロント＋5系統基盤）／Cは独立そのものではない（独立が確定要件ならA）。

## 4. 縦切りロードマップ（各スライス単独で本番投入できる完成物・`REMOTE_ENABLED`等フラグで並走し本番を壊さない）

1. **Slice 1「高速・大量銘柄の市場リサーチ器」**（最小で誇れる完成物）
   - Neon+TimescaleDB構築＋`market`/`me`スキーマ／`investment.db`＋`data.js`＋`analysis_cache.json`をETLでseed／`/api/market/{ohlcv,financials,search,ai-comment}`／`dataClient.js`（`STOCK_DATA`互換shim）で既存チャートUIをAPI駆動へ。
   - 完了の定義：見た目同一のまま**初回ロード21MB→数KB**、チャート＋財務3表＋AIコメント＋検索が本番。**認証不要・個人データゼロ＝公開可能な器**。v1を単体で超える出荷物。
2. **Slice 2「ログイン × 司令室クラウド化」**：`/api/auth/*`（password→httpOnly cookie→Neon `sessions`）／`money.js`の load/save を localStorage↔`mcc_state`テーブル両対応／目標機能／export を初回クラウド同期に流用。完了：バケツ・目標が**複数端末同期**（送信ゼロ放棄はここで初発生・AIまだ無し）。
3. **Slice 3「AI規律コーチ（集約値のみ）」**：`/api/me/advice` がサーバで`money-rules.js`と同一の規律エンジンで決定論ファクト構築→**Mode A（集約値）**でSonnet→決定論ルールをAI文の上に優先表示＋免責＋監査ログ。完了：「次の一手」に教育的理由。**生額をLLMに出さず機能**。
4. **Slice 4「収支連携 → 投資余力の可視化」**（中核ゴール）：月次Actionsがkakeibo(Notion)を読取専用pull→`cashflow_snapshots`／投資余力パネル（収入−支出−固定費）／コーチに貯蓄率・余剰を集約供給。完了：「可視化→目標→AI助言」のループが端から端まで閉じる。
5. **Slice 5「個人保有 × 準リアルタイム評価」**：`holdings`(ticker×株数×取得単価)／`/api/me/summary` が終値/15分遅延気配を結合し時価・損益・バケツ実額を**サーバ集計**／US=Finnhub無料・JP=立花e支店 or yfinance遅延。完了：バケツ実額が保有から自動導出、上限警告が実保有で発火。
6. **Slice 6「本番データ源 × 全自動 × 銘柄拡張 × 磨き込み」**（旗艦完成形）：JP本番をJ-Quants Lightへ／全自動cron／数百→数千銘柄／バックアップ＋export30日リマインダ／デザイン監修（CHRONOGRAPH級）。
   - （任意）Slice 7：Front A を fork-and-deploy 公開＋セキュリティ監査ハーデン。独立が確定要件になれば Front B を独立アプリへ昇格（C→A）。

## 5. v1／investment-portal からの移行・再利用（実体確認済）

- `data/investment.db`（`ticker_master`100・`financial_data_v2`293=BS/PL/CF完全）→ Postgres `market`（ほぼ1:1）。`financial_data`(legacy)/`weather_logs`破棄。
- `data.js`(21MB) → `ohlcv` hypertable＋最新指標（一度きりETL seed→退役 or 軽量fallback）。
- `analysis_cache.json` → `ai_comments`（週次Haiku再生成の初期値）。
- **`money-rules.js`（純関数・UMD-lite）→ ブラウザ(Front B)＋サーバ(advice)両用の単一ソース**。`tests/money-rules.test.js` 継続（両環境ドリフト番）。
- `money.js`（`mcc_state`・export/import実装済）＋`money.css` → Front B。load/save を localStorage↔`/api/me/*` 両対応に拡張、export/importを初回クラウド同期に流用。
- `index.html`（Lightweight Charts/Chart.js）→ Front A。`data.js`グローバル直読を`dataClient.js`へ差替、`REMOTE_ENABLED`フラグで旧同期読みへ即フォールバック＝**本番を一度も壊さない**。
- `scripts/*`（yfinance/EDINET）→ ingest層（GH Actions）。US補完＋JP財務の無料公式補完。
- kakeibo の login/cookie/session → `api/auth/*`（bcrypt＋httpOnly cookie＋Neon `sessions`）。

**移行の安全シーケンス**：新APIを先に立て、市場ビューを画面単位で `data.js→API` へ差し替え（Slice 1で並走）。個人データのサーバ化は AIコーチ/実保有を本当に欲する Slice 2〜3 まで意図的に遅らせ、各スライスで「この機能のためにプライバシーコストを払うか」を都度選べる構造。

## 6. 各スライスで詰める残論点（決定を該当スライスまで遅延）

- Slice 1: Neon プロジェクト provision（要ユーザー作業：NEON_DATABASE_URL）／スキーマ確定／API契約／dataClient shim／ETL。
- Slice 3: AI助言の詳細設計（Mode Aの集約値セット・プロンプト・監査・免責・モデル選定）＝失敗したAI研究の穴をここで埋める。
- Slice 5: 気配データ源の最終選択（立花e支店 or kabu or yfinance遅延）・証券口座開設の要否。
- Slice 6: J-Quants Light 契約・リポPublic化（事前 secret/PII 監査）・2FA は将来。

## 7. 受け入れ基準（プロジェクト全体）

各スライスが「単独で本番投入でき、UXが一段完成し、前スライスを壊さない」こと。最終的に大量銘柄・公式データ・全自動・磨き込みの旗艦完成形に到達し、`money-rules.js`の規律の芯がブラウザ／サーバで一貫すること。個人データのLLM送出は常に集約値（Mode A）に限定され監査ログが残ること。
