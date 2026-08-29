// scratchpad/w35-real-shots.js — W3.5 本実装（モック注入なし）のスクリーンショット。
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w35-real-shots.js [outDir]
// モック鯖を W35_VARIANTS=0 で 8255 に自前起動し、PC 1440 / 390px × dash/report/config を fullPage で撮る。
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }
const ROOT = path.resolve(__dirname, "..");
const PORT = 8255, BASE = "http://127.0.0.1:" + PORT;
const OUT = process.argv[2] || path.join(ROOT, "scratchpad", "w35-real-shots");
fs.mkdirSync(OUT, { recursive: true });
const NOW = Date.UTC(2026, 7, 29, 3);

function waitForServer(ms) {
  const dl = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => http.get(BASE + "/api/auth/session", (res) => { res.resume(); resolve(); })
      .on("error", () => (Date.now() > dl ? reject(new Error("server not ready")) : setTimeout(tick, 120)));
    tick();
  });
}
async function fixDate(context, fixedMs) {
  await context.addInitScript((fixed) => {
    const RealDate = Date;
    function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed); }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => fixed; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
  }, fixedMs);
}
const VP = [{ key: "1440", w: 1440, h: 900 }, { key: "390", w: 390, h: 844 }];
const TABS = ["dash", "report", "config"];

async function main() {
  const server = spawn("python3", [path.join(ROOT, "scratchpad", "w35-mock-server.py"), "--port", String(PORT)],
    { stdio: ["ignore", "ignore", "ignore"], env: Object.assign({}, process.env, { W35_VARIANTS: "0" }) });
  let browser;
  try {
    await waitForServer(15000);
    browser = await chromium.launch();
    for (const v of VP) {
      const context = await browser.newContext({ viewport: { width: v.w, height: v.h } });
      await fixDate(context, NOW);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE + "/?diag=off", { waitUntil: "domcontentloaded" });
      await page.evaluate(() => window.MCC && window.MCC.show && window.MCC.show());
      await page.waitForSelector("#mcc-root .mcc-hero", { timeout: 15000 });
      await page.waitForFunction(() => !!document.querySelector("#mcc-sec-cashflow .mcc-cashflow"), null, { timeout: 15000 });
      for (const t of TABS) {
        await page.evaluate((tab) => MCC.switchTab(tab), t);
        await page.waitForTimeout(400);
        const file = path.join(OUT, "real-" + v.key + "-" + t + ".png");
        await page.screenshot({ path: file, fullPage: true });
        const info = await page.evaluate(() => ({
          budgetRows: document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-row").length,
          digest: (document.querySelector("#mcc-sec-budget-live .mcc-fold-dg") || {}).textContent || "",
          repMonth: (document.querySelector(".mcc-rep-month") || {}).textContent || "",
          scrollW: document.getElementById("money-view").scrollWidth,
        }));
        console.log(file, JSON.stringify(info), "pageerrors=" + errors.length);
      }
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
