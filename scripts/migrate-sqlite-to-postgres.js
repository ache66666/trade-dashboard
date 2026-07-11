const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { getPool, closePool } = require('../database');

const SQLITE_PATH = path.join(__dirname, '..', 'data', 'market.db');
const EXPECTED_INDICATORS = 32;
const EXPECTED_EVENTS = 3;

function asBoolean(value) {
  return value === 1;
}

function normalizedTimestamp(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(' ', 'T').padEnd(19, ':00').slice(0, 19);
}

function normalizedIndicator(row) {
  return {
    id: Number(row.id),
    symbol: row.symbol,
    name: row.name,
    category: row.category,
    value: Number(row.value),
    previous_value: Number(row.previous_value),
    value_unit: row.value_unit,
    change_type: row.change_type,
    source: row.source,
    as_of: row.as_of,
    frequency: row.frequency,
    is_manual: Boolean(row.is_manual),
    is_featured: Boolean(row.is_featured),
    sort_order: Number(row.sort_order),
    updated_at: normalizedTimestamp(row.updated_at)
  };
}

function normalizedEvent(row) {
  return {
    id: Number(row.id),
    event_time: normalizedTimestamp(row.event_time),
    region: row.region,
    name: row.name,
    importance: Number(row.importance),
    previous: row.previous,
    forecast: row.forecast,
    actual: row.actual,
    source: row.source,
    is_manual: Boolean(row.is_manual),
    updated_at: normalizedTimestamp(row.updated_at)
  };
}

function firstDifference(expected, actual) {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    try {
      assert.deepStrictEqual(actual[index], expected[index]);
    } catch {
      return { index, expected: expected[index], actual: actual[index] };
    }
  }
  return null;
}

async function migrate() {
  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  const indicators = sqlite.prepare('SELECT * FROM indicators ORDER BY id').all();
  const events = sqlite.prepare('SELECT * FROM macro_events ORDER BY id').all();
  sqlite.close();

  assert.equal(indicators.length, EXPECTED_INDICATORS, 'SQLite indicators count is not 32');
  assert.equal(events.length, EXPECTED_EVENTS, 'SQLite macro_events count is not 3');

  const client = await getPool().connect();
  let committed = false;

  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query('LOCK TABLE public.indicators, public.macro_events IN EXCLUSIVE MODE');

    const before = await client.query(
      `SELECT
        (SELECT count(*)::int FROM public.indicators) AS indicators,
        (SELECT count(*)::int FROM public.macro_events) AS macro_events`
    );
    if (before.rows[0].indicators !== 0 || before.rows[0].macro_events !== 0) {
      throw new Error(`目标表不是空表：indicators=${before.rows[0].indicators}, macro_events=${before.rows[0].macro_events}`);
    }

    const insertIndicator = `
      INSERT INTO public.indicators
        (id, symbol, name, category, value, previous_value, value_unit,
         change_type, source, as_of, frequency, is_manual, is_featured,
         sort_order, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`;
    for (const row of indicators) {
      await client.query(insertIndicator, [
        row.id, row.symbol, row.name, row.category, row.value,
        row.previous_value, row.value_unit, row.change_type, row.source,
        row.as_of, row.frequency, asBoolean(row.is_manual),
        asBoolean(row.is_featured), row.sort_order, row.updated_at
      ]);
    }

    const insertEvent = `
      INSERT INTO public.macro_events
        (id, event_time, region, name, importance, previous, forecast,
         actual, source, is_manual, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;
    for (const row of events) {
      await client.query(insertEvent, [
        row.id, row.event_time, row.region, row.name, row.importance,
        row.previous, row.forecast, row.actual, row.source,
        asBoolean(row.is_manual), row.updated_at
      ]);
    }

    await client.query(
      "SELECT setval(pg_get_serial_sequence($1, $2), $3, true)",
      ['public.indicators', 'id', Math.max(...indicators.map(row => Number(row.id)))]
    );
    await client.query(
      "SELECT setval(pg_get_serial_sequence($1, $2), $3, true)",
      ['public.macro_events', 'id', Math.max(...events.map(row => Number(row.id)))]
    );

    const pgIndicators = await client.query(
      `SELECT id, symbol, name, category, value, previous_value, value_unit,
              change_type, source, as_of::text AS as_of, frequency,
              is_manual, is_featured, sort_order,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS updated_at
       FROM public.indicators ORDER BY id`
    );
    const pgEvents = await client.query(
      `SELECT id, to_char(event_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS event_time,
              region, name, importance, previous, forecast, actual, source,
              is_manual,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS updated_at
       FROM public.macro_events ORDER BY id`
    );

    const expectedIndicators = indicators.map(row => normalizedIndicator({
      ...row,
      is_manual: asBoolean(row.is_manual),
      is_featured: asBoolean(row.is_featured)
    }));
    const actualIndicators = pgIndicators.rows.map(normalizedIndicator);
    const expectedEvents = events.map(row => normalizedEvent({ ...row, is_manual: asBoolean(row.is_manual) }));
    const actualEvents = pgEvents.rows.map(normalizedEvent);

    const indicatorDifference = firstDifference(expectedIndicators, actualIndicators);
    const eventDifference = firstDifference(expectedEvents, actualEvents);
    if (indicatorDifference || eventDifference) {
      const error = new Error('迁移后字段校验不一致');
      error.details = { indicatorDifference, eventDifference };
      throw error;
    }

    const validation = {
      counts: {
        indicators: actualIndicators.length,
        macro_events: actualEvents.length
      },
      symbolsMatch: JSON.stringify(actualIndicators.map(row => row.symbol)) ===
        JSON.stringify(expectedIndicators.map(row => row.symbol)),
      maxIds: {
        indicators: Math.max(...actualIndicators.map(row => row.id)),
        macro_events: Math.max(...actualEvents.map(row => row.id))
      },
      keyFieldsMatch: !indicatorDifference && !eventDifference,
      eventTimesMatch: JSON.stringify(actualEvents.map(row => row.event_time)) ===
        JSON.stringify(expectedEvents.map(row => row.event_time))
    };

    assert.equal(validation.counts.indicators, EXPECTED_INDICATORS);
    assert.equal(validation.counts.macro_events, EXPECTED_EVENTS);
    assert.equal(validation.symbolsMatch, true);
    assert.equal(validation.maxIds.indicators, Math.max(...indicators.map(row => Number(row.id))));
    assert.equal(validation.maxIds.macro_events, Math.max(...events.map(row => Number(row.id))));
    assert.equal(validation.keyFieldsMatch, true);
    assert.equal(validation.eventTimesMatch, true);

    await client.query('COMMIT');
    committed = true;
    console.log(JSON.stringify({ status: 'committed', validation }));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(JSON.stringify({
      status: 'rolled_back',
      error: error.message,
      details: error.details || null
    }));
    process.exitCode = 1;
  } finally {
    client.release();
    await closePool();
    if (!committed && !process.exitCode) process.exitCode = 1;
  }
}

migrate().catch(error => {
  console.error(JSON.stringify({ status: 'failed_before_transaction', error: error.message }));
  process.exitCode = 1;
});
