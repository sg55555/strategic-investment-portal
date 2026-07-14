# B#2 資産クラス比率（Asset Class Ratio）設計仕様

- date: 2026-07-14
- project: investment-portal（お金の司令室 #money-view）
- backlog: 将来backlog B（投資枠配分推奨）の第2フェーズ。B#1（3バケツ フェーズ型ロードマップ）に続く粒度。
- 規制フレーム: 2層必須（[[strategy-personal-finance-advice-intent]]）
- 前提: brainstorming（design panel workflow + 太田さんとの確認）で全論点確定済。本 spec は decision-complete。
- **改訂履歴**:
  - (1) 2026-07-14 敵対レビュー workflow `b2-spec-adversarial-review`（61エージェント・confirmed 41件）を全件反映。**年齢の扱いは A案（建前撤回）を採用**（§3.5/§4/§7）。確定指摘の全文＝`docs/superpowers/audits/2026-07-14-b2-spec-adversarial-review-findings.md`。原本＝`scratchpad/b2-spec-pre-review-backup.md`。
  - (2) 2026-07-14 再検証 workflow `b2-spec-reverify`（45エージェント・完全性検証＋新規ハント＋反証）を反映。gap 2＋確定新規 7 を修正＝**P1 §3.1 currentYear の JS/Py degrade 対称化＋NaN ゲート／P2 §3.3 現状側 総資産集約ウェイト（assetHoldings 実額）を非対称に確定／#3(critical) §2.2 scalar-only coerce で fixture(i) を satisfiable 化／#4-7 §5-3 目標ドーナツから未分類グレー除去（未分類=現在地バー限定）／P3 §3.3 集約 Σ=100 端数吸収／#6 birthYear 未設定 facts を「assetClasses キー省略」に一意化**。判定＝「微修正で足りる・再設計不要・A案と 39/41 fix は健全」。

---

## 0. 目的と戦略文脈

投資するお金を **資産クラス**（株/債券/その他）でどう割るかを、**年齢に合わせた「設計図」（目標）** と **今の「現在地」（現状）のズレ** で見える化する。B#1 が「投資余力を buffer/core/satellite にどう振るか」を扱い、B#2 はその次の粒度＝バケツの中身を資産クラスで割る。

芯は「勝ち銘柄当て」でなく **規律を守らせる・教育する**。年齢で動的に動くグライドパス（太田さんが魅力を感じた点）を主役にしつつ、公開物では個別銘柄・生額・パーソナライズ助言を出さず（層1）、具体的な銘柄/配分推奨は本人専用 server-gate（層2）に押し出す。

---

## 1. 確定事項（太田さんとの確認で確定・変更不可）

| 論点 | 確定 |
|---|---|
| 対象レベル | **3バケツ×資産クラス**（buffer/core/satellite それぞれに比率）を総資産で俯瞰 |
| 資産クラス | **7分類**（現金/国内株/先進国株/新興国株/債券/REIT/金）＝地域込み |
| 主目的 | **目標比率＋現状ドリフト** 両方 |
| 目標決定法 | **年齢グライドパス** `R = clamp(110−age, 30, 90)`（動的・主に core） |
| 現状データ源 | **段階分離**＝B#2 は各バケツ×クラスの簡易手入力／保有明細 ticker 自動集計は将来 B#4 |
| 動的な帯 | now/+10/+20年 の将来投影を**公開clientに display-only**（¥なし・facts非出力） |
| core現金 | **0%**（現金は buffer に集約） |
| **年齢の扱い（A案）** | age は**公開client で本人が入力し UI に表示される公開教育値**。グライドパスは age の公開教育関数。よって facts の riskAssetPct/targetPct をトップレベルに出す（両モード同一）＝age 逆算可を許容。**ageBucket・「年齢最小化」条項は不採用**（§3.5/§4/§7）。規制の芯＝「production で個別銘柄・生¥・パーソナライズ助言を出さない」は SYS_PRODUCTION＋出力スキャナ＋raw除去で担保（age非依存）。 |
| 2層 | 層1=公開・決定論・教育・no-score・免責／層2=personal gated 具体化・是非 |
| 版方針 | **CURRENT_VERSION/RULES_VERSION 据え置き（2）**＋**FACTS_SCHEMA_VERSION 3→4** |

---

## 2. データモデル

### 2.1 資産クラス（7クラス・単一トークン）
`cash / jpEq / devEq / emEq / bond / reit / gold`（キー・不変の allowlist・**この順序をタイブレーク基準に使う**＝§3.2）。日本語名＝現金/国内株/先進国株/新興国株/債券/REIT/金。

### 2.2 新 state（すべて加算的・トップレベル・CURRENT_VERSION は据え置き）
既存 `defaultState()`（money-rules.js:85）に加算：

- **`birthYear`**: 数値スカラ（既定 0=未設定）。`age = currentYear − birthYear`（§3.1 で currentYear の UTC 導出を規定）。**月日を持たない**＝誕生日跨ぎの nowMs 境界パリティ問題を回避。
  - **受理レンジガード（MINOR-16/17）**: `1900 ≤ birthYear ≤ currentYear` の**範囲外は 0（未設定）へ写す**（負値だけでなく 2桁typo・未来年も未設定扱い）。`normalizeGoal/Reserve` と同型の純関数として **defaultState と migrate の両所**へ coerce として追加。§5 の number 入力 min/max は widget のみを守り、setField/クラウドPUT/migrate の state 経路は守れないため state 側 coerce が本丸。
- **`assetHoldings`**: `{ buffer:{7キー}, core:{7キー}, satellite:{7キー} }`・各 num 既定0。
  - **`normalizeAssetHoldings` は入力に関わらず常に完全骨格を返す（MINOR-10/15）**＝`{buffer:{7クラス=0},core:{7クラス=0},satellite:{7クラス=0}}`。欠落サブバケツ/欠落クラスは0充填・未知キー破棄。`raw.assetHoldings` が非オブジェクト（配列/文字列/null）なら空骨格を返す（イディオム＝`var ah = (raw.assetHoldings && typeof raw.assetHoldings==='object' && !Array.isArray(raw.assetHoldings)) ? raw.assetHoldings : {}`）。テンプレは `normalizeReserve`（flat）でなく **`normalizeAnchor`（固定形状オブジェクト正規化）を先例に**する。
    - **各クラス値の coerce は num/_num を使わない（critical・再検証#3）**: 汎用 `num([5])=5` vs `_num([5])=0.0` は単一要素配列で発散し、その差が currentPct 分母に載って §7 の byte 一致要求を破る。よって **両言語 byte 一致の scalar-only coerce** を新設して各クラス値に使う＝「**有限の数値 or 数値文字列のみ受理・配列/オブジェクト/NaN/null/負値は 0**」（JS: `typeof v==='number' ? (isFinite(v)&&v>=0?v:0) : (typeof v==='string'&&isFinite(+v)&&+v>=0?+v:0)`／Py: `v if (isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) and v>=0) else (float(v) if <str かつ float() 成功&&>=0> else 0)`）。これで §7 ケース(i) の単一要素配列 byte 一致が原理的に満たせる（num/_num の非対称を分母から排除）。
  - buffer は形状上7キーを持つが UI は cash のみ書込＝非cashは常時0で許容（拒否不要）。
- **`assetSource`**: `'manual' | 'ledger'`（既定 manual・enum coerce）。B#4 接続点＝既存 `cashSource`/`investmentSource` 二軸（money-rules.js defaultState）と同型イディオム。

**制約**:
- `buckets.{}.amount` は温存（別レイヤ加算＝後方互換。bufferProgress/investable/totalAssets/advice.py 全経路が amount 依存）。
- `birthYear`/`normalizeAssetHoldings`/`assetSource` は **defaultState と migrate（money-rules.js:115）の両方に必ず追加**（片方漏れ＝ロード時無言消失＝reserves/goals 同型の既知落とし穴）。
- **advice.py 側 `_migrate`（:223）にも同型の正規化ミラーを追加（MINOR-7・§7 パリティで再掲）**＝birthYear レンジガード・normalizeAssetHoldings（7キー allowlist・num/_num coerce・未知キー破棄・完全骨格）を JS と同型で実装。currentPct 分母の両言語一致に必須。JS 片側だけ書く非対称を作らない。
- `setField` dot-path（money.js:389/非生成降下:393）が `assetHoldings.core.jpEq` を通るには `assetHoldings.core` の中間ノードが常在する必要＝**normalizeAssetHoldings の完全骨格常在で保証**（setField 側の存在ガードは骨格常在ゆえ不要）。
- **CURRENT_VERSION=2 据え置き**（reserves 先例＝state追加で bump せず migrate 加算 coercion で処理。bump は全 fixture の rulesVersion churn を招くため回避）。
- **クラウド同期**: Neon `me.mcc_state` は JSONB 丸ごと保持＝DDL変更不要・新キー自動搭載。
- 目標比率は **state に持たず年齢から純導出**（B#1 導出方針の継承＝migrate/同期の面を増やさない）。

---

## 3. 層1ロジック（公開client・money-rules.js純関数・決定論・no-score・免責fail-closed）

すべて純関数・`num/clamp/r`（money-rules.js:32-34）経由で advice.py 鏡像とパリティ。

### 3.1 年齢グライドパス（core バケツに効く）
```
// currentYear は必ず nowMs から UTC 導出。reserveMonthly と同型に非有限/例外を degrade（再検証P1・#2）
JS:  const nd = new Date(num(opts.nowMs));
     if (!isFinite(nd.getTime())) return { configured: false };   // 巨大/不正 nowMs → 未設定
     const currentYear = nd.getUTCFullYear();
Py:  try:    dt = datetime.fromtimestamp(_num(now_ms) / 1000, tz=utc)
     except (OverflowError, OSError, ValueError): return { 'configured': False }
     currentYear = dt.year
age  = currentYear − birthYear                             // 両者整数ゆえ Math.floor 不要（no-op削除）
R    = clamp(110 − age, 30, 90)                            // リスク資産%（株3クラス＋REIT＋金）
D    = 100 − R                                              // 債券%
```
- **currentYear の導出元＋両言語 degrade を固定（MINOR-11/22・再検証P1/#2）**: `currentYear` は必ず `modeAFacts(opts.nowMs)`／`mode_a_facts(now_ms)` から **UTC** で導出。壁時計 `new Date().getFullYear()`／`Date.today()` 直呼びは**禁止**（fixture 決定性）。**JS num()／Py _num() の非対称を排し、巨大/不正/負 nowMs は両言語とも `{configured:false}` へ degrade**（JS は `isFinite(nd.getTime())`・Py は `_num`＋`try/except(OverflowError,OSError,ValueError)`＝reserveMonthly:76-77／_reserve_monthly:211-214 の確立イディオムを写す）。片側だけ NaN facts 流出／片側だけ 500 の乖離を作らない。
- **未設定ゲートを純関数契約として形式化（MINOR-12・再検証#2）**: glidePath は**先頭で** `birthYear<=0 || !isFinite(age) || age<0 || age>120` なら `{configured:false}` を返し（clamp 前短絡・**NaN age を必ず捕捉**＝比較は全て false で素通りするため `!isFinite(age)` を明記）、以降のクラス分解/ドーナツ/facts をすべて未設定扱いにする。UI §5 の「あなた(◯歳)の設計図」読み出しも `configured:false` で非表示。**birthYear 既定0（未設定）が「株30%＝最も守り」の偽目標へ崩落するのを防ぐ絶対ガード**（important B）。
- 係数110＝「100−年齢」の長期運用+10版。傾き −1/年 が「毎年ちょっと守りへ」の物語を式に宿す。
- 上限90「若くても守りをゼロにしない」／下限30「高齢でもインフレ負けを防ぐ成長枠を残す」＝境界自体が教育。
- 例: 30歳→R80/D20、40歳→70/30、55歳→55/45、80歳→30/70。

### 3.2 地域内訳（core・年齢非依存の固定比で機械分解）
```
alt(実物枠) = R × 0.15    → reit = R × 0.09,  gold = R × 0.06   (reit:gold = 3:2)
株式合計    = R × 0.85    → devEq = 株式合計×0.60, jpEq = ×0.20, emEq = ×0.20  (先進:国内:新興 = 6:2:2)
bond        = D = 100 − R
cash        = 0           (core は完全投資・現金は buffer に集約)
```
- **丸めと端数吸収を一意確定（MINOR-5/21・important H）**: 各クラス `r()` half-up で整数化後、7クラス合計の端数（±数pt）を**吸収先＝r()後整数の argmax（cash除く6クラス）**へ載せ Σ=100 を機械保証。**同値タイは §2.1 allowlist 固定順（cash→jpEq→devEq→emEq→bond→reit→gold）で先勝ち**＝JS/Py 両言語で明記（「通常 devEq」の非決定的表現は撤回）。この吸収により **`bond=D=100−R` は近似（±1pt しうる）** と注記。
- 例 age40(R70,D30): dev36/jp12/em12/reit6/gold4/bond30/cash0（r() 後 Σ=100）。
- 教育フック（平易厚め）＝「世界の時価総額比の簡略版（オルカン的）＋ホームバイアスで国内2割＋金/REITはインフレ耐性の分散スパイス1.5割」。

### 3.3 3バケツの目標（決定則を分離）
- **buffer**: `cash=100%` 固定・年齢非依存（生活防衛＝値動きさせない絶対ルール・入力不要）。
- **core**: 3.1+3.2 を全面適用する唯一の動的バケツ（cash=0 の6クラスへ展開）。B#2 の心臓部。
- **satellite**: 株式集中・年齢非依存＝`devEq60/jpEq20/emEq20`（core株式の6:2:2＝「サテライトはコアの株式スリーブを100%にしたもの」と平易に説明可）、bond/reit/gold/cash=0。量の抑制は既存 `satelliteCapPct` が担うので質を固定。
- **総資産の俯瞰（目標側）**: 各バケツのクラス**目標**% × バケツ**目標額**ウェイト（buffer=bufferTarget、core=coreTarget、satellite=satelliteCap）で加重平均＝総資産の目標資産クラス比率。UI はバケツ別↔総資産をトグル切替。
  - **総資産の俯瞰（現状側）を非対称に規定（important・MIN-6/20 残渣＝再検証P2/#1）**: **currentPct の総資産集約は目標額ウェイトでなく各バケツの `assetHoldings` 実額をウェイト**にする＝`total currentPct[class] = Σ_bucket assetHoldings[bucket][class] / Σ_all assetHoldings`（分類済み全額を分母）。§7 の「バケツ目標額ウェイト」は **targetPct 専用**。**全 assetHoldings=0 の縮退時は currentPct=0・drift=−target（§3.4 と整合）を JS/Py 同一で規定**。これで partial-funding（一部バケツ空）でも Σ currentPct_total=100 が自然に成立し、per-bucket 0/0 を集約へ持ち込まない（目標側の目標額ウェイトを currentPct に字義適用すると空バケツ 0/0 で Σ≠100 になる罠を回避）。
  - **総資産集約の Σ=100 端数吸収（minor・MIN-5 残渣＝再検証P3）**: 総資産集約（目標側・現状側とも）にも §3.2 と同じ吸収規則＝r()後整数の argmax（同値タイは §2.1 allowlist 固定順）へ端数を載せ Σ=100 を機械保証（集約 facts が Σ=99/101 にならないよう両言語同一化）。
  - **「state非依存」表現の訂正（MINOR-9/18）**: クラス目標% は age 由来で state 非依存だが、**バケツ目標額ウェイト（bufferTarget/coreTarget/satelliteCap）は既存 state 由来**。ただし**新規 state フィールドは追加せず既存純関数の再利用のみ**＝migrate/同期面は増やさない。
  - **全ウェイト0（setup未完）のフォールバックを規定（important F・MINOR-9/18）**: 総重み0（全バケツ目標0）時は **`else 0`で空ドーナツにしない**（年齢設計図は資金非依存で定義可能＝主目的に反するため）。denom>0 のときのみ加重平均し、**denom=0 のときは意味のある唯一の動的バケツ core 単独分布へフォールバック**（or 総資産トグルを非出力＝`assetClasses.total` を facts に載せない）。JS `NaN` vs Py 例外の**パリティ乖離を回避**するため両言語で同一挙動を固定。§9 の共有 fixture に zero-weight ケース（monthlyExpense=0・holdings全0）を追加。

### 3.4 現状ドリフト（段階分離＝手入力）
- 現状は各バケツ×クラスの簡易手入力¥（`assetHoldings`）。ticker 自動集計は B#4 送り。
- 入力: buffer=cash1欄のみ／core・satellite=クラス別 moneyInput（`onchange`→`setField('assetHoldings.core.jpEq',v)`→save→render・`oninput` 逐次renderは禁止＝フォーカス喪失回避）。
- **¥ゲートの適用範囲（MINOR-29）**: ¥ゲート（§5-9）は**派生¥ readout（保有総額・現状¥の読み出し）にのみ適用**。手入力フィールド（assetHoldings の moneyInput）とクイックフィルは既存 buckets 保有額と同様、**未ログインでも常時表示**（localStorage完結・送信ゼロ維持）。
- 摩擦最小化: 「現状は現金のみ」クイックフィルで総額を `assetHoldings.buffer.cash` に一括投入（現金のみ・投資未開始の太田さんで盤面が空にならない）。
- 現状%算出: 各バケツで classes 合計を分母に百分率。**分類済み合計=0 のとき currentPct=0（0/0 ガードで NaN 回避）**。あるバケツの classes が全0だが `buckets.amount>0` の場合は既存 amount を「未分類」1本として**現在地バー限定の表示セグメント**に計上（後方互換）。**「未分類」は facts に出力しない（§3.5/§7 と相互参照・facts は7キー allowlist 厳守）**。
- **ドリフトの符号付き half-up 丸めを一意確定（important C・MINOR-19）**: `driftPct = 現状% − 目標%`（符号付き pt・+超過/−不足）。**`cfNum` は符号付き coerce のみで丸めない**ため、**符号付き half-up ヘルパを両言語に新設**＝money-rules.js `function rSigned(x){ x=cfNum(x); return x<0 ? -r(-x) : r(x); }`／advice.py 鏡像 `_r_signed`。**丸めパイプライン**を固定＝①各クラス%（目標・現状とも）を先に整数へ丸め（現状側も Σ=100 吸収）→②整数どうしの減算で drift も整数、③総資産集約は「加重平均を rSigned で整数化してから減算」（集約でも fractional を残さない）。**drift が常に整数**であること（＝coarsen の .5 境界を踏まない）を fixture で固定。
- **全0現状バケツの drift（MINOR-20）**: classes 全0（未分類のみ）バケツの drift は **`−target`（未配分の事実）を意図出力**とする（マスクせず「未配分」を可視化）。§9 に境界ケース（全0現状→drift=−target）を追加。
- 見せ方: (1)目標「設計図」バーと現状「現在地」バーを上下並置（同じクラス色でセグメント幅%・境界は線・縦整列でズレが一目）、(2)ドリフト・レール＝クラス毎に「目標◯%→現状◯%(±Npt)」を |drift| 降順に1行。層1ゆえ **ズレの事実の提示のみ・リバランス指示は出さない**。
  - **方向色は補助（MINOR-3/25）**: 超過/不足/一致の意味読取は**行の符号(±Npt)・目標→現状テキスト・|drift|降順**で担保し、direction色（amber/cyan/emerald）は補助的強調に留める（direction色は identity 7hue と hue が重なるため＝§6.3）。

### 3.5 教育・no-score・免責
- 数値スコア化しない（no-score）。グロッサリ単一源＋desc（モデルポートフォリオ用語=オルカン/GPIF/均等 の噛み砕きを平易厚めに）。
- **A案＝年齢は公開教育値（建前撤回）**: age は公開client で本人が入力し UI に「あなた(◯歳)の設計図」として表示される値で、グライドパスは age の**公開教育関数**として設計されている。よって **age は client から秘匿しない**＝riskAssetPct/targetPct をトップレベルに出す（age 逆算可を許容・§7）。**「年齢は生値を出さず age_bucket 化」条項は撤回・ageBucket フィールドは持たない**。
- production で出さないもの（規制の芯・age非依存）: **生額¥**（`_AMOUNT_RE` strip 対象を出さない）・**個別ETF/銘柄名**・パーソナライズ助言。%のみ出力。
- 免責は既存 `DISCLAIMER`（money-rules.js:17）を踏襲。加えて**「目標は絶対的正解でなく年齢別の一般的目安」を §3.4/§6.3 の方向色注記に併記**（MINOR-3・valence 抑制）。

---

## 4. 層2（api/me/advice.py・ADVICE_MODE=personal・server-gate・dormant）

- 層1が出した **目標%/現状%/ドリフト** を facts 入力として受け、具体ETF/銘柄への落とし込み・モデルポートフォリオ的具体化・「◯◯クラスへ移す」等の具体リバランス手順・是非。
- **A案での raw 境界**: **生額¥は `facts.raw`（`include_raw=personal`・advice.py:630 `mode_a_facts`）限定**。riskAssetPct/targetPct/currentPct/driftPct（集約%・符号付きdrift）は**両モード完全一致でトップレベル**（age は公開値ゆえ raw 隔離しない）。currentPct/driftPct の監査ログ粗化は §7 coarsen で担保。
- **SYS_PRODUCTION（advice.py:63）に「資産クラス配分の変更・リバランスを指示しない・ドリフトの意味説明のみ」条項を追記**（`_TRADE_RE` は「配分変更」語を捕捉しないため明記必須＝二次ベルト非依存で一次プロンプトに置く）。
- **配分変更ベルト非対称の sufficiency 根拠を明記（MINOR-1）**: リバランス/配分変更語は `_TRADE_RE/_SECURITY_RE/_FORECAST_RE/_AMOUNT_RE` に非マッチで scan_output を素通りするが、これで十分な理由を1段落で残す＝(1)一次保証は **facts allowlist**（production facts に生¥/ティッカー無し・集約%のみ）、(2)資産クラス級は 4本柱の**公開安全ゾーン**（.claude/CLAUDE.md）、(3)危険な**具体ETF/銘柄は _SECURITY_RE＋market hit で別途 belted**、(4)⑤⑥⑦同様に**プロンプトのみ禁則は既存常態**（advice.py:91 はベルトを禁則①〜③と 1:1 と明示・配分変更は既存の SYS 条項②で本番済＝B#2 固有バグではない）。**任意の上積み**＝`_REBALANCE_RE`（増やし/減らし/比率を(上げ|下げ)/寄せ/移し/組み替え/リバランス/配分(変更|見直|調整)＋資産クラス語文脈）を scan_output に追加し命中で deterministic-only へ degrade すれば既存②欠落ごと塞げる（必須ではない）。
- 新 Vercel 関数は増やさない（Hobby 枠維持）＝advice.py 拡張で収める。

---

## 5. UI（#money-view・theme D ネオン・面禁則＝線/グロー/縁）

`render()` 連結列で `roadmapSection` の直後に `assetClassSection(vm)` を innerHTML 挿入（index.html 無改造）。`id=mcc-sec-assets` を `_JUMP_TARGETS` 登録。全 `.mcc-ac-*` は baseline + `[data-theme="D"] #money-view` の二層定義。

構成:
1. section-title「資産クラス比率」+ termHelp('資産クラス') + desc「年齢に合わせた"設計図"と、今の"現在地"のズレを見える化」。
2. 年齢入力1行（生年 number・onchange・min/max=widget補助のみ）+ 読み出し「あなた(◯歳)の設計図：成長資産◯% / 守り◯%」＝この1行が物語（編集で即更新＝動的さ）。**`configured:false`（未設定/域外）時は読み出しを非表示にし「生年を入力」を促す（§3.1 ガード）**。
3. **目標ドーナツ**（§6.3 の conic 方式・7クラスをアーク色分け）、中央に「守り◯%/攻め◯%」。**目標は常に Σ=100 の完全7クラス分類ゆえ未分類は載らない**（未分類グレーは §5-5 の現在地バー限定＝§3.4/§6.1・再検証#4/#5/#7）。
4. **【二次・display-only】** now/+10/+20年の設計図が動く帯（¥なし・facts非出力・純粋年齢関数）。
5. 目標vs現状の積み上げバー2本。
6. ドリフト・レール群（|drift|降順・方向で意味色）。
7. 現状入力アコーディオン（buffer=cash/core・satellite クラス欄）＋「現状は現金のみ」クイックフィル。**手入力欄は未ログインでも常時表示（§3.4 ¥ゲート範囲）**。
8. バケツ別↔総資産トグル。
9. **¥ readout は `sync.loggedIn`（money.js:11）時のみ・%は常時表示・手入力欄も常時表示**（roadmap 準拠のゲート＝readout gate であって input gate ではない・§3.4/MINOR-29）。

---

## 6. デザイン確定値（2026-07-14 max分析・実測駆動で確定＝B案）

> 根本原因の計測: 「暗い・じとっと・同色化」の共通原因は **alpha 0.2 + `mix-blend-mode:screen` + 暗背景**。低alphaが screen で chroma差を圧縮し、隣接hueを潰し（債券/現金がレンダリング後 距離1）、色を暗くしていた。conic/円は per-pixel では棒と同等〜明るい（「円が暗い」は細いリング＋暗い穴の知覚）。
>
> **確定＝B案（MINOR-23）**: §6.1 の7hex＋§6.2 の alpha0.4+screen+saturate1.55/brightness1.5。モックのA案（solid/theme-Dトークン写像）は**比較用で不採用＝実装から除外**。モック既定は B（stB on）にして視覚リファレンスと確定案を一致させる。
> **✅太田さん実機確認済（2026-07-14）**: 強化mock（`scratchpad/b2-asset-class-mock.html`・per-class色ピッカー＋透明度/発光度スライダー＋未分類グレー）をローカル配信で確認し「絶妙なバランス」＝**alpha 0.40／glow 100%／7hueパレット（§6.1 変更なし）／第8色グレー #64748b で確定**。色は実装値としてロック。

### 6.1 パレット（7hue 色相環＋未分類・単一トークン・全要素参照）
| クラス | hex | 色 |
|---|---|---|
| devEq 先進国株 | `#b03cff` | 紫 |
| jpEq 国内株 | `#4468ff` | 青 |
| emEq 新興国株 | `#ff2a4d` | 赤 |
| reit REIT | `#f2e400` | 黄（緑寄り） |
| gold 金 | `#ff7a00` | 橙（赤寄り） |
| bond 債券 | `#1fdb5e` | 緑 |
| cash 現金 | `#12cffa` | シアン |
| **未分類 unclassified** | **`#64748b`** | **無彩寄りスレート（低chroma）** |

- **未分類色（important G）**: §3.4 の後方互換「未分類」現在地セグメント用に第8色を定義。**低chroma のスレート**＝7つの高chroma identity 色と明確に分離し「本物のクラスでない」ことを彩度で読ませる（saturate 1.55 でも無彩寄りを維持）。**現在地バー限定・facts非出力**。
- 実測（alpha 0.4・レンダリング後）: identity 7色 全ペア距離 ≥29（最小 reit/gold=29）／平均輝度73／債券vs現金=66／クロス要素一致 距離7。

### 6.2 レンダリング（チャート符号化要素で完全同一の適用）
- **適用範囲を限定（MINOR-26）**: 「全要素で完全同一」は**チャート符号化要素（構成バー seg／ドーナツ本体・edge・glow／下部帯 seg）**に限る。legend／ドリフトレールの `.mcc-ac-swatch` は**不透明 hex＋box-shadow glow の別レンダ経路**（識別色の純 hue を出す・§6.1「クロス要素一致 距離7」の実測集合の外）。
- **alpha 0.4**（透明⇄明るさ⇄判別性の実測バランス点。スライダーで調整可＝下げるほど判別性・明るさが落ちる関係を実測で確認）。
- `mix-blend-mode: screen`（加算＝暗背景で発光しつつ下地グリッドが透ける）。
- `filter: saturate(1.55) brightness(1.5)`（チャート符号化要素で統一＝色味・明るさを円/中央/下部で一致）。
- 下地に微グリッド（透け先）。
- **発光度スライダー**（縁 glow の強さ・box-shadow 多層＝内側/近縁/遠い余波）。既定 glow 100%。
- **面禁則の例外を明記（MINOR-27）**: theme D 面禁則（§5 見出し）に対し「低alpha(0.4)+screen+下地グリッド透過の発光塗りは許容」を例外として1文添える（§5 の絶対表現と §6.3 実装の緊張を解く）。

### 6.3 各要素
- **バー**（中央 設計図/現在地）: div セグメント・`rgba(token, alpha)` 均一（縦グラデなし＝濃さ統一）＋上端明色ネオン縁（`box-shadow inset 0 2px 0`）＋全周1px縁＋縁glow多層。
- **円グラフ**: **CSS `conic-gradient`（棒と同じ HTML要素方式）**。3層＝ぼかしglowハロー / 半透明body / 内外周の細いネオン縁（band mask）。
  - **mask 半径を明示（MINOR-24・§10 と整合）**: mask の `circle` は既定 farthest-corner でリング半径がずれる（200px要素で対角141px基準）。**`circle closest-side at 50% 50%`（半径=100px＝%が100px基準）または明示長 `circle 100px at 50% 50%` に固定**。`.edge` も同修正。「（body 51-82%）」は基準系（closest-side 半径=100px）を併記。mock（37-41行）も同修正して視覚リファレンスを正す。
- **下部帯**（将来の設計図・display-only）: 成長／守りの2値表現。
  - **色言語を3言語に整理（MINOR-27）**: 色言語＝**識別(identity 7色)・方向(direction 3色)・集約2値(成長/守り)**の3言語。下部帯は成長/守りの2値で**ドーナツ/バーの class-identity 7色とは別言語**と明記。成長色は identity hue と非衝突が望ましい（emEq/gold トークンの流用をやめニュートラル暖色グロー単一hue推奨）／守り=緑（bond 域）。now/+10/+20 の3本。
- **色言語の分離（identity vs direction）**: ドーナツ/構成バーは class-identity 色／ドリフトレールは direction 色（超過=amber/不足=cyan/一致=emerald）。
  - **direction×identity のクロス重複を明記（MINOR-25）**: direction 3色は identity 7hue のうち gold/reit(amber)・cash(cyan)・bond(emerald) と hue が重なる。**意味読取は §3.4 の符号/テキスト/降順で担保し direction色は補助**（分離は役割分離であって hue 分離ではない）。§6.1 の実測に identity×direction のクロス距離1項を追加するのが最小の穴埋め。

### 6.4 実装 = money.css 追加（新 `.mcc-ac-*`）＋ money.js 薄層。モック `scratchpad/b2-asset-class-mock.html`（A/B トグル・年齢/透明度/発光度スライダー・既定 B）が実装の視覚リファレンス。

---

## 7. パリティ計画（money-rules.js ↔ advice.py）

facts 出力を採用（層2 personal 具体化に目標/現状/ドリフトが必要）。

- **facts の型を一意確定（MINOR-28）**: `facts.assetClasses` ＝ `{ riskAssetPct, classes:[{key,targetPct,currentPct,driftPct}] }`。**`classes[]` は総資産集約の固定7クラス1本のみ**（**targetPct は §3.3 目標額ウェイト・currentPct は §3.3 の assetHoldings 実額ウェイトで加重平均**＝集約ウェイトが目標/現状で非対称な点に注意・再検証P2）。**buffer/core/satellite のバケツ別内訳は client 純導出の UI 専用（facts/fixture/advice.py パリティ非対象）**。`include_raw`（personal）時のみ `facts.raw` に生額¥（age は公開ゆえ raw 隔離不要）。
- **A案での age 出力**: `riskAssetPct`（=110−age・age逆算可）と `classes[].targetPct` を**両モードトップレベル**で出す。**ageBucket フィールドは持たない**（撤回）。**birthYear 未設定時は `facts.assetClasses` キー自体を省く**（＝出さない。「`configured:false` を載せる」案は不採用で一意化・再検証#6）＝§3.1 ガードと一致（JS `modeAFacts`↔Py `mode_a_facts` 両鏡像で assetClasses キー不在を一致）。
- **advice.py `mode_a_facts`（:630）に同方向・同時に鏡像追加**＋**`_migrate`（:223）に normalizeAssetHoldings/birthYear 鏡像追加**（§2.2 再掲・currentPct 分母の両言語一致）。
- **版**: `FACTS_SCHEMA_VERSION`（JS:15）3→4・`SCHEMA_VERSION`（Py:29）3→4 を両側同時 bump（facts schema変更ゆえ）。`RULES_VERSION`/`CURRENT_VERSION` は 2 据え置き。
  - **既存 fixture の一括 bump（MINOR-4）**: 新規ケース追加に加え、**既存全ケース（production+personal 両ブロック＝現状46箇所）の `schemaVersion` を 3→4 へ一括置換**。`rulesVersion(=2)` は据え置き。§9 のテスト実行が既存ケースの落ちを検出するゲートになる（相互参照）。
- **符号付き drift の丸め（important C・MINOR-19 再掲）**: `rSigned`/`_r_signed` を両言語に新設し half-up 方向・0近傍（=目標一致で±0）を厳密一致。「cfNum 経由で half-up」の旧文言は「cfNum で符号付き coerce → rSigned で half-up」に訂正。
- **coarsen（advice.py:828 `coarsen_facts`）は非再帰・allowlist（MINOR-2）**: トップレベル `raw` のみ剥がし列挙キーだけを `_bucket25` する再帰なし実装ゆえ、**新設 `facts.assetClasses` は自動では粗化されない＝明示走査を追加**。
  - **A案での粗化対象**: **portfolio を露わにする `currentPct` を `_bucket25`・`driftPct` を `sign×_bucket25(|d|)`** に粗化（監査ログ・facts_hash の指紋化防止）。**`riskAssetPct`/`targetPct` は age 由来の公開値ゆえ粗化不要**（A案）。`facts_hash`（:966）と `_log`（:1049）は既に coarsen 後を使うので **coarsen 拡張だけで hash も指紋安全（別途 hash 処理不要）**。
- **coarsen の JS↔Py 表記を一義化（MINOR-8）**: coarsen は現状 **Py 専用のログ整形層で JS 鏡像が無い**。§9 の「coarsen 一致」は「**pre-coarsen facts が JS↔Py 同値 → Py coarsen の決定性/正当性**」と読み替える（JS 側 bucket25 鏡像は新設しない＝driftPct 等は整数pt で half-up と half-to-even が分岐しないため既存 r/_r で十分）。
- `assetClasses.classes` は固定7クラス（キー allowlist・配列注入なし）＝件数 cap 自然。
- **共有 fixture** `tests/fixtures/advice_facts_cases.json`（現存・108KB）に production/personal 両期待を追加。**追加ケース一覧**（§9 と対）＝(a)年齢一致=drift0境界／(b)half-up境界(.5)・±0・負ドリフト／(c)classes未入力=現状0（全0現状→drift=−target）／(d)floor30/ceil90 境界（age側も）／(e)**birthYear 未設定＝`facts.assetClasses` キー省略（両モード両言語で assetClasses 不在一致）**／(f)**zero-weight（全ウェイト0）で総資産集約が NaN でなく未設定/core-fallback**／(g)**端数吸収タイブレーク**（age55→R55／age80→R30 の吸収先）／(h)**年境界 UTC**（同一 birthYear で 12/31 23:59Z と 1/1 00:00Z の nowMs で age 一致）／(i)**adversarial-coercion**（assetHoldings に未知キー/NaN/nested/負値/単一要素配列＝§2.2 scalar-only coerce で両言語 0 一致し分母に差が載らない）／(j)**coarsen 出力に生の非25刻み currentPct/driftPct がゼロ件**／(k)**巨大/負 nowMs → 両モード両言語 configured:false（NaN facts でも 500 でもない・再検証P1）**／(l)**partial-funding（一部バケツ空）で総資産 currentPct 集約が Σ=100・JS↔Py 一致（再検証P2）**／(m)**総資産集約 blend で cash と devEq がタイ＝allowlist 固定順で吸収先一致（再検証P3）**。トップレベル同値・差は raw のみ。scratchpad fuzz 比較更新、cf-1/cf-2/par-2 回帰維持。
- 検証: `node --test tests/*.test.js`（**末尾スラッシュ不可＝本Node環境gotcha**）＋pytest。

---

## 8. 段階構成（B#2 スコープ ↔ 将来 B#4）

- **B#2 で作る**: (a)新state(birthYear/assetHoldings/assetSource) (b)money-rules.js純関数群 (c)資産クラス比率セクションUI(money.js/money.css theme D) (d)層1完結(目標＋ドリフト可視化＋教育＋display-only帯) (e)facts出力→advice.py鏡像＋fixture更新。
- **B#4 接続点**: `assetSource:'manual'→'ledger'`。B#4 が `me.investment_snapshots.holdings {ticker:{qty}}` を埋めたら、`universe.csv` の新 `asset_class` 列で ticker→資産クラス join（⚠️ETFは type 単純写像不可＝中身を資産クラスへ展開するマッピング表が必要）→ 各バケツ×クラス金額を自動供給し source='ledger' へ切替。UI/descriptor/facts/state schema は不変のまま供給源だけ差替＝最小結合。同型 source軸は将来 B#3 NISA口座軸にも横展開可。
  - **assetHoldings↔buckets.amount の権威（MINOR-13・§10 と対）**: ledger 供給時、供給額と buckets.amount のどちらを権威にするかを B#4 で確定（現状 B#2 は両者独立の手入力2ソース）。

---

## 9. テスト/検証

- money-rules.js 純関数 unit（glidePath/regionBreakdown/bucketTargets/現状集計/符号付きdrift・端数吸収でΣ=100・floor30/ceil90境界・drift0境界）。
  - 追加＝**glidePath 未設定（birthYear<=0/域外/`!isFinite(age)`＝configured:false）**／**巨大・負 nowMs → 両言語 configured:false degrade（NaN facts でも 500 でもない・再検証P1）**／**端数吸収タイブレーク**（低R吸収境界 age55/age80）＋**総資産集約 blend タイ**（cash/devEq）／**zero-weight 総資産集約が未設定/core-fallback（NaN でない）**／**partial-funding で現状側 総資産集約 Σ=100・JS↔Py 一致（再検証P2）**／**年境界 UTC**（12/31 23:59Z と 1/1 00:00Z で age 一致）／**drift が常に整数**。
- advice.py 鏡像 unit＋共有 fixture パリティ（production/personal トップレベル同値）＋**`_migrate`/normalizeAssetHoldings 正規化パリティ**（adversarial-coercion ケースで分母一致）。
- **coarsen の Py 決定性**（§7 の読み替え）＝pre-coarsen facts が JS↔Py 同値である fixture に対し、**coarsen 出力に生の非25刻み currentPct/driftPct がゼロ件**であることを assert。
- SYS_PRODUCTION 禁則語トリップ0を実 fixture で実証。
- money.js smoke（Playwright実ブラウザ）: 年齢入力→ドーナツ更新／¥ログインゲート（readout のみ・**手入力欄は未ログインで消えない**）／**未ログインで手入力→ドリフト更新（localStorage 保存・%/pt更新）**／クイックフィル／display-only帯／pageerror0。
- デザイン: モック `scratchpad/b2-asset-class-mock.html`（既定 B）の視覚リファレンス＋レンダリング後RGBの判別性/クロス要素一致を実測（本 spec §6 の数値を満たす）＋**ドーナツ幾何（穴半径・外縁の可視性＝closest-side 修正後）**を1項確認（色のみ測定の盲点を塞ぐ・MINOR-24）。
- 本人実機サニティ: theme D の glow/glass/発色（GPU依存＝headless非authoritative）。

---

## 10. リスク

- **migrate 両所追加漏れ**: defaultState と migrate（＋advice.py `_migrate`）の三所に birthYear/normalizeAssetHoldings/assetSource を足さないとロード時無言消失。
- **符号付きdrift初導入**: cfNum が丸めない罠。rSigned/_r_signed を両言語で使い、half-up方向・0近傍・coarsen の sign×bucket を fuzz/fixture で厳密一致。drift を常に整数に保ち .5 境界を踏まない。
- **LWW消失（MINOR-14 で機構を訂正）**: 支配的機構は**クロス端末の stale ブラウザキャッシュ JS**（古い money.js/money-rules.js の allowlist migrate を走らせる開きっぱなしタブ）＝**クロスデプロイの版ずれとは別物**。**通常/persona 両サイト同時デプロイは版ずれサブケースのみ閉じ、stale-JS は閉じられない**（`.js` must-revalidate〔vercel.json〕は次回リロードまでの窓を短縮するだけ）。**CURRENT_VERSION bump も救済にならない**（古クライアントの migrate が新キーを知らず drop→後勝ちで消失は同じ）。緩和＝過渡期の window 最小化と、重要キーの LWW 前 reconcile に留まる。
- **assetHoldings↔buckets.amount の二重会計（MINOR-13）**: 現状クラス内訳（assetHoldings）とロードマップ総額（buckets.amount）は**独立の手入力2ソース**で B#2 では前者が後者から導出されない＝権威は用途別。ログイン時に両¥が併記され得るため、乖離時に UI で乖離フラグを出すか、現状%分母を「クラス入力があればクラス合計・無ければ amount」に切替える現仕様が amount 側真値と一致しない前提をリスクとして固定。%表示は composition 比のため矛盾は主に¥ readout 側。
- **conic mask の farthest-corner**: `circle` 既定でリング半径がずれる（計測で判明）＝**closest-side 明示半径必須**（§6.3）。
- **現金のみユーザーで現状ドリフト盤面が薄い**（真価は投資開始後）＝クイックフィルで初期非空化＋当面の主価値は「年齢設計図＋教育」と UI トーンで明示。
- **低alphaの chroma圧縮**: alpha を大きく下げると隣接hueが再衝突（実測）＝スライダー下限で判別性が落ちる関係をユーザーに委ねる。

---

## 11. Non-goals（B#2 では扱わない）

- 保有明細（ticker×株数）の自動集計（→B#4）。
- 個別銘柄/ETF の具体推奨（→層2 personal のみ）。
- NISA 口座軸（→B#3）。
- リバランスの具体指示（→層2 personal）。
- リアルタイム価格連動（B#2 は手入力）。
