'use strict';

const DATA_API_UNAVAILABLE = 'DATA_API_UNAVAILABLE';
const DATA_API_CONFLICT = 'DATA_API_CONFLICT';

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

function conflictError() {
  const error = new Error('Private data operation conflicted');
  error.code = DATA_API_CONFLICT;
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

    if (response.status === 409) throw conflictError();
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

  function storagePath(value) {
    const parts = String(value || '').split('/');
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..')) throw unavailableError();
    return parts.map(encodeURIComponent).join('/');
  }

  async function storageRequest(bucket, objectPath, requestOptions) {
    const token = String(requestOptions.accessToken || '');
    const fetchImpl = suppliedFetch || globalThis.fetch;
    const headers = {
      apikey:config.supabasePublishableKey,
      Authorization:`Bearer ${token}`
    };
    let controller;
    let timer;
    let response;
    let url;

    if (!config.supabaseUrl || !config.supabasePublishableKey ||
        isForbiddenAdminKey(config.supabasePublishableKey) || !token ||
        typeof fetchImpl !== 'function') throw unavailableError();
    try {
      url = requestOptions.method === 'GET'
        ? `${config.supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${storagePath(objectPath)}`
        : `${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${storagePath(objectPath)}`;
    } catch (error) {
      throw unavailableError();
    }
    if (requestOptions.contentType) headers['Content-Type'] = requestOptions.contentType;
    if (requestOptions.upsert) headers['x-upsert'] = 'true';
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(url, {
        method:requestOptions.method || 'GET',
        headers,
        body:requestOptions.body,
        signal:controller.signal
      });
    } catch (error) {
      throw unavailableError();
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw unavailableError();
    if (requestOptions.responseType === 'buffer') {
      try {
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        throw unavailableError();
      }
    }
    return [];
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

  function getMorningMeetingByDate(meetingDate, userId, accessToken) {
    return request('morning_meetings', {
      accessToken,
      query:{
        select:'id,meeting_date,primary_driver,evidence,contradiction,need_to_verify,confidence,my_view,review_notes,analysis_status,created_at,updated_at',
        meeting_date:`eq.${meetingDate}`,
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
        select:'id,meeting_id,original_filename,mime_type,size_bytes,storage_path,upload_status,created_at',
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
    const existing = await listMorningMeetingImages([meetingId], userId, accessToken);
    const requestedIds = images.filter(image => image.id).map(image => image.id);
    const kept = existing.filter(image => requestedIds.includes(image.id));
    const unknownId = requestedIds.find(id => !existing.some(image => image.id === id));
    const removed = existing.filter(image => !requestedIds.includes(image.id));
    const added = images.filter(image => !image.id);
    let inserted = [];
    if (unknownId) throw unavailableError();
    if (removed.length) {
      await request('morning_meeting_images', {
        method:'DELETE',
        accessToken,
        query:{
          meeting_id:`eq.${meetingId}`,
          user_id:`eq.${userId}`,
          id:`in.(${removed.map(image => image.id).join(',')})`
        },
        prefer:'return=minimal'
      });
    }
    if (!added.length) return kept;
    inserted = await request('morning_meeting_images', {
      method:'POST',
      accessToken,
      query:{ select:'id,meeting_id,original_filename,mime_type,size_bytes,storage_path,upload_status,created_at' },
      prefer:'return=representation',
      body:added.map(image => ({
        user_id:userId,
        meeting_id:meetingId,
        storage_path:null,
        original_filename:image.original_filename,
        mime_type:image.mime_type,
        size_bytes:image.size_bytes,
        upload_status:'metadata_only'
      }))
    });
    return kept.concat(inserted);
  }

  function getMorningMeetingImage(imageId, meetingId, userId, accessToken) {
    return request('morning_meeting_images', {
      accessToken,
      query:{
        select:'id,meeting_id,original_filename,mime_type,size_bytes,storage_path,upload_status,created_at',
        id:`eq.${imageId}`,
        meeting_id:`eq.${meetingId}`,
        user_id:`eq.${userId}`,
        limit:'1'
      }
    });
  }

  function markMorningMeetingImageStored(imageId, meetingId, storageObjectPath, userId, accessToken) {
    return request('morning_meeting_images', {
      method:'PATCH',
      accessToken,
      query:{
        id:`eq.${imageId}`,
        meeting_id:`eq.${meetingId}`,
        user_id:`eq.${userId}`,
        select:'id,meeting_id,original_filename,mime_type,size_bytes,storage_path,upload_status,created_at'
      },
      prefer:'return=representation',
      body:{ storage_path:storageObjectPath, upload_status:'stored' }
    });
  }

  function uploadMorningMeetingImage(bucket, objectPath, bytes, mimeType, accessToken) {
    return storageRequest(bucket, objectPath, {
      method:'POST',
      accessToken,
      body:bytes,
      contentType:mimeType,
      upsert:true
    });
  }

  function downloadMorningMeetingImage(bucket, objectPath, accessToken) {
    return storageRequest(bucket, objectPath, {
      method:'GET',
      accessToken,
      responseType:'buffer'
    });
  }

  async function removeMorningMeetingImages(bucket, objectPaths, accessToken) {
    const token = String(accessToken || '');
    const fetchImpl = suppliedFetch || globalThis.fetch;
    const headers = {
      apikey:config.supabasePublishableKey,
      Authorization:`Bearer ${token}`,
      'Content-Type':'application/json'
    };
    let controller;
    let timer;
    let response;
    let url;
    if (!objectPaths.length) return [];
    if (!config.supabaseUrl || !config.supabasePublishableKey ||
        isForbiddenAdminKey(config.supabasePublishableKey) || !token ||
        typeof fetchImpl !== 'function') throw unavailableError();
    try {
      url = `${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`;
      objectPaths.forEach(storagePath);
    } catch (error) {
      throw unavailableError();
    }
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(url, {
        method:'DELETE',
        headers,
        body:JSON.stringify({ prefixes:objectPaths }),
        signal:controller.signal
      });
    } catch (error) {
      throw unavailableError();
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw unavailableError();
    return [];
  }

  function getMorningMeetingAnalysis(meetingId, userId, accessToken) {
    return request('morning_meeting_analyses', {
      accessToken,
      query:{
        select:'id,meeting_id,status,extracted_text,structured_data,analysis_text,model_provider,model_name,prompt_version,error_code,error_message_safe,started_at,completed_at,created_at,updated_at',
        meeting_id:`eq.${meetingId}`,
        user_id:`eq.${userId}`,
        limit:'1'
      }
    });
  }

  function createMorningMeetingAnalysis(meetingId, userId, accessToken) {
    const now = new Date().toISOString();
    return request('morning_meeting_analyses', {
      method:'POST',
      accessToken,
      query:{ select:'id,meeting_id,status,started_at,created_at,updated_at' },
      prefer:'return=representation',
      body:{
        meeting_id:meetingId,
        user_id:userId,
        status:'processing',
        started_at:now,
        updated_at:now
      }
    });
  }

  function retryMorningMeetingAnalysis(meetingId, userId, accessToken) {
    const now = new Date().toISOString();
    return request('morning_meeting_analyses', {
      method:'PATCH',
      accessToken,
      query:{
        meeting_id:`eq.${meetingId}`,
        user_id:`eq.${userId}`,
        status:'eq.failed',
        select:'id,meeting_id,status,started_at,created_at,updated_at'
      },
      prefer:'return=representation',
      body:{
        status:'processing',
        extracted_text:'',
        structured_data:null,
        analysis_text:'',
        error_code:null,
        error_message_safe:null,
        started_at:now,
        completed_at:null,
        updated_at:now
      }
    });
  }

  function completeMorningMeetingAnalysis(meetingId, result, userId, accessToken) {
    const now = new Date().toISOString();
    return request('morning_meeting_analyses', {
      method:'PATCH',
      accessToken,
      query:{
        meeting_id:`eq.${meetingId}`,
        user_id:`eq.${userId}`,
        status:'eq.processing',
        select:'id,meeting_id,status,extracted_text,structured_data,analysis_text,model_provider,model_name,prompt_version,error_code,error_message_safe,started_at,completed_at,created_at,updated_at'
      },
      prefer:'return=representation',
      body:{
        status:'completed',
        extracted_text:result.extracted_text,
        structured_data:result.structured_data,
        analysis_text:result.analysis_text,
        model_provider:result.model_provider,
        model_name:result.model_name,
        prompt_version:result.prompt_version,
        error_code:null,
        error_message_safe:null,
        completed_at:now,
        updated_at:now
      }
    });
  }

  function failMorningMeetingAnalysis(meetingId, errorCode, safeMessage, userId, accessToken) {
    const now = new Date().toISOString();
    return request('morning_meeting_analyses', {
      method:'PATCH',
      accessToken,
      query:{
        meeting_id:`eq.${meetingId}`,
        user_id:`eq.${userId}`,
        status:'eq.processing',
        select:'id,meeting_id,status,error_code,error_message_safe,updated_at'
      },
      prefer:'return=representation',
      body:{
        status:'failed',
        error_code:errorCode,
        error_message_safe:String(safeMessage || 'Analysis failed').slice(0, 300),
        completed_at:null,
        updated_at:now
      }
    });
  }

  function invalidateMorningMeetingAnalysis(meetingId, userId, accessToken) {
    const now = new Date().toISOString();
    return request('morning_meeting_analyses', {
      method:'PATCH',
      accessToken,
      query:{
        meeting_id:`eq.${meetingId}`,
        user_id:`eq.${userId}`,
        status:'in.(completed,failed)',
        select:'id,meeting_id,status,error_code,error_message_safe,updated_at'
      },
      prefer:'return=representation',
      body:{
        status:'failed',
        extracted_text:'',
        structured_data:null,
        analysis_text:'',
        error_code:'ANALYSIS_SOURCE_CHANGED',
        error_message_safe:'The Morning Meeting changed; run analysis again',
        completed_at:null,
        updated_at:now
      }
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
    getMorningMeetingByDate,
    listMorningMeetingImages,
    upsertMorningMeeting,
    updateMorningMeeting,
    replaceMorningMeetingImages,
    getMorningMeetingImage,
    markMorningMeetingImageStored,
    uploadMorningMeetingImage,
    downloadMorningMeetingImage,
    removeMorningMeetingImages,
    getMorningMeetingAnalysis,
    createMorningMeetingAnalysis,
    retryMorningMeetingAnalysis,
    completeMorningMeetingAnalysis,
    failMorningMeetingAnalysis,
    invalidateMorningMeetingAnalysis,
    deleteMorningMeeting
  });
}

module.exports = { DATA_API_CONFLICT, DATA_API_UNAVAILABLE, createSupabaseDataClient, isForbiddenAdminKey };
