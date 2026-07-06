'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { parseSenderFromMessage } = require('./emailSender');

const execFileAsync = promisify(execFile);

const MAX_MOVE_PER_REQUEST = 100;
const MOVE_BATCH_SIZE = 25;

const TRASH_WORDS = /\b(trash|bin|junk|spam)\b/i;

function wantsEmailMoveToFolder(message) {
  const text = message || '';
  if (TRASH_WORDS.test(text) && /\bmove\b/i.test(text)) return false;
  if (!/\bmove\b/i.test(text)) return false;
  if (/\bfolder\b/i.test(text)) return true;
  if (/\bfrom\b/i.test(text) && /\bto\b/i.test(text) && parseDestinationFolder(text)) return true;
  return false;
}

function parseDestinationFolder(message) {
  const text = message || '';
  const patterns = [
    /\b(?:to|into)\s+(?:the\s+)?["']?([A-Za-z0-9][A-Za-z0-9 _-]{0,40}?)["']?\s+folder\b/i,
    /\b(?:to|into)\s+folder\s+["']?([A-Za-z0-9][A-Za-z0-9 _-]{0,40}?)["']?\b/i,
    /\bmove\s+(?:all\s+)?(?:emails?\s+)?from\s+[^"'\n]+?\s+(?:to|into)\s+(?:the\s+)?["']?([A-Za-z0-9][A-Za-z0-9 _-]{0,40}?)["']?\s*$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const name = match[1].trim();
    if (TRASH_WORDS.test(name)) continue;
    return name;
  }
  return null;
}

function parseMoveSenderFromMessage(message) {
  const text = message || '';

  const emailInParens = text.match(/\(([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\)/i);
  if (emailInParens && /\bmove\b/i.test(text)) return emailInParens[1];

  const moveFrom = text.match(
    /\bmove\s+(?:all\s+)?(?:emails?\s+)?from\s+["']?([^"'\n]+?)["']?\s+(?:\([^)]+\)\s*)?(?:to|into)\s+/i,
  );
  if (moveFrom?.[1]) {
    let sender = moveFrom[1].trim();
    const emailInSender = sender.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
    if (emailInSender) return emailInSender[1];
    sender = sender.replace(/\s*\([^)]*@[^)]+\)\s*$/, '').trim();
    if (sender.length >= 2 && !/^\d{1,2}[\/\-]/.test(sender)) return sender;
  }

  const bareEmail = text.match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  if (bareEmail && /\bmove\b/i.test(text) && /\bfrom\b/i.test(text)) return bareEmail[1];

  return parseSenderFromMessage(message);
}

function resolveMoveUids(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  return messages
    .map((m) => Number(m.uid))
    .filter((uid) => Number.isFinite(uid))
    .slice(0, MAX_MOVE_PER_REQUEST);
}

async function runImapMove(imapScript, uids, destFolder) {
  const skillRoot = path.dirname(path.dirname(imapScript));
  const args = [imapScript, 'move', ...uids.map(String), '--to', destFolder];

  const { stdout, stderr } = await execFileAsync('node', args, {
    timeout: 120000,
    maxBuffer: 1024 * 1024,
    cwd: skillRoot,
    env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
  });

  if (stderr?.trim()) {
    console.error('[continuum-bridge] imap move stderr:', stderr.trim());
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return { success: true, uids, action: 'moved_to_folder', destination_mailbox: destFolder, raw: stdout.trim() };
  }
}

async function runImapMoveBatched(imapScript, uids, destFolder) {
  const chunks = [];
  for (let i = 0; i < uids.length; i += MOVE_BATCH_SIZE) {
    chunks.push(uids.slice(i, i + MOVE_BATCH_SIZE));
  }
  const results = [];
  for (const chunk of chunks) {
    results.push(await runImapMove(imapScript, chunk, destFolder));
  }
  return {
    success: results.every((r) => r.success !== false),
    uids,
    action: 'moved_to_folder',
    destination_mailbox: results[0]?.destination_mailbox || destFolder,
    count: uids.length,
    batches: chunks.length,
  };
}

function formatMoveResult(result, emails, movedUids, destFolder, sender) {
  const lines = movedUids.map((uid) => {
    const email = emails.find((item) => Number(item.uid) === Number(uid));
    if (!email) return `- UID ${uid}`;
    const from = email.from?.text || email.from || 'Unknown';
    const subject = email.subject || '(no subject)';
    return `- UID ${uid}: "${subject}" from ${from}`;
  });

  const dest = result?.destination_mailbox || destFolder;
  const parts = [
    `Moved ${movedUids.length} email(s) from ${sender || 'matched sender'} to folder "${dest}" via Yahoo IMAP:`,
  ];
  if (lines.length) parts.push(...lines);
  if (result?.batches > 1) {
    parts.push(`(Executed in ${result.batches} batch(es).)`);
  }
  return parts.join('\n');
}

async function maybeMoveEmailsToFolder(message, emails, imapScript, { enabled = false } = {}) {
  if (!enabled || !wantsEmailMoveToFolder(message) || !imapScript) {
    return { executed: false, summary: null, error: null, uids: [], destFolder: null, sender: null };
  }

  const destFolder = parseDestinationFolder(message);
  const sender = parseMoveSenderFromMessage(message);

  if (!destFolder) {
    return {
      executed: false,
      summary: null,
      error: 'Move requested but no destination folder found. Say: move all emails from Min Zhang to Min folder.',
      uids: [],
      destFolder: null,
      sender,
    };
  }

  if (!sender) {
    return {
      executed: false,
      summary: null,
      error: 'Move requested but no sender found. Say: move all emails from Min Zhang (njsgas@gmail.com) to Min folder.',
      uids: [],
      destFolder,
      sender: null,
    };
  }

  const uids = resolveMoveUids(emails);
  if (uids.length === 0) {
    return {
      executed: false,
      summary: null,
      error: `No emails from "${sender}" in the fetched inbox slice. Widen lookback (e.g. 365d) or raise Email Fetch Limit, then retry.`,
      uids: [],
      destFolder,
      sender,
    };
  }

  try {
    const result = await runImapMoveBatched(imapScript, uids, destFolder);
    return {
      executed: true,
      summary: formatMoveResult(result, emails, uids, destFolder, sender),
      error: null,
      uids,
      destFolder: result.destination_mailbox || destFolder,
      sender,
    };
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    const syncHint = /unknown command:\s*move/i.test(detail)
      ? ' Run on VPS: bash /tmp/continuum-mobile/integrations/continuum-bridge/sync-imap-skill.sh'
      : '';
    return {
      executed: false,
      summary: null,
      error: `Email move failed: ${detail}.${syncHint}`,
      uids,
      destFolder,
      sender,
    };
  }
}

module.exports = {
  MAX_MOVE_PER_REQUEST,
  wantsEmailMoveToFolder,
  parseDestinationFolder,
  parseMoveSenderFromMessage,
  resolveMoveUids,
  maybeMoveEmailsToFolder,
};
