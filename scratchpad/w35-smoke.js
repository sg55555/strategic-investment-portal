// scratchpad/w35-smoke.js — W3.5 月次パック 受入（spec §10.2）。
// 使い方（この1行で1コマンド。モック鯖は自前で起動/停止・W35_VARIANTS=0 で本実装だけを検証）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w35-smoke.js
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }

const ROOT = path.resolve(__dirname, "..");
const results = [];
function check(name, cond, detail) { results.push({ name, pass: !!cond, detail }); if (!cond) console.log("  ✗ " + name + (detail ? " — " + detail : "")); }

// fixture 由来の literal（w35-mock-server.py の決定論 fixture。fixture を意図的に変えたときだけ更新する）。
const LIT = {
  augHead: "2026年8月",
  augElapsed: 94,                       // 2026-08-29 → 29/31
  augTotalVal: "¥241,300 / ¥260,000（93%）",
  augTotalRem: "残り ¥18,700",
  augDigest: "消化 93%・月 94% 経過・超過 1費目",
  gaishoku: "¥24,500 / ¥20,000（123%）",
  gaishokuOver: "超過 ¥4,500",
  shokuhi: "¥41,600 / ¥45,000（92%）",
  shokuhiRem: "残り ¥3,400",
  unbudTotal: "¥41,900",
  shokuhiAvg3: "48233",                 // 直近3確定月（2026-05/06/07）の平均＝round((52700+42500+49500)/3)
  julyMonth: "2026年7月",
  julyIncome: "¥335,000", julyExpense: "¥266,000", julyBalance: "¥69,000", julySavings: "21%",
  julyMomIncome: "前月比 −¥200,000（−37.4%）",
  julyMomExpense: "前月比 +¥28,500（+12.0%）",
  julyMomBalance: "前月比 −¥228,500（−76.8%）",
  julyMomSavings: "前月比 −35.0pt",
  julyYoyIncome: "前年同月比 −¥15,000（−4.3%）",
  julyYoyExpense: "前年同月比 +¥18,000（+7.3%）",
  julyYoySavings: "前年同月比 −8.0pt",
  julyAssets: "¥3,174,000", julyAssetsDelta: "前月比 +¥69,000（+2.2%）",
  julyAssetsSub: "現金 ¥2,574,000・投資 ¥600,000",
  juneMonth: "2026年6月",
  juneMomIncome: "前月比 +¥205,000（+62.1%）",
  juneMomExpense: "前月比 −¥30,000（−11.2%）",
  juneMomSavings: "前月比 +37.0pt",
  nisaNow: "NISA 年内 使用 ¥300,000 / ¥3,600,000（残 ¥3,300,000）",
  goalNow: "住宅の頭金 63%",
  tabLabels: ["ダッシュボード", "レポート", "設定"],
  tabbarH: 42,                          // 390px で wrap しない高さ（本 wave 実測。Ruling A2＝spec §10.2 が正・plan の 43 は W3 期の値）
};
const BAN = ["節約", "使いすぎ", "見直し", "おすすめ", "しましょう", "べき"];
const KNOWN_NOISE = [/Failed to load resource/i, /favicon/i, /_vercel\/insights/i, /the server responded with a status of 401/i,
  /bootData returned empty STOCK_DATA/i];   // モックの /api/market/* が意図的に stocks:{} を返すための既知の無害ログ（W3.5 非接触の portal-view 初期化経路）
const PC = { width: 1440, height: 900 }, SP = { width: 390, height: 844 };
const NOW = Date.UTC(2026, 7, 29, 3);   // 2026-08-29（JST 昼＝UTC でも 08-29）

function startServer(port, env) {
  return spawn("python3", [path.join(ROOT, "scratchpad", "w35-mock-server.py"), "--port", String(port)],
    { stdio: ["ignore", "ignore", "ignore"], env: Object.assign({}, process.env, { W35_VARIANTS: "0" }, env || {}) });
}
function waitForServer(base, ms) {
  const dl = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => http.get(base + "/api/auth/session", (res) => { res.resume(); resolve(); })
      .on("error", () => (Date.now() > dl ? reject(new Error("server not ready")) : setTimeout(tick, 120)));
    tick();
  });
}
// Date を固定（render() は Date.now() を1回取る＝ここを固定すれば全 VM が同じ月を見る）。
async function fixDate(context, fixedMs) {
  await context.addInitScript((fixed) => {
    const RealDate = Date;
    function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed); }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => fixed; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
  }, fixedMs);
}
async function newPage(browser, base, viewport, loggedIn) {
  const context = await browser.newContext({ viewport });
  await fixDate(context, NOW);
  const page = await context.newPage();
  const errors = [], consoleErrs = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!KNOWN_NOISE.some((re) => re.test(t))) consoleErrs.push(t);
  });
  await page.goto(base + "/?diag=off", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => MCC.show());
  await page.waitForSelector("#mcc-root .mcc-hero", { timeout: 15000 });
  if (loggedIn) await page.waitForFunction(() => !!document.querySelector("#mcc-sec-cashflow .mcc-cashflow"), null, { timeout: 15000 });
  return { context, page, errors, consoleErrs };
}
const txtOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : ""; }, sel);

async function main() {
  const PORT = 8252, BASE = "http://127.0.0.1:" + PORT;
  const PORT_NB = 8253, BASE_NB = "http://127.0.0.1:" + PORT_NB;   // W35_BUDGETS=0
  const PORT_NA = 8254, BASE_NA = "http://127.0.0.1:" + PORT_NA;   // W35_AUTH=0
  const servers = [startServer(PORT), startServer(PORT_NB, { W35_BUDGETS: "0" }), startServer(PORT_NA, { W35_AUTH: "0" })];
  let browser;
  try {
    await Promise.all([waitForServer(BASE, 15000), waitForServer(BASE_NB, 15000), waitForServer(BASE_NA, 15000)]);
    browser = await chromium.launch();

    // ---- S1 未設定（W35_BUDGETS=0）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE_NB, PC, true);
      await page.waitForSelector("#mcc-sec-budget-live");
      const s1 = await page.evaluate(() => ({
        digest: document.querySelector("#mcc-sec-budget-live .mcc-fold-dg").textContent.trim(),
        cta: (document.querySelector("#mcc-sec-budget-live .mcc-bud-cta") || {}).textContent || "",
        chips: Array.from(document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-chip")).map((n) => n.textContent.trim()),
        bars: document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-row").length,
      }));
      check("S1 digest 未設定", s1.digest === "未設定", s1.digest);
      check("S1 CTA 逐語", s1.cta.indexOf("費目ごとの月額を設定すると、今月の消化がここに出ます。") >= 0, s1.cta);
      check("S1 CTA に「月の予算」ジャンプ", s1.cta.indexOf("「月の予算」") >= 0, s1.cta);
      check("S1 今月の費目チップ 5件", s1.chips.length === 5, JSON.stringify(s1.chips));
      check("S1 バーは出さない", s1.bars === 0, s1.bars);
      check("S1 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S2 設定済（既定 fixture・2026-08-29）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.waitForSelector("#mcc-sec-budget-live .mcc-bud-row-total");
      const s2 = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-row-item")).map((r) => ({
          name: r.querySelector(".mcc-bud-lbl").textContent.trim(),
          val: r.querySelector(".mcc-bud-val").textContent.replace(/\s+/g, " ").trim(),
          cls: r.querySelector(".mcc-bud-fill").className,
          width: r.querySelector(".mcc-bud-fill").style.width,
        }));
        const total = document.querySelector("#mcc-sec-budget-live .mcc-bud-row-total");
        return {
          open: document.getElementById("mcc-sec-budget-live").open,
          digest: document.querySelector("#mcc-sec-budget-live .mcc-fold-dg").textContent.replace(/\s+/g, " ").trim(),
          head: document.querySelector("#mcc-sec-budget-live .mcc-bud-head").textContent.replace(/\s+/g, " ").trim(),
          totalVal: total.querySelector(".mcc-bud-val").textContent.replace(/\s+/g, " ").trim(),
          tick: total.querySelector(".mcc-bud-tick") ? total.querySelector(".mcc-bud-tick").style.left : "",
          totalWidth: total.querySelector(".mcc-bud-fill").style.width,
          rows: rows,
          unbud: (document.querySelector("#mcc-sec-budget-live .mcc-bud-unbud") || {}).textContent || "",
          chips: Array.from(document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-chip")).map((n) => n.textContent.trim()),
          notes: Array.from(document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-note")).map((n) => n.textContent.trim()).join("|"),
        };
      });
      check("S2 fold は既定 open", s2.open === true);
      check("S2 digest 逐語", s2.digest === LIT.augDigest, s2.digest);
      check("S2 見出し（進行中・経過率）", s2.head.indexOf(LIT.augHead) === 0 && s2.head.indexOf("（進行中・月の " + LIT.augElapsed + "% 経過）") > 0, s2.head);
      check("S2 合計バーの値", s2.totalVal.indexOf(LIT.augTotalVal) === 0, s2.totalVal);
      check("S2 合計バーの残り", s2.totalVal.indexOf(LIT.augTotalRem) > 0, s2.totalVal);
      check("S2 目盛線＝経過率", s2.tick === LIT.augElapsed + "%", s2.tick);
      check("S2 合計バー幅＝消化率", s2.totalWidth === "93%", s2.totalWidth);
      check("S2 費目 9 行・pct 降順の先頭は外食費", s2.rows.length === 9 && s2.rows[0].name === "外食費", JSON.stringify(s2.rows.map((r) => r.name)));
      check("S2 over は 1 件（外食費・赤）", s2.rows.filter((r) => /\bover\b/.test(r.cls)).length === 1 && /\bover\b/.test(s2.rows[0].cls), s2.rows[0].cls);
      check("S2 over の値と超過額", s2.rows[0].val.indexOf(LIT.gaishoku) === 0 && s2.rows[0].val.indexOf(LIT.gaishokuOver) > 0, s2.rows[0].val);
      const watch = s2.rows.filter((r) => /\bwatch\b/.test(r.cls));
      check("S2 watch は 1 件（食費・アンバー）", watch.length === 1 && watch[0].name === "食費", JSON.stringify(watch));
      check("S2 watch の値と残り", watch.length === 1 && watch[0].val.indexOf(LIT.shokuhi) === 0 && watch[0].val.indexOf(LIT.shokuhiRem) > 0, watch.length ? watch[0].val : "");
      const nodata = s2.rows.filter((r) => r.val === "実績なし");
      check("S2 実績なしは 旧・雑貨 1 件・バー幅 0", nodata.length === 1 && nodata[0].name === "旧・雑貨" && nodata[0].width === "0%", JSON.stringify(nodata));
      check("S2 予算なしの費目 合計", s2.unbud.indexOf("予算なしの費目 " + LIT.unbudTotal + "：") >= 0, s2.unbud);
      check("S2 予算なしチップ 5 件", s2.chips.length === 5, JSON.stringify(s2.chips));
      check("S2 チップに 車・ガソリン ¥12,000", s2.chips.indexOf("車・ガソリン ¥12,000") >= 0, JSON.stringify(s2.chips));
      check("S2 内訳と合計は一致（不一致注記なし）", s2.notes.indexOf("一致していません") < 0, s2.notes);
      check("S2 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S3 設定カード（0 で削除・平均を採用・フォーカス復元）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.evaluate(() => MCC.switchTab("config"));
      await page.waitForSelector("#mcc-sec-budget-card .mcc-bud-table");
      const before = await page.evaluate(() => ({
        rows: document.querySelectorAll("#mcc-sec-budget-card .mcc-bud-table tbody tr").length,
        nodata: Array.from(document.querySelectorAll("#mcc-sec-budget-card tr.mcc-bud-nodata th")).map((n) => n.textContent.trim()),
        readout: (document.querySelector("#mcc-sec-budget-card .mcc-bud-readout") || {}).textContent || "",
        note: Array.from(document.querySelectorAll("#mcc-sec-budget-card .mcc-bud-note")).map((n) => n.textContent.trim()).join("|"),
      }));
      check("S3 実績なしの行は「旧・雑貨」＋タグ", before.nodata.length === 1 && before.nodata[0].indexOf("旧・雑貨") === 0 && before.nodata[0].indexOf("直近12ヶ月に実績なし") > 0, JSON.stringify(before.nodata));
      check("S3 合計の読み出し（直近3ヶ月・確定月のみ）", before.readout.indexOf("実支出の平均は ¥257,000/月（直近3ヶ月・確定月のみ）") >= 0, before.readout);
      check("S3 0 で消える注記", before.note.indexOf("0 を入れると予算を消します") >= 0, before.note);
      check("S3 費目の合計注記", before.note.indexOf("費目の合計 ¥207,000（合計予算の 80%）") >= 0, before.note);
      // 旧・雑貨に 0 を入れる → 行ごと消える
      await page.evaluate(() => {
        const inp = document.querySelector('#mcc-sec-budget-card input[data-mcc-focus="budgets.item:旧・雑貨"]');
        inp.value = "0";
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForFunction(() => !document.querySelector('#mcc-sec-budget-card input[data-mcc-focus="budgets.item:旧・雑貨"]'), null, { timeout: 5000 });
      const after0 = await page.evaluate(() => ({
        rows: document.querySelectorAll("#mcc-sec-budget-card .mcc-bud-table tbody tr").length,
        stored: JSON.parse(localStorage.getItem("mcc_state")).budgets.items.map((i) => i.name),
      }));
      check("S3 0 入力で行が消える", after0.rows === before.rows - 1, before.rows + " → " + after0.rows);
      check("S3 0 入力で state からも消える", after0.stored.indexOf("旧・雑貨") < 0, JSON.stringify(after0.stored));
      // 食費に「平均を採用」→ avg3 が入る＋フォーカス復元（data-mcc-focus）
      await page.evaluate(() => {
        const th = Array.from(document.querySelectorAll("#mcc-sec-budget-card tbody tr")).find((tr) => tr.querySelector("th").textContent.trim() === "食費");
        th.querySelector(".mcc-bud-adopt").click();
      });
      await page.waitForFunction((want) => {
        const i = document.querySelector('#mcc-sec-budget-card input[data-mcc-focus="budgets.item:食費"]');
        return !!i && i.value === want;
      }, LIT.shokuhiAvg3, { timeout: 5000 });
      check("S3 平均を採用で avg3 が入る", true);
      // 入力欄に触ってから Enter 確定＝フォーカスが同じ欄に戻る
      const focused = await page.evaluate(async () => {
        const inp = document.querySelector('#mcc-sec-budget-card input[data-mcc-focus="budgets.item:外食費"]');
        inp.focus();
        inp.value = "21000";
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        const ae = document.activeElement;
        return ae ? ae.getAttribute("data-mcc-focus") : "";
      });
      check("S3 フォーカス復元（budgets.item:外食費）", focused === "budgets.item:外食費", focused);
      check("S3 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S4 レポート（既定＝最新の確定月・◀ ▶・端で disabled）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.evaluate(() => MCC.switchTab("report"));
      await page.waitForSelector("#mcc-tab-report-body .mcc-rep-nav");
      const snap = () => page.evaluate(() => ({
        month: document.querySelector(".mcc-rep-month").textContent.trim(),
        chip: (document.querySelector(".mcc-rep-chip") || {}).textContent || "",
        badge: (document.querySelector("#mcc-tab-report-body .mcc-rep-chip-live, #mcc-tab-report-body .mcc-rep-chip-prov") || {}).textContent || "",
        kpis: Array.from(document.querySelectorAll("#mcc-tab-report-body .mcc-cf-stat")).map((s) => s.textContent.replace(/\s+/g, " ").trim()),
        assets: (document.querySelector(".mcc-rep-assets") || {}).textContent.replace(/\s+/g, " ").trim(),
        now: (document.querySelector(".mcc-rep-now") || {}).textContent || "",
        prevDisabled: document.querySelector('[aria-label="前の月"]').disabled,
        nextDisabled: document.querySelector('[aria-label="次の月"]').disabled,
        cats: Array.from(document.querySelectorAll(".mcc-rep-cat-nm")).map((n) => n.textContent.trim()),
        budgetRows: document.querySelectorAll(".mcc-rep-budget .mcc-bud-row").length,
        compareNote: (document.querySelector(".mcc-rep-budget .mcc-bud-note") || {}).textContent || "",
      }));
      const july = await snap();
      check("S4 既定＝最新の確定月", july.month === LIT.julyMonth, july.month);
      check("S4 最新チップ", july.chip === "最新", july.chip);
      check("S4 確定バッジ", july.badge === "確定", july.badge);
      check("S4 収入タイル逐語", july.kpis[0].indexOf(LIT.julyIncome) >= 0 && july.kpis[0].indexOf(LIT.julyMomIncome) >= 0 && july.kpis[0].indexOf(LIT.julyYoyIncome) >= 0, july.kpis[0]);
      check("S4 支出タイル逐語", july.kpis[1].indexOf(LIT.julyExpense) >= 0 && july.kpis[1].indexOf(LIT.julyMomExpense) >= 0 && july.kpis[1].indexOf(LIT.julyYoyExpense) >= 0, july.kpis[1]);
      check("S4 収支タイル逐語", july.kpis[2].indexOf(LIT.julyBalance) >= 0 && july.kpis[2].indexOf(LIT.julyMomBalance) >= 0, july.kpis[2]);
      check("S4 貯蓄率タイルは pt", july.kpis[3].indexOf(LIT.julySavings) >= 0 && july.kpis[3].indexOf(LIT.julyMomSavings) >= 0 && july.kpis[3].indexOf(LIT.julyYoySavings) >= 0, july.kpis[3]);
      check("S4 資産増減", july.assets.indexOf("総資産 " + LIT.julyAssets) >= 0 && july.assets.indexOf(LIT.julyAssetsDelta) >= 0 && july.assets.indexOf(LIT.julyAssetsSub) >= 0, july.assets);
      check("S4 現在地（最新の確定月のみ）", july.now.indexOf(LIT.nisaNow) >= 0 && july.now.indexOf(LIT.goalNow) >= 0, july.now);
      check("S4 確定月は「現在の予算で比較しています」", july.compareNote.indexOf("現在の予算で比較しています") >= 0, july.compareNote);
      check("S4 費目の先頭＝賃貸費用（構成比つき）", july.cats[0].indexOf("賃貸費用 ¥85,000（32%）") === 0, july.cats[0]);
      // ◀ で前月へ
      await page.click('[aria-label="前の月"]');
      await page.waitForFunction(() => document.querySelector(".mcc-rep-month").textContent.trim() === "2026年6月", null, { timeout: 5000 });
      const june = await snap();
      check("S4 ◀ で 2026年6月", june.month === LIT.juneMonth, june.month);
      check("S4 最新チップは消える", june.chip === "", june.chip);
      check("S4 6月の前月比（収入/支出/貯蓄率）", june.kpis[0].indexOf(LIT.juneMomIncome) >= 0 && june.kpis[1].indexOf(LIT.juneMomExpense) >= 0 && june.kpis[3].indexOf(LIT.juneMomSavings) >= 0, june.kpis.join(" | "));
      check("S4 6月は現在地を出さない", june.now === "", june.now);
      // ▶ ▶ で進行中月へ
      await page.click('[aria-label="次の月"]');
      await page.waitForFunction(() => document.querySelector(".mcc-rep-month").textContent.trim() === "2026年7月", null, { timeout: 5000 });
      await page.click('[aria-label="次の月"]');
      await page.waitForFunction(() => document.querySelector(".mcc-rep-month").textContent.trim() === "2026年8月", null, { timeout: 5000 });
      const aug = await snap();
      check("S4 ▶▶ で 2026年8月・暫定（進行中）", aug.badge === "暫定（進行中）", aug.badge);
      check("S4 端では ▶ が disabled", aug.nextDisabled === true, aug.nextDisabled);
      check("S4 進行中月は比較注記を出さない", aug.compareNote.indexOf("現在の予算で比較しています") < 0, aug.compareNote);
      check("S4 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S5 資産増減が推移カードの同月点と一致（DOM 同士の突合）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      const capText = await page.evaluate(() => {
        const hits = Array.from(document.querySelectorAll("#mcc-sec-series .mcc-series-hit"));
        const h = hits.map((x) => x.getAttribute("data-cap")).find((c) => c && c.indexOf("2026年7月") === 0);
        return h || "";
      });
      await page.evaluate(() => MCC.switchTab("report"));
      await page.waitForSelector(".mcc-rep-assets");
      const rep = await txtOf(page, ".mcc-rep-assets");
      check("S5 推移カードに 2026年7月 の点がある", capText.indexOf("総資産 " + LIT.julyAssets) > 0, capText);
      check("S5 レポートの総資産＝推移カードの同月点", rep.indexOf("総資産 " + LIT.julyAssets) >= 0, rep);
      check("S5 現金/投資も一致", capText.indexOf("現金 ¥2,574,000") > 0 && rep.indexOf("現金 ¥2,574,000") >= 0, capText + " || " + rep);
      check("S5 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S6 未ログイン（W35_AUTH=0）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE_NA, PC, false);
      const s6 = await page.evaluate(() => {
        const rep = document.getElementById("mcc-tab-report");
        const card = document.getElementById("mcc-sec-budget-card");
        return {
          fold: !!document.getElementById("mcc-sec-budget-live"),
          repText: rep ? rep.textContent.replace(/\s+/g, " ").trim() : "",
          cardText: card ? card.textContent.replace(/\s+/g, " ").trim() : "",
          cardInputs: card ? card.querySelectorAll("input").length : 0,
        };
      });
      check("S6 未ログインは fold を描かない", s6.fold === false);
      check("S6 レポートはログイン案内 1 行", s6.repText.indexOf("ログインすると月次レポートが表示されます。") >= 0, s6.repText);
      check("S6 レポートに ¥ が出ない", s6.repText.indexOf("¥") < 0, s6.repText);
      check("S6 設定カードは編集可（入力あり）", s6.cardInputs >= 1, s6.cardInputs);
      check("S6 設定カードに ¥ が出ない", s6.cardText.indexOf("¥") < 0, s6.cardText);
      check("S6 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S7 禁則語（新設セクションに 0 件）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.evaluate(() => MCC.switchTab("report"));
      await page.waitForSelector("#mcc-tab-report-body");
      const texts = await page.evaluate(() => ({
        fold: (document.getElementById("mcc-sec-budget-live") || {}).textContent || "",
        report: (document.getElementById("mcc-tab-report") || {}).textContent || "",
        card: (document.getElementById("mcc-sec-budget-card") || {}).textContent || "",
      }));
      BAN.forEach((w) => {
        check("S7 禁則語「" + w + "」が新設部分に無い",
          texts.fold.indexOf(w) < 0 && texts.report.indexOf(w) < 0 && texts.card.indexOf(w) < 0, w);
      });
      check("S7 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S8 fold の開閉が再描画後も保持 ----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.waitForSelector("#mcc-sec-budget-live");
      await page.evaluate(() => { document.getElementById("mcc-sec-budget-live").open = false; });
      await page.waitForTimeout(80);
      await page.evaluate(() => MCC.render());
      await page.waitForTimeout(80);
      const closed = await page.evaluate(() => document.getElementById("mcc-sec-budget-live").open);
      check("S8 閉じた fold は再描画後も閉じたまま", closed === false, closed);
      await page.evaluate(() => { document.getElementById("mcc-sec-budget-live").open = true; });
      await page.waitForTimeout(80);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.evaluate(() => MCC.show());
      await page.waitForSelector("#mcc-sec-budget-live");
      const reopened = await page.evaluate(() => document.getElementById("mcc-sec-budget-live").open);
      check("S8 開いた fold はリロード後も開く（mcc_details）", reopened === true, reopened);
      check("S8 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S9 タブ 3 本（非再描画切替・390px で 1 行）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      const s9a = await page.evaluate(() => {
        window.__cf = document.getElementById("mcc-sec-cashflow");
        window.__cf.open = false;
        return {
          tabs: Array.from(document.querySelectorAll(".mcc-tab")).map((b) => b.id),
          nums: Array.from(document.querySelectorAll(".mcc-tab-num")).map((n) => n.textContent.trim()),
          labels: Array.from(document.querySelectorAll(".mcc-tab-lbl")).map((n) => n.textContent.trim()),
          shorts: Array.from(document.querySelectorAll(".mcc-tab-lbl-s")).map((n) => n.textContent.trim()),
        };
      });
      check("S9 タブ 3 本", JSON.stringify(s9a.tabs) === JSON.stringify(["mcc-tab-btn-dash", "mcc-tab-btn-report", "mcc-tab-btn-config"]), JSON.stringify(s9a.tabs));
      check("S9 番号 01/02/03", JSON.stringify(s9a.nums) === JSON.stringify(["01", "02", "03"]), JSON.stringify(s9a.nums));
      check("S9 ラベル逐語", JSON.stringify(s9a.labels) === JSON.stringify(["ダッシュボード", "月次レポート", "設定・ガイド"]), JSON.stringify(s9a.labels));
      check("S9 短ラベル逐語", JSON.stringify(s9a.shorts) === JSON.stringify(LIT.tabLabels), JSON.stringify(s9a.shorts));
      await page.click("#mcc-tab-btn-report");
      await page.waitForTimeout(80);
      const s9b = await page.evaluate(() => ({
        same: window.__cf === document.getElementById("mcc-sec-cashflow"),
        stillClosed: document.getElementById("mcc-sec-cashflow").open,
        hidden: [document.getElementById("mcc-tab-dash").hidden, document.getElementById("mcc-tab-report").hidden, document.getElementById("mcc-tab-config").hidden],
        aria: Array.from(document.querySelectorAll(".mcc-tab")).map((b) => b.getAttribute("aria-selected")),
        stored: localStorage.getItem("mcc_tab"),
      }));
      check("S9 切替は非再描画（同一ノード参照）", s9b.same === true);
      check("S9 切替で fold の開閉が残る", s9b.stillClosed === false);
      check("S9 hidden はレポートだけ false", JSON.stringify(s9b.hidden) === JSON.stringify([true, false, true]), JSON.stringify(s9b.hidden));
      check("S9 aria-selected", JSON.stringify(s9b.aria) === JSON.stringify(["false", "true", "false"]), JSON.stringify(s9b.aria));
      check("S9 localStorage に report", s9b.stored === "report", s9b.stored);
      await context.close();
      // 390px: wrap しない（タブバー高さ＝タブ1個分）
      const sp = await newPage(browser, BASE, SP, true);
      const s9c = await sp.page.evaluate(() => {
        const bar = document.querySelector(".mcc-tabbar");
        const btn = document.querySelector(".mcc-tab");
        return {
          barH: Math.round(bar.getBoundingClientRect().height),
          btnH: Math.round(btn.getBoundingClientRect().height),
          numShown: getComputedStyle(document.querySelector(".mcc-tab-num")).display,
          lblShown: getComputedStyle(document.querySelector(".mcc-tab-lbl")).display,
          shortShown: getComputedStyle(document.querySelector(".mcc-tab-lbl-s")).display,
          viewW: document.getElementById("money-view").scrollWidth,
        };
      });
      check("S9 390px でタブバーが wrap しない", s9c.barH === s9c.btnH, s9c.barH + " / " + s9c.btnH);
      check("S9 390px のタブバー高さ（実測 42px）", s9c.barH === LIT.tabbarH, s9c.barH);
      check("S9 390px は番号とフルラベルを隠す", s9c.numShown === "none" && s9c.lblShown === "none" && s9c.shortShown !== "none", JSON.stringify(s9c));
      check("S9 390px 横あふれなし", s9c.viewW <= 390, s9c.viewW);
      check("S9 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0 && sp.errors.length === 0 && sp.consoleErrs.length === 0,
        errors.concat(consoleErrs, sp.errors, sp.consoleErrs).join(" / "));
      await sp.context.close();
    }

    // ---- S10 390px のレポート/予算 fold（描画とエラー 0）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, SP, true);
      await page.evaluate(() => MCC.switchTab("report"));
      await page.waitForSelector("#mcc-tab-report-body .mcc-rep-nav");
      const s10 = await page.evaluate(() => ({
        navH: Math.round(document.querySelector(".mcc-rep-nav").getBoundingClientRect().height),
        viewW: document.getElementById("money-view").scrollWidth,
        kpis: document.querySelectorAll("#mcc-tab-report-body .mcc-cf-stat").length,
      }));
      check("S10 390px 横あふれなし", s10.viewW <= 390, s10.viewW);
      check("S10 KPI 4 タイル", s10.kpis === 4, s10.kpis);
      check("S10 月ナビは 1〜2 行に収まる", s10.navH <= 80, s10.navH);
      check("S10 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    servers.forEach((s) => s.kill());
  }
  const failed = results.filter((r) => !r.pass);
  console.log(results.length - failed.length + "/" + results.length + " asserts passed");
  console.log(failed.length ? "FAIL" : "ALL PASS");
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
