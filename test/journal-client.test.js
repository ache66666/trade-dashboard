'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'journal.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('Journal browser runtime preserves ES5 and XMLHttpRequest compatibility', () => {
  assert.match(client, /new XMLHttpRequest\(\)/);
  assert.doesNotMatch(client, /\bfetch\s*\(/);
  assert.doesNotMatch(client, /\b(?:const|let)\s+/);
  assert.doesNotMatch(client, /\basync\b|\bawait\b|\bPromise\b|=>|\.at\s*\(/);
});

test('Journal browser runtime obtains a token and never sends user_id', () => {
  assert.match(client, /getAccessToken/);
  assert.match(client, /setRequestHeader\('Authorization', 'Bearer ' \+ token\)/);
  assert.doesNotMatch(client, /user_id/);
  assert.doesNotMatch(client, /\/rest\/v1\//);
});

test('Journal UI is hidden by default and loaded after Auth and app runtime', () => {
  assert.match(html, /id="journalNav"[^>]*hidden/);
  assert.match(html, /id="journalOverviewLink"[^>]*hidden/);
  assert.ok(html.indexOf('auth.js?') < html.indexOf('app.js?'));
  assert.ok(html.indexOf('app.js?') < html.indexOf('journal.js?'));
});
