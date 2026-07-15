/* Stable ES5 client; append ?debug=1 to show staged compatibility diagnostics. */
(function () {
  var indicators = [];
  var events = [];
  var activeCategory = '全部';
  var editingIndicatorId = null;
  var journalSymbols = ['DR007', 'CN10Y', 'T.CFE', 'DXY', 'USDCNY', 'CSI300', 'SPX', 'GOLD', 'WTI', 'VIX', 'MOVE'];
  var categories = ['流动性', '利率', '国债期货', '外汇', '股票', '商品', '波动率', '信用', '宏观日历'];
  var groups = [
    { name: 'Rates', label: '利率', detail: '利率', symbols: ['DR007', 'CN10Y', 'US10Y', 'T.CFE'] },
    { name: 'FX', label: '外汇', detail: '外汇', symbols: ['DXY', 'USDCNY', 'USDJPY', 'EURUSD'] },
    { name: 'Equity', label: '权益', detail: '股票', symbols: ['CSI300', 'HSTECH', 'SPX', 'NDX'] },
    { name: 'Commodity', label: '商品', detail: '商品', symbols: ['GOLD', 'WTI', 'COPPER'] },
    { name: 'Credit', label: '信用', detail: '信用', symbols: ['AAA3Y', 'AA+3Y', 'AA3Y'] },
    { name: 'Options', label: '期权与波动率', detail: '波动率', symbols: ['VIX', 'MOVE'] }
  ];
  var publicConfig = window.__APP_CONFIG__ || {};
  var editorWriteEnabled = publicConfig.editorWriteEnabled === true;
  var authClient = window.marketAuth || null;
  var authVerifying = false;
  var debugEnabled = Boolean(publicConfig.debugPanelDefault) || window.location.search.indexOf('debug=1') >= 0;
  var stageBox;

  function byId(id) { return document.getElementById(id); }
  function all(selector) { return document.querySelectorAll(selector); }
  function text(value) { return value === null || value === undefined || value === '' ? '暂无数据' : String(value); }
  function escapeHtml(value) { return String(value === null || value === undefined ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function createStageBox() {
    if (!debugEnabled) return;
    stageBox = document.createElement('div');
    stageBox.id = 'compat2Status';
    stageBox.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;padding:8px 12px;background:#10221e;color:#fff;font:12px/1.45 monospace;white-space:pre-wrap;max-height:28vh;overflow:auto;border-bottom:2px solid #c7a75b';
    document.body.appendChild(stageBox);
    document.body.style.paddingTop = '82px';
  }

  function report(stage, state, error, last) {
    var row = document.createElement('div');
    var message = '阶段 ' + stage + ' | ' + state + ' | 最后成功: ' + (last || '—');
    if (error) message += '\nerror.name=' + text(error.name) + ' | error.message=' + text(error.message) + '\nerror.stack=' + text(error.stack);
    if (!stageBox) {
      if (error) showError('数据加载失败：' + text(error.message));
      return;
    }
    row.appendChild(document.createTextNode(message));
    row.style.cssText = 'padding:3px 0;border-bottom:1px solid #49615b;color:' + (error ? '#ff9c8d' : '#dce8e4');
    stageBox.appendChild(row);
    stageBox.scrollTop = stageBox.scrollHeight;
  }

  function showError(message) {
    var toast = byId('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast show';
    window.setTimeout(function () { toast.className = 'toast'; }, 4000);
  }

  function sendApiXhr(xhr, payload, requireLogin, failed) {
    if (!authClient) {
      if (requireLogin) { failed(new Error('请先登录')); return; }
      xhr.send(payload);
      return;
    }
    if (requireLogin) {
      authClient.sendAuthenticated(xhr, payload, function (error) { failed(error); });
      return;
    }
    authClient.send(xhr, payload);
  }

  function renderAuthState(state) {
    var form = byId('authLoginForm');
    var sessionPanel = byId('authSession');
    var status = byId('authStatus');
    var loginButton = byId('authLoginBtn');
    if (!form || !sessionPanel || !status) return;
    status.className = state.error ? 'auth-error' : '';
    if (!state.configured) {
      form.hidden = false;
      sessionPanel.hidden = true;
      loginButton.disabled = true;
      status.textContent = '身份服务尚未配置';
      return;
    }
    loginButton.disabled = Boolean(state.loading);
    if (state.authenticated) {
      form.hidden = true;
      sessionPanel.hidden = false;
      byId('authUserEmail').textContent = state.user && state.user.email ? state.user.email : '正在验证…';
      status.textContent = state.error || (state.user ? '身份已验证' : '正在验证身份…');
    } else {
      form.hidden = false;
      sessionPanel.hidden = true;
      status.textContent = state.error || (state.loading ? '登录中…' : '未登录');
    }
  }

  function verifyCurrentUser() {
    if (!authClient || !authClient.getSession() || authVerifying) return;
    authVerifying = true;
    authClient.currentUser(function (error, user) {
      authVerifying = false;
      if (error) {
        authClient.signOut(function () {});
        renderAuthState({ configured:true, authenticated:false, error:error.message });
        return;
      }
      renderAuthState({ configured:true, authenticated:true, user:user });
    });
  }

  function initAuthentication() {
    var form = byId('authLoginForm');
    if (!authClient || !form) {
      renderAuthState({ configured:false, authenticated:false });
      return;
    }
    authClient.onChange(function (state) {
      renderAuthState(state);
      if (state.authenticated && !authVerifying) verifyCurrentUser();
    });
    form.onsubmit = function (event) {
      event.preventDefault();
      authClient.signIn(byId('authEmail').value, byId('authPassword').value, function (error) {
        if (error) { renderAuthState({ configured:true, authenticated:false, error:error.message }); return; }
        byId('authPassword').value = '';
      });
    };
    byId('authLogoutBtn').onclick = function () { authClient.signOut(function () {}); };
    authClient.init();
  }

  function runStage(name, work) {
    try {
      work();
      report(name, 'success', null, runStage.last || '完成');
      return true;
    } catch (error) {
      report(name, 'failed', error, runStage.last || '—');
      return false;
    }
  }

  function findSymbol(symbol) {
    var i;
    for (i = 0; i < indicators.length; i += 1) {
      if (indicators[i].symbol === symbol) return indicators[i];
    }
    return null;
  }

  function simpleValue(item) {
    if (!item || item.source === '待手工录入') return '待录入';
    return text(item.value) + (item.value_unit ? (item.value_unit === '%' ? '%' : ' ' + item.value_unit) : '');
  }

  function simpleChange(item) {
    var change;
    if (!item || item.source === '待手工录入') return '—';
    if (item.change_type === 'bp') change = (Number(item.value) - Number(item.previous_value)) * (item.value_unit === 'bp' ? 1 : 100);
    else change = Number(item.previous_value) ? (Number(item.value) / Number(item.previous_value) - 1) * 100 : 0;
    if (!isFinite(change)) return '暂无数据';
    return (change > 0 ? '↑ +' : change < 0 ? '↓ ' : '— ') + change.toFixed(item.change_type === 'bp' ? 1 : 2) + ' ' + (item.change_type === 'bp' ? 'bp' : '%');
  }

  function simpleClass(item) {
    var change = Number(item.value) - Number(item.previous_value);
    return change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  }

  function overviewRow(item, symbol) {
    if (!item) return '<div class="overview-missing"><b>' + symbol + '</b><span>暂无数据</span></div>';
    return '<div class="overview-row"><div class="overview-name"><b>' + text(item.name) + '</b><small>' + text(item.symbol) + '</small></div>' +
      '<div class="overview-quote"><strong>' + simpleValue(item) + '</strong><span class="' + simpleClass(item) + '">' + simpleChange(item) + '</span></div>' +
      '<div class="overview-meta"><span>' + text(item.as_of) + ' · ' + text(item.frequency) + '</span><span>' + text(item.source) + '</span></div>' +
      '<span class="update-badge ' + (item.is_manual ? 'manual' : 'auto') + '">' + (item.is_manual ? '手工维护' : '自动更新') + '</span></div>';
  }

  function stageA() {
    var latest = byId('latestDate');
    var i;
    var value = '';
    for (i = 0; i < indicators.length; i += 1) {
      if (indicators[i].as_of && indicators[i].as_of > value) value = indicators[i].as_of;
      runStage.last = indicators[i].symbol || String(i);
    }
    latest.textContent = value || '—';
  }

  function stageB() {
    byId('overviewGrid').innerHTML = '<article class="market-group"><div class="group-head"><div><p>Stage B</p><h3>硬编码测试卡</h3></div></div><div class="overview-list"><div class="overview-row"><div class="overview-name"><b>硬编码指标</b><small>STATIC</small></div><div class="overview-quote"><strong>1.00</strong><span class="flat">— 0.00</span></div></div></div></article>';
    runStage.last = 'STATIC';
  }

  function stageC() {
    var item = indicators[0];
    byId('overviewGrid').innerHTML = '<article class="market-group"><div class="group-head"><div><p>Stage C</p><h3>首条接口指标</h3></div></div><div class="overview-list">' + overviewRow(item, item ? item.symbol : 'index=0') + '</div></article>';
    runStage.last = item ? item.symbol : 'index=0';
  }

  function stageD() {
    var grid = byId('overviewGrid');
    var ticker = byId('ticker');
    var html = '';
    var tickerHtml = '';
    var tickerSymbols = ['CN10Y', 'US10Y', 'DXY', 'SPX', 'GOLD', 'VIX'];
    var g;
    var s;
    var item;
    for (g = 0; g < groups.length; g += 1) {
      html += '<article class="market-group"><div class="group-head"><div><p>' + groups[g].name + '</p><h3>' + groups[g].label + '</h3></div><button class="group-link" data-detail="' + groups[g].detail + '">查看详细数据 <span>→</span></button></div><div class="overview-list">';
      for (s = 0; s < groups[g].symbols.length; s += 1) {
        item = findSymbol(groups[g].symbols[s]);
        html += overviewRow(item, groups[g].symbols[s]);
        runStage.last = groups[g].symbols[s] + '/index=' + s;
      }
      html += '</div></article>';
    }
    grid.innerHTML = html;
    for (s = 0; s < tickerSymbols.length; s += 1) {
      item = findSymbol(tickerSymbols[s]);
      if (item) tickerHtml += '<div class="ticker-item"><small>' + item.symbol + '</small><b>' + simpleValue(item) + '</b><strong class="' + simpleClass(item) + '">' + simpleChange(item) + '</strong></div>';
    }
    ticker.innerHTML = tickerHtml;
  }

  function stageE() {
    var root = byId('eventList');
    var html = '';
    var i;
    for (i = 0; i < events.length; i += 1) {
      html += '<div class="event"><time>' + text(events[i].event_time).substring(5, 10) + '<br>' + text(events[i].event_time).substring(11, 16) + '</time><span class="region">' + text(events[i].region) + '</span><b>' + text(events[i].name) + '</b><span class="stars">' + text(events[i].importance) + '星</span><small>前值 ' + text(events[i].previous) + '</small><small>预期 ' + text(events[i].forecast) + '</small></div>';
      runStage.last = 'event index=' + i;
    }
    root.innerHTML = html || '<p class="empty">暂无事件</p>';
  }

  function showPage(page) {
    if (page === 'editor' && !editorWriteEnabled) {
      showError('数据维护功能暂未开放');
      return;
    }
    var navs = all('.nav');
    var pages = all('.page');
    var i;
    for (i = 0; i < navs.length; i += 1) navs[i].className = navs[i].getAttribute('data-page') === page ? 'nav active' : 'nav';
    for (i = 0; i < pages.length; i += 1) pages[i].className = pages[i].id === page ? 'page active' : 'page';
    byId('pageTitle').textContent = page === 'overview' ? '市场总览' : page === 'journal' ? '交易日志' : page === 'details' ? '详细数据' : '数据维护';
    byId('pageDesc').textContent = page === 'journal' ? '记录今天的判断、证据与明日验证事项。' : page === 'overview' ? '用最少的数据，看清今天的市场方向。' : page === 'details' ? '按品类查看全部市场指标。' : '维护手工指标与宏观事件。';
    if (page === 'journal') loadJournal();
  }

  function renderDetails() {
    var root = byId('detailsRoot');
    var query = byId('searchInput').value.toLowerCase();
    var html = '<section class="detail-section"><div class="cards">';
    var i;
    var item;
    for (i = 0; i < indicators.length; i += 1) {
      item = indicators[i];
      if (activeCategory !== '全部' && item.category !== activeCategory) continue;
      if (query && (text(item.name) + ' ' + text(item.symbol) + ' ' + text(item.source)).toLowerCase().indexOf(query) < 0) continue;
      html += '<article class="card"><div class="card-name"><b>' + text(item.name) + '</b><small>' + text(item.symbol) + '</small></div><div class="card-main"><div class="card-value">' + simpleValue(item) + '</div><div class="card-change ' + simpleClass(item) + '">' + simpleChange(item) + '</div></div><div class="card-meta"><span>' + text(item.source) + '</span><span>' + text(item.as_of) + '</span></div></article>';
      runStage.last = item.symbol + '/index=' + i;
    }
    root.innerHTML = html + '</div></section>';
  }

  function renderTabs() {
    var root = byId('categoryTabs');
    var values = ['全部'].concat(categories.slice(0, categories.length - 1));
    var i;
    var button;
    root.innerHTML = '';
    for (i = 0; i < values.length; i += 1) {
      button = document.createElement('button');
      button.className = values[i] === activeCategory ? 'tab active' : 'tab';
      button.setAttribute('data-category', values[i]);
      button.appendChild(document.createTextNode(values[i]));
      button.onclick = function () { activeCategory = this.getAttribute('data-category'); renderTabs(); renderDetails(); };
      root.appendChild(button);
    }
  }

  function renderEditor() {
    var root = byId('editTable');
    var html = '';
    var i;
    for (i = 0; i < indicators.length; i += 1) {
      if (!indicators[i].is_manual) continue;
      html += '<tr><td><b>' + text(indicators[i].name) + '</b><br><small>' + text(indicators[i].symbol) + '</small></td><td>' + text(indicators[i].category) + '</td><td>' + simpleValue(indicators[i]) + '</td><td>' + text(indicators[i].as_of) + '</td><td>' + text(indicators[i].source) + '</td><td><button class="edit-btn" data-id="' + indicators[i].id + '">编辑</button></td></tr>';
    }
    root.innerHTML = html;
    attachEditButtons();
  }

  function attachEditButtons() {
    var buttons = all('.edit-btn');
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      buttons[i].onclick = function () {
        var id = Number(this.getAttribute('data-id'));
        var j;
        for (j = 0; j < indicators.length; j += 1) {
          if (Number(indicators[j].id) === id) { openIndicatorDialog(indicators[j]); return; }
        }
      };
    }
  }

  function openIndicatorDialog(item) {
    if (!editorWriteEnabled) {
      showError('数据维护功能暂未开放');
      return;
    }
    var dialog = byId('editDialog');
    var form = byId('indicatorForm');
    var key;
    var field;
    form.reset();
    editingIndicatorId = item ? Number(item.id) : null;
    byId('dialogTitle').textContent = item ? '编辑指标' : '新增指标';
    if (item) {
      for (key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        field = form.elements[key];
        if (!field) continue;
        if (field.type === 'checkbox') field.checked = Boolean(item[key]);
        else field.value = item[key] === null ? '' : item[key];
      }
    } else {
      form.elements.source.value = 'Wind 手工';
      form.elements.frequency.value = 'Daily Close';
      form.elements.sort_order.value = '99';
      form.elements.as_of.value = new Date().toISOString().substring(0, 10);
    }
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', 'open');
  }

  function request(method, url, payload, done, failed) {
    if (!editorWriteEnabled && method !== 'GET') {
      failed(new Error('数据维护功能暂未开放'));
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 10000;
    if (payload !== null) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () { if (xhr.status >= 200 && xhr.status < 300) done(xhr.responseText); else failed(new Error('HTTP ' + xhr.status)); };
    xhr.onerror = function () { failed(new Error('网络错误')); };
    xhr.ontimeout = function () { failed(new Error('请求超时')); };
    sendApiXhr(xhr, payload === null ? null : JSON.stringify(payload), method !== 'GET', failed);
  }

  function localDate() {
    var now = new Date();
    var month = String(now.getMonth() + 1);
    var day = String(now.getDate());
    return now.getFullYear() + '-' + (month.length < 2 ? '0' + month : month) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function renderJournalSnapshot() {
    var root = byId('journalSnapshot');
    var html = '';
    var i;
    var item;
    for (i = 0; i < journalSymbols.length; i += 1) {
      item = findSymbol(journalSymbols[i]);
      if (!item) {
        html += '<div class="journal-market is-missing"><b>' + journalSymbols[i] + '</b><small>暂无数据</small><strong>—</strong></div>';
        continue;
      }
      html += '<div class="journal-market"><b>' + escapeHtml(item.name) + '</b><small>' + escapeHtml(item.symbol) + '</small><strong>' + escapeHtml(simpleValue(item)) + '</strong><em class="' + simpleClass(item) + '">' + escapeHtml(simpleChange(item)) + '</em></div>';
    }
    root.innerHTML = html;
  }

  function evidenceMap(items) {
    var result = {};
    var i;
    for (i = 0; i < (items || []).length; i += 1) result[items[i].symbol] = items[i].note || '';
    return result;
  }

  function renderJournalEvidence(kind, saved) {
    var root = byId(kind === 'support' ? 'supportEvidence' : 'opposeEvidence');
    var notes = evidenceMap(saved);
    var html = '';
    var i;
    var item;
    for (i = 0; i < journalSymbols.length; i += 1) {
      item = findSymbol(journalSymbols[i]);
      if (!item) continue;
      html += '<div class="evidence-row"><input type="checkbox" data-evidence-check="' + kind + '" data-symbol="' + escapeHtml(item.symbol) + '"' + (Object.prototype.hasOwnProperty.call(notes, item.symbol) ? ' checked' : '') + '><label><b>' + escapeHtml(item.name) + '</b><small>' + escapeHtml(item.symbol) + ' · ' + escapeHtml(simpleChange(item)) + '</small></label><input class="evidence-note" maxlength="200" data-evidence-note="' + kind + '" data-symbol="' + escapeHtml(item.symbol) + '" placeholder="记录这项数据说明了什么" value="' + escapeHtml(notes[item.symbol] || '') + '"></div>';
    }
    root.innerHTML = html || '<p class="empty">暂无可选指标</p>';
  }

  function collectEvidence(kind) {
    var checks = all('[data-evidence-check="' + kind + '"]');
    var notes = all('[data-evidence-note="' + kind + '"]');
    var result = [];
    var i;
    var j;
    var symbol;
    var note;
    for (i = 0; i < checks.length; i += 1) {
      if (!checks[i].checked) continue;
      symbol = checks[i].getAttribute('data-symbol');
      note = '';
      for (j = 0; j < notes.length; j += 1) if (notes[j].getAttribute('data-symbol') === symbol) { note = notes[j].value; break; }
      result.push({ symbol: symbol, note: note });
    }
    return result;
  }

  function journalPayload() {
    var form = byId('journalForm');
    var watchlist = [];
    var i;
    var title;
    var note;
    for (i = 0; i < 3; i += 1) {
      title = form.elements['watch_title_' + i].value;
      note = form.elements['watch_note_' + i].value;
      if (title || note) watchlist.push({ title:title, note:note, status:form.elements['watch_status_' + i].value });
    }
    return {
      thesis:form.elements.thesis.value,
      summary:form.elements.summary.value,
      supporting_evidence:collectEvidence('support'),
      opposing_evidence:collectEvidence('oppose'),
      watchlist:watchlist
    };
  }

  function populateJournal(note) {
    var form = byId('journalForm');
    var i;
    var item;
    form.reset();
    form.elements.thesis.value = note ? note.thesis : '';
    form.elements.summary.value = note ? note.summary : '';
    renderJournalEvidence('support', note ? note.supporting_evidence : []);
    renderJournalEvidence('oppose', note ? note.opposing_evidence : []);
    for (i = 0; i < 3; i += 1) {
      item = note && note.watchlist ? note.watchlist[i] : null;
      form.elements['watch_title_' + i].value = item ? item.title : '';
      form.elements['watch_note_' + i].value = item ? item.note : '';
      form.elements['watch_status_' + i].value = item ? item.status : '未验证';
    }
    byId('journalSummaryCount').textContent = form.elements.summary.value.length + ' / 200';
    byId('journalSaveState').textContent = note ? '已保存 · ' + text(note.updated_at).substring(0, 16).replace('T', ' ') : '尚未保存';
    byId('journalSaveState').className = note ? 'is-saved' : '';
    byId('journalError').textContent = '';
  }

  function journalRequest(method, url, payload, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 10000;
    if (payload) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      var data;
      try {
        data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error || ('HTTP ' + xhr.status));
        done(null, data);
      } catch (error) { done(error); }
    };
    xhr.onerror = function () { done(new Error('网络错误')); };
    xhr.ontimeout = function () { done(new Error('请求超时')); };
    sendApiXhr(xhr, payload ? JSON.stringify(payload) : null, false, done);
  }

  function loadJournal() {
    var date = byId('journalDate').value || localDate();
    byId('journalSaveState').textContent = '读取中…';
    journalRequest('GET', '/api/journal/' + encodeURIComponent(date), null, function (error, data) {
      if (error) { byId('journalError').textContent = error.message; byId('journalSaveState').textContent = '读取失败'; return; }
      populateJournal(data.note);
      report('Journal', 'loaded', null, date);
    });
  }

  function saveJournal(event) {
    var button = byId('journalSaveBtn');
    var date = byId('journalDate').value;
    var payload = journalPayload();
    event.preventDefault();
    byId('journalError').textContent = '';
    if (!payload.thesis || !payload.summary.trim()) { byId('journalError').textContent = '请选择主线并填写一句话判断'; return; }
    button.disabled = true;
    button.textContent = '保存中…';
    journalRequest('PUT', '/api/journal/' + encodeURIComponent(date), payload, function (error, data) {
      button.disabled = false;
      button.textContent = '保存今日日志';
      if (error) { byId('journalError').textContent = error.message; report('Journal', 'failed', error, date); return; }
      populateJournal(data.note);
      showError('交易日志已保存');
      report('Journal', 'saved', null, date);
    });
  }

  function refreshMarketData() {
    if (!editorWriteEnabled) {
      showError('数据维护功能暂未开放');
      return;
    }
    var button = byId('refreshBtn');
    var xhr = new XMLHttpRequest();
    button.disabled = true;
    button.textContent = '更新中…';
    xhr.open('POST', '/api/refresh', true);
    xhr.timeout = 120000;
    xhr.onload = function () {
      button.disabled = false;
      button.textContent = '↻ 刷新';
      if (xhr.status >= 200 && xhr.status < 300) loadDashboard();
      else report('刷新', 'failed', new Error('HTTP ' + xhr.status), 'api/refresh');
    };
    xhr.onerror = function () { button.disabled = false; button.textContent = '↻ 刷新'; report('刷新', 'failed', new Error('网络错误'), 'api/refresh'); };
    xhr.ontimeout = function () { button.disabled = false; button.textContent = '↻ 刷新'; report('刷新', 'failed', new Error('请求超时'), 'api/refresh'); };
    sendApiXhr(xhr, null, true, function (error) {
      button.disabled = false;
      button.textContent = '↻ 刷新';
      report('刷新', 'failed', error, 'api/refresh');
    });
  }

  function attachListeners() {
    var navs = all('.nav');
    var links = all('[data-go]');
    var groupLinks = all('.group-link');
    var categorySelect = byId('categorySelect');
    var option;
    var i;
    for (i = 0; i < navs.length; i += 1) navs[i].onclick = function () { showPage(this.getAttribute('data-page')); };
    for (i = 0; i < links.length; i += 1) links[i].onclick = function () { showPage(this.getAttribute('data-go')); };
    for (i = 0; i < groupLinks.length; i += 1) groupLinks[i].onclick = function () { activeCategory = this.getAttribute('data-detail'); renderTabs(); renderDetails(); showPage('details'); };
    byId('searchInput').oninput = renderDetails;
    byId('refreshBtn').onclick = refreshMarketData;
    byId('newBtn').onclick = function () { openIndicatorDialog(null); };
    byId('closeDialog').onclick = function () { byId('editDialog').close(); };
    byId('cancelDialog').onclick = function () { byId('editDialog').close(); };
    byId('journalDate').value = byId('journalDate').value || localDate();
    byId('journalDate').onchange = loadJournal;
    byId('journalForm').onsubmit = saveJournal;
    byId('journalForm').elements.summary.oninput = function () { byId('journalSummaryCount').textContent = this.value.length + ' / 200'; };
    categorySelect.innerHTML = '';
    for (i = 0; i < categories.length - 1; i += 1) {
      option = document.createElement('option');
      option.appendChild(document.createTextNode(categories[i]));
      categorySelect.appendChild(option);
    }
    byId('indicatorForm').onsubmit = function (event) {
      var form = this;
      var payload = formPayload(form);
      var method = editingIndicatorId ? 'PUT' : 'POST';
      var url = editingIndicatorId ? '/api/indicators/' + editingIndicatorId : '/api/indicators';
      event.preventDefault();
      payload.is_featured = form.elements.is_featured.checked;
      request(method, url, payload, function () { editingIndicatorId = null; byId('editDialog').close(); loadDashboard(); }, function (error) { report('F 指标保存', 'failed', error, payload.symbol || '—'); });
    };
    byId('eventForm').onsubmit = function (event) {
      var form = this;
      var payload = formPayload(form);
      event.preventDefault();
      request('POST', '/api/events', payload, function () { form.reset(); loadDashboard(); }, function (error) { report('F 事件保存', 'failed', error, payload.name || '—'); });
    };
    renderTabs();
    renderDetails();
    renderEditor();
    renderJournalSnapshot();
    renderJournalEvidence('support', []);
    renderJournalEvidence('oppose', []);
    runStage.last = 'listeners';
  }

  function applyEditorWriteState() {
    var controls;
    var i;
    if (editorWriteEnabled) return;
    controls = all('[data-editor-write-control]');
    for (i = 0; i < controls.length; i += 1) {
      controls[i].hidden = true;
      controls[i].disabled = true;
    }
  }

  function formPayload(form) {
    var payload = {};
    var i;
    var field;
    for (i = 0; i < form.elements.length; i += 1) {
      field = form.elements[i];
      if (field.name) payload[field.name] = field.value;
    }
    return payload;
  }

  function runStages() {
    runStage.last = '—';
    runStage('A 数据基准', stageA);
    if (debugEnabled) {
      runStage('B 硬编码卡片', stageB);
      runStage('C 首条接口指标', stageC);
    }
    runStage('D 全部市场总览', stageD);
    runStage('E 宏观事件', stageE);
    runStage('F 导航与维护监听器', attachListeners);
  }

  function loadDashboard() {
    var xhr;
    report('XHR', 'start', null, 'create');
    try {
      xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/dashboard-compat?t=' + new Date().getTime(), true);
      xhr.responseType = 'text';
      xhr.timeout = 10000;
      xhr.onload = function () {
        var data;
        try {
          if (xhr.status < 200 || xhr.status >= 300) throw new Error('HTTP ' + xhr.status);
          data = JSON.parse(xhr.responseText);
          indicators = data.indicators;
          events = data.events;
          report('XHR', 'success', null, 'indicators=' + indicators.length + ' events=' + events.length);
          runStages();
          if (window.location.search.indexOf('page=journal') >= 0) showPage('journal');
        } catch (error) {
          report('XHR onload', 'failed', error, 'responseLength=' + (xhr.responseText ? xhr.responseText.length : 0));
        }
      };
      xhr.onerror = function () { report('XHR', 'failed', new Error('网络错误'), 'onerror'); };
      xhr.ontimeout = function () { report('XHR', 'failed', new Error('请求超时'), 'ontimeout'); };
      xhr.onabort = function () { report('XHR', 'failed', new Error('请求中止'), 'onabort'); };
      sendApiXhr(xhr, null, false, function (error) { report('XHR', 'failed', error, 'authorization'); });
    } catch (error) {
      report('XHR create/send', 'failed', error, '—');
    }
  }

  createStageBox();
  applyEditorWriteState();
  initAuthentication();
  if (publicConfig.environment === 'staging') byId('environmentBadge').hidden = false;
  report('Runtime', 'ready', null, (publicConfig.environment || 'unknown') + ' commit=' + (publicConfig.commit || 'unknown') + ' version=' + (publicConfig.version || 'unknown'));
  loadDashboard();
}());
