'use strict';

const { parseYearRangeFromMessage } = require('./emailDateRange');
const { wantsEmailCleanup, countCleanupTargets } = require('./emailDelete');

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function wantsYearCleanup(message) {
  const text = String(message || '');
  if (!wantsEmailCleanup(text)) return false;
  return !!parseYearRangeFromMessage(text);
}

function monthCleanupMessage(monthName, year) {
  return `clean up ${monthName} ${year} emails`;
}

function parseTrashedCount(deleteResult) {
  if (!deleteResult?.executed) return 0;
  const header = deleteResult.summary?.split('\n')[0] || '';
  const m = header.match(/Moved to Trash\s+(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return Array.isArray(deleteResult.uids) ? deleteResult.uids.length : 0;
}

function mergeYearDeleteResults(a, b) {
  if (!a?.executed) return b || a;
  if (!b?.executed) return a;
  const totalTrashed = parseTrashedCount(a) + parseTrashedCount(b);
  return {
    executed: true,
    summary: `Moved to Trash ${totalTrashed} email(s) via Yahoo IMAP (whole-year cleanup).`,
    error: a.error || b.error || null,
    uids: [...(a.uids || []), ...(b.uids || [])],
    skippedUids: [...new Set([...(a.skippedUids || []), ...(b.skippedUids || [])])],
  };
}

function buildYearPrefilledSummary({ year, monthResults, deleteResult, totalMatched, totalLoaded, totalTrashed, totalCleanupTargets }) {
  const activeMonths = monthResults.filter((m) => m.matched > 0 || m.loaded > 0 || m.trashed > 0);
  const lines = [
    '[PREFILLED SUMMARY — your ENTIRE reply must be ONLY the text between these markers; copy verbatim]',
    '',
    `## ${year} Whole-Year Cleanup Summary`,
    '',
    `- **Months scanned:** 12`,
    `- **Total matched:** ${totalMatched}`,
    `- **Total loaded:** ${totalLoaded}`,
    `- **Cleanup targets found:** ${totalCleanupTargets}`,
    `- **Moved to Trash:** ${totalTrashed}`,
    '',
    '**By Month:**',
    ...MONTH_NAMES.map((name, idx) => {
      const row = monthResults[idx];
      if (!row || (row.matched === 0 && row.loaded === 0 && row.trashed === 0)) {
        return `- ${name} ${year}: 0 emails`;
      }
      const parts = [`${row.matched} matched`, `${row.loaded} loaded`];
      if (row.trashed > 0) parts.push(`${row.trashed} trashed`);
      return `- ${name} ${year}: ${parts.join(', ')}`;
    }),
  ];

  if (totalTrashed > 0 && deleteResult?.summary) {
    lines.push('', '**Cleanup Results:**', `- ${deleteResult.summary.split('\n')[0]}`);
  } else if (totalCleanupTargets > 0 && totalTrashed === 0) {
    lines.push(
      '',
      '**Cleanup:** Targets found but nothing trashed — check that **Allow move to Trash** is ON in app Setup.',
    );
  } else if (totalTrashed === 0) {
    lines.push(
      '',
      '**Cleanup:** Nothing trashed — no newsletter/promo targets found for this year.',
    );
  }

  if (activeMonths.length < 12 && totalMatched === 0) {
    lines.push('', `_No mail found in INBOX for ${year}._`);
  }

  lines.push('', '[/PREFILLED SUMMARY]');
  return lines.join('\n');
}

function buildYearScanBlock(year, totalMatched, totalLoaded) {
  return [
    '[MAILBOX SCAN — whole year]',
    `Date filter: ${year}-01-01 .. ${year + 1}-01-01 (${year} full year)`,
    `Matched: ${totalMatched}`,
    `Emails loaded: ${totalLoaded}`,
    'Mode: month-by-month scan (12 batches)',
    '[/MAILBOX SCAN]',
  ].join('\n');
}

/**
 * Run cleanup month-by-month for a full calendar year.
 * Lazy-requires fetchEmailContext to avoid circular module dependency at load time.
 */
async function runYearCleanup({ message, yearRange, payloadOptions = {}, onProgress = null }) {
  const year = parseInt(String(yearRange?.since || '').slice(0, 4), 10);
  if (!year || year < 1970) {
    throw new Error('Invalid year for whole-year cleanup.');
  }

  const { fetchEmailContext } = require('./emailContext');
  const monthResults = [];
  let totalMatched = 0;
  let totalLoaded = 0;
  let totalTrashed = 0;
  let totalCleanupTargets = 0;
  let mergedDelete = { executed: false, summary: null, error: null, uids: [], skippedUids: [] };
  let lastFetchOptions = null;
  let hadError = null;

  for (let i = 0; i < MONTH_NAMES.length; i += 1) {
    const monthName = MONTH_NAMES[i];
    const monthMessage = monthCleanupMessage(monthName, year);
    const stepLabel = `${monthName} ${year} (${i + 1}/12)`;

    if (onProgress) onProgress(`Whole-year cleanup: ${stepLabel}…`);

    const monthPayload = {
      ...payloadOptions,
      email_since: null,
      email_before: null,
      email_limit: null,
      email_offset: 0,
      history: [],
    };

    let monthProgress = null;
    const nestedProgress = onProgress
      ? (detail) => {
          if (!monthProgress || monthProgress !== detail) {
            monthProgress = detail;
            onProgress(`${stepLabel}: ${detail}`);
          }
        }
      : null;

    try {
      const result = await fetchEmailContext(monthMessage, monthPayload, nestedProgress);
      if (result.error) {
        hadError = result.error;
        monthResults.push({ month: monthName, matched: 0, loaded: 0, trashed: 0, cleanupTargets: 0, error: result.error });
        continue;
      }

      const matched = result.scanMeta?.matched ?? result.messages?.length ?? 0;
      const loaded = result.messages?.length ?? result.loadedCount ?? 0;
      const trashed = parseTrashedCount(result.deleteResult);
      const cleanupTargets = Array.isArray(result.messages) ? countCleanupTargets(result.messages) : 0;

      totalMatched += matched;
      totalLoaded += loaded;
      totalTrashed += trashed;
      totalCleanupTargets += cleanupTargets;
      lastFetchOptions = result.fetchOptions;

      if (result.deleteResult?.executed) {
        mergedDelete = mergeYearDeleteResults(mergedDelete, result.deleteResult);
      }

      monthResults.push({
        month: monthName,
        matched,
        loaded,
        trashed,
        cleanupTargets,
        error: null,
      });
    } catch (err) {
      hadError = err.message || String(err);
      monthResults.push({ month: monthName, matched: 0, loaded: 0, trashed: 0, cleanupTargets: 0, error: hadError });
    }
  }

  if (onProgress) onProgress('Whole-year cleanup: building summary…');

  const prefilled = buildYearPrefilledSummary({
    year,
    monthResults,
    deleteResult: mergedDelete,
    totalMatched,
    totalLoaded,
    totalTrashed,
    totalCleanupTargets,
  });

  const scanBlock = buildYearScanBlock(year, totalMatched, totalLoaded);
  const trashBlock = mergedDelete.executed && mergedDelete.summary
    ? ['[Email cleanup executed — moved to Trash]', mergedDelete.summary].join('\n')
    : null;

  const context = [scanBlock, prefilled, trashBlock].filter(Boolean).join('\n\n');

  return {
    matched: true,
    context,
    error: hadError && totalMatched === 0 && totalTrashed === 0 ? hadError : null,
    fetchOptions: {
      ...(lastFetchOptions || {}),
      since: yearRange.since,
      before: yearRange.before,
      dateRangeLabel: yearRange.label || `${year} (full year)`,
      limit: totalLoaded,
    },
    scanMeta: {
      matched: totalMatched,
      scanned: totalLoaded,
      scanMode: 'year_monthly',
      months: monthResults,
    },
    loadedCount: totalLoaded,
    messages: [],
    deleteResult: mergedDelete.executed ? mergedDelete : { executed: false, summary: null, error: null, uids: [], skippedUids: [] },
    moveResult: { executed: false, summary: null, error: null, uids: [], destFolder: null, sender: null },
    yearCleanup: true,
  };
}

module.exports = {
  wantsYearCleanup,
  runYearCleanup,
  MONTH_NAMES,
};
