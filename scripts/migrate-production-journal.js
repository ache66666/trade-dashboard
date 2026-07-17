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
  if (preflight.state === 'legacy-with-data') {
    report.dateRange = { first:preflight.firstDate, last:preflight.lastDate };
  }
  return report;
}

function safeErrorMessage(error) {
  const message = String(error && error.message || '');
  if (/^Production Journal migration (?:refused|verification failed)/.test(message)) return message;
  return 'Production Journal migration failed. No database changes were committed.';
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assertProductionSafety(process.env, { requireConfirmation:!options.dryRun });
  const { getPool } = require('../database');
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await runProductionMigration({
      client,
      dryRun:options.dryRun,
      environment:process.env
    });
    process.stdout.write(`${JSON.stringify(safeReport(result), null, 2)}\n`);
    if (result.status === 'stopped') process.exitCode = 2;
  } finally {
    client.release();
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
