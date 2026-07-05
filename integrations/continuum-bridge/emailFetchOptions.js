'use strict';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 1000;
const DEFAULT_RECENT = '7d';

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

function parseLimitFromMessage(message) {
  const text = message || '';
  const patterns = [
    /\b(?:last|top|read|fetch|get|show|list)\s+(\d{1,4})\s+emails?\b/i,
    /\b(?:latest|recent|newest)\s+(\d{1,4})\s+emails?\b/i,
    /\b(\d{1,4})\s+(?:recent|latest|newest)\s+emails?\b/i,
    /\b(\d{1,4})\s+emails?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clampLimit(match[1], null);
  }
  return null;
}

function parseRecentFromMessage(message) {
  const text = (message || '').toLowerCase();
  if (/\b(?:last|past)\s+(\d+)\s*hours?\b/.test(text)) {
    const h = text.match(/\b(?:last|past)\s+(\d+)\s*hours?\b/);
    if (h) return `${h[1]}h`;
  }
  if (/\b(?:last|past)\s+(\d+)\s*days?\b/.test(text)) {
    const d = text.match(/\b(?:last|past)\s+(\d+)\s*days?\b/);
    if (d) return `${d[1]}d`;
  }
  if (/\b(?:last|past)\s+(\d+)\s*weeks?\b/.test(text)) {
    const w = text.match(/\b(?:last|past)\s+(\d+)\s*weeks?\b/);
    if (w) return `${parseInt(w[1], 10) * 7}d`;
  }
  if (/\b24\s*hours?\b|\btoday\b|\byesterday\b/.test(text)) return '24h';
  if (/\b7\s*days?\b|\bweek\b/.test(text)) return '7d';
  if (/\b30\s*days?\b|\bmonth\b/.test(text)) return '30d';
  return null;
}

function resolveEmailFetchOptions(message, payloadOptions = {}) {
  const limitFromMessage = parseLimitFromMessage(message);
  const limit = clampLimit(
    limitFromMessage ?? payloadOptions.email_limit,
    DEFAULT_LIMIT,
  );
  const recent = parseRecentFromMessage(message)
    || payloadOptions.email_recent
    || DEFAULT_RECENT;
  const unreadOnly = /\b(unread|unseen)\b/i.test(message || '');
  return { limit, recent, unreadOnly };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  parseLimitFromMessage,
  parseRecentFromMessage,
  resolveEmailFetchOptions,
};
