'use strict';

function positiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function booleanValue(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function appEnvironment() {
  const value = String(process.env.APP_ENV || 'production').trim().toLowerCase();
  if (!['production', 'staging', 'development', 'test'].includes(value)) {
    throw new Error(`APP_ENV 无效：${value}`);
  }
  return value;
}

const appEnv = appEnvironment();
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error('缺少 DATABASE_URL，无法连接 PostgreSQL');

module.exports = Object.freeze({
  appEnv,
  nodeEnv: process.env.NODE_ENV || (appEnv === 'production' ? 'production' : 'development'),
  databaseUrl,
  debugPanelDefault: booleanValue('DEBUG_PANEL_DEFAULT', false),
  logLevel: String(process.env.LOG_LEVEL || 'info').trim().toLowerCase(),
  port: positiveInteger('PORT', 4173),
  databasePoolMax: positiveInteger('DATABASE_POOL_MAX', 10),
  databaseIdleTimeoutMs: positiveInteger('DATABASE_IDLE_TIMEOUT_MS', 30000),
  databaseConnectionTimeoutMs: positiveInteger('DATABASE_CONNECTION_TIMEOUT_MS', 10000)
});
