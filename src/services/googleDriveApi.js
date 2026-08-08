import * as FileSystem from 'expo-file-system/legacy';
import { getValidGoogleDriveAccessToken } from './googleDriveAuth';
import { resolveDocumentMimeType } from '../utils/documentTypes';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

const GOOGLE_EXPORT_MAP = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/pdf',
    extension: 'pdf',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: 'pptx',
  },
};

async function driveFetch(path, { method = 'GET', headers = {}, raw = false } = {}) {
  const accessToken = await getValidGoogleDriveAccessToken();
  const res = await fetch(`${DRIVE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
  });
  if (!res.ok) {
    let detail = `Drive API error (${res.status})`;
    try {
      const err = await res.json();
      detail = err?.error?.message || detail;
    } catch {
      // ignore
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${detail}. Reconnect Google Drive under Setup.`);
    }
    throw new Error(detail);
  }
  if (raw) return res;
  return res.json();
}

/**
 * List recent Drive files the user can read.
 * @param {{ query?: string, pageSize?: number, pageToken?: string }} opts
 */
export async function listGoogleDriveFiles({ query = '', pageSize = 30, pageToken = '' } = {}) {
  const qParts = ['trashed = false'];
  const trimmed = String(query || '').trim();
  if (trimmed) {
    const safe = trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    qParts.push(`name contains '${safe}'`);
  }
  const params = new URLSearchParams({
    pageSize: String(Math.min(50, Math.max(1, pageSize))),
    q: qParts.join(' and '),
    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,iconLink,shortcutDetails)',
    orderBy: 'viewedByMeTime desc',
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const json = await driveFetch(`/files?${params.toString()}`);
  const files = (json.files || []).map((f) => ({
    id: f.id,
    name: f.name || 'Untitled',
    mimeType: f.mimeType || 'application/octet-stream',
    modifiedTime: f.modifiedTime || '',
    size: Number(f.size) || 0,
    isGoogleDoc: String(f.mimeType || '').startsWith('application/vnd.google-apps.'),
  }));
  return {
    files,
    nextPageToken: json.nextPageToken || '',
  };
}

function sanitizeFileName(name) {
  return String(name || 'drive-file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

/**
 * Download a Drive file into the app cache and return a chat attachment descriptor.
 */
export async function downloadGoogleDriveFileToCache(file) {
  if (!file?.id) throw new Error('Missing Drive file id.');
  const accessToken = await getValidGoogleDriveAccessToken();
  const exportInfo = GOOGLE_EXPORT_MAP[file.mimeType];
  const baseName = sanitizeFileName(file.name);
  let downloadUrl;
  let outName;
  let outType;

  if (exportInfo) {
    downloadUrl = `${DRIVE_API}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportInfo.mimeType)}`;
    const stem = baseName.replace(/\.[^.]+$/, '');
    outName = `${stem}.${exportInfo.extension}`;
    outType = exportInfo.mimeType;
  } else if (String(file.mimeType || '').startsWith('application/vnd.google-apps.')) {
    throw new Error(`Google file type "${file.mimeType}" cannot be exported for chat yet.`);
  } else {
    downloadUrl = `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`;
    outName = baseName.includes('.') ? baseName : `${baseName}`;
    outType = resolveDocumentMimeType(outName, file.mimeType);
  }

  const cacheRoot = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!cacheRoot) throw new Error('No cache directory available on this device.');
  const target = `${cacheRoot}gdrive_${Date.now()}_${outName}`;

  const result = await FileSystem.downloadAsync(downloadUrl, target, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Download failed (${result.status}).`);
  }

  return {
    uri: result.uri,
    name: outName,
    type: outType,
    source: 'google-drive',
    driveFileId: file.id,
  };
}
