'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'sql', '004_tighten_morning_meeting_authenticated_grants.sql'),
  'utf8'
);

test('Morning Meeting permission repair is transactional and forward-only', () => {
  assert.match(sql, /^\s*--[\s\S]*\bBEGIN;/);
  assert.match(sql, /\bCOMMIT;\s*$/);
  assert.doesNotMatch(
    sql,
    /^\s*(?:DROP\b|TRUNCATE\b|DELETE\s+FROM\b|INSERT\s+INTO\b|UPDATE\s+\S+\s+SET\b|ALTER\s+TABLE\b|CREATE\s+TABLE\b)/im
  );
  assert.doesNotMatch(sql, /daily_market_notes|indicators|macro_events|auth\.users|storage/i);
});

test('permission repair revokes inherited table grants before granting CRUD only', () => {
  for (const table of ['morning_meetings', 'morning_meeting_images']) {
    assert.match(sql, new RegExp(
      `REVOKE ALL PRIVILEGES\\s+ON TABLE public\\.${table}\\s+FROM authenticated`
    ));
    assert.match(sql, new RegExp(
      `GRANT SELECT, INSERT, UPDATE, DELETE\\s+ON TABLE public\\.${table}\\s+TO authenticated`
    ));
  }
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE)[\s\S]*\b(?:TRUNCATE|REFERENCES|TRIGGER|MAINTAIN|CREATE|OWNERSHIP|BYPASSRLS)\b/i);
  assert.doesNotMatch(sql, /\bSEQUENCE\b/i);
});
