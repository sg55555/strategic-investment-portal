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
  check("7203.T: 副題が block（wide でも2行化＝D27）", t7203.subDisplay === "block");
  check("7203.T: 社名が本文側に残る", /トヨタ|TOYOTA|\(7203\.T\)/.test(t7203.text || ""));

  // W2: FY は従来の「経営期間トレンド」、ローリング窓は rollingLabelParts の文言に変わる。
  //  ⚠ 正規表現を緩めて「どちらでも緑」にしてはいけない（それをやると「FY ボタンを押したら
  //  期間バーも FY に戻る」という回帰が検知できなくなる）。期間を明示的に切り替え、その期間に
  //  対応する文言だけを許すこと（前 wave 単発の「7203.T の FY 副題」アサートはこのループに吸収）。
  const EXPECT = {
    FY: /^\[.*経営期間トレンド\]$/,
    "1Y": /^\[直近1年 \d{4}年\d{1,2}月 〜 \d{4}年\d{1,2}月\]$/,
    MAX: /^\[全期間 \d{4}年\d{1,2}月 〜 \d{4}年\d{1,2}月\]$/,
  };
  for (const [key, re] of Object.entries(EXPECT)) {
    await page.evaluate((k) => document.querySelector(`#w2-period-box .w2-p[data-p="${k}"]`).click(), key);
    await page.waitForTimeout(700);
    const sub = await page.evaluate(() => document.querySelector(".stock-title-sub").textContent);
    check(`7203.T ${key} の副題: ${sub}`, re.test(sub));
  }

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
