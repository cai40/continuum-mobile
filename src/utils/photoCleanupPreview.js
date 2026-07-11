/** @typedef {'duplicate' | 'coding_screenshot'} TrashReason */

/**
 * @typedef {Object} PhotoPreviewItem
 * @property {string} id
 * @property {string} filename
 * @property {string} uri
 * @property {string} dateLabel
 * @property {string} sizeLabel
 * @property {TrashReason} [reason]
 */

export const PREVIEW_STORAGE_CAP = 150;
export const CHAT_LIST_CAP = 40;

export function formatPhotoDateLabel(creationTime) {
  if (!creationTime) return 'Unknown date';
  return new Date(creationTime).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPhotoSizeLabel(width, height) {
  if (!width || !height) return '';
  return `${width}×${height}`;
}

/** @param {import('expo-media-library').Asset} asset @param {TrashReason} [reason] */
export function toPhotoPreviewItem(asset, reason) {
  /** @type {PhotoPreviewItem} */
  const item = {
    id: asset.id,
    filename: String(asset.filename || 'Photo').trim() || 'Photo',
    uri: asset.uri,
    dateLabel: formatPhotoDateLabel(asset.creationTime),
    sizeLabel: formatPhotoSizeLabel(asset.width, asset.height),
  };
  if (reason) item.reason = reason;
  return item;
}

/** @param {PhotoPreviewItem[]} items */
export function capPreviewItems(items, cap = PREVIEW_STORAGE_CAP) {
  return {
    total: items.length,
    items: items.slice(0, cap),
    truncated: items.length > cap,
  };
}

/** @param {PhotoPreviewItem} item */
export function formatPreviewItemLine(item) {
  const size = item.sizeLabel ? ` · ${item.sizeLabel}` : '';
  return `- ${item.filename} — ${item.dateLabel}${size}`;
}

/**
 * @param {PhotoPreviewItem[]} items
 * @param {number} [cap]
 */
export function formatPreviewItemList(items, cap = CHAT_LIST_CAP) {
  if (!items?.length) return ['- _(none)_'];
  const lines = items.slice(0, cap).map(formatPreviewItemLine);
  if (items.length > cap) {
    lines.push(`- _…and ${items.length - cap} more_`);
  }
  return lines;
}

/**
 * @param {import('./photoAlbumCleanup').CleanupReport} report
 */
export function formatDryRunDetailMarkdown(report) {
  if (!report?.dryRun) return '';

  const dupes = report.trash?.duplicates?.items || [];
  const screenshots = report.trash?.codingScreenshots?.items || [];
  const favorites = report.favorites?.items || [];
  const trashTotal = report.trash?.total ?? (dupes.length + screenshots.length);

  const lines = [
    '',
    `### Would move to trash (${trashTotal})`,
    '_Deleted photos go to Recently Deleted on iOS._',
    '',
    `**Duplicates (${report.trash?.duplicates?.total ?? dupes.length})**`,
    ...formatPreviewItemList(dupes),
    '',
    `**Coding screenshots (${report.trash?.codingScreenshots?.total ?? screenshots.length})**`,
    ...formatPreviewItemList(screenshots),
    '',
    `### Would favorite (${report.favorites?.total ?? favorites.length})`,
    '_Added to Continuum Favorites album._',
    '',
    ...formatPreviewItemList(favorites),
  ];

  if (report.trash?.duplicates?.truncated || report.trash?.codingScreenshots?.truncated || report.favorites?.truncated) {
    lines.push('', '_Open the Photos tab for the full preview list (up to 150 per section)._');
  }

  return lines.join('\n');
}

/** Short alert body after a photo cleanup preview finishes. */
export function formatPhotoPreviewAlertSummary(report) {
  if (!report) return 'Preview complete.';
  const trash = report.trash?.total ?? 0;
  const fav = report.favorites?.total ?? report.favorites?.selected ?? 0;
  const period = report.rangeLabel ? ` for ${report.rangeLabel}` : '';
  const lines = [
    `Scanned ${report.scanned} photo(s)${period}.`,
    '',
  ];
  if (trash || fav) {
    lines.push(
      `Would trash: ${trash}`,
      `Would favorite: ${fav}`,
      '',
      'Reply apply, proceed, yes, or ok in chat to apply.',
      'Or tap Apply cleanup on the Photos tab.',
    );
  } else {
    lines.push('Nothing would be deleted or favorited for this period.');
  }
  return lines.join('\n');
}

export function formatPhotoCleanupPreviewNextSteps({ rangeLabel = null, hasChanges = true } = {}) {
  const period = rangeLabel ? `**${rangeLabel}**` : 'the **same period** you just previewed';

  const lines = [
    '',
    '---',
    '',
    '## What to do next',
    '',
    'This was a **preview only** — no photos were deleted or favorited.',
    '',
  ];

  if (!hasChanges) {
    lines.push(
      'Nothing to delete or favorite in this batch.',
      '',
      '**Options:**',
      '- Try another date range from the **Photos** tab.',
      '- Preview again: **Photos** tab → period → **Preview (dry run)**.',
    );
    return lines.join('\n');
  }

  lines.push(
    '**Reply in chat with one word:**',
    '',
    '- **`apply`** (recommended)',
    '- **`proceed`**',
    '- **`yes`**',
    '- **`ok`**',
    '',
    'Same period as this preview. Do not say "preview" again.',
    '',
    '**Or apply from the Photos tab:**',
    '',
    `1. **Photos** tab → choose ${period} → tap **Apply cleanup**.`,
    '2. Wait until the reply shows **Done**.',
    '',
    '**Notes:**',
    '- Trash goes to Recently Deleted (recoverable on iOS).',
    '- Favorites are added to Continuum Favorites.',
    '- **To skip:** do nothing — this preview made no changes.',
  );
  return lines.join('\n');
}
