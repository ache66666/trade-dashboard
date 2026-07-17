'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_FILE = path.join(__dirname, '..', '..', 'sql', '002_production_daily_market_notes_rls.sql');
const EXECUTION_CONFIRMATION = 'production-journal-migration';
const PROJECT_REF_PATTERN = /^[a-z0-9]{8,64}$/i;

const LEGACY_COLUMNS = Object.freeze({
  id:{ type:'bigint', nullable:false, identity:true },
  note_date:{ type:'date', nullable:false },
  thesis:{ type:'text', nullable:false },
  summary:{ type:'text', nullable:false },
  supporting_evidence:{ type:'jsonb', nullable:false, defaultPattern:/^'\[\]'::jsonb$/ },
  opposing_evidence:{ type:'jsonb', nullable:false, defaultPattern:/^'\[\]'::jsonb$/ },
  watchlist:{ type:'jsonb', nullable:false, defaultPattern:/^'\[\]'::jsonb$/ },
  created_at:{ type:'timestamp with time zone', nullable:false, defaultPattern:/^now\(\)$/i },
  updated_at:{ type:'timestamp with time zone', nullable:false, defaultPattern:/^now\(\)$/i }
});

const TARGET_COLUMNS = Object.freeze(Object.assign({}, LEGACY_COLUMNS, {
  user_id:{ type:'uuid', nullable:false }
}));

function databaseTarget(value) {
  let parsed;
  let projectRef = '';
  try {
    parsed = new URL(String(value || ''));
  } catch (error) {
    return { valid:false, projectRef:'', database:'' };
  }
  const directHost = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
  const poolerUser = /^postgres\.([a-z0-9]+)$/i.exec(decodeURIComponent(parsed.username || ''));
  if (directHost) projectRef = directHost[1].toLowerCase();
  if (poolerUser) projectRef = poolerUser[1].toLowerCase();
  return {
    valid:parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:',
    projectRef,
    database:decodeURIComponent(parsed.pathname.replace(/^\//, '') || '')
  };
}

function projectRefFromSupabaseUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
    return match ? match[1].toLowerCase() : '';
  } catch (error) {
    return '';
  }
}

function maskedProjectRef(value) {
  const ref = String(value || '');
  if (ref.length <= 8) return 'configured';
  return `${ref.slice(0, 4)}...${ref.slice(-4)}`;
}

function knownStagingRefs(environment) {
  return [
    environment.STAGING_SUPABASE_PROJECT_REF,
    environment.STAGING_DATABASE_PROJECT_REF,
    projectRefFromSupabaseUrl(environment.STAGING_SUPABASE_URL),
    databaseTarget(environment.STAGING_DATABASE_URL).projectRef
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function assertProductionSafety(environment = process.env, options = {}) {
  const appEnv = String(environment.APP_ENV || '').trim().toLowerCase();
  const allowRef = String(environment.PRODUCTION_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
  const target = databaseTarget(environment.DATABASE_URL);
  if (appEnv !== 'production') {
    throw new Error('Production Journal migration refused: APP_ENV must be production.');
  }
  if (!PROJECT_REF_PATTERN.test(allowRef)) {
    throw new Error('Production Journal migration refused: PRODUCTION_SUPABASE_PROJECT_REF is required.');
  }
  if (!target.valid || !target.projectRef || !target.database) {
    throw new Error('Production Journal migration refused: database target cannot be verified.');
  }
  if (target.projectRef !== allowRef) {
    throw new Error('Production Journal migration refused: database target does not match the Production allow-list.');
  }
  if (knownStagingRefs(environment).includes(target.projectRef)) {
    throw new Error('Production Journal migration refused: target matches a known Staging project.');
  }
  if (options.requireConfirmation === true &&
      environment.PRODUCTION_JOURNAL_MIGRATION_CONFIRM !== EXECUTION_CONFIRMATION) {
    throw new Error('Production Journal migration refused: explicit execution confirmation is required.');
  }
  return {
    environment:'production',
    projectRef:target.projectRef,
    maskedProjectRef:maskedProjectRef(target.projectRef),
    database:target.database
  };
}

function normalizedColumn(row) {
  return {
    name:String(row.column_name),
    type:String(row.data_type),
    nullable:String(row.is_nullable).toUpperCase() === 'YES',
    identity:String(row.is_identity).toUpperCase() === 'YES',
    defaultValue:row.column_default === null || row.column_default === undefined ? '' : String(row.column_default)
  };
}

function columnMismatches(columns, expected) {
  const actual = new Map(columns.map(row => {
    const value = normalizedColumn(row);
    return [value.name, value];
  }));
  const mismatches = [];
  for (const [name, definition] of Object.entries(expected)) {
    const value = actual.get(name);
    if (!value) mismatches.push(`missing-column:${name}`);
    else {
      if (value.type !== definition.type) mismatches.push(`column-type:${name}`);
      if (value.nullable !== definition.nullable) mismatches.push(`column-nullability:${name}`);
      if (definition.identity === true && value.identity !== true) mismatches.push(`column-identity:${name}`);
      if (definition.defaultPattern && !definition.defaultPattern.test(value.defaultValue)) mismatches.push(`column-default:${name}`);
    }
  }
  for (const name of actual.keys()) {
    if (!Object.prototype.hasOwnProperty.call(expected, name)) mismatches.push(`unexpected-column:${name}`);
  }
  return mismatches;
}

const REQUIRED_CHECKS = Object.freeze([
  'daily_market_notes_thesis_check',
  'daily_market_notes_summary_length_check',
  'daily_market_notes_supporting_array_check',
  'daily_market_notes_opposing_array_check',
  'daily_market_notes_watchlist_array_check'
]);

function sharedStructureMismatches(snapshot) {
  const mismatches = [];
  const constraints = snapshot.constraints || [];
  const indexes = snapshot.indexes || [];
  const hasNamedConstraint = (name, type) => constraints.some(item => item.name === name && item.type === type);
  if (!hasNamedConstraint('daily_market_notes_pkey', 'PRIMARY KEY')) mismatches.push('constraint:primary-key');
  for (const name of REQUIRED_CHECKS) {
    if (!hasNamedConstraint(name, 'CHECK')) mismatches.push(`constraint:${name}`);
  }
  if (!indexes.some(item => item.name === 'daily_market_notes_updated_at_idx' &&
      /\(updated_at DESC\)/i.test(String(item.definition)))) {
    mismatches.push('index:updated-at');
  }
  return mismatches;
}

function legacyStructureMismatches(snapshot) {
  const mismatches = columnMismatches(snapshot.columns, LEGACY_COLUMNS).concat(sharedStructureMismatches(snapshot));
  const constraints = snapshot.constraints || [];
  if (!constraints.some(item => item.type === 'UNIQUE' && /^UNIQUE \(note_date\)$/i.test(String(item.definition)))) {
    mismatches.push('constraint:legacy-date-unique');
  }
  return mismatches;
}

function policyReady(policy, command) {
  if (!policy || String(policy.cmd).toUpperCase() !== command) return false;
  const roles = Array.isArray(policy.roles) ? policy.roles : [];
  const using = String(policy.qual || '').replace(/[()\s]/g, '');
  const check = String(policy.with_check || '').replace(/[()\s]/g, '');
  if (!roles.includes('authenticated')) return false;
  if (command === 'SELECT' || command === 'DELETE') return using === 'auth.uid=user_id' || using === 'auth.uid()=user_id';
  if (command === 'INSERT') return check === 'auth.uid=user_id' || check === 'auth.uid()=user_id';
  return (using === 'auth.uid=user_id' || using === 'auth.uid()=user_id') &&
    (check === 'auth.uid=user_id' || check === 'auth.uid()=user_id');
}

function targetMismatches(snapshot) {
  const mismatches = columnMismatches(snapshot.columns, TARGET_COLUMNS).concat(sharedStructureMismatches(snapshot));
  const constraints = snapshot.constraints || [];
  const policies = snapshot.policies || [];
  const tableGrants = snapshot.tableGrants || [];
  const sequenceGrants = snapshot.sequenceGrants || [];
  const relation = snapshot.relation || {};
  const roleAttributes = snapshot.roleAttributes || [];
  const hasConstraint = (type, pattern) => constraints.some(item => item.type === type && pattern.test(String(item.definition)));
  const hasGrant = (grants, role, privilege) => grants.some(item => item.grantee === role && item.privilege === privilege);

  if (!hasConstraint('UNIQUE', /^UNIQUE \(user_id, note_date\)$/i)) mismatches.push('constraint:user-date-unique');
  if (hasConstraint('UNIQUE', /^UNIQUE \(note_date\)$/i)) mismatches.push('constraint:legacy-date-unique');
  if (!hasConstraint('FOREIGN KEY', /^FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE RESTRICT$/i)) {
    mismatches.push('constraint:user-foreign-key');
  }
  if (relation.rls_enabled !== true) mismatches.push('rls:disabled');
  if (relation.rls_forced !== true) mismatches.push('rls:not-forced');
  if (['anon', 'authenticated', 'service_role'].includes(String(relation.owner || ''))) {
    mismatches.push('ownership:unsafe-table-owner');
  }
  for (const role of roleAttributes) {
    if (['anon', 'authenticated'].includes(role.name) && role.bypass_rls === true) {
      mismatches.push(`role:${role.name}-bypassrls`);
    }
  }
  const expectedPolicies = [
    ['daily_market_notes_select_own', 'SELECT'],
    ['daily_market_notes_insert_own', 'INSERT'],
    ['daily_market_notes_update_own', 'UPDATE'],
    ['daily_market_notes_delete_own', 'DELETE']
  ];
  for (const [name, command] of expectedPolicies) {
    if (!policyReady(policies.find(item => item.name === name), command)) mismatches.push(`policy:${name}`);
  }
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    if (hasGrant(tableGrants, 'anon', privilege)) mismatches.push(`grant:anon-${privilege.toLowerCase()}`);
    if (!hasGrant(tableGrants, 'authenticated', privilege)) mismatches.push(`grant:authenticated-${privilege.toLowerCase()}`);
  }
  if (hasGrant(sequenceGrants, 'anon', 'USAGE')) mismatches.push('grant:anon-sequence');
  if (!hasGrant(sequenceGrants, 'authenticated', 'USAGE')) mismatches.push('grant:authenticated-sequence');
  return mismatches;
}

function classifySnapshot(snapshot) {
  if (snapshot.tableExists !== true) {
    return { state:'table-absent', executable:true, recordCount:0, mismatches:[] };
  }
  const count = Number(snapshot.recordCount || 0);
  const hasUserId = snapshot.columns.some(row => row.column_name === 'user_id');
  if (!hasUserId) {
    const legacyIssues = legacyStructureMismatches(snapshot);
    if (legacyIssues.length > 0) {
      return { state:'partially-migrated', executable:false, recordCount:count, mismatches:legacyIssues };
    }
    if (count === 0) return { state:'legacy-empty', executable:true, recordCount:0, mismatches:[] };
    return {
      state:'legacy-with-data', executable:false, recordCount:count,
      firstDate:snapshot.firstDate || null, lastDate:snapshot.lastDate || null,
      mismatches:['ownership-mapping-required']
    };
  }
  const mismatches = targetMismatches(snapshot);
  if (Number(snapshot.nullOwnerCount || 0) > 0) mismatches.unshift('data:null-user-id');
  if (mismatches.length > 0) {
    return { state:'partially-migrated', executable:false, recordCount:count, mismatches:[...new Set(mismatches)] };
  }
  return { state:'target-compliant', executable:false, recordCount:count, mismatches:[] };
}

async function inspectMigrationState(client) {
  const table = await client.query("SELECT to_regclass('public.daily_market_notes') AS table_name");
  if (!table.rows[0] || !table.rows[0].table_name) return classifySnapshot({ tableExists:false, columns:[] });
  const columns = await client.query(
    `SELECT column_name, data_type, is_nullable, is_identity, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='daily_market_notes'
      ORDER BY ordinal_position`
  );
  const counts = await client.query(
    `SELECT count(*)::bigint AS record_count,
            min(note_date)::text AS first_date,
            max(note_date)::text AS last_date
       FROM public.daily_market_notes`
  );
  const base = {
    tableExists:true,
    columns:columns.rows,
    recordCount:Number(counts.rows[0].record_count),
    firstDate:counts.rows[0].first_date,
    lastDate:counts.rows[0].last_date
  };
  const constraints = await client.query(
    `SELECT con.conname AS name,
            CASE con.contype
              WHEN 'p' THEN 'PRIMARY KEY'
              WHEN 'u' THEN 'UNIQUE'
              WHEN 'f' THEN 'FOREIGN KEY'
              WHEN 'c' THEN 'CHECK'
              ELSE con.contype::text
            END AS type,
            pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
      WHERE con.conrelid='public.daily_market_notes'::regclass`
  );
  const indexes = await client.query(
    `SELECT indexname AS name, indexdef AS definition
       FROM pg_indexes
      WHERE schemaname='public' AND tablename='daily_market_notes'`
  );
  base.constraints = constraints.rows;
  base.indexes = indexes.rows;
  if (!columns.rows.some(row => row.column_name === 'user_id')) return classifySnapshot(base);

  const ownership = await client.query(
    'SELECT count(*) FILTER (WHERE user_id IS NULL)::bigint AS null_owner_count FROM public.daily_market_notes'
  );
  const relation = await client.query(
    `SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
            owner_role.rolname AS owner
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_roles owner_role ON owner_role.oid=c.relowner
      WHERE n.nspname='public' AND c.relname='daily_market_notes'`
  );
  const roleAttributes = await client.query(
    `SELECT rolname AS name, rolbypassrls AS bypass_rls
       FROM pg_roles WHERE rolname IN ('anon','authenticated')`
  );
  const policies = await client.query(
    `SELECT policyname AS name, cmd, roles, qual, with_check
       FROM pg_policies WHERE schemaname='public' AND tablename='daily_market_notes'`
  );
  const tableGrants = await client.query(
    `SELECT grantee, privilege_type AS privilege
       FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name='daily_market_notes'
        AND grantee IN ('anon','authenticated')`
  );
  const sequenceGrants = await client.query(
    `SELECT grantee, privilege_type AS privilege
       FROM information_schema.role_usage_grants
      WHERE object_schema='public' AND object_name='daily_market_notes_id_seq'
        AND grantee IN ('anon','authenticated')`
  );
  return classifySnapshot(Object.assign(base, {
    nullOwnerCount:Number(ownership.rows[0].null_owner_count),
    relation:relation.rows[0] || {}, roleAttributes:roleAttributes.rows, policies:policies.rows,
    tableGrants:tableGrants.rows, sequenceGrants:sequenceGrants.rows
  }));
}

function loadMigrationSql() {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  if (/\bBEGIN\s*;|\bCOMMIT\s*;/i.test(sql)) {
    throw new Error('Production Journal migration refused: transaction control must remain in the runner.');
  }
  if (/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(sql)) {
    throw new Error('Production Journal migration refused: destructive SQL is not allowed.');
  }
  return sql;
}

async function runProductionMigration(options) {
  const environment = options.environment || process.env;
  const dryRun = options.dryRun === true;
  const target = assertProductionSafety(environment, { requireConfirmation:!dryRun });
  const client = options.client;
  await client.query(dryRun ? 'BEGIN READ ONLY' : 'BEGIN');
  try {
    const inspectState = options.inspectState || inspectMigrationState;
    const preflight = await inspectState(client);
    if (dryRun) {
      await client.query('ROLLBACK');
      return { mode:'dry-run', status:preflight.state === 'target-compliant' ? 'already-compliant' : preflight.executable ? 'executable' : 'stopped', target, preflight };
    }
    if (preflight.state === 'target-compliant') {
      await client.query('ROLLBACK');
      return { mode:'executable', status:'already-compliant', target, preflight };
    }
    if (!preflight.executable) {
      await client.query('ROLLBACK');
      return { mode:'executable', status:'stopped', target, preflight };
    }
    await client.query(options.migrationSql === undefined ? loadMigrationSql() : options.migrationSql);
    const verification = await inspectState(client);
    if (verification.state !== 'target-compliant') {
      throw new Error('Production Journal migration verification failed.');
    }
    await client.query('COMMIT');
    return { mode:'executable', status:'migrated', target, preflight, verification };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { /* retain original error */ }
    throw error;
  }
}

module.exports = {
  EXECUTION_CONFIRMATION,
  LEGACY_COLUMNS,
  MIGRATION_FILE,
  TARGET_COLUMNS,
  REQUIRED_CHECKS,
  assertProductionSafety,
  classifySnapshot,
  databaseTarget,
  inspectMigrationState,
  loadMigrationSql,
  maskedProjectRef,
  runProductionMigration,
  targetMismatches
};
