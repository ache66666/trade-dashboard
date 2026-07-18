'use strict';

const fs = require('node:fs');

function parseReport(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === '{');
  if (start < 0) throw new Error('FRED summary report is missing.');
  const report = JSON.parse(lines.slice(start).join('\n'));
  if (report.connector !== 'fred-mvp' || !Array.isArray(report.plans)) {
    throw new Error('FRED summary report is invalid.');
  }
  return report;
}

function markdownSummary(report, label) {
  const lines = [
    `## ${label}`,
    '',
    `- Environment: ${report.environment}`,
    `- Connector: ${report.connector}`,
    `- Updated: ${Number(report.updated)}`,
    `- API readback verified: ${Number(report.readback && report.readback.verified || 0)}`,
    '',
    '| Indicator | Candidate date | Action |',
    '| --- | --- | --- |'
  ];
  for (const plan of report.plans) {
    lines.push(`| ${plan.symbol} | ${plan.to.observation_date} | ${plan.action} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main(argumentsList) {
  if (argumentsList.length !== 2) throw new Error('Expected log path and summary label.');
  const report = parseReport(fs.readFileSync(argumentsList[0], 'utf8'));
  process.stdout.write(markdownSummary(report, argumentsList[1]));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) {
    process.stderr.write('FRED summary generation failed.\n');
    process.exitCode = 1;
  }
}

module.exports = { markdownSummary, parseReport };
