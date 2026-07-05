'use strict';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 1000;
const DEFAULT_RECENT = '7d';

const EMAIL_TRIGGER = /\b(emails?|inbox|yahoo|mail|unread|smtp|imap|delete|remove|trash|junk|spam|move|triage|classify|memory|continuum|feed|ingest|remember|skip|offset|fetch|batch|page|newsletter|promo|summarize|summary)\b/i;

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

function clampOffset(value, fallback = 0) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, n);
}

function parseLimitFromMessage(message) {
  const text = message || '';
  const range = parseRangeFromMessage(text);
  if (range) return range.limit;

  const patterns = [
    /\b(?:last|top|read|fetch|get|show|list)\s+(\d{1,4})\s+emails?\b/i,
    /\b(?:latest|recent|newest)\s+(\d{1,4})\s+emails?\b/i,
    /\b(\d{1,4})\s+(?:recent|latest|newest)\s+emails?\b/i,
    /\bnext\s+(\d{1,4})\s+emails?\b/i,
    /\b(\d{1,4})\s+emails?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clampLimit(match[1], null);
  }
  return null;
}

function parseRangeFromMessage(message) {
  const text = message || '';
  const match = text.match(/\bemails?\s+(\d{1,4})\s*[-–]\s*(\d{1,4})\b/i);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < start) return null;
  return {
    offset: start - 1,
    limit: end - start + 1,
  };
}

function parseOffsetFromMessage(message) {
  const text = message || '';
  const range = parseRangeFromMessage(text);
  if (range) return range.offset;

  const patterns = [
    /\bnext\s+\d{1,4}\s+emails?\s+(?:after|past|beyond|from|starting(?:\s+after)?)\s+(?:the\s+)?(?:first\s+)?(\d{1,4})\b/i,
    /\b(?:skip|offset)\s+(?:the\s+)?(?:first\s+)?(\d{1,4})(?:\s+emails?)?\b/i,
    /\b(?:after|beyond)\s+(?:the\s+)?(?:first|top)\s+(\d{1,4})\s+emails?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clampOffset(match[1], null);
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
  const offsetFromMessage = parseOffsetFromMessage(message);
  const limit = clampLimit(
    limitFromMessage ?? payloadOptions.email_limit,
    DEFAULT_LIMIT,
  );
  let offset = clampOffset(
    offsetFromMessage ?? payloadOptions.email_offset,
    0,
  );
  const pageMatch = (message || '').match(/\b(?:page|batch)\s+(\d{1,4})\b/i);
  if (pageMatch && offsetFromMessage == null && payloadOptions.email_offset == null) {
    const page = parseInt(pageMatch[1], 10);
    if (page > 1) offset = clampOffset((page - 1) * limit);
  }
  const recent = parseRecentFromMessage(message)
    || payloadOptions.email_recent
    || DEFAULT_RECENT;
  const unreadOnly = /\b(unread|unseen)\b/i.test(message || '');
  return { limit, offset, recent, unreadOnly };
}

function wantsEmailFetch(message, payloadOptions = {}) {
  const text = message || '';
  if (EMAIL_TRIGGER.test(text)) return true;
  if (parseRangeFromMessage(text)) return true;
  if (parseOffsetFromMessage(text) != null) return true;
  if (parseLimitFromMessage(text) != null && /\bemails?\b/i.test(text)) return true;
  if (/\b(?:page|batch)\s+\d/i.test(text)) return true;
  if (Number(payloadOptions.email_offset) > 0) return true;
  return false;
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  clampOffset,
  parseLimitFromMessage,
  parseOffsetFromMessage,
  parseRangeFromMessage,
  parseRecentFromMessage,
  resolveEmailFetchOptions,
  wantsEmailFetch,
};
