'use strict';

const { wantsEmailCleanup, MAX_DELETE_PER_REQUEST, CLEANUP_DELETE_MAX, countCleanupTargets } = require('./emailDelete');
const { wantsEmailMoveToFolder } = require('./emailMove');

/** Bulk confirm hint threshold in permission messages (fetch-and-clean bypasses target count). */
const PERMISSION_CLEANUP_THRESHOLD = 10000;

const BULK_CONFIRM = /\b(yes|yeah|yep|confirm|confirmed|proceed|go ahead|do it|approved|approve|clean all|trash all|delete all matching|move all)\b/i;

function hasBulkActionConfirm(message) {
  return BULK_CONFIRM.test(message || '');
}

function formatPermissionBlock({ totalMatched, cleanupTargets, limit, dateRangeLabel, isCleanup, isMove, destFolder }) {
  const action = isMove ? 'move' : (isCleanup ? 'move to Trash (clean up)' : 'move to Trash');
  const lines = [
    isMove
      ? `[Permission required — no emails moved to "${destFolder || 'folder'}" yet]`
      : '[Permission required — no emails moved to Trash yet]',
    `${totalMatched} email(s) match this request but the current limit is ${limit}.`,
  ];
  if (isCleanup && cleanupTargets > 0 && cleanupTargets !== totalMatched) {
    lines.push(`${cleanupTargets} of the fetched batch are cleanup targets (news, promos, dev mail, bank statements).`);
  }
  if (cleanupTargets >= PERMISSION_CLEANUP_THRESHOLD) {
    lines.push(`Each confirmed run can move up to ${CLEANUP_DELETE_MAX} messages.`);
  } else if (cleanupTargets > MAX_DELETE_PER_REQUEST) {
    lines.push(`Each run can move up to ${CLEANUP_DELETE_MAX} messages (no confirm under ${PERMISSION_CLEANUP_THRESHOLD} targets).`);
  }
  if (isCleanup && cleanupTargets >= PERMISSION_CLEANUP_THRESHOLD) {
    lines.push(`${cleanupTargets} cleanup targets — confirm required at ${PERMISSION_CLEANUP_THRESHOLD}+.`);
  }
  lines.push(
    `Reply "yes proceed" or "confirm" to ${action} matching mail in batches,`,
    `or raise the limit (e.g. "${isMove ? 'move' : (isCleanup ? 'clean up' : 'fetch')}${dateRangeLabel ? ` ${dateRangeLabel}` : ''} limit 500").`,
  );
  return lines.join('\n');
}

function evaluateOverLimitPermission({
  message,
  fetchOptions,
  scanMeta,
  messages,
  deleteRequested,
  moveRequested,
  destFolder,
}) {
  const actionRequested = deleteRequested || moveRequested;
  if (!actionRequested || hasBulkActionConfirm(message)) return null;

  const limit = fetchOptions?.limit || 100;
  const fetchedCount = messages?.length || 0;
  const totalMatched = scanMeta?.matched ?? fetchedCount;
  const isCleanup = wantsEmailCleanup(message);
  const isMove = !!moveRequested;
  const cleanupTargets = isCleanup ? countCleanupTargets(messages) : 0;

  // Inbox cleanups run without a separate confirm — "fetch and clean" is already consent.
  // Target count alone never blocks cleanup (only fetch/range caps below).

  const overRange = totalMatched > limit;
  const overFetchCap = fetchedCount >= limit && totalMatched > fetchedCount;
  const overActionCap = isMove && fetchedCount >= MAX_DELETE_PER_REQUEST;

  if (!overRange && !overFetchCap && !overActionCap) return null;

  return {
    totalMatched,
    cleanupTargets: isMove ? fetchedCount : cleanupTargets,
    limit,
    dateRangeLabel: fetchOptions?.dateRangeLabel || null,
    isCleanup,
    isMove,
    destFolder,
  };
}

/** Trash cap for this request (10000 for cleanups, else 100). */
function resolveDeleteCap({ message, messages, permission }) {
  if (!wantsEmailCleanup(message)) return MAX_DELETE_PER_REQUEST;
  const targets = countCleanupTargets(messages);
  if (!permission && targets > 0) {
    return Math.min(CLEANUP_DELETE_MAX, targets);
  }
  if (!permission && hasBulkActionConfirm(message) && targets > 0) {
    return Math.min(CLEANUP_DELETE_MAX, targets);
  }
  return MAX_DELETE_PER_REQUEST;
}

module.exports = {
  hasBulkActionConfirm,
  evaluateOverLimitPermission,
  formatPermissionBlock,
  resolveDeleteCap,
  MAX_DELETE_PER_REQUEST,
  PERMISSION_CLEANUP_THRESHOLD,
  CLEANUP_DELETE_MAX,
};
