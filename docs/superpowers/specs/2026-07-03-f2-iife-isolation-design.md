# F2: index.html inline `<script>` の IIFE 隔離 — 設計スペック

- date: 2026-07-03
- scope: `index.html` の唯一の inline `<script>`（**行 1440–2109**、約670行）を IIFE で包み、グローバル汚染（46トップレベル宣言）を「意図した公開面のみ」へ絞る
- 制約: **挙動完全保存**（前回 detail 分離と同じ move-not-rewrite・描画/ロジック本体は無改変）
- 位置づけ: ポータル監査 F2（「最リスク高・payoff 最小＝公開漏れ=無言故障」）の**専用セッション**。understand フェーズを ultracode workflow（wf_1c71d8f2-462・11 agents）で網羅マップ化し、敵対的完全性クリティックで裏取り済み。

## 1. 現状の構造（偵察で確定）

- inline `<script>` は **1ブロックのみ**（1440–2109）。他は外部 CDN/module。
- 読込順（依存）: `dataClient.js` → `finance-rules.js` → `detail-rules.js` → **[inline 1440-2109]** → `detail-charts.js` → `detail.js` → `money-rules.js` → `money.js`
- ∴ inline より**後**にロードされる `detail-charts.js` / `detail.js` は inline のグローバルを **free-var 参照**する（IIFE で隠すと壊れる）。inline より前の3本は inline 名を参照しない（`detail-rules.js` は `FinanceRules` のみ）。

## 2. inline ブロックの46宣言の分類

### A. 公開必須（IIFE 後も外部から到達必須）= 20

**A-1. 生きたトップレベル束縛として維持（= 2・最重要・window 値コピー禁止）**
| 名前 | 行 | 理由 |
|---|---|---|
| `currentTicker` | 1471 | detail.js:206 が `"use strict"` 下で **bare 代入**（`currentTicker = ticker`）／detail-charts.js/detail.js が bare read。**双方向共有可変**。window への一回値コピーでは再代入が伝播せず desync、かつ strict bare-write は生束縛が無いと ReferenceError。 |
| `currentView` | 1481 | inline（`_applyView`/`showView`）が書き、detail-charts.js:188 が呼出時に bare read。同様に一回コピー不可。 |

**A-2. 末尾 `Object.assign(window, {...})` で一括公開（= 18・関数/const で識別子不変）**
- cross-script free-var: `esc`(1449) / `ICO`(1454) / `DEFAULT_CURRENCY`(1467) / `currencyBadge`(1514) / `isWatched`(1563) / `trackEvent`(2062) / `showView`(2082)
- inline HTML handler 依存: `toggleScreening` `applyScreening` `resetScreening` `toggleWatchlist` `handleContactSubmit` `openModal` `closeModal` `retryLoadData` `onPortalSearchInput` `setSort` `navigateToPortal`

### B. private 化可（IIFE 内へ・外部参照ゼロをクリティックが grep 反証で確認）= 26
`DEFAULT_COUNTRY` `DEFAULT_TICKER` `sortKey` `sortAsc` `portalSearchTimer` `dataLoadState` `VIEW_IDS` `activeSectorFilter` `showDetailSectors` `SECTOR_ACCENT_TOKENS` `SECTOR_ACCENT_COLORS` `getSectorColor` `fmtMarketCap` `screeningActive` `screening` `passesScreening` `watchlist` `watchChipLabel` `renderPortalStatus` `loadPortalData` `filterAndRenderPortal` `buildSparklineSVG` `initSectorFilter` `setSectorFilter` `_applyView` `onHashChange`

（20 + 26 = 46 ✓ 完全に説明がつく。falsePrivatizations = 0）

### C. IIFE 非対象（inline に宣言が無い＝シャドウしない・確認済）
- inline handler 依存だが inline 未宣言（他 script が window 公開済）: `exportCSV` `toggleMA/BB/SR/TR/RSI/MACD` `compareSearchInput` `setComparePeriod` `openCompareModal` `addToCompare` `removeFromCompare` `MCC`（detail.js/money.js 由来）
- detail-charts/detail.js の free-var で inline 由来でないもの: `STOCK_DATA`/`getStock`（dataClient.js:56）・`animateNumber`（detail.js:127→`window.animateNumber`）・`DetailRules`/`FinanceRules`/`DetailCharts`（各 module）

## 3. IIFE 化の実装方針（move-not-rewrite）

```
<script>
  // 生きた cross-script 共有束縛（detail.js の strict bare-write / detail-charts の bare-read が依存）。
  // トップレベル let のまま＝現状のグローバル字句束縛を保持（window プロパティは作らない＝最も忠実）。
  let currentTicker, currentView;
  (function () {
    Chart.register(ChartDataLabels);
    ...（1441–2108 をそのまま。ただし↓2箇所だけ let を落として代入に）...
    // 1471:  currentTicker = DEFAULT_TICKER;   ← 元 `let currentTicker = DEFAULT_TICKER;`
    // 1481:  currentView = "portal";           ← 元 `let currentView = "portal";`
    ...
    // IIFE 最終行（try の外・確実に到達させる）で公開を一括:
    Object.assign(window, {
      esc, ICO, DEFAULT_CURRENCY, currencyBadge, isWatched, trackEvent, showView,
      toggleScreening, applyScreening, resetScreening, toggleWatchlist, handleContactSubmit,
      openModal, closeModal, retryLoadData, onPortalSearchInput, setSort, navigateToPortal,
    });
  })();
</script>
```

### 実装ガード（クリティックが特定した本番破壊の芽・必須）
1. **DEFAULT_TICKER トラップ回避**: `currentTicker` の**宣言だけ**を IIFE 外へ hoist し、**初期化（= DEFAULT_TICKER 参照）は IIFE 内 1471 に残す**。宣言と初期化を一緒に外へ出すと、外スコープから IIFE 内 `const DEFAULT_TICKER`(1469) が見えず load 時 ReferenceError で全滅する。`currentView` はリテラル初期化ゆえトラップ無し（同様に宣言を外・代入を内）。
2. **生束縛の維持**: `currentTicker`/`currentView` は末尾 `Object.assign` の値スナップショットに**混ぜない**。IIFE 外の `let` 実束縛として残し、bare read/write を双方向で通す。
3. **`'use strict'` は付けない**: `A3`（暗黙global）は空で事故 global は無いが、strict は `this`（IIFE 内 `this===window` 依存）・silent-fail 代入の throw 化・`arguments` 等の意味を変える。純 move 保存を優先し strict 化は別タスク（回帰検証後）。
4. **公開行の到達保証**: 末尾 `Object.assign` を IIFE 最終行・`try` の外に置き、途中例外で公開スキップ→全 handler 未定義化を防ぐ（関数宣言は hoist ゆえリスク低だが防御的に）。
5. **`window.onload`(1691)** は IIFE 内の window 代入のまま位置保存（二重代入・順序変更を作らない）。
6. **配置順ハザード無し**: 公開は inline 同期実行で完了。参照側（detail-charts/detail/money）は after ロードかつ実参照はユーザー操作後＝公開済で安全。`SECTOR_ACCENT_COLORS`/`getSectorColor` の起動時 `getComputedStyle` 初期化も配置位置不変で DOM/CSS 可用性不変。

### 併せて訂正（runtime 無害だが将来地雷）
- `detail.js:14,20` のヘッダ契約コメントが `watchlist`/`watchChipLabel` を「inline から free-var 参照」と誤記（実コードは非参照）。private 化に合わせコメントを実態（inline private・非公開）へ訂正。

## 4. 検証計画（挙動完全保存の gate）
- **before/after snapshot**: `scratchpad/mock_prod_server.py` で本番 index.html＋`/api/market/*` をモック配信し、**portal / detail / money 3ビュー**の DOM/computedStyles/canvasCount/chartDims/**window API 公開集合**/pageerror を before（現行）→after（IIFE 化後）で突合。`✅ MATCH` が gate。
- **unit**: `node --test tests/*.test.js`（120緑・本変更は純関数非対象ゆえ不変を確認）。
- **headless pageerror**: 3ビュー遷移＋詳細ビュー遷移＋★ウォッチトグルで `currentTicker`（detail.js 書込→inline read）/`currentView`（inline 書込→detail-charts read）の**双方向**が通ること・pageerror0 を確認。
- **本番反映は本人実機サニティ後**（前回 detail 分離と同じループ）。push=Vercel Git 連携で本番デプロイ発火。

## payoff
- inline ブロックが window へ漏らす名: **46 → 20（意図した公開のみ）**。detail.js/money.js と同じ「IIFE + 明示公開面」規律にポータルを揃える。残る F2 外スコープ = 厳格 `script-src` CSP（P7 と束ねる）。
