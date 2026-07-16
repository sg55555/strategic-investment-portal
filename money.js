// money.js — お金の司令塔(MCC) ブラウザ層。window.MCCRules(純関数)をDOMへ適用する薄い層。
// v2(Slice2): クラウド同期（ログイン=自動同期）＋資産目標(goals) UI を追加。
// 業務math は money-rules.js に閉じる（ここは load/save/同期/描画のみ）。
window.MCC = (function () {
  "use strict";
  var R = window.MCCRules;
  var state = null;
  var lastSaveOk = true;

  // クラウド同期の状態（自動同期＝ログインしたら以降の save が cloud にも飛ぶ）。
  var sync = { loggedIn: false, busy: false, lastSyncOk: true, lastError: "" };
  var _sessionChecked = false;
  var _cloudTimer = null;   // debounce タイマー
  var _cloudBusy = false;   // PUT in-flight（直列化）
  var _cloudPending = false;// in-flight 中に来た編集の再送フラグ
  var _cloudDirty = false;  // 未確定の編集が cloud に未到達か（離脱時フラッシュ判定）

  // AI規律コーチ（Slice3）の状態。render 跨ぎで保持（毎 render 再描画＝paintSyncStatus と同方針）。
  var advice = null;
  var adviceBusy = false;
  var adviceErr = "";

  // Slice4: 収支連携（投資余力）。/api/me/cashflow の生行を保持（read-only・ログイン時のみ取得）。
  var _cashflowRows = [];
  // データ基盤Phase2: 投資台帳。/api/me/investment の生行を保持（read-only・保有ゼロ/未配線でも空配列で degrade）。
  var _investmentRows = [];
  var _refreshing = false; // 「最新に更新」ボタンの多重起動ガード（in-session 再取得）

  // Task6b (backlog B#2): 資産クラス比率のスコープ表示切替（永続 state でない・モジュール view 変数）。
  var _acScope = "core"; // "core"=コアの設計図（心臓部）/ "total"=総資産で俯瞰。既定=core。

  // 基準（アンカー）の月を「2026年7月」表記へ整形（YYYY-MM-01 / YYYY-MM どちらも受ける）。
  function fmtAnchorMonth(d) {
    var m = /^(\d{4})-(\d{2})/.exec(String(d == null ? "" : d));
    return m ? (m[1] + "年" + parseInt(m[2], 10) + "月") : esc(d);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- 永続化（local 即時 ＋ logged-in 時のみ cloud へ debounced PUT）----
  function load() {
    try {
      var raw = localStorage.getItem(R.STORAGE_KEY);
      state = R.migrate(raw ? JSON.parse(raw) : null);
    } catch (e) { state = R.defaultState(); }
    return state;
  }

  function saveLocal() {
    var ok;
    try { localStorage.setItem(R.STORAGE_KEY, JSON.stringify(state)); ok = true; }
    catch (e) { ok = false; }
    lastSaveOk = ok;
    return ok;
  }

  // ユーザ編集による保存。updatedAt を刻んで last-write-wins の基準にする。
  function save() {
    state.updatedAt = Date.now();
    var ok = saveLocal();
    cloudSave();
    return ok;
  }

  // ---- API（すべて同一オリジン＝cookie 自動送出。credentials は明示）----
  function apiJSON(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { ok: r.ok, status: r.status, data: j };
      });
    });
  }

  // 編集のたびに呼ぶ。debounce してから直列に PUT（順序保証）。
  function cloudSave() {
    if (!sync.loggedIn) return;
    _cloudDirty = true;
    if (_cloudTimer) clearTimeout(_cloudTimer);
    _cloudTimer = setTimeout(cloudFlush, 800);
  }

  // debounce 発火。in-flight 中なら pending にして1回だけ再送（古い PUT が後勝ちしない）。
  function cloudFlush() {
    _cloudTimer = null;
    if (!sync.loggedIn) { _cloudDirty = false; return; }
    if (_cloudBusy) { _cloudPending = true; return; }
    _cloudBusy = true;
    apiJSON("PUT", "/api/me/state", { state: state }).then(function (res) {
      _cloudBusy = false;
      if (res.status === 401) { sync.loggedIn = false; _cloudDirty = false; repaintSyncBar(); }
      else if (res.ok) { _cloudDirty = false; sync.lastSyncOk = true; paintSyncStatus(); }
      else { sync.lastSyncOk = false; paintSyncStatus(); }
      if (_cloudPending) { _cloudPending = false; cloudFlush(); }
    }).catch(function () {
      _cloudBusy = false; sync.lastSyncOk = false; paintSyncStatus();
      if (_cloudPending) { _cloudPending = false; cloudFlush(); }
    });
  }

  // ページ離脱時、未送信の編集を keepalive で同期的に送る（debounce 内の取りこぼし防止）。
  function cloudFlushBeacon() {
    if (!sync.loggedIn || !_cloudDirty) return;
    if (_cloudTimer) { clearTimeout(_cloudTimer); _cloudTimer = null; }
    try {
      fetch("/api/me/state", {
        method: "PUT", keepalive: true, credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: state }),
      });
      _cloudDirty = false;
    } catch (e) { /* 離脱中なので何もできない */ }
  }

  // コーチ相談の前に保留中の編集を確実に Neon へ反映（サーバが最新 state を読めるように）。
  function flushNow() {
    if (!sync.loggedIn || !_cloudDirty) return Promise.resolve();
    if (_cloudTimer) { clearTimeout(_cloudTimer); _cloudTimer = null; }
    return apiJSON("PUT", "/api/me/state", { state: state }).then(function (res) {
      if (res.ok) { _cloudDirty = false; sync.lastSyncOk = true; }
      return res;
    }).catch(function () { return { ok: false }; });
  }

  // AI規律コーチに相談（ログイン時のみ）。最新 state を反映してからサーバに集約・LLM させる。
  function requestAdvice() {
    if (adviceBusy) return;
    if (!sync.loggedIn) { advice = null; adviceErr = "セッションが切れました。再ログインしてください"; render(); return; } // fe-2
    adviceBusy = true; adviceErr = ""; render();
    flushNow().then(function () {
      return apiJSON("POST", "/api/me/advice", {});
    }).then(function (res) {
      adviceBusy = false;
      // fe-4: 401 以外（429/503/一過性）は直前の良好な助言を破棄せず adviceErr のみ表示。
      if (res.status === 401) { sync.loggedIn = false; advice = null; adviceErr = "セッションが切れました。再ログインしてください"; }
      else if (res.status === 429) { adviceErr = "短時間に相談が多すぎます。少し待って再試行してください"; }
      else if (res.status === 503) { adviceErr = "AIコーチは未設定です（規律ルールは上に表示）"; } // fe-7
      else if (!res.ok || !res.data) { adviceErr = "コーチの取得に失敗しました"; }
      else {
        advice = res.data;
        advice._stateTs = (state && Number(state.updatedAt)) || 0; // 取得時の state 版（変化検知）
      }
      render();
    }).catch(function () { adviceBusy = false; adviceErr = "通信エラー"; render(); });
  }

  // Slice4: 収支スナップショットを取得（認証データ＝ログイン時のみ意味がある）。失敗は空配列で degrade。
  // 成功時のみ rows を差し替え＝refresh の一過性失敗で表示中の good データを空に落とさない（requestAdvice fe-4 と同型）。
  // 初回ロードは prior が [] なので挙動不変。401 は他経路(reconcile/cloudFlush/requestAdvice)と一貫して loggedIn を倒す。
  // logout が明示クリアするのでアカウント跨ぎの残留は無い。
  function loadCashflow() {
    return apiJSON("GET", "/api/me/cashflow").then(function (res) {
      if (res.ok && res.data && Array.isArray(res.data.cashflow)) _cashflowRows = res.data.cashflow;
      else if (res.status === 401) sync.loggedIn = false;
    }).catch(function () { /* ネットワーク断は直前データを温存 */ });
  }
  // データ基盤Phase2: 投資台帳の生行を取得（cashflow と別 endpoint＝故障隔離・保有ゼロは空配列で degrade）。
  function loadInvestment() {
    return apiJSON("GET", "/api/me/investment").then(function (res) {
      if (res.ok && res.data && Array.isArray(res.data.investment)) _investmentRows = res.data.investment;
      else if (res.status === 401) sync.loggedIn = false;
    }).catch(function () { /* 直前データを温存 */ });
  }

  // ユーザー任意の「今すぐ最新化」：Neon の最新スナップショットを取り直して再描画（月次自動更新を待たない）。
  // kakeibo→Neon の ETL は起動せず、既に Neon にある確定データの再取得のみ＝副作用ゼロ・安全。
  // 「今どこまで取り込まれているか」をその場で確定できるようにする（鮮度行の隣にボタンを置く）。
  function refreshData() {
    if (_refreshing || !sync.loggedIn) return;
    _refreshing = true;
    render();  // 即「更新中…」を反映（ボタン無効化）
    var done = function () { _refreshing = false; render(); };
    Promise.all([loadCashflow(), loadInvestment()]).then(done, done);
  }

  // ワンタップ：今月の投資余力をウォーターフォール（バッファ→確保枠→コア）で各先へ加算。
  // 既存 save()/クラウド同期に乗る＝「可視化→配分→目標→AI助言」のループを閉じる（明示的な本人操作）。
  // 規律＝バッファ→確保枠（優先順位配分）→コア。保存則 toBuffer+Σallocated+toCore==monthlySurplus（純関数で担保）。
  function applySurplus() {
    if (!state) load();
    var cv = R.cashflowViewModel(_cashflowRows, state, Date.now());
    if (!cv.available || cv.monthlySurplus <= 0 || !cv.applyPeriod) return;
    if (cv.alreadyApplied) return;  // 同一確定月の二重計上を防ぐ（クラウド同期される恒久水増し回避）
    var b = state.buckets;
    b.buffer.amount = (Number(b.buffer.amount) || 0) + cv.toBuffer;
    // 確保枠へ提案配分を saved に積む（id 一致・自動執行 Model A・本人選択 2026-06-30）。
    (cv.reserves || []).forEach(function (ra) {
      if (!(ra.allocated > 0)) return;
      var rv = _findReserve(ra.id);
      if (rv) rv.saved = (Number(rv.saved) || 0) + ra.allocated;
    });
    b.core.amount = (Number(b.core.amount) || 0) + cv.toCore;  // 確保枠控除後の残り＝コア（toSatellite は常に0）
    state.lastAppliedCashflowPeriod = cv.applyPeriod;  // この確定月は反映済みと記録
    save();
    render();
  }

  // データ基盤Phase1: 定点アンカー（基準日の現金）を保存。以降の確定収支から現在現金を自動導出する起点。
  function saveAnchor() {
    var mo = (document.getElementById("mcc-anchor-month") || {}).value || "";  // YYYY-MM（月単位）
    var amt = (document.getElementById("mcc-anchor-amount") || {}).value || "";
    if (!/^\d{4}-\d{2}$/.test(mo) || !(Number(amt) >= 0)) return;
    if (!state) load();
    state.anchor = { date: mo + "-01", amount: Number(amt) >= 0 ? Number(amt) : 0 };  // 常に月初へ正規化
    save();
    render();
  }
  function editAnchor() {
    if (!state) load();
    if (state.anchor) state.anchor.date = "";  // 未設定に戻し再入力フォームを出す（amount は破棄）
    save();
    render();
  }

  // 背景同期の結果はステータス要素だけ差分更新（innerHTML 再構築で入力フォーカスを壊さない）。
  function paintSyncStatus() {
    var el = document.getElementById("mcc-sync-status");
    if (!el) return;
    el.textContent = syncStatusText();
  }

  // 背景 401 等で同期バーだけ差し替える（full render は入力フォーカス/未確定テキストを壊すため避ける）。
  function repaintSyncBar() {
    var bar = document.querySelector("#mcc-root .mcc-sync");
    if (bar) bar.outerHTML = syncBar();
    else paintSyncStatus();
  }
  function syncStatusText() {
    if (!sync.loggedIn) return "☁ クラウド同期（複数端末で共有）";
    return sync.lastSyncOk === false ? "☁ ⚠ 同期エラー（後で再試行）" : "☁ ✓ この端末はクラウド同期中";
  }

  // ---- 認証 ----
  function checkSession() {
    return apiJSON("GET", "/api/auth/session").then(function (res) {
      sync.loggedIn = !!(res.ok && res.data && res.data.ok);
      return sync.loggedIn;
    }).catch(function () { sync.loggedIn = false; return false; });
  }

  // ログイン直後/セッション確認後に1回。last-write-wins（updatedAt 比較）で調停する。
  function reconcile() {
    return apiJSON("GET", "/api/me/state").then(function (res) {
      if (res.status === 401) { sync.loggedIn = false; return; }
      if (!res.ok) { sync.lastSyncOk = false; return; }
      var cloud = res.data && res.data.state;
      var localTs = (state && Number(state.updatedAt)) || 0;
      var cloudTs = (cloud && Number(cloud.updatedAt)) || 0;
      if (cloud && typeof cloud === "object" && cloudTs >= localTs) {
        state = R.migrate(cloud);   // cloud が新しい（または同等）→ cloud 採用
        saveLocal();
        sync.lastSyncOk = true;
      } else {
        // local が新しい or cloud 空 → local を push（初回 seed も兼ねる・export 流用）
        _cloudDirty = true;
        cloudFlush();
      }
    }).catch(function () { sync.lastSyncOk = false; });
  }

  function doLogin() {
    var el = document.getElementById("mcc-pw");
    var pw = el ? el.value : "";
    if (!pw) { sync.lastError = "パスワードを入力してください"; render(); return; }
    sync.busy = true; sync.lastError = ""; render();
    apiJSON("POST", "/api/auth/login", { password: pw }).then(function (res) {
      sync.busy = false;
      if (res.ok && res.data && res.data.ok) {
        sync.loggedIn = true;
        Promise.all([reconcile(), loadCashflow(), loadInvestment()]).then(function () { render(); });
      } else {
        sync.loggedIn = false;
        sync.lastError = res.status === 401 ? "パスワードが違います"
          : res.status === 503 ? "サーバ未設定（管理者に連絡してください）"
          : "ログインに失敗しました";
        render();
      }
    }).catch(function () { sync.busy = false; sync.lastError = "通信エラー"; render(); });
  }

  function logout() {
    if (_cloudTimer) { clearTimeout(_cloudTimer); _cloudTimer = null; }
    _cloudPending = false; _cloudDirty = false;  // 保留中の PUT を破棄（ログアウト後に飛ばさない）
    advice = null; adviceErr = ""; adviceBusy = false;  // 個人化助言ブロックを残さない（fe-1）
    _cashflowRows = [];  // 認証データ＝ログアウトで破棄（次のログインで再取得）
    _investmentRows = [];
    apiJSON("POST", "/api/auth/logout").catch(function () {});
    sync.loggedIn = false; sync.lastError = ""; render();  // ローカル state はそのまま残す
  }

  // ---- 目標(goals) ----
  function addGoal() {
    var label = (document.getElementById("mcc-goal-label") || {}).value || "";
    var amount = (document.getElementById("mcc-goal-amount") || {}).value || "";
    var deadline = (document.getElementById("mcc-goal-deadline") || {}).value || "";
    label = label.trim();
    if (!label && !Number(amount)) return;  // 完全な空は無視
    if (!state) load();
    var id = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var goal = R.normalizeGoal({ id: id, label: label, targetAmount: amount, deadline: deadline }, (state.goals || []).length);
    state.goals = (state.goals || []).concat([goal]);
    save(); render();
  }
  function removeGoal(id) {
    if (!state) load();
    state.goals = (state.goals || []).filter(function (g) { return g.id !== id; });
    save(); render();
  }

  // ---- 確保枠(reserves・sinking fund) ----
  function _findReserve(id) {
    return ((state && state.reserves) || []).filter(function (r) { return r.id === id; })[0] || null;
  }
  function addReserve() {
    var label = ((document.getElementById("mcc-rsv-label") || {}).value || "").trim();
    var target = (document.getElementById("mcc-rsv-target") || {}).value || "";
    var deadline = (document.getElementById("mcc-rsv-deadline") || {}).value || "";
    if (!label && !Number(target)) return;  // 完全な空は無視
    if (!state) load();
    var id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var rv = R.normalizeReserve({ id: id, label: label, target: target, saved: 0, deadline: deadline, monthlyOverride: 0 },
      (state.reserves || []).length);
    state.reserves = (state.reserves || []).concat([rv]);
    save(); render();
  }
  function removeReserve(id) {
    if (!state) load();
    state.reserves = (state.reserves || []).filter(function (r) { return r.id !== id; });
    save(); render();
  }
  // 満額確保（手元にある分を一括）：saved を target まで一気に引き上げる（"もう手元にある"枠用）。
  function fundReserve(id) {
    if (!state) load();
    var rv = _findReserve(id);
    if (!rv) return;
    rv.saved = Number(rv.target) >= 0 ? Number(rv.target) : 0;
    save(); render();
  }
  // 枠の各フィールド編集（target/saved/monthlyOverride は数値、deadline は日付文字列）。
  function setReserveField(id, field, value) {
    if (!state) load();
    var rv = _findReserve(id);
    if (!rv) return;
    if (field === "deadline") rv.deadline = (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) ? value : "";
    else rv[field] = Number(value) >= 0 ? Number(value) : 0;
    save(); render();
  }

  // ---- 画面遷移 ----
  function show() {
    // F3: 中央ルーター経由でビュー切替（hash 同期・戻るボタン対応）。index.html の window.showView。
    if (window.showView) {
      window.showView("money");
    } else {
      var views = document.querySelectorAll(".view-section");
      for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
      document.getElementById("money-view").classList.add("active");
      window.scrollTo(0, 0);
    }
    // 司令室を初めて開いた時だけセッションを確認（市場ビューでは auth DB を打たない）。
    if (!_sessionChecked) {
      _sessionChecked = true;
      checkSession().then(function (ok) {
        if (ok) { Promise.all([reconcile(), loadCashflow(), loadInvestment()]).then(function () { render(); }); }
        else { render(); }
      });
    }
  }

  function backToPortal() {
    if (window.showView) {
      window.showView("portal");
    } else {
      document.getElementById("money-view").classList.remove("active");
      document.getElementById("portal-view").classList.add("active");
      window.scrollTo(0, 0);
    }
  }

  function moneyInput(label, path, value) {
    return '<label class="mcc-field"><span>' + label + '</span>' +
      '<input type="number" min="0" step="1000" value="' + value + '" ' +
      'onchange="MCC.setField(\'' + path + '\', this.value)"></label>';
  }

  // path 例: "monthlyExpense" / "buckets.buffer.amount"
  function setField(path, value) {
    if (!state) load();
    var parts = path.split(".");
    var obj = state;
    for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = Number(value) >= 0 ? Number(value) : 0;
    save();
    render();
  }

  // 設定の「月の生活費」に実支出の平均をワンタップ採用（連携済みのみ・手動確定＝規律フレーム維持）。
  function adoptAvgExpense() {
    if (!sync.loggedIn) return;
    var cv = R.cashflowViewModel(_cashflowRows, state, Date.now());
    if (!cv.hasData || !(cv.avgExpense > 0)) return;
    setField("monthlyExpense", cv.avgExpense); // save()+render() 込み・バッファ目標も即再計算
  }

  // ---- 描画 ----
  function syncBar() {
    if (sync.loggedIn) {
      return '<div class="mcc-sync mcc-sync-on" id="mcc-sec-sync">' +
        '<span class="mcc-sync-status" id="mcc-sync-status">' + syncStatusText() + '</span>' +
        '<button class="mcc-sync-btn" onclick="MCC.logout()">ログアウト</button>' +
      '</div>';
    }
    var err = sync.lastError ? '<span class="mcc-sync-err">' + esc(sync.lastError) + '</span>' : '';
    var dis = sync.busy ? ' disabled' : '';
    return '<div class="mcc-sync" id="mcc-sec-sync">' +
      '<span class="mcc-sync-status" id="mcc-sync-status">' + syncStatusText() + '</span>' +
      '<span class="mcc-sync-form">' +
        '<input type="password" id="mcc-pw" placeholder="パスワード" autocomplete="current-password"' + dis +
          ' onkeydown="if(event.key===\'Enter\')MCC.doLogin()">' +
        '<button class="mcc-sync-btn" onclick="MCC.doLogin()"' + dis + '>' + (sync.busy ? "…" : "ログイン") + '</button>' +
      '</span>' + err +
    '</div>';
  }

  function goalsSection(vm) {
    var items = vm.goals.map(function (g) {
      var badge = g.achieved ? '<span class="mcc-goal-done">達成 ✓</span>' : '';
      var dl = g.deadline ? '<span class="mcc-goal-dl">期限 ' + esc(g.deadline) + '</span>' : '';
      var sub = g.targetAmount > 0
        ? vm.fmt(vm.totalAssets) + ' / ' + vm.fmt(g.targetAmount) + (g.achieved ? '' : '・あと ' + vm.fmt(g.remaining))
        : '目標額が未設定';
      return '<div class="mcc-goal">' +
        '<div class="mcc-goal-head"><span class="mcc-goal-label">' + esc(g.label || "（無題）") + '</span>' + badge +
          '<button class="mcc-goal-del" title="削除" onclick="MCC.removeGoal(\'' + esc(g.id) + '\')">×</button></div>' +
        '<div class="mcc-goal-bar"><div class="mcc-goal-fill' + (g.achieved ? ' done' : '') + '" style="width:' + g.progressPct + '%"></div></div>' +
        '<div class="mcc-goal-stat">' + sub + (dl ? ' ' + dl : '') + '</div>' +
      '</div>';
    }).join("");
    var form =
      '<div class="mcc-goal-add">' +
        '<input type="text" id="mcc-goal-label" placeholder="目標名（例: FIRE資金）" maxlength="40">' +
        '<input type="number" id="mcc-goal-amount" placeholder="目標額" min="0" step="100000">' +
        '<input type="date" id="mcc-goal-deadline" title="期限（任意）">' +
        '<button class="mcc-goal-addbtn" onclick="MCC.addGoal()">＋ 目標を追加</button>' +
      '</div>';
    var empty = '<div class="mcc-goals-empty">総資産（' + vm.fmt(vm.totalAssets) + '）に対する資産目標を追加できます。</div>';
    return '<div class="mcc-goals" id="mcc-sec-goals"><div class="mcc-section-title">資産目標</div><div class="mcc-section-desc">総資産に対する目標と達成度（確保枠は含めません）。</div>' +
      (items || empty) + form + '</div>';
  }

  // AI規律コーチ。決定論ルールを最上位（権威）に、AI を従属表示、免責(DISCLAIMER)を常時同梱（client 定数）。
  function adviceSection(vm) {
    var ruleHead = '<div class="mcc-advice-rulehead">あなたが設定したルール（バッファ月数・サテライト上限）に基づく計算（最優先）</div>';
    var rule = '<div class="mcc-advice-rule"><span class="mcc-advice-rule-icon">▶</span><span>' + esc(vm.next.message) + '</span></div>';

    var aiHtml = '';
    if (advice) {
      var curTs = (state && Number(state.updatedAt)) || 0;
      var stale = (advice._stateTs || 0) !== curTs;
      var det = advice.deterministic || {};
      var mismatch = det.nextTarget && det.nextTarget !== vm.next.target; // サーバ集約と画面の不一致＝同期遅延
      if (advice.ai && !mismatch) {
        var a = advice.ai;
        var modeTag = advice.mode === "personal" ? '<span class="mcc-advice-mode">個人モード</span>' : '';
        aiHtml =
          '<div class="mcc-advice-ai">' + modeTag +
            '<div class="mcc-advice-ai-head">' + esc(a.headline || "") + '</div>' +
            '<div class="mcc-advice-ai-edu">' + esc(a.education || "") + '</div>' +
            (a.next_step ? '<div class="mcc-advice-ai-next">▶ ' + esc(a.next_step) + '</div>' : '') +
          '</div>';
      } else {
        var why = mismatch ? "数値が同期中です。もう一度相談してください。"
          : advice.aiStatus === "cooldown" ? "少し時間を置いてから、もう一度相談してください。"
          : advice.aiStatus === "filtered" ? "AIの応答が規律ガードに掛かったため、規律ルールのみ表示します。"
          : "AIコメントは今取得できませんでした（規律ルールは上に表示）。";
        aiHtml = '<div class="mcc-advice-ai mcc-advice-ai-muted">' + esc(why) + '</div>';
      }
      if (stale) aiHtml += '<div class="mcc-advice-stale">数値が変わりました。「再相談」で更新できます。</div>';
    }

    var btn = sync.loggedIn
      ? '<button class="mcc-advice-btn" onclick="MCC.requestAdvice()"' + (adviceBusy ? ' disabled' : '') + '>' +
          (adviceBusy ? '相談中…' : (advice ? '再相談' : 'コーチに相談')) + '</button>'
      : '<span class="mcc-advice-login">ログインすると AI コーチに相談できます</span>';
    var err = adviceErr ? '<div class="mcc-advice-err">' + esc(adviceErr) + '</div>' : '';
    var disc = '<div class="mcc-advice-disclaimer">' + esc(R.DISCLAIMER) + '</div>';

    return '<div class="mcc-advice">' +
      '<div class="mcc-section-title">AI規律コーチ</div><div class="mcc-section-desc">決定論ルールが最優先・AIはその補足です。</div>' +
      ruleHead + rule + aiHtml +
      '<div class="mcc-advice-actions">' + btn + '</div>' + err + disc +
    '</div>';
  }

  // 収支推移のスパークライン（balance バー・正=緑/負=赤・当月は半透明）。isolated SVG＝Chart.js を持ち込まない。
  function sparkline(history) {
    if (!history || history.length < 2) return "";
    var w = 280, h = 56, n = history.length, bw = w / n, mid = h / 2;
    var maxAbs = 1;
    history.forEach(function (d) { maxAbs = Math.max(maxAbs, Math.abs(Number(d.balance) || 0)); });
    var bars = history.map(function (d, i) {
      var v = Number(d.balance) || 0;
      var bh = Math.max(1, Math.round((Math.abs(v) / maxAbs) * (mid - 2)));
      var x = Math.round(i * bw) + 1, bwi = Math.max(1, Math.round(bw) - 2);
      var y = v >= 0 ? (mid - bh) : mid;
      var cls = v >= 0 ? "pos" : "neg";
      return '<rect class="mcc-spark-' + cls + '" x="' + x + '" y="' + y + '" width="' + bwi + '" height="' + bh +
        '" opacity="' + (d.isComplete ? "1" : "0.45") + '"></rect>';
    }).join("");
    return '<div class="mcc-cf-spark"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" width="100%" height="' + h + '">' +
      '<line class="mcc-spark-axis" x1="0" y1="' + mid + '" x2="' + w + '" y2="' + mid + '"></line>' + bars + '</svg></div>';
  }

  // Slice4: 収支カード＋投資余力ゲージ＋鮮度。業務 math は持たず cv（cashflowViewModel）を描くのみ。
  function cashflowSection(cv) {
    if (!sync.loggedIn) return "";  // 認証データ＝未ログインでは出さない
    var title = '<div class="mcc-section-title">収支と投資余力' + termHelp("投資余力") + '</div><div class="mcc-section-desc">毎月の収支から、無理なく投資に回せる額を出します。</div>';
    if (!cv.hasData) {
      return '<div class="mcc-cashflow" id="mcc-sec-cashflow">' + title +
        '<div class="mcc-cashflow-empty">収支データが未連携です。kakeibo（家計）の月次収支を取り込むと、毎月いくら投資に回せるか（投資余力）が表示されます。</div></div>';
    }
    if (cv.currencyMismatch) {
      return '<div class="mcc-cashflow" id="mcc-sec-cashflow">' + title +
        '<div class="mcc-cashflow-empty">通貨が JPY 以外のため投資余力は表示しません（収支連携は JPY 前提）。</div></div>';
    }
    var partial = cv.latestIsPartial
      ? '<span class="mcc-cf-partial">（進行中・暫定）</span>'
      : '<span class="mcc-cf-latest">（最新の確定月）</span>';
    var head =
      '<div class="mcc-cf-head"><span class="mcc-cf-period">' + fmtAnchorMonth(cv.latestPeriod) + 'の収支</span>' + partial + '</div>' +
      (cv.latestIsPartial ? '' : '<div class="mcc-cf-monthnote">今月の収支は月末締め後（翌月初の自動更新）に反映されます。「最新に更新」はクラウドの再取得です。</div>') +
      '<div class="mcc-cf-stats">' +
        '<div class="mcc-cf-stat"><span>収入</span><strong>' + cv.fmt(cv.income) + '</strong></div>' +
        '<div class="mcc-cf-stat"><span>支出</span><strong>' + cv.fmt(cv.expense) + '</strong></div>' +
        '<div class="mcc-cf-stat"><span>収支</span><strong class="' + (cv.balance < 0 ? "neg" : "pos") + '">' + cv.balanceFmt + '</strong></div>' +
        '<div class="mcc-cf-stat"><span>貯蓄率</span><strong>' + cv.savingsRatePct + '%</strong></div>' +
      '</div>';

    var surplus, applyBtn = "";
    if (cv.surplusPositive) {
      var dest = cv.destination === "buffer" ? "バッファ（生活防衛資金）" : (cv.destination === "satellite" ? "サテライト" : "コア（長期）");
      var toMsg = !cv.bufferAchieved
        ? "まずバッファへ。あと約 " + (cv.monthsToBufferComplete == null ? "—" : cv.monthsToBufferComplete) + "ヶ月で目標到達"
        : "バッファ達成済み。投資（" + dest + "）へ回せます";
      var wf =
        '<span class="mcc-wf mcc-wf-buffer">バッファ ' + cv.fmt(cv.toBuffer) + '</span>' +
        (cv.toReserves > 0 ? '<span class="mcc-wf mcc-wf-reserve">確保枠 ' + cv.fmt(cv.toReserves) + '</span>' : "") +
        '<span class="mcc-wf mcc-wf-core">コア ' + cv.fmt(cv.toCore) + '</span>' +
        (cv.toSatellite > 0 ? '<span class="mcc-wf mcc-wf-sat">サテライト ' + cv.fmt(cv.toSatellite) + '</span>' : "");
      surplus =
        '<div class="mcc-cf-surplus">' +
          '<div class="mcc-cf-surplus-main">毎月の投資余力（平滑後）<strong>' + cv.fmt(cv.monthlySurplus) + ' / 月</strong></div>' +
          '<div class="mcc-cf-waterfall">' + wf + '</div>' +
          '<div class="mcc-cf-dest">' + esc(toMsg) + '</div>' +
        '</div>';
      applyBtn = cv.alreadyApplied
        ? '<button class="mcc-cf-apply" disabled>' + fmtAnchorMonth(cv.latestPeriod) + 'の余剰は反映済み</button>'
        : '<button class="mcc-cf-apply" onclick="MCC.applySurplus()">今月の余剰 ' + cv.fmt(cv.monthlySurplus) + ' を規律配分（バッファ→確保枠→コア）で反映</button>';
    } else {
      var defMsg = cv.deficitMonths > 0
        ? "直近で赤字の月があります（" + cv.deficitMonths + "回/6ヶ月）。投資より家計の見直し・バッファ防衛を優先しましょう。"
        : "平滑後の経常余剰がありません。支出の見直しを優先しましょう。";
      surplus = '<div class="mcc-cf-surplus mcc-cf-surplus-neg">' +
        '<div class="mcc-cf-surplus-main">投資余力 <strong>' + cv.fmt(0) + ' / 月</strong></div>' +
        '<div class="mcc-cf-dest">' + esc(defMsg) + '</div></div>';
    }

    var cats = (cv.categories && cv.categories.length)
      ? '<div class="mcc-cf-cats">' + cv.categories.map(function (c) {
          return '<span class="mcc-cf-cat">' + esc(c.name) + ' ' + cv.fmt(c.amount) + '</span>';
        }).join("") + '</div>'
      : "";
    var insuf = cv.insufficientData
      ? '<div class="mcc-cf-note">確定月が ' + cv.monthsCovered + 'ヶ月分のみ＝暫定値です（3ヶ月で安定します）。</div>' : "";
    var divNote = cv.expenseDivergence
      ? '<div class="mcc-cf-note">実支出の平均（' + cv.fmt(cv.avgExpense) + '/月）が設定の月の生活費と乖離しています。' + jumpLink("settings", "「設定」") + 'の見直しを検討してください。</div>' : "";
    // 鮮度＋「今すぐ最新化」。月次自動更新（毎月2日）を待たずにユーザー任意で取り直せる（Neon 再取得のみ）。
    var freshTxt = cv.staleDays == null ? "クラウドの最新データを表示中"
      : ("最終取得 " + cv.staleDays + "日前" + (cv.dataFresh ? "" : "・更新が止まっている可能性"));
    var fresh =
      '<div class="mcc-cf-fresh' + (cv.dataFresh === false ? " stale" : "") + '">' +
        '<span class="mcc-cf-fresh-txt">' + esc(freshTxt) + ' ｜ 自動更新 毎月2日ごろ</span>' +
        '<button class="mcc-cf-refresh" title="クラウド（保存済みデータ）を再取得します。新しい月は毎月の自動更新で増えます。" onclick="MCC.refreshData()"' + (_refreshing ? " disabled" : "") + '>' +
          (_refreshing ? "更新中…" : "↻ 最新に更新") + '</button>' +
      '</div>';

    // データ基盤Phase1: 定点アンカー＋確定月収支で現在現金を自動算出（手入力ドリフトの解消・投資フローはPhase2で合算）。
    var cd = R.cashDerived(_cashflowRows, _investmentRows, (state && state.anchor) || {}, Date.now());
    var anchorBlock;
    if (cd.anchorConfigured) {
      anchorBlock =
        '<div class="mcc-anchor">' +
          '<div class="mcc-anchor-main">いまの貯蓄額（自動算出）<strong>' + cv.fmt(cd.derivedCash) + '</strong></div>' +
          '<div class="mcc-anchor-sub">基準＝' + esc(fmtAnchorMonth(cd.anchorDate)) + 'のはじめ（' + cv.fmt(cd.anchorAmount) + '）＋ その後の確定収支 ' + cd.monthsCovered + 'ヶ月分を自動加算。当月込みの参考値 ' + cv.fmt(cd.derivedCashLive) + '。毎回再計算するので手入力のズレが溜まりません。</div>' +
          '<button class="mcc-anchor-edit" onclick="MCC.editAnchor()">基準を変更</button>' +
        '</div>';
    } else {
      anchorBlock =
        '<div class="mcc-anchor mcc-anchor-setup">' +
          '<div class="mcc-anchor-cta">いまの貯蓄額を自動算出します。<b>基準にする月</b>と、<b>その月のはじめ（1日時点）の貯蓄額</b>を1回入れるだけ。以降は選んだ月からの確定収支を自動で積み上げます（月の途中で取引があっても、扱いは月単位なので二重計上は起きません）。</div>' +
          '<div class="mcc-anchor-form">' +
            '<input type="month" id="mcc-anchor-month" title="基準にする月">' +
            '<input type="number" id="mcc-anchor-amount" placeholder="その月初の貯蓄額（円）" min="0" step="10000">' +
            '<button class="mcc-anchor-set" onclick="MCC.saveAnchor()">設定</button>' +
          '</div>' +
        '</div>';
    }

    return '<div class="mcc-cashflow" id="mcc-sec-cashflow">' + title + head + anchorBlock + surplus + applyBtn + sparkline(cv.history) + cats + insuf + divNote + fresh + '</div>';
  }

  // Slice4.5: 確保枠（目的別の取り置き）。cv.reserves（reserveAlloc・純関数算出）を描くのみ。
  // 規律＝投資余力（コア）より先に確保。期日逆算で月額提案、満額確保で手元分を一括。未ログインでもローカル state で表示。
  function reservesSection(cv) {
    var rs = cv.reserves || [];
    var cards = rs.map(function (rv) {
      var pct = Math.round((rv.progress || 0) * 100);
      var done = rv.complete;
      var dl = rv.deadline ? '<span class="mcc-rsv-dl">期日 ' + esc(rv.deadline) + '</span>' : '';
      // shortfall は「実際に配分できる余剰がある時」のみ意味を持つ（収支未連携/赤字月は単なる積立目安として表示）。
      var hasSurplusCtx = cv.available && cv.surplusPositive;
      var monthly;
      if (done) {
        monthly = '<span class="mcc-rsv-monthly done">確保完了 ✓</span>';
      } else if (rv.suggestedMonthly > 0) {
        var isShort = hasSurplusCtx && rv.shortfall;
        monthly = '<span class="mcc-rsv-monthly' + (isShort ? ' short' : '') + '">毎月の積立目安 ' +
          cv.fmt(rv.suggestedMonthly) + (isShort ? '（今月は余剰が足りず一部のみ）' : '') + '</span>';
      } else {
        monthly = '<span class="mcc-rsv-monthly muted">期日/月額 未設定 — 満額確保で入金</span>';
      }
      var alloc = rv.allocated > 0 ? '<span class="mcc-rsv-alloc">今回反映 +' + cv.fmt(rv.allocated) + '</span>' : '';
      var edit =
        '<details class="mcc-rsv-editbox"><summary>編集</summary>' +
          '<label class="mcc-field"><span>目標額</span><input type="number" min="0" step="50000" value="' + rv.target +
            '" onchange="MCC.setReserveField(\'' + esc(rv.id) + '\',\'target\',this.value)"></label>' +
          '<label class="mcc-field"><span>確保済み</span><input type="number" min="0" step="10000" value="' + rv.saved +
            '" onchange="MCC.setReserveField(\'' + esc(rv.id) + '\',\'saved\',this.value)"></label>' +
          '<label class="mcc-field"><span>期日</span><input type="date" value="' + esc(rv.deadline) +
            '" onchange="MCC.setReserveField(\'' + esc(rv.id) + '\',\'deadline\',this.value)"></label>' +
          '<label class="mcc-field"><span>月額固定（任意・逆算上書き）</span><input type="number" min="0" step="10000" value="' + (rv.monthlyOverride || 0) +
            '" onchange="MCC.setReserveField(\'' + esc(rv.id) + '\',\'monthlyOverride\',this.value)"></label>' +
        '</details>';
      return '<div class="mcc-rsv' + (done ? ' done' : '') + (rv.shortfall ? ' short' : '') + '">' +
        '<div class="mcc-rsv-head"><span class="mcc-rsv-label">' + esc(rv.label || "（無題）") + '</span>' +
          (done ? '<span class="mcc-rsv-badge">確保 ✓</span>' : '') +
          '<button class="mcc-rsv-del" title="削除" onclick="MCC.removeReserve(\'' + esc(rv.id) + '\')">×</button></div>' +
        '<div class="mcc-rsv-bar"><div class="mcc-rsv-fill' + (done ? ' done' : '') + '" style="width:' + pct + '%"></div></div>' +
        '<div class="mcc-rsv-stat">' + cv.fmt(rv.saved) + ' / ' + cv.fmt(rv.target) + '・' + pct + '%' + (dl ? ' ' + dl : '') + '</div>' +
        '<div class="mcc-rsv-sub">' + monthly + alloc + '</div>' +
        '<div class="mcc-rsv-actions">' +
          (done ? '' : '<button class="mcc-rsv-fund" onclick="MCC.fundReserve(\'' + esc(rv.id) + '\')">満額確保（手元にある分を一括）</button>') +
          edit +
        '</div>' +
      '</div>';
    }).join("");

    // 取り分けサマリ＋自由に使える現金（アンカー導出 cash − 確保枠合計）。
    var freeLine = "";
    var cd = R.cashDerived(_cashflowRows, _investmentRows, (state && state.anchor) || {}, Date.now());
    if (cd.anchorConfigured && cv.reservesTotalSaved > 0) {
      var free = cd.derivedCash - cv.reservesTotalSaved;
      freeLine = '・確保枠を除く自由な現金 約 ' + cv.fmtSigned(free);
    }
    var summary = rs.length
      ? '<div class="mcc-rsv-summary">取り分け済み 合計 ' + cv.fmt(cv.reservesTotalSaved) + ' / 目標 ' + cv.fmt(cv.reservesTotalTarget) +
          (cv.reservesActive > 0 ? '・積立中 ' + cv.reservesActive + '枠' : '') + freeLine + '</div>'
      : '';
    var form =
      '<div class="mcc-rsv-add">' +
        '<input type="text" id="mcc-rsv-label" placeholder="確保枠名（例: 登記費用）" maxlength="40">' +
        '<input type="number" id="mcc-rsv-target" placeholder="目標額" min="0" step="50000">' +
        '<input type="date" id="mcc-rsv-deadline" title="期日（任意・逆算で月額を提案）">' +
        '<button class="mcc-rsv-addbtn" onclick="MCC.addReserve()">＋ 確保枠を追加</button>' +
      '</div>';
    var empty = '<div class="mcc-rsv-empty">住宅の登記費用・不動産取得税など、近い将来に使う目的別のお金を「確保枠」として取り置きできます。期日を入れると毎月の積立額を逆算し、投資余力（コア）より<strong>先に</strong>確保します。時期が読めない費用は満額確保で手元分を一括計上できます。</div>';
    return '<div class="mcc-reserves"><div class="mcc-section-title">確保枠（目的別の取り置き）' + termHelp("確保枠") + '</div><div class="mcc-section-desc">投資より先に取り置く目的別の貯金。期日から毎月の積立額を逆算します。</div>' +
      (cards || empty) + summary + form + '</div>';
  }

  // ---- Task6: フェーズ型ロードマップ（守る/育てる/攻める）----
  // rm = R.roadmap(state, cd, nowMs) の VM をそのまま描くだけ（業務mathは持たない）。
  // ¥ は loggedIn の時のみ（既存 cashflowSection と同一ゲート）・フェーズ構造/％は常時表示。
  // roadmapPhase() の6状態（setup/buffer/rebalance/core/satellite/independence）を
  // rail の3フェーズ（buffer/core/satellite）へ縮約する表示専用マッピング（業務mathではない）。
  var _RM_CURRENT_KEY = { setup: "buffer", buffer: "buffer", rebalance: "core", core: "core", satellite: "satellite", independence: "satellite" };

  function _rmPhaseRail(rm) {
    var currentKey = _RM_CURRENT_KEY[rm.phase] || "buffer";
    // §7.1: バッファ→コアの継ぎ目に「先取り(確保枠)」チップ。確保枠へ月次でコミットしている時のみ（rm.projection.reserveMonthlyTotal>0）。
    var reserveActive = !!(rm.projection && rm.projection.reserveMonthlyTotal > 0);
    var parts = [];
    rm.phases.forEach(function (p, i) {
      if (i > 0) {
        if (i === 1 && reserveActive) {
          parts.push(
            '<span class="mcc-rm-seam" title="確保枠を先取りしてからコアへ配分します">' +
              '<span class="mcc-rm-sep"></span>' +
              '<span class="mcc-rm-seam-chip">先取り(確保枠)</span>' +
              '<span class="mcc-rm-sep"></span>' +
            '</span>'
          );
        } else {
          parts.push('<span class="mcc-rm-sep"></span>');
        }
      }
      var locked = !!p.locked;
      var current = !locked && p.key === currentKey;
      var done = !locked && !current && p.progress >= 1;
      var cls = locked ? "locked" : (current ? "current" : (done ? "done" : "todo"));
      var icon = locked ? "🔒" : (done ? "✓" : (current ? "●" : "○"));
      parts.push(
        '<div class="mcc-rm-phase mcc-rm-phase-' + cls + '" data-key="' + p.key + '">' +
          '<span class="mcc-rm-phase-dot">' + icon + '</span>' +
          '<span class="mcc-rm-phase-label">' + esc(p.label) + '</span>' +
          '<span class="mcc-rm-phase-pct">' + p.progressPct + '%</span>' +
        '</div>'
      );
    });
    return '<div class="mcc-rm-rail">' + parts.join('') + '</div>';
  }

  // コア目標ラベル：goal 逆算／フォールバック（月支出×24ヶ月）／setup未完 の3系統。¥はloggedInのみ。
  function _rmNorthStar(rm, loggedIn) {
    if (rm.northStar.source === "goal") {
      var amt = loggedIn
        ? ('コア目標 ' + R.yen(rm.coreTarget) + '（あと ' + R.yen(rm.coreProgress.remaining) + '）')
        : ('コア目標まで ' + rm.coreProgress.pct + '%');
      return '<div class="mcc-rm-northstar">目標『' + esc(rm.northStar.label) + '』から逆算 → ' + amt + '</div>';
    }
    if (rm.northStar.source === "fallback") {
      return '<div class="mcc-rm-northstar mcc-rm-northstar-fallback">仮の目安：月支出×24ヶ月（2年分）。実際の目標を宣言するとここが逆算に変わります。' +
        jumpLink("goals", "資産目標を追加") + '</div>';
    }
    return '<div class="mcc-rm-northstar mcc-rm-northstar-setup">' + jumpLink("settings", "「設定」") + 'で月の生活費を入力するとコア目標が決まります。</div>';
  }

  // 今月の配分プラン：バッファ/確保枠/コア/(解放時)サテライトの ¥（.mcc-wf-* 再利用）。
  // サテライトは表示のみの目安＝applySurplus は変更しない（コアのみ執行）。
  function _rmThisMonth(rm, loggedIn) {
    var tm = rm.thisMonth;
    var head = '<div class="mcc-rm-thismonth-head">今月の配分プラン' + termHelp("投資余力") + '</div>';
    // Finding1: 未連携（本当にリンクなし）と連携済み赤字/均衡月（リンク済だが余力なし）を rm.projection.available で区別。
    // 後者に「家計を連携」CTAを出すと既に連携済のユーザーに誤案内になるため出さない。
    if (!rm.projection.available) {
      return '<div class="mcc-rm-thismonth" id="mcc-rm-thismonth">' + head +
        '<div class="mcc-rm-note">収支連携すると、今月の配分（バッファ→確保枠→コア' + (tm.satelliteUnlocked ? "→サテライト" : "") + '）が表示されます。' +
        jumpLink("cashflow", "家計（kakeibo）を連携") + '</div></div>';
    }
    if (rm.projection.monthlySurplus <= 0) {
      return '<div class="mcc-rm-thismonth" id="mcc-rm-thismonth">' + head +
        '<div class="mcc-rm-note">今月は投資に回せる余力がありません（収支が均衡または赤字）。</div></div>';
    }
    var chips = loggedIn
      ? ('<span class="mcc-wf mcc-wf-buffer">バッファ ' + R.yen(tm.toBuffer) + '</span>' +
          (tm.toReserves > 0 ? '<span class="mcc-wf mcc-wf-reserve">確保枠 ' + R.yen(tm.toReserves) + '</span>' : "") +
          '<span class="mcc-wf mcc-wf-core">コア ' + R.yen(tm.toCore) + '</span>' +
          (tm.satelliteUnlocked ? '<span class="mcc-wf mcc-wf-sat">サテライト ' + R.yen(tm.toSatellite) + '（手動で移す目安）</span>' : ""))
      : ('<span class="mcc-wf mcc-wf-buffer">バッファ</span>' +
          (tm.toReserves > 0 ? '<span class="mcc-wf mcc-wf-reserve">確保枠</span>' : "") +
          '<span class="mcc-wf mcc-wf-core">コア</span>' +
          (tm.satelliteUnlocked ? '<span class="mcc-wf mcc-wf-sat">サテライト（手動で移す目安）</span>' : "") +
          '<span class="mcc-rm-note">ログインすると金額が表示されます</span>');
    return '<div class="mcc-rm-thismonth" id="mcc-rm-thismonth">' + head + '<div class="mcc-rm-wf">' + chips + '</div></div>';
  }

  // タイムライン：積立のみの粗い到達見込み（運用益は含めない・投機を誘発しない注記を必ず添える）。
  function _rmTimeline(rm) {
    // Finding1: 同上（_rmThisMonth）＝未連携と連携済み赤字/均衡月を区別し、後者ではリンクCTAを出さない。
    if (!rm.projection.available) {
      return '<div class="mcc-rm-timeline muted">収支連携でタイムラインが表示されます。' + jumpLink("cashflow", "家計（kakeibo）を連携") + '</div>';
    }
    if (rm.projection.monthlySurplus <= 0) {
      return '<div class="mcc-rm-timeline muted">今月は投資に回せる余力がありません（収支が均衡または赤字）。</div>';
    }
    if (rm.projection.cumulativeToCore == null) {
      return '<div class="mcc-rm-timeline muted">確保枠の積立で今月の余力を使い切っているため、コア到達の見込みが立ちません（確保枠の見直しを検討してください）。</div>';
    }
    return '<div class="mcc-rm-timeline">この余力ペースなら コア目標到達まで約 ' + rm.projection.cumulativeToCore +
      ' ヶ月（概算・積立のみ／運用益は含めない）</div>';
  }

  // サテライト解放状態チップ（構造/％は非依存で常時表示・上限までの残り¥はloggedInのみ§7.5）。
  function _rmSatChip(rm, loggedIn) {
    if (rm.satelliteUnlocked) {
      var headroom = "";
      if (loggedIn) {
        var satPhase = null;
        for (var i = 0; i < rm.phases.length; i++) {
          if (rm.phases[i].key === "satellite") { satPhase = rm.phases[i]; break; }
        }
        if (satPhase) {
          headroom = "・上限まであと " + R.yen(Math.max(0, satPhase.target - satPhase.saved));
        }
      }
      return '<div class="mcc-rm-satchip mcc-rm-satchip-unlocked">✓ サテライト解放中' + headroom + '</div>';
    }
    return '<div class="mcc-rm-satchip mcc-rm-satchip-locked">🔒 解放条件：バッファ達成＋コア' + rm.satelliteUnlockCorePct +
      '%（現在 ' + rm.coreProgress.pct + '%）</div>';
  }

  function roadmapSection(rm, loggedIn) {
    return '<div class="mcc-roadmap" id="mcc-sec-roadmap">' +
      '<div class="mcc-section-title">ロードマップ</div>' +
      '<div class="mcc-section-desc">守る（バッファ）→ 育てる（コア）→ 攻める（サテライト）の進み具合と、今月の配分。</div>' +
      _rmPhaseRail(rm) + _rmNorthStar(rm, loggedIn) + _rmThisMonth(rm, loggedIn) + _rmTimeline(rm) + _rmSatChip(rm, loggedIn) +
    '</div>';
  }

  // ---- Task6 (backlog B#2): 資産クラス比率。業務mathはすべて R.*（money-rules.js Task1-5純関数）へ委譲・ここは薄いUI層。----

  function acSetScope(which) {
    _acScope = which === "total" ? "total" : "core";
    render();
  }

  // 「現状は現金のみ」クイックフィル：既存 buckets.amount 合計（R.totalAssets・純関数）を assetHoldings.buffer.cash へ一括投入
  // （現金のみ・投資未開始でも盤面が空にならない・spec §3.4）。
  function acFillCashOnly() {
    if (!state) load();
    setField("assetHoldings.buffer.cash", R.totalAssets(state)); // save()+render() 込み
  }

  // spec §6.1: 7hue色相環＋未分類の単一トークン（太田さん実機確認済 2026-07-14＝alpha0.4/glow100%で確定・実装値ロック）。
  var AC_COLORS = {
    devEq: "#b03cff", jpEq: "#4468ff", emEq: "#ff2a4d",
    reit: "#f2e400", gold: "#ff7a00", bond: "#1fdb5e", cash: "#12cffa",
  };
  var AC_NAMES = { devEq: "先進国株", jpEq: "国内株", emEq: "新興国株", reit: "REIT", gold: "金", bond: "債券", cash: "現金" };
  var AC_BUCKET_NAMES = { buffer: "バッファ（現金）", core: "コア", satellite: "サテライト" };
  var AC_UNCLASSIFIED_COLOR = "#64748b"; // spec §6.1: 低chromaスレート（現在地バー限定・facts非出力）
  // spec §6.3: 下部帯(成長/守り2値)。太田さん実機FB(2026-07-15)で mock 準拠の「成長=赤→橙グラデ(emEq→gold)」に確定
  // （§6.3の"identity非衝突ニュートラル暖色"案は不採用＝本人が mock で確定した赤系統を優先。gold等との混同は帯の凡例で解消）。
  // 守り=緑(bond域)。左端が赤(emEq #ff2a4d)→右へ橙(gold #ff7a00)のグラデ。

  function _hexRgb(h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // spec §6.2: 発光塗り（alpha既定0.4・glow100%固定・チャート符号化要素で完全同一の適用）。
  function _acNeon(rr, gg, bb, alphaArg, bgOverride) {
    var a = alphaArg != null ? alphaArg : 0.4;
    var bg = bgOverride || ("rgba(" + rr + "," + gg + "," + bb + "," + a + ")");
    return "background:" + bg + ";box-shadow:" +
      "inset 0 0 0 1px rgba(" + rr + "," + gg + "," + bb + ",.9)," +
      "inset 0 2px 0 rgba(" + rr + "," + gg + "," + bb + ",1)," +
      "inset 0 0 11px rgba(" + rr + "," + gg + "," + bb + ",.45)," +
      "0 0 18px rgba(" + rr + "," + gg + "," + bb + ",.74)," +
      "0 0 48px rgba(" + rr + "," + gg + "," + bb + ",.42);";
  }
  function _acSegStyle(key) { var c = _hexRgb(AC_COLORS[key]); return _acNeon(c[0], c[1], c[2]); }
  function _acUncStyle() { var c = _hexRgb(AC_UNCLASSIFIED_COLOR); return _acNeon(c[0], c[1], c[2]); }

  // spec §6.3: ドーナツ=棒と同じHTML要素方式(conic-gradient・rgba半透明＋screen)。alpha違いでbody/edge/glow 3層に流用。
  function _acConicStops(map, alpha) {
    var acc = 0, out = [];
    for (var i = 0; i < R.ASSET_CLASSES.length; i++) {
      var k = R.ASSET_CLASSES[i], p = (map && map[k]) || 0;
      if (p <= 0) continue;
      var frac = p / 100, gap = 0.004;
      var c = _hexRgb(AC_COLORS[k]);
      var s = (acc * 100).toFixed(2), e = ((acc + frac - gap) * 100).toFixed(2), e2 = ((acc + frac) * 100).toFixed(2);
      out.push("rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alpha + ") " + s + "% " + e + "%", "transparent " + e + "% " + e2 + "%");
      acc += frac;
    }
    return out.join(",");
  }

  function _acSum(map) {
    var s = 0;
    for (var i = 0; i < R.ASSET_CLASSES.length; i++) s += (map && map[R.ASSET_CLASSES[i]]) || 0;
    return s;
  }
  // 「保有総額」¥readout用の単純合計（既に手入力済みの生値を足すだけ＝新規の業務式ではない）。
  function _acHoldingsSum(holdings, scope) {
    var buckets = scope === "total" ? ["buffer", "core", "satellite"] : ["core"];
    var s = 0;
    for (var b = 0; b < buckets.length; b++) s += _acSum(holdings[buckets[b]]);
    return s;
  }

  function _acStack(map) {
    var out = "";
    for (var i = 0; i < R.ASSET_CLASSES.length; i++) {
      var k = R.ASSET_CLASSES[i], p = (map && map[k]) || 0;
      if (p <= 0) continue;
      out += '<div class="mcc-ac-seg" style="width:' + p + '%;' + _acSegStyle(k) + '" title="' + esc(AC_NAMES[k]) + " " + p + '%"></div>';
    }
    return out;
  }

  function _acDriftRail(rows) {
    return rows.map(function (x) {
      var cls = x.driftPct > 0 ? "over" : x.driftPct < 0 ? "under" : "match";
      var sign = x.driftPct > 0 ? "+" : "";
      return '<div class="mcc-ac-driftrow ' + cls + '">' +
        '<span class="cn"><span class="mcc-ac-swatch" style="background:' + AC_COLORS[x.key] + ';color:' + AC_COLORS[x.key] + '"></span>' + esc(AC_NAMES[x.key]) + '</span>' +
        '<span class="tr">目標 ' + x.targetPct + '% → 現状 ' + x.currentPct + '%</span>' +
        '<span class="dv">' + sign + x.driftPct + 'pt</span></div>';
    }).join("");
  }

  // spec §5-4: now/+10/+20年の設計図（display-only・facts非出力）。UTC年をdyシフトしR.glidePathへ再入力するのみ
  // ＝時刻算術のみで新規の業務式は追加しない（実際の目標%はすべてR.bucketTargets/R.growDefへ委譲）。
  function _acBands(birthYear, nowMs) {
    var pairs = [[0, "now"], [10, "+10年"], [20, "+20年"]];
    var emC = _hexRgb(AC_COLORS.emEq), goC = _hexRgb(AC_COLORS.gold), defC = _hexRgb(AC_COLORS.bond);
    // 成長=赤→橙グラデ（左端 emEq赤→右 gold橙・mock準拠）＋emEq(赤)グロー
    var growBg = "linear-gradient(90deg,rgba(" + emC[0] + "," + emC[1] + "," + emC[2] + ",.4),rgba(" + goC[0] + "," + goC[1] + "," + goC[2] + ",.4))";
    return pairs.map(function (pair) {
      var d = new Date(nowMs);
      d.setUTCFullYear(d.getUTCFullYear() + pair[0]);
      var gpN = R.glidePath(birthYear, d.getTime());
      if (!gpN.configured) return "";
      var core = R.bucketTargets("core", gpN.R);
      var gd = R.growDef(core);
      var growStyle = _acNeon(emC[0], emC[1], emC[2], 0.4, growBg);
      var defStyle = _acNeon(defC[0], defC[1], defC[2]);
      return '<div class="mcc-ac-band"><span class="yl">' + esc(pair[1]) + ' <small>(' + gpN.age + '歳)</small></span>' +
        '<div class="mcc-ac-stack" style="height:16px">' +
          '<div class="mcc-ac-seg" style="width:' + gd.g + '%;' + growStyle + '" title="成長 ' + gd.g + '%"></div>' +
          '<div class="mcc-ac-seg" style="width:' + gd.d + '%;' + defStyle + '" title="守り ' + gd.d + '%"></div>' +
        '</div></div>';
    }).join("");
  }

  // 資産クラス比率セクション（backlog B#2）。目標=年齢glidepath（R.glidePath/R.bucketTargets/R.totalTargetPct）、
  // 現状=手入力assetHoldings（R.bucketCurrentPct/R.totalCurrentPct）、ドリフト=R.assetClassDrift。
  // vm は render() が渡す標準 viewModel（vm.fmt/vm.totalAssets/vm.coreAmount を使用）。sync.loggedIn/state はクロージャ経由
  // （adviceSection 等の既存パターンと同型）。id="mcc-sec-assets"（_JUMP_TARGETS 登録）。
  function assetClassSection(vm) {
    var nowMs = Date.now();
    var gp = R.glidePath(state.birthYear, nowMs);
    var scope = _acScope;
    var holdings = R.normalizeAssetHoldings(state.assetHoldings);
    var currentYear = new Date(nowMs).getUTCFullYear();

    var readoutHtml = gp.configured ? "" :
      '<div class="mcc-ac-readout mcc-ac-readout-muted">生年を入力すると、年齢に合わせた設計図（目標比率）が表示されます</div>';

    var toolbar =
      '<div class="mcc-ac-toolbar">' +
        '<button type="button" class="mcc-ac-tbtn' + (scope === "core" ? " on" : "") + '" onclick="MCC.acSetScope(\'core\')">コアの設計図</button>' +
        '<button type="button" class="mcc-ac-tbtn' + (scope === "total" ? " on" : "") + '" onclick="MCC.acSetScope(\'total\')">総資産で俯瞰</button>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="mcc-ac-tbtn" onclick="MCC.acFillCashOnly()">現状は現金のみ</button>' +
      '</div>';

    // spec §3.4/§5-7: 現状入力（buffer=cashのみ／core・satellite=クラス別）。¥ゲート対象外＝未ログインでも常時表示。
    var acInputHtml =
      '<details class="mcc-ac-input" id="mcc-ac-input"><summary>現状の保有額を入力</summary>' +
        '<div class="mcc-ac-input-bucket"><div class="mcc-ac-input-bktitle">' + esc(AC_BUCKET_NAMES.buffer) + '</div>' +
          moneyInput("現金", "assetHoldings.buffer.cash", holdings.buffer.cash) +
        '</div>' +
        '<div class="mcc-ac-input-bucket"><div class="mcc-ac-input-bktitle">' + esc(AC_BUCKET_NAMES.core) + '</div>' +
          '<div class="mcc-ac-input-grid">' + R.ASSET_CLASSES.map(function (k) {
            return moneyInput(esc(AC_NAMES[k]), "assetHoldings.core." + k, holdings.core[k]);
          }).join("") + '</div></div>' +
        '<div class="mcc-ac-input-bucket"><div class="mcc-ac-input-bktitle">' + esc(AC_BUCKET_NAMES.satellite) + '</div>' +
          '<div class="mcc-ac-input-grid">' + R.ASSET_CLASSES.map(function (k) {
            return moneyInput(esc(AC_NAMES[k]), "assetHoldings.satellite." + k, holdings.satellite[k]);
          }).join("") + '</div></div>' +
      '</details>';

    var donutHtml = "", barsHtml = "", railHtml = "", bandsHtml = "";

    if (gp.configured) {
      var weights = { buffer: R.bufferTarget(state), core: R.coreTarget(state), satellite: R.satelliteCap(state) };
      // spec §3.3: targetPctはバケツ目標額ウェイト、currentPctはassetHoldings実額ウェイト（非対称・R.totalTargetPct/R.totalCurrentPctへ委譲）。
      var target = scope === "total" ? R.totalTargetPct(gp.R, weights) : R.bucketTargets("core", gp.R);
      var currentMap = scope === "total" ? R.totalCurrentPct(holdings) : R.bucketCurrentPct(holdings, "core").classPct;
      // spec §3.4: あるバケツ(または総資産)のclassesが全0だがamount>0の場合、既存amountを「未分類」1本として現在地バー限定で計上。
      var amountForUnc = scope === "total" ? vm.totalAssets : vm.coreAmount;
      var classSum = currentMap ? _acSum(currentMap) : 0;
      var uncPct = (classSum <= 0 && amountForUnc > 0) ? 100 : 0;
      var gd = R.growDef(target);
      var drift = R.assetClassDrift(target, currentMap);

      readoutHtml = '<div class="mcc-ac-readout">あなた(' + gp.age + '歳)の設計図：成長資産 <b class="g">' + gd.g +
        '%</b> / 守り <b class="d">' + gd.d + '%</b></div>';

      var donutBody = "conic-gradient(from 0deg, " + _acConicStops(target, 0.4) + ")";
      var donutEdge = "conic-gradient(from 0deg, " + _acConicStops(target, 0.95) + ")";
      var donutGlow = "conic-gradient(from 0deg, " + _acConicStops(target, 0.7) + ")";
      var legendHtml = "";
      for (var li = 0; li < R.ASSET_CLASSES.length; li++) {
        var lk = R.ASSET_CLASSES[li];
        legendHtml += '<div class="mcc-ac-leg"><span class="mcc-ac-swatch" style="background:' + AC_COLORS[lk] + ';color:' + AC_COLORS[lk] + '"></span>' +
          '<span class="nm">' + esc(AC_NAMES[lk]) + '</span><span class="pc">' + (target[lk] || 0) + '%</span></div>';
      }
      // spec §5-3/§6.1: 目標ドーナツは7クラスのみ（未分類グレーは現在地バー限定＝ここには出さない）。
      donutHtml =
        '<div class="mcc-ac-grid">' +
          '<div class="mcc-ac-donutwrap">' +
            '<div class="mcc-ac-donut2 glowlayer" style="background:' + donutGlow + '"></div>' +
            '<div class="mcc-ac-donut2" style="background:' + donutBody + '"></div>' +
            '<div class="mcc-ac-donut2 edge" style="background:' + donutEdge + '"></div>' +
            '<div class="mcc-ac-center"><div class="big g">成長 ' + gd.g + '%</div><div class="big d">守り ' + gd.d + '%</div><div class="sub">目標</div></div>' +
          '</div>' +
          '<div class="mcc-ac-legend">' + legendHtml + '</div>' +
        '</div>';

      var barTarget = _acStack(target);
      var barCurrent = _acStack(currentMap || {}) +
        (uncPct > 0 ? '<div class="mcc-ac-seg" style="width:' + uncPct + '%;' + _acUncStyle() + '" title="未分類 ' + uncPct + '%"></div>' : "");
      barsHtml =
        '<div class="mcc-ac-bars">' +
          '<div class="mcc-ac-barlab">設計図（目標）</div><div class="mcc-ac-stack">' + barTarget + '</div>' +
          '<div class="mcc-ac-barlab">現在地（現状）</div><div class="mcc-ac-stack">' + barCurrent + '</div>' +
        '</div>';

      railHtml = '<div class="mcc-ac-rail">' + _acDriftRail(drift) + '</div>';

      bandsHtml = '<div class="mcc-ac-bands"><div class="cap">◷ 将来の設計図（年齢とともに"守り"へ寄っていく・表示のみ）</div>' +
        '<div class="mcc-ac-band-legend">' +
          '<span class="mcc-ac-bk"><i class="grow"></i>成長資産（株・REIT・金）</span>' +
          '<span class="mcc-ac-bk"><i class="def"></i>守り（債券）</span>' +
        '</div>' +
        _acBands(state.birthYear, nowMs) + '</div>';
    }

    // spec §5-9/MINOR-29: ¥readout（派生・保有合計）は sync.loggedIn のみでゲート（birthYear 未設定と独立＝gp.configured 外）。
    // %・手入力欄は常時表示（readout gate であって input gate ではない）。_acHoldingsSum は gp/target 非依存。
    var yenReadoutHtml = "";
    if (sync.loggedIn) {
      var hSum = _acHoldingsSum(holdings, scope);
      yenReadoutHtml = '<div class="mcc-ac-yen">現状の保有合計（' + (scope === "total" ? "総資産" : "コア") + '）<strong>' + vm.fmt(hSum) + '</strong></div>';
    }

    var ageRow =
      '<div class="mcc-ac-agerow">' +
        '<label for="mcc-ac-birthyear">生年</label>' +
        '<input class="mcc-ac-age" id="mcc-ac-birthyear" type="number" min="1900" max="' + currentYear + '" ' +
          'value="' + (state.birthYear > 0 ? state.birthYear : "") + '" placeholder="例: 1986" ' +
          'onchange="MCC.setField(\'birthYear\', this.value)">' +
        readoutHtml +
      '</div>';

    var disc = '<div class="mcc-ac-disc">' + esc(R.DISCLAIMER) + ' 目標は絶対的な正解ではなく、年齢別の一般的な目安です。</div>';

    return '<div class="mcc-assets" id="mcc-sec-assets">' +
      '<div class="mcc-section-title mcc-section-title-gap">資産クラス比率' + termHelp("資産クラス") + '</div>' +
      '<div class="mcc-section-desc">年齢に合わせた"設計図"（目標）と、今の"現在地"（現状）のズレを見える化します。</div>' +
      '<div class="mcc-ac-card neonb">' +
        ageRow + toolbar + donutHtml + acInputHtml + yenReadoutHtml + barsHtml + railHtml + bandsHtml + disc +
      '</div>' +
    '</div>';
  }

  // ---- B#3 NISA枠（backlog #3・Task9・レイアウトD）----
  // 業務mathはここに書かない＝全数値は R.nisaViewModel(state, cd, now) 由来。ここでの計算は表示専用
  // （幅%・conic-gradientストップ・¥⇔%切替の文言選択）のみで、新規の集計式は追加しない。
  // 確定mock（OPTION D）: .superpowers/brainstorm/107523-1784134765/content/nisa-layout-v2.html を1:1移植。
  // ¥は sync.loggedIn 時のみ（readout gate）・%/バー/構造/入力欄は常時。
  var NISA_ETA_LABELS = { none: "—", lt6: "半年未満", "6_12": "半年〜1年", "1_3y": "1〜3年", "3_10y": "3〜10年", over_10y: "10年超" };

  // 使用/残の1行（¥はloggedInのみ・未ログインは使用率%のみ）。used/cap/remaining は vm の leaf（生¥・personal）、
  // usedPct は vm 由来の丸め済み%（表示の切替のみ・新規の業務式ではない）。未ログイン時は100-usedPctの
  // 計算をせず、vm由来のusedPctをそのまま「使用」表示に使う（review Important対応）。
  function _nisaStat(used, cap, remaining, usedPct) {
    return sync.loggedIn
      ? '<span class="yen">使用 ' + R.yen(used) + ' / ' + R.yen(cap) + '</span><span class="rem">残 ' + R.yen(remaining) + '</span>'
      : '<span class="yen">使用 ' + usedPct + '%</span>';
  }

  function nisaSection(vm) {
    if (!vm) return "";
    var loggedIn = sync.loggedIn;
    var n = R.normalizeNisa(state.nisa);
    var currentYear = new Date(Date.now()).getUTCFullYear();

    var bodyHtml;
    if (!vm.configured) {
      bodyHtml = '<div class="mcc-nisa-readout mcc-nisa-readout-muted">使用状況を入力すると、年間枠・生涯枠の消化状況が表示されます</div>';
    } else {
      // HUD: 年間枠残／生涯枠残／成長内数残／充填ペース／来年復活。¥項目は loggedIn のみ。未ログインは
      // 100-usedPct の計算をせず、vm由来のusedPctをそのまま使用率として表示（review Important対応）。
      var hudAnnual = loggedIn ? R.yen(vm.annual.total.remaining) : vm.annual.total.usedPct + "% 使用";
      var hudLifetime = loggedIn ? R.yen(vm.lifetime.remaining) : vm.lifetime.usedPct + "% 使用";
      var hudGrowthCap = loggedIn ? R.yen(vm.growthCap.remaining) : vm.growthCap.usedPct + "% 使用";
      var hudEta = NISA_ETA_LABELS[vm.fillEta] || "—";
      var hudRestore = vm.restoration.hasPending ? (loggedIn ? "+" + R.yen(vm.restoration.sold) : "予定あり") : "—";
      var hud =
        '<div class="mcc-nisa-hud">' +
          '<div class="h"><span class="k">年間枠 残</span><span class="v am">' + hudAnnual + '</span></div>' +
          '<div class="h"><span class="k">生涯枠 残</span><span class="v vi">' + hudLifetime + '</span></div>' +
          '<div class="h"><span class="k">成長内数 残</span><span class="v em">' + hudGrowthCap + '</span></div>' +
          '<div class="h"><span class="k">充填ペース</span><span class="v">' + hudEta + '</span></div>' +
          '<div class="h"><span class="k">来年 復活（' + vm.restoration.restoresYear + '年）</span><span class="v em">' + hudRestore + '</span></div>' +
        '</div>';

      // 生涯枠ヒーロー：ドーナツ(lifetimeUsedPct)＋生涯総枠2段バー（つみたて/成長セグメント）＋成長内数バー。
      // セグメント幅%はvm.lifetime.tsumitatePortionPct/growthPortionPct（money-rules.jsのnisaViewModelが
      // donutと同じ丸め[clamp(r(x/NISA_LIFETIME*100),0,100)]で算出済）をそのまま使う。money.js側で
      // 独自に割り算・丸めをしない＝ドーナツとセグメントの合計不一致（review Critical）を解消。
      var lifePct = vm.lifetime.usedPct;
      var donutHtml =
        '<div class="mcc-nisa-donutwrap">' +
          '<div class="mcc-nisa-donut glowlayer" style="background:conic-gradient(var(--c-violet) 0 ' + lifePct + '%, rgba(255,255,255,0.05) ' + lifePct + '% 100%)"></div>' +
          '<div class="mcc-nisa-donut" style="background:conic-gradient(var(--c-violet) 0 ' + lifePct + '%, rgba(255,255,255,0.05) ' + lifePct + '% 100%)"></div>' +
          '<div class="mcc-nisa-donut-center"><div class="p">' + lifePct + '%</div><div class="l">生涯投資枠<br>使用</div></div>' +
        '</div>';

      var lifeBarHtml =
        '<div class="mcc-nisa-qlabel"><span>生涯総枠（簿価' + (loggedIn ? "・上限 " + R.yen(vm.lifetime.cap) : "") + '・非課税は無期限）</span><b>' + lifePct + '%</b></div>' +
        '<div class="mcc-nisa-bar tall">' +
          '<div class="mcc-nisa-seg tsum" style="width:' + vm.lifetime.tsumitatePortionPct + '%"></div>' + // 表示専用: 幅はVM由来pct
          '<div class="mcc-nisa-seg grow" style="width:' + vm.lifetime.growthPortionPct + '%"></div>' + // 表示専用: 幅はVM由来pct
        '</div>' +
        '<div class="mcc-nisa-stat">' + _nisaStat(vm.lifetime.used, vm.lifetime.cap, vm.lifetime.remaining, lifePct) + '</div>' +
        '<div class="mcc-nisa-legend">' +
          '<span><i class="tsum"></i>つみたて分' + (loggedIn ? " " + R.yen(vm.lifetime.tsumitatePortion) : "") + '</span>' +
          '<span><i class="grow"></i>成長分' + (loggedIn ? " " + R.yen(vm.lifetime.growthPortion) : "") + '</span>' +
        '</div>' +
        '<div class="mcc-nisa-subbar-label">└ うち <span>成長投資枠</span>（内数上限' + (loggedIn ? " " + R.yen(vm.growthCap.cap) : "") + '）</div>' +
        '<div class="mcc-nisa-qlabel gl"><span>成長内数枠</span><b>' + vm.growthCap.usedPct + '%</b></div>' +
        '<div class="mcc-nisa-bar"><div class="mcc-nisa-fill grow" style="width:' + vm.growthCap.usedPct + '%"></div></div>' +
        '<div class="mcc-nisa-stat">' + _nisaStat(vm.growthCap.used, vm.growthCap.cap, vm.growthCap.remaining, vm.growthCap.usedPct) + '</div>';

      var heroHtml =
        '<div class="mcc-nisa-card mcc-nisa-hero neonb">' +
          '<div class="mcc-nisa-herorow">' + donutHtml +
            '<div class="mcc-nisa-herobars">' + lifeBarHtml + '</div>' +
          '</div>' +
        '</div>';

      // 当年2ゲージ（つみたて/成長）。
      var gaugeTsum =
        '<div class="mcc-nisa-card neonb">' +
          '<div class="mcc-nisa-qlabel"><span>当年 つみたて投資枠</span><b>' + vm.annual.tsumitate.usedPct + '%</b></div>' +
          '<div class="mcc-nisa-bar"><div class="mcc-nisa-fill tsum" style="width:' + vm.annual.tsumitate.usedPct + '%"></div></div>' +
          '<div class="mcc-nisa-stat">' + _nisaStat(vm.annual.tsumitate.used, vm.annual.tsumitate.cap, vm.annual.tsumitate.remaining, vm.annual.tsumitate.usedPct) + '</div>' +
        '</div>';
      var gaugeGrow =
        '<div class="mcc-nisa-card neonb">' +
          '<div class="mcc-nisa-qlabel gl"><span>当年 成長投資枠</span><b>' + vm.annual.growth.usedPct + '%</b></div>' +
          '<div class="mcc-nisa-bar"><div class="mcc-nisa-fill grow" style="width:' + vm.annual.growth.usedPct + '%"></div></div>' +
          '<div class="mcc-nisa-stat">' + _nisaStat(vm.annual.growth.used, vm.annual.growth.cap, vm.annual.growth.remaining, vm.annual.growth.usedPct) + '</div>' +
        '</div>';
      var grid2Html = '<div class="mcc-nisa-grid2">' + gaugeTsum + gaugeGrow + '</div>';

      // アクションチップ：つみたて満額まで／売却→翌年復活／暦年リセット警告／超過警告。
      var chips = "";
      if (vm.annual.tsumitate.remaining > 0 && vm.monthlyToFillTsumitate > 0) {
        chips += '<span class="mcc-nisa-chip feed">つみたて満額まで <b>' +
          (loggedIn ? "月 " + R.yen(vm.monthlyToFillTsumitate) : "ログインで金額表示") + '</b></span>';
      }
      if (vm.restoration.hasPending) {
        chips += '<span class="mcc-nisa-chip restore">' +
          (loggedIn ? "当年売却 " + R.yen(vm.restoration.sold) : "当年売却あり") +
          ' → <b>' + vm.restoration.restoresYear + '年1/1 復活</b></span>';
      }
      if (vm.staleYear) {
        chips += '<span class="mcc-nisa-chip warn">当年枠は <b>暦年でリセット</b>（' + vm.year + '年分）</span>';
      }
      if (vm.annual.tsumitate.over || vm.annual.growth.over || vm.annual.total.over || vm.lifetime.over || vm.growthCap.over) {
        chips += '<span class="mcc-nisa-chip warn">⚠ 枠を超過しています</span>';
      }
      var chipsHtml = chips ? '<div class="mcc-nisa-chips">' + chips + '</div>' : "";

      bodyHtml = hud + heroHtml + grid2Html + chipsHtml;
    }

    var fieldsHtml =
      '<div class="mcc-nisa-fields">' +
        moneyInput("当年つみたて拠出", "nisa.tsumitateThisYear", n.tsumitateThisYear) +
        moneyInput("当年成長拠出", "nisa.growthThisYear", n.growthThisYear) +
        moneyInput("当年売却(簿価)", "nisa.soldThisYearAtCost", n.soldThisYearAtCost) +
        moneyInput("生涯つみたて簿価残", "nisa.tsumitateLifetime", n.tsumitateLifetime) +
        moneyInput("生涯成長簿価残", "nisa.growthLifetime", n.growthLifetime) +
        '<label class="mcc-field"><span>アンカー年</span><input type="number" min="1900" max="9999" value="' +
          (n.anchorYear > 0 ? n.anchorYear : "") + '" placeholder="例: ' + currentYear + '" onchange="MCC.setField(\'nisa.anchorYear\', this.value)"></label>' +
      '</div>';
    var inputHtml =
      '<details class="mcc-nisa-input" id="mcc-nisa-input"><summary>使用状況を入力（手入力・クラウド同期）</summary>' +
        fieldsHtml +
        '<div class="mcc-nisa-gate">¥はログイン時のみ表示（未ログインは%のみ）。</div>' +
      '</details>';

    return '<div class="mcc-nisa" id="mcc-sec-nisa">' +
      '<div class="mcc-section-title mcc-section-title-gap">NISA枠（非課税枠）' + termHelp("NISA枠") + '</div>' +
      '<div class="mcc-section-desc">課税を避けられる「枠」の消化。バケツ（いつ）・資産クラス（何を）と直交する「どの口座で持つか」の軸。</div>' +
      bodyHtml + inputHtml +
    '</div>';
  }

  // ① 用語ヘルプ：GLOSSARY(money-rules.js 単一源)から定義を引き ? ツールチップを返す。見出し/バケツ名に添える。
  var _glossaryMap = null;
  function termHelp(term) {
    if (!_glossaryMap) { _glossaryMap = {}; (R.GLOSSARY || []).forEach(function (g) { _glossaryMap[g.term] = g; }); }
    var g = _glossaryMap[term];
    if (!g) return "";
    // title でなく data-def＋CSS ポップオーバー(:hover/:focus)＝ホバーに加えタップ/キーボードでも定義が出る。
    return '<span class="mcc-help" tabindex="0" role="note" data-def="' + esc(g.read + "：" + g.def) +
      '" aria-label="' + esc(term + "とは：" + g.def) + '">?</span>';
  }

  // ① ガイド/ステッパー内の「設定」等のセクション参照 → 該当セクションへスクロール（折りたたみは開く）。
  var _JUMP_TARGETS = { settings: "mcc-sec-settings", buckets: "mcc-sec-buckets", sync: "mcc-sec-sync", cashflow: "mcc-sec-cashflow", goals: "mcc-sec-goals", assets: "mcc-sec-assets", nisa: "mcc-sec-nisa" };
  // 収支セクションは未ログインだと描画されない（認証データ）。連携にはログインが前提なので login 欄へフォールバック。
  var _JUMP_FALLBACK = { cashflow: "sync" };
  function jumpLink(key, label) {
    return '<button type="button" class="mcc-jump" onclick="MCC.jumpTo(\'' + key + '\')">' + esc(label) + '</button>';
  }
  function jumpTo(key) {
    var el = document.getElementById(_JUMP_TARGETS[key]);
    if (!el && _JUMP_FALLBACK[key]) el = document.getElementById(_JUMP_TARGETS[_JUMP_FALLBACK[key]]);
    if (!el) return;
    // <details>（設定など）は開いてから見せる＝「開いて入力」を1クリックで完結。
    if (el.tagName === "DETAILS") { el.open = true; }
    else { var det = el.closest ? el.closest("details") : null; if (det) det.open = true; }
    if (el.scrollIntoView) { el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    // 一瞬ハイライト（CSS アニメ）で「ここだよ」を提示。再クリックでも再発火するよう一度外して reflow。
    el.classList.remove("mcc-jump-flash"); void el.offsetWidth; el.classList.add("mcc-jump-flash");
  }

  // ① 常駐「はじめに / 使い方」（空状態に依存せず常時・折りたたみ・後から見返せる）。用語集も同梱。
  function guideSection() {
    var glossary = (R.GLOSSARY || []).map(function (g) {
      return '<div class="mcc-glo-item"><span class="mcc-glo-term">' + esc(g.term) + '</span>' +
        '<span class="mcc-glo-read">' + esc(g.read) + '</span>' +
        '<span class="mcc-glo-def">' + esc(g.def) + '</span></div>';
    }).join("");
    return '<details class="mcc-guide"><summary>はじめに / 使い方</summary>' +
      '<div class="mcc-guide-body">' +
        '<p class="mcc-guide-lead">このビューは、お金を <b>守る（バッファ）</b>・<b>育てる（コア）</b>・<b>攻める（サテライト）</b> の3つに分け、規律よく管理・判断支援するための画面です。投機ではなく「ルールを守る・学ぶ」ための道具です。</p>' +
        '<div class="mcc-guide-rule">配分の芯：<b>バッファ → 確保枠 → コア →（余剰のみ上限内）サテライト</b> の順に満たします。</div>' +
        '<ol class="mcc-guide-steps">' +
          '<li>' + jumpLink("settings", "「設定」") + 'で<b>月の生活費</b>を入力（バッファ目標が決まります）</li>' +
          '<li>' + jumpLink("buckets", "バッファ・コア・サテライト") + 'に<b>今ある金額</b>を入力</li>' +
          '<li>（任意）' + jumpLink("sync", "ログイン") + 'で<b>クラウド同期</b>＝複数端末で共有</li>' +
          '<li>（任意）' + jumpLink("cashflow", "家計（kakeibo）を連携") + 'すると<b>毎月の投資余力</b>が出ます</li>' +
        '</ol>' +
        '<div class="mcc-glo-title">用語集</div>' +
        '<div class="mcc-glossary">' + glossary + '</div>' +
        '<div class="mcc-guide-privacy">' + (sync.loggedIn
          ? 'ログイン中：データはクラウド同期されます（複数端末で共有）。'
          : '未ログイン中：この端末のみ（localStorage）で外部送信ゼロ。上の「クラウド同期」でログインすると共有されます。') + '</div>' +
      '</div></details>';
  }

  // ① 初回ステッパー（今ここ＋残ステップ）。全完了で非表示＝整ったユーザーの邪魔をしない。
  function stepperSection(ob) {
    if (ob.allDone) return "";
    var dots = ob.steps.map(function (st, i) {
      var cls = st.done ? "done" : (i === ob.currentIndex ? "current" : "todo");
      return '<div class="mcc-step mcc-step-' + cls + '">' +
        '<span class="mcc-step-dot">' + (st.done ? "✓" : (i + 1)) + '</span>' +
        '<span class="mcc-step-label">' + esc(st.label) + (st.optional ? '<span class="mcc-step-opt">任意</span>' : '') + '</span>' +
      '</div>';
    }).join('<span class="mcc-step-sep"></span>');
    var nextHtml = '';
    if (ob.currentIndex >= 0) {
      var st = ob.steps[ob.currentIndex];
      var actionHtml = esc(st.action);
      // action 内のセクション参照語(linkLabel)だけをジャンプリンク化（残りは素のテキスト）。
      if (st.linkLabel && st.target) {
        actionHtml = actionHtml.replace(esc(st.linkLabel), function () { return jumpLink(st.target, st.linkLabel); });
      }
      nextHtml = '<div class="mcc-stepper-next">次：' + actionHtml + '</div>';
    }
    return '<div class="mcc-stepper">' +
      '<div class="mcc-stepper-track">' + dots + '</div>' + nextHtml +
    '</div>';
  }

  function render() {
    var root = document.getElementById("mcc-root");
    if (!root) return;
    var vm = R.viewModel(state);
    var cv = R.cashflowViewModel(_cashflowRows, state, Date.now());
    var ob = R.onboardingSteps(state, sync.loggedIn, cv.hasData);
    // Task6: フェーズ型ロードマップ VM。cd は cashflowViewModel と同じ cashflowDerived(rows,state,now) の生の戻り
    // （reserveAlloc 等のキー名が cv とは異なるため、cv を渡さず別途算出＝R.roadmap の想定形状に一致させる）。
    var cd = R.cashflowDerived(_cashflowRows, state, Date.now());
    var rm = R.roadmap(state, cd, Date.now());

    var gaugeStat = vm.bufferConfigured
      ? ('<strong>' + vm.bufferProgressPct + '%</strong> ' +
          '（' + vm.fmt(vm.bufferAmount) + ' / ' + vm.fmt(vm.bufferTarget) + '）' +
          (vm.bufferRemaining > 0 ? ' ・あと ' + vm.fmt(vm.bufferRemaining) : ' ・達成'))
      : '未設定 — ' + jumpLink("settings", "「設定」") + 'で月の生活費を入力するとバッファ目標が決まります';
    var gauge =
      '<div class="mcc-gauge-card">' +
        '<div class="mcc-gauge-label">バッファ目標（生活防衛資金）' + termHelp("バッファ") + '</div>' +
        '<div class="mcc-gauge-bar"><div class="mcc-gauge-fill" style="width:' + (vm.bufferConfigured ? vm.bufferProgressPct : 0) + '%"></div></div>' +
        '<div class="mcc-gauge-stat">' + gaugeStat + '</div>' +
      '</div>';

    // setup 段はステッパー＋ゲージが既に「設定で生活費を」と促すため banner を省き、同一CTAの3連を避ける。
    var banner = vm.next.target === "setup" ? "" :
      '<div class="mcc-banner mcc-banner-' + vm.next.target + '">' +
        '<span class="mcc-banner-icon">▶</span><span>' + vm.next.message + '</span>' +
      '</div>';

    var satWarn = vm.satelliteIsOver
      ? '<div class="mcc-sat-warn">⚠ 上限超過 ' + vm.fmt(vm.satelliteOver) + '</div>' : '';
    var buckets =
      '<div class="mcc-section-title mcc-section-title-gap">いま持っている資産の内訳（保有額）</div>' +
      '<div class="mcc-section-desc">いま各バケツに入っている<b>現在の残高</b>を入力します（これから振り分ける予定額ではありません）。3つの合計が総資産になります。</div>' +
      '<div class="mcc-buckets" id="mcc-sec-buckets">' +
        '<div class="mcc-bucket"><div class="mcc-bucket-name">バッファ（現金）' + termHelp("バッファ") + '</div>' +
          moneyInput("保有額", "buckets.buffer.amount", vm.bufferAmount) + '</div>' +
        '<div class="mcc-bucket"><div class="mcc-bucket-name">コア（長期）' + termHelp("コア") + '</div>' +
          moneyInput("保有額", "buckets.core.amount", vm.coreAmount) + '</div>' +
        '<div class="mcc-bucket' + (vm.satelliteIsOver ? ' mcc-bucket-over' : '') + '">' +
          '<div class="mcc-bucket-name">サテライト（個別株/短期）' + termHelp("サテライト") + '</div>' +
          moneyInput("保有額", "buckets.satellite.amount", vm.satelliteAmount) +
          '<div class="mcc-sat-bar"><div class="mcc-sat-fill' + (vm.satelliteIsOver ? " over" : "") +
            '" style="width:' + Math.min(100, vm.satelliteFillPct) + '%"></div></div>' +
          '<div class="mcc-sat-cap">上限 ' + vm.fmt(vm.satelliteCap) + '（investable比 ' + vm.satelliteCapPct + '%）</div>' +
          satWarn +
        '</div>' +
      '</div>';

    // 収支連携済みなら、実支出の平均を「月の生活費」に採用できる提案を出す（毎回ゼロから入力する手間を削減）。
    var expenseSuggest = "";
    if (cv.hasData && cv.avgExpense > 0) {
      var matchesAvg = vm.monthlyExpense === cv.avgExpense;
      expenseSuggest =
        '<div class="mcc-expense-suggest">' +
          '<div class="mcc-expense-suggest-main">実支出の平均は <strong>' + cv.fmt(cv.avgExpense) + ' / 月</strong>' +
            (cv.monthsCovered ? '（直近' + Math.min(3, cv.monthsCovered) + 'ヶ月の確定平均）' : '') + '。' +
            (matchesAvg
              ? '<span class="mcc-expense-applied">✓ 設定と一致</span>'
              : '<button class="mcc-expense-adopt" onclick="MCC.adoptAvgExpense()">この平均を採用</button>') +
          '</div>' +
          '<div class="mcc-expense-note">※旅行・臨時出費も含む総支出の平均です。生活防衛資金は「平常の必要生活費」で決めるのが基本（娯楽等を除くとやや少なめになります）。</div>' +
        '</div>';
    }
    var settings =
      '<details class="mcc-settings" id="mcc-sec-settings"><summary>設定</summary>' +
        moneyInput("月の生活費", "monthlyExpense", vm.monthlyExpense) +
        expenseSuggest +
        moneyInput("バッファ目標（ヶ月）", "bufferMonths", vm.bufferMonths) +
        moneyInput("サテライト上限（%）", "satelliteCapPct", vm.satelliteCapPct) +
      '</details>';

    var tools =
      '<div class="mcc-tools">' +
        '<button class="mcc-tool-btn" onclick="MCC.exportJSON()">↓ エクスポート(JSON)</button>' +
        '<label class="mcc-tool-btn">↑ インポート<input type="file" accept="application/json" style="display:none" ' +
          'onchange="if(this.files[0])MCC.importJSON(this.files[0])"></label>' +
      '</div>';

    var saveWarn = lastSaveOk ? '' : '<div class="mcc-save-warn">⚠ 保存できませんでした（プライベートブラウズ等）。この端末に値が保存されない可能性があります。</div>';
    root.innerHTML = syncBar() + saveWarn + guideSection() + stepperSection(ob) + gauge + banner + roadmapSection(rm, sync.loggedIn) + assetClassSection(vm) + nisaSection(R.nisaViewModel(state, cd, Date.now())) + cashflowSection(cv) + reservesSection(cv) + adviceSection(vm) + buckets + goalsSection(vm) + settings + tools;
  }

  function exportJSON() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mcc_state.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try { state = R.migrate(JSON.parse(reader.result)); save(); render(); }
      catch (e) { alert("読み込みに失敗しました（JSONが不正です）"); }
    };
    reader.onerror = function () { alert("ファイルの読み込みに失敗しました"); };
    reader.readAsText(file);
  }

  // ③デザイン Phase 3b: 採用テーマ D「ネオン・ターミナル」を既定適用。<html data-theme="D"> を付与＝
  // money.css の [data-theme="D"] #money-view ブロック（:root[data-theme="D"] のトークン上書き＋構造規則）が効く。
  // index.html 本体は当トークンを未使用のため現状は #money-view のみに作用（本体展開は次工程）。比較用 A/B/C は削除済み。
  function applyTheme() {
    try { document.documentElement.setAttribute("data-theme", "D"); }
    catch (e) { /* 失敗時は baseline のまま */ }
  }

  function init() {
    if (!R) return;
    applyTheme();
    load();
    render();  // localStorage で即描画（セッション確認は司令室を開いた初回に遅延）
  }

  document.addEventListener("DOMContentLoaded", init);
  // 離脱時に未送信の編集を keepalive でフラッシュ（debounce 内クローズでの消失を防ぐ）。
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") cloudFlushBeacon();
  });
  window.addEventListener("pagehide", cloudFlushBeacon);

  return {
    init: init, show: show, backToPortal: backToPortal, setField: setField,
    load: load, save: save, render: render, exportJSON: exportJSON, importJSON: importJSON,
    doLogin: doLogin, logout: logout, addGoal: addGoal, removeGoal: removeGoal,
    requestAdvice: requestAdvice, applySurplus: applySurplus,
    saveAnchor: saveAnchor, editAnchor: editAnchor, refreshData: refreshData, jumpTo: jumpTo, adoptAvgExpense: adoptAvgExpense,
    addReserve: addReserve, removeReserve: removeReserve, fundReserve: fundReserve, setReserveField: setReserveField,
    acSetScope: acSetScope, acFillCashOnly: acFillCashOnly,
  };
})();
