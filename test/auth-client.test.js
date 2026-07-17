'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../public/auth.js'), 'utf8');

function browserHarness(storedSession, locationHash) {
  const responses = [];
  const requests = [];
  const storage = new Map();
  const timers = [];
  if (storedSession) storage.set('market-workbench.auth.session.v1', JSON.stringify(storedSession));

  function FakeXhr() {
    this.headers = {};
    this.status = 0;
    this.responseText = '';
    requests.push(this);
  }
  FakeXhr.prototype.open = function (method, url) { this.method = method; this.url = url; };
  FakeXhr.prototype.setRequestHeader = function (name, value) { this.headers[name] = value; };
  FakeXhr.prototype.send = function (body) {
    const response = responses.shift();
    this.body = body;
    if (!response) throw new Error('No fake XHR response queued');
    this.status = response.status;
    this.responseText = response.body === undefined ? '' : JSON.stringify(response.body);
    this.onload();
  };

  const window = {
    __APP_CONFIG__:{ authConfigured:true, supabaseUrl:'https://test.supabase.co', supabasePublishableKey:'sb_publishable_test' },
    localStorage:{
      getItem:key => storage.has(key) ? storage.get(key) : null,
      setItem:(key, value) => storage.set(key, value),
      removeItem:key => storage.delete(key)
    },
    location:{ origin:'https://production.example.com', pathname:'/', search:'', hash:locationHash || '' },
    history:{ replaceState:function (state, title, url) { window.location.hash = ''; window.location.replacedWith = url; } },
    document:{ title:'Market Workbench' },
    setTimeout:function (fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout:function () {}
  };
  vm.runInNewContext(source, { window, XMLHttpRequest:FakeXhr }, { filename:'public/auth.js' });
  return { auth:window.marketAuth, responses, requests, storage, timers, location:window.location };
}

test('ES5 client logs in and verifies the current user through Node API', () => {
  const h = browserHarness();
  let result;
  h.auth.init();
  h.responses.push({ status:200, body:{ access_token:'access-1', refresh_token:'refresh-1', expires_in:3600, user:{ id:'user-1', email:'trader@example.com' } } });
  h.auth.signIn('trader@example.com', 'private-password', function (error) { result = error; });
  assert.equal(result, null);
  assert.equal(h.requests[0].url, 'https://test.supabase.co/auth/v1/token?grant_type=password');
  h.responses.push({ status:200, body:{ id:'user-1', email:'trader@example.com' } });
  h.auth.currentUser(function (error, user) { result = { error, user }; });
  assert.equal(result.error, null);
  assert.equal(result.user.email, 'trader@example.com');
  assert.equal(h.requests[1].url, '/api/auth/me');
  assert.equal(h.requests[1].headers.Authorization, 'Bearer access-1');
});

test('expired Session refreshes and failed refresh clears it', () => {
  const stored = { access_token:'expired', refresh_token:'refresh-1', expires_at:1, user:{ id:'user-1' } };
  const h = browserHarness(stored);
  h.responses.push({ status:200, body:{ access_token:'access-2', refresh_token:'refresh-2', expires_in:3600, user:{ id:'user-1' } } });
  h.auth.init();
  assert.equal(h.auth.getSession().access_token, 'access-2');
  assert.ok(h.timers.length > 0);

  const failed = browserHarness(stored);
  failed.responses.push({ status:401, body:{ error_code:'invalid_grant', message:'RAW' } });
  failed.auth.init();
  assert.equal(failed.auth.getSession(), null);
  assert.equal(failed.storage.has('market-workbench.auth.session.v1'), false);
});

test('logout clears local Session even when remote response is empty', () => {
  const h = browserHarness();
  h.responses.push({ status:200, body:{ access_token:'access-1', refresh_token:'refresh-1', expires_in:3600 } });
  h.auth.signIn('trader@example.com', 'private-password', function () {});
  h.responses.push({ status:204 });
  h.auth.signOut(function () {});
  assert.equal(h.auth.getSession(), null);
  assert.equal(h.storage.has('market-workbench.auth.session.v1'), false);
});

test('signup remains unauthenticated and masks an existing address', () => {
  const h = browserHarness();
  let result;
  h.responses.push({ status:200, body:{ user:{ id:'masked', identities:[] } } });
  h.auth.signUp('existing@example.com', 'safe-password', function (error, value) { result = { error, value }; });
  assert.equal(result.error, null);
  assert.equal(result.value.requiresEmailVerification, true);
  assert.equal(h.auth.getSession(), null);
});

test('password reset uses a generic success result', () => {
  const h = browserHarness();
  let result = 'pending';
  h.responses.push({ status:200, body:{} });
  h.auth.resetPasswordForEmail('trader@example.com', function (error) { result = error; });
  assert.equal(result, null);
  assert.equal(h.requests[0].url, 'https://test.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fproduction.example.com%2F');
});

test('recovery callback removes URL credentials and never persists recovery token', () => {
  const h = browserHarness(null, '#access_token=recovery-token&refresh_token=unused&type=recovery');
  h.auth.init();
  assert.equal(h.location.hash, '');
  assert.equal(h.location.replacedWith, '/');
  assert.equal(h.storage.size, 0);
  h.responses.push({ status:200, body:{ user:{ id:'user-1' } } });
  h.auth.updatePassword('new-safe-password', function () {});
  assert.equal(h.requests[0].headers.Authorization, 'Bearer recovery-token');
  assert.equal(h.storage.size, 0);
});

test('Auth errors and persisted Session do not expose upstream text or password', () => {
  const h = browserHarness();
  let result;
  h.responses.push({ status:400, body:{ error_code:'email_not_confirmed', message:'RAW_UPSTREAM' } });
  h.auth.signIn('trader@example.com', 'private-password', function (error) { result = error; });
  assert.equal(result.message, '邮箱尚未验证，请先完成邮箱验证');
  assert.doesNotMatch(result.message, /RAW_UPSTREAM|private-password|test\.supabase\.co/);

  const success = browserHarness();
  success.responses.push({ status:200, body:{ access_token:'access-1', refresh_token:'refresh-1', expires_in:3600, user:{ id:'user-1' } } });
  success.auth.signIn('trader@example.com', 'private-password', function () {});
  assert.doesNotMatch(success.storage.get('market-workbench.auth.session.v1'), /private-password/);
  assert.doesNotMatch(source, /console\.(?:log|debug|info)\s*\(/);
});
