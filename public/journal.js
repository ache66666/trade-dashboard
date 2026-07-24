(function (window, document) {
  'use strict';

  var auth = window.marketAuth;
  var workbench = window.marketWorkbench;
  var symbols = ['DR007','CN10Y','T.CFE','DXY','USDCNY','CSI300','SPX','GOLD','WTI','VIX','MOVE'];

  function byId(id) { return document.getElementById(id); }
  function all(selector) { return document.querySelectorAll(selector); }
  function escapeHtml(value) { return String(value === null || value === undefined ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function localDate() {
    var now = new Date();
    var month = String(now.getMonth() + 1);
    var day = String(now.getDate());
    return now.getFullYear() + '-' + (month.length < 2 ? '0' + month : month) + '-' + (day.length < 2 ? '0' + day : day);
  }
  function indicators() { return workbench && workbench.getIndicators ? workbench.getIndicators() : []; }
  function findIndicator(symbol) {
    var values = indicators();
    var i;
    for (i = 0; i < values.length; i += 1) if (values[i].symbol === symbol) return values[i];
    return null;
  }
  function hasValue(item) { return item && item.value !== null && item.value !== '' && isFinite(Number(item.value)); }
  function valueText(item) { return hasValue(item) ? String(item.value) + (item.value_unit || '') : '待录入'; }
  function changeText(item) {
    var current;
    var previous;
    var change;
    if (!hasValue(item) || item.previous_value === null || item.previous_value === '' || !isFinite(Number(item.previous_value))) return '—';
    current = Number(item.value);
    previous = Number(item.previous_value);
    change = item.change_type === 'bp' ? (current - previous) * 100 : (previous === 0 ? null : (current - previous) / previous * 100);
    if (change === null || !isFinite(change)) return '—';
    return (change > 0 ? '+' : '') + change.toFixed(2) + (item.change_type === 'bp' ? ' bp' : '%');
  }
  function changeClass(item) {
    var current;
    var previous;
    if (!hasValue(item) || item.previous_value === null || item.previous_value === '' || !isFinite(Number(item.previous_value))) return 'is-missing';
    current = Number(item.value);
    previous = Number(item.previous_value);
    return current > previous ? 'up' : current < previous ? 'down' : 'flat';
  }

  function renderSnapshot() {
    var root = byId('journalSnapshot');
    var html = '';
    var i;
    var item;
    for (i = 0; i < symbols.length; i += 1) {
      item = findIndicator(symbols[i]);
      if (!item) {
        html += '<div class="journal-market is-missing"><b>' + escapeHtml(symbols[i]) + '</b><small>暂无数据</small><strong>—</strong></div>';
      } else {
        html += '<div class="journal-market ' + changeClass(item) + '"><b>' + escapeHtml(item.name) + '</b><small>' + escapeHtml(item.symbol) + '</small><strong>' + escapeHtml(valueText(item)) + '</strong><em>' + escapeHtml(changeText(item)) + '</em></div>';
      }
    }
    root.innerHTML = html;
  }

  function evidenceMap(items) {
    var result = {};
    var i;
    for (i = 0; i < (items || []).length; i += 1) result[items[i].symbol] = items[i].note || '';
    return result;
  }
  function renderEvidence(kind, saved) {
    var root = byId(kind === 'support' ? 'supportEvidence' : 'opposeEvidence');
    var notes = evidenceMap(saved);
    var html = '';
    var i;
    var item;
    for (i = 0; i < symbols.length; i += 1) {
      item = findIndicator(symbols[i]);
      if (!item) continue;
      html += '<div class="evidence-row"><input type="checkbox" data-evidence-check="' + kind + '" data-symbol="' + escapeHtml(item.symbol) + '"' + (Object.prototype.hasOwnProperty.call(notes, item.symbol) ? ' checked' : '') + '><label><b>' + escapeHtml(item.name) + '</b><small>' + escapeHtml(item.symbol) + ' · ' + escapeHtml(changeText(item)) + '</small></label><input class="evidence-note" maxlength="200" data-evidence-note="' + kind + '" data-symbol="' + escapeHtml(item.symbol) + '" placeholder="记录这项数据说明了什么" value="' + escapeHtml(notes[item.symbol] || '') + '"></div>';
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
      result.push({ symbol:symbol, note:note });
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
  function populate(note) {
    var form = byId('journalForm');
    var i;
    var item;
    form.reset();
    form.elements.thesis.value = note ? note.thesis : '';
    form.elements.summary.value = note ? note.summary : '';
    renderEvidence('support', note ? note.supporting_evidence : []);
    renderEvidence('oppose', note ? note.opposing_evidence : []);
    for (i = 0; i < 3; i += 1) {
      item = note && note.watchlist ? note.watchlist[i] : null;
      form.elements['watch_title_' + i].value = item ? item.title : '';
      form.elements['watch_note_' + i].value = item ? item.note : '';
      form.elements['watch_status_' + i].value = item ? item.status : '未验证';
    }
    byId('journalSummaryCount').textContent = form.elements.summary.value.length + ' / 200';
    byId('journalSaveState').textContent = note ? '已保存' : '尚未保存';
    byId('journalSaveState').className = note ? 'is-saved' : '';
    byId('journalError').textContent = '';
  }
  function safeError(status, data) {
    if (status === 401) return '请先登录';
    if (status === 400 && data && typeof data.error === 'string') return data.error;
    if (status === 503) return '交易日志服务暂时不可用';
    return '请求失败，请稍后再试';
  }
  function request(method, url, payload, done) {
    auth.getAccessToken(function (tokenError, token) {
      var xhr;
      if (tokenError || !token) { done(new Error('请先登录')); return; }
      xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = 10000;
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      if (payload) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
        if (xhr.status >= 200 && xhr.status < 300) { done(null, data || {}); return; }
        done(new Error(safeError(xhr.status, data)));
      };
      xhr.onerror = function () { done(new Error('网络异常')); };
      xhr.ontimeout = function () { done(new Error('请求超时')); };
      xhr.send(payload ? JSON.stringify(payload) : null);
    });
  }
  function load() {
    var date = byId('journalDate').value || localDate();
    byId('journalSaveState').textContent = '读取中…';
    request('GET', '/api/journal/' + encodeURIComponent(date), null, function (error, data) {
      if (error) { byId('journalError').textContent = error.message; byId('journalSaveState').textContent = '读取失败'; return; }
      populate(data.note);
    });
  }
  function save(event) {
    var button = byId('journalSaveBtn');
    var payload = journalPayload();
    var date = byId('journalDate').value;
    event.preventDefault();
    byId('journalError').textContent = '';
    if (!payload.thesis || !payload.summary.replace(/^\s+|\s+$/g, '')) { byId('journalError').textContent = '请选择主线并填写一句话判断'; return; }
    button.disabled = true;
    button.textContent = '保存中…';
    request('PUT', '/api/journal/' + encodeURIComponent(date), payload, function (error, data) {
      button.disabled = false;
      button.textContent = '保存今日日志';
      if (error) { byId('journalError').textContent = error.message; return; }
      populate(data.note);
    });
  }
  function syncAuth() {
    var authenticated = Boolean(auth && auth.getSession && auth.getSession());
    byId('journalNav').hidden = !authenticated;
    byId('journalOverviewLink').hidden = !authenticated;
    if (!authenticated && byId('journal').className.indexOf('active') >= 0) {
      populate(null);
      workbench.showPage('morning');
    }
  }
  function openJournal() {
    if (!auth || !auth.getSession || !auth.getSession()) return;
    window.setTimeout(function () { renderSnapshot(); renderEvidence('support', []); renderEvidence('oppose', []); load(); }, 0);
  }
  function init() {
    window.marketPageAccess = function (page) { return page !== 'journal' || Boolean(auth && auth.getSession && auth.getSession()); };
    byId('journalDate').value = localDate();
    byId('journalDate').onchange = load;
    byId('journalForm').onsubmit = save;
    byId('journalForm').elements.summary.oninput = function () { byId('journalSummaryCount').textContent = this.value.length + ' / 200'; };
    byId('journalNav').addEventListener('click', openJournal, false);
    byId('journalOverviewLink').addEventListener('click', openJournal, false);
    if (auth) auth.onChange(function () { syncAuth(); });
    syncAuth();
  }

  init();
}(window, document));
