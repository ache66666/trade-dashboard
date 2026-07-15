'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSupabaseDataClient, isForbiddenAdminKey } = require('../supabase-data');

const config = {
  supabaseUrl:'https://test.supabase.co',
  supabasePublishableKey:'test-publishable-key'
};

function response(status, body) {
  return {
    ok:status >= 200 && status < 300,
    status,
    json:async function () { return body; }
  };
}

test('Data API forwards the verified user token and publishable key', async () => {
  const calls = [];
  const client = createSupabaseDataClient({
    config,
    fetchImpl:async function (url, options) {
      calls.push({ url, options });
      return response(200, []);
    }
  });

  await client.getDailyNote('2026-07-15', 'verified-user-token');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/test\.supabase\.co\/rest\/v1\/daily_market_notes\?/);
  assert.equal(calls[0].options.headers.apikey, 'test-publishable-key');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer verified-user-token');
});

test('Journal upsert never forwards a client-supplied user_id', async () => {
  let sentBody;
  let sentHeaders;
  const client = createSupabaseDataClient({
    config,
    fetchImpl:async function (url, options) {
      sentBody = JSON.parse(options.body);
      sentHeaders = options.headers;
      return response(200, [sentBody]);
    }
  });
  await client.upsertDailyNote('2026-07-15', {
    user_id:'attacker-selected-user',
    thesis:'test',
    summary:'test',
    supporting_evidence:[],
    opposing_evidence:[],
    watchlist:[]
  }, 'verified-user-token');
  assert.equal(Object.hasOwn(sentBody, 'user_id'), false);
  assert.equal(sentHeaders.Authorization, 'Bearer verified-user-token');
  assert.equal(sentHeaders.apikey, 'test-publishable-key');
  assert.equal(sentHeaders.Prefer, 'resolution=merge-duplicates,return=representation');
});

test('Data API failures are sanitized and do not expose upstream content', async () => {
  const client = createSupabaseDataClient({
    config,
    fetchImpl:async function () {
      return response(500, { message:'UPSTREAM_SECRET_MARKER' });
    }
  });
  await assert.rejects(
    client.getDailyNote('2026-07-15', 'verified-user-token'),
    error => error.code === 'DATA_API_UNAVAILABLE' && !/UPSTREAM_SECRET_MARKER/.test(error.message)
  );
});

test('known Supabase administrative keys are rejected before network access', async () => {
  let calls = 0;
  const serviceRolePayload = Buffer.from(JSON.stringify({ role:'service_role' })).toString('base64url');
  assert.equal(isForbiddenAdminKey('sb_secret_example'), true);
  assert.equal(isForbiddenAdminKey(`header.${serviceRolePayload}.signature`), true);
  const client = createSupabaseDataClient({
    config:{ supabaseUrl:config.supabaseUrl, supabasePublishableKey:'sb_secret_example' },
    fetchImpl:async function () { calls += 1; return response(200, []); }
  });
  await assert.rejects(client.getDailyNote('2026-07-15', 'token'), /Journal data service unavailable/);
  assert.equal(calls, 0);
});

test('missing Data API configuration fails lazily so public routes can still start', async () => {
  let calls = 0;
  const client = createSupabaseDataClient({
    config:{ supabaseUrl:'', supabasePublishableKey:'' },
    fetchImpl:async function () { calls += 1; return response(200, []); }
  });
  await assert.rejects(client.getDailyNote('2026-07-15', 'token'), /Journal data service unavailable/);
  assert.equal(calls, 0);
});
