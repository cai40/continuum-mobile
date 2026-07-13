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

function shannonEntropyBits(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return 0;
  const counts = {};
  for (const ch of cleaned.toLowerCase()) {
    counts[ch] = (counts[ch] || 0) + 1;
  }
  const total = cleaned.length;
  let entropy = 0;
  for (const count of Object.values(counts)) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const NOISE_FILLER = /^(hi|hello|hey|test|thanks|thank you|ok|okay|yes|no|anyone there)[\s!.?]*$/i;

/** Short filler utterances with low information density (L2 noise purge). */
export function isConversationalNoise(text) {
  const cleaned = String(text || '').trim();
  if (cleaned.length < 15 && NOISE_FILLER.test(cleaned)) return true;
  if (cleaned.length < 15 && shannonEntropyBits(cleaned) < 2.5) return true;
  if (shannonEntropyBits(cleaned) < 2.5 && cleaned.length < 40) return true;
  return false;
}

/** Ebbinghaus-style retention score for decay purge on L2/L3. */
export function ebbinghausRetention({ createdAt, mentionCount = 1, importanceScore = 5, now = Date.now() }) {
  if (!createdAt) return 1;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 1;
  const ageDays = Math.max(0, (now - created) / 86400000);
  const stability = Math.max(1, Number(mentionCount) * Math.max(1, Number(importanceScore)) * 7);
  return Math.exp(-ageDays / stability);
}
