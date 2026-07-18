'use strict';

class IndicatorRepository {
  constructor(pool, allowList) {
    this.pool = pool;
    this.allowList = Object.freeze([...allowList]);
  }

  assertAllowed(symbols) {
    const unique = [...new Set(symbols)];
    if (unique.length !== symbols.length || unique.some(symbol => !this.allowList.includes(symbol))) {
      const error = new Error('Indicator is outside the repository allow-list.');
      error.code = 'REPOSITORY_ALLOW_LIST_VIOLATION';
      throw error;
    }
  }

  async readCurrent(symbols) {
    this.assertAllowed(symbols);
    const result = await this.pool.query(
      `SELECT id, symbol, category, value, previous_value, value_unit, change_type,
              source, as_of::text AS as_of, frequency, is_manual
       FROM indicators
       WHERE symbol = ANY($1::text[])
       ORDER BY symbol`,
      [symbols]
    );
    const rows = result.rows || [];
    if (rows.length !== symbols.length || new Set(rows.map(row => row.symbol)).size !== symbols.length) {
      const error = new Error('The Production indicator allow-list is incomplete.');
      error.code = 'REPOSITORY_INDICATOR_SET_INVALID';
      throw error;
    }
    return rows;
  }

  async apply(plans) {
    const updates = plans.filter(plan => plan.action === 'update');
    this.assertAllowed(plans.map(plan => plan.symbol));
    if (updates.length === 0) return { updated:0 };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const plan of updates) {
        const result = await client.query(
          `UPDATE indicators
           SET value=$1, previous_value=$2, source=$3, as_of=$4, frequency=$5,
               is_manual=false, updated_at=CURRENT_TIMESTAMP
           WHERE symbol=$6 AND (as_of IS NULL OR as_of <= $4::date)
           RETURNING symbol`,
          [plan.to.value, plan.to.previous_value, plan.to.source,
            plan.to.observation_date, plan.to.frequency, plan.symbol]
        );
        if (!result.rows || result.rows.length !== 1) {
          const error = new Error('Concurrent or missing indicator update.');
          error.code = 'REPOSITORY_UPDATE_REJECTED';
          throw error;
        }
      }
      await client.query('COMMIT');
      return { updated:updates.length };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        const failure = new Error('Repository rollback failed.');
        failure.code = 'REPOSITORY_ROLLBACK_FAILED';
        throw failure;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { IndicatorRepository };
