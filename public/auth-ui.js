(function (window, document) {
  'use strict';

  var authClient = window.marketAuth || null;
  var authVerifying = false;
  var authMode = 'login';
  var authActionInFlight = false;

  function byId(id) { return document.getElementById(id); }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function setAuthMode(mode) {
    var ids = ['authLoginForm', 'authSignupForm', 'authResetForm', 'authRecoveryForm', 'authSignupSuccess'];
    var activeId = mode === 'signup' ? 'authSignupForm' : mode === 'reset' ? 'authResetForm' : mode === 'recovery-password' ? 'authRecoveryForm' : mode === 'signup-success' ? 'authSignupSuccess' : 'authLoginForm';
    var i;
    authMode = mode;
    for (i = 0; i < ids.length; i += 1) byId(ids[i]).hidden = ids[i] !== activeId;
    byId('authShowLogin').className = mode === 'login' ? 'auth-mode active' : 'auth-mode';
    byId('authShowSignup').className = mode === 'signup' ? 'auth-mode active' : 'auth-mode';
    byId('authModeTabs').hidden = mode === 'reset' || mode === 'recovery-password' || mode === 'signup-success';
  }

  function setAuthBusy(loading) {
    var ids = ['authLoginBtn', 'authSignupBtn', 'authResetBtn', 'authRecoveryBtn', 'authShowLogin', 'authShowSignup', 'authForgotBtn', 'authBackToLogin', 'authSuccessLogin', 'authLogoutBtn'];
    var i;
    authActionInFlight = Boolean(loading);
    for (i = 0; i < ids.length; i += 1) if (byId(ids[i])) byId(ids[i]).disabled = authActionInFlight;
  }

  function showAuthValidation(message, mode) {
    setAuthBusy(false);
    setAuthMode(mode || authMode);
    byId('authStatus').className = 'auth-error';
    byId('authStatus').textContent = message;
  }

  function renderAuthState(state) {
    var form = byId('authLoginForm');
    var guestPanel = byId('authGuest');
    var sessionPanel = byId('authSession');
    var status = byId('authStatus');
    if (!form || !guestPanel || !sessionPanel || !status) return;
    if (state.mode) setAuthMode(state.mode);
    status.className = state.error ? 'auth-error' : state.message ? 'auth-success-message' : '';
    setAuthBusy(state.loading);
    if (!state.configured) {
      guestPanel.hidden = false;
      sessionPanel.hidden = true;
      setAuthBusy(true);
      status.textContent = '身份服务尚未配置';
      return;
    }
    if (state.authenticated) {
      guestPanel.hidden = true;
      sessionPanel.hidden = false;
      byId('authUserEmail').textContent = state.user && state.user.email ? state.user.email : '正在验证…';
      status.textContent = state.error || (state.user ? '身份已验证' : '正在验证身份…');
    } else {
      guestPanel.hidden = false;
      sessionPanel.hidden = true;
      status.textContent = state.error || state.message || (state.loading ? (authMode === 'signup' ? '注册中…' : authMode === 'reset' ? '正在发送…' : '登录中…') : '未登录');
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
    var signupForm = byId('authSignupForm');
    var resetForm = byId('authResetForm');
    var recoveryForm = byId('authRecoveryForm');
    if (!authClient || !form) {
      renderAuthState({ configured:false, authenticated:false });
      return;
    }
    authClient.onChange(function (state) {
      renderAuthState(state);
      if (state.authenticated && !authVerifying) verifyCurrentUser();
    });
    form.onsubmit = function (event) {
      var email;
      event.preventDefault();
      if (authActionInFlight) return;
      email = String(byId('authEmail').value || '').trim();
      if (!validEmail(email)) { showAuthValidation('请输入有效邮箱地址', 'login'); return; }
      if (!byId('authPassword').value) { showAuthValidation('请输入密码', 'login'); return; }
      authClient.signIn(email, byId('authPassword').value, function (error) {
        if (error) { renderAuthState({ configured:true, authenticated:false, error:error.message }); return; }
        byId('authPassword').value = '';
      });
    };
    signupForm.onsubmit = function (event) {
      var email;
      var password;
      event.preventDefault();
      if (authActionInFlight) return;
      email = String(byId('authSignupEmail').value || '').trim();
      password = byId('authSignupPassword').value;
      if (!validEmail(email)) { showAuthValidation('请输入有效邮箱地址', 'signup'); return; }
      if (password.length < 8) { showAuthValidation('密码至少需要 8 位字符', 'signup'); return; }
      if (password !== byId('authSignupConfirm').value) { showAuthValidation('两次输入的密码不一致', 'signup'); return; }
      authClient.signUp(email, password, function (error) {
        if (error) { renderAuthState({ configured:true, authenticated:false, error:error.message, mode:'signup' }); return; }
        byId('authSignupPassword').value = '';
        byId('authSignupConfirm').value = '';
      });
    };
    resetForm.onsubmit = function (event) {
      var email;
      event.preventDefault();
      if (authActionInFlight) return;
      email = String(byId('authResetEmail').value || '').trim();
      if (!validEmail(email)) { showAuthValidation('请输入有效邮箱地址', 'reset'); return; }
      authClient.resetPasswordForEmail(email, function (error) {
        if (error) renderAuthState({ configured:true, authenticated:false, error:error.message, mode:'reset' });
      });
    };
    recoveryForm.onsubmit = function (event) {
      var password;
      event.preventDefault();
      if (authActionInFlight) return;
      password = byId('authNewPassword').value;
      if (password.length < 8) { showAuthValidation('密码至少需要 8 位字符', 'recovery-password'); return; }
      if (password !== byId('authNewPasswordConfirm').value) { showAuthValidation('两次输入的密码不一致', 'recovery-password'); return; }
      authClient.updatePassword(password, function (error) {
        if (error) return;
        byId('authNewPassword').value = '';
        byId('authNewPasswordConfirm').value = '';
      });
    };
    byId('authShowLogin').onclick = function () { if (!authActionInFlight) setAuthMode('login'); };
    byId('authShowSignup').onclick = function () { if (!authActionInFlight) { byId('authSignupEmail').value = byId('authEmail').value; setAuthMode('signup'); } };
    byId('authForgotBtn').onclick = function () { if (!authActionInFlight) { byId('authResetEmail').value = byId('authEmail').value; setAuthMode('reset'); } };
    byId('authBackToLogin').onclick = function () { if (!authActionInFlight) setAuthMode('login'); };
    byId('authSuccessLogin').onclick = function () { if (!authActionInFlight) { byId('authEmail').value = byId('authSignupEmail').value; setAuthMode('login'); } };
    byId('authLogoutBtn').onclick = function () { if (!authActionInFlight) { setAuthBusy(true); authClient.signOut(function () { setAuthBusy(false); }); } };
    setAuthMode('login');
    authClient.init();
  }

  initAuthentication();
}(window, document));
