'use strict';

const { assertStagingSafety, describeDatabaseTarget, cleanStagingSeed } = require('./lib/staging-seed');

async function main() {
  assertStagingSafety(process.env);
  const { getPool, closePool } = require('../database');
  const client = await getPool().connect();
  try {
    const target = describeDatabaseTarget(process.env);
    console.log(`Staging target: environment=${target.environment}, host=${target.host}, project=${target.projectRef}, database=${target.database}`);
    const result = await cleanStagingSeed(client);
    console.log(`Staging seed cleanup complete: ${result.indicators} indicators, ${result.events} events removed.`);
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
