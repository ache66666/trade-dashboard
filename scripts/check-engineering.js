'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const expectedCodes = [
  'AUTH_REQUIRED', 'INVALID_TOKEN', 'AUTH_UNAVAILABLE', 'FORBIDDEN',
  'VALIDATION_FAILED', 'NOT_FOUND', 'RLS_DENIED', 'INTERNAL_ERROR'
];
const expectedCategories = ['AUTH', 'API', 'SESSION', 'EDITOR', 'RLS', 'DB', 'DEPLOY'];

function fail(message) {
  process.stderr.write(`Engineering check failed: ${message}\n`);
  process.exitCode = 1;
}

const codes = JSON.parse(fs.readFileSync(path.join(root, 'standards/error-codes.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(root, 'standards/log-categories.json'), 'utf8'));
if (JSON.stringify(Object.keys(codes)) !== JSON.stringify(expectedCodes)) fail('error-code registry differs from the approved contract');
if (JSON.stringify(categories) !== JSON.stringify(expectedCategories)) fail('log-category registry differs from the approved contract');

const tracked = execFileSync('git', ['ls-files'], { cwd:root, encoding:'utf8' }).split(/\r?\n/).filter(Boolean);
const forbidden = tracked.filter(file => /^\.env(?:\.|$)/.test(file) && file !== '.env.example' && file !== '.env.staging.example');
if (forbidden.length) fail(`tracked local environment files: ${forbidden.join(', ')}`);

const runtimeFiles = tracked.filter(file => /^(?:public\/.*|[^/]+)\.js$/.test(file));
runtimeFiles.forEach(file => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (/console\.log\s*\(/.test(source) && file !== 'logger.js') fail(`direct console.log in runtime file ${file}`);
});

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes:true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(absolute) : (entry.name.endsWith('.md') ? [absolute] : []);
  });
}

[path.join(root, 'README.md'), ...markdownFiles(path.join(root, 'docs'))].forEach(file => {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) fail(`broken Markdown link in ${path.relative(root, file)}: ${target}`);
  }
});

if (!process.exitCode) process.stdout.write('Engineering standards check passed.\n');
