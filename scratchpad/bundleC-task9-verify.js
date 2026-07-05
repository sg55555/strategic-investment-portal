const { chromium } = require("playwright");
const { spawn } = require("child_process");
const { FIXTURE } = require("./bundleC-fixture.js");
const WT = "/home/shugo/apps/investment-portal/.claude/worktrees/bundleC-discipline-tools";
const PORT = 8973;
(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: WT, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 900));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("**/api/market/list", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".portal-table tbody tr", { timeout: 8000 });

  // スクリーニングパネルを開く
  await page.click("#screening-toggle");
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => {
    const panel = document.getElementById("screening-panel");
    const axisIds = ["scr-per-min", "scr-pbr-min", "scr-op-min", "scr-roe-min", "scr-nm-min", "scr-eq-min", "scr-cur-min", "scr-cagr-min"];
    const axisPresent = axisIds.every(id => !!document.getElementById(id));
    const mktJp = document.getElementById("scr-mkt-jp");
    const mktUs = document.getElementById("scr-mkt-us");
    const marketsOk = !!mktJp && !!mktUs && mktJp.checked === true && mktUs.checked === true;
    const presetSelect = document.getElementById("scr-preset-select");
    const saveBtn = panel ? panel.querySelector('button[onclick="saveScreenerPreset()"]') : null;
    const delBtn = panel ? panel.querySelector('button[onclick="deleteScreenerPreset()"]') : null;
    const presetsOk = !!presetSelect && !!saveBtn && !!delBtn;
    const groups = panel ? [...panel.querySelectorAll(".screening-group")].map(g => g.textContent.trim()) : [];
    const groupsOk = ["割安", "収益", "安全", "成長"].every(g => groups.includes(g));
    const note = panel ? panel.querySelector(".screening-note") : null;
    const noteOk = !!note && note.textContent.includes("売買を推奨するもの");
    const termLabels = panel ? [...panel.querySelectorAll("[data-term]")] : [];
    const termOk = termLabels.length === 8;
    const isPanelVisible = panel ? getComputedStyle(panel).display !== "none" : false;
    return {
      axisPresent, marketsOk, presetsOk, groups, groupsOk, noteOk, termCount: termLabels.length, termOk, isPanelVisible,
    };
  });

  await browser.close(); server.kill();

  const ok = result.axisPresent && result.marketsOk && result.presetsOk && result.groupsOk && result.noteOk && result.termOk
    && result.isPanelVisible && errors.length === 0;

  console.log(JSON.stringify({ ...result, errors, PASS: ok }, null, 2));
  process.exit(ok ? 0 : 1);
})();
