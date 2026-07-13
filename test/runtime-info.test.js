'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getRuntimeInfo, createHealthPayload } = require('../runtime-info');
const { handleHealth } = require('../health');

test('health payload exposes status, environment and runtime version', () => {
  const runtime = getRuntimeInfo({ RENDER_GIT_COMMIT:'abc1234', APP_VERSION:'0.5.0', DEPLOYED_AT:'2026-07-13T00:00:00Z' });
  const payload = createHealthPayload({ status:'ok', environment:'staging', database:'connected', runtime });
  assert.deepEqual(payload, {
    status:'ok', environment:'staging', database:'connected',
    commit:'abc1234', version:'0.5.0', deployedAt:'2026-07-13T00:00:00Z'
  });
});

test('commit falls back to unknown when no deployment SHA exists', () => {
  assert.equal(getRuntimeInfo({}).commit, 'unknown');
});

test('health handler returns 200 with the configured environment', async () => {
  let result;
  await handleHealth({
    query: async () => ({ rows:[{ '?column?':1 }] }),
    sendJson: (response, status, body) => { result = { status, body }; },
    response: {},
    config: { appEnv:'staging', commit:'abc1234', version:'1.0.0', deployedAt:null }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'ok');
  assert.equal(result.body.environment, 'staging');
  assert.equal(result.body.database, 'connected');
  assert.equal(result.body.commit, 'abc1234');
});
