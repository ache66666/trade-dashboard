'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  indicators, events, assertStagingSafety, seedStaging
} = require('../scripts/lib/staging-seed');

class FakeClient {
  constructor() {
    this.indicatorSymbols = new Set();
    this.eventKeys = new Set();
  }

  async query(sql, params) {
    if (sql.startsWith('INSERT INTO indicators')) {
      this.indicatorSymbols.add(params[0]);
      return { rowCount:1 };
    }
    if (sql.startsWith('INSERT INTO macro_events')) {
      this.eventKeys.add(`${params[0]}|${params[2]}|${params[7]}`);
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

test('staging seed can run twice without duplicate logical records', async () => {
  assert.doesNotThrow(() => assertStagingSafety({ APP_ENV:'staging', STAGING_SEED_CONFIRM:'staging' }));
  const client = new FakeClient();
  await seedStaging(client);
  await seedStaging(client);
  assert.equal(client.indicatorSymbols.size, indicators.length);
  assert.equal(client.eventKeys.size, events.length);
  assert.equal(client.indicatorSymbols.size, 5);
  assert.equal(client.eventKeys.size, 2);
});
