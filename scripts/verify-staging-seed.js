'use strict';

const {
  indicators,
  events,
  assertStagingSafety,
  describeDatabaseTarget,
  inspectStagingSeed
} = require('./lib/staging-seed');

async function main() {
  assertStagingSafety(process.env);
  const { getPool, closePool } = require('../database');
  const client = await getPool().connect();
  try {
    const target = describeDatabaseTarget(process.env);
    const counts = (await client.query(
      'SELECT (SELECT count(*)::int FROM indicators) indicators, (SELECT count(*)::int FROM macro_events) events'
    )).rows[0];
    const categories = (await client.query(
      'SELECT category, count(*)::int count FROM indicators GROUP BY category ORDER BY category'
    )).rows;
    const duplicateSymbols = (await client.query(
      'SELECT symbol FROM indicators GROUP BY symbol HAVING count(*) > 1'
    )).rowCount;
    const missingRequiredIndicators = (await client.query(
      `SELECT count(*)::int count FROM indicators
       WHERE symbol IS NULL OR btrim(symbol)='' OR name IS NULL OR btrim(name)=''
          OR category IS NULL OR btrim(category)='' OR value IS NULL OR previous_value IS NULL
          OR change_type IS NULL OR btrim(change_type)='' OR source IS NULL OR btrim(source)=''
          OR as_of IS NULL OR frequency IS NULL OR btrim(frequency)=''`
    )).rows[0].count;
    const missingRequiredEvents = (await client.query(
      `SELECT count(*)::int count FROM macro_events
       WHERE event_time IS NULL OR region IS NULL OR btrim(region)=''
          OR name IS NULL OR btrim(name)='' OR importance IS NULL
          OR source IS NULL OR btrim(source)=''`
    )).rows[0].count;
    const directions = (await client.query(
      `SELECT count(*) FILTER (WHERE source='待手工录入')::int pending,
              count(*) FILTER (WHERE source<>'待手工录入' AND value>previous_value)::int up,
              count(*) FILTER (WHERE source<>'待手工录入' AND value<previous_value)::int down
         FROM indicators`
    )).rows[0];
    const plan = await inspectStagingSeed(client);
    const expectedCategories = new Set(indicators.map(item => item.category));
    const actualCategories = new Set(categories.map(item => item.category));
    const result = {
      target,
      counts,
      categories,
      duplicateSymbols,
      missingRequiredIndicators,
      missingRequiredEvents,
      directions,
      idempotencePlan:plan
    };
    if (counts.indicators !== indicators.length || counts.events !== events.length) throw new Error(`Staging verification failed: expected ${indicators.length}/${events.length} rows.`);
    if (expectedCategories.size !== actualCategories.size || Array.from(expectedCategories).some(category => !actualCategories.has(category))) throw new Error('Staging verification failed: category coverage mismatch.');
    if (duplicateSymbols || missingRequiredIndicators || missingRequiredEvents) throw new Error('Staging verification failed: duplicate or incomplete records found.');
    if (plan.indicators.insert || plan.events.insert || plan.events.existing !== events.length) throw new Error('Staging verification failed: Seed is not idempotent.');
    console.log(`Staging target: environment=${target.environment}, host=${target.host}, project=${target.projectRef}, database=${target.database}`);
    console.log(JSON.stringify(result));
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
