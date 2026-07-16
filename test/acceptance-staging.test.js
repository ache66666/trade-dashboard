'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateEnvironment, notePayload } = require('../scripts/acceptance/acceptance-staging');

function validEnvironment() {
  return {
    APP_ENV:'staging',
    STAGING_ACCEPTANCE_CONFIRM:'staging',
    STAGING_BASE_URL:'https://trade-dashboard-staging.onrender.com',
    SUPABASE_URL:'https://staging-project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',
    JOURNAL_TEST_USER_A_EMAIL:'a@example.invalid',
    JOURNAL_TEST_USER_A_PASSWORD:'test-a',
    JOURNAL_TEST_USER_B_EMAIL:'b@example.invalid',
    JOURNAL_TEST_USER_B_PASSWORD:'test-b',
    JOURNAL_LEGACY_OWNER_USER_ID:'00000000-0000-4000-8000-000000000001'
  };
}

test('Staging acceptance rejects missing explicit confirmation', () => {
  const environment = validEnvironment();
  delete environment.STAGING_ACCEPTANCE_CONFIRM;
  assert.throws(() => validateEnvironment(environment), /CONFIRM/);
});

test('Staging acceptance rejects Production mode and known Production URL', () => {
  const productionMode = validEnvironment();
  productionMode.APP_ENV = 'production';
  assert.throws(() => validateEnvironment(productionMode), /APP_ENV/);
  const productionUrl = validEnvironment();
  productionUrl.STAGING_BASE_URL = 'https://trade-dashboard-kgof.onrender.com';
  assert.throws(() => validateEnvironment(productionUrl), /Production application URL/);
});

test('Staging acceptance rejects service-role and secret keys', () => {
  const environment = validEnvironment();
  environment.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_never_allowed';
  assert.throws(() => validateEnvironment(environment), /Publishable Key/);
});

test('Staging acceptance payload is deterministic and valid for cleanup tests', () => {
  const payload = notePayload('TEST_SYMBOL', 'update');
  assert.equal(payload.summary, 'Staging acceptance update');
  assert.equal(payload.supporting_evidence[0].symbol, 'TEST_SYMBOL');
  assert.equal(payload.watchlist.length, 1);
});
