'use strict';

const { assertStagingSafety, seedStaging } = require('./lib/staging-seed');

async function main() {
  assertStagingSafety(process.env);
  const { getPool, closePool } = require('../database');
  const client = await getPool().connect();
  try {
    const result = await seedStaging(client);
    console.log(`Staging seed complete: ${result.indicators} indicators, ${result.events} events.`);
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
