'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  IMAGE_LIMITS,
  validateImageMetadata,
  validateMorningMeeting,
  analyzeMarketScreenshots
} = require('../morning-meeting');

function payload() {
  return {
    meeting_date:'2026-07-24',
    primary_driver:'Liquidity',
    evidence:'Funding conditions improved.',
    contradiction:'Risk assets did not confirm.',
    need_to_verify:'Check the close.',
    confidence:65,
    my_view:'Liquidity is the primary driver today.',
    review_notes:'',
    user_id:'attacker',
    images:[{
      original_filename:'market.png',
      mime_type:'image/png',
      size_bytes:1024
    }]
  };
}

test('Morning Meeting validates the required private record fields', () => {
  const result = validateMorningMeeting(payload());
  assert.equal(result.error, undefined);
  assert.equal(result.value.meeting_date, '2026-07-24');
  assert.equal(result.value.primary_driver, 'Liquidity');
  assert.equal(result.value.confidence, 65);
  assert.equal(result.value.analysis_status, 'not_configured');
  assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'user_id'), false);
  assert.deepEqual(result.value.images[0], {
    original_filename:'market.png',
    mime_type:'image/png',
    size_bytes:1024,
    storage_path:null,
    upload_status:'metadata_only'
  });
});

test('Morning Meeting requires date, driver, view, and confidence range', () => {
  for (const change of [
    { meeting_date:'2026-02-31' },
    { primary_driver:'Secret Driver' },
    { confidence:-1 },
    { confidence:101 },
    { confidence:20.5 },
    { my_view:'   ' }
  ]) {
    assert.ok(validateMorningMeeting({ ...payload(), ...change }).error);
  }
});

test('screenshot metadata enforces count and size limits', () => {
  const image = { original_filename:'market.jpg', mime_type:'image/jpeg', size_bytes:1024 };
  assert.match(validateImageMetadata(Array(IMAGE_LIMITS.maxFiles + 1).fill(image)).error, /maximum/i);
  assert.match(validateImageMetadata([{ ...image, size_bytes:IMAGE_LIMITS.maxFileBytes + 1 }]).error, /size/i);
  assert.match(validateImageMetadata(Array(7).fill({ ...image, size_bytes:9 * 1024 * 1024 })).error, /total/i);
});

test('screenshot metadata rejects unsafe MIME, extension, and path names', () => {
  for (const image of [
    { original_filename:'market.svg', mime_type:'image/svg+xml', size_bytes:100 },
    { original_filename:'market.pdf', mime_type:'application/pdf', size_bytes:100 },
    { original_filename:'market.html.png', mime_type:'image/png', size_bytes:100 },
    { original_filename:'..\\market.png', mime_type:'image/png', size_bytes:100 },
    { original_filename:'market.jpg.exe', mime_type:'image/jpeg', size_bytes:100 },
    { original_filename:'market.png', mime_type:'image/jpeg', size_bytes:100 }
  ]) {
    assert.ok(validateImageMetadata([image]).error, image.original_filename);
  }
});

test('AI analysis remains an explicit non-configured boundary', () => {
  assert.deepEqual(analyzeMarketScreenshots([]), { analysis_status:'not_configured' });
});
