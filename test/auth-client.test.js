'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../public/auth.js'), 'utf8');

function browserHarness(storedSession) {
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
    setTimeout:function (fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout:function () {}
  };
  const context = { window, XMLHttpRequest:FakeXhr };
  vm.runInNewContext(source, context, { filename:'public/auth.js' });
  return { auth:window.marketAuth, responses, requests, storage, timers };
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
