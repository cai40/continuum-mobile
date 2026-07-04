import {
  DEFAULT_OPENCLAW_EMAIL_LIMIT,
  DEFAULT_OPENCLAW_EMAIL_RECENT,
  MAX_OPENCLAW_EMAIL_LIMIT,
} from '../constants/Config';

export function clampEmailLimit(value) {
  const n = parseInt(String(value || '').trim(), 10);
  if (Number.isNaN(n)) return DEFAULT_OPENCLAW_EMAIL_LIMIT;
  return Math.min(MAX_OPENCLAW_EMAIL_LIMIT, Math.max(1, n));
}

export function normalizeEmailRecent(value) {
  const v = String(value || '').trim().toLowerCase();
  if (/^\d+h$/.test(v) || /^\d+d$/.test(v)) return v;
  if (v === '24h' || v === '1d') return '24h';
  if (v === '7d' || v === 'week') return '7d';
  if (v === '30d' || v === 'month') return '30d';
  return DEFAULT_OPENCLAW_EMAIL_RECENT;
}

export function parseEmailLimitFromMessage(message) {
  const text = message || '';
  const patterns = [
    /\b(?:last|top|read|fetch|get|show|list)\s+(\d{1,3})\s+emails?\b/i,
    /\b(?:latest|recent|newest)\s+(\d{1,3})\s+emails?\b/i,
    /\b(\d{1,3})\s+(?:recent|latest|newest)\s+emails?\b/i,
    /\b(\d{1,3})\s+emails?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clampEmailLimit(match[1]);
  }
  return null;
}

export function resolveEmailFetchPayload({ limit, recent, message }) {
  const fromMessage = message ? parseEmailLimitFromMessage(message) : null;
  return {
    email_limit: fromMessage ?? clampEmailLimit(limit),
    email_recent: normalizeEmailRecent(recent),
  };
}
