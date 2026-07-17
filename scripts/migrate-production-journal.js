'use strict';

const {
  assertProductionSafety,
  runProductionMigration
} = require('./lib/production-journal-migration');

function parseArguments(argumentsList) {
  const allowed = new Set(['--dry-run']);
  const unknown = argumentsList.filter(value => !allowed.has(value));
  if (unknown.length > 0) throw new Error('Unknown migration option.');
  return { dryRun:argumentsList.includes('--dry-run') };
}

function safeReport(result) {
  const preflight = result.preflight || {};
  const report = {
    migration:'production-journal-rls',
    mode:result.mode,
    status:result.status,
    environment:result.target.environment,
    project:result.target.maskedProjectRef,
    database:result.target.database,
    state:preflight.state,
    recordCount:preflight.recordCount,
    executable:preflight.executable,
    mismatches:preflight.mismatches || []
  };
  report.nextAction = result.status === 'executable'
    ? 'Review this dry-run result before separately authorizing formal migration.'
    : result.status === 'already-compliant'
      ? 'No schema migration is required.'
      : 'Stop. Resolve the reported state without automatic data changes.';
  if (preflight.state === 'legacy-with-data') {
    report.dateRange = { first:preflight.firstDate, last:preflight.lastDate };
  }
  return report;
}

function safeErrorMessage(error) {
  const message = String(error && error.message || '');
  if (/^Production Journal migration (?:refused|verification failed)/.test(message)) return message;
  return 'Production Journal migration failed or completion could not be confirmed. Verify database state before retrying.';
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assertProductionSafety(process.env, { requireConfirmation:!options.dryRun });
  const { getPool } = require('../database');
  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
    const result = await runProductionMigration({
      client,
      dryRun:options.dryRun,
      environment:process.env
    });
    process.stdout.write(`${JSON.stringify(safeReport(result), null, 2)}\n`);
    if (result.status === 'stopped') process.exitCode = 2;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArguments, safeErrorMessage, safeReport };
