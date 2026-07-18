'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { adaptFredCsv, convertValue } = require('../connectors/fred/adapter');
const { ALLOW_LIST, getIndicatorDefinition } = require('../connectors/fred/catalog');
const { fetchFredCsv } = require('../connectors/fred/fetcher');
const { assertProductionSafety } = require('../connectors/fred/production-safety');
const { IndicatorRepository } = require('../connectors/fred/repository');
const {
  readPublicIndicators, runFredConnector, safeErrorCode, verifyReadback
} = require('../connectors/fred/runner');
const { validateRecord } = require('../connectors/fred/validator');

const NOW = new Date('2026-07-18T12:00:00Z');
const TEST_TARGETS = Object.freeze({
  productionProjectRefSha256:crypto.createHash('sha256').update('prodref123').digest('hex'),
  stagingProjectRefSha256:crypto.createHash('sha256').update('stageref456').digest('hex'),
  productionPublicOrigin:'https://trade.example.com'
});

function response(body, options = {}) {
  return {
    ok:options.ok !== false,
    status:options.status || 200,
    headers:{ get:() => options.contentType || 'text/csv' },
    text:async () => body,
    json:async () => JSON.parse(body)
  };
}

function csv(series, previous = '4.20', latest = '4.25') {
  return `observation_date,${series}\n2026-07-16,${previous}\n2026-07-17,${latest}\n`;
}

function currentRow(symbol) {
  const definition = getIndicatorDefinition(symbol);
  return {
    symbol,
    category:definition.category,
    value:4.20,
    previous_value:4.10,
    value_unit:definition.databaseUnit,
    change_type:definition.changeType,
    source:'manual baseline',
    as_of:'2026-07-16',
    frequency:definition.frequency,
    is_manual:true
  };
}

function validEnvironment(overrides = {}) {
  return Object.assign({
    APP_ENV:'production',
    DATABASE_URL:'postgresql://postgres.prodref123@aws-0.pooler.supabase.com:6543/postgres',
    SUPABASE_URL:'https://prodref123.supabase.co',
    PRODUCTION_SUPABASE_PROJECT_REF:'prodref123',
    STAGING_SUPABASE_PROJECT_REF:'stageref456',
    PRODUCTION_PUBLIC_URL:'https://trade.example.com'
  }, overrides);
}

function assertSafety(environment, options = {}) {
  return assertProductionSafety(environment, Object.assign({}, options, { targetConfig:TEST_TARGETS }));
}

function publicRows() {
  const targets = ALLOW_LIST.map((symbol, index) => Object.assign({
    id:index + 1, name:symbol, value_unit:getIndicatorDefinition(symbol).databaseUnit,
    is_featured:true, sort_order:index + 1, updated_at:'2026-07-17T00:00:00Z'
  }, currentRow(symbol)));
  const others = Array.from({ length:29 }, (value, index) => ({
    id:index + 4, symbol:`OTHER${index + 1}`, name:`Other ${index + 1}`,
    category:'Other', value:index, previous_value:index - 1, value_unit:'',
    change_type:'percent', source:'baseline', as_of:'2026-07-16', frequency:'Daily',
    is_manual:false, is_featured:false, sort_order:index + 4,
    updated_at:'2026-07-17T00:00:00Z'
  }));
  return targets.concat(others);
}

test('FRED fetcher accepts a normal CSV response', async () => {
  const result = await fetchFredCsv('DGS10', {
    fetchImplementation:async () => response(csv('DGS10')),
    now:() => NOW
  });
  assert.equal(result.seriesId, 'DGS10');
  assert.match(result.body, /2026-07-17,4.25/);
});

test('FRED fetcher times out while reading the response body', async () => {
  await assert.rejects(fetchFredCsv('DGS10', {
    timeoutMs:10,
    fetchImplementation:async (url, request) => {
      const pending = new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name:'AbortError' }));
        });
      });
      return { ok:true, headers:{ get:() => 'text/csv' }, text:() => pending };
    }
  }), error => error.code === 'FRED_FETCH_TIMEOUT');
});

test('FRED fetcher rejects non-200 HTTP responses', async () => {
  await assert.rejects(fetchFredCsv('DGS10', {
    fetchImplementation:async () => response('unavailable', { ok:false, status:503 })
  }), error => error.code === 'FRED_HTTP_ERROR');
});

test('FRED fetcher rejects HTML and empty bodies', async () => {
  await assert.rejects(fetchFredCsv('DGS10', {
    fetchImplementation:async () => response('<html>blocked</html>', { contentType:'text/html' })
  }), error => error.code === 'FRED_HTML_RESPONSE');
  await assert.rejects(fetchFredCsv('DGS10', {
    fetchImplementation:async () => response('   ')
  }), error => error.code === 'FRED_EMPTY_RESPONSE');
});

test('adapter rejects non-numeric values and invalid dates', () => {
  const definition = getIndicatorDefinition('US10Y');
  assert.throws(() => adaptFredCsv({
    seriesId:'DGS10', body:'observation_date,DGS10\n2026-07-16,4.2\n2026-07-17,nope\n',
    fetchedAt:NOW.toISOString()
  }, definition), error => error.code === 'FRED_VALUE_INVALID');
  assert.throws(() => adaptFredCsv({
    seriesId:'DGS10', body:'observation_date,DGS10\n2026-02-30,4.2\n2026-07-17,4.3\n',
    fetchedAt:NOW.toISOString()
  }, definition), error => error.code === 'FRED_DATE_INVALID');
});

test('adapter skips FRED missing values and keeps the latest two valid observations', () => {
  const definition = getIndicatorDefinition('US10Y');
  const record = adaptFredCsv({
    seriesId:'DGS10',
    body:'observation_date,DGS10\n2026-07-15,4.1\n2026-07-16,.\n2026-07-17,4.2\n',
    fetchedAt:NOW.toISOString()
  }, definition);
  assert.equal(record.previous_value, 4.1);
  assert.equal(record.value, 4.2);
});

test('adapter rejects duplicate or out-of-order observation dates', () => {
  const definition = getIndicatorDefinition('US10Y');
  for (const body of [
    'observation_date,DGS10\n2026-07-17,4.1\n2026-07-17,4.2\n',
    'observation_date,DGS10\n2026-07-17,4.1\n2026-07-16,4.2\n'
  ]) {
    assert.throws(() => adaptFredCsv({
      seriesId:'DGS10', body, fetchedAt:NOW.toISOString()
    }, definition), error => error.code === 'FRED_DATE_ORDER_INVALID');
  }
});

test('adapter accepts unchanged values on distinct dates', () => {
  const definition = getIndicatorDefinition('US10Y');
  const record = adaptFredCsv({
    seriesId:'DGS10', body:csv('DGS10', '4.2', '4.2'), fetchedAt:NOW.toISOString()
  }, definition);
  assert.equal(record.value, 4.2);
  assert.equal(record.previous_value, 4.2);
  assert.equal(record.change, 0);
});

test('catalog rejects unknown indicators and defines exactly three allowed symbols', () => {
  assert.deepEqual(ALLOW_LIST, ['US10Y', 'USDCNY', 'WTI']);
  assert.throws(() => getIndicatorDefinition('SPX'), error => error.code === 'CATALOG_INDICATOR_NOT_FOUND');
});

test('adapter applies configured unit conversion', () => {
  assert.equal(convertValue(2.5, { scale:100, offset:1 }), 251);
});

test('validator rejects unit mismatch and observation regression', () => {
  const definition = getIndicatorDefinition('US10Y');
  const fetchedAt = NOW.toISOString();
  const base = {
    indicator_code:'US10Y', observation_date:'2026-07-17', value:4.2, previous_value:4.1,
    source:definition.source, source_timestamp:'2026-07-17', fetched_at:fetchedAt,
    status:'valid', unit:definition.unit, series_id:definition.seriesId
  };
  assert.throws(() => validateRecord(base, definition,
    Object.assign(currentRow('US10Y'), { value_unit:'wrong' }), { now:() => NOW }),
  error => error.code === 'UNIT_MISMATCH');
  assert.throws(() => validateRecord(Object.assign({}, base, {
    observation_date:'2026-07-15', source_timestamp:'2026-07-15'
  }), definition, currentRow('US10Y'), { now:() => NOW }),
  error => error.code === 'OBSERVATION_REGRESSION');
});

test('runner dry-run fetches and validates without writing', async () => {
  let applied = false;
  const rows = ALLOW_LIST.map(currentRow);
  const result = await runFredConnector({
    repository:{ readCurrent:async () => rows, apply:async () => { applied = true; } },
    dryRun:true,
    now:() => NOW,
    fetchImplementation:async url => {
      const series = new URL(url).searchParams.get('id');
      return response(csv(series));
    }
  });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.plans.length, 3);
  assert.equal(applied, false);
});

test('Production safety fails closed for environment, target and allow-list errors', () => {
  assert.throws(() => assertSafety(validEnvironment({ APP_ENV:'staging' })), /APP_ENV/);
  assert.throws(() => assertSafety(validEnvironment({
    DATABASE_URL:'postgresql://postgres.prodref123@localhost:5432/postgres'
  })), /cannot be verified/);
  assert.throws(() => assertSafety(validEnvironment({
    PRODUCTION_SUPABASE_PROJECT_REF:'anotherref'
  })), /Production reference/);
  assert.throws(() => assertSafety(validEnvironment({
    STAGING_SUPABASE_PROJECT_REF:'prodref123'
  })), /Staging deny-list/);
});

test('Production writes require the exact explicit confirmation', () => {
  assert.throws(() => assertSafety(validEnvironment(), {
    writeRequested:true, confirmation:'wrong'
  }), /explicit write confirmation/);
  assert.equal(assertSafety(validEnvironment(), {
    writeRequested:true, confirmation:'production-fred-mvp'
  }).mode, 'apply');
});

test('Production writes validate the API readback target before data access', () => {
  for (const value of ['http://trade.example.com', 'https://localhost:4173', 'https://other.example.com']) {
    assert.throws(() => assertSafety(validEnvironment({
      PRODUCTION_PUBLIC_URL:value
    }), {
      writeRequested:true,
      confirmation:'production-fred-mvp'
    }), /readback URL/);
  }
  assert.equal(assertSafety(validEnvironment({
    PRODUCTION_PUBLIC_URL:''
  }), { writeRequested:false }).mode, 'dry-run');
});

test('Production safety derives public values while preserving hashed allow and deny lists', () => {
  const environment = validEnvironment({
    SUPABASE_URL:'', PRODUCTION_SUPABASE_PROJECT_REF:'',
    STAGING_SUPABASE_PROJECT_REF:'', PRODUCTION_PUBLIC_URL:''
  });
  assert.equal(assertSafety(environment, { writeRequested:false }).environment, 'production');
  assert.equal(assertSafety(environment, {
    writeRequested:true, confirmation:'production-fred-mvp'
  }).mode, 'apply');
});

test('public readback requires 32 unique indicator codes', async () => {
  await assert.rejects(readPublicIndicators({}, async () => response(JSON.stringify(publicRows().slice(0, 31)))),
    error => error.code === 'READBACK_INDICATOR_SET_INVALID');
  const duplicates = publicRows();
  duplicates[31] = Object.assign({}, duplicates[31], { symbol:duplicates[30].symbol });
  await assert.rejects(readPublicIndicators({}, async () => response(JSON.stringify(duplicates))),
    error => error.code === 'READBACK_INDICATOR_SET_INVALID');
});

test('apply preflight and readback verify targets and all 29 non-target rows', async () => {
  const baseline = publicRows();
  const rows = ALLOW_LIST.map(currentRow);
  let applied = 0;
  let apiReads = 0;
  const result = await runFredConnector({
    repository:{
      readCurrent:async () => rows,
      apply:async plans => { applied += 1; return { updated:plans.length }; }
    },
    dryRun:false,
    environment:{},
    now:() => NOW,
    fetchImplementation:async url => {
      if (url.endsWith('/api/indicators')) {
        apiReads += 1;
        const snapshot = baseline.map(row => {
          const definition = ALLOW_LIST.includes(row.symbol) ? getIndicatorDefinition(row.symbol) : null;
          return definition && apiReads === 2 ? Object.assign({}, row, {
            value:4.25, previous_value:4.20, as_of:'2026-07-17',
            source:definition.source, frequency:definition.frequency, is_manual:false
          }) : row;
        });
        return response(JSON.stringify(snapshot));
      }
      const series = new URL(url).searchParams.get('id');
      return response(csv(series));
    }
  });
  assert.equal(applied, 1);
  assert.equal(apiReads, 2);
  assert.deepEqual(result.readback, { verified:3, indicatorCount:32, nonTargetVerified:29 });
});

test('readback rejects a change to any non-target indicator', async () => {
  const before = publicRows();
  const after = before.map(row => row.symbol === 'OTHER1' ? Object.assign({}, row, { value:999 }) : row);
  const plans = ALLOW_LIST.map(symbol => {
    const row = after.find(item => item.symbol === symbol);
    return { symbol, to:{ observation_date:row.as_of, value:row.value, previous_value:row.previous_value } };
  });
  await assert.rejects(verifyReadback({}, plans,
    async () => response(JSON.stringify(after)), before),
  error => error.code === 'READBACK_NON_TARGET_CHANGED');
});

test('repository rejects symbols outside the three-indicator allow-list', async () => {
  const repository = new IndicatorRepository({ query:async () => ({ rows:[] }) }, ALLOW_LIST);
  await assert.rejects(repository.readCurrent(['SPX']), error => error.code === 'REPOSITORY_ALLOW_LIST_VIOLATION');
});

test('repository is idempotent when all plans are unchanged', async () => {
  let connected = false;
  const repository = new IndicatorRepository({ connect:async () => { connected = true; } }, ALLOW_LIST);
  const result = await repository.apply(ALLOW_LIST.map(symbol => ({ symbol, action:'unchanged' })));
  assert.deepEqual(result, { updated:0 });
  assert.equal(connected, false);
});

test('repository rolls back all updates and preserves old values after a failure', async () => {
  const statements = [];
  const client = {
    query:async statement => {
      statements.push(statement);
      if (/UPDATE indicators/.test(statement)) throw Object.assign(new Error('database detail'), { code:'DB_FAILURE' });
      return { rows:[] };
    },
    release:() => statements.push('RELEASE')
  };
  const repository = new IndicatorRepository({ connect:async () => client }, ALLOW_LIST);
  await assert.rejects(repository.apply([{
    symbol:'US10Y', action:'update',
    to:{ value:4.2, previous_value:4.1, source:'FRED', observation_date:'2026-07-17', frequency:'Daily Close' }
  }]), error => error.code === 'DB_FAILURE');
  assert.deepEqual(statements.filter(value => typeof value === 'string' && !/UPDATE/.test(value)),
    ['BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('safe logging exposes only allow-listed error codes', () => {
  assert.equal(safeErrorCode({ code:'FRED_HTTP_ERROR', message:'secret' }), 'FRED_HTTP_ERROR');
  assert.equal(safeErrorCode({ code:'token=https://secret.example' }), 'FRED_CONNECTOR_FAILED');
});
