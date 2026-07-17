'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { countJsonArray, parseJsonArray } = require('../scripts/lib/acceptance-json');

test('acceptance JSON parser counts an empty array as zero', () => {
  assert.equal(countJsonArray('[]', 'empty response'), 0);
  assert.deepEqual(parseJsonArray('[]'), []);
});

test('acceptance JSON parser counts one array item as one', () => {
  assert.equal(countJsonArray('[{"id":1}]', 'single response'), 1);
});

test('acceptance JSON parser counts every item in a multi-item array', () => {
  assert.equal(countJsonArray('[{"id":1},{"id":2},{"id":3}]', 'multi response'), 3);
});

test('acceptance JSON parser rejects a non-array JSON value', () => {
  assert.throws(
    () => countJsonArray('{"id":1}', 'unexpected response'),
    /unexpected response must be a JSON array/
  );
});

test('acceptance JSON parser rejects malformed JSON', () => {
  assert.throws(
    () => countJsonArray('not-json', 'broken response'),
    /broken response is not valid JSON/
  );
});

test('Staging RLS runner requires an explicit full expected deployment commit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-staging-journal-rls.js'), 'utf8');
  assert.match(source, /required\(process\.env, 'STAGING_EXPECTED_COMMIT'\)/);
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/);
  assert.doesNotMatch(source, /const EXPECTED_COMMIT\s*=/);
});
