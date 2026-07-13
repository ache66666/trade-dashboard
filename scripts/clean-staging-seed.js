'use strict';

const { assertStagingSafety, cleanStagingSeed } = require('./lib/staging-seed');

async function main() {
  assertStagingSafety(process.env);
  const { getPool, closePool } = require('../database');
  const client = await getPool().connect();
  try {
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
