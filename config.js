'use strict';

const { getRuntimeInfo } = require('./runtime-info');

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

function databaseProjectRef(value) {
  try {
    const parsed = new URL(String(value || ''));
    const directHost = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
    const poolerUser = /^postgres\.([a-z0-9]+)$/i.exec(decodeURIComponent(parsed.username || ''));
    return directHost ? directHost[1].toLowerCase() : poolerUser ? poolerUser[1].toLowerCase() : '';
  } catch (error) {
    return '';
  }
}

function publicSupabaseKey(value) {
  const key = String(value || '').trim();
  const parts = key.split('.');
  let payload;
  if (!key || /^sb_secret_/i.test(key)) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (parts.length !== 3) return false;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && payload.role === 'anon';
  } catch (error) {
    return false;
  }
}

function authConfiguration(appEnv, databaseUrl) {
  const rawUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  let parsed;
  let projectRef;
  let expectedRef;

  if (!rawUrl && !publishableKey) return { configured:false, url:'', key:'' };
  if (!rawUrl || !publishableKey) return { configured:false, url:'', key:'' };

  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    return { configured:false, url:'', key:'' };
  }

  projectRef = /^([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
  expectedRef = databaseProjectRef(databaseUrl);
  if (!projectRef || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    return { configured:false, url:'', key:'' };
  }
  if (appEnv === 'production' && (parsed.protocol !== 'https:' || !expectedRef || projectRef[1].toLowerCase() !== expectedRef)) {
    return { configured:false, url:'', key:'' };
  }
  if (!publicSupabaseKey(publishableKey)) return { configured:false, url:'', key:'' };

  return { configured:true, url:parsed.origin, key:publishableKey };
}

const appEnv = appEnvironment();
const databaseUrl = process.env.DATABASE_URL;
const editorWriteEnabled = appEnv === 'staging' && booleanValue('EDITOR_WRITE_ENABLED', false);
const runtime = getRuntimeInfo(process.env);
const auth = authConfiguration(appEnv, databaseUrl);

if (!databaseUrl) throw new Error('缺少 DATABASE_URL，无法连接 PostgreSQL');

module.exports = Object.freeze({
  appEnv,
  nodeEnv: process.env.NODE_ENV || (appEnv === 'production' ? 'production' : 'development'),
  databaseUrl,
  debugPanelDefault: booleanValue('DEBUG_PANEL_DEFAULT', false),
  editorWriteEnabled,
  authConfigured:auth.configured,
  supabaseUrl:auth.url,
  supabasePublishableKey:auth.key,
  logLevel: String(process.env.LOG_LEVEL || 'info').trim().toLowerCase(),
  port: positiveInteger('PORT', 4173),
  databasePoolMax: positiveInteger('DATABASE_POOL_MAX', 10),
  databaseIdleTimeoutMs: positiveInteger('DATABASE_IDLE_TIMEOUT_MS', 30000),
  databaseConnectionTimeoutMs: positiveInteger('DATABASE_CONNECTION_TIMEOUT_MS', 10000),
  commit: runtime.commit,
  version: runtime.version,
  deployedAt: runtime.deployedAt
});
