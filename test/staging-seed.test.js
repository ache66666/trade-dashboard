'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  indicators, events, assertStagingSafety, describeDatabaseTarget, seedStaging
} = require('../scripts/lib/staging-seed');

class FakeClient {
  constructor() {
    this.indicators = new Map();
    this.events = new Map();
  }

  async query(sql, params) {
    if (sql.startsWith('SELECT symbol FROM indicators')) {
      return { rows:Array.from(this.indicators.values()).map(item => ({ symbol:item.symbol })) };
    }
    if (sql.startsWith('SELECT symbol, name, category, source FROM indicators')) {
      return { rows:Array.from(this.indicators.values()).map(item => ({ symbol:item.symbol, name:item.name, category:item.category, source:item.source })) };
    }
    if (sql.startsWith('SELECT to_char(event_time')) {
      return { rows:Array.from(this.events.values()).map(item => ({ event_time:item.event_time, name:item.name, source:item.source })) };
    }
    if (sql.startsWith('INSERT INTO indicators')) {
      this.indicators.set(params[0], { symbol:params[0], name:params[1], category:params[2], source:params[7] });
      return { rowCount:1 };
    }
    if (sql.startsWith('INSERT INTO macro_events')) {
      const key = `${params[0]}|${params[2]}|${params[7]}`;
      if (!this.events.has(key)) this.events.set(key, { event_time:params[0], name:params[2], source:params[7] });
      return { rowCount:1 };
    }
    return { rowCount:0 };
  }
}

test('staging safety rejects production before database loading', () => {
  assert.throws(
    () => assertStagingSafety({ APP_ENV:'production', STAGING_SEED_CONFIRM:'staging' }),
    /APP_ENV must be staging/
  );

  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'seed-staging.js')], {
    env: { APP_ENV:'production', STAGING_SEED_CONFIRM:'staging' },
    encoding:'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APP_ENV must be staging/);
  assert.doesNotMatch(result.stderr, /DATABASE_URL/);
});

test('staging safety requires the expected Supabase project target', () => {
  const testDatabaseUrl = ['postgresql:', '', 'postgres.stageproject:example@pooler.example.com', 'postgres'].join('/');
  const base = {
    APP_ENV:'staging',
    STAGING_SEED_CONFIRM:'staging',
    DATABASE_URL:testDatabaseUrl
  };
  assert.throws(() => assertStagingSafety(base), /STAGING_DATABASE_PROJECT_REF is required/);
  assert.throws(
    () => assertStagingSafety({ ...base, STAGING_DATABASE_PROJECT_REF:'productionproject' }),
    /does not match/
  );
  assert.doesNotThrow(() => assertStagingSafety({ ...base, STAGING_DATABASE_PROJECT_REF:'stageproject' }));
  assert.deepEqual(describeDatabaseTarget(base), {
    host:'pooler.example.com', database:'postgres', projectRef:'stag***ject', environment:'staging'
  });
});

test('staging seed can run twice without duplicate logical records', async () => {
  const client = new FakeClient();
  const first = await seedStaging(client);
  const second = await seedStaging(client);
  assert.deepEqual(first.plan, { indicators:{ insert:10, update:0 }, events:{ insert:2, existing:0 } });
  assert.deepEqual(second.plan, { indicators:{ insert:0, update:10 }, events:{ insert:0, existing:2 } });
  assert.equal(client.indicators.size, indicators.length);
  assert.equal(client.events.size, events.length);
  assert.equal(client.indicators.size, 10);
  assert.equal(client.events.size, 2);
  assert.deepEqual(new Set(indicators.map(item => item.category)), new Set(['流动性','利率','国债期货','外汇','股票','商品','波动率','信用']));
  assert.equal(indicators.filter(item => item.source === '待手工录入').length, 1);
});
