# 実装計画: Plan 2 一覧窓表示（Portal Windowing / IntersectionObserver）

- date: 2026-07-12
- project: investment-portal
- 由来: 将来backlog A「一覧データ拡充＋動的化」の **Plan 2**（spec `docs/superpowers/specs/2026-07-11-universe-expansion-dynamic-refresh-design.md` §3.5）。Plan 1（データパイプライン・292銘柄）は本番LIVE済。
- effort/進め方: **xhigh + ultracode workflow**（ユーザー確定 2026-07-12）
- 描画構造: **セクター束ねを維持し「行」だけを窓化**（ユーザー確定 2026-07-12。spec のフラット前提を翻案）
- worktree: `worktree-plan2-portal-windowing`（b5f2c30 ベース）

---

## §0 目的・非目標

### 目的
ユニバース拡充（旧95→292銘柄）で `filterAndRenderPortal()` が **毎 filter/search/sort で全銘柄の DOM を全再構築**（292行×スパークライン）するコストを、**可視範囲＋増分だけを描画する窓化**で削減する。データ層・API・percentile/ランキング計算は一切変えない。

### 非目標（今回やらない）
1. サーバ page 分割（束B の percentile が全ユニバースをクライアントで要するため逆効果・spec §3.5 根拠）。
2. セクター束ね UX の変更（見出し・色・N社バッジ・クリック委譲・マークアップは**完全不変**）。
3. カード内容・ソート/フィルタ意味・検索デバウンス・`dataLoadState` 状態機械の変更。
4. 新規 window 露出（窓化は全て F2 IIFE private・inline handler から呼ばれる新関数は無い）。

---

## §1 現状の把握（b5f2c30 `index.html`）

`filterAndRenderPortal()`（1895〜2147）:
1. `container.innerHTML = ""`（1904）で全消去。
2. `STOCK_DATA` を走査し filter（sector/market/search/screener）→ `item` を組み立て `list` に push（1910〜1979）。
3. `screening-count` を `list.length` で更新（1982〜1986・**全ヒット数**）。
4. `list.sort(...)`（1989〜2000・NULL_LAST_KEYS 対応・グローバルソート）。
5. `groups = { industry: [item...] }`（2002〜2006・**挿入順=ソート済リスト内で各セクターが初出する順**）。
6. `groups` 空 → 「該当する企業が見つかりません」→ return（2008〜2014）。
7. `for (const ind in groups)`: `.sector-section`（title：セクター色/N社バッジ）＋`.portal-table`（thead ソートヘッダ）＋tbody（各行 = カード・inline SVG スパークライン `buildSparklineSVG`）→ `scrollWrap`（横スクロール）で包み container へ append（2016〜2140）。
8. `injectTermHelp(screening-panel)` ＋ `injectTermHelp(container)`（2142〜2146・売上3期見出し `data-term="growth-rate"` 活性化）。

確認済みの前提:
- ポータルは**ページ（body）スクロール**・`#portal-container` に overflow コンテナ無し → IntersectionObserver `root: null`（viewport）で良い。
- `_applyView` はクラス切替＋`scrollTo(0,0)` のみで**ポータルを再描画しない** → observer/sentinel はビュー遷移をまたいで持続（非表示時は IntersectionObserver が非intersecting で no-op）。`filterAndRenderPortal` が呼ばれるのは onload / sort / sector・market filter / search debounce のみ。
- `injectTermHelp(root)` は `:scope > .term-help` 冪等ガード付き＋subtree スコープ → **新セクションごとに呼んで安全**。
- `filterAndRenderPortal` は window 非露出（IIFE private・内部呼び出しのみ）。`portalSearchTimer` も IIFE private。
- `data/investment.db`（mock source）は 100銘柄/39セクター。

---

## §2 窓化アルゴリズム（セクター束ね維持・行窓化）

### §2.1 窓の単位
窓は **セクター束ね順にフラット化した行の列**＝`[sectorOrder[0]の全行..., sectorOrder[1]の全行..., ...]` に対して張る。この列は現行の視覚順（セクタークラスタ順・各セクター内ソート順）と**完全一致**する。行を先頭 `CHUNK` 件描画し、セクター境界を跨いだら新しい `.sector-section` を生成、同一セクター内は既存 tbody へ追記する。

### §2.2 状態（F2 IIFE private・新規 let）
```
let portalWin = null;   // 窓化の実行状態（filterAndRenderPortal ごとに作り直す）
// portalWin = {
//   flat: [item, ...],            // セクター束ね順フラット行列（描画対象全量）
//   sectorLen: { industry: n },   // セクター毎の総数（N社バッジ用・窓外込みの全数）
//   rendered: 0,                  // 描画済み件数（flat のカーソル）
//   curIndustry: null,            // 直近に append 中のセクター（境界検出）
//   curTbody: null,               // 直近セクションの tbody（チャンク跨ぎで継続）
//   sentinel: <div>,              // 末尾センチネル（null 可＝全量が1チャンクに収まる時）
//   observer: IntersectionObserver | null,
//   container: <#portal-container>,
// }
```
`CHUNK`（初期＝増分）= **60**（spec 例）。プリフェッチ余白 `PREFETCH_PX` = **600**（sentinel が viewport 下 600px 以内で次チャンク）。

### §2.3 filterAndRenderPortal の改修（差分は最小・§1 の 1〜6 は不変）
- **先頭**：既存の `portalSearchTimer` 取消・`dataLoadState` ガードは不変。**追加**＝`if (portalWin && portalWin.observer) portalWin.observer.disconnect();`（前回 observer が旧 sentinel を握ったまま `innerHTML=""` で剥がれるリーク/多重発火を防ぐ）→ `portalWin = null`。
- §1 の 2〜4（filter/screening-count/sort）は**そのまま**。
- §1 の 5（grouping）を**robust 化**：`groups` に加え `sectorOrder`（配列）を明示構築（integer-like key の並び替え罠回避）。
  ```
  const groups = {}, sectorOrder = [];
  list.forEach((item) => {
    if (!groups[item.industry]) { groups[item.industry] = []; sectorOrder.push(item.industry); }
    groups[item.industry].push(item);
  });
  ```
- §1 の 6（empty-state）は**そのまま**（return）。
- §1 の 7（全セクション描画ループ）を**窓化に置換**：
  ```
  // flat 行列 + sectorLen を構築
  const flat = [], sectorLen = {};
  sectorOrder.forEach((ind) => { sectorLen[ind] = groups[ind].length; groups[ind].forEach((it) => flat.push(it)); });
  const sentinel = flat.length > CHUNK ? _makePortalSentinel() : null;
  portalWin = { flat, sectorLen, rendered: 0, curIndustry: null, curTbody: null, sentinel, observer: null, container };
  _renderPortalChunk();                        // 初回チャンク（＋必要なら viewport 充填）
  if (sentinel) {
    container.appendChild(sentinel);
    portalWin.observer = new IntersectionObserver(_onPortalSentinel, { root: null, rootMargin: PREFETCH_PX + "px 0px" });
    portalWin.observer.observe(sentinel);
    _fillPortalToViewport();                    // 初期チャンクが viewport を埋めない場合の追い足し
  }
  ```
- §1 の 8（term-help）：**container 全体への `injectTermHelp` は廃し**、`screening-panel` への注入のみ main 関数に残す。各行/セクションの `data-term` 活性化は `_renderPortalChunk` が**新セクション生成時にそのセクションへ**注入する（増分対応）。
  ```
  if (window.Detail && typeof window.Detail.injectTermHelp === "function") {
    const panel = document.getElementById("screening-panel");
    if (panel) window.Detail.injectTermHelp(panel);
  }
  ```

### §2.4 新規 private 関数

**`_makePortalRow(item)`**（純 DOM 生成・§1 の 2054〜2131 の tr 構築を**そのまま切り出す**＝move-not-rewrite・`buildSparklineSVG` 呼び出し含む）。`<tr>` を返す。`tr.onclick = () => navigateToDetail(item.ticker)` と star-btn `onclick`（`event.stopPropagation()` 付き）も現状のまま。

**`_makePortalSection(industry, count)`**（§1 の 2016〜2051 の sector-section＋table shell を切り出す）。`{ sectionEl, tbody }` を返す。title の N社バッジは `count`（=sectorLen＝**全数**）を使う（窓外の未描画行も数に含む）。`getSectorColor`・sort ヘッダ（active-sort/sort-icon・`data-term="growth-rate"`）は現状のまま。table は現状どおり `scrollWrap`（overflow-x）で包む。

**`_makePortalSentinel()`**：`<div class="portal-sentinel" aria-hidden="true" style="height:1px"></div>` を返す。

**`_renderPortalChunk()`**：
```
const w = portalWin; if (!w) return;
const end = Math.min(w.rendered + CHUNK, w.flat.length);
for (let i = w.rendered; i < end; i++) {
  const item = w.flat[i];
  if (item.industry !== w.curIndustry) {          // セクター境界 → 新セクション
    w.curIndustry = item.industry;
    const sec = _makePortalSection(item.industry, w.sectorLen[item.industry]);
    if (w.sentinel) w.container.insertBefore(sec.sectionEl, w.sentinel);   // sentinel の手前へ
    else w.container.appendChild(sec.sectionEl);
    w.curTbody = sec.tbody;
    if (window.Detail && typeof window.Detail.injectTermHelp === "function") window.Detail.injectTermHelp(sec.sectionEl);
  }
  w.curTbody.appendChild(_makePortalRow(item));
}
w.rendered = end;
if (w.rendered >= w.flat.length && w.observer && w.sentinel) {   // 完了 → 後片付け
  w.observer.unobserve(w.sentinel); w.observer.disconnect(); w.observer = null;
  if (w.sentinel.parentNode) w.sentinel.parentNode.removeChild(w.sentinel); w.sentinel = null;
}
```

**`_onPortalSentinel(entries)`**：
```
if (!portalWin) return;
if (entries.some((e) => e.isIntersecting)) { _renderPortalChunk(); _fillPortalToViewport(); }
```

**`_fillPortalToViewport()`**（初回＆各チャンク後：sentinel がまだ viewport＋PREFETCH 内なら rAF で追い足し・全量到達で自然停止）：
```
const w = portalWin;
if (!w || !w.sentinel || w.rendered >= w.flat.length) return;
requestAnimationFrame(() => {
  const w2 = portalWin;
  if (!w2 || !w2.sentinel || w2.rendered >= w2.flat.length) return;
  const r = w2.sentinel.getBoundingClientRect();
  if (r.top < (window.innerHeight + PREFETCH_PX)) { _renderPortalChunk(); _fillPortalToViewport(); }
});
```
（`rendered` は単調増加＋`< flat.length` ガードで必ず停止。無限ループ不可。）

### §2.5 スパークライン lazy（自動達成）
窓外の行は DOM 生成されない＝`buildSparklineSVG` も窓内行の生成時のみ呼ばれる。**別機構は不要**（spec §3.5.4 の意図は行窓化で自動的に満たされる）。

---

## §3 不変条件（実装後に file:line で確認するチェックリスト）
1. **screening-count** は全ヒット数（`list.length`）のまま（窓化前に更新・不変）。
2. **empty-state** メッセージ（groups 空）は不変で return。
3. **ソート意味**（NULL_LAST_KEYS・localeCompare・asc/desc）不変＝flat は sort 後の groups から作るため順序完全一致。
4. **セクター見出し**（色・`ind.replace`・N社バッジ=全数・`sector-title-line`）不変。
5. **行マークアップ**（ticker/star-btn/company-clickable/salesText/PER/PBR/健全性バー/営業利益率/ROE/sparkline/growthBadge）**バイト等価**（切り出しのみ）。
6. **クリック委譲**（tr.onclick→navigateToDetail、star `event.stopPropagation()`＋toggleWatchlist）不変。
7. **term-help**（`data-term="growth-rate"` 見出し）が全セクションで活性・二重注入なし（冪等ガード）。
8. **検索デバウンス**（180ms・onPortalSearchInput）・**dataLoadState** 状態機械・**0件/失敗UI** 不変。
9. **F2 規律**：新関数/定数は全て IIFE private（inline handler から呼ばれない）＝`Object.assign(window,{...})` への追加は**不要**（追加しないことを確認）。
10. **横スクロール**（`scrollWrap` overflow-x）不変。
11. observer は filterAndRenderPortal 冒頭で必ず disconnect（リーク/多重発火なし）。
12. `portal-container` の直接の子＝`.sector-section`* ＋（未完了時）末尾 `.portal-sentinel`。他コードは `#portal-container` を innerHTML でしか触らない（grep 済＝1824/1903 のみ）ので子構造前提の外部依存なし。

---

## §4 検証戦略

### §4.1 ユニット
窓化は DOM/observer 依存で純関数ユニット対象外。既存 `node --test`（detail-rules/finance-rules/money-rules/screener-rules/cross-section-rules）は**回帰しないこと**を確認（触っていないので緑維持のはず）。

### §4.2 スナップショット突合（既存ハーネス）
`scratchpad/f2-snapshot.js`（portal/detail/money の DOM/canvas/style/dims/公開面/ticker切替/pageerror 突合）を before/after で回し、**公開面 20 名・pageerror0** が不変であることを確認。**注意**：窓化で portal の初期 DOM 件数は減る（=snapshot の portal DOM 差分は「窓化による意図的差」）。→ snapshot は「公開面・pageerror・detail/money 不変」を gate にし、portal の件数差は窓化の正当差として扱う（f2-snapshot の比較粒度を確認し、必要なら portal は件数でなく「先頭N件描画＋sentinel 存在」を別アサート）。

### §4.3 窓化専用 Playwright/node テスト（新規 `scratchpad/plan2-window-verify.js`）
`scratchpad/mock_prod_server.py` を**多銘柄（~300）に増幅**（`?inflate=300` 相当のクエリ or 環境変数で ticker_master を合成複製・financials/prices は既存の決定論合成を流用）した上で:
1. **初期描画**：`.portal-table tbody tr` が `CHUNK`（60）±セクター境界で概ね 60 前後、かつ全 292 未満（=窓化されている）。`.portal-sentinel` が1個存在。
2. **スクロール増分**：`window.scrollTo(0, document.body.scrollHeight)` → 待機 → tr 件数が増える。繰り返して全量（292）到達で sentinel 消滅。
3. **filter/search/sort/sector リセット**：ソートヘッダクリック / セクターフィルタ / 検索入力で tr 件数が先頭チャンクに**リセット**（増えた状態から戻る）＋順序が新ソートで正しい。
4. **percentile/ランキング不変**：詳細ビューの相対位置カード・#ranking-view が窓化の影響を受けない（全量計算＝STOCK_DATA 由来で不変）。
5. **term-help**：初期＆スクロール後の各セクション見出し `.term-help` が1個ずつ（二重なし）。
6. **クリック→detail**：窓内行クリックで navigateToDetail 発火（hash/detail-view active）。スクロールで後から出た行も同様。
7. **pageerror 0**・**空フィルタ0件**（該当なしメッセージ）・**単一セクターのみ**・**ETF_only**・**watch_only** の各経路で例外なし。

### §4.4 実機サニティ（headless 不可分＝本人）
GPU/描画（スパークライン/カード）と実スクロール体感は本人 FHD 実機で確認（[[canvas-black-firstpaint-entrance-animation-fhd]] 系の描画差は本タスク非対象だが、窓化で初期描画数が減る＝初回描画負荷は下がる方向）。

---

## §5 実装フェーズ（SDD）
- **T1**：filterAndRenderPortal 窓化＋新 private 関数（§2）実装（move-not-rewrite で行/セクション生成を切り出し）。
- **T2**：mock server 多銘柄増幅＋`plan2-window-verify.js`（§4.3）実装。
- **T3**：f2-snapshot 突合（§4.2）＋ node --test 回帰（§4.1）。
- **T4**：whole-branch 敵対検証 workflow（§6）。confirmed のみ修正。
- **T5**：記憶整理＋ハンドオフ（本人実機サニティ＋push＝次回起点）。

## §6 敵対検証（ultracode workflow・多観点）
- **window reset race**：検索デバウンス中の連続入力・sort連打で observer 多重/古い portalWin が残らないか。
- **sector 境界**：チャンク境界がセクター途中に落ちた時、次チャンクが同一 tbody に継続 append するか（見出し重複/欠落なし）。N社バッジ＝全数か。
- **observer leak**：view 遷移（portal→detail→portal）・連続 filter で observer が積み上がらないか（毎回 disconnect）。
- **不変条件破れ**：§3 の 12 項目を diff で機械確認。
- **perf**：初期 DOM 件数削減の実証（292→~60）。
- **edge**：empty / single-sector / ETF_only / watch_only(0件) / 検索0件 / flat.length<=CHUNK（sentinel 無し経路）/ 巨大 viewport 自動充填。

---

## §7 統合・ハンドオフ
- 検証通過後、`ExitWorktree`(keep) で main へ → `git merge worktree-plan2-portal-windowing` → 本人が実機サニティ後に `git push`（Vercel 本番デプロイ発火・**通常URL/persona 両方 curl 確認**＝[[investment-portal-dual-deploy-persona]]）。
- SW 無し・push 即反映（investment-portal は静的配信）。
- 次回起点＝**本人実機サニティ→push**。
