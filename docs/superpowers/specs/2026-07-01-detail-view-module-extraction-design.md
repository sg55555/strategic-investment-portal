# 詳細ページ（detail-view）分離リファクタ 設計

- date: 2026-07-01
- project: investment-portal
- related: `docs/superpowers/audits/2026-06-30-portal-index-audit.md`（F2 IIFE隔離）／`money-rules.js`+`money.js`（写像元アーキ）／`finance-rules.js`（既存の純関数抽出）

## 1. 背景・目的

`index.html` は 4594 行の一枚岩（Gemini 由来）。`#money-view` のみが分離アーキ（`money-rules.js` 純関数 ＋ `money.js` IIFE ＋ `money.css`）＝保守しやすい規律を持つ。一方 `#detail-view` は依然 inline `<script>` の一枚岩で、`navigateToDetail`/`updateFinancialViews`/`renderBSChart` 等がグローバルに散在する（財務 math のみ `finance-rules.js` に一部抽出済み）。監査（2026-06-30）の **F2「IIFE 隔離・約40 bare-global」は最高リスクとして後回し**にしていた。

**目的＝`#detail-view` を `#money-view` と同じ分離アーキ標準へ引き上げる、純粋なコードアーキ・リファクタ。** 見た目（テーマD＝ネオン・ターミナル/ガラス）は既に適用済みなので、**視覚・挙動は完全に不変**のまま土台だけを作り直す。

## 2. 非目標（Non-goals）

- **チャートの視覚改善**（色感 #0033AD/#DA0133・ラベル表示ロジック・ZigZag レンジ検出改善）＝別タスク（積み残し③）。今回は混ぜない。
- **portal-view の分離**＝別途（今回は detail-view のみ）。
- **inline `onclick` の全面 addEventListener 化**＝別フェーズ候補（今回は curated window API で温存）。
- 機能追加・データ層/バックエンド変更。

## 3. 制約

- **唯一の技術制約＝`display:none → createChart` の 0x0罠**（チャートコンテナの寸法・初期化順序）。装飾は親カードに付け、chart-container の寸法/初期化順序は不変に保つ。
- **チャート改変 freeze は 2026-07-01 に本人指示で全面解除済み**（色味/ラベル/フォント/低棒ロジック/ZigZag レンジ検出はすべて改善対象）。→ 今回 move-not-rewrite にするのは **「アーキ・リファクタと視覚リデザインを同じ pass で混ぜない」規律**（色 freeze が理由ではない）。混ぜると下記④の before-after 完全一致検証が使えなくなる。
- **保持するのは上下の意味付けのみ**（ローソク up=赤/down=青、ZigZag は逆規約という“意図”）。
- 本番非破壊。各 Step は独立コミット、回帰が出たら即 revert 可能。

## 4. モジュール構成（案B＝チャート隔離）

| モジュール | 役割 | 規律 |
|---|---|---|
| **`detail-rules.js`** | 純関数（DOM 禁止）：価格の期間フィルタ→`displayPrices`、単位選定（`finance-rules.js` 既存分は再利用/集約）、PER/PBR ステータス分類（green/red/gold/blue 判定）、`MARKET_BASIS` 参照 | `money-rules.js` と同じ＝業務ロジックは純関数・DOM を触らない。`tests/detail-rules.test.js`（node --test） |
| **`detail-charts.js`** | 移設したチャート lifecycle（**中身 1 文字も変えない**）：createChart/candle/MA/volume/RSI/MACD/BB/S-R/ZigZag/Series Primitive/glow、Chart.js（BS/PL/CF/Radar）、`forceChartRepaint` | インスタンス（`priceChart` 等）と状態（`rsiState`/`macdState`）をクロージャに閉込め、明確な API（`renderPrice()`/`renderFinancials()`/`repaint()`/`destroy()`）を公開。**0x0罠回避の寸法/初期化順序は保持** |
| **`detail.js`** | IIFE（`window.Detail`）：DOM 描画（ヘッダ/KPI カード/AI コメント/年ボタン）、オーケストレーション（navigateToDetail→rules 算出→DOM＋charts 委譲）、イベント配線、`esc()` XSS | inline `onclick` 用に**厳選 window API**（navigateToDetail/switchYear/toggleWatchlist/openCompareModal 等）を維持。※`showView`（中央ルーター）は全ビュー共有ゆえ **detail.js に取り込まず現状維持** |
| **`detail.css`** | `index.html` `<style>` から **`#detail-view` スコープのルールと detail 専用クラス**（`.kpi-*`/`.panel-*`/`.status-card` 等）のみを抽出。**全ビュー共有の基底クラス（`.card`/`.card-title` 等・portal/money も使う）は移さず現状維持** | **セレクタ・値・トークン参照（`var(--ix-*)`）は不変** |

## 5. データフロー

```
navigateToDetail(ticker)
  → STOCK_DATA[ticker]（データ源・不変）
  → detail-rules（displayPrices / unit / PER-PBR 分類 を純関数算出）
  → detail.js（ヘッダ/KPI/AI コメント/年ボタンを DOM 描画）
  + detail-charts（renderPrice/renderFinancials に描画委譲）
  → detail-charts.repaint()（FHD 黒面対策・移設済み forceChartRepaint）
switchYear(year) → 同じ rules→DOM→charts 経路（animate-cards 再付与なし）
```

`money-rules → money.js → DOM` と同型の一方向フロー。

## 6. 段階（strangler・各 Step で before-after 完全一致を検証）

- **Step 0**：検証ハーネス構築（§7）＋ 現行 index.html の baseline スナップショット取得。
- **Step 1**：純関数を `detail-rules.js` へ抽出（DOM を含まない算出＝displayPrices/unit/PER-PBR 分類）。inline から `detail-rules` を呼ぶ形に差し替え。→ unit test ＋ before-after 一致。
- **Step 2**：チャート lifecycle を `detail-charts.js` へ**丸ごと移設**（インスタンス変数＋描画関数＋状態をクロージャへ）。inline は `DetailCharts` API を呼ぶ。→ before-after 一致（canvas 数/chart-container 寸法/pageerror0）。
- **Step 3**：DOM 描画＋オーケストレーション＋イベント配線を `detail.js`（IIFE）へ移設。inline `<script>` から detail-view 関連を撤去し、window API のみ残す。→ before-after 一致。
- **Step 4**：detail-view の CSS を `detail.css` へ抽出（`#detail-view` スコープのルールと detail 専用クラスのみ。**全ビュー共有の `.card` 等の基底ルールは移さない**）。→ 算出スタイル完全一致。

各 Step は独立コミット。回帰が出たら即 revert。

## 7. 検証（安全網）

- **純関数**：`tests/detail-rules.test.js`（node --test・境界値/日本株[4月〜翌3月]米国株[暦年]の期間フィルタ/PER-PBR 分類しきい値）。
- **before-after スナップショット**（headless Playwright・診断モックサーバ流用）：**株式・ETF・財務欠損年**の複数銘柄で detail を開き、① DOM 構造ハッシュ ② 主要要素の computed style ③ canvas 数 ④ chart-container 寸法 ⑤ pageerror0 ⑥ **window API（inline onclick 依存）の存在** を baseline と突合。各 Step 後に実行。
- ⑥ が重要＝inline `onclick` が参照する window 関数の公開漏れは「無言故障」になるため、スナップショットで存在を機械チェックする。

## 8. 成功基準（Definition of Done）

- detail-view のロジック/描画/スタイルが `detail-rules.js`/`detail-charts.js`/`detail.js`/`detail.css` へ移設され、`index.html` は markup ＋ 厳選 window API のみ。
- detail 由来の bare-global が解消（module クロージャ化）。
- 視覚・挙動が before-after 完全一致（pageerror0）。
- 純関数 unit test 緑。

## 9. リスクと軽減

- **最大リスク＝Step 2（チャート移設）**。軽減＝move-not-rewrite（描画ロジックを 1 文字も変えない）＋ before-after で canvas 数/寸法/pageerror 突合 ＋ 独立コミット。0x0罠回避の初期化順序を厳守。
- **inline `onclick` 依存（約24関数）**＝curated window API 維持で温存（money.js 実績）。公開漏れ＝無言故障 → §7⑥ の window API 存在チェックで捕捉。
- **共有シンボル**（`showView`/`STOCK_DATA`/`currentTicker`/`selectedYear` 等）＝detail 専用でないものは移設せず現状維持、detail 専用の状態のみクロージャ化する。境界を Step 前に明示。

## 10. 実装フェーズの広さ（ultracode）判断

設計は `money.js` テンプレの写像ゆえ**単独で提案**。**実装フェーズ着手前に**、各 Step の「挙動完全一致」を敵対検証する workflow を使うか（先の FHD 修正で ETF 欠陥を捕捉した方式）の**広さ停止（AskUserQuestion）を出す**。
