'use strict';

const { parseYearRangeFromMessage, addDays } = require('./emailDateRange');
const { wantsEmailCleanup, countCleanupTargets } = require('./emailDelete');
const { MONTH_RANGE_MIN_LIMIT } = require('./emailFetchOptions');

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

function monthWeekRanges(year, monthIndex) {
  const month = monthIndex + 1;
  const since = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12
    ? { y: year + 1, m: 1 }
    : { y: year, m: month + 1 };
  const monthEnd = `${nextMonth.y}-${String(nextMonth.m).padStart(2, '0')}-01`;
  const weeks = [];
  let cursor = since;
  while (cursor < monthEnd) {
    const next = addDays(cursor, 7);
    const before = next >= monthEnd ? monthEnd : next;
    weeks.push({ since: cursor, before });
    cursor = before;
  }
  return weeks;
}

function mergeMonthScanResults(accum, result) {
  if (!result || result.error) return accum;
  const matched = result.scanMeta?.matched ?? result.messages?.length ?? 0;
  const loaded = result.messages?.length ?? result.loadedCount ?? 0;
  const trashed = parseTrashedCount(result.deleteResult);
  const cleanupTargets = Array.isArray(result.messages) ? countCleanupTargets(result.messages) : 0;
  accum.matched += matched;
  accum.loaded += loaded;
  accum.trashed += trashed;
  accum.cleanupTargets += cleanupTargets;
  accum.lastFetchOptions = result.fetchOptions || accum.lastFetchOptions;
  if (result.deleteResult?.executed) {
    accum.mergedDelete = mergeYearDeleteResults(accum.mergedDelete, result.deleteResult);
  }
  return accum;
}

function weekRangeLabel(week) {
  const end = addDays(week.before, -1);
  return week.since === end ? week.since : `${week.since} .. ${end}`;
}

async function runMonthCleanup({
  monthName,
  year,
  monthIndex,
  stepLabel,
  payloadOptions,
  fetchEmailContext,
  onProgress,
}) {
  const weeks = monthWeekRanges(year, monthIndex);
  const monthMessage = monthCleanupMessage(monthName, year);
  const accum = {
    matched: 0,
    loaded: 0,
    trashed: 0,
    cleanupTargets: 0,
    mergedDelete: { executed: false, summary: null, error: null, uids: [], skippedUids: [] },
    lastFetchOptions: null,
    error: null,
  };

  for (let w = 0; w < weeks.length; w += 1) {
    const { assertJobActive } = require('./emailJobCancel');
    assertJobActive(payloadOptions._cancel_job_id);

    const week = weeks[w];
    const weekLabel = weeks.length > 1 ? `${stepLabel} week ${w + 1}/${weeks.length}` : stepLabel;
    const rangeLabel = weekRangeLabel(week);
    if (onProgress) onProgress(`${weekLabel}: scanning ${rangeLabel}…`);

    const weekPayload = {
      ...payloadOptions,
      email_since: week.since,
      email_before: week.before,
      email_limit: MONTH_RANGE_MIN_LIMIT,
      email_offset: 0,
      email_date_override: true,
      year_cleanup_month: true,
      history: [],
    };

    try {
      const result = await fetchEmailContext(monthMessage, weekPayload, null);
      if (result.error) {
        accum.error = result.error;
        if (onProgress) onProgress(`${weekLabel}: error — ${result.error}`);
        continue;
      }

      const weekMatched = result.scanMeta?.matched ?? result.messages?.length ?? 0;
      const weekLoaded = result.messages?.length ?? result.loadedCount ?? 0;
      if (onProgress) {
        onProgress(`${weekLabel}: done — ${weekMatched} matched, ${weekLoaded} loaded`);
      }
      mergeMonthScanResults(accum, result);
    } catch (err) {
      if (err.code === 'EMAIL_JOB_CANCELLED') throw err;
      accum.error = err.message || String(err);
    }
  }

  return accum;
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
    'Mode: month-by-month scan with weekly slices (12 batches)',
    '[/MAILBOX SCAN]',
  ].join('\n');
}

function normalizeYearCheckpoint(checkpoint, year) {
  if (!checkpoint || parseInt(String(checkpoint.year || year), 10) !== year) return null;
  const startIndex = Math.min(
    Math.max(parseInt(checkpoint.completedMonthIndex, 10) || 0, 0),
    MONTH_NAMES.length,
  );
  return {
    startIndex,
    monthResults: Array.isArray(checkpoint.monthResults) ? checkpoint.monthResults.slice(0, MONTH_NAMES.length) : [],
    totalMatched: parseInt(checkpoint.totalMatched, 10) || 0,
    totalLoaded: parseInt(checkpoint.totalLoaded, 10) || 0,
    totalTrashed: parseInt(checkpoint.totalTrashed, 10) || 0,
    totalCleanupTargets: parseInt(checkpoint.totalCleanupTargets, 10) || 0,
    mergedDelete: checkpoint.mergedDelete || { executed: false, summary: null, error: null, uids: [], skippedUids: [] },
    hadError: checkpoint.hadError || null,
    lastFetchOptions: checkpoint.lastFetchOptions || null,
  };
}

function buildYearCheckpoint({
  year,
  completedMonthIndex,
  monthResults,
  totalMatched,
  totalLoaded,
  totalTrashed,
  totalCleanupTargets,
  mergedDelete,
  hadError,
  lastFetchOptions,
}) {
  return {
    year,
    completedMonthIndex,
    monthResults,
    totalMatched,
    totalLoaded,
    totalTrashed,
    totalCleanupTargets,
    mergedDelete,
    hadError,
    lastFetchOptions,
  };
}

/**
 * Run cleanup month-by-month for a full calendar year.
 * Lazy-requires fetchEmailContext to avoid circular module dependency at load time.
 * Optional checkpoint resumes after server restart (skips completed months).
 */
async function runYearCleanup({
  message,
  yearRange,
  payloadOptions = {},
  onProgress = null,
  checkpoint = null,
  onCheckpoint = null,
}) {
  const year = parseInt(String(yearRange?.since || '').slice(0, 4), 10);
  if (!year || year < 1970) {
    throw new Error('Invalid year for whole-year cleanup.');
  }

  const { fetchEmailContext } = require('./emailContext');
  const restored = normalizeYearCheckpoint(checkpoint, year);
  const monthResults = restored?.monthResults ? [...restored.monthResults] : [];
  let totalMatched = restored?.totalMatched || 0;
  let totalLoaded = restored?.totalLoaded || 0;
  let totalTrashed = restored?.totalTrashed || 0;
  let totalCleanupTargets = restored?.totalCleanupTargets || 0;
  let mergedDelete = restored?.mergedDelete || { executed: false, summary: null, error: null, uids: [], skippedUids: [] };
  let lastFetchOptions = restored?.lastFetchOptions || null;
  let hadError = restored?.hadError || null;
  const startIndex = restored?.startIndex || 0;

  if (startIndex > 0 && onProgress) {
    onProgress(`Resuming whole-year cleanup from ${MONTH_NAMES[startIndex]} ${year} (${startIndex + 1}/12)…`);
  }

  for (let i = startIndex; i < MONTH_NAMES.length; i += 1) {
    const { assertJobActive } = require('./emailJobCancel');
    assertJobActive(payloadOptions._cancel_job_id);

    const monthName = MONTH_NAMES[i];
    const stepLabel = `${monthName} ${year} (${i + 1}/12)`;

    try {
      const monthScan = await runMonthCleanup({
        monthName,
        year,
        monthIndex: i,
        stepLabel,
        payloadOptions,
        fetchEmailContext,
        onProgress,
      });

      if (monthScan.error && monthScan.matched === 0 && monthScan.loaded === 0) {
        hadError = monthScan.error;
      }

      totalMatched += monthScan.matched;
      totalLoaded += monthScan.loaded;
      totalTrashed += monthScan.trashed;
      totalCleanupTargets += monthScan.cleanupTargets;
      lastFetchOptions = monthScan.lastFetchOptions || lastFetchOptions;
      if (monthScan.mergedDelete?.executed) {
        mergedDelete = mergeYearDeleteResults(mergedDelete, monthScan.mergedDelete);
      }

      monthResults.push({
        month: monthName,
        matched: monthScan.matched,
        loaded: monthScan.loaded,
        trashed: monthScan.trashed,
        cleanupTargets: monthScan.cleanupTargets,
        error: monthScan.error && monthScan.matched === 0 ? monthScan.error : null,
      });

      if (onProgress) {
        onProgress(
          `${stepLabel}: month done — ${monthScan.matched} matched, ${monthScan.loaded} loaded, ${monthScan.trashed} trashed`,
        );
      }
    } catch (err) {
      if (err.code === 'EMAIL_JOB_CANCELLED') throw err;
      hadError = err.message || String(err);
      monthResults.push({ month: monthName, matched: 0, loaded: 0, trashed: 0, cleanupTargets: 0, error: hadError });
    }

    if (onCheckpoint) {
      onCheckpoint(buildYearCheckpoint({
        year,
        completedMonthIndex: i + 1,
        monthResults,
        totalMatched,
        totalLoaded,
        totalTrashed,
        totalCleanupTargets,
        mergedDelete,
        hadError,
        lastFetchOptions,
      }));
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
  buildYearCheckpoint,
  normalizeYearCheckpoint,
  MONTH_NAMES,
};
