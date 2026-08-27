# W3「司令室PFMパック」設計 — 資産の推移／前月比／runway／目標の見通し／NISA・確保枠リマインド

- 日付: 2026-08-27
- ブランチ: `worktree-w3-cockpit-pfm`（worktree `.claude/worktrees/w3-cockpit-pfm`・base `a6a34b3`）
- 前提スレッド: UIUX刷新（W1 → W1.5 → W2 に続く W3。2026-08-09 に本人が選定した「機能第1弾」のうち司令室PFM束）
- 所有ノート: Obsidian `Projects/investment-portal.md`「🎨 UIUX刷新スレッド」／司令室の権威ノート `Projects/wealth-cockpit-v2.md`

---

## §1 目的とスコープ

お金の司令室（`#money-view`・`money.js` が `#mcc-root` に描画）に「**資産がどう動いてきて、これからどうなるか**」を
一目で示す PFM の背骨を入れる。現状の司令室は「いまの値」（確定貯蓄額・達成率・投資余力・次の一手）しか持たず、
**時間軸**（推移・前月比・見込み・期限）が無い。

入れるもの（5点・本人選定 2026-08-27）:

1. **資産の推移グラフ** — 月次の総資産（現金＋投資）を積み上げエリアで表示。期間 `6M | 1Y | 2Y | ALL`。
2. **前月比デルタバッジ** — ヒーローの金額に、直近2確定月の総資産差（¥・%）。
3. **runway 月数** — バッファ（現金）で生活費の何ヶ月分か（`buffer ÷ 月の生活費`）。
4. **目標の達成見込み** — 資産目標ごとに「現ペースなら YYYY年M月ごろ」＋期限付きなら「間に合わせるには月 ¥X」。
5. **NISA・確保枠リマインド** — 年内の NISA 残枠（Q4 に強調）と、確保枠の「期日までに不足の見込み」を、
   ヒーロー直下の**リマインド帯**に集約（＋各 fold 内にも行を出す）。

### 非目標（YAGNI）

- **マンスリーレポート**（月次まとめ）と**予算 vs 実績の消化バー** → 次 wave W3.5「月次パック」へ送る
  （予算は state に概念が無く新フィールド設計が要るため）。
- **未配分額の常時表示** → 不採用。3バケツで全額が割当済みの構造上「未配分」は存在せず、実態は既存の
  「今月の投資余力」と重複する。
- **日次スナップショット表**（`me.asset_snapshots` 等）・ETL/cron 変更・migration・新 Vercel 関数（**11/12 を維持**）。
- **時価連動**（保有銘柄×終値）。投資分は現在値で固定（Slice5 の領分）。
- **AI コーチ facts の拡張**。`modeAFacts`／`advice.py`／`tests/fixtures/advice_facts_cases.json`／
  `FACTS_SCHEMA_VERSION`（=6）は**非接触**（本 wave の関数は全て UI 専用＝鏡像義務を発生させない）。
- **state スキーマ変更**（`defaultState`／`migrate`／`_migrate` 非接触）。唯一の永続化は端末 localStorage の期間キー。
- Chart.js／Lightweight Charts の司令室への導入（inline SVG で描く）。

## §2 決定（本人承認済み・2026-08-27）

- **D1 データ源＝月次導出（案A）**。日次の総資産履歴は存在しない（総資産は `mcc_state` の現在値から毎回計算する純関数・
  `cashflow_snapshots`／`investment_snapshots` は月次 PK）。カタログの「1日1点スナップショット・新API不要」は裏付けなし。
  基準（アンカー）＋月次収支から**各月末の現金水準を純関数で復元**する（前方＝加算・後方＝減算）＝既存 30ヶ月分が初日から線になる。
  日次表の新設（案B）・端末での日次点蓄積（案C）は不採用（可動部ゼロ・本人の psql 作業なし・時価連動が無い現状では
  日次点は月次の階段と同じ情報しか持たない）。
- **D2 範囲＝導出で完結する5点**（§1）。マンスリーレポート／予算 vs 実績は W3.5、未配分額は不採用。
- **D3 方式＝inline SVG ＋ 統合リマインド帯**（案1）。Chart.js（案2）は render() 全再描画ごとの destroy→再生成と
  `display:none`→0x0 罠の二重隠蔽（ビュー非表示＋タブ hidden）で地雷面が増えるため不採用。最小構成（案3）は
  警告が折りたたみに埋まり一目性が弱いため不採用。
- **D4 全ロジックは `money-rules.js` の純関数・facts 非出力**。`money.js` は表示のみ（業務 math 禁の既存規律）。
- **D5 期間＝`6M | 1Y | 2Y | ALL`・既定 `1Y`・端末 localStorage `mcc_series_period`**（クラウド state に混ぜない＝
  `mcc_tab` と同じ扱い。未知値は `1Y` へ正規化）。
- **D6 しきい値**＝NISA: 1〜9月 info（NISA fold 内のみ）／10〜11月 warn／12月 urgent（warn 以上でリマインド帯）。
  確保枠: 不足見込み>0 で warn・期日超過未達で urgent。目標: behind（必要月額>余剰）は info（帯には出さず fold 内のみ）。
  前月比バッジは色のみ（＋緑／−赤／0 灰）。runway は `bufferMonths` 未満で amber。
- **D7 「現ペース」の単一源＝`cashflowDerived().monthlySurplus`**（`roadmap.milestones[].projectedMonths` と同じ）。
- **D8 推移カードの置き場＝A ヒーロー直下の独立 fold**（実物モック比較で本人選定・2026-08-27・§6）。B ヒーロー内埋め込み／
  C 収支 fold に同居は不採用。
- **D9 文言は事実＋数値のみ**（売買指示・推奨に読める表現を使わない。§7）。production／personal で出し分けない
  （UI は既にログイン本人向け・LLM へは出さない）。

## §3 データモデル — 月次系列の定義

### 3.1 前提（既存の純関数と同じ土台）

- `cashDerived(rows, investmentRows, anchor)`（`money-rules.js:1035`）: 導出現金 `derivedCash = anchor.amount + Σ_{period ≥ anchor月, is_complete} flow`、
  `flow = balance + invest_cash_flow[period]`。`derivedCashLive` は当月（`is_complete=false`）も含む。
- `effectiveState`（`:1066`）: anchor 設定済み＋rows ありなら `buckets.buffer.amount ← r(derivedCash)` のコピーを返す。
  司令室は `render()` 冒頭で `eff` を1回作り全 VM に配る。`_anchorLinked = (eff !== state)`。
- `investable(eff) = core + satellite`（現在値・履歴なし）。`investmentSource` は保存フラグのみで残高を上書きしない（実測）。

### 3.2 `assetSeries(eff, cashflowRows, investmentRows)`

**意味**: 各月末の現金水準（バッファ）と総資産の月次系列。**アンカー月初の現金 = `anchor.amount`** を固定点に、
アンカー月以降は前方へ、アンカー月より前は後方へ、同じ `flow` を累積する。

```
anchorYM = anchor.date.slice(0,7)                      // "2025-09"
rows     = cashflowRows(cashflowRows_in)                // 既存: period 昇順・不正行除去
icf      = { period → invest_cash_flow }                // cashDerived と同一
flow(m)  = rows[m].balance + (icf[m] || 0)

点 P(anchor−1) : cash = anchor.amount（アンカー月初＝前月末。行が無くても定義される・isAnchor=true）
前方: m = anchorYM, anchorYM+1, … : rows[m] があれば cash(m) = cash(m−1) + flow(m)。無ければ打切（truncatedForward=true）。
      is_complete=false の行は「末尾の1件」だけ暫定点（isComplete=false）として含め、以後は打切。
後方: m = anchorYM−2, anchorYM−3, … : rows[m+1] があり is_complete なら cash(m) = cash(m+1) − flow(m+1)。無ければ打切（truncatedBackward=true）。
invest(m) = investable(eff)（全点同値）
total(m)  = cash(m) + invest(m)
```

**戻り値**
```js
{
  available: boolean,            // 下の全条件を満たすとき true
  reason: "" | "noAnchor" | "noRows" | "noCompleteRows" | "currency",
  anchorPeriod: "YYYY-MM-01",
  points: [{ period: "YYYY-MM-01", cash, invest, total, isComplete, beforeAnchor, isAnchor }],  // period 昇順
  truncatedForward: boolean, truncatedBackward: boolean,
  latestCompleteIndex: number|-1, liveIndex: number|-1,   // 暫定点（当月）の位置
}
```
- `available` 条件: `anchor.date` あり（正規化済み）／rows が1件以上／`is_complete` の行が1件以上／`eff.currency !== "USD"`
  （kakeibo は JPY 前提＝`cashflowDerived.currencyMismatch` と同じ）。不成立時は `points: []`。
- **不変条件（node テストで機械証明）**: `!truncatedForward` のとき、`points` の最後の `isComplete` 点の `cash` は
  `cashDerived(...).derivedCash` と**厳密一致**、暫定点があればその `cash` は `derivedCashLive` と厳密一致
  （値は `NUMERIC(14,0)` 由来の整数＝加算順序に依存しない。テスト fixture も整数）。
- `points.length` の上限は設けない（API 側 `MAX_MONTHS=60` が上限）。ALL は全点。
- **ここで丸めない**（表示側の `fmt` で `R.yen` が丸める＝par-2 の単一丸め）。

### 3.3 派生の小関数

| 関数 | 入力 | 出力 | 定義 |
|---|---|---|---|
| `SERIES_PERIODS` | — | `["6M","1Y","2Y","ALL"]` | 定数（表示順） |
| `normalizeSeriesPeriod(key)` | any | key | 未知／非文字列 → `"1Y"` |
| `seriesWindow(points, key)` | 3.2 の points | points 部分配列 | `6M→末尾6点／1Y→12／2Y→24／ALL→全点`（点数不足はそのまま） |
| `momDelta(points)` | 3.2 の points | `{available, prevPeriod, curPeriod, delta, pct\|null, sign:-1\|0\|1}` | 直近2つの `isComplete` 点の `total` 差。`pct = delta/prev.total*100`（prev.total が 0 なら null）。確定点<2 → `available:false` |
| `runwayMonths(eff)` | eff | `{available, months, target, low}` | `months = round1(buffer.amount / monthlyExpense)`（`monthlyExpense<=0` → `available:false`）。`target = bufferMonths`。`low = months < target` |
| `monthsBetweenYM(nowMs, ymd)` | epoch, `YYYY-MM(-DD)` | number\|null | `reserveMonthly` の月差と**同じ式**（UTC・`[1,9999]` 年ガード・不正は null）を新関数として持つ。`reserveMonthly` 自体は無改変（§3.4）＝テストで両者の一致を機械確認 |
| `spanDelta(points, months)` | 3.2 の points, 12 等 | `{available, delta, fromPeriod, toPeriod}` | 最新確定点と「その `months` 個前の点」の `total` 差（点が無ければ `available:false`）。fold digest の「直近12ヶ月」用・選択窓に依存しない |
| `goalOutlook(goal, total, monthlySurplus, nowMs)` | `normalizeGoal` 済み goal, `totalAssets(eff)`, D7 のペース, epoch | 下記 | 目標1件の見通し |
| `reserveOutlook(ra, nowMs, hasSurplusCtx)` | `cashflowDerived().reserveAlloc[i]`, epoch, `cv.available && cv.surplusPositive` | 下記 | 確保枠1件の見通し |
| `nisaReminder(nvm, nowMs)` | `nisaViewModel()` の戻り, epoch | 下記 | 年内残枠のリマインド |
| `reminders(input)` | `{nisa: nisaReminder結果, reserves: [{id,label,deadline,allocated,outlook}]}` | `[{key,id,label?,deadline?,allocated?,level,jump,data}]` | 帯に出す項目（warn/urgent のみ・urgent→warn 順・同レベルは入力順）。`deadline`／`allocated` は帯の文言用に素通し |

**`goalOutlook`**
```
remaining      = max(0, targetAmount − total)
etaMonths      = projectMonths(remaining, monthlySurplus)          // 既存関数（pace<=0 → null）
etaPeriod      = etaMonths===null ? "" : now + etaMonths ヶ月 の "YYYY-MM"（UTC 月加算）
monthsLeft     = deadline ? monthsBetweenYM(nowMs, deadline) : null   // 期限月 − 今月（負＝超過）
requiredMonthly= deadline && monthsLeft!==null ? ceil(remaining / max(1, monthsLeft)) : null
status         = remaining===0 ? "achieved"
               : (deadline && monthsLeft<0) ? "overdue"
               : deadline ? (monthlySurplus>0 && requiredMonthly<=monthlySurplus ? "onTrack" : "behind")
               : (monthlySurplus>0 ? "noDeadline" : "noPace")
戻り値 { remaining, etaMonths, etaPeriod, monthsLeft, requiredMonthly, status }
```
**`reserveOutlook`**（`ra` は `cashflowDerived().reserveAlloc` の1要素＝`{target, saved, deadline, suggestedMonthly, allocated, complete}`）
```
monthsLeft       = deadline ? monthsBetweenYM(nowMs, deadline) : null
if (!hasSurplusCtx)         → status "unknown"（収支未連携／余剰なしの月は見通しを語らない＝既存 reservesSection の hasSurplusCtx と同じ線）
complete                    → "complete"
!deadline                   → "noDeadline"
monthsLeft < 0              → "overdue"（projectedShortfall = target − saved）
else projectedSaved = saved + allocated × max(1, monthsLeft)   // reserveMonthly の「残月 min 1」と同じ暦
     projectedShortfall = max(0, target − projectedSaved)
     status = projectedShortfall>0 ? "short" : "onTrack"
戻り値 { monthsLeft, projectedSaved, projectedShortfall, status }
```
**`nisaReminder`**（`nvm` = `nisaViewModel()`・`nisaNow(nowMs)` で月を取る＝既存と同じ UTC 暦）
```
if (!nvm.configured || !now.valid || nvm.annual.total.remaining <= 0) → { level: "none" }
level = monthIndex<=8 ? "info" : monthIndex<=10 ? "warn" : "urgent"      // 0基: 0-8=1〜9月, 9-10=10〜11月, 11=12月
monthsLeft = nvm.monthsLeft（既存・12 − monthIndex）
monthlyToFillTotal = ceil(nvm.annual.total.remaining / monthsLeft)
戻り値 { level, year, monthsLeft, remainingTotal, remainingTsumitate, remainingGrowth,
         monthlyToFillTotal, monthlyToFillTsumitate: nvm.monthlyToFillTsumitate, monthlyToFillGrowth: nvm.monthlyToFillGrowth }
```
**`reminders`**: `nisa.level ∈ {warn,urgent}` → `{key:"nisa", level, jump:"nisa", data:nisa}`；各 reserve の
`outlook.status === "short"` → warn／`"overdue"` → urgent（`jump:"reserves"`）。目標は含めない（D6）。

### 3.4 変更しないもの（機械確認する）

- `defaultState`／`migrate`／`normalize*`／`modeAFacts`／`nisaFacts`／`cashflowDerived`／`cashDerived`／`effectiveState`：**無改変**
  （`git diff` で関数本体に差分が無いこと・`tests/test_advice_facts.py` 106 とパリティ fixture 71 ケースが不変）。
- `api/` 配下：**無接触**（`git diff --stat -- api/` が空）。

## §4 描画（`money.js`）

### 4.1 render() の配線

```
var series = R.assetSeries(eff, _cashflowRows, _investmentRows);
var mom    = R.momDelta(series.points);
var rw     = R.runwayMonths(eff);
var gol    = vm.goals.map(g => R.goalOutlook(g, vm.totalAssets, cd.monthlySurplus, now));   // vm.goals は goalProgress 済み（targetAmount/deadline を持つ）
var hasSurplusCtx = cv.available && cv.surplusPositive;
var rol    = cd.reserveAlloc.map(ra => R.reserveOutlook(ra, now, hasSurplusCtx));
var nrem   = R.nisaReminder(nvm, now);
var rem    = R.reminders({ nisa: sync.loggedIn ? nrem : null,
                          reserves: cd.reserveAlloc.map((ra,i) => ({ id: ra.id, label: ra.label, deadline: ra.deadline, allocated: ra.allocated, outlook: rol[i] })) });
```
- **`nisa` は未ログインでは渡さない**（`sync.loggedIn ? nrem : null`）。確保枠は cashflow が無い＝`hasSurplusCtx=false` で自然に
  `unknown` に落ちるが、NISA はローカル state だけで成立するため、素通しすると未ログイン画面に残枠の ¥ が出る（§8「未ログイン＝帯非表示」
  と矛盾する）。受入は `w3-smoke.js` S3 の「未ログインは帯 0 件」。
- `deadline`／`allocated` は帯の文言用の素通し（§3.3）。
- `now` は既存の `render()` 内 1 回の `Date.now()` を共有（同一描画で時刻がずれない）。
- 各セクションへは**引数で渡す**（module 変数を増やさない）。`heroSection(vm, cv, cd, mom, rw)`／`reminderRail(rem)`／
  `seriesSection(series, mom, periodKey)`／`goalsSection(vm, gol)`／`reservesSection(cv, cd, rol)`／`nisaSection(vm, nrem)`。

### 4.2 推移カード（`seriesSection`）

- 期間バー: `SERIES_PERIODS` のボタン。`onclick="MCC.setSeriesPeriod('1Y')"` → localStorage 保存 → `render()`
  （司令室の描画入口は render() 一本＝部分再描画を新設しない）。選択中は `aria-pressed="true"`。
- SVG: `seriesSvg(points, opts)`（`money.js`・`sparkline()` と同型の**表示幾何**。業務値は points をそのまま使う）。
  - `viewBox 640×220`（B 案なら 640×120）・`preserveAspectRatio="none"` は使わない（文字が歪む）→ `width:100%` の等比。
  - 積み上げエリア: 現金（`--c-cyan`・fill 0.22・線 1.5px）の上に投資（`--c-indigo-bright`・fill 0.25）。
  - Y 目盛 3 本（`niceStep`＝1/2/5×10^n の丸め・左に短縮¥「120万」「1,200万」）。X ラベル最大 4 個（`YYYY/MM`）。
  - 点: 確定＝塗り丸 r=2.5／暫定（`isComplete=false`）＝中抜き丸／アンカー点（`isAnchor`）が窓内にあれば縦の点線＋「基準」ラベル
    （窓の**先頭**がアンカー点ならラベル省略・点線のみ＝§6 注意1。窓外なら何も描かない）。
  - ヒット矩形: 各点に透明な `<rect class="mcc-series-hit" data-cap="…">`（列幅）を置き、`mousemove`／`touchstart`／`focus`
    で `data-cap` をキャプション行 `.mcc-series-cap` へ**コピーするだけ**（ハンドラに math を置かない）。初期表示＝最新点。
  - キャプション書式: `2026年3月：総資産 ¥2,340,000（現金 ¥1,740,000・投資 ¥600,000）`／暫定点は末尾に「（当月・暫定）」。
- 注記: 「投資分（コア＋サテライト）は現在値で固定・時価ではありません」（常時）／「基準（YYYY年M月）より前は収支から逆算」
  （**窓内にアンカーより前の点があるときだけ**・§6 注意2）／「◯年◯月以前は収支データが無いため表示していません」（`truncatedBackward` かつ
  窓が系列の先頭を含むとき）／
  「◯年◯月より後は収支データが欠けているため表示していません（グラフと前月比は同月までの値です）」（`truncatedForward` のとき・
  ◯年◯月＝系列の**最終点**の月）。**前方打切の注記は省略不可**＝ヒーローの確定額（`cashDerived`）は欠月より後の確定行も足すため
  系列の最終点と一致せず、前月比バッジ（`momDelta(series.points)`）も打切った月で止まる。注記が無いと画面上で無音の不一致になる。
- fold: `foldSection("mcc-sec-series", "mcc-fold-series", "資産の推移", digest, body)`。`_FOLD_DEFAULT_OPEN["mcc-sec-series"] = true`
  （§6 注意3）。`_JUMP_TARGETS` に `series: { id: "mcc-sec-series", tab: "dash" }` を追加（帯やガイドから参照できるように）。
- 非 available 時（§8）: 案内文のみ（グラフ枠は出さない）。

### 4.3 ヒーロー

- **前月比バッジ**: `.mcc-hero-amount` の**兄弟**として `<span class="mcc-hero-mom pos|neg|flat">前月比 +¥123,456（+5.2%）</span>`
  （`.mcc-hero-amount` の中身は金額のみのまま＝既存 E2E の金額アサートを壊さない）。表示条件＝`_anchorLinked && mom.available`。
  `pct===null` なら `（+5.2%）` を省く。
- **runway チップ**: `.mcc-hero-gauge-row` の末尾に `<span class="mcc-hero-runway ok|low">生活費 4.3ヶ月分</span>`。
  表示条件＝`vm.bufferConfigured && rw.available`。`low` は `--c-amber`。

### 4.4 リマインド帯（`reminderRail`）

- ヒーロー直下（`stepperSection` と `cashflowSection` の間）。`rem.length===0` なら**空文字**（DOM を作らない）。
- `<div class="mcc-rail"><div class="mcc-rail-item warn|urgent">● 本文 <a class="mcc-jump" onclick="MCC.jumpTo('nisa')">→ NISA</a></div>…</div>`
  （`jumpLink` を流用・fold は jumpTo が自動 open）。
- 「次の一手」帯（配分の1手）とは役割分離：帯は**期限・枠**の注意だけを扱う。

### 4.5 各 fold 内の行

- goals: `.mcc-goal-stat` の直後に `<div class="mcc-goal-outlook [behind|overdue]">…</div>`（§7 の文言）。
- reserves: `.mcc-rsv-sub` の直後に `<div class="mcc-rsv-outlook [short|overdue]">…</div>`（`status` が `unknown|noDeadline|complete` なら出さない）。
- nisa: 本文先頭に `<div class="mcc-nisa-reminder info|warn|urgent">…</div>`（`level!=="none"` のとき）。
  digest（summary の1行）にも `残枠 ¥X` を足す（既存 digest に追記・既存の文字は変えない）。

### 4.6 公開面・永続化

- `window.MCC` に `setSeriesPeriod` を追加（`money.js:2266` の return に追記＝忘れると無音故障）。
- localStorage: `mcc_series_period`（`_TAB_KEY` と同じ扱い・cloud state 非同梱・`normalizeSeriesPeriod` で読む）。
- `animateNumber` は司令室に無い（静的テキスト）＝`bumpAnimSeq` 不要。

## §5 スタイル（`money.css`・theme D）

- `.mcc-series`（カード本体）／`.mcc-series-bar`（期間ボタン群・`flex-wrap`）／`.mcc-series-btn[aria-pressed=true]`（シアン縁）／
  `.mcc-series-svg`（`display:block; width:100%; height:auto`）／`.mcc-series-cap`（12px・`--c-text-dim`）／`.mcc-series-note`。
- `.mcc-hero-mom.pos{--c-emerald-bright} .neg{--c-danger-soft} .flat{--c-text-dim}`／`.mcc-hero-runway.low{--c-amber}`。
  `.mcc-hero-amount { display:inline-block }`（バッジを同じ行の右に置くため・§6 注意6。860px 未満では折り返して金額の下段に落ちてよい）／
  `.mcc-hero-gauge-row { flex-wrap: wrap }`（§6 注意7）。
- `.mcc-rail`（`.mcc-fold` と同じ罫線色 `rgba(129,140,248,0.2)`・左 3px の色帯 warn=amber／urgent=danger）。
- 390px: SVG は幅追従・期間バーは折返し・帯は縦積み（`.mcc-hero` の 860px ブレークポイントと同系）。
  - 狭幅（`window.innerWidth < 640`）は viewBox を 360×200（padL 52・padR 10）で描き、X ラベルは3個（先頭・中央・末尾）。640 幅のまま縮小すると 11px の軸ラベルが実効 ~6px になって読めないため（実効 ~9.3px に回復）。
- 面の光（radial/nebula）は足さない（グラス干渉の既知事故）。

## §6 推移カードの置き場（D8・モック実物比較で確定）

| 案 | 位置 | 長所 | 短所 |
|---|---|---|---|
| A | ヒーロー直下の独立 fold「資産の推移」（既定 open） | 一目性・他 fold と同じ操作感・digest に前月比 | ダッシュボードの縦が +約 300px |
| B | ヒーロー本体（`.mcc-hero-main`）の中にコンパクト版 | 金額とグラフが同じ視野・縦の増加が最小 | ヒーローが重くなる・期間バーが小さい・390px で窮屈 |
| C | 収支 fold（`#mcc-sec-cashflow`）の中に同居 | 収支と同じ文脈・新 fold を増やさない | 収支 fold を閉じると見えない・fold の主題が二重化 |

- モック: `scratchpad/w3-mock-server.py`（合成 fixture・本人データ非使用）＋ `scratchpad/w3-variants.js`（`?w3variant=A|B|C`・
  `?w3now=YYYY-MM-DD` でリマインドの月を再現）＋ `scratchpad/w3-mock-shots.js`（12枚・pageerror 0・ヒーロー確定額＝系列最終確定点 12/12 一致）。
  PC 1440／390px。
- **選定結果＝A（本人・2026-08-27）**。ヒーロー直下の独立 fold `id="mcc-sec-series"`（accent `mcc-fold-series`・名前「資産の推移」）。
  既定 open（`_FOLD_DEFAULT_OPEN` に追加＝保存が無いときだけ open・閉じれば `mcc_details` に保存され次回も閉じたまま）。
  digest＝`前月比 +¥110,000・直近12ヶ月 +¥1,205,000`（`momDelta` と `spanDelta(points, 12)`・選択窓に依存しない。どちらも
  `available:false` なら該当部分を省く。両方無ければ `推移を表示`）。
  B は右カラムの余白・期間バーの小ささ、C は fold 主題の二重化で不採用（モック実物で確認）。
- モックで判明した実装上の注意（本実装で必ず反映）:
  1. 既定 1Y 窓ではアンカー月が窓の**先頭**に来る（fixture 2025-09 の例）＝縦点線と「基準」ラベルが Y 軸に重なる → **窓の先頭点がアンカー点なら
     ラベルを出さず点線のみ**。6M 窓ではアンカーが窓外＝点線もラベルも出さない。
  2. 「基準より前は収支から逆算」の注記は**窓内にアンカーより前の点が実在するときだけ**出す。
  3. `mcc_details` は `details[id]` を無差別に保存する＝新 fold は自動的にこの仕組みに乗る（追加作業は `_FOLD_DEFAULT_OPEN` の1行）。
  4. リマインドの月判定は `render()` が1回取る `now` を使う（`Date.now()` を関数内で再取得しない）。受入で日付を動かすときは
     Playwright の `context.addInitScript` で `Date.now`／`new Date()` を固定する（本体は URL パラメータを読まない＝モックの `w3now` は
     オーバーレイ専用）。
  5. 確保枠の `allocated` は `cashflowDerived().reserveAlloc[i].allocated`（モックの近似は使わない）。
  6. 前月比バッジを金額と同じ行に置くには `.mcc-hero-amount { display:inline-block }` が要る（§5）。
  7. `.mcc-hero-gauge-row` に `flex-wrap: wrap`（runway チップで 390px が溢れる・§5）。

## §7 文言（決定論・事実＋数値・D9）

| 場所 | 文言 |
|---|---|
| 前月比バッジ | `前月比 +¥123,456（+5.2%）`／`前月比 −¥45,000（−1.8%）`／`前月比 ±¥0` |
| runway チップ | `生活費 4.3ヶ月分`（`low` は同文言で amber・title に「目標 6ヶ月分」） |
| 帯 NISA warn | `今年の NISA 非課税枠が ¥X 残っています（月 ¥Y で年内満額・残 Nヶ月）。年内に使わなかった枠は翌年に繰り越せません。 → NISA` |
| 帯 NISA urgent | `今年の NISA 非課税枠 ¥X が未使用です（今月が最後・翌年に繰り越せません）。 → NISA` |
| 帯 確保枠 short | `「車検・保険」は期日（2026年11月）までに ¥X 不足の見込みです（今のペース 月 ¥Y）。 → 確保枠` |
| 帯 確保枠 overdue | `「車検・保険」は期日（2026年11月）を過ぎていますが ¥X 未達です。 → 確保枠` |
| goal onTrack | `達成見込み 2028年3月ごろ（現ペース 月 ¥Y）・期限に間に合う見込み（必要 月 ¥X）` |
| goal behind | `達成見込み 2029年1月ごろ（現ペース 月 ¥Y）・期限（2028年3月）に間に合わせるには 月 ¥X` |
| goal noDeadline | `達成見込み 2028年3月ごろ（現ペース 月 ¥Y）` |
| goal noPace | `現ペースでは見込みが立ちません（余剰が 0 の月が続いています）` |
| goal overdue | `期限（2026年3月）を過ぎています・あと ¥X` |
| reserve short | `期日までに ¥X 不足の見込み（今のペース 月 ¥Y）`／onTrack `期日までに確保できる見込み` |
| nisa fold 内 | `今年の非課税枠は翌年に繰り越せません。残り ¥X（つみたて ¥a・成長 ¥b）・月 ¥Y で年内満額（残 Nヶ月）` |
| 推移 非available | noAnchor: `「貯蓄の基準」で基準（アンカー）を設定すると推移が表示されます`（jumpLink anchor）／noRows・noCompleteRows: `収支データが連携されると推移が表示されます`／未ログイン: `ログインすると推移が表示されます`（jumpLink sync）／currency: `JPY 以外の通貨には対応していません` |

- 「使い切るべき」「買い足すべき」「投資に回しましょう」等の**指示・推奨語は使わない**（既存の決定論テンプレと同じ線）。
- 年月表記は `fmtAnchorMonth` と同系（`YYYY年M月`）。金額は `R.yen`（¥＋3桁区切り）。

## §8 劣化と例外

| 状況 | 挙動 |
|---|---|
| 未ログイン | 推移＝案内文（ログイン）・バッジ／チップ／帯＝非表示（cashflow が無いので `series.available=false`、確保枠は `unknown`。**NISA だけはローカル state で成立するので render() が `nisa: sync.loggedIn ? nrem : null` で明示的に落とす**＝`rem=[]`）。runway は `bufferConfigured` なら出す（保存値ベース・既存ゲージと同じ扱い） |
| ログイン済・アンカー未設定 | 推移＝案内文（貯蓄の基準へ）・バッジ非表示・帯は確保枠／NISA の分だけ出る |
| rows はあるが確定行ゼロ（初月） | `reason:"noCompleteRows"`・案内文。暫定点だけの線は描かない |
| 行の欠月 | 連続部分だけ描き、`truncatedBackward`／`truncatedForward` の**両方**に注記を出す（§4.2）。不変条件は `!truncatedForward` の時のみ主張 |
| USD | `reason:"currency"`（既存 `currencyMismatch` と同じ） |
| `monthlyExpense = 0` | runway 非表示。goal/reserve は影響なし |
| `monthlySurplus = 0` | goal=`noPace`／reserve=`unknown`（`hasSurplusCtx=false`）＝警告を出さない（既存 `shortfall` の扱いと同じ） |
| 期限の月が今月 | `monthsLeft=0` → `max(1, …)`＝今月分で判定（`reserveMonthly` と同じ） |
| NISA 未設定／残枠 0／超過 | `level:"none"`（超過は既存 UI の `over` 表示に任せる） |
| 巨大値／NaN | 入力は既存 `cashflowRows`／`num` で正規化済み。`projectMonths` は非有限を null に落とす（既存） |
| fold が閉じている | 帯の jumpTo が自動 open（既存） |

## §9 既存受入への影響

- `scratchpad/cockpit-e2e.js`（**241**＝2026-08-27 実測。旧記載「235」は W2 以前からの陳腐化で、本 wave は `check(` 呼出を
  base/head とも 212 で1件も増やしていない）: ヒーローの `.mcc-hero-amount` は**金額のみ**を維持（バッジは兄弟要素）。ゲージ行に
  チップが増えるが `.mcc-hero-gauge-pct` は不変。fixture（2026-07 の 1 確定行）では `momDelta.available=false`＝バッジ無し、
  `series.available=true` で点は 2（アンカー点＋7月）。**期待値の変更なし**で緑のはず＝実行して確認。
- `scratchpad/portal-money-smoke.js`: 横断動線のみ＝影響なし（実行して確認）。
- `scratchpad/wave-closure.sh`（W2 用）: 司令室を含まない＝本 wave の受入は §10.2 を別途回す。
- `detail-snapshot`／`f2-snapshot`: `#money-view` の DOM を含む f2-snapshot は差分が出る（新要素）＝**本 wave では f2 の比較対象外**
  とし、pageerror 0 と公開面の typeof のみ確認。

## §10 テスト計画

### 10.1 node ユニット（新規 `tests/money-pfm.test.js`・`NODE_PATH` 不要・`node --test tests/*.test.js`）

- `assetSeries`: 前方累積／後方累積／アンカー点／暫定点（末尾のみ）／欠月打切（前後）／`available` の各 reason／
  **不変条件**（最後の確定点 cash === `cashDerived().derivedCash`・暫定点 === `derivedCashLive`・整数 fixture 30ヶ月＋負の月）／
  `invest_cash_flow` の合流（icf）／USD／points が period 昇順。
- `seriesWindow`／`normalizeSeriesPeriod`: 6/12/24/ALL・点数不足・未知値→1Y。
- `momDelta`: 2確定点／1確定点／prev.total=0 で pct null／暫定点は無視／符号。
- `runwayMonths`: 正常・`monthlyExpense=0`・`low` の境界（`months === target` は low=false）。
- `monthsBetweenYM`: 同月=0・翌月=1・前月=−1・年跨ぎ・不正 deadline=null・年 >9999=null。
- `goalOutlook`: achieved／onTrack／behind（境界 `requiredMonthly === monthlySurplus` は onTrack）／noDeadline／noPace／overdue／etaPeriod の年跨ぎ。
- `reserveOutlook`: unknown／complete／noDeadline／overdue／short／onTrack／`monthsLeft=0`。
- `nisaReminder`: none（未設定・残0）／info・warn・urgent の月境界（9月=info・10月=warn・12月=urgent）／`monthlyToFillTotal`。
- `reminders`: 順序（urgent→warn）・goal 非含有・空。
- **非接触の機械確認**: `R.modeAFacts` の出力キー集合が既存 fixture 71 ケースで不変（`tests/money-rules.test.js` のパリティテストが担う）。

### 10.2 ブラウザ受入（新規 `scratchpad/w3-smoke.js`・Playwright・`NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js`）

- 配信: `scratchpad/w3-mock-server.py`（§6 と同じ合成 fixture・変数 `W3_VARIANTS=0` でモック注入なし）を自前起動。
- シナリオ（PC 1440×900／390×844 × ログイン済 fixture）:
  1. 推移カードが描画され、SVG の確定点数＝fixture の連続確定月数＋1（アンカー点）、暫定点 1。
  2. 期間切替 6M→ALL→2Y で点数が 6／全点／24 に変わり、localStorage `mcc_series_period` に保存、リロード後も維持、未知値は 1Y。
  3. hover（PC）／tap（390px）で `.mcc-series-cap` が該当月の文言に変わる。
  4. ヒーローの前月比バッジ（符号・色クラス）と runway チップ（`low` の有無）が fixture から計算した期待値と一致（期待値は
     テスト側で `money-rules.js` を直接 require して算出＝二重実装しない）。
  5. リマインド帯: `addInitScript` で `Date.now()` を 2026-08-15 に固定＝NISA が出ず確保枠 short のみ／2026-11-15 で NISA warn が加わり
     順序は urgent→warn／2026-12-15 で urgent／帯のリンクで fold が open してスクロール。
  6. goals／reserves／nisa の各行の文言（status ごと）。
  7. 未ログイン（session 401）で推移が案内文・帯なし・pageerror 0。
  8. 既存 `cockpit-e2e.js`（241・実測）・`portal-money-smoke.js` を同じ木で再実行して緑。
- **偽陽性の潰し**（W2 の型）: `assetSeries` の後方累積を故意に壊す／`reminders` の順序を壊す／`setSeriesPeriod` の LS 保存を外す、
  の3つで対応するアサートが**赤になる**ことを一度確認してから緑を主張する。

### 10.3 既存スイート

- `node --test tests/*.test.js`（既存 178＋新規）／`/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_advice_facts.py`（106 不変）／
  `git diff --stat -- api/` が空。

## §11 リスクと申し送り

- **系列の意味**: 「kakeibo の balance（＋投資現金フロー）が現金の増減を全て説明する」という既存 `cashDerived` と同じ仮定に乗る。
  後方導出も同じ仮定＝アンカー以前に別口座の入出金があれば線がずれる（注記で「収支から逆算」と明示）。
- **投資分は平ら**: 総資産の動きは現金分だけ。時価連動（Slice5）が入ったら `invest(m)` を差し替えるだけの構造にしておく
  （`assetSeries` の invest 算出を 1 箇所に閉じる）。
- **UTC 暦**: `nisaNow`／`monthsBetweenYM` は既存に合わせ UTC。月末深夜（JST 0〜9時）は月がずれ得る＝既存と同じ既知事項。
- **CTA 過多**: 帯は warn/urgent のみ・goal は fold 内のみ（D6）。それでも「次の一手」と並ぶと 2 帯になる＝モック比較で本人が確認。
- **render() 全再描画**: 期間切替も render() 経由＝入力中フォーカスの復元は既存機構（`_pendingFocusKey`）に乗る。
- **LS キー追加**: `mcc_series_period` は `_TAB_KEY` と同じく cloud 非同梱を守る（同梱すると他端末の期間が LWW で書き換わる）。
- **f2-snapshot** の司令室 DOM 差分は想定内（§9）。次に f2 の基準を取り直す時は本 wave 後の DOM を capture する。
- W3.5 送り: マンスリーレポート（月次まとめ）／予算 vs 実績（要 `budgets` フィールド設計＋kakeibo 費目→バケツの対応表）。
- **`.claude/CLAUDE.md`（Task 7 Step 1）は本 wave では未実施**: このファイルは git 管理外かつ物理的に main チェックアウト配下
  `/home/shugo/apps/investment-portal/.claude/CLAUDE.md` にのみ存在し、worktree からは `git add` できない（worktree に `.claude/`
  自体が存在しない）。先例＝`c64e6b6`（W1 パック時・`docs/superpowers/specs/2026-08-23-w1-portal-price-pack-design.md` §16 に
  同型の記録あり）。追記予定だった「W3 司令室PFMパック」の
  恒久運用注意ブロックの原文は `task-7-report.md`（`.gitignore` の `.superpowers/` 配下＝worktree を消すと失われる）にしか無かったので、
  **下に逐語で写して tracked にした**。**main 統合（merge）を行うセッションが `.claude/CLAUDE.md` の「お金の司令塔／司令室」節・
  `- **E2Eハーネス**＝…` bullet の直後へ次のブロックを追記する**こと。
  **同時に、その直前の `- **E2Eハーネス**＝…` bullet の「235アサート」を「241アサート」に直す**（2026-08-27 実測 241/241。
  `check(` 呼出は base/head とも 212 で本 wave は 1 件も増やしていない＝235 は W2 以前からの陳腐化。直さないと着地直後から
  誤った基準値が恒久ノートに載る）。

  ```markdown
    - **🆕 W3 司令室PFMパック（spec `docs/superpowers/specs/2026-08-27-w3-cockpit-pfm-design.md`）**：資産の推移（月次導出＝`R.assetSeries`・アンカー月初を固定点に前方+Σ/後方−Σ・invest は現在値固定・欠月で打切）／前月比 `momDelta`／runway `runwayMonths`／目標 `goalOutlook`／確保枠 `reserveOutlook`／NISA `nisaReminder`／帯 `reminders`。**全て UI 専用の純関数＝facts 非出力・advice.py 鏡像なし・state 不変**。グラフは inline SVG（`seriesSvg`・インスタンス管理なし）。期間は端末 LS `mcc_series_period`（クラウド非同梱）。⚠**不変条件**＝`assetSeries` の最後の確定点 cash === `cashDerived().derivedCash`（`tests/money-pfm.test.js` が機械証明・`cashDerived` の flow 定義を変えるなら両方同時に）。⚠`.mcc-hero-amount` の中身は金額のみ（前月比バッジは兄弟 `.mcc-hero-mom`）。⚠欠月があると系列だけ打ち切られヒーローの確定額とずれる＝`truncatedForward`／`truncatedBackward` の注記を消さない。受入＝`W3_VARIANTS=0 python3 scratchpad/w3-mock-server.py`（w3-smoke が自前起動）＋`NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js`。
  ```

## §12 変更するファイル

- `money-rules.js`: §3 の純関数を追加（既存関数は無改変）＋ UMD return に追記。
- `money.js`: §4（`seriesSection`／`seriesSvg`／`reminderRail`／hero・goals・reserves・nisa の差し込み／`setSeriesPeriod`／
  hover ハンドラ／`window.MCC` 追記）。
- `money.css`: §5。
- `tests/money-pfm.test.js`: 新規（§10.1）。
- `scratchpad/w3-mock-server.py`／`scratchpad/w3-variants.js`／`scratchpad/w3-mock-shots.js`: モック比較資産（リポに残す・配信は
  `.vercelignore` の scratchpad 除外で本番に出ない）。`w3-mock-server.py` は §10.2 の受入でも配信役を兼ねる（`W3_VARIANTS=0` で
  `w3-variants.js` の注入を止める＝本実装の money.js だけを検証する）。
- `scratchpad/w3-smoke.js`: 受入（§10.2）。
- `docs/superpowers/specs/2026-08-27-w3-cockpit-pfm-design.md`（本書）／`docs/superpowers/plans/2026-08-27-w3-cockpit-pfm.md`（次工程）。
- 非接触: `index.html`／`api/**`／`db/**`／`scripts/**`／`tests/fixtures/advice_facts_cases.json`／`vercel.json`。
