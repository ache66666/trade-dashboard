'use strict';

const { ALLOW_LIST, getIndicatorDefinition } = require('./catalog');
const { fetchFredCsv } = require('./fetcher');
const { adaptFredCsv } = require('./adapter');
const { validateRecord } = require('./validator');
const { productionPublicUrl } = require('./production-safety');

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

async function verifyReadback(environment, plans, fetchImplementation) {
  const baseUrl = productionPublicUrl(environment);
  const response = await fetchImplementation(`${baseUrl}/api/indicators`, {
    method:'GET', headers:{ Accept:'application/json' }
  });
  if (!response || response.ok !== true) throw Object.assign(new Error('Readback failed.'), { code:'READBACK_HTTP_ERROR' });
  let rows;
  try { rows = await response.json(); } catch (error) {
    throw Object.assign(new Error('Readback failed.'), { code:'READBACK_JSON_INVALID' });
  }
  if (!Array.isArray(rows)) throw Object.assign(new Error('Readback failed.'), { code:'READBACK_SHAPE_INVALID' });
  for (const plan of plans) {
    const row = rows.find(item => item && item.symbol === plan.symbol);
    if (!row || String(row.as_of) !== plan.to.observation_date ||
        Number(row.value) !== plan.to.value || Number(row.previous_value) !== plan.to.previous_value) {
      throw Object.assign(new Error('Readback failed.'), { code:'READBACK_MISMATCH' });
    }
  }
  return { verified:plans.length };
}

async function runFredConnector(options) {
  const repository = options.repository;
  const fetchImplementation = options.fetchImplementation || globalThis.fetch;
  const now = options.now || (() => new Date());
  const dryRun = options.dryRun !== false;
  const logger = options.logger || { info:() => {}, error:() => {} };
  const currentRows = await repository.readCurrent(ALLOW_LIST);
  const currentBySymbol = new Map(currentRows.map(row => [row.symbol, row]));
  const plans = [];

  try {
    for (const symbol of ALLOW_LIST) {
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

  const result = await repository.apply(plans);
  const readback = await verifyReadback(options.environment, plans, fetchImplementation);
  return { mode:'apply', updated:result.updated, readback, plans:plans.map(publicPlan) };
}

module.exports = { publicPlan, runFredConnector, safeErrorCode, verifyReadback };
