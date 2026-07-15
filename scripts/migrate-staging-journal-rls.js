'use strict';

const { assertMigrationEnvironment, runMigration } = require('./lib/journal-rls-migration');

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  assertMigrationEnvironment(process.env);
  const { getPool, closePool } = require('../database');
  let client;
  try {
    client = await getPool().connect();
    const result = await runMigration({ client, environment:process.env, dryRun });
    console.log(
      `Staging Journal RLS ${dryRun ? 'dry run' : 'migration'} complete: ` +
      `environment=${result.target.environment}, host=${result.target.host}, ` +
      `project=${result.target.projectRef}, database=${result.target.database}, state=${result.state}`
    );
  } finally {
    if (client) client.release();
    await closePool();
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Staging Journal RLS migration failed. Review protected local logs and preflight conditions.');
    process.exit(1);
  });
}

module.exports = { main };
