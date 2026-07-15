'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertStagingSafety, describeDatabaseTarget } = require('./lib/staging-seed');

async function main() {
  assertStagingSafety(process.env);
  const { getPool, closePool } = require('../database');
  const client = await getPool().connect();
  try {
    const target = describeDatabaseTarget(process.env);
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '002_daily_market_notes.sql'), 'utf8');
    console.log(`Staging target: environment=${target.environment}, host=${target.host}, project=${target.projectRef}, database=${target.database}`);
    await client.query(sql);
    const verification = await client.query("SELECT to_regclass('public.daily_market_notes') AS table_name");
    if (verification.rows[0].table_name !== 'daily_market_notes') throw new Error('Journal migration verification failed.');
    console.log('Staging journal migration complete: daily_market_notes is ready.');
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
