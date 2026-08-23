/* W1.5「セクターヒートマップ」実物比較モック（scratchpad/w15-mock-server.py が注入）。
 *
 * 確定済みの設計（2026-08-23 ブレスト）:
 *   ・面の主役 = 業種サマリ主体＋展開（289銘柄のタイルを常時出さない＝モバイル縦長の構造的解決）
 *   ・54業種 → 13大分類の対応表は rules 層の純関数に持つ（DB/ETL 非接触・未知業種は「その他」へ）
 *
 * ここで見比べる3案（第1層のレイアウトだけが違う。第2層＝展開は共通）:
 *   案A 統合グリッド : 13大分類を均等タイルで1枚に。JP/US は1つのタイルの中で内訳バーとして見る。
 *   案B 面積グリッド : 同じ13大分類を「時価総額の大きさ＝タイルの面積」で敷き詰める（treemap）。
 *   案C 市場別2カラム: 日本株 / 米国株 を別カラムにして、それぞれの大分類タイルを並べる。
 *
 * 共通で切り替えられるもの: 指標（1日 / 5日 / 52週レンジ内位置）・平均の取り方（単純 / 時価総額加重）。
 * 右下の切替バーに「縦 NNNNpx」を出す＝モバイル縦長（現モックは 4758px）の是正を数値で確認できる。
 *
 * ⚠ このファイルはモック専用。決まった案だけを spec/plan 経由で本実装する（本番コードには入れない）。
 * ⚠ 時価総額は JP=円 / US=ドルの混在なので、モックでは固定レート FX_JPY_PER_USD で換算している。
 *    案B/加重平均を採る場合、レートの出所は spec で決める必要がある（この注記自体が論点）。
 */
(function () {
  "use strict";

  var LS_V = "w15_variant", LS_M = "w15_metric", LS_W = "w15_weight";
  var variant = localStorage.getItem(LS_V) || "uni";      // off | uni | tree | dual
  var metric = localStorage.getItem(LS_M) || "c1";        // c1 | c5 | pos52
  var weight = localStorage.getItem(LS_W) || "eq";        // eq | cap
  var openSector = null;                                  // 展開中の大分類（1つだけ＝アコーディオン）

  var FX_JPY_PER_USD = 150;
  var esc = window.esc || function (s) { return String(s == null ? "" : s); };

  /* ───────── 54業種 → 13大分類（本実装では portal-price-rules.js の sectorOf に置く） ───────── */
  var SECTOR_MAP = {
    // テクノロジー
    "US - テクノロジー": "テクノロジー", "US - クラウド・SaaS": "テクノロジー", "US - 半導体・AI": "テクノロジー",
    "US - SNS・AI": "テクノロジー", "US - EC・クラウド": "テクノロジー", "US - 広告・クラウド": "テクノロジー",
    "US - 決済・フィンテック": "テクノロジー",
    "電気機器・半導体": "テクノロジー", "精密機器・半導体": "テクノロジー", "電機・ITサービス": "テクノロジー",
    "電機・インフラIT": "テクノロジー", "テクノロジー・家電": "テクノロジー", "情報通信": "テクノロジー",
    "情報通信・巨大投資": "テクノロジー",
    // 金融
    "US - 銀行・金融": "金融", "US - 保険": "金融", "US - 証券・資産運用": "金融",
    "銀行・金融": "金融", "保険": "金融", "証券・金融サービス": "金融",
    // ヘルスケア
    "US - 医薬品・バイオ": "ヘルスケア", "医薬品・バイオ": "ヘルスケア",
    // 資本財
    "US - 資本財・防衛": "資本財", "重工・防衛": "資本財", "産業用ロボット": "資本財", "空調・産業機器": "資本財",
    // 一般消費財
    "US - 小売・流通": "一般消費財", "US - 飲食・外食": "一般消費財", "US - 自動車": "一般消費財",
    "US - 電気自動車・エネルギー": "一般消費財", "US - エンターテインメント": "一般消費財",
    "小売業": "一般消費財", "自動車・輸送機器": "一般消費財", "自動車部品・電装": "一般消費財",
    "エンターテインメント": "一般消費財",
    // 生活必需品
    "US - 生活必需品": "生活必需品", "食品・飲料": "生活必需品",
    // 素材
    "US - 素材・化学": "素材", "化学・素材": "素材", "総合商社": "素材",
    // エネルギー / 公益 / 通信 / 不動産 / 運輸
    "US - エネルギー": "エネルギー",
    "US - 公益事業": "公益", "電力・ガス": "公益",
    "US - 通信": "通信",
    "US - REIT・不動産": "不動産", "不動産": "不動産",
    "US - 運輸・物流": "運輸", "運輸・インフラ": "運輸",
  };
  // 面の並び順（社数でなく意味で固定＝フィルタで社数が変わっても並びが踊らない）
  var SECTOR_ORDER = ["テクノロジー", "金融", "ヘルスケア", "一般消費財", "生活必需品", "資本財",
    "素材", "エネルギー", "公益", "通信", "不動産", "運輸", "ETF", "その他"];

  function sectorOf(industry, type) {
    if ((type || "stock") === "etf" || String(industry || "").indexOf("ETF") !== -1) return "ETF";
    return SECTOR_MAP[industry] || "その他";
  }

  /* ───────── 指標 ───────── */
  var METRICS = {
    c1: { label: "1日", cap: 3, center: 0, unit: "%", digits: 2, signed: true, note: "前日比（±3%で振り切り）" },
    c5: { label: "5日", cap: 6, center: 0, unit: "%", digits: 2, signed: true, note: "5営業日騰落（±6%で振り切り）" },
    pos52: { label: "52週位置", cap: 50, center: 50, unit: "", digits: 0, signed: false, note: "52週レンジ内の位置（0=安値 / 100=高値）" },
  };
  function valOf(px) {
    if (!px) return null;
    var v = px[metric];
    return (v == null || !isFinite(v)) ? null : v;
  }
  function fmtVal(v) {
    var m = METRICS[metric];
    if (v == null || !isFinite(v)) return "--";
    if (!m.signed) return v.toFixed(m.digits);
    return (v > 0 ? "+" : "") + v.toFixed(m.digits) + m.unit;
  }

  /* ───────── 発散カラースケール（2色＋中立グレー・5段） ─────────
   * 中立は面の地色に寄せたグレー＝0（中央値）が「色がついていない」に見える。
   * タイル上の数値は塗りの濃さで白/黒を出し分ける（濃い段で白文字にすると読めないため）。 */
  var NEUTRAL = [35, 46, 56], UP = [0, 200, 110], DOWN = [255, 70, 105];
  var STEPS = [0.20, 0.42, 0.62, 0.82, 1.0];
  function mix(a, b, t) {
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," +
      Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")";
  }
  function stepOf(v) {
    var m = METRICS[metric];
    if (v == null || !isFinite(v)) return null;
    var d = (v - m.center) / m.cap;                       // -1..+1
    var t = Math.min(1, Math.abs(d));
    if (t < 0.06) return { i: -1, up: d >= 0 };           // 中立
    for (var i = 0; i < STEPS.length; i++) if (t <= STEPS[i] || i === STEPS.length - 1) return { i: i, up: d >= 0 };
    return { i: STEPS.length - 1, up: d >= 0 };
  }
  function fillOf(v) {
    var s = stepOf(v);
    if (!s) return "rgba(120,140,150,.10)";               // データ無し
    if (s.i < 0) return mix(NEUTRAL, NEUTRAL, 0);
    return mix(NEUTRAL, s.up ? UP : DOWN, STEPS[s.i]);
  }
  function inkOf(v) {
    var s = stepOf(v);
    return (s && s.i >= 3) ? "#06121a" : "#eaf6fb";       // 濃い2段は黒文字
  }

  /* ───────── 集計 ───────── */
  function capOf(e) {
    var c = e.marketCap || 0;
    if (!c) return 0;
    return (e.currency === "USD") ? c * FX_JPY_PER_USD : c;
  }
  function aggregate(entries) {
    var vals = [], caps = [], up = 0, down = 0, capSum = 0;
    entries.forEach(function (e) {
      var v = valOf(e.px);
      if (v == null) return;
      vals.push(v); caps.push(capOf(e)); capSum += capOf(e);
      var d = v - METRICS[metric].center;
      if (d > 0) up++; else if (d < 0) down++;
    });
    if (!vals.length) return { v: null, n: entries.length, up: 0, down: 0, cap: 0 };
    var v;
    if (weight === "cap" && capSum > 0) {
      var s = 0;
      for (var i = 0; i < vals.length; i++) s += vals[i] * caps[i];
      v = s / capSum;
    } else {
      v = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    }
    return { v: v, n: entries.length, up: up, down: down, cap: capSum };
  }
  function groupBySector(list) {
    var g = {};
    list.forEach(function (it) {
      var s = sectorOf(it.industry, it.isEtf ? "etf" : "stock");
      (g[s] = g[s] || []).push(it);
    });
    return SECTOR_ORDER.filter(function (s) { return g[s]; })
      .map(function (s) { var a = aggregate(g[s]); a.key = s; a.items = g[s]; return a; });
  }

  /* ───────── treemap（squarified・案B） ───────── */
  function squarify(items, X, Y, W, H) {
    var out = [], total = 0;
    items.forEach(function (i) { total += Math.max(i.w, 1e-9); });
    if (!items.length || total <= 0) return out;
    var scale = (W * H) / total;
    var nodes = items.map(function (i) { return { d: i, a: Math.max(i.w, 1e-9) * scale }; });
    (function layout(list, x, y, w, h) {
      if (!list.length || w <= 0 || h <= 0) return;
      if (list.length === 1) { out.push({ d: list[0].d, x: x, y: y, w: w, h: h }); return; }
      var short = Math.min(w, h), row = [], rowArea = 0, best = Infinity, i = 0;
      while (i < list.length) {
        var next = row.concat([list[i]]), area = rowArea + list[i].a, mx = 0, mn = Infinity;
        next.forEach(function (n) { mx = Math.max(mx, n.a); mn = Math.min(mn, n.a); });
        var ratio = Math.max((short * short * mx) / (area * area), (area * area) / (short * short * mn));
        if (!row.length || ratio <= best) { row = next; rowArea = area; best = ratio; i++; } else break;
      }
      var len = rowArea / short, ox = x, oy = y;
      row.forEach(function (n) {
        var t = n.a / len;
        if (w >= h) { out.push({ d: n.d, x: ox, y: oy, w: len, h: t }); oy += t; }
        else { out.push({ d: n.d, x: ox, y: oy, w: t, h: len }); ox += t; }
      });
      if (w >= h) layout(list.slice(row.length), x + len, y, w - len, h);
      else layout(list.slice(row.length), x, y + len, w, h - len);
    })(nodes, X, Y, W, H);
    return out;
  }

  /* ───────── 描画 ───────── */
  function tileLabel(e) {
    if (String(e.ticker).indexOf(".T") === -1) return e.ticker;
    var n = String(e.name || "").replace(/(ホールディングス|グループ本社|グループ|株式会社|・|　| )/g, "");
    return n.slice(0, 4) || String(e.ticker).replace(".T", "");
  }
  function go(t) { if (typeof window.navigateToDetail === "function") window.navigateToDetail(t); }

  function sectorTile(a, extraStyle, cls) {
    var pct = a.n ? Math.round((a.up / Math.max(1, a.up + a.down)) * 100) : 0;
    return '<button type="button" class="w15-tile' + (cls ? " " + cls : "") +
      (openSector === a.key ? " open" : "") + '" data-sec="' + esc(a.key) + '"' +
      ' style="background:' + fillOf(a.v) + ';color:' + inkOf(a.v) + ';' + (extraStyle || "") + '"' +
      ' title="' + esc(a.key) + " " + a.n + "社 / " + fmtVal(a.v) + '">' +
      '<span class="w15-t-name">' + esc(a.key) + "</span>" +
      '<span class="w15-t-val">' + fmtVal(a.v) + "</span>" +
      '<span class="w15-t-sub">' + a.n + "社　" +
      '<i class="w15-bar"><i style="width:' + pct + '%"></i></i></span></button>';
  }

  function expansion(aggs) {
    if (!openSector) return "";
    var hit = aggs.filter(function (a) { return a.key === openSector; })[0];
    if (!hit) return "";
    var byInd = {};
    hit.items.forEach(function (it) { (byInd[it.industry] = byInd[it.industry] || []).push(it); });
    var inds = Object.keys(byInd).sort(function (a, b) { return byInd[b].length - byInd[a].length; });
    var blocks = inds.map(function (ind) {
      var g = byInd[ind].slice().sort(function (a, b) {
        var x = valOf(a.px), y = valOf(b.px);
        return (y == null ? -Infinity : y) - (x == null ? -Infinity : x);
      });
      var tiles = g.map(function (e) {
        var v = valOf(e.px);
        return '<button type="button" class="w15-stock" data-t="' + esc(e.ticker) + '"' +
          ' style="background:' + fillOf(v) + ';color:' + inkOf(v) + '"' +
          ' title="' + esc(e.name) + " " + esc(e.ticker) + " " + fmtVal(v) + '">' +
          '<span class="w15-s-name">' + esc(tileLabel(e)) + "</span>" +
          '<span class="w15-s-val">' + fmtVal(v) + "</span></button>";
      }).join("");
      return '<div class="w15-ind"><div class="w15-ind-h" data-ind="' + esc(ind) + '">' +
        esc(String(ind).replace("US - ", "")) + ' <span>' + g.length + "社 ・ 表をこの業種に絞る</span></div>" +
        '<div class="w15-stocks">' + tiles + "</div></div>";
    }).join("");
    var a = aggregate(hit.items);
    return '<div class="w15-exp"><div class="w15-exp-h">' + esc(openSector) +
      '　<b style="color:' + (a.v == null ? "#7f95a3" : (a.v - METRICS[metric].center >= 0 ? "#00e676" : "#ff5c7a")) +
      '">' + fmtVal(a.v) + "</b>　" + hit.n + "社　" +
      '<button type="button" class="w15-close">閉じる ✕</button></div>' + blocks + "</div>";
  }

  function legend() {
    var m = METRICS[metric], sw = [];
    for (var i = STEPS.length - 1; i >= 0; i--) sw.push('<i style="background:' + mix(NEUTRAL, DOWN, STEPS[i]) + '"></i>');
    sw.push('<i style="background:' + mix(NEUTRAL, NEUTRAL, 0) + '"></i>');
    for (var j = 0; j < STEPS.length; j++) sw.push('<i style="background:' + mix(NEUTRAL, UP, STEPS[j]) + '"></i>');
    return '<div class="w15-legend"><span>' + (m.signed ? "下落" : "安値圏") + "</span>" + sw.join("") +
      "<span>" + (m.signed ? "上昇" : "高値圏") + "</span><span class='w15-note'>" + esc(m.note) + "</span></div>";
  }

  function renderUni(host, aggs) {
    host.innerHTML =
      '<div class="w15-cap">市場の温度感　<b>' + esc(METRICS[metric].label) + "</b>　/　13の大分類（クリックで中の銘柄を展開）</div>" +
      '<div class="w15-panel"><div class="w15-grid">' +
      aggs.map(function (a) { return sectorTile(a); }).join("") + "</div>" +
      legend() + expansion(aggs) +
      '<div class="w15-disc">終値ベースの事実の可視化です（推奨・売買判断ではありません）。</div></div>';
  }

  function renderTree(host, aggs) {
    // ⚠ host は :empty のとき display:none ＝ clientWidth が 0 になる。親の幅で測る。
    var box = host.parentElement || document.body;
    var W = Math.max(320, (host.clientWidth || box.clientWidth || 960)) - 34;   // panel padding 分
    var H = window.innerWidth < 760 ? 300 : 260;
    var items = aggs.map(function (a) { return { a: a, w: a.cap }; });
    var pos = 0;
    items.forEach(function (i) { if (i.w > 0) pos = Math.max(pos, i.w); });
    var floor = pos * 0.012 || 1;                              // 時価総額 0（ETF等）でも消えないように床を与える
    items.forEach(function (i) { i.w = Math.max(i.w, floor); });
    items.sort(function (x, y) { return y.w - x.w; });
    var cells = squarify(items, 0, 0, W, H);
    var tiles = cells.map(function (c) {
      // 極小タイルは「値だけ」（名前を残すと値の方が ellipsis で切れる＝一番読みたい数字が消える）
      var cls = (c.w < 74 || c.h < 44) ? "xs" : ((c.w < 96 || c.h < 66) ? "sm" : "");
      return sectorTile(c.d.a,
        "position:absolute;left:" + c.x.toFixed(1) + "px;top:" + c.y.toFixed(1) + "px;" +
        "width:" + Math.max(0, c.w - 3).toFixed(1) + "px;height:" + Math.max(0, c.h - 3).toFixed(1) + "px;",
        cls);
    }).join("");
    host.innerHTML =
      '<div class="w15-cap">市場の温度感　<b>' + esc(METRICS[metric].label) + "</b>　/　面積＝時価総額（1ドル=" + FX_JPY_PER_USD + "円で換算）</div>" +
      '<div class="w15-panel"><div class="w15-tree" style="height:' + H + 'px">' + tiles + "</div>" +
      legend() + expansion(aggs) +
      '<div class="w15-disc">終値ベースの事実の可視化です（推奨・売買判断ではありません）。</div></div>';
  }

  function renderDual(host, list) {
    function col(title, pred) {
      var aggs = groupBySector(list.filter(pred));
      if (!aggs.length) return '<div class="w15-col"><h4>' + esc(title) + '</h4><div class="w15-empty">該当なし</div></div>';
      return '<div class="w15-col"><h4>' + esc(title) + '</h4><div class="w15-grid sm">' +
        aggs.map(function (a) { return sectorTile(a); }).join("") + "</div></div>";
    }
    var allAggs = groupBySector(list);
    host.innerHTML =
      '<div class="w15-cap">市場の温度感　<b>' + esc(METRICS[metric].label) + "</b>　/　市場ごとに大分類を並べる</div>" +
      '<div class="w15-panel"><div class="w15-cols">' +
      col("日本株", function (it) { return it.country === "JP"; }) +
      col("米国株", function (it) { return it.country === "US"; }) + "</div>" +
      legend() + expansion(allAggs) +
      '<div class="w15-disc">終値ベースの事実の可視化です（推奨・売買判断ではありません）。</div></div>';
  }

  /* ───────── 配線 ───────── */
  function hostEl() {
    var h = document.getElementById("w15-host");
    if (!h) {
      var strip = document.getElementById("portal-strip");
      if (!strip || !strip.parentNode) return null;
      h = document.createElement("div");
      h.id = "w15-host";
      strip.parentNode.insertBefore(h, strip);
    }
    return h;
  }

  function render(list) {
    var host = hostEl();
    if (!host) return;
    if (variant === "off") { host.innerHTML = ""; updateHeight(); return; }
    var withPx = (list || []).filter(function (it) { return it.px; });
    if (!withPx.length) { host.innerHTML = ""; updateHeight(); return; }
    if (variant === "dual") renderDual(host, withPx);
    else if (variant === "tree") renderTree(host, groupBySector(withPx));
    else renderUni(host, groupBySector(withPx));

    host.querySelectorAll(".w15-tile").forEach(function (el) {
      el.onclick = function () {
        openSector = (openSector === el.dataset.sec) ? null : el.dataset.sec;
        render(window.__w15host.list());
      };
    });
    host.querySelectorAll(".w15-stock").forEach(function (el) { el.onclick = function () { go(el.dataset.t); }; });
    host.querySelectorAll(".w15-ind-h").forEach(function (el) {
      el.onclick = function () { window.__w15host.setSector(el.dataset.ind); };
    });
    var close = host.querySelector(".w15-close");
    if (close) close.onclick = function () { openSector = null; render(window.__w15host.list()); };
    updateHeight();
  }

  function updateHeight() {
    var el = document.getElementById("w15-h");
    if (el) el.textContent = "縦 " + document.documentElement.scrollHeight + "px";
  }

  var VARIANTS = [{ key: "off", label: "現行" }, { key: "uni", label: "A 統合" },
    { key: "tree", label: "B 面積" }, { key: "dual", label: "C 市場別" }];
  function renderSwitch() {
    var bar = document.getElementById("w15-switch");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "w15-switch";
      document.body.appendChild(bar);
    }
    function grp(label, opts, cur, onPick) {
      return "<b>" + label + "</b>" + opts.map(function (o) {
        return '<button type="button" data-g="' + onPick + '" data-k="' + o.key + '"' +
          (o.key === cur ? ' class="on"' : "") + ">" + o.label + "</button>";
      }).join("");
    }
    bar.innerHTML =
      grp("案", VARIANTS, variant, "v") +
      grp("指標", [{ key: "c1", label: "1日" }, { key: "c5", label: "5日" }, { key: "pos52", label: "52週位置" }], metric, "m") +
      grp("平均", [{ key: "eq", label: "単純" }, { key: "cap", label: "時価総額" }], weight, "w") +
      '<span id="w15-h" class="w15-hh"></span>';
    bar.querySelectorAll("button").forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.k;
        if (b.dataset.g === "v") { variant = k; localStorage.setItem(LS_V, k); }
        else if (b.dataset.g === "m") { metric = k; localStorage.setItem(LS_M, k); }
        else { weight = k; localStorage.setItem(LS_W, k); }
        renderSwitch();
        render(window.__w15host.list());
      };
    });
    updateHeight();
  }

  var CSS = `
  #w15-host { margin: 0 0 18px; }
  #w15-host:empty { display: none; }
  .w15-cap { font-size: 12px; color: var(--ix-text-dim); margin: 0 0 8px; }
  .w15-cap b { color: var(--ix-text); font-weight: 600; }
  .w15-panel { background: var(--ix-surface-panel); border: 1px solid var(--ix-border);
               border-radius: 4px; padding: 14px 16px 12px; }
  .w15-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 6px; }
  .w15-grid.sm { grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); }
  .w15-tile { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; justify-content: center;
              min-height: 74px; padding: 9px 10px; border-radius: 4px; cursor: pointer;
              border: 1px solid rgba(255,255,255,.06); font-family: inherit; text-align: left; overflow: hidden; }
  .w15-tile:hover { outline: 1px solid var(--ix-cyan); outline-offset: -1px; }
  .w15-tile.open { outline: 2px solid var(--ix-cyan); outline-offset: -2px; }
  .w15-t-name { font-size: 12px; opacity: .92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .w15-t-val { font-family: var(--ix-mono); font-size: 19px; font-weight: 700; line-height: 1.05; }
  .w15-t-sub { font-size: 11px; opacity: .78; display: flex; align-items: center; gap: 6px; }
  .w15-bar { display: inline-block; width: 42px; height: 4px; border-radius: 2px;
             background: rgba(255,80,110,.55); overflow: hidden; }
  .w15-bar > i { display: block; height: 100%; background: rgba(0,214,110,.95); }
  .w15-tree { position: relative; width: 100%; }
  .w15-tree .w15-tile { min-height: 0; padding: 7px 8px; gap: 0; }
  .w15-tree .w15-tile .w15-t-name,
  .w15-tree .w15-tile .w15-t-val,
  .w15-tree .w15-tile .w15-t-sub { white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .w15-tree .w15-tile.sm { padding: 5px 6px; justify-content: flex-start; }
  .w15-tree .w15-tile.sm .w15-t-name { font-size: 11px; }
  .w15-tree .w15-tile.sm .w15-t-val { font-size: 13px; }
  .w15-tree .w15-tile.sm .w15-t-sub { display: none; }
  .w15-tree .w15-tile.xs { padding: 3px 4px; align-items: center; justify-content: center; }
  .w15-tree .w15-tile.xs .w15-t-name,
  .w15-tree .w15-tile.xs .w15-t-sub { display: none; }
  .w15-tree .w15-tile.xs .w15-t-val { font-size: 12px; }
  .w15-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .w15-col > h4 { font-size: 12px; color: var(--ix-text-dim); margin: 0 0 8px; letter-spacing: .08em; font-weight: 600; }
  .w15-empty { font-size: 12px; color: var(--ix-slate); padding: 8px 0; }
  .w15-legend { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--ix-text-dim);
                margin-top: 10px; flex-wrap: wrap; }
  .w15-legend i { width: 17px; height: 9px; border-radius: 1px; display: inline-block; }
  .w15-legend span { margin: 0 5px; }
  .w15-legend .w15-note { color: var(--ix-slate); }
  .w15-exp { margin-top: 12px; border-top: 1px solid var(--ix-border); padding-top: 11px; }
  .w15-exp-h { font-size: 13px; color: var(--ix-text); margin-bottom: 9px; display: flex; align-items: center; }
  .w15-close { margin-left: auto; font-size: 11px; padding: 5px 10px; min-height: 30px; border-radius: 999px;
               background: transparent; border: 1px solid var(--ix-border-mid); color: var(--ix-text-dim); cursor: pointer; font-family: inherit; }
  .w15-ind { margin-bottom: 10px; }
  .w15-ind-h { font-size: 12px; color: var(--ix-text-dim); margin-bottom: 4px; cursor: pointer; }
  .w15-ind-h:hover { color: var(--ix-cyan); }
  .w15-ind-h span { color: var(--ix-slate); font-size: 11px; }
  .w15-stocks { display: grid; grid-template-columns: repeat(auto-fill, minmax(66px, 1fr)); gap: 3px; }
  .w15-stock { border-radius: 3px; padding: 6px 3px; text-align: center; cursor: pointer;
               border: 1px solid rgba(255,255,255,.05); font-family: inherit; display: block; }
  .w15-stock:hover { outline: 1px solid var(--ix-cyan); outline-offset: -1px; }
  .w15-s-name { display: block; font-family: var(--ix-mono); font-size: 12px; line-height: 1.15; }
  .w15-s-val { display: block; font-family: var(--ix-mono); font-size: 11px; opacity: .85; }
  .w15-disc { font-size: 11px; color: var(--ix-slate); margin-top: 10px; }
  #w15-switch { position: fixed; right: 12px; bottom: 12px; z-index: 9999; display: flex; gap: 5px; align-items: center;
                flex-wrap: wrap; max-width: min(96vw, 760px);
                background: rgba(4,7,12,.94); border: 1px solid var(--ix-border-mid); border-radius: 12px;
                padding: 7px 10px; box-shadow: 0 10px 30px rgba(0,0,0,.6); backdrop-filter: blur(6px); }
  #w15-switch b { font-size: 11px; color: var(--ix-slate); letter-spacing: .06em; margin: 0 2px 0 6px; }
  #w15-switch b:first-child { margin-left: 0; }
  #w15-switch button { font-size: 12px; min-height: 30px; padding: 5px 10px; border-radius: 999px; cursor: pointer;
                       background: transparent; border: 1px solid var(--ix-border-mid); color: var(--ix-text-dim); font-family: inherit; }
  #w15-switch button.on { background: rgba(0,229,255,.14); border-color: rgba(0,229,255,.5); color: var(--ix-text-hi); }
  .w15-hh { font-size: 11px; color: var(--ix-cyan); font-family: var(--ix-mono); margin-left: 6px; }
  @media (max-width: 760px) {
    .w15-panel { padding: 12px 11px 10px; }
    .w15-grid { grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 5px; }
    .w15-grid.sm { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
    .w15-tile { min-height: 66px; padding: 8px; }
    .w15-t-val { font-size: 16px; }
    .w15-cols { grid-template-columns: 1fr; }
    #w15-switch { right: 6px; left: 6px; bottom: 6px; justify-content: center; }
  }`;

  function boot() {
    var s = document.createElement("style");
    s.textContent = CSS;
    document.head.appendChild(s);
    renderSwitch();
    window.__W15 = { afterRender: render };
    if (window.__w15host) render(window.__w15host.list());
    var t = null;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(function () { render(window.__w15host.list()); }, 160);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
