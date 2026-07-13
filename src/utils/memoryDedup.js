/** Punctuation-agnostic fingerprint for duplicate detection (matches backend deep-clean logic). */
export function normalizeMemoryContent(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function memoryContentFingerprint(text) {
  const normalized = normalizeMemoryContent(text);
  return normalized ? normalized.slice(0, 160) : '';
}

/** Group items with identical normalized content. Returns only groups with 2+ items. */
export function findDuplicateGroups(items, layer, getText) {
  const buckets = new Map();
  for (const item of items || []) {
    const text = getText(item, layer);
    const fp = memoryContentFingerprint(text);
    if (!fp) continue;
    if (!buckets.has(fp)) buckets.set(fp, []);
    buckets.get(fp).push(item);
  }
  return [...buckets.values()].filter((group) => group.length > 1);
}

export function sortItemsNewestFirst(items, layer, getText) {
  return [...items].sort((a, b) => {
    const da = String(a?.created_at || a?.timestamp || '');
    const db = String(b?.created_at || b?.timestamp || '');
    return db.localeCompare(da);
  });
}

/** Keep newest duplicate; return the rest for deletion. */
export function pickDuplicateRemovals(group, layer, getText) {
  const sorted = sortItemsNewestFirst(group, layer, getText);
  return sorted.slice(1);
}
