'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'production.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

function configuredPaths(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex(line => /^\s{4}paths:\s*$/.test(line));
  if (start === -1) return [];

  const paths = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const item = line.match(/^\s{6}-\s+['"]([^'"]+)['"]\s*$/);
    if (item) {
      paths.push(item[1]);
      continue;
    }
    if (line.trim() && !/^\s{6,}/.test(line)) break;
  }
  return paths;
}

test('Production deployment has an explicit application path allow-list', () => {
  const paths = configuredPaths(workflow);
  assert.deepEqual(paths, [
    '.github/workflows/production.yml',
    '*.js',
    'public/**',
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'sql/**',
    'scripts/migrate-*.js',
    'scripts/lib/production-journal-migration.js'
  ]);
});

test('independent automation, Connector-only, tests and documentation do not trigger application deployment', () => {
  const paths = configuredPaths(workflow);
  const joined = paths.join('\n');
  assert.doesNotMatch(joined, /fred|connectors|run-fred|summarize-fred/i);
  assert.doesNotMatch(joined, /test|docs|README|\.github\/workflows\/\*/i);
  assert.ok(!paths.includes('.github/workflows/fred-production-sync.yml'));
});

test('Render deployment hook and Production secret remain unchanged', () => {
  assert.match(workflow, /name:\s*Trigger Render Production deploy/);
  assert.match(workflow, /secrets\.RENDER_PRODUCTION_DEPLOY_HOOK_URL/);
  assert.match(workflow, /needs:\s*check-build/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test('existing Production check and deployment gate order remains intact', () => {
  const expectedSteps = [
    'Checkout main commit',
    'Set up Node.js',
    'Install dependencies',
    'Audit dependencies (non-blocking)',
    'Check tracked JavaScript syntax',
    'Run tests when configured',
    'Run lint when configured',
    'Build when configured',
    'Require Production deploy hook',
    'Trigger Render Production deploy'
  ];
  let previous = -1;
  for (const step of expectedSteps) {
    const current = workflow.indexOf(`name: ${step}`);
    assert.ok(current > previous, `${step} must remain in gate order`);
    previous = current;
  }
});

test('Production workflow YAML has the expected main push structure without tabs', () => {
  assert.match(workflow, /^on:\s*$/m);
  assert.match(workflow, /^\s{2}push:\s*$/m);
  assert.match(workflow, /^\s{4}branches:\s*$/m);
  assert.match(workflow, /^\s{6}- main\s*$/m);
  assert.doesNotMatch(workflow, /\t/);
});
