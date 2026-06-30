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
    return '<div class="mcc-goals"><div class="mcc-section-title">資産目標</div><div class="mcc-section-desc">総資産に対する目標と達成度（確保枠は含めません）。</div>' +
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
  var _JUMP_TARGETS = { settings: "mcc-sec-settings", buckets: "mcc-sec-buckets", sync: "mcc-sec-sync", cashflow: "mcc-sec-cashflow" };
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
    root.innerHTML = syncBar() + saveWarn + guideSection() + stepperSection(ob) + gauge + banner + cashflowSection(cv) + reservesSection(cv) + adviceSection(vm) + buckets + goalsSection(vm) + settings + tools;
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
  };
})();
