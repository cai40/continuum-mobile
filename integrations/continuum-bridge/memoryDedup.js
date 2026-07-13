'use strict';

function normalizeMemoryContent(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function memoryContentFingerprint(text) {
  const normalized = normalizeMemoryContent(text);
  return normalized ? normalized.slice(0, 160) : '';
}

function rowTimestamp(row) {
  return String(row?.created_at || row?.timestamp || '');
}

function sortRowsNewestFirst(rows) {
  return [...rows].sort((a, b) => rowTimestamp(b).localeCompare(rowTimestamp(a)));
}

function findDuplicateGroups(rows, getText) {
  const buckets = new Map();
  for (const row of rows || []) {
    const fp = memoryContentFingerprint(getText(row));
    if (!fp) continue;
    if (!buckets.has(fp)) buckets.set(fp, []);
    buckets.get(fp).push(row);
  }
  return [...buckets.values()].filter((g) => g.length > 1);
}

function pickDuplicateRemovals(group) {
  const ordered = sortRowsNewestFirst(group);
  return ordered.slice(1);
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

function isConversationalNoise(text) {
  const cleaned = String(text || '').trim();
  if (cleaned.length < 15 && NOISE_FILLER.test(cleaned)) return true;
  if (cleaned.length < 15 && shannonEntropyBits(cleaned) < 2.5) return true;
  if (shannonEntropyBits(cleaned) < 2.5 && cleaned.length < 40) return true;
  return false;
}

function ebbinghausRetention({ createdAt, mentionCount = 1, importanceScore = 5, now = Date.now() }) {
  if (!createdAt) return 1;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 1;
  const ageDays = Math.max(0, (now - created) / 86400000);
  const stability = Math.max(1, Number(mentionCount) * Math.max(1, Number(importanceScore)) * 7);
  return Math.exp(-ageDays / stability);
}

module.exports = {
  normalizeMemoryContent,
  memoryContentFingerprint,
  findDuplicateGroups,
  pickDuplicateRemovals,
  isConversationalNoise,
  ebbinghausRetention,
};
