---
date: 2026-07-17
tags: [investment-portal, nisa, money-cockpit, stage2, layer1]
project: investment-portal
related: [[2026-07-16-nisa-quota-design]], [[strategy-personal-finance-advice-intent]]
---

# NISA枠 Stage2（年別履歴）— 設計書

## §0 目的と戦略文脈

Stage1（`2026-07-16-nisa-quota-design.md`・本番LIVE `0188236`）は NISA 使用状況を**累計スカラー手入力6値**で追跡した。Stage2 は spec §8 の段階構成に従い、入力源を**年別履歴配列**（`nisa.source:'history'`）へ差し替え、狙いである**精密な再利用/監査**を成立させる。

Stage1 の限界＝**復活の粒度**。`soldThisYearAtCost` が枠別でない合算1本のため、成長投資枠の内数上限（1200万）の復活を正しく戻せない。また生涯簿価残をユーザーが手で減算維持する運用のため、「いつ・いくら復活したか」が記録として残らない＝監査できない。

Stage2 はこの2点を解く。**facts の形状は変えない**（§3）。既存 facts の精度だけが上がる。

## §1 確定事項（製品判断・変更不可）

ブレスト 2026-07-17（xhigh + ultracode・understand workflow `wf_ca6bf184-82e` の構造マップに基づく）でユーザー確定：

1. **履歴1行＝5項目**（年 / つみたて拠出 / 成長拠出 / 売却簿価(つみたて由来) / 売却簿価(成長由来)）。売却を枠別に持つ＝成長枠内数1200万の復活を正しく戻すため。取得年ひも付き・銘柄単位は不採用（新NISA の復活ルールは取得年に依存せず簿価額で戻るため精度向上が限定的／銘柄単位は Stage3 ledger と重複）。
2. **入力源は排他＋初回1回だけ移行**。`source='history'` なら履歴が唯一の入力源。切替時に当年3値を当年行へ1回だけ転記。併存（履歴に無い年は手入力フォールバック）は不採用＝合計値の出所が常に曖昧になり監査目的と矛盾。
3. **年別履歴を production facts に出さない**（facts 形状不変）。`FACTS_SCHEMA_VERSION` は **5 据置**。schema bump / fixture literal 98箇所置換 / coarsen 明示走査追記 / DENY 名前衝突をすべて回避しつつ、既存 facts の精度は上がる。
4. **`staleAnchorYear` は履歴モードで常に false**（キーは維持・意味だけ縮退）。履歴は各行が年を持つため年ロールオーバーが自動解決し、警告が純粋な誤警報になるため。
5. **全再描画問題は render() の汎用パッチで治す**（Stage2 に含める）。open な `<details>` とフォーカスの復元。Stage1 の入力・資産クラス入力・設定のアコーディオンも同時に治る。
6. **年の重複は「純関数で後勝ちで畳む」＋「UI で作らせない」の二重防衛**。合算は不採用（インポート重複で生涯枠が黙って二重計上され、監査目的そのものが壊れる）。
7. **移行直後の差分リコンサイル表示**。手入力の生涯簿価残を参照値として保持し、履歴からの導出値との差を「履歴が未完成：差 ¥X」/「履歴と一致」で見せる。「数字が落ちた」を「埋めるべき残り」に変える＝手入力と履歴の突き合わせ自体が Stage2 の価値。

## §2 アーキテクチャ：履歴→スカラー畳み込みアダプタ

**Stage2 の本体は新規純関数 `nisaHistoryFold(history, currentYear)` 1本**。年別履歴を Stage1 とまったく同じ5スカラーへ畳み、既存の計算本体をそのまま通す。

```
tsumitateThisYear  = t[cy]
growthThisYear     = g[cy]
soldThisYearAtCost = soldT[cy] + soldG[cy]
tsumitateLifetime  = max(0, Σ(y≤cy) t[y] − Σ(y<cy) soldT[y])
growthLifetime     = max(0, Σ(y≤cy) g[y] − Σ(y<cy) soldG[y])
```

- **当年の売却を生涯枠から差し引かない**（復活は翌年1/1）＝Stage1 概算の精密化の本体。
- 売却を枠別に持つため `growthLifetime` が正しく戻り、`growthCapUsedPct`（1200万内数）が初めて正確になる。
- `max(0, …)` は売却>拠出（不正データ）の負値ガード。両言語同型。
- **`cy` は `nisaNow(nowMs)` 由来のみ**。`now.valid===false`（nowMs 域外）なら `cy=0` → 全和が空 → 全0へ degrade（既存 `monthsLeft=0` と同じ縮退方針）。

`nisaDerive` の変更は分岐1箇所：

```
var src = (n.source === "history") ? nisaHistoryFold(n.history, now.year) : n;
// 以降 atUsed/agUsed/lifeUsed 等は src.* を読む（現行は n.* を読む）
```

**下流は全て無改修**：各Pct・over判定・remaining・ETA・積立ペース・`nisaFacts`・`nisaRaw`・`modeAFacts` 配線・`coarsen_facts`・facts schema。spec §8 が意図した「純関数の入力源差替のみで UI/facts 契約不変」がそのまま成立する。

### 2.1 却下した代替案

- **B: `nisaDerive` 内に履歴専用の計算パスを書く** — 下流の Pct/over/ETA を二重に持つことになり、丸め不一致（Stage1 の review Critical と同型）を再発させる。fold なら計算本体は1本のまま。
- **C: 保存時に畳んだスカラーも state に持つ（非正規化）** — 履歴とスカラーの二重真実。LWW マージで片方だけ更新され黙って腐る。

## §3 データモデル

### 3.1 `state.nisa.history`（新規・前方互換既定）

```
nisa: {
  source: 'manual',          // 既存（enum 'manual'|'history'|'ledger'・NISA_SOURCES は既に history を含む）
  anchorYear: 0,             // 既存（history モードでは未使用・manual 用に保持）
  tsumitateThisYear: 0,      // 既存（history モードでは未使用・参照値として保持）
  growthThisYear: 0,         // 既存（同上）
  tsumitateLifetime: 0,      // 既存（同上・リコンサイルの参照値 §6）
  growthLifetime: 0,         // 既存（同上・同）
  soldThisYearAtCost: 0,     // 既存（history モードでは未使用）
  history: [                 // ★Stage2 追加
    { year: 0, tsumitate: 0, growth: 0, soldTsumitate: 0, soldGrowth: 0 },
  ],
}
```

- **`state.nisa.history` に置く**（トップレベル `state.history`＝バケツ推移の既存キーと名前衝突するため・money-rules.js:310-313）。
- **`CURRENT_VERSION` は据置**（birthYear/assetHoldings/nisa 自体と同じ前方互換既定追加。migrate 加算 coercion で処理＝全 fixture の rulesVersion churn 回避）。
- クラウドは Neon `me.mcc_state`（id=1 シングルトンJSONB）に丸ごと乗る＝**DDL不要**。

### 3.2 `normalizeNisa` の拡張（配列 normalize イディオム）

`normalizeNisa`（money-rules.js:72-83）**の内部に閉じる**。これにより `migrate`（:317）と `defaultState`（:266）は**無改修で追従**する＝Stage2 の最小変更点。

正規化パイプライン（両言語で同順・決定論）：

1. `Array.isArray(raw.history)` gate（非配列→`[]`）
2. `filter(e => e && typeof e === "object" && !Array.isArray(e))`
3. `.slice(0, NISA_HISTORY_MAX)`（**50**・reserves 流儀 money-rules.js:303-305 に倣う／Py は `[:50]` advice.py:448-450）
4. `.map(normalizeNisaYear)`（要素 normalizer・`(e, i)` 署名は normalizeReserve:217-226 に倣う）
5. **無効年を落とす**（`filter(e => e.year > 0)`）＝年は自然キーゆえ年の無い行は無意味
6. **年で後勝ちに畳む**（同年が複数あれば後の要素が勝つ）
7. **年昇順ソート**（畳み後は年が一意＝全順序ゆえ安定性問題なし）

`normalizeNisaYear(e, i)`：

- `year`：**`normalizeBirthYear` 型の範囲 gate**（`num()` → `Math.floor` → `[NISA_MIN_YEAR, 9999]` 以外は 0）。`NISA_MIN_YEAR = 2024`（新NISA 開始年・module const・facts 非出力）。独自の `int()`/`Number()` は 2026-07-15 の num/_num scalar-coerce パリティ堅牢化を巻き戻すため**禁止**。
- `tsumitate` / `growth` / `soldTsumitate` / `soldGrowth`：共有 `num()`（非負・scalar-only・単一要素配列/NaN/hex/underscore/全角を両言語同一に reject）。
- 未知キーは allowlist 明示列挙により自然破棄。固定5キー骨格を常に返す。

### 3.3 版方針

- `FACTS_SCHEMA_VERSION`（money-rules.js:15）＝**5 据置**。`SCHEMA_VERSION`（advice.py:30）＝**5 据置**。fixture の `schemaVersion:5` literal は**無改修**。
- `RULES_VERSION` / `CURRENT_VERSION`（state migrate 版）も**据置**。
- **据置であることをテストで固定する**（§8）＝「facts 形状不変」は本 spec の中心的主張ゆえ、回帰で黙って崩れないよう assert する。

## §4 configured 判定の拡張（唯一の既存ロジック変更）

現行（money-rules.js:425-426 / advice.py:871-872）は**6数値スカラーの OR**。履歴だけを入れた state はこの判定で `configured:false` になり、`facts.nisa` / `facts.raw.nisa` が**キーごと消える**（`if (nf) facts.nisa = nf` 契約）。

**判定を `source` 別にする**（＝「今有効な入力源にデータがあるか」を見る）：

```
configured = (stored.source === 'history')
  ? stored.history.length > 0
  : (既存6スカラーの OR)
```

- 既存 fixture は `source` 既定が `'manual'` → 判定不変 → **両モード全 fixture グリーン維持**。
- 両言語同時変更（byte-parity）。
- `'ledger'`（Stage3・未実装）は当面 manual と同じ枝（`nisaEffective` も非 history は素通しゆえ整合）。
- **なぜ source 別か**（2026-07-17 レビューで確定・当初案 `(6スカラーOR) || history.length>0` からの変更）：source 非依存にすると「履歴モードで記録 → 手入力モードへ戻す」状態（手入力スカラー全0・履歴は残存＝§5 で消さないため）で `configured:true` になり、**`facts.nisa` が「NISA枠を全く使っていない」と AI コーチに報告する**。実際には履歴に記録がある。Stage2 の目的（数字が黙って嘘をつかない）に反するため source 別が正しい。

## §5 切替と移行（`MCC.setNisaSource`）

新規 UI アクション。`setField` は数値 path 専用（money.js:392-400）ゆえ enum 用の別関数を立てる。

```
setNisaSource(src):
  src が NISA_SOURCES に無ければ無視（fail-closed）
  src === 'history' かつ state.nisa.history.length === 0 のとき、1回だけ:
      当年行 { year: currentYear,
               tsumitate: nisa.tsumitateThisYear,
               growth:    nisa.growthThisYear,
               soldTsumitate: nisa.soldThisYearAtCost,   // 枠別内訳が不明な合算値
               soldGrowth: 0 }
      を history へ push（currentYear は nisaNow(Date.now()).year・valid のときのみ）
  state.nisa.source = src; save(); render();
```

- **生涯2値（`tsumitateLifetime`/`growthLifetime`）は転記しない**。これらは残高であって当年拠出ではなく、当年行に入れると当年つみたて枠120万を超えて over 警告が誤発火する。
- **手入力スカラーは消さない**。`source` を `manual` に戻せば元通り＝**可逆**。かつ §6 リコンサイルの参照値になる。
- 移行時の売却は枠別内訳が不明ゆえ `soldTsumitate` に寄せる（保守的＝成長枠内数の復活を過大に戻さない）。UI は移行直後に内訳の確認を促す注記を出す。
- `now.valid === false` のときは移行をスキップ（年が決まらないため）。

## §6 リコンサイル（`nisaViewModel` 専用・facts 非出力）

`nisaViewModel`（money-rules.js:498-517）に leaf を追加。**VM 専用＝パリティ不要・facts 非出力**（既存の VM 規律どおり）。

```
reconcile: {
  available: source==='history' && (manualLifetime > 0),
  manualLifetime: nisa.tsumitateLifetime + nisa.growthLifetime,   // 参照値（手入力）
  derivedLifetime: fold.tsumitateLifetime + fold.growthLifetime,  // 履歴からの導出
  diff: manualLifetime − derivedLifetime,                          // 正=履歴が未完成
  matched: diff === 0,
}
```

- `available:false`（手入力の生涯簿価残が一度も入っていない）なら UI は何も出さない＝参照値が無いのに差を語らない。
- UI 文言：`matched` → 「履歴と一致」／`diff > 0` → 「履歴が未完成：差 ¥X（過去年を埋めると 0 になります）」／`diff < 0` → 「履歴が手入力を上回っています：差 ¥X」。**中立教育フレーム**（買え/売れの推奨語を層1に出さない・`cross-section-rules._band` と同じ閉集合規律）。
- ¥表示は `sync.loggedIn` ゲートの内側のみ（§7）。

## §7 UI（#money-view nisaSection・theme D）

### 7.1 入力源トグル

**本プロジェクト初の入力源切替 UI**（既存 `assetSource`/`cashSource`/`investmentSource` は state だけの休眠軸で UI 未実装・money-rules.js:265, 316）。ここでの形が後続（Stage3 ledger・B#2/B#4）の先例になる。

- 入力アコーディオン（`#mcc-nisa-input`）の先頭に「手入力 / 年別履歴」の2択。
- 選択で `MCC.setNisaSource(...)`。inline handler 方式（既存踏襲）。
- **形は `acSetScope(which)`（money.js:817-820）に倣う**（enum を受けて fail-closed に丸め→`render()`）。ただし `acSetScope` は UI ローカル変数 `_acScope` を更新するのに対し、`setNisaSource` は **state を更新して `save()` する**（クラウド同期に乗る軸のため）。

### 7.2 年別テーブル（`source==='history'` のとき）

- 列＝年 / つみたて拠出 / 成長拠出 / 売却(つみたて) / 売却(成長)。
- **年は `<select>`**（`NISA_MIN_YEAR`〜現在年）。**既存年は option から除く＝重複行を UI で作らせない**（§1-6 二重防衛の UI 側）。option の元になる `availableYears`（＝`NISA_MIN_YEAR`〜`now.year` から既存行の年を除いた昇順配列）は **`nisaViewModel` の leaf として出す**（絞り込みロジックを money.js に書かない＝§7.3 の業務math禁則）。`now.valid===false` なら `availableYears` は空＝行追加不可（degrade）。
- 行追加 `MCC.addNisaYear()` / 行削除 `MCC.removeNisaYear(year)` / セル更新 `MCC.setNisaYearField(year, field, value)`。**年をキーにする**（index キーはソート後にずれる）。
- **形は reserves の行編集に倣う**＝`setReserveField(id, field, value)`（money.js:345-352・`_findReserve` で対象を引き当て→field 別に coerce→`save(); render()`）／`addReserve()`（:319-329・入力欄から読んで `R.normalizeReserve` を通してから push）／`removeReserve(id)`（:331-335・`filter` で除去）。NISA も**必ず `R.normalizeNisaYear` を通してから push**する（UI で生の値を state に入れない）。
- 新関数は **`MCC` の公開 return（money.js:1398-1406）と `money-rules.js` の exports（:1209-1215）の両方**に追加しないと無言故障。
- id/年を handler に埋める箇所は `esc()` を通す（money.js:641-647 が先例）。既存 compare-search の inline onclick XSS（detail.js:47/81・未修正）と**同じ轍を踏まない**。
- レスポンシブは既存 600px ブレークポイント（money.css:536/551）に揃える。狭幅ではテーブルを行カード化。

### 7.3 ¥ゲートと業務math禁則

- **生¥は `sync.loggedIn` ゲートの内側でしか HTML に入れない**（money.js:1066-1070 `_nisaStat` 等が先例）。**年別テーブルは行ごとに¥が並ぶ最も漏れやすい面**ゆえ、行セル用のゲート済ヘルパを用意し `R.yen` を直に書かせない。
  - ただし **input の value はゲートしない**（Stage1 と同じく readout gate であって input gate ではない＝未ログインでも入力はできる）。ゲート対象は readout（合計・差分・リコンサイル）。
- **money.js に業務math を書かない**（money.js:1057-1058 に明文化・過去に丸め不一致が review Critical として摘出＝money.js:1099-1103）。年別の集計・%・over 判定・リコンサイル差は**全て `nisaViewModel` の leaf**として生やし、money.js は転記に徹する。

### 7.4 CSS

二層構成を崩さない（money.css:492-493）：baseline は構造/寸法＋`var()` 色のみ、glow/blend/mono は `[data-theme="D"] #money-view` 配下（money.css:965-1001 の隣）。

## §8 render() 汎用パッチ（Stage2 に含める）

**問題**（コード読解で確定・Stage1 の未発見欠陥）：入力は `onchange` で `MCC.setField` → `render()` が `root.innerHTML` を丸ごと差し替える（money.js:1354, 392-400）。`<details>` に open 状態の保持機構は無い（money.js:1182/957/1339）。**1項目確定するたびにアコーディオンが閉じ、フォーカスが飛ぶ**。6フィールドなら「気づきにくい不便」だが、N年×5項目のテーブルでは実用不能。

**方針**：全再描画方式は維持（as-you-type ではなく onchange＝確定時のみゆえ、mistakes.md「as-you-type は入力要素を作り直さない」には抵触しない）。`render()` に汎用の状態復元を足す。

### 8.1 ブラウザ挙動の実測（2026-07-17・Chromium/Playwright・推測ではない）

当初案は「`render()` の中で `document.activeElement` を読んで復元」だったが、**実測でこれは Tab 動線では機能しないことが判明**した（Task8 レビューが実機で発見 → controller が最小再現で確定）。

`<input>` を編集して **Tab** で抜けたときの発火順と状態：

| # | イベント | `document.activeElement` | `relatedTarget` |
|---|---|---|---|
| 1 | `change` | **BODY** | **なし**（change は relatedTarget を持たない） |
| 2 | `blur` | BODY | 次の要素 |
| 3 | `focusout` | BODY | 次の要素 |

→ **`change` の時点では移動先が一切分からない**（activeElement は BODY、relatedTarget も無い）。当初案の「activeElement を読む」は常に BODY を読むため復元が不発になり、さらに次の Tab でページ先頭（ログイン欄）へ飛ぶ。

**Enter** で確定したとき（フォーカスが動かない）：

| # | イベント | `document.activeElement` |
|---|---|---|
| 1 | `change` | **その入力欄のまま** |
| — | `focusout` | **発火しない** |

→ Enter 経路には focusout が来ないので、**フォールバックが必須**。

`focusout` の中で**同期的に** innerHTML を差し替えて新ノードへ `focus()` しても、ブラウザはフォーカスを奪い返さない（実測：最終 activeElement は新しい次セル）。遅延させても同結果ゆえ、**同期でよい**。

### 8.2 採用する設計（focusout ベース・ユーザー確定 2026-07-17）

**描画の起点を `change` から `focusout` へ移す**（`change` は値の確定と保存だけを行う）。

```
setField / setNisaYearField 等（onchange から呼ばれる）:
    値を代入 → save() → _renderDirty = true
    if (activeElement が data-mcc-focus を持つ)   // ＝Enter 確定（focusout が来ない）
        renderRestoring(その data-mcc-focus)
    // それ以外（Tab/クリック＝activeElement は BODY）は描画せず focusout に委ねる

root の focusout（init で1回だけ登録・render で root 自体は差し替わらない）:
    if (!_renderDirty) return
    renderRestoring(e.relatedTarget の data-mcc-focus ?? null)

renderRestoring(key): _renderDirty = false; _pendingFocusKey = key; render()

render():
  before: open な <details id> の id 集合を記録
  innerHTML 差替
  after:  記録した id の <details> を open に戻す
          _pendingFocusKey があれば一致要素へ focus + caret 復元 → null に戻す
```

- `render()` の**他の呼び出し元**（`addGoal`/`removeReserve` 等）は `_pendingFocusKey` が null なのでフォーカス復元は起きない＝既存挙動のまま。
- **既知の限界（新規の回帰ではない）**：「セルを編集してから確定せずにボタンを直接クリック」した場合、blur 系の途中で DOM が差し替わるためクリックが不発になり得る。これは `change` 同期描画だった**現行 Stage1 でも同じ**で、本パッチは timing を変えないため回帰ではない（Task10 smoke で確認する）。

- 対象は id を持つ `<details>`（`#mcc-nisa-input` / `#mcc-ac-input` / `#mcc-sec-settings`）。id の無い `<details>`（reserves 編集 :639・ガイド :1231）は現状維持＝**回帰を増やさない**。
  - **既知の限界（意図的）**：reserves の編集ボックス（:639）は id が無いため `setReserveField` 後に閉じる挙動が残る。これは Stage2 のスコープ外＝同じ症状だが別機能の回帰リスクを取らない。id を与えれば同じパッチで治るので、将来の単独課題として残す。
- 入力要素に `data-mcc-focus="<path>"` を付与して同定（テーブルは `nisa.history.<year>.<field>`）。
- `jumpTo`（money.js:1216-1217）の「開いてから見せる」既存挙動と競合しないこと（open を強制する方向のみで、閉じる方向には作用しない）。

## §9 パリティ計画（money-rules.js ↔ advice.py）

| JS | Py | 変更 |
|---|---|---|
| `normalizeNisa` :72-83 | `_normalize_nisa` :839-851 | history 正規化を追加（§3.2・同順・同 N=50） |
| （新）`normalizeNisaYear` | （新）`_normalize_nisa_year` | 要素 normalizer |
| （新）`nisaHistoryFold` | （新）`_nisa_history_fold` | §2 の畳み込み |
| `nisaDerive` :423-456 | `_nisa_derive` :868-902 | 分岐1箇所＋configured 拡張＋stale=false |
| `nisaFacts` :460-478 | `_nisa_facts` :904- | **無改修** |
| `nisaRaw` :481-495 | `_nisa_raw` :926- | **無改修** |
| `nisaViewModel` :498-517 | — | reconcile leaf 追加（VM は JS 専用・パリティ非対象） |
| `NISA_MIN_YEAR` / `NISA_HISTORY_MAX` | 同値 const :36-41 の隣 | 新規定数（facts 非出力） |
| exports :1209-1215 | — | 新純関数を公開 |

- 数値 coerce は必ず共有 `num()`/`_num()`（money-rules.js:46-52 / advice.py:262-264）。
- 現在時刻由来の年は必ず `nisaNow`/`_nisa_now`（[1,9999] ガードと Invalid Date↔例外の対称化済み。`datetime` を新規に触ると OverflowError 捕捉漏れで 500）。
- **履歴を facts の側チャネル引数として渡さない**。構造テストは `state` と `nowMs` しか渡していない（tests/test_advice_facts.py:92 / tests/money-rules.test.js:237）ため、側チャネルは生¥ゼロ検査の対象外になる。必ず **state 経由**（現 nisa と同じ配線）。

## §10 テスト/検証

### 10.1 検証3点セット（締め）

- `node --test 'tests/*.test.js'` 全緑（**末尾スラッシュ不可**＝`node --test tests/` はこの環境で `Cannot find module tests`）
- `PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q` 全緑
- parity fuzz（`genNisa` に history 生成器追加）で **mismatches:0**

### 10.2 fixture 追加ケース（RED-first）

実装前に追記し `nisa mismatch` で RED 確認→鏡像実装→GREEN：

- `nisa-j` history のみ（スカラー全0・source='history'）→ **configured:true**（§4 の要）・facts.nisa が出る
- `nisa-k` **当年売却は生涯枠から控除されない**（当年 sold>0・lifetimeUsedPct が控除前）＝§2 の核
- `nisa-l` **過去年売却が復活している**（前年 sold>0・lifetimeUsedPct が控除後）＋成長枠別復活で `growthCapUsedPct` が正しい
- `nisa-m` 重複年（同年2行）→ **後勝ちで畳まれる**（合算されない）
- `nisa-n` 無効年（0 / 2023 / 10000 / 全角）→ **行ごと落ちる**（§3.2 step 4 で `year=0` 化 → step 5 で除去）。※`"2024"`（ASCII decimal 文字列）は `num()` が通すため**有効年として残る**（既存 num/_num の契約・両言語同一）
- `nisa-o` source='history' で `staleAnchorYear:false`（anchorYear=2024・現在2026 でも false）
- `nisa-p` adversarial：history が非配列 / 要素が配列・null / 51件超（slice(0,50)）/ 金額に NaN・hex・全角
- `nisa-q` `now.valid=false`（nowMs 域外）で全0 degrade
- 各ケース personal は `facts.raw.nisa` の生¥を deepEqual 固定

### 10.3 構造テスト（facts 形状不変の証明＝本 spec の中心的主張）

- `FACTS_SCHEMA_VERSION === 5` / `SCHEMA_VERSION == 5` の**据置 assert**（bump を要求しないことを固定）
- production facts の全 number leaf が整数 [-100,150]（tests/money-rules.test.js:245-247 / tests/test_advice_facts.py:99-101）が **history 入り state でも通る**
- production facts の**キー集合が manual モードと history モードで同一**であること（形状不変の直接証明）
- `coarsen_facts`（advice.py:1191-1235）が**無改修で**生解像度を残さないこと（history 入り state で pre-coarsen 同値→coarsen 後に生の `*UsedPct` ゼロ件）
- `history` というキー名が production facts に**出ていない**こと（DENY/DENYLIST_KEYS 既収載・tests/test_advice_facts.py:50 / tests/money-rules.test.js:223）

### 10.4 fuzz

`genNisa` に history 生成器を追加：件数0〜60（slice 境界跨ぎ）、年（有効/0/2023/10000/文字列/全角）、金額（正常/NaN/hex/underscore/全角/単一要素配列/負）、**重複年を意図的に生成**（後勝ちの両言語一致）、順序シャッフル（ソートの両言語一致）。

### 10.5 UI/実機

- Playwright smoke：source トグル→テーブル出現、**セル確定後も details が open のまま・フォーカスが次セルに残る**（§8 の直接検証）、行追加/削除、pageerror 0、¥ readout gate（未ログインで readout 非表示・input は可）、セクション挿入位置、jumpTo 非破壊。
- **本人実機サニティ**（theme D glow/glass・テーブルの狭幅カード化＝GPU/実機依存ゆえ headless 非authoritative）。
- 本番curl 検証は**本番ルート `/`**（`/index.html` は15Bスタブ）＋**通常URL と persona の両デプロイ**（`vercel git connect` 済でpush→両自動）。

### 10.6 whole-branch 敵対検証wf（ultracode）

観点＝①facts 形状不変の実証（manual/history でキー集合同一・schemaVersion 5 据置）②JS↔Py パリティ（正規化の順序・後勝ち・ソート・slice 境界）③復活タイミングの制度整合（当年非控除・翌年復活・枠別内数）④生¥非漏洩（行セル・リコンサイル差の gate）⑤cf-1 不変（既存40 fixture byte 同一）⑥render パッチの回帰（jumpTo・既存アコーディオン・as-you-type 非該当の確認）。

## §11 リスク

- **configured 拡張の波及**（§4）＝両モードの fixture が全件動く可能性。→ 既存 fixture は history 無し＝判定不変を**最初に**確認する（RED-first の前に既存グリーンを取る）。
- **後勝ち/ソートの両言語不一致**＝JS の `sort` と Py の `sorted` は畳み後に年が一意なら全順序ゆえ一致する。危険なのは**順序を破壊するソート**の混入であって、年キーの**安定**ソートを畳み込み前に前置しても挙動は変わらない（JS `Array.sort` も Py `sorted` も stable＝2026-07-17 の最終レビューが変異注入で equivalent mutant であることを実証。当初この節は「畳む前にソートすると後勝ちの意味が変わる」と書いていたが**事実として誤り**だった）。→ パイプライン順序（§3.2 の 1〜7）を両言語で厳守・fuzz で重複年＋シャッフルを踏む。
- **`slice(0,50)` の位置**＝filter の後・map の前（reserves 流儀）。位置がずれると両言語で残る行が変わる。→ fuzz で 51件超を踏む。
- **移行の非可逆化**＝手入力スカラーを消すと manual に戻せない。→ 消さない（§5）。
- **render パッチの副作用**＝id 無し `<details>` や jumpTo の挙動変化。→ 対象を id 持ちに限定・jumpTo は open を強制する方向のみゆえ非競合・smoke で固定。
- **年 select の option 生成が業務mathに見える**＝「既存年を除く」は VM 側（`nisaViewModel.availableYears`）で出す。money.js に絞り込みロジックを書かない。
- **既存 compare-search inline onclick XSS**（detail.js:47/81・未修正）→ NISA テーブルは `esc()` を通し同じ轍を踏まない。

## §11.1 マージ後の follow-up（2026-07-17 最終レビューで発見・非ブロッカー）

いずれも**現行コードは正しく**、実害は非到達または検証網の穴に留まる。次に NISA を触るときにまとめて是正する。

- **(F-1) `nisaHistoryFold` の出力が非有限になり得る**（`money-rules.js` / `_nisa_history_fold`）：fold は**和**なので `Math.max(0, tLife)` が `Infinity` を通す。Stage1 の raw leaf は全て単一 `num()` 出力＝常に有限で、**これは Stage2 が新設した唯一の非有限面**。production facts は `r()` が非有限を 0 に潰すので無傷（クラッシュ・漏洩なし）だが、`facts.raw.nisa`（personal）に `Infinity` が入ると `json.dumps` が RFC 非準拠 JSON を吐き LLM prompt に載る。到達には 1e308 円級の入力が要り現実には非到達＝Minor。ただし 2026-07-15/16 に確立した「非有限は両言語対称に degrade」規律の**唯一の例外**なので、fold 出力に有限 gate を入れるのが筋。
- **(F-2) 年 gate の floor 意味論が検証網の穴**：`math.floor` → `round` へ変異させると **pytest も branch fuzz（14 seed × 800＝11,200ケース）も検出 0**。原因は fuzz の年生成器（`scratchpad/b2-parity-fuzz.js`）が固定リストで**小数年を1つも含まない**こと。**現行コードは正しい**が、将来の退行を捕まえられない。年生成器に小数年（と bool）を足す。

## §12 Non-goals（Stage2）

- **年別履歴の production facts への出力**（§1-3 確定・schema 5 据置）。
- 投資台帳ledger 自動導出（Stage3・`nisa.source:'ledger'`）。
- 口座振り分けの本人助言 endpoint（Stage4・層2・要 Vercel 関数12上限 + 法務 precondition）。
- 開始残高行（履歴開始年より前の集約）＝新NISA は2024開始で現時点3行ゆえ不要。許すと年別監査という目的が穴あきになる。
- 旧NISA（一般/つみたて）＝新NISA 生涯枠に影響しない別枠。
- iDeCo（掛金上限が職業依存）。
- 為替/評価損益/配当課税シミュレーション（枠＝簿価トラッキングに限定）。
- money.js の全再描画方式そのものの置換（部分再描画への移行）＝§8 の汎用パッチで足りる。

---

## 決定ログ（ユーザー確定・ブレスト 2026-07-17）

1. 履歴1行＝5項目・売却を枠別に持つ（※確定）
2. 入力源は排他＋初回1回だけ移行（※確定）
3. 年別履歴を facts に出さない・facts 形状不変・schema 5 据置（※確定）
4. `staleAnchorYear` は履歴モードで常に false・意味を縮退（※確定）
5. 全再描画問題は render() 汎用パッチで治す・Stage2 に含める（※確定）
6. 年の重複は後勝ちで畳む＋UI で作らせない（※確定）
7. 移行直後の差分リコンサイル表示を入れる（※確定）
