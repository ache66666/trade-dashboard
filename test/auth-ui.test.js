'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'public/auth.js'), 'utf8');
const authUi = fs.readFileSync(path.join(root, 'public/auth-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/auth.css'), 'utf8');

test('Auth Widget contains the complete standalone account lifecycle UI', () => {
  for (const id of ['authLoginForm', 'authSignupForm', 'authResetForm', 'authRecoveryForm', 'authSignupSuccess', 'authSession', 'authLogoutBtn']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /验证邮件将发送至该邮箱/);
  assert.match(html, /忘记密码？/);
  assert.match(html, /退出登录/);
});

test('Auth UI validates input and prevents duplicate actions', () => {
  assert.match(html, /id="authSignupEmail"[^>]+type="email"/);
  assert.match(html, /id="authSignupPassword"[^>]+minlength="8"/);
  assert.match(html, /id="authSignupConfirm"[^>]+minlength="8"/);
  assert.match(authUi, /password\.length < 8/);
  assert.match(authUi, /两次输入的密码不一致/);
  assert.match(authUi, /authActionInFlight/);
  assert.match(authUi, /authClient\.updatePassword\(password/);
});

test('Auth frontend remains ES5 plus XMLHttpRequest', () => {
  const combined = auth + '\n' + authUi;
  assert.doesNotMatch(combined, /\b(?:const|let)\b|=>|\bfetch\s*\(|\bPromise\b|\.at\s*\(|\?\./);
  assert.match(auth, /new XMLHttpRequest\(\)/);
  assert.doesNotMatch(app, /\/api\/auth\/me|marketAuth|Authorization/);
});

test('Auth Widget is independent from Journal and Market Overview rendering', () => {
  const combined = auth + '\n' + authUi;
  assert.doesNotMatch(combined, /journal|data-page|data-go|renderOverview|renderAll/i);
  assert.match(html, /<script src="auth\.js[^>]+><\/script><script src="auth-ui\.js/);
});

test('Auth styling covers status, disabled actions and mobile layout', () => {
  assert.match(css, /auth-error/);
  assert.match(css, /auth-success-message/);
  assert.match(css, /:disabled/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
