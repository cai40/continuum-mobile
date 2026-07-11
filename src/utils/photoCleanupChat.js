import { cleanUpPhotoAlbum, loadLastPhotoCleanupRun } from './photoAlbumCleanup';
import { formatDryRunDetailMarkdown, formatPhotoCleanupPreviewNextSteps } from './photoCleanupPreview';
import { parsePhotoCleanupRangeFromMessage } from './cleanupMenu';

const PHOTO_TRIGGER = /\b(photos?|pictures?|images?|selfies?|album|camera\s*roll|photo\s+library|library)\b/i;
const PHOTO_CLEANUP_INTENT = /\b(clean\s*up|cleanup|cleaning\s+up|dedupe?|dedup(?:licate)?|organize|declutter|tidy)\b/i;

const PHASE_LABELS = {
  scan: 'Scanning photo library',
  duplicates: 'Finding duplicates',
  screenshots: 'Detecting coding screenshots',
  favorites: 'Scoring photos with AI',
  delete: 'Deleting photos',
  done: 'Done',
};

/** Detect on-device photo album cleanup requests in chat. */
export function wantsPhotoCleanup(message) {
  const text = String(message || '').trim();
  if (!text) return false;

  if (/\bphoto\s+album\s+cleanup\b/i.test(text)) return true;
  if (/\b(?:preview|apply)\s+photo\s+(?:album\s+)?cleanup\b/i.test(text)) return true;
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

export function isPhotoConfirmMessage(text) {
  const input = String(text || '').trim();
  if (input.length > 120) return false;
  return /\b(yes|yeah|yep|ok(?:ay)?|apply|confirm|confirmed|proceed|go ahead|do it|run)\b/i.test(input)
    && !/\b(photo|photos|album|library|cleanup|preview|camera)\b/i.test(input);
}

export function findPriorPhotoUserMessage(messages) {
  if (!Array.isArray(messages)) return null;
  const userMessages = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row?.role !== 'user') continue;
    const text = String(row.content || '').trim();
    if (!text || isPhotoConfirmMessage(text)) continue;
    userMessages.push(text);
  }

  const preview = userMessages.find((text) => /\bpreview\s+photo/i.test(text)
    || (wantsPhotoCleanup(text) && /\b(preview|dry\s*run)\b/i.test(text)));
  if (preview) return preview;

  for (const text of userMessages) {
    if (wantsPhotoCleanup(text)) return text;
  }
  return null;
}

export function buildPhotoConfirmMessage(priorMessage) {
  const prior = String(priorMessage || '').trim();
  if (!prior) return prior;
  if (/\bpreview\s+photo/i.test(prior)) {
    return prior.replace(/^preview\s+/i, 'apply ');
  }
  if (/\b(preview|dry\s*run)\b/i.test(prior) && wantsPhotoCleanup(prior)) {
    return prior
      .replace(/\b(preview|dry\s*run)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return 'apply photo cleanup';
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
  const trashTotal = report.trash?.total ?? 0;
  const favoriteTotal = report.favorites?.total ?? report.favorites?.selected ?? 0;
  const hasChanges = trashTotal + favoriteTotal > 0;
  const lines = [
    report.summary || '',
    '',
  ];

  if (report.dryRun) {
    lines.push(
      'This was a **preview only** — no photos were deleted or favorited.',
      '',
      hasChanges
        ? '**Reply in chat:** **`apply`**, **`proceed`**, **`yes`**, or **`ok`** — same period, no need to say "preview" again.'
        : 'Nothing to delete or favorite in this batch.',
    );
    lines.push(formatDryRunDetailMarkdown(report));
    lines.push(formatPhotoCleanupPreviewNextSteps({
      rangeLabel: report.rangeLabel || null,
      hasChanges,
    }));
  } else {
    lines.push(
      `Cleanup **applied**. Deleted ${report.duplicates.deleted + report.codingScreenshots.deleted} photo(s) and marked ${report.favorites.selected} as favorites in Continuum Favorites.`,
    );
  }

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
      ? 'Reply **`apply`**, **`proceed`**, **`yes`**, or **`ok`** in chat to apply cleanup for the same period.'
      : '',
  ].filter(Boolean).join('\n');
}

export async function runPhotoCleanupFromChat(message, onProgress, { priorMessage = null } = {}) {
  if (wantsPhotoCleanupStatus(message)) {
    return { type: 'status', content: await formatPhotoCleanupStatusReply() };
  }

  const effectiveMessage = priorMessage && isPhotoConfirmMessage(message)
    ? buildPhotoConfirmMessage(priorMessage)
    : message;
  const dryRun = !isPhotoCleanupApply(effectiveMessage);
  const range = parsePhotoCleanupRangeFromMessage(effectiveMessage);
  const report = await cleanUpPhotoAlbum({
    dryRun,
    createdAfter: range?.createdAfter,
    createdBefore: range?.createdBefore,
    monthKeys: range?.monthKeys || null,
    rangeLabel: range?.label || null,
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
