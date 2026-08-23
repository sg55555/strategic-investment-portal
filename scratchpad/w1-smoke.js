// scratchpad/w1-smoke.js — W1 本実装の構造スモーク（PC 1440 / 390px × 財務/値動き）。
// 使い方:
//   .venv/bin/python scratchpad/w1-mock-server.py &     # /api/market/list は px 入り dump を返す
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w1-smoke.js ; kill %1
// GPUのグロー/色の見え方は対象外（実機の仕事）。DOM/例外/件数だけ見る。
const { chromium } = require("playwright");

const PORT = process.env.W1_PORT || "8210";   // モック鯖（w1-mock-server.py）と同じ env で揃える
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = "scratchpad/w1-shots";
const VIEWS = [{ name: "pc", width: 1440, height: 1000 }, { name: "mb", width: 390, height: 844 }];
const MODES = ["fin", "px"];

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  // 別 worktree の古いモック鯖が同じポートを握っていると、W1 未適用の index.html を測って
  // 偽の失敗/成功を出す。W1 の資産が配信されているかを先に確かめる。
  const [rulesRes, html] = await Promise.all([
    fetch(BASE + "portal-price-rules.js").catch(() => null),
    fetch(BASE).then((r) => r.text()).catch(() => ""),
  ]);
  if (!rulesRes || rulesRes.status !== 200 || !/id="portal-strip"/.test(html)) {
    console.log(`❌ ${BASE} は W1 適用済みのツリーを配信していません（別プロセスがポートを握っている可能性）`);
    process.exit(2);
  }
  const browser = await chromium.launch();
  let fail = 0;
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    for (const mode of MODES) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate((m) => localStorage.setItem("sip_portal_table_mode", m), mode);
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForSelector("#portal-container tbody tr", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(700);
      const s = await page.evaluate(() => ({
        cards: document.querySelectorAll(".pstrip-card").length,
        tabs: document.querySelectorAll(".pstrip-tab").length,
        pxTables: document.querySelectorAll("table.portal-px-table").length,
        finTables: document.querySelectorAll("#portal-container table.portal-table").length,
        cols: document.querySelectorAll("table.portal-px-table thead th").length,
        rows: document.querySelectorAll("#portal-container tbody tr").length,
        stale: document.querySelectorAll("tr.is-stale").length,
        sortedByC1: (document.querySelector("table.portal-px-table th.active-sort") || {}).textContent || "",
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        asofKeys: Object.keys((typeof DATA_MARKET_ASOF !== "undefined" && DATA_MARKET_ASOF) || {}).length,
      }));
      await page.screenshot({ path: `${OUT}/impl-${mode}-${v.name}.png` });
      const bad = [];
      if (s.cards !== 12) bad.push("ストリップのカード " + s.cards);
      if (s.tabs !== 4) bad.push("タブ " + s.tabs);
      if (mode === "px") {
        if (s.pxTables !== 1) bad.push("値動き表が " + s.pxTables + " 枚");
        if (s.finTables !== 0) bad.push("財務表が残っている " + s.finTables);
        if (s.cols !== (v.name === "mb" ? 4 : 8)) bad.push("列数 " + s.cols);
        if (!/前日比/.test(s.sortedByC1)) bad.push("既定ソートが前日比でない: " + s.sortedByC1);
      } else {
        if (s.pxTables !== 0) bad.push("財務モードなのに値動き表がある");
        if (s.finTables < 1) bad.push("財務表が無い");
      }
      if (s.overflowX) bad.push("横スクロール発生");
      // 鮮度（stale）経路が実際に動いているか。market_asof が空だと isStale が常に false になり、
      // バッジ・dim・ストリップ除外が一度も実行されないまま緑になる（＝無検証の ✅）。
      if (!s.asofKeys) bad.push("market_asof が空（鮮度判定が動いていない）");
      if (bad.length) fail++;
      console.log(`${v.name}/${mode}: cards=${s.cards} pxTables=${s.pxTables} finTables=${s.finTables} ` +
        `cols=${s.cols} rows=${s.rows} stale=${s.stale} asof=${s.asofKeys} ` + (bad.length ? "❌ " + bad.join(" / ") : "✅"));
    }
    const real = errs.filter((e) => !/_vercel\/insights/.test(e));
    if (real.length) { console.log(`  [${v.name}] JSエラー:`); real.slice(0, 8).forEach((e) => console.log("   - " + e)); fail++; }
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `\n❌ ${fail} 件の要確認` : "\n✅ 全ケース構造OK");
  process.exit(fail ? 1 : 0);
})();
