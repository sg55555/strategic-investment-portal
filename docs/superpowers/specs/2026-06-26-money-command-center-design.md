# お金の司令塔（Money Command Center / MCC）— 設計仕様

- date: 2026-06-26
- project: investment-portal（Strategic Investment Portal）への機能追加
- status: 設計承認済み（実装計画へ移行予定）
- author: 太田周吾 ＋ Claude（ブレインストーミング経由）

---

## 1. 背景・目的

太田さんのキャリア／資産戦略の壁打ちから派生した最初の具体アーティファクト。狙いは **「収入を死守しつつ、自律（独立/金融/投資）へ向かう」** を支える**“守りの司令塔”**を作ること。

核心の気づき：今いちばん自律を奪っているのは職場でも上司でもなく **「貯蓄バッファが薄いこと」**。バッファ＝“自由の頭金”。よって自律への第一歩は、攻めの投資ではなく **バッファ再建という守り** を可視化・規律化すること。

このMVPは同時に3つの目的を満たす：
1. **守り**：バッファ・コア・サテライトの可視化（最優先＝バッファ再建の見える化）
2. **正直な欲**：個別株（短期サテライト）枠を“上限つき”で安全に持つ構造
3. **二本目の柱の種**：将来 publish-the-tool（道具を公開）して「金融×教育」の発信資産へ

設計の芯（恒久方針）：AI/ロジックは **「勝ち銘柄を当てる」ではなく「規律を守らせる・教育する」**。これが (a) 太田さんをFXの轍から守り (b) 将来公開時に規制の安全圏（教育>個別助言）に収まり (c) 二本目の柱の資産になる、という三方良しを成立させる。

## 2. 確定した方針（ブレインストーミングの決定事項）

| 論点 | 決定 | 観点 |
|---|---|---|
| 誰のため／公開 | **まず自分専用 → 将来“道具（空の器）”を公開**。実データは端末から出さない。公開時は各自が自分の端末に入力する方式で、太田さんの数字は一切出さない | プライバシー × 二本目の柱の両立 |
| 実装場所 | **investment-portal に統合**（3つ目のビュー） | ハイブリッド実現 × 既存資産（デザイン/チャート/デプロイ/将来は株価）再利用 × 最速本番 |
| MVPの粒度 | **3バケツ（バッファ/コア/サテライト）の金額＋目標**。保有銘柄の明細は v1.5 へ後回し | YAGNI × #1（バッファ再建）に最短 |
| 規律の効かせ方 | **ルールベースの司令塔ロジック**（決定論・LLM不要）。AIコーチは第2弾で「なぜ・教育」を足す層 | 規律の芯 × コスト0 × 安全 |
| プライバシー保存 | 個人実データは **localStorage 限定**（サーバ送信なし・公開しない） | [[feedback_secrets_handling]]（生の機密はAIに見せず、ローカル完結） |

既定値：**バッファ 6ヶ月分 ／ サテライト上限 10%（investable比）／ 通貨 JPY**。すべてユーザーが設定で変更可。

## 3. アーキテクチャ（統合と疎結合）

investment-portal は単一ファイル SPA（`index.html` 約4,100行・非module グローバルJS・静的配信・SWなし）。既存の `#portal-view`／`#detail-view` に **3つ目のビュー `#money-view`** を追加する。

**衛生方針（モノリスを汚さない）**：新コードは隔離する。

- `money.js` … MCCのロジック全体。グローバル名前空間 **`MCC`**（既存の非module構成に合わせ、`window.MCC = (function(){ ... })()` の IIFE で公開関数のみ露出）。
- `money.css` … MCC専用スタイル（既存デザイントークン＝ダーク紺 `#070c16→#0e1422`／オーロラ発光／テーマ `#4f46e5`／`Helvetica Neue` を流用）。
- localStorage 名前空間 … **`mcc_*`**（既存の `sip_*` と完全分離）。
- 既存 `index.html` への変更は最小限の3点のみ：
  1. ナビに「司令塔」エントリ（既存のビュー切替方式 `view-section` クラスに乗る）
  2. `<section id="money-view" class="view-section">…</section>` の骨組み追加
  3. `<link rel="stylesheet" href="money.css">` と `<script src="money.js"></script>` の include（`data.js` と同様に静的読込）

既存4,100行のロジック（チャート・スクリーナー等）には**触れない**。

**MVPは `data.js`（21MB・株価データ）に依存しない**（手入力のみ）。株価参照は v1.5（保有明細）で初めて行う。

## 4. データモデル（localStorage限定・端末内・サーバ送信なし）

キー `mcc_state`（JSON文字列）：

```js
{
  version: 1,
  currency: "JPY",
  monthlyExpense: 0,        // 月の生活費（バッファ目標の基礎）
  bufferMonths: 6,          // バッファ目標 = monthlyExpense × bufferMonths
  buckets: {
    buffer:    { amount: 0 },   // 生活防衛資金（現金）
    core:      { amount: 0 },   // 長期コア（インデックス等）
    satellite: { amount: 0 }    // 個別株/短期サテライト
  },
  satelliteCapPct: 10,      // サテライト上限（investable に対する%）
  history: [                // 任意・推移グラフ用スナップショット
    { date: "YYYY-MM-DD", buffer: 0, core: 0, satellite: 0 }
  ]
}
```

- 全フィールド手入力。数値は非負。通貨は当面 JPY 固定。
- **エクスポート/インポート**：`mcc_state` を JSON ファイルとして書き出し／読み込み（端末間バックアップ用・任意機能）。クラウド同期はしない。
- `history` は「スナップショット保存」操作時に現在のバケツ値を1行追記（自動ではなくユーザー操作。MVPでは任意、無くても成立）。

## 5. ルールエンジン（決定論・純関数・LLM不要）＝司令塔の頭脳

`money.js` 内の純関数群（副作用なし・入力stateのみ依存 → ユニットテスト容易）。

```
bufferTarget(state)     = monthlyExpense × bufferMonths
bufferProgress(state)   = bufferTarget>0 ? clamp(buffer.amount / bufferTarget, 0, 1) : 0
bufferRemaining(state)  = max(0, bufferTarget − buffer.amount)
investable(state)       = core.amount + satellite.amount        // 投資に回した総額（守りのbufferは含めない）
satelliteCap(state)     = investable × satelliteCapPct / 100
satelliteOver(state)    = max(0, satellite.amount − satelliteCap)   // 上限超過額
```

**`nextAllocation(state)`** … 「次の余剰（毎月の黒字）はどこへ？」を1つ返す（決定論の滝）：

1. `bufferProgress < 1` → **`{ target: "buffer", message: "次の余剰はバッファへ。目標まであと ¥{bufferRemaining}（{bufferMonths}ヶ月分）" }`**
2. それ以外（バッファ達成済み）：
   - `satelliteOver > 0` → **`{ target: "rebalance", message: "サテライトが上限超過（¥{satelliteOver}）。コアへ寄せるか現金化を検討" }`**
   - それ以外 → **`{ target: "core", message: "バッファ達成。次の余剰はコア（長期）へ。サテライトは上限 ¥{satelliteCap} の余剰内のみ" }`**

設計意図：**バッファ → コア → （余剰のみ上限内）サテライト** の優先順位を、毎回ユーザーに迷わせず提示する。サテライトは“余ったお金で、上限内だけ”という規律を機械的に守らせる。

すべて純関数のため、第2弾のAIコーチはこの出力（target / 各種数値）を入力に「なぜ／教育」の自然言語を足すだけでよい（ロジックの再実装不要）。

## 6. UI（`#money-view`・既存デザイン言語で）

上から：

1. **ヒーロー：バッファ目標ゲージ** — リング or 横バーで進捗%。中央に「あと ¥X ／ ◯ヶ月分」。オーロラ発光で主役感を出す（既存ヘッダーの blur 放射グラデを流用）。
2. **「次の一手」バナー** — `nextAllocation().message` を1行で強調表示（司令塔の能動的ガイダンス）。
3. **3バケツカード** — buffer / core / satellite。各カードに金額（インライン編集 or 編集ボタン→入力）。
   - サテライトカードのみ **上限バー**（現在額 vs `satelliteCap`）を表示し、`satelliteOver>0` で**赤縁＋警告アイコン**。この上限警告は**カードレベルで常時表示**であり、§5「次の一手」バナーがバッファ優先を出している間も独立して表示される（カード警告＝状態の可視化、バナー＝単一の次アクション、と役割を分ける）。
4. **設定パネル**（折りたたみ）— `monthlyExpense` / `bufferMonths` / `satelliteCapPct` を編集。
5. **（任意）推移スパークライン** — `history` があれば各バケツの推移を小さく描画（Chart.js 流用）。
6. **エクスポート / インポート** ボタン。

初回（state未保存）は **オンボーディング**：「月の生活費」「現在のバッファ（現金）」等の入力を促す軽いウィザード or プレースホルダ。

## 7. エラー処理・エッジケース

- 入力バリデーション：数値・非負。不正入力は拒否してメッセージ表示（既存値を保持）。
- 未入力フィールドは 0 として扱い、ゲージ/警告は破綻させない。
- `investable === 0` のとき `satelliteCap = 0`（ゼロ除算回避）。`bufferTarget === 0` のとき `bufferProgress = 0`（同上）。
- localStorage 読込失敗／JSON破損／`version` 不一致 → 安全に既定state へ migrate（将来のversion up用に migrate 関数を1つ用意）。破損時はユーザーに確認のうえリセット。
- localStorage 無効環境（プライベートブラウズ等）→ メモリ上stateで動作し、「保存できない」旨を通知。

## 8. テスト

- **ルールエンジンのユニットテスト**（純関数）：`bufferTarget` / `bufferProgress`（0除算・上限clamp）/ `investable` / `satelliteCap` / `satelliteOver` / `nextAllocation` の全分岐（バッファ未達／達成かつ上限内／達成かつ超過）。
  - 既存リポにテスト基盤が無いため、最小構成を新設（Node の標準 `node:test` か、`index.html` を読む Playwright スモーク。実装計画で確定）。
- **スモークテスト**：ビュー切替（portal↔detail↔money）／入力→再描画／localStorage 往復（保存→リロード→復元）／export→import の round-trip／サテライト超過時の警告表示。

## 9. デプロイ・運用

- 既存通り：静的ファイルを追加するだけで Vercel が自動配信（`vercel.json` は rewrites のみ・ビルドなし・SWなし＝版bump不要）。
- 作業は worktree（`worktree-money-command-center`）で実施。完成・テスト後に main へ統合 → push で本番反映（ExitWorktree → merge → push）。**半完成を本番に出さない**。
- `data.js`（21MB）には触れない＝初回ロード負荷を増やさない。

## 10. スコープ外（YAGNI で削減）・第2弾の布石

**MVPでやらないこと**：複数通貨／証券口座連携／取引履歴／税計算／クラウド同期／AIコーチ。

**第2弾以降（布石のみ）**：
- **AI規律コーチ**：本MVPのルールエンジン出力（target・数値）に「なぜ・教育」の自然言語を足す層。**実データをLLMに送るか否かはその時点で別途決定**（候補：集約値のみ送る／オフライン事前生成／送らない）。MVPでは **送らない**。
- **保有明細（v1.5）**：サテライト/コアを「ティッカー×株数×取得単価」で入力 → 既存 `data.js` の株価で自動評価・含み損益・既存の銘柄詳細ビューへ接続。MVPの3バケツ金額を、明細の合算で置き換えられる構造にしておく（将来拡張の余地を data model に残す）。
- **publish-the-tool**：localStorage限定設計のため、公開すれば自然に“空の器”になる。公開判断は二本目の柱の発信戦略と併せて将来検討。

## 11. 受け入れ基準（MVP完了の定義）

- [ ] `#money-view` が investment-portal に追加され、ナビから切替できる（既存ビューに影響なし）
- [ ] 3バケツ＋月生活費＋設定を入力でき、`mcc_state` に localStorage 保存・リロードで復元される
- [ ] バッファ目標ゲージが進捗%と残額を正しく表示する
- [ ] サテライト上限バーが表示され、超過時に警告が出る
- [ ] 「次の一手」バナーが `nextAllocation` の決定論ルール通りに表示される
- [ ] export/import で state を JSON 往復できる
- [ ] ルールエンジン純関数のユニットテストが緑
- [ ] 個人データがサーバへ一切送信されない（ネットワーク送信ゼロをコードレベルで担保）
