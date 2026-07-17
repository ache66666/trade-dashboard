(function (window) {
  'use strict';

  var config = window.__APP_CONFIG__ || {};
  var storageKey = 'market-workbench.auth.session.v1';
  var session = null;
  var listeners = [];
  var refreshTimer = null;
  var refreshInFlight = false;
  var refreshCallbacks = [];
  var recoveryAccessToken = null;

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

  function authRequestWithMethod(method, path, body, accessToken, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, config.supabaseUrl + path, true);
    xhr.timeout = 10000;
    xhr.setRequestHeader('apikey', config.supabasePublishableKey);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (accessToken) xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
    xhr.onload = function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
      if (xhr.status >= 200 && xhr.status < 300) callback(null, data || {});
      else {
        var requestError = new Error('身份验证失败');
        requestError.code = String(data && (data.error_code || data.code) || 'AUTH_REJECTED').toUpperCase();
        requestError.status = xhr.status;
        callback(requestError);
      }
    };
    xhr.onerror = function () { var error = new Error('网络异常，请稍后重试'); error.code = 'NETWORK_ERROR'; callback(error); };
    xhr.ontimeout = function () { var error = new Error('身份服务暂时不可用'); error.code = 'REQUEST_TIMEOUT'; callback(error); };
    xhr.send(JSON.stringify(body || {}));
  }

  function authRequest(path, body, accessToken, callback) {
    authRequestWithMethod('POST', path, body, accessToken, callback);
  }

  function redirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  function consumeAuthCallback() {
    var hash = String(window.location.hash || '').replace(/^#/, '');
    var parts;
    var values = {};
    var i;
    var pair;
    if (!hash) return null;
    parts = hash.split('&');
    for (i = 0; i < parts.length; i += 1) {
      pair = parts[i].split('=');
      values[decodeURIComponent(pair[0] || '')] = decodeURIComponent(pair.slice(1).join('=') || '');
    }
    if (values.access_token || values.refresh_token || values.type || values.error) {
      window.history.replaceState(null, window.document.title, window.location.pathname + window.location.search);
    }
    if (values.type === 'recovery' && values.access_token) return { type:'recovery', accessToken:values.access_token };
    if (values.type === 'signup' || values.type === 'email_change') return { type:'verified' };
    if (values.error) return { type:'error' };
    return null;
  }

  function friendlyError(error, fallback) {
    var code = String(error && error.code || '').toUpperCase();
    if (code === 'EMAIL_EXISTS' || code === 'USER_ALREADY_EXISTS' || code === 'IDENTITY_ALREADY_EXISTS') return '如果可以创建该账户，验证邮件将发送至该邮箱';
    if (code === 'EMAIL_NOT_CONFIRMED') return '邮箱尚未验证，请先完成邮箱验证';
    if (code === 'INVALID_LOGIN_CREDENTIALS' || code === 'INVALID_CREDENTIALS') return '邮箱或密码错误';
    if (code === 'WEAK_PASSWORD') return '密码强度不足，请至少使用 8 位字符';
    if (code === 'OVER_EMAIL_SEND_RATE_LIMIT' || code === 'OVER_REQUEST_RATE_LIMIT') return '请求过于频繁，请稍后再试';
    if (code === 'NETWORK_ERROR') return '网络异常，请稍后重试';
    if (code === 'REQUEST_TIMEOUT') return '身份服务暂时不可用';
    return fallback || '服务器异常，请稍后重试';
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

  function signIn(email, password, callback) {
    if (!configured()) { callback(new Error('身份服务尚未配置')); return; }
    emit({ loading:true, mode:'login' });
    authRequest('/auth/v1/token?grant_type=password', { email:email, password:password }, null, function (error, data) {
      var next;
      var message;
      if (error) { message = friendlyError(error, '邮箱或密码错误'); emit({ error:message, mode:'login' }); callback(new Error(message)); return; }
      next = normalize(data);
      if (!next) { emit({ error:'登录响应无效' }); callback(new Error('登录响应无效')); return; }
      session = next;
      persist();
      scheduleRefresh();
      emit({});
      callback(null, session);
    });
  }

  function signUp(email, password, callback) {
    if (!configured()) { callback(new Error('身份服务尚未配置')); return; }
    emit({ loading:true, mode:'signup' });
    authRequest('/auth/v1/signup?redirect_to=' + encodeURIComponent(redirectUrl()), { email:email, password:password }, null, function (error, data) {
      var message;
      var code = String(error && error.code || '').toUpperCase();
      var maskedExistingUser = !error && data && data.user && data.user.identities && data.user.identities.length === 0;
      var existingUserError = code === 'EMAIL_EXISTS' || code === 'USER_ALREADY_EXISTS' || code === 'IDENTITY_ALREADY_EXISTS';
      if (maskedExistingUser || existingUserError) error = null;
      if (error) {
        message = friendlyError(error, '注册失败，请稍后重试');
        emit({ error:message, mode:'signup' });
        callback(new Error(message));
        return;
      }
      emit({ message:'如果可以创建该账户，验证邮件将发送至该邮箱。请完成验证后登录。', mode:'signup-success' });
      callback(null, { requiresEmailVerification:true });
    });
  }

  function resetPasswordForEmail(email, callback) {
    if (!configured()) { callback(new Error('身份服务尚未配置')); return; }
    emit({ loading:true, mode:'reset' });
    authRequest('/auth/v1/recover?redirect_to=' + encodeURIComponent(redirectUrl()), { email:email }, null, function (error) {
      var message;
      if (error) {
        message = friendlyError(error, '密码重置请求失败，请稍后重试');
        emit({ error:message, mode:'reset' });
        callback(new Error(message));
        return;
      }
      emit({ message:'若该邮箱已注册，密码重置邮件将发送至该邮箱。', mode:'reset' });
      callback(null);
    });
  }

  function updatePassword(password, callback) {
    var token = recoveryAccessToken;
    if (!configured() || !token) { callback(new Error('密码重置链接已失效，请重新申请')); return; }
    emit({ loading:true, mode:'recovery-password' });
    authRequestWithMethod('PUT', '/auth/v1/user', { password:password }, token, function (error) {
      var message;
      recoveryAccessToken = null;
      if (error) {
        message = friendlyError(error, '密码重置失败，请重新申请重置邮件');
        emit({ error:message, mode:'login' });
        callback(new Error(message));
        return;
      }
      emit({ message:'密码已更新，请使用新密码登录。', mode:'login' });
      callback(null);
    });
  }

  function signOut(callback) {
    var token = session && session.access_token;
    session = null;
    persist();
    clearRefreshTimer();
    emit({ message:'已退出登录', mode:'login' });
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
    var callbackState;
    var now = Math.floor(new Date().getTime() / 1000);
    callbackState = consumeAuthCallback();
    if (!configured()) { emit({ disabled:true }); return; }
    if (callbackState) {
      session = null;
      persist();
      clearRefreshTimer();
      if (callbackState.type === 'recovery') {
        recoveryAccessToken = callbackState.accessToken;
        emit({ message:'请设置新密码', mode:'recovery-password' });
      } else if (callbackState.type === 'verified') {
        emit({ message:'邮箱验证已完成，请登录。', mode:'login' });
      } else {
        emit({ error:'身份验证链接无效或已过期', mode:'login' });
      }
      return;
    }
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
    signUp:signUp,
    resetPasswordForEmail:resetPasswordForEmail,
    updatePassword:updatePassword,
    signOut:signOut,
    currentUser:currentUser,
    getSession:function () { return session; }
  };
}(window));
