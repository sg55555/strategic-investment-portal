---
date: 2026-06-30
type: audit
target: index.html (ポータル/詳細/チャート部・約4247行)
method: ultracode workflow `portal-audit` (run wlvfbe21d) — 7次元並列監査→統合
project: investment-portal
related: [[wealth-cockpit-v2]]
---

# ポータル(index.html) コード監査 — 2026-06-30

7次元（architecture / dead-duplication / consistency-quality / gaps-completeness / bugs-correctness / security / performance）で並列監査し統合。

## 総評
動作しており本番LIVE。だが**姉妹モジュール（money-rules.js＝業務mathを純関数化し node --test 23緑／money.js＝IIFE(window.MCC) 隔離＋esc() XSS防御）が確立した規律が、ポータル側には一つも適用されていない**。

最大の弱点：
1. 財務計算（ROE/自己資本比率/流動比率/営業利益率/総資産）が portal/detail/各チャートに **3〜4回 inline 複製**・テスト皆無。
2. 単一スコープに **約40の可変 bare-global**・中央ルーター不在（`.active` 手動トグル）。
3. 失敗系がほぼ無処理＋**財務データの誤表示（捏造値/誤単位）**。

クラッシュ級は少なく堅い面もある（/list が financials_trend を必ず `{}` で返すため安全、await取りこぼし無し、subscribe リーク回避ガード有り）。**強み**＝CSS は 232 `var(--ix-*)` でほぼ完全トークン化・theme D適用済・チャートインスタンスのリーク回避は概ね達成。

総じて「**動くが土台未整備**」。銘柄・指標・ビューを足すほどコピペ・グローバル・トグルが線形〜超線形に増える＝複利負債が蓄積中。**機能拡張の直前である今が土台投入の最適点。**

## Critical / High（bug・security）
| # | 内容 | sev | 工数 | 場所 |
|---|---|---|---|---|
| C1 | **ETF詳細でローソク足が描画されず前銘柄の足/財務が残存**。`updateFinancialViews` の `if(!fin) return`(3458-3459) が `candleSeries.setData`(3497) より前。ETFは financials_trend `{}` → return し価格チャート未更新 | high | M | 3458-3459,3497 / navigateToDetail 3403-3414 |
| C2 | **取得失敗が「該当企業が見つかりません」の誤空状態＝読込失敗とフィルタ0件が区別不能**。loading/error/retry UI 皆無 | high | M | 2385,2506 / dataClient bootData 38-45 |
| C3 | **検索/スクリーニングが未デバウンス**＝毎キーで全DOM再構築＋約84スパークライン破棄/再生成→Chart.js `Canvas is already in use` 例外の恐れ | high | S | 1669,1681-1710 / filterAndRenderPortal 2401-2653 |
| C4 | **財務データの捏造値・誤単位**：(a)CF期首現金 `\|\|6524000`(4115)＝特定企業のマジック定数を欠損銘柄全てに適用 (b)Y軸「兆円」固定(3790/4031/4236)＝USストックで軸と単位が矛盾 (c)売上総利益 `\|\|sales*0.2`(3911)・経常/税前を営業利益で塗り潰し | high | M | 4115-4135,3790/4031/4236,3911-3913 |
| C5 | **CDNスクリプト版未固定＋SRI不在**（chart.js は latest 解決）。認証Cookie・同期データを扱う money.js と同居＝サプライチェーン侵害で奪取経路 | medium | S | 40-42 |
| C6 | **サーバ由来データを未エスケープで innerHTML＋onclick属性内に注入**（money.js の esc() と非対称）。社名にクォートでハンドラ破損する構造バグも | medium | M | 2270,2296,2520,2606-2631,3469-3475 |

## Foundation（機能追加の前に直すべき土台）
| # | 内容 | sev | 工数 |
|---|---|---|---|
| F1 | **財務計算ロジックの純関数分離**（3〜4回の inline 複製を calcRoe/calcEquityRatio 等に集約＋node --test）。巨大関数 updateFinancialViews(~140行)/filterAndRenderPortal(~250行)の分割も同根 | medium | L |
| F2 | **IIFE隔離＋状態オブジェクト集約**（~40 bare-global・dataClient.js との暗黙 global 契約を window.MarketData 等へ） | medium | M |
| F3 | **中央ビュールーター**（showView(name)＋currentView＋location.hash でディープリンク/戻る対応・3箇所の手動 .active トグル解消） | medium | M |
| F4 | **退役 data.js/data-bundle.js 計約42MB を削除＋.vercelignore 追記**（data.js 完全未参照・data-bundle.js は REMOTE_ENABLED=true で到達不能）＋REMOTE_ENABLED を env/フラグ化 | low | S |
| F5 | **色のJS単一ソース化**（CSS は 232 トークン済だが JS は raw hex 157＋rgba 21・トークン参照0）。起動時 getComputedStyle で `--ix-*` を JS パレットへ。※ローソク確定色/canvasデータ意味色は不変 | medium | M |
| F6 | **死蔵フリーミアム足場の決着**（checkPremiumAccess no-op・isPremium 未参照・上限値が二重定義）。削除して意図明確化＋有効化は法務レビュー後にサーバ側認可 | low | S |

## Polish（機能が固まってから）
- P1 アクセシビリティ全般欠落（ARIA/role/tabindex 0・モーダル非アクセシブル・キーボード不可）※公開拡大予定なら前倒し
- P2 3点スパークラインに重量級 Chart.js を約84インスタンス（素 Canvas/SVG へ）
- P3 通貨/単位・閾値・銘柄特例（9984.T 直書き）の inline 散在 → ヘルパ/定数表/データ駆動化
- P4 チャートのライフサイクル/リサイズ/例外処理の方針不統一（SR/TR の try/catch 制御フロー・resize 非追従）
- P5 失敗フィードバック/小さな正しさの取りこぼし群（フォーム二重送信・DATA_UPDATED_AT 空欄・ウォッチ件数陳腐化 等）
- P6 デッドコード/重複の小掃除＋無駄計算削減＋絵文字コメント統一
- P7 CSP不在＋イベント束縛方式混在（inline onclick 47/.onclick 5/addEventListener 0）→ delegation＋CSP段階導入

## 推奨着手順序（本人の問い「全機能追加後 vs 先に整える」への答え）
**ハイブリッド＝「土台の一部だけ先に・表層は後で」が最適**。判断基準＝負債が複利化する項目（コピペ財務math・40グローバル・ルーター・財務データ誤表示）は銘柄/指標/ビューを足すほど増えるので**追加前の今が最も安い**。表層（A11y/軽量化/小掃除/CSP）は機能が固まってからで収穫は落ちない。

- **フェーズ0（即・小工数）**：C5 chart.js版固定+SRI、C6 esc()導入、F4 data.js削除+.vercelignore。低リスクで効果。
- **フェーズ1（機能追加の前・土台）**：F1 財務math純関数分離+test、F2 IIFE隔離、F3 showViewルーター＋C4 財務データ整合性（捏造値/兆円/6524000）＋C1 ETF早期return＋C2 失敗UI＋C3 検索デバウンス（いずれもユーザー可視）。
- **フェーズ2**：ティッカー/新指標/新ビューを整った土台に載せる。
- **フェーズ3（機能が固まってから・表層）**：P1〜P7、F5 色トークンJS化（テーマ確定後）、F6 freemium削除。
- 例外＝P1 A11y は公開拡大予定なら前倒し。F6 freemium は課金/ゲート直前に決着＋金商法レビュー（hard precondition）。

## 着手前の裏取り（needsVerification）
1. api/market/list.py に updated_at が含まれるか（P5 の前提）
2. ETF が実際に financials_trend={} で返り早期return に至るか（C1）
3. cf_cash_start/gross_profit/operating_income 等が null になる銘柄が実在するか・欠損分布（C4 実害範囲）
4. data.js 完全未参照か・REMOTE_ENABLED=true 恒久運用か（F4 削除可否）
5. chart.js の本番稼働中メジャー.マイナー（C5 pin先）
6. 色トークンJS化が不可侵リスト（ローソク確定色/canvasデータ意味色/ZigZag逆規約）に触れないこと（F5）
7. 社名にクォートを含む銘柄が現データに存在するか（C6 実発生条件）
8. Canvas二重生成例外が実機高速タイプで再現するか（C3・Playwright）
9. money.js の esc() を index.html へ共有する方法（共通util昇格 or 再実装）
