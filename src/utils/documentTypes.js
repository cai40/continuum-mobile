/** Shared document MIME types for Continuum uploads (L5 ingest + chat attachments). */

export const MAX_DOCUMENT_ATTACHMENTS = 10;

export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const EXTENSION_MIME = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function resolveDocumentMimeType(fileName, mimeType) {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
  const ext = String(fileName || '').split('.').pop()?.toLowerCase();
  return EXTENSION_MIME[ext] || 'application/octet-stream';
}

export function isSupportedDocumentType(mimeType, fileName) {
  const resolved = resolveDocumentMimeType(fileName, mimeType);
  return DOCUMENT_MIME_TYPES.includes(resolved);
}

export function isPdfAttachment(file) {
  const name = file?.name || '';
  const resolved = resolveDocumentMimeType(name, file?.type);
  const ext = String(name).split('.').pop()?.toLowerCase() || '';
  return ext === 'pdf' || resolved.includes('pdf');
}

export function documentTypeLabel(mimeType, fileName) {
  const resolved = resolveDocumentMimeType(fileName, mimeType);
  if (resolved.includes('pdf')) return 'PDF';
  if (resolved.includes('word') || resolved.includes('wordprocessing')) return 'Word';
  if (resolved.includes('powerpoint') || resolved.includes('presentation')) return 'PowerPoint';
  if (resolved.includes('excel') || resolved.includes('spreadsheet')) return 'Excel';
  if (resolved.includes('text/plain')) return 'Text';
  return 'Document';
}

export function documentIconName(mimeType, fileName) {
  const resolved = resolveDocumentMimeType(fileName, mimeType);
  if (resolved.startsWith('image/')) return 'image';
  if (resolved.includes('pdf')) return 'document-text';
  if (resolved.includes('word') || resolved.includes('wordprocessing')) return 'document';
  if (resolved.includes('powerpoint') || resolved.includes('presentation')) return 'easel';
  if (resolved.includes('excel') || resolved.includes('spreadsheet')) return 'grid';
  return 'document-attach';
}

export function normalizePickedAsset(asset) {
  return {
    uri: asset.uri,
    name: asset.name || asset.fileName || 'document',
    type: resolveDocumentMimeType(asset.name || asset.fileName, asset.mimeType),
  };
}
