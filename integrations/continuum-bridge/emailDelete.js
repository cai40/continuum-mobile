'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MAX_DELETE_PER_REQUEST = 25;

const DELETE_INTENT = /\b(delete|remove|trash|purge|discard)\b/i;
const DELETE_BLOCKED = /\b(don'?t|do not|never|without|not)\s+(delete|remove|trash|purge)\b/i;

function wantsEmailDelete(message) {
  const text = message || '';
  if (DELETE_BLOCKED.test(text)) return false;
  return DELETE_INTENT.test(text);
}

function parseIndexList(raw) {
  const values = new Set();
  const chunks = String(raw || '').split(/,|\band\b/i);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    const single = trimmed.match(/^(\d{1,3})$/);
    if (single) {
      values.add(parseInt(single[1], 10));
      continue;
    }
    const range = trimmed.match(/^(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})$/i);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = parseInt(range[2], 10);
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let i = lo; i <= hi; i += 1) values.add(i);
    }
  }
  return Array.from(values);
}

function resolveDeleteUids(message, emails) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const text = message || '';
  const uids = new Set();

  for (const match of text.matchAll(/\buid\s*[:#]?\s*(\d+)\b/gi)) {
    uids.add(parseInt(match[1], 10));
  }

  for (const match of text.matchAll(/\b(?:email|message|mail)\s*#?\s*(\d+(?:\s*(?:,|and)\s*\d+|\s*-\s*\d+)*)/gi)) {
    for (const idx of parseIndexList(match[1])) {
      const email = emails[idx - 1];
      if (email?.uid) uids.add(Number(email.uid));
    }
  }

  const rangeMatch = text.match(/\b(?:emails?|messages?)\s*(\d+)\s*(?:-|–|to)\s*(\d+)/i);
  if (rangeMatch) {
    for (const idx of parseIndexList(`${rangeMatch[1]}-${rangeMatch[2]}`)) {
      const email = emails[idx - 1];
      if (email?.uid) uids.add(Number(email.uid));
    }
  }

  const fromMatch = text.match(/\b(?:from|sender)\s+["']?([^"'\n,]+?)["']?(?:\s|$|,|\.)/i);
  if (fromMatch) {
    const needle = fromMatch[1].trim().toLowerCase();
    for (const email of emails) {
      const from = String(email.from?.text || email.from || '').toLowerCase();
      if (from.includes(needle)) uids.add(Number(email.uid));
    }
  }

  const subjectMatch = text.match(/\bsubject\s+(?:contains\s+)?["']?([^"'\n]+?)["']?(?:\s|$|,|\.)/i);
  if (subjectMatch) {
    const needle = subjectMatch[1].trim().toLowerCase();
    for (const email of emails) {
      const subject = String(email.subject || '').toLowerCase();
      if (subject.includes(needle)) uids.add(Number(email.uid));
    }
  }

  if (/\bdelete\s+(all\s+)?unread\b/i.test(text)) {
    for (const email of emails) {
      const unread = Array.isArray(email.flags) && !email.flags.includes('\\Seen');
      if (unread) uids.add(Number(email.uid));
    }
  }

  if (/\bdelete\s+(all|every)\b/i.test(text) && uids.size === 0) {
    for (const email of emails) {
      if (email?.uid) uids.add(Number(email.uid));
    }
  }

  return Array.from(uids).filter((uid) => Number.isFinite(uid)).slice(0, MAX_DELETE_PER_REQUEST);
}

async function runImapDelete(imapScript, uids) {
  const skillRoot = path.dirname(path.dirname(imapScript));
  const args = [imapScript, 'delete', ...uids.map(String)];

  const { stdout, stderr } = await execFileAsync('node', args, {
    timeout: 60000,
    maxBuffer: 1024 * 1024,
    cwd: skillRoot,
    env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
  });

  if (stderr?.trim()) {
    console.error('[continuum-bridge] imap delete stderr:', stderr.trim());
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return { success: true, uids, action: 'deleted', raw: stdout.trim() };
  }
}

function formatDeleteResult(result, emails, deletedUids) {
  const deletedSet = new Set(deletedUids.map(Number));
  const lines = deletedUids.map((uid) => {
    const email = emails.find((item) => Number(item.uid) === Number(uid));
    if (!email) return `- UID ${uid}`;
    const from = email.from?.text || email.from || 'Unknown';
    const subject = email.subject || '(no subject)';
    return `- UID ${uid}: "${subject}" from ${from}`;
  });

  const header = result?.success
    ? `Deleted ${deletedUids.length} email(s):`
    : `Delete attempted for ${deletedUids.length} email(s):`;

  return [header, ...lines].join('\n');
}

async function maybeDeleteEmails(message, emails, imapScript, { enabled = false } = {}) {
  if (!enabled || !wantsEmailDelete(message) || !imapScript) {
    return { executed: false, summary: null, error: null, uids: [] };
  }

  const uids = resolveDeleteUids(message, emails);
  if (uids.length === 0) {
    return {
      executed: false,
      summary: null,
      error: 'Delete requested but no matching emails found. Use "delete email 1", "delete uid 12345", "delete from spam@...", or "delete subject Newsletter".',
      uids: [],
    };
  }

  try {
    const result = await runImapDelete(imapScript, uids);
    return {
      executed: true,
      summary: formatDeleteResult(result, emails, uids),
      error: null,
      uids,
    };
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    return {
      executed: false,
      summary: null,
      error: `Email delete failed: ${detail}`,
      uids,
    };
  }
}

module.exports = {
  MAX_DELETE_PER_REQUEST,
  wantsEmailDelete,
  resolveDeleteUids,
  maybeDeleteEmails,
};
