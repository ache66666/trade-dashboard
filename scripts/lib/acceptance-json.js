'use strict';

function parseJsonArray(text, label) {
  let parsed;
  const name = label || 'response';

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} is not valid JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array`);
  }
  return parsed;
}

function countJsonArray(text, label) {
  return parseJsonArray(text, label).length;
}

module.exports = { countJsonArray, parseJsonArray };
