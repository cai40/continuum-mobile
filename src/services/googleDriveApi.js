import * as FileSystem from 'expo-file-system/legacy';
import { getValidGoogleDriveAccessToken } from './googleDriveAuth';
import { resolveDocumentMimeType } from '../utils/documentTypes';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

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

function mapDriveFile(f) {
  const mimeType = f.mimeType || 'application/octet-stream';
  return {
    id: f.id,
    name: f.name || 'Untitled',
    mimeType,
    modifiedTime: f.modifiedTime || '',
    size: Number(f.size) || 0,
    isFolder: mimeType === FOLDER_MIME,
    isGoogleDoc: mimeType.startsWith('application/vnd.google-apps.') && mimeType !== FOLDER_MIME,
    shortcutTargetId: f.shortcutDetails?.targetId || '',
    shortcutTargetMime: f.shortcutDetails?.targetMimeType || '',
  };
}

/**
 * List Drive files. Pass folderId to browse a folder (`root` for My Drive root).
 * With a search query, searches across Drive (not limited to the current folder).
 * @param {{ query?: string, folderId?: string, pageSize?: number, pageToken?: string }} opts
 */
export async function listGoogleDriveFiles({
  query = '',
  folderId = 'root',
  pageSize = 30,
  pageToken = '',
} = {}) {
  const qParts = ['trashed = false'];
  const trimmed = String(query || '').trim();
  if (trimmed) {
    const safe = trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    qParts.push(`name contains '${safe}'`);
  } else {
    const parent = String(folderId || 'root').replace(/'/g, "\\'");
    qParts.push(`'${parent}' in parents`);
  }

  const params = new URLSearchParams({
    pageSize: String(Math.min(50, Math.max(1, pageSize))),
    q: qParts.join(' and '),
    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,iconLink,shortcutDetails)',
    orderBy: trimmed ? 'viewedByMeTime desc' : 'folder,name',
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const json = await driveFetch(`/files?${params.toString()}`);
  const files = (json.files || []).map(mapDriveFile);
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
  if (file.isFolder || file.mimeType === FOLDER_MIME) {
    throw new Error('That is a folder. Open it to pick a file inside.');
  }

  const accessToken = await getValidGoogleDriveAccessToken();
  let fileId = file.id;
  let mimeType = file.mimeType;
  let name = file.name;

  // Resolve shortcuts to their target file.
  if (mimeType === 'application/vnd.google-apps.shortcut') {
    if (!file.shortcutTargetId) throw new Error('This shortcut has no target file.');
    fileId = file.shortcutTargetId;
    mimeType = file.shortcutTargetMime || mimeType;
  }

  const exportInfo = GOOGLE_EXPORT_MAP[mimeType];
  const baseName = sanitizeFileName(name);
  let downloadUrl;
  let outName;
  let outType;

  if (exportInfo) {
    downloadUrl = `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportInfo.mimeType)}`;
    const stem = baseName.replace(/\.[^.]+$/, '');
    outName = `${stem}.${exportInfo.extension}`;
    outType = exportInfo.mimeType;
  } else if (String(mimeType || '').startsWith('application/vnd.google-apps.')) {
    throw new Error(`Google file type "${mimeType}" cannot be exported for chat yet.`);
  } else {
    downloadUrl = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
    outName = baseName.includes('.') ? baseName : `${baseName}`;
    outType = resolveDocumentMimeType(outName, mimeType);
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
    driveFileId: fileId,
  };
}
