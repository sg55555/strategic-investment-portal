# UIUX刷新 wave「テーマA本実装＋チャート修正①〜⑤」設計 spec

- **日付**: 2026-08-20（設計承認 2026-08-20・本人）
- **worktree**: `/home/shugo/apps/investment-portal/.claude/worktrees/uiux-theme-a-charts`（branch `worktree-uiux-theme-a-charts`・base main `143df86`＝recon 実測時 HEAD と同一・rebase 不要）
- **典拠（正）**: `scratchpad/recon-uiux/` の 6 ファイル（themeA / zeroFy / srUnify / pageUnit / bsCallout / harness・全 file:line は 143df86 実測値）＋承認済み設計 `scratchpad/recon-uiux/00-approved-design.md`
- **監査元**: `docs/superpowers/audits/2026-08-09-chart-callout-audit.md`・テーマA仕様実体 `docs/superpowers/specs/assets/theme-a-tuning.css`・カタログ `docs/superpowers/specs/2026-08-08-uiux-proposal-catalog.md`
- **敵対検証**: spec pre-mortem workflow（4観点 find→dedup→refute・run `wf_658f4b79`）＝confirmed 16 findings を反映済（2026-08-21・§11 D10-D12 を含む）

## 0. 背景・経緯

UIUX刷新スレッドの機能第1弾に先立つ「土台の見た目と正しさ」wave。2026-08-08〜09 の監査（5観点＋チャート吹き出し横断監査）→デザイン案 A/B/C/現行の実物比較で**案A「現行Dの可読性チューニング」を本人確定**→2026-08-20 の brainstorming で wave 範囲・全ゼロFY方式・A-mini 同梱の 3 判断を本人承認済み。本 spec はその承認済み設計を decision-complete に固定する。

## 1. 確定事項（本人決定・AskUserQuestion）

1. **wave 範囲＝監査推奨順①〜⑤**（2026-08-09）＝①全ゼロFY防御・②S/R窓統一・③チャート別単位・④⑤BS吹き出し（＋テーマA本実装）。**小工数頻出系一掃は次 wave**（本 spec §12 付録**と Obsidian 所有ノート**に明記・本人指示）。
2. **全ゼロFY行の防御＝合流方式**（2026-08-20）＝FY2026 ボタンは残す（最新価格窓 2025-04〜2026-03 の閲覧を保存）・既定年は「実質値のある最新年」・FY2026 手動選択時は財務カード群を「この年度は決算未確定」プレースホルダ（`!fin` 経路に DOM 後始末を追加）。
3. **監査A最小緩和（A-mini）を同梱**（2026-08-20）＝S/R 軸ラベルを強度上位 2 本/側のみに限定（線は全本＝top-3/側 維持・約30分）。理由＝②窓統一でレベルが可視レンジ内に集まり右軸バッジ渋滞が悪化し得るため。監査A フル版（近接マージ等）は次 wave。

## 2. スコープ / 非スコープ

### スコープ
- **テーマA本実装**（§4）: theme-a-tuning.css 全8項目を「発生源修正＋in-place 編集」で本体へ。override CSS の移植はしない・`!important` 4ルールは本体に持ち込まない。
- **修正① 全ゼロFY防御**（§5）: `hasFinSubstance` 新設＋既定年選択＋合流方式プレースホルダ＋残汚染7箇所（健全性/FCF/KPI比較/cross-section/ポータルグリッド/ポータル sparkline/成長指標）の同時修正。
- **修正② S/R窓統一＋A-mini**（§6）: チャート側 S/R を displayPrices 基準へ統一・軸ラベル上位2本/側。
- **修正③ チャート別単位**（§7): pageUnit 廃止→BS/PL/CF 各チャート内算出・カードタイトル単位バッジ・USD 億層・軸目盛 `fmtTickValue`。
- **修正④⑤ BS吹き出し**（§8): side-aware 動的パディング・anchor 'center' 統一・低棒全科目横逃がし・`bsLeaderPlugin` リード線・同側低棒 stagger。

### 非スコープ（明示）
- **データ側**: 全ゼロFY2026 行の ETL 除去・`cf_cash_start/end` 年連鎖不整合（9984.T 3年同一値）＝**別レーン**（`scripts/update_data.py` 系・本人ローカル作業が絡む）。表示側防御は ETL 再実行で FY2027 全ゼロ行が再生成されても効く恒久ガードとして残す。
- **銀行の側パネル流動比率 0.0%**: 全年で起きる既存の別問題（`current_assets=0/current_liabilities=0`→`ratio()=0`）。`hasFinSubstance` は銀行行を正しく素通りさせる（誤除外なし）が、この 0.0% 自体は本 wave で直さない（直すなら ratioOrNull 化の別修正＝§12）。
- **S/R の maxPerSide 差の完全一致**: チャート＝count 降順 top-3 描画・digest＝Infinity から最寄り選択（M7）は**意図的差として維持**。digest が top-3 外の弱い水準（強度1等）を引用しチャートに線が無いケースは残存＝scope out。
- 監査A フル版（近接マージ・端クランプ）・§12 の次 wave リスト全項目。
- `FinanceRules.fmtAxis`（消費者ゼロの遺物）の整理＝据置（今回のテスト対象外・churn 回避）。

## 3. 実施順（承認済み・SDD タスク分割は plan で）

**P1 全ゼロFY（§5）→ テーマA（§4）→ ③pageUnit（§7）→ ②S/R＋A-mini（§6）→ ④⑤BS（§8）**

順序根拠: P1 先行で BS の hasLow 判定の NaN 穴（`totalAssets===0` 時）に全ゼロ年が到達しなくなる（§8 は防御ガードも併置）。②と④⑤は右軸バッジ・可視レンジの相互作用があるため A-mini を②に同梱し同一リリースで束ねる。

## 4. テーマA本実装 詳細仕様

方針: **「override の移植」でなく発生源修正＋in-place 編集**。行番号は全て 143df86 実測（themeA.md sites が正）。

### 4.1 トークン（③⑤の土台）
- `index.html:70` `--ix-slate: #6b7d8a` → `#7f95a3`。
- `index.html` `:root`（L53〜）に **`--ix-sans` を新規追加**（本体に現存しない唯一の新規トークン。値は theme-a-tuning.css の sans スタック）。detail.css/money.css からも `var(--ix-sans)` 参照可（読込順 inline style→detail.css→money.css）。
- `money.css:12` 非D `--c-text-mute: #5b6478` → `#7b859b`（**非D側は保険値のみ**＝実運用は常時 data-theme=D。非D `--c-text-faint` は据置＝仕様）。
- `money.css:774` D層 `--c-text-faint: #6e8492` → `#8299a7`・`--c-text-mute: #54636f` → `#7f95a3`。`money.css:775` `--c-slate: #6b7d8a` → `#7f95a3`。
- ⚠許容視覚差分: `--ix-slate` 変更は td 系以外の使用約9箇所（`.ma-label` detail.css:495・`.ma-btn:hover`:514・index.html:695/832/941 等）にも波及＝**可読性向上と同方向のため許容**（検収基準に明記・override 環境との厳密一致は要求しない）。`.val-badge.fair` の `rgba(107,125,138,…)` 背景/枠（index.html:447）はリテラルのため追従しない＝据置。

### 4.2 `!important` 全廃（発生源修正・4ルールを本体に持ち込まない）
- `index.html:2101` renderPortal sector-title テンプレ `color:${sectorColor}88` → `color:var(--ix-text)`。
- `index.html:2102` sector-count-badge の `color:${sectorColor}99` → `color:var(--ix-text-dim)`。**`border-color:${sectorColor}33` はアクセントとして残す**（sector-title-line のグラデ :2103 も残す＝一括置換で消さないこと）。
- `index.html:2144/2153/2170/2178` `let perStyle = "color: #6b7d8a;"` 系4箇所 → `"color: var(--ix-slate);"`（トークン再宣言に自動追従・td[style*] ルール自体が不要化）。**`index.html:2061` の空状態 div の `#6b7d8a` も同時に var 化**（override では取り残されていた箇所の是正）。
- `index.html:1206` `#csv-export-btn` inline の `font-size:0.72rem` → `12px` 直接書換。
- `detail.js:665` 単位注記 `font-size:0.7rem` → `12px`（※§7 でこの span 自体を削除するため、実施順上③が先に来た場合は不要。テーマA時点で残っていれば書換）。
- **`detail.js:663` ティッカー `(${currentTicker})` は 12px に書換**（現行 0.9rem=14.4px を override が 12px に縮小しており、**承認済みの見た目＝12px を正とする**・本人確定）。

### 4.3 ⑥ グロー廃止（text-shadow 削除・sites 列挙行に限定）
- 削除対象（themeA.md sites の全列挙・実在確認済）: `index.html:604`（.card-title）・`453`（.safety-score-num）／`detail.css:290`（.compare-title）・`589-591`（.disc-chip .v 3種）・`1017`（.ai-ins-headline）／`money.css:822`（.mcc-tab[aria-selected]）・`1125`（.mcc-section-title）・`898-899`（.mcc-sync-status）・`952-962`（.mcc-fold-*-nm 6種）・`994-995`（.mcc-cf-stat strong）・`873/878/883`（.mcc-hero-next 系 strong）・`1071`（.mcc-sat-warn）・`1236`（.mcc-ac-yen）・`1242`（.mcc-ac-leg .pc）・`1244`（.mcc-ac-center .big）・`1249-1251`（.mcc-ac-driftrow .dv）。
- **維持組**: `.mcc-hero-power`（money.css:864-866・12px shadow）と `.mcc-hero-ref-amount`（:853）＝廃止リスト外。**一括 text-shadow 掃除は禁止**（過剰廃止）。
- text-shadow は**継承プロパティ**＝維持親 `.mcc-hero-power` の `small` 子へ波及するため、`money.css:866` 直後に `[data-theme="D"] .mcc-hero-power small { text-shadow: none; }` を新規追加。

### 4.4 ⑦ 日本語長文の sans 化（mono 奪回）
- `money.css:1128` `.mcc-section-desc` → `font-family:var(--ix-sans); letter-spacing:0; line-height:1.65` へ in-place 書換。
- `money.css:1011` `.mcc-cf-note` → 同上 in-place 書換。
- `money.css:1274-1280` の **7 セレクタ**・グループ規則（`.mcc-nisa-qlabel / .mcc-nisa-stat / .mcc-nisa-legend / .mcc-nisa-subbar-label / .mcc-nisa-readout / .mcc-nisa-gate / .mcc-nisa-input summary` → `font-family: var(--mcc-mono)`）から、**`:1279` の `.mcc-nisa-gate,` の1行のみを削除**（他6セレクタの mono は維持。特に `.mcc-nisa-qlabel`（base :684）と `.mcc-nisa-stat`（:692）は base に font-family が無く**この規則だけが mono の由来**＝グループの組み直しは行わず行削除に限定）。**後方追記（奪回）方式は不可**＝二重定義が残り将来の混乱源。※recon themeA.md:48 の「1276-1280 の5クラス・他4維持」は誤記＝**本 spec が正**（2026-08-21 実測）。
- `money.css:1200-1201` の 2 クラス・グループ（`[data-theme="D"] #money-view .mcc-rm-note, .mcc-rm-timeline { font-family: var(--mcc-mono); }`）から **`.mcc-rm-note` を除去する編集**（`.mcc-rm-timeline` の mono は維持）。理由＝id＋クラスの高特異性 D 層宣言には末尾追記の素クラスルールが順序無関係で勝てず、⑦の sans 化が実運用（常時 data-theme=D）で**無言不達**になる。override 環境も同じ取りこぼしで mono のままだった＝視覚一致検分では検出されない（theme-a ⑦リストの意図＝sans を正とする）。
- 免責/注記グループ（theme-a:85-98 相当）: `detail.css` 末尾＋`money.css` 末尾に `font-family:var(--ix-sans); letter-spacing:0; line-height:1.65` の正式ルールを追加（同ファイル内で元宣言より後方＝同特異性で勝つ）。※**この「末尾追加＝勝つ」は D 層 `[data-theme="D"] #money-view` 直指定の font-family を持つクラスには不成立**＝該当4クラス（section-desc / cf-note / nisa-gate / rm-note）は上記 in-place 編集が必須（本 wave でこの4つが全量であることを確認済み）。

### 4.5 ①⑧ 12px 床（sub-12px 全廃）＋ term-help 円拡大
- 基底宣言の in-place 12px 化: 0.6-0.74rem 群（index.html 約16・detail.css 約17・money.css 約61）＋ `detail.css:899-958` の 10-11px 群（.sig-note/.sig-asof/.sig-disclaimer/.ht-note/.ht-disclaimer/.dp-flabel/.relpos-na/.term-help/.term-help::after）＋**`.relpos-cap`（:935・`font: 11px/1.3 var(--ix-mono…)` の shorthand 内 11px→12px 書換＝プロパティ形が他と異なる点に注意）**。対象クラスリストは theme-a-tuning.css ⑧床リスト（portal 15・detail 29・mcc 97・stale セレクタ 0 件を機械照合済）。
- `?` 円: `.term-help` w/h 14px→**17px**＋font 12px（detail.css:941-942・::after 本文 :958 も 12px）／`.mcc-help` 同様（money.css:255/257/272）。
- **【cascade 罠・最重要】media 内縮小宣言の同時書換が必須**: base だけ 12px 化しても後続 @media 内の縮小宣言が同特異性・後方 order で勝つ。対象＝`index.html:903`（.sector-btn 0.72rem@768）・`924`（.sector-btn 0.68rem@375）・`928`（.card-title 0.72rem@375＝theme-a:168 の正式反映先）／`detail.css:408`（.panel-desc-text-below@768）・`439`（.detail-star-btn/.open-compare-btn@768）／`money.css:331`（.mcc-step-label@640）・`555`（.mcc-rm-phase-label@640）・`565`（.mcc-rm-seam-chip@640）・`741`（.mcc-nisa-table td::before@600）。全て 12px 化。
- `detail.css:706-708` `.time-label` → color を `var(--ix-border-mid)`→`var(--ix-text-dim)`＋12px 化。`detail.css:254` `.detail-star-btn` の color 同様（:253 は padding・:hover/.watched の amber は据置）。

### 4.6 「標準」val-badge の減灯
- `index.html:447` `.val-badge.fair` に `opacity: 0.35;` を追記（**非表示化はしない**・本人確定）。生成 JS（:2149/:2158）は無改変。

### 4.7 テーマA の検証観点
- override（theme-a-tuning.css を </head> 直前注入）環境と本体反映後の視覚一致は「同方向の差分を許容」（§4.1 の --ix-slate 波及・4.2 の 2061 是正）。厳密一致でなく **AA コントラスト達成＋12px 床＋グロー廃止対象の shadow 0** を機械判定する。
- `?` 円 17px 化はレイアウト寸法変更＝**表ヘッダ（index.html:2116 の th 内 term-help）の折返し/ズレを Playwright で確認**。
- renderPortal テンプレ（2101-2102/2144-2178/2061）は JS 変更＝`scratchpad/f2-snapshot.js`（portal/detail/money 3ビュー＋公開20名 bare typeof）を補助ゲートに回す。

## 5. 修正① 全ゼロFY防御（合流方式）詳細仕様

対象事実: FY2026 の全18列=0 の行が 12 銘柄に存在（SQLite 実測・NULL は全293行で0件・銀行 3 行は net_sales>0 かつ non_current_assets 巨大で誤除外なし・除外後に空になる銘柄なし）。

### 5.1 共有述語 `hasFinSubstance`（finance-rules.js 新設・単一源）
```js
// 実質値のある財務行か（全ゼロFY行=ETL未確定行の防御・§5全消費者の単一源）
function hasFinSubstance(fin) {
  if (!fin) return false;
  return n(fin.net_sales) > 0 || totalAssets(fin) > 0 || n(fin.net_assets) !== 0;
}
```
- 「主要3軸（売上/総資産/純資産）いずれも実質値なし」の形＝将来 ETL が部分確定行を作っても分類が揺れにくい。現 DB では `n(net_sales)===0 && totalAssets===0` の否定と等価・12行に過不足なく一致（SELECT 実証済）。
- UMD export 追加＋`tests/finance-rules.test.js` に単体テスト（全ゼロ行 false／銀行行 true／通常行 true／欠損 fin=null false／純資産のみ負値 true）。
- **`index.html:1968` の既存 `hasFinData` 述語（net_sales>0||net_assets>0）もこれへ置換して単一源化**。

### 5.2 既定年選択（detail.js:601）
```js
selectedYear = availableYears.find(y => FinanceRules.hasFinSubstance(data.financials_trend[y]))
  || availableYears[0] || 2025;
```
- availableYears は降順（:598）＝ find が「実質値のある最新年」。全年 substanceless の防御は `availableYears[0]`（現データで該当銘柄なし）・空配列は既存 `|| 2025` を保存。
- 年ボタン生成（:605 `availableYears.reverse()`）は**無改変**＝FY2026 ボタンは残る（確定事項2）。

### 5.3 合流＝FY2026 手動選択時のプレースホルダ（detail.js updateFinancialViews）
- `:650` を `const rawFin = data.financials_trend[selectedYear]; const fin = FinanceRules.hasFinSubstance(rawFin) ? rawFin : null;` に変更＝全ゼロ年は既存 `!fin` 経路（:772）へ合流。
- **表示/非表示の共通ブロック（必須・現状 `!fin` 経路は株式で実質到達不能＝クリア処理未整備）**: `const finVisible = !isEtf && !!fin;` を**単一判定源**とし、**isEtf return（:765）より前の無条件通過点**に :757-764 相当を再定義して全対象へ毎回 `display = finVisible ? "" : "none"` を評価する。対象の明示列挙:
  - finCards 8 枚のうち **`.card` 内在の 7 枚**＝`.closest(".card")` 非表示化。
  - **`#kpi-compare-card`**＝`.card` 祖先を持たない（#detail-view 直下・index.html:1203）ため**直接 style.display**（既存 isEtf 経路 :766 と同型。:757-759 の closest ループはこのカードに対して no-op になる点に注意）。
  - **`#ai-analysis-card`**（index.html:1197・finCards 外。唯一の既存トグル :775-785 は :772 return の**後**＝全ゼロ年に不到達で前年 AI コメントが残留する）＝**直接 style.display**。既存トグルは fin 実在経路用として残置（!fin/isEtf の hide は共通ブロックが担う）。
  - この共通ブロック化により **FY2026→実質年復帰・ETF→株式の既存復帰欠落も同時解消**される。
- **プレースホルダ**: 固定 id `#fin-pending-note`「**この年度は決算未確定です**」を **`#kpi-compare-card` の直前に insertBefore**（冪等＝既存 id あれば再利用）。表示条件＝`!isEtf && !fin`・非表示＝その否定を**同じ共通ブロックで毎回評価**（ETF 遷移含む全経路で必ず実行＝6861.T FY2026→SPY で注記が残留しない）。
- 前銘柄/前年の財務チャート・KPI グリッド・側パネル値・AI 分析カードの**残像を残さない**ことが受入条件（§5.5 の追加3ケース参照）。

### 5.4 残汚染の同時修正（availableYears では直らない 7 箇所）
1. **健全性トレンド** `detail-rules.js:877-882`: 年ループで `!FR.hasFinSubstance(f)` の年は **equityRatio/currentRatio/cash/totalLiab の4系列すべて null push**（fcfTrendSeries と同型。比率2系列だけでなく、全ゼロ年は cf_cash_end=0/負債2列=0 が hasValue(0)=true で「現金が 2026 に 0 へ急落」の偽実点になるため金額2系列も欠測化）。実装形は eqOk/curOk への AND＋cash/tl push へのゲートでも、ループ先頭 early null×4 push でも可（結果同値）。
2. **FCFトレンド** `detail-rules.js:906-913`: `!hasFinSubstance` の年は全系列 null push（FCF=0 の偽実点を排除）。
3. **KPI比較ストリップ** `detail.js:526-529`: years を `hasFinSubstance` な年のみにフィルタ（ゼロ列＝売上0/YoY-100% バッジの誤誘導を除去。年の存在提示は年ボタン側が担う＝§11 D3）。
4. **cross-section** `cross-section-rules.js:63-69` `_latestFin`: 「`FR.hasFinSubstance` な最大年」へ（12 大型銘柄が分布母集団から脱落している隣接汚染の解消。FR 依存は既存＝UMD/require 済）。
5. **ポータルグリッド** `index.html:1964-1968`: finYears 降順から `hasFinSubstance` な最新年を採用（既存 hasFinData 置換＝§5.1 と同時）。
6. **ポータル sparkline** `index.html:1993-1996`: trendYears を `hasFinSubstance` な年でフィルタしてから昇順末尾3年を採用（全ゼロ FY2026 の net_sales=0 が trendSales に入り**偽のゼロ急落波形**（:2201 buildSparklineSVG）になるのを排除）。
7. **ポータル成長指標** `index.html:2001`: `FinanceRules.growthRates` へは `hasFinSubstance` な年のみの trend を渡す（end=全ゼロ年だと salesYoY=-100%・salesCagr=null → growthBadge「CAGR —」劣化・NULL_LAST_KEYS ソート最下位落ち（:2036）・screener-rules.js:18 の売上成長率 CAGR 絞込から脱落）。
- 実装は 5/6/7 で**「hasFinSubstance でフィルタ済みの年リスト（or trend）を1回構築し latestFin 選択・trendYears・growthRates の3消費者で共用」**する形を推奨（3独立算出の再発防止）。
- **CSV（detail.js:156）は据置**＝生データエクスポートとしてゼロ列も出す（§11 D4・根治はデータ側 ETL）。

### 5.5 検証（§9 と別に本修正固有）
- node テスト: hasFinSubstance 単体＋**healthTrendSeries の全ゼロ年は equityRatio/currentRatio/cash/totalLiab の4系列とも null**・fcfTrendSeries の全系列 null＋_latestFin のスキップをフィクスチャで固定。
- DOM 実測: 全ゼロ 12 銘柄のうち 2-3 銘柄（6861.T 等）で「既定年=実質最新年」「FY2026 手動選択→プレースホルダ＋残像ゼロ」を Playwright 確認。**追加3ケース**＝(i) 前年に ai_analysis がある銘柄で FY2026 切替→**AI 分析カード非表示** (ii) FY2026→実質年復帰→**kpi-compare-card 再表示** (iii) 6861.T FY2026→SPY 遷移→**#fin-pending-note 非表示**。
- ポータル行実測: 全ゼロ銘柄のポータル行で (a) sparkline が右端ゼロ急落を描かない (b) 成長バッジが「CAGR —」でなく実 CAGR 値（tooltip の売上 YoY も 2024→2025 実値）(c) 売上3期ソートで null 末尾送りにならない、を Playwright 確認。
- **本番 Neon 確認を完了判定に含める**: `/api/market/financials?ticker=6861.T` の応答で FY2026 全ゼロ行の存在を確認（ローカル SQLite と同系譜の実証・api は None のみ省略し 0 は配信＝フロント防御が本番でも作動する前提の裏取り）。

## 6. 修正② S/R窓統一＋A-mini 詳細仕様

### 6.1 窓統一（最小差分・2口同時）
- `detail-charts.js:508` `applySRLines(base)` → `applySRLines(displayPrices)`。**MA/BB/KC の base（:483-502・全履歴算出→窓 filter のウォームアップ機構）は不可侵**。
- `detail-charts.js:244` toggleSR の `if (data) applySRLines(data.prices);` → `if (data) applySRLines(currentDisplayPrices || data.prices);`（:243 のローカル `const data = STOCK_DATA[currentTicker];` は維持・防御フォールバック付き。**:508 だけ変えると「FY切替後=窓基準・トグル OFF→ON=全履歴基準」の状態依存不整合**＝両口同時変更が必須）。
- 引数渡しを採る（closure `currentDisplayPrices` を applySRLines 内部で読む実装は **:511 の代入が :508 より後**の順序罠で1世代前の窓を読む）。
- `detail-rules.js:706-707` の stale コメントを事実化（「チャート・サマリ共に表示期間 displayPrices 基準＝整合」へ更新）。
- detectSR 本体（シグネチャ・既定 maxPerSide=3・slice(-252)）は無改変＝既存テスト（detail-rules 96・うち detectSR 直接 2・node 全体 331）非影響。決定論性により入力統一だけでチャート/digest の数値一致が保証される（物理的な 1 回呼び出し統合はしない＝差分膨張回避）。

### 6.2 A-mini（軸ラベル上位2本/側・確定事項3）
- `applySRLines`（:227-238）の createPriceLine ループで、**各側 index<2 のみ `axisLabelVisible:true`・3本目は false**（detectSR の戻りは count 降順ソート済＝再ソート不要）。線・title（R×count/S×count）は全本（top-3/側=最大6本）維持。

### 6.3 挙動変化の扱い（退行でなく意図変更）
- 過年度 FY 窓では S/R レベルが可視レンジ内に収まる（従来は全履歴基準で軸端クリップ）＝**FY 切替で S/R が窓ごとに変わるのが正**。fallback 200 本窓では母数 252→200 でクラスタが変わる＝before/after 差分は「変わって正しい」検分。
- 疎データ FY 窓（US 暦年進行中など数十本）では pivot 母数不足で S/R 0 本になり得る＝perceived regression として §10 実機サニティの注記に含める（digest 側は既に同条件で「データ不足」を出す＝整合）。
- ローソク glow primitive（:519）・T/R 線（既に displayPrices 基準）とは描画機構が別＝無干渉（実測確認済）。

## 7. 修正③ チャート別単位 詳細仕様

### 7.1 チャート別算出（healthTrend/fcfTrend 同型・pageUnit 廃止）
- `renderPLChart` 内: `const plMax = Math.max(0, ...DetailRules.plSteps(fin).map(s => Math.abs(FinanceRules.n(s.val))))` → `pickUnit(plMax, currency)`。
- `renderCFChart` 内: `DetailRules.cfWaterfall(fin).maxCfScale` をそのまま pickUnit へ（:571・累積水準込み＝軸レンジと同義で最適）。
- `renderBSChart` 内: **両スタック和の max**＝`Math.max(FinanceRules.totalAssets(fin), FinanceRules.n(fin.current_liabilities) + FinanceRules.n(fin.non_current_liabilities) + displayNetAssets)`（displayNetAssets 適用後）。BS は全 dataset が stack:"Stack0"（y軸 stacked）＝**軸上限はセグメント単体でなくスタック和**に達するため、セグメント5値 max は軸上限と乖離し実データ5社11行（2269.T/2802.T/7733.T/7741.T/7832.T）で兆→5桁億円へ降格してしまう。両スタック和 max は軸上限（左右列高の大きい方）と厳密一致し、負純資産時は負債側和>totalAssets を正しく採る（totalAssets 単独不採用の懸念も吸収）＝**現行 pageUnit からの JPY 単位層変化ゼロ**（CF の「軸レンジと同義」原則と統一・§11 D10）。
- currency は各 render 冒頭で `const currency = STOCK_DATA[currentTicker]?.currency;` を採用（現行 :710 の dead unitStr と同型＝実績あり。引数継続案は不採用＝「第2引数完全削除」と整合・§11 D11）。
- **detail.js 側の削除**: `pageUnit` state（:22）・算出（:656-658）・`renderBS/PL/CFChart` の第2引数（:789/791/792）・ヘッダ「単位: X」span（:665）＝**完全削除**（ETF の「単位: 百万円」無意味表示も同時解消・§11 D5）。
- **シグネチャ変更は detail.js↔detail-charts.js を同一コミットで同時変更**（片方だけだと `fmtUnitValue` が `!unit` で `String(v)` 素通し＝**例外の出ない無言故障**になる点に注意）。
- `financialMaxAbs`（detail-rules.js:453-462）は消費者ゼロ化→**削除**（export :993・`tests/detail-rules.test.js:74-83` も同時整理＝§11 D6）。dead な `const unitStr`（detail-charts.js:710/995/1108）も同関数編集のついでに削除。

### 7.2 カードタイトル単位バッジ（**分離と表示追加は不可分の1リリース**）
- `#bs-title`（index.html:1248）/`#pl-title`（:1389）/`#cf-title`（:1396）の末尾に `<span class="chart-unit-badge" id="bs-unit-badge">単位: 億ドル</span>` 型の span を各 render 冒頭で挿入（**固定 id 付き冪等＝既存あれば差替**・bs/pl タイトル内の data-term span へ injectTermHelp が `?` を注入するため**既存 child の後ろに append**）。
- チャート別化で同一ページに PL=億円/BS=兆円が併存し得る＝バッジ無しでは現状より誤読が悪化するため、**バッジ実装なしの単位分離リリースは禁止**。
- `.chart-unit-badge` の CSS は 12px 床・`var(--ix-text-dim)`（テーマA 整合）。

### 7.3 USD 億層（JPY 鏡像・JPY 不変）
- `pickUnit`（finance-rules.js:104-115）の USD 分岐を書換: `if (a >= 100) return { div: 100, suffix: "億" + cur, dec: a >= 10000 ? 0 : 1 }; return { div: 1, suffix: "百万" + cur, dec: 0 };`（**十億層を廃し億層へ**＝「10.6十億ドル」→「106億ドル」。兆層 `a>=1e6` は通貨共通で維持・JPY 分岐は無改変）。
- 正常表示だった USD 銘柄（NVDA "153.5十億ドル" 等）も全て表示が変わる＝退行でなく意図変更（before/after 期待値更新）。

### 7.4 軸目盛の動的小数桁 `fmtTickValue`（finance-rules.js 新設）
- 軸 callback 3箇所（detail-charts.js:903/1097/1228）を `callback: (v, i, ticks) => FinanceRules.fmtTickValue(v, unit, ticks)` へ（Chart.js v4 の ticks 引数仕様・CDN 4.5.1 SRI 固定で安全・this 非使用の arrow のまま）。
- 仕様: `step = ticks.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) / unit.div : Math.abs(val) / unit.div`・`dec = step > 0 ? Math.max(unit.dec, Math.min(4, Math.ceil(-Math.log10(step)))) : unit.dec`・`v===0` は `"0"`・以降 fmtUnitValue と同整形＝**目盛間隔基準で桁を揃え「0.1兆ドル×4連」重複と「0.02兆ドル」桁不揃いを同時に根絶**。
- **datalabel 側は現行 `fmtUnitValue` を維持**（値単体の適応精度が必要）。fmtUnitValue/fmtTickValue は finance-rules.js に並置し**相互参照コメントで縛る**（将来片方だけ直す取りこぼし防止）。
- 「0.0005兆ドル」問題は USD 億層化で消える（500百万ドル→"5億ドル"）＝dec 自動拡張 while（:126）自体は JPY 挙動保存のため無改変。

### 7.5 テスト影響（書換必須の明細）
- `tests/finance-rules.test.js`: `:104`（pickUnit USD 416161→十億）・`:106`（500 USD・億層閾値で変化）・`:119`（"416.2十億ドル"→"4,162億ドル"）は書換必須。`:105`（兆ドル）・JPY 系 `:111-117/:124-130`・unitLabel `:134-136` は**維持できることをもって JPY 無改変の証明**とする。fmtTickValue の新テスト追加（step 由来 dec・v=0・ticks 長1 フォールバック・JPY/USD 両系）。

## 8. 修正④⑤ BS吹き出し 詳細仕様

前提の裏取り: datalabels v2.2.0 非圧縮 dist をソースレベルで確認済（compute$1 の不正 anchor→セグメント中点フォールバック・aligned の**数値=時計回り角度**解釈・coordinates の「align'right' 時 frame 左端=アンカーx+offset」恒等・display:true では自動間引き `_hidable` 完全無効）。幾何: canvasW=vw−560（1024≤vw≤1540）・バー半幅=chartArea.width/4・frame 実測最大 112.6px（NVDA USD 2行）。

### 8.1 低棒判定と side-aware 動的パディング（P4+P7）
- `renderBSChart` 冒頭（:717 付近）で1回算出:
```js
const LOW = 0.12;
const lowLeft  = totalAssets > 0 && [fin.current_assets, fin.non_current_assets].some(v => v > 0 && v / totalAssets < LOW);
const lowRight = totalAssets > 0 && [fin.current_liabilities, fin.non_current_liabilities, displayNetAssets].some(v => v > 0 && v / totalAssets < LOW);
const hostW = document.getElementById("bsChart").parentElement.clientWidth || 880;
const CALLOUT_PAD = Math.min(140, Math.max(126, Math.round(hostW * 0.16)));
```
- `:801` → `layout: { padding: isMobile ? {left:4,right:4,top:10,bottom:4} : { left: lowLeft ? CALLOUT_PAD : 8, right: lowRight ? CALLOUT_PAD : 16, top: 65, bottom: 20 } }`。
- **監査P4案の right:100/left:8 は不採用**（USD 2行ラベル frame 112.6px+gap12≈125px が欠けるため**下限126へ上方修正**）。低棒の居る側だけ予約＝低棒なし銘柄はプロット幅+約250px。**モバイル arm は不変**。下限126の導出（frame112.6+gap12）は右側基準だが、左列は offset の y 軸幅加算（§8.2）により同じ「padding 帯全載り」が成立＝左右で下限を変えない。
- `totalAssets > 0` ガード必須（P1 全ゼロ年の NaN 比較防御＝§5 先行で経路自体は消えるが二重防御として残す）。
- layout.padding は Chart.js 4.5.1 で toPadding 直読み＝**スクリプタブル不可**→render 時に数値化して渡す（毎回 destroy→new Chart なので年/銘柄切替で自然に再評価。ウィンドウリサイズでは次 render まで旧値＝既存挙動と同じ・退行ではない）。

### 8.2 anchor/align/offset（P2+P3）
- **anchor**（:841-854）: 低棒分岐を全廃し `return "center";` に統一。**視覚不変なのは :851 の不正値 'left'/'right' の置換のみ**（フォールバック実挙動＝center と同一）。:849 の 'end'（流動系＝上端）・:850 の 'start'（純資産＝下端）は**正規 anchor でアンカー点が実際に移動する＝align/offset の横逃がしとセットの意図変更**（単独では視覚変化あり・before/after 差分が出るのが正・**anchor 変更だけの先行コミット分割は不可**）。:844 の val=0→center は formatter null で無ラベル＝据置可。
- **align**（:855-868）: 低棒（<LOW）は**全科目 横逃がし** `context.dataIndex === 0 ? "left" : "right"`（P3 純資産の 'bottom' 廃止・流動系の 'top' も横統一＝**上空浮遊「0」問題（P5 の一因）も同時に消える**）。非低棒は 'center'。
- **offset**（:870-879）: `if (totalAssets > 0 && val > 0 && val / totalAssets < LOW) { const ca = context.chart.chartArea; const base = (ca ? ca.width / 4 : 132) + 12; return context.dataIndex === 0 ? base + (context.chart.scales.y?.width || 72) : base; } return 0;`。右列＝**frame 左端=バー右端+12px が padding 値に依存せず恒等成立**（プラグインソースで検証済）。**左列は y 軸幅を加算**＝align:'left' チップの右端が chartArea.left−12 に来ると不透明チップ（#0a0f17・最大112.6px）が **y 軸目盛数字を覆う**ため、軸幅ぶん外へ逃がして padding 帯に全載りさせる（CALLOUT_PAD≥126 で左端≥1.4px＝クリップ 0 維持。offset コールバックは layout 確定後解決＝scales.y.width 読取可）。リード線が軸ボックスを 1px 線で横断するのは許容。ca 未定義フォールバック 132/72 は neonBarBg 同型（§11 D12）。
- **:851 と :870-879 は必ず同時に変える**（anchor center 化単独では「たまたまバー上に載る」現状が変わらない）。

### 8.3 リード線 `bsLeaderPlugin`（P5）
- `detail-charts.js:128`（`Chart.register(neonGlowPlugin)`）直後に登録（登録順=ChartDataLabels→neonGlow→bsLeader＝afterDatasetsDraw がラベル描画・_box 更新後に走る）:
```js
const bsLeaderPlugin = { id: "bsLeader", afterDatasetsDraw(chart) {
  const specs = chart.$bsLeaders; if (!specs) return;      // renderBSChart が低棒のみ [{di,bi}] を設定・他チャートは no-op（neonGlow と同じ gate 方式）
  const c = chart.ctx; c.save();
  specs.forEach(({ di, bi }) => {
    const el = chart.getDatasetMeta(di).data[bi]; if (!el) return;
    const lab = (el.$datalabels || [])[0]; if (!lab || !lab.$layout || !lab.$layout._visible) return;
    const r = lab.$layout._box._rect;                       // 絶対座標 frame（datalabels 内部API）
    const p = el.getProps(["x", "y", "base"]);              // live 値（final=true 不可＝アニメ1500ms中ラベルは live el 追従・final だと線がズレる）
    const segY = (p.y + p.base) / 2;
    const fromX = r.x + r.w / 2 < p.x ? r.x + r.w : r.x;    // チップのセグメント側縁
    c.strokeStyle = "rgba(0,229,255,0.55)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(fromX, r.y + r.h / 2); c.lineTo(p.x, segY); c.stroke();
  });
  c.restore();
} };
Chart.register(bsLeaderPlugin);
```
- renderBSChart 側: `bsChartInstance.$bsLeaders = lowIndices;`（:909 の `$neonSpecs` 直後）。**lowIndices の構築式（これを正とする）**:
```js
// 低棒のみ（§8.1 と同判定・displayNetAssets 適用後・totalAssets>0 ガード）
const lowIndices = [
  [0, displayNetAssets, 1],            // 純資産→調達源泉列
  [1, fin.non_current_liabilities, 1], // 固定負債→調達源泉列
  [2, fin.current_liabilities, 1],     // 流動負債→調達源泉列
  [3, fin.non_current_assets, 0],      // 固定資産→運用形態列
  [4, fin.current_assets, 0],          // 流動資産→運用形態列
].filter(([, v]) => totalAssets > 0 && v > 0 && v / totalAssets < LOW)
 .map(([di, , bi]) => ({ di, bi }));
```
  bi は datasets data 配列（:742-786）の**実バー位置**＝負債/純資産系は data=[0,v] ゆえ bi=1・資産系は data=[v,0] ゆえ bi=0。**取り違えると反対列の value=0 バーを引き formatter null→_visible=false で gate が黙って skip＝リード線が無言で欠ける**（rect アサートでは検出不能・実機サニティ④のみが捕捉）。
- **⚠内部API依存の明記（運用注意・恒久）**: `$datalabels`/`$layout._box._rect` は chartjs-plugin-datalabels の**非公開内部API**。SRI pin v2.2.0（index.html:46）固定の間は安定だが、**プラグインをバージョン更新する際は本プラグインの動作再確認を必須とする**（壊れても gate が no-op になるだけでエラーは出ない＝リード線が無言で消える）。この注意は CLAUDE.md／Obsidian 所有ノートにも転記する。

### 8.4 同側低棒2つの stagger（4755.T=流動負債+純資産 等）
- display:true のため自動間引きは無効（ソース確認済）＝同側横逃がしでチップ（高さ≈49px）が縦近接・重複し得る。
- 対処: **align の角度数値指定**（datalabels は align に時計回り角度[度]を受ける）で 2 本目以降を分離。同側の低棒が複数ある場合、セグメント中点の縦距離が 50px 未満のペアに対し、下側のチップの align を基準角（右=0/左=180）から**下向き成分側へずらした角度**にする（具体角度は SDD 実装時に代表銘柄で実測調整・**θ<45° に留める**＝45°超は datalabels 正規化の支配軸が縦へ切替わり下記補正式が崩れる）。
- **角度時の offset 補正（必須）**: 変位はラベル中心＝アンカー＋(frame半幅+offset)·(cosθ, sinθ) のため、角度を付けると水平変位が cosθ 倍に縮み §8.2 の「バー端+12px」恒等が崩れてチップがバーへ食い込む（1440px 幅で θ≈24°超から）。**stagger 対象チップの offset は `(ca.width/4 + 12) / cos(θ)` に補正**して水平クリアランス 12px を保存する（垂直分離は補正でさらに増える＝分離効果は損なわれない）。『offset そのままで角度だけ振る』実装は不可。
- 受入は**角度の値でなく数値アサート**＝チップ `_box._rect` 相互の重なり 0＋**stagger 適用チップ×当該列バー矩形（x∈バー中心±ca.width/4）の交差 0**。
- 縦クランプ（canvas 下端はみ出し・銀行系の最下段純資産）は**実装しない**（datalabels に縦クランプ機構なし＝offset では表現不可。リード線が帰属を明示し、受入アサートで欠けを検出した場合のみ角度の上向き成分で SDD 調整＝§11 D7）。

### 8.5 非影響の確認（実測済・受入で再確認）
- モバイル（<768）: :809-811 の 0.15 表示ゲートで低棒ラベル自体が非表示＝<LOW 分岐不到達・表示ラベルは center/center/0 経路のみ＝**モバイル挙動不変**（padding のモバイル arm を触らないこと）。
- ETF: detail.js:765 return で renderBSChart 不到達。財務欠損年: :772 return（§5 合流後は全ゼロ年も不到達）。

## 9. 検証計画（2層ゲート・受入マトリクス）

### 9.0 前提セットアップ（**最初の SDD タスクとして必須**）
1. **実DB symlink 差替**: worktree の `data/investment.db` は **0 バイトの空ファイル**（git-ignored）＝mock_prod_server.py が全 API 500 になり全 e2e が偽陰性で落ちる。`rm data/investment.db && ln -s /home/shugo/apps/investment-portal/data/investment.db data/investment.db`（phase2-bundleD-layer2 と同方式・上書きでなく rm→ln -s）。
2. **before-baseline 作成**: baseline（scratchpad/detail-baseline.json・**scratchpad/f2-baseline.json**）は**いずれも worktree に現存しない**（git 非追跡）。mock 鯖起動（`PLAN2_PORT=8200 python3 scratchpad/mock_prod_server.py`）→変更前に ①`NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture` ②`NODE_PATH=/home/shugo/node_modules node scratchpad/f2-snapshot.js capture` を各1回実行。両スクリプトとも URL 8200 ハードコード（detail-snapshot.js:61／f2-snapshot.js:121）＝並行セッション時は snapshot 用鯖を 8200 で立てる。**main リポ側 scratchpad の f2-baseline.json（2026-07-03 F2 期の産物）は陳腐化のため流用禁止**。

### 9.1 2層ゲート（detail-snapshot の運用再定義）
- **層1（無条件 MATCH・機械判定）**: `windowApi 16/16 true`・`canvasCount`・`pageErrors 0` は全タスクで不変必須。
- **層2（意図 diff 検分→再 baseline 昇格）**: `computedStyles`（テーマA で必ず diff る）・`domHash`/`chartContainerDims`（チャート修正で diff る）は、compare の diffs 出力（キー名のみ）＋ **baseline JSON の手動 diff（jq）で「意図したキー/値のみか」を検分**→OK なら capture で after を新 baseline に昇格。以後のタスク内リグレッションは MATCH で機械判定。タスク粒度ごとに繰り返す。「MATCH 必須」を機械ゲートにするとテーマA が全部 fail する＝この2層化が本 spec の検証規約。**f2-snapshot にも同じ2層運用を適用**する（テーマA は portal.styles・修正①は portalDomLen が意図 diff→検分→再 baseline）。

### 9.2 受入マトリクス（変更領域×検証手段）
| 変更領域 | 必須ゲート（機械判定） | 意図 diff 検分 |
|---|---|---|
| テーマA: index.html（inline style/トークン/renderPortal テンプレ） | portal-money-smoke.js 9 assert＋層1不変＋**f2-snapshot.js**（公開20名 typeof・3ビュー pageerror） | computedStyles diff＝意図セレクタのみか jq 検分→再 baseline |
| テーマA: detail.css | 同上（detail-snapshot の STYLE_SELECTORS 18 が最感度） | 同上 |
| テーマA: money.css | **cockpit-e2e.js 全 check PASS（CLAUDE.md 必須）**＋portal-money-smoke | money 系は STYLE_SELECTORS 外＝cockpit-e2e が実質ゲート。money.css 変更時も detail-snapshot compare を回す（index.html は両 CSS 常時ロード） |
| 純関数: finance-rules.js/detail-rules.js/cross-section-rules.js（hasFinSubstance・pickUnit/fmtTickValue・系列 null 化・_latestFin） | `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js` 331+新規 全pass（**ディレクトリ渡しは MODULE_NOT_FOUND で不可**）＋`PYTHONPATH=<worktree> /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q` 228 不変（main 側 .venv・PYTHONPATH 必須） | 不要 |
| detail-charts.js（S/R・単位・BS吹き出し・bsLeader） | 層1不変＋smoke-zigzag-range.js（pageerror 0）＋**S/R 機械ゲート**＝代表銘柄で FY 切替後の S/R priceLine 価格とサマリ digest 引用値の一致・**軸ラベル表示数≤2/側**（A-mini）を Playwright 数値アサート | **Playwright 監査再現**: 代表銘柄を mock 鯖で開き `$datalabels...$layout._box._rect` を抽出→**クリップ 0（canvas 外欠け無し）・チップ相互重なり 0・チップ×y軸 tick ラベル矩形（`chart.scales.y.getLabelItems()` から算出）の重なり 0・stagger チップ×バー矩形の交差 0** を数値アサート（監査と同手法＝受入基準が症状定義と 1:1） |
| detail.js（既定年・合流・pageUnit 廃止配線）＋**修正①の index.html ポータル系（:1964-2001）** | node --test（rules 層分）＋detail-snapshot compare＋portal-money-smoke＋f2-snapshot | 全ゼロ 12 銘柄中 2-3 銘柄で既定年/プレースホルダ/残像ゼロ＋§5.5 追加3ケース＋**ポータル行実測（sparkline/成長バッジ/ソート）**の DOM 実測 |
| 全変更共通（各タスク完了時） | node 全緑・pytest 228・portal-money-smoke・再 baseline 後 compare MATCH | — |

- **代表銘柄セット**: 6861.T（全ゼロFY）/6758.T（低棒左列）/8306.T（銀行）/7203.T（正常）/4755.T（同側極小2つ）/BRK-B（USD 単位・兆層）/NVDA（USD 2行 frame 最大）/**7741.T（BS 兆層×低セグメント＝単位層不変の検分用）**/SPY（ETF 非影響）。ビューポートは 1440 と 1024（P7 圧殺帯）＋768 未満（モバイル不変確認）。
- 意図 diff 検分の観点に「**JPY 銘柄で BS 単位層が現行から変わらないこと**（§7.1 D10 の検収）」「trendSales/growthBadge の変化が全ゼロ 12 銘柄に限られること」を含める。
- **最終見た目は本人実機サニティ**（GPU 発色・グロー・フォントは headless 非 authoritative）＝§10。

### 9.3 SDD ledger
- `.superpowers/sdd/progress.md` を本 worktree に新規作成（main 側 `.superpowers/sdd/progress.md`（B#2）の形式踏襲＝総括→branch/plan/base→Task 状態→Minor ロールアップ）。

## 10. 制約（不可侵）と実機サニティ項目

- **0x0 罠**: display:none コンテナで createChart しない・chart-container 寸法/初期化順序は不変（唯一の恒久技術制約）。
- **MA/BB/KC の base 算出（detail-charts.js:483-502）不可侵**（ウォームアップ切れで指標線が窓先頭欠けする退行防止）。
- **detail 分離規律**: 純計算=detail-rules/finance-rules・描画 lifecycle=detail-charts・配線=detail.js。hasFinSubstance/fmtTickValue は必ず finance-rules.js へ。
- **IIFE 公開面**: 本 wave で新規 window 公開は追加しない（hasFinSubstance は FinanceRules 名前空間経由・bsLeaderPlugin は detail-charts closure 内）。
- **money.js/money-rules.js/advice.py 非接触**＝facts パリティ非影響（money.css の表示層のみ変更）。ただし money.css 変更ゆえ cockpit-e2e 必須。
- **ローソク確定色・ZigZag 逆規約・サブパネル形状**: 本 wave 非対象（テーマA は文字/チップ/トークン/グローのみ）。
- **本人実機サニティ項目（受入の最終段）**: ①テーマA の可読性（12px 床・グロー廃止・sans 化の体感）②FY 切替時の S/R 窓連動（過年度で線が窓内に収まる・疎窓で 0 本になり得る点の体感確認）③カード間単位バッジの読みやすさ（PL=億円/BS=兆円併存）④BS 吹き出し（低棒銘柄・銀行・4755.T）とリード線⑤ヘッダ「単位:X」削除の違和感有無。

## 11. 主要決定の記録

- **D1 テーマA反映方式＝発生源修正＋in-place**（override 移植でなく）: !important 持ち込みゼロ・トークン単一源。cascade 罠（media 内縮小の後勝ち）への対処として media 内同時書換を必須化。
- **D2 全ゼロFY＝合流方式**（本人確定・除外方式は不採用）: 除外方式（availableYears filter）は 1 行で済むが 12 銘柄の既定価格窓が FY2025 へ後退し FY2026 価格窓（現在選べる最新窓）が閲覧不能になる副作用があるため不採用。合流方式は DOM 後始末の追加実装を要するがこれを受け入れる。
- **D3 KPI 比較ストリップ＝ゼロ列をフィルタ除去**（「未確定」列表示でなく）: 売上0/YoY-100% バッジは誤誘導であり、FY2026 の存在提示は年ボタンが担うため帯には出さない。
- **D4 CSV＝据置**（ゼロ列も出す）: CSV は生データエクスポート＝アプリ側の解釈を挟まない。根治はデータ側 ETL（別レーン）。
- **D5 ヘッダ「単位: X」＝完全削除**（「各チャート表記」等の代替文言も置かない）: 各カードタイトルのバッジが単位の正となり冗長表示を排除・ETF 無意味表示も同時解消。本人実機 FB 確認事項に含める。
- **D6 financialMaxAbs＝削除**: 消費者ゼロ化（detail.js:656 のみだった）のため dead 化させず export・テストごと整理。
- **D7 BS チップの縦クランプ＝実装しない**: datalabels に縦クランプ機構なし。リード線で帰属明示＋受入アサート（クリップ 0）違反時のみ align 角度で SDD 調整。
- **D8 detail.js:663 ティッカー＝12px**（本人確定・承認済みの見た目に忠実）／**「標準」val-badge＝opacity:0.35**（非表示化しない・本人確定）。
- **D9 S/R maxPerSide 差＝維持**: チャート top-3 描画・digest Infinity 最寄り（M7）。完全一致化は次 wave 判断。
- **D10 BS 単位母集合＝両スタック和の max**（敵対検証 HIGH 由来・セグメント5値 max / totalAssets 単独とも不採用）: stacked 軸上限と厳密一致させ、JPY 5社11行（2269.T/2802.T/7733.T/7741.T/7832.T）の兆層表示を保持（単位層変化ゼロ＝承認済み「JPY 不変」と整合）・負純資産時も負債側和で正しく選層。
- **D11 currency 取得＝各 render 冒頭で `STOCK_DATA[currentTicker]?.currency`**（引数継続案は不採用・pageUnit 引数全廃と整合）。
- **D12 左列低棒の offset＝y 軸幅加算**（敵対検証由来・「y軸目盛の隠れを許容」案は不採用）: 不透明チップが y 軸目盛数字を覆うのを避け padding 帯へ全載り＝機械判定可能性と右側設計との対称性を優先。

## 12. 付録: 次 wave 積み残し（本人指示で明記必須）

**本リストは Obsidian 所有ノート（Projects/investment-portal.md 🎨UIUX刷新スレッド節）へもリスト本体を転記する**（本人指示。wave 完了時の横断記憶整理と同時でよいが、ポインタでなく本体転記＝worktree 片付け後も辿れるようにする）。

**小工数頻出系一掃 wave の候補リスト**（今回スコープ外・着手時に本リストから選定）:
銀行営業利益 0 の N/A 化／CF ウォーターフォールラベル衝突／浮遊「0」退避（※P5 横統一で BS 分は解消・他チャート分が残る）／レーダー団子／S/R 近接マージ（監査A フル版・完全一致化 D9 の再訪含む）／サブパネル二重ラベル・OBV 生値軸・時間軸位置／fitContent／比較チャートバッジ 8 連／トグルバー迷子「?」／タイトル二重ティッカー／P6 債務超過注記／P8 モバイル低棒サマリ／銀行 CF 専用表示／銀行の側パネル流動比率 0.0%（ratioOrNull 化）／cf_cash_start/end 年連鎖（**データ側**・9984.T 3年同一値・本人ローカル作業レーン）／全ゼロ FY2026 行の ETL 除去（**データ側**・同レーン）。

## 13. 再開の合図

- spec 承認後: 「**テーマA+チャート修正の writing-plans から**」（→SDD 実装）。
- 実装中断後: `.superpowers/sdd/progress.md` の Task 状態から再開。
