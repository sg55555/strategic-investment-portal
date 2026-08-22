# UIUX刷新 wave「小工数頻出系一掃」実装 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前 wave が積み残した「小工数頻出系」の表示不具合 12 項目＋recon 新発見 1 件を一掃し、チャート/ラベル/タイトル/トグルバーの読みにくさと偽値表示を解消する。

**Architecture:** 既存の detail 分離規律（純計算=detail-rules.js/finance-rules.js・描画 lifecycle=detail-charts.js・配線=detail.js）を維持したまま、①判定/選抜/整形ロジックは全て rules 層の純関数として新設し node テストで固定 ②描画層はその純関数を消費するだけ（選抜ロジックの二重実装を作らない）③受入は「rules 層＝node テスト」「描画層＝Playwright の DOM 計測＋ソース照合」の二本立て（lightweight-charts のインスタンスは IIFE 私有で page から観測できないため、canvas 内部状態に依存するアサートは書かない）。

**Tech Stack:** Vanilla JS（IIFE・ES5 互換記法混在）／lightweight-charts v4.2.3（SRI pin・index.html:44）／Chart.js v4.5.1＋chartjs-plugin-datalabels v2.2.0（SRI pin・index.html:46）／node --test（tests/*.test.js）／pytest（scripts 系）／Playwright 1.60.0＋chromium（`NODE_PATH=/home/shugo/node_modules`）／mock_prod_server.py（SQLite 実財務＋決定論合成 OHLCV・127.0.0.1:8200）

**Spec:** `docs/superpowers/specs/2026-08-22-uiux-quickfix-sweep-design.md`（2026-08-22 本人承認・敵対検証5レンズ30件反映済・決定記録 D13〜D27）

**Base:** worktree `/home/shugo/apps/investment-portal/.claude/worktrees/uiux-chart-sweep`・branch `worktree-uiux-chart-sweep`・base main `8e44298`

## Global Constraints

以下は全タスクの要件に暗黙的に含まれる（spec §14 の不可侵制約＋本 wave の確定事項）。

- **0x0 罠**: `display:none` のコンテナで `createChart` しない。chart-container の寸法・初期化順序は不変に保つ（C4 の高さミラー・rAF ガードを含む）。
- **MA/BB/KC の base 算出（全履歴算出→窓 filter のウォームアップ機構）不可侵**。本 wave は applySRLines と fit 配線にのみ触れる。
- **detail 分離規律**: 純計算は必ず detail-rules.js / finance-rules.js へ（displayName / periodLabelParts / isFinancialPL / srNearest / srLabelPlan / fitLogicalRange / detectSR マージ）。描画 lifecycle は detail-charts.js、DOM 配線は detail.js。
- **IIFE 公開面**: `window` 直下への新規公開は禁止。唯一の例外＝`DetailCharts.getPriceVisibleRange()`（#9 受入用デバッグゲッター・resizePrice と同型の薄ラッパ・DetailCharts 名前空間内）。
- **windowApi 15/17 は全タスクで不変**（detail-snapshot の WINDOW_API は window 直下 17 名の存在チェックのみ＝名前空間内の追加は非観測）。「ゲートを変えるため」の window 直公開は規律違反。
- **money.js / money-rules.js / advice.py は非接触**。money.css も非接触（#13 の CSS は detail.css 側）＝cockpit-e2e は必須ゲート外。触った場合のみ cockpit-e2e 212 check 全 PASS へ昇格（CLAUDE.md 条件）。
- **bsLeaderPlugin の datalabels 内部 API（`$datalabels` / `$layout._box._rect`）依存は SRI pin v2.2.0 の間のみ安定**。新設する bsNotePlugin は内部 API 非依存で設計する（D22）。
- **ローソク確定色・ZigZag 逆規約の意味は保持**（本 wave はどちらの算出にも触れない）。
- **finance-rules.js の currentRatio 本体（:36-39）と ratio の 0 返し（:19-22）は変更しない**（tests/finance-rules.test.js:37 の既存挙動固定を維持＝消費者側 ratioOrNull 化で解決する・D17）。
- **テスト実行コマンド**: node は `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`（**ディレクトリ渡し `tests/` は Node v24 で MODULE_NOT_FOUND**）。pytest は `PYTHONPATH=$(pwd) /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q`。ベースライン＝node 334 pass / pytest 228 pass。
- **mock 鯖のポートは 8200 固定**（前 wave 受入6本が全て 8200 ハードコード）。起動前に `lsof -i :8200` で専有チェックし、使用中なら中断する（並行セッションによる偽陰性の防止）。
- **2層ゲート**: 層1（無条件 MATCH）＝windowApi 15/17・canvasCount・pageErrors 0。層2（意図 diff 検分→再 baseline）＝computedStyles / domHash / chartContainerDims。層2 はタスク粒度ごとに検分→capture 昇格を繰り返す。
- **本 wave で確定した採否**（spec の「plan で確定」項目）: ATR 中央値の代替表示＝アコーディオン見出しバッジ（`.acc-metric`）／ETF の `selected-year-display` 「----」化＝不採用／S/R 連鎖マージの span 上限オプション＝非採用／CF diff=0 の浮遊「0」＝現状維持（非スコープ）／C4 の高さ補償＝採用（±28px のレイアウトシフトは実機サニティ項目7で許容確認）／`#desc-current-ratio` の N/A 上書き＝採用／detail.js:682-688 の stale コメント事実化＝採用／`roundRect`＝採用（受入で実描画を機械確認・NG なら手書き path へフォールバック）。
- **SDD ledger**: `.superpowers/sdd/2026-08-22-uiux-quickfix-sweep/progress.md`（per-plan workspace 規約）。

---
