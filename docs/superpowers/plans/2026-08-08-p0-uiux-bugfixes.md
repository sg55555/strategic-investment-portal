# P0 UIUXバグ修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-08-08 UIUX監査で確定した実バグ4件＋小物2件を修正する（デザイン刷新とは独立の信頼毀損級修正）。

**Architecture:** 既存構造の局所修正のみ。新機能・新ファイルなし（テスト追加を除く）。監査エージェントが file:line と再現条件を実測済み＝root cause 確定済み。

**Tech Stack:** Vanilla JS / detail.css / Playwright（scratchpad ハーネス流用）・node --test。

## Global Constraints（全タスク共通）

- **チャート描画の唯一の技術制約＝display:none→createChart 0x0罠**（寸法/初期化順序は不変）。
- money-rules.js↔advice.py 鏡像・fixture パリティに触れる変更はこのplanに無い（触れないこと）。
- index.html の inline script は IIFE 隔離済み＝新規公開関数は末尾 Object.assign(window,{...}) に追加（無言故障防止）。
- テスト: `node --test tests/*.test.js` グロブ・E2E は `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js` ＋ `node scratchpad/portal-money-smoke.js`。
- 各タスク末尾で commit（メッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）。

## File Structure

- Modify: `cross-section-rules.js`（時価総額スケーリング）
- Modify: `detail.css`（モバイル比較/ウォッチ入口・比較モーダル幅）
- Modify: `index.html`（.search-input box-sizing・ローディングフィードバック）
- Modify: `detail.js`（navigateToDetail フィードバック・出来高桁区切りは detail-rules.js）
- Modify: `detail-rules.js`（出来高 toLocaleString）
- Modify: `money.css`（.mcc-anchor-main dead CSS 削除4行）
- Test: `tests/cross-section-rules.test.js`（存在すれば追記・無ければ新設）・E2E追記

---

### Task T1: 時価総額100万倍誤表示の修正（fmtMagnitude 前提違い）

**Files:**
- Modify: `cross-section-rules.js:89-90` 付近（`_rawPositive(raw,"marketCap")` の値が生円のまま `FR.fmtMagnitude`〔百万単位前提〕へ渡る）
- Test: tests/ 配下の cross-section 系テスト（実ファイル名を確認して追記）

**Interfaces:**
- Consumes: `finance-rules.js fmtMagnitude(value, currency)`＝**百万単位入力前提**（finance-rules.js:80 `a>=1e6→/1e6+"兆"`）。index.html:1644 `fmtMarketCap`（生円/1e12）が正しい参照実装。
- Produces: 相対ポジション・ランキング・セクター中央値チップ・比較モーダルの時価総額が正しい兆/億表示になる。

- [ ] **Step 1: 失敗するテストを書く** — トヨタ級（約48兆円=4.8e13円）の raw marketCap を通し「48.0兆円」級の文字列になること（現状は「48000000兆円」級で FAIL することを確認）。
- [ ] **Step 2: 修正** — marketCap 経路のみ `value/1e6` を fmtMagnitude へ渡す（または marketCap 専用に fmtMarketCap 相当を使う）。**同じ `_fmtMetric` 経路の他指標（売上等・元々百万単位）を壊さないこと**＝指標ごとの単位前提を関数冒頭コメントに明記。
- [ ] **Step 3: 影響4箇所の実画面確認** — mock_prod_server で ①詳細「相対ポジション」 ②ランキング（指標=時価総額） ③セクター中央値チップ ④比較モーダル指標表、の時価総額表示が妥当値になることをスクショで確認。
- [ ] **Step 4: 全unit緑→commit** — `fix(portal): 時価総額の百万単位前提違いを修正（相対ポジション482046兆円誤表示）`

### Task T2: モバイル動線の復旧（比較/ウォッチ入口＋モーダル幅＋横はみ出し）

**Files:**
- Modify: `detail.css:430`（`.detail-star-btn, .open-compare-btn { display:none }` を撤廃し、≤768px ではコンパクト表示（アイコン化・高さ44px 目標）に変更）
- Modify: `detail.css` 比較モーダル（`.compare-modal-box` を `width:min(429px, calc(100vw - 24px))` 系に・✕ボタンが常に画面内）
- Modify: `index.html` `.search-input`（`box-sizing:border-box` 追加）＋390px で layout viewport が 390 を超える他要因を DevTools 実測で潰す（portal 455 / detail 469 / money 436-468 → 全ビュー 390 以下に）

- [ ] **Step 1: 再現確認** — Playwright 390x844 で ①比較/ウォッチボタン w=0 ②モーダル右端449px ③documentElement.scrollWidth>390 の3点を数値で記録（修正前証跡）。
- [ ] **Step 2: 修正実装**（上記3件）。
- [ ] **Step 3: E2E追記** — 390px で ①「⊕比較」実クリック→モーダルが visible かつ右端≤390 ②✕実クリックで閉じる ③3ビューとも scrollWidth≤390 ④ウォッチ実クリックでトグル、を固定。
- [ ] **Step 4: デスクトップ無回帰**（1440pxで従来表示）→ 全E2E緑 → commit `fix(mobile): 比較/ウォッチ入口復旧・モーダル幅・横はみ出し解消`

### Task T3: 詳細遷移のローディングフィードバック＋小物2件

**Files:**
- Modify: `detail.js:580-584`（navigateToDetail）・`index.html`（スタイル1件）
- Modify: `detail-rules.js:750`（出来高 `toLocaleString`）
- Modify: `money.css:449-450,1015-1016`（.mcc-anchor-main dead CSS 4行削除）

**Interfaces:**
- Produces: 行クリック直後（await getStock 前）に `document.body.classList.add("nav-busy")` ＋クリック行に `.row-busy`（背景ハイライト＋行末ミニスピナー）を付与し、表示完了/失敗で必ず除去。多重クリックは busy 中 return でガード。CSS は `body.nav-busy { cursor: progress }` ＋ `.row-busy` の2ルール（index.html の style 内）。

- [ ] **Step 1: 実装**（try/finally で必ず解除・失敗時も残らないこと）。
- [ ] **Step 2: E2E** — ohlcv を 1200ms 遅延モックし ①クリック直後に nav-busy/row-busy が付く ②表示後に消える ③busy中の再クリックが no-op ④出来高が「4,356,865」形式 ⑤.mcc-anchor-main が css から消滅（grep 0）
- [ ] **Step 3: 全suite緑 → commit** `fix(ux): 詳細遷移のローディング可視化＋出来高桁区切り＋dead CSS掃除`

### Task T4: 統合検証

- [ ] unit 全suite＋cockpit-e2e＋portal-money-smoke 緑・モバイル390/デスクトップ1440 の回帰スクショ。
- [ ] 敵対レビュー（whole-branch・小規模なので単発レビューア）→ HIGH/MED 0 で完了。

## Self-Review 結果
- 監査所見（fresh-eyes #1・usability #1-3・consistency C6・legacy #6）と1:1対応・ギャップ無し。
- 行番号は監査時点（f3e0083）＝実装者は実ファイルで確定のこと。
