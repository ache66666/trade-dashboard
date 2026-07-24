(function (window, document) {
  'use strict';

  var auth = window.marketAuth;
  var selectedFiles = [];
  var existingImages = [];
  var previewUrls = [];
  var currentMeetingId = null;
  var limits = { count:12, fileBytes:10 * 1024 * 1024, totalBytes:60 * 1024 * 1024 };
  var mimeExtensions = {
    'image/jpeg':['jpg', 'jpeg'],
    'image/png':['png'],
    'image/webp':['webp']
  };

  function byId(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function localDate() {
    var date = new Date();
    var offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }
  function clearPreviewUrls() {
    var i;
    for (i = 0; i < previewUrls.length; i += 1) window.URL.revokeObjectURL(previewUrls[i]);
    previewUrls = [];
  }
  function fileExtension(name) {
    var match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return match ? match[1].toLowerCase() : '';
  }
  function metadataError(file) {
    var extensions = mimeExtensions[String(file.type || '').toLowerCase()];
    var extension = fileExtension(file.name);
    if (!extensions || extensions.indexOf(extension) < 0) return 'Only JPEG, PNG, and WebP screenshots are supported.';
    if (/[\/\\]/.test(file.name) || /\.(?:exe|com|bat|cmd|ps1|sh|js|html?|svg|pdf|php|jar|msi)(?:\.|$)/i.test(file.name)) return 'A screenshot filename is not allowed.';
    if (!file.size || file.size > limits.fileBytes) return 'Each screenshot must be 10 MB or smaller.';
    return '';
  }
  function bytesMatch(file, bytes) {
    if (file.type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (file.type === 'image/png') return bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
    if (file.type === 'image/webp') return bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
    return false;
  }
  function validateMagic(file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result || new ArrayBuffer(0));
      done(bytesMatch(file, bytes) ? null : new Error('A file does not match its declared image type.'));
    };
    reader.onerror = function () { done(new Error('A screenshot could not be read.')); };
    reader.readAsArrayBuffer(file.slice(0, 12));
  }
  function setStatus(message, state) {
    byId('morningStatus').className = 'morning-status' + (state ? ' is-' + state : '');
    byId('morningStatus').textContent = message;
  }
  function totalSelectedBytes(files) {
    var total = 0;
    var i;
    for (i = 0; i < files.length; i += 1) total += files[i].size;
    return total;
  }
  function processFiles(files, index, accepted, done) {
    var error;
    if (index >= files.length) { done(accepted); return; }
    error = metadataError(files[index]);
    if (error) { done(accepted, new Error(error)); return; }
    validateMagic(files[index], function (magicError) {
      if (magicError) { done(accepted, magicError); return; }
      accepted.push(files[index]);
      processFiles(files, index + 1, accepted, done);
    });
  }
  function renderPreviews() {
    var root = byId('morningPreview');
    var fragment = document.createDocumentFragment();
    var i;
    clearPreviewUrls();
    root.innerHTML = '';
    for (i = 0; i < selectedFiles.length; i += 1) {
      (function (file, index) {
        var card = document.createElement('article');
        var image = document.createElement('img');
        var info = document.createElement('div');
        var name = document.createElement('b');
        var status = document.createElement('small');
        var remove = document.createElement('button');
        var url = window.URL.createObjectURL(file);
        previewUrls.push(url);
        image.src = url;
        image.alt = '';
        name.textContent = file.name;
        status.textContent = 'Selected · local preview only';
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.onclick = function () {
          selectedFiles.splice(index, 1);
          renderPreviews();
        };
        info.appendChild(name);
        info.appendChild(status);
        card.appendChild(image);
        card.appendChild(info);
        card.appendChild(remove);
        fragment.appendChild(card);
      }(selectedFiles[i], i));
    }
    for (i = 0; i < existingImages.length; i += 1) {
      (function (imageMetadata, index) {
        var card = document.createElement('article');
        var placeholder = document.createElement('div');
        var info = document.createElement('div');
        var name = document.createElement('b');
        var status = document.createElement('small');
        var remove = document.createElement('button');
        placeholder.className = 'metadata-placeholder';
        placeholder.textContent = 'Metadata';
        name.textContent = imageMetadata.original_filename;
        status.textContent = 'Metadata saved · screenshot file not stored';
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.onclick = function () {
          existingImages.splice(index, 1);
          renderPreviews();
        };
        info.appendChild(name);
        info.appendChild(status);
        card.appendChild(placeholder);
        card.appendChild(info);
        card.appendChild(remove);
        fragment.appendChild(card);
      }(existingImages[i], i));
    }
    root.appendChild(fragment);
    if (!selectedFiles.length && !existingImages.length) root.innerHTML = '<p class="empty">No screenshots selected.</p>';
    setStatus(
      (selectedFiles.length + existingImages.length) + ' screenshot item(s). New screenshot files remain local; only validated metadata is saved.',
      selectedFiles.length ? 'ready' : ''
    );
  }
  function handleSelection(event) {
    var incoming = [];
    var i;
    var totalCount;
    for (i = 0; i < event.target.files.length; i += 1) incoming.push(event.target.files[i]);
    totalCount = existingImages.length + incoming.length;
    if (totalCount > limits.count) { setStatus('A maximum of 12 screenshots is allowed.', 'error'); event.target.value = ''; return; }
    if (totalSelectedBytes(incoming) > limits.totalBytes) { setStatus('The selected screenshots exceed 60 MB.', 'error'); event.target.value = ''; return; }
    setStatus('Validating screenshot files…', 'loading');
    processFiles(incoming, 0, [], function (accepted, error) {
      event.target.value = '';
      if (error) { setStatus(error.message, 'error'); return; }
      selectedFiles = accepted;
      existingImages = [];
      renderPreviews();
    });
  }
  function safeError(status, data) {
    if (status === 401) return 'Please sign in to use your private Morning Meeting.';
    if (status === 404) return 'Morning Meeting not found.';
    if (status === 400 && data && typeof data.error === 'string') return data.error;
    if (status === 503) return 'Morning Meeting service is temporarily unavailable.';
    return 'The request failed. Please try again.';
  }
  function request(method, url, payload, done) {
    auth.getAccessToken(function (tokenError, token) {
      var xhr;
      if (tokenError || !token) { done(new Error('Please sign in first.')); return; }
      xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = 12000;
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      if (payload !== null) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
        if (xhr.status >= 200 && xhr.status < 300) { done(null, data || {}); return; }
        done(new Error(safeError(xhr.status, data)));
      };
      xhr.onerror = function () { done(new Error('Network unavailable.')); };
      xhr.ontimeout = function () { done(new Error('Request timed out.')); };
      xhr.send(payload === null ? null : JSON.stringify(payload));
    });
  }
  function imagePayload() {
    var result = [];
    var i;
    for (i = 0; i < selectedFiles.length; i += 1) result.push({
      original_filename:selectedFiles[i].name,
      mime_type:selectedFiles[i].type,
      size_bytes:selectedFiles[i].size
    });
    for (i = 0; i < existingImages.length; i += 1) result.push({
      original_filename:existingImages[i].original_filename,
      mime_type:existingImages[i].mime_type,
      size_bytes:existingImages[i].size_bytes
    });
    return result;
  }
  function formPayload() {
    var form = byId('morningForm');
    return {
      meeting_date:form.elements.meeting_date.value,
      primary_driver:form.elements.primary_driver.value,
      evidence:form.elements.evidence.value,
      contradiction:form.elements.contradiction.value,
      need_to_verify:form.elements.need_to_verify.value,
      confidence:Number(form.elements.confidence.value),
      my_view:form.elements.my_view.value,
      review_notes:form.elements.review_notes.value,
      images:imagePayload()
    };
  }
  function populate(meeting) {
    var form = byId('morningForm');
    currentMeetingId = meeting ? meeting.id : null;
    form.reset();
    byId('morningDate').value = meeting ? meeting.meeting_date : localDate();
    form.elements.primary_driver.value = meeting ? meeting.primary_driver : '';
    form.elements.evidence.value = meeting ? meeting.evidence : '';
    form.elements.contradiction.value = meeting ? meeting.contradiction : '';
    form.elements.need_to_verify.value = meeting ? meeting.need_to_verify : '';
    form.elements.confidence.value = meeting ? meeting.confidence : 50;
    form.elements.my_view.value = meeting ? meeting.my_view : '';
    form.elements.review_notes.value = meeting ? meeting.review_notes : '';
    byId('morningConfidenceValue').textContent = form.elements.confidence.value;
    selectedFiles = [];
    existingImages = meeting && meeting.images ? meeting.images.slice(0) : [];
    byId('morningSaveState').textContent = meeting ? 'Saved metadata' : 'Not saved';
    byId('morningError').textContent = '';
    renderPreviews();
  }
  function saveMeeting(event) {
    var payload = formPayload();
    var button = byId('morningSaveButton');
    var method = currentMeetingId ? 'PUT' : 'POST';
    var url = currentMeetingId ? '/api/morning-meetings/' + encodeURIComponent(currentMeetingId) : '/api/morning-meetings';
    event.preventDefault();
    if (!auth || !auth.getSession || !auth.getSession()) { byId('morningError').textContent = 'Please sign in first.'; return; }
    if (!payload.primary_driver || !payload.my_view.replace(/^\s+|\s+$/g, '')) { byId('morningError').textContent = 'Primary Driver and My View are required.'; return; }
    button.disabled = true;
    button.textContent = 'Saving…';
    request(method, url, payload, function (error, data) {
      button.disabled = false;
      button.textContent = 'Save Private Meeting';
      if (error) { byId('morningError').textContent = error.message; return; }
      populate(data.meeting);
      setStatus('Meeting saved. Screenshot metadata is private; screenshot files are not permanently stored.', 'saved');
      loadHistory();
    });
  }
  function historyCard(meeting) {
    return '<article class="meeting-card" data-meeting-id="' + escapeHtml(meeting.id) + '"><div><time>' + escapeHtml(meeting.meeting_date) + '</time><b>' + escapeHtml(meeting.primary_driver) + '</b><p>' + escapeHtml(meeting.my_view) + '</p><small>' + escapeHtml(meeting.image_count) + ' screenshot metadata · confidence ' + escapeHtml(meeting.confidence) + '</small></div><div><button type="button" data-edit-meeting="' + escapeHtml(meeting.id) + '">Edit</button><button type="button" data-delete-meeting="' + escapeHtml(meeting.id) + '">Delete</button></div></article>';
  }
  function attachHistoryActions(meetings) {
    var edits = document.querySelectorAll('[data-edit-meeting]');
    var deletes = document.querySelectorAll('[data-delete-meeting]');
    var i;
    function findMeeting(id) {
      var j;
      for (j = 0; j < meetings.length; j += 1) if (meetings[j].id === id) return meetings[j];
      return null;
    }
    for (i = 0; i < edits.length; i += 1) edits[i].onclick = function () {
      var meeting = findMeeting(this.getAttribute('data-edit-meeting'));
      if (!meeting) return;
      populate(meeting);
      window.marketWorkbench.showPage('morning');
    };
    for (i = 0; i < deletes.length; i += 1) deletes[i].onclick = function () {
      var id = this.getAttribute('data-delete-meeting');
      request('DELETE', '/api/morning-meetings/' + encodeURIComponent(id), null, function (error) {
        if (error) { byId('morningError').textContent = error.message; return; }
        if (currentMeetingId === id) populate(null);
        loadHistory();
      });
    };
  }
  function loadHistory() {
    if (!auth || !auth.getSession || !auth.getSession()) {
      byId('morningHistory').innerHTML = '<p class="empty">Sign in to view your private Morning Meetings.</p>';
      return;
    }
    request('GET', '/api/morning-meetings', null, function (error, data) {
      var meetings;
      var html = '';
      var i;
      if (error) { byId('morningHistory').innerHTML = '<p class="empty">Private history is temporarily unavailable.</p>'; return; }
      meetings = data.meetings || [];
      for (i = 0; i < meetings.length; i += 1) html += historyCard(meetings[i]);
      byId('morningHistory').innerHTML = html || '<p class="empty">Your private Morning Meetings will appear here.</p>';
      attachHistoryActions(meetings);
    });
  }
  function syncAuth() {
    var authenticated = Boolean(auth && auth.getSession && auth.getSession());
    byId('morningSaveButton').disabled = !authenticated;
    if (!authenticated) {
      populate(null);
      byId('morningHistory').innerHTML = '<p class="empty">Sign in to view your private Morning Meetings.</p>';
      setStatus('Sign in to save a private Morning Meeting. Screenshot files remain local.', '');
      return;
    }
    loadHistory();
  }
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;
    navigator.serviceWorker.register('/service-worker.js').catch(function () {});
  }
  function init() {
    byId('morningDate').value = localDate();
    byId('morningScreenshots').onchange = handleSelection;
    byId('morningConfidence').oninput = function () { byId('morningConfidenceValue').textContent = this.value; };
    byId('morningForm').onsubmit = saveMeeting;
    if (auth) auth.onChange(syncAuth);
    renderPreviews();
    syncAuth();
    registerServiceWorker();
  }

  init();
}(window, document));
