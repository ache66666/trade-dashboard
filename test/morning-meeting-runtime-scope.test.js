'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const dataApi = fs.readFileSync(path.join(root, 'supabase-data.js'), 'utf8');

test('Morning Meeting authentication precedes body parsing and private data access', () => {
  const route = server.indexOf('if (isMorningMeetingRequest(req, url))');
  const auth = server.indexOf('await requireAuth(req, res', route);
  const parseBody = server.indexOf('input = await body(req)', route);
  const dataRead = server.indexOf('journalData.listMorningMeetings', route);
  assert.ok(route >= 0 && auth > route);
  assert.ok(parseBody > auth);
  assert.ok(dataRead > auth);
});

test('Morning Meeting runtime cannot use native pg or caller-supplied headers', () => {
  const sectionStart = dataApi.indexOf('function listMorningMeetings');
  const section = dataApi.slice(sectionStart);
  assert.doesNotMatch(section, /require\(['"]\.\/database['"]\)|DATABASE_URL|getPool/);
  assert.doesNotMatch(section, /requestOptions\.headers|options\.headers/);
  assert.match(dataApi, /Authorization:`Bearer \$\{token\}`/);
  assert.match(dataApi, /apikey:config\.supabasePublishableKey/);
});

test('no cross-user or public listing routes are introduced', () => {
  assert.doesNotMatch(server, /morning-meetings\/all|users\/:id\/meetings|screenshots\/public/);
  assert.doesNotMatch(server, /req\.(?:body|query)\.user_id|headers\[['"]x-user-id['"]\]/i);
});

test('missing or foreign records use a generic not-found response', () => {
  assert.match(server, /\{error:'Morning Meeting not found'\}/);
  assert.doesNotMatch(server, /belongs to another user|other user|foreign owner/i);
});

test('analysis and image routes authenticate before body, storage, or model access', () => {
  const route = server.indexOf('if (isMorningMeetingRequest(req, url))');
  const auth = server.indexOf('await requireAuth(req, res', route);
  const imageRoute = server.indexOf('if (imageContent)', auth);
  const analysisRoute = server.indexOf('if (analysisMeetingId)', imageRoute);
  assert.ok(auth > route && imageRoute > auth && analysisRoute > auth);
  assert.ok(server.indexOf('await binaryBody(req', imageRoute) > auth);
  assert.ok(server.indexOf('await body(req)', analysisRoute) > auth);
  assert.ok(server.indexOf('morningAnalysis.analyze', analysisRoute) > auth);
});

test('analysis runtime never writes public market or Journal data', () => {
  const start = server.indexOf('if (analysisMeetingId)');
  const end = server.indexOf("if (req.method === 'GET' && !meetingId)", start);
  const section = server.slice(start, end);
  assert.doesNotMatch(section, /updateMarket|indicators|macro_events|daily_market_notes|journalData\.upsertDailyNote/);
  assert.doesNotMatch(section, /req\.(?:body|query)\.user_id|x-user-id/i);
});
