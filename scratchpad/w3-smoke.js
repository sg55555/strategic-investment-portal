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
// over = { state, cashflow }（任意）。鯖の fixture を触らずに、この文脈だけ API の戻りを差し替える
// （目標の期限切れ/目標額未設定/期限なし・収支なし＝余剰0 の分岐を DOM で踏むため）。
async function newPage(browser, viewport, fixedMs, loggedIn, over) {
  const context = await browser.newContext({ viewport });
  if (fixedMs) await fixDate(context, fixedMs);
  if (!loggedIn) await context.route("**/api/auth/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"unauthorized"}' }));
  if (over && over.state) {
    await context.route("**/api/me/state", (route) => route.fulfill({ status: 200, contentType: "application/json",
      body: route.request().method() === "GET" ? JSON.stringify({ state: over.state }) : '{"ok":true}' }));
  }
  // 未ログインでも「この端末に保存された state」は生きる（localStorage 限定層）＝NISA 設定済みで
  // セッションだけ切れた状態を作るために使う。
  if (over && over.localState) {
    await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} }, [R.STORAGE_KEY, JSON.stringify(over.localState)]);
  }
  if (over && over.cashflow) {
    await context.route("**/api/me/cashflow", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cashflow: over.cashflow }) }));
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/?diag=off", { waitUntil: "domcontentloaded" });
  await openMoney(page);
  // 収支なしの文脈では .mcc-cashflow が出ないので、代わりに（既定 state には無い）目標カードの出現を待つ
  // ＝どちらも「鯖 state が適用済み」の合図。
  if (loggedIn && over && over.cashflow && over.cashflow.length === 0) {
    await page.waitForFunction(() => !!document.querySelector("#mcc-sec-reserves-goals .mcc-goal"), null, { timeout: 15000 });
  } else if (loggedIn) {
    await page.waitForFunction(() => !!document.querySelector("#mcc-sec-cashflow .mcc-cashflow"), null, { timeout: 15000 });
  }
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
        vb: document.querySelector(".mcc-series-svg")?.getAttribute("data-vb"),
      }));
      check("S1 fold は既定 open", info.open === true);
      check("S1 広幅 viewBox", info.vb === "640", info.vb);
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
      // 打切っていない fixture では打切の注記を出さない（S6 の対の偽陽性チェック）。
      check("S1 注記: 打切なしなら打切の注記は出ない", !series.truncatedForward && !series.truncatedBackward && info.notes.indexOf("表示していません") < 0, info.notes);
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
      const w = await page.evaluate(() => ({
        view: document.getElementById("money-view").scrollWidth,
        svg: document.querySelector(".mcc-series-svg").getBoundingClientRect().width,
        vb: document.querySelector(".mcc-series-svg").getAttribute("data-vb"),
        ylblPx: document.querySelector(".mcc-series-ylbl").getScreenCTM().a * 11,
      }));
      check("S2 横あふれなし", w.view <= 390, String(w.view));
      check("S2 SVG 幅追従", w.svg > 200 && w.svg <= 390, String(w.svg));
      check("S2 狭幅 viewBox", w.vb === "360", w.vb);
      check("S2 Y ラベルの実効フォントサイズ 9px 以上", w.ylblPx >= 9, String(Math.round(w.ylblPx * 100) / 100));
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
      // 帯は未ログインでは1件も出さない（spec §8・§10.2 シナリオ7）。確保枠は cashflow 依存で自然に消えるが、NISA は
      // ローカル state だけで成立する＝money.js render() の `nisa: sync.loggedIn ? nrem : null` が唯一の防波堤で、外すと
      // 未ログイン画面に残枠の ¥ が出る。8月は NISA が info（元から帯に出ない）＝ゲートを外しても 0 件のままで空振りするので、
      // **urgent になる 12月** で見る（ログイン時は 12月に urgent が1件出ることを S4 が実証済み＝この 0 件は有意）。
      // ローカル state（NISA 設定済み）を seed する＝未ログインでも nisaReminder は urgent を返す文脈。
      // seed しないと NISA 未設定で level:"none" になり、ゲートを外しても 0 件のまま＝この assert が空振りする。
      const outDec = await newPage(browser, PC, NOW_DEC, false, { localState: state });
      const d = await outDec.page.evaluate(() => ({ rail: document.querySelectorAll(".mcc-rail-item").length, railBox: document.querySelectorAll(".mcc-rail").length,
        nisaSec: document.querySelectorAll("#mcc-sec-nisa").length }));
      check("S3 12月・未ログインでも帯 0 件（NISA の ¥ を出さない）", d.rail === 0 && d.railBox === 0, "item=" + d.rail + " box=" + d.railBox + " nisaSec=" + d.nisaSec);
      check("S3 12月・未ログイン pageerror 0", outDec.errors.length === 0, outDec.errors.join(" / "));
      await outDec.context.close();
    }
    // ---- S4 ヒーロー（前月比・runway）＋リマインド帯 ----
    {
      const cd = R.cashflowDerived(rows, eff, NOW_AUG);
      // 実装（money.js render()）と同じ式にする。monthlySurplus は round(max(0,base))＝base>0 とは別式で、
      // 実装側のゲートを差し替えても受入が赤くならない（整数 fixture では同値のため偽緑になる）。
      const hasSurplusCtx = cd.available && cd.surplusPositive;
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
        railBox: document.querySelectorAll(".mcc-rail").length,
      }));
      check("S4 金額ノードは金額のみ", h.amount.trim() === R.yen(eff.buckets.buffer.amount), h.amount);
      check("S4 前月比バッジの文言", h.momText === "前月比 " + (function () { const v = Math.round(mom.delta); return (v > 0 ? "+" : (v < 0 ? "−" : "±")) + R.yen(Math.abs(v)); })() + (mom.pct === null ? "" : "（" + (mom.sign > 0 ? "+" : (mom.sign < 0 ? "−" : "")) + Math.abs(mom.pct).toFixed(1) + "%）"), h.momText);
      check("S4 前月比バッジの色クラス", h.momCls.indexOf(mom.sign > 0 ? "pos" : (mom.sign < 0 ? "neg" : "flat")) >= 0, h.momCls);
      check("S4 runway チップ", h.rwText === "生活費 " + rw.months.toFixed(1) + "ヶ月分" && h.rwCls.indexOf(rw.low ? "low" : "ok") >= 0, h.rwText + " " + h.rwCls);
      check("S4 8月の帯の件数＝期待", h.rail.length === remAug.length, JSON.stringify(h.rail));
      remAug.forEach((it, i) => check("S4 帯[" + i + "] key/id/level", (h.rail[i] || "").indexOf(it.level + "|" + it.key + "|" + it.id) >= 0, h.rail[i]));
      // 0件なら DOM を作らない（spec §4.4）。8月の fixture は帯 0 件なので、ここが「.mcc-rail 自体が無い」の検証になる。
      // 本文と導線（jumpLink→fold）は帯が 0 件の 8月では検証できない＝下の 11月ブロックで実行する。
      check("S4 8月 帯 0件なら .mcc-rail 自体が無い", h.railBox === (remAug.length ? 1 : 0), h.railBox + " / rem=" + remAug.length);
      check("S4 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
      // 11月: NISA warn が加わる（urgent→warn 順）
      const cdN = R.cashflowDerived(rows, eff, NOW_NOV);
      const remNov = R.reminders({ nisa: R.nisaReminder(R.nisaViewModel(eff, cdN, NOW_NOV, []), NOW_NOV),
        reserves: cdN.reserveAlloc.map((ra) => ({ id: ra.id, label: ra.label, deadline: ra.deadline, allocated: ra.allocated, outlook: R.reserveOutlook(ra, NOW_NOV, cdN.available && cdN.surplusPositive) })) });
      const nov = await newPage(browser, PC, NOW_NOV, true);
      const railNov = await nov.page.evaluate(() => Array.from(document.querySelectorAll(".mcc-rail-item")).map((n) => n.className + "|" + n.dataset.key + "|" + n.dataset.id + "|" + n.textContent));
      check("S4 11月の帯の件数", railNov.length === remNov.length && remNov.some((it) => it.key === "nisa"), JSON.stringify(railNov));
      // 帯の並び（level|key|id）を literal で固定（spec §10.2 偽陽性潰し②）。remNov（期待値）も railNov（DOM）も
      // 同じ money-rules.js（モック鯖が static 配信する同一ファイル）から出るため、動的な remNov と突き合わせるだけでは
      // reminders の rank ロジックが壊れても両側が同時に同じ順序へ壊れて緑のままになる＝ literal で固定して独立に検証する。
      // fixture を意図的に変えたときだけ更新する。
      const LIT_RAIL_NOV = ["warn|nisa|nisa", "warn|reserve|rsv-shaken"];
      LIT_RAIL_NOV.forEach((want, i) => check("S4 11月 帯[" + i + "] 順序（literal）", (railNov[i] || "").indexOf(want) >= 0, railNov[i]));
      const nisaIt = remNov.find((it) => it.key === "nisa");
      if (nisaIt) check("S4 NISA warn の本文", railNov.some((t) => t.indexOf(R.yen(nisaIt.data.remainingTotal) + " 残っています") >= 0 && t.indexOf("翌年に繰り越せません") >= 0 && t.indexOf("→ NISA") >= 0), JSON.stringify(railNov));
      // 確保枠行の本文（11月は NISA warn ＋ 確保枠 short の2件＝ここでしか本文を見られない）。ガードを置かず、
      // 期待側が空になったら落ちるようにする（8月ブロックの条件付き assert が一度も走らなかった再発防止）。
      const rsvNov = remNov.find((x) => x.key === "reserve" && x.level === "warn");
      check("S4 11月 確保枠 short の本文", !!rsvNov && railNov.some((t) => t.indexOf(R.yen(rsvNov.data.projectedShortfall) + " 不足の見込み") >= 0 && t.indexOf("→ 確保枠") >= 0), JSON.stringify(railNov));
      // 帯のリンクで fold が開く（NISA 行・確保枠行の両方）。既定で open だと空振りするので、押す前に必ず閉じる。
      for (const [key, secId, nm] of [["nisa", "mcc-sec-nisa", "NISA"], ["reserve", "mcc-sec-reserves-goals", "確保枠"]]) {
        const clicked = await nov.page.evaluate(([k, s]) => {
          const det = document.getElementById(s); if (det) det.open = false;
          const a = document.querySelector('.mcc-rail-item[data-key="' + k + '"] .mcc-jump');
          if (!a || !det || det.open) return false;
          a.click(); return true;
        }, [key, secId]);
        await nov.page.waitForTimeout(300);
        check("S4 11月 帯[" + nm + "]のリンクで fold が open",
          clicked && (await nov.page.evaluate((s) => document.getElementById(s)?.open === true, secId)), "clicked=" + clicked);
      }
      check("S4 11月 pageerror 0", nov.errors.length === 0, nov.errors.join(" / "));
      await nov.context.close();
      // 混在レベル(urgent+warn)の順序を DOM で実証（spec §10.2 シナリオ5「順序は urgent→warn」）。
      // fixture の 11月 は nisa(warn)・reserve(warn) が両方 warn 止まりで、rank の urgent<warn 比較を一度も踏まない
      // （reserve は state.reserves[0].deadline=2026-11-30 を過ぎるまで overdue=urgent にならない）。
      // reserves[0].deadline を早めた state を差し替え、reserve=urgent と nisa=warn が同時に出る文脈を作って
      // 実際に urgent→warn の並びを検証する（over.state は S5 と同じ方式）。
      const stateMix = JSON.parse(JSON.stringify(state));
      stateMix.reserves[0].deadline = "2026-09-30";
      const effMix = R.effectiveState(R.migrate(stateMix), rows, [], NOW_AUG);
      const cdMix = R.cashflowDerived(rows, effMix, NOW_NOV);
      const remMix = R.reminders({ nisa: R.nisaReminder(R.nisaViewModel(effMix, cdMix, NOW_NOV, []), NOW_NOV),
        reserves: cdMix.reserveAlloc.map((ra) => ({ id: ra.id, label: ra.label, deadline: ra.deadline, allocated: ra.allocated, outlook: R.reserveOutlook(ra, NOW_NOV, cdMix.available && cdMix.surplusPositive) })) });
      const mix = await newPage(browser, PC, NOW_NOV, true, { state: stateMix });
      const railMix = await mix.page.evaluate(() => Array.from(document.querySelectorAll(".mcc-rail-item")).map((n) => n.className + "|" + n.dataset.key + "|" + n.dataset.id));
      check("S4 混在(urgent+warn) 件数＝2（reserve urgent・nisa warn）", railMix.length === 2 && remMix.length === 2, JSON.stringify(railMix) + " / rem=" + JSON.stringify(remMix.map((it) => it.level + "|" + it.key)));
      // DOM 側は literal で固定（remMix と二重に同じファイルへ依存させない＝rank 破壊時に確実に赤くする）。
      const LIT_RAIL_MIX = ["urgent|reserve|rsv-shaken", "warn|nisa|nisa"];
      LIT_RAIL_MIX.forEach((want, i) => check("S4 混在 帯[" + i + "] urgent→warn 順（literal）", (railMix[i] || "").indexOf(want) >= 0, railMix[i]));
      check("S4 混在 pageerror 0", mix.errors.length === 0, mix.errors.join(" / "));
      await mix.context.close();
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
    // ---- S5 fold 内の行（goals/reserves/nisa）----
    // 8月の fixture だけでは goal=onTrack/achieved・reserve=onTrack/complete の4分岐しか踏まない。
    // 11月/12月（goal behind・reserve short/overdue）と、API の戻りを差し替えた2文脈
    //   ・目標分岐: 期限切れ／目標額未設定（targetAmount=0）／期限なし ＝ overdue・achieved・noDeadline
    //   ・収支なし: cashflow 0行 ＝ 余剰0 → goal noPace・reserve unknown
    // を足して、fold 内の行の全分岐（文言と CSS クラス）を DOM で踏む。踏み漏れは末尾の網羅チェックが落とす。
    {
      const seenG = new Set(), seenR = new Set();
      const foldChecks = async (tag, nowMs, over) => {
        const st = (over && over.state) || state;
        const rws = (over && over.cashflow) || rows;
        const ef = R.effectiveState(R.migrate(st), rws, [], nowMs);
        const cd = R.cashflowDerived(rws, ef, nowMs);
        const vm = R.viewModel(ef);
        const gol = vm.goals.map((g) => R.goalOutlook(g, vm.totalAssets, cd.monthlySurplus, nowMs));
        const hasSurplusCtx = cd.available && cd.surplusPositive;   // money.js render() と同式（monthlySurplus>0 ではない）
        const rol = cd.reserveAlloc.map((ra) => R.reserveOutlook(ra, nowMs, hasSurplusCtx));
        const nrem = R.nisaReminder(R.nisaViewModel(ef, cd, nowMs, []), nowMs);
        const { context, page, errors } = await newPage(browser, PC, nowMs, true, over);
        // 鯖 state（＝差し替え後の goals）が適用済みであることを、件数一致で待つ（描画途中を読まない）。
        await page.waitForFunction((n) => document.querySelectorAll(".mcc-goal").length === n, vm.goals.length, { timeout: 15000 });
        const f = await page.evaluate(() => ({
          goals: Array.from(document.querySelectorAll(".mcc-goal")).map((g) => (g.querySelector(".mcc-goal-outlook")?.className || "") + "|" + (g.querySelector(".mcc-goal-outlook")?.textContent || "")),
          rsv: Array.from(document.querySelectorAll(".mcc-rsv")).map((r) => (r.querySelector(".mcc-rsv-outlook")?.className || "") + "|" + (r.querySelector(".mcc-rsv-outlook")?.textContent || "")),
          nisa: document.querySelector(".mcc-nisa-reminder")?.className + "|" + (document.querySelector(".mcc-nisa-reminder")?.textContent || ""),
          nisaDigest: document.querySelector("#mcc-sec-nisa .mcc-fold-dg")?.textContent || "",
        }));
        const P = "S5[" + tag + "] ";
        check(P + "目標カード数＝rules", f.goals.length === gol.length, f.goals.length + " / " + gol.length);
        gol.forEach((o, i) => {
          seenG.add(o.status);
          const t = f.goals[i] || "";
          if (o.status === "achieved") check(P + "goal[" + i + "] achieved は行なし", t === "|", t);
          else if (o.status === "onTrack") check(P + "goal[" + i + "] onTrack", t.indexOf("期限に間に合う見込み") >= 0 && t.indexOf(R.yen(o.requiredMonthly)) >= 0, t);
          else if (o.status === "behind") check(P + "goal[" + i + "] behind", t.indexOf("behind") >= 0 && t.indexOf("間に合わせるには 月 " + R.yen(o.requiredMonthly)) >= 0, t);
          else if (o.status === "noDeadline") check(P + "goal[" + i + "] noDeadline", t.indexOf("達成見込み") >= 0 && t.indexOf("期限") < 0, t);
          else if (o.status === "overdue") check(P + "goal[" + i + "] overdue", t.indexOf("overdue") >= 0 && t.indexOf("過ぎています") >= 0 && t.indexOf(R.yen(o.remaining)) >= 0, t);
          else check(P + "goal[" + i + "] noPace", t.indexOf("見込みが立ちません（余剰が 0 の月が続いています）") >= 0 && t.indexOf("behind") < 0 && t.indexOf("overdue") < 0, t);
        });
        rol.forEach((o, i) => {
          seenR.add(o.status);
          const t = f.rsv[i] || "";
          if (o.status === "short") check(P + "reserve[" + i + "] short", t.indexOf("short") >= 0 && t.indexOf(R.yen(o.projectedShortfall) + " 不足の見込み") >= 0, t);
          else if (o.status === "onTrack") check(P + "reserve[" + i + "] onTrack", t.indexOf("確保できる見込み") >= 0, t);
          else if (o.status === "overdue") check(P + "reserve[" + i + "] overdue", t.indexOf("overdue") >= 0 && t.indexOf("過ぎています") >= 0, t);
          else check(P + "reserve[" + i + "] " + o.status + " は行なし", t === "|", t);
        });
        if (nrem.level !== "none") {
          check(P + "NISA 行のレベル", f.nisa.indexOf(nrem.level) >= 0, f.nisa);
          check(P + "NISA 行の文言", f.nisa.indexOf("翌年に繰り越せません") >= 0 && f.nisa.indexOf(R.yen(nrem.remainingTotal)) >= 0 && f.nisa.indexOf("残 " + nrem.monthsLeft + "ヶ月") >= 0, f.nisa);
          check(P + "NISA digest に残枠", f.nisaDigest.indexOf("残枠 " + R.yen(nrem.remainingTotal)) >= 0, f.nisaDigest);
        }
        check(P + "pageerror 0", errors.length === 0, errors.join(" / "));
        await context.close();
      };
      // 目標の分岐用 state（fixture は触らない＝S0 の literal と他シナリオに影響を与えない）。
      const goalsVariant = JSON.parse(JSON.stringify(state));
      goalsVariant.goals = goalsVariant.goals.concat([
        { id: "goal-late", label: "旧目標（期限切れ）", targetAmount: 8000000, deadline: "2026-05-31" },
        { id: "goal-noamt", label: "目標額が未設定", targetAmount: 0, deadline: "" },
        { id: "goal-far", label: "期限なしの大目標", targetAmount: 10000000, deadline: "" },
      ]);
      await foldChecks("8月", NOW_AUG, null);
      await foldChecks("11月", NOW_NOV, null);
      await foldChecks("12月", NOW_DEC, null);
      await foldChecks("目標分岐", NOW_AUG, { state: goalsVariant });
      await foldChecks("収支なし", NOW_AUG, { cashflow: [] });
      // 網羅チェック（条件付き assert が一度も走らない＝空振りの再発防止）。
      ["onTrack", "achieved", "behind", "overdue", "noDeadline", "noPace"].forEach((st) =>
        check("S5 goal 分岐 " + st + " を DOM で踏んだ", seenG.has(st), Array.from(seenG).join(",")));
      ["onTrack", "complete", "short", "overdue", "unknown"].forEach((st) =>
        check("S5 reserve 分岐 " + st + " を DOM で踏んだ", seenR.has(st), Array.from(seenR).join(",")));
    }
    // ---- S6 前方打切の注記（spec §4.2 注記・§8「行の欠月」）----
    // 欠月があると系列は連続部分で打ち切られる一方、ヒーローの確定額（cashDerived）は欠月より後の確定行も足す
    // ＝注記が無いと「グラフだけ古い」が無音の不一致になる。2026-03 を抜いて実際にその状態を踏む。
    {
      const gapRows = rows.filter((r) => String(r.period).slice(0, 7) !== "2026-03");
      const effGap = R.effectiveState(R.migrate(state), gapRows, [], NOW_AUG);
      const sGap = R.assetSeries(effGap, gapRows, []);
      const cdGap = R.cashDerived(gapRows, [], effGap.anchor, NOW_AUG);
      const lastGap = sGap.points[sGap.points.length - 1];
      check("S6 前提: 欠月で前方打切・最終点は 2026-02", sGap.truncatedForward === true && lastGap.period.slice(0, 7) === "2026-02", sGap.truncatedForward + " / " + (lastGap && lastGap.period));
      check("S6 前提: ヒーロー確定額と系列最終点がずれる（注記の存在理由）", cdGap.derivedCash !== lastGap.cash, cdGap.derivedCash + " / " + lastGap.cash);
      const { context, page, errors } = await newPage(browser, PC, NOW_AUG, true, { cashflow: gapRows });
      await page.waitForSelector("#mcc-sec-series .mcc-series-note");
      const g = await page.evaluate(() => ({
        notes: Array.from(document.querySelectorAll(".mcc-series-note")).map((n) => n.textContent).join("|"),
        amount: document.querySelector(".mcc-hero-amount")?.textContent || "",
      }));
      check("S6 前方打切の注記が出る", g.notes.indexOf("2026年2月より後は収支データが欠けているため表示していません") >= 0, g.notes);
      check("S6 注記は前月比も同月止まりだと述べる", g.notes.indexOf("グラフと前月比は同月までの値です") >= 0, g.notes);
      check("S6 ヒーローは欠月より後も足した確定額（＝注記が説明する差）", g.amount.trim() === R.yen(effGap.buckets.buffer.amount), g.amount + " / " + R.yen(effGap.buckets.buffer.amount));
      check("S6 pageerror 0", errors.length === 0, errors.join(" / "));
      await context.close();
    }
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
