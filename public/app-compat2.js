(function () {
  var indicators = [];
  var events = [];
  var activeCategory = '全部';
  var categories = ['流动性', '利率', '国债期货', '外汇', '股票', '商品', '波动率', '信用', '宏观日历'];
  var groups = [
    { name: 'Rates', label: '利率', detail: '利率', symbols: ['DR007', 'CN10Y', 'US10Y', 'T.CFE'] },
    { name: 'FX', label: '外汇', detail: '外汇', symbols: ['DXY', 'USDCNY', 'USDJPY', 'EURUSD'] },
    { name: 'Equity', label: '权益', detail: '股票', symbols: ['CSI300', 'HSTECH', 'SPX', 'NDX'] },
    { name: 'Commodity', label: '商品', detail: '商品', symbols: ['GOLD', 'WTI', 'COPPER'] },
    { name: 'Credit', label: '信用', detail: '信用', symbols: ['AAA3Y', 'AA+3Y', 'AA3Y'] },
    { name: 'Options', label: '期权与波动率', detail: '波动率', symbols: ['VIX', 'MOVE'] }
  ];
  var stageBox;

  function byId(id) { return document.getElementById(id); }
  function all(selector) { return document.querySelectorAll(selector); }
  function text(value) { return value === null || value === undefined || value === '' ? '暂无数据' : String(value); }

  function createStageBox() {
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
    row.appendChild(document.createTextNode(message));
    row.style.cssText = 'padding:3px 0;border-bottom:1px solid #49615b;color:' + (error ? '#ff9c8d' : '#dce8e4');
    stageBox.appendChild(row);
    stageBox.scrollTop = stageBox.scrollHeight;
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
    return text(item.value) + (item.value_unit === '%' ? '%' : '');
  }

  function simpleChange(item) {
    var change;
    if (!item || item.source === '待手工录入') return '—';
    change = Number(item.value) - Number(item.previous_value);
    if (!isFinite(change)) return '暂无数据';
    return (change > 0 ? '↑ +' : change < 0 ? '↓ ' : '— ') + change.toFixed(4) + ' ' + text(item.change_type === 'bp' ? 'bp' : '%');
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
    var navs = all('.nav');
    var pages = all('.page');
    var i;
    for (i = 0; i < navs.length; i += 1) navs[i].className = navs[i].getAttribute('data-page') === page ? 'nav active' : 'nav';
    for (i = 0; i < pages.length; i += 1) pages[i].className = pages[i].id === page ? 'page active' : 'page';
    byId('pageTitle').textContent = page === 'overview' ? '市场总览' : page === 'details' ? '详细数据' : '数据维护';
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
      html += '<tr><td><b>' + text(indicators[i].name) + '</b><br><small>' + text(indicators[i].symbol) + '</small></td><td>' + text(indicators[i].category) + '</td><td>' + simpleValue(indicators[i]) + '</td><td>' + text(indicators[i].as_of) + '</td><td>' + text(indicators[i].source) + '</td><td></td></tr>';
    }
    root.innerHTML = html;
  }

  function request(method, url, payload, done, failed) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 10000;
    if (payload !== null) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () { if (xhr.status >= 200 && xhr.status < 300) done(xhr.responseText); else failed(new Error('HTTP ' + xhr.status)); };
    xhr.onerror = function () { failed(new Error('网络错误')); };
    xhr.ontimeout = function () { failed(new Error('请求超时')); };
    xhr.send(payload === null ? null : JSON.stringify(payload));
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
    byId('refreshBtn').onclick = loadDashboard;
    byId('newBtn').onclick = function () { var dialog = byId('editDialog'); byId('indicatorForm').reset(); if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', 'open'); };
    byId('closeDialog').onclick = function () { byId('editDialog').close(); };
    byId('cancelDialog').onclick = function () { byId('editDialog').close(); };
    categorySelect.innerHTML = '';
    for (i = 0; i < categories.length - 1; i += 1) {
      option = document.createElement('option');
      option.appendChild(document.createTextNode(categories[i]));
      categorySelect.appendChild(option);
    }
    byId('indicatorForm').onsubmit = function (event) {
      var form = this;
      var payload = formPayload(form);
      event.preventDefault();
      payload.is_featured = form.elements.is_featured.checked;
      request('POST', '/api/indicators', payload, function () { byId('editDialog').close(); loadDashboard(); }, function (error) { report('F 指标保存', 'failed', error, payload.symbol || '—'); });
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
    runStage.last = 'listeners';
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
    runStage('B 硬编码卡片', stageB);
    runStage('C 首条接口指标', stageC);
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
        } catch (error) {
          report('XHR onload', 'failed', error, 'responseLength=' + (xhr.responseText ? xhr.responseText.length : 0));
        }
      };
      xhr.onerror = function () { report('XHR', 'failed', new Error('网络错误'), 'onerror'); };
      xhr.ontimeout = function () { report('XHR', 'failed', new Error('请求超时'), 'ontimeout'); };
      xhr.onabort = function () { report('XHR', 'failed', new Error('请求中止'), 'onabort'); };
      xhr.send(null);
    } catch (error) {
      report('XHR create/send', 'failed', error, '—');
    }
  }

  createStageBox();
  loadDashboard();
}());
