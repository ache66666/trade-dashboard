'use strict';

const { ALLOW_LIST, getIndicatorDefinition } = require('./catalog');
const { fetchFredCsv } = require('./fetcher');
const { adaptFredCsv } = require('./adapter');
const { validateRecord } = require('./validator');
const { productionPublicUrl } = require('./production-safety');

const EXPECTED_INDICATOR_COUNT = 32;
const READBACK_ATTEMPT_TIMEOUT_MS = 15000;
const READBACK_MAX_ATTEMPTS = 3;
const READBACK_RETRY_DELAYS_MS = Object.freeze([1000, 2000]);
const READBACK_TOTAL_TIMEOUT_MS = 50000;
const PUBLIC_ROW_FIELDS = Object.freeze([
  'id', 'symbol', 'name', 'category', 'value', 'previous_value', 'value_unit',
  'change_type', 'source', 'as_of', 'frequency', 'is_manual', 'is_featured',
  'sort_order', 'updated_at'
]);

function safeErrorCode(error) {
  return /^[A-Z0-9_]{3,80}$/.test(String(error && error.code || ''))
    ? error.code : 'FRED_CONNECTOR_FAILED';
}

function publicPlan(plan) {
  return {
    symbol:plan.symbol,
    action:plan.action,
    from:{
      observation_date:plan.from.observation_date,
      value:plan.from.value,
      previous_value:plan.from.previous_value,
      source:plan.from.source
    },
    to:{
      observation_date:plan.to.observation_date,
      value:plan.to.value,
      previous_value:plan.to.previous_value,
      source:plan.to.source
    }
  };
}

function connectorFailure(code) {
  return Object.assign(new Error(code), { code });
}

function selectedSymbols(value) {
  const symbols = value === undefined ? ALLOW_LIST : value;
  if (!Array.isArray(symbols) || symbols.length === 0 ||
      new Set(symbols).size !== symbols.length || symbols.some(symbol => !ALLOW_LIST.includes(symbol))) {
    throw connectorFailure('FRED_INDICATOR_SELECTION_INVALID');
  }
  return symbols;
}

function validObservationDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function validatePublicRows(rows, requiredSymbols = []) {
  if (!Array.isArray(rows)) throw connectorFailure('READBACK_SHAPE_INVALID');
  if (rows.length !== EXPECTED_INDICATOR_COUNT ||
      new Set(rows.map(row => row && row.symbol)).size !== EXPECTED_INDICATOR_COUNT) {
    throw connectorFailure('READBACK_INDICATOR_SET_INVALID');
  }
  for (const symbol of requiredSymbols) {
    const row = rows.find(item => item && item.symbol === symbol);
    const definition = getIndicatorDefinition(symbol);
    if (!row || !validObservationDate(row.as_of) || !Number.isFinite(Number(row.value)) ||
        !Number.isFinite(Number(row.previous_value)) || row.value_unit !== definition.databaseUnit ||
        row.source !== definition.source) {
      throw connectorFailure('READBACK_BASELINE_MISMATCH');
    }
  }
  return rows;
}

function normalizedPublicRow(row) {
  const normalized = {};
  for (const field of PUBLIC_ROW_FIELDS) normalized[field] = row && row[field];
  return JSON.stringify(normalized);
}

async function readPublicIndicatorsOnce(baseUrl, fetchImplementation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(connectorFailure('READBACK_TIMEOUT'));
    }, timeoutMs);
  });
  const request = (async () => {
    let response;
    try {
      response = await fetchImplementation(`${baseUrl}/api/indicators`, {
        method:'GET', headers:{ Accept:'application/json' }, signal:controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === 'AbortError')) {
        throw connectorFailure('READBACK_TIMEOUT');
      }
      throw connectorFailure('READBACK_CONNECTION_ERROR');
    }
    if (!response || response.ok !== true || response.status !== 200) {
      throw connectorFailure('READBACK_HTTP_ERROR');
    }
    try {
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === 'AbortError')) {
        throw connectorFailure('READBACK_TIMEOUT');
      }
      throw connectorFailure('READBACK_JSON_INVALID');
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readPublicIndicators(environment, fetchImplementation, options = {}) {
  const baseUrl = productionPublicUrl(environment);
  const attemptTimeoutMs = options.attemptTimeoutMs || READBACK_ATTEMPT_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs || READBACK_TOTAL_TIMEOUT_MS;
  const retryDelaysMs = options.retryDelaysMs || READBACK_RETRY_DELAYS_MS;
  const sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const startedAt = Date.now();
  let lastError;

  for (let attempt = 0; attempt < READBACK_MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) throw lastError || connectorFailure('READBACK_TIMEOUT');
    try {
      const rows = await readPublicIndicatorsOnce(baseUrl, fetchImplementation,
        Math.min(attemptTimeoutMs, remainingMs));
      return validatePublicRows(rows, options.requiredSymbols || []);
    } catch (error) {
      lastError = error;
      const retryable = error && (error.code === 'READBACK_TIMEOUT' ||
        error.code === 'READBACK_CONNECTION_ERROR');
      if (!retryable || attempt === READBACK_MAX_ATTEMPTS - 1) throw error;
      const delayMs = retryDelaysMs[attempt];
      if (!Number.isFinite(delayMs) || delayMs < 0 ||
          Date.now() - startedAt + delayMs >= totalTimeoutMs) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
  throw lastError || connectorFailure('READBACK_TIMEOUT');
}

async function verifyReadback(environment, plans, fetchImplementation, beforeRows, readbackOptions) {
  const rows = await readPublicIndicators(environment, fetchImplementation, Object.assign({}, readbackOptions, {
    requiredSymbols:plans.map(plan => plan.symbol)
  }));
  const targetSymbols = new Set(plans.map(plan => plan.symbol));
  for (const plan of plans) {
    const row = rows.find(item => item && item.symbol === plan.symbol);
    if (!row || String(row.as_of) !== plan.to.observation_date ||
        Number(row.value) !== plan.to.value || Number(row.previous_value) !== plan.to.previous_value) {
      throw Object.assign(new Error('Readback failed.'), { code:'READBACK_MISMATCH' });
    }
  }
  const beforeBySymbol = new Map(beforeRows.map(row => [row.symbol, row]));
  for (const row of rows) {
    if (!targetSymbols.has(row.symbol) &&
        normalizedPublicRow(row) !== normalizedPublicRow(beforeBySymbol.get(row.symbol))) {
      throw connectorFailure('READBACK_NON_TARGET_CHANGED');
    }
  }
  return { verified:plans.length, indicatorCount:rows.length, nonTargetVerified:rows.length - plans.length };
}

async function runFredConnector(options) {
  const repository = options.repository;
  const fetchImplementation = options.fetchImplementation || globalThis.fetch;
  const now = options.now || (() => new Date());
  const dryRun = options.dryRun !== false;
  const logger = options.logger || { info:() => {}, error:() => {} };
  const symbols = selectedSymbols(options.symbols);
  const currentRows = await repository.readCurrent(symbols);
  const currentBySymbol = new Map(currentRows.map(row => [row.symbol, row]));
  const plans = [];

  try {
    for (const symbol of symbols) {
      const definition = getIndicatorDefinition(symbol);
      const fetched = await fetchFredCsv(definition.seriesId, { fetchImplementation, now });
      const record = adaptFredCsv(fetched, definition);
      const plan = validateRecord(record, definition, currentBySymbol.get(symbol), { now });
      plans.push(plan);
      logger.info(`[DATA][FRED] ${symbol} ${plan.action}`);
    }
  } catch (error) {
    logger.error(`[DATA][FRED] ${safeErrorCode(error)}`);
    throw error;
  }

  if (dryRun) {
    return { mode:'dry-run', updated:0, plans:plans.map(publicPlan) };
  }

  const beforeRows = await readPublicIndicators(options.environment, fetchImplementation,
    Object.assign({}, options.readbackOptions, { requiredSymbols:symbols }));
  const result = await repository.apply(plans);
  const readback = await verifyReadback(options.environment, plans, fetchImplementation, beforeRows,
    options.readbackOptions);
  return { mode:'apply', updated:result.updated, readback, plans:plans.map(publicPlan) };
}

module.exports = {
  EXPECTED_INDICATOR_COUNT,
  READBACK_MAX_ATTEMPTS,
  normalizedPublicRow,
  publicPlan,
  readPublicIndicators,
  runFredConnector,
  safeErrorCode,
  selectedSymbols,
  validatePublicRows,
  verifyReadback
};
