'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');

const SAFE_DATABASE_URL = 'postgresql://test:test@127.0.0.1:6543/test';
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

before(async () => {
  process.env.APP_ENV = 'production';
  process.env.EDITOR_WRITE_ENABLED = 'true';
  process.env.DATABASE_URL = SAFE_DATABASE_URL;
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

  global.fetch = async function (url, options) {
    var token = String(options.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    authCalls += 1;
    assert.equal(url, 'https://test.supabase.co/auth/v1/user');
    assert.equal(options.headers.apikey, 'test-publishable-key');
    if (token === 'valid-token') return authResponse(200, { id:'user-123', email:'trader@example.com' });
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

function request(method, pathname, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(pathname, baseUrl), {
      method,
      headers:token ? { Authorization:'Bearer ' + token } : {}
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
    req.end();
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

for (const endpoint of [
  ['POST', '/api/refresh'],
  ['POST', '/api/indicators'],
  ['PUT', '/api/indicators/1'],
  ['POST', '/api/events']
]) {
  test(`Production keeps ${endpoint[0]} ${endpoint[1]} disabled before Auth and database access`, async () => {
    const beforeAuth = authCalls;
    const beforeQueries = queryCalls;
    const response = await request(endpoint[0], endpoint[1], 'valid-token');
    assert.equal(response.status, 403);
    assert.deepEqual(response.json, { error:'Public data editing is currently disabled' });
    assert.equal(authCalls, beforeAuth);
    assert.equal(queryCalls, beforeQueries);
  });
}
