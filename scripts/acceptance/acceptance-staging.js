'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isForbiddenAdminKey } = require('../../supabase-data');

const startedAt = Date.now();
const results = [];
let cleanup = null;

function loadLocalEnvironment() {
  const file = path.resolve(__dirname, '../../.env.staging.local');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) return;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeUrl(value, label) {
  let url;
  try { url = new URL(value); } catch (error) { throw new Error(`${label} is not a valid URL`); }
  assert(url.protocol === 'https:', `${label} must use HTTPS`);
  return url;
}

function validateEnvironment(environment) {
  const base = safeUrl(environment.STAGING_BASE_URL, 'STAGING_BASE_URL');
  const supabase = safeUrl(environment.SUPABASE_URL, 'SUPABASE_URL');
  assert(environment.APP_ENV === 'staging', 'APP_ENV must equal staging');
  assert(environment.STAGING_ACCEPTANCE_CONFIRM === 'staging', 'STAGING_ACCEPTANCE_CONFIRM must equal staging');
  assert(base.hostname !== 'trade-dashboard-kgof.onrender.com', 'Production application URL is forbidden');
  if (environment.PRODUCTION_BASE_URL) assert(base.origin !== safeUrl(environment.PRODUCTION_BASE_URL, 'PRODUCTION_BASE_URL').origin, 'Staging and Production URLs must differ');
  assert(/\.supabase\.co$/i.test(supabase.hostname), 'SUPABASE_URL must identify a Supabase project');
  assert(environment.SUPABASE_PUBLISHABLE_KEY && !isForbiddenAdminKey(environment.SUPABASE_PUBLISHABLE_KEY), 'A non-admin Publishable Key is required');
  assert(environment.JOURNAL_TEST_USER_A_EMAIL && environment.JOURNAL_TEST_USER_A_PASSWORD, 'User A credentials are required');
  assert(environment.JOURNAL_TEST_USER_B_EMAIL && environment.JOURNAL_TEST_USER_B_PASSWORD, 'User B credentials are required');
  assert(environment.JOURNAL_LEGACY_OWNER_USER_ID, 'JOURNAL_LEGACY_OWNER_USER_ID is required');
  return { base:base.origin, supabase:supabase.origin };
}

async function request(url, options) {
  const requestOptions = { ...(options || {}) };
  const controller = new AbortController();
  const timeoutMs = Number(requestOptions.timeoutMs || process.env.STAGING_ACCEPTANCE_TIMEOUT_MS || 30000);
  delete requestOptions.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try { response = await fetch(url, { ...requestOptions, signal:controller.signal }); }
  catch (error) { throw new Error('Network request failed or timed out'); }
  finally { clearTimeout(timer); }
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch (error) { throw new Error(`HTTP ${response.status} returned invalid JSON`); }
  }
  return { status:response.status, type:response.headers.get('content-type') || '', json };
}

async function step(name, operation) {
  const before = Date.now();
  try {
    await operation();
    results.push({ name, status:'PASS', duration:Date.now() - before });
  } catch (error) {
    results.push({ name, status:'FAIL', duration:Date.now() - before, error:error.message });
    throw error;
  }
}

function authHeaders(token, extra) {
  return { ...(extra || {}), Authorization:`Bearer ${token}` };
}

async function signIn(settings, email, password) {
  const result = await request(`${settings.supabase}/auth/v1/token?grant_type=password`, {
    method:'POST',
    headers:{ apikey:process.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type':'application/json' },
    body:JSON.stringify({ email, password })
  });
  assert(result.status === 200 && result.json && result.json.access_token && result.json.refresh_token, 'Staging test-user login failed');
  return result.json;
}

async function api(settings, pathname, options) {
  return request(`${settings.base}${pathname}`, options);
}

async function dataApi(settings, table, query, options) {
  return request(`${settings.supabase}/rest/v1/${table}?${query}`, {
    ...(options || {}),
    headers:{ apikey:process.env.SUPABASE_PUBLISHABLE_KEY, ...((options && options.headers) || {}) }
  });
}

function notePayload(symbol, marker) {
  return {
    thesis:'暂无明确主线',
    summary:`Staging acceptance ${marker}`,
    supporting_evidence:[{ symbol, note:'Staging automated acceptance evidence' }],
    opposing_evidence:[],
    watchlist:[{ title:'Staging acceptance watch', note:marker, status:'未验证' }]
  };
}

async function logout(settings, session) {
  return request(`${settings.supabase}/auth/v1/logout`, {
    method:'POST',
    headers:{ apikey:process.env.SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${session.access_token}` }
  });
}

async function run() {
  loadLocalEnvironment();
  const settings = validateEnvironment(process.env);
  let health;
  let indicators;
  let events;
  let userA;
  let userB;
  let aIdentity;
  let bIdentity;
  let legacyDate;
  let aNoteId;
  let bNoteId;

  await step('Environment: health is Staging and database is connected', async () => {
    const response = await api(settings, '/api/health', { timeoutMs:60000 });
    assert(response.status === 200, 'Health endpoint did not return HTTP 200');
    assert(response.json && response.json.status === 'ok' && response.json.environment === 'staging' && response.json.database === 'connected', 'Health contract does not identify a connected Staging instance');
    health = response.json;
  });

  await step('Auth: anonymous request is rejected with fixed JSON', async () => {
    const response = await api(settings, '/api/auth/me');
    assert(response.status === 401, 'Anonymous auth request did not return 401');
    assert(/^application\/json\b/i.test(response.type), 'Anonymous auth response is not JSON');
    assert(JSON.stringify(response.json) === JSON.stringify({ error:'Authentication required' }), 'Anonymous auth error contract changed');
  });

  await step('Auth: invalid Bearer is rejected with fixed JSON', async () => {
    const response = await api(settings, '/api/auth/me', { headers:{ Authorization:'Bearer invalid' } });
    assert(response.status === 401, 'Invalid Bearer request did not return 401');
    assert(/^application\/json\b/i.test(response.type), 'Invalid Bearer response is not JSON');
    assert(JSON.stringify(response.json) === JSON.stringify({ error:'Authentication required' }), 'Invalid Bearer error contract changed');
  });

  await step('Public data: Dashboard, Indicators and Events remain available', async () => {
    const [dashboardResponse, indicatorsResponse, eventsResponse] = await Promise.all([
      api(settings, '/api/dashboard'), api(settings, '/api/indicators'), api(settings, '/api/events')
    ]);
    assert(dashboardResponse.status === 200 && dashboardResponse.json, 'Dashboard is unavailable');
    assert(indicatorsResponse.status === 200 && Array.isArray(indicatorsResponse.json), 'Indicators are unavailable');
    assert(eventsResponse.status === 200 && Array.isArray(eventsResponse.json), 'Events are unavailable');
    indicators = indicatorsResponse.json;
    events = eventsResponse.json;
    const expectedIndicators = Number(process.env.STAGING_EXPECTED_INDICATORS || 10);
    const expectedEvents = Number(process.env.STAGING_EXPECTED_EVENTS || 2);
    assert(indicators.length === expectedIndicators, `Indicators count differs from expected ${expectedIndicators}`);
    assert(events.length === expectedEvents, `Events count differs from expected ${expectedEvents}`);
    assert(Array.isArray(dashboardResponse.json.indicators) && dashboardResponse.json.indicators.length === indicators.length, 'Dashboard indicators count is inconsistent');
    assert(Array.isArray(dashboardResponse.json.events) && dashboardResponse.json.events.length === events.length, 'Dashboard events count is inconsistent');
  });

  await step('Auth: User A and User B log in as distinct users', async () => {
    [userA, userB] = await Promise.all([
      signIn(settings, process.env.JOURNAL_TEST_USER_A_EMAIL, process.env.JOURNAL_TEST_USER_A_PASSWORD),
      signIn(settings, process.env.JOURNAL_TEST_USER_B_EMAIL, process.env.JOURNAL_TEST_USER_B_PASSWORD)
    ]);
    const [aResponse, bResponse] = await Promise.all([
      api(settings, '/api/auth/me', { headers:authHeaders(userA.access_token) }),
      api(settings, '/api/auth/me', { headers:authHeaders(userB.access_token) })
    ]);
    assert(aResponse.status === 200 && bResponse.status === 200, 'Authenticated identity endpoint failed');
    aIdentity = aResponse.json;
    bIdentity = bResponse.json;
    assert(aIdentity.id && bIdentity.id && aIdentity.id !== bIdentity.id, 'Test users are not distinct');
    assert(aIdentity.id === process.env.JOURNAL_LEGACY_OWNER_USER_ID, 'Legacy owner does not match User A');
  });

  await step('RLS: User B cannot read a User A legacy note', async () => {
    const dates = ['2026-07-14', '2026-07-15'];
    for (const date of dates) {
      const aResponse = await api(settings, `/api/journal/${date}`, { headers:authHeaders(userA.access_token) });
      if (aResponse.status === 200 && aResponse.json && aResponse.json.note) {
        legacyDate = date;
        aNoteId = aResponse.json.note.id;
        break;
      }
    }
    assert(legacyDate && aNoteId, 'User A legacy Journal baseline was not found');
    const bResponse = await api(settings, `/api/journal/${legacyDate}`, { headers:authHeaders(userB.access_token) });
    assert(bResponse.status === 200 && bResponse.json && bResponse.json.note === null, 'User B can see User A Journal data');
  });

  await step('Journal: User B creates, updates and reads one idempotent same-day note', async () => {
    const symbol = String(indicators[0] && indicators[0].symbol || '');
    assert(symbol, 'No indicator is available for Journal evidence');
    const createResponse = await api(settings, `/api/journal/${legacyDate}?user_id=${encodeURIComponent(aIdentity.id)}`, {
      method:'PUT',
      headers:authHeaders(userB.access_token, { 'Content-Type':'application/json', 'X-User-Id':aIdentity.id }),
      body:JSON.stringify({ ...notePayload(symbol, 'create'), user_id:aIdentity.id })
    });
    assert(createResponse.status === 200 && createResponse.json && createResponse.json.note, 'User B Journal create failed');
    bNoteId = createResponse.json.note.id;
    assert(createResponse.json.note.user_id === bIdentity.id, 'Client-supplied user_id affected ownership');
    cleanup = async () => dataApi(settings, 'daily_market_notes', `id=eq.${encodeURIComponent(bNoteId)}&user_id=eq.${encodeURIComponent(bIdentity.id)}&select=id`, {
      method:'DELETE', headers:authHeaders(userB.access_token, { Prefer:'return=representation' })
    });
    const updateResponse = await api(settings, `/api/journal/${legacyDate}`, {
      method:'PUT', headers:authHeaders(userB.access_token, { 'Content-Type':'application/json' }),
      body:JSON.stringify(notePayload(symbol, 'update'))
    });
    assert(updateResponse.status === 200 && updateResponse.json.note.id === bNoteId, 'Same-day Journal update was not idempotent');
    const readResponse = await api(settings, `/api/journal/${legacyDate}`, { headers:authHeaders(userB.access_token) });
    assert(readResponse.status === 200 && readResponse.json.note.id === bNoteId && /update$/.test(readResponse.json.note.summary), 'Updated Journal could not be read back');
  });

  await step('RLS: User B cannot update or delete User A through Data API', async () => {
    const filter = `id=eq.${encodeURIComponent(aNoteId)}&user_id=eq.${encodeURIComponent(aIdentity.id)}&select=id`;
    const updateResponse = await dataApi(settings, 'daily_market_notes', filter, {
      method:'PATCH',
      headers:authHeaders(userB.access_token, { 'Content-Type':'application/json', Prefer:'return=representation' }),
      body:JSON.stringify({ summary:'forbidden cross-user update' })
    });
    assert(updateResponse.status === 200 && Array.isArray(updateResponse.json) && updateResponse.json.length === 0, 'RLS did not block cross-user update');
    const deleteResponse = await dataApi(settings, 'daily_market_notes', filter, {
      method:'DELETE', headers:authHeaders(userB.access_token, { Prefer:'return=representation' })
    });
    assert(deleteResponse.status === 200 && Array.isArray(deleteResponse.json) && deleteResponse.json.length === 0, 'RLS did not block cross-user delete');
    const aResponse = await api(settings, `/api/journal/${legacyDate}`, { headers:authHeaders(userA.access_token) });
    assert(aResponse.status === 200 && aResponse.json.note && aResponse.json.note.id === aNoteId, 'User A note changed during RLS checks');
  });

  await step('Editor: public market-data writes remain disabled', async () => {
    const response = await api(settings, '/api/refresh', { method:'POST' });
    assert(response.status === 403, 'Editor write gate did not return 403');
    assert(JSON.stringify(response.json) === JSON.stringify({ error:'Public data editing is currently disabled' }), 'Editor error contract changed');
  });

  await step('Journal: temporary User B data is removed', async () => {
    const response = await cleanup();
    cleanup = null;
    assert(response.status === 200 && Array.isArray(response.json) && response.json.length === 1, 'Temporary Journal cleanup did not remove exactly one record');
    const readResponse = await api(settings, `/api/journal/${legacyDate}`, { headers:authHeaders(userB.access_token) });
    assert(readResponse.status === 200 && readResponse.json.note === null, 'Temporary Journal data remains after cleanup');
  });

  await step('Session: logout succeeds and refresh token can no longer restore User B', async () => {
    const logoutResponse = await logout(settings, userB);
    assert(logoutResponse.status === 204 || logoutResponse.status === 200, 'User B logout failed');
    const refreshResponse = await request(`${settings.supabase}/auth/v1/token?grant_type=refresh_token`, {
      method:'POST',
      headers:{ apikey:process.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type':'application/json' },
      body:JSON.stringify({ refresh_token:userB.refresh_token })
    });
    assert(refreshResponse.status === 400 || refreshResponse.status === 401, 'Logged-out Session refresh was not rejected');
    userB = null;
    await logout(settings, userA);
    userA = null;
  });

  return { health, indicatorCount:indicators.length, eventCount:events.length };
}

async function main() {
  let failure;
  try { await run(); }
  catch (error) { failure = error; }
  finally {
    if (cleanup) {
      try {
        const response = await cleanup();
        if (!(response.status === 200 && Array.isArray(response.json) && response.json.length === 1)) throw new Error('cleanup verification failed');
        results.push({ name:'Emergency cleanup', status:'PASS', duration:0 });
      } catch (error) {
        results.push({ name:'Emergency cleanup', status:'FAIL', duration:0, error:'Temporary Staging data may require manual review' });
        failure = failure || error;
      }
    }
  }
  results.forEach(result => {
    process.stdout.write(`${result.status} ${result.name} (${result.duration}ms)${result.error ? `: ${result.error}` : ''}\n`);
  });
  const failed = results.filter(result => result.status === 'FAIL');
  process.stdout.write(`Result: ${failed.length ? 'FAIL' : 'PASS'} | Duration: ${Date.now() - startedAt}ms | Failed: ${failed.length}\n`);
  if (failure || failed.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { loadLocalEnvironment, validateEnvironment, notePayload, request };
