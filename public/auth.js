(function (window) {
  'use strict';

  var config = window.__APP_CONFIG__ || {};
  var storageKey = 'market-workbench.auth.session.v1';
  var session = null;
  var listeners = [];
  var refreshTimer = null;
  var refreshInFlight = false;
  var refreshCallbacks = [];

  function configured() {
    return config.authConfigured === true && Boolean(config.supabaseUrl) && Boolean(config.supabasePublishableKey);
  }

  function emit(state) {
    var snapshot = state || {};
    var i;
    snapshot.configured = configured();
    snapshot.authenticated = Boolean(session && session.access_token);
    snapshot.user = session && session.user ? session.user : null;
    for (i = 0; i < listeners.length; i += 1) listeners[i](snapshot);
  }

  function clearRefreshTimer() {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function persist() {
    try {
      if (session) window.localStorage.setItem(storageKey, JSON.stringify(session));
      else window.localStorage.removeItem(storageKey);
    } catch (error) {
      emit({ error:'浏览器无法保存登录状态' });
    }
  }

  function normalize(data) {
    var expiresIn = Number(data && data.expires_in);
    if (!data || !data.access_token || !data.refresh_token) return null;
    return {
      access_token:data.access_token,
      refresh_token:data.refresh_token,
      expires_at:Math.floor(new Date().getTime() / 1000) + (expiresIn > 0 ? expiresIn : 3600),
      user:data.user || null
    };
  }

  function scheduleRefresh() {
    var delay;
    clearRefreshTimer();
    if (!session || !session.expires_at) return;
    delay = Math.max(5000, (session.expires_at * 1000) - new Date().getTime() - 60000);
    refreshTimer = window.setTimeout(function () { refreshSession(function () {}); }, delay);
  }

  function authRequest(path, body, accessToken, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', config.supabaseUrl + path, true);
    xhr.timeout = 10000;
    xhr.setRequestHeader('apikey', config.supabasePublishableKey);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (accessToken) xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
    xhr.onload = function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
      if (xhr.status >= 200 && xhr.status < 300) callback(null, data || {});
      else callback(new Error('身份验证失败'));
    };
    xhr.onerror = function () { callback(new Error('身份服务网络错误')); };
    xhr.ontimeout = function () { callback(new Error('身份服务请求超时')); };
    xhr.send(JSON.stringify(body || {}));
  }

  function finishRefresh(error) {
    var callbacks = refreshCallbacks.slice(0);
    var i;
    refreshCallbacks = [];
    refreshInFlight = false;
    for (i = 0; i < callbacks.length; i += 1) callbacks[i](error, session);
  }

  function refreshSession(callback) {
    var refreshToken;
    if (callback) refreshCallbacks.push(callback);
    if (refreshInFlight) return;
    if (!configured() || !session || !session.refresh_token) {
      session = null;
      persist();
      emit({ error:'登录状态已失效' });
      finishRefresh(new Error('登录状态已失效'));
      return;
    }
    refreshInFlight = true;
    refreshToken = session.refresh_token;
    authRequest('/auth/v1/token?grant_type=refresh_token', { refresh_token:refreshToken }, null, function (error, data) {
      var updated;
      if (error) {
        session = null;
        persist();
        clearRefreshTimer();
        emit({ error:'登录状态已失效' });
        finishRefresh(error);
        return;
      }
      updated = normalize(data);
      if (!updated) {
        session = null;
        persist();
        emit({ error:'登录状态已失效' });
        finishRefresh(new Error('登录状态已失效'));
        return;
      }
      session = updated;
      persist();
      scheduleRefresh();
      emit({});
      finishRefresh(null);
    });
  }

  function getAccessToken(callback) {
    var now = Math.floor(new Date().getTime() / 1000);
    if (!session || !session.access_token) { callback(new Error('请先登录')); return; }
    if (session.expires_at > now + 30) { callback(null, session.access_token); return; }
    refreshSession(function (error) {
      if (error || !session) callback(new Error('登录状态已失效'));
      else callback(null, session.access_token);
    });
  }

  function send(xhr, payload) {
    var now = Math.floor(new Date().getTime() / 1000);
    if (session && session.access_token && session.expires_at > now) {
      xhr.setRequestHeader('Authorization', 'Bearer ' + session.access_token);
    } else if (session && session.refresh_token) {
      refreshSession(function () {});
    }
    xhr.send(payload);
  }

  function sendAuthenticated(xhr, payload, callback) {
    getAccessToken(function (error, token) {
      if (error) { callback(error); return; }
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.send(payload);
    });
  }

  function signIn(email, password, callback) {
    if (!configured()) { callback(new Error('身份服务尚未配置')); return; }
    emit({ loading:true });
    authRequest('/auth/v1/token?grant_type=password', { email:email, password:password }, null, function (error, data) {
      var next;
      if (error) { emit({ error:'邮箱或密码错误' }); callback(new Error('邮箱或密码错误')); return; }
      next = normalize(data);
      if (!next) { emit({ error:'登录响应无效' }); callback(new Error('登录响应无效')); return; }
      session = next;
      persist();
      scheduleRefresh();
      emit({});
      callback(null, session);
    });
  }

  function signOut(callback) {
    var token = session && session.access_token;
    session = null;
    persist();
    clearRefreshTimer();
    emit({});
    if (!configured() || !token) { callback(null); return; }
    authRequest('/auth/v1/logout', {}, token, function () { callback(null); });
  }

  function currentUser(callback) {
    getAccessToken(function (tokenError, token) {
      var xhr;
      if (tokenError) { callback(tokenError); return; }
      xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/auth/me', true);
      xhr.timeout = 10000;
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
        if (xhr.status >= 200 && xhr.status < 300 && data && data.id) {
          if (session) { session.user = data; persist(); }
          emit({});
          callback(null, data);
        } else callback(new Error(xhr.status === 401 ? '登录状态已失效' : '无法验证当前用户'));
      };
      xhr.onerror = function () { callback(new Error('用户验证网络错误')); };
      xhr.ontimeout = function () { callback(new Error('用户验证请求超时')); };
      xhr.send(null);
    });
  }

  function init() {
    var raw;
    var now = Math.floor(new Date().getTime() / 1000);
    if (!configured()) { emit({ disabled:true }); return; }
    try {
      raw = window.localStorage.getItem(storageKey);
      session = raw ? JSON.parse(raw) : null;
    } catch (error) { session = null; }
    if (session && session.refresh_token && (!session.access_token || session.expires_at <= now + 30)) {
      refreshSession(function () {});
      return;
    }
    scheduleRefresh();
    emit({});
  }

  window.marketAuth = {
    init:init,
    onChange:function (listener) { listeners.push(listener); },
    signIn:signIn,
    signOut:signOut,
    currentUser:currentUser,
    getSession:function () { return session; },
    getAccessToken:getAccessToken,
    send:send,
    sendAuthenticated:sendAuthenticated
  };
}(window));
