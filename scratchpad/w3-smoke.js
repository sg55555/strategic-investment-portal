// scratchpad/w3-smoke.js — W3 司令室PFMパック 受入（spec §10.2）。
// 使い方（この1行で1コマンド。モック鯖は自前で起動/停止・W3_VARIANTS=0 で本実装だけを検証）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }
const R = require("../money-rules.js");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8242;
const BASE = "http://127.0.0.1:" + PORT;
const results = [];
function check(name, cond, detail) { results.push({ name, pass: !!cond, detail }); if (!cond) console.log("  ✗ " + name + (detail ? " — " + detail : "")); }

function startServer() {
  return spawn("python3", [path.join(ROOT, "scratchpad", "w3-mock-server.py"), "--port", String(PORT)],
    { stdio: ["ignore", "ignore", "ignore"], env: Object.assign({}, process.env, { W3_VARIANTS: "0" }) });
}
function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on("error", reject);
  });
}
function waitForServer(ms) {
  const dl = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => getJSON("/api/auth/session").then(resolve, () => (Date.now() > dl ? reject(new Error("server not ready")) : setTimeout(tick, 120)));
    tick();
  });
}
// Date を固定（money.js の render() は Date.now() を1回取る＝ここを固定すれば全 VM が同じ月を見る）。
async function fixDate(context, fixedMs) {
  await context.addInitScript((fixed) => {
    const RealDate = Date;
    function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed); }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => fixed; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
  }, fixedMs);
}
// 司令室を開く。index.html は #money の deep-link を window.onload で捨てる（履歴を汚さない方針）ので、
// URL ハッシュではなく MCC.show() で開く（cockpit-e2e.js と同じ入口）。reload 後も毎回これを通す。
async function openMoney(page) {
  await page.evaluate(() => MCC.show());
  await page.waitForSelector("#mcc-root .mcc-hero", { timeout: 15000 });
}
async function newPage(browser, viewport, fixedMs, loggedIn) {
  const context = await browser.newContext({ viewport });
  if (fixedMs) await fixDate(context, fixedMs);
  if (!loggedIn) await context.route("**/api/auth/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"unauthorized"}' }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/?diag=off", { waitUntil: "domcontentloaded" });
  await openMoney(page);
  if (loggedIn) await page.waitForFunction(() => !!document.querySelector("#mcc-sec-cashflow .mcc-cashflow"), null, { timeout: 15000 });
  return { context, page, errors };
}
// fixture 由来の金額の literal（spec §10.2 偽陽性潰し①）。
// w3-mock-server.py の fixture は決定論（LCG seed 20260827／FIRST_YM 2024-03・LAST_YM 2026-08・ANCHOR 2025-09 ¥1,450,000）
// なので金額は毎回同じ。DOM 側と期待値側の両方を money-rules.js から出すと assetSeries の後方累積や total が
// 壊れたときに両側が同時に壊れて緑のままになる＝金額だけは literal で固定し、rules 側／DOM 側の両方をこれに突き合わせる。
// fixture を意図的に変えたときだけ、この値も更新する（勝手に合わせない）。
const LIT = {
  total1Y: "¥3,250,000",   // 1Y 窓の最新点（2026-08・当月/暫定）の総資産
  cash1Y: "¥2,650,000",    // 同・現金
  invest1Y: "¥600,000",    // 同・投資（現在値で固定）
  mom: "¥110,000",         // 前月比（2026-06 → 2026-07）の絶対値
  span12: "¥1,205,000",    // 直近12ヶ月（2025-07 → 2026-07）の絶対値
};
const PC = { width: 1440, height: 900 }, SP = { width: 390, height: 844 };
const NOW_AUG = Date.UTC(2026, 7, 15, 3), NOW_NOV = Date.UTC(2026, 10, 15, 3), NOW_DEC = Date.UTC(2026, 11, 15, 3);

async function main() {
  const server = startServer();
  let browser;
  try {
    await waitForServer(15000);
    // 期待値は money-rules.js から直接算出（二重実装しない）。fixture は鯖から取る。
    const state = (await getJSON("/api/me/state")).state;
    const rows = (await getJSON("/api/me/cashflow")).cashflow;
    const eff = R.effectiveState(R.migrate(state), rows, [], NOW_AUG);
    const series = R.assetSeries(eff, rows, []);
    const completeN = series.points.filter((p) => p.isComplete).length;
    const win1y = R.seriesWindow(series.points, "1Y");
    const last = win1y[win1y.length - 1];
    const mom = R.momDelta(series.points), span = R.spanDelta(series.points, 12);

    // ---- S0 fixture の金額を literal で固定（rules 側の回帰を DOM と独立に検出する）----
    check("S0 fixture 不変: 1Y 最新点の総資産", R.yen(last.total) === LIT.total1Y, R.yen(last.total));
    check("S0 fixture 不変: 1Y 最新点の現金", R.yen(last.cash) === LIT.cash1Y, R.yen(last.cash));
    check("S0 fixture 不変: 1Y 最新点の投資", R.yen(last.invest) === LIT.invest1Y, R.yen(last.invest));
    check("S0 fixture 不変: 前月比", mom.available && R.yen(Math.abs(mom.delta)) === LIT.mom, R.yen(Math.abs(mom.delta)));
    check("S0 fixture 不変: 直近12ヶ月", span.available && R.yen(Math.abs(span.delta)) === LIT.span12, R.yen(Math.abs(span.delta)));
    browser = await chromium.launch();

    // ---- S1 推移カード（PC・ログイン済）----
    {
      const { context, page, errors } = await newPage(browser, PC, NOW_AUG, true);
      await page.waitForSelector("#mcc-sec-series");
      const info = await page.evaluate(() => ({
        open: document.getElementById("mcc-sec-series").open,
        pressed: document.querySelector(".mcc-series-btn[aria-pressed='true']")?.dataset.period,
        complete: document.querySelectorAll(".mcc-series-pt.complete").length,
        live: document.querySelectorAll(".mcc-series-pt.live").length,
        hits: document.querySelectorAll(".mcc-series-hit").length,
        anchorLine: document.querySelectorAll(".mcc-series-anchor").length,
        anchorLbl: document.querySelectorAll(".mcc-series-anchor-lbl").length,
        cap: document.querySelector(".mcc-series-cap")?.textContent || "",
        digest: document.querySelector("#mcc-sec-series .mcc-fold-dg")?.textContent || "",
        notes: Array.from(document.querySelectorAll(".mcc-series-note")).map((n) => n.textContent).join("|"),
      }));
      check("S1 fold は既定 open", info.open === true);
      check("S1 既定期間は 1Y", info.pressed === "1Y", info.pressed);
      check("S1 1Y の確定点数", info.complete === win1y.filter((p) => p.isComplete).length, info.complete);
      check("S1 暫定点 1", info.live === 1, info.live);
      check("S1 ヒット矩形＝点数", info.hits === win1y.length, info.hits);
      // fixture のアンカー(2025-09)は 1Y 窓の先頭 → 点線のみ・ラベル無し（spec §6 注意1）
      const aIdx = win1y.findIndex((p) => p.isAnchor);
      check("S1 アンカー線（窓内なら1本）", info.anchorLine === (aIdx >= 0 ? 1 : 0), info.anchorLine);
      check("S1 アンカーラベル（先頭なら省略）", info.anchorLbl === (aIdx > 0 ? 1 : 0), info.anchorLbl);
      check("S1 初期キャプション＝最新点", info.cap.indexOf(R.yen(last.total)) >= 0 && info.cap.indexOf("暫定") >= 0, info.cap);
      // DOM 側は literal に突き合わせる（rules 側と同時に壊れても落ちる）。
      check("S1 キャプションの金額（literal）",
        info.cap.indexOf(LIT.total1Y) >= 0 && info.cap.indexOf(LIT.cash1Y) >= 0 && info.cap.indexOf(LIT.invest1Y) >= 0, info.cap);
      check("S1 digest に前月比", info.digest.indexOf(R.yen(Math.abs(mom.delta))) >= 0, info.digest);
      check("S1 digest の前月比（literal）", info.digest.indexOf(LIT.mom) >= 0, info.digest);
      check("S1 digest に直近12ヶ月", !span.available || info.digest.indexOf(R.yen(Math.abs(span.delta))) >= 0, info.digest);
      check("S1 digest の直近12ヶ月（literal）", info.digest.indexOf(LIT.span12) >= 0, info.digest);
      check("S1 注記: 投資分固定", info.notes.indexOf("現在値で固定") >= 0, info.notes);
      check("S1 注記: 逆算は窓内に前点がある時だけ", (info.notes.indexOf("逆算") >= 0) === win1y.some((p) => p.beforeAnchor && !p.isAnchor), info.notes);
      // 期間切替 → 点数と LS
      await page.evaluate(() => document.querySelector(".mcc-series-btn[data-period='6M']").click());
      await page.waitForFunction(() => document.querySelector(".mcc-series-btn[aria-pressed='true']")?.dataset.period === "6M");
      const c6 = await page.evaluate(() => ({ hits: document.querySelectorAll(".mcc-series-hit").length, ls: localStorage.getItem("mcc_series_period"), notes: Array.from(document.querySelectorAll(".mcc-series-note")).map((n) => n.textContent).join("|"), anchor: document.querySelectorAll(".mcc-series-anchor").length }));
      check("S1 6M で6点", c6.hits === 6, c6.hits);
      check("S1 LS に保存", c6.ls === "6M", c6.ls);
      check("S1 6M はアンカー窓外＝線なし・逆算注記なし", c6.anchor === 0 && c6.notes.indexOf("逆算") < 0, c6.notes);
      await page.evaluate(() => document.querySelector(".mcc-series-btn[data-period='ALL']").click());
      await page.waitForFunction(() => document.querySelector(".mcc-series-btn[aria-pressed='true']")?.dataset.period === "ALL");
      const cAll = await page.evaluate(() => ({ hits: document.querySelectorAll(".mcc-series-hit").length, lbl: document.querySelectorAll(".mcc-series-anchor-lbl").length }));
      check("S1 ALL で全点", cAll.hits === series.points.length, cAll.hits);
      check("S1 ALL ではアンカーラベルあり", cAll.lbl === 1, cAll.lbl);
      // リロード後も維持・未知値は 1Y
      await page.reload({ waitUntil: "domcontentloaded" });
      await openMoney(page);
      await page.waitForSelector("#mcc-sec-series .mcc-series-btn[aria-pressed='true']");
      check("S1 リロード後も ALL", (await page.evaluate(() => document.querySelector(".mcc-series-btn[aria-pressed='true']").dataset.period)) === "ALL");
      await page.evaluate(() => localStorage.setItem("mcc_series_period", "bogus"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await openMoney(page);
      await page.waitForSelector("#mcc-sec-series .mcc-series-btn[aria-pressed='true']");
      check("S1 未知値は 1Y", (await page.evaluate(() => document.querySelector(".mcc-series-btn[aria-pressed='true']").dataset.period)) === "1Y");
      // hover でキャプション
      const hit = await page.$(".mcc-series-hit");
      const capWant = await hit.getAttribute("data-cap");
      await hit.hover();
      const capGot = await page.evaluate(() => document.querySelector(".mcc-series-cap").textContent);
      check("S1 hover でキャプション差替", capGot === capWant, capGot);
      check("S1 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
    }
    // ---- S2 390px・タップ ----
    {
      const { context, page, errors } = await newPage(browser, SP, NOW_AUG, true);
      await page.waitForSelector("#mcc-sec-series svg.mcc-series-svg");
      const w = await page.evaluate(() => ({ view: document.getElementById("money-view").scrollWidth, svg: document.querySelector(".mcc-series-svg").getBoundingClientRect().width }));
      check("S2 横あふれなし", w.view <= 390, String(w.view));
      check("S2 SVG 幅追従", w.svg > 200 && w.svg <= 390, String(w.svg));
      const hits = await page.$$(".mcc-series-hit");
      const want = await hits[2].getAttribute("data-cap");
      await hits[2].dispatchEvent("touchstart");
      check("S2 tap でキャプション差替", (await page.evaluate(() => document.querySelector(".mcc-series-cap").textContent)) === want);
      check("S2 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
    }
    // ---- S3 未ログイン ----
    {
      const { context, page, errors } = await newPage(browser, PC, NOW_AUG, false);
      const e = await page.evaluate(() => ({ empty: document.querySelector("#mcc-sec-series .mcc-series-empty")?.textContent || "", svg: document.querySelectorAll(".mcc-series-svg").length }));
      check("S3 未ログインは案内文（ログイン）", e.empty.indexOf("ログイン") >= 0 && e.svg === 0, e.empty);
      check("S3 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
    }
    // ---- S4 ヒーロー（前月比・runway）＋リマインド帯 ----
    {
      const cd = R.cashflowDerived(rows, eff, NOW_AUG);
      const hasSurplusCtx = cd.available && cd.monthlySurplus > 0;
      const mom = R.momDelta(series.points), rw = R.runwayMonths(eff);
      // 8月: NISA は info（帯に出ない）。確保枠の short/overdue だけが帯に出る想定。
      const remAug = R.reminders({ nisa: R.nisaReminder(R.nisaViewModel(eff, cd, NOW_AUG, []), NOW_AUG),
        reserves: cd.reserveAlloc.map((ra) => ({ id: ra.id, label: ra.label, deadline: ra.deadline, allocated: ra.allocated, outlook: R.reserveOutlook(ra, NOW_AUG, hasSurplusCtx) })) });
      const { context, page, errors } = await newPage(browser, PC, NOW_AUG, true);
      const h = await page.evaluate(() => ({
        amount: document.querySelector(".mcc-hero-amount")?.textContent || "",
        momText: document.querySelector(".mcc-hero-mom")?.textContent || "", momCls: document.querySelector(".mcc-hero-mom")?.className || "",
        rwText: document.querySelector(".mcc-hero-runway")?.textContent || "", rwCls: document.querySelector(".mcc-hero-runway")?.className || "",
        rail: Array.from(document.querySelectorAll(".mcc-rail-item")).map((n) => n.className + "|" + n.dataset.key + "|" + n.dataset.id + "|" + n.textContent),
      }));
      check("S4 金額ノードは金額のみ", h.amount.trim() === R.yen(eff.buckets.buffer.amount), h.amount);
      check("S4 前月比バッジの文言", h.momText === "前月比 " + (function () { const v = Math.round(mom.delta); return (v > 0 ? "+" : (v < 0 ? "−" : "±")) + R.yen(Math.abs(v)); })() + (mom.pct === null ? "" : "（" + (mom.sign > 0 ? "+" : (mom.sign < 0 ? "−" : "")) + Math.abs(mom.pct).toFixed(1) + "%）"), h.momText);
      check("S4 前月比バッジの色クラス", h.momCls.indexOf(mom.sign > 0 ? "pos" : (mom.sign < 0 ? "neg" : "flat")) >= 0, h.momCls);
      check("S4 runway チップ", h.rwText === "生活費 " + rw.months.toFixed(1) + "ヶ月分" && h.rwCls.indexOf(rw.low ? "low" : "ok") >= 0, h.rwText + " " + h.rwCls);
      check("S4 8月の帯の件数＝期待", h.rail.length === remAug.length, JSON.stringify(h.rail));
      remAug.forEach((it, i) => check("S4 帯[" + i + "] key/id/level", (h.rail[i] || "").indexOf(it.level + "|" + it.key + "|" + it.id) >= 0, h.rail[i]));
      if (remAug.some((it) => it.key === "reserve" && it.level === "warn")) {
        const it = remAug.find((x) => x.key === "reserve" && x.level === "warn");
        check("S4 確保枠 short の本文", h.rail.some((t) => t.indexOf(R.yen(it.data.projectedShortfall) + " 不足の見込み") >= 0 && t.indexOf("→ 確保枠") >= 0), JSON.stringify(h.rail));
      }
      // 帯のリンクで fold が開く
      if (h.rail.length) {
        await page.evaluate(() => document.querySelector(".mcc-rail-item .mcc-jump").click());
        await page.waitForTimeout(300);
        check("S4 帯リンクで fold が open", await page.evaluate(() => document.getElementById("mcc-sec-reserves-goals")?.open === true || document.getElementById("mcc-sec-nisa")?.open === true));
      }
      check("S4 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
      // 11月: NISA warn が加わる（urgent→warn 順）
      const cdN = R.cashflowDerived(rows, eff, NOW_NOV);
      const remNov = R.reminders({ nisa: R.nisaReminder(R.nisaViewModel(eff, cdN, NOW_NOV, []), NOW_NOV),
        reserves: cdN.reserveAlloc.map((ra) => ({ id: ra.id, label: ra.label, deadline: ra.deadline, allocated: ra.allocated, outlook: R.reserveOutlook(ra, NOW_NOV, cdN.available && cdN.monthlySurplus > 0) })) });
      const nov = await newPage(browser, PC, NOW_NOV, true);
      const railNov = await nov.page.evaluate(() => Array.from(document.querySelectorAll(".mcc-rail-item")).map((n) => n.className + "|" + n.dataset.key + "|" + n.dataset.id + "|" + n.textContent));
      check("S4 11月の帯の件数", railNov.length === remNov.length && remNov.some((it) => it.key === "nisa"), JSON.stringify(railNov));
      remNov.forEach((it, i) => check("S4 11月 帯[" + i + "] 順序", (railNov[i] || "").indexOf(it.level + "|" + it.key + "|" + it.id) >= 0, railNov[i]));
      const nisaIt = remNov.find((it) => it.key === "nisa");
      if (nisaIt) check("S4 NISA warn の本文", railNov.some((t) => t.indexOf(R.yen(nisaIt.data.remainingTotal) + " 残っています") >= 0 && t.indexOf("翌年に繰り越せません") >= 0 && t.indexOf("→ NISA") >= 0), JSON.stringify(railNov));
      check("S4 11月 pageerror 0", nov.errors.length === 0, nov.errors.join(" / "));
      await nov.context.close();
      // 12月: urgent
      const dec = await newPage(browser, PC, NOW_DEC, true);
      const railDec = await dec.page.evaluate(() => Array.from(document.querySelectorAll(".mcc-rail-item")).map((n) => n.className + "|" + n.textContent));
      check("S4 12月は NISA urgent", railDec.some((t) => t.indexOf("urgent") >= 0 && t.indexOf("今月が最後") >= 0), JSON.stringify(railDec));
      check("S4 12月 pageerror 0", dec.errors.length === 0, dec.errors.join(" / "));
      await dec.context.close();
      // 390px: ゲージ行が折り返して溢れない
      const sp = await newPage(browser, SP, NOW_AUG, true);
      const ov = await sp.page.evaluate(() => ({ view: document.getElementById("money-view").scrollWidth, row: document.querySelector(".mcc-hero-gauge-row").scrollWidth, rowW: document.querySelector(".mcc-hero-gauge-row").clientWidth }));
      check("S4 390px 横あふれなし", ov.view <= 390 && ov.row <= ov.rowW + 1, JSON.stringify(ov));
      await sp.context.close();
    }
    // ---- 後続 Task がここにシナリオを追加（S5 fold 内の行）----
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.pass);
  console.log(results.length - failed.length + "/" + results.length + " asserts passed");
  console.log(failed.length ? "FAIL" : "ALL PASS");
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
