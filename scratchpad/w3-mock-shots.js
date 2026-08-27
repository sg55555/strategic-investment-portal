// scratchpad/w3-mock-shots.js — W3 モック3案（A/B/C）のスクリーンショット採取＋pageerror 監視。
//
// 使い方（この1行で1コマンド。HTTP サーバはこのスクリプトが自前で起動/停止する）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w3-mock-shots.js
//
// 何を撮るか: 案 A/B/C × ビューポート 1440x900 / 390x844 × 日付 今日 / 2026-11-15 の 12 枚（fullPage）。
// 何を見張るか: 各ページの pageerror と console.error（0 件であることが受入条件）。
// localStorage（mcc_* / w3m の期間選択）がシナリオ間で混ざらないよう、1シナリオ = 1 BrowserContext。

const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }

const ROOT = path.resolve(__dirname, "..");
const PORT = 8241;
const BASE = "http://127.0.0.1:" + PORT;
const OUT = "/tmp/claude-1000/-home-shugo-apps/a0eb21d0-15e8-4d27-b342-892c668c6e18/scratchpad/w3-mock-shots";

const VARIANTS = ["A", "B", "C"];
const VIEWPORTS = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
];
const DATES = [
  { tag: "today", now: "" },
  { tag: "20261115", now: "2026-11-15" },
];

// ポータル（銘柄一覧）由来の既知ノイズ。/api/market/list を空で返す設計の帰結で、司令室の検証とは無関係
// （cockpit-e2e.js と同じ方針）。ここに載らない console.error は受入 NG として数える。
const KNOWN_NOISE = [
  /bootData returned empty STOCK_DATA/,
  /market\/list/,
];

function startServer() {
  return spawn("python3", [path.join(ROOT, "scratchpad", "w3-mock-server.py"), "--port", String(PORT)],
    { stdio: ["ignore", "ignore", "inherit"] });
}

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(BASE + "/api/auth/session", (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(); else retry();
      });
      req.on("error", retry);
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error("mock server did not become ready"));
      else setTimeout(tick, 120);
    };
    tick();
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = startServer();
  let browser = null;
  const results = [];
  let errTotal = 0;
  let noiseTotal = 0;

  try {
    await waitForServer(15000);
    browser = await chromium.launch();

    for (const v of VARIANTS) {
      for (const vp of VIEWPORTS) {
        for (const d of DATES) {
          const name = `${v}-${vp.tag}-${d.tag}`;
          const ctx = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            deviceScaleFactor: 1,
          });
          const page = await ctx.newPage();
          const errors = [];   // 司令室/オーバーレイ由来（0 でなければ受入 NG）
          const noise = [];    // ポータル由来の既知ノイズ（/api/market/list を空で返す設計上の帰結）
          page.on("pageerror", (e) => errors.push("pageerror: " + (e && e.message ? e.message : String(e))));
          page.on("console", (m) => {
            if (m.type() !== "error") return;
            const t = m.text();
            (KNOWN_NOISE.some((re) => re.test(t)) ? noise : errors).push("console.error: " + t);
          });

          const url = BASE + "/?w3variant=" + v + (d.now ? "&w3now=" + d.now : "");
          await page.goto(url, { waitUntil: "domcontentloaded" });

          let state = null;
          try {
            await page.waitForSelector("#mcc-root .mcc-hero", { timeout: 15000 });
            await page.waitForSelector("#mcc-root .w3m", { timeout: 15000 });
            // 収支ロード後の再描画（＋NISA probe 由来の追随 render）を吸収してから撮る。
            await page.waitForFunction(
              () => { const w = window.__W3M__; return !!(w && w.seriesLastCash !== null && w.heroAmount === Math.round(w.seriesLastCash)); },
              { timeout: 15000 }
            );
            await page.waitForTimeout(450);
            state = await page.evaluate(() => window.__W3M__ || null);
            // 切替パネルは position:fixed のため fullPage 撮影だと画面中ほどに焼き付いて中身を隠す。
            // 実ブラウザでの比較には必要な UI なので消さず、スクショの時だけ隠す。
            await page.evaluate(() => {
              const p = document.querySelector(".w3m-panel");
              if (p) p.style.display = "none";
            });
          } catch (e) {
            errors.push("wait: " + e.message);
          }

          await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
          errTotal += errors.length;
          noiseTotal += noise.length;
          results.push({ name, errors, noise, state });
          await ctx.close();
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }

  console.log("\n=== W3 mock shots ===");
  console.log("out: " + OUT);
  for (const r of results) {
    const s = r.state;
    const line = s
      ? `hero=¥${(s.heroAmount || 0).toLocaleString("en-US")} series=¥${Math.round(s.seriesLastCash || 0).toLocaleString("en-US")} match=${s.match} pts=${s.points} rail=${s.rail}`
      : "(no __W3M__)";
    console.log(`  ${r.name.padEnd(20)} err=${r.errors.length} noise=${r.noise.length}  ${line}`);
    r.errors.forEach((e) => console.log("      ! " + e));
    r.noise.forEach((e) => console.log("      ~ " + e));
  }
  console.log(`\nTOTAL errors (pageerror + 非ノイズ console.error) = ${errTotal}`);
  console.log(`TOTAL known portal noise (console.error) = ${noiseTotal}`);
  const mismatched = results.filter((r) => !r.state || r.state.match !== true).map((r) => r.name);
  console.log(`hero==series MISMATCH = ${mismatched.length}${mismatched.length ? " (" + mismatched.join(", ") + ")" : ""}`);
  process.exit(errTotal === 0 && mismatched.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
