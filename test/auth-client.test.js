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
    __APP_CONFIG__:{
      authConfigured:true,
      supabaseUrl:'https://test.supabase.co',
      supabasePublishableKey:'test-publishable-key'
    },
    localStorage:{
      getItem:key => storage.has(key) ? storage.get(key) : null,
      setItem:(key, value) => storage.set(key, value),
      removeItem:key => storage.delete(key)
    },
    location:{ origin:'https://staging.example.com', pathname:'/', search:'', hash:locationHash || '' },
    history:{ replaceState:function (state, title, url) { window.location.hash = ''; window.location.replacedWith = url; } },
    document:{ title:'Market Workbench' },
    setTimeout:function (fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout:function () {}
  };
  const context = { window, XMLHttpRequest:FakeXhr };
  vm.runInNewContext(source, context, { filename:'public/auth.js' });
  return { auth:window.marketAuth, responses, requests, storage, timers, location:window.location };
}

test('ES5 client logs in and verifies the current user through Node API', () => {
  const harness = browserHarness();
  let signInResult;
  let currentUserResult;
  harness.auth.init();
  harness.responses.push({ status:200, body:{
    access_token:'access-1', refresh_token:'refresh-1', expires_in:3600,
    user:{ id:'user-1', email:'trader@example.com' }
  } });
  harness.auth.signIn('trader@example.com', 'password', function (error, result) {
    signInResult = { error, result };
  });
  assert.equal(signInResult.error, null);
  assert.equal(harness.requests[0].url, 'https://test.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(harness.requests[0].headers.apikey, 'test-publishable-key');
  assert.deepEqual(JSON.parse(harness.requests[0].body), { email:'trader@example.com', password:'password' });

  harness.responses.push({ status:200, body:{ id:'user-1', email:'trader@example.com' } });
  harness.auth.currentUser(function (error, user) { currentUserResult = { error, user }; });
  assert.equal(currentUserResult.error, null);
  assert.equal(currentUserResult.user.email, 'trader@example.com');
  assert.equal(harness.requests[1].url, '/api/auth/me');
  assert.equal(harness.requests[1].headers.Authorization, 'Bearer access-1');
});

test('ES5 client restores an expired Session and refreshes its Token', () => {
  const harness = browserHarness({
    access_token:'expired-access',
    refresh_token:'refresh-1',
    expires_at:1,
    user:{ id:'user-1', email:'trader@example.com' }
  });
  harness.responses.push({ status:200, body:{
    access_token:'access-2', refresh_token:'refresh-2', expires_in:3600,
    user:{ id:'user-1', email:'trader@example.com' }
  } });
  harness.auth.init();
  assert.equal(harness.requests[0].url, 'https://test.supabase.co/auth/v1/token?grant_type=refresh_token');
  assert.deepEqual(JSON.parse(harness.requests[0].body), { refresh_token:'refresh-1' });
  assert.equal(harness.auth.getSession().access_token, 'access-2');
  assert.ok(harness.timers.length > 0);
});

test('ES5 client attaches a valid Bearer Token to API XHR', () => {
  const harness = browserHarness();
  const apiXhr = {};
  let sent = false;
  harness.responses.push({ status:200, body:{ access_token:'access-1', refresh_token:'refresh-1', expires_in:3600 } });
  harness.auth.signIn('trader@example.com', 'password', function () {});
  apiXhr.headers = {};
  apiXhr.setRequestHeader = function (name, value) { this.headers[name] = value; };
  apiXhr.send = function (body) { this.body = body; sent = true; };
  harness.auth.send(apiXhr, null);
  assert.equal(sent, true);
  assert.equal(apiXhr.headers.Authorization, 'Bearer access-1');
});

test('ES5 client logout clears the local Session even if the remote response is empty', () => {
  const harness = browserHarness();
  harness.responses.push({ status:200, body:{ access_token:'access-1', refresh_token:'refresh-1', expires_in:3600 } });
  harness.auth.signIn('trader@example.com', 'password', function () {});
  harness.responses.push({ status:204 });
  harness.auth.signOut(function () {});
  assert.equal(harness.auth.getSession(), null);
  assert.equal(harness.storage.has('market-workbench.auth.session.v1'), false);
  assert.equal(harness.requests[1].url, 'https://test.supabase.co/auth/v1/logout');
});

test('ES5 client registers through Supabase Auth without creating a local Session', () => {
  const harness = browserHarness();
  let result;
  harness.auth.init();
  harness.responses.push({ status:200, body:{ user:{ id:'pending-user', email:'new@example.com', identities:[{ id:'identity-1' }] }, session:null } });
  harness.auth.signUp('new@example.com', 'safe-password', function (error, value) { result = { error, value }; });
  assert.equal(result.error, null);
  assert.equal(result.value.requiresEmailVerification, true);
  assert.equal(harness.requests[0].url, 'https://test.supabase.co/auth/v1/signup?redirect_to=https%3A%2F%2Fstaging.example.com%2F');
  assert.deepEqual(JSON.parse(harness.requests[0].body), { email:'new@example.com', password:'safe-password' });
  assert.equal(harness.auth.getSession(), null);
  assert.equal(harness.storage.has('market-workbench.auth.session.v1'), false);
});

test('ES5 client does not reveal whether a registration email already exists', () => {
  const harness = browserHarness();
  let result;
  harness.responses.push({ status:200, body:{ user:{ id:'masked-user', identities:[] } } });
  harness.auth.signUp('existing@example.com', 'safe-password', function (error, value) { result = { error, value }; });
  assert.equal(result.error, null);
  assert.equal(result.value.requiresEmailVerification, true);
  assert.equal(harness.auth.getSession(), null);
});

test('ES5 client requests a reset email without exposing account existence', () => {
  const harness = browserHarness();
  let result = 'pending';
  harness.responses.push({ status:200, body:{} });
  harness.auth.resetPasswordForEmail('trader@example.com', function (error) { result = error; });
  assert.equal(result, null);
  assert.equal(harness.requests[0].url, 'https://test.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fstaging.example.com%2F');
  assert.deepEqual(JSON.parse(harness.requests[0].body), { email:'trader@example.com' });
});

test('Recovery callback strips tokens from the URL and updates the password without persisting a Session', () => {
  const harness = browserHarness(null, '#access_token=recovery-token&refresh_token=unused&type=recovery');
  let result;
  harness.auth.init();
  assert.equal(harness.location.hash, '');
  assert.equal(harness.location.replacedWith, '/');
  assert.equal(harness.storage.has('market-workbench.auth.session.v1'), false);
  assert.equal(harness.auth.getSession(), null);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.storage.size, 0);
  assert.equal(harness.auth.getSession(), null);
  harness.responses.push({ status:200, body:{ user:{ id:'user-1' } } });
  harness.auth.updatePassword('new-safe-password', function (error) { result = error; });
  assert.equal(result, null);
  assert.equal(harness.requests[0].method, 'PUT');
  assert.equal(harness.requests[0].url, 'https://test.supabase.co/auth/v1/user');
  assert.equal(harness.requests[0].headers.Authorization, 'Bearer recovery-token');
  assert.deepEqual(JSON.parse(harness.requests[0].body), { password:'new-safe-password' });
  assert.equal(harness.auth.getSession(), null);
  assert.equal(harness.storage.has('market-workbench.auth.session.v1'), false);
});

test('Auth errors are mapped without exposing the upstream response or credentials', () => {
  const harness = browserHarness();
  let result;
  harness.responses.push({ status:400, body:{ error_code:'email_not_confirmed', msg:'RAW_UPSTREAM_DETAIL' } });
  harness.auth.signIn('trader@example.com', 'private-password', function (error) { result = error; });
  assert.equal(result.message, '邮箱尚未验证，请先完成邮箱验证');
  assert.doesNotMatch(result.message, /RAW_UPSTREAM_DETAIL|private-password|test\.supabase\.co/);
  assert.doesNotMatch(source, /console\.(?:log|debug|info)\s*\(/);
});

test('Persisted Session never contains the submitted password', () => {
  const harness = browserHarness();
  harness.responses.push({ status:200, body:{ access_token:'access-1', refresh_token:'refresh-1', expires_in:3600, user:{ id:'user-1', email:'trader@example.com' } } });
  harness.auth.signIn('trader@example.com', 'private-password', function () {});
  const persisted = harness.storage.get('market-workbench.auth.session.v1');
  assert.ok(persisted);
  assert.doesNotMatch(persisted, /private-password/);
});
