'use strict';

const PRIMARY_DRIVERS = Object.freeze([
  'Growth',
  'Inflation',
  'Liquidity',
  'Risk',
  'Monetary Policy',
  'Positioning',
  'Other'
]);
const IMAGE_LIMITS = Object.freeze({
  maxFiles:12,
  maxFileBytes:10 * 1024 * 1024,
  maxTotalBytes:60 * 1024 * 1024
});
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg':['jpg', 'jpeg'],
  'image/png':['png'],
  'image/webp':['webp']
});
const DANGEROUS_EXTENSION = /\.(?:exe|com|bat|cmd|ps1|sh|js|html?|svg|pdf|php|jar|msi)(?:\.|$)/i;

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function cleanText(value, maxLength) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  return text.length <= maxLength ? text : null;
}

function validateImageMetadata(images) {
  let totalBytes = 0;
  const normalized = [];
  if (!Array.isArray(images)) return { error:'Screenshots must be an array' };
  if (images.length > IMAGE_LIMITS.maxFiles) return { error:`A maximum of ${IMAGE_LIMITS.maxFiles} screenshots is allowed` };
  for (const image of images) {
    const originalFilename = cleanText(image && image.original_filename, 180);
    const mimeType = String(image && image.mime_type || '').toLowerCase();
    const sizeBytes = Number(image && image.size_bytes);
    const allowedExtensions = MIME_EXTENSIONS[mimeType];
    const extensionMatch = originalFilename && /\.([a-z0-9]+)$/i.exec(originalFilename);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
    if (!originalFilename || /[\/\\\u0000-\u001f\u007f]/.test(originalFilename) || DANGEROUS_EXTENSION.test(originalFilename)) {
      return { error:'A screenshot filename is not allowed' };
    }
    if (!allowedExtensions || !allowedExtensions.includes(extension)) {
      return { error:'Only JPEG, PNG, and WebP screenshots are supported' };
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > IMAGE_LIMITS.maxFileBytes) {
      return { error:'A screenshot exceeds the file size limit' };
    }
    totalBytes += sizeBytes;
    normalized.push({
      original_filename:originalFilename,
      mime_type:mimeType,
      size_bytes:sizeBytes,
      storage_path:null,
      upload_status:'metadata_only'
    });
  }
  if (totalBytes > IMAGE_LIMITS.maxTotalBytes) return { error:'The selected screenshots exceed the total size limit' };
  return { value:normalized };
}

function validateMorningMeeting(input) {
  const meetingDate = String(input && input.meeting_date || '');
  const primaryDriver = String(input && input.primary_driver || '');
  const confidence = Number(input && input.confidence);
  const evidence = cleanText(input && input.evidence, 4000);
  const contradiction = cleanText(input && input.contradiction, 4000);
  const needToVerify = cleanText(input && input.need_to_verify, 4000);
  const myView = cleanText(input && input.my_view, 4000);
  const reviewNotes = cleanText(input && input.review_notes, 4000);
  const images = validateImageMetadata(input && input.images || []);
  if (!validDate(meetingDate)) return { error:'Meeting date is invalid' };
  if (!PRIMARY_DRIVERS.includes(primaryDriver)) return { error:'Primary driver is invalid' };
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) return { error:'Confidence must be an integer from 0 to 100' };
  if (myView === null || !myView) return { error:'My View is required' };
  if ([evidence, contradiction, needToVerify, reviewNotes].includes(null)) return { error:'A text field exceeds the length limit' };
  if (images.error) return images;
  return {
    value:{
      meeting_date:meetingDate,
      primary_driver:primaryDriver,
      evidence,
      contradiction,
      need_to_verify:needToVerify,
      confidence,
      my_view:myView,
      review_notes:reviewNotes,
      analysis_status:'not_configured',
      images:images.value
    }
  };
}

function analyzeMarketScreenshots() {
  return { analysis_status:'not_configured' };
}

module.exports = {
  PRIMARY_DRIVERS,
  IMAGE_LIMITS,
  MIME_EXTENSIONS,
  validDate,
  validId,
  validateImageMetadata,
  validateMorningMeeting,
  analyzeMarketScreenshots
};
