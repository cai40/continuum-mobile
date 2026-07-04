'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { selectJunkUids, triageMessages } = require('./emailTriage');

const execFileAsync = promisify(execFile);

const MAX_DELETE_PER_REQUEST = 100;
const DELETE_BATCH_SIZE = 25;

const DELETE_INTENT = /\b(delete|remove|trash|purge|discard|move\s+(?:them|these|those|it|all)?\s*(?:to\s+)?(?:trash|bin)|clear\s+(?:out|my)?\s*(?:inbox|mail|junk))\b/i;
const DELETE_BLOCKED = /\b(don'?t|do not|never|without|not)\s+(delete|remove|trash|purge|move\s+.*\s+trash)\b/i;
const JUNK_INTENT = /\b(junk|spam|promo(?:tional)?|marketing|newsletter|selectable)\b/i;
const CATEGORY_DELETE = /\bcategor(?:y|ies)\s*#?\s*\d|github\s*\/?\s*cursor|cursor\[bot\]|automated\s+cursor|promotions?\s*(?:&|and)\s*newsletters?\b/i;

function wantsEmailDelete(message) {
  const text = message || '';
  if (DELETE_BLOCKED.test(text)) return false;
  if (DELETE_INTENT.test(text)) return true;
  if (/\bmove\b/i.test(text) && /\b(trash|bin)\b/i.test(text)) return true;
  if (JUNK_INTENT.test(text) && /\b(trash|delete|remove|move|clear)\b/i.test(text)) return true;
  if (CATEGORY_DELETE.test(text) && /\b(trash|delete|remove|move)\b/i.test(text)) return true;
  return false;
}

function isGithubCursorRow(row) {
  return /github|cursor\[bot\]|cursor\s*bot/i.test(`${row.from} ${row.subject}`);
}

function parseRequestedCategoryNumbers(text) {
  const cats = new Set();
  const raw = String(text || '');

  const listMatch = raw.match(/\bcategor(?:y|ies)\s*(?:#?\s*)?([\d\s,and&–\-]+(?:\d+\s*(?:-|–|to|through)\s*\d+)?[\d\s,and&]*)/i);
  if (listMatch) {
    const chunk = listMatch[1];
    const range = chunk.match(/(\d+)\s*(?:-|–|to|through)\s*(\d+)/i);
    if (range) {
      const lo = Math.min(parseInt(range[1], 10), parseInt(range[2], 10));
      const hi = Math.max(parseInt(range[1], 10), parseInt(range[2], 10));
      for (let i = lo; i <= hi; i += 1) {
        if (i >= 1 && i <= 6) cats.add(i);
      }
    }
    for (const num of chunk.match(/\d+/g) || []) {
      const n = parseInt(num, 10);
      if (n >= 1 && n <= 6) cats.add(n);
    }
  }

  if (cats.size === 0) {
    if (/github\s*\/?\s*cursor|cursor\[bot\]|cursor\s*bot|automated\s+cursor|github\s+notifications?/i.test(raw)) {
      cats.add(1);
    }
    if (/promotions?\s*(?:&|and)\s*newsletters?|\bnewsletters?\s*(?:&|and)\s*promotions?/i.test(raw)) {
      cats.add(6);
    }
  }

  return cats;
}

function rowBlob(row) {
  return `${row.from} ${row.subject}`.toLowerCase();
}

function matchesSummaryCategory(row, catNum) {
  if (row.uid == null) return false;
  if (row.category === 'protected') return false;

  const blob = rowBlob(row);

  switch (catNum) {
    case 1:
      return isGithubCursorRow(row) && row.selectable_as_junk;
    case 2:
      return false;
    case 3:
      return row.selectable_as_junk
        && (row.category === 'newsletter' || row.category === 'spam')
        && !isGithubCursorRow(row);
    case 4:
      return /smtp|connection test|test email from the imap|imap\/smtp email skill/i.test(blob);
    case 5:
      if (/hertz.*reservation|reservation confirmation|national grid|ezdrive|peak demand|account statement|direct deposit|e-?statement|one.?time passcode|verification code/i.test(blob)) {
        return false;
      }
      return /sixt|promotional rental|auto insurance promotion|\$29\/month|reprocessed quote|home insurance options|nucar|service reminder|trugreen|renewal by andersen|flybussen|password reset|email verification link|automotive insurance info/i.test(blob)
        && (row.selectable_as_junk || /promo|promotion|deal|sale|offer/i.test(blob));
    case 6:
      return row.selectable_as_junk && (row.category === 'newsletter' || row.category === 'spam');
    default:
      return false;
  }
}

function resolveCategoryDeleteUids(text, emails) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const uids = new Set();
  const triaged = triageMessages(emails);
  const requested = parseRequestedCategoryNumbers(text);

  for (const row of triaged) {
    for (const cat of requested) {
      if (matchesSummaryCategory(row, cat)) {
        uids.add(Number(row.uid));
        break;
      }
    }
  }

  return Array.from(uids);
}

function filterToFetchedUids(candidateUids, emails) {
  const fetched = new Set(emails.map((e) => Number(e.uid)).filter(Number.isFinite));
  return candidateUids.filter((uid) => fetched.has(Number(uid)));
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

function parseExplicitUids(message) {
  const uids = new Set();
  const text = message || '';

  for (const match of text.matchAll(/\buids?\s*[:#]?\s*([\d,\s]+)/gi)) {
    for (const num of match[1].matchAll(/\d{4,}/g)) {
      uids.add(parseInt(num[0], 10));
    }
  }

  for (const match of text.matchAll(/\buid\s*[:#]?\s*(\d+)/gi)) {
    uids.add(parseInt(match[1], 10));
  }

  return Array.from(uids);
}

function resolveDeleteUids(message, emails) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const text = message || '';
  const uids = new Set();

  for (const uid of parseExplicitUids(text)) {
    uids.add(uid);
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

  if (JUNK_INTENT.test(text) && (DELETE_INTENT.test(text) || /\b(trash|move)\b/i.test(text))) {
    const includeGithub = !/\b(keep|exclude|without|no)\s+github\b/i.test(text);
    const { uids: junkUids } = selectJunkUids(emails, { includeGithub });
    for (const uid of junkUids) uids.add(uid);
  }

  if (CATEGORY_DELETE.test(text)) {
    for (const uid of resolveCategoryDeleteUids(text, emails)) uids.add(uid);
  }

  if (/\bdelete\s+(all|every)\b/i.test(text) && uids.size === 0) {
    for (const email of emails) {
      if (email?.uid) uids.add(Number(email.uid));
    }
  }

  const candidates = Array.from(uids).filter((uid) => Number.isFinite(uid));
  const verified = filterToFetchedUids(candidates, emails);
  return verified.slice(0, MAX_DELETE_PER_REQUEST);
}

async function runImapDelete(imapScript, uids) {
  const skillRoot = path.dirname(path.dirname(imapScript));
  const args = [imapScript, 'delete', ...uids.map(String)];

  const { stdout, stderr } = await execFileAsync('node', args, {
    timeout: 120000,
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

async function runImapDeleteBatched(imapScript, uids) {
  const chunks = [];
  for (let i = 0; i < uids.length; i += DELETE_BATCH_SIZE) {
    chunks.push(uids.slice(i, i + DELETE_BATCH_SIZE));
  }
  const results = [];
  for (const chunk of chunks) {
    results.push(await runImapDelete(imapScript, chunk));
  }
  return {
    success: results.every((r) => r.success !== false),
    uids,
    action: 'moved_to_trash',
    count: uids.length,
    batches: chunks.length,
  };
}

function formatDeleteResult(result, emails, deletedUids, skippedUids = []) {
  const lines = deletedUids.map((uid) => {
    const email = emails.find((item) => Number(item.uid) === Number(uid));
    if (!email) return `- UID ${uid}`;
    const from = email.from?.text || email.from || 'Unknown';
    const subject = email.subject || '(no subject)';
    return `- UID ${uid}: "${subject}" from ${from}`;
  });

  const action = result?.action === 'moved_to_trash' ? 'Moved to Trash' : 'Deleted';
  const parts = [`${action} ${deletedUids.length} email(s) via Yahoo IMAP:`];
  if (lines.length) parts.push(...lines);
  if (skippedUids.length) {
    parts.push(`Skipped ${skippedUids.length} UID(s) not in the fetched inbox (may be invalid or already removed): ${skippedUids.slice(0, 10).join(', ')}${skippedUids.length > 10 ? '...' : ''}`);
  }
  if (result?.batches > 1) {
    parts.push(`(Executed in ${result.batches} batch(es).)`);
  }
  return parts.join('\n');
}

async function maybeDeleteEmails(message, emails, imapScript, { enabled = false } = {}) {
  if (!enabled || !wantsEmailDelete(message) || !imapScript) {
    return { executed: false, summary: null, error: null, uids: [], skippedUids: [] };
  }

  const requestedUids = parseExplicitUids(message);
  const uids = resolveDeleteUids(message, emails);
  const fetchedSet = new Set(emails.map((e) => Number(e.uid)));
  const skippedUids = requestedUids.filter((uid) => !fetchedSet.has(uid));

  if (uids.length === 0) {
    const hint = /\bcategor/i.test(message)
      ? 'Supported summary categories: 1=GitHub/Cursor bots, 4=SMTP self-tests only, 5=travel/auto/home promos, 6=newsletters/promos. Categories 2–3 (career/finance/real estate) and protected mail (banks, DocuSign, Hetzner OTP) are never auto-deleted. Try "move category 6 to trash" or list explicit UIDs.'
      : JUNK_INTENT.test(message)
        ? 'No junk/spam matches in the fetched inbox slice. Try a higher Email Fetch Limit or say "delete email 1, 2, 3".'
        : 'Use "delete email 1", "delete uid 12345" (must be in fetched list), "move category 6 to trash", or "delete junk to trash".';
    return {
      executed: false,
      summary: null,
      error: `Delete requested but no matching fetched emails. ${hint}`,
      uids: [],
      skippedUids,
    };
  }

  try {
    const result = await runImapDeleteBatched(imapScript, uids);
    return {
      executed: true,
      summary: formatDeleteResult(result, emails, uids, skippedUids),
      error: null,
      uids,
      skippedUids,
    };
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    const syncHint = /unknown command:\s*delete/i.test(detail)
      ? ' Run on VPS: bash /tmp/continuum-mobile/integrations/continuum-bridge/sync-imap-skill.sh'
      : '';
    return {
      executed: false,
      summary: null,
      error: `Email delete failed: ${detail}.${syncHint}`,
      uids,
      skippedUids,
    };
  }
}

module.exports = {
  MAX_DELETE_PER_REQUEST,
  wantsEmailDelete,
  resolveDeleteUids,
  parseExplicitUids,
  maybeDeleteEmails,
};
