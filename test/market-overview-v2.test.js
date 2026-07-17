'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/overview.css'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let index;
  for (index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error('unterminated function ' + name);
}

function loadOverviewModel() {
  const context = {};
  const names = ['text', 'escapeHtml', 'simpleValue', 'simpleChange', 'marketStatusClass', 'overviewRow'];
  vm.runInNewContext(names.map((name) => extractFunction(app, name)).join('\n'), context);
  return context;
}

test('Market Overview 2.0 exposes the intended information hierarchy', () => {
  assert.match(html, /TODAY'S MARKET/);
  assert.match(html, /Market Status/);
  assert.match(html, /TODAY'S STORY/);
  assert.match(html, /RECENT JOURNAL/);
  assert.match(html, /MACRO CALENDAR/);
  assert.match(html, /id="overviewGrid"/);
  assert.match(html, /id="ticker"/);
});

test('Market Status covers all seven product categories and representative symbols', () => {
  const groupNames = Array.from(app.matchAll(/\{ name: '([^']+)', label:/g), match => match[1]);
  assert.deepEqual(groupNames, ['Liquidity', 'Rates', 'FX', 'Equity', 'Commodity', 'Credit', 'Volatility']);
  for (const category of ['Liquidity', 'Rates', 'FX', 'Equity', 'Commodity', 'Credit', 'Volatility']) {
    assert.match(app, new RegExp("name: '" + category + "'"));
  }
  for (const symbol of ['R001', 'DR007', 'CN10Y', 'US10Y', 'T.CFE', 'IRS5Y', 'DXY', 'USDCNY', 'USDJPY', 'CSI300', 'SPX', 'NDX', 'HSTECH', 'GOLD', 'WTI', 'COPPER', 'AAA3Y', 'AA+3Y', 'AA3Y', 'VIX', 'MOVE']) {
    assert.match(app, new RegExp("'" + symbol.replace(/[+.]/g, '\\$&') + "'"));
  }
});

test('Overview uses scoped up, down and pending states without changing the compat API', () => {
  assert.match(app, /status-up/);
  assert.match(app, /status-down/);
  assert.match(app, /status-pending/);
  assert.match(css, /--status-up:\s*#18725b/);
  assert.match(css, /--status-down:\s*#b34f45/);
  assert.match(css, /\.overview-row\.status-pending/);
  assert.match(app, /\/api\/dashboard-compat\?t=/);
});

test('Market state mapping executes correctly for up, down, flat, pending and invalid values', () => {
  const model = loadOverviewModel();
  assert.equal(model.marketStatusClass({ value: 2, previous_value: 1, source: 'Test' }), 'status-up');
  assert.equal(model.marketStatusClass({ value: 1, previous_value: 2, source: 'Test' }), 'status-down');
  assert.equal(model.marketStatusClass({ value: 1, previous_value: 1, source: 'Test' }), 'status-flat');
  assert.equal(model.marketStatusClass({ value: null, previous_value: 1, source: 'Test' }), 'status-pending');
  assert.equal(model.marketStatusClass({ value: 'invalid', previous_value: 1, source: 'Test' }), 'status-pending');
  assert.equal(model.marketStatusClass({ value: 1, previous_value: 0, source: '待手工录入' }), 'status-pending');
});

test('Missing and invalid values render explicit data states instead of numeric artifacts', () => {
  const model = loadOverviewModel();
  const missing = { name: 'Missing', symbol: 'MISS', value: null, previous_value: 1, value_unit: '%', source: 'Test', change_type: 'percent', as_of: '', frequency: '', is_manual: false };
  const invalid = { name: 'Invalid', symbol: 'BAD', value: 'NaN', previous_value: 1, value_unit: '', source: 'Test', change_type: 'percent', as_of: '', frequency: '', is_manual: false };
  assert.equal(model.simpleValue(missing), '暂无数据');
  assert.equal(model.simpleChange(missing), '暂无数据');
  assert.equal(model.simpleValue(invalid), '暂无数据');
  assert.equal(model.simpleChange(invalid), '暂无数据');
  for (const output of [model.overviewRow(missing, 'MISS'), model.overviewRow(invalid, 'BAD'), model.overviewRow(null, 'NONE')]) {
    assert.doesNotMatch(output, /(?:NaN|undefined|null)/);
  }
});

test('Overview keeps the stable ES5 and XMLHttpRequest loading path', () => {
  assert.doesNotMatch(app, /\b(?:const|let)\b/);
  assert.doesNotMatch(app, /=>/);
  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.doesNotMatch(app, /\bPromise\b/);
  assert.doesNotMatch(app, /\.at\s*\(/);
  assert.match(app, /new XMLHttpRequest\(\)/);
  assert.match(app, /xhr\.responseType = 'text'/);
});

test('Overview defines Desktop, Tablet and Mobile layouts without mobile horizontal scrolling', () => {
  assert.match(css, /@media \(min-width: 1200px\)/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /#overview \.ticker \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); overflow: hidden; \}/);
  assert.doesNotMatch(css, /#overview \.ticker \{[^}]*overflow-x:\s*auto/);
});
