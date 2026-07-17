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
  const poolerHost = /\.pooler\.supabase\.com$/i.test(parsed.hostname);
  if (directHost) projectRef = directHost[1].toLowerCase();
  if (poolerUser && poolerHost) projectRef = poolerUser[1].toLowerCase();
  return {
    valid:(parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') && Boolean(directHost || (poolerUser && poolerHost)),
    projectRef,
    database:decodeURIComponent(parsed.pathname.replace(/^\//, '') || '')
  };
}

function projectRefFromSupabaseUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
    const cleanPath = parsed.pathname === '' || parsed.pathname === '/';
    return match && parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      cleanPath && !parsed.search && !parsed.hash ? match[1].toLowerCase() : '';
  } catch (error) {
    return '';
  }
}

function maskedProjectRef(value) {
  const ref = String(value || '');
  if (ref.length <= 8) return 'configured';
  return `${ref.slice(0, 4)}...${ref.slice(-4)}`;
}

function verifiedStagingRefs(environment) {
  const configuredRef = String(environment.STAGING_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
  if (!PROJECT_REF_PATTERN.test(configuredRef)) {
    throw new Error('Production Journal migration refused: STAGING_SUPABASE_PROJECT_REF deny-list is required.');
  }
  const candidates = [configuredRef];
  const explicitDatabaseRef = String(environment.STAGING_DATABASE_PROJECT_REF || '').trim().toLowerCase();
  if (explicitDatabaseRef) candidates.push(explicitDatabaseRef);
  if (environment.STAGING_SUPABASE_URL) {
    const urlRef = projectRefFromSupabaseUrl(environment.STAGING_SUPABASE_URL);
    if (!urlRef) throw new Error('Production Journal migration refused: Staging URL cannot be verified.');
    candidates.push(urlRef);
  }
  if (environment.STAGING_DATABASE_URL) {
    const databaseRef = databaseTarget(environment.STAGING_DATABASE_URL).projectRef;
    if (!databaseRef) throw new Error('Production Journal migration refused: Staging database target cannot be verified.');
    candidates.push(databaseRef);
  }
  if (candidates.some(value => !PROJECT_REF_PATTERN.test(value) || value !== configuredRef)) {
    throw new Error('Production Journal migration refused: Staging deny-list configuration is inconsistent.');
  }
  return [...new Set(candidates)];
}

function assertProductionSafety(environment = process.env, options = {}) {
  const appEnv = String(environment.APP_ENV || '').trim().toLowerCase();
  const allowRef = String(environment.PRODUCTION_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
  const target = databaseTarget(environment.DATABASE_URL);
  const productionUrlRef = projectRefFromSupabaseUrl(environment.SUPABASE_URL);
  if (appEnv !== 'production') {
    throw new Error('Production Journal migration refused: APP_ENV must be production.');
  }
  if (!PROJECT_REF_PATTERN.test(allowRef)) {
    throw new Error('Production Journal migration refused: PRODUCTION_SUPABASE_PROJECT_REF is required.');
  }
  if (!target.valid || !target.projectRef || !target.database) {
    throw new Error('Production Journal migration refused: database target cannot be verified.');
  }
  if (!productionUrlRef || target.projectRef !== allowRef || productionUrlRef !== allowRef) {
    throw new Error('Production Journal migration refused: database target does not match the Production allow-list.');
  }
  if (verifiedStagingRefs(environment).includes(target.projectRef)) {
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

function normalizedDefinition(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function checkConstraintReady(constraint, name) {
  if (!constraint || constraint.type !== 'CHECK') return false;
  const definition = normalizedDefinition(constraint.definition);
  const lower = definition.toLowerCase();
  const canonical = lower.replace(/::text/g, '').replace(/[()\s]/g, '');
  if (!/^CHECK \(/i.test(definition) || /\sOR\s/i.test(definition)) return false;
  if (name === 'daily_market_notes_thesis_check') {
    const expected = [
      '流动性', '货币政策', '通胀', '经济增长', '风险偏好',
      '地缘政治', '财政', '技术性因素', '暂无明确主线'
    ];
    const literals = [...definition.matchAll(/'((?:''|[^'])*)'/g)].map(match => match[1].replace(/''/g, "'"));
    return (canonical.includes('thesisin') || canonical.includes('thesis=anyarray')) &&
      literals.length === expected.length && expected.every(value => literals.includes(value));
  }
  if (name === 'daily_market_notes_summary_length_check') {
    return canonical === 'checkchar_lengthsummarybetween1and200' ||
      canonical === 'checkchar_lengthsummary>=1andchar_lengthsummary<=200';
  }
  const columnByName = {
    daily_market_notes_supporting_array_check:'supporting_evidence',
    daily_market_notes_opposing_array_check:'opposing_evidence',
    daily_market_notes_watchlist_array_check:'watchlist'
  };
  const column = columnByName[name];
  if (!column) return false;
  if (name === 'daily_market_notes_watchlist_array_check') {
    return canonical === "checkjsonb_typeofwatchlist='array'andjsonb_array_lengthwatchlist<=3";
  }
  return canonical === `checkjsonb_typeof${column}='array'`;
}

function sharedStructureMismatches(snapshot) {
  const mismatches = [];
  const constraints = snapshot.constraints || [];
  const indexes = snapshot.indexes || [];
  const primaryKeys = constraints.filter(item => item.type === 'PRIMARY KEY' &&
    /^PRIMARY KEY \(id\)$/i.test(normalizedDefinition(item.definition)));
  if (primaryKeys.length !== 1) {
    mismatches.push('constraint:primary-key');
  }
  for (const name of REQUIRED_CHECKS) {
    if (constraints.filter(item => checkConstraintReady(item, name)).length !== 1) mismatches.push(`constraint:${name}`);
  }
  if (!indexes.some(item => /USING btree \(updated_at DESC\)$/i.test(normalizedDefinition(item.definition)))) {
    mismatches.push('index:updated-at');
  }
  return mismatches;
}

function legacyStructureMismatches(snapshot) {
  const mismatches = columnMismatches(snapshot.columns, LEGACY_COLUMNS).concat(sharedStructureMismatches(snapshot));
  const constraints = snapshot.constraints || [];
  const legacyUnique = constraints.filter(item => item.type === 'UNIQUE' &&
    /^UNIQUE \(note_date\)$/i.test(normalizedDefinition(item.definition)));
  if (legacyUnique.length !== 1) {
    mismatches.push('constraint:legacy-date-unique');
  }
  if (constraints.length !== 7) mismatches.push('constraint:unexpected-definition');
  return mismatches;
}

function policyReady(policy, command) {
  if (!policy || String(policy.cmd).toUpperCase() !== command) return false;
  const roles = Array.isArray(policy.roles) ? policy.roles : [];
  const using = String(policy.qual || '').replace(/[()\s]/g, '');
  const check = String(policy.with_check || '').replace(/[()\s]/g, '');
  if (roles.length !== 1 || roles[0] !== 'authenticated') return false;
  if (command === 'SELECT' || command === 'DELETE') {
    return !check && (using === 'auth.uid=user_id' || using === 'auth.uid()=user_id');
  }
  if (command === 'INSERT') return !using && (check === 'auth.uid=user_id' || check === 'auth.uid()=user_id');
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
  const privilegeSet = (grants, role) => new Set(grants.filter(item => item.grantee === role).map(item => item.privilege));

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
  for (const roleName of ['anon', 'authenticated']) {
    const role = roleAttributes.find(item => item.name === roleName);
    if (!role) mismatches.push(`role:${roleName}-missing`);
    else if (role.bypass_rls === true) mismatches.push(`role:${roleName}-bypassrls`);
  }
  const expectedPolicies = [
    ['daily_market_notes_select_own', 'SELECT'],
    ['daily_market_notes_insert_own', 'INSERT'],
    ['daily_market_notes_update_own', 'UPDATE'],
    ['daily_market_notes_delete_own', 'DELETE']
  ];
  for (const [name, command] of expectedPolicies) {
    if (policies.filter(item => policyReady(item, command)).length !== 1) mismatches.push(`policy:${name}`);
  }
  if (policies.length !== 4) mismatches.push('policy:unexpected-definition');
  const targetUnique = constraints.filter(item => item.type === 'UNIQUE' &&
    /^UNIQUE \(user_id, note_date\)$/i.test(normalizedDefinition(item.definition)));
  const targetForeignKey = constraints.filter(item => item.type === 'FOREIGN KEY' &&
    /^FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE RESTRICT$/i.test(normalizedDefinition(item.definition)));
  if (targetUnique.length !== 1 || targetForeignKey.length !== 1 || constraints.length !== 8) {
    mismatches.push('constraint:unexpected-definition');
  }
  const expectedTablePrivileges = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
  const authenticatedTablePrivileges = privilegeSet(tableGrants, 'authenticated');
  if (privilegeSet(tableGrants, 'anon').size > 0) mismatches.push('grant:anon-table');
  if (privilegeSet(tableGrants, 'service_role').size > 0) mismatches.push('grant:service-role-table');
  if (privilegeSet(tableGrants, 'PUBLIC').size > 0) mismatches.push('grant:public-table');
  for (const privilege of expectedTablePrivileges) {
    if (!authenticatedTablePrivileges.has(privilege)) mismatches.push(`grant:authenticated-${privilege.toLowerCase()}`);
  }
  for (const privilege of authenticatedTablePrivileges) {
    if (!expectedTablePrivileges.has(privilege)) mismatches.push(`grant:authenticated-extra-${privilege.toLowerCase()}`);
  }
  const authenticatedSequencePrivileges = privilegeSet(sequenceGrants, 'authenticated');
  if (privilegeSet(sequenceGrants, 'anon').size > 0) mismatches.push('grant:anon-sequence');
  if (privilegeSet(sequenceGrants, 'service_role').size > 0) mismatches.push('grant:service-role-sequence');
  if (privilegeSet(sequenceGrants, 'PUBLIC').size > 0) mismatches.push('grant:public-sequence');
  if (authenticatedSequencePrivileges.size !== 1 || !authenticatedSequencePrivileges.has('USAGE')) {
    mismatches.push('grant:authenticated-sequence');
  }
  return mismatches;
}

function classifySnapshot(snapshot) {
  if (snapshot.tableExists === false) {
    return { state:'table-absent', executable:true, recordCount:0, mismatches:[] };
  }
  if (snapshot.tableExists !== true || !Array.isArray(snapshot.columns)) {
    return { state:'partially-migrated', executable:false, recordCount:0, mismatches:['inspection:table-existence'] };
  }
  const count = Number(snapshot.recordCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    return { state:'partially-migrated', executable:false, recordCount:0, mismatches:['inspection:record-count'] };
  }
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
  const nullOwnerCount = Number(snapshot.nullOwnerCount);
  if (!Number.isSafeInteger(nullOwnerCount) || nullOwnerCount < 0) mismatches.unshift('inspection:null-owner-count');
  else if (nullOwnerCount > 0) mismatches.unshift('data:null-user-id');
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
    `WITH roles(grantee) AS (
       VALUES ('anon'), ('authenticated'), ('service_role')
     ), privileges(privilege) AS (
       VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
     ), effective AS (
       SELECT grantee, privilege FROM roles CROSS JOIN privileges
        WHERE has_table_privilege(grantee, 'public.daily_market_notes', privilege)
     ), public_acl AS (
       SELECT 'PUBLIC'::text AS grantee, acl.privilege_type AS privilege
         FROM pg_class c
         CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
        WHERE c.oid='public.daily_market_notes'::regclass AND acl.grantee=0
     )
     SELECT grantee, privilege FROM effective
     UNION ALL
     SELECT grantee, privilege FROM public_acl`
  );
  const sequenceGrants = await client.query(
    `WITH roles(grantee) AS (
       VALUES ('anon'), ('authenticated'), ('service_role')
     ), privileges(privilege) AS (
       VALUES ('USAGE'), ('SELECT'), ('UPDATE')
     ), effective AS (
       SELECT grantee, privilege FROM roles CROSS JOIN privileges
        WHERE has_sequence_privilege(grantee, 'public.daily_market_notes_id_seq', privilege)
     ), public_acl AS (
       SELECT 'PUBLIC'::text AS grantee, acl.privilege_type AS privilege
         FROM pg_class c
         CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) acl
        WHERE c.oid='public.daily_market_notes_id_seq'::regclass AND acl.grantee=0
     )
     SELECT grantee, privilege FROM effective
     UNION ALL
     SELECT grantee, privilege FROM public_acl`
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
  const allowTestOverrides = environment.NODE_ENV === 'test' &&
    environment.ALLOW_MIGRATION_TEST_OVERRIDES === 'true';
  const target = assertProductionSafety(environment, { requireConfirmation:!dryRun });
  const client = options.client;
  await client.query(dryRun ? 'BEGIN READ ONLY' : 'BEGIN');
  try {
    const inspectState = allowTestOverrides && options.inspectState ? options.inspectState : inspectMigrationState;
    if (!dryRun) await client.query('SELECT pg_advisory_xact_lock(749131, 3003)');
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
    if (preflight.state === 'legacy-empty') {
      await client.query('LOCK TABLE public.daily_market_notes IN ACCESS EXCLUSIVE MODE');
      const lockedPreflight = await inspectState(client);
      if (lockedPreflight.state !== 'legacy-empty' || lockedPreflight.recordCount !== 0) {
        throw new Error('Production Journal migration refused: legacy state changed before execution.');
      }
    }
    await client.query(allowTestOverrides && options.migrationSql !== undefined ? options.migrationSql : loadMigrationSql());
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
