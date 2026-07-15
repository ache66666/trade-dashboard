'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertStagingSafety, describeDatabaseTarget } = require('./staging-seed');

const MIGRATION_FILE = path.join(__dirname, '..', '..', 'sql', '003_daily_market_notes_user_rls.sql');
const EXPECTED_DATES = Object.freeze(['2026-07-14', '2026-07-15']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function projectRefFromSupabaseUrl(value) {
  if (!value) return '';
  try {
    const host = new URL(value).hostname;
    return host.endsWith('.supabase.co') ? host.split('.')[0] : '';
  } catch (error) {
    return '';
  }
}

function projectRefFromDatabaseUrl(value) {
  if (!value) return '';
  try {
    const username = decodeURIComponent(new URL(value).username || '');
    return username.includes('.') ? username.split('.').pop() : '';
  } catch (error) {
    return '';
  }
}

function assertMigrationEnvironment(environment = process.env) {
  const target = assertStagingSafety(environment);
  const ownerId = String(environment.JOURNAL_LEGACY_OWNER_USER_ID || '').trim();
  if (!UUID_PATTERN.test(ownerId)) {
    throw new Error('Journal RLS migration refused: JOURNAL_LEGACY_OWNER_USER_ID must be a valid UUID.');
  }

  const stagingApiRef = projectRefFromSupabaseUrl(environment.SUPABASE_URL);
  if (stagingApiRef && stagingApiRef !== target.projectRef) {
    throw new Error('Journal RLS migration refused: Supabase API and database targets differ.');
  }

  const productionRefs = [
    String(environment.PRODUCTION_DATABASE_PROJECT_REF || '').trim(),
    projectRefFromDatabaseUrl(environment.PRODUCTION_DATABASE_URL),
    projectRefFromSupabaseUrl(environment.PRODUCTION_SUPABASE_URL),
    projectRefFromSupabaseUrl(environment.SUPABASE_PRODUCTION_URL)
  ].filter(Boolean);
  if (productionRefs.length === 0) {
    throw new Error('Journal RLS migration refused: a Production project deny-list is required.');
  }
  if (productionRefs.includes(target.projectRef)) {
    throw new Error('Journal RLS migration refused: database target matches Production.');
  }
  return { target, ownerId };
}

function normalizedDates(rows) {
  return rows.map(row => String(row.note_date).slice(0, 10)).sort();
}

function datesMatchExpected(dates) {
  return dates.length === EXPECTED_DATES.length && dates.every((value, index) => value === EXPECTED_DATES[index]);
}

async function inspectMigrationState(client, ownerId) {
  const table = await client.query("SELECT to_regclass('public.daily_market_notes') AS table_name");
  if (!table.rows[0] || !table.rows[0].table_name) {
    throw new Error('Journal RLS migration refused: daily_market_notes does not exist.');
  }

  const owner = await client.query('SELECT EXISTS (SELECT 1 FROM auth.users WHERE id=$1::uuid) AS exists', [ownerId]);
  if (!owner.rows[0] || owner.rows[0].exists !== true) {
    throw new Error('Journal RLS migration refused: legacy owner does not exist.');
  }

  const column = await client.query(
    `SELECT is_nullable
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='daily_market_notes' AND column_name='user_id'`
  );
  const dates = await client.query('SELECT note_date FROM public.daily_market_notes ORDER BY note_date');
  const dateValues = normalizedDates(dates.rows);

  if (column.rows.length === 0) {
    if (!datesMatchExpected(dateValues)) {
      throw new Error('Journal RLS migration refused: legacy rows do not match the approved dates.');
    }
    return {
      state:'first-run', tableExists:true, ownerExists:true, userColumnExists:false,
      totalRows:dateValues.length, nullOwnerRows:dateValues.length, dates:dateValues
    };
  }

  const ownership = await client.query(
    `SELECT count(*)::int AS total_rows,
            count(*) FILTER (WHERE user_id IS NULL)::int AS null_owner_rows,
            count(*) FILTER (WHERE user_id IS NOT NULL AND user_id <> $1::uuid)::int AS other_owner_rows
       FROM public.daily_market_notes`,
    [ownerId]
  );
  const counts = ownership.rows[0];
  if (counts.total_rows === 2 && counts.null_owner_rows === 2 &&
      counts.other_owner_rows === 0 && datesMatchExpected(dateValues)) {
    return {
      state:'first-run', tableExists:true, ownerExists:true, userColumnExists:true,
      totalRows:counts.total_rows, nullOwnerRows:counts.null_owner_rows, dates:dateValues
    };
  }
  if (counts.null_owner_rows !== 0) {
    throw new Error('Journal RLS migration refused: Journal ownership is partially populated.');
  }

  const security = await client.query(
    `SELECT c.relrowsecurity AS rls_enabled,
            c.relforcerowsecurity AS rls_forced,
            EXISTS (
              SELECT 1 FROM pg_constraint con
               WHERE con.conrelid=c.oid AND con.contype='u'
                 AND pg_get_constraintdef(con.oid)='UNIQUE (user_id, note_date)'
            ) AS composite_unique,
            NOT EXISTS (
              SELECT 1 FROM pg_constraint con
               WHERE con.conrelid=c.oid AND con.contype='u'
                 AND pg_get_constraintdef(con.oid)='UNIQUE (note_date)'
            ) AS legacy_unique_absent,
            EXISTS (
              SELECT 1 FROM pg_constraint con
               WHERE con.conrelid=c.oid AND con.contype='f'
                 AND con.confrelid='auth.users'::regclass
                 AND con.confdeltype='r'
            ) AS owner_foreign_key,
            (SELECT count(*)=4
               FROM pg_policy p
              WHERE p.polrelid=c.oid
                AND p.polroles=ARRAY['authenticated'::regrole]::oid[]
                AND (
                  (p.polname='daily_market_notes_select_own' AND p.polcmd='r' AND p.polqual IS NOT NULL) OR
                  (p.polname='daily_market_notes_insert_own' AND p.polcmd='a' AND p.polwithcheck IS NOT NULL) OR
                  (p.polname='daily_market_notes_update_own' AND p.polcmd='w' AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL) OR
                  (p.polname='daily_market_notes_delete_own' AND p.polcmd='d' AND p.polqual IS NOT NULL)
                )
            ) AS policies_ready,
            NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_table_denied,
            has_table_privilege('authenticated', c.oid, 'SELECT') AND
            has_table_privilege('authenticated', c.oid, 'INSERT') AND
            has_table_privilege('authenticated', c.oid, 'UPDATE') AND
            has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_table_ready,
            NOT has_sequence_privilege('anon', 'public.daily_market_notes_id_seq', 'USAGE') AS anon_sequence_denied,
            has_sequence_privilege('authenticated', 'public.daily_market_notes_id_seq', 'USAGE') AS authenticated_sequence_ready
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='daily_market_notes'`
  );
  const secured = security.rows[0] || {};
  if (column.rows[0].is_nullable === 'NO' && secured.rls_enabled === true &&
      secured.rls_forced === true && secured.composite_unique === true &&
      secured.legacy_unique_absent === true && secured.owner_foreign_key === true &&
      secured.policies_ready === true && secured.anon_table_denied === true &&
      secured.authenticated_table_ready === true && secured.anon_sequence_denied === true &&
      secured.authenticated_sequence_ready === true) {
    return {
      state:'migrated', tableExists:true, ownerExists:true, userColumnExists:true,
      totalRows:counts.total_rows, nullOwnerRows:0, dates:dateValues, securityReady:true
    };
  }
  throw new Error('Journal RLS migration refused: existing ownership state is not recognized.');
}

function loadMigrationSql() {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  if (/\bBEGIN\s*;|\bCOMMIT\s*;/i.test(sql)) {
    throw new Error('Journal RLS migration refused: transaction control must remain in the runner.');
  }
  return sql;
}

async function runMigration(options) {
  const environment = options.environment || process.env;
  const safety = assertMigrationEnvironment(environment);
  const client = options.client;
  const dryRun = options.dryRun === true;
  const sql = dryRun ? null : (options.migrationSql === undefined ? loadMigrationSql() : options.migrationSql);

  await client.query(dryRun ? 'BEGIN READ ONLY' : 'BEGIN');
  try {
    const state = await inspectMigrationState(client, safety.ownerId);
    if (dryRun || state.state === 'migrated') {
      await client.query('ROLLBACK');
      return { dryRun, state:state.state, preflight:state, target:describeDatabaseTarget(environment) };
    }
    await client.query(
      "SELECT set_config('app.journal_legacy_owner_user_id', $1, true)",
      [safety.ownerId]
    );
    await client.query(sql);
    const verification = await inspectMigrationState(client, safety.ownerId);
    if (verification.state !== 'migrated') throw new Error('Journal RLS migration verification failed.');
    await client.query('COMMIT');
    return { dryRun:false, state:'migrated', preflight:verification, target:describeDatabaseTarget(environment) };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { /* preserve the original failure */ }
    throw error;
  }
}

module.exports = {
  EXPECTED_DATES,
  MIGRATION_FILE,
  assertMigrationEnvironment,
  inspectMigrationState,
  loadMigrationSql,
  runMigration
};
