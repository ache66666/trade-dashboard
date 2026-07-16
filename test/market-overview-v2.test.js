'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/overview.css'), 'utf8');

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
  for (const category of ['Liquidity', 'Rates', 'FX', 'Equity', 'Commodity', 'Credit', 'Volatility']) {
    assert.match(app, new RegExp("name: '" + category + "'"));
  }
  for (const symbol of ['R001', 'DR007', 'CN10Y', 'US10Y', 'T.CFE', 'IRS5Y', 'DXY', 'USDCNY', 'USDJPY', 'CSI300', 'SPX', 'NDX', 'HSTECH', 'GOLD', 'WTI', 'COPPER', 'AAA3Y', 'AA+3Y', 'AA3Y', 'VIX', 'MOVE']) {
    assert.match(app, new RegExp("'" + symbol.replace(/[+.]/g, '\\$&') + "'"));
  }
});

test('Overview uses scoped up, down and pending states without changing global API behavior', () => {
  assert.match(app, /status-up/);
  assert.match(app, /status-down/);
  assert.match(app, /status-pending/);
  assert.match(css, /--status-up:\s*#18725b/);
  assert.match(css, /--status-down:\s*#b34f45/);
  assert.match(css, /\.overview-row\.status-pending/);
  assert.match(app, /\/api\/dashboard-compat\?t=/);
});

test('Overview keeps the stable ES5 and XMLHttpRequest loading path', () => {
  assert.doesNotMatch(app, /\b(?:const|let)\b/);
  assert.doesNotMatch(app, /=>/);
  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.match(app, /new XMLHttpRequest\(\)/);
  assert.match(app, /xhr\.responseType = 'text'/);
});

test('Overview defines Desktop, Tablet and Mobile layouts', () => {
  assert.match(css, /@media \(min-width: 1200px\)/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /repeat\(2, minmax\(0, 1fr\)\)/);
});
