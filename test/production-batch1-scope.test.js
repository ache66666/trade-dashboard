'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

test('Production Batch 1 remains free of Journal routes and resources after Auth Batch 2', () => {
  const combined = server + '\n' + html + '\n' + app;
  assert.doesNotMatch(combined, /\/api\/journal/);
  assert.doesNotMatch(html, /journal\.(?:js|css)/i);
  assert.doesNotMatch(html, /data-page="journal"|data-go="journal"/i);
  assert.equal(fs.existsSync(path.join(root, 'journal.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'public/journal.js')), false);
});

test('Production Batch 1 keeps the public dashboard APIs and Editor deny-list', () => {
  for (const route of ['/api/dashboard', '/api/dashboard-compat', '/api/indicators', '/api/events']) {
    assert.match(server, new RegExp(route.replace(/\//g, '\\/')));
  }
  assert.match(server, /isEditorWriteRequest\(req, url\) && !config\.editorWriteEnabled/);
  assert.match(server, /Public data editing is currently disabled/);
});
