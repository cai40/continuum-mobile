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

async function runScript(scriptPath, args, { timeoutMs = 120000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  const { stdout } = await execFileAsync('node', [scriptPath, ...args], {
    timeout: timeoutMs,
    maxBuffer,
    cwd: path.dirname(path.dirname(scriptPath)),
    env: skillEnv(scriptPath),
  });
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
  const imap = findImapScript();
  if (!imap) throw new Error('Yahoo IMAP skill not installed on VPS. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh');
  const result = await runScript(imap, ['list-mailboxes']);
  return Array.isArray(result) ? result : [];
}

async function listEmails({ folder = 'INBOX', limit = 50, offset = 0 } = {}) {
  const imap = findImapScript();
  if (!imap) throw new Error('Yahoo IMAP skill not installed on VPS. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh');
  const args = ['check', '--mailbox', folder, '--limit', String(limit), '--offset', String(offset), '--lite'];
  const rows = await runScript(imap, args, { timeoutMs: 180000 });
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeEmailRow);
}

async function fetchEmail(uid, folder = 'INBOX') {
  const imap = findImapScript();
  if (!imap) throw new Error('Yahoo IMAP skill not installed on VPS. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh');
  const args = ['fetch', String(uid), '--mailbox', folder];
  const result = await runScript(imap, args, { timeoutMs: 120000 });
  if (!result || result.uid == null) throw new Error('Email not found.');
  return {
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
}

async function markRead(uids, folder = 'INBOX') {
  const imap = findImapScript();
  if (!imap) throw new Error('Yahoo IMAP skill not installed on VPS.');
  const list = (Array.isArray(uids) ? uids : [uids]).map(String);
  if (!list.length) return { success: true, uids: [] };
  const result = await runScript(imap, ['mark-read', ...list, '--mailbox', folder], { timeoutMs: 120000 });
  return result || { success: true, uids: list };
}

async function sendEmail({ to, cc = null, subject, body } = {}) {
  const imap = findImapScript();
  const smtp = findSmtpScript(imap);
  if (!smtp || !fs.existsSync(smtp)) {
    throw new Error('SMTP skill not installed. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh');
  }
  if (!to || !subject || !body) throw new Error('To, subject, and body are required.');

  const args = ['send', '--to', to, '--subject', subject, '--body', body];
  if (cc) args.push('--cc', cc);
  return runScript(smtp, args, { timeoutMs: 120000 });
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
  sendEmail,
  ingestEmailIntoMemory,
  normalizeEmailRow,
  stripHtml,
};
