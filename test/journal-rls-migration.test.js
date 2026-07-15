'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  MIGRATION_FILE,
  assertMigrationEnvironment,
  loadMigrationSql,
  runMigration
} = require('../scripts/lib/journal-rls-migration');

const OWNER_ID = '11111111-1111-4111-8111-111111111111';

function environment(overrides) {
  return {
    APP_ENV:'staging',
    STAGING_SEED_CONFIRM:'staging',
    STAGING_DATABASE_PROJECT_REF:'stageproject',
    DATABASE_URL:'postgresql://postgres.stageproject:password@pooler.example.com/postgres',
    SUPABASE_URL:'https://stageproject.supabase.co',
    JOURNAL_LEGACY_OWNER_USER_ID:OWNER_ID,
    PRODUCTION_DATABASE_PROJECT_REF:'productionproject',
    ...overrides
  };
}

class FakeClient {
  constructor(options) {
    this.options = options || {};
    this.calls = [];
    this.migrated = Boolean(this.options.migrated);
  }

  async query(sql, params) {
    this.calls.push({ sql, params });
    if (sql.indexOf("to_regclass('public.daily_market_notes')") >= 0) {
      return { rows:[{ table_name:'daily_market_notes' }] };
    }
    if (sql.indexOf('FROM auth.users') >= 0) {
      return { rows:[{ exists:this.options.ownerExists !== false }] };
    }
    if (sql.indexOf('information_schema.columns') >= 0) {
      if (this.migrated) return { rows:[{ is_nullable:'NO' }] };
      return { rows:this.options.userColumn ? [{ is_nullable:'YES' }] : [] };
    }
    if (sql.indexOf('SELECT note_date FROM public.daily_market_notes') >= 0) {
      return { rows:(this.options.dates || ['2026-07-14', '2026-07-15']).map(note_date => ({ note_date })) };
    }
    if (sql.indexOf('other_owner_rows') >= 0) {
      return { rows:[{
        total_rows:this.options.totalRows === undefined ? 2 : this.options.totalRows,
        null_owner_rows:this.migrated ? 0 : (this.options.nullOwnerRows === undefined ? 2 : this.options.nullOwnerRows),
        other_owner_rows:this.options.otherOwnerRows || 0
      }] };
    }
    if (sql.indexOf('relrowsecurity') >= 0) {
      return { rows:[{
        rls_enabled:true,
        rls_forced:true,
        composite_unique:true,
        legacy_unique_absent:true,
        owner_foreign_key:true,
        policies_ready:this.options.policiesReady !== false,
        anon_table_denied:true,
        authenticated_table_ready:true,
        anon_sequence_denied:true,
        authenticated_sequence_ready:true
      }] };
    }
    if (sql.indexOf("set_config('app.journal_legacy_owner_user_id'") >= 0) {
      return { rows:[{}] };
    }
    if (sql.indexOf('DO $migration$') >= 0) {
      this.migrated = true;
      return { rowCount:0 };
    }
    return { rowCount:0, rows:[] };
  }
}

test('Journal RLS runner rejects unsafe environments and invalid owners', () => {
  assert.throws(() => assertMigrationEnvironment(environment({ APP_ENV:'production' })), /APP_ENV must be staging/);
  assert.throws(() => assertMigrationEnvironment(environment({ STAGING_SEED_CONFIRM:'' })), /STAGING_SEED_CONFIRM/);
  assert.throws(() => assertMigrationEnvironment(environment({ STAGING_DATABASE_PROJECT_REF:'other' })), /does not match/);
  assert.throws(() => assertMigrationEnvironment(environment({ JOURNAL_LEGACY_OWNER_USER_ID:'not-a-uuid' })), /valid UUID/);
  assert.throws(
    () => assertMigrationEnvironment(environment({
      PRODUCTION_DATABASE_PROJECT_REF:'',
      PRODUCTION_DATABASE_URL:'',
      PRODUCTION_SUPABASE_URL:'',
      SUPABASE_PRODUCTION_URL:''
    })),
    /Production project deny-list is required/
  );
  assert.throws(
    () => assertMigrationEnvironment(environment({ PRODUCTION_DATABASE_PROJECT_REF:'stageproject' })),
    /matches Production/
  );
  assert.throws(
    () => assertMigrationEnvironment(environment({ PRODUCTION_SUPABASE_URL:'https://stageproject.supabase.co' })),
    /matches Production/
  );
  assert.throws(
    () => assertMigrationEnvironment(environment({ PRODUCTION_DATABASE_URL:'postgresql://postgres.stageproject:secret@prod-pooler.example.com/postgres' })),
    /matches Production/
  );
});

test('dry run performs only read-only preflight and never loads or executes migration SQL', async () => {
  const client = new FakeClient();
  const result = await runMigration({ client, environment:environment(), dryRun:true });
  assert.equal(result.state, 'first-run');
  assert.equal(client.calls[0].sql, 'BEGIN READ ONLY');
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(client.calls.some(call => call.sql.indexOf('set_config') >= 0), false);
  assert.equal(client.calls.some(call => call.sql.indexOf('DO $migration$') >= 0), false);
  assert.equal(client.calls.some(call => /ALTER TABLE|CREATE POLICY|GRANT /i.test(call.sql)), false);
});

test('runner rejects wrong legacy dates and rolls back', async () => {
  const client = new FakeClient({ dates:['2026-07-14', '2026-07-16'] });
  await assert.rejects(runMigration({ client, environment:environment(), dryRun:true }), /approved dates/);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('runner rejects unexplained prefilled ownership even when two null rows remain', async () => {
  const client = new FakeClient({ userColumn:true, totalRows:3, nullOwnerRows:2 });
  await assert.rejects(runMigration({ client, environment:environment(), dryRun:true }), /partially populated/);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('runner rejects a missing legacy owner before migration SQL', async () => {
  const client = new FakeClient({ ownerExists:false });
  await assert.rejects(runMigration({ client, environment:environment(), dryRun:false, migrationSql:'DO $migration$ BEGIN END $migration$;' }), /owner does not exist/);
  assert.equal(client.calls.some(call => call.sql.indexOf('DO $migration$') >= 0), false);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('runner passes owner UUID only as a parameter in the same transaction', async () => {
  const client = new FakeClient();
  const migrationSql = 'DO $migration$ BEGIN NULL; END $migration$;';
  const result = await runMigration({ client, environment:environment(), dryRun:false, migrationSql });
  assert.equal(result.state, 'migrated');
  const setting = client.calls.find(call => call.sql.indexOf("set_config('app.journal_legacy_owner_user_id'") >= 0);
  assert.deepEqual(setting.params, [OWNER_ID]);
  assert.match(setting.sql, /\$1, true/);
  assert.doesNotMatch(setting.sql, new RegExp(OWNER_ID));
  assert.ok(client.calls.findIndex(call => call === setting) > client.calls.findIndex(call => call.sql === 'BEGIN'));
  assert.ok(client.calls.findIndex(call => call.sql === migrationSql) > client.calls.findIndex(call => call === setting));
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
});

test('runner recognizes the already migrated state without replaying SQL', async () => {
  const client = new FakeClient({ migrated:true });
  const result = await runMigration({ client, environment:environment(), dryRun:false, migrationSql:'SHOULD NOT RUN' });
  assert.equal(result.state, 'migrated');
  assert.equal(client.calls.some(call => call.sql === 'SHOULD NOT RUN'), false);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('runner refuses a partially secured migrated-looking schema', async () => {
  const client = new FakeClient({ migrated:true, policiesReady:false });
  await assert.rejects(
    runMigration({ client, environment:environment(), dryRun:true }),
    /existing ownership state is not recognized/
  );
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('runner is pinned to migration 003 and transaction control remains outside SQL', () => {
  assert.equal(path.basename(MIGRATION_FILE), '003_daily_market_notes_user_rls.sql');
  const sql = loadMigrationSql();
  assert.match(sql, /ADD COLUMN IF NOT EXISTS user_id uuid/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(sql, /\bBEGIN\s*;|\bCOMMIT\s*;/i);
  assert.doesNotMatch(sql, new RegExp(OWNER_ID));
});

test('CLI environment failures are sanitized and occur before database access', () => {
  const marker = 'PASSWORD_TOKEN_SECRET_MARKER';
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'migrate-staging-journal-rls.js')], {
    env:{ APP_ENV:'production', DATABASE_URL:'postgresql://user:' + marker + '@example.com/postgres' },
    encoding:'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Staging Journal RLS migration failed/);
  assert.doesNotMatch(result.stderr, new RegExp(marker));
  assert.doesNotMatch(result.stderr, /postgresql:\/\//);
});
