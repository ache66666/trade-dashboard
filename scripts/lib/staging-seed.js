'use strict';

const CONFIRMATION_VALUE = 'staging';
const SEED_SOURCE = 'STAGING SEED';

const indicators = Object.freeze([
  Object.freeze({ symbol:'DR007', name:'[STAGING TEST] DR007（待录入）', category:'流动性', value:0, previous_value:0, value_unit:'%', change_type:'bp', source:'待手工录入', as_of:'2099-01-10', frequency:'Manual Test', is_featured:true, sort_order:901 }),
  Object.freeze({ symbol:'CN10Y', name:'[STAGING TEST] 中国国债 10Y', category:'利率', value:1.78, previous_value:1.75, value_unit:'%', change_type:'bp', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:902 }),
  Object.freeze({ symbol:'US10Y', name:'[STAGING TEST] 美国国债 10Y', category:'利率', value:4.22, previous_value:4.27, value_unit:'%', change_type:'bp', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:903 }),
  Object.freeze({ symbol:'T.CFE', name:'[STAGING TEST] 10Y 国债期货主力', category:'国债期货', value:108.20, previous_value:108.50, value_unit:'', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:904 }),
  Object.freeze({ symbol:'DXY', name:'[STAGING TEST] 美元指数', category:'外汇', value:103.20, previous_value:102.80, value_unit:'', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:905 }),
  Object.freeze({ symbol:'CSI300', name:'[STAGING TEST] 沪深 300', category:'股票', value:3900, previous_value:3920, value_unit:'', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:906 }),
  Object.freeze({ symbol:'SPX', name:'[STAGING TEST] 标普 500', category:'股票', value:5650, previous_value:5600, value_unit:'', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:907 }),
  Object.freeze({ symbol:'GOLD', name:'[STAGING TEST] 黄金', category:'商品', value:2350, previous_value:2320, value_unit:'美元/盎司', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:908 }),
  Object.freeze({ symbol:'VIX', name:'[STAGING TEST] VIX', category:'波动率', value:18.50, previous_value:19.20, value_unit:'', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:909 }),
  Object.freeze({ symbol:'AAA3Y', name:'[STAGING TEST] AAA 3Y 信用利差', category:'信用', value:45, previous_value:42, value_unit:'bp', change_type:'bp', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:910 })
]);

const events = Object.freeze([
  Object.freeze({ event_time:'2099-01-15T09:30:00', region:'TEST', name:'[STAGING TEST] Inflation Release', importance:3, previous:'1.0%', forecast:'1.1%', actual:'', source:SEED_SOURCE }),
  Object.freeze({ event_time:'2099-01-16T14:00:00', region:'TEST', name:'[STAGING TEST] Policy Decision', importance:4, previous:'2.50%', forecast:'2.50%', actual:'待公布', source:SEED_SOURCE })
]);

function databaseTarget(environment = process.env) {
  let parsed;
  try {
    parsed = new URL(environment.DATABASE_URL);
  } catch {
    throw new Error('Staging seed refused: DATABASE_URL is missing or invalid.');
  }
  const username = decodeURIComponent(parsed.username || '');
  const projectRef = username.includes('.') ? username.split('.').pop() : '';
  return { host:parsed.hostname, database:parsed.pathname.replace(/^\//, ''), projectRef };
}

function maskProjectRef(projectRef) {
  if (!projectRef) return 'unknown';
  if (projectRef.length <= 6) return `${projectRef.slice(0, 1)}***${projectRef.slice(-1)}`;
  return `${projectRef.slice(0, 4)}***${projectRef.slice(-4)}`;
}

function describeDatabaseTarget(environment = process.env) {
  const target = databaseTarget(environment);
  return { host:target.host, database:target.database, projectRef:maskProjectRef(target.projectRef), environment:'staging' };
}

function assertStagingSafety(environment = process.env) {
  if (String(environment.APP_ENV || '').trim().toLowerCase() !== 'staging') {
    throw new Error('Staging seed refused: APP_ENV must be staging.');
  }
  if (String(environment.STAGING_SEED_CONFIRM || '').trim().toLowerCase() !== CONFIRMATION_VALUE) {
    throw new Error('Staging seed refused: STAGING_SEED_CONFIRM must be staging.');
  }
  const expectedProjectRef = String(environment.STAGING_DATABASE_PROJECT_REF || '').trim();
  if (!expectedProjectRef) {
    throw new Error('Staging seed refused: STAGING_DATABASE_PROJECT_REF is required.');
  }
  const target = databaseTarget(environment);
  if (!target.projectRef || target.projectRef !== expectedProjectRef) {
    throw new Error('Staging seed refused: DATABASE_URL does not match STAGING_DATABASE_PROJECT_REF.');
  }
  return target;
}

function eventKey(item) {
  return `${item.event_time}|${item.name}|${item.source}`;
}

async function inspectStagingSeed(client) {
  const indicatorResult = await client.query(
    'SELECT symbol FROM indicators WHERE symbol = ANY($1::text[])',
    [indicators.map(item => item.symbol)]
  );
  const eventResult = await client.query(
    'SELECT event_time, name, source FROM macro_events WHERE source=$1 AND name = ANY($2::text[])',
    [SEED_SOURCE, events.map(item => item.name)]
  );
  const existingSymbols = new Set(indicatorResult.rows.map(row => row.symbol));
  const existingEvents = new Set(eventResult.rows.map(row => eventKey({
    event_time:String(row.event_time).replace(' ', 'T'), name:row.name, source:row.source
  })));
  return {
    indicators:{ insert:indicators.filter(item => !existingSymbols.has(item.symbol)).length, update:indicators.filter(item => existingSymbols.has(item.symbol)).length },
    events:{ insert:events.filter(item => !existingEvents.has(eventKey(item))).length, existing:events.filter(item => existingEvents.has(eventKey(item))).length }
  };
}

async function validateSeedTransaction(client) {
  const indicatorResult = await client.query(
    'SELECT symbol, name, category, source FROM indicators WHERE symbol = ANY($1::text[])',
    [indicators.map(item => item.symbol)]
  );
  const eventResult = await client.query(
    'SELECT event_time, name, source FROM macro_events WHERE source=$1 AND name = ANY($2::text[])',
    [SEED_SOURCE, events.map(item => item.name)]
  );
  if (indicatorResult.rows.length !== indicators.length) throw new Error('Staging seed validation failed: indicator count mismatch.');
  if (eventResult.rows.length !== events.length) throw new Error('Staging seed validation failed: event count mismatch.');
  if (new Set(indicatorResult.rows.map(row => row.symbol)).size !== indicators.length) throw new Error('Staging seed validation failed: duplicate symbols.');
  for (const expected of indicators) {
    const actual = indicatorResult.rows.find(row => row.symbol === expected.symbol);
    if (!actual || actual.name !== expected.name || actual.category !== expected.category || actual.source !== expected.source) {
      throw new Error(`Staging seed validation failed: key fields differ for ${expected.symbol}.`);
    }
  }
}

async function seedStaging(client) {
  await client.query('BEGIN');
  try {
    const plan = await inspectStagingSeed(client);
    for (const item of indicators) {
      await client.query(
        `INSERT INTO indicators
          (symbol,name,category,value,previous_value,value_unit,change_type,source,as_of,frequency,is_manual,is_featured,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)
         ON CONFLICT (symbol) DO UPDATE SET
           name=EXCLUDED.name, category=EXCLUDED.category, value=EXCLUDED.value,
           previous_value=EXCLUDED.previous_value, value_unit=EXCLUDED.value_unit,
           change_type=EXCLUDED.change_type, source=EXCLUDED.source, as_of=EXCLUDED.as_of,
           frequency=EXCLUDED.frequency, is_manual=true, is_featured=EXCLUDED.is_featured,
           sort_order=EXCLUDED.sort_order, updated_at=CURRENT_TIMESTAMP`,
        [item.symbol,item.name,item.category,item.value,item.previous_value,item.value_unit,item.change_type,item.source,item.as_of,item.frequency,item.is_featured,item.sort_order]
      );
    }
    for (const item of events) {
      await client.query(
        `INSERT INTO macro_events
          (event_time,region,name,importance,previous,forecast,actual,source,is_manual)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,true
         WHERE NOT EXISTS (
           SELECT 1 FROM macro_events WHERE event_time=$1 AND name=$3 AND source=$8
         )`,
        [item.event_time,item.region,item.name,item.importance,item.previous,item.forecast,item.actual,item.source]
      );
    }
    await validateSeedTransaction(client);
    await client.query('COMMIT');
    return { plan, indicators:indicators.length, events:events.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function cleanStagingSeed(client) {
  await client.query('BEGIN');
  try {
    const indicatorResult = await client.query(
      'DELETE FROM indicators WHERE symbol = ANY($1::text[]) AND name = ANY($2::text[])',
      [indicators.map(item => item.symbol), indicators.map(item => item.name)]
    );
    const eventResult = await client.query(
      'DELETE FROM macro_events WHERE source=$1 AND name = ANY($2::text[])',
      [SEED_SOURCE, events.map(item => item.name)]
    );
    await client.query('COMMIT');
    return { indicators:indicatorResult.rowCount, events:eventResult.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports = {
  CONFIRMATION_VALUE,
  SEED_SOURCE,
  indicators,
  events,
  assertStagingSafety,
  describeDatabaseTarget,
  inspectStagingSeed,
  seedStaging,
  cleanStagingSeed
};
