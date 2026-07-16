'use strict';

const config = require('./config');
const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLevel = Object.prototype.hasOwnProperty.call(levels, config.logLevel) ? config.logLevel : 'info';
const categories = new Set(['AUTH', 'API', 'SESSION', 'EDITOR', 'RLS', 'DB', 'DEPLOY']);

function write(level, message) {
  if (levels[level] > levels[activeLevel]) return;
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function categorized(category, level, message) {
  const normalized = String(category || '').toUpperCase();
  if (!categories.has(normalized)) throw new Error('Unknown log category');
  write(level, `[${normalized}] ${message}`);
}

module.exports = {
  error: message => write('error', message),
  warn: message => write('warn', message),
  info: message => write('info', message),
  debug: message => write('debug', message),
  category: categorized,
  categories:Object.freeze(Array.from(categories))
};
