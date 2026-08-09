'use strict';

/**
 * Mail client for Continuum — wraps the IMAP/SMTP skill scripts and Continuum
 * memory ingest so the app can browse, read, and reply to email like a mail app.
 *
 * Exposes:
 *   listMailboxes()                — folders from Yahoo IMAP
 *   listEmails({folder, limit, offset}) — headers/snippets (newest first)
 *   fetchEmail(uid, folder)        — full message (marks as read)
 *   markRead(uids, folder)         — mark as read
 *   sendEmail({to, cc, subject, body, inReplyTo}) — via SMTP
 *   ingestEmailIntoMemory(email, authToken, apiUrl) — feed one email to Continuum
 *
 * Every script call runs as `node <skill>/scripts/<tool>.js ...` and parses JSON.
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// ---- Simple TTL cache -------------------------------------------------
const cacheStore = new Map();
const CACHE_TTL = {
  folders: 5 * 60 * 1000, // 5 min
  list: 60 * 1000, // 60s
  email: 10 * 60 * 1000, // 10 min
};
const CACHE_MAX_ENTRIES = 300;

// Serialize IMAP/SMTP child-process calls so only one heavy child runs at a
// time. Render's small instances OOM when several node children (imap list +
// smtp send + ingest) run concurrently — this caps peak memory.
let scriptQueue = Promise.resolve();
function enqueueScript(run) {
  const next = scriptQueue.then(run, run);
  scriptQueue = next.catch(() => {});
  return next;
}

function cacheKey(prefix, parts) {
  return `${prefix}:${(parts || []).map((p) => String(p ?? '')).join('|')}`;
}

function cacheGet(key) {
  const entry = cacheStore.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > entry.ttl) {
    cacheStore.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value, ttl, { version = null } = {}) {
  cacheStore.set(key, { value, at: Date.now(), ttl, version });
  if (cacheStore.size > CACHE_MAX_ENTRIES) {
    const oldest = [...cacheStore.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, cacheStore.size - CACHE_MAX_ENTRIES);
    for (const [k] of oldest) cacheStore.delete(k);
  }
}

function cacheBustPrefix(prefix) {
  for (const key of cacheStore.keys()) {
    if (key.startsWith(`${prefix}:`)) cacheStore.delete(key);
  }
}

function findImapScript() {
  if (process.env.IMAP_SCRIPT && fs.existsSync(process.env.IMAP_SCRIPT)) {
    return process.env.IMAP_SCRIPT;
  }
  const home = process.env.HOME || '/root';
  const candidates = [
    '/tmp/continuum-mobile/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js',
    path.join(home, '.openclaw/workspace/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js'),
    path.join(home, '.openclaw/workspace/skills/imap-smtp-email/scripts/imap.js'),
  ];
  return candidates.find((p) => {
    try {
      fs.accessSync(p);
      const skillRoot = path.dirname(path.dirname(p));
      return fs.existsSync(path.join(skillRoot, 'node_modules', 'imap'));
    } catch {
      return false;
    }
  }) || candidates.find((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

function findSmtpScript(imapScript) {
  if (!imapScript) return null;
  return path.join(path.dirname(path.dirname(imapScript)), 'scripts', 'smtp.js');
}

function skillEnv(scriptPath) {
  const skillRoot = path.dirname(path.dirname(scriptPath));
  return { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') };
}

async function runScript(scriptPath, args, { timeoutMs = 120000, maxBuffer = 16 * 1024 * 1024, input = null } = {}) {
  // Run through the serial queue to keep only one child process alive at a time.
  return enqueueScript(() => runScriptNow(scriptPath, args, { timeoutMs, maxBuffer, input }));
}

async function runScriptNow(scriptPath, args, { timeoutMs = 120000, maxBuffer = 16 * 1024 * 1024, input = null } = {}) {
  let stdout;
  let stderr = '';
  try {
    const result = await execFileAsync('node', [scriptPath, ...args], {
      timeout: timeoutMs,
      maxBuffer,
      input: input == null ? undefined : String(input),
      cwd: path.dirname(path.dirname(scriptPath)),
      env: skillEnv(scriptPath),
    });
    stdout = result.stdout;
    stderr = result.stderr || '';
  } catch (err) {
    const childErr = (err && (err.stderr || err.stdout)) || '';
    const detail = String(childErr || err?.message || 'Unknown script error').trim().slice(0, 500);
    console.error(`[continuum-bridge] ${path.basename(scriptPath)} ${args[0] || ''} failed:`, detail);
    throw new Error(detail || `Script ${path.basename(scriptPath)} failed.`);
  }
  if (stderr && String(stderr).trim()) {
    console.error(`[continuum-bridge] ${path.basename(scriptPath)} ${args[0] || ''} stderr:`, String(stderr).trim().slice(0, 500));
  }
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmailRow(row) {
  return {
    uid: row?.uid != null ? Number(row.uid) : null,
    from: row?.from || row?.fromAddress || 'Unknown',
    subject: row?.subject || '(no subject)',
    date: row?.date || row?.headerDate || null,
    headerDate: row?.headerDate || null,
    flags: row?.flags || [],
    snippet: row?.snippet || stripHtml(row?.text || row?.html || '').slice(0, 220),
  };
}

async function listMailboxes() {
  const key = cacheKey('folders');
  const cached = cacheGet(key);
  if (cached) return cached;
  const imap = findImapScript();
  if (!imap) throw new Error('Yahoo IMAP skill not installed on VPS. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh');
  const result = await runScript(imap, ['list-mailboxes']);
  const folders = Array.isArray(result) ? result : [];
  cacheSet(key, folders, CACHE_TTL.folders);
  return folders;
}

async function listEmails({ folder = 'INBOX', limit = 50, offset = 0 } = {}) {
  const key = cacheKey('list', [folder, limit, offset]);
  const cached = cacheGet(key);
  if (cached) return cached;
  const imap = findImapScript();
  if (!imap) throw new Error('Yahoo IMAP skill not installed on VPS. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh');
  // Use the fast seqno-window `list` command (no full-mailbox SEARCH ALL).
  const args = ['list', '--mailbox', folder, '--limit', String(limit), '--offset', String(offset)];
  const rows = await runScript(imap, args, { timeoutMs: 120000 });
  if (!Array.isArray(rows)) return [];
  const normalized = rows.map(normalizeEmailRow);
  cacheSet(key, normalized, CACHE_TTL.list);
  return normalized;
}

async function fetchEmail(uid, folder = 'INBOX') {
  const key = cacheKey('email', [folder, uid]);
  const cached = cacheGet(key);
  if (cached) return cached;
  const imap = findImapScript();
  if (!imap) throw new Error('Yahoo IMAP skill not installed on VPS. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh');
  const args = ['fetch', String(uid), '--mailbox', folder];
  const result = await runScript(imap, args, { timeoutMs: 45000 });
  if (!result || result.uid == null) throw new Error('Email not found.');
  const email = {
    uid: Number(result.uid),
    from: result.from || 'Unknown',
    to: result.to || '',
    cc: result.cc || '',
    subject: result.subject || '(no subject)',
    date: result.date || result.headerDate || null,
    headerDate: result.headerDate || null,
    flags: result.flags || [],
    text: result.text || '',
    html: result.html || '',
    snippet: result.snippet || stripHtml(result.text || result.html || '').slice(0, 220),
    attachments: Array.isArray(result.attachments)
      ? result.attachments.map((a) => ({
        filename: a?.filename,
        contentType: a?.contentType,
        size: a?.size,
      }))
      : [],
  };
  cacheSet(key, email, CACHE_TTL.email);
  return email;
}

async function markRead(uids, folder = 'INBOX') {
  const imap = findImapScript();
  if (!imap) throw new Error('Yahoo IMAP skill not installed on VPS.');
  const list = (Array.isArray(uids) ? uids : [uids]).map(String);
  if (!list.length) return { success: true, uids: [] };
  const result = await runScript(imap, ['mark-read', ...list, '--mailbox', folder], { timeoutMs: 120000 });
  // Invalidate list + email caches for this folder so read state refreshes.
  cacheBustPrefix('list');
  for (const uid of list) cacheStore.delete(cacheKey('email', [folder, uid]));
  return result || { success: true, uids: list };
}

async function deleteEmails(uids, folder = 'INBOX') {
  const imap = findImapScript();
  if (!imap) throw new Error('Yahoo IMAP skill not installed on VPS.');
  const list = (Array.isArray(uids) ? uids : [uids]).map(String);
  if (!list.length) return { success: true, uids: [] };
  // `delete` moves to Yahoo Trash (recoverable), matching the cleanup flow.
  const result = await runScript(imap, ['delete', ...list, '--mailbox', folder], { timeoutMs: 180000 });
  // Invalidate list + email caches for this folder so deleted mail disappears.
  cacheBustPrefix('list');
  for (const uid of list) cacheStore.delete(cacheKey('email', [folder, uid]));
  return result || { success: true, uids: list, action: 'moved_to_trash' };
}

async function sendEmail({ to, cc = null, subject, body } = {}) {
  const imap = findImapScript();
  const smtp = findSmtpScript(imap);
  if (!smtp || !fs.existsSync(smtp)) {
    throw new Error('SMTP skill not installed. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh');
  }
  if (!to || !subject || !body) throw new Error('To, subject, and body are required.');

  // Pass the body via stdin (--body-stdin) so long reply bodies with lines like
  // "-- something" can never be misread as CLI flags, and to avoid a giant argv.
  const args = ['send', '--to', to, '--subject', subject, '--body-stdin'];
  if (cc) args.push('--cc', cc);
  return runScript(smtp, args, { timeoutMs: 120000, input: body });
}

/**
 * Feed one email into Continuum memory. Uses the app's bearer token so the
 * ingest writes to the correct user's memory vault via the backend /chat.
 */
async function ingestEmailIntoMemory(email, authToken, apiUrl) {
  if (!email || !authToken) return { executed: false, reply: null };
  const textBody = stripHtml(email.text || email.html || email.snippet || '');
  const prompt = [
    `REAL email from ${email.from || 'Unknown'} (${email.date || 'date unknown'}).`,
    `Subject: ${email.subject || '(no subject)'}`,
    '',
    textBody.slice(0, 6000),
    '',
    '---',
    'Extract any durable facts, commitments, dates, names, and relationship context from this email and store them in Continuum memory. Reply with a short confirmation of what was remembered.',
  ].join('\n');

  const form = new FormData();
  form.append('message', prompt);
  form.append('provider', 'gemini');
  form.append('history', '[]');

  const res = await fetch(`${String(apiUrl || '').replace(/\/$/, '')}/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Memory ingest failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => null);
  return {
    executed: true,
    reply: data?.reply || data?.response || data?.content || data?.message || 'Saved to memory.',
  };
}

module.exports = {
  findImapScript,
  findSmtpScript,
  listMailboxes,
  listEmails,
  fetchEmail,
  markRead,
  deleteEmails,
  sendEmail,
  ingestEmailIntoMemory,
  normalizeEmailRow,
  stripHtml,
};
