import { cleanUpPhotoAlbum, loadLastPhotoCleanupRun } from './photoAlbumCleanup';

const PHOTO_TRIGGER = /\b(photos?|pictures?|images?|selfies?|album|camera\s*roll|photo\s+library|library)\b/i;
const PHOTO_CLEANUP_INTENT = /\b(clean\s*up|cleanup|cleaning\s+up|dedupe?|dedup(?:licate)?|organize|declutter|tidy)\b/i;

const PHASE_LABELS = {
  scan: 'Scanning photo library',
  duplicates: 'Finding duplicates',
  screenshots: 'Detecting coding screenshots',
  favorites: 'Scoring photos for favorites',
  delete: 'Deleting photos',
  done: 'Done',
};

/** Detect on-device photo album cleanup requests in chat. */
export function wantsPhotoCleanup(message) {
  const text = String(message || '').trim();
  if (!text) return false;

  if (/\bphoto\s+album\s+cleanup\b/i.test(text)) return true;
  if (/\b(clean\s*up|cleanup)\s+(my\s+)?(photos?|pictures?|album|library)\b/i.test(text)) return true;
  if (/\b(remove|delete)\s+(duplicate|coding)\s+(photos?|pictures?|screenshots?)\b/i.test(text)) return true;
  if (/\b(duplicate|coding)\s+(photos?|pictures?|screenshots?).*\b(clean|remove|delete)\b/i.test(text)) return true;
  if (PHOTO_CLEANUP_INTENT.test(text) && PHOTO_TRIGGER.test(text)) return true;
  if (/\b(dedupe|dedup)\s+(my\s+)?(photos?|pictures?|album)\b/i.test(text)) return true;

  return false;
}

export function wantsPhotoCleanupStatus(message) {
  return /\b(photo\s+cleanup|photo\s+album\s+cleanup)\s+(status|summary|report|result)\b/i.test(message || '')
    || /\b(last|previous)\s+photo\s+cleanup\b/i.test(message || '');
}

/** Default chat mode is dry-run unless user explicitly asks to apply/delete. */
export function isPhotoCleanupApply(message) {
  const text = String(message || '');
  if (/\b(dry\s*run|preview|scan\s+only|don't\s+delete|do\s+not\s+delete|without\s+deleting|no\s+delete)\b/i.test(text)) {
    return false;
  }
  if (/\b(apply|actually\s+delete|for\s+real|yes\s+proceed|confirm|go\s+ahead)\b/i.test(text)
    && /\b(photo|photos|album|library|cleanup)\b/i.test(text)) {
    return true;
  }
  if (/\b(apply|run)\s+photo\s+(album\s+)?cleanup\b/i.test(text)) return true;
  if (/\bdelete\s+(duplicates?|coding\s+screenshots?).*\b(photos?|pictures?)\b/i.test(text)) return true;
  return false;
}

export function formatPhotoCleanupProgress(phase, done, total, dryRun = true) {
  const label = PHASE_LABELS[phase] || phase;
  const suffix = dryRun && phase !== 'done' ? ' (preview — no changes)' : '';
  if (total > 0) return `${label}: ${done} / ${total}${suffix}`;
  if (done > 0) return `${label}: ${done}${suffix}`;
  return `${label}…${suffix}`;
}

export function formatPhotoCleanupReply(report) {
  const lines = [
    report.summary || '',
    '',
    report.dryRun
      ? 'This was a **preview** — no photos were deleted or favorited. Say **apply photo cleanup** to make changes.'
      : `Cleanup **applied**. Deleted ${report.duplicates.deleted + report.codingScreenshots.deleted} photo(s) and marked ${report.favorites.selected} as favorites in Continuum Favorites.`,
  ];
  if (report.errors?.length) {
    lines.push('', '**Notes:**', ...report.errors.map((e) => `- ${e}`));
  }
  return lines.filter(Boolean).join('\n');
}

export async function formatPhotoCleanupStatusReply() {
  const last = await loadLastPhotoCleanupRun();
  if (!last) {
    return 'No photo cleanup has run yet. Say **preview photo cleanup** or **clean up my photos** to scan your library.';
  }
  return [
    `## Last photo cleanup (${last.dryRun ? 'preview' : 'applied'})`,
    '',
    last.summary || '',
    '',
    `Ran: ${new Date(last.ran_at).toLocaleString()}`,
    last.dryRun
      ? 'Say **apply photo cleanup** to delete duplicates and coding screenshots.'
      : '',
  ].filter(Boolean).join('\n');
}

export async function runPhotoCleanupFromChat(message, onProgress) {
  if (wantsPhotoCleanupStatus(message)) {
    return { type: 'status', content: await formatPhotoCleanupStatusReply() };
  }

  const dryRun = !isPhotoCleanupApply(message);
  const report = await cleanUpPhotoAlbum({
    dryRun,
    onProgress: (phase, done, total) => {
      if (onProgress) onProgress(formatPhotoCleanupProgress(phase, done, total, dryRun));
    },
  });

  return {
    type: 'cleanup',
    report,
    content: formatPhotoCleanupReply(report),
  };
}
