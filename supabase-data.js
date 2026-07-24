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
    let url;

    if (!config.supabaseUrl || !config.supabasePublishableKey ||
        isForbiddenAdminKey(config.supabasePublishableKey) || !token ||
        typeof fetchImpl !== 'function') throw unavailableError();
    try {
      url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
    } catch (error) {
      throw unavailableError();
    }
    Object.entries(requestOptions.query || {}).forEach(([name, value]) => url.searchParams.set(name, value));
    if (requestOptions.prefer) headers.Prefer = requestOptions.prefer;
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

  function getDailyNote(noteDate, userId, accessToken) {
    return request('daily_market_notes', {
      accessToken,
      query:{ select:'*', user_id:`eq.${userId}`, note_date:`eq.${noteDate}`, limit:'1' }
    });
  }

  function findIndicatorSymbols(symbols, accessToken) {
    if (!symbols.length) return Promise.resolve([]);
    return request('indicators', { accessToken, query:{ select:'symbol' } });
  }

  function upsertDailyNote(noteDate, note, userId, accessToken) {
    return request('daily_market_notes', {
      method:'POST',
      accessToken,
      query:{ on_conflict:'user_id,note_date', select:'*' },
      prefer:'resolution=merge-duplicates,return=representation',
      body:{
        user_id:userId,
        note_date:noteDate,
        thesis:note.thesis,
        summary:note.summary,
        supporting_evidence:note.supporting_evidence,
        opposing_evidence:note.opposing_evidence,
        watchlist:note.watchlist
      }
    });
  }

  function deleteDailyNote(noteDate, userId, accessToken) {
    return request('daily_market_notes', {
      method:'DELETE',
      accessToken,
      query:{ user_id:`eq.${userId}`, note_date:`eq.${noteDate}` },
      prefer:'return=minimal'
    });
  }

  function listMorningMeetings(userId, accessToken) {
    return request('morning_meetings', {
      accessToken,
      query:{
        select:'id,meeting_date,primary_driver,evidence,contradiction,need_to_verify,confidence,my_view,review_notes,analysis_status,created_at,updated_at',
        user_id:`eq.${userId}`,
        order:'meeting_date.desc,updated_at.desc'
      }
    });
  }

  function getMorningMeeting(meetingId, userId, accessToken) {
    return request('morning_meetings', {
      accessToken,
      query:{
        select:'id,meeting_date,primary_driver,evidence,contradiction,need_to_verify,confidence,my_view,review_notes,analysis_status,created_at,updated_at',
        id:`eq.${meetingId}`,
        user_id:`eq.${userId}`,
        limit:'1'
      }
    });
  }

  function listMorningMeetingImages(meetingIds, userId, accessToken) {
    if (!meetingIds.length) return Promise.resolve([]);
    return request('morning_meeting_images', {
      accessToken,
      query:{
        select:'id,meeting_id,original_filename,mime_type,size_bytes,upload_status,created_at',
        meeting_id:`in.(${meetingIds.join(',')})`,
        user_id:`eq.${userId}`,
        order:'created_at.asc'
      }
    });
  }

  function upsertMorningMeeting(meeting, userId, accessToken) {
    return request('morning_meetings', {
      method:'POST',
      accessToken,
      query:{ on_conflict:'user_id,meeting_date', select:'id,meeting_date,primary_driver,evidence,contradiction,need_to_verify,confidence,my_view,review_notes,analysis_status,created_at,updated_at' },
      prefer:'resolution=merge-duplicates,return=representation',
      body:{
        user_id:userId,
        meeting_date:meeting.meeting_date,
        primary_driver:meeting.primary_driver,
        evidence:meeting.evidence,
        contradiction:meeting.contradiction,
        need_to_verify:meeting.need_to_verify,
        confidence:meeting.confidence,
        my_view:meeting.my_view,
        review_notes:meeting.review_notes,
        analysis_status:'not_configured',
        updated_at:new Date().toISOString()
      }
    });
  }

  function updateMorningMeeting(meetingId, meeting, userId, accessToken) {
    return request('morning_meetings', {
      method:'PATCH',
      accessToken,
      query:{
        id:`eq.${meetingId}`,
        user_id:`eq.${userId}`,
        select:'id,meeting_date,primary_driver,evidence,contradiction,need_to_verify,confidence,my_view,review_notes,analysis_status,created_at,updated_at'
      },
      prefer:'return=representation',
      body:{
        meeting_date:meeting.meeting_date,
        primary_driver:meeting.primary_driver,
        evidence:meeting.evidence,
        contradiction:meeting.contradiction,
        need_to_verify:meeting.need_to_verify,
        confidence:meeting.confidence,
        my_view:meeting.my_view,
        review_notes:meeting.review_notes,
        analysis_status:'not_configured',
        updated_at:new Date().toISOString()
      }
    });
  }

  async function replaceMorningMeetingImages(meetingId, images, userId, accessToken) {
    await request('morning_meeting_images', {
      method:'DELETE',
      accessToken,
      query:{ meeting_id:`eq.${meetingId}`, user_id:`eq.${userId}` },
      prefer:'return=minimal'
    });
    if (!images.length) return [];
    return request('morning_meeting_images', {
      method:'POST',
      accessToken,
      query:{ select:'id,meeting_id,original_filename,mime_type,size_bytes,upload_status,created_at' },
      prefer:'return=representation',
      body:images.map(image => ({
        user_id:userId,
        meeting_id:meetingId,
        storage_path:null,
        original_filename:image.original_filename,
        mime_type:image.mime_type,
        size_bytes:image.size_bytes,
        upload_status:'metadata_only'
      }))
    });
  }

  function deleteMorningMeeting(meetingId, userId, accessToken) {
    return request('morning_meetings', {
      method:'DELETE',
      accessToken,
      query:{ id:`eq.${meetingId}`, user_id:`eq.${userId}`, select:'id' },
      prefer:'return=representation'
    });
  }

  return Object.freeze({
    getDailyNote,
    findIndicatorSymbols,
    upsertDailyNote,
    deleteDailyNote,
    listMorningMeetings,
    getMorningMeeting,
    listMorningMeetingImages,
    upsertMorningMeeting,
    updateMorningMeeting,
    replaceMorningMeetingImages,
    deleteMorningMeeting
  });
}

module.exports = { DATA_API_UNAVAILABLE, createSupabaseDataClient, isForbiddenAdminKey };
