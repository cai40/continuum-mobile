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

export function clampEmailOffset(value) {
  const n = parseInt(String(value || '').trim(), 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, n);
}

function parseDateToken(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  let [, mm, dd, yyyy] = m;
  if (yyyy.length === 2) yyyy = `20${yyyy}`;
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  const year = parseInt(yyyy, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1970 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

function parseMonthRangeFromMessage(message) {
  const text = message || '';
  const monthPat = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  const defaultYear = new Date().getFullYear();
  const patterns = [
    new RegExp(`\\b(?:for|in|during)\\s+(?:the\\s+)?(?:month\\s+of\\s+)?(${monthPat})\\s+(20\\d{2})\\b`, 'i'),
    new RegExp(`\\b(?:clean\\s*up|cleanup|fetch|get|show|list|trash|delete|remove|move|clean)(?:\\s+(?:and|my|the))*\\s+(?:\\w+\\s+){0,4}?\\b(${monthPat})\\s+(20\\d{2})\\b`, 'i'),
    new RegExp(`\\b(?:clean\\s*up|cleanup|fetch|get|show|list|clean)(?:\\s+(?:and|my|the))*\\s+(?:\\w+\\s+){0,4}?\\b(${monthPat})\\s+emails?\\b`, 'i'),
    /\b(?:for|in|during|clean\s*up|cleanup)\s+(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/i,
    new RegExp(`\\b(${monthPat})\\s+(20\\d{2})\\b`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const year = parseInt(match[2] || String(defaultYear), 10);
    if (year < 1970 || year > 2100) continue;
    let month;
    if (/^\d{1,2}$/.test(match[1])) month = parseInt(match[1], 10);
    else month = MONTHS[match[1].toLowerCase()];
    if (!month || month < 1 || month > 12) continue;
    const since = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
    const before = `${next.y}-${String(next.m).padStart(2, '0')}-01`;
    return { since, before };
  }
  return null;
}

function parseYearRangeFromMessage(message) {
  const text = message || '';
  const patterns = [
    /\b(?:for|in|during)\s+(?:the\s+)?(?:year\s+)?(20\d{2})\b/i,
    /\b(?:clean\s*up|cleanup)(?:\s+(?:my|the)\s+inbox)?\s+(?:for\s+)?(20\d{2})\b/i,
    /\b(?:fetch|get|show|list|trash|delete|remove|move)\s+(?:emails?\s+)?(?:for|in)\s+(20\d{2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const year = parseInt(match[1], 10);
    if (year < 1970 || year > 2100) continue;
    return {
      since: `${year}-01-01`,
      before: `${year + 1}-01-01`,
    };
  }
  return null;
}

export function parseEmailDateRangeFromMessage(message) {
  const yearRange = parseYearRangeFromMessage(message);
  if (yearRange) return yearRange;

  const monthRange = parseMonthRangeFromMessage(message);
  if (monthRange) return monthRange;

  const text = message || '';
  const patterns = [
    /\bfrom\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(?:back\s+to|to)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i,
    /\bbetween\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+and\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i,
    /\b(?:emails?\s+)?(?:from\s+)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(?:through|thru|until|to|-)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i,
    /\b(?:since|after)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})(?:\s+(?:until|before|to|through)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}))?\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const d1 = parseDateToken(match[1]);
    if (!d1) continue;
    if (!match[2]) {
      const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
      return { since: d1, before: tomorrow };
    }
    const d2 = parseDateToken(match[2]);
    if (!d2) continue;
    const since = d1 <= d2 ? d1 : d2;
    const end = d1 <= d2 ? d2 : d1;
    return { since, before: addDays(end, 1) };
  }
  return null;
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
    /\b(?:up\s+to|process\s+up\s+to|max|maximum)\s+(\d{1,4})\s+emails?\b/i,
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
  const batchSkip = text.match(/\b(\d{1,4})\s+emails?\s*\(\s*skipp(?:ing|ed)?\s+(?:the\s+)?(?:first\s+)?(\d{1,4})\s*\)/i);
  if (batchSkip) return clampEmailOffset(batchSkip[2]);

  const patterns = [
    /\bnext\s+\d{1,4}\s+emails?\s+(?:after|past|beyond|from|starting(?:\s+after)?)\s+(?:the\s+)?(?:first\s+)?(\d{1,4})\b/i,
    /\bskip(?:ping|ped)?\s+(?:the\s+)?(?:first\s+)?(\d{1,4})(?:\s+emails?)?\b/i,
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
  const dateRange = message ? parseEmailDateRangeFromMessage(message) : null;
  let resolvedLimit = fromMessageLimit ?? clampEmailLimit(limit);
  if (dateRange && fromMessageLimit == null) {
    resolvedLimit = Math.max(resolvedLimit, 1000);
  }
  let resolvedOffset = fromMessageOffset ?? 0;

  const pageMatch = message?.match(/\b(?:page|batch)\s+(\d{1,4})\b/i);
  if (pageMatch && fromMessageOffset == null) {
    const page = parseInt(pageMatch[1], 10);
    if (page > 1) resolvedOffset = clampEmailOffset((page - 1) * resolvedLimit);
  }

  return {
    email_limit: resolvedLimit,
    email_offset: resolvedOffset,
    email_recent: dateRange ? null : normalizeEmailRecent(recent),
    email_since: dateRange?.since || null,
    email_before: dateRange?.before || null,
  };
}
