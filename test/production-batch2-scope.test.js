'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const authServer = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
const authClient = fs.readFileSync(path.join(root, 'public/auth.js'), 'utf8');
const authUi = fs.readFileSync(path.join(root, 'public/auth-ui.js'), 'utf8');

function normalizeLineEndings(content) {
  return content.replace(/\r\n?/g, '\n');
}

function normalizedSha256(content) {
  return crypto.createHash('sha256').update(normalizeLineEndings(content), 'utf8').digest('hex');
}

function sha256(file) {
  return normalizedSha256(fs.readFileSync(path.join(root, file), 'utf8'));
}

test('Auth modules remain independent after Journal Runtime is added', () => {
  const combined = authServer + '\n' + authClient + '\n' + authUi;
  assert.doesNotMatch(combined, /\/api\/journal|daily_market_notes|supabase-data|service[_ -]?role|sb_secret_/i);
  assert.match(server, /\/api\/auth\/me/);
});

test('Auth server module cannot import or query the database', () => {
  assert.doesNotMatch(authServer, /require\(['"]\.\/database['"]\)|getPool|\bquery\s*\(|postgres|DATABASE_URL/i);
  assert.match(server, /\/api\/auth\/me/);
});

test('Production Editor deny gate remains before Auth routing', () => {
  const gate = server.indexOf('isEditorWriteRequest(req, url) && !config.editorWriteEnabled');
  const authRoute = server.indexOf("url.pathname === '/api/auth/me'");
  assert.ok(gate >= 0 && authRoute > gate);
  assert.match(server.slice(gate, authRoute), /Public data editing is currently disabled/);
});

test('public GET routes remain anonymous and Market Overview app has no Auth coupling', () => {
  for (const route of ['/api/health', '/api/dashboard', '/api/dashboard-compat', '/api/indicators', '/api/events']) {
    assert.match(server, new RegExp(route.replace(/\//g, '\\/')));
  }
  assert.doesNotMatch(app, /marketAuth|Authorization|\/api\/auth/i);
});

test('Batch 2 frontend uses XHR and injects only public Auth configuration', () => {
  assert.match(authClient, /new XMLHttpRequest\(\)/);
  assert.doesNotMatch(authClient + '\n' + authUi, /\bfetch\s*\(|\bPromise\b|=>|\b(?:const|let)\b|\?\./);
  assert.match(html, /supabasePublishableKey:__SUPABASE_PUBLISHABLE_KEY_JSON__/);
  assert.doesNotMatch(html, /service[_ -]?role|sb_secret_|DATABASE_URL/i);
});

test('normalized hashing is stable across LF, CRLF and CR line endings', () => {
  const lf = 'first line\nsecond line\n';
  const crlf = 'first line\r\nsecond line\r\n';
  const cr = 'first line\rsecond line\r';
  assert.equal(normalizedSha256(lf), normalizedSha256(crlf));
  assert.equal(normalizedSha256(lf), normalizedSha256(cr));
});

test('later Runtime batches leave the Production workflow content unchanged', () => {
  assert.equal(sha256('.github/workflows/production.yml'), '1b07d59363afeb7412f28505d746fd629f6de40054bb4e2238345bcba115b7d8');
});
