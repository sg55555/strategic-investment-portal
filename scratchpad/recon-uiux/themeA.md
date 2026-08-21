# themeA（recon実測 2026-08-09・HEAD 143df86・wf_1876fa2c-3ac）

## summary
theme-a-tuning.css 全8項目の本体反映先を実測で確定した。トークンは index.html:70(--ix-slate)・money.css:12(非D --c-text-mute)・money.css:759-775(D層 --c-text-mute/--c-text-faint/--c-slate)の値書換で反映でき、--ix-sans のみ新規追加。!important 4箇所の発生源は index.html:2101-2102(sector-title JS)・2144/2153/2170/2178(td色JS)・1206(CSVボタンinline)・detail.js:663/665(単位注記inline)で、発生源修正により全!importantを撤去可能。グロー廃止⑥の全セレクタ・12px床⑧の全クラスは実在を確認（staleセレクタ0件）。最大の罠は「overrideは最後注入ゆえ勝てていたが、本体でbase宣言だけ12px化しても後続media内縮小(index.html:903/924/928、detail.css:408/439、money.css:331/555/565/741)が後勝ちする」ことで、media内宣言の同時書換が必須。監査doc(32eb0ae)とのfile:line矛盾は検出なし（本報告の行番号は全て143df86実測値）。

## notes
【データフロー】ポータル表(sector-title/td色/val-badge)は index.html 内 IIFE の renderPortal 系テンプレ文字列が innerHTML で毎描画生成（L2097-2103, 2144-2186）。詳細ヘッダは detail.js updateFinancialViews 内 L661-669 が #active-company-header(.active-company-title, index.html:1183) を innerHTML 生成。#csv-export-btn は静的HTML(index.html:1206)。【現行値】--ix-slate=#6b7d8a(4.3:1)・--ix-text-dim=#8ba2af／money.css D層: --c-text-mute=#54636f・--c-text-faint=#6e8492・--c-slate=#6b7d8a（非D: mute=#5b6478・faint=#8b94a8・slate=#64748b）。--ix-sans は本体に存在しない（新規トークン）。sub-12px(0.50-0.72rem)出現概数: index.html 16 / detail.css 17 / money.css 61、px指定(10-11px)は detail.css の sig/ht/dp/relpos/term-help 系9行に集中。⑧床リスト全クラス（portal 15・detail 29・mcc 97）の実在を機械照合済＝staleセレクタ0件。⑥グロー廃止の全セレクタも実在確認済（text-shadow総数42のうち廃止対象を全行特定・上記sites参照）。【制約】(a) text-shadow は継承プロパティ＝親削除で子も消える／維持親(.mcc-hero-power)には small 用遮断ルール追加が必要。(b) inline style でも var() は使える＝JS直書き4箇所は \"color: var(--ix-slate);\" 化がトークン一元化として最善。(c) money.css の :root は index.html :root より後読みだが --ix-*/--c-* は名前空間非衝突。(d) 監査doc 2026-08-09-chart-callout-audit.md は本任務対象行への言及が薄く file:line 矛盾は検出されず、本報告の行番号は全て worktree(143df86) 実測。

## proposal
正式反映は「override CSSを移植」でなく発生源修正＋in-place編集で行う: (1)トークン: index.html:70 を #7f95a3 へ、:root(L53〜)に --ix-sans を新規追加、money.css:12 の --c-text-mute を #7b859b、L774 の --c-text-faint→#8299a7/--c-text-mute→#7f95a3、L775 の --c-slate→#7f95a3。(2)!important全廃: index.html:2101 の ${sectorColor}88→var(--ix-text)、2102 の ${sectorColor}99→var(--ix-text-dim)、2144/2153/2170/2178 の \"color: #6b7d8a;\"→\"color: var(--ix-slate);\"（2061のdivも同時に）、1206 の 0.72rem→12px、detail.js:665 の 0.7rem→12px。これで theme-a の !important 4ルール(L41-42,45,161-162)は本体に持ち込まない。(3)⑥: sites記載の各 text-shadow 宣言を in-place 削除し、money.css:866 直後に [D] .mcc-hero-power small { text-shadow:none } を追加。(4)⑦: money.css:1128/1011 を var(--ix-sans)+letter-spacing:0+line-height:1.65 に書換、L1276-1280 グループから .mcc-nisa-gate を除去、theme-a:85-98 の免責/注記グループルールは detail.css 末尾＋money.css 末尾（または各基底宣言）に font-family:var(--ix-sans);letter-spacing:0;line-height:1.65 として正式追加。(5)①⑧: 各基底宣言の font-size を12pxへ in-place 書換（0.6-0.74rem群＋detail.css:899-958 の10-11px群）、term-help/mcc-help は w/h 17px+12px化（detail.css:941-942, money.css:255/257/272）。同時に media 内縮小 index.html:903/924/928・detail.css:408/439・money.css:331/555/565/741 も12px化（後勝ちで床を破るため必須）。(6).val-badge.fair: index.html:447 に opacity:0.35 追記（非表示化するなら 2149/2158 の生成を空文字に）。

## risks
- 【cascade罠・最重要】overrideは</head>直前注入＝常に最後勝ちだったが、本体では base 宣言を12px化しても後続 @media 内の縮小宣言(index.html:903/924/928, detail.css:408/439, money.css:331/555/565/741)が同特異性・後方orderで勝つ。media内も同時書換しないと狭幅で床割れが再発（overrideとの視覚差分として検収で検出される）
- .active-company-title span[style*="font-size"] は detail.js:663 のティッカー(0.9rem=14.4px)にも当たり現行overrideは12pxへ縮小している。発生源修正で665のみ12px化すると663は14.4pxに戻る＝override環境との見た目差。spec でどちらを正とするか明記が必要
- --ix-slate を #7f95a3 化すると td 以外の使用9箇所(.ma-label detail.css:495, .ma-btn:hover:514, index.html:695/832/941 等)も明るくなる。overrideは td[style] しか触っていないため厳密には視覚差分が出る（方向性は同じ可読性向上だが検収基準に注意）。逆に .val-badge.fair の rgba(107,125,138,…)背景/枠(index.html:447)はリテラルのため追従しない
- td[style*="6b7d8a"] ルールを本体に持ち込まず JS を var(--ix-slate) 化する案は、テスト/スナップショットが inline hex を期待している場合に差分が出る（detail-snapshot.js / f2-snapshot.js の computedStyles 突合を再実行のこと）
- money.css:1276-1280 のグループセレクタから .mcc-nisa-gate を抜く編集は、単純な後方追記(奪回)と違い他4クラスの mono を壊さないよう注意。追記方式なら二重定義が残り将来の混乱源
- 非D側の --c-text-faint は override でも本体案でも未変更（保険は --c-text-mute のみ）。実運用は常時 data-theme=D なので影響なしだが、テーマ切替コードが将来復活すると非Dで faint が暗いまま
- ⑥で .mcc-hero-ref-amount(money.css:853, shadow有) は override 廃止リスト外＝維持が仕様。誤って一括 text-shadow 掃除すると過剰廃止になる（廃止は sites 列挙行に限定）
- sector-count-badge の border-color:${sectorColor}33 と sector-title-line のグラデ(2103)はアクセントとして残す仕様。2101-2102 を書き換える際に一括置換で消さないこと
- term-help/mcc-help の円14→17px はレイアウト寸法変更＝表ヘッダ(index.html:2116 の th 内 term-help)で折返し/ズレの可能性。実機で表ヘッダ幅を確認

## sites
- index.html:53 — :root トークンブロック開始（〜L120台）。--ix-sans 新規追加の挿入先。ここで定義すれば detail.css/money.css からも var(--ix-sans) 参照可
- index.html:70 — --ix-slate: #6b7d8a; → #7f95a3 に書換（⑤の土台）。CSS使用≈9箇所（index.html:695,832,941／detail.css:495,510,514ほか）・JS使用0
- index.html:71 — --ix-text-dim: #8ba2af;（現在値・overrideのfallbackと一致・値変更不要）。使用≈39箇所（index.html 13＋detail.css 26）
- money.css:6 — :root（非D）。L12 --c-text-mute:#5b6478 → #7b859b（非D保険）。L12 --c-text-faint:#8b94a8 は override 対象外（D専用）
- money.css:759 — :root[data-theme="D"] ブロック開始。L774 --c-text-faint:#6e8492→#8299a7・--c-text-mute:#54636f→#7f95a3、L775 --c-slate:#6b7d8a→#7f95a3 に書換（②⑤）
- index.html:2101 — !important①発生源: renderPortal内 sector-title テンプレ `<span style="color:${sectorColor}88;">${esc(ind…)}</span>`。ここを color:var(--ix-text) 直書きor style撤去+CSS化すれば !important 不要
- index.html:2102 — 同テンプレ `<span class="sector-count-badge" style="border-color:${sectorColor}33;color:${sectorColor}99;">${count}社</span>`。color のみ var(--ix-text-dim) へ（border-color:${sectorColor}33 はアクセントとして残す）
- index.html:2144 — !important②発生源: `let perStyle = "color: #6b7d8a;";`（同型が 2153 pbrStyle / 2170 opStyle / 2178 roeStyle）。4箇所を "color: var(--ix-slate);" へ変えればトークン再宣言に自動追従し td[style*="6b7d8a"] !important ルール自体が不要化
- index.html:2061 — 補足: 空状態div `style="…color:#6b7d8a…"`。override の td[style*] セレクタは div のため非適用＝現状も暗いまま。本体反映時に同時に var(--ix-slate) 化推奨
- index.html:1206 — !important③発生源: #csv-export-btn の inline style 内 font-size:0.72rem（静的HTML）。12px に直接書換（or inline撤去してCSS移設）で !important 不要
- detail.js:665 — !important④発生源: active-company-header テンプレ `<span style="font-size:0.7rem;color:#8ba2af;…">単位: ${unitLabel}</span>`。0.7rem(11.2px)→12px 直接書換が本筋
- detail.js:663 — ⚠override誤爆点: 同テンプレのティッカー `<span style="color:#475569;font-size:0.9rem;">(${ticker})</span>` も .active-company-title span[style*="font-size"] にマッチし 14.4px→12px に縮小されている。本体反映では665のみ触るか663も12px仕様とするか要決定
- index.html:447 — .val-badge.fair 宣言行（background rgba(107,125,138,0.14)/color:var(--ix-slate-light)/border）。opacity:0.35 の正式配置先＝この行に追記
- index.html:2149 — 「標準」バッジ生成JS①: `perBadge = '<span class="val-badge fair">標準</span>'`（PER 15<x<=28）。非表示化する場合の変更点
- index.html:2158 — 「標準」バッジ生成JS②: PBR側 `pbrBadge = '<span class="val-badge fair">標準</span>'`（1<x<=3）
- detail.css:706 — ③ .time-label { font-size:0.74rem; color:var(--ix-border-mid); }（L708が色）→ color:var(--ix-text-dim) へ in-place 書換＋font-size 12px化
- detail.css:253 — ③ .detail-star-btn の color:var(--ix-border-mid)（L247-257ブロック内）→ var(--ix-text-dim) へ。:hover/.watched(258-259)は amber のまま
- index.html:604 — ⑥ .card-title(L595-605) の text-shadow:0 0 10px rgba(0,229,255,0.35) → 削除。text-shadowは継承プロパティ＝子(sig-asof等)への波及も同時に消える
- index.html:453 — ⑥ .safety-score-num { font-size:0.75rem; …; text-shadow:0 0 5px currentColor; } → shadow削除（ついでに⑧の12px床対象）
- detail.css:290 — ⑥ .compare-title(L282-) の text-shadow → 削除。同型: .disc-chip .v.hot/.warm/.calm=L589-591、.ai-ins-headline=L1017
- money.css:822 — ⑥money: [D] .mcc-tab[aria-selected=true](821-823) の text-shadow。以下すべて実在確認済＝.mcc-section-title:1125 / .mcc-sync-status:898・899 / .mcc-fold-*-nm:952,954,956,958,960,962 / .mcc-cf-stat strong:994-995 / .mcc-hero-next系strong:873,878,883 / .mcc-sat-warn:1071 / .mcc-ac-yen:1236 / .mcc-ac-leg .pc:1242 / .mcc-ac-center .big:1244 / .mcc-ac-driftrow .dv:1249-1251。各行から text-shadow 宣言を in-place 削除
- money.css:866 — ⑥維持組: [D] .mcc-hero-power(864-866・text-shadow 12px 維持)。`small` 子への継承遮断ルール `.mcc-hero-power small { text-shadow:none }` はこの直後に新規追加
- money.css:1128 — ⑦mono奪回①: [D] .mcc-section-desc { …font-family:var(--mcc-mono); letter-spacing:0.2px; } → in-place で var(--ix-sans)/letter-spacing:0 へ
- money.css:1011 — ⑦mono奪回②: [D] .mcc-cf-note { font-family:var(--mcc-mono); } → in-place 書換
- money.css:1279 — ⑦mono奪回③: .mcc-nisa-gate は L1276-1280 の5クラス・グループセレクタ内で mono 指定 → nisa-gate だけグループから除去する編集が必要（他4クラスは mono 維持）
- detail.css:899 — ①⑧px系床上げ代表: .sig-note 11px(899)/.sig-asof 11px(900)/.sig-disclaimer 10px(901)/.ht-note 11px(907)/.ht-disclaimer 10px(908)/.dp-flabel 11px(914)/.relpos-na 11px(936)/.term-help 10px+w/h14px(941-942)/.term-help::after 11px(958) → 各 in-place 12px化・円は17px
- money.css:255 — .mcc-help 円: w/h14px(255)・font-size 0.6rem(257)・::after 本文 0.66rem(272) → 17px/12px/12px へ。D変種は 1129-1133（サイズ指定なし・色のみ）
- index.html:903 — ⚠media衝突①: @media(max-width:768px)(887-904)内 .sector-btn font-size:0.72rem。base側だけ12px化すると後方のこの宣言が勝つ＝この行も12pxへ
- index.html:924 — ⚠media衝突②: @media(375px)(916-929)内 .sector-btn 0.68rem(924)・.card-title 0.72rem(928)。928 が theme-a:168 の @media(375px){.card-title{font-size:12px}} の正式反映先（in-place 12px化）
- detail.css:408 — ⚠media衝突③: @media(768px)(406-448)内 .panel-desc-text-below 0.72rem(408)・.detail-star-btn/.open-compare-btn 0.68rem(439)。両方12px床対象クラス＝この2行も書換必要。@480(450-456)/@375(457-467)には床対象の font-size 縮小なし（チャート高さ等のみ）
- money.css:331 — ⚠media衝突④(全て1行media): .mcc-step-label 0.62rem@640(331)・.mcc-rm-phase-label 0.66rem@640(555)・.mcc-rm-seam-chip 0.58rem@640(565)・.mcc-nisa-table td::before 0.66rem@600(741, ブロック737-742)。いずれも床リスト該当＝各行12px化必要
- index.html:1015 — 読込順: inline <style>=L48-1014 → detail.css=L1015 → money.css=L1016。プロキシは </head> 直前(=L1016の後)に注入＋money.css末尾連結ゆえ全ties勝ち。本体反映は「各宣言の in-place 編集」が原則、新規ルール追加は同ファイル内で元宣言より後方に置けば同特異性で勝つ
