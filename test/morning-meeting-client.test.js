'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'public', 'morning.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'public', 'service-worker.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));

test('Morning client remains ES5 and XMLHttpRequest compatible', () => {
  assert.match(client, /new XMLHttpRequest\(\)/);
  assert.doesNotMatch(client, /\bfetch\s*\(/);
  assert.doesNotMatch(client, /\b(?:const|let)\s+/);
  assert.doesNotMatch(client, /\basync\b|\bawait\b|\bPromise\b|=>|\.at\s*\(/);
});

test('Morning client uses only Node API and never submits user identity', () => {
  assert.match(client, /\/api\/morning-meetings/);
  assert.match(client, /setRequestHeader\('Authorization', 'Bearer ' \+ token\)/);
  assert.doesNotMatch(client, /user_id|\/rest\/v1\/|service_role|sb_secret_/i);
});

test('Morning upload UX supports multiple safe image types and private messaging', () => {
  assert.match(html, /id="morningScreenshots"[^>]+accept="image\/jpeg,image\/png,image\/webp"[^>]+multiple/);
  assert.match(html, /Private: only you can access your screenshots and notes/);
  assert.match(html, /截图文件.*不永久|not permanently saved/i);
  assert.doesNotMatch(html, />\s*(?:Share|Publish|Community|Copy public link)\s*</i);
  assert.match(client, /FileReader/);
  assert.match(client, /bytesMatch/);
  assert.match(client, /window\.URL\.revokeObjectURL/);
});

test('PWA manifest is installable and identifies Market Coach', () => {
  assert.equal(manifest.name, 'Market Coach');
  assert.equal(manifest.short_name, 'Market Coach');
  assert.equal(manifest.display, 'standalone');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
});

test('Service Worker caches only an explicit static allow-list', () => {
  assert.match(worker, /STATIC_PATHS\.indexOf\(url\.pathname\) < 0/);
  assert.match(worker, /request\.headers\.has\('Authorization'\)/);
  assert.doesNotMatch(worker, /\/api\/|screenshots|signed[_ -]?url/i);
  assert.doesNotMatch(worker, /caches\.match\(request\).*fetch\(request\)/s);
});

test('Morning navigation is first while Markets and existing Journal remain available', () => {
  const morning = html.indexOf('data-page="morning"');
  const journal = html.indexOf('data-page="journal"');
  const markets = html.indexOf('data-page="overview"');
  assert.ok(morning >= 0 && journal > morning && markets > journal);
  assert.match(html, /id="overview"/);
  assert.match(html, /id="journal"/);
});
