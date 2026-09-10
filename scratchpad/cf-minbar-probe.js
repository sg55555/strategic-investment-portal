// minBarLength:3 が「差分ゼロの段」にも下限を効かせてしまわないかを実測で確かめる。
// （detail-charts.js のコメント「0 の段は 0 のまま」の裏取り。嘘のコメントを残さないため）
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  await p.goto(`http://127.0.0.1:${process.env.CF_PORT || 8231}/`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => typeof Chart !== "undefined");
  const out = await p.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = 600; cv.height = 300;
    cv.style.width = "600px"; cv.style.height = "300px";
    document.body.appendChild(cv);
    const ch = new Chart(cv.getContext("2d"), {
      type: "bar",
      data: {
        labels: ["ゼロ", "極小", "普通", "負のゼロ幅"],
        datasets: [{ data: [[100, 100], [100, 100.5], [0, 1000], [500, 500]], minBarLength: 3 }],
      },
      options: { responsive: false, animation: false, plugins: { legend: { display: false }, datalabels: { display: false } } },
    });
    const meta = ch.getDatasetMeta(0);
    const r = meta.data.map((el, i) => {
      const pr = el.getProps(["y", "base"], true);
      return { label: ch.data.labels[i], px: Math.round(Math.abs(pr.base - pr.y) * 100) / 100 };
    });
    ch.destroy(); cv.remove();
    return r;
  });
  console.log(JSON.stringify(out));
  await b.close();
})();
