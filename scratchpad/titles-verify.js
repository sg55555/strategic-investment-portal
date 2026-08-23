// spec §6.4 受入: G1 二重ティッカー解消・G2 ETF 文言・G3 副題行分離（描画側）。
// 実行: PLAN2_PORT=8200 で mock 鯖起動後、NODE_PATH=/home/shugo/node_modules node scratchpad/titles-verify.js
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  const open = async (t) => { await page.evaluate((tk) => navigateToDetail(tk), t); await page.waitForTimeout(900); };
  const title = () => page.evaluate(() => {
    const el = document.getElementById("stock-title");
    const sub = el ? el.querySelector(".stock-title-sub") : null;
    const head = document.querySelector("#active-company-header .company-title-main");
    return {
      text: el ? el.textContent : null,
      subText: sub ? sub.textContent : null,
      subDisplay: sub ? getComputedStyle(sub).display : null,
      headText: head ? head.textContent : null,
    };
  });

  // ── SPY（社名が既に "(SPY)" を含む ETF）──
  await open("SPY");
  const spy = await title();
  check("SPY: #stock-title に (SPY) (SPY) を含まない", !/\(SPY\)\s*\(SPY\)/.test(spy.text || ""));
  check("SPY: ヘッダ社名にも (SPY) (SPY) を含まない", !/\(SPY\)\s*\(SPY\)/.test(spy.headText || ""));
  check("SPY: ETF タイトルに『経営期間トレンド』を含まない", !/経営期間トレンド/.test(spy.text || ""));

  // ── 7203.T（株式・非退行）──
  await open("7203.T");
  const t7203 = await title();
  check("7203.T: 副題 span が存在", !!t7203.subText);
  check("7203.T: 副題が [..] 注記（経営期間トレンド）", /^\[.*経営期間トレンド\]$/.test((t7203.subText || "").trim()));
  check("7203.T: 副題が block（wide でも2行化＝D27）", t7203.subDisplay === "block");
  check("7203.T: 社名が本文側に残る", /トヨタ|TOYOTA|\(7203\.T\)/.test(t7203.text || ""));

  // ── 480px（narrow）──
  await page.setViewportSize({ width: 480, height: 900 });
  await open("7203.T");
  const narrow = await title();
  check("480px: .stock-title-sub が block", narrow.subDisplay === "block");
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
