'use strict';

const { parseDateRangeFromMessage, parseYearRangeFromMessage, addDays } = require('./emailDateRange');
const { wantsEmailCleanup } = require('./emailDelete');
const { wantsEmailMoveToFolder } = require('./emailMove');
const { isComposeEmailRequest } = require('./emailComposeIntent');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50000;
/** Minimum fetch cap for month date-range queries (no explicit limit in message). */
const MONTH_RANGE_MIN_LIMIT = 50000;
/** Minimum fetch cap for full-year date-range queries. */
const YEAR_RANGE_MIN_LIMIT = 50000;
const DEFAULT_RECENT = '7d';

const EMAIL_TRIGGER = /\b(emails?|inbox|yahoo|mail|unread|smtp|imap|delete|remove|trash|junk|spam|move|copy|triage|classify|memory|continuum|feed|ingest|remember|skip|offset|fetch|batch|page|newsletter|promo|summarize|summary|clean|clean(?:up|ing)?)\b/i;

function wantsEmailSummaryOnly(message) {
  const text = message || '';
  if (/\b(list\s+each|every\s+email|all\s+subjects|show\s+(?:me\s+)?each)\b/i.test(text)) return false;
  return /\b(summary|summarize|don'?t\s+(?:list|show|give)|do\s+not\s+(?:list|show)|no\s+details|not\s+each|overview|high[\s-]?level|just\s+(?:a\s+)?summary|aggregate|stats?\s+only)\b/i.test(text)
    || /\bprocess\s+up\s+to\s+\d+\s+emails?\b/i.test(text);
}

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
    /\b(?:up\s+to|process\s+up\s+to|max|maximum)\s+(\d{1,5})\s+emails?\b/i,
    /\b(?:last|top|read|fetch|get|show|list)\s+(\d{1,5})\s+emails?\b/i,
    /\b(?:latest|recent|newest)\s+(\d{1,5})\s+emails?\b/i,
    /\b(\d{1,5})\s+(?:recent|latest|newest)\s+emails?\b/i,
    /\bnext\s+(\d{1,5})\s+emails?\b/i,
    /\b(\d{1,5})\s+emails?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      // A 4-digit year (2000–2099) that's part of a date range (e.g. "Sep 2025 emails",
      // "for 2025") must NOT be treated as a fetch limit — fall back to the range default.
      if (n >= 2000 && n <= 2099 && parseDateRangeFromMessage(text)) return null;
      return clampLimit(match[1], null);
    }
  }
  return null;
}

function parseRangeFromMessage(message) {
  const text = message || '';
  const match = text.match(/\bemails?\s+(\d{1,5})\s*[-–]\s*(\d{1,5})\b/i);
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

  const batchSkip = text.match(/\b(\d{1,4})\s+emails?\s*\(\s*skipp(?:ing|ed)?\s+(?:the\s+)?(?:first\s+)?(\d{1,4})\s*\)/i);
  if (batchSkip) return clampOffset(batchSkip[2], null);

  const patterns = [
    /\bnext\s+\d{1,4}\s+emails?\s+(?:after|past|beyond|from|starting(?:\s+after)?)\s+(?:the\s+)?(?:first\s+)?(\d{1,4})\b/i,
    /\bskip(?:ping|ped)?\s+(?:the\s+)?(?:first\s+)?(\d{1,4})(?:\s+emails?)?\b/i,
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
  const dateRangeFromMessage = parseDateRangeFromMessage(message);
  const yearRange = parseYearRangeFromMessage(message);
  const cleanup = wantsEmailCleanup(message);
  const moveToFolder = wantsEmailMoveToFolder(message);
  const rangeMinLimit = yearRange
    ? YEAR_RANGE_MIN_LIMIT
    : (dateRangeFromMessage ? MONTH_RANGE_MIN_LIMIT : null);
  const defaultLimit = rangeMinLimit ?? (moveToFolder ? 250 : (cleanup ? 500 : DEFAULT_LIMIT));
  let limit = limitFromMessage != null
    ? clampLimit(limitFromMessage, defaultLimit)
    : clampLimit(payloadOptions.email_limit, defaultLimit);
  // App-stored limits (e.g. 500) must not cap month/year range fetches below the bridge default.
  if (dateRangeFromMessage && limitFromMessage == null) {
    limit = Math.max(limit, defaultLimit);
  }
  // Whole-year cleanup uses weekly slices — always use month minimum, never the parent year cap.
  if (payloadOptions.year_cleanup_month && dateRangeFromMessage) {
    limit = Math.max(MONTH_RANGE_MIN_LIMIT, limitFromMessage != null ? clampLimit(limitFromMessage, MONTH_RANGE_MIN_LIMIT) : MONTH_RANGE_MIN_LIMIT);
  }
  let offset = clampOffset(
    offsetFromMessage ?? payloadOptions.email_offset,
    0,
  );
  const pageMatch = (message || '').match(/\b(?:page|batch)\s+(\d{1,4})\b/i);
  if (pageMatch && offsetFromMessage == null && payloadOptions.email_offset == null) {
    const page = parseInt(pageMatch[1], 10);
    if (page > 1) offset = clampOffset((page - 1) * limit);
  }
  const recent = dateRangeFromMessage
    ? null
    : (parseRecentFromMessage(message)
      || (moveToFolder ? (/\ball\b/i.test(message || '') ? '365d' : '90d') : null)
      || (cleanup ? '30d' : null)
      || payloadOptions.email_recent
      || DEFAULT_RECENT);
  const since = payloadOptions.email_date_override
    ? (payloadOptions.email_since || dateRangeFromMessage?.since || null)
    : (dateRangeFromMessage?.since || payloadOptions.email_since || null);
  const before = payloadOptions.email_date_override
    ? (payloadOptions.email_before || dateRangeFromMessage?.before || null)
    : (dateRangeFromMessage?.before || payloadOptions.email_before || null);
  const dateRangeLabel = payloadOptions.email_date_override && since && before
    ? `${since} .. ${addDays(before, -1)}`
    : (dateRangeFromMessage?.label
      || (since && before ? `${since} through ${addDays(before, -1)}` : null));
  const unreadOnly = /\b(unread|unseen)\b/i.test(message || '');
  return {
    limit, offset, recent, unreadOnly, since, before, dateRangeLabel,
  };
}

function formatPreEmailFetchStatus(fetchOptions) {
  if (!fetchOptions) return 'Fetching Yahoo inbox (if requested)…';
  const { limit = 0, dateRangeLabel } = fetchOptions;
  if (dateRangeLabel) {
    const isFullYear = /\(full year\)/i.test(String(dateRangeLabel));
    if (limit >= 10000 && isFullYear) {
      return `Scanning ${dateRangeLabel}… (load cap ${limit}; full-year scan — may take 15–45 minutes)`;
    }
    if (limit >= 10000) {
      return `Scanning ${dateRangeLabel}… (load cap ${limit}; month scan — may take 5–20 minutes)`;
    }
    if (limit >= 1500) {
      return `Scanning ${dateRangeLabel}… (load cap ${limit}; large scan — may take 5–15 minutes)`;
    }
    if (limit >= 500) {
      return `Scanning ${dateRangeLabel}… (load cap ${limit}; may take 3–8 minutes)`;
    }
    return `Scanning ${dateRangeLabel}…`;
  }
  if (limit >= 500) {
    return `Fetching Yahoo inbox (up to ${limit} — may take 3–8 minutes)…`;
  }
  return 'Fetching Yahoo inbox (if requested)…';
}

function formatPostEmailFetchStatus({ fetchOptions, scanMeta, loadedCount } = {}) {
  const range = fetchOptions?.dateRangeLabel;
  const matched = scanMeta?.matched;
  const loaded = loadedCount ?? 0;
  if (range && matched != null) {
    if (loaded < matched) {
      return `${range}: ${loaded} of ${matched} matched loaded (cap ${fetchOptions.limit}) — analyzing…`;
    }
    return `${range}: ${matched} matched — analyzing…`;
  }
  if (loaded > 0) {
    return `Loaded ${loaded} email(s) — analyzing…`;
  }
  return null;
}

function wantsEmailFetch(message, payloadOptions = {}) {
  const text = message || '';
  if (isComposeEmailRequest(text)) return false;
  if (EMAIL_TRIGGER.test(text)) return true;
  if (parseDateRangeFromMessage(text)) return true;
  if (parseOffsetFromMessage(text) != null) return true;
  if (parseLimitFromMessage(text) != null && /\bemails?\b/i.test(text)) return true;
  if (/\b(?:page|batch)\s+\d/i.test(text)) return true;
  if (Number(payloadOptions.email_offset) > 0) return true;
  return false;
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MONTH_RANGE_MIN_LIMIT,
  YEAR_RANGE_MIN_LIMIT,
  clampLimit,
  clampOffset,
  parseLimitFromMessage,
  parseOffsetFromMessage,
  parseRangeFromMessage,
  parseRecentFromMessage,
  parseDateRangeFromMessage,
  resolveEmailFetchOptions,
  formatPreEmailFetchStatus,
  formatPostEmailFetchStatus,
  wantsEmailFetch,
  wantsEmailSummaryOnly,
};
