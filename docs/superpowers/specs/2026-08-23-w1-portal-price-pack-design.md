# UIUX刷新 wave W1「ポータル一目パック（発掘ストリップ＋値動きモード）」設計 spec

- **日付**: 2026-08-23（設計承認 2026-08-23・本人／モック実物比較で確定）
- **worktree**: `/home/shugo/apps/investment-portal/.claude/worktrees/w1-price-pack`（branch `worktree-w1-price-pack`・base main `9147d48`）
- **典拠（正）**: 本 spec のすべての数値は **2026-08-23 に Neon 本番 DB を読取専用 SELECT して実測**した値（測定スクリプト＝`scratchpad/w1-dump.py`）。モック実物＝`scratchpad/w1-mock-server.py` ＋ `scratchpad/w1-variants.js`（案①②③を実アプリのシェル上で切替比較・**リポの index.html は無改変**／serve 時にだけフックを注入）。構造スモーク＝`scratchpad/w1-smoke.js`（PC 1440 / 390px × 4案 = 8ケース緑）。
- **上位計画**: `Projects/investment-portal.md`「🎨 UIUX刷新スレッド」→ 機能第1弾（16機能）を4 wave に分割し、その **W1**。カタログ＝`docs/superpowers/specs/2026-08-08-uiux-proposal-catalog.md` 柱3「ポータル強化」。
- 本 spec のコード断片は設計意図の提示＝**SDD 実装時に必ず現物（現 HEAD の該当行）を確認**してから編集する。

## 0. 背景・経緯

現行ポータルは **財務10列の表**（売上高／売上3期／時価総額／PER／PBR／健全性／営業利益率／ROE）で、**価格・値動きの情報がゼロ**。「今日どれが動いたか」「52週高値に近いのはどれか」は本アプリでは一切分からない。一方 `market.ohlcv` には **292銘柄すべてに 252営業日以上の日足**（総 235万行・最新 2026-08-21）が既にあり、**データは揃っているのに UI に出ていない**状態だった。

2026-08-09 に本人が選定した機能第1弾のうち「ポータル強化」束（値動きランキング／価格スパークライン／52週高値接近／セクターヒートマップ／条件保存）を W1 とし、2026-08-23 に配置3案をモックで実物比較 → **案①発掘ストリップ ＋ 案②値動きモードの組合せ**を採用、**案③ヒートマップは次 wave** と決定した。

### recon で判明した前提の訂正
- **「スクリーニング条件保存」は既に実装済み**（`index.html` の `saveScreenerPreset`/`onScreenerPresetChange`/`loadScreenerPreset`/`deleteScreenerPreset` ＋ `ScreenerRules.loadPresets/savePresets/validatePreset`）。**W1 のスコープから外す**（カタログの記載が stale）。
- 既に `#ranking` 画面がある（`METRIC_REGISTRY` 9指標の散布図＋順位表）。**本 wave は #ranking に手を入れない**（価格指標の #ranking 統合は将来判断・§13）。

## 1. 確定事項（本人決定・AskUserQuestion 2026-08-23）

1. **主目的＝発掘**（知らない銘柄を見つける）。ウォッチ監視・相場俯瞰は従。
2. **発掘の軸＝カタログ4点セット**（前日比／5日騰落／出来高急増／52週高値からの距離）。YTD・MA乖離・RSI 等は入れない（軸が増えると初見で迷い、payload も増える）。
3. **集計は list.py で毎回計算**（`market.price_summary` の ETL 事前計算は採らない）＝**可動部ゼロ**（migration なし・ETL 無改修・新関数なし）。遅ければ後から ETL 側へ移せる（後戻り可能）。
4. **鮮度＝自市場の最新日だけランキングに採用**（JP は JP の最新日・US は US の最新日）。取り残された銘柄は表には出すが日付バッジで明示。
5. **スパークラインは30日**（+10.7KB gzip）。
6. **ストリップは常時表示**（値動きモード中も畳まない）＝「開いた瞬間に今日の動き」を失わない。
7. **案③ヒートマップは次 wave**（実物は刺さったが、55業種の丸め方とモバイル縦長 4758px の設計が別問題）。

## 2. スコープ / 非スコープ

### スコープ
| # | 項目 | 主対象 | 依存 |
|---|------|--------|------|
| S1 | list API に価格集計 `px` を同梱（4点セット＋30日 spark＋52週） | `api/market/list.py` | market.ohlcv（既存） |
| S2 | 鮮度メタ `market_asof` の供給と stale 判定 | `list.py` ＋ 新 rules 層 | S1 |
| S3 | 案① 発掘ストリップ（4タブ・上位12件） | `index.html`・新 rules 層・CSS | S1/S2 |
| S4 | 案② 値動きモード（[財務]/[値動き]・1枚表・列ヘッダ並べ替え） | `index.html`・新 rules 層・CSS | S1/S2 |
| S5 | 純関数レイヤ新設 `portal-price-rules.js` ＋ node テスト | 新規ファイル・`tests/` | — |
| S6 | `dataClient.js` に `market_asof` の受け渡し1行 | `dataClient.js` | S2 |

### 非スコープ（明示）
- **案③ セクターヒートマップ**（次 wave = W1.5 として別 spec）。
- **`.portal-table` の nth-child 列非表示を data-col 方式へ全面置換**（財務表の回帰リスクを本 wave に持ち込まない・§8／次 wave 送り）。
- **詳細ビュー側**（52週レンジバー・期間切替バー・ベンチマーク比較）＝ W2。
- **配当情報・決算イベントマーカー・日次アラート**＝新データが要るので W4。
- **`#ranking` 画面への価格指標追加**（本 wave は非接触）。
- **リアルタイム株価**（EOD 日足のみ。intraday は恒久的に非目標）。
- **ETL / データ側の修正**（EA の価格取り残しは §4 で表示側が防御するのみ。ETL 調査は本人レーン）。

## 3. データ定義（4点セット・厳密）

すべて **終値ベース**。`rn` は「その銘柄の日足を日付降順に並べた順位」（rn=1 が最新）。

| キー | 意味 | 定義 | null になる条件 |
|------|------|------|----------------|
| `last` | 最新終値 | close(rn=1) | 履歴 0 件 |
| `date` | その終値の日付 | date(rn=1) | 同上 |
| `c1` | 前日比% | (close1 / close2 − 1) × 100 | close2 が無い/0 |
| `c5` | 5営業日騰落% | (close1 / close6 − 1) × 100 | close6 の close が NULL/0（件数不足は下の「px 省略」で吸収） |
| `vr` | 出来高倍率 | volume1 ÷ avg(volume, rn 2..21) | 平均が 0 / 履歴不足 |
| `dh` | 52週高値からの距離% | (close1 / hi52 − 1) × 100（0=高値更新中・負=下） | hi52 が無い/0 |
| `hi52` / `lo52` | 52週高値・安値 | max/min(close, rn ≤ 252) | 履歴 0 件 |
| `pos52` | 52週レンジ内位置 0–100 | (close1 − lo52) / (hi52 − lo52) × 100、hi52=lo52 なら 50 | 履歴 0 件 |
| `spark` | 直近30日の形 | close(rn ≤ 30) を昇順に並べ、その30点の min–max で **0–100 の整数**へ正規化。全点同値なら全て 50 | 履歴 < 2 |

- **履歴が6営業日未満の銘柄は `px` 自体を省略**（部分的に null を持つ px を作らない）。UI 側は「--」。
- **52週系（`hi52`/`lo52`/`dh`/`pos52`）は、400日窓内の実件数が 60 未満なら null**（30日しか履歴が無い新規上場を「52週高値」と称さない）。`last`/`c1`/`c5`/`vr`/`spark` は出す。現行292銘柄は全て 607件以上なので、この分岐は将来の新規上場のための防御。
- 丸め: `last`/`hi52`/`lo52` は小数2桁、`c1`/`c5`/`dh`/`vr` は小数2桁、`pos52`/`spark` は整数。
- **出来高倍率の分母は「当日を除く」直近20営業日**（当日を含めるとスパイク当日に自己希釈する）。

## 4. 鮮度ポリシー（実測に基づく必須要件）

実測（2026-08-23 時点の DB）:
- 米国株 **184銘柄 = 2026-08-21**、日本株 **107銘柄 = 2026-08-20**（市場カレンダー／ETL 実行時刻の差＝正常）
- **EA（Electronic Arts）だけ 2026-08-10 で取り残されている**（1銘柄・原因はデータ側レーン）

したがって「全銘柄で同じ日付」を前提にした設計は成立しない。

- **`list` レスポンスに `market_asof` を追加**：`{"JP": "2026-08-20", "US": "2026-08-21"}`（各市場の `MAX(date)`。市場は `ticker_master.country`、無ければティッカー末尾 `.T` で JP 判定＝`cross-section-rules.js` の `_market()` と同一規約）。
- **stale 判定は純関数**（`PortalPriceRules.isStale(px, marketAsof, market)`）＝ `px.date < marketAsof[market]`。
- **ランキング（案①ストリップ）は stale を除外**。除外が発生した日は見出し脇に「（1銘柄は価格が古いため除外）」と件数を出す（黙って消さない）。
- **表（案②）は stale も表示**し、日付バッジ（例 `08/10`）を付け、数値は dim 表示。
- ストリップ見出しの日付表記は **「日本株 8/20 ／ 米国株 8/21 終値」の2本立て**（1つに丸めない）。
- **鮮度除外の安全弁（2026-08-23 追加・レビュー指摘 R6 起点）**: `market_asof` は市場ごとの MAX 日付なので、ETL が未来日付の行を1本でも混入させるとその市場が丸ごと stale 扱いになり、ストリップが**何も出ない**状態になる（原因が UI から一切見えない最悪の壊れ方）。そこで `rankTop` は **候補の 50% 超が stale なら鮮度除外そのものを停止**し（`staleFilterDisabled: true`）、全件を出したうえで見出しに「価格の日付が揃っていないため、鮮度による除外を一時停止しています」と明示する。検索で1銘柄に絞った結果がその銘柄だけ stale だった場合も同じ経路に入る（「該当なし」より「出して注記」を選ぶ）。

## 5. サーバ（`api/market/list.py` の拡張）

### 5.1 SQL（400日境界が必須）
実測: 日付境界なしの window 関数は **2.8〜3.8秒（コールドで 35秒）** ＝ Vercel の10秒制限に対して危険。`date >= MAX(date) − 400日` を入れると **723〜904ms**（既存2クエリは master 368ms＋financials 192ms）。インデックスは `ohlcv_pkey(ticker,date)` と `idx_ohlcv_ticker_date(ticker,date DESC)` が既存＝追加不要。

```sql
WITH bound AS (SELECT (MAX(date) - INTERVAL '400 days')::date d FROM market.ohlcv),
w AS (SELECT ticker, date, close, volume,
             ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) rn
      FROM market.ohlcv, bound WHERE date >= bound.d),
y AS (SELECT ticker, MAX(close) hi52, MIN(close) lo52 FROM w WHERE rn <= 252 GROUP BY ticker),
v AS (SELECT ticker, AVG(volume)::float avg20   FROM w WHERE rn BETWEEN 2 AND 21 GROUP BY ticker),
s AS (SELECT ticker, array_agg(close ORDER BY date ASC) spark FROM w WHERE rn <= 30 GROUP BY ticker),
p AS (SELECT ticker,
        MAX(CASE WHEN rn=1 THEN close  END) last,
        MAX(CASE WHEN rn=1 THEN date   END) last_date,
        MAX(CASE WHEN rn=1 THEN volume END) last_vol,
        MAX(CASE WHEN rn=2 THEN close  END) prev,
        MAX(CASE WHEN rn=6 THEN close  END) base5
      FROM w WHERE rn <= 6 GROUP BY ticker)
SELECT p.ticker, p.last, p.last_date, p.prev, p.base5, p.last_vol,
       v.avg20, y.hi52, y.lo52, s.spark
FROM p JOIN y USING (ticker) JOIN v USING (ticker) JOIN s USING (ticker)
```

- **400日は「252営業日＋余裕」の暦日換算**。定数として明示（`_PX_BOUND_DAYS = 400`）し、コメントに「252営業日 ≈ 365暦日、休場・データ欠損の余裕を見て 400」と根拠を書く。
- 上場から日が浅い銘柄（400日窓内 6件未満）は `_px_row` が `None` を返す＝ `px` キーごと省略（§3）。SQL は返してよい。

### 5.2 Python 側の整形（純関数として切り出す）
`_px_row(row) -> dict | None` を **DB 非依存の純関数**として切り出し、pytest でテストする（SQL は別レーン）。責務は丸め・正規化・null 規約・履歴不足時の `None` 返却のみ。

### 5.3 劣化（必須）
**価格集計が失敗しても list 本体は返す**：集計クエリを `try/except` で包み、失敗時は `px` 無し＋`market_asof` 空で 200 を返す。理由＝ポータルの一覧（財務表）は px に依存しておらず、価格が取れないだけで**アプリ全体が白画面になるのは退行**。失敗は `px_error` フラグ（真偽のみ）でレスポンスに載せ、UI は「値動きは一時的に取得できません」の1行に留める。

### 5.4 キャッシュ
`Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` は**現状維持**（変更しない）。730ms を踏むのは各リージョンで1時間に1回。

### 5.5 レスポンス形（追加分のみ）
```jsonc
{
  "stocks": { "7203.T": { /* 既存フィールド */,
      "px": { "last": 2841.5, "date": "2026-08-20", "c1": 1.23, "c5": -0.4,
              "vr": 1.12, "dh": -8.7, "hi52": 3112.0, "lo52": 2210.0,
              "pos52": 70, "spark": [12, 18, ... 30個 ...] } } },
  "updated_at": "2026-08-22 06:17",
  "market_asof": { "JP": "2026-08-20", "US": "2026-08-21" },
  "px_error": false
}
```

## 6. 案① 発掘ストリップ

- **位置**: `#portal-container` の直前（レジェンド帯の下・表の上）。PC/モバイル共通。
- **タブ4種**（既定＝値上がり・`localStorage` 永続）:
  | タブ | 並べ替え | カード主指標 | 副指標 |
  |------|----------|--------------|--------|
  | 値上がり | `c1` 降順 | `+8.86%` | 5日 `+129.2%` |
  | 値下がり | `c1` 昇順 | `−5.57%` | 5日 |
  | 出来高急増 | `vr` 降順 | `2.41倍` | 前日比 |
  | 52週高値に接近 | `dh` 降順（0 に近い順） | `高値まで 0.8%` / `高値更新` | 前日比 |
- **上位12件・閾値なし**（実測: 8/21 は `vr ≥ 2.0` がわずか3銘柄・中央値 0.78倍＝閾値方式だと日によって空になる。逆に 52週高値 −3%圏は56銘柄と厚い）。
- **母集合＝表と同じ**（検索・セクターフィルタ・スクリーナー条件をすべて適用した結果）＋ stale 除外。理由＝同一画面の上下で母集合が違うと説明が要る。既定フィルタは「株式のみ」なので、既定状態では実質「全株式から発掘」になる。母集合が12件未満なら全件。
  - ⚠ **モックとの差分**: モックは常に全ユニバースから出している（フィルタ非連動）。spec ではフィルタ連動が正。
- **カード**: ティッカー／社名（1行省略）／30日スパークライン（136×30・騰落色）／主指標（17px 太字）／終値／副指標。横スクロール（scroll-snap）。クリックで詳細へ（既存 `navigateToDetail` ＋ 遷移中フィードバックは表の行と同等）。
- **空表示**: 0件なら「該当する銘柄がありません」。`px_error` 時は「値動きは一時的に取得できません」。
- **免責1行**（12px・テーマA の文字床遵守）: 「終値ベースの事実の並べ替えです（推奨・売買判断ではありません）。出来高倍率＝当日出来高 ÷ 直近20営業日平均。」

## 7. 案② 値動きモード

- **トグル**: ストリップの直下・表の直上に `[財務] [値動き]`（セグメント）。既定は **財務**（初訪の体験を変えない。⚠ モックは比較しやすさのため値動きを既定にしている＝差分）。`localStorage` に永続（キー `sip_portal_table_mode`）。URL には載せない。
- **値動きモードの表は「1枚表」**: 現行は industry が変わるたびに `_makePortalSection` でセクションを作るため、前日比でソートすると業種ブロックが細切れになる。したがって値動きモードでは**業種セクション見出しを出さず、全銘柄を1つの表**に流す（横断ソートが目的）。財務モードは現行のまま（業種セクション維持）。
- **列**:
  - wide（≥761px・8列）: コード / 企業名 / 終値 / 前日比 / 5日 / 出来高倍率 / 52週レンジ / 30日
  - narrow（≤760px・4列）: 銘柄（社名＋コード2段） / 終値 / 前日比 / 30日
- **既定ソート**: 値動きモードに入った時、ソートキーが財務系なら **`c1` 降順**に切り替える。財務モードに戻す時、ソートキーが価格系なら **`ticker` 昇順**（現行既定）に戻す。
- **並べ替え**: 既存 `setSort` をそのまま使う（`filterAndRenderPortal` の `item` に価格フィールドを載せる＝§9）。**価格キーを `NULL_LAST_KEYS` に追加**し、px 無し銘柄が昇順時に上位へ来ないようにする。
- **52週レンジ列**: 目盛バー（位置＝`pos52`）＋その下に「高値まで x.x%」。
- **stale 行**: 日付バッジ（`08/10`）＋数値 dim（§4）。
- **窓化**: 既存の `PORTAL_CHUNK` / IntersectionObserver 窓化をそのまま使う（1枚表でも同じ経路）。

## 8. 列の出し分け（既存 CSS の地雷・実際に踏んだ）

`index.html` のレスポンシブは **`.portal-table td:nth-child(N)` で列を消している**（≤1024px: 4,9,10／≤768px: 3,5,7／≤480px: 1／≤375px: first-child）。これは**列構成が固定であることを前提にした実装**で、列を差し替えると別の列が消える。モックで実際に踏み、390px で「終値だけが残る」状態になった。

**本 wave の方針**:
- 値動き表は **`.portal-px-table`（`.portal-table` を付けない）**独立クラスにする。既存の nth-child ルールは財務表だけに効き続ける＝**財務表の回帰リスクはゼロ**。
- 値動き表自身の narrow 対応は **列セットを差し替える方式**（`priceColumns(isNarrow)`）＝ nth-child に依存しない。幅の閾値（760px）をまたいだら再描画する。
- 既存財務表を data-col 方式へ直す作業は**本 wave では行わない**（次 wave 送り・§13）。

## 9. 純関数レイヤ `portal-price-rules.js`（新規・UMD）

前 wave で確立した「**描画判断を rules 層の純関数に出し、描画・node テスト・受入が同一実装を参照する**」（`srLabelPlan` の plan パターン）を踏襲する。

公開 API（`window.PortalPriceRules`）:
| 関数 | 責務 |
|------|------|
| `isStale(px, marketAsof, market)` | 鮮度判定（§4） |
| `marketOf(ticker, raw)` | JP/US 判定（`cross-section-rules.js` と同一規約） |
| `rankTop(items, tabKey, n)` | タブ別の並べ替え＋上位N＋null/stale 除外＋**同値は ticker 昇順で安定化** |
| `priceColumns(isNarrow)` | 列定義（key/label/幅/ソート可否）を返す＝描画・テスト・受入の単一源 |
| `sparkGeometry(spark, w, h)` | polyline の points 文字列と面 path（幾何の正規化のみ） |
| `fmtSigned(v, digits, unit)` / `fmtVolRatio(vr)` / `fmtDistHigh(dh)` | 表示整形（`--` 規約を含む） |
| `PRICE_KEYS` | 価格系ソートキーの集合（モード切替のキー整合と `NULL_LAST_KEYS` 追加に使う） |

- **DOM 非依存**（`money-rules.js` / `detail-rules.js` / `screener-rules.js` と同型）。
- **JS↔Py の鏡像は発生しない**：数値計算はサーバ（`list.py`）側だけで、JS 側は表示整形と並べ替えのみ。司令室のような二重実装パリティ義務を持ち込まない（これは意図的な設計選択＝§14 D9）。

## 9.1 実装の配置（新規ファイルと結線）

| 追加物 | 置き場所 | 理由 |
|--------|----------|------|
| `portal-price-rules.js` | リポ直下（`screener-rules.js` と同階層）・`index.html` の `<script src="screener-rules.js">` の直後に読み込む | 既存 rules 層と同じ規約（UMD・zero-config 配信で `vercel.json` 変更不要） |
| ストリップ／値動き表の CSS | `index.html` の inline `<style>`（ポータル系スタイルの現住所） | portal のスタイルは全て inline にある。新 CSS ファイルを作ると2箇所管理になる（`detail.css`/`money.css` はビュー単位の既存分割＝踏襲しない理由がある） |
| ストリップ／値動き表の描画コード | `index.html` の既存 IIFE 内（`filterAndRenderPortal` / `_makePortalSection` / `_makePortalRow` の近傍） | 既存のポータル描画と同じ閉じたスコープに置く。公開が要るハンドラだけ末尾の `Object.assign(window, {...})` に追加する |
| `tests/portal-price-rules.test.js` | `tests/` | 既存 node --test 群と同じ |

## 10. 規制・文言（既存方針の踏襲）

- 中立語のみ：「値上がり／値下がり／出来高急増／52週高値に接近」。**推奨・買い時・狙い目・注目 等は使わない**。
- 免責1行を各面（ストリップ・値動き表）に置く（既存 `#rk-disclaimer` と同トーン・12px）。
- 本 wave は **public 市場データの事実提示のみ**＝ personal gate（`ADVICE_MODE`）は不要。個人資産データには一切触れない。

## 11. 性能・転送量（実測と受入閾値）

| 項目 | 実測（2026-08-23） | 受入閾値 |
|------|--------------------|----------|
| 集計 SQL（400日境界） | 723–904ms | 単体 < 1.5s |
| 既存2クエリ | 368ms + 192ms | — |
| list 全体（想定） | ≈ 1.3s（キャッシュミス時のみ） | < 3.0s |
| payload: 現行 | 196.9KB raw / **35.1KB gzip** | — |
| payload: 集計4点 | 35.3KB raw / **+8.8KB gzip** | — |
| payload: spark30 | 27.7KB raw / **+10.7KB gzip** | — |
| payload: 合計 | 259.6KB raw / **54.6KB gzip**（本番と同じ直列化＝`ensure_ascii=False` のみでは **59.1KB**） | **≤ 75KB gzip**（回帰テストで assert・2026-08-23 に 60KB から改訂＝60 は実測前に置いた仮の値で、実測 59.1KB に対して余裕が 1.5% しかなかった） |

参考（不採用案）: spark20 = +7.8KB、spark10（3日間引き）= +4.7KB。

## 12. 検証計画

1. **node 単体**（新規 `tests/portal-price-rules.test.js`）: `rankTop` の同値安定性／null 除外／stale 除外／`isStale` の境界（同日=false・翌日=true）／`priceColumns` の wide/narrow／`sparkGeometry` の平坦データ（全点同値→水平線）／`fmt*` の `--` 規約。**既存 357 pass を維持**。
2. **pytest**（`list.py` の `_px_row` 純関数）: 履歴不足→None／分母0→null／`pos52` の hi=lo→50／spark 正規化の端点（0 と 100 が必ず出る）／丸め桁。**既存 228 pass を維持**。
3. **playwright 構造スモーク**（`scratchpad/w1-smoke.js` を本実装向けに改訂）: PC 1440 / 390px × 財務/値動き × ストリップ表示 で、①ストリップのカード12枚 ②値動き表が1枚 ③390px で4列 ④横スクロールが出ない ⑤`pageerror` 0 ⑥stale 銘柄にバッジ。
4. **payload 回帰**: list レスポンスの gzip サイズを測って 60KB 超で fail（`scratchpad/w1-payload-check.py`）。
5. **本人 実機サニティ**（headless では判定不能・GPU/実描画）:
   - スパークラインのグロー／騰落色が実機で識別できるか（緑 `#00e676` / 赤 `#ff5c7a`）
   - 390px でカード横スクロールの指の掛かり・タップ目標44px
   - 値動きモードのソート往復（前日比→出来高倍率→財務モードへ戻す）で表示が崩れないか
   - stale バッジ（EA）が「古い」と読めるか
   - 詳細遷移の待機フィードバック（カード／行の両方）

## 13. リスク・申し送り

| # | リスク | 扱い |
|---|--------|------|
| R1 | Neon のコンピュート休止明けは初回クエリが極端に遅い（実測35秒） | 本 wave では **CDN キャッシュ＋劣化(§5.3)** で吸収。恒常的に遅いなら `market.price_summary` の ETL 事前計算へ移す（後戻り可能・確定事項3） |
| R2 | `.portal-table` の nth-child 列制御が残る | 本 wave は独立クラスで回避。**次 wave で data-col 方式へ置換**（財務表の回帰テストとセットで） |
| R3 | EA のような価格取り残し銘柄が増える | 表示側は §4 で防御済み。**ETL 側の調査は本人レーン**（表示修正と混ぜない） |
| R4 | 1枚表でソートすると業種の文脈が消える | 意図的（発掘＝横断が目的）。業種の文脈は財務モードと次 wave のヒートマップが担う |
| R5 | 出来高倍率は event 翌日以降に自己希釈する（分母に spike が入る） | 既知の性質として受容（20日平均の標準的な定義）。注記は付けない（過剰説明） |

## 14. 主要決定の記録

| ID | 決定 | 理由 |
|----|------|------|
| D1 | 配置＝案①ストリップ＋案②値動きモード。案③ヒートマップは次 wave | モック実物比較で本人決定（2026-08-23） |
| D2 | 発掘4点セットのみ（YTD/MA乖離/RSI を入れない） | 軸の重複を避ける・payload と初見の迷いを抑える |
| D3 | 集計は list.py で毎回（ETL 事前計算は不採用） | 可動部ゼロ・後戻り可能。CDN で 1時間に1回しか踏まない |
| D4 | SQL に 400日境界を必須化 | 無制限だと 2.8–3.8s（コールド35s）＝10秒制限に対して危険。境界ありで 730ms |
| D5 | 鮮度は「自市場の最新日」基準・ランキングは stale 除外／表はバッジ | JP 8/20・US 8/21・EA 8/10 の実測。古い値を「今日の値上がり」として見せない |
| D6 | spark は30点・0–100 の正規化整数 | 形の可読性が最良（+10.7KB gzip）。値のツールチップは持たない＝整数化で十分 |
| D7 | ストリップは常時表示・母集合は表と同じ（フィルタ連動） | 「開いた瞬間に今日の動き」を失わない／上下で母集合が違う説明を作らない |
| D8 | 値動き表は独立クラス `.portal-px-table` | 既存 nth-child 列制御に触れず財務表の回帰をゼロにする |
| D9 | 計算はサーバのみ・JS は表示整形のみ（鏡像を作らない） | 司令室のような JS↔Py パリティ義務を新設しない |
| D10 | 価格集計が落ちても list は 200 で返す（劣化） | 価格が無いだけで一覧全体を失うのは退行 |
| D11 | 「条件保存」は実装済みにつきスコープ外 | recon で現物確認 |

## 15. 再開の合図

「**investment の W1（ポータル一目パック）＝ spec 承認済み・plan から**」／モック実物は `.venv/bin/python scratchpad/w1-mock-server.py` → http://127.0.0.1:8210/ （右下バーで案切替）。

## 16. 実装差分メモ（Task 5・2026-08-23）

Task 1〜4 は plan のコードをそのまま実装済み（コミット履歴: `dba2636` list.py、`8ed1b04` portal-price-rules.js、`7cb2ec6` 発掘ストリップ、`0ece1ce` 値動きモード）。Task 5（本タスク）で見つかった、plan の記述と実行環境の現物との差分は以下の3点。**コード側の設計変更は無し**（すべて検証環境・実測値の差分）。

- **pytest 件数**: plan は `tests/test_market_list_px.py` を「9 tests」と書いているが、Step 1 に貼られたコード自体が定義するテスト関数は8個（`test_px_row_basic` 〜 `test_market_asof_takes_max_date_per_market`）。実行結果も一貫して8。既存228 + 新規8 = **236 passed**（plan記載の「237」ではなく236が正）。node側は既存357 + 新規11（portal-price-rules.test.js）= **368 passed**（plan通り）。
- **payload 実測値の再測定**: 2026-08-23 のこのセッションでの実測は `fetch_list: 3052ms（2回目）  gzip=57.7KB  px=292/292  asof={'US': '2026-08-21', 'JP': '2026-08-20'}  px_error=False`。§11 表の「723–904ms／54.6KB」より遅く・大きい（Neon 側のレイテンシ変動と考えられる）が、**当時の受入閾値（<3.0s・≤60KB gzip）を満たしているとしていたが、これは本番と異なる直列化（`separators=(",", ":")`）で測った値だった**（後述の追補で訂正）。
- **`.env` / `.venv` は worktree に無かった**: git 管理外のため worktree チェックアウトには含まれず、`.venv` も未作成だった。読み取り専用で main チェックアウトの `.env` を worktree にコピーし、`uv venv` + `uv pip install -r requirements.txt pytest openpyxl`（`scripts/requirements.txt` にある openpyxl はテスト実行に必要）でセットアップした。**root `requirements.txt` 自体は変更していない**（Global Constraints 遵守）。
- **`.claude/CLAUDE.md`（Step 6）は本タスクでは未実施**: このファイルは git 管理外かつ物理的に main チェックアウト配下 `/home/shugo/apps/investment-portal/.claude/CLAUDE.md` にのみ存在し、worktree からは `git add` できない（worktree に `.claude/` 自体が存在しない）。本タスクの絶対規則「main のチェックアウトは絶対に触らない」を優先し、直接編集を見送った。plan Step 6 で追記予定だった「ポータル価格レイヤー（W1）」の恒久運用注意ブロックの原文はそのまま plan 本文（Task 5 Step 6）に残っているので、**統合（main merge）を行うセッションが `.claude/CLAUDE.md` へ追記する**こと。

## 17. 追補（統合セッション・2026-08-23）

Task 5 完了後に統合セッション側で行った修正と決定。

- **`.claude/CLAUDE.md` は追記済み**（§16 の申し送りを実施）。worktree からは触れないファイルなので main チェックアウトの実体に直接追記した（git 管理外＝merge 不要）。追記内容＝400日境界の必須性／`.portal-table` の nth-child 依存／sticky と `overflow:hidden`／銘柄ごとに最終終値日が違うこと／`px_error` の劣化契約／playwright `page.click()` のスクロール副作用／受入スクリプト群。
- **payload 上限を 60KB → 75KB に改訂**（本人決定）。本番と同じ直列化での実測は **59.1KB** で、60KB では余裕が 1.5% しかなく銘柄を数本足すだけでゲートが赤になる。60KB は実測前に置いた仮の値であり、見た目（spark 30点）を削ってまで守る数字ではないと判断した。
- **sticky 列ヘッダの実効化**（`ac7eaf8`）: `table.portal-px-table` の `overflow: hidden` を除去。table 自身がスクロールコンテナになり `position: sticky` の th が「表の中で固定」になっていた（実測 `th.top = -738` → 修正後 `0`）。角丸2pxのクリップより sticky を優先。
- **免責文の逐語重複を解消**（`ac7eaf8`）: ストリップと値動き表で同一文が上下100px に二度出ていた（前 wave D2「説明二重」と同じ悪さ）。表側の文面を「表の数値は各銘柄の最新終値ベースです（推奨・売買判断ではありません）。」に分離し、§10 の「各面に免責」は維持したまま重複感を消した。
- **鮮度除外の安全弁を追加**（§4 に反映・node テスト2本追加）。
- **エッジ経路の受入スクリプトを追加**: `scratchpad/w1-edge-check.js`（stale の見え方／`px_error` 劣化／タブ切替の非再構築／sticky の4経路・常設スモークでは通らない）。
- **検証で判明した測定器の罠**: playwright の `page.click()` は要素を画面内へスクロールしてから押すため、画面上部の要素では scrollY が必ず 0 になる。「タブ切替でスクロール位置が保持されるか」を `page.click()` で測ると**偽陽性の失敗**が出る（実際に踏んだ）。`page.evaluate(() => el.click())` を使う。
- **申し送り（次 wave）**: レビュー Low 15件のうち未対応＝①52週レンジのマーカーがバー枠から上下にはみ出して下の文字にかぶる ②ソート不可の「30日」列ヘッダに `cursor: pointer` が当たる ③`sparkGeometry` の `area` は未使用（先頭点が二重に打たれている死コード）④`_portalWasNarrow` の初期値 null で閾値をまたがない最初の resize でも1回再描画 ⑤`_px_row` の `dh` は hi52=0 のとき spec の null でなく 0.0（「高値更新」表示）。いずれも実害は軽微。
