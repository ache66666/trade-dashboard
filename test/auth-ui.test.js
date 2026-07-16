'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'public/auth.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/auth.css'), 'utf8');

test('Auth UI exposes login, signup, verification, reset and authenticated states', () => {
  for (const id of ['authLoginForm', 'authSignupForm', 'authResetForm', 'authRecoveryForm', 'authSignupSuccess', 'authSession', 'authLogoutBtn']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /验证邮件将发送至该邮箱/);
  assert.match(html, /忘记密码？/);
  assert.match(html, /退出登录/);
});

test('Signup fields enforce email, password and confirmation input contracts', () => {
  assert.match(html, /id="authSignupEmail"[^>]+type="email"/);
  assert.match(html, /id="authSignupPassword"[^>]+minlength="8"/);
  assert.match(html, /id="authSignupConfirm"[^>]+minlength="8"/);
  assert.match(app, /password\.length < 8/);
  assert.match(app, /两次输入的密码不一致/);
  assert.match(app, /authActionInFlight/);
  assert.match(app, /authClient\.updatePassword\(password/);
});

test('Auth UI keeps the ES5 and XMLHttpRequest compatibility path', () => {
  assert.doesNotMatch(auth, /\b(?:const|let)\b|=>|\bfetch\s*\(|\bPromise\b|\.at\s*\(/);
  assert.match(auth, /new XMLHttpRequest\(\)/);
  assert.doesNotMatch(app, /\b(?:const|let)\b|=>|\bfetch\s*\(|\bPromise\b|\.at\s*\(/);
});

test('Logout hides Journal access and Journal navigation is guarded by Session', () => {
  assert.match(html, /id="journalNav"[^>]+hidden/);
  assert.match(app, /journalNav\.hidden = false/);
  assert.match(app, /journalNav\.hidden = true/);
  assert.match(app, /page === 'journal' && \(!authClient \|\| !authClient\.getSession\(\)\)/);
});

test('Auth status styles cover errors, success, loading and all target viewports', () => {
  assert.match(css, /auth-error/);
  assert.match(css, /auth-success-message/);
  assert.match(css, /:disabled/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
