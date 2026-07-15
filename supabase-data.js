'use strict';

const DATA_API_UNAVAILABLE = 'DATA_API_UNAVAILABLE';

function legacyJwtRole(key) {
  const parts = String(key || '').split('.');
  if (parts.length !== 3) return '';
  try {
    return String(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role || '');
  } catch (error) {
    return '';
  }
}

function isForbiddenAdminKey(key) {
  const value = String(key || '').trim();
  return /^sb_secret_/i.test(value) || legacyJwtRole(value) === 'service_role';
}

function unavailableError() {
  const error = new Error('Journal data service unavailable');
  error.code = DATA_API_UNAVAILABLE;
  return error;
}

function createSupabaseDataClient(options) {
  const config = options.config;
  const timeoutMs = options.timeoutMs || 10000;
  const suppliedFetch = options.fetchImpl;

  async function request(table, requestOptions) {
    const token = String(requestOptions.accessToken || '');
    const fetchImpl = suppliedFetch || globalThis.fetch;
    const headers = {
      apikey:config.supabasePublishableKey,
      Authorization:`Bearer ${token}`,
      Accept:'application/json'
    };
    let controller;
    let timer;
    let response;

    if (!config.supabaseUrl || !config.supabasePublishableKey ||
        isForbiddenAdminKey(config.supabasePublishableKey) || !token ||
        typeof fetchImpl !== 'function') throw unavailableError();
    let url;
    try {
      url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
    } catch (error) {
      throw unavailableError();
    }
    Object.entries(requestOptions.query || {}).forEach(([name, value]) => url.searchParams.set(name, value));
    Object.assign(headers, requestOptions.headers || {});
    if (requestOptions.body !== undefined) headers['Content-Type'] = 'application/json';

    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(url.toString(), {
        method:requestOptions.method || 'GET',
        headers,
        body:requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
        signal:controller.signal
      });
    } catch (error) {
      throw unavailableError();
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw unavailableError();
    try {
      return response.status === 204 ? [] : await response.json();
    } catch (error) {
      throw unavailableError();
    }
  }

  function getDailyNote(noteDate, accessToken) {
    return request('daily_market_notes', {
      accessToken,
      query:{ select:'*', note_date:`eq.${noteDate}`, limit:'1' }
    });
  }

  function findIndicatorSymbols(symbols, accessToken) {
    if (!symbols.length) return Promise.resolve([]);
    return request('indicators', {
      accessToken,
      query:{ select:'symbol' }
    });
  }

  function upsertDailyNote(noteDate, note, accessToken) {
    return request('daily_market_notes', {
      method:'POST',
      accessToken,
      query:{ on_conflict:'note_date', select:'*' },
      headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
      body:{
        note_date:noteDate,
        thesis:note.thesis,
        summary:note.summary,
        supporting_evidence:note.supporting_evidence,
        opposing_evidence:note.opposing_evidence,
        watchlist:note.watchlist
      }
    });
  }

  return Object.freeze({ getDailyNote, findIndicatorSymbols, upsertDailyNote });
}

module.exports = { DATA_API_UNAVAILABLE, createSupabaseDataClient, isForbiddenAdminKey };
