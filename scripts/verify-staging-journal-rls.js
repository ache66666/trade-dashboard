'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseJsonArray } = require('./lib/acceptance-json');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env.staging.local');
const DATE_A = '2098-12-30';
const DATE_B = '2098-12-31';

function fail(message) {
  throw new Error(message);
}

function readLocalEnvironment() {
  const values = {};
  if (!fs.existsSync(ENV_FILE)) fail('Staging acceptance refused: .env.staging.local is missing.');
  fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
  return values;
}

function required(values, name) {
  if (!values[name]) fail(`Staging acceptance refused: ${name} is missing.`);
  return values[name];
}

function safeUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    fail(`Staging acceptance refused: ${name} is invalid.`);
  }
  if (parsed.protocol !== 'https:') fail(`Staging acceptance refused: ${name} must use HTTPS.`);
  return parsed;
}

function legacyJwtRole(key) {
  const parts = String(key || '').split('.');
  if (parts.length !== 3) return '';
  try {
    return String(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role || '');
  } catch (error) {
    return '';
  }
}

function isAdministrativeKey(key) {
  return /^sb_secret_/i.test(String(key || '').trim()) || legacyJwtRole(key) === 'service_role';
}

function validateEnvironment(values) {
  const baseUrl = safeUrl(required(process.env, 'STAGING_BASE_URL'), 'STAGING_BASE_URL');
  const expectedCommit = required(process.env, 'STAGING_EXPECTED_COMMIT');
  const supabaseUrl = safeUrl(required(values, 'SUPABASE_URL'), 'SUPABASE_URL');
  const projectRef = required(values, 'STAGING_DATABASE_PROJECT_REF');
  const requiredNames = [
    'SUPABASE_PUBLISHABLE_KEY',
    'JOURNAL_TEST_USER_A_EMAIL',
    'JOURNAL_TEST_USER_A_PASSWORD',
    'JOURNAL_TEST_USER_B_EMAIL',
    'JOURNAL_TEST_USER_B_PASSWORD'
  ];

  if (values.APP_ENV !== 'staging') fail('Staging acceptance refused: APP_ENV must equal staging.');
  if (!/^[0-9a-f]{40}$/i.test(expectedCommit)) {
    fail('Staging acceptance refused: STAGING_EXPECTED_COMMIT must be a full Git SHA.');
  }
  if (!supabaseUrl.hostname.endsWith('.supabase.co') || !supabaseUrl.hostname.startsWith(`${projectRef}.`)) {
    fail('Staging acceptance refused: Supabase project does not match the approved Staging project.');
  }
  requiredNames.forEach((name) => required(values, name));
  if (isAdministrativeKey(values.SUPABASE_PUBLISHABLE_KEY)) {
    fail('Staging acceptance refused: an administrative Supabase key is not allowed.');
  }
  return { baseUrl:baseUrl.origin, supabaseUrl:supabaseUrl.origin, projectRef, expectedCommit:expectedCommit.toLowerCase() };
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      fail(`Unexpected non-JSON response (HTTP ${response.status}).`);
    }
  }
  return { status:response.status, contentType:response.headers.get('content-type') || '', body, text };
}

async function login(config, email, password) {
  const response = await jsonRequest(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method:'POST',
    headers:{ apikey:config.key, 'Content-Type':'application/json' },
    body:JSON.stringify({ email, password })
  });
  if (response.status !== 200 || !response.body || !response.body.access_token || !response.body.user) {
    fail('Staging acceptance refused: a test user could not authenticate.');
  }
  return { token:response.body.access_token, id:response.body.user.id };
}

async function appRequest(config, token, method, pathname, body, extraHeaders) {
  const headers = Object.assign({ Authorization:`Bearer ${token}` }, extraHeaders || {});
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  return jsonRequest(`${config.baseUrl}${pathname}`, {
    method,
    headers,
    body:body === undefined ? undefined : JSON.stringify(body)
  });
}

async function dataRequest(config, token, method, query, body, prefer) {
  const headers = {
    apikey:config.key,
    Authorization:`Bearer ${token}`,
    Accept:'application/json'
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${config.supabaseUrl}/rest/v1/daily_market_notes?${query}`, {
    method,
    headers,
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) fail(`Staging Data API request failed (HTTP ${response.status}).`);
  return { status:response.status, rows:text ? parseJsonArray(text, 'Staging Data API response') : [] };
}

function note(summary) {
  return {
    thesis:'暂无明确主线',
    summary,
    supporting_evidence:[],
    opposing_evidence:[],
    watchlist:[]
  };
}

function assertNote(response, expectedSummary, label) {
  if (response.status !== 200 || !response.body || !response.body.note) fail(`${label} did not return a Journal note.`);
  if (response.body.note.summary !== expectedSummary) fail(`${label} returned unexpected content.`);
}

async function ownerRows(config, user, date) {
  const query = new URLSearchParams({ select:'user_id,note_date,summary', user_id:`eq.${user.id}`, note_date:`eq.${date}` });
  return (await dataRequest(config, user.token, 'GET', query.toString())).rows;
}

async function crossRows(config, actor, targetId, date) {
  const query = new URLSearchParams({ select:'user_id,note_date,summary', user_id:`eq.${targetId}`, note_date:`eq.${date}` });
  return (await dataRequest(config, actor.token, 'GET', query.toString())).rows;
}

async function crossMutation(config, actor, method, targetId, date, body) {
  const query = new URLSearchParams({ select:'user_id,note_date,summary', user_id:`eq.${targetId}`, note_date:`eq.${date}` });
  return dataRequest(config, actor.token, method, query.toString(), body, 'return=representation');
}

async function cleanup(config, user, date) {
  const query = new URLSearchParams({ select:'user_id,note_date', user_id:`eq.${user.id}`, note_date:`eq.${date}` });
  await dataRequest(config, user.token, 'DELETE', query.toString(), undefined, 'return=representation');
}

async function main() {
  const values = readLocalEnvironment();
  const target = validateEnvironment(values);
  const config = {
    baseUrl:target.baseUrl,
    supabaseUrl:target.supabaseUrl,
    key:values.SUPABASE_PUBLISHABLE_KEY,
    expectedCommit:target.expectedCommit
  };
  const completed = [];
  let userA;
  let userB;
  let createdA = false;
  let createdB = false;

  const health = await jsonRequest(`${config.baseUrl}/api/health`, { method:'GET' });
  if (health.status !== 200 || !health.body || health.body.status !== 'ok' || health.body.environment !== 'staging' || health.body.database !== 'connected') {
    fail('Staging acceptance refused: health check does not identify a connected Staging deployment.');
  }
  if (String(health.body.commit || '').toLowerCase() !== config.expectedCommit) {
    fail('Staging acceptance refused: deployed commit is not the approved baseline.');
  }
  completed.push('environment');

  userA = await login(config, values.JOURNAL_TEST_USER_A_EMAIL, values.JOURNAL_TEST_USER_A_PASSWORD);
  userB = await login(config, values.JOURNAL_TEST_USER_B_EMAIL, values.JOURNAL_TEST_USER_B_PASSWORD);
  if (userA.id === userB.id) fail('Staging acceptance refused: User A and User B are not distinct.');
  const meA = await appRequest(config, userA.token, 'GET', '/api/auth/me');
  const meB = await appRequest(config, userB.token, 'GET', '/api/auth/me');
  if (meA.status !== 200 || !meA.body || meA.body.id !== userA.id ||
      meB.status !== 200 || !meB.body || meB.body.id !== userB.id) {
    fail('Staging acceptance refused: Node API identities do not match the authenticated users.');
  }
  completed.push('identity');

  const baselineA = await dataRequest(config, userA.token, 'GET', new URLSearchParams({ select:'user_id,note_date,summary' }).toString());
  const baselineB = await dataRequest(config, userB.token, 'GET', new URLSearchParams({ select:'user_id,note_date,summary' }).toString());
  if ((await ownerRows(config, userA, DATE_A)).length !== 0 || (await ownerRows(config, userB, DATE_B)).length !== 0) {
    fail('Staging acceptance refused: a temporary date is already occupied.');
  }
  const historyA14 = await appRequest(config, userA.token, 'GET', '/api/journal/2026-07-14');
  const historyA15 = await appRequest(config, userA.token, 'GET', '/api/journal/2026-07-15');
  completed.push('baseline');

  try {
    const aCreate = await appRequest(config, userA.token, 'PUT', `/api/journal/${DATE_A}`, note('RLS-A-v1'));
    assertNote(aCreate, 'RLS-A-v1', 'User A create');
    createdA = true;
    const bCreate = await appRequest(config, userB.token, 'PUT', `/api/journal/${DATE_B}`, note('RLS-B-v1'));
    assertNote(bCreate, 'RLS-B-v1', 'User B create');
    createdB = true;

    assertNote(await appRequest(config, userA.token, 'GET', `/api/journal/${DATE_A}`), 'RLS-A-v1', 'User A read');
    assertNote(await appRequest(config, userB.token, 'GET', `/api/journal/${DATE_B}`), 'RLS-B-v1', 'User B read');
    assertNote(await appRequest(config, userA.token, 'PUT', `/api/journal/${DATE_A}`, note('RLS-A-v2')), 'RLS-A-v2', 'User A update');
    assertNote(await appRequest(config, userB.token, 'PUT', `/api/journal/${DATE_B}`, note('RLS-B-v2')), 'RLS-B-v2', 'User B update');
    if ((await ownerRows(config, userA, DATE_A)).length !== 1 || (await ownerRows(config, userB, DATE_B)).length !== 1) {
      fail('Owner idempotency verification failed.');
    }
    completed.push('owner-operations');

    if ((await crossRows(config, userA, userB.id, DATE_B)).length !== 0) fail('RLS failure: User A can read User B data.');
    if ((await crossMutation(config, userA, 'PATCH', userB.id, DATE_B, { summary:'CROSS-A' })).rows.length !== 0) fail('RLS failure: User A can update User B data.');
    if ((await crossMutation(config, userA, 'DELETE', userB.id, DATE_B)).rows.length !== 0) fail('RLS failure: User A can delete User B data.');
    assertNote(await appRequest(config, userB.token, 'GET', `/api/journal/${DATE_B}`), 'RLS-B-v2', 'User B record after User A attacks');
    completed.push('a-to-b-isolation');

    if ((await crossRows(config, userB, userA.id, DATE_A)).length !== 0) fail('RLS failure: User B can read User A data.');
    if ((await crossMutation(config, userB, 'PATCH', userA.id, DATE_A, { summary:'CROSS-B' })).rows.length !== 0) fail('RLS failure: User B can update User A data.');
    if ((await crossMutation(config, userB, 'DELETE', userA.id, DATE_A)).rows.length !== 0) fail('RLS failure: User B can delete User A data.');
    assertNote(await appRequest(config, userA.token, 'GET', `/api/journal/${DATE_A}`), 'RLS-A-v2', 'User A record after User B attacks');
    completed.push('b-to-a-isolation');

    const spoof = note('RLS-B-spoof-check');
    spoof.user_id = userA.id;
    const spoofed = await appRequest(
      config,
      userB.token,
      'PUT',
      `/api/journal/${DATE_B}?user_id=${encodeURIComponent(userA.id)}`,
      spoof,
      { 'X-User-Id':userA.id }
    );
    assertNote(spoofed, 'RLS-B-spoof-check', 'Identity spoof check');
    const bRows = await ownerRows(config, userB, DATE_B);
    if (bRows.length !== 1 || bRows[0].user_id !== userB.id) fail('Identity spoofing changed Journal ownership.');
    completed.push('identity-spoofing');
  } finally {
    if (createdA) await cleanup(config, userA, DATE_A);
    if (createdB) await cleanup(config, userB, DATE_B);
  }

  if ((await ownerRows(config, userA, DATE_A)).length !== 0 || (await ownerRows(config, userB, DATE_B)).length !== 0) {
    fail('Cleanup failed: temporary Journal data remains.');
  }
  const afterA = await dataRequest(config, userA.token, 'GET', new URLSearchParams({ select:'user_id,note_date,summary' }).toString());
  const afterB = await dataRequest(config, userB.token, 'GET', new URLSearchParams({ select:'user_id,note_date,summary' }).toString());
  if (afterA.rows.length !== baselineA.rows.length || afterB.rows.length !== baselineB.rows.length) fail('Cleanup failed: user baselines changed.');
  const afterHistoryA14 = await appRequest(config, userA.token, 'GET', '/api/journal/2026-07-14');
  const afterHistoryA15 = await appRequest(config, userA.token, 'GET', '/api/journal/2026-07-15');
  if (JSON.stringify(afterHistoryA14.body) !== JSON.stringify(historyA14.body) || JSON.stringify(afterHistoryA15.body) !== JSON.stringify(historyA15.body)) {
    fail('Cleanup failed: User A historical baseline changed.');
  }
  completed.push('cleanup');

  console.log(`PASS Staging Journal RLS acceptance (${completed.join(', ')})`);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
