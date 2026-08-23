// spec §5.3 受入: D1 空 span 全廃＋ctrl-pair 密着 / D2 展開時のヘッダ desc 非表示。
//  ⚠ `:empty` 判定は不採用（injectTermHelp 注入後は修正前でも常に0件＝識別力なし）。
// 実行: PLAN2_PORT=8200 で mock 鯖起動後、NODE_PATH=/home/shugo/node_modules node scratchpad/toolbar-terms-verify.js
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(1200);

  // ① data-term を持つグループラベルはすべて自前テキストを持つ（空 span 全廃の検収）
  const labels = await page.evaluate(() => [...document.querySelectorAll(".ma-control-bar .ma-label[data-term]")]
    .map((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim()));
  check(`① .ma-label[data-term] が2件以上（${labels.length}件）`, labels.length >= 2);
  check("① .ma-label[data-term] は全てテキスト非空", labels.length > 0 && labels.every((t) => t.length > 0));

  // ② ボタン固有概念は ctrl-pair でボタン直後に「?」が入る（4件）
  const pairs = await page.evaluate(() => [...document.querySelectorAll(".ctrl-pair > .term-help")]
    .map((h) => ({
      prevTag: h.previousElementSibling ? h.previousElementSibling.tagName : null,
      term: h.parentElement.dataset.term,
      sameRow: Math.abs(h.getBoundingClientRect().top - h.previousElementSibling.getBoundingClientRect().top) < 12,
    })));
  check(`② .ctrl-pair > .term-help が4件（${pairs.length}件）`, pairs.length === 4);
  check("② 各 ? の previousElementSibling が button", pairs.length === 4 && pairs.every((p) => p.prevTag === "BUTTON"));
  check("② term は keltner/sr/zigzag/vwap", JSON.stringify(pairs.map((p) => p.term).sort()) === JSON.stringify(["keltner", "sr", "vwap", "zigzag"]));

  // ②' 480px の flex-wrap でもボタンと ? が同一行（迷子の最悪ケース根絶）
  await page.setViewportSize({ width: 480, height: 900 });
  await page.waitForTimeout(400);
  const narrowPairs = await page.evaluate(() => [...document.querySelectorAll(".ctrl-pair > .term-help")]
    .map((h) => Math.abs(h.getBoundingClientRect().top - h.previousElementSibling.getBoundingClientRect().top) < 12));
  check("②' 480px でもボタンと ? が同一行", narrowPairs.length === 4 && narrowPairs.every(Boolean));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);

  // ③ 展開時にヘッダ desc が消え、折り畳みで復帰
  const acc = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const item = document.querySelector(".acc-item");
    if (!item) return null;
    const desc = item.querySelector(".acc-desc");
    const head = item.querySelector(".acc-head");
    if (!item.classList.contains("expanded")) { head.click(); await wait(500); }
    const expanded = getComputedStyle(desc).display;
    head.click(); await wait(500);
    const collapsed = getComputedStyle(desc).display;
    head.click(); await wait(500);   // 元の展開状態へ戻す（後続ゲートへの副作用を残さない）
    return { expanded, collapsed };
  });
  check("③ 展開時 .acc-desc の display=none", !!acc && acc.expanded === "none");
  check("③ 折り畳みで .acc-desc が復帰", !!acc && acc.collapsed !== "none");
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
