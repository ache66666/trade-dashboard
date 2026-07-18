'use strict';

function adapterError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function splitCsvLine(line) {
  return String(line || '').replace(/\r$/, '').split(',').map(value => value.trim());
}

function convertValue(value, definition) {
  const scale = Number.isFinite(Number(definition.scale)) ? Number(definition.scale) : 1;
  const offset = Number.isFinite(Number(definition.offset)) ? Number(definition.offset) : 0;
  return (Number(value) * scale) + offset;
}

function adaptFredCsv(result, definition) {
  const lines = String(result && result.body || '').split(/\n/).filter(line => line.trim() !== '');
  const header = splitCsvLine(lines.shift());
  const observations = [];

  if (!result || result.seriesId !== definition.seriesId) throw adapterError('FRED_SERIES_MISMATCH');
  if (header.length < 2 || header[0] !== 'observation_date' || header[1] !== definition.seriesId) {
    throw adapterError('FRED_HEADER_INVALID');
  }

  for (const line of lines) {
    const row = splitCsvLine(line);
    if (row.length < 2) throw adapterError('FRED_ROW_INVALID');
    if (!validIsoDate(row[0])) throw adapterError('FRED_DATE_INVALID');
    if (row[1] === '' || row[1] === '.') continue;
    if (!Number.isFinite(Number(row[1]))) throw adapterError('FRED_VALUE_INVALID');
    observations.push({ date:row[0], value:convertValue(row[1], definition) });
  }
  if (observations.length < 2) throw adapterError('FRED_INSUFFICIENT_OBSERVATIONS');

  const previous = observations[observations.length - 2];
  const latest = observations[observations.length - 1];
  const change = latest.value - previous.value;
  const changePct = previous.value === 0 ? null : (change / previous.value) * 100;

  return {
    indicator_code:definition.indicatorCode,
    observation_date:latest.date,
    value:latest.value,
    previous_value:previous.value,
    change:definition.changeType === 'bp' ? change * 100 : change,
    change_pct:changePct,
    source:definition.source,
    source_timestamp:latest.date,
    fetched_at:result.fetchedAt,
    status:'valid',
    unit:definition.unit,
    series_id:definition.seriesId
  };
}

module.exports = { adaptFredCsv, convertValue, validIsoDate };
