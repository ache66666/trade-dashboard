'use strict';

const { ALLOW_LIST, DEFAULT_SYMBOLS } = require('../connectors/fred/catalog');
const { assertProductionSafety, WRITE_CONFIRMATION } = require('../connectors/fred/production-safety');
const { safeStage, stageFailure } = require('../connectors/fred/runner');

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
    symbols:indicator ? [indicator] : DEFAULT_SYMBOLS
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
  return {
    error:'FRED_CONNECTOR_FAILED',
    stage:safeStage(error),
    message:'FRED connector stopped without changing unconfirmed data.'
  };
}

async function main() {
  let options;
  let target;
  try {
    options = parseArguments(process.argv.slice(2));
    target = assertProductionSafety(process.env, {
      writeRequested:!options.dryRun,
      confirmation:options.confirmation
    });
  } catch (error) {
    throw stageFailure(error, 'environment-validation');
  }

  let closePool;
  let logger;
  let repository;
  try {
    const database = require('../database');
    const { IndicatorRepository } = require('../connectors/fred/repository');
    closePool = database.closePool;
    logger = require('../logger');
    repository = new IndicatorRepository(database.getPool(), ALLOW_LIST);
  } catch (error) {
    throw stageFailure(error, 'repository-init');
  }
  try {
    const result = await require('../connectors/fred/runner').runFredConnector({
      repository,
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
