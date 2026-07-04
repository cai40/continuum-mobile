'use strict';

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolveEmailFetchOptions, MAX_LIMIT } = require('./emailFetchOptions');

const execFileAsync = promisify(execFile);

const EMAIL_KEYWORDS = /\b(email|inbox|yahoo|mail|unread|smtp|imap)\b/i;

function findImapScript() {
  const home = process.env.HOME || '/root';
  const candidates = [
    path.join(home, '.openclaw/workspace/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js'),
    path.join(home, '.openclaw/workspace/skills/imap-smtp-email/scripts/imap.js'),
    '/tmp/continuum-mobile/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js',
  ];
  return candidates.find((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatEmailMessages(rawStdout, limit) {
  let parsed;
  try {
    parsed = JSON.parse(rawStdout);
  } catch {
    return rawStdout.trim().slice(0, 12000);
  }
  if (!Array.isArray(parsed)) return rawStdout.trim().slice(0, 12000);
  if (parsed.length === 0) return 'No messages found in INBOX for the requested period.';

  const maxChars = Math.min(50000, Math.max(10000, limit * 450));
  const header = `Fetched ${parsed.length} email(s) (limit ${limit}, max ${MAX_LIMIT} per request):\n\n`;

  const body = parsed.map((msg, idx) => {
    const from = msg.from?.text || msg.from || msg.fromAddress || 'Unknown';
    const subject = msg.subject || '(no subject)';
    const date = msg.date || msg.receivedDate || msg.headerDate || '';
    const unread = Array.isArray(msg.flags) && !msg.flags.includes('\\Seen');
    const previewSource = msg.snippet || msg.text || msg.preview || msg.html || '';
    const preview = stripHtml(previewSource).slice(0, 220);
    return [
      `--- Email ${idx + 1}${unread ? ' (unread)' : ''} ---`,
      `From: ${from}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      preview ? `Preview: ${preview}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return (header + body).slice(0, maxChars);
}

function imapCheckArgs(fetchOptions) {
  const args = ['check', '--limit', String(fetchOptions.limit), '--recent', fetchOptions.recent];
  if (fetchOptions.unreadOnly) {
    args.push('--unseen');
  }
  return args;
}

async function runImapCheck(imapScript, message, payloadOptions = {}) {
  const fetchOptions = resolveEmailFetchOptions(message, payloadOptions);
  const skillRoot = path.dirname(path.dirname(imapScript));
  const args = [imapScript, ...imapCheckArgs(fetchOptions)];
  const timeoutMs = Math.min(180000, 60000 + fetchOptions.limit * 2500);

  const { stdout, stderr } = await execFileAsync(
    'node',
    args,
    {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      cwd: skillRoot,
      env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
    },
  );
  if (stderr?.trim()) {
    console.error('[continuum-bridge] imap stderr:', stderr.trim());
  }
  return {
    context: formatEmailMessages(stdout, fetchOptions.limit),
    fetchOptions,
  };
}

async function fetchEmailContext(message, payloadOptions = {}) {
  if (!EMAIL_KEYWORDS.test(message || '')) {
    return { matched: false, context: null, error: null, fetchOptions: null };
  }

  const imapScript = findImapScript();
  if (!imapScript) {
    return {
      matched: true,
      context: null,
      error: 'Yahoo IMAP skill not installed on VPS. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh',
      fetchOptions: null,
    };
  }

  const configPaths = [
    path.join(process.env.HOME || '/root', '.config/mail-skills/.env'),
    path.join(process.env.HOME || '/root', '.config/imap-smtp-email/.env'),
  ];
  const hasConfig = configPaths.some((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  });

  if (!hasConfig) {
    return {
      matched: true,
      context: null,
      error: 'Yahoo credentials missing. Run on VPS: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh',
      fetchOptions: null,
    };
  }

  try {
    const { context, fetchOptions } = await runImapCheck(imapScript, message, payloadOptions);
    return { matched: true, context, error: null, fetchOptions };
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    return {
      matched: true,
      context: null,
      error: `Yahoo IMAP failed: ${detail}. Check app password at ~/.config/mail-skills/.env`,
      fetchOptions: null,
    };
  }
}

async function getEmailHealth() {
  const imapScript = findImapScript();
  if (!imapScript) {
    return { ready: false, reason: 'imap skill not installed' };
  }
  const configPath = [
    path.join(process.env.HOME || '/root', '.config/mail-skills/.env'),
    path.join(process.env.HOME || '/root', '.config/imap-smtp-email/.env'),
  ].find((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!configPath) {
    return { ready: false, reason: 'mail config missing' };
  }
  try {
    await runImapCheck(imapScript, 'check inbox', { email_limit: 3, email_recent: '24h' });
    return { ready: true, config: configPath, max_limit: MAX_LIMIT };
  } catch (err) {
    return { ready: false, reason: err.message || String(err) };
  }
}

module.exports = { fetchEmailContext, getEmailHealth, findImapScript };
