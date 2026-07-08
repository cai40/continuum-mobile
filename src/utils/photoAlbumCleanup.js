import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';

const LAST_RUN_KEY = '@photo_cleanup_last_run';
const FAVORITES_ALBUM = 'Continuum Favorites';
const PROTECTED_ALBUM_NAMES = new Set([
  FAVORITES_ALBUM.toLowerCase(),
  'favorites',
  'recently deleted',
  'hidden',
]);

const SCREENSHOT_NAME_RE = /screenshot|screen.?shot|screencapture|simulator|capture|screenrecording/i;
const CODING_NAME_RE = /vscode|xcode|android.?studio|terminal|ide|code|debug|console|stack\s*trace/i;
const MONITOR_RATIOS = [16 / 9, 16 / 10, 4 / 3, 3 / 2, 19.5 / 9, 20 / 9, 21 / 9];

/** @typedef {'scan' | 'duplicates' | 'screenshots' | 'favorites' | 'delete' | 'done'} CleanupPhase */

/**
 * @typedef {Object} CleanupReport
 * @property {boolean} dryRun
 * @property {number} scanned
 * @property {{ found: number, deleted: number, kept: number }} duplicates
 * @property {{ found: number, deleted: number }} codingScreenshots
 * @property {{ selected: number, ids: string[] }} favorites
 * @property {string[]} errors
 * @property {string} summary
 * @property {string} ran_at
 */

function isMonitorAspectRatio(width, height) {
  if (!width || !height) return false;
  const ratio = Math.max(width, height) / Math.min(width, height);
  return MONITOR_RATIOS.some((r) => Math.abs(ratio - r) < 0.08);
}

function isScreenshotFilename(filename = '') {
  return SCREENSHOT_NAME_RE.test(filename);
}

function isCodingScreenshot(asset) {
  const name = String(asset.filename || '');
  const lower = name.toLowerCase();
  const png = lower.endsWith('.png');
  const monitorRatio = isMonitorAspectRatio(asset.width, asset.height);

  if (CODING_NAME_RE.test(name)) return true;
  if (isScreenshotFilename(name) && monitorRatio) return true;
  if (isScreenshotFilename(name) && png) return true;
  if (monitorRatio && png && /img_|screen|snap/i.test(name)) return true;

  return false;
}

function scorePhoto(asset) {
  const pixels = (asset.width || 0) * (asset.height || 0);
  const resolution = pixels > 0 ? Math.log10(pixels) / 7 : 0;
  const notScreenshot = isCodingScreenshot(asset) || isScreenshotFilename(asset.filename) ? 0 : 0.25;
  const landscapeBonus = asset.width > asset.height ? 0.05 : 0;
  const recency = asset.creationTime
    ? Math.min(0.1, (Date.now() - asset.creationTime) / (1000 * 60 * 60 * 24 * 365 * -10) + 0.1)
    : 0;

  return resolution * 0.55 + notScreenshot + landscapeBonus + recency;
}

async function hashAssetContent(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists) return null;

    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
  } catch {
    return null;
  }
}

async function sampleHash(uri) {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 32, height: 32 } }],
      { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG },
    );
    const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64.slice(0, 4096));
  } catch {
    return null;
  }
}

async function loadAllPhotos(onProgress) {
  const assets = [];
  let hasNext = true;
  let after;

  while (hasNext) {
    const page = await MediaLibrary.getAssetsAsync({
      first: 200,
      after,
      mediaType: MediaLibrary.MediaType.photo,
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    });
    assets.push(...page.assets);
    hasNext = page.hasNextPage;
    after = page.endCursor;
    onProgress?.('scan', assets.length, assets.length + (hasNext ? 200 : 0));
  }

  return assets;
}

async function loadProtectedAssetIds() {
  const protectedIds = new Set();
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    for (const album of albums) {
      if (!PROTECTED_ALBUM_NAMES.has(String(album.title || '').toLowerCase())) continue;
      let hasNext = true;
      let after;
      while (hasNext) {
        const page = await MediaLibrary.getAssetsAsync({
          album,
          first: 200,
          after,
          mediaType: MediaLibrary.MediaType.photo,
        });
        for (const asset of page.assets) protectedIds.add(asset.id);
        hasNext = page.hasNextPage;
        after = page.endCursor;
      }
    }
  } catch {
    // Non-fatal: proceed without protected set if album enumeration fails.
  }
  return protectedIds;
}

function pickKeeper(cluster) {
  return cluster
    .slice()
    .sort((a, b) => {
      const pa = (a.width || 0) * (a.height || 0);
      const pb = (b.width || 0) * (b.height || 0);
      if (pb !== pa) return pb - pa;
      return (b.creationTime || 0) - (a.creationTime || 0);
    })[0];
}

async function findDuplicateDeletes(assets, { onProgress, protectedIds }) {
  const exactMap = new Map();
  const nearMap = new Map();
  const toDelete = [];
  const kept = new Set();

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    if (protectedIds.has(asset.id)) {
      kept.add(asset.id);
      onProgress?.('duplicates', i + 1, assets.length);
      continue;
    }

    const fullHash = await hashAssetContent(asset.uri);
    if (fullHash) {
      const cluster = exactMap.get(fullHash) || [];
      cluster.push(asset);
      exactMap.set(fullHash, cluster);
    }

    const thumbHash = await sampleHash(asset.uri);
    if (thumbHash) {
      const nearKey = `${thumbHash}:${asset.width}x${asset.height}`;
      const nearCluster = nearMap.get(nearKey) || [];
      nearCluster.push(asset);
      nearMap.set(nearKey, nearCluster);
    }

    onProgress?.('duplicates', i + 1, assets.length);
  }

  for (const cluster of exactMap.values()) {
    if (cluster.length < 2) {
      kept.add(cluster[0].id);
      continue;
    }
    const keeper = pickKeeper(cluster);
    kept.add(keeper.id);
    for (const asset of cluster) {
      if (asset.id !== keeper.id) toDelete.push(asset);
    }
  }

  for (const cluster of nearMap.values()) {
    if (cluster.length < 2) continue;
    const unprocessed = cluster.filter((a) => !toDelete.some((d) => d.id === a.id) && !kept.has(a.id));
    if (unprocessed.length < 2) continue;

    const keeper = pickKeeper(unprocessed);
    kept.add(keeper.id);
    for (const asset of unprocessed) {
      if (asset.id !== keeper.id && !toDelete.some((d) => d.id === asset.id)) {
        toDelete.push(asset);
      }
    }
  }

  const deleteIds = new Set(toDelete.map((a) => a.id));
  const survivors = assets.filter((a) => !deleteIds.has(a.id));

  return { toDelete, survivors, found: toDelete.length };
}

function findCodingScreenshotDeletes(assets, { protectedIds }) {
  const toDelete = [];
  for (const asset of assets) {
    if (protectedIds.has(asset.id)) continue;
    if (isCodingScreenshot(asset)) toDelete.push(asset);
  }
  const deleteIds = new Set(toDelete.map((a) => a.id));
  return {
    toDelete,
    survivors: assets.filter((a) => !deleteIds.has(a.id)),
    found: toDelete.length,
  };
}

function selectFavorites(assets, favoritePercent = 0.05) {
  if (!assets.length) return [];
  const scored = assets
    .map((asset) => ({ asset, score: scorePhoto(asset) }))
    .sort((a, b) => b.score - a.score);
  const count = Math.max(1, Math.ceil(assets.length * favoritePercent));
  return scored.slice(0, count).map((row) => row.asset);
}

async function batchDeleteAssets(assets, onProgress) {
  const ids = assets.map((a) => a.id);
  const chunkSize = 50;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    await MediaLibrary.deleteAssetsAsync(chunk);
    onProgress?.('delete', Math.min(i + chunkSize, ids.length), ids.length);
  }
}

async function markFavorites(favorites) {
  if (!favorites.length) return;

  let album = await MediaLibrary.getAlbumAsync(FAVORITES_ALBUM);
  if (!album) {
    await MediaLibrary.createAlbumAsync(FAVORITES_ALBUM, favorites[0], false);
    if (favorites.length > 1) {
      album = await MediaLibrary.getAlbumAsync(FAVORITES_ALBUM);
      await MediaLibrary.addAssetsToAlbumAsync(favorites.slice(1), album, false);
    }
  } else {
    await MediaLibrary.addAssetsToAlbumAsync(favorites, album, false);
  }

  const favoriteIds = favorites.map((a) => a.id);
  const existing = await AsyncStorage.getItem('@continuum_favorite_photo_ids');
  const merged = Array.from(new Set([...(existing ? JSON.parse(existing) : []), ...favoriteIds]));
  await AsyncStorage.setItem('@continuum_favorite_photo_ids', JSON.stringify(merged));
}

function buildSummary(report) {
  const lines = [
    `## Photo album cleanup — ${new Date(report.ran_at).toLocaleString()}`,
    '',
    `- **Scanned:** ${report.scanned} photo(s)`,
    `- **Duplicates:** ${report.duplicates.found} found${report.dryRun ? '' : `, ${report.duplicates.deleted} deleted`}`,
    `- **Coding screenshots:** ${report.codingScreenshots.found} found${report.dryRun ? '' : `, ${report.codingScreenshots.deleted} deleted`}`,
    `- **Favorites (top 5%):** ${report.favorites.selected} selected`,
    report.dryRun ? '- **Mode:** dry run (no changes made)' : '- **Mode:** applied',
  ];
  if (report.errors.length) {
    lines.push('', `**Errors:** ${report.errors.length}`);
  }
  return lines.join('\n');
}

export async function loadLastPhotoCleanupRun() {
  try {
    const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveLastPhotoCleanupRun(report) {
  await AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify(report));
}

/**
 * Clean up the on-device photo library: remove duplicates and coding screenshots,
 * then mark the top 5% of remaining photos as favorites.
 *
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=true]
 * @param {number} [options.favoritePercent=0.05]
 * @param {(phase: CleanupPhase, done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<CleanupReport>}
 */
export async function cleanUpPhotoAlbum({
  dryRun = true,
  favoritePercent = 0.05,
  onProgress,
} = {}) {
  const errors = [];
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('Photo library permission denied');
  }

  if (Platform.OS === 'android' && permission.accessPrivileges === 'limited') {
    errors.push('Limited photo access: cleanup only affects the photos you selected.');
  }

  const protectedIds = await loadProtectedAssetIds();
  const assets = await loadAllPhotos(onProgress);

  const { toDelete: duplicateDeletes, survivors: afterDupes, found: dupFound } =
    await findDuplicateDeletes(assets, { onProgress, protectedIds });

  onProgress?.('screenshots', 0, afterDupes.length);
  const { toDelete: screenshotDeletes, survivors, found: ssFound } =
    findCodingScreenshotDeletes(afterDupes, { protectedIds });

  onProgress?.('favorites', 0, survivors.length);
  const favorites = selectFavorites(survivors, favoritePercent);
  onProgress?.('favorites', favorites.length, survivors.length);

  const allDeletes = [...duplicateDeletes, ...screenshotDeletes];
  const uniqueDeletes = Array.from(new Map(allDeletes.map((a) => [a.id, a])).values());

  if (!dryRun) {
    try {
      if (uniqueDeletes.length) await batchDeleteAssets(uniqueDeletes, onProgress);
      if (favorites.length) await markFavorites(favorites);
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }

  /** @type {CleanupReport} */
  const report = {
    dryRun,
    scanned: assets.length,
    duplicates: {
      found: dupFound,
      deleted: dryRun ? 0 : uniqueDeletes.filter((a) => duplicateDeletes.some((d) => d.id === a.id)).length,
      kept: survivors.length,
    },
    codingScreenshots: {
      found: ssFound,
      deleted: dryRun ? 0 : uniqueDeletes.filter((a) => screenshotDeletes.some((d) => d.id === a.id)).length,
    },
    favorites: {
      selected: favorites.length,
      ids: favorites.map((a) => a.id),
    },
    errors,
    ran_at: new Date().toISOString(),
    summary: '',
  };

  report.summary = buildSummary(report);
  await saveLastPhotoCleanupRun(report);
  onProgress?.('done', 1, 1);

  return report;
}
