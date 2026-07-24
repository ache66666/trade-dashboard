'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '005_morning_meeting_analysis.sql'), 'utf8');

test('analysis migration is transactional, scoped, and detects missing prerequisites', () => {
  assert.match(sql, /^\s*--[\s\S]*\bBEGIN;/);
  assert.match(sql, /\bCOMMIT;\s*$/);
  assert.match(sql, /to_regclass\('public\.morning_meetings'\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.morning_meeting_analyses/);
  assert.doesNotMatch(sql, /daily_market_notes|indicators|macro_events|TRUNCATE/i);
});

test('analysis ownership is one-to-one and cannot diverge from its parent meeting', () => {
  assert.match(sql, /UNIQUE \(meeting_id\)/);
  assert.match(sql, /FOREIGN KEY \(meeting_id, user_id\)[\s\S]*REFERENCES public\.morning_meetings\(id, user_id\)[\s\S]*ON DELETE CASCADE/);
  assert.match(sql, /status IN \('pending', 'processing', 'completed', 'failed'\)/);
  assert.match(sql, /structured_data jsonb/);
});

test('analysis table has forced own-row RLS and least-privilege grants', () => {
  assert.match(sql, /ALTER TABLE public\.morning_meeting_analyses ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.morning_meeting_analyses FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /FOR SELECT TO authenticated\s+USING \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /FOR INSERT TO authenticated\s+WITH CHECK \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /FOR UPDATE TO authenticated\s+USING \(auth\.uid\(\) = user_id\)\s+WITH CHECK \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON public\.morning_meeting_analyses\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON public\.morning_meeting_analyses TO authenticated/);
  assert.doesNotMatch(sql, /GRANT[\s\S]*DELETE ON public\.morning_meeting_analyses/i);
});

test('private bucket refuses a conflicting public or oversized configuration', () => {
  assert.match(sql, /'morning-meeting-images'[\s\S]*false[\s\S]*10485760/);
  assert.match(sql, /Existing Morning Meeting storage bucket is not compliant/);
  assert.match(sql, /bucket_id = 'morning-meeting-images'/);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  assert.doesNotMatch(sql, /public\s*=\s*true/i);
});
