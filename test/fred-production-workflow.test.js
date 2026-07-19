'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ALLOW_LIST } = require('../connectors/fred/catalog');
const { markdownSummary, parseReport } = require('../scripts/summarize-fred-run');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'fred-production-sync.yml'), 'utf8');
const RUNNER = fs.readFileSync(path.join(ROOT, 'connectors', 'fred', 'runner.js'), 'utf8');

test('FRED Production workflow has weekday schedule, manual trigger and non-cancelling concurrency', () => {
  assert.match(WORKFLOW, /cron:\s*['"]30 0 \* \* 1-5['"]/);
  assert.match(WORKFLOW, /workflow_dispatch:/);
  assert.match(WORKFLOW, /group:\s*fred-production-sync/);
  assert.match(WORKFLOW, /cancel-in-progress:\s*false/);
});

test('workflow runs only the three-indicator connector behind dry-run and apply gates', () => {
  assert.deepEqual(ALLOW_LIST, ['US10Y', 'USDCNY', 'WTI']);
  const dryRun = WORKFLOW.indexOf('scripts/run-fred-connector.js --dry-run');
  const apply = WORKFLOW.indexOf('scripts/run-fred-connector.js --apply');
  assert.ok(dryRun >= 0 && apply > dryRun);
  assert.equal((WORKFLOW.match(/scripts\/run-fred-connector\.js --apply/g) || []).length, 1);
  assert.match(WORKFLOW, /APP_ENV:\s*production/);
  assert.match(WORKFLOW, /--confirm=\$FRED_PRODUCTION_WRITE_CONFIRMATION/);
});

test('workflow uses only the two approved FRED secrets and never deploys Render or Staging', () => {
  const secretNames = Array.from(WORKFLOW.matchAll(/secrets\.([A-Z0-9_]+)/g), match => match[1]);
  assert.deepEqual(secretNames.sort(), [
    'FRED_PRODUCTION_DATABASE_URL', 'FRED_PRODUCTION_WRITE_CONFIRMATION'
  ]);
  assert.doesNotMatch(WORKFLOW, /RENDER_|deploy[_ -]?hook|STAGING|onrender\.com/i);
  assert.doesNotMatch(WORKFLOW, /set\s+-x|printenv|echo\s+\$\{?(?:DATABASE_URL|FRED_PRODUCTION_WRITE_CONFIRMATION)/i);
});

test('workflow does not configure retries and includes tests plus syntax checks', () => {
  assert.doesNotMatch(WORKFLOW, /retry|attempt/i);
  assert.match(WORKFLOW, /npm test/);
  assert.match(WORKFLOW, /node --check/);
  assert.match(WORKFLOW, /environment:\s*production/);
});

test('API baseline, count and non-target checks occur before and after the single apply', () => {
  const baseline = RUNNER.indexOf('const beforeRows = await readPublicIndicators');
  const apply = RUNNER.indexOf('await repository.apply(plans)');
  const readback = RUNNER.indexOf('await verifyReadback');
  assert.ok(baseline >= 0 && apply > baseline && readback > apply);
  assert.match(RUNNER, /EXPECTED_INDICATOR_COUNT = 32/);
  assert.match(RUNNER, /READBACK_NON_TARGET_CHANGED/);
});

test('workflow logs only the sanitized summary rather than raw connector output', () => {
  assert.match(WORKFLOW, /> "\$RUNNER_TEMP\/fred-dry-run\.log" 2>&1/);
  assert.match(WORKFLOW, /> "\$RUNNER_TEMP\/fred-apply\.log" 2>&1/);
  assert.match(WORKFLOW, /summarize-fred-run\.js/);
  assert.doesNotMatch(WORKFLOW, /run-fred-connector\.js[^\n]*\|\s*tee/);
});

test('summary parser emits only safe dates, counts and indicator codes', () => {
  const report = parseReport('[INFO] safe\n{\n"connector":"fred-mvp",\n"environment":"production",\n"updated":0,\n"plans":[{"symbol":"US10Y","action":"unchanged","to":{"observation_date":"2026-07-17"}}],\n"readback":null\n}\n');
  const markdown = markdownSummary(report, 'Dry-run');
  assert.match(markdown, /US10Y \| 2026-07-17 \| unchanged/);
  assert.match(markdown, /Updated: 0/);
  assert.doesNotMatch(markdown, /DATABASE_URL|token|password|postgresql:\/\//i);
});
