'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateJournal, validDate } = require('../journal');

function validPayload() {
  return {
    thesis:'流动性',
    summary:'今日债市主要交易资金宽松预期。',
    supporting_evidence:[{ symbol:'DR007', note:'资金价格继续下行。' }],
    opposing_evidence:[{ symbol:'CSI300', note:'权益市场尚未验证。' }],
    watchlist:[{ title:'观察DR007', note:'是否继续下行', status:'未验证' }]
  };
}

test('journal accepts a complete daily note and trims text', () => {
  const payload = validPayload();
  payload.summary = `  ${payload.summary}  `;
  const result = validateJournal(payload);
  assert.equal(result.error, undefined);
  assert.equal(result.value.summary, '今日债市主要交易资金宽松预期。');
  assert.equal(result.value.watchlist.length, 1);
});

test('journal enforces thesis, 200 character summary and three watch items', () => {
  const invalidThesis = validPayload();
  invalidThesis.thesis = '自动分析';
  assert.match(validateJournal(invalidThesis).error, /交易主线/);
  const longSummary = validPayload();
  longSummary.summary = '市'.repeat(201);
  assert.match(validateJournal(longSummary).error, /200/);
  const tooMany = validPayload();
  tooMany.watchlist = [1,2,3,4].map(index => ({ title:`观察${index}`, status:'未验证' }));
  assert.match(validateJournal(tooMany).error, /最多3条/);
});

test('journal rejects duplicate evidence and invalid watch status', () => {
  const duplicate = validPayload();
  duplicate.supporting_evidence.push({ symbol:'DR007', note:'重复' });
  assert.match(validateJournal(duplicate).error, /重复指标/);
  const invalidStatus = validPayload();
  invalidStatus.watchlist[0].status = '已忽略';
  assert.match(validateJournal(invalidStatus).error, /状态无效/);
  const missingNote = validPayload();
  missingNote.supporting_evidence[0].note = '';
  assert.match(validateJournal(missingNote).error, /填写备注/);
});

test('journal date accepts ISO dates only', () => {
  assert.equal(validDate('2026-07-14'), true);
  assert.equal(validDate('2026/07/14'), false);
  assert.equal(validDate('2026-02-31'), false);
  assert.equal(validDate('today'), false);
});
