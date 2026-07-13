'use strict';

const packageJson = require('./package.json');

function firstValue(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return undefined;
}

function getRuntimeInfo(environment = process.env) {
  return Object.freeze({
    commit: firstValue([
      environment.RENDER_GIT_COMMIT,
      environment.GITHUB_SHA,
      environment.COMMIT_SHA
    ]) || 'unknown',
    version: firstValue([environment.APP_VERSION, packageJson.version]) || 'unknown',
    deployedAt: firstValue([environment.DEPLOYED_AT, environment.RENDER_DEPLOYED_AT]) || null
  });
}

function createHealthPayload({ status, environment, database, runtime }) {
  return {
    status,
    environment,
    database,
    commit: runtime.commit,
    version: runtime.version,
    deployedAt: runtime.deployedAt
  };
}

module.exports = { getRuntimeInfo, createHealthPayload };
