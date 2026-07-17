'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getRuntimeInfo, createHealthPayload } = require('../runtime-info');
const { handleHealth } = require('../health');

test('health payload exposes status, production environment and runtime version', () => {
  const runtime = getRuntimeInfo({ RENDER_GIT_COMMIT:'abc1234', APP_VERSION:'1.0.0', DEPLOYED_AT:'2026-07-17T00:00:00Z' });
  const payload = createHealthPayload({ status:'ok', environment:'production', database:'connected', runtime });
  assert.deepEqual(payload, {
    status:'ok', environment:'production', database:'connected',
    commit:'abc1234', version:'1.0.0', deployedAt:'2026-07-17T00:00:00Z'
  });
});

test('commit falls back to unknown when no deployment SHA exists', () => {
  assert.equal(getRuntimeInfo({}).commit, 'unknown');
});

test('health handler returns 200 with the configured production environment', async () => {
  let result;
  await handleHealth({
    query: async () => ({ rows:[{ '?column?':1 }] }),
    sendJson: (response, status, body) => { result = { status, body }; },
    response: {},
    config: { appEnv:'production', commit:'abc1234', version:'1.0.0', deployedAt:null }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'ok');
  assert.equal(result.body.environment, 'production');
  assert.equal(result.body.database, 'connected');
  assert.equal(result.body.commit, 'abc1234');
});

test('health handler returns a sanitized disconnected payload', async () => {
  let result;
  await handleHealth({
    query: async () => { throw new Error('DATABASE_SECRET_MARKER'); },
    sendJson: (response, status, body) => { result = { status, body }; },
    response: {},
    config: { appEnv:'production', commit:'abc1234', version:'1.0.0', deployedAt:null }
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.database, 'disconnected');
  assert.doesNotMatch(JSON.stringify(result.body), /DATABASE_SECRET_MARKER/);
});
