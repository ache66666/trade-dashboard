'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adaptFredCsv, convertValue } = require('../connectors/fred/adapter');
const { ALLOW_LIST, getIndicatorDefinition } = require('../connectors/fred/catalog');
const { fetchFredCsv } = require('../connectors/fred/fetcher');
const { assertProductionSafety } = require('../connectors/fred/production-safety');
const { IndicatorRepository } = require('../connectors/fred/repository');
const { runFredConnector, safeErrorCode } = require('../connectors/fred/runner');
const { validateRecord } = require('../connectors/fred/validator');

const NOW = new Date('2026-07-18T12:00:00Z');

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
    STAGING_SUPABASE_PROJECT_REF:'stageref456'
  }, overrides);
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
  assert.throws(() => assertProductionSafety(validEnvironment({ APP_ENV:'staging' })), /APP_ENV/);
  assert.throws(() => assertProductionSafety(validEnvironment({
    DATABASE_URL:'postgresql://postgres.prodref123@localhost:5432/postgres'
  })), /cannot be verified/);
  assert.throws(() => assertProductionSafety(validEnvironment({
    PRODUCTION_SUPABASE_PROJECT_REF:'anotherref'
  })), /allow-list/);
  assert.throws(() => assertProductionSafety(validEnvironment({
    STAGING_SUPABASE_PROJECT_REF:'prodref123'
  })), /matches Staging/);
});

test('Production writes require the exact explicit confirmation', () => {
  assert.throws(() => assertProductionSafety(validEnvironment(), {
    writeRequested:true, confirmation:'wrong'
  }), /explicit write confirmation/);
  assert.equal(assertProductionSafety(validEnvironment(), {
    writeRequested:true, confirmation:'production-fred-mvp'
  }).mode, 'apply');
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
