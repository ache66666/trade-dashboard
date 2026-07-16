'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.APP_ENV = process.env.APP_ENV || 'test';
const logger = require('../logger');
const { normalizeName, scaffoldFeature } = require('../scripts/create-feature');

test('feature names require lowercase kebab-case', () => {
  assert.equal(normalizeName('market-watchlist'), 'market-watchlist');
  for (const invalid of ['', 'Watchlist', '../watchlist', 'watch list', 'watch_list']) {
    assert.throws(() => normalizeName(invalid), /kebab-case/);
  }
});

test('feature scaffold creates the standard isolated directories', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-feature-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const result = scaffoldFeature('watchlist', { root });
  assert.deepEqual(result.files.sort(), [
    'api/README.md', 'css/README.md', 'docs/FEATURE.md', 'page/README.md', 'test/README.md'
  ]);
  result.files.forEach(file => assert.equal(fs.existsSync(path.join(root, 'features/watchlist', file)), true));
  assert.throws(() => scaffoldFeature('watchlist', { root }), /already exists/);
});

test('feature scaffold dry-run does not write files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-feature-plan-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const result = scaffoldFeature('alerts', { root, dryRun:true });
  assert.equal(result.files.length, 5);
  assert.equal(fs.existsSync(path.join(root, 'features')), false);
});

test('logger exposes only approved categories', () => {
  assert.deepEqual(logger.categories, ['AUTH', 'API', 'SESSION', 'EDITOR', 'RLS', 'DB', 'DEPLOY']);
  assert.throws(() => logger.category('SECRET', 'info', 'not written'), /Unknown log category/);
});

test('error-code registry contains the approved stable names', () => {
  const codes = require('../standards/error-codes.json');
  assert.deepEqual(Object.keys(codes), [
    'AUTH_REQUIRED', 'INVALID_TOKEN', 'AUTH_UNAVAILABLE', 'FORBIDDEN',
    'VALIDATION_FAILED', 'NOT_FOUND', 'RLS_DENIED', 'INTERNAL_ERROR'
  ]);
});
