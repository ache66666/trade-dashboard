const { Pool, types } = require('pg');
const config = require('./config');
const logger = require('./logger');

// Preserve the API's existing date/time strings instead of converting them
// through the server's timezone when PostgreSQL values are serialized to JSON.
types.setTypeParser(1082, value => value);
types.setTypeParser(1114, value => value.replace(' ', 'T').replace(/:00$/, ''));

let pool;

function getPool() {
  if (pool) return pool;

  pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    idleTimeoutMillis: config.databaseIdleTimeoutMs,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs
  });

  pool.on('error', error => {
    logger.error(`PostgreSQL connection pool error: ${error.message}`);
  });

  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function closePool() {
  if (!pool) return;
  const activePool = pool;
  pool = undefined;
  await activePool.end();
}

module.exports = { getPool, query, closePool };
