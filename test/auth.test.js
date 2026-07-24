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
let dataApiCalls = 0;
let lastDataApiRequest = null;
let lastMeetingWriteBody = null;
let analysisRow = null;
let failAnalysisComplete = false;
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
  process.env.OPENAI_API_KEY = 'test-model-key';

  global.fetch = async function (url, options) {
    const token = String(options.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    if (String(url) === 'https://api.openai.com/v1/responses') {
      return authResponse(200, {
        output_text:JSON.stringify({
          extracted_text:'US10Y 4.2%',
          structured_data:{
            meeting_date:null,
            title:'Test',
            source:'Screenshot',
            market_summary:'Test summary',
            rates:[{ name:'US10Y', value:4.2, unit:'%', change:null, direction:'unknown', comment:'Fact', source_text:'US10Y 4.2%', confidence:0.9 }],
            fx:[], equities:[], commodities:[], credit:[], events:[], risks:[], trade_ideas:[], uncertain_items:[]
          },
          analysis_text:'1. 今日市场在交易什么\n测试\n2. 国内利率与资金面\n测试\n3. 海外利率与汇率\n测试\n4. 股票、商品与风险偏好\n测试\n5. 关键事件和催化剂\n测试\n6. 数据支持的结论\n测试\n7. 尚未得到验证的判断\n测试\n8. 今日继续观察的问题\n测试'
        })
      });
    }
    if (String(url).includes('/storage/v1/object/authenticated/')) {
      const bytes = Buffer.from([137,80,78,71,13,10,26,10]);
      return { ok:true, status:200, arrayBuffer:async function () { return bytes; } };
    }
    if (String(url).startsWith('https://test.supabase.co/rest/v1/')) {
      dataApiCalls += 1;
      lastDataApiRequest = { url:String(url), options };
      assert.equal(options.headers.apikey, PUBLIC_KEY);
      if (token === 'data-error') return authResponse(500, { message:'RAW_DATA_INTERNAL' });
      if (String(url).includes('/indicators')) return authResponse(200, [{ symbol:'TEST' }]);
      if (String(url).includes('/morning_meeting_analyses')) {
        if (options.method === 'POST') {
          analysisRow = { id:'33333333-3333-4333-8333-333333333333', ...JSON.parse(options.body) };
          return authResponse(200, [analysisRow]);
        }
        if (options.method === 'PATCH') {
          const update = JSON.parse(options.body);
          if (failAnalysisComplete && update.status === 'completed') return authResponse(500, { message:'RAW_ANALYSIS_SAVE_ERROR' });
          analysisRow = { ...analysisRow, ...update };
          const safeRow = { ...analysisRow };
          delete safeRow.user_id;
          return authResponse(200, [safeRow]);
        }
        return authResponse(200, analysisRow ? [analysisRow] : []);
      }
      if (String(url).includes('/morning_meeting_images') && options.method === 'GET') {
        return authResponse(200, [{
          id:'22222222-2222-4222-8222-222222222222',
          meeting_id:'11111111-1111-4111-8111-111111111111',
          original_filename:'market.png',
          mime_type:'image/png',
          size_bytes:8,
          storage_path:'user-123/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png',
          upload_status:'stored'
        }]);
      }
      if (String(url).includes('/morning_meetings') && (!options.method || options.method === 'GET')) {
        const parsed = new URL(String(url));
        if (parsed.searchParams.get('id') === 'eq.11111111-1111-4111-8111-111111111111' &&
            parsed.searchParams.get('user_id') === 'eq.user-123') {
          return authResponse(200, [{
            id:'11111111-1111-4111-8111-111111111111',
            meeting_date:'2026-07-24',
            primary_driver:'Liquidity',
            confidence:55,
            my_view:'Private view'
          }]);
        }
        return authResponse(200, []);
      }
      if (String(url).includes('/morning_meetings') && (options.method === 'POST' || options.method === 'PATCH')) {
        lastMeetingWriteBody = JSON.parse(options.body);
        return authResponse(200, [{
          id:'11111111-1111-4111-8111-111111111111',
          meeting_date:lastMeetingWriteBody.meeting_date,
          primary_driver:lastMeetingWriteBody.primary_driver,
          evidence:lastMeetingWriteBody.evidence,
          contradiction:lastMeetingWriteBody.contradiction,
          need_to_verify:lastMeetingWriteBody.need_to_verify,
          confidence:lastMeetingWriteBody.confidence,
          my_view:lastMeetingWriteBody.my_view,
          review_notes:lastMeetingWriteBody.review_notes,
          analysis_status:lastMeetingWriteBody.analysis_status
        }]);
      }
      if (String(url).includes('/morning_meeting_images') && options.method === 'DELETE') return authResponse(204);
      if (options.method === 'POST') return authResponse(200, [JSON.parse(options.body)]);
      return authResponse(options.method === 'DELETE' ? 204 : 200, []);
    }
    authCalls += 1;
    assert.equal(url, 'https://test.supabase.co/auth/v1/user');
    assert.equal(options.headers.apikey, PUBLIC_KEY);
    if (token === 'valid-token') return authResponse(200, { id:'user-123', email:'trader@example.com', role:'ignored' });
    if (token === 'valid-token-b') return authResponse(200, { id:'user-456', email:'trader-b@example.com' });
    if (token === 'data-error') return authResponse(200, { id:'user-123', email:'trader@example.com' });
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

for (const method of ['GET', 'PUT', 'DELETE']) {
  test(`anonymous Journal ${method} is rejected before data access`, async () => {
    const beforeData = dataApiCalls;
    const beforeQueries = queryCalls;
    const payload = method === 'PUT' ? { malformed:'payload', user_id:'attacker' } : undefined;
    const response = await request(method, '/api/journal/2098-12-30?user_id=attacker', undefined, payload, { 'X-User-Id':'attacker' });
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, { error:'Authentication required' });
    assert.equal(dataApiCalls, beforeData);
    assert.equal(queryCalls, beforeQueries);
  });
}

test('authenticated Journal GET uses the verified user through Data API, not pg', async () => {
  const beforeQueries = queryCalls;
  const response = await request('GET', '/api/journal/2098-12-30?user_id=attacker', 'Bearer valid-token', undefined, { 'X-User-Id':'attacker' });
  const url = new URL(lastDataApiRequest.url);
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { date:'2098-12-30', note:null });
  assert.equal(url.searchParams.get('user_id'), 'eq.user-123');
  assert.equal(lastDataApiRequest.options.headers.Authorization, 'Bearer valid-token');
  assert.equal(queryCalls, beforeQueries);
});

test('authenticated Journal PUT ignores forged user_id and uses a composite upsert', async () => {
  const beforeQueries = queryCalls;
  const payload = {
    user_id:'attacker', thesis:'流动性', summary:'test',
    supporting_evidence:[{ symbol:'TEST', note:'evidence' }], opposing_evidence:[], watchlist:[]
  };
  const response = await request('PUT', '/api/journal/2098-12-30?user_id=attacker', 'Bearer valid-token', payload, { 'X-User-Id':'attacker' });
  const sent = JSON.parse(lastDataApiRequest.options.body);
  const url = new URL(lastDataApiRequest.url);
  assert.equal(response.status, 200);
  assert.equal(sent.user_id, 'user-123');
  assert.equal(url.searchParams.get('on_conflict'), 'user_id,note_date');
  assert.equal(queryCalls, beforeQueries);
});

test('authenticated Journal DELETE is scoped to the verified user', async () => {
  const beforeQueries = queryCalls;
  const response = await request('DELETE', '/api/journal/2098-12-30?user_id=attacker', 'Bearer valid-token', undefined, { 'X-User-Id':'attacker' });
  const url = new URL(lastDataApiRequest.url);
  assert.equal(response.status, 200);
  assert.equal(url.searchParams.get('user_id'), 'eq.user-123');
  assert.equal(url.searchParams.get('note_date'), 'eq.2098-12-30');
  assert.equal(queryCalls, beforeQueries);
});

test('Journal Data API errors are mapped to sanitized 503', async () => {
  const response = await request('GET', '/api/journal/2098-12-30', 'Bearer data-error');
  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { error:'Journal service unavailable' });
  assert.doesNotMatch(response.text, /RAW_|token|supabase|stack|postgres/i);
});

for (const endpoint of [
  ['GET', '/api/morning-meetings'],
  ['POST', '/api/morning-meetings'],
  ['GET', '/api/morning-meetings/11111111-1111-4111-8111-111111111111'],
  ['PUT', '/api/morning-meetings/11111111-1111-4111-8111-111111111111'],
  ['DELETE', '/api/morning-meetings/11111111-1111-4111-8111-111111111111'],
  ['GET', '/api/morning-meetings/11111111-1111-4111-8111-111111111111/analysis'],
  ['POST', '/api/morning-meetings/11111111-1111-4111-8111-111111111111/analysis'],
  ['PUT', '/api/morning-meetings/11111111-1111-4111-8111-111111111111/images/22222222-2222-4222-8222-222222222222/content']
]) {
  test(`anonymous Morning Meeting ${endpoint[0]} is rejected before private data access`, async () => {
    const beforeData = dataApiCalls;
    const beforeQueries = queryCalls;
    const response = await request(
      endpoint[0],
      endpoint[1] + '?user_id=attacker',
      undefined,
      endpoint[0] === 'POST' || endpoint[0] === 'PUT' ? { user_id:'attacker', malformed:true } : undefined,
      { 'X-User-Id':'attacker' }
    );
    assert.equal(response.status, 401);
    assert.deepEqual(response.json, { error:'Authentication required' });
    assert.equal(dataApiCalls, beforeData);
    assert.equal(queryCalls, beforeQueries);
  });
}

test('authenticated Morning Meeting list uses verified identity through Data API', async () => {
  const beforeQueries = queryCalls;
  const response = await request('GET', '/api/morning-meetings?user_id=attacker', 'Bearer valid-token', undefined, { 'X-User-Id':'attacker' });
  const url = new URL(lastDataApiRequest.url);
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { meetings:[] });
  assert.equal(url.pathname, '/rest/v1/morning_meetings');
  assert.equal(url.searchParams.get('user_id'), 'eq.user-123');
  assert.equal(queryCalls, beforeQueries);
});

test('authenticated Morning Meeting create ignores forged user identity', async () => {
  const beforeQueries = queryCalls;
  const response = await request(
    'POST',
    '/api/morning-meetings?user_id=attacker',
    'Bearer valid-token',
    {
      user_id:'attacker',
      meeting_date:'2026-07-24',
      primary_driver:'Liquidity',
      evidence:'Evidence',
      contradiction:'',
      need_to_verify:'',
      confidence:55,
      my_view:'Private view',
      review_notes:'',
      images:[]
    },
    { 'X-User-Id':'attacker' }
  );
  assert.equal(response.status, 200);
  assert.equal(lastMeetingWriteBody.user_id, 'user-123');
  assert.equal(Object.prototype.hasOwnProperty.call(response.json.meeting, 'user_id'), false);
  assert.equal(response.json.screenshot_storage, 'metadata_only');
  assert.equal(queryCalls, beforeQueries);
});

test('a second user cannot address another user through query, body, or headers', async () => {
  const foreignId = '11111111-1111-4111-8111-111111111111';
  const response = await request(
    'PUT',
    `/api/morning-meetings/${foreignId}?user_id=user-123`,
    'Bearer valid-token-b',
    {
      user_id:'user-123',
      meeting_date:'2026-07-24',
      primary_driver:'Risk',
      evidence:'',
      contradiction:'',
      need_to_verify:'',
      confidence:30,
      my_view:'Attempted foreign update',
      review_notes:'',
      images:[]
    },
    { 'X-User-Id':'user-123' }
  );
  const url = new URL(lastDataApiRequest.url);
  assert.equal(response.status, 404);
  assert.deepEqual(response.json, { error:'Morning Meeting not found' });
  assert.equal(url.pathname, '/rest/v1/morning_meetings');
  assert.equal(url.searchParams.get('id'), `eq.${foreignId}`);
  assert.equal(url.searchParams.get('user_id'), 'eq.user-456');
});

test('Morning Meeting Data API errors are mapped to a sanitized 503', async () => {
  const response = await request('GET', '/api/morning-meetings', 'Bearer data-error');
  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { error:'Morning Meeting service unavailable' });
  assert.doesNotMatch(response.text, /RAW_|token|supabase|stack|postgres/i);
});

test('authenticated user can analyze only an owned stored screenshot', async () => {
  analysisRow = null;
  failAnalysisComplete = false;
  const response = await request(
    'POST',
    '/api/morning-meetings/11111111-1111-4111-8111-111111111111/analysis?user_id=attacker',
    'Bearer valid-token',
    { user_id:'attacker', retry:false },
    { 'X-User-Id':'attacker' }
  );
  assert.equal(response.status, 200);
  assert.equal(response.json.analysis.status, 'completed');
  assert.equal(response.json.analysis.structured_data.rates[0].name, 'US10Y');
  assert.equal(Object.prototype.hasOwnProperty.call(response.json.analysis, 'user_id'), false);
});

test('analysis database save failure is sanitized and does not expose upstream details', async () => {
  analysisRow = null;
  failAnalysisComplete = true;
  const response = await request(
    'POST',
    '/api/morning-meetings/11111111-1111-4111-8111-111111111111/analysis',
    'Bearer valid-token',
    { retry:false }
  );
  failAnalysisComplete = false;
  assert.equal(response.status, 503);
  assert.equal(response.json.code, 'ANALYSIS_DATA_UNAVAILABLE');
  assert.doesNotMatch(response.text, /RAW_|token|supabase|stack|postgres|test-model-key/i);
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
