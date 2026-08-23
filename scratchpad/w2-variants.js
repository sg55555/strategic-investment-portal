/* 3案の定義（w2-mock-variants workflow の 3 エージェントが独立に設計した markup/CSS を機械的に貼付）。
 * この下の IIFE が配線する。案そのものの中身はここ以外で編集しない。 */
window.__W2_VARIANT_DEFS__ = {
  "a": {
    "name": "デンシティ・レール",
    "thesis": "期間8個・52週レンジ・ベンチを ma-control-bar と同じ密度・同じ語彙の「1行のレール」に圧縮し、チャート高さを1pxも削らずに時間軸UIを足す。52週は数値カードではなく行内の細ゲージとして埋め込み、既存ツールバー群と完全に同族に見せる。",
    "parts": [
      {
        "anchor": "maBar",
        "position": "before",
        "html": "<div class=\"w2a-rail\" role=\"group\" aria-label=\"表示期間と52週レンジ\"><span class=\"w2a-label\">期間</span><div class=\"w2a-seg\" title=\"FY＝決算年度（財務3表と同期）／1M〜MAX＝価格・指標のみのローリング窓\"><button class=\"w2-p active\" data-p=\"FY\">FY</button><span class=\"w2a-sep\" aria-hidden=\"true\"></span><button class=\"w2-p\" data-p=\"1M\">1M</button><button class=\"w2-p\" data-p=\"3M\">3M</button><button class=\"w2-p\" data-p=\"6M\">6M</button><button class=\"w2-p\" data-p=\"YTD\">YTD</button><button class=\"w2-p\" data-p=\"1Y\">1Y</button><button class=\"w2-p\" data-p=\"5Y\">5Y</button><button class=\"w2-p\" data-p=\"MAX\">MAX</button></div><div class=\"w2-52w\" title=\"直近52週レンジ内の現在地（期間切替とは独立）\"><span class=\"w2a-tag\">52W</span><span class=\"w2a-num\" data-w2=\"lo\">—</span><span class=\"w2a-track\"><span class=\"w2a-marker\" data-w2=\"marker\"></span></span><span class=\"w2a-num\" data-w2=\"hi\">—</span><span class=\"w2a-pos\" data-w2=\"pos\">—</span><span class=\"w2a-dist\" data-w2=\"dist\">—</span><span class=\"w2a-note\" data-w2=\"note\"></span></div><button class=\"w2-bench\" data-bench><span data-w2=\"benchLabel\">vs TOPIX</span></button></div>"
      }
    ],
    "css": "body[data-w2v=\"a\"] .w2a-rail{\n  display:flex; align-items:center; flex-wrap:nowrap; gap:0;\n  padding:7px 0 6px; margin:0;\n  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--ix-border) 70%, transparent);\n}\nbody[data-w2v=\"a\"] .w2a-label{\n  flex:0 0 auto; margin-right:8px;\n  font-size:12px; font-weight:bold; letter-spacing:.8px; text-transform:uppercase;\n  color:var(--ix-slate); white-space:nowrap;\n}\nbody[data-w2v=\"a\"] .w2a-seg{\n  display:flex; align-items:center; gap:4px;\n  flex:0 1 auto; min-width:0;\n  overflow-x:auto; overflow-y:hidden; overscroll-behavior-x:contain;\n  scroll-snap-type:x proximity; scrollbar-width:none; -ms-overflow-style:none;\n}\nbody[data-w2v=\"a\"] .w2a-seg::-webkit-scrollbar{ display:none; }\nbody[data-w2v=\"a\"] .w2a-sep{\n  flex:0 0 auto; width:1px; height:16px; margin:0 5px;\n  background:var(--ix-border-strong);\n}\nbody[data-w2v=\"a\"] .w2-p{\n  position:relative; flex:0 0 auto; scroll-snap-align:start;\n  min-height:24px; padding:3px 9px 3px 12px;\n  background:transparent; border:1px solid var(--ix-border-mid); border-radius:3px;\n  font-family:var(--ix-mono); font-size:.72rem; font-weight:bold; letter-spacing:.5px;\n  color:var(--ix-slate-line); white-space:nowrap; cursor:pointer;\n  transition:border-color .2s, color .2s, background .2s;\n}\nbody[data-w2v=\"a\"] .w2-p::after{ content:\"\"; position:absolute; inset:-6px 0; }\nbody[data-w2v=\"a\"] .w2-p:hover{ border-color:var(--ix-slate); color:var(--ix-text-dim); }\nbody[data-w2v=\"a\"] .w2-p:focus-visible{ outline:1px solid var(--ix-cyan); outline-offset:1px; }\nbody[data-w2v=\"a\"] .w2-p.active{\n  border-color:var(--ix-cyan); color:var(--ix-cyan);\n  background:color-mix(in srgb, var(--ix-cyan) 12%, transparent);\n}\nbody[data-w2v=\"a\"] .w2-p[data-p=\"FY\"]::before{\n  content:\"\"; position:absolute; left:4px; top:50%; transform:translateY(-50%);\n  width:2px; height:10px; border-radius:1px; background:var(--ix-amber); opacity:.5;\n}\nbody[data-w2v=\"a\"] .w2-p[data-p=\"FY\"]:hover::before{ opacity:.8; }\nbody[data-w2v=\"a\"] .w2-p[data-p=\"FY\"].active{\n  border-color:var(--ix-amber); color:var(--ix-amber);\n  background:color-mix(in srgb, var(--ix-amber) 12%, transparent);\n}\nbody[data-w2v=\"a\"] .w2-p[data-p=\"FY\"].active::before{ opacity:1; }\nbody[data-w2v=\"a\"] .w2-52w{\n  display:flex; align-items:center; gap:6px; flex:0 0 auto;\n  margin-left:10px; font-family:var(--ix-mono); line-height:1;\n}\nbody[data-w2v=\"a\"] .w2-52w::before{\n  content:\"\"; flex:0 0 auto; width:1px; height:16px; margin-right:10px;\n  background:var(--ix-border-strong);\n}\nbody[data-w2v=\"a\"] .w2a-tag{ font-size:10px; letter-spacing:.6px; color:var(--ix-slate); }\nbody[data-w2v=\"a\"] .w2a-num{ font-size:10px; color:var(--ix-slate-line); white-space:nowrap; }\nbody[data-w2v=\"a\"] .w2a-track{\n  position:relative; flex:0 0 auto;\n  width:clamp(56px, 8vw, 104px); height:4px; border-radius:2px;\n  background:linear-gradient(90deg,\n    color-mix(in srgb, var(--ix-slate-line) 24%, transparent),\n    color-mix(in srgb, var(--ix-cyan) 34%, transparent));\n}\nbody[data-w2v=\"a\"] .w2a-marker{\n  position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);\n  width:3px; height:12px; border-radius:1px;\n  background:var(--ix-cyan-bright2);\n  box-shadow:0 0 6px color-mix(in srgb, var(--ix-cyan) 55%, transparent);\n  transition:left .25s ease;\n}\nbody[data-w2v=\"a\"] .w2a-pos{ font-size:11px; font-weight:bold; color:var(--ix-text); }\nbody[data-w2v=\"a\"] .w2a-dist{ font-size:10px; color:var(--ix-slate); white-space:nowrap; }\nbody[data-w2v=\"a\"] .w2a-note{ font-size:10px; color:var(--ix-amber); white-space:nowrap; }\nbody[data-w2v=\"a\"] .w2a-note:empty{ display:none; }\nbody[data-w2v=\"a\"] .w2-bench{\n  position:relative; flex:0 0 auto; margin-left:auto;\n  display:inline-flex; align-items:center; gap:6px;\n  min-height:24px; padding:3px 10px;\n  background:transparent; border:1px solid var(--ix-border-mid); border-radius:3px;\n  font-size:.72rem; font-weight:bold; letter-spacing:.5px;\n  color:var(--ix-slate-line); white-space:nowrap; cursor:pointer;\n  transition:border-color .2s, color .2s, background .2s;\n}\nbody[data-w2v=\"a\"] .w2-bench::before{\n  content:\"\"; flex:0 0 auto; width:12px; height:2px; border-radius:1px;\n  background:currentColor; opacity:.45;\n}\nbody[data-w2v=\"a\"] .w2-bench::after{ content:\"\"; position:absolute; inset:-6px 0; }\nbody[data-w2v=\"a\"] .w2-bench:hover{ border-color:var(--ix-slate); color:var(--ix-text-dim); }\nbody[data-w2v=\"a\"] .w2-bench:focus-visible{ outline:1px solid var(--ix-cyan); outline-offset:1px; }\nbody[data-w2v=\"a\"] .w2-bench.active{\n  border-color:var(--ix-indigo-bright); color:var(--ix-indigo-bright);\n  background:color-mix(in srgb, var(--ix-indigo-bright) 12%, transparent);\n}\nbody[data-w2v=\"a\"] .w2-bench.active::before{ opacity:1; }\n\n@media (max-width:768px){\n  body[data-w2v=\"a\"] .w2a-rail{\n    display:grid; grid-template-columns:minmax(0,1fr) auto;\n    column-gap:8px; row-gap:4px; padding:6px 0 5px;\n  }\n  body[data-w2v=\"a\"] .w2a-label{ display:none; }\n  body[data-w2v=\"a\"] .w2a-seg{\n    grid-column:1; grid-row:1; gap:5px;\n    -webkit-mask-image:linear-gradient(90deg, var(--ix-white) 0 88%, transparent 100%);\n    mask-image:linear-gradient(90deg, var(--ix-white) 0 88%, transparent 100%);\n  }\n  body[data-w2v=\"a\"] .w2-p{ min-height:36px; padding:0 11px 0 14px; font-size:.78rem; }\n  body[data-w2v=\"a\"] .w2-p::after{ inset:-5px 0; }\n  body[data-w2v=\"a\"] .w2-bench{\n    grid-column:2; grid-row:1; margin-left:0; min-height:36px; padding:0 10px;\n  }\n  body[data-w2v=\"a\"] .w2-bench::after{ inset:-5px 0; }\n  body[data-w2v=\"a\"] .w2-52w{\n    grid-column:1 / -1; grid-row:2; margin-left:0; height:16px;\n    display:grid; grid-template-columns:auto auto minmax(40px,1fr) auto auto auto;\n    align-items:center; gap:0 6px;\n  }\n  body[data-w2v=\"a\"] .w2-52w::before{ display:none; }\n  body[data-w2v=\"a\"] .w2a-track{ width:auto; }\n  body[data-w2v=\"a\"] .w2a-marker{ height:10px; }\n  body[data-w2v=\"a\"] .w2a-note{ grid-column:1 / -1; white-space:normal; }\n}\n\n@media (max-width:480px){\n  body[data-w2v=\"a\"] .w2-p{ padding:0 9px 0 12px; font-size:.75rem; }\n  body[data-w2v=\"a\"] .w2-bench{ padding:0 8px; gap:4px; font-size:.7rem; }\n  body[data-w2v=\"a\"] .w2-bench::before{ width:9px; }\n  body[data-w2v=\"a\"] .w2a-num{ font-size:9px; }\n  body[data-w2v=\"a\"] .w2a-dist{ font-size:9px; }\n}\n\n@media (max-width:375px){\n  body[data-w2v=\"a\"] .w2a-rail{ column-gap:6px; }\n  body[data-w2v=\"a\"] .w2-p{ padding:0 8px 0 11px; }\n  body[data-w2v=\"a\"] .w2a-tag{ display:none; }\n}",
    "vertical_cost": "PC（≥769px）: +37px（レール1行のみ。padding 7+6 + ボタン高24。区切り線は inset box-shadow ＝ 高さ0。#chart-container は不変）／390px: +67px（padding 6+5 + タップ行36 + row-gap 4 + 52Wヘアライン16。チャート高 260/220/190px は一切削らない）",
    "tradeoffs": [
      "密度優先ゆえ 52週レンジの数値（lo/hi）が 9〜10px の極小モノスペースになる。「今どこにいるか」はゲージで直感的に分かるが、実額を読ませる用途では弱い（拡大は他案の役割）。",
      "PC でも 8 ボタンを収めるためにボタンが .ma-btn より小ぶり（min-height 24px）。マウス操作前提の密度で、PC でのタップ操作には最適化していない（当たり判定は ::after で ±6px 補っているが視覚的には小さい）。",
      "390px では期間バーが横スクロールのセグメントになるため、初期表示で MAX / 5Y が画面外に隠れる（右端フェードマスクでスクロール可能性を示唆するのみ）。「全期間が一望できる」ことは捨てた。",
      "FY と 1M〜MAX の意味の非対称は、区切り線＋アンバーのアンカー印＋色分け（FY=アンバー／ローリング=シアン）という視覚記号だけで表現しており、文言による説明は title 属性のみ。初回ユーザーが「財務3表は動かない」ことを言葉で知る導線はない（説明テキスト1行を足すと思想＝縦ゼロ増が崩れるため意図的に不採用）。",
      "390px の「期間」ラベルと 375px の「52W」タグを非表示にして幅を稼いでいる（意味はボタン文字列とゲージ形状に依存）。",
      "ベンチマークチップが右端の margin-left:auto 配置のため、52週ブロックが display:none で欠損しても位置は動かないが、PC で中央に大きな空白が生まれる場合がある（欠損時のみ）。"
    ]
  },
  "b": {
    "name": "足元レンジ帯",
    "thesis": "期間切替はタイトル行の右端に浮かせて縦の行を一切増やさず、空いた縦幅を全部「52週レンジ帯」に投資する。チャート直下に全幅の帯を敷き、安値・高値・現在地・高値までの距離を主役級の大きさで読ませる。",
    "parts": [
      {
        "anchor": "cardTitle",
        "position": "after",
        "html": "<div class=\"w2b-periodwrap\"><span class=\"w2b-state\"><i class=\"w2b-dot\" aria-hidden=\"true\"></i><span class=\"w2b-state-fy\">決算期と同期</span><span class=\"w2b-state-roll\">ローリング窓・財務はFY</span></span><div class=\"w2b-periodscroll\" role=\"group\" aria-label=\"チャート表示期間\"><button class=\"w2-p active\" data-p=\"FY\">FY</button><span class=\"w2b-sep\" aria-hidden=\"true\"></span><button class=\"w2-p\" data-p=\"1M\">1M</button><button class=\"w2-p\" data-p=\"3M\">3M</button><button class=\"w2-p\" data-p=\"6M\">6M</button><button class=\"w2-p\" data-p=\"YTD\">YTD</button><button class=\"w2-p\" data-p=\"1Y\">1Y</button><button class=\"w2-p\" data-p=\"5Y\">5Y</button><button class=\"w2-p\" data-p=\"MAX\">MAX</button></div></div>"
      },
      {
        "anchor": "chartContainer",
        "position": "after",
        "html": "<div class=\"w2-52w\" role=\"group\" aria-label=\"52週レンジ\"><div class=\"w2b-head\"><span class=\"w2b-cap\">52週レンジ内の位置</span><b class=\"w2b-pos\" data-w2=\"pos\">—</b><span class=\"w2b-dist-wrap\"><span class=\"w2b-dist-cap\">高値まで</span><b class=\"w2b-dist\" data-w2=\"dist\">—</b></span><span class=\"w2b-note\" data-w2=\"note\"></span><button class=\"w2-bench\" data-bench><span data-w2=\"benchLabel\">vs TOPIX</span></button></div><div class=\"w2b-body\"><span class=\"w2b-end w2b-end-lo\"><em>52W LOW</em><b data-w2=\"lo\">—</b></span><div class=\"w2b-track\"><span class=\"w2b-ticks\" aria-hidden=\"true\"></span><span class=\"w2b-marker\" data-w2=\"marker\"><i class=\"w2b-needle\"></i><i class=\"w2b-dotm\"></i></span></div><span class=\"w2b-end w2b-end-hi\"><em>52W HIGH</em><b data-w2=\"hi\">—</b></span></div></div>"
      }
    ],
    "css": "/* W2 案B: 1) 期間バー=タイトル行右端に浮遊 2) 52週レンジ=チャート直下の全幅帯(主役) 3) ベンチ=帯の右端 */\n\n/* 1) 期間切替バー */\nbody[data-w2v=\"b\"] .w2b-periodwrap{\n  position:absolute; top:26px; right:22px; z-index:3;\n  display:inline-flex; align-items:center; gap:10px;\n  max-width:calc(100% - 44px);\n  padding:4px 8px 4px 11px;\n  border:1px solid var(--ix-border); border-radius:4px;\n  background:var(--ix-surface-0);\n  background:color-mix(in srgb, var(--ix-bg-void) 84%, transparent);\n  backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);\n}\nbody[data-w2v=\"b\"] .w2b-state{\n  display:inline-flex; align-items:center; gap:6px;\n  font-family:var(--ix-sans); font-size:10.5px; letter-spacing:.4px;\n  color:var(--ix-slate); white-space:nowrap;\n}\nbody[data-w2v=\"b\"] .w2b-dot{\n  width:6px; height:6px; border-radius:50%; flex:0 0 auto;\n  background:var(--ix-cyan-deep);\n  box-shadow:0 0 7px color-mix(in srgb, var(--ix-cyan) 70%, transparent);\n}\nbody[data-w2v=\"b\"] .w2b-state-roll{ display:none; }\nbody[data-w2v=\"b\"] .w2b-periodwrap:has(.w2-p:not([data-p=\"FY\"]).active) .w2b-state{ color:var(--ix-amber); }\nbody[data-w2v=\"b\"] .w2b-periodwrap:has(.w2-p:not([data-p=\"FY\"]).active) .w2b-dot{\n  background:var(--ix-amber);\n  box-shadow:0 0 7px color-mix(in srgb, var(--ix-amber) 70%, transparent);\n}\nbody[data-w2v=\"b\"] .w2b-periodwrap:has(.w2-p:not([data-p=\"FY\"]).active) .w2b-state-fy{ display:none; }\nbody[data-w2v=\"b\"] .w2b-periodwrap:has(.w2-p:not([data-p=\"FY\"]).active) .w2b-state-roll{ display:inline; }\nbody[data-w2v=\"b\"] .w2b-periodscroll{ display:flex; align-items:center; gap:4px; min-width:0; }\nbody[data-w2v=\"b\"] .w2b-sep{\n  width:1px; height:16px; margin:0 3px; flex:0 0 auto;\n  background:var(--ix-border-strong);\n}\nbody[data-w2v=\"b\"] .w2-p{\n  flex:0 0 auto; background:transparent;\n  border:1px solid var(--ix-border-mid); border-radius:3px;\n  color:var(--ix-slate-line);\n  font-family:var(--ix-mono); font-size:.7rem; font-weight:bold; letter-spacing:.6px;\n  padding:4px 9px; cursor:pointer; white-space:nowrap;\n  transition:border-color .18s, color .18s, background .18s, box-shadow .18s;\n}\nbody[data-w2v=\"b\"] .w2-p:hover{ border-color:var(--ix-slate); color:var(--ix-text-dim); }\nbody[data-w2v=\"b\"] .w2-p:focus-visible{ outline:1px solid var(--ix-cyan); outline-offset:2px; }\nbody[data-w2v=\"b\"] .w2-p[data-p=\"FY\"]{ color:var(--ix-text-dim); }\nbody[data-w2v=\"b\"] .w2-p[data-p=\"FY\"].active{\n  border-color:var(--ix-cyan); color:var(--ix-cyan);\n  background:color-mix(in srgb, var(--ix-cyan) 14%, transparent);\n  box-shadow:0 0 10px color-mix(in srgb, var(--ix-cyan) 22%, transparent);\n}\nbody[data-w2v=\"b\"] .w2-p:not([data-p=\"FY\"]).active{\n  border-color:var(--ix-amber); color:var(--ix-amber);\n  background:color-mix(in srgb, var(--ix-amber) 14%, transparent);\n}\n\n/* 2) 52週レンジ帯 */\nbody[data-w2v=\"b\"] .w2-52w{\n  margin:10px 0 2px; padding:10px 14px 12px;\n  border:1px solid var(--ix-border); border-left:2px solid var(--ix-cyan);\n  border-radius:3px;\n  background:var(--ix-surface-0);\n  background:linear-gradient(180deg,\n    color-mix(in srgb, var(--ix-bg-void) 70%, transparent),\n    color-mix(in srgb, var(--ix-bg-void) 32%, transparent));\n}\nbody[data-w2v=\"b\"] .w2b-head{ display:flex; align-items:center; flex-wrap:wrap; gap:10px; }\nbody[data-w2v=\"b\"] .w2b-cap{\n  font-size:10.5px; font-weight:bold; letter-spacing:1.4px; text-transform:uppercase;\n  color:var(--ix-slate); white-space:nowrap;\n}\nbody[data-w2v=\"b\"] .w2b-pos{\n  font-family:var(--ix-mono); font-size:1.4rem; font-weight:bold; line-height:1;\n  letter-spacing:.5px; color:var(--ix-cyan-light);\n  text-shadow:0 0 14px color-mix(in srgb, var(--ix-cyan) 45%, transparent);\n}\nbody[data-w2v=\"b\"] .w2b-dist-wrap{\n  display:inline-flex; align-items:center; gap:6px; min-height:18px;\n  padding-left:12px; border-left:1px solid var(--ix-border-strong);\n}\nbody[data-w2v=\"b\"] .w2b-dist-cap{ font-size:10.5px; letter-spacing:1px; color:var(--ix-slate); white-space:nowrap; }\nbody[data-w2v=\"b\"] .w2b-dist{ font-family:var(--ix-mono); font-size:.95rem; font-weight:bold; color:var(--ix-text-hi); }\nbody[data-w2v=\"b\"] .w2b-note{ font-family:var(--ix-sans); font-size:10.5px; line-height:1.4; color:var(--ix-slate-muted); }\nbody[data-w2v=\"b\"] .w2b-note:empty{ display:none; }\n\n/* 3) ベンチマークチップ */\nbody[data-w2v=\"b\"] .w2-bench{\n  margin-left:auto; flex:0 0 auto;\n  background:transparent; border:1px solid var(--ix-border-mid); border-radius:3px;\n  color:var(--ix-slate-line);\n  font-family:var(--ix-mono); font-size:.72rem; font-weight:bold; letter-spacing:.6px;\n  padding:5px 12px; cursor:pointer; white-space:nowrap;\n  transition:border-color .18s, color .18s, background .18s;\n}\nbody[data-w2v=\"b\"] .w2-bench::before{ content:\"— \"; opacity:.8; }\nbody[data-w2v=\"b\"] .w2-bench:hover{ border-color:var(--ix-slate); color:var(--ix-text-dim); }\nbody[data-w2v=\"b\"] .w2-bench:focus-visible{ outline:1px solid var(--ix-cyan); outline-offset:2px; }\nbody[data-w2v=\"b\"] .w2-bench.active{\n  border-color:var(--ix-indigo-bright); color:var(--ix-indigo-bright);\n  background:color-mix(in srgb, var(--ix-indigo-bright) 14%, transparent);\n}\n\n/* レンジ本体 */\nbody[data-w2v=\"b\"] .w2b-body{\n  display:grid; grid-template-columns:auto minmax(0,1fr) auto;\n  align-items:center; gap:0 12px; margin-top:9px;\n}\nbody[data-w2v=\"b\"] .w2b-end{ display:flex; flex-direction:column; gap:2px; line-height:1.1; }\nbody[data-w2v=\"b\"] .w2b-end em{\n  font-style:normal; font-size:9px; letter-spacing:1.1px; text-transform:uppercase;\n  color:var(--ix-slate); white-space:nowrap;\n}\nbody[data-w2v=\"b\"] .w2b-end b{ font-family:var(--ix-mono); font-size:.88rem; color:var(--ix-text-hi); }\nbody[data-w2v=\"b\"] .w2b-end-lo{ align-items:flex-end; text-align:right; }\nbody[data-w2v=\"b\"] .w2b-end-hi{ align-items:flex-start; text-align:left; }\nbody[data-w2v=\"b\"] .w2b-track{\n  position:relative; height:14px; border-radius:8px;\n  border:1px solid var(--ix-border-strong);\n  background:var(--ix-surface-3);\n  background-image:linear-gradient(90deg,\n    color-mix(in srgb, var(--ix-red-soft) 34%, transparent),\n    color-mix(in srgb, var(--ix-slate) 12%, transparent) 50%,\n    color-mix(in srgb, var(--ix-emerald-bright) 38%, transparent));\n}\nbody[data-w2v=\"b\"] .w2b-ticks{\n  position:absolute; inset:0; border-radius:inherit; pointer-events:none;\n  background-image:repeating-linear-gradient(90deg,\n    transparent 0 calc(25% - 1px),\n    color-mix(in srgb, var(--ix-slate) 42%, transparent) calc(25% - 1px) 25%);\n}\nbody[data-w2v=\"b\"] .w2b-marker{\n  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);\n  width:12px; height:32px; pointer-events:none;\n}\nbody[data-w2v=\"b\"] .w2b-needle{\n  position:absolute; left:50%; top:0; bottom:0; width:2px; margin-left:-1px;\n  border-radius:1px; background:var(--ix-cyan-bright2);\n  box-shadow:0 0 10px color-mix(in srgb, var(--ix-cyan) 75%, transparent);\n}\nbody[data-w2v=\"b\"] .w2b-dotm{\n  position:absolute; left:50%; top:50%; width:10px; height:10px; margin:-5px 0 0 -5px;\n  border-radius:50%; background:var(--ix-cyan-bright2);\n  box-shadow:0 0 0 2px var(--ix-bg-void), 0 0 14px color-mix(in srgb, var(--ix-cyan) 80%, transparent);\n}\n\n@media (max-width: 980px){\n  body[data-w2v=\"b\"] .w2b-periodwrap{\n    position:static; display:flex; flex-direction:column; align-items:stretch; gap:5px;\n    max-width:none; margin:-9px 0 10px; padding:0;\n    border:0; background:none; backdrop-filter:none; -webkit-backdrop-filter:none;\n  }\n  body[data-w2v=\"b\"] .w2b-state{ order:2; font-size:11px; }\n  body[data-w2v=\"b\"] .w2b-periodscroll{\n    order:1; overflow-x:auto; overflow-y:hidden; gap:6px; padding-bottom:2px;\n    scrollbar-width:none; -ms-overflow-style:none;\n    scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch;\n    -webkit-mask-image:linear-gradient(90deg, black 0 calc(100% - 22px), transparent);\n    mask-image:linear-gradient(90deg, black 0 calc(100% - 22px), transparent);\n  }\n  body[data-w2v=\"b\"] .w2b-periodscroll::-webkit-scrollbar{ display:none; }\n  body[data-w2v=\"b\"] .w2-p{ min-height:40px; min-width:42px; padding:0 12px; font-size:.76rem; scroll-snap-align:start; }\n  body[data-w2v=\"b\"] .w2b-sep{ height:22px; margin:0 2px; }\n}\n\n@media (max-width: 480px){\n  body[data-w2v=\"b\"] .w2b-periodwrap{ margin:-9px 0 8px; }\n  body[data-w2v=\"b\"] .w2b-state{ display:none; }\n  body[data-w2v=\"b\"] .w2b-periodwrap:has(.w2-p:not([data-p=\"FY\"]).active) .w2b-state{ display:inline-flex; }\n  body[data-w2v=\"b\"] .w2-p{ min-height:44px; min-width:44px; padding:0 10px; font-size:.74rem; }\n  body[data-w2v=\"b\"] .w2-52w{ margin:8px 0 2px; padding:8px 10px 10px; }\n  body[data-w2v=\"b\"] .w2b-head{ gap:8px; }\n  body[data-w2v=\"b\"] .w2b-cap{ display:none; }\n  body[data-w2v=\"b\"] .w2b-pos{ font-size:1.2rem; }\n  body[data-w2v=\"b\"] .w2b-dist-wrap{ padding-left:10px; }\n  body[data-w2v=\"b\"] .w2b-dist{ font-size:.85rem; }\n  body[data-w2v=\"b\"] .w2b-note{ order:9; flex:0 0 100%; margin-top:2px; }\n  body[data-w2v=\"b\"] .w2-bench{ min-height:44px; padding:5px 10px; font-size:.68rem; }\n  body[data-w2v=\"b\"] .w2b-body{ gap:0 9px; margin-top:8px; }\n  body[data-w2v=\"b\"] .w2b-end b{ font-size:.8rem; }\n  body[data-w2v=\"b\"] .w2b-track{ height:12px; }\n  body[data-w2v=\"b\"] .w2b-marker{ height:28px; }\n}\n\n@media (max-width: 375px){\n  body[data-w2v=\"b\"] .w2b-pos{ font-size:1.1rem; }\n  body[data-w2v=\"b\"] .w2b-dist{ font-size:.8rem; }\n  body[data-w2v=\"b\"] .w2b-end b{ font-size:.76rem; }\n  body[data-w2v=\"b\"] .w2b-end em{ font-size:8.5px; letter-spacing:.9px; }\n  body[data-w2v=\"b\"] .w2-52w{ padding:8px 8px 10px; }\n}",
    "vertical_cost": "PC(≥981px) ≈ +98px：期間バーは #stock-title 行に絶対配置で浮かせるため縦増分 0px、52週帯のみ約98px（margin10+border2+padding22+ヘッダ22+gap9+レンジ行32）。390px ≈ +155px：期間セグメント約43px（44pxタップ標的・card-title の margin-bottom を -9px で食って相殺済み）＋52週帯約112px。1M〜MAX 選択中のみ警告キャプションが1行出て +16px（FY既定では出ない）。",
    "tradeoffs": [
      "PC で期間バーを .card 内に position:absolute で浮かせている＝.card{position:relative} と #stock-title が2行（社名＋[期間]注記）である現状の高さに top:26px を合わせている。将来タイトルが3行に増える／カードのラッパ構造が変わると重なる可能性がある（占有背景＋blur で読めなくはならないが、追従が要る）。",
      "縦を最も食う案。52週レンジを『主役級』にした代償で、モバイルではチャート(220px)の下に112pxの帯が居座り、サブパネル以降が下へ押される。「チャートを大きく見せたい」要求とは正面から競合する。",
      "390px では8ボタンが収まらず横スクロール前提（マスクのフェードだけが手がかり）。5Y/MAX は初見でスクロールに気づかない人が出る。",
      "FY と 1M〜MAX の非対称を色（FY=cyan／ローリング=amber）と :has() によるキャプション切替で表現しているため、:has() 非対応環境では常に『決算期と同期』表示のまま固定される（誤読はしないが警告が出ない）。amber を『財務と切り離された状態』に割り当てたので、他所で amber を注意色として使うと意味が薄まる。",
      "色は全て --ix-* + color-mix。color-mix 非対応環境では帯のグラデーションが単色 var(--ix-surface-3) にフォールバックし、安値/高値の色の手がかりが失われる（数値とマーカーは残る）。",
      "52週レンジは期間切替と独立なのに、位置が期間バーから離れた（タイトル行 vs チャート直下）ため『この帯は期間に連動しない』ことは配置では説明できていない。文言での担保が必要。"
    ]
  },
  "c": {
    "name": "チャート面HUD",
    "thesis": "カードの縦寸を1pxも増やさず、期間セグメント・ベンチチップ・52週ゲージをすべてチャート面に浮かせる（高さ0のレイヤ＋absolute）。PCではレイヤ全体を pointer-events:none／既定 opacity .72 にしてローソクを読む邪魔をせず、カードに触れた瞬間だけ前面化する。390px はチャート高が260pxしかなくオーバーレイが破綻するため、≤768px では思想を明示的に降ろして通常フロー（横スクロールのセグメントレール＋横バー化した52W）に落とす。",
    "parts": [
      {
        "anchor": "chartContainer",
        "position": "before",
        "html": "<div class=\"w2c-layer\">\n  <div class=\"w2c-hud\">\n    <div class=\"w2c-seg\" role=\"group\" aria-label=\"表示期間\" title=\"FY＝決算年度の窓（財務3表と同期する唯一の状態）／1M〜MAX＝価格チャート・指標・シグナルだけのローリング窓\">\n      <button class=\"w2-p active\" data-p=\"FY\">FY</button>\n      <span class=\"w2c-seg-div\" aria-hidden=\"true\"></span>\n      <button class=\"w2-p\" data-p=\"1M\">1M</button>\n      <button class=\"w2-p\" data-p=\"3M\">3M</button>\n      <button class=\"w2-p\" data-p=\"6M\">6M</button>\n      <button class=\"w2-p\" data-p=\"YTD\">YTD</button>\n      <button class=\"w2-p\" data-p=\"1Y\">1Y</button>\n      <button class=\"w2-p\" data-p=\"5Y\">5Y</button>\n      <button class=\"w2-p\" data-p=\"MAX\">MAX</button>\n    </div>\n    <button class=\"w2-bench\" data-bench><span data-w2=\"benchLabel\">vs TOPIX</span></button>\n  </div>\n\n  <div class=\"w2-52w\" aria-label=\"52週レンジ内の現在地\">\n    <div class=\"w2c-g-head\">\n      <span class=\"w2c-g-tag\">52W</span>\n      <span class=\"w2c-g-pos\" data-w2=\"pos\">–</span>\n    </div>\n    <div class=\"w2c-g-body\">\n      <span class=\"w2c-g-lab w2c-g-hi\" data-w2=\"hi\">–</span>\n      <span class=\"w2c-track\"><span class=\"w2c-marker\" data-w2=\"marker\"></span></span>\n      <span class=\"w2c-g-lab w2c-g-lo\" data-w2=\"lo\">–</span>\n    </div>\n    <div class=\"w2c-g-foot\">\n      <span class=\"w2c-g-dist\" data-w2=\"dist\">–</span>\n      <span class=\"w2c-g-note\" data-w2=\"note\"></span>\n    </div>\n  </div>\n</div>"
      }
    ],
    "css": "/* ══════ W2 案C「Chart-Face HUD」＝チャート面を使う（TradingView / 端末作法）══════\n   ・PC: カードの縦寸増分 0px。高さ0のレイヤを #chart-container の直前に敷き、\n     すべての部品を absolute でチャート面に浮かせる。\n   ・遮蔽対策: レイヤ全体 pointer-events:none（ボタンだけ auto）／既定 opacity .72 で\n     カードに触れた時だけ前面化／backdrop-filter でローソクを透かす／右プライススケール\n     (rightPriceScale.minimumWidth:72) と出来高帯(scaleMargins top:.82 ＝ 下18%)は必ず避ける。\n   ・≤768px は破綻するのでオーバーレイを捨て通常フローへ落ちる（縦ゼロ増はPC専用の思想）。 */\n\n/* ── レイヤ土台 ─────────────────────────────────────────\n   display:flow-root は必須。これが無いと height:0 の自己マージン相殺が起き、\n   .ma-control-bar の margin-bottom:10px の“中”にボックスが着地して原点が 10px ずれる。 */\nbody[data-w2v=\"c\"] .w2c-layer{\n  display:flow-root;\n  position:relative;\n  height:0;\n  margin:0;\n  z-index:6;\n  font-family:var(--ix-mono);\n  pointer-events:none;\n  opacity:.72;\n  transition:opacity .18s ease;\n}\nbody[data-w2v=\"c\"] .card:hover .w2c-layer,\nbody[data-w2v=\"c\"] .w2c-layer:focus-within{ opacity:1; }\n\n/* ── 上段フローティング行（期間セグメント＋ベンチチップ）────────────\n   right:82px = 右プライススケール 72px + 余白。軸ラベルには絶対に被せない。 */\nbody[data-w2v=\"c\"] .w2c-hud{\n  position:absolute;\n  top:8px; left:10px; right:82px;\n  display:flex; align-items:flex-start; justify-content:space-between;\n  gap:8px;\n}\n\n/* セグメントコントロール（半透明ガラスのピル） */\nbody[data-w2v=\"c\"] .w2c-seg{\n  display:flex; align-items:center; flex-wrap:nowrap; gap:2px;\n  padding:3px; border-radius:5px;\n  pointer-events:auto;\n  background:color-mix(in srgb, var(--ix-surface-solid) 74%, transparent);\n  border:1px solid color-mix(in srgb, var(--ix-border-strong) 88%, transparent);\n  box-shadow:0 2px 12px color-mix(in srgb, var(--ix-bg-void) 68%, transparent);\n  backdrop-filter:blur(6px) saturate(1.15);\n  -webkit-backdrop-filter:blur(6px) saturate(1.15);\n}\n/* FY と 1M〜MAX の間のヘアライン＝「ここから意味が変わる」境界 */\nbody[data-w2v=\"c\"] .w2c-seg-div{\n  flex:0 0 1px; width:1px; height:14px; margin:0 4px;\n  background:color-mix(in srgb, var(--ix-border-mid) 95%, transparent);\n}\n\nbody[data-w2v=\"c\"] .w2-p{\n  appearance:none; -webkit-appearance:none;\n  flex:0 0 auto;\n  background:transparent; border:1px solid transparent; border-radius:3px;\n  padding:0 8px; min-width:34px; height:22px; line-height:20px;\n  font-family:var(--ix-mono); font-size:11px; font-weight:700; letter-spacing:.6px;\n  color:var(--ix-slate-line); white-space:nowrap; cursor:pointer;\n  transition:color .15s ease, background .15s ease, border-color .15s ease;\n}\nbody[data-w2v=\"c\"] .w2-p:hover{\n  color:var(--ix-cyan-light);\n  background:color-mix(in srgb, var(--ix-cyan) 12%, transparent);\n}\nbody[data-w2v=\"c\"] .w2-p:focus-visible{\n  outline:1px solid var(--ix-cyan-bright2); outline-offset:1px;\n}\n/* ローリング窓の active = シアン塗り（端末の「選択セル」） */\nbody[data-w2v=\"c\"] .w2-p.active{\n  color:var(--ix-bg-void);\n  background:color-mix(in srgb, var(--ix-cyan) 84%, transparent);\n  border-color:color-mix(in srgb, var(--ix-cyan) 62%, transparent);\n  box-shadow:0 0 10px color-mix(in srgb, var(--ix-cyan) 42%, transparent);\n}\n\n/* ── FY だけは意味が違う（財務3表と同期する唯一の状態）＝色で別種にする ──\n   ローリング窓=シアン / FY=アンバー。FY が非 active の間もアンバーの点が残り、\n   「財務はいまも FY に錨を下ろしたまま」であることを 0px の面積で示す。 */\nbody[data-w2v=\"c\"] .w2-p[data-p=\"FY\"]{\n  position:relative;\n  color:var(--ix-amber); letter-spacing:1px;\n}\nbody[data-w2v=\"c\"] .w2-p[data-p=\"FY\"]:hover{\n  color:var(--ix-gold);\n  background:color-mix(in srgb, var(--ix-amber) 14%, transparent);\n}\nbody[data-w2v=\"c\"] .w2-p[data-p=\"FY\"].active{\n  color:var(--ix-bg-void);\n  background:color-mix(in srgb, var(--ix-amber) 88%, transparent);\n  border-color:color-mix(in srgb, var(--ix-amber) 64%, transparent);\n  box-shadow:0 0 10px color-mix(in srgb, var(--ix-amber) 45%, transparent);\n}\nbody[data-w2v=\"c\"] .w2-p[data-p=\"FY\"]:not(.active)::after{\n  content:\"\";\n  position:absolute; top:2px; right:3px;\n  width:4px; height:4px; border-radius:50%;\n  background:var(--ix-amber);\n  box-shadow:0 0 6px color-mix(in srgb, var(--ix-amber) 75%, transparent);\n}\n\n/* ── ベンチマークチップ（ON/OFF のみ・線サンプル付き）──────────── */\nbody[data-w2v=\"c\"] .w2-bench{\n  appearance:none; -webkit-appearance:none;\n  flex:0 0 auto; pointer-events:auto;\n  display:inline-flex; align-items:center; gap:6px;\n  height:28px; padding:0 10px; border-radius:5px;\n  font-family:var(--ix-mono); font-size:11px; font-weight:700; letter-spacing:.5px;\n  color:var(--ix-slate-line); white-space:nowrap; cursor:pointer;\n  background:color-mix(in srgb, var(--ix-surface-solid) 74%, transparent);\n  border:1px solid color-mix(in srgb, var(--ix-border-strong) 88%, transparent);\n  box-shadow:0 2px 12px color-mix(in srgb, var(--ix-bg-void) 68%, transparent);\n  backdrop-filter:blur(6px) saturate(1.15);\n  -webkit-backdrop-filter:blur(6px) saturate(1.15);\n  transition:color .15s ease, background .15s ease, border-color .15s ease;\n}\n/* 線サンプル＝OFF は消え入る実線、ON は破線（ベンチ＝中立の参照線という作法） */\nbody[data-w2v=\"c\"] .w2-bench::before{\n  content:\"\"; flex:0 0 auto; width:14px; height:2px; border-radius:1px;\n  background:color-mix(in srgb, var(--ix-slate) 60%, transparent);\n}\nbody[data-w2v=\"c\"] .w2-bench:hover{\n  color:var(--ix-text-dim);\n  border-color:color-mix(in srgb, var(--ix-slate) 70%, transparent);\n}\nbody[data-w2v=\"c\"] .w2-bench:focus-visible{\n  outline:1px solid var(--ix-cyan-bright2); outline-offset:1px;\n}\nbody[data-w2v=\"c\"] .w2-bench.active{\n  color:var(--ix-text-hi);\n  background:color-mix(in srgb, var(--ix-surface-blue) 55%, transparent);\n  border-color:color-mix(in srgb, var(--ix-slate-light) 45%, transparent);\n}\nbody[data-w2v=\"c\"] .w2-bench.active::before{\n  background:repeating-linear-gradient(90deg,\n    var(--ix-slate-light) 0 3px, transparent 3px 6px);\n}\n\n/* ── 52週レンジ＝右端の縦ミニゲージ ────────────────────────\n   right:78px でプライススケール(72px)の内側に寄せ、価格軸と同じ向き・同じ単位で読ませる。\n   縦の占有は 44px〜約342px＝価格帯だけ。出来高ヒストグラム帯(≒346px〜)には入らない。 */\nbody[data-w2v=\"c\"] .w2-52w{\n  position:absolute; top:44px; right:78px;\n  width:52px;\n  display:flex; flex-direction:column; align-items:center; gap:5px;\n  padding:6px 4px;\n  border-radius:4px;\n  pointer-events:none;\n  text-align:center;\n  font-family:var(--ix-mono);\n  background:color-mix(in srgb, var(--ix-surface-solid) 46%, transparent);\n  backdrop-filter:blur(2.5px);\n  -webkit-backdrop-filter:blur(2.5px);\n}\nbody[data-w2v=\"c\"] .w2c-g-head{\n  display:flex; flex-direction:column; align-items:center; gap:1px; line-height:1;\n}\nbody[data-w2v=\"c\"] .w2c-g-tag{\n  font-size:8.5px; letter-spacing:1.4px; color:var(--ix-slate);\n}\nbody[data-w2v=\"c\"] .w2c-g-pos{\n  font-size:12px; font-weight:700; letter-spacing:.4px; color:var(--ix-cyan-light);\n  text-shadow:0 0 8px color-mix(in srgb, var(--ix-cyan) 55%, transparent);\n}\n\n/* body は定高さ＝marker の top:% が確実に解決される containing block になる */\nbody[data-w2v=\"c\"] .w2c-g-body{\n  position:relative; width:100%; height:230px;\n}\nbody[data-w2v=\"c\"] .w2c-g-lab{\n  position:absolute; left:0; right:0;\n  font-size:9px; line-height:1.1; letter-spacing:.1px;\n  color:var(--ix-slate-muted);\n}\nbody[data-w2v=\"c\"] .w2c-g-hi{\n  top:0;\n  color:color-mix(in srgb, var(--ix-red-soft) 72%, var(--ix-slate-light));\n}\nbody[data-w2v=\"c\"] .w2c-g-lo{\n  bottom:0;\n  color:color-mix(in srgb, var(--ix-blue) 70%, var(--ix-slate-light));\n}\n\n/* レール本体は幅0の線＝marker の left:% が必ず 0px に潰れる。\n   （横バーに転回する ≤768px では逆に height:0 で top:% が潰れる。結果、統合側は\n     left:pos% と top:(100-pos)% を“両方同時に”入れれば分岐なしでどちらでも正しく効く。）\n   見える帯は ::before が描く。安値=青 / 高値=赤＝ローソクの down/up 色と同じ語彙。 */\nbody[data-w2v=\"c\"] .w2c-track{\n  position:absolute; left:50%; top:15px; bottom:15px;\n  width:0;\n}\nbody[data-w2v=\"c\"] .w2c-track::before{\n  content:\"\";\n  position:absolute; left:-3px; top:0; bottom:0; width:6px;\n  border-radius:3px;\n  background:linear-gradient(to top,\n    color-mix(in srgb, var(--ix-blue-bright) 72%, transparent),\n    color-mix(in srgb, var(--ix-slate) 36%, transparent) 50%,\n    color-mix(in srgb, var(--ix-red-soft) 76%, transparent));\n  box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--ix-bg-void) 60%, transparent);\n}\nbody[data-w2v=\"c\"] .w2c-marker{\n  position:absolute; left:0; top:0;\n  width:26px; height:3px; border-radius:2px;\n  transform:translate(-50%, -50%);\n  background:var(--ix-cyan-light);\n  box-shadow:0 0 9px color-mix(in srgb, var(--ix-cyan) 85%, transparent);\n}\n/* 価格軸を指す小三角＝「いまの値はこの高さ」 */\nbody[data-w2v=\"c\"] .w2c-marker::after{\n  content:\"\";\n  position:absolute; right:-5px; top:50%;\n  transform:translateY(-50%);\n  border:4px solid transparent;\n  border-left-color:var(--ix-cyan-light);\n}\n\nbody[data-w2v=\"c\"] .w2c-g-foot{\n  display:flex; flex-direction:column; align-items:center; gap:2px;\n  line-height:1.25;\n}\nbody[data-w2v=\"c\"] .w2c-g-dist{\n  font-size:9px; color:var(--ix-slate-muted);\n}\nbody[data-w2v=\"c\"] .w2c-g-note{\n  font-size:8.5px; color:var(--ix-amber); line-height:1.2;\n}\nbody[data-w2v=\"c\"] .w2c-g-note:empty{ display:none; }\n\n/* ══ ≤768px: オーバーレイを畳んで通常フローへ ══════════════════\n   390px ではチャート高が 260px しかなく HUD が足元まで覆って破綻するため、\n   この幅では「チャート面を使う」思想を明示的に降ろし、縦増分を払う。 */\n@media (max-width: 768px){\n  body[data-w2v=\"c\"] .w2c-layer{\n    position:static; height:auto; margin:0 0 10px;\n    pointer-events:auto; opacity:1;\n  }\n  body[data-w2v=\"c\"] .w2c-hud{\n    position:static; align-items:center; gap:8px;\n  }\n  /* 8ボタンは折り返さず横スクロールのレール（端末の作法は維持）。\n     右端のマスクで「まだ先がある」ことを示す。 */\n  body[data-w2v=\"c\"] .w2c-seg{\n    flex:1 1 auto; min-width:0;\n    overflow-x:auto; overflow-y:hidden;\n    scrollbar-width:none; -ms-overflow-style:none;\n    scroll-snap-type:x proximity;\n    -webkit-overflow-scrolling:touch;\n    padding:3px 4px; gap:3px;\n    backdrop-filter:none; -webkit-backdrop-filter:none;\n    background:color-mix(in srgb, var(--ix-surface-1) 92%, transparent);\n    -webkit-mask-image:linear-gradient(90deg, rgba(0,0,0,1) 0,\n      rgba(0,0,0,1) calc(100% - 16px), rgba(0,0,0,0) 100%);\n    mask-image:linear-gradient(90deg, rgba(0,0,0,1) 0,\n      rgba(0,0,0,1) calc(100% - 16px), rgba(0,0,0,0) 100%);\n  }\n  body[data-w2v=\"c\"] .w2c-seg::-webkit-scrollbar{ display:none; }\n  body[data-w2v=\"c\"] .w2-p{\n    height:42px; min-width:46px; line-height:40px;\n    font-size:12px; padding:0 10px;\n    scroll-snap-align:center;\n  }\n  body[data-w2v=\"c\"] .w2c-seg-div{ height:20px; margin:0 5px; }\n  body[data-w2v=\"c\"] .w2-bench{\n    height:44px; padding:0 11px; font-size:12px;\n    backdrop-filter:none; -webkit-backdrop-filter:none;\n    background:color-mix(in srgb, var(--ix-surface-1) 92%, transparent);\n  }\n\n  /* 52週レンジは横バーに転回（lo 左 / hi 右＝row-reverse で DOM 順は不変） */\n  body[data-w2v=\"c\"] .w2-52w{\n    position:static; width:auto;\n    margin-top:8px; padding:7px 10px;\n    display:flex; flex-direction:row; flex-wrap:wrap;\n    align-items:center; gap:5px 10px;\n    text-align:left;\n    border-radius:4px;\n    border:1px solid color-mix(in srgb, var(--ix-border) 95%, transparent);\n    background:color-mix(in srgb, var(--ix-surface-1) 90%, transparent);\n    backdrop-filter:none; -webkit-backdrop-filter:none;\n  }\n  body[data-w2v=\"c\"] .w2c-g-head{\n    order:0; flex-direction:row; align-items:baseline; gap:6px;\n  }\n  body[data-w2v=\"c\"] .w2c-g-foot{\n    order:1; margin-left:auto; flex-direction:row; align-items:baseline; gap:8px;\n  }\n  body[data-w2v=\"c\"] .w2c-g-body{\n    order:2; flex:0 0 100%;\n    display:flex; flex-direction:row-reverse; align-items:center; gap:9px;\n    height:auto; position:relative;\n  }\n  body[data-w2v=\"c\"] .w2c-g-lab{\n    position:static; flex:0 0 auto; font-size:10px;\n  }\n  body[data-w2v=\"c\"] .w2c-track{\n    position:relative; left:auto; top:auto; bottom:auto;\n    flex:1 1 auto; min-width:0; width:auto; height:0;\n  }\n  body[data-w2v=\"c\"] .w2c-track::before{\n    left:0; right:0; top:-3px; bottom:auto;\n    width:auto; height:6px;\n    background:linear-gradient(to right,\n      color-mix(in srgb, var(--ix-blue-bright) 72%, transparent),\n      color-mix(in srgb, var(--ix-slate) 36%, transparent) 50%,\n      color-mix(in srgb, var(--ix-red-soft) 76%, transparent));\n  }\n  body[data-w2v=\"c\"] .w2c-marker{\n    width:3px; height:20px; border-radius:2px;\n  }\n  body[data-w2v=\"c\"] .w2c-marker::after{ display:none; }\n  body[data-w2v=\"c\"] .w2c-g-pos{ font-size:13px; }\n  body[data-w2v=\"c\"] .w2c-g-dist{ font-size:11px; }\n  body[data-w2v=\"c\"] .w2c-g-note{ font-size:10px; }\n}\n\n/* ══ ≤390px: さらに切り詰める（横スクロール/はみ出しを作らない）══ */\n@media (max-width: 390px){\n  body[data-w2v=\"c\"] .w2c-hud{ gap:6px; }\n  body[data-w2v=\"c\"] .w2-p{ min-width:44px; padding:0 8px; }\n  body[data-w2v=\"c\"] .w2-bench{ padding:0 9px; gap:5px; }\n  body[data-w2v=\"c\"] .w2-bench::before{ width:11px; }\n  body[data-w2v=\"c\"] .w2-52w{ padding:7px 9px; gap:4px 8px; }\n  body[data-w2v=\"c\"] .w2c-g-body{ gap:7px; }\n  body[data-w2v=\"c\"] .w2c-g-lab{ font-size:9.5px; }\n  body[data-w2v=\"c\"] .w2c-g-foot{ gap:6px; }\n}",
    "vertical_cost": "PC（>768px）: +0px。レイヤは height:0 の absolute 土台で、部品はすべて #chart-container の面（450px）に載る。／390px: 約 +125px（セグメント行 50px ＋ 間 8px ＋ 52W横バー 57px ＋ 下マージン 10px）。オーバーレイを降ろす代償がそのまま出る。",
    "tradeoffs": [
      "チャート面を覆う代償は消せない。52Wゲージが 52px×約300px を右端（プライススケールの内側）に置くため、直近の数本〜十数本のローソクにかかる。pointer-events:none＋blur透過＋既定opacity .72 で緩和はするが「隠さない」は不可能。",
      "この案の最大の売り（縦ゼロ増）はPC専用。≤768px ではオーバーレイを全部降ろすため、390px では逆に約125px と3案中もっとも重くなる可能性がある。",
      "top:44px / height:230px / right:78px / right:82px は「チャート高450px・rightPriceScale.minimumWidth:72・出来高 scaleMargins top:.82」を前提にしたマジックナンバー。#chart-container の高さやチャート設定を変えると再調整が要る。",
      "769〜1024px のタッチ端末には hover がないため、HUD が常時 opacity .72 のまま前面化しない（実害は薄さだけで操作は可能）。",
      "FY の非対称性をアンバー色＋非activeのドット＋seg の title 属性だけで伝えており、文字の説明が一切ない。初見では「なぜ FY だけ色が違うのか」に気づかない可能性がある（説明を足すと縦ゼロ増が崩れるので意図的に捨てた）。",
      "marker は left/top を両方 % で受ける設計。統合側は left:pos% と top:(100-pos)% を同時に入れる必要がある（片方だけだと縦・横どちらかのレイアウトで動かない）。",
      "backdrop-filter を多用するため、低スペック端末ではチャート再描画と重なった時に合成コストが乗る可能性がある。"
    ]
  }
};

/* W2「詳細の時間軸パック」実物比較モック（案 A/B/C を実アプリのシェル上で見比べる）。
 *
 *   .venv/bin/python scratchpad/w2-mock-server.py     # → http://127.0.0.1:8220/
 *   ?v=a | ?v=b | ?v=c で案を切替（右下の切替バーからも変えられる。localStorage で保持）
 *
 * 仕組み（リポの index.html / detail.js / detail-charts.js は一切改変しない。モック鯖が serve 時に
 * この 1 ファイルを </body> 直前へ注入するだけ）:
 *   1. LightweightCharts.createChart を包んで #chart-container のチャート実体を捕まえる
 *      （priceChart は detail-charts.js の closure 私有で外から取れないため。モック限定の手口）。
 *   2. #stock-title の変化を MutationObserver で見て「詳細ビューが描き直された」ことを検知する
 *      （navigate も switchYear も必ずここを通る＝両方の再描画を1点で拾える）。
 *   3. 期間切替は本実装と同じ経路を踏む＝ DetailCharts.setCandleData → updateMaAndVolume →
 *      Detail.renderSignalDigest → Detail.renderDisciplineCard（＝これはレイアウト比較用の張りぼてではなく
 *      本当に動くプロトタイプ。S/R・ZigZag・VWAP・サブパネルまで窓に追従する）。
 *   4. 52週レンジは STOCK_DATA[ticker].px（/api/market/list のサーバ計算値）をそのまま読む
 *      ＝ JS 側で再計算しない（D9 原則）。
 *   5. ベンチマークは getStock(bench) で ohlcv を取り、主銘柄の窓内初値へリベースして同一軸に重ねる。
 *
 * ⚠ このファイルは throwaway の比較ハーネス。ここでの rollingWindow/benchRebase は本実装（detail-rules.js
 *   の純関数）の下書きであって、本番コードではない。
 */
(function () {
  "use strict";

  // ── 案の定義（マークアップ/CSS は 3 エージェントが独立に設計したものを機械的に流し込む）──
  var VARIANTS = window.__W2_VARIANT_DEFS__ || {};

  var LS_KEY = "sip_w2_mock_variant";
  var LS_PERIOD = "sip_detail_period";
  var PERIODS = ["FY", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"];

  // ── 純関数の下書き（本実装は detail-rules.js に置く）───────────────────────

  /* ローリング窓。アンカーは wall-clock ではなく **prices の最終バー日**（データが stale でも窓がズレない・
     テストが決定論になる。既存 normalizeForCompare の new Date() は踏襲しない）。 */
  function rollingWindow(prices, key) {
    if (!prices || !prices.length) return { startDate: null, endDate: null, displayPrices: [], fallback: false };
    var endDate = prices[prices.length - 1].time;
    if (key === "MAX") {
      return { startDate: prices[0].time, endDate: endDate, displayPrices: prices.slice(), fallback: false };
    }
    var startDate;
    if (key === "YTD") {
      startDate = endDate.slice(0, 4) + "-01-01";
    } else {
      var months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "5Y": 60 }[key];
      if (!months) return { startDate: null, endDate: endDate, displayPrices: prices.slice(), fallback: false };
      startDate = _minusMonths(endDate, months);
    }
    var win = prices.filter(function (p) { return p.time >= startDate && p.time <= endDate; });
    var fallback = win.length < 2;
    return { startDate: startDate, endDate: endDate, displayPrices: fallback ? prices.slice() : win, fallback: fallback };
  }

  /* 月引き算。JS の Date は 3/31 の 1ヶ月前を 3/3 に溢れさせるので、溢れたら対象月の末日へクランプする。 */
  function _minusMonths(iso, months) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    var tm = m - months, ty = y;
    while (tm <= 0) { tm += 12; ty -= 1; }
    var last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();   // 対象月の末日
    var td = Math.min(d, last);
    return ty + "-" + String(tm).padStart(2, "0") + "-" + String(td).padStart(2, "0");
  }

  /* ベンチを**両者の共通開始日**でリベースする（無次元化＝円/ドル混在でも同一軸に載る）。
     ⚠ 窓先頭の主銘柄終値に貼ると、ベンチの履歴が窓より短いとき（MAX で 7203.T は 1999年〜／
        1306.T は 2009年〜）「2009年の TOPIX を 1999年のトヨタ株価に一致させた線」を描いてしまう。
        アンカーは必ず両者が揃う最初の日に置き、揃わなかったことは covered=false で呼び出し側へ渡す。 */
  function benchRebase(benchPrices, mainWin) {
    var empty = { points: [], anchorTime: null, covered: false };
    if (!benchPrices || !benchPrices.length || !mainWin || mainWin.length < 2) return empty;
    var s = mainWin[0].time, e = mainWin[mainWin.length - 1].time;
    var w = benchPrices.filter(function (p) { return p.time >= s && p.time <= e; });
    if (w.length < 2) return empty;
    var anchorTime = w[0].time > s ? w[0].time : s;
    var mainAnchor = null;
    for (var i = 0; i < mainWin.length; i++) {
      if (mainWin[i].time >= anchorTime) { mainAnchor = mainWin[i]; break; }
    }
    var bAnchor = null;                                   // ※ module 変数 benchAnchor と別物（誤読防止で改名）
    for (var j = 0; j < w.length; j++) {
      if (w[j].time >= anchorTime) { bAnchor = w[j]; break; }
    }
    if (!mainAnchor || !bAnchor) return empty;
    var base = bAnchor.close, mainBase = mainAnchor.close;
    if (!(base > 0) || !(mainBase > 0)) return empty;
    return {
      points: w.map(function (p) {
        return { time: p.time, value: Math.round(mainBase * (p.close / base) * 10000) / 10000 };
      }),
      anchorTime: anchorTime,
      covered: anchorTime === s,
    };
  }

  function benchFor(ticker, data) {
    var market = (data && data.country) || (String(ticker).endsWith(".T") ? "JP" : "US");
    var b = market === "JP" ? "1306.T" : "SPY";
    if (b === ticker) return null;                       // ベンチ自身を開いている
    return { ticker: b, label: market === "JP" ? "vs TOPIX" : "vs S&P500" };
  }

  // ── チャート実体の捕獲（モック限定）──────────────────────────────────
  // ⚠ LightweightCharts の名前空間オブジェクトは凍結されていて createChart を直接差し替えられない
  //    （"Cannot assign to read only property" を実際に踏んだ）。名前空間ごと Proxy に置き換えて
  //    createChart の getter だけ差し替える。失敗してもモック全体は動くよう try/catch で握る
  //    （ベンチ重ね描きだけが無効になる）。
  var priceChart = null, benchSeries = null;
  (function patchCreateChart() {
    var tryPatch = function () {
      var LC = window.LightweightCharts;
      if (!LC || LC.__w2patched) return !!(LC && LC.__w2patched);
      var wrapped = function (container) {
        var chart = LC.createChart.apply(LC, arguments);
        var el = typeof container === "string" ? document.getElementById(container) : container;
        if (el && el.id === "chart-container") priceChart = chart;
        return chart;
      };
      try {
        // Proxy は不可（非設定可能・非書込可の data property は「実値を返せ」という不変条件があり
        //  get トラップで差し替えると TypeError になる＝実際に踏んだ）。名前空間の**浅いコピー**を作り、
        //  そこだけ createChart を差し替えて window の束縛ごと置き換える。
        var copy = {};
        Object.getOwnPropertyNames(LC).forEach(function (k) {
          if (k === "createChart") return;
          try { copy[k] = LC[k]; } catch (e2) { /* getter が投げるものは諦める */ }
        });
        copy.createChart = wrapped;
        copy.__w2patched = true;
        window.LightweightCharts = copy;
        return true;
      } catch (e) {
        console.warn("[w2-mock] createChart を包めませんでした（ベンチ重ね描きは無効）", e);
        return true;                                  // 再試行しても無駄なので打ち切る
      }
    };
    if (!tryPatch()) document.addEventListener("DOMContentLoaded", tryPatch);
  })();

  // ── 状態 ───────────────────────────────────────────────────────
  var variantKey = _initialVariant();
  var selectedPeriod = _readPeriod();
  var benchOn = false;
  var mounted = false;
  var applying = false;

  function _initialVariant() {
    var q = new URLSearchParams(location.search).get("v");
    if (q && VARIANTS[q]) { try { localStorage.setItem(LS_KEY, q); } catch (e) {} return q; }
    var saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch (e) {}
    return (saved && VARIANTS[saved]) ? saved : Object.keys(VARIANTS)[0] || "a";
  }
  function _readPeriod() {
    var v = null;
    try { v = localStorage.getItem(LS_PERIOD); } catch (e) {}
    return PERIODS.indexOf(v) >= 0 ? v : "FY";        // 未知値は FY に正規化
  }
  function _writePeriod(v) { try { localStorage.setItem(LS_PERIOD, v); } catch (e) {} }

  // ── 案の CSS を全部入れて data-w2v で出し分ける ───────────────────────
  function injectCss() {
    var css = Object.keys(VARIANTS).map(function (k) { return VARIANTS[k].css || ""; }).join("\n");
    css += "\n" + SWITCHER_CSS;
    var st = document.createElement("style");
    st.id = "w2-mock-style";
    st.textContent = css;
    document.head.appendChild(st);
    document.body.setAttribute("data-w2v", variantKey);
  }

  // ── 案のマークアップを挿す ────────────────────────────────────────
  var ANCHORS = {
    cardTitle: function () { return document.getElementById("stock-title"); },
    maBar: function () { return document.querySelector("#detail-view .ma-control-bar"); },
    chartContainer: function () { return document.getElementById("chart-container"); },
    subpanelBar: function () { return document.querySelector("#detail-view .subpanel-bar"); },
  };

  function mountParts() {
    if (mounted) return true;
    var def = VARIANTS[variantKey];
    if (!def) return false;
    var ok = true;
    (def.parts || []).forEach(function (part, i) {
      var anchor = (ANCHORS[part.anchor] || function () { return null; })();
      if (!anchor) { ok = false; return; }
      var holder = document.createElement("div");
      holder.innerHTML = part.html;
      var node = holder.firstElementChild;
      if (!node) return;
      node.setAttribute("data-w2-part", variantKey + ":" + i);
      if (part.position === "before") anchor.parentNode.insertBefore(node, anchor);
      else if (part.position === "after") anchor.parentNode.insertBefore(node, anchor.nextSibling);
      else if (part.position === "prepend") anchor.insertBefore(node, anchor.firstChild);
      else anchor.appendChild(node);
    });
    if (!ok) return false;
    mounted = true;
    wire();
    return true;
  }

  function unmountParts() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-w2-part]"), function (n) { n.remove(); });
    mounted = false;
  }

  // ── 配線 ──────────────────────────────────────────────────────
  function wire() {
    document.querySelectorAll(".w2-p").forEach(function (btn) {
      btn.addEventListener("click", function () { setPeriod(btn.getAttribute("data-p")); });
    });
    var chip = document.querySelector(".w2-bench");
    if (chip) chip.addEventListener("click", function () { toggleBench(); });
  }

  function paintPeriodButtons() {
    document.querySelectorAll(".w2-p").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-p") === selectedPeriod);
    });
  }

  function setPeriod(key) {
    if (PERIODS.indexOf(key) < 0) return;
    selectedPeriod = key;
    _writePeriod(key);
    paintPeriodButtons();
    applyWindow();
  }

  /* 本実装の applyPriceWindow() 相当。価格系だけを窓に合わせて描き直す（財務3表には触らない）。 */
  function applyWindow() {
    var data = STOCK_DATA[currentTicker];
    if (!data || !data.prices || !data.prices.length) return;
    applying = true;
    try {
      var win;
      if (selectedPeriod === "FY") {
        var isUS = data.country === "US";
        var year = _currentFyYear();
        win = window.DetailRules.priceWindow(data.prices, year, isUS);
      } else {
        win = rollingWindow(data.prices, selectedPeriod);
      }
      var dp = win.displayPrices;
      if (!dp || !dp.length) return;
      window.DetailCharts.setCandleData(dp);
      window.DetailCharts.updateMaAndVolume(dp, data.prices);
      window.Detail.renderSignalDigest(dp, data.prices);
      window.Detail.renderDisciplineCard(dp, data.prices);
      paintSubtitle(win);
      redrawBench(dp);
      measure();
    } finally {
      applying = false;
    }
  }

  function _currentFyYear() {
    var el = document.getElementById("selected-year-display");
    var m = el && /(\d{4})/.exec(el.innerText || "");
    return m ? +m[1] : 2025;
  }

  /* モックでは既存の副題は触らず、期間モードのときだけ小さな注記を出す（本実装の文言設計は spec で決める）。 */
  function paintSubtitle(win) {
    var host = document.querySelector("[data-w2='rangeNote']");
    if (!host) return;
    host.textContent = selectedPeriod === "FY" ? "" :
      (win.startDate + " 〜 " + win.endDate + "（" + win.displayPrices.length + "本）" + (win.fallback ? " ※データ不足のため全期間" : ""));
  }

  // ── ベンチマーク ─────────────────────────────────────────────────
  var benchGen = 0, benchPoints = 0, benchAnchor = null;
  // 実験用スイッチ: ベンチ系列を右軸の autoscale に参加させるか（spec の D4 再判定のため）。
  //  参加させると 1306.T の異常バー（1日だけ 1/10）が軸を引き伸ばしてローソクが潰れる。
  var benchAutoscale = true;
  function benchOptions() {
    var o = {
      color: "#8aa0ff", lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    };
    if (!benchAutoscale) o.autoscaleInfoProvider = function () { return null; };
    return o;
  }
  function toggleBench() {
    benchOn = !benchOn;
    var chip = document.querySelector(".w2-bench");
    if (chip) chip.classList.toggle("active", benchOn);
    var data = STOCK_DATA[currentTicker];
    if (!data) return;
    var win = selectedPeriod === "FY"
      ? window.DetailRules.priceWindow(data.prices, _currentFyYear(), data.country === "US")
      : rollingWindow(data.prices, selectedPeriod);
    redrawBench(win.displayPrices);
  }

  function redrawBench(displayPrices) {
    if (!priceChart) return;
    var data = STOCK_DATA[currentTicker];
    var b = data && benchFor(currentTicker, data);
    var chip = document.querySelector(".w2-bench");
    if (chip) {
      var lab = chip.querySelector("[data-w2='benchLabel']");
      if (lab && b) lab.textContent = b.label;
      chip.style.display = b ? "" : "none";
    }
    if (!benchOn || !b) {
      if (benchSeries) benchSeries.setData([]);
      benchPoints = 0; benchAnchor = null;
      return;
    }
    var gen = ++benchGen;
    Promise.resolve(window.getStock(b.ticker)).then(function (bd) {
      if (gen !== benchGen) return;                                  // 世代ガード（別銘柄/別窓へ移った後の描画を捨てる）
      var series = benchSeries || (benchSeries = priceChart.addLineSeries(benchOptions()));
      var reb = benchRebase((bd && bd.prices) || [], displayPrices);
      benchPoints = reb.points.length;                               // 受入が「本当に線が出たか」を見るため
      benchAnchor = reb;
      series.setData(reb.points);
      var chip2 = document.querySelector(".w2-bench [data-w2='benchLabel']");
      if (chip2 && b) chip2.textContent = reb.covered ? b.label : b.label + "（" + reb.anchorTime.slice(0, 4) + "年〜）";
    });
  }

  // ── 52週レンジ ──────────────────────────────────────────────────
  function paint52w() {
    var root = document.querySelector(".w2-52w");
    if (!root) return;
    var data = STOCK_DATA[currentTicker];
    var px = data && data.px;
    var ok = px && px.pos52 != null && px.hi52 != null && px.lo52 != null;
    root.style.display = ok ? "" : "none";
    if (!ok) return;
    var cur = (data.currency === "USD") ? "$" : "¥";
    var set = function (k, v) { var el = root.querySelector("[data-w2='" + k + "']"); if (el) el.textContent = v; };
    set("lo", cur + _fmt(px.lo52));
    set("hi", cur + _fmt(px.hi52));
    set("pos", Math.round(px.pos52) + "%");
    set("dist", window.PortalPriceRules ? window.PortalPriceRules.fmtDistHigh(px.dh) : "--");
    var marker = root.querySelector("[data-w2='marker']");
    if (marker) {
      var p = window.PortalPriceRules ? window.PortalPriceRules.clampPos(px.pos52) : px.pos52;
      marker.style.left = p + "%";
      marker.style.setProperty("--w2-pos", p + "%");
    }
    var stale = window.PortalPriceRules && typeof DATA_MARKET_ASOF !== "undefined"
      ? window.PortalPriceRules.isStale(px, DATA_MARKET_ASOF, window.PortalPriceRules.marketOf(currentTicker, data))
      : false;
    set("note", stale ? "終値 " + px.date + "（更新待ち）" : "");
  }
  function _fmt(v) {
    if (v == null) return "--";
    return v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2);
  }

  // ── 詳細ビューの再描画検知（navigate も switchYear も #stock-title を必ず書き換える）──
  function observe() {
    var title = document.getElementById("stock-title");
    if (!title) return;
    new MutationObserver(function () {
      if (applying) return;
      if (!mountParts()) return;
      // 銘柄/年が変わった＝ベンチはいったん消す（本実装では窓に合わせて張り直す）
      paintPeriodButtons();
      paint52w();
      if (selectedPeriod !== "FY") setTimeout(applyWindow, 0);       // FY 描画のあとにローリング窓を当てる
      else { redrawBench(null); measure(); }
    }).observe(title, { childList: true, subtree: true, characterData: true });
  }

  // ── 切替バー（案の比較・ページ縦 px の実測表示）────────────────────────
  var SWITCHER_CSS = [
    "#w2-switch{position:fixed;right:12px;bottom:12px;z-index:99999;display:flex;align-items:center;gap:8px;",
    "background:rgba(4,8,13,0.92);border:1px solid #2a3a44;border-radius:6px;padding:8px 10px;",
    "font:12px ui-monospace,Menlo,Consolas,monospace;color:#a8bcc6;box-shadow:0 8px 30px rgba(0,0,0,0.6)}",
    "#w2-switch button{background:transparent;border:1px solid #2a3a44;color:#7f95a3;border-radius:3px;",
    "padding:4px 10px;cursor:pointer;font:inherit;font-weight:bold}",
    "#w2-switch button.on{border-color:#00e5ff;color:#00e5ff;background:rgba(0,229,255,0.12)}",
    "#w2-switch .m{color:#8ba2af;white-space:nowrap}",
  ].join("");

  function buildSwitcher() {
    var bar = document.createElement("div");
    bar.id = "w2-switch";
    var label = document.createElement("span");
    label.textContent = "W2案";
    bar.appendChild(label);
    Object.keys(VARIANTS).forEach(function (k) {
      var b = document.createElement("button");
      b.textContent = k.toUpperCase() + " " + (VARIANTS[k].name || "");
      b.className = k === variantKey ? "on" : "";
      b.addEventListener("click", function () {
        variantKey = k;
        try { localStorage.setItem(LS_KEY, k); } catch (e) {}
        document.body.setAttribute("data-w2v", k);
        unmountParts();
        mountParts();
        paintPeriodButtons();
        paint52w();
        redrawBench(null);
        Array.prototype.forEach.call(bar.querySelectorAll("button"), function (x) { x.className = ""; });
        b.className = "on";
        measure();
      });
      bar.appendChild(b);
    });
    var m = document.createElement("span");
    m.className = "m";
    m.id = "w2-measure";
    bar.appendChild(m);
    document.body.appendChild(bar);
  }

  function measure() {
    var m = document.getElementById("w2-measure");
    if (!m) return;
    var card = document.getElementById("chart-container");
    var cardRoot = card && card.closest(".card");
    m.textContent = "page " + document.documentElement.scrollHeight + "px / card "
      + (cardRoot ? Math.round(cardRoot.getBoundingClientRect().height) : "-") + "px";
  }

  // ── 起動 ──────────────────────────────────────────────────────
  function boot() {
    if (!Object.keys(VARIANTS).length) {
      console.warn("[w2-mock] 案の定義が空です（window.__W2_VARIANT_DEFS__ 未注入）");
      return;
    }
    injectCss();
    buildSwitcher();
    observe();
    window.addEventListener("resize", measure);
    console.log("[w2-mock] ready. variant=" + variantKey + " period=" + selectedPeriod);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // デバッグ用（受入スクリプトから叩く）
  window.__W2 = {
    rollingWindow: rollingWindow, benchRebase: benchRebase, benchFor: benchFor,
    setPeriod: setPeriod, toggleBench: toggleBench, paint52w: paint52w,
    get benchPoints() { return benchPoints; },
    get benchAnchor() { return benchAnchor; },
    get chartCaptured() { return !!priceChart; },
    /* 右軸の可視レンジを読む（LWC に軸レンジ API が無いので、右軸を共有する系列の
       coordinateToPrice を使って上端/下端の価格を逆算する）。 */
    axisProbe: function () {
      if (!benchSeries || !priceChart) return null;
      var h = document.getElementById("chart-container").clientHeight;
      var top = benchSeries.coordinateToPrice(0);
      var bot = benchSeries.coordinateToPrice(h);
      return { top: top, bottom: bot, height: h };
    },
    /* ベンチを右軸の autoscale に参加させるかを切り替えて張り直す（実験用）。 */
    setBenchAutoscale: function (on) {
      benchAutoscale = !!on;
      if (benchSeries && priceChart) { priceChart.removeSeries(benchSeries); benchSeries = null; }
      var data = STOCK_DATA[currentTicker];
      var win = selectedPeriod === "FY"
        ? window.DetailRules.priceWindow(data.prices, _currentFyYear(), data.country === "US")
        : rollingWindow(data.prices, selectedPeriod);
      redrawBench(win.displayPrices);
    },
    get variant() { return variantKey; },
    get period() { return selectedPeriod; },
  };
})();
