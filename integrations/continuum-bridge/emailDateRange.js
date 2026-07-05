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

const RANGE_SEP = String.raw`\s*,?\s*`;

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
      label: `${year} (full year)`,
    };
  }
  return null;
}

function parseDateRangeFromMessage(message) {
  const yearRange = parseYearRangeFromMessage(message);
  if (yearRange) return yearRange;

  const text = message || '';
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
  parseDateRangeFromMessage,
  addDays,
};
