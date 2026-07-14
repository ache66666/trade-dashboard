'use strict';

const {
  assertStagingSafety,
  describeDatabaseTarget,
  inspectStagingSeed,
  seedStaging
} = require('./lib/staging-seed');

async function main() {
  assertStagingSafety(process.env);
  const { getPool, closePool } = require('../database');
  const client = await getPool().connect();
  try {
    const target = describeDatabaseTarget(process.env);
    console.log(`Staging target: environment=${target.environment}, host=${target.host}, project=${target.projectRef}, database=${target.database}`);
    if (process.argv.includes('--dry-run')) {
      const plan = await inspectStagingSeed(client);
      console.log(`Staging seed dry-run: indicators insert=${plan.indicators.insert}, update=${plan.indicators.update}; events insert=${plan.events.insert}, existing=${plan.events.existing}.`);
      return;
    }
    const result = await seedStaging(client);
    console.log(`Staging seed plan: indicators insert=${result.plan.indicators.insert}, update=${result.plan.indicators.update}; events insert=${result.plan.events.insert}, existing=${result.plan.events.existing}.`);
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
