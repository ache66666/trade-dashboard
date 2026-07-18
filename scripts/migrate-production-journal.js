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

function safeDiagnosticText(value, maximumLength) {
  const text = String(value || '');
  if (/:\/\/|@|password|secret|token|api[_-]?key|auth\.uid|[()]/i.test(text)) {
    return '[redacted]';
  }
  return text.replace(/[^A-Za-z0-9 _:=;,.+\-]/g, '?').slice(0, maximumLength);
}

function safeFailureReport(error) {
  const verificationFailure = error && error.code === 'MIGRATION_VERIFICATION_FAILED';
  const details = verificationFailure && Array.isArray(error.mismatchDetails)
    ? error.mismatchDetails.map(detail => ({
      item:safeDiagnosticText(detail.item, 100),
      expected:safeDiagnosticText(detail.expected, 160),
      actual:safeDiagnosticText(detail.actual, 160)
    }))
    : [];
  return {
    error:verificationFailure ? 'MIGRATION_VERIFICATION_FAILED' : 'MIGRATION_FAILED',
    message:safeErrorMessage(error),
    mismatches:verificationFailure && Array.isArray(error.mismatches)
      ? error.mismatches.map(value => safeDiagnosticText(value, 100)) : [],
    details,
    rollback:error && error.rollbackSucceeded === true ? 'succeeded'
      : error && error.rollbackSucceeded === false ? 'failed' : 'not-recorded',
    rollbackError:error && error.rollbackErrorClass === 'ROLLBACK_FAILED' ? 'ROLLBACK_FAILED' : null,
    connectionClosed:error && error.connectionClosed === true ? 'succeeded'
      : error && error.connectionClosed === false ? 'failed' : 'not-recorded',
    connectionCloseError:error && error.connectionCloseErrorClass === 'CONNECTION_CLOSE_FAILED'
      ? 'CONNECTION_CLOSE_FAILED' : null
  };
}

async function closeResources(pool, client, failure) {
  let releaseError;
  try {
    if (client) client.release();
  } catch (error) {
    releaseError = error;
  }
  try {
    await pool.end();
    if (failure) {
      failure.connectionClosed = !releaseError;
      if (releaseError) failure.connectionCloseErrorClass = 'CONNECTION_CLOSE_FAILED';
    } else if (releaseError) {
      throw releaseError;
    }
  } catch (closeError) {
    if (!failure) throw closeError;
    failure.connectionClosed = false;
    failure.connectionCloseErrorClass = 'CONNECTION_CLOSE_FAILED';
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assertProductionSafety(process.env, { requireConfirmation:!options.dryRun });
  const { getPool } = require('../database');
  const pool = getPool();
  let client;
  let failure;
  try {
    client = await pool.connect();
    const result = await runProductionMigration({
      client,
      dryRun:options.dryRun,
      environment:process.env
    });
    process.stdout.write(`${JSON.stringify(safeReport(result), null, 2)}\n`);
    if (result.status === 'stopped') process.exitCode = 2;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await closeResources(pool, client, failure);
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify(safeFailureReport(error), null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { closeResources, parseArguments, safeDiagnosticText, safeErrorMessage, safeFailureReport, safeReport };
