'use strict';

const CONFIRMATION_VALUE = 'staging';
const SEED_SOURCE = 'STAGING SEED';

const indicators = Object.freeze([
  Object.freeze({ symbol:'STG_RATE_10Y', name:'[STAGING TEST] 10Y Rate', category:'利率', value:2.50, previous_value:2.45, value_unit:'%', change_type:'bp', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:901 }),
  Object.freeze({ symbol:'STG_FX_INDEX', name:'[STAGING TEST] FX Index', category:'外汇', value:101.20, previous_value:100.80, value_unit:'', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:902 }),
  Object.freeze({ symbol:'STG_EQUITY', name:'[STAGING TEST] Equity Index', category:'股票', value:3250, previous_value:3200, value_unit:'', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:903 }),
  Object.freeze({ symbol:'STG_GOLD', name:'[STAGING TEST] Gold', category:'商品', value:2500, previous_value:2480, value_unit:'美元/盎司', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:904 }),
  Object.freeze({ symbol:'STG_VOL', name:'[STAGING TEST] Volatility', category:'波动率', value:18.50, previous_value:17.90, value_unit:'', change_type:'percent', source:SEED_SOURCE, as_of:'2099-01-10', frequency:'Test Snapshot', is_featured:true, sort_order:905 })
]);

const events = Object.freeze([
  Object.freeze({ event_time:'2099-01-15T09:30:00', region:'TEST', name:'[STAGING TEST] Inflation Release', importance:3, previous:'1.0%', forecast:'1.1%', actual:'', source:SEED_SOURCE }),
  Object.freeze({ event_time:'2099-01-16T14:00:00', region:'TEST', name:'[STAGING TEST] Policy Decision', importance:4, previous:'2.50%', forecast:'2.50%', actual:'', source:SEED_SOURCE })
]);

function assertStagingSafety(environment = process.env) {
  if (String(environment.APP_ENV || '').toLowerCase() !== 'staging') {
    throw new Error('Staging seed refused: APP_ENV must be staging.');
  }
  if (String(environment.STAGING_SEED_CONFIRM || '').toLowerCase() !== CONFIRMATION_VALUE) {
    throw new Error('Staging seed refused: STAGING_SEED_CONFIRM must be staging.');
  }
}

async function seedStaging(client) {
  await client.query('BEGIN');
  try {
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

    await client.query('COMMIT');
    return { indicators: indicators.length, events: events.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function cleanStagingSeed(client) {
  await client.query('BEGIN');
  try {
    const indicatorResult = await client.query(
      'DELETE FROM indicators WHERE symbol = ANY($1::text[]) AND source=$2',
      [indicators.map(item => item.symbol), SEED_SOURCE]
    );
    const eventResult = await client.query(
      'DELETE FROM macro_events WHERE source=$1 AND name = ANY($2::text[])',
      [SEED_SOURCE, events.map(item => item.name)]
    );
    await client.query('COMMIT');
    return { indicators: indicatorResult.rowCount, events: eventResult.rowCount };
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
  seedStaging,
  cleanStagingSeed
};
