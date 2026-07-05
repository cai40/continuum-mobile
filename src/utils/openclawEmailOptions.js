import {
  DEFAULT_OPENCLAW_EMAIL_LIMIT,
  DEFAULT_OPENCLAW_EMAIL_RECENT,
  MAX_OPENCLAW_EMAIL_LIMIT,
} from '../constants/Config';

export function clampEmailOffset(value) {
  const n = parseInt(String(value || '').trim(), 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, n);
}

export function normalizeEmailRecent(value) {
  const v = String(value || '').trim().toLowerCase();
  if (/^\d+h$/.test(v) || /^\d+d$/.test(v)) return v;
  if (v === '24h' || v === '1d') return '24h';
  if (v === '7d' || v === 'week') return '7d';
  if (v === '30d' || v === 'month') return '30d';
  return DEFAULT_OPENCLAW_EMAIL_RECENT;
}

export function parseEmailRangeFromMessage(message) {
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

export function parseEmailLimitFromMessage(message) {
  const range = parseEmailRangeFromMessage(message);
  if (range) return clampEmailLimit(range.limit);

  const text = message || '';
  const patterns = [
    /\b(?:last|top|read|fetch|get|show|list)\s+(\d{1,4})\s+emails?\b/i,
    /\b(?:latest|recent|newest)\s+(\d{1,4})\s+emails?\b/i,
    /\b(\d{1,4})\s+(?:recent|latest|newest)\s+emails?\b/i,
    /\bnext\s+(\d{1,4})\s+emails?\b/i,
    /\b(\d{1,4})\s+emails?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clampEmailLimit(match[1]);
  }
  return null;
}

export function parseEmailOffsetFromMessage(message) {
  const range = parseEmailRangeFromMessage(message);
  if (range) return clampEmailOffset(range.offset);

  const text = message || '';
  const patterns = [
    /\bnext\s+\d{1,4}\s+emails?\s+(?:after|past|beyond|from|starting(?:\s+after)?)\s+(?:the\s+)?(?:first\s+)?(\d{1,4})\b/i,
    /\b(?:skip|offset)\s+(?:the\s+)?(?:first\s+)?(\d{1,4})(?:\s+emails?)?\b/i,
    /\b(?:after|beyond)\s+(?:the\s+)?(?:first|top)\s+(\d{1,4})\s+emails?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clampEmailOffset(match[1]);
  }
  return null;
}

export function resolveEmailFetchPayload({ limit, recent, message }) {
  const fromMessageLimit = message ? parseEmailLimitFromMessage(message) : null;
  const fromMessageOffset = message ? parseEmailOffsetFromMessage(message) : null;
  const resolvedLimit = fromMessageLimit ?? clampEmailLimit(limit);
  let resolvedOffset = fromMessageOffset ?? 0;

  const pageMatch = message?.match(/\b(?:page|batch)\s+(\d{1,4})\b/i);
  if (pageMatch && fromMessageOffset == null) {
    const page = parseInt(pageMatch[1], 10);
    if (page > 1) resolvedOffset = clampEmailOffset((page - 1) * resolvedLimit);
  }

  return {
    email_limit: resolvedLimit,
    email_offset: resolvedOffset,
    email_recent: normalizeEmailRecent(recent),
  };
}
