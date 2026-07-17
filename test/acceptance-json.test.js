'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
