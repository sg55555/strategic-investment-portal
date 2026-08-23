// scratchpad/w15-smoke.js — W1.5 本実装の構造スモーク（PC 1440 / 390px × 指標3種 × 開閉
//   ＋ 展開の市場スコープ（Ruling 5）・社数=withPx注記・指標永続化・0件・px_error劣化は Step 3 で別途）。
// 使い方:
//   .venv/bin/python scratchpad/w15-mock-server.py &
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w15-smoke.js ; kill %1
// GPU の見え方は対象外（実機の仕事）。DOM・例外・件数・縦寸法だけ見る。
const { chromium } = require("playwright");

const PORT = process.env.W15_PORT || "8215";
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = [{ name: "pc", width: 1440, height: 1000 }, { name: "mb", width: 390, height: 844 }];
const METRICS = ["c1", "c5", "pos52"];
// モック環境固有のノイズ（本実装と無関係）。_vercel/insights は Vercel Analytics のモック鯖未実装 404
// （w1-smoke.js と同じ扱い＝本番では Vercel が配信するため実環境には存在しない）。
const IGNORE = [/\/sw\.js/, /\/api\/me/, /_vercel\/insights/];

let failed = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

// ⚠ モック鯖は比較用モック w15-variants.js も注入する。既定 variant=uni のままだと #portal-heat の
//   外に別パネル（免責文つき）が出て免責文カウント/console を汚すので、読み込むたびに off にする。
function withVariantOff(extra) {
  return Object.assign({ w15_variant: "off" }, extra || {});
}
async function setLS(page, obj) {
  await page.evaluate((o) => { for (const k in o) localStorage.setItem(k, o[k]); }, obj);
}
async function waitTiles(page) {
  await page.waitForFunction(() => document.querySelectorAll("#portal-heat .w15-tile").length > 0, { timeout: 25000 });
}
// ⚠ goto 直後に localStorage を書いて即 reload すると、goto 側の bootData fetch がまだ in-flight の
//   ことがあり、reload がそれを中断して "bootData failed TypeError: Failed to fetch" を console.error
//   に出すことがある（実装のバグではなくテスト側の競合＝goto の fetch を待たずに reload する形）。
//   goto 後にタイル描画（=bootData 完了）を待ってから reload することで競合そのものを起こさない。
async function gotoFresh(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await waitTiles(page).catch(() => {});
}
function attachErrorListeners(page, errors) {
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // ブラウザ由来の「リソース読み込み失敗」は m.text() に URL が乗らない（m.location().url を見る）。
    const url = (m.location() || {}).url || "";
    if (IGNORE.some((re) => re.test(m.text()) || re.test(url))) return;
    errors.push(`${m.text()}${url ? "  @" + url : ""}`);
  });
}

// (1) 展開の市場スコープ（Ruling 5・spec §6.2）。JP/US 両方に存在する大分類を選び、
//     押した側のタイルだけが開く／見出しに市場名が出る／社数・平均がタイルと一致する／
//     反対側の市場の同名タイルを押すと切り替わる、を反復して確かめる。
async function pickCrossMarketSector(page) {
  return page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll("#portal-heat .w15-tile"));
    const bySec = {};
    tiles.forEach((t) => { (bySec[t.dataset.sec] = bySec[t.dataset.sec] || new Set()).add(t.dataset.market); });
    return Object.keys(bySec).find((k) => bySec[k].has("JP") && bySec[k].has("US")) || null;
  });
}
function clickTile(page, sector, market) {
  return page.evaluate(({ sector, market }) => {
    const t = Array.from(document.querySelectorAll("#portal-heat .w15-tile"))
      .find((x) => x.dataset.sec === sector && x.dataset.market === market);
    if (t) t.click();
  }, { sector, market });
}
function readTileAndExpansion(page, sector) {
  return page.evaluate((sector) => {
    const tiles = Array.from(document.querySelectorAll("#portal-heat .w15-tile"));
    const jp = tiles.find((t) => t.dataset.sec === sector && t.dataset.market === "JP");
    const us = tiles.find((t) => t.dataset.sec === sector && t.dataset.market === "US");
    const numOf = (el) => {
      if (!el) return null;
      const sub = el.querySelector(".w15-t-sub");
      const mt = (sub ? sub.textContent : "").match(/(\d+)社/);
      return mt ? parseInt(mt[1], 10) : null;
    };
    const valOf = (el) => (el ? (el.querySelector(".w15-t-val") || {}).textContent : null);
    const expH = document.querySelector("#portal-heat .w15-exp-h");
    let expMarketLabel = null, expCount = null, expVal = null, expHasSector = false;
    if (expH) {
      const cloned = expH.cloneNode(true);
      const btn = cloned.querySelector(".w15-close");
      if (btn) btn.remove();
      const raw = cloned.textContent.replace(/\s+/g, " ").trim();
      expMarketLabel = raw.split("・")[0].trim();
      expHasSector = raw.indexOf(sector) !== -1;
      const cm = raw.match(/(\d+)社/);
      expCount = cm ? parseInt(cm[1], 10) : null;
      const b = expH.querySelector("b");
      expVal = b ? b.textContent.trim() : null;
    }
    return {
      jpOpen: jp ? jp.classList.contains("open") : null,
      usOpen: us ? us.classList.contains("open") : null,
      jpCount: numOf(jp), usCount: numOf(us), jpVal: valOf(jp), usVal: valOf(us),
      hasExp: !!expH, expMarketLabel, expCount, expVal, expHasSector,
    };
  }, sector);
}

async function marketScopeTest(page, viewName) {
  await gotoFresh(page);
  await setLS(page, withVariantOff({ sip_heat_metric: "c1" }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitTiles(page);

  const sector = await pickCrossMarketSector(page);
  check(`[${viewName}] JP/US 両方にある大分類が見つかる（展開スコープ検査の前提）`, !!sector, sector || "候補なし");
  if (!sector) return;

  for (let round = 1; round <= 2; round++) {
    // JP タイルを押す → JP だけ open・見出しに「日本株」・社数と平均がタイルと一致
    await clickTile(page, sector, "JP");
    await page.waitForTimeout(300);
    let s = await readTileAndExpansion(page, sector);
    check(`[${viewName}/${sector}] JPタイルを押すとJP側だけopen（${round}周目）`, s.jpOpen === true && s.usOpen === false);
    check(`[${viewName}/${sector}] 展開見出しが「日本株」＋大分類名（${round}周目）`, s.expMarketLabel === "日本株" && s.expHasSector);
    check(`[${viewName}/${sector}] JP展開の社数がタイルの社数と一致（${round}周目）`,
      s.jpCount !== null && s.jpCount === s.expCount, `tile=${s.jpCount} exp=${s.expCount}`);
    check(`[${viewName}/${sector}] JP展開の平均がタイルの表示と一致（${round}周目）`,
      s.jpVal !== null && s.jpVal === s.expVal, `tile=${s.jpVal} exp=${s.expVal}`);

    // US の同名タイルを押す → US が開いて JP が閉じる
    await clickTile(page, sector, "US");
    await page.waitForTimeout(300);
    s = await readTileAndExpansion(page, sector);
    check(`[${viewName}/${sector}] USタイルを押すとJPが閉じUSが開く（${round}周目）`, s.usOpen === true && s.jpOpen === false);
    check(`[${viewName}/${sector}] 展開見出しが「米国株」＋大分類名（${round}周目）`, s.expMarketLabel === "米国株" && s.expHasSector);
    check(`[${viewName}/${sector}] US展開の社数がタイルの社数と一致（${round}周目）`,
      s.usCount !== null && s.usCount === s.expCount, `tile=${s.usCount} exp=${s.expCount}`);
    check(`[${viewName}/${sector}] US展開の平均がタイルの表示と一致（${round}周目）`,
      s.usVal !== null && s.usVal === s.expVal, `tile=${s.usVal} exp=${s.expVal}`);

    // 次周のために閉じておく
    await clickTile(page, sector, "US");
    await page.waitForTimeout(300);
  }
}

// (2) 社数=withPx（Ruling 5(B)）。/api/market/list を route で細工し、ある市場×大分類の一部銘柄の
//     px.pos52 を欠損させて「◯社中◯社で算出」の分岐に強制的に入れる。データファイルは作らない。
async function pxWithPxNoteTest(browser, view) {
  const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height } });
  const page = await ctx.newPage();
  const errors = [];
  attachErrorListeners(page, errors);

  await gotoFresh(page);
  await setLS(page, withVariantOff({ sip_heat_metric: "pos52" }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitTiles(page);

  // window.PortalPriceRules（本実装と同じ市場/大分類判定）を使って対象を選ぶ＝
  // テスト側に別のマッピング表を複製しない。
  const target = await page.evaluate(async () => {
    const raw = await (await fetch("/api/market/list")).json();
    const buckets = {};
    for (const ticker in raw.stocks || {}) {
      const entry = raw.stocks[ticker];
      if (!entry || !entry.px) continue;
      const market = window.PortalPriceRules.marketOf(ticker, entry);
      const sector = window.PortalPriceRules.sectorOf(entry.industry, entry.type === "etf");
      const key = market + "|" + sector;
      (buckets[key] = buckets[key] || []).push(ticker);
    }
    let bestKey = null;
    for (const key in buckets) {
      if (buckets[key].length >= 4 && (!bestKey || buckets[key].length > buckets[bestKey].length)) bestKey = key;
    }
    if (!bestKey) return null;
    const [market, sector] = bestKey.split("|");
    return { market, sector, total: buckets[bestKey].length, nullTickers: buckets[bestKey].slice(0, 2) };
  });

  if (!target) {
    check(`[${view.name}] px欠損検査の対象（4社以上の市場×大分類）が見つかる`, false);
    await ctx.close();
    return;
  }
  const remain = target.total - target.nullTickers.length;
  check(`[${view.name}] px欠損検査の対象が見つかる`, true,
    `${target.market}/${target.sector} ${target.total}社中${target.nullTickers.length}社のpos52を欠損させる`);

  await ctx.route("**/api/market/list", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    for (const t of target.nullTickers) {
      if (json.stocks[t] && json.stocks[t].px) json.stocks[t].px.pos52 = null;
    }
    await route.fulfill({ response, json });
  });
  await setLS(page, withVariantOff({ sip_heat_metric: "pos52" }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitTiles(page);

  const found = await page.evaluate(({ sector, market }) => {
    const t = Array.from(document.querySelectorAll("#portal-heat .w15-tile"))
      .find((x) => x.dataset.sec === sector && x.dataset.market === market);
    return t ? { title: t.getAttribute("title") || "" } : null;
  }, target);
  check(`[${view.name}/${target.market}/${target.sector}] 欠損させたタイルがDOMに見つかる`, !!found);

  if (found) {
    const noteRe = new RegExp(`${target.total}社中${remain}社で算出`);
    check(`[${view.name}/${target.market}/${target.sector}] タイルの title に「${target.total}社中${remain}社で算出」の注記が出る`,
      noteRe.test(found.title), found.title);

    await clickTile(page, target.sector, target.market);
    await page.waitForTimeout(300);
    const exp = await page.evaluate(() => {
      const expH = document.querySelector("#portal-heat .w15-exp-h");
      if (!expH) return null;
      const cloned = expH.cloneNode(true);
      const btn = cloned.querySelector(".w15-close");
      if (btn) btn.remove();
      return cloned.textContent.replace(/\s+/g, " ").trim();
    });
    const wantSub = `${remain}社（${target.total}社中）`;
    check(`[${view.name}/${target.market}/${target.sector}] 展開見出しの社数がタイルと一致（${wantSub}）`,
      !!exp && exp.indexOf(wantSub) !== -1, exp);
  }

  check(`[${view.name}] px欠損検査中 pageerror/console.error なし`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

(async () => {
  const html = await fetch(BASE).then((r) => r.text()).catch(() => "");
  if (!/id="portal-heat"/.test(html)) {
    console.log(`❌ ${BASE} は W1.5 適用済みのツリーを配信していません`);
    process.exit(2);
  }
  const browser = await chromium.launch();
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await ctx.newPage();
    const errors = [];
    attachErrorListeners(page, errors);

    for (const metric of METRICS) {
      await gotoFresh(page);
      await setLS(page, withVariantOff({ sip_heat_metric: metric }));
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitTiles(page);

      const m = await page.evaluate(() => ({
        tiles: document.querySelectorAll("#portal-heat .w15-tile").length,
        cols: document.querySelectorAll("#portal-heat .w15-col").length,
        legend: document.querySelectorAll("#portal-heat .w15-legend").length,
        // ⚠ 免責文は既存で最大2本ある（ストリップ末尾＝常時／モードバー＝値動きモード時のみ・文言は別）。
        //    守る要件は「ヒートマップが免責文を増やさない」こと＝パネル内0件・画面全体は既存のまま。
        heatDisc: (document.getElementById("portal-heat").innerText || "").split("推奨・売買判断ではありません").length - 1,
        bodyDisc: document.body.innerText.split("推奨・売買判断ではありません").length - 1,
        docH: document.documentElement.scrollHeight,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        // (3) 指標切替の永続化：localStorage に書いてリロードした直後、点灯しているボタンが
        //     実際に描画に使われている指標と一致するか（描画とバーの状態が食い違わないこと）。
        onCtls: Array.from(document.querySelectorAll("#portal-heat .w15-ctl.on[data-metric]")).map((b) => b.dataset.metric),
      }));
      check(`[${v.name}/${metric}] タイルが出る`, m.tiles > 0, `${m.tiles}枚`);
      check(`[${v.name}/${metric}] 2カラム`, m.cols === 2);
      check(`[${v.name}/${metric}] 凡例1つ`, m.legend === 1);
      check(`[${v.name}/${metric}] ヒートマップは免責文を持たない`, m.heatDisc === 0, `${m.heatDisc}個`);
      check(`[${v.name}/${metric}] 画面の免責文は既存のまま（1〜2本）`, m.bodyDisc >= 1 && m.bodyDisc <= 2, `${m.bodyDisc}個`);
      check(`[${v.name}/${metric}] 横スクロールなし`, !m.overflowX);
      check(`[${v.name}/${metric}] 指標バーの点灯がちょうど1つ`, m.onCtls.length === 1, `[${m.onCtls.join(",")}]`);
      check(`[${v.name}/${metric}] リロード後、点灯している指標ボタンが描画中の指標と一致（永続化）`,
        m.onCtls[0] === metric, `bar=${m.onCtls[0]}`);

      // 展開（⚠ page.click() は要素を画面内へスクロールするので evaluate 経由で押す）。
      // 開閉は2周反復して確かめる（1回通っただけで合格にしない）。
      for (let round = 1; round <= 2; round++) {
        await page.evaluate(() => document.querySelector("#portal-heat .w15-tile").click());
        await page.waitForTimeout(300);
        const open = await page.evaluate(() => ({
          stocks: document.querySelectorAll("#portal-heat .w15-stock").length,
          docH: document.documentElement.scrollHeight,
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }));
        check(`[${v.name}/${metric}] 展開で銘柄タイルが出る（${round}周目）`, open.stocks > 0, `${open.stocks}枚`);
        check(`[${v.name}/${metric}] 展開後も横スクロールなし（${round}周目）`, !open.overflowX);
        check(`[${v.name}/${metric}] 展開でページが伸びる（${round}周目）`, open.docH > m.docH, `${m.docH}→${open.docH}px`);

        await page.evaluate(() => document.querySelector("#portal-heat .w15-tile").click());
        await page.waitForTimeout(300);
        const closed = await page.evaluate(() => document.querySelectorAll("#portal-heat .w15-stock").length);
        check(`[${v.name}/${metric}] 再クリックで閉じる（${round}周目）`, closed === 0);
      }
    }

    // (1) 展開の市場スコープ（Ruling 5）
    await marketScopeTest(page, v.name);

    // 0件フィルタ → パネルが消える（表側が「見つかりません」を出す）
    await gotoFresh(page);
    await setLS(page, withVariantOff({}));
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitTiles(page);
    await page.fill("#portal-search", "該当しない検索語zzz");
    await page.waitForTimeout(600);
    const empty = await page.evaluate(() => document.getElementById("portal-heat").innerHTML.trim().length);
    check(`[${v.name}] 0件でパネルが消える`, empty === 0);

    check(`[${v.name}] pageerror / console.error なし`, errors.length === 0, errors.join(" | "));
    await ctx.close();

    // (2) 社数=withPx（別コンテキストで route 細工。メインの errors とは独立集計）
    await pxWithPxNoteTest(browser, v);
  }
  await browser.close();
  console.log(failed ? `\n❌ ${failed}件 FAIL` : "\n✅ ALL PASS");
  process.exit(failed ? 1 : 0);
})();
