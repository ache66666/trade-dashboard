'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '003_private_morning_meetings.sql'), 'utf8');

test('Morning Meeting migration is isolated and transactional', () => {
  assert.match(sql, /^\s*--[\s\S]*\bBEGIN;/);
  assert.match(sql, /\bCOMMIT;\s*$/);
  assert.doesNotMatch(sql, /daily_market_notes|indicators|macro_events|TRUNCATE/i);
  assert.match(sql, /CREATE TABLE public\.morning_meetings/);
  assert.match(sql, /CREATE TABLE public\.morning_meeting_images/);
});

test('both private tables enforce Auth ownership and RLS', () => {
  for (const table of ['morning_meetings', 'morning_meeting_images']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`));
    for (const command of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.match(sql, new RegExp(`ON public\\.${table} FOR ${command} TO authenticated`));
    }
  }
  assert.equal((sql.match(/auth\.uid\(\) = user_id/g) || []).length, 10);
  assert.match(sql, /FOR UPDATE TO authenticated\s+USING \(auth\.uid\(\) = user_id\)\s+WITH CHECK \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /FOR INSERT TO authenticated\s+WITH CHECK \(auth\.uid\(\) = user_id\)/);
});

test('anonymous and public access is revoked and no sharing fields exist', () => {
  assert.match(sql, /REVOKE ALL PRIVILEGES ON public\.morning_meetings\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON public\.morning_meeting_images\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.morning_meetings TO authenticated/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.morning_meeting_images TO authenticated/);
  assert.doesNotMatch(sql, /is_public|public_url|share_token|visibility/i);
});

test('image ownership cannot diverge from meeting ownership', () => {
  assert.match(sql, /UNIQUE \(id, user_id\)/);
  assert.match(sql, /FOREIGN KEY \(meeting_id, user_id\)[\s\S]*REFERENCES public\.morning_meetings\(id, user_id\)/);
  assert.match(sql, /storage_path text/);
  assert.match(sql, /upload_status = 'metadata_only'/);
  assert.match(sql, /storage_path IS NULL/);
});
