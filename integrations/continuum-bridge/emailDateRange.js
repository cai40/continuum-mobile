'use strict';

const MONTHS = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

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

function parseNamedDateToken(raw) {
  const m = String(raw || '').trim().match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (day < 1 || day > 31 || year < 1970 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseAnyDateToken(raw) {
  return parseDateToken(raw) || parseNamedDateToken(raw);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthNamePattern() {
  return Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
}

function parseMonthToken(monthRaw, yearRaw) {
  const year = parseInt(yearRaw, 10);
  if (year < 1970 || year > 2100) return null;
  let month;
  if (/^\d{1,2}$/.test(String(monthRaw))) {
    month = parseInt(monthRaw, 10);
  } else {
    month = MONTHS[String(monthRaw).toLowerCase()];
  }
  if (!month || month < 1 || month > 12) return null;
  const since = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = month === 12
    ? { y: year + 1, m: 1 }
    : { y: year, m: month + 1 };
  const before = `${next.y}-${String(next.m).padStart(2, '0')}-01`;
  const monthLabel = String(monthRaw).match(/^\d/)
    ? since.slice(0, 7)
    : `${String(monthRaw).charAt(0).toUpperCase()}${String(monthRaw).slice(1).toLowerCase()} ${year}`;
  return { since, before, label: monthLabel };
}

function parseMonthRangeFromMessage(message) {
  const text = message || '';
  const monthPat = monthNamePattern();
  const defaultYear = String(new Date().getFullYear());
  const patterns = [
    new RegExp(String.raw`\b(?:for|in|during)\s+(?:the\s+)?(?:month\s+of\s+)?(${monthPat})\s+(20\d{2})\b`, 'i'),
    new RegExp(String.raw`\b(?:clean\s*up|cleanup|fetch|get|show|list|trash|delete|remove|move|clean)(?:\s+(?:and|my|the))*\s+(?:\w+\s+){0,4}?\b(${monthPat})\s+(20\d{2})\b`, 'i'),
    new RegExp(String.raw`\b(?:clean\s*up|cleanup|fetch|get|show|list|clean)(?:\s+(?:and|my|the))*\s+(?:\w+\s+){0,4}?\b(${monthPat})\s+emails?\b`, 'i'),
    /\b(?:for|in|during|clean\s*up|cleanup)\s+(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/i,
    new RegExp(String.raw`\b(${monthPat})\s+(20\d{2})\b`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const monthRaw = match[1];
    const yearRaw = match[2] || defaultYear;
    const parsed = parseMonthToken(monthRaw, yearRaw);
    if (parsed) return parsed;
  }
  return null;
}

function hasExplicitMonthYear(message) {
  const text = message || '';
  const monthPat = monthNamePattern();
  if (new RegExp(String.raw`\b(${monthPat})\s+(20\d{2})\b`, 'i').test(text)) return true;
  return /\b(?:for|in|during|clean\s*up|cleanup)\s+(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/i.test(text);
}

function parseYearRangeFromMessage(message) {
  const text = message || '';
  // "clean up December 2024 emails" must stay a single-month scan, not whole-year 2024.
  if (hasExplicitMonthYear(text)) return null;
  const patterns = [
    /\b(?:for|in|during)\s+(?:the\s+)?(?:whole\s+)?(?:year\s+)?(20\d{2})\b/i,
    /\b(?:clean\s*up|cleanup|clean)(?:\s+(?:my|the))?\s+(?:inbox\s+)?(?:for\s+)?(?:the\s+)?(?:whole\s+)?(?:year\s+)?(20\d{2})\b/i,
    /\b(?:clean\s*up|cleanup|clean)\s+(?:all\s+of|entire|whole|full)\s+(20\d{2})\b/i,
    /\b(?:clean\s*up|cleanup|clean)\s+(?:the\s+)?(?:whole|full|entire)\s+year\s+(20\d{2})\b/i,
    /\b(?:fetch\s+and\s+clean|fetch|get|show|list|trash|delete|remove|move)\s+(?:(?:and\s+)?clean\s+)?(?:emails?\s+)?(?:for\s+)?(?:the\s+)?(?:whole\s+)?(?:year\s+)?(20\d{2})\b/i,
    /\b(?:whole|full|entire)\s+year\s+(20\d{2})\b/i,
    /\b(?:clean\s*up|cleanup|fetch\s+and\s+clean)\s+(20\d{2})\s+emails?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const year = parseInt(match[1], 10);
    if (year < 1970 || year > 2100) continue;
    return {
      since: `${year}-01-01`,
      before: `${year + 1}-01-01`,
      label: `${year} (full year)`,
    };
  }
  return null;
}

function parseDateRangeFromMessage(message) {
  const monthRange = parseMonthRangeFromMessage(message);
  if (monthRange) return monthRange;

  const yearRange = parseYearRangeFromMessage(message);
  if (yearRange) return yearRange;

  const text = message || '';
  const RANGE_SEP = String.raw`\s*,?\s*`;
  const dateToken = String.raw`(?:[a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})`;
  const patterns = [
    new RegExp(String.raw`\bfrom\s+(${dateToken})${RANGE_SEP}(?:back\s+to|to)\s+(${dateToken})\b`, 'i'),
    new RegExp(String.raw`\bbetween\s+(${dateToken})${RANGE_SEP}and\s+(${dateToken})\b`, 'i'),
    new RegExp(String.raw`\b(?:emails?\s+)?(?:from\s+)?(${dateToken})${RANGE_SEP}(?:through|thru|until|to|-)\s+(${dateToken})\b`, 'i'),
    new RegExp(String.raw`\b(?:since|after)\s+(${dateToken})(?:${RANGE_SEP}(?:until|before|to|through)\s+(${dateToken}))?\b`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const d1 = parseAnyDateToken(match[1]);
    if (!d1) continue;
    if (!match[2]) {
      const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
      return { since: d1, before: tomorrow, label: `${d1} through today` };
    }
    const d2 = parseAnyDateToken(match[2]);
    if (!d2) continue;
    const since = d1 <= d2 ? d1 : d2;
    const end = d1 <= d2 ? d2 : d1;
    return {
      since,
      before: addDays(end, 1),
      label: `${since} through ${end}`,
    };
  }
  return null;
}

module.exports = {
  parseDateToken,
  parseNamedDateToken,
  parseAnyDateToken,
  parseYearRangeFromMessage,
  parseMonthRangeFromMessage,
  parseDateRangeFromMessage,
  hasExplicitMonthYear,
  addDays,
};
