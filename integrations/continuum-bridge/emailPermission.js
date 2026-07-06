'use strict';

const { wantsEmailCleanup, MAX_DELETE_PER_REQUEST, countCleanupTargets } = require('./emailDelete');
const { wantsEmailMoveToFolder } = require('./emailMove');

/** Cleanup runs without "yes proceed" when fewer than this many trash targets. */
const PERMISSION_CLEANUP_THRESHOLD = 500;

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
  if (cleanupTargets > MAX_DELETE_PER_REQUEST) {
    lines.push(`Each run can move at most ${MAX_DELETE_PER_REQUEST} messages per batch.`);
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

  // Inbox cleanups under 500 targets run immediately (still max 100 per path per batch).
  if (isCleanup && cleanupTargets > 0 && cleanupTargets < PERMISSION_CLEANUP_THRESHOLD) {
    return null;
  }

  const overRange = totalMatched > limit;
  const overFetchCap = fetchedCount >= limit && totalMatched > fetchedCount;
  const overActionCap = (isCleanup || isMove) && fetchedCount >= MAX_DELETE_PER_REQUEST
    && (isCleanup
      ? cleanupTargets >= PERMISSION_CLEANUP_THRESHOLD
      : fetchedCount >= MAX_DELETE_PER_REQUEST);

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

module.exports = {
  hasBulkActionConfirm,
  evaluateOverLimitPermission,
  formatPermissionBlock,
  MAX_DELETE_PER_REQUEST,
  PERMISSION_CLEANUP_THRESHOLD,
};
