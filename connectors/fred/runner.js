'use strict';

const { ALLOW_LIST, getIndicatorDefinition } = require('./catalog');
const { fetchFredCsv } = require('./fetcher');
const { adaptFredCsv } = require('./adapter');
const { validateRecord } = require('./validator');
const { productionPublicUrl } = require('./production-safety');

const EXPECTED_INDICATOR_COUNT = 32;
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

function normalizedPublicRow(row) {
  const normalized = {};
  for (const field of PUBLIC_ROW_FIELDS) normalized[field] = row && row[field];
  return JSON.stringify(normalized);
}

async function readPublicIndicators(environment, fetchImplementation) {
  const baseUrl = productionPublicUrl(environment);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let response;
  let rows;
  try {
    response = await fetchImplementation(`${baseUrl}/api/indicators`, {
      method:'GET', headers:{ Accept:'application/json' }, signal:controller.signal
    });
    if (!response || response.ok !== true) throw connectorFailure('READBACK_HTTP_ERROR');
    rows = await response.json();
  } catch (error) {
    if (controller.signal.aborted || (error && error.name === 'AbortError')) {
      throw connectorFailure('READBACK_TIMEOUT');
    }
    if (error && error.code) throw error;
    throw connectorFailure('READBACK_JSON_INVALID');
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(rows)) throw Object.assign(new Error('Readback failed.'), { code:'READBACK_SHAPE_INVALID' });
  if (rows.length !== EXPECTED_INDICATOR_COUNT ||
      new Set(rows.map(row => row && row.symbol)).size !== EXPECTED_INDICATOR_COUNT) {
    throw connectorFailure('READBACK_INDICATOR_SET_INVALID');
  }
  return rows;
}

async function verifyReadback(environment, plans, fetchImplementation, beforeRows) {
  const rows = await readPublicIndicators(environment, fetchImplementation);
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

  const beforeRows = await readPublicIndicators(options.environment, fetchImplementation);
  const result = await repository.apply(plans);
  const readback = await verifyReadback(options.environment, plans, fetchImplementation, beforeRows);
  return { mode:'apply', updated:result.updated, readback, plans:plans.map(publicPlan) };
}

module.exports = {
  EXPECTED_INDICATOR_COUNT,
  normalizedPublicRow,
  publicPlan,
  readPublicIndicators,
  runFredConnector,
  safeErrorCode,
  selectedSymbols,
  verifyReadback
};
