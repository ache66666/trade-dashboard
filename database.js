const { Pool, types } = require('pg');

// Preserve the API's existing date/time strings instead of converting them
// through the server's timezone when PostgreSQL values are serialized to JSON.
types.setTypeParser(1082, value => value);
types.setTypeParser(1114, value => value.replace(' ', 'T').replace(/:00$/, ''));

let pool;

function positiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('缺少 DATABASE_URL，无法连接 Supabase PostgreSQL');
  }

  pool = new Pool({
    connectionString,
    max: positiveInteger('DATABASE_POOL_MAX', 10),
    idleTimeoutMillis: positiveInteger('DATABASE_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: positiveInteger('DATABASE_CONNECTION_TIMEOUT_MS', 10000)
  });

  pool.on('error', error => {
    console.error('PostgreSQL connection pool error:', error.message);
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
