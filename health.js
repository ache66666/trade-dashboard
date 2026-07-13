'use strict';

const { createHealthPayload } = require('./runtime-info');

async function handleHealth({ query, sendJson, response, config }) {
  try {
    await query('SELECT 1');
    return sendJson(response, 200, createHealthPayload({
      status:'ok', environment:config.appEnv, database:'connected', runtime:config
    }));
  } catch {
    return sendJson(response, 503, createHealthPayload({
      status:'error', environment:config.appEnv, database:'disconnected', runtime:config
    }));
  }
}

module.exports = { handleHealth };
