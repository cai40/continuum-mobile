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

export function resolveEmailFetchPayload({ limit, recent }) {
  return {
    email_limit: clampEmailLimit(limit),
    email_recent: normalizeEmailRecent(recent),
  };
}
