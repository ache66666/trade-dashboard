'use strict';

const { validIsoDate } = require('./adapter');

function validationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function dateAfterUtcTomorrow(value, now) {
  const tomorrow = new Date(now.getTime());
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return value > tomorrow.toISOString().slice(0, 10);
}

function validateRecord(record, definition, current, options = {}) {
  const now = options.now ? options.now() : new Date();
  if (!current || current.symbol !== definition.indicatorCode) {
    throw validationError('INDICATOR_NOT_FOUND');
  }
  if (record.indicator_code !== definition.indicatorCode) throw validationError('INDICATOR_CODE_MISMATCH');
  if (record.source !== definition.source) throw validationError('SOURCE_MISMATCH');
  if (record.series_id !== definition.seriesId) throw validationError('SOURCE_SYMBOL_MISMATCH');
  if (record.unit !== definition.unit || String(current.value_unit || '') !== definition.databaseUnit) {
    throw validationError('UNIT_MISMATCH');
  }
  if (String(current.category || '') !== definition.category) throw validationError('CATEGORY_MISMATCH');
  if (String(current.change_type || '') !== definition.changeType) throw validationError('CHANGE_TYPE_MISMATCH');
  if (!Number.isFinite(record.value) || !Number.isFinite(record.previous_value)) {
    throw validationError('VALUE_NOT_FINITE');
  }
  if (record.value < definition.minimum || record.value > definition.maximum ||
      record.previous_value < definition.minimum || record.previous_value > definition.maximum) {
    throw validationError('VALUE_OUT_OF_RANGE');
  }
  if (!validIsoDate(record.observation_date) || dateAfterUtcTomorrow(record.observation_date, now)) {
    throw validationError('OBSERVATION_DATE_INVALID');
  }
  if (record.source_timestamp !== record.observation_date ||
      !Number.isFinite(new Date(record.fetched_at).getTime())) {
    throw validationError('SOURCE_TIMESTAMP_INVALID');
  }
  if (current.as_of && record.observation_date < String(current.as_of)) {
    throw validationError('OBSERVATION_REGRESSION');
  }

  const unchanged = record.observation_date === String(current.as_of || '') &&
    Number(current.value) === record.value &&
    Number(current.previous_value) === record.previous_value &&
    String(current.source || '') === record.source &&
    String(current.frequency || '') === definition.frequency && current.is_manual === false;

  return {
    symbol:definition.indicatorCode,
    action:unchanged ? 'unchanged' : 'update',
    from:{
      observation_date:String(current.as_of || ''),
      value:Number(current.value),
      previous_value:Number(current.previous_value),
      source:String(current.source || '')
    },
    to:{
      observation_date:record.observation_date,
      value:record.value,
      previous_value:record.previous_value,
      source:record.source,
      frequency:definition.frequency
    },
    record
  };
}

module.exports = { validateRecord };
