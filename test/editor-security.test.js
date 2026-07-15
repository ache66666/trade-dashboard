'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SAFE_DATABASE_URL = 'postgresql://test:test@127.0.0.1:6543/test';
const DISABLED_ERROR = { error:'Public data editing is currently disabled' };

function configFor(appEnv, editorWriteEnabled) {
  const env = { ...process.env, APP_ENV:appEnv, DATABASE_URL:SAFE_DATABASE_URL };
  const script = "process.stdout.write(JSON.stringify(require('./config').editorWriteEnabled))";
  if (editorWriteEnabled === undefined) delete env.EDITOR_WRITE_ENABLED;
  else env.EDITOR_WRITE_ENABLED = editorWriteEnabled;
  const result = spawnSync(process.execPath, ['-e', script], { cwd:ROOT, env, encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('EDITOR_WRITE_ENABLED is disabled by default', () => {
  assert.equal(configFor('production'), false);
});

test('EDITOR_WRITE_ENABLED=false remains disabled', () => {
  assert.equal(configFor('staging', 'false'), false);
});

test('Production cannot enable Editor writes through the environment', () => {
  assert.equal(configFor('production', 'true'), false);
});

test('Staging must opt in explicitly before Editor writes are enabled', () => {
  assert.equal(configFor('staging'), false);
  assert.equal(configFor('staging', 'true'), true);
});

test('an explicitly enabled Staging server requires Auth before preserving the write path', () => {
  const script = [
    "process.env.APP_ENV='staging'",
    "process.env.EDITOR_WRITE_ENABLED='true'",
    `process.env.DATABASE_URL=${JSON.stringify(SAFE_DATABASE_URL)}`,
    "process.env.SUPABASE_URL='https://test.supabase.co'",
    "process.env.SUPABASE_PUBLISHABLE_KEY='test-publishable-key'",
    "global.fetch=async function(){return {ok:true,status:200,json:async function(){return {id:'user-1',email:'trader@example.com'}}}}",
    "const databasePath=require.resolve('./database')",
    "require.cache[databasePath]={id:databasePath,filename:databasePath,loaded:true,exports:{getPool:function(){},closePool:async function(){},query:async function(){return {rows:[{id:1,symbol:'TEST'}],rowCount:1}}}}",
    "const server=require('./server').server",
    "server.listen(0,'127.0.0.1',async function(){",
    "const address=server.address()",
    "const payload=JSON.stringify({symbol:'TEST',name:'Test',category:'Rates',value:1,previous_value:1,source:'Test',as_of:'2026-07-15',frequency:'Daily',change_type:'percent'})",
    "function send(token,done){const headers={'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)};if(token)headers.Authorization='Bearer '+token;const req=require('node:http').request({hostname:'127.0.0.1',port:address.port,path:'/api/indicators',method:'POST',headers:headers},function(response){response.resume();response.on('end',function(){done(response.statusCode)})});req.end(payload)}",
    "send(null,function(first){process.stdout.write(String(first)+',');send('valid-token',function(second){process.stdout.write(String(second));server.close()})})",
    "})"
  ].join(';');
  const result = spawnSync(process.execPath, ['-e', script], { cwd:ROOT, env:process.env, encoding:'utf8', timeout:10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '401,201');
});

const indicators = Array.from({ length:32 }, (_, index) => ({
  id:index + 1,
  symbol:`TEST${index + 1}`,
  name:`Indicator ${index + 1}`
}));
const events = Array.from({ length:3 }, (_, index) => ({
  id:index + 1,
  name:`Event ${index + 1}`
}));
let queryCount = 0;
let forceFailure = false;
let server;
let baseUrl;

before(async () => {
  process.env.APP_ENV = 'production';
  process.env.EDITOR_WRITE_ENABLED = 'true';
  process.env.DATABASE_URL = SAFE_DATABASE_URL;

  const databasePath = require.resolve('../database');
  require.cache[databasePath] = {
    id:databasePath,
    filename:databasePath,
    loaded:true,
    exports:{
      getPool:function () {},
      closePool:async function () {},
      query:async function (sql) {
        queryCount += 1;
        if (forceFailure) throw new Error('DATABASE_INTERNAL_MARKER');
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
  if (!server || !server.listening) return;
  await new Promise(resolve => server.close(resolve));
});

function request(method, pathname, payload, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(pathname, baseUrl);
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = http.request(target, {
      method,
      headers:{
        ...(body ? { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } : {}),
        ...(headers || {})
      }
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json = null;
        if (text && /application\/json/i.test(String(res.headers['content-type'] || ''))) json = JSON.parse(text);
        resolve({ status:res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

for (const endpoint of [
  ['POST', '/api/refresh'],
  ['POST', '/api/indicators'],
  ['PUT', '/api/indicators/1'],
  ['POST', '/api/events']
]) {
  test(`Production rejects ${endpoint[0]} ${endpoint[1]} before database access`, async () => {
    const beforeQueries = queryCount;
    const response = await request(endpoint[0], endpoint[1], {});
    assert.equal(response.status, 403);
    assert.deepEqual(response.json, DISABLED_ERROR);
    assert.equal(queryCount, beforeQueries);
  });
}

test('client parameters and headers cannot enable Production writes', async () => {
  const response = await request(
    'POST',
    '/api/refresh?EDITOR_WRITE_ENABLED=true',
    undefined,
    { 'X-Editor-Write-Enabled':'true' }
  );
  assert.equal(response.status, 403);
  assert.deepEqual(response.json, DISABLED_ERROR);
});

for (const endpoint of [
  '/api/health',
  '/api/dashboard',
  '/api/dashboard-compat',
  '/api/indicators',
  '/api/events'
]) {
  test(`public GET remains available: ${endpoint}`, async () => {
    const response = await request('GET', endpoint);
    assert.equal(response.status, 200);
  });
}

test('public data counts remain unchanged during security tests', async () => {
  const indicatorResponse = await request('GET', '/api/indicators');
  const eventResponse = await request('GET', '/api/events');
  assert.equal(indicatorResponse.json.length, 32);
  assert.equal(eventResponse.json.length, 3);
});

test('Production HTML hides anonymous Editor controls', async () => {
  const response = await request('GET', '/');
  assert.equal(response.status, 200);
  assert.match(response.text, /editorWriteEnabled:false/);
  assert.match(response.text, /data-page="editor" data-editor-write-control hidden/);
  assert.doesNotMatch(response.text, /__(?:EDITOR_WRITE|AUTH_CONFIGURED|SUPABASE_)[A-Z_]*__/);
});

test('server errors return a sanitized response', async () => {
  forceFailure = true;
  const response = await request('GET', '/api/indicators');
  forceFailure = false;
  assert.equal(response.status, 500);
  assert.deepEqual(response.json, { error:'Internal server error' });
  assert.doesNotMatch(response.text, /DATABASE_INTERNAL_MARKER|postgresql|stack|password/i);
});
