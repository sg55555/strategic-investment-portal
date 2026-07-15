# num/_num scalar-coerce パリティ堅牢化（generic num/_num 配列unbox債務）— 設計

- date: 2026-07-15
- branch: `num-scalar-parity`（worktree `.claude/worktrees/num-scalar-parity`・base main `e41b6a1`）
- 由来: B#2「資産クラス比率」の申し送り「将来hardeningチケット（generic num/_num の配列unbox債務・他フィールド潜在）」
- 方式: **Approach A（基底プリミティブ堅牢化）**＋ effort xhigh（ultracode）
- pre-mortem: workflow `wf_7bc52be0-ab4`（6 agent・node/python 実地 diff・ground truth）

---

## 0. 問題（実地 diff で確定した発散面）

`money-rules.js`（JS）と `api/me/advice.py`（Py）は **byte-parity 鏡像**で、LLM facts（`modeAFacts`/`mode_a_facts`）と money view を駆動する。汎用 coercer が JS `Number()`/`+v` と Py `float()` の**文法差**で発散する。

| クラス | 例 | JS | Py | 到達性 |
|---|---|---|---|---|
| 配列 unbox（`num/_num`） | `[5]` `[[5]]` `["5"]` `[" 5 "]` | 5 | 0 | **mcc_state import 到達可**（client-bug/import） |
| 配列 unbox（`cfNum/_cf_num`・符号付き） | `[5]` `[-5]` | 5 / **-5** | 0 | cashflow DB path のみ（mcc_state 非到達） |
| 文字列 hex/8/2進 | `"0x10"` `"0o17"` `"0b101"` | 16/15/5 | 0 | mcc_state import 到達可（3 coercer 全て） |
| 文字列 underscore/全角/アラビア | `"1_000"` `"１２３"` `"٥"` | 0 | 1000/123/5 | mcc_state import 到達可（**逆方向＝Py 過大読み**） |
| 2^53+1 整数 passthrough | `9007199254740993` | …992 | …993 | `numScalar/_num_scalar` 固有（非JS writer のみ） |

- **bool**: `num(true)=1`/`numScalar(true)=0`（両言語同値だが coercer 族内で不整合）。
- **-0**: `num(-0)` JS=-0 / Py=0（数値等価・`JSON.stringify(-0)==="0"` で immaterial）。

**具体的な害**: `mcc_state = {monthlyExpense:[500000], buckets.core.amount:[2000000]}` を PUT/import すると、JS facts `{bufferConfigured:true, nextTarget:buffer, coreSharePct:100}` vs Py facts `{bufferConfigured:false, nextTarget:setup, coreSharePct:0}` — **client UI と server personal advice が本人の資産について食い違う**（discretization に潰されず top-level facts へ観測可能に伝播）。

**呼び出し監査（142箇所＝JS num 87＋Py _num 55）**: 回帰リスク **0**・bool依存/配列unbox依存 **なし**。正当経路は常に scalar leaf（container の goals/reserves/history/assetHoldings は必ず iterate され leaf のみ coerce）。配列 unbox は**既に発散している**ので依存し得ず、両側 0 収束＝**パリティ復元**（退行でない）。

---

## 1. 確定した設計判断（太田さん承認 2026-07-15）

1. **方式 A**: scalar-safety を汎用 coercer 本体に畳み込む（フィールド単位移行でなく根本解決）。
2. **numScalar/_num_scalar は削除**し `num/_num` へ集約（呼び出し3経路×2言語を再ポイント）。2^53+1 整数 passthrough も同時解消（numScalar が唯一 `Number()/float()` を通さない経路だった）。
3. **timestamp parser（`_parse_iso_ms` ↔ `Date.parse(pulledAt)`）は本チケット対象外＝別チケットへ defer**。今回の拡張 fuzz は cashflow に **valid な `pulled_at`** のみ与え、cashflow の数値 coercer（`cfNum`）だけ検証する。
4. **空白は LENIENT**: 前後 ASCII 空白を許容（`" 5 "→5`・今日も両言語一致）。Unicode 空白は ASCII クラスで弾く。
5. 既定で進める端: **value-identity**（既存 harness は正規化値比較・byte一致不要）／**Infinity→0 は現状維持**／**先頭 `+` 許容**／**巨大整数→0**。

---

## 2. Contract（byte-identical・value-level）

各言語に scalar 基底 `parseNum`/`_parse_num` を1つ設け、`num`（非負）と `cfNum`（符号付き）を再構築する。`r`/`rSigned` は本体無改変で自動継承（`num`/`cfNum` 上に構築済）。

**最重要 impl 詳細**: 共有 decimal 正規表現は **両言語で明示 ASCII `[0-9]` と `[ \t\n\r\f\x0b]` を使い、`\d`/`\s` は絶対に使わない**。Python の Unicode-aware `\d`/`\s` は全角/アラビア数字・Unicode 空白を再び通し、発散を静かに復活させる。

### JS（money-rules.js）
```js
// 共有 strict-decimal 文法。ASCII クラス限定（\d/\s は使わない＝Py Unicode 差で発散復活）。
// LENIENT: 前後 ASCII 空白許容（" 5 "→5・今日の挙動を保存）。
var _DECIMAL_RE = /^[ \t\n\r\f\x0b]*[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[ \t\n\r\f\x0b]*$/;
function parseNum(v) {                            // → Number（NaN/±Infinity を返し得る・呼び元が gate）
  if (typeof v === "number") return v;            // -0, ±Infinity, NaN はそのまま通す
  if (typeof v === "string") return _DECIMAL_RE.test(v) ? Number(v) : NaN;
  return NaN;                                      // boolean, null, undefined, array, object → NaN
}
function num(v)   { var n = parseNum(v); return (isFinite(n) && n >= 0) ? n + 0 : 0; } // 非負・n+0 で -0 正規化
function cfNum(v) { var n = parseNum(v); return  isFinite(n)            ? n + 0 : 0; } // 符号付き・n+0 で -0 正規化
```

### Py（api/me/advice.py）
```python
import re                    # ファイル冒頭へ（既に import 済）
from decimal import Decimal  # ファイル冒頭へ追加（下記 _parse_num で必須）
# ASCII クラス限定（\d/\s は使わない＝Unicode-aware で全角/アラビアを通す）。LENIENT 空白。
_DECIMAL_RE = re.compile(r'^[ \t\n\r\f\x0b]*[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[ \t\n\r\f\x0b]*$')
def _parse_num(v):                               # → float（nan/±inf を返し得る・呼び元が gate）
    if isinstance(v, bool):        return float('nan')            # bool を int より先に（Python は bool <: int）
    if isinstance(v, (int, float, Decimal)):                      # ⚠ Decimal 必須＝advice.py は cashflow の生 Decimal を _cf_num へ直渡し（下記注意）
        try:    return float(v)                                   # 巨大 int → double 化＝JS JSON.parse 意味論／float(Decimal) で現行挙動維持
        except (OverflowError, ValueError): return float('nan')   # int > ~1.8e308 → JS Infinity → nan → 0
    if isinstance(v, str):
        if not _DECIMAL_RE.match(v): return float('nan')          # 0x/0o/0b/underscore/unicode-digit を拒否
        try:    return float(v)
        except (ValueError, OverflowError): return float('nan')
    return float('nan')                                          # None, list, dict, datetime, ...
def _num(v):
    n = _parse_num(v); return (n + 0.0) if (math.isfinite(n) and n >= 0) else 0.0   # 非負・+0.0 で -0.0 正規化
def _cf_num(v):
    n = _parse_num(v); return (n + 0.0) if  math.isfinite(n)             else 0.0   # 符号付き・+0.0 で -0.0 正規化
```

> ⚠️ **Decimal は必須（回帰防止）**: `advice.py` do_POST は `me.cashflow_snapshots` を SELECT し `cf_rows` を **生 `rec[N]`（psycopg NUMERIC=`Decimal`）** で組み立て（L1177-1181）、`_cashflow_rows`→`_cf_num(r.get("total_income"))` = `_cf_num(Decimal(...))` へ直渡しする。現行 `_cf_num=float(v)` は `float(Decimal)` を受けるので動く。新 `_parse_num` が `Decimal` を numeric として扱わないと **cashflow 全額（income/expense/balance）が 0 に潰れる本番回帰**（Slice4 personal advice 破壊）。JS 側は `/api/me/cashflow` API が `cashflow.py._num` で Decimal→float 済みの JSON 数値を受けるので Decimal を見ない＝`float(Decimal(x))` と JSON 化 `float(x)` が同一 double でパリティ維持。`_num`（mcc_state 経路）は JSONB=JSON scalar のみで Decimal 非到達だが、共有 `_parse_num` が Decimal を扱っても無害。

### 挙動表（両言語で同一）
```
array / object（入れ子含む [5] [[5]] ["5"] [" 5 "] [-5] {} [{}] [[]]） ...... 0
boolean true / false ................................................ 0（bool を先に guard）
null / None / 欠測キー ............................................... 0
NaN / ±Infinity / "1e400" / "Infinity" / "inf" ...................... 0（isFinite/isfinite gate）
負の有限（-5, "-5"） ................................................ num→0 ; cfNum→-5（符号保存）
-0 / -0.0 / "-0" .................................................... +0（+0/+0.0 正規化）
2^53超の巨大 int（非JS writer のみ） ................................. 最近傍 double へ collapse・両側同値
plain decimal / exponent / signed / 前後 ASCII 空白（LENIENT） ...... Number()/float() で同一 parse
```

---

## 3. numScalar/_num_scalar 削除（実サイト）

### JS（money-rules.js）
- 定義 **L41-45 削除**。
- 実呼び出し **4箇所を `num` へ再ポイント**:
  - L53 `normalizeAssetHoldings`: `numScalar(inner[...])` → `num(inner[...])`
  - L63 `normalizeBirthYear`: `var n = numScalar(v)` → `num(v)`
  - L75 `glidePath`: `new Date(numScalar(nowMs))` → `new Date(num(nowMs))`
  - L819 `modeAFacts`: `var nowMs = numScalar(opts.nowMs)` → `num(opts.nowMs)`（事前 coerce は保持＝`num` が scalar-safe なので glidePath の再 coerce と冪等）
- export **L1027 `numScalar: numScalar` 削除**（`parseNum`/`num`/`cfNum` を export に追加）。
- コメント L60/L72/L810-817 を新 contract に合わせ更新（「numScalar だから配列 unbox しない」→「num が scalar-safe」）。

### Py（api/me/advice.py）
- 定義 **L170-182 削除**。
- 実呼び出し **3箇所を `_num` へ再ポイント**:
  - L192 `_normalize_asset_holdings`: `_num_scalar(inner.get(c))` → `_num(inner.get(c))`
  - L203 `_normalize_birth_year`: `n = _num_scalar(v)` → `_num(v)`
  - L223 `_current_year`: `_num_scalar(now_ms)` → `_num(now_ms)`
- コメント L200-202/L220 更新。

**副次修正（削除で自動的に閉じる発散）**:
- `normalizeBirthYear("0x7CE")`: 旧 numScalar=1998 / _num_scalar=0 → 折込 num で両側 0（assetClasses facts ブロック両側 absent）。
- 2^53+1: numScalar=…992 / _num_scalar=…993 → num/_num の float collapse で両側 …992。

**要確認（実装時）**: `tests/*.js`・`tests/*.py` が `numScalar`/`_num_scalar` を直接参照していれば `num`/`_num` へ更新（export 削除で壊れる箇所）。

---

## 4. migrate default-selection guard 修正

gate が生 `Number()`/`float()` で**第2の発散面**。**gate を sentinel `parseNum`/`_parse_num` に切替え、値は `num`/`_num` のまま**。「absent/invalid→default」と「present 0→0」の区別、および Infinity→0 の現挙動を保存する。

⚠️ **`num` を gate に使えない**: `satelliteCapPct` の gate は `>= 0` で、`num` は常に ≥0 を返すため gate が恒真化し default（10）へ落ちなくなる（`satelliteCapPct` 未設定が 0 になる回帰）。sentinel `parseNum`（NaN を返せる）が必須。

### JS（money-rules.js・object literal の前で sentinel を算出）
```js
// return {...} の直前で:
var _bm  = parseNum(raw.bufferMonths);
var _scp = parseNum(raw.satelliteCapPct);
// literal 内:
bufferMonths:    (_bm  > 0)  ? num(raw.bufferMonths)    : d.bufferMonths,      // 旧 Number(raw.bufferMonths)>0
satelliteCapPct: (_scp >= 0) ? num(raw.satelliteCapPct) : d.satelliteCapPct,   // 旧 Number(raw.satelliteCapPct)>=0
```

### Py（advice.py L412-421）
```python
_bm  = _parse_num(raw.get("bufferMonths"))
buffer_months = _num(raw.get("bufferMonths")) if _bm  > 0  else 6.0
_scp = _parse_num(raw.get("satelliteCapPct"))
sat_cap_pct   = _num(raw.get("satelliteCapPct")) if _scp >= 0 else 10.0
```

---

## 5. スコープ

**IN**（lockstep JS↔Py ペアで堅牢化）:
- `parseNum`/`_parse_num` 新設（scalar 基底）。
- `num`/`_num`（非負）・`cfNum`/`_cf_num`（符号付き）を基底上に再構築。
- `numScalar`/`_num_scalar` 削除＋呼び出し再ポイント（§3）。
- `r`/`_r`・`rSigned`/`_r_signed` は本体無改変で自動継承。
- migrate guard（bufferMonths/satelliteCapPct・§4）。

**OUT**（family 監査で除外正当と確認）:
- `cashflow.py:52`・`investment.py:52` の `_num`（信頼済 Neon DB Decimal→number 直列化器・client JSON 非経由。パリティ再 coerce は下流の `cfNum`/`_cf_num` で実施）。
- `_DATE_RE` gated な deadline `parseInt`/`int`・deadlineBucket `parseInt`/`strptime`（digit-only slice・parity 済）。
- 表示専用 `yen`/`yenSigned`（Py 鏡像なし・facts 非対象）。
- Python-only `_bucket25`/`_bucket25_signed`（coarsen/log path・JS 鏡像なし）・`_envint`（config）。

**別チケットへ defer**: `_parse_iso_ms(pulled_at)` ↔ `Date.parse(pulledAt)`（num族でない timestamp parser・§6）。

---

## 6. Follow-up チケット（defer）＝「JS Date/datetime・整数 overflow のライブラリ境界 非対称」（すべて非 coercion・本番非到達=絶対値が非現実的な極値でのみ発生）

拡張 fuzz が exercise した結果、**num/_num coercion とは無関係の pre-existing JS/Py 非対称を3種発見**（いずれも coerce 値は新旧同一＝本チケットの変更起因でない）。同カテゴリ（Date/datetime・overflow のライブラリ境界）ゆえ**単独の follow-up チケットにまとめて切る**。今回の fuzz はこれらを誘発しない範囲（現実的な絶対値・year≤9999）に入力を cap して coercion パリティを純粋検証した。

1. **timestamp パーサ**: `_parse_iso_ms` ↔ `Date.parse(pulledAt)`（`Date.parse` は実装依存で緩い）。fuzz は `pulled_at=""` で非 exercise。`facts.cashflow.dataFresh`/`staleDays` へ流入。
2. **整数 overflow**: `int(math.ceil(inf))` が Python で `OverflowError`（例 `_reserve_monthly` L406・`months_to_buffer` L764）。JS `Math.ceil(Infinity)=Infinity` は degrade（例外にならない）。`monthlyExpense≈1e300` 等が下流の積で Infinity 化した時のみ（本番の金額 ≤1e10 では非到達）。fuzz は huge 値を ≤1e9 に cap。
3. **Date year 境界**: `reserveMonthly`/`_reserve_monthly` が `nowMs` から日付を作る時、JS `new Date` は year>9999（上限 275760）を受理するが Py `datetime.fromtimestamp` は year 9999 超で例外→0。→ want が JS=満額/Py=0 に発散。**`glidePath`/`_glide_path` は `cy>9999` guard 済だが `reserveMonthly` は未 guard**（1行 guard 追加で対称化可）。`nowMs≈253402300800000`（year 10001）等でのみ（本番 `Date.now()` は year 2026 ゆえ非到達）。fuzz は nowMs を year≤9999 に cap。

**修正方針（follow-up）**: (2)(3) は「JS の非例外・非有限を Python 側でも同じ挙動に揃える」＝Py 側に `isfinite`/`year>9999` guard を足して JS の degrade（0/bucket）に対称化。(1) は共有 ISO パーサ純関数化。いずれも本チケット（coercion）の scope 外。

## 6.5 実測結果（本チケット・GREEN）

- **coercer contract table**（両言語）: JS `money-rules.test.js` / Py `test_advice_facts.py`。array/obj/bool/null→0・hex/8/2進/underscore/全角/アラビア→0・decimal 保持・負(num→0/cfNum 保存)・-0 正規化・Decimal 回帰ガード。
- **facts-parity**: `satelliteCapPct` 非decimal/配列→両言語 default 10（旧 JS 16/Py 10 等の発散解消）／配列 monthlyExpense/buckets→未設定（旧 JS unbox の誤 configured 解消）。
- **fuzz**: `scratchpad/b2-parity-fuzz.js`（全 num/cfNum フィールド＋cashflow＋新文字列カテゴリへ拡張）＝**7 seed×4000×2mode=56,000 比較 0 mismatch**（非有限は両側 sentinel 化して比較）。
- **回帰**: `node --test tests/*.test.js` 275/275・pytest 106/106 緑。
- **mutation-kill**: ①ASCII `[0-9]`→`\d` で全角が Py 側で漏れ RED（`[0-9]` 保護の非 vacuous 実証）②`_parse_num` の `Decimal` 除去で cashflow Decimal 回帰テスト RED（Decimal 保護の非 vacuous 実証）。他の array/bool/underscore/hex は RED-first で実証済。

---

## 7. テスト計画（TDD・RED-first）

1. **RED-first**: 既知発散入力を `tests/fixtures/advice_facts_cases.json` に敵対ケースとして追加し、**現行コードで** JS+Py parity スイートが**赤**になることを確認 → 実装で緑。
2. **coercer 単体 contract テーブル**（`tests/money-rules.test.js` と `tests/test_advice_facts.py` 両方）: `num`/`cfNum` を全 battery（`[5]`,`[[5]]`,`[[[5]]]`,`["5"]`,`[" 5 "]`,`[-5]`,`{}`,`[{}]`,`[[]]`,`true`,`false`,`null`,欠測,`NaN`,`Infinity`,`-Infinity`,`-0`,`"-0"`,`"0x10"`,`"0X1F"`,`"0o17"`,`"0b101"`,`"1_000"`,`"1_0"`,`"1_000.5"`,`"１２３"`,`"٥"`,`"Infinity"`,`"1e999"`,`"inf"`,`-5`,`"-5"`,`0`,`"007"`,`".5"`,`"5."`,`"1e3"`,`"1E-3"`,`" 5 "`,`9007199254740993`,`1e309`）でアサート。num→負は0・cfNum は符号保存・-0 正規化（`Object.is`/`copysign` で検証）。
3. **facts-parity fixture**（parity-critical フィールド別）: `monthlyExpense`, `bufferMonths`, `satelliteCapPct`, `buckets.*.amount`, `goals[].targetAmount`, `reserves[].{target,saved,monthlyOverride}`, `updatedAt`（num）／`assetHoldings.{bucket}.{class}`, `birthYear`, `nowMs`（折込 num）／cashflow row 全部（cfNum・valid pulled_at）。migrate guard ケース含め `bufferConfigured`/`nextTarget`/`roadmap.phase`/`satelliteCap` のパリティをアサート。**Decimal 回帰ガード**＝Py 側で `_cf_num(Decimal("123456.78"))==123456.78` を直接アサート（cashflow は DB で Decimal・JS の JSON 数値と同一 double を要求）。
4. **fuzz 拡張**（`scratchpad/b2-parity-fuzz.js` ＋ `b2-parity-fuzz-run.py`）: 全 num/cfNum フィールドを adversarial battery で変動（現状は birthYear/assetHoldings/nowMs のみ）＋文字列カテゴリに 0x/0o/0b/underscore/全角/アラビア/padded/先頭+/先頭0を追加＋array/nested/string-array/negative-array/{}/bool/null/2^53+1/1e309を追加＋**adversarial cashflow arg**（valid pulled_at）で `cashflowDerived`/`_cashflow_derived` を通す。production+personal で **0 mismatch** 要求・N 引上げ。
5. **mutation-kill**（非 vacuous 実証・1つずつ導入→スイート赤→revert）: (1)parseNum の array guard 除去 (2)Py `[0-9]`→`\d` (3)underscore 許容 (4)Py bool guard 除去 (5)int→float collapse 除去 (6)-0 正規化除去 (7)migrate gate を生 Number()/float() へ戻す (8)OverflowError guard 除去 (9)`_parse_num` の isinstance から `Decimal` 除去（cashflow Decimal 回帰を検知）。
6. **回帰**: `node --test tests/*.test.js`（**グロブ形必須**＝`node --test tests/` は本 Node 環境で `Cannot find module tests`）＋ pytest。既存 pinned battery・cf-1/cf-2/par-2 不変・正当 decimal facts が不変を確認。
7. **統合前 adversarial 検証 workflow**（whole-branch・correctness/parity/regulatory/regression）→ merge。
8. **post-merge**: `/` を通常/persona 両 deploy で curl 反映確認。

---

## 8. 不変条件（守る）

- 規制安全: no-score・facts 非改変（正当入力の facts は不変）・免責。
- cf-1（バッファ→コア）/cf-2（trend rb<=0 絶対比較）/par-2（単一丸め）回帰を壊さない。
- money.js に業務 math を書かない（純関数は money-rules.js）。
- JS↔Py は同じ向きに同時変更（fixture パリティ固定）。
- 意図的な挙動変更2件（両方 malformed-input 限定・両側同一に変化）: (a) `num`/`cfNum`(true) 1→0 (b) bufferMonths/satelliteCapPct に非decimal文字列/単要素配列→両側 default。string-format 発散の closure は既に発散していたので**パリティ復元**（回帰でない）。
