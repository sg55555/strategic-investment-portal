/* W2「詳細の時間軸パック」受入。
 *
 *   1) W2_INJECT=0 python3 scratchpad/w2-mock-server.py     # :8220（比較ハーネスを注入しない）
 *   2) NODE_PATH=/home/shugo/node_modules node scratchpad/w2-smoke.js
 *
 * ⚠ 合成データのモック鯖（mock_prod_server.py・600本）ではなく **本番 API のプロキシ**を使う。
 *   合成 600 本では 5Y と MAX が同じ窓になり「切り替わっていないのに緑」になるため。
 */
const { chromium } = require("playwright");

const BASE = process.env.W2_BASE || "http://127.0.0.1:8220";
const fail = [];
function check(cond, label) {
  console.log((cond ? "  ✅ " : "  ❌ ") + label);
  if (!cond) fail.push(label);
}

async function open(page, ticker, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForFunction(() => typeof STOCK_DATA !== "undefined" && Object.keys(STOCK_DATA).length > 0, { timeout: 30000 });
  await page.evaluate((t) => window.navigateToDetail(t), ticker);
  await page.waitForSelector("#chart-container canvas", { timeout: 30000 });
  await page.waitForTimeout(1200);
}
const clickPeriod = (page, k) =>
  page.evaluate((x) => document.querySelector(`#w2-period-box .w2-p[data-p="${x}"]`).click(), k);
const range = (page) =>
  page.evaluate(() => { const r = window.DetailCharts.getPriceVisibleRange(); return r ? Math.round(r.to - r.from) : null; });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // モック鯖が配信しない _vercel/insights の 404 だけを無視する（AND 条件。旧版は OR で
    // "Failed to load resource" を含む別の 404＝新しい JS/CSS 参照の typo 等まで無条件に握り潰していた）。
    // ⚠ 対象 URL は m.text() には入らず m.location().url にしか出ない（実測で確認済み。
    //   Chromium の "Failed to load resource" ログは本文に URL を含まない）。
    const url = (m.location() && m.location().url) || "";
    if (url.includes("_vercel/insights") && m.text().includes("Failed to load resource")) return;
    errors.push("console: " + m.text());
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // ブリーフ原文はここで即 reload していたが、直前の goto が投げた window.onload の
  // bootData() fetch がまだ in-flight のまま reload すると中断され、旧ドキュメントの
  // console.error("bootData failed", TypeError: Failed to fetch) がこの page に残る。
  // 実装のバグではなく本スクリプトの競合（毎回同じ箇所で決定的に再現・診断で特定済み）。
  // open() と同じ待ち方（STOCK_DATA 充足待ち）を先に挟んで fetch を完了させてから reload する。
  await page.waitForFunction(() => typeof STOCK_DATA !== "undefined" && Object.keys(STOCK_DATA).length > 0, { timeout: 30000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T");

  console.log("=== 期間バー ===");
  const keys = await page.evaluate(() => [...document.querySelectorAll("#w2-period-box .w2-p")].map((b) => b.dataset.p));
  check(keys.join(",") === "FY,1M,3M,6M,YTD,1Y,5Y,MAX", `8個がこの順で並ぶ (${keys.join("/")})`);
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="FY"]').classList.contains("active")),
    "既定は FY（初回・LS 空）");
  // 比較ハーネス（w2-variants.js）が入っていないこと。入っていると期間バーが二重に mount され、
  //  実装ではなくモックを検査してしまう。ハーネスは window.__W2 を必ず生やすのでそれで判定する。
  check(await page.evaluate(() => typeof window.__W2 === "undefined"), "比較ハーネスが注入されていない（W2_INJECT=0）");

  const bars = {};
  for (const k of ["1M", "1Y", "5Y", "MAX"]) { await clickPeriod(page, k); await page.waitForTimeout(800); bars[k] = await range(page); }
  console.log("   可視バー数:", JSON.stringify(bars));
  check(bars["1M"] < bars["1Y"] && bars["1Y"] < bars["5Y"] && bars["5Y"] < bars["MAX"], "1M < 1Y < 5Y < MAX");

  // FINAL-C1: 単調性は 1440px 既定幅の open() でしか走っておらず、この bug（LWC v4.2.3 の
  //  minBarSpacing 既定 0.5px/bar が fitContent() をクランプ）を検知できなかった。390px は
  //  最も踏みやすい（1223本ペインでも 535本しか描かれず 5Y と MAX が完全に同じ画面になる）ため、
  //  同じ検査をここでも回す＝この bug を検知できる唯一のアサート。
  console.log("=== 期間バー（390px・FINAL-C1: minBarSpacing クランプの検知）===");
  await open(page, "7203.T", 390);
  const bars390 = {};
  for (const k of ["1M", "1Y", "5Y", "MAX"]) { await clickPeriod(page, k); await page.waitForTimeout(800); bars390[k] = await range(page); }
  console.log("   可視バー数(390px):", JSON.stringify(bars390));
  check(bars390["1M"] < bars390["1Y"] && bars390["1Y"] < bars390["5Y"] && bars390["5Y"] < bars390["MAX"],
    `390px でも 1M < 1Y < 5Y < MAX（修正前は 5Y=MAX=535 で完全一致していた・${JSON.stringify(bars390)}）`);
  await open(page, "7203.T");   // 以降のセクションを壊さないよう既定幅(1440px)へ戻す

  console.log("=== FY 復帰（last-click-wins）===");
  await clickPeriod(page, "1Y"); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll("#year-controller-box .time-btn")[0].click());
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="FY"]').classList.contains("active")),
    "FY ボタンを押すと期間バーが FY に戻る");

  console.log("=== 永続 ===");
  await clickPeriod(page, "6M"); await page.waitForTimeout(600);
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "6758.T");
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="6M"]').classList.contains("active")),
    "リロード＋別銘柄でも 6M が復元される");
  await page.evaluate(() => { try { localStorage.setItem("sip_detail_period", "9Z"); } catch (e) {} });
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "6758.T");
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="FY"]').classList.contains("active")),
    "未知値を書き込んでも FY へ正規化される");

  console.log("=== 52週レンジ ===");
  await open(page, "7203.T");
  const w52 = await page.evaluate(() => ({
    lo: document.querySelector('[data-w2="lo"]').textContent,
    hi: document.querySelector('[data-w2="hi"]').textContent,
    pos: document.querySelector('[data-w2="pos"]').textContent,
    dist: document.querySelector('[data-w2="dist"]').textContent,
  }));
  check(/^¥[\d,]+$/.test(w52.lo) && /^¥[\d,]+$/.test(w52.hi), `実データで埋まる (${w52.lo} 〜 ${w52.hi} ${w52.pos} ${w52.dist})`);
  const before = JSON.stringify(w52);
  await clickPeriod(page, "1M"); await page.waitForTimeout(700);
  const after = await page.evaluate(() => JSON.stringify({
    lo: document.querySelector('[data-w2="lo"]').textContent, hi: document.querySelector('[data-w2="hi"]').textContent,
    pos: document.querySelector('[data-w2="pos"]').textContent, dist: document.querySelector('[data-w2="dist"]').textContent,
  }));
  check(before === after, "期間を変えても 52週レンジは変わらない（独立）");
  await page.evaluate(() => { STOCK_DATA["7203.T"].px = { last: 1, date: "2026-08-20" }; });
  await open(page, "7203.T");
  check(await page.evaluate(() => getComputedStyle(document.getElementById("w2-52w")).display) === "none",
    "pos52 欠損ならバーごと非表示");

  console.log("=== ベンチマーク ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T");
  await clickPeriod(page, "1Y"); await page.waitForTimeout(600);

  // 着弾ガード（遅延レース）: 1306.T の ohlcv フェッチを意図的に 1.5秒遅延させ、
  // 「ON の直後に OFF」→「遅れて ON 時の fetch が着弾」という、着弾ガードが本来守るべき順序を
  // 確定的に作る（レビュー Critical 1）。⚠ ここでは 1306.T がまだ未キャッシュ（このリロード後
  // 一度もベンチを ON にしていない）であることが重要 = 未キャッシュだからこそ route が実際に
  // 発火する実ネットワーク経路になる。この直後の通常の ON→OFF 連打テスト（下）は 1306.T が
  // キャッシュ済みになるため、2回目以降の ON は数十ms未満でキャッシュヒット即着弾してしまい、
  // このガードが守る「実ネットワーク遅延の後発着弾」を再現できない（実測で確認済み）。
  await page.route("**/api/market/ohlcv?ticker=1306.T", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());   // ON: fetch開始（遅延中・未着弾）
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());   // OFF: 着弾前に即取り消し
  await page.waitForTimeout(2500);   // 遅延させた fetch の着弾を待つ
  await page.unroute("**/api/market/ohlcv?ticker=1306.T");
  const raceActive = await page.evaluate(() => document.getElementById("w2-bench-btn").classList.contains("active"));
  const racePoints = await page.evaluate(() => window.DetailCharts.benchPointCount());
  check(!raceActive, "遅延着弾レース: ON直後にOFFした後で遅れてfetchが着弾してもOFFが残る（ボタン表示）");
  check(racePoints === 0,
    `遅延着弾レース: ON直後にOFFした後で遅れてfetchが着弾してもOFFが残る（チャート実系列 benchPointCount=${racePoints}・線が復活していない）`);

  await page.evaluate(() => document.getElementById("w2-bench-btn").click());
  await page.waitForTimeout(3000);
  check(await page.evaluate(() => document.getElementById("w2-bench-btn").classList.contains("active")), "ベンチ ON（ボタン表示）");
  // ボタンの CSS クラスは paintBenchChip が benchOn を見て毎回同期的に塗り直すだけなので、着弾ガードが
  // 壊れて非同期の setBenchData が後から実データで線を復活させても、ボタン表示だけでは検知できない
  // （レビュー Critical 1・上の遅延レースが本命の検証。ここは通常経路でも同じ形で確認する）。
  check((await page.evaluate(() => window.DetailCharts.benchPointCount())) > 0, "ベンチ ON（チャート実系列に点が乗る）");
  const axis = await page.evaluate(() => {
    const w = DetailRules.rollingWindow(STOCK_DATA[currentTicker].prices, "1Y").displayPrices;
    return { lo: Math.min(...w.map((p) => p.low)) };
  });
  console.log(`   窓内最安値 ${axis.lo}（軸がこの 0.5 倍を下回らないこと）`);
  // 通常のクリック連打（1306.T キャッシュ済み・即着弾）は上の遅延レースほど厳密ではないが、
  // 連打してもクラッシュせず最終状態が OFF に収束する UX 上の健全性チェックとして残す。
  await page.evaluate(() => { document.getElementById("w2-bench-btn").click(); document.getElementById("w2-bench-btn").click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());
  await page.waitForTimeout(3000);
  const offActive = await page.evaluate(() => document.getElementById("w2-bench-btn").classList.contains("active"));
  const offPoints = await page.evaluate(() => window.DetailCharts.benchPointCount());
  check(!offActive, "ON→即OFF を繰り返しても最後の OFF が残る（ボタン表示）");
  check(offPoints === 0,
    `ON→即OFF を繰り返しても最後の OFF が残る（チャート実系列 benchPointCount=${offPoints}・線が復活していない）`);
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());
  await page.waitForTimeout(2500);
  await clickPeriod(page, "MAX"); await page.waitForTimeout(3000);
  check(/（\d{4}年〜）/.test(await page.evaluate(() => document.querySelector('[data-w2="benchLabel"]').textContent)),
    "MAX ではベンチ履歴の開始年がラベルに出る");
  await open(page, "1306.T");
  check(await page.evaluate(() => getComputedStyle(document.getElementById("w2-bench-btn")).display) === "none",
    "ベンチ自身を開くとチップごと非表示");

  console.log("=== 劣化経路 ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T");
  // dataClient.js の getStock は `_mktHydrated` 未登録のティッカーを開くたび必ず本番へ再フェッチして
  // cur.prices を実データで上書きする。reload 直後にこの reload 内で一度も開いていない 6758.T へ
  // いきなり prices=[] を仕込んでも、navigateToDetail 内の getStock がその場で実データに戻してしまい
  // 「実は一度も空データを検査していなかった」空振りになる（実測で確認済み）。同一セッション内で
  // 先に一度実データのまま開いて _mktHydrated に載せてから mutate すれば、以後の getStock は
  // 早期 return で再フェッチをスキップし、mutate が最後まで残る。
  await open(page, "6758.T");   // ハイドレートのためだけの捨て開き（このタイミングで 52週レンジ等は6758の実値に変わる）
  // 7203.T へ戻し、DOM を「6758.T の値ではない既知の状態」に戻してから本番の検証に入る。
  // ここで戻さないと、直前の捨て開きで52週レンジが既に6758の値に書き換わっており、次に6758を
  // 再度開いたときバグで書き換えがスキップされても偶然同じ値のままになり見分けが付かない
  // （実測でこの罠を踏んだ＝最初の実装は空振りだった）。
  await open(page, "7203.T");
  const titleBefore = await page.evaluate(() => document.getElementById("stock-title").textContent);
  // 52週レンジ（解析カード側の代表として）も前銘柄（7203.T）の値を控えておく。applyPriceWindow の
  // 途中に early-return を挟むバグは setCandleData/paint52wBar 等その後ろの呼び出しを一律スキップ
  // するため、「新しいティッカーの px は健全なのに旧ティッカーの表示が残る」形で顕在化する
  // （レビュー Critical 2）。
  const loBefore = await page.evaluate(() => document.querySelector('[data-w2="lo"]').textContent);
  // FINAL-I3: candlePointCount/52週レンジは「新しいティッカーの値が正しく出る」ことしか見ておらず、
  //  detail-charts.js:579 の早期 return が持っていた「ローソク以外まるごと残る」（出来高/MA/BB/KC/VWAP/
  //  S/R/T/R/サブパネル）は検知できなかった。出来高（volPointCount）を代表として、7203.T の実系列
  //  件数を控えておく（0 でないことも前提として確認する＝空振りアサート対策）。
  const volBefore = await page.evaluate(() => window.DetailCharts.volPointCount());
  check(volBefore > 0, `(前提) 7203.T の出来高が実系列に乗っている (volPointCount=${volBefore})`);
  await page.evaluate(() => { STOCK_DATA["6758.T"].prices = []; });
  await open(page, "6758.T");   // 本番の検証対象（6758.T は既にハイドレート済みなので再フェッチされない）
  const titleAfter = await page.evaluate(() => document.getElementById("stock-title").textContent);
  check(titleAfter !== titleBefore && titleAfter.includes("6758.T"),
    `価格ゼロの銘柄でも前銘柄の残像を残さない (タイトル: ${titleAfter.slice(0, 40)})`);
  // タイトルだけでは検知できない残像（レビュー Critical 1 と同型の「表示は変わるが中身は旧のまま」）。
  // ローソク足はチャートの実系列（candlePointCount）、解析カードは 52週レンジの実測値で見る。
  const candleAfter = await page.evaluate(() => window.DetailCharts.candlePointCount());
  check(candleAfter === 0,
    `価格ゼロの銘柄でも前銘柄のローソク足が残らない（candlePointCount=${candleAfter}・空データで setCandleData された証拠）`);
  const loAfter = await page.evaluate(() => document.querySelector('[data-w2="lo"]').textContent);
  check(loAfter !== loBefore,
    `価格ゼロの銘柄でも前銘柄の52週レンジ（解析カード）が残らない (52W lo: ${loBefore} → ${loAfter})`);
  // FINAL-I3 本体の検査: ローソク以外の系列（出来高）も空になったこと。修正前は updateMaAndVolume の
  //  早期 return によりここが volBefore と同じ値のまま残る（実際に注入実験で確認する）。
  const volAfter = await page.evaluate(() => window.DetailCharts.volPointCount());
  check(volAfter === 0,
    `価格ゼロの銘柄でも前銘柄の出来高（ローソク以外の系列の代表）が残らない（volPointCount=${volBefore}→${volAfter}）`);

  console.log("=== レスポンシブ ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T", 390);
  const resp = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    minFont: Math.min(...[...document.querySelectorAll(".w2-rail *")].map((e) => parseFloat(getComputedStyle(e).fontSize)).filter(Boolean)),
  }));
  check(resp.overflow <= 1, `390px で横はみ出しなし (${resp.overflow}px)`);
  // Math.min(...[]) は Infinity を返す＝.w2-rail 配下に要素が1つも無くても >=12 が真になり緑のまま通ってしまう
  // （空集合の空振りアサート）。Number.isFinite で「実際に何か測れたか」を先に確認する。
  check(Number.isFinite(resp.minFont) && resp.minFont >= 12, `390px でも文字床 12px を守る (${resp.minFont}px)`);

  check(errors.length === 0, `pageerror ゼロ (${errors.length})`);
  if (errors.length) console.log("   " + errors.slice(0, 5).join("\n   "));

  await browser.close();
  console.log(fail.length ? `\n❌ FAIL ${fail.length}件\n - ` + fail.join("\n - ") : "\n✅ ALL PASS");
  process.exit(fail.length ? 1 : 0);
})();
