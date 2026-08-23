// scratchpad/w1-edge-check.js — W1 の「常設スモークでは通らない経路」を実ブラウザで確認する。
//   1) stale 銘柄（EA=08/10）が値動き表で is-stale＋日付バッジ＋dim になり、ストリップからは除外され件数が出る
//   2) px_error=true（価格集計だけ失敗）で財務表が残り、モードバーが [財務] 固定＋[値動き] 無効で復帰できる
//   3) ストリップのタブ切替で表が再構築されない（窓化とスクロール位置が保持される）
//   4) 値動き表の sticky ヘッダが 1440px で実際に固定される
// 使い方:
//   .venv/bin/python scratchpad/w1-mock-server.py &
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w1-edge-check.js ; kill %1
const { chromium } = require("playwright");

const PORT = process.env.W1_PORT || "8210";
const BASE = `http://127.0.0.1:${PORT}/`;
const fails = [];
function check(name, ok, detail) {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) fails.push(name);
}

(async () => {
  const browser = await chromium.launch();

  // ── 1) stale 銘柄の見え方 ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("sip_portal_table_mode", "px"));
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.fill("#portal-search", "Electronic Arts");
    await page.waitForTimeout(700);
    const s = await page.evaluate(() => ({
      rows: document.querySelectorAll("table.portal-px-table tbody tr").length,
      staleRows: document.querySelectorAll("table.portal-px-table tbody tr.is-stale").length,
      badge: (document.querySelector(".pstale") || {}).textContent || "",
      opacity: (() => { const tr = document.querySelector("tr.is-stale"); return tr ? getComputedStyle(tr.querySelector("td")).opacity : ""; })(),
      head: (document.querySelector(".pstrip-head") || {}).textContent || "",
      cards: document.querySelectorAll(".pstrip-card").length,
    }));
    check("stale: EA 1行が is-stale", s.rows === 1 && s.staleRows === 1, `rows=${s.rows} stale=${s.staleRows}`);
    check("stale: 日付バッジ 08/10", s.badge.trim() === "08/10", `badge="${s.badge.trim()}"`);
    check("stale: 行が減光される", s.opacity !== "" && Number(s.opacity) < 1, `opacity=${s.opacity}`);
    check("stale: ストリップから除外され件数が出る", /価格が古いため除外/.test(s.head) && s.cards === 0, s.head.replace(/\s+/g, " ").trim());
    await page.close();
  }

  // ── 2) px_error の劣化 ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route("**/api/market/list", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      for (const k of Object.keys(json.stocks)) delete json.stocks[k].px;   // 価格集計だけ落ちた状態
      json.market_asof = {};
      json.px_error = true;
      await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(json) });
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("sip_portal_table_mode", "px"));  // 値動きモードの記憶あり
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => ({
      finTables: document.querySelectorAll("#portal-container table.portal-table").length,
      pxTables: document.querySelectorAll("table.portal-px-table").length,
      rows: document.querySelectorAll("#portal-container tbody tr").length,
      modeButtons: document.querySelectorAll(".pmode-seg button").length,
      pxDisabled: !!(document.querySelector('.pmode-seg button[data-mode="px"]') || {}).disabled,
      finActive: !!document.querySelector('.pmode-seg button[data-mode="fin"].active'),
      stripText: (document.getElementById("portal-strip") || {}).textContent || "",
    }));
    check("px_error: 財務表が残る", s.finTables >= 1 && s.pxTables === 0 && s.rows > 0, `fin=${s.finTables} px=${s.pxTables} rows=${s.rows}`);
    check("px_error: モードバーが残り [財務] 固定・[値動き] 無効", s.modeButtons === 2 && s.pxDisabled && s.finActive,
      `buttons=${s.modeButtons} disabled=${s.pxDisabled} finActive=${s.finActive}`);
    check("px_error: ストリップは注意文だけ", /取得できません/.test(s.stripText), s.stripText.replace(/\s+/g, " ").trim().slice(0, 60));
    await page.close();
  }

  // ── 3) タブ切替で表が再構築されない ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("sip_portal_table_mode", "px"));
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => ({
      y: Math.round(window.scrollY),
      rows: document.querySelectorAll("table.portal-px-table tbody tr").length,
      firstRow: (document.querySelector("table.portal-px-table tbody tr") || {}).dataset?.ticker || "",
    }));
    // ⚠ page.click() は要素を画面内へスクロールしてから押すため、画面上部にあるタブでは
    //    スクロール位置が必ず 0 に戻る（テスト由来の副作用）。実ユーザーの操作を再現するため
    //    ここでは DOM の click() を直接呼ぶ。
    await page.evaluate(() => document.querySelector('.pstrip-tab[data-tab="vol"]').click());
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      y: Math.round(window.scrollY),
      rows: document.querySelectorAll("table.portal-px-table tbody tr").length,
      firstRow: (document.querySelector("table.portal-px-table tbody tr") || {}).dataset?.ticker || "",
      activeTab: (document.querySelector(".pstrip-tab.active") || {}).textContent || "",
    }));
    check("タブ切替: スクロール位置が保持される", Math.abs(after.y - before.y) < 50, `${before.y} → ${after.y}`);
    check("タブ切替: 表が再構築されない", after.rows >= before.rows && after.firstRow === before.firstRow,
      `rows ${before.rows}→${after.rows} first ${before.firstRow}→${after.firstRow}`);
    check("タブ切替: タブは切り替わっている", /出来高急増/.test(after.activeTab), after.activeTab);
    await page.close();
  }

  // ── 4) sticky ヘッダ ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("sip_portal_table_mode", "px"));
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const th = document.querySelector("table.portal-px-table thead th");
      const box = th.getBoundingClientRect();
      return { top: Math.round(box.top), visible: box.top >= -1 && box.top < window.innerHeight };
    });
    check("sticky: 1440px で列ヘッダが画面内に残る", r.visible, `th.top=${r.top}`);
    await page.close();
  }

  await browser.close();
  console.log(fails.length ? `\n❌ ${fails.length} 件 NG: ${fails.join(" / ")}` : "\n✅ エッジ経路すべてOK");
  process.exit(fails.length ? 1 : 0);
})();
