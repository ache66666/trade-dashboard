'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SAFE_DATABASE_URL = 'postgresql://postgres.test:test@127.0.0.1:6543/test';
const PUBLIC_KEY = 'sb_publishable_test_value';
const indicators = [{ id:1, symbol:'TEST', name:'Test indicator' }];
const events = [{ id:1, name:'Test event' }];
let authCalls = 0;
let queryCalls = 0;
let server;
let baseUrl;

function authResponse(status, data) {
  return {
    ok:status >= 200 && status < 300,
    status,
    json:async function () { return data; }
  };
}

function readConfig(overrides) {
  const env = {
    ...process.env,
    APP_ENV:'production',
    DATABASE_URL:SAFE_DATABASE_URL,
    SUPABASE_URL:'https://test.supabase.co',
    SUPABASE_PUBLISHABLE_KEY:PUBLIC_KEY,
    ...overrides
  };
  const script = "const c=require('./config');process.stdout.write(JSON.stringify({configured:c.authConfigured,url:c.supabaseUrl,key:c.supabasePublishableKey}))";
  const result = spawnSync(process.execPath, ['-e', script], { cwd:ROOT, env, encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

before(async () => {
  process.env.APP_ENV = 'production';
  process.env.EDITOR_WRITE_ENABLED = 'true';
  process.env.DATABASE_URL = SAFE_DATABASE_URL;
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = PUBLIC_KEY;

  global.fetch = async function (url, options) {
    const token = String(options.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    authCalls += 1;
    assert.equal(url, 'https://test.supabase.co/auth/v1/user');
    assert.equal(options.headers.apikey, PUBLIC_KEY);
    if (token === 'valid-token') return authResponse(200, { id:'user-123', email:'trader@example.com', role:'ignored' });
    if (token === 'forbidden-token') return authResponse(403, { message:'RAW_FORBIDDEN' });
    if (token === 'service-error') return authResponse(500, { message:'RAW_AUTH_INTERNAL' });
    if (token === 'network-error') throw new Error('RAW_NETWORK_INTERNAL');
    return authResponse(401, { message:'RAW_JWT_INTERNAL' });
  };

  const databasePath = require.resolve('../database');
  require.cache[databasePath] = {
    id:databasePath,
    filename:databasePath,
    loaded:true,
    exports:{
      getPool:function () {},
      closePool:async function () {},
      query:async function (sql) {
        queryCalls += 1;
        if (/FROM indicators/.test(sql)) return { rows:indicators, rowCount:indicators.length };
        if (/FROM macro_events/.test(sql)) return { rows:events, rowCount:events.length };
        return { rows:[{ ok:1 }], rowCount:1 };
      }
    }
  };

  server = require('../server').server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server && server.listening) await new Promise(resolve => server.close(resolve));
});

function request(method, pathname, authorization, payload, extraHeaders) {
  return new Promise((resolve, reject) => {
    const requestBody = payload === undefined ? null : JSON.stringify(payload);
    const headers = {
      ...(authorization !== undefined ? { Authorization:authorization } : {}),
      ...(requestBody ? { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(requestBody) } : {}),
      ...(extraHeaders || {})
    };
    const req = http.request(new URL(pathname, baseUrl), { method, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({
        status:res.statusCode,
        contentType:String(res.headers['content-type'] || ''),
        text,
        json:text ? JSON.parse(text) : null
      }));
    });
    req.on('error', reject);
    if (requestBody) req.write(requestBody);
    req.end();
  });
}

test('Production Auth configuration requires a same-project HTTPS URL and public key', () => {
  const anonJwt = 'header.' + Buffer.from(JSON.stringify({ role:'anon' })).toString('base64url') + '.signature';
  const serviceJwt = 'header.' + Buffer.from(JSON.stringify({ role:'service_role' })).toString('base64url') + '.signature';
  assert.deepEqual(readConfig({}), { configured:true, url:'https://test.supabase.co', key:PUBLIC_KEY });
  assert.deepEqual(readConfig({ SUPABASE_PUBLISHABLE_KEY:anonJwt }), { configured:true, url:'https://test.supabase.co', key:anonJwt });
  for (const overrides of [
    { SUPABASE_URL:'', SUPABASE_PUBLISHABLE_KEY:'' },
    { SUPABASE_PUBLISHABLE_KEY:'' },
    { SUPABASE_URL:'http://test.supabase.co' },
    { SUPABASE_URL:'https://other.supabase.co' },
    { SUPABASE_URL:'https://test.supabase.co/unexpected' },
    { SUPABASE_URL:'https://localhost' },
    { SUPABASE_PUBLISHABLE_KEY:'sb_secret_forbidden' },
    { SUPABASE_PUBLISHABLE_KEY:serviceJwt },
    { SUPABASE_PUBLISHABLE_KEY:'header.not-json.signature' }
  ]) {
    const config = readConfig(overrides);
    assert.deepEqual(config, { configured:false, url:'', key:'' });
  }
});

for (const authorization of [undefined, 'Bearer', 'Bearer   ', 'Basic invalid', 'Bearer invalid token']) {
  test(`missing or malformed Authorization returns JSON 401: ${String(authorization)}`, async () => {
    const beforeAuth = authCalls;
    const beforeQueries = queryCalls;
    const response = await request('GET', '/api/auth/me', authorization);
    assert.equal(response.status, 401);
    assert.match(response.contentType, /^application\/json/i);
    assert.deepEqual(response.json, { error:'Authentication required' });
    assert.equal(authCalls, beforeAuth);
    assert.equal(queryCalls, beforeQueries);
  });
}

for (const token of ['invalid-token', 'forbidden-token']) {
  test(`invalid upstream credential is mapped to sanitized 401: ${token}`, async () => {
    const response = await request('GET', '/api/auth/me', 'Bearer ' + token);
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, { error:'Authentication required' });
    assert.doesNotMatch(response.text, /RAW_|token|supabase|stack|postgres/i);
  });
}

for (const token of ['service-error', 'network-error']) {
  test(`Auth unavailability is mapped to sanitized 503: ${token}`, async () => {
    const response = await request('GET', '/api/auth/me', 'Bearer ' + token);
    assert.equal(response.status, 503);
    assert.deepEqual(response.json, { error:'Authentication service unavailable' });
    assert.doesNotMatch(response.text, /RAW_|token|supabase|stack|postgres/i);
  });
}

test('Auth timeout is classified without leaking its cause', async () => {
  const { verifyAccessToken } = require('../auth');
  const fetchImpl = function (url, options) {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', function () { reject(new Error('RAW_TIMEOUT')); });
    });
  };
  await assert.rejects(
    verifyAccessToken('timeout-token', {
      config:{ authConfigured:true, supabaseUrl:'https://test.supabase.co', supabasePublishableKey:PUBLIC_KEY },
      fetchImpl,
      timeoutMs:5
    }),
    error => error.code === 'AUTH_UNAVAILABLE' && !/RAW_TIMEOUT|test\.supabase\.co/.test(error.message)
  );
});

test('missing Auth configuration returns sanitized 503 without contacting transport', async () => {
  const { requireAuth } = require('../auth');
  let payload;
  let transportCalls = 0;
  const user = await requireAuth(
    { headers:{ authorization:'Bearer structurally-valid' } },
    {},
    {
      config:{ authConfigured:false, supabaseUrl:'', supabasePublishableKey:'' },
      fetchImpl:function () { transportCalls += 1; },
      sendJson:function (res, status, body) { payload = { status, body }; }
    }
  );
  assert.equal(user, null);
  assert.deepEqual(payload, { status:503, body:{ error:'Authentication service unavailable' } });
  assert.equal(transportCalls, 0);
});

test('valid token returns only id and email without database access', async () => {
  const beforeQueries = queryCalls;
  const response = await request('GET', '/api/auth/me?user_id=attacker', 'Bearer valid-token', undefined, { 'X-User-Id':'attacker' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { id:'user-123', email:'trader@example.com' });
  assert.equal(queryCalls, beforeQueries);
});

for (const endpoint of ['/api/health', '/api/dashboard', '/api/dashboard-compat', '/api/indicators', '/api/events']) {
  test(`public GET remains anonymous: ${endpoint}`, async () => {
    const response = await request('GET', endpoint);
    assert.equal(response.status, 200);
  });
}

for (const endpoint of [
  ['POST', '/api/refresh'],
  ['POST', '/api/indicators'],
  ['PUT', '/api/indicators/1'],
  ['POST', '/api/events']
]) {
  test(`Production Editor deny gate precedes Auth and database: ${endpoint[0]} ${endpoint[1]}`, async () => {
    const beforeAuth = authCalls;
    const beforeQueries = queryCalls;
    const response = await request(endpoint[0], endpoint[1], 'Bearer valid-token', { malformed:'payload' });
    assert.equal(response.status, 403);
    assert.deepEqual(response.json, { error:'Public data editing is currently disabled' });
    assert.equal(authCalls, beforeAuth);
    assert.equal(queryCalls, beforeQueries);
  });
}
