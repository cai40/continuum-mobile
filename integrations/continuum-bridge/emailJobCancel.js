'use strict';

/** Tracks user-cancelled jobs and active IMAP child processes (kill on cancel). */
const cancelledIds = new Set();
const imapChildren = new Map();

function isJobCancelled(jobId) {
  if (!jobId) return false;
  return cancelledIds.has(String(jobId));
}

function markJobCancelled(jobId) {
  if (!jobId) return;
  cancelledIds.add(String(jobId));
  killImapChildren(jobId);
}

function clearJobCancelled(jobId) {
  if (!jobId) return;
  cancelledIds.delete(String(jobId));
  imapChildren.delete(String(jobId));
}

function killImapChildren(jobId) {
  const children = imapChildren.get(String(jobId));
  if (!children) return;
  for (const child of children) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

function registerImapChild(jobId, child) {
  if (!jobId || !child) return;
  const key = String(jobId);
  if (!imapChildren.has(key)) imapChildren.set(key, new Set());
  imapChildren.get(key).add(child);
  child.on('close', () => {
    imapChildren.get(key)?.delete(child);
  });
}

function assertJobActive(jobId) {
  if (!isJobCancelled(jobId)) return;
  const err = new Error('Email job cancelled by user.');
  err.code = 'EMAIL_JOB_CANCELLED';
  throw err;
}

module.exports = {
  isJobCancelled,
  markJobCancelled,
  clearJobCancelled,
  registerImapChild,
  assertJobActive,
};
