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

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
}

test('Batch 2 contains Auth only and excludes Journal, Data API, migrations and seed tools', () => {
  const combined = server + '\n' + html + '\n' + authServer + '\n' + authClient + '\n' + authUi;
  assert.doesNotMatch(combined, /\/api\/journal|daily_market_notes|supabase-data|service[_ -]?role|sb_secret_/i);
  assert.doesNotMatch(html, /data-page="journal"|data-go="journal"|id="journal|journal\.(?:js|css)/i);
  for (const file of [
    'journal.js',
    'supabase-data.js',
    'public/journal.js',
    'public/journal.css',
    'sql/002_daily_market_notes.sql',
    'sql/003_daily_market_notes_user_rls.sql'
  ]) assert.equal(fs.existsSync(path.join(root, file)), false, file);
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

test('Batch 2 leaves the Market Overview loader and Production workflow byte-for-byte unchanged', () => {
  assert.equal(sha256('public/app.js'), 'f2e1d164fac2d744fba491e898aa3a4f93b8ef11bd8b666b72b4b379d49bf331');
  assert.equal(sha256('.github/workflows/production.yml'), 'f4516014027cd197ed754bf1d29744588791e0c4f3d01860d4a31372ee3b3b2e');
});
