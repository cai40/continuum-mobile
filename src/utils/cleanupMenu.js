/** Shared date ranges and chat messages for email / photo cleanup menus. */

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function usDateFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

/** Calendar week starting Sunday (local time). */
function startOfCalendarWeek(date) {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

/**
 * @param {'today'|'week'|'month'|'custom_month'} period
 * @param {{ month?: number, year?: number }} [opts]
 */
export function getCleanupRange(period, opts = {}) {
  const now = new Date();

  if (period === 'today') {
    const start = startOfDay(now);
    const end = addDays(start, 1);
    return {
      period,
      label: 'Today',
      since: toISODate(start),
      before: toISODate(end),
      createdAfter: start.getTime(),
      createdBefore: end.getTime(),
    };
  }

  if (period === 'week') {
    const start = startOfCalendarWeek(now);
    const end = addDays(start, 7);
    return {
      period,
      label: 'This week',
      since: toISODate(start),
      before: toISODate(end),
      createdAfter: start.getTime(),
      createdBefore: end.getTime(),
    };
  }

  if (period === 'month') {
    const year = now.getFullYear();
    const monthIndex = now.getMonth();
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);
    return {
      period,
      label: `${MONTH_NAMES[monthIndex]} ${year}`,
      monthName: MONTH_NAMES[monthIndex],
      year,
      month: monthIndex + 1,
      since: toISODate(start),
      before: toISODate(end),
      createdAfter: start.getTime(),
      createdBefore: end.getTime(),
    };
  }

  if (period === 'custom_month') {
    const year = opts.year;
    const month = opts.month;
    if (!year || !month || month < 1 || month > 12) return null;
    const monthIndex = month - 1;
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);
    return {
      period,
      label: `${MONTH_NAMES[monthIndex]} ${year}`,
      monthName: MONTH_NAMES[monthIndex],
      year,
      month,
      since: toISODate(start),
      before: toISODate(end),
      createdAfter: start.getTime(),
      createdBefore: end.getTime(),
    };
  }

  return null;
}

/** @param {ReturnType<typeof getCleanupRange>} range */
export function buildEmailCleanupPreviewMessage(range) {
  if (!range) return 'preview email cleanup inbox';
  if (range.period === 'today') return 'preview email cleanup for today';
  if (range.period === 'week') {
    const endInclusive = usDateFromISO(toISODate(addDays(new Date(`${range.before}T12:00:00`), -1)));
    return `preview email cleanup from ${usDateFromISO(range.since)} to ${endInclusive}`;
  }
  return `preview email cleanup for ${range.monthName} ${range.year}`;
}

/** @param {ReturnType<typeof getCleanupRange>} range */
export function buildEmailCleanupApplyMessage(range) {
  return buildEmailCleanupMessage(range);
}

/** @param {ReturnType<typeof getCleanupRange>} range */
export function buildEmailCleanupMessage(range) {
  if (!range) return 'clean up inbox';
  if (range.period === 'today') return 'clean up today emails';
  if (range.period === 'week') {
    const endInclusive = usDateFromISO(toISODate(addDays(new Date(`${range.before}T12:00:00`), -1)));
    return `clean up emails from ${usDateFromISO(range.since)} to ${endInclusive}`;
  }
  return `clean up ${range.monthName} ${range.year} emails`;
}

/** @param {ReturnType<typeof getCleanupRange>} range */
export function buildPhotoCleanupMessage(range, { apply = false } = {}) {
  if (!range) return apply ? 'apply photo cleanup' : 'preview photo cleanup';
  const prefix = apply ? 'apply photo cleanup' : 'preview photo cleanup';
  if (range.period === 'today') return `${prefix} for today`;
  if (range.period === 'week') return `${prefix} for this week`;
  return `${prefix} for ${range.monthName} ${range.year}`;
}

export function listSelectableMonths(count = 24) {
  const items = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    items.push({
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return items;
}

const MONTH_NAME_PATTERN = MONTH_NAMES.join('|');

/** Parse photo cleanup time range from a chat message. */
export function parsePhotoCleanupRangeFromMessage(message) {
  const text = String(message || '');

  if (/\b(?:for|during)\s+today\b/i.test(text) || /\btoday'?s?\s+photos?\b/i.test(text)) {
    return getCleanupRange('today');
  }
  if (/\b(?:for|during)\s+this\s+week\b/i.test(text) || /\bthis\s+week'?s?\s+photos?\b/i.test(text)) {
    return getCleanupRange('week');
  }

  const monthYear = text.match(new RegExp(`\\b(?:for|during|in)\\s+(${MONTH_NAME_PATTERN})\\s+(20\\d{2})\\b`, 'i'));
  if (monthYear) {
    const monthIndex = MONTH_NAMES.findIndex((m) => m.toLowerCase() === monthYear[1].toLowerCase());
    if (monthIndex >= 0) {
      return getCleanupRange('custom_month', { month: monthIndex + 1, year: parseInt(monthYear[2], 10) });
    }
  }

  const dateRange = text.match(
    /\bfrom\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(?:to|through|until|-)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i,
  );
  if (dateRange) {
    const parse = (raw) => {
      const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (!m) return null;
      let yyyy = m[3];
      if (yyyy.length === 2) yyyy = `20${yyyy}`;
      return new Date(parseInt(yyyy, 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    };
    const d1 = parse(dateRange[1]);
    const d2 = parse(dateRange[2]);
    if (d1 && d2) {
      const start = d1 <= d2 ? d1 : d2;
      const end = addDays(d1 <= d2 ? d2 : d1, 1);
      return {
        period: 'custom_range',
        label: 'Custom range',
        since: toISODate(start),
        before: toISODate(end),
        createdAfter: startOfDay(start).getTime(),
        createdBefore: end.getTime(),
      };
    }
  }

  return null;
}
