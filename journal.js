'use strict';

const THESIS_OPTIONS = Object.freeze([
  '流动性', '货币政策', '通胀', '经济增长', '风险偏好',
  '地缘政治', '财政', '技术性因素', '暂无明确主线'
]);
const WATCH_STATUSES = Object.freeze(['未验证', '已验证', '与预期相反']);

function cleanText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return null;
  return value.map(item => ({ symbol:cleanText(item && item.symbol), note:cleanText(item && item.note) }));
}

function normalizeWatchlist(value) {
  if (!Array.isArray(value)) return null;
  return value.map(item => ({
    title:cleanText(item && item.title),
    note:cleanText(item && item.note),
    status:cleanText(item && item.status) || '未验证'
  })).filter(item => item.title || item.note);
}

function validateJournal(payload) {
  const value = {
    thesis:cleanText(payload && payload.thesis),
    summary:cleanText(payload && payload.summary),
    supporting_evidence:normalizeEvidence(payload && payload.supporting_evidence),
    opposing_evidence:normalizeEvidence(payload && payload.opposing_evidence),
    watchlist:normalizeWatchlist(payload && payload.watchlist)
  };
  if (!THESIS_OPTIONS.includes(value.thesis)) return { error:'请选择有效的交易主线' };
  if (!value.summary) return { error:'请填写一句话判断' };
  if (value.summary.length > 200) return { error:'一句话判断不能超过200字' };
  if (!value.supporting_evidence || !value.opposing_evidence || !value.watchlist) return { error:'证据和观察列表格式无效' };
  if (value.supporting_evidence.length > 20 || value.opposing_evidence.length > 20) return { error:'单侧证据不能超过20条' };
  if (value.watchlist.length > 3) return { error:'明日观察最多3条' };
  const evidence = value.supporting_evidence.concat(value.opposing_evidence);
  if (evidence.some(item => !item.symbol)) return { error:'证据必须关联指标' };
  if (evidence.some(item => !item.note)) return { error:'所选证据必须填写备注' };
  if (evidence.some(item => item.symbol.length > 40 || item.note.length > 200)) return { error:'证据代码或备注过长' };
  if (new Set(value.supporting_evidence.map(item => item.symbol)).size !== value.supporting_evidence.length) return { error:'支持证据存在重复指标' };
  if (new Set(value.opposing_evidence.map(item => item.symbol)).size !== value.opposing_evidence.length) return { error:'反对证据存在重复指标' };
  if (value.watchlist.some(item => item.title.length > 80 || item.note.length > 200)) return { error:'观察标题或备注过长' };
  if (value.watchlist.some(item => !WATCH_STATUSES.includes(item.status))) return { error:'观察状态无效' };
  return { value };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

module.exports = { THESIS_OPTIONS, WATCH_STATUSES, validateJournal, validDate };
