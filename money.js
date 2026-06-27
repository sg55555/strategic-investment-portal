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
        reconcile().then(function () { render(); });
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

  // ---- 画面遷移 ----
  function show() {
    var views = document.querySelectorAll(".view-section");
    for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
    document.getElementById("money-view").classList.add("active");
    window.scrollTo(0, 0);
    // 司令室を初めて開いた時だけセッションを確認（市場ビューでは auth DB を打たない）。
    if (!_sessionChecked) {
      _sessionChecked = true;
      checkSession().then(function (ok) {
        if (ok) { reconcile().then(function () { render(); }); }
        else { render(); }
      });
    }
  }

  function backToPortal() {
    document.getElementById("money-view").classList.remove("active");
    document.getElementById("portal-view").classList.add("active");
    window.scrollTo(0, 0);
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

  // ---- 描画 ----
  function syncBar() {
    if (sync.loggedIn) {
      return '<div class="mcc-sync mcc-sync-on">' +
        '<span class="mcc-sync-status" id="mcc-sync-status">' + syncStatusText() + '</span>' +
        '<button class="mcc-sync-btn" onclick="MCC.logout()">ログアウト</button>' +
      '</div>';
    }
    var err = sync.lastError ? '<span class="mcc-sync-err">' + esc(sync.lastError) + '</span>' : '';
    var dis = sync.busy ? ' disabled' : '';
    return '<div class="mcc-sync">' +
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
    return '<div class="mcc-goals"><div class="mcc-section-title">資産目標</div>' +
      (items || empty) + form + '</div>';
  }

  function render() {
    var root = document.getElementById("mcc-root");
    if (!root) return;
    var vm = R.viewModel(state);

    var gaugeStat = vm.bufferConfigured
      ? ('<strong>' + vm.bufferProgressPct + '%</strong> ' +
          '（' + vm.fmt(vm.bufferAmount) + ' / ' + vm.fmt(vm.bufferTarget) + '）' +
          (vm.bufferRemaining > 0 ? ' ・あと ' + vm.fmt(vm.bufferRemaining) : ' ・達成'))
      : '未設定 — 「設定」で月の生活費を入力するとバッファ目標が決まります';
    var gauge =
      '<div class="mcc-gauge-card">' +
        '<div class="mcc-gauge-label">バッファ目標（生活防衛資金）</div>' +
        '<div class="mcc-gauge-bar"><div class="mcc-gauge-fill" style="width:' + (vm.bufferConfigured ? vm.bufferProgressPct : 0) + '%"></div></div>' +
        '<div class="mcc-gauge-stat">' + gaugeStat + '</div>' +
      '</div>';

    var banner =
      '<div class="mcc-banner mcc-banner-' + vm.next.target + '">' +
        '<span class="mcc-banner-icon">▶</span><span>' + vm.next.message + '</span>' +
      '</div>';

    var satWarn = vm.satelliteIsOver
      ? '<div class="mcc-sat-warn">⚠ 上限超過 ' + vm.fmt(vm.satelliteOver) + '</div>' : '';
    var buckets =
      '<div class="mcc-buckets">' +
        '<div class="mcc-bucket"><div class="mcc-bucket-name">バッファ（現金）</div>' +
          moneyInput("金額", "buckets.buffer.amount", vm.bufferAmount) + '</div>' +
        '<div class="mcc-bucket"><div class="mcc-bucket-name">コア（長期）</div>' +
          moneyInput("金額", "buckets.core.amount", vm.coreAmount) + '</div>' +
        '<div class="mcc-bucket' + (vm.satelliteIsOver ? ' mcc-bucket-over' : '') + '">' +
          '<div class="mcc-bucket-name">サテライト（個別株/短期）</div>' +
          moneyInput("金額", "buckets.satellite.amount", vm.satelliteAmount) +
          '<div class="mcc-sat-bar"><div class="mcc-sat-fill' + (vm.satelliteIsOver ? " over" : "") +
            '" style="width:' + Math.min(100, vm.satelliteFillPct) + '%"></div></div>' +
          '<div class="mcc-sat-cap">上限 ' + vm.fmt(vm.satelliteCap) + '（investable比 ' + vm.satelliteCapPct + '%）</div>' +
          satWarn +
        '</div>' +
      '</div>';

    var settings =
      '<details class="mcc-settings"><summary>設定</summary>' +
        moneyInput("月の生活費", "monthlyExpense", vm.monthlyExpense) +
        moneyInput("バッファ目標（ヶ月）", "bufferMonths", vm.bufferMonths) +
        moneyInput("サテライト上限（%）", "satelliteCapPct", vm.satelliteCapPct) +
      '</details>';

    var isEmpty = vm.monthlyExpense === 0 && vm.bufferAmount === 0 && vm.coreAmount === 0 && vm.satelliteAmount === 0;
    var onboarding = isEmpty
      ? '<div class="mcc-onboard">まず「設定」で月の生活費を、各バケツに現在の金額を入力してください。' +
        (sync.loggedIn
          ? 'データはクラウド同期中（複数端末で共有）。'
          : '未ログインの間はこの端末（localStorage）のみで、外部送信されません。上の「クラウド同期」でログインすると複数端末で共有できます。') +
        '</div>'
      : '';
    var tools =
      '<div class="mcc-tools">' +
        '<button class="mcc-tool-btn" onclick="MCC.exportJSON()">↓ エクスポート(JSON)</button>' +
        '<label class="mcc-tool-btn">↑ インポート<input type="file" accept="application/json" style="display:none" ' +
          'onchange="if(this.files[0])MCC.importJSON(this.files[0])"></label>' +
      '</div>';

    var saveWarn = lastSaveOk ? '' : '<div class="mcc-save-warn">⚠ 保存できませんでした（プライベートブラウズ等）。この端末に値が保存されない可能性があります。</div>';
    root.innerHTML = syncBar() + saveWarn + onboarding + gauge + banner + buckets + goalsSection(vm) + settings + tools;
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

  function init() {
    if (!R) return;
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
  };
})();
