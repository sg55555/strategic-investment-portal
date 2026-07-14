# B#2 資産クラス比率 spec — 再検証記録（第2ラウンド）

- date: 2026-07-14
- workflow: `b2-spec-reverify`（runId wf_a3e0a9e1-2fd・45エージェント・完全性検証＋新規ハント→反証→統合）
- 結果: gap 2／新規ハント生 33→反証後 確定 7
- 対象: 第1ラウンド41件反映＋A案採用後の改訂spec
- **全項目を改訂spec に反映済**（改訂履歴(2)参照）。判定＝微修正で足りる・再設計不要。

## 完全性 gap（fix 部分未反映）

### MIN-5 — §78 largest-class 端数吸収の pre/post-round とタイブレーク未定義
- applied=True / correct=False
- 主要 fix は反映済＝§3.2 line87『各クラス r() half-up 整数化後、端数を r()後整数の argmax(cash除く6クラス)へ載せ Σ=100 機械保証。同値タイは §2.1 allowlist 固定順(cash→jpEq→devEq→emEq→bond→reit→gold)で先勝ち＝JS/Py 両言語明記。「通常devEq」の非決定表現は撤回』で丸め基準＋タイブレークを一意化（コード裏取り r():34 half-up 非負前提一致）。ただし fix の残り2点が未反映＝(1)『§86(=改訂§3.3)総資産集約にも Σ=100 端数吸収規則を規定』が無い。§3.4 line105③は『加重平均を rSigned で整数化してから減算(集約でも fractional 残さない)』とだけ規定し、集約側の Σ=100 端数吸収は未定義＝両言語同一丸めでパリティは保たれるが集約 facts が Σ=99/101 になり得る点が未手当て。(2)『cash と devEq が §3.3 集約 blend でタイするケースの fixture』が明示に無い＝§7 line202 の追加ケース(g)は『age55→R55/age80→R30 の吸収先』＝§3.2 グライドパス側のタイブレークで、集約 blend 固有のタイではない。いずれも minor 残渣だが fix が明示要求した項目ゆえ未充足。

### MIN-6 — 未分類マス vs facts 7キー固定の不整合（§92 vs §172/§167）
- applied=True / correct=False
- 中核の突き合わせは反映済＝§3.4 line104『未分類は facts に出力しない(§3.5/§7 相互参照・facts は7キー allowlist 厳守)・分類済み合計=0 のとき currentPct=0(0/0 ガードで NaN 回避)』＋line106『classes 全0バケツの drift は −target(未配分)を意図出力』＋§7 line192『classes[] は総資産集約の固定7クラス1本のみ・バケツ別は UI 専用』で、実装者が8本目 unclassified キーを注入して7キー cap を破る誤解余地を封じる。ただし fix の2点目が未反映＝『§86(=改訂§3.3)の総資産の俯瞰に現状側アグリゲートの分母を明記(未分類割合を別フィールド unclassifiedPct で持つか/分類済み合計を分母にするか)』が無い。§3.3 line95 は『目標』アグリゲートのウェイト(bufferTarget/coreTarget/satelliteCap)のみ規定し、現状側アグリゲートの分母・未分類マスの帰属を未決定＝§7 line192 の目標額ウェイト＋§3.4 line104 の per-bucket currentPct から現状集約は導出可能だが、未分類質量が黙って落ちて現状集約が Σ<100 になる挙動が明文化されていない。minor な明確化残渣。

## 確定新規issue（反証を生き残った）

### 新-1（IMPORTANT）総資産集約の currentPct/driftPct を parity-gated facts に確定したのに、現状側集約ウェイトが未定義（§3.3 は目標側ウェイトのみ規定）
- 場所: §7 (line 192) と §3.3 (line 95-97) / §3.4 (line 104)
- why: §7:192(MINOR-28)は `classes[]` を「総資産集約（バケツ目標額ウェイト加重平均後の固定7クラス1本）のみ」に確定し、バケツ別内訳は UI 専用・facts 非対象と明言＝facts には総資産レベルの currentPct/driftPct が必須。しかし §3.3:95 が定義する加重平均は『各バケツのクラス目標% × バケツ目標額ウェイト(bufferTarget/coreTarget/satelliteCap)』＝目標(targetPct)側のみ。総資産 currentPct をどのウェイトで集約するか(目標額ウェイトで対称に? 実 assetHoldings 合計で? 分類済み合計で?)は §3.3/§3.4 のどこにも規定されない。driftPct_total=currentPct_total−targetPct_total は §4:121 でトップレベル両モード完全一致(parity-gated)なので、JS↔Py が現状側ウェイトを別々に選べばパリティが破綻する＝実装ブロッカー。MIN-6/MIN-20 は『現状側分母を規定せよ』と指摘したが改訂 spec は目標側しか定義しておらず未反映で、MINOR-28 の総資産-only 確定がこの欠落を(バケツ別で逃げられない)ハードなパリティ穴へ格上げした。§3.4:104 の per-bucket currentPct 分母(分類済み合計)は総資産集約ウェイトとは別レイヤで、これでは代替にならない。
- 反証判定: 改訂spec上に実在する未解決の問題。改訂spec §3.3:95 は総資産集約ウェイトを「各バケツのクラス『目標%』× バケツ目標額ウェイト＝総資産の『目標』比率」と目標側のみ定義し、現状側(currentPct)の総資産集約ウェイト/分母を規定していない。§3.4:104 は per-bucket 現状%(classes合計を分母)のみで総資産集約の代替にならず、§3.5:105 step③ の「総資産集約は加重平均を rSigned で整数化」も現状側のウェイトを名指ししていない。§7:192(MINOR-28)は classes[] を総資産-only に確定し「バケツ目標額ウェイト加重平均後の固定7クラス1本」とするが、これを currentPct に literal 適用すると partial-funding(空バケツの per-bucket currentPct=0/0→0)で Σ≠100 になり破綻する＝spec 自身の主要シナリオ(§3.4:103/§10:235「現金のみ・投資未開始」)で不正。よって §7:192 は shape を確定するだけで正しい現状側集約則を与えていない。決定的なのは、元findings で MIN-6 fix(line109「§86 の総資産の俯瞰に現状側アグリゲートの分母を明記」)と MIN-20 fix(2)(line201「総資産の現状集約ウェイトを目標集約と対称に定義＝現状は各バケツの assetHoldings 合計をウェイトにする等…JS/Py 実装分岐によるパリティ破綻を防ぐ」)が明示的に本ギャップの是正を要求したにもかかわらず、改訂spec は兄弟fix(未分類facts非出力§3.4:104・全0現状drift=−target§3.4:106・目標ウェイトのzero-weight fallback§3.3:9

### 新-2（IMPORTANT）§3.1 currentYear 導出スニペットが JS のみ num()/isFinite ガードを持ち、Py 側に _num/例外ガードが無い＝負・巨大 nowMs で JS(NaN/1970) vs Py(例外/1969) の parity 乖離を再導入
- 場所: spec §3.1（L69-70, L74-75）
- why: 改訂で追加された導出 `currentYear = new Date(num(opts.nowMs)).getUTCFullYear()` / Py `datetime.fromtimestamp(now_ms/1000, tz=utc).year` は非対称。JS num()(money-rules.js:32)は負を0へ写す→負nowMsで Date(0)=1970、一方 Py 側スニペットは _num を通さない→fromtimestamp(負)=1969 で age が1ずれる。巨大 nowMs では JS が Date(1e300)=Invalid→getUTCFullYear()=NaN→age=NaN、しかし §3.1 の未設定ゲート `birthYear<=0||age<0||age>120`(L75) は NaN 比較が全て false ゆえ configured=true のまま R=clamp(110−NaN,30,90)=NaN が facts へ流出（JSON化で null）。Py は fromtimestamp が OverflowError→500。既存 reserveMonthly は正にこの罠を `if(!isFinite(nd.getTime()))return 0`(money-rules.js:76-77) と Py `_num(now_ms)`＋try/except(advice.py:211-214) で両側 degrade 済なのに、改訂 §3.1 はその確立イディオムを写さず配線し直した。ゲートに `!isFinite(age)` も欠く。
- 反証判定: 改訂spec §3.1 上に実在する未解決の穴で、非問題化されていない。裏取り結果:

【huge nowMs = 決定的な穴（refute不能）】
- L69 の導出は Date 構築系（JS `new Date(num(opts.nowMs)).getUTCFullYear()` / Py `datetime.fromtimestamp(now_ms/1000).year`）。`num()`(money-rules.js:32) は非有限/負/を0へ写すが、**巨大な有限値は素通し**＝`num(1e300)=1e300` → `new Date(1e300)` は有効範囲±8.64e15超で Invalid → `getUTCFullYear()=NaN` → `age=NaN`。
- L75 で形式化した未設定ゲートは `birthYear<=0 || age<0 || age>120` の3条件のみで、**`!isFinite(age)`/NaNチェックを欠く**。NaN の比較は全て false ゆえゲートを configured:true で通過し、`R=clamp(110−NaN,30,90)`。clamp=`Math.max(30,Math.min(90,NaN))=NaN` が facts へ流出（JSON化で null）。一方 Py は fromtimestamp(巨大)→OverflowError で、L69 スニペットに try/except が無いため 500。**JS(facts=null) vs Py(500) の parity 乖離**が成立する。これは既に確定採用された MINOR-9/18（zero-weight で JS NaN vs Py 例外の乖離回避）と同クラスの欠陥だが、nowMs→age 経路については改訂spec のどこに

### 新-3（CRITICAL）§7 fixture ケース(i) が要求する単一要素配列の byte一致（`num([5])≠_num([5])`）は、§2.2 が指定する per-class num/_num 正規化では原理的に満たせず、mandated fixture が unsatisfiable
- 場所: §7 パリティ計画 ケース(i)（spec 行202）× §2.2 normalizeAssetHoldings『各 num 既定0』（行47-48）
- why: 実測で確認：num([5])=5・num(['5'])=5（JS, money-rules.js:32）に対し _num([5])=0.0・_num(['5'])=0.0（Py, advice.py:155）＝単一要素配列で発散する。§2.2 は各クラス値を『num 既定0』(JS) / '_num coerce'(Py) で正規化すると規定＝この差が currentPct 分母にそのまま載り、§7 が要求する『production/personal トップレベル同値（currentPct/driftPct 含む）』が破れる。ところが改訂 §7 ケース(i)は『単一要素配列＝num([5])≠_num([5]) の差が分母に載らないこと』を必須 fixture として明記しながら、それを両言語で一致させる追加ガード（例 typeof==='number' 判定や Array 明示 0 化）を normalizer 側に一切規定していない＝指定どおり実装すると当該 fixture は必ず赤になる。裏付け：既存 adversarial-coercion fixture(tests/fixtures/advice_facts_cases.json:375)は satellite.amount を意図的に多要素 [1,2,3]（num=0=_num=0 で一致）にして、まさにこの発散を回避していた。A案 rewrite が [5] を必須テストへ昇格させたことで、回避していた発散を解決策なしに再導入している。
- 反証判定: 実在する未解決の問題。実測で裏取り済：money-rules.js:32 num([5])=5（Number([5])→"5"→5）に対し advice.py:155 _num([5])=0.0（float([5])→TypeError→0.0）で発散する。既存 fixture(:375)は satellite.amount を [1,2,3]（両言語とも0一致）にしてこの発散を意図的に回避していた。ところが改訂 §2.2（行47-48,55）は各クラス値を「num/_num coerce」だけで正規化すると規定し、これが「currentPct 分母の両言語一致に必須」と明言する一方、配列ガードは *トップレベル `raw.assetHoldings`* にのみ効く `typeof==='object' && !Array.isArray` の1箇所のみで、クラス値（例 core.jpEq=[5]）は num/_num へ直行する。改訂 §7 ケース(i)（行202）は単一要素配列＝`num([5])≠_num([5])` の差が分母に載らないことを必須 fixture に昇格させたが、それを両言語で一致させる per-class の typeof/Array 明示0化ガードを §2.2 にも §7 にも一切規定していない。よって §2.2 を文字どおり実装すると core.jpEq=[5] は JS で5・Py で0となり currentPct 分母が発散＝ケース(i)は必ず赤。§2.2 の「num/_num coerce で両言語一致」という主張は §7 が mandate する当該入力に対して偽であり、§2.2 の機構と §7 の不変条件が矛盾している（decision-complete を謳う spec 内の未解決の内部矛盾）。A案 rewrite が [1,2,3

### 新-4（IMPORTANT）目標ドーナツに『未分類グレー』を載せる §5-3 が、未分類=現在地バー限定という §3.4/§6.1・および目標は常に完全7クラス(Σ=100)という §3.3 と正面衝突（第8色を目標側に混入）
- 場所: §5 item3 vs §3.3 / §3.4 / §6.1
- why: IMP-9 fix で新設した第8色(未分類)を §5-3 が『目標ドーナツ（…7クラスをアーク色分け＋未分類はグレー）』と目標ドーナツに紐付けた。だが未分類は §3.4『あるバケツの classes が全0だが amount>0 の場合…現在地バー限定の表示セグメント』かつ §6.1『現在地バー限定・facts非出力』と明記される現状(current)専用概念。目標(target)は §3.1-3.3 の glidePath 純導出で常に7クラスがΣ=100（§3.2『Σ=100 を機械保証』）＝未分類スロットが構造的に存在しない。§5-3 の中央表示も『守り◯%/攻め◯%』＝目標R/D。よって目標ドーナツに未分類グレーを出すのは定義上不可能で、§5 が §3.3/§3.4/§6.1 と矛盾。第8色がどのチャートに現れるかという実装の要が二重定義になっており、rewrite で第8色を §5 に糸通しした際に生じた新規矛盾（IMP-9 fix は『現在地バー限定』としており目標ドーナツ混入は指示していない）。
- 反証判定: 実在する未解決の矛盾。改訂spec §5 item3（line135）は「**目標ドーナツ**（§6.3 の conic 方式・7クラスをアーク色分け＋未分類はグレー）、中央に『守り◯%/攻め◯%』」と、第8色（未分類グレー）を明確に**目標側ドーナツ**へ紐付けている（中央が守り/攻め＝目標R/Dゆえ target donut で確定）。一方 §3.4（line104）は未分類を「既存 amount を『未分類』1本として**現在地バー限定**の表示セグメントに計上・facts非出力」と定義し、§6.1（line163）も第8色を「**現在地バー限定**・facts非出力」と明記。さらに §3.3（line92-94）+§3.2（line87）で target は buffer cash=100%/core glidePath/satellite固定＝常に7クラスで『Σ=100 を機械保証』＝未分類スロットが構造的に存在しない。よって目標ドーナツに未分類グレーを載せるのは (a) §6.1 の『現在地バー限定』に正面から違反、(b) §3.3 の常時7クラスΣ=100と両立不能、(c) 現在地表示は §5 item5（目標vs現状の積み上げバー2本）が別途担う。改訂spec内に目標ドーナツで未分類を許す整合テキストは無く、IMP-9 fix の第8色を§5へ糸通しした際に『現在地バー限定』を無視して誤って target donut 側へ付けた新規矛盾。手当て済でも非問題でもない。

### 新-5（IMPORTANT）§5 item3「目標ドーナツ…＋未分類はグレー」が §6.1(未分類=現在地バー限定)・§3.2(目標は常にΣ=100で7クラス完全分類)と矛盾
- 場所: spec §5 item3 (L136) vs §6.1 (L163) / §3.2
- why: 目標(target)はglidePath由来で§3.2が7クラスΣ=100を機械保証(core cash=0・総資産集約でも全クラス充填)＝未分類スロットは構造的に存在しない。ところが§5 item3は『目標ドーナツ…＋未分類はグレー』と未分類アークを目標ドーナツに描くと規定。一方rewriteで追加された§6.1(important G fix)L163は未分類色を『現在地バー限定・facts非出力』と明記。未分類は§3.4 L104どおり classes全0×amount>0 の現在地セグメント専用概念で、目標側には出得ない。rewriteの§6.1『現在地バー限定』制約が旧来の§5ドーナツ文言と新たに衝突し、実装者は目標ドーナツに未分類グレーを描くか否か判断不能。
- 反証判定: 改訂spec上に実在する未解決の textual contradiction である。§3.2（L82-87）は目標(target)がglidePath由来で端数吸収により7クラスΣ=100を機械保証し、core cash=0でも6クラス充填・総資産集約でも全クラスが埋まる＝目標側に未分類スロットは構造的に存在し得ない。未分類は§3.4(L104)どおり「classes全0×amount>0」の現在地セグメント専用概念であり、rewriteが新設した§6.1(L163・important G)は未分類色を明確に「現在地バー限定・facts非出力」と規定した。ところが§5 item3(L135)の UI レンダ指定は依然「目標ドーナツ … 7クラスをアーク色分け＋未分類はグレー」と、目標ドーナツに未分類グレーアークを描くと明記したまま更新されていない。これは rewrite が§6.1の「現在地バー限定」制約を追加しながら§5 item3の旧文言をスクラブし忘れた incomplete-rewrite の残存で、§3.2/§3.4/§6.1(3箇所)が「未分類=現在地バー限定」で一致するのに対し§5(UIレンダの権威リスト)だけが矛盾する。decision-complete を称する spec に目標ドーナツ側の未分類描画可否について矛盾する指定が残っており、修正(§5 item3から「＋未分類はグレー」を削除、または『目標ドーナツには未分類は出ない』の相互参照追記)を要する。なお本件はA案(age/ageBucket)とは無関係の指摘で、A案の refutation は適用されない。実害は目標が構造上未分類値を持たないため描画上は0幅で無害だが、spec本文の未解決な内部不整合という点では実在する。

### 新-6（IMPORTANT）birthYear 未設定時の facts 形状が『assetClasses を出さない or configured:false を載せる』の未決 OR で、共有 fixture(e) を一意に pin できない
- 場所: spec §7（L193）／§9・fixture(e)（L202,218）
- why: §7 A案 age 出力は『birthYear 未設定時は assetClasses を出さない（or configured:false を載せる）』と2形状を OR のまま残す。§3.1 の glidePath は {configured:false} を返すが、それが facts でキー丸ごと省略になるか `assetClasses:{configured:false}` オブジェクトとして載るかは別問題で未確定。fixture(e) は『configured:false／age依存部を facts に出さない』と両表現を混在させ、§9(L218) は『birthYear<=0/域外＝configured:false』とだけ書く。共有 fixture は modeAFacts↔mode_a_facts の facts dict を丸ごと突合するため、OR の2形状はどちらか一方を確定しないと期待値を書けない＝decision-complete を謳う spec の実装ブロッカー。ageBucket 撤回（A案・非gap）とは独立の穴。
- 反証判定: 改訂spec上に実在する未解決の穴。refuted=false と判定。

【事実確認】
- §7 L193 は改訂後も「birthYear 未設定時は `assetClasses` を出さない（or `configured:false` を載せる）」と、**assetClasses オブジェクト丸ごとのレベルで二形状の binary OR を明文で残している**（「出さない」＝キーごと省略 vs 「configured:false を載せる」＝`assetClasses:{configured:false}` を載せる）。文法上も "or" で二択を並置しており、片方の consequence 記述には還元できない。
- fixture(e) L202「birthYear 未設定＝configured:false／age依存部を facts に出さない」も「／」で両表現を併記し、どちらか一方に確定していない。
- §3.1 L75／§9 L218 が確定しているのは **glidePath 純関数の戻り値 `{configured:false}`**（unit）であって、それを facts 層が (a)そのまま `facts.assetClasses` に埋めるか (b)`gp.configured` を見てキーごと省略するかは別決定＝どちらも純関数戻り値と両立し、§7 の OR を閉じない。むしろ「純関数戻り値をそのまま埋める」自然実装だと §7 の「出さない」選択肢と内部的に食い違う軽い緊張すらある。

【なぜ実装ブロッカーか（裏取り済）】
共有 fixture は facts dict を**丸ごと突合**する：JS `tests/money-rules.test.js:221-225`＝`assert.deepEqual(prod, c.production)`／

### 新-7（MINOR）§5-3『目標ドーナツ …＋未分類はグレー』が §6.1/§3.4 の『未分類＝現在地バー限定』と矛盾（目標は常に7クラス完全分類ゆえ未分類が存在し得ない）
- 場所: spec §5-3（L135）／§6.1（L163）・§3.4（L104）
- why: §6.1 の未分類色(#64748b)は『§3.4 の後方互換“未分類”現在地セグメント用・現在地バー限定・facts非出力』と定義され、§3.4(L104) も未分類を classes 全0×buckets.amount>0 の現状側専用セグメントとする。一方 §5-3 は『目標ドーナツ（…7クラスをアーク色分け＋未分類はグレー）、中央に“守り◯%/攻め◯%”』と、年齢グライドパス由来で常に7クラスへ完全分類される目標ドーナツに未分類スロットを付けている。目標側は R/D から機械分解され未分類は構造上生じ得ないため、目標ドーナツへの未分類グレー言及は §6.1/§3.4 の『現在地限定』条項と矛盾する改訂由来の小穴。実装者がどちらの図に未分類を描くか迷う。
- 反証判定: 改訂spec上に実在する未解決の小穴。§5-3(L135)は「目標ドーナツ（…7クラスをアーク色分け＋未分類はグレー）」と、未分類スロットを目標ドーナツに明記している。一方 §6.1(L163)は未分類色#64748bを「§3.4 の後方互換『未分類』現在地セグメント用…現在地バー限定・facts非出力」と定義し、§3.4(L104)も未分類を「classes 全0×buckets.amount>0 の既存amountを1本として現在地バー限定の表示セグメントに計上」と現状側専用に限定している。目標ドーナツは年齢グライドパス(R/D)から3バケツ加重で7クラスへ機械分解され(§3.3)、構造上100%が7クラスに配分され未分類は生じ得ない。§6.3の円グラフ記述も単一データのconic(3視覚層=glow/body/edge)であり現在地データを内包しない(現在地は§5-5の積み上げバー2本が担う)。よって §5-3 の目標ドーナツへの『未分類はグレー』言及は §6.1/§3.4 の『現在地バー限定』条項と矛盾し、§5-3側に整合注記もない。実装者が目標ドーナツへ描画すべきでない未分類グレーアークを描く誘導になる改訂由来の未解決inconsistency。A案/ageBucket 撤回とは別軸の問題で、当該前提では手当てされていない。

## 統合判定（synth）

I've verified the load-bearing claims against the actual code. Confirming the key facts before synthesizing:

- `num()` (money-rules.js:32) = `isFinite(n) && n>=0 ? n : 0` → huge finite (e.g. `1e300`) passes through; `new Date(1e300)`→Invalid→`getUTCFullYear()`=NaN.
- Existing idiom that the revised §3.1 fails to copy: JS `reserveMonthly` guards with `if(!isFinite(nd.getTime()))return 0` (money-rules.js:76-77); Py `_reserve_monthly` guards with `_num(now_ms)` + `try/except (OverflowError,OSError,ValueError)` (advice.py:211-214).
- `_migrate` (advice.py:252-266) is an allowlist rebuild that drops non-listed keys — confirms the mode_a_facts pipeline reads only migrated fields.
- Spec §3.3:95 / §3.4:104 / §7:192 name only "バケツ目標額ウェイト" (target-amount weight); no current-side aggregation weight/denominator anywhere.

Both new issues reproduce. Synthesis:

---

# B#2 改訂spec 再検証の統合

## (1) 実装着手可能な品質か
**ほぼ可。ただし着手前に潰すべき important 2件が残存**（＋minor 1件）。41件中 39件の fix は正しく反映済み。A案採用（age 公開教育値・ageBucket/年齢最小化 撤回）は正しい適用で、そこは gap ではない。残る2件はいずれも **JS↔Py パリティのハード・ブロッカー**（表示専用でなく facts/実装/500 に波及）だが、**局所的**（§3.1・§3.3/§3.4/§7 の数文で閉じる）。構造変更は不要。

## (2) 実装前に必ず直す項目（優先順）

**P1【important・パリティ&クラッシュ】§3.1 currentYear 導出の JS/Py 非対称（確立イディオムの写し忘れ）**
- 症状: 巨大 nowMs → JS は `num()` 素通り→`new Date(1e300)`→NaN→**ゲート `birthYear<=0||age<0||age>120`(§3.1 L75) を NaN が全て false で通過**→`R=clamp(110−NaN,…)=NaN`→facts が null 流出。Py 側スニペット `datetime.fromtimestamp(now_ms/1000, tz=utc)` は `_num`/try-except 無し→**OverflowError→500**。負 nowMs でも JS(1970) vs Py(1969) の age off-by-one。
- 修正（§3.1 L69/L75）: 既存 reserveMonthly/_reserve_monthly と同型に揃える。① JS: `new Date(num(opts.nowMs))` の `if(!isFinite(nd.getTime()))` で未設定へ、かつゲートに **`!isFinite(age)`（NaN）条件を追加**。② Py: `datetime.fromtimestamp(_num(now_ms)/1000, tz=utc)` に **`_num` を通し try/except(OverflowError/OSError/ValueError)** で `configured:false` へ degrade。③ 両側とも「巨大/不正/負 nowMs → configured:false（NaN facts でも 500 でもない）」と明記。④ §7/§9 fixture に「巨大 nowMs・負 nowMs → 両モード両言語 configured:false 一致」ケースを追加（case (i) adversarial-coercion / (h) 年境界 UTC の延長）。

**P2【important・パリティ】現状側 総資産集約ウェイト/分母が未定義（§7:192 の total-only 確定で per-bucket 逃げ道が消え、穴が格上げ）**
- 症状: §3.3:95 は集約ウェイトを「クラス**目標**% × バケツ**目標額**ウェイト」と**目標側のみ**定義。§7:192(MINOR-28) は `classes[]` を「総資産集約（バケツ目標額ウェイト加重平均後の固定7クラス1本）のみ」に確定。この**目標額ウェイトを currentPct に字義通り適用すると**、空バケツの per-bucket currentPct=0/0→0 が混じり **Σ≠100**（＝spec の主シナリオ「現金のみ・投資未開始」§3.4:103/§10:235 で不正）。正しい現状側集約（各クラスの assetHoldings 実額を全バケツ合算し総分類額で割る＝自然に Σ=100）は spec のどこにも書かれておらず、JS/Py/fixture 著者が各々選べる。currentPct/driftPct は §4:121/§7:192 で両モード完全一致のトップレベル parity-gated ゆえ実装ブロッカー。**これは MIN-6 fix(2) と MIN-20 fix(2) が明示要求した是正の未反映**（兄弟 fix は取り込み済だが本項だけ欠落）。
- 修正（§3.3・§3.4:105・§7:192）: ①「currentPct の総資産集約は**目標額ウェイトではなく各バケツ assetHoldings 実額をウェイト**にする（＝Σ_bucket 実額[class] / Σ_all 実額）」を1文で確定し、§7:192 の「バケツ目標額ウェイト」は **targetPct 専用**と明記。② 全 assetHoldings=0 の縮退時は currentPct=0 / drift=−target（§3.4:106 と整合）を JS/Py 同一で規定。③ §9 fixture に「partial-funding（一部バケツ空）で Σ currentPct_total=100・JS↔Py 一致」ケースを追加。

**P3【minor・推奨】§3.3 総資産集約の Σ=100 端数吸収と集約 blend タイ fixture（MIN-5 残渣）**
- §3.2 のクラス分解には argmax+allowlist タイブレークの Σ=100 吸収があるが、**§3.3 総資産集約側には無い**（§3.4:105③ は「rSigned で整数化」のみ）→集約 facts が Σ=99/101 になり得る（両言語同一丸めでパリティは保つが Σ 不整合）。§3.3 集約にも同じ吸収規則を適用し、§7/§9 に「cash と devEq が集約 blend でタイするケース」の fixture を追加（現状の case (g) は §3.2 グライドパス側のタイで集約 blend 固有ではない）。

（MIN-6 の残渣は P2 と同一の穴なので P2 に統合済み。）

## (3) 判定
**微修正で足りる**（実装そのまま不可・再設計不要）。P1・P2（いずれも important パリティ穴・数文で閉じる）を必須反映、P3 を推奨反映してから着手すれば decision-complete。A案の骨格と 39/41 fix は健全で、構造・データモデル・2層境界の作り直しは不要。