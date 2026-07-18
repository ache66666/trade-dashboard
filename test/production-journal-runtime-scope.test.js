'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const dataApi = fs.readFileSync(path.join(root, 'supabase-data.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public', 'journal.js'), 'utf8');

test('Journal authentication precedes body parsing and Data API access', () => {
  const route = server.indexOf('if (isJournalRequest(req, url))');
  const auth = server.indexOf('await requireAuth(req, res', route);
  const parseBody = server.indexOf('await body(req)', route);
  const dataRead = server.indexOf('journalData.getDailyNote', route);
  assert.ok(route >= 0 && auth > route);
  assert.ok(parseBody > auth);
  assert.ok(dataRead > auth);
});

test('Journal Data API cannot import the native database or accept arbitrary headers', () => {
  assert.doesNotMatch(dataApi, /require\(['"]\.\/database['"]\)|DATABASE_URL|getPool|\bquery\s*\(/);
  assert.doesNotMatch(dataApi, /requestOptions\.headers|options\.headers/);
  assert.match(dataApi, /Authorization:`Bearer \$\{token\}`/);
  assert.match(dataApi, /apikey:config\.supabasePublishableKey/);
  assert.match(dataApi, /isForbiddenAdminKey/);
});

test('Journal browser calls only Node API and cannot submit user identity', () => {
  assert.match(client, /\/api\/journal\//);
  assert.doesNotMatch(client, /\/rest\/v1\/|supabaseUrl|supabasePublishableKey|user_id/);
  assert.match(client, /getAccessToken/);
});

test('Production Editor deny gate remains ahead of Journal routing', () => {
  const editorGate = server.indexOf('isEditorWriteRequest(req, url) && !config.editorWriteEnabled');
  const journalRoute = server.indexOf('if (isJournalRequest(req, url))');
  assert.ok(editorGate >= 0 && journalRoute > editorGate);
});
