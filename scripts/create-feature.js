'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeName(value) {
  const name = String(value || '').trim();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('Feature name must use lowercase kebab-case');
  }
  return name;
}

function templates(name) {
  return {
    'api/README.md':`# ${name} API\n\nDescribe endpoints, authentication, validation and rollback before implementation.\n`,
    'page/README.md':`# ${name} page\n\nDescribe states, accessibility and ES5/XHR compatibility before implementation.\n`,
    'css/README.md':`# ${name} styles\n\nUse component-scoped kebab-case selectors and the existing design tokens.\n`,
    'docs/FEATURE.md':`# Feature: ${name}\n\n## Goal\n\n## Non-goals\n\n## Design\n\n## Acceptance\n\n## Risks and rollback\n`,
    'test/README.md':`# ${name} tests\n\nList unit, API, security, compatibility and Staging acceptance coverage.\n`
  };
}

function scaffoldFeature(nameValue, options) {
  const name = normalizeName(nameValue);
  const root = path.resolve((options && options.root) || path.resolve(__dirname, '..'));
  const target = path.join(root, 'features', name);
  const plan = templates(name);
  if (fs.existsSync(target)) throw new Error(`Feature already exists: ${name}`);
  if (options && options.dryRun) return { name, target, files:Object.keys(plan) };
  Object.entries(plan).forEach(([relative, content]) => {
    const output = path.join(target, relative);
    fs.mkdirSync(path.dirname(output), { recursive:true });
    fs.writeFileSync(output, content, { encoding:'utf8', flag:'wx' });
  });
  return { name, target, files:Object.keys(plan) };
}

function main(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const name = args.find(value => value !== '--dry-run');
  const result = scaffoldFeature(name, { dryRun });
  process.stdout.write(`${dryRun ? 'Feature scaffold plan' : 'Feature scaffold created'}: ${result.name}\n`);
  result.files.forEach(file => process.stdout.write(`- features/${result.name}/${file}\n`));
}

if (require.main === module) {
  try { main(process.argv); }
  catch (error) {
    process.stderr.write(`Feature scaffold failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { normalizeName, scaffoldFeature, templates };
