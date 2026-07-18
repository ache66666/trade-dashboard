'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSupabaseDataClient, isForbiddenAdminKey } = require('../supabase-data');

const config = { supabaseUrl:'https://test.supabase.co', supabasePublishableKey:'test-publishable-key' };
function response(status, body) { return { ok:status >= 200 && status < 300, status, json:async function () { return body; } }; }

test('Data API forwards only the verified token and publishable key', async () => {
  const calls = [];
  const client = createSupabaseDataClient({ config, fetchImpl:async function (url, options) { calls.push({ url, options }); return response(200, []); } });
  await client.getDailyNote('2026-07-15', 'verified-user-id', 'verified-user-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.apikey, 'test-publishable-key');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer verified-user-token');
  assert.equal(new URL(calls[0].url).searchParams.get('user_id'), 'eq.verified-user-id');
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['Accept','Authorization','apikey'].sort());
});

test('Journal upsert ignores a client user_id and targets the composite key', async () => {
  let sentBody;
  let sentUrl;
  const client = createSupabaseDataClient({ config, fetchImpl:async function (url, options) { sentUrl = url; sentBody = JSON.parse(options.body); return response(200, [sentBody]); } });
  await client.upsertDailyNote('2026-07-15', { user_id:'attacker', thesis:'test', summary:'test', supporting_evidence:[], opposing_evidence:[], watchlist:[] }, 'verified-user-id', 'verified-token');
  assert.equal(sentBody.user_id, 'verified-user-id');
  assert.equal(new URL(sentUrl).searchParams.get('on_conflict'), 'user_id,note_date');
});

test('Journal delete is restricted by verified user and date', async () => {
  let call;
  const client = createSupabaseDataClient({ config, fetchImpl:async function (url, options) { call = { url, options }; return response(204); } });
  await client.deleteDailyNote('2098-12-31', 'verified-user-id', 'verified-token');
  const url = new URL(call.url);
  assert.equal(call.options.method, 'DELETE');
  assert.equal(url.searchParams.get('user_id'), 'eq.verified-user-id');
  assert.equal(url.searchParams.get('note_date'), 'eq.2098-12-31');
  assert.equal(call.options.headers.Authorization, 'Bearer verified-token');
});

test('Data API failures are sanitized', async () => {
  const client = createSupabaseDataClient({ config, fetchImpl:async function () { return response(500, { message:'UPSTREAM_SECRET_MARKER' }); } });
  await assert.rejects(client.getDailyNote('2026-07-15', 'user-id', 'token'), error => error.code === 'DATA_API_UNAVAILABLE' && !/UPSTREAM_SECRET_MARKER/.test(error.message));
});

test('administrative keys are rejected before network access', async () => {
  let calls = 0;
  const role = Buffer.from(JSON.stringify({ role:'service_role' })).toString('base64url');
  assert.equal(isForbiddenAdminKey('sb_secret_example'), true);
  assert.equal(isForbiddenAdminKey(`header.${role}.signature`), true);
  const client = createSupabaseDataClient({ config:{ supabaseUrl:config.supabaseUrl, supabasePublishableKey:'sb_secret_example' }, fetchImpl:async function () { calls += 1; return response(200, []); } });
  await assert.rejects(client.getDailyNote('2026-07-15', 'user-id', 'token'), /Journal data service unavailable/);
  assert.equal(calls, 0);
});

test('missing Data API configuration fails lazily', async () => {
  let calls = 0;
  const client = createSupabaseDataClient({ config:{ supabaseUrl:'', supabasePublishableKey:'' }, fetchImpl:async function () { calls += 1; return response(200, []); } });
  await assert.rejects(client.getDailyNote('2026-07-15', 'user-id', 'token'), /Journal data service unavailable/);
  assert.equal(calls, 0);
});
