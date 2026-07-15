'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');

const SAFE_DATABASE_URL = 'postgresql://test:test@127.0.0.1:6543/test';
const indicators = [{ id:1, symbol:'TEST', name:'Test indicator' }];
const events = [{ id:1, name:'Test event' }];
let authCalls = 0;
let dataApiCalls = 0;
let lastDataApiRequest = null;
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

before(async () => {
  process.env.APP_ENV = 'production';
  process.env.EDITOR_WRITE_ENABLED = 'true';
  process.env.DATABASE_URL = SAFE_DATABASE_URL;
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

  global.fetch = async function (url, options) {
    if (String(url).indexOf('/rest/v1/') >= 0) {
      dataApiCalls += 1;
      lastDataApiRequest = { url:String(url), options };
      assert.equal(options.headers.apikey, 'test-publishable-key');
      if (options.headers.Authorization === 'Bearer data-error') return authResponse(500, { message:'DATA_API_INTERNAL_MARKER' });
      if (String(url).indexOf('/rest/v1/indicators') >= 0) return authResponse(200, [{ symbol:'TEST' }]);
      if (options.method === 'POST') return authResponse(200, [{ id:1, ...JSON.parse(options.body) }]);
      return authResponse(200, []);
    }
    var token = String(options.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    authCalls += 1;
    assert.equal(url, 'https://test.supabase.co/auth/v1/user');
    assert.equal(options.headers.apikey, 'test-publishable-key');
    if (token === 'valid-token' || token === 'data-error') return authResponse(200, { id:'user-123', email:'trader@example.com' });
    if (token === 'service-error') return authResponse(500, { message:'INTERNAL_AUTH_MARKER' });
    return authResponse(401, { message:'JWT_INTERNAL_MARKER' });
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

function request(method, pathname, token, payload, extraHeaders) {
  return new Promise((resolve, reject) => {
    const requestBody = payload === undefined ? null : JSON.stringify(payload);
    const req = http.request(new URL(pathname, baseUrl), {
      method,
      headers:{
        ...(token ? { Authorization:'Bearer ' + token } : {}),
        ...(requestBody ? { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(requestBody) } : {}),
        ...(extraHeaders || {})
      }
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({
        status:res.statusCode,
        text,
        json:text ? JSON.parse(text) : null
      }));
    });
    req.on('error', reject);
    req.end(requestBody);
  });
}

test('missing token returns 401 without contacting Auth or database', async () => {
  const beforeAuth = authCalls;
  const beforeQueries = queryCalls;
  const response = await request('GET', '/api/auth/me');
  assert.equal(response.status, 401);
  assert.deepEqual(response.json, { error:'Authentication required' });
  assert.equal(authCalls, beforeAuth);
  assert.equal(queryCalls, beforeQueries);
});

test('malformed Authorization header returns 401', async () => {
  const response = await new Promise((resolve, reject) => {
    const req = http.request(new URL('/api/auth/me', baseUrl), { headers:{ Authorization:'Basic invalid' } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status:res.statusCode, json:JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(response.status, 401);
  assert.deepEqual(response.json, { error:'Authentication required' });
});

test('invalid token returns a sanitized 401', async () => {
  const response = await request('GET', '/api/auth/me', 'invalid-token');
  assert.equal(response.status, 401);
  assert.deepEqual(response.json, { error:'Authentication required' });
  assert.doesNotMatch(response.text, /JWT_INTERNAL_MARKER|token|supabase|stack/i);
});

test('expired token returns a sanitized 401', async () => {
  const response = await request('GET', '/api/auth/me', 'expired-token');
  assert.equal(response.status, 401);
  assert.deepEqual(response.json, { error:'Authentication required' });
});

test('valid token returns the current user only', async () => {
  const response = await request('GET', '/api/auth/me', 'valid-token');
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { id:'user-123', email:'trader@example.com' });
});

test('Auth provider failures return a sanitized 503', async () => {
  const response = await request('GET', '/api/auth/me', 'service-error');
  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { error:'Authentication service unavailable' });
  assert.doesNotMatch(response.text, /INTERNAL_AUTH_MARKER|supabase|stack|database/i);
});

test('public Dashboard remains available without login', async () => {
  const response = await request('GET', '/api/dashboard');
  assert.equal(response.status, 200);
  assert.equal(response.json.indicators.length, 1);
  assert.equal(response.json.events.length, 1);
});

test('Journal read and write require Auth before database access', async () => {
  for (const method of ['GET', 'PUT']) {
    const beforeQueries = queryCalls;
    const beforeDataApi = dataApiCalls;
    const response = await request(method, '/api/journal/2026-07-15');
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, { error:'Authentication required' });
    assert.equal(queryCalls, beforeQueries);
    assert.equal(dataApiCalls, beforeDataApi);
  }
});

test('invalid Journal token returns 401 without Data API access', async () => {
  const beforeDataApi = dataApiCalls;
  const response = await request('GET', '/api/journal/2026-07-15', 'invalid-token');
  assert.equal(response.status, 401);
  assert.deepEqual(response.json, { error:'Authentication required' });
  assert.equal(dataApiCalls, beforeDataApi);
});

test('authenticated Journal read uses Data API with the verified token and not pg', async () => {
  const beforeQueries = queryCalls;
  const beforeDataApi = dataApiCalls;
  const response = await request('GET', '/api/journal/2026-07-15?user_id=attacker', 'valid-token', undefined, { 'X-User-Id':'attacker' });
  assert.equal(response.status, 200);
  assert.equal(response.json.note, null);
  assert.equal(queryCalls, beforeQueries);
  assert.equal(dataApiCalls, beforeDataApi + 1);
  assert.equal(lastDataApiRequest.options.headers.Authorization, 'Bearer valid-token');
  assert.equal(new URL(lastDataApiRequest.url).searchParams.get('user_id'), 'eq.user-123');
});

test('authenticated Journal write uses only Data API and ignores client user_id', async () => {
  const beforeQueries = queryCalls;
  const beforeDataApi = dataApiCalls;
  const payload = {
    user_id:'attacker',
    thesis:require('../journal').THESIS_OPTIONS[0],
    summary:'Verified user journal',
    supporting_evidence:[],
    opposing_evidence:[],
    watchlist:[]
  };
  const response = await request('PUT', '/api/journal/2026-07-15?user_id=attacker', 'valid-token', payload, { 'X-User-Id':'attacker' });
  assert.equal(response.status, 200);
  assert.equal(queryCalls, beforeQueries);
  assert.equal(dataApiCalls, beforeDataApi + 1);
  assert.equal(lastDataApiRequest.options.headers.Authorization, 'Bearer valid-token');
  assert.equal(JSON.parse(lastDataApiRequest.options.body).user_id, 'user-123');
  assert.equal(new URL(lastDataApiRequest.url).searchParams.get('on_conflict'), 'user_id,note_date');
});

test('Journal Auth provider failures return 503 without Data API access', async () => {
  const beforeDataApi = dataApiCalls;
  const response = await request('GET', '/api/journal/2026-07-15', 'service-error');
  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { error:'Authentication service unavailable' });
  assert.equal(dataApiCalls, beforeDataApi);
});

test('Journal Data API failures return a sanitized 503', async () => {
  const response = await request('GET', '/api/journal/2026-07-15', 'data-error');
  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { error:'Journal data service unavailable' });
  assert.doesNotMatch(response.text, /DATA_API_INTERNAL_MARKER|supabase|stack|token|postgres/i);
});

for (const endpoint of [
  ['POST', '/api/refresh'],
  ['POST', '/api/indicators'],
  ['PUT', '/api/indicators/1'],
  ['POST', '/api/events']
]) {
  test(`Production keeps ${endpoint[0]} ${endpoint[1]} disabled before Auth and database access`, async () => {
    const beforeAuth = authCalls;
    const beforeDataApi = dataApiCalls;
    const beforeQueries = queryCalls;
    const response = await request(endpoint[0], endpoint[1], 'valid-token');
    assert.equal(response.status, 403);
    assert.deepEqual(response.json, { error:'Public data editing is currently disabled' });
    assert.equal(authCalls, beforeAuth);
    assert.equal(dataApiCalls, beforeDataApi);
    assert.equal(queryCalls, beforeQueries);
  });
}
