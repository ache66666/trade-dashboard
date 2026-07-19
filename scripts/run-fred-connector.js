'use strict';

const { ALLOW_LIST } = require('../connectors/fred/catalog');
const { assertProductionSafety, WRITE_CONFIRMATION } = require('../connectors/fred/production-safety');

function parseArguments(argumentsList) {
  const apply = argumentsList.includes('--apply');
  const dryRunFlag = argumentsList.includes('--dry-run');
  const confirmations = argumentsList.filter(value => value.startsWith('--confirm='));
  const indicators = argumentsList.filter(value => value.startsWith('--indicator='));
  const known = argumentsList.every(value => value === '--apply' || value === '--dry-run' ||
    value.startsWith('--confirm=') || value.startsWith('--indicator='));
  if (!known || (apply && dryRunFlag) || confirmations.length > 1 || indicators.length > 1) {
    throw new Error('Invalid FRED connector options.');
  }
  const indicator = indicators.length ? indicators[0].slice('--indicator='.length).trim().toUpperCase() : '';
  if (indicators.length && !ALLOW_LIST.includes(indicator)) {
    throw new Error('Invalid FRED connector indicator.');
  }
  return {
    dryRun:!apply,
    confirmation:confirmations.length ? confirmations[0].slice('--confirm='.length) : '',
    symbols:indicator ? [indicator] : ALLOW_LIST
  };
}

function safeReport(target, result) {
  return {
    connector:'fred-mvp',
    environment:target.environment,
    project:target.project,
    database:target.database,
    mode:result.mode,
    allowList:result.plans.map(plan => plan.symbol),
    updated:result.updated,
    plans:result.plans,
    readback:result.readback || null
  };
}

function safeFailure(error) {
  const code = /^[A-Z0-9_]{3,80}$/.test(String(error && error.code || ''))
    ? error.code : 'FRED_CONNECTOR_FAILED';
  return { error:code, message:'FRED connector stopped without changing unconfirmed data.' };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const target = assertProductionSafety(process.env, {
    writeRequested:!options.dryRun,
    confirmation:options.confirmation
  });
  const { getPool, closePool } = require('../database');
  const logger = require('../logger');
  const { IndicatorRepository } = require('../connectors/fred/repository');
  const { runFredConnector } = require('../connectors/fred/runner');
  const pool = getPool();
  try {
    const result = await runFredConnector({
      repository:new IndicatorRepository(pool, require('../connectors/fred/catalog').ALLOW_LIST),
      dryRun:options.dryRun,
      environment:process.env,
      logger,
      symbols:options.symbols
    });
    process.stdout.write(`${JSON.stringify(safeReport(target, result), null, 2)}\n`);
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArguments, safeFailure, safeReport, WRITE_CONFIRMATION };
