# toolbar-terms（recon実測 2026-08-21・HEAD 8e44298）

## summary
- D1（迷子「?」）・D2（acc-desc/acc-full-desc 同文二重）とも現HEADで**症状健在**。直近waveは非修正（spec §13:311 で「トグルバー迷子『?』」を明示的に後送り）。
- 監査の修正方針は**両方とも今も有効**。ただしテーマA 12px床で `.term-help` 円が 14px→17px・font 12px に拡大＝迷子チップの視覚的存在感は監査時より**増大**（悪化方向）。
- 該当行は index.html が +5行シフト（1220→1225 等）・detail.js は監査時と同一行（injectTermHelp 224-233 / acc生成 359-370）。マークアップ構造は wave 前後で不変（diff で確認）。
- D1 修正案＝空span廃止＋「グループ概念はグループラベルに内包・ボタン固有概念は `.ctrl-pair` ラッパでボタンに密着」（index.html 約7行＋detail.css 約3行・JS無改修）。D2＝`.acc-item.expanded .acc-desc{display:none}` 1行。
- 工数=小（D1）＋極小（D2）。既存 node テスト（termHelp文字列のみ検証）は非破壊。--th-shift クランプは位置計測ベースなので DOM 移設後も動作。

## notes

### D1: 迷子「?」の機構（現HEADで裏取り済）
- 注入器: `detail.js:224-233 injectTermHelp(root)` が `[data-term]` 全要素に `termHelp()`（`detail.js:216-223`・`<span class="term-help" tabindex="0" role="note">?</span>`）を `insertAdjacentHTML("beforeend")`。冪等ガード=`:scope > .term-help`（:229）。呼出し起点は `detail.js:693`（`injectTermHelp(#detail-view)`・ETF でも走るよう early-return より前）。
- 空アンカー（テキスト無し `.ma-label`）が「?」だけのチップとして浮遊する現行マークアップ:
  - `index.html:1225` — `MA 75` ボタン直後の `<span class="ma-label" data-term="ma"></span>`（空）
  - `index.html:1231` — `KC 20` 直後の `data-term="keltner"`（空）
  - `index.html:1236-1238` — `S/R線`/`T/R線`/`VWAP` 直後の `data-term="sr"/"zigzag"/"vwap"`（空）
  - `index.html:1229` — 「エンベロープ」ラベル自体に `data-term="bb"`（テキスト有=?がラベル内に付く正常形）。KC 分だけ別に浮く＝監査指摘どおり紐付け規則の不統一が現存。
  - `index.html:1240` — `.vol-label data-term="volume"` はテキスト有＝正常形。
- グロッサリ側: keltner/vwap/sr/zigzag/ma/bb/volume すべて `detail-rules.js:50-83 INDICATOR_GLOSSARY` に実在＝空spanには必ず「?」が入る（no-op にならない）。
- レイアウト: `.ctrl-group`（detail.css:479-484）は flex gap:5px＝空chipは前のボタンから 5px 離れた独立 flex 子。480px では `.ma-control-bar{flex-wrap:wrap}`（detail.css:454）で**ボタンと「?」の間でも改行しうる**＝監査の「3行折返しで悪化」の機構が現存。
- wave 前後の差分（git diff 32eb0ae..HEAD で確認）:
  - index.html のツールバー markup 行は**無変更**（diff ヒット0）。行番号のみ +5 シフト（旧1220→現1225・旧1226→現1231・旧1231-1233→現1236-1238。`git show 32eb0ae:index.html` で旧行を照合済）。
  - `.term-help` 円 14px→**17px**・font 12px（detail.css:938-945・spec §4.5）＋ `::after` 本文 12px/sans 化（detail.css:947-962・1024-1031）。**12px床がチップ表示を壊してはいない**（円17px内に「?」12pxは収まる・機能退行なし）が、浮遊チップが監査時より大きく目立つ。
  - `--ix-slate` トークン変更が `.ma-label` 色（detail.css:492-499）に波及（spec §4 の許容視覚差分として設計済・本項とは独立）。

### D2: 説明文二重（現HEADで裏取り済）
- `detail.js:359-365` `acc-head` 生成に `<span class="acc-desc">meta.desc</span>`、`detail.js:368-370` で同一 `meta.desc` を `.acc-full-desc` として body に再掲＝**同文二重が現存**（監査と同一行番号）。
- 展開状態クラス: `detail.js:326` `wrap.classList.add("expanded")` / `:338` remove＝CSS だけで出し分け可能。
- 現CSS: `.acc-desc`（detail.css:621-628・max-width:46%+ellipsis）/`.acc-body .acc-full-desc`（detail.css:640・wave で 0.68rem→12px 化）。`.acc-item.expanded` セレクタは既存（detail.css:607）だが **`.acc-desc` を隠すルールは無い**（grep で不在確認）。12px 化で二重文が監査時より読みやすく＝二重が目立つ方向。

### overflow クリップ既知問題との整合
- ツールバーを載せる `.card`（index.html:577-586）は overflow 未指定＝visible 既定→ tooltip はクリップされない（既知制約「載せるカードは overflow:visible 必須」を満たす）。
- `.acc-item` は明示 `overflow:visible`（detail.css:602-605・コメントで term-help クリップ回避を明記）＝アコーディオン側も安全。
- 横クランプ: `index.html:2608-2633` の委譲リスナー（focusin/mouseover）が `.term-help` の実位置を `getBoundingClientRect` で計測し `--th-shift` を書込む方式＝**「?」をどの親（ラベル内/ctrl-pair 内）へ移設しても位置計測は追従**（DOM 依存なし）。

### テスト面
- `tests/detail-termhelp.test.js`（88行）は `termHelp()` の文字列出力のみ検証（DOM 副作用は Playwright 委譲と明記）＝下記 proposal は node テスト非破壊。injectTermHelp 本体のシグネチャも不変。

## proposal

### D1（工数: 小＝index.html 約7行＋detail.css 約3行・JS 無改修）
方針＝「グループ概念の?はグループラベルに内包・ボタン固有概念の?は改行不可ラッパでボタンに密着」。空 span 全廃。
1. `index.html:1222` — `<span class="ma-label">移動平均</span>` に `data-term="ma"` を付与（?がラベル内に付く=1229 の「エンベロープ」bb と同形）。`index.html:1225` の空 span `data-term="ma"` を削除。
2. `index.html:1231` — `<button id="ind-btn-keltner">KC 20</button><span …keltner></span>` を `<span class="ctrl-pair" data-term="keltner"><button class="ma-btn" id="ind-btn-keltner" onclick="toggleKeltner()">KC 20</button></span>` に変更（空 span 削除・data-term はラッパへ）。injectTermHelp が beforeend でラッパ末尾（=ボタン直後）に?を注入し、冪等ガード `:scope > .term-help` もそのまま効く。
3. `index.html:1236-1238` — S/R線(sr)/T/R線(zigzag)/VWAP(vwap) も同じ `.ctrl-pair` 化（3行）。
4. `detail.css`（.ma-btn 群の近傍 ~:500 台に追加）:
   ```css
   .ctrl-pair { display: inline-flex; align-items: center; }
   .ctrl-pair > .term-help { margin-left: 3px; }  /* 既定5pxより密着 */
   ```
   inline-flex ラッパにより 480px の flex-wrap でも**ボタンと?が同一行に固定**（迷子の最悪ケース根絶）。
5. ボタン内包（`<button>` 内に tabindex=0 span）は**採用しない**: ネスト interactive で ?クリックが onclick(toggle) を誘発・focus 挙動破綻のため。ラッパ密着が安全形。
- 検証: Playwright で 1280px/480px の toolbar スクショ＋`.term-help` が空テキスト親を持たないこと（`document.querySelectorAll('.ma-control-bar .ma-label:empty')` = 0）・tooltip hover が clamp されること。

### D2（工数: 極小＝detail.css 1行）
- `detail.css:628` 付近（.acc-desc 定義直後）に追加:
  ```css
  .acc-item.expanded .acc-desc { display: none; }
  ```
- 監査案そのまま有効。collapse 時（.expanded 除去・detail.js:338）はヘッダ desc が復帰＝narrow の「ヘッダ省略+直下全文」二重も同時解消。JS 無改修。
- 検証: アコーディオン展開時にヘッダ右側 desc が消え body の `.acc-full-desc` のみ表示、折り畳みで復帰。

## risks
- `.ctrl-pair` ラッパ追加はツールバー DOM 構造変更＝`#ind-btn-*` を直接 querySelector する既存 JS（toggle 系・chip active 付与）は **id 参照のため影響なし**を確認済だが、Playwright の CSS セレクタ（`.ctrl-group > .ma-btn` 等の直下参照）があれば要追従（現リポの tests/ には該当なし・将来の spec 内セレクタ要確認）。
- `data-term` をラッパ（非 span.ma-label）へ移すため、`.ma-label` の uppercase/bold スタイルが「?」に及ばなくなる＝視覚差分は微小（term-help は自前スタイルで自己完結・detail.css:938-945）。
- D2 は CSS のみだが、`.acc-desc` を情報源として読む JS/テストが将来増えた場合 display:none でも textContent は残る＝機能退行なし（現在参照ゼロ）。
- カードタイトル側の空 span 群（index.html:1253/1297/1316/1326/1394 の `data-term` 空 span）は同型の「無所属?」だがタイトル直後に並ぶため監査は非指摘＝本修正のスコープ外（統一するなら別途・同じ ctrl-pair 不要でタイトル内包化のみ）。
- テーマA 12px床は本修正と干渉しない（円17px は据置のまま・縮小はテーマA検収基準に抵触するため触らない）。

## sites
- index.html:1220-1241 — ma-control-bar 全体（現行トグルバー markup）
- index.html:1222 — 「移動平均」グループラベル（D1 fix: data-term="ma" 付与先）
- index.html:1225 — 空 span data-term="ma"（迷子?発生源①・削除対象）
- index.html:1229 — 「エンベロープ」ラベル data-term="bb"（正常形の参照実装）
- index.html:1231 — KC 20 ボタン＋空 span data-term="keltner"（発生源②・ctrl-pair 化対象）
- index.html:1236-1238 — S/R線/T/R線/VWAP＋空 span sr/zigzag/vwap（発生源③〜⑤・ctrl-pair 化対象）
- index.html:1240 — vol-label data-term="volume"（テキスト有=正常形・変更不要）
- index.html:2608-2633 — --th-shift/--mh-shift クランプ委譲リスナー（位置計測ベース=DOM 移設に追従）
- index.html:577-586 — .card 定義（overflow 未指定=visible・tooltip 非クリップ）
- detail.js:216-223 — termHelp(term) 文字列ビルダー
- detail.js:224-233 — injectTermHelp（beforeend 注入＋:scope>.term-help 冪等ガード・無改修で proposal 対応可）
- detail.js:693 — detail-view 全体への注入起点（ETF 含む全経路）
- detail.js:359-365 — acc-head 生成（.acc-desc 同文①）
- detail.js:368-370 — .acc-full-desc 生成（同文②）
- detail.js:326/338 — .expanded クラス付与/除去（D2 の CSS フック）
- detail.css:479-484 — .ctrl-group（flex gap:5px=浮遊チップの離隔）
- detail.css:454 — 480px .ma-control-bar flex-wrap（迷子悪化条件）
- detail.css:492-499 — .ma-label（空 span の現スタイル・--ix-slate 波及先）
- detail.css:621-628 — .acc-desc（ヘッダ側・D2 追加行の挿入位置直後）
- detail.css:640 — .acc-body .acc-full-desc（wave で 0.68rem→12px）
- detail.css:602-605 — .acc-item overflow:visible（term-help クリップ回避の既存担保）
- detail.css:938-963 — .term-help/.term-help::after（wave で円 14→17px・font 12px）
- detail.css:1024-1031 — テーマA⑦ sans 化ブロック（acc-desc/acc-full-desc/term-help::after 包含）
- detail-rules.js:50-83 — INDICATOR_GLOSSARY（ma/bb/keltner/sr/zigzag/vwap/volume 全て実在）
- tests/detail-termhelp.test.js — termHelp 文字列のみ検証（proposal 非破壊）
- docs/superpowers/audits/2026-08-09-chart-callout-audit.md:158-160 — 監査 D 節（旧行番号）
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:311 — トグルバー迷子「?」の明示後送り（§13）
- docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md:72-74 — §4.5 12px床＋term-help 円 17px 化
