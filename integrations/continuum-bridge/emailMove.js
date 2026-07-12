'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { parseSenderFromMessage } = require('./emailSender');
const { parseMailboxFromMessage } = require('./emailFolderParse');
const { hasBulkActionConfirm } = require('./emailPermission');

const execFileAsync = promisify(execFile);

const MAX_MOVE_PER_REQUEST = 100;
const MAX_COPY_FOLDER_PER_REQUEST = 5000;
const MOVE_BATCH_SIZE = 25;

const TRASH_WORDS = /\b(trash|bin|junk|spam)\b/i;

function wantsEmailMoveToFolder(message) {
  const text = message || '';
  if (wantsEmailCopyFolderToInbox(text)) return false;
  if (TRASH_WORDS.test(text) && /\bmove\b/i.test(text)) return false;
  if (!/\bmove\b/i.test(text)) return false;
  if (/\bfolder\b/i.test(text)) return true;
  if (/\bfrom\b/i.test(text) && /\bto\b/i.test(text) && parseDestinationFolder(text)) return true;
  return false;
}

function wantsEmailCopyFolderToInbox(message) {
  const text = message || '';
  if (!/\bcopy\b/i.test(text)) return false;
  if (!/\bfolder\b/i.test(text)) return false;
  if (!/\b(?:to|into)\s+(?:the\s+)?inbox\b/i.test(text)) return false;
  return !!parseSourceFolderFromMessage(text);
}

function parseSourceFolderFromMessage(message) {
  return parseMailboxFromMessage(message);
}

function parseCopyDestMailbox(message) {
  const text = message || '';
  if (/\b(?:to|into)\s+(?:the\s+)?inbox\b/i.test(text)) return 'INBOX';
  return 'INBOX';
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

async function runImapCopy(imapScript, uids, destFolder, sourceMailbox = null) {
  const skillRoot = path.dirname(path.dirname(imapScript));
  const args = [imapScript, 'copy', ...uids.map(String), '--to', destFolder];
  if (sourceMailbox) args.push('--mailbox', sourceMailbox);

  const { stdout, stderr } = await execFileAsync('node', args, {
    timeout: 120000,
    maxBuffer: 1024 * 1024,
    cwd: skillRoot,
    env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
  });

  if (stderr?.trim()) {
    console.error('[continuum-bridge] imap copy stderr:', stderr.trim());
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return { success: true, uids, action: 'copied_to_folder', destination_mailbox: destFolder, raw: stdout.trim() };
  }
}

async function runImapCopyBatched(imapScript, uids, destFolder, sourceMailbox = null) {
  const chunks = [];
  for (let i = 0; i < uids.length; i += MOVE_BATCH_SIZE) {
    chunks.push(uids.slice(i, i + MOVE_BATCH_SIZE));
  }
  const results = [];
  for (const chunk of chunks) {
    results.push(await runImapCopy(imapScript, chunk, destFolder, sourceMailbox));
  }
  return {
    success: results.every((r) => r.success !== false),
    uids,
    action: 'copied_to_folder',
    destination_mailbox: results[0]?.destination_mailbox || destFolder,
    count: uids.length,
    batches: chunks.length,
  };
}

async function runImapListUids(imapScript, mailbox, { limit = null, offset = 0 } = {}) {
  const skillRoot = path.dirname(path.dirname(imapScript));
  const args = [imapScript, 'list-uids', '--mailbox', mailbox];
  if (limit != null) args.push('--limit', String(limit));
  if (offset) args.push('--offset', String(offset));

  const { stdout, stderr } = await execFileAsync('node', args, {
    timeout: 120000,
    maxBuffer: 1024 * 1024,
    cwd: skillRoot,
    env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
  });

  if (stderr?.trim()) {
    console.error('[continuum-bridge] imap list-uids stderr:', stderr.trim());
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return { success: true, uids: [], total: 0, mailbox, raw: stdout.trim() };
  }
}

async function runImapCopyAll(imapScript, sourceFolder, destFolder, { limit = null, offset = 0 } = {}) {
  const skillRoot = path.dirname(path.dirname(imapScript));
  const args = [imapScript, 'copy-all', '--mailbox', sourceFolder, '--to', destFolder];
  if (limit != null) args.push('--limit', String(limit));
  if (offset) args.push('--offset', String(offset));

  const { stdout, stderr } = await execFileAsync('node', args, {
    timeout: 300000,
    maxBuffer: 1024 * 1024,
    cwd: skillRoot,
    env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
  });

  if (stderr?.trim()) {
    console.error('[continuum-bridge] imap copy-all stderr:', stderr.trim());
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return {
      success: true,
      action: 'copied_to_folder',
      source_mailbox: sourceFolder,
      destination_mailbox: destFolder,
      raw: stdout.trim(),
    };
  }
}

function formatCopyFolderPermissionBlock({ total, sourceFolder, destFolder, limit }) {
  return [
    `[Permission required — no emails copied from "${sourceFolder}" yet]`,
    `${total} email(s) in folder "${sourceFolder}" — the current cap is ${limit} per run.`,
    'Originals stay in the source folder; copies go to INBOX.',
    `Reply "yes proceed" or "confirm" to copy up to ${Math.min(total, MAX_COPY_FOLDER_PER_REQUEST)} email(s),`,
    `or say "copy all emails in ${sourceFolder} folder to inbox limit 500".`,
  ].join('\n');
}

function formatCopyFolderResult(result, sourceFolder, destFolder) {
  const count = result?.count ?? result?.uids?.length ?? 0;
  const total = result?.total ?? count;
  const source = result?.source_mailbox || sourceFolder;
  const dest = result?.destination_mailbox || destFolder;
  const parts = [
    `Copied ${count} email(s) from folder "${source}" to "${dest}" via Yahoo IMAP (originals remain in "${source}").`,
  ];
  if (total > count) {
    parts.push(`${total - count} email(s) remain in "${source}" — send another copy request or reply "yes proceed" to copy more.`);
  }
  if (result?.batches > 1) {
    parts.push(`(Executed in ${result.batches} batch(es).)`);
  }
  return parts.join('\n');
}

async function maybeCopyFolderToInbox(message, imapScript, { enabled = false, onProgress = null } = {}) {
  if (!enabled || !wantsEmailCopyFolderToInbox(message) || !imapScript) {
    return {
      executed: false,
      summary: null,
      error: null,
      uids: [],
      sourceFolder: null,
      destFolder: null,
      needsPermission: false,
      total: 0,
    };
  }

  const sourceFolder = parseSourceFolderFromMessage(message);
  const destFolder = parseCopyDestMailbox(message);

  if (!sourceFolder) {
    return {
      executed: false,
      summary: null,
      error: 'Copy requested but no source folder found. Say: copy all emails in Min folder to inbox.',
      uids: [],
      sourceFolder: null,
      destFolder,
      needsPermission: false,
      total: 0,
    };
  }

  try {
    const { parseLimitFromMessage } = require('./emailFetchOptions');
    const limitFromMessage = parseLimitFromMessage(message);
    const listResult = await runImapListUids(imapScript, sourceFolder);
    const total = listResult.total ?? listResult.uids?.length ?? 0;

    if (total === 0) {
      return {
        executed: false,
        summary: null,
        error: `No emails in folder "${sourceFolder}".`,
        uids: [],
        sourceFolder,
        destFolder,
        needsPermission: false,
        total: 0,
      };
    }

    const confirmed = hasBulkActionConfirm(message);
    let copyLimit = limitFromMessage != null
      ? Math.min(limitFromMessage, total)
      : (confirmed ? Math.min(total, MAX_COPY_FOLDER_PER_REQUEST) : Math.min(total, MAX_MOVE_PER_REQUEST));

    if (!confirmed && limitFromMessage == null && total > MAX_MOVE_PER_REQUEST) {
      return {
        executed: false,
        summary: formatCopyFolderPermissionBlock({
          total,
          sourceFolder,
          destFolder,
          limit: MAX_MOVE_PER_REQUEST,
        }),
        error: null,
        uids: [],
        sourceFolder,
        destFolder,
        needsPermission: true,
        total,
      };
    }

    if (onProgress) {
      onProgress(`Copying ${copyLimit} email(s) from "${sourceFolder}" to ${destFolder}…`);
    }

    const result = await runImapCopyAll(imapScript, sourceFolder, destFolder, { limit: copyLimit });
    return {
      executed: true,
      summary: formatCopyFolderResult(result, sourceFolder, destFolder),
      error: null,
      uids: result.uids || [],
      sourceFolder: result.source_mailbox || sourceFolder,
      destFolder: result.destination_mailbox || destFolder,
      needsPermission: false,
      total,
    };
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    const syncHint = /unknown command:\s*copy-all/i.test(detail)
      ? ' Run on VPS: bash /tmp/continuum-mobile/integrations/continuum-bridge/sync-imap-skill.sh'
      : '';
    return {
      executed: false,
      summary: null,
      error: `Email copy failed: ${detail}.${syncHint}`,
      uids: [],
      sourceFolder,
      destFolder,
      needsPermission: false,
      total: 0,
    };
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
  MAX_COPY_FOLDER_PER_REQUEST,
  wantsEmailMoveToFolder,
  wantsEmailCopyFolderToInbox,
  parseDestinationFolder,
  parseSourceFolderFromMessage,
  parseCopyDestMailbox,
  parseMoveSenderFromMessage,
  resolveMoveUids,
  maybeMoveEmailsToFolder,
  maybeCopyFolderToInbox,
  runImapMoveBatched,
  runImapCopyBatched,
  runImapCopyAll,
  runImapListUids,
};
