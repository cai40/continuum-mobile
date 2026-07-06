'use strict';

const { wantsEmailCleanup, resolveCleanupUids, MAX_DELETE_PER_REQUEST } = require('./emailDelete');
const { wantsEmailMoveToFolder } = require('./emailMove');

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
  const cleanupTargets = isCleanup ? resolveCleanupUids(messages).length : 0;

  const overRange = totalMatched > limit;
  const overFetchCap = fetchedCount >= limit && totalMatched > fetchedCount;
  const overActionCap = (isCleanup || isMove) && fetchedCount >= MAX_DELETE_PER_REQUEST
    && (isCleanup ? cleanupTargets > MAX_DELETE_PER_REQUEST : fetchedCount >= MAX_DELETE_PER_REQUEST);

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
};
