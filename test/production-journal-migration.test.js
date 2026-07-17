'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = require('../scripts/lib/production-journal-migration');
const cli = require('../scripts/migrate-production-journal');

const root = path.resolve(__dirname, '..');
const productionRef = 'prodref123456';
const productionUrl = `postgresql://postgres.${productionRef}@aws-0-region.pooler.supabase.com:6543/postgres`;

function environment(overrides) {
  return Object.assign({
    APP_ENV:'production',
    NODE_ENV:'test',
    ALLOW_MIGRATION_TEST_OVERRIDES:'true',
    DATABASE_URL:productionUrl,
    SUPABASE_URL:`https://${productionRef}.supabase.co`,
    PRODUCTION_SUPABASE_PROJECT_REF:productionRef,
    STAGING_SUPABASE_PROJECT_REF:'stagingref1234'
  }, overrides || {});
}

function columns(includeUser) {
  const result = Object.entries(migration.LEGACY_COLUMNS).map(([name, definition]) => ({
    column_name:name,
    data_type:definition.type,
    is_nullable:definition.nullable ? 'YES' : 'NO',
    is_identity:definition.identity ? 'YES' : 'NO',
    column_default:definition.defaultPattern ? (name.endsWith('_at') ? 'now()' : "'[]'::jsonb") : null
  }));
  if (includeUser) result.push({ column_name:'user_id', data_type:'uuid', is_nullable:'NO', is_identity:'NO', column_default:null });
  return result;
}

function constraints(target) {
  const result = [
    { name:'daily_market_notes_pkey', type:'PRIMARY KEY', definition:'PRIMARY KEY (id)' },
    { name:'daily_market_notes_thesis_check', type:'CHECK', definition:"CHECK (thesis IN ('流动性','货币政策','通胀','经济增长','风险偏好','地缘政治','财政','技术性因素','暂无明确主线'))" },
    { name:'daily_market_notes_summary_length_check', type:'CHECK', definition:'CHECK (char_length(summary) BETWEEN 1 AND 200)' },
    { name:'daily_market_notes_supporting_array_check', type:'CHECK', definition:"CHECK (jsonb_typeof(supporting_evidence) = 'array')" },
    { name:'daily_market_notes_opposing_array_check', type:'CHECK', definition:"CHECK (jsonb_typeof(opposing_evidence) = 'array')" },
    { name:'daily_market_notes_watchlist_array_check', type:'CHECK', definition:"CHECK (jsonb_typeof(watchlist) = 'array' AND jsonb_array_length(watchlist) <= 3)" }
  ];
  if (target) {
    result.push({ name:'daily_market_notes_user_date_key', type:'UNIQUE', definition:'UNIQUE (user_id, note_date)' });
    result.push({ name:'daily_market_notes_user_id_fkey', type:'FOREIGN KEY', definition:'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT' });
  } else {
    result.push({ name:'daily_market_notes_note_date_key', type:'UNIQUE', definition:'UNIQUE (note_date)' });
  }
  return result;
}

function policies() {
  return [
    { name:'daily_market_notes_select_own', cmd:'SELECT', roles:['authenticated'], qual:'(auth.uid() = user_id)', with_check:null },
    { name:'daily_market_notes_insert_own', cmd:'INSERT', roles:['authenticated'], qual:null, with_check:'(auth.uid() = user_id)' },
    { name:'daily_market_notes_update_own', cmd:'UPDATE', roles:['authenticated'], qual:'(auth.uid() = user_id)', with_check:'(auth.uid() = user_id)' },
    { name:'daily_market_notes_delete_own', cmd:'DELETE', roles:['authenticated'], qual:'(auth.uid() = user_id)', with_check:null }
  ];
}

function targetSnapshot(overrides) {
  return Object.assign({
    tableExists:true,
    columns:columns(true),
    constraints:constraints(true),
    indexes:[{ name:'daily_market_notes_updated_at_idx', definition:'CREATE INDEX daily_market_notes_updated_at_idx ON public.daily_market_notes USING btree (updated_at DESC)' }],
    recordCount:0,
    nullOwnerCount:0,
    relation:{ rls_enabled:true, rls_forced:true, owner:'postgres' },
    roleAttributes:[
      { name:'anon', bypass_rls:false },
      { name:'authenticated', bypass_rls:false }
    ],
    policies:policies(),
    tableGrants:['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map(privilege => ({ grantee:'authenticated', privilege })),
    sequenceGrants:[{ grantee:'authenticated', privilege:'USAGE' }]
  }, overrides || {});
}

function legacySnapshot(count) {
  return {
    tableExists:true,
    columns:columns(false),
    constraints:constraints(false),
    indexes:[{ name:'daily_market_notes_updated_at_idx', definition:'CREATE INDEX daily_market_notes_updated_at_idx ON public.daily_market_notes USING btree (updated_at DESC)' }],
    recordCount:count,
    firstDate:count ? '2042-02-03' : null,
    lastDate:count ? '2042-07-08' : null
  };
}

test('safety gate requires the Production environment', () => {
  assert.throws(() => migration.assertProductionSafety(environment({ APP_ENV:'staging' })), /APP_ENV/);
});

test('safety gate requires an explicit Production project allow-list', () => {
  assert.throws(() => migration.assertProductionSafety(environment({ PRODUCTION_SUPABASE_PROJECT_REF:'' })), /PROJECT_REF/);
});

test('safety gate rejects an unverifiable database target', () => {
  assert.throws(() => migration.assertProductionSafety(environment({ DATABASE_URL:'not-a-url' })), /cannot be verified/);
  assert.throws(() => migration.assertProductionSafety(environment({
    DATABASE_URL:`postgresql://postgres.${productionRef}@untrusted.example:6543/postgres`
  })), /cannot be verified/);
});

test('safety gate rejects a database outside the Production allow-list', () => {
  assert.throws(() => migration.assertProductionSafety(environment({ PRODUCTION_SUPABASE_PROJECT_REF:'differentref' })), /allow-list/);
});

test('safety gate requires the Production Supabase URL to match the allow-list', () => {
  assert.throws(() => migration.assertProductionSafety(environment({ SUPABASE_URL:'' })), /allow-list/);
  assert.throws(() => migration.assertProductionSafety(environment({
    SUPABASE_URL:'https://differentref.supabase.co'
  })), /allow-list/);
  assert.throws(() => migration.assertProductionSafety(environment({
    SUPABASE_URL:`http://${productionRef}.supabase.co/path`
  })), /allow-list/);
});

test('safety gate requires a consistent, explicit Staging deny-list', () => {
  assert.throws(() => migration.assertProductionSafety(environment({ STAGING_SUPABASE_PROJECT_REF:'' })), /deny-list/);
  assert.throws(() => migration.assertProductionSafety(environment({
    STAGING_DATABASE_PROJECT_REF:'differentstagingref'
  })), /inconsistent/);
  assert.throws(() => migration.assertProductionSafety(environment({
    STAGING_SUPABASE_URL:'not-a-url'
  })), /Staging URL/);
});

test('safety gate rejects any known Staging target', () => {
  assert.throws(() => migration.assertProductionSafety(environment({ STAGING_SUPABASE_PROJECT_REF:productionRef })), /known Staging/);
});

test('dry-run safety does not require formal confirmation', () => {
  const target = migration.assertProductionSafety(environment(), { requireConfirmation:false });
  assert.equal(target.projectRef, productionRef);
  assert.notEqual(target.maskedProjectRef, productionRef);
});

test('formal safety requires the exact confirmation phrase', () => {
  assert.throws(() => migration.assertProductionSafety(environment(), { requireConfirmation:true }), /confirmation/);
  assert.doesNotThrow(() => migration.assertProductionSafety(environment({
    PRODUCTION_JOURNAL_MIGRATION_CONFIRM:migration.EXECUTION_CONFIRMATION
  }), { requireConfirmation:true }));
});

test('table absence is executable', () => {
  assert.deepEqual(migration.classifySnapshot({ tableExists:false, columns:[] }), {
    state:'table-absent', executable:true, recordCount:0, mismatches:[]
  });
});

test('unknown inspection state and missing counts fail closed', () => {
  assert.equal(migration.classifySnapshot({}).state, 'partially-migrated');
  const missingCount = legacySnapshot(0);
  delete missingCount.recordCount;
  const result = migration.classifySnapshot(missingCount);
  assert.ok(result.mismatches.includes('inspection:record-count'));
});

test('recognized empty legacy schema is executable', () => {
  assert.equal(migration.classifySnapshot(legacySnapshot(0)).state, 'legacy-empty');
});

test('legacy rows require an explicit ownership plan regardless of count or date', () => {
  const result = migration.classifySnapshot(legacySnapshot(7));
  assert.equal(result.state, 'legacy-with-data');
  assert.equal(result.executable, false);
  assert.equal(result.firstDate, '2042-02-03');
  assert.deepEqual(result.mismatches, ['ownership-mapping-required']);
});

test('unrecognized legacy structure is classified as partially migrated', () => {
  const snapshot = legacySnapshot(0);
  snapshot.constraints = snapshot.constraints.filter(item => item.name !== 'daily_market_notes_summary_length_check');
  const result = migration.classifySnapshot(snapshot);
  assert.equal(result.state, 'partially-migrated');
  assert.ok(result.mismatches.includes('constraint:daily_market_notes_summary_length_check'));
});

test('named constraints with incorrect definitions are rejected', () => {
  const snapshot = legacySnapshot(0);
  snapshot.constraints = snapshot.constraints.map(item => item.name === 'daily_market_notes_summary_length_check'
    ? Object.assign({}, item, { definition:'CHECK (char_length(summary) >= 0)' })
    : item);
  const result = migration.classifySnapshot(snapshot);
  assert.equal(result.state, 'partially-migrated');
  assert.ok(result.mismatches.includes('constraint:daily_market_notes_summary_length_check'));
});

test('unknown legacy constraints fail closed', () => {
  const snapshot = legacySnapshot(0);
  snapshot.constraints.push({ name:'unexpected_constraint', type:'CHECK', definition:'CHECK (true)' });
  const result = migration.classifySnapshot(snapshot);
  assert.ok(result.mismatches.includes('constraint:unexpected-definition'));
});

test('fully secured target is compliant', () => {
  assert.equal(migration.classifySnapshot(targetSnapshot()).state, 'target-compliant');
});

test('compliance is based on real definitions rather than generated object names', () => {
  const snapshot = targetSnapshot();
  snapshot.constraints = snapshot.constraints.map((item, index) => Object.assign({}, item, { name:`verified_constraint_${index}` }));
  snapshot.policies = snapshot.policies.map((item, index) => Object.assign({}, item, { name:`verified_policy_${index}` }));
  snapshot.indexes = snapshot.indexes.map(item => Object.assign({}, item, { name:'verified_updated_at_index' }));
  assert.equal(migration.classifySnapshot(snapshot).state, 'target-compliant');
});

test('null ownership makes a target partial', () => {
  const result = migration.classifySnapshot(targetSnapshot({ recordCount:1, nullOwnerCount:1 }));
  assert.equal(result.state, 'partially-migrated');
  assert.ok(result.mismatches.includes('data:null-user-id'));
});

test('missing FORCE RLS or an own-row policy makes a target partial', () => {
  const missingPolicy = policies().slice(0, 3);
  const result = migration.classifySnapshot(targetSnapshot({
    relation:{ rls_enabled:true, rls_forced:false, owner:'postgres' }, policies:missingPolicy
  }));
  assert.ok(result.mismatches.includes('rls:not-forced'));
  assert.ok(result.mismatches.includes('policy:daily_market_notes_delete_own'));
});

test('policies with extra roles or incomplete predicates are rejected', () => {
  const unsafePolicies = policies();
  unsafePolicies[0] = Object.assign({}, unsafePolicies[0], { roles:['authenticated', 'anon'] });
  unsafePolicies[2] = Object.assign({}, unsafePolicies[2], { with_check:null });
  unsafePolicies.push({ name:'unexpected_allow_all', cmd:'SELECT', roles:['authenticated'], qual:'true', with_check:null });
  const result = migration.classifySnapshot(targetSnapshot({ policies:unsafePolicies }));
  assert.ok(result.mismatches.includes('policy:daily_market_notes_select_own'));
  assert.ok(result.mismatches.includes('policy:daily_market_notes_update_own'));
  assert.ok(result.mismatches.includes('policy:unexpected-definition'));
});

test('unsafe ownership or user-facing BYPASSRLS makes a target partial', () => {
  const result = migration.classifySnapshot(targetSnapshot({
    relation:{ rls_enabled:true, rls_forced:true, owner:'authenticated' },
    roleAttributes:[{ name:'authenticated', bypass_rls:true }]
  }));
  assert.ok(result.mismatches.includes('ownership:unsafe-table-owner'));
  assert.ok(result.mismatches.includes('role:authenticated-bypassrls'));
});

test('missing RLS role metadata fails closed', () => {
  const result = migration.classifySnapshot(targetSnapshot({ roleAttributes:[] }));
  assert.ok(result.mismatches.includes('role:anon-missing'));
  assert.ok(result.mismatches.includes('role:authenticated-missing'));
});

test('anon grants and missing authenticated grants are rejected', () => {
  const result = migration.classifySnapshot(targetSnapshot({
    tableGrants:[{ grantee:'anon', privilege:'SELECT' }],
    sequenceGrants:[{ grantee:'anon', privilege:'USAGE' }]
  }));
  assert.ok(result.mismatches.includes('grant:anon-table'));
  assert.ok(result.mismatches.includes('grant:authenticated-insert'));
  assert.ok(result.mismatches.includes('grant:anon-sequence'));
});

test('extra authenticated, service-role and public grants are rejected', () => {
  const result = migration.classifySnapshot(targetSnapshot({
    tableGrants:[
      ...['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].map(privilege => ({ grantee:'authenticated', privilege })),
      { grantee:'service_role', privilege:'SELECT' },
      { grantee:'PUBLIC', privilege:'SELECT' }
    ],
    sequenceGrants:[
      { grantee:'authenticated', privilege:'USAGE' },
      { grantee:'authenticated', privilege:'UPDATE' },
      { grantee:'service_role', privilege:'USAGE' },
      { grantee:'PUBLIC', privilege:'USAGE' }
    ]
  }));
  assert.ok(result.mismatches.includes('grant:authenticated-extra-truncate'));
  assert.ok(result.mismatches.includes('grant:service-role-table'));
  assert.ok(result.mismatches.includes('grant:public-table'));
  assert.ok(result.mismatches.includes('grant:service-role-sequence'));
  assert.ok(result.mismatches.includes('grant:public-sequence'));
});

test('dry-run uses a read-only transaction and always rolls back', async () => {
  const queries = [];
  const client = { query:async sql => { queries.push(sql); return { rows:[] }; } };
  const result = await migration.runProductionMigration({
    client, dryRun:true, environment:environment(), inspectState:async () => migration.classifySnapshot(legacySnapshot(0))
  });
  assert.equal(result.status, 'executable');
  assert.deepEqual(queries, ['BEGIN READ ONLY', 'ROLLBACK']);
});

test('dry-run rolls back when read-only inspection fails', async () => {
  const queries = [];
  await assert.rejects(migration.runProductionMigration({
    client:{ query:async sql => { queries.push(sql); return { rows:[] }; } },
    dryRun:true,
    environment:environment(),
    inspectState:async () => { throw new Error('synthetic inspection failure'); }
  }), /synthetic inspection failure/);
  assert.deepEqual(queries, ['BEGIN READ ONLY', 'ROLLBACK']);
});

test('formal execution refuses missing confirmation before opening a transaction', async () => {
  const queries = [];
  await assert.rejects(migration.runProductionMigration({
    client:{ query:async sql => queries.push(sql) }, dryRun:false, environment:environment()
  }), /confirmation/);
  assert.deepEqual(queries, []);
});

test('formal execution applies SQL once and commits only after target verification', async () => {
  const queries = [];
  let inspection = 0;
  const result = await migration.runProductionMigration({
    client:{ query:async sql => { queries.push(sql); return { rows:[] }; } },
    dryRun:false,
    environment:environment({ PRODUCTION_JOURNAL_MIGRATION_CONFIRM:migration.EXECUTION_CONFIRMATION }),
    migrationSql:'SELECT 1 AS migration_body',
    inspectState:async () => inspection++ === 0 ? migration.classifySnapshot({ tableExists:false, columns:[] }) : migration.classifySnapshot(targetSnapshot())
  });
  assert.equal(result.status, 'migrated');
  assert.deepEqual(queries, ['BEGIN', 'SELECT pg_advisory_xact_lock(749131, 3003)', 'SELECT 1 AS migration_body', 'COMMIT']);
});

test('formal legacy upgrade locks the table and rechecks the empty state before DDL', async () => {
  const queries = [];
  let inspection = 0;
  const states = [
    migration.classifySnapshot(legacySnapshot(0)),
    migration.classifySnapshot(legacySnapshot(0)),
    migration.classifySnapshot(targetSnapshot())
  ];
  const result = await migration.runProductionMigration({
    client:{ query:async sql => { queries.push(sql); return { rows:[] }; } },
    dryRun:false,
    environment:environment({ PRODUCTION_JOURNAL_MIGRATION_CONFIRM:migration.EXECUTION_CONFIRMATION }),
    migrationSql:'SELECT 1 AS migration_body',
    inspectState:async () => states[inspection++]
  });
  assert.equal(result.status, 'migrated');
  assert.deepEqual(queries, [
    'BEGIN',
    'SELECT pg_advisory_xact_lock(749131, 3003)',
    'LOCK TABLE public.daily_market_notes IN ACCESS EXCLUSIVE MODE',
    'SELECT 1 AS migration_body',
    'COMMIT'
  ]);
});

test('formal legacy upgrade rolls back if the locked state changed', async () => {
  const queries = [];
  const states = [migration.classifySnapshot(legacySnapshot(0)), migration.classifySnapshot(legacySnapshot(1))];
  await assert.rejects(migration.runProductionMigration({
    client:{ query:async sql => { queries.push(sql); return { rows:[] }; } },
    dryRun:false,
    environment:environment({ PRODUCTION_JOURNAL_MIGRATION_CONFIRM:migration.EXECUTION_CONFIRMATION }),
    migrationSql:'SHOULD NOT RUN',
    inspectState:async () => states.shift()
  }), /state changed/);
  assert.equal(queries.includes('SHOULD NOT RUN'), false);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('formal execution rolls back stopped and already-compliant states without applying SQL', async () => {
  for (const snapshot of [legacySnapshot(3), targetSnapshot()]) {
    const queries = [];
    const result = await migration.runProductionMigration({
      client:{ query:async sql => { queries.push(sql); return { rows:[] }; } },
      dryRun:false,
      environment:environment({ PRODUCTION_JOURNAL_MIGRATION_CONFIRM:migration.EXECUTION_CONFIRMATION }),
      migrationSql:'SHOULD NOT RUN',
      inspectState:async () => migration.classifySnapshot(snapshot)
    });
    assert.deepEqual(queries, ['BEGIN', 'SELECT pg_advisory_xact_lock(749131, 3003)', 'ROLLBACK']);
    assert.ok(['stopped', 'already-compliant'].includes(result.status));
  }
});

test('formal execution rolls back when SQL or verification fails', async () => {
  const queries = [];
  await assert.rejects(migration.runProductionMigration({
    client:{ query:async sql => {
      queries.push(sql);
      if (sql === 'BROKEN SQL') throw new Error('synthetic failure');
      return { rows:[] };
    } },
    dryRun:false,
    environment:environment({ PRODUCTION_JOURNAL_MIGRATION_CONFIRM:migration.EXECUTION_CONFIRMATION }),
    migrationSql:'BROKEN SQL',
    inspectState:async () => migration.classifySnapshot({ tableExists:false, columns:[] })
  }), /synthetic failure/);
  assert.deepEqual(queries, ['BEGIN', 'SELECT pg_advisory_xact_lock(749131, 3003)', 'BROKEN SQL', 'ROLLBACK']);
});

test('failed post-migration verification rolls back instead of committing', async () => {
  const queries = [];
  let inspection = 0;
  await assert.rejects(migration.runProductionMigration({
    client:{ query:async sql => { queries.push(sql); return { rows:[] }; } },
    dryRun:false,
    environment:environment({ PRODUCTION_JOURNAL_MIGRATION_CONFIRM:migration.EXECUTION_CONFIRMATION }),
    migrationSql:'SELECT 1 AS migration_body',
    inspectState:async () => inspection++ === 0
      ? migration.classifySnapshot({ tableExists:false, columns:[] })
      : migration.classifySnapshot(targetSnapshot({ relation:{ rls_enabled:true, rls_forced:false, owner:'postgres' } }))
  }), /verification failed/);
  assert.equal(queries.includes('COMMIT'), false);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('SQL body contains final ownership, constraints, RLS, policies and least privilege grants', () => {
  const sql = migration.loadMigrationSql();
  assert.match(sql, /user_id uuid NOT NULL/i);
  assert.match(sql, /IF to_regclass\('public\.daily_market_notes'\) IS NULL THEN\s+CREATE TABLE public\.daily_market_notes/i);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS public\.daily_market_notes/i);
  assert.match(sql, /UNIQUE \(user_id, note_date\)/i);
  assert.match(sql, /REFERENCES auth\.users\(id\) ON DELETE RESTRICT/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
  assert.equal((sql.match(/CREATE POLICY/g) || []).length, 4);
  assert.match(sql, /WITH CHECK \(auth\.uid\(\) = user_id\)/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.daily_market_notes FROM anon/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.daily_market_notes FROM service_role/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.daily_market_notes FROM PUBLIC/i);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE/i);
});

test('SQL body and runner reject destructive operations, seeds and transaction nesting', () => {
  const sql = fs.readFileSync(migration.MIGRATION_FILE, 'utf8');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bBEGIN\s*;|\bCOMMIT\s*;/i);
  assert.doesNotMatch(sql, /2026-07-1[45]|JOURNAL_LEGACY_OWNER_USER_ID|UPDATE\s+public\.daily_market_notes/i);
});

test('CLI accepts only dry-run and returns a sanitized report', () => {
  assert.deepEqual(cli.parseArguments(['--dry-run']), { dryRun:true });
  assert.throws(() => cli.parseArguments(['--force']), /Unknown/);
  const report = cli.safeReport({
    mode:'dry-run', status:'stopped', target:{ environment:'production', maskedProjectRef:'prod...3456', database:'postgres' },
    preflight:{ state:'legacy-with-data', recordCount:2, firstDate:'2040-01-01', lastDate:'2040-01-02', executable:false, mismatches:['ownership-mapping-required'] }
  });
  assert.equal(report.project, 'prod...3456');
  assert.equal(JSON.stringify(report).includes('postgresql://'), false);
  assert.deepEqual(report.dateRange, { first:'2040-01-01', last:'2040-01-02' });
  assert.match(report.nextAction, /^Stop/);
});

test('CLI validates the target before importing the database connection module', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/migrate-production-journal.js'), 'utf8');
  assert.ok(source.indexOf('assertProductionSafety(process.env') < source.indexOf("require('../database')"));
});

test('CLI sanitizes unexpected database and network errors', () => {
  const sanitized = cli.safeErrorMessage(new Error('connection failed at sensitive.internal with credential details'));
  assert.match(sanitized, /could not be confirmed/);
  assert.doesNotMatch(sanitized, /sensitive|credential/);
});

test('Batch 3A does not introduce Journal runtime, UI, workflow, seed or Staging runner files', () => {
  for (const file of [
    'journal.js', 'supabase-data.js', 'public/journal.js', 'public/journal.css',
    'scripts/seed-staging.js', 'scripts/run-staging-migration.js'
  ]) assert.equal(fs.existsSync(path.join(root, file)), false, file);
  assert.equal(fs.readFileSync(path.join(root, '.github/workflows/production.yml'), 'utf8').includes('journal:migration'), false);
});
