'use strict';

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

function parseDateRangeFromMessage(message) {
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
      return { since: d1, before: tomorrow, label: `${d1} through today` };
    }
    const d2 = parseDateToken(match[2]);
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
  parseDateRangeFromMessage,
  addDays,
};
