// scratchpad/w35-mock-shots.js — W3.5 モック3案（A/B/C）のスクリーンショット採取＋pageerror 監視。
//
// 使い方（この1行で1コマンド。HTTP サーバはこのスクリプトが自前で起動/停止する）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w35-mock-shots.js
//
// 何を撮るか: 案 A/B/C × ビューポート 1440x900 / 390x844 × 面 dash / report / config ＝ 18 枚（fullPage）。
//   dash   … ダッシュボード（「今月の予算」fold つき）
//   report … 月次レポート面（A=タブ「03」クリック後／B=fold を開いた後／C=収支 fold のまま）
//   config … 設定・ガイドタブ（「月の予算」カード）
// 日付は w35now=2026-08-29 固定（進行中月 2026-08 が 94% 経過＝外食費が超過・食費が watch）。
// 何を見張るか: 各ページの pageerror と console.error（0 件であることが受入条件）。
// localStorage（mcc_tab / mcc_fold）がシナリオ間で混ざらないよう、1シナリオ = 1 BrowserContext。

const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }

const ROOT = path.resolve(__dirname, "..");
const PORT = 8251;
const BASE = "http://127.0.0.1:" + PORT;
const OUT = "/tmp/claude-1000/-home-shugo-apps/6de46815-e0bc-45ac-9faf-c89b30ef8a79/scratchpad/w35-mock-shots";
const NOW = "2026-08-29";

const VARIANTS = ["A", "B", "C"];
const VIEWPORTS = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
];

// ポータル（銘柄一覧）由来の既知ノイズ。/api/market/list を空で返す設計の帰結で、司令室の検証とは無関係
// （cockpit-e2e.js / w3-mock-shots.js と同じ方針）。ここに載らない console.error は受入 NG として数える。
const KNOWN_NOISE = [
  /bootData returned empty STOCK_DATA/,
  /market\/list/,
];

function startServer() {
  return spawn("python3", [path.join(ROOT, "scratchpad", "w35-mock-server.py"), "--port", String(PORT)],
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

// スクショの時だけ切替パネル（position:fixed）を隠す。実ブラウザでの比較には必要な UI なので消さない。
async function hidePanel(page) {
  await page.evaluate(() => {
    const p = document.querySelector(".w35m-panel");
    if (p) p.style.display = "none";
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = startServer();
  let browser = null;
  const results = [];
  let errTotal = 0;
  let noiseTotal = 0;
  let shots = 0;

  try {
    await waitForServer(15000);
    browser = await chromium.launch();

    for (const v of VARIANTS) {
      for (const vp of VIEWPORTS) {
        const name = `${v}-${vp.tag}`;
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
        });
        const page = await ctx.newPage();
        const errors = [];   // 司令室/オーバーレイ由来（0 でなければ受入 NG）
        const noise = [];    // ポータル由来の既知ノイズ
        page.on("pageerror", (e) => errors.push("pageerror: " + (e && e.message ? e.message : String(e))));
        page.on("console", (m) => {
          if (m.type() !== "error") return;
          const t = m.text();
          (KNOWN_NOISE.some((re) => re.test(t)) ? noise : errors).push("console.error: " + t);
        });

        const url = `${BASE}/?w35variant=${v}&w35now=${NOW}`;
        await page.goto(url, { waitUntil: "domcontentloaded" });

        let state = null;
        try {
          await page.waitForSelector("#mcc-root .mcc-hero", { timeout: 15000 });
          await page.waitForSelector("#mcc-root .w35m-marker", { state: "attached", timeout: 15000 });
          await page.waitForSelector("#mcc-sec-budget-live", { timeout: 15000 });
          await page.waitForTimeout(450);
          state = await page.evaluate(() => window.__W35M__ || null);
          await hidePanel(page);

          // ① ダッシュボード（既定の面）
          await page.screenshot({ path: path.join(OUT, `w35-${v}-${vp.tag}-dash.png`), fullPage: true });
          shots++;

          // ② レポート面
          if (v === "A") {
            await page.click("#mcc-tab-btn-report");
            await page.waitForSelector("#mcc-tab-report .w35m-report", { state: "visible", timeout: 8000 });
          } else if (v === "B") {
            await page.click("#mcc-sec-report > summary");
            await page.waitForSelector("#mcc-sec-report[open] .w35m-report", { state: "visible", timeout: 8000 });
          } else {
            // C: 収支 fold の本文末尾（新しい面は作らない＝ダッシュボードのまま）
            await page.waitForSelector("#mcc-sec-cashflow .w35m-report", { state: "visible", timeout: 8000 });
          }
          await page.waitForTimeout(300);
          await hidePanel(page);
          await page.screenshot({ path: path.join(OUT, `w35-${v}-${vp.tag}-report.png`), fullPage: true });
          shots++;

          // ③ 設定・ガイドタブ（「月の予算」カード）
          await page.click("#mcc-tab-btn-config");
          await page.waitForSelector("#mcc-sec-budget-card", { state: "visible", timeout: 8000 });
          await page.waitForTimeout(300);
          await hidePanel(page);
          await page.screenshot({ path: path.join(OUT, `w35-${v}-${vp.tag}-config.png`), fullPage: true });
          shots++;
        } catch (e) {
          errors.push("flow: " + e.message);
        }

        errTotal += errors.length;
        noiseTotal += noise.length;
        results.push({ name, errors, noise, state });
        await ctx.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }

  console.log("\n=== W3.5 mock shots ===");
  console.log("out: " + OUT + "   shots=" + shots);
  for (const r of results) {
    const s = r.state;
    const line = s
      ? `live=${s.livePeriod} 支出¥${(s.liveExpense || 0).toLocaleString("en-US")}(${s.livePct}%/経過${s.elapsedPct}%) 超過${s.overCount}費目 予算なし${s.unbudgeted} | 確定${s.latestPeriod} 収支¥${(s.latestBalance || 0).toLocaleString("en-US")} 貯蓄率${s.latestSavingsRate}% 総資産¥${(s.totalAssets || 0).toLocaleString("en-US")} series=${s.seriesSource}`
      : "(no __W35M__)";
    console.log(`  ${r.name.padEnd(10)} err=${r.errors.length} noise=${r.noise.length}  ${line}`);
    r.errors.forEach((e) => console.log("      ! " + e));
    r.noise.forEach((e) => console.log("      ~ " + e));
  }
  console.log(`\nTOTAL errors (pageerror + 非ノイズ console.error) = ${errTotal}`);
  console.log(`TOTAL known portal noise (console.error) = ${noiseTotal}`);
  console.log(`shots = ${shots} / 18`);
  process.exit(errTotal === 0 && shots === 18 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
