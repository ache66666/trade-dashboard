'use strict';

const FRED_CSV_ORIGIN = 'https://fred.stlouisfed.org';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function connectorError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function looksLikeHtml(contentType, text) {
  return /(?:text\/html|application\/xhtml\+xml)/i.test(String(contentType || '')) ||
    /^\s*(?:<!doctype\s+html|<html\b)/i.test(String(text || ''));
}

async function fetchFredCsv(seriesId, options = {}) {
  const id = String(seriesId || '').trim().toUpperCase();
  const fetchImplementation = options.fetchImplementation || globalThis.fetch;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs : 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let text;

  if (!/^[A-Z0-9_]{2,32}$/.test(id)) throw connectorError('FRED_SERIES_INVALID');
  if (typeof fetchImplementation !== 'function') throw connectorError('FRED_FETCH_UNAVAILABLE');

  try {
    response = await fetchImplementation(
      `${FRED_CSV_ORIGIN}/graph/fredgraph.csv?id=${encodeURIComponent(id)}`,
      { method:'GET', headers:{ Accept:'text/csv' }, signal:controller.signal }
    );
    if (!response || response.ok !== true) throw connectorError('FRED_HTTP_ERROR');
    text = await response.text();
  } catch (error) {
    if (controller.signal.aborted || (error && error.name === 'AbortError')) {
      throw connectorError('FRED_FETCH_TIMEOUT');
    }
    if (error && error.code === 'FRED_HTTP_ERROR') throw error;
    if (response) throw connectorError('FRED_BODY_READ_FAILED');
    throw connectorError('FRED_FETCH_FAILED');
  } finally {
    clearTimeout(timer);
  }

  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw connectorError('FRED_RESPONSE_TOO_LARGE');
  }
  if (looksLikeHtml(response.headers && response.headers.get
    ? response.headers.get('content-type') : '', text)) {
    throw connectorError('FRED_HTML_RESPONSE');
  }
  if (!String(text || '').trim()) throw connectorError('FRED_EMPTY_RESPONSE');

  return {
    seriesId:id,
    body:text,
    fetchedAt:(options.now ? options.now() : new Date()).toISOString()
  };
}

module.exports = { FRED_CSV_ORIGIN, fetchFredCsv, looksLikeHtml };
