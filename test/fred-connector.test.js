'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { adaptFredCsv, convertValue } = require('../connectors/fred/adapter');
const { ALLOW_LIST, DEFAULT_SYMBOLS, getIndicatorDefinition } = require('../connectors/fred/catalog');
const { fetchFredCsv } = require('../connectors/fred/fetcher');
const { assertProductionSafety } = require('../connectors/fred/production-safety');
const { IndicatorRepository } = require('../connectors/fred/repository');
const {
  readPublicIndicators, runFredConnector, safeErrorCode, safeStage, selectedSymbols,
  stageFailure, verifyReadback
} = require('../connectors/fred/runner');
const { parseArguments, safeFailure } = require('../scripts/run-fred-connector');
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
  const targets = DEFAULT_SYMBOLS.map((symbol, index) => Object.assign({
    id:index + 1, name:symbol, value_unit:getIndicatorDefinition(symbol).databaseUnit,
    is_featured:true, sort_order:index + 1, updated_at:'2026-07-17T00:00:00Z'
  }, currentRow(symbol), { source:getIndicatorDefinition(symbol).source }));
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

test('catalog adds only US2Y while preserving the three-indicator scheduled default', () => {
  assert.deepEqual(ALLOW_LIST, ['US2Y', 'US10Y', 'USDCNY', 'WTI']);
  assert.deepEqual(DEFAULT_SYMBOLS, ['US10Y', 'USDCNY', 'WTI']);
  assert.deepEqual(getIndicatorDefinition('US2Y'), {
    indicatorCode:'US2Y', category:'利率', seriesId:'DGS2', source:'FRED · DGS2',
    unit:'%', databaseUnit:'%', frequency:'Daily Close', changeType:'bp',
    minimum:-5, maximum:30, scale:1
  });
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
  const rows = DEFAULT_SYMBOLS.map(currentRow);
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

test('single-indicator mode processes only US2Y without changing the scheduled default', async () => {
  assert.deepEqual(parseArguments(['--dry-run', '--indicator=US2Y']).symbols, ['US2Y']);
  assert.deepEqual(parseArguments(['--dry-run', '--indicator=US10Y']).symbols, ['US10Y']);
  assert.deepEqual(parseArguments(['--dry-run']).symbols, DEFAULT_SYMBOLS);
  assert.throws(() => parseArguments(['--dry-run', '--indicator=']), /Invalid FRED connector indicator/);
  assert.throws(() => parseArguments(['--dry-run', '--indicator=SPX']), /Invalid FRED connector indicator/);
  assert.throws(() => selectedSymbols(['US10Y', 'US10Y']), error =>
    error.code === 'FRED_INDICATOR_SELECTION_INVALID');

  const reads = [];
  const fetched = [];
  const result = await runFredConnector({
    repository:{
      readCurrent:async symbols => { reads.push(symbols); return [currentRow('US10Y')]; },
      apply:async () => { throw new Error('dry-run must not apply'); }
    },
    dryRun:true,
    symbols:['US10Y'],
    now:() => NOW,
    fetchImplementation:async url => {
      fetched.push(new URL(url).searchParams.get('id'));
      return response(csv('DGS10'));
    }
  });

  assert.deepEqual(reads, [['US10Y']]);
  assert.deepEqual(fetched, ['DGS10']);
  assert.deepEqual(result.plans.map(plan => plan.symbol), ['US10Y']);

  const us2y = await runFredConnector({
    repository:{
      readCurrent:async symbols => {
        assert.deepEqual(symbols, ['US2Y']);
        return [currentRow('US2Y')];
      },
      apply:async () => { throw new Error('dry-run must not apply'); }
    },
    dryRun:true,
    symbols:['US2Y'],
    now:() => NOW,
    fetchImplementation:async url => {
      assert.equal(new URL(url).searchParams.get('id'), 'DGS2');
      return response(csv('DGS2'));
    }
  });
  assert.deepEqual(us2y.plans.map(plan => plan.symbol), ['US2Y']);
  assert.equal(us2y.plans[0].to.source, 'FRED · DGS2');
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

function fastReadbackOptions() {
  return { attemptTimeoutMs:5, totalTimeoutMs:100, retryDelaysMs:[0, 0], sleep:async () => {} };
}

function timeoutRequest(request) {
  return new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {
      name:'AbortError'
    })));
  });
}

test('Production readback retries one timeout and succeeds on the second attempt', async () => {
  let calls = 0;
  const rows = await readPublicIndicators({}, async (url, request) => {
    calls += 1;
    return calls === 1 ? timeoutRequest(request) : response(JSON.stringify(publicRows()));
  }, Object.assign(fastReadbackOptions(), { requiredSymbols:['US10Y'] }));
  assert.equal(calls, 2);
  assert.equal(rows.length, 32);
});

test('Production readback stops safely after three consecutive timeouts', async () => {
  let calls = 0;
  await assert.rejects(readPublicIndicators({}, async (url, request) => {
    calls += 1;
    return timeoutRequest(request);
  }, fastReadbackOptions()), error => error.code === 'READBACK_TIMEOUT');
  assert.equal(calls, 3);
});

test('Production readback retries a connection error and distinguishes response failures', async () => {
  let calls = 0;
  const rows = await readPublicIndicators({}, async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('temporary connection error');
    return response(JSON.stringify(publicRows()));
  }, Object.assign(fastReadbackOptions(), { requiredSymbols:['US10Y'] }));
  assert.equal(calls, 2);
  assert.equal(rows.length, 32);

  await assert.rejects(readPublicIndicators({}, async () => response('unavailable', { ok:false, status:500 }),
    fastReadbackOptions()), error => error.code === 'READBACK_HTTP_ERROR');
  await assert.rejects(readPublicIndicators({}, async () => response('', { status:204 }),
    fastReadbackOptions()), error => error.code === 'READBACK_HTTP_ERROR');
  await assert.rejects(readPublicIndicators({}, async () => response('not-json'), fastReadbackOptions()),
    error => error.code === 'READBACK_JSON_INVALID');
});

async function assertPreflightBlocks(apiResponse, expectedCode) {
  let applied = 0;
  let apiCalls = 0;
  await assert.rejects(runFredConnector({
    repository:{
      readCurrent:async () => [publicRows().find(row => row.symbol === 'US10Y')],
      apply:async () => { applied += 1; return { updated:1 }; }
    },
    dryRun:false,
    symbols:['US10Y'],
    environment:{},
    readbackOptions:fastReadbackOptions(),
    now:() => NOW,
    fetchImplementation:async (url, request) => {
      if (url.endsWith('/api/indicators')) {
        apiCalls += 1;
        return typeof apiResponse === 'function' ? apiResponse(request) : apiResponse;
      }
      return response(csv('DGS10'));
    }
  }), error => error.code === expectedCode);
  assert.equal(applied, 0);
  return apiCalls;
}

test('HTTP and invalid JSON preflight failures never call repository.apply', async () => {
  assert.equal(await assertPreflightBlocks(response('unavailable', { ok:false, status:500 }),
    'READBACK_HTTP_ERROR'), 1);
  assert.equal(await assertPreflightBlocks(response('not-json'), 'READBACK_JSON_INVALID'), 1);
});

test('indicator count, duplicate symbols and missing US10Y never call repository.apply', async () => {
  assert.equal(await assertPreflightBlocks(response(JSON.stringify(publicRows().slice(0, 31))),
    'READBACK_INDICATOR_SET_INVALID'), 1);
  const duplicate = publicRows();
  duplicate[31] = Object.assign({}, duplicate[31], { symbol:duplicate[30].symbol });
  assert.equal(await assertPreflightBlocks(response(JSON.stringify(duplicate)),
    'READBACK_INDICATOR_SET_INVALID'), 1);
  const missing = publicRows().map(row => row.symbol === 'US10Y' ? Object.assign({}, row, {
    symbol:'MISSING_US10Y'
  }) : row);
  assert.equal(await assertPreflightBlocks(response(JSON.stringify(missing)),
    'READBACK_BASELINE_MISMATCH'), 1);
});

test('an inconsistent US10Y baseline never calls repository.apply', async () => {
  const inconsistent = publicRows().map(row => row.symbol === 'US10Y' ? Object.assign({}, row, {
    source:'unexpected source'
  }) : row);
  assert.equal(await assertPreflightBlocks(response(JSON.stringify(inconsistent)),
    'READBACK_BASELINE_MISMATCH'), 1);
  const wrongUnit = publicRows().map(row => row.symbol === 'US10Y' ? Object.assign({}, row, {
    value_unit:'bp'
  }) : row);
  assert.equal(await assertPreflightBlocks(response(JSON.stringify(wrongUnit)),
    'READBACK_BASELINE_MISMATCH'), 1);
});

test('three preflight timeouts never call repository.apply', async () => {
  assert.equal(await assertPreflightBlocks(request => timeoutRequest(request), 'READBACK_TIMEOUT'), 3);
});

test('three preflight connection errors never call repository.apply', async () => {
  assert.equal(await assertPreflightBlocks(() => {
    throw new TypeError('temporary connection error');
  }, 'READBACK_CONNECTION_ERROR'), 3);
});

test('apply preflight and readback verify targets and all 29 non-target rows', async () => {
  const baseline = publicRows();
  const rows = DEFAULT_SYMBOLS.map(symbol => baseline.find(row => row.symbol === symbol));
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
          const definition = DEFAULT_SYMBOLS.includes(row.symbol) ? getIndicatorDefinition(row.symbol) : null;
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

test('US2Y first apply accepts an exact non-FRED baseline and verifies the FRED result', async () => {
  const definition = getIndicatorDefinition('US2Y');
  const current = Object.assign(currentRow('US2Y'), {
    source:'U.S. Treasury', frequency:'Daily', is_manual:false
  });
  const baseline = publicRows().map(row => row.symbol === 'OTHER1' ? Object.assign({}, current, {
    id:row.id, name:'美国国债 2Y', sort_order:row.sort_order, updated_at:row.updated_at
  }) : row);
  let apiReads = 0;
  let applied = 0;
  const result = await runFredConnector({
    repository:{
      readCurrent:async symbols => {
        assert.deepEqual(symbols, ['US2Y']);
        return [current];
      },
      apply:async plans => {
        applied += 1;
        assert.deepEqual(plans.map(plan => plan.symbol), ['US2Y']);
        return { updated:1 };
      }
    },
    dryRun:false,
    symbols:['US2Y'],
    environment:{},
    now:() => NOW,
    fetchImplementation:async url => {
      if (url.endsWith('/api/indicators')) {
        apiReads += 1;
        return response(JSON.stringify(apiReads === 1 ? baseline : baseline.map(row =>
          row.symbol === 'US2Y' ? Object.assign({}, row, {
            value:4.25, previous_value:4.20, as_of:'2026-07-17',
            source:definition.source, frequency:definition.frequency, is_manual:false
          }) : row)));
      }
      assert.equal(new URL(url).searchParams.get('id'), 'DGS2');
      return response(csv('DGS2'));
    }
  });
  assert.equal(applied, 1);
  assert.equal(apiReads, 2);
  assert.deepEqual(result.readback, { verified:1, indicatorCount:32, nonTargetVerified:31 });
});

test('readback rejects a change to any non-target indicator', async () => {
  const before = publicRows();
  const after = before.map(row => row.symbol === 'OTHER1' ? Object.assign({}, row, { value:999 }) :
    DEFAULT_SYMBOLS.includes(row.symbol) ? Object.assign({}, row, { is_manual:false }) : row);
  const plans = DEFAULT_SYMBOLS.map(symbol => {
    const row = after.find(item => item.symbol === symbol);
    return { symbol, to:{
      observation_date:row.as_of,
      value:row.value,
      previous_value:row.previous_value,
      source:row.source,
      frequency:row.frequency
    } };
  });
  await assert.rejects(verifyReadback({}, plans,
    async () => response(JSON.stringify(after)), before, fastReadbackOptions()),
  error => error.code === 'READBACK_NON_TARGET_CHANGED');
});

test('repository rejects symbols outside the four-indicator explicit allow-list', async () => {
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

test('CLI failure output keeps one public code and exposes only an allow-listed stage', () => {
  const failure = stageFailure(Object.assign(new Error('password=secret'), {
    code:'DATABASE_SECRET_DETAIL'
  }), 'repository-init');
  assert.deepEqual(safeFailure(failure), {
    error:'FRED_CONNECTOR_FAILED',
    stage:'repository-init',
    message:'FRED connector stopped without changing unconfirmed data.'
  });
  assert.equal(JSON.stringify(safeFailure(failure)).includes('secret'), false);
  assert.equal(safeStage({ fredStage:'token=https://secret.example' }), 'unknown');
});

test('runner classifies failures before and inside repository.apply without leaking details', async () => {
  await assert.rejects(runFredConnector({
    repository:{ readCurrent:async () => { throw new Error('database target detail'); } },
    dryRun:false, symbols:['US10Y']
  }), error => safeStage(error) === 'repository-init');

  await assert.rejects(runFredConnector({
    repository:{
      readCurrent:async () => [publicRows().find(row => row.symbol === 'US10Y')],
      apply:async () => { throw new Error('SQL statement detail'); }
    },
    dryRun:false,
    symbols:['US10Y'],
    environment:{},
    now:() => NOW,
    readbackOptions:fastReadbackOptions(),
    fetchImplementation:async url => url.endsWith('/api/indicators')
      ? response(JSON.stringify(publicRows())) : response(csv('DGS10'))
  }), error => safeStage(error) === 'repository-apply');
});

test('runner classifies fetch, transform, validation and readback failures safely', async () => {
  const repository = { readCurrent:async () => [currentRow('US10Y')], apply:async () => ({ updated:0 }) };
  await assert.rejects(runFredConnector({
    repository, dryRun:true, symbols:['US10Y'], now:() => NOW,
    fetchImplementation:async () => { throw new TypeError('private host detail'); }
  }), error => safeStage(error) === 'fetch');
  await assert.rejects(runFredConnector({
    repository, dryRun:true, symbols:['US10Y'], now:() => NOW,
    fetchImplementation:async () => response('not,csv')
  }), error => safeStage(error) === 'transform');
  await assert.rejects(runFredConnector({
    repository, dryRun:true, symbols:['US10Y'], now:() => NOW,
    fetchImplementation:async () => response(csv('DGS10', '4.20', '999'))
  }), error => safeStage(error) === 'validation');
  await assert.rejects(runFredConnector({
    repository, dryRun:false, symbols:['US10Y'], environment:{}, now:() => NOW,
    readbackOptions:fastReadbackOptions(),
    fetchImplementation:async url => url.endsWith('/api/indicators')
      ? response('unavailable', { ok:false, status:500 }) : response(csv('DGS10'))
  }), error => safeStage(error) === 'readback');
});
