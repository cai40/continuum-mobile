'use strict';

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolveEmailFetchOptions, MAX_LIMIT } = require('./emailFetchOptions');
const { maybeDeleteEmails, wantsEmailDelete } = require('./emailDelete');

const execFileAsync = promisify(execFile);

const EMAIL_KEYWORDS = /\b(email|inbox|yahoo|mail|unread|smtp|imap|delete|remove|trash)\b/i;

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
    return { text: rawStdout.trim().slice(0, 12000), messages: [] };
  }
  if (!Array.isArray(parsed)) {
    return { text: rawStdout.trim().slice(0, 12000), messages: [] };
  }
  if (parsed.length === 0) {
    return { text: 'No messages found in INBOX for the requested period.', messages: [], fetchedCount: 0 };
  }

  const maxChars = Math.min(80000, Math.max(10000, limit * 450));
  const uids = parsed.map((msg) => msg.uid).filter((uid) => uid != null);
  const uidList = uids.join(', ');
  const fetchedCount = parsed.length;
  const shortfall = limit > fetchedCount
    ? `\nNOTE: Requested up to ${limit} emails but only ${fetchedCount} exist in INBOX for this lookback period. Do NOT invent the missing ${limit - fetchedCount}.`
    : '';

  const header = [
    `Fetched ${fetchedCount} REAL email(s) from Yahoo IMAP (requested limit ${limit}, max ${MAX_LIMIT} per request).`,
    uids.length ? `Valid UIDs ONLY: ${uidList}` : null,
    'ANTI-HALLUCINATION: Summarize ONLY the emails listed below. NEVER invent, simulate, reconstruct, or guess emails, UIDs, senders, or subjects not in this list.',
    shortfall || null,
    '',
  ].filter(Boolean).join('\n');

  const body = parsed.map((msg, idx) => {
    const from = msg.from?.text || msg.from || msg.fromAddress || 'Unknown';
    const subject = msg.subject || '(no subject)';
    const date = msg.date || msg.receivedDate || msg.headerDate || '';
    const uid = msg.uid != null ? String(msg.uid) : '';
    const unread = Array.isArray(msg.flags) && !msg.flags.includes('\\Seen');
    const previewSource = msg.snippet || msg.text || msg.preview || msg.html || '';
    const preview = stripHtml(previewSource).slice(0, 220);
    return [
      `--- Email ${idx + 1}${unread ? ' (unread)' : ''} ---`,
      uid ? `UID: ${uid}` : null,
      `From: ${from}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      preview ? `Preview: ${preview}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return { text: (header + body).slice(0, maxChars), messages: parsed, fetchedCount };
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
  const formatted = formatEmailMessages(stdout, fetchOptions.limit);
  return {
    context: formatted.text,
    messages: formatted.messages,
    fetchOptions,
  };
}

async function fetchEmailContext(message, payloadOptions = {}) {
  const deleteRequested = wantsEmailDelete(message);
  if (!EMAIL_KEYWORDS.test(message || '') && !deleteRequested) {
    return { matched: false, context: null, error: null, fetchOptions: null, deleteResult: null };
  }

  const imapScript = findImapScript();
  if (!imapScript) {
    return {
      matched: true,
      context: null,
      error: 'Yahoo IMAP skill not installed on VPS. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh',
      fetchOptions: null,
      deleteResult: null,
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
      deleteResult: null,
    };
  }

  if (deleteRequested && !payloadOptions.email_delete_enabled) {
    return {
      matched: true,
      context: null,
      error: 'Email delete is disabled in the app. Setup → OpenClaw Gateway → turn on "Allow email delete", Save, then try again.',
      fetchOptions: null,
      deleteResult: null,
    };
  }

  try {
    const { context, messages, fetchOptions } = await runImapCheck(imapScript, message, payloadOptions);
    const deleteResult = await maybeDeleteEmails(message, messages, imapScript, {
      enabled: !!payloadOptions.email_delete_enabled,
    });

    let finalContext = context;
    if (deleteResult.executed && deleteResult.summary) {
      finalContext = [context, '', '[Email delete executed]', deleteResult.summary].join('\n');
    } else if (deleteResult.error) {
      finalContext = [context, '', `[Email delete] ${deleteResult.error}`].filter(Boolean).join('\n');
    }

    return {
      matched: true,
      context: finalContext,
      error: null,
      fetchOptions,
      deleteResult,
    };
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    return {
      matched: true,
      context: null,
      error: `Yahoo IMAP failed: ${detail}. Check app password at ~/.config/mail-skills/.env`,
      fetchOptions: null,
      deleteResult: null,
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
    return { ready: true, config: configPath, max_limit: MAX_LIMIT, delete_supported: true };
  } catch (err) {
    return { ready: false, reason: err.message || String(err) };
  }
}

module.exports = { fetchEmailContext, getEmailHealth, findImapScript };
