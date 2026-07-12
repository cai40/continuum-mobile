'use strict';

const { runImapCopyBatched } = require('./emailMove');

/** During inbox cleanup, copy matching senders to Yahoo folders (original stays in INBOX). */
const BUILTIN_CLEANUP_FOLDER = [
  {
    label: 'Min Zhang',
    folder: 'Min',
    copy: true,
    needles: ['min zhang', 'njsgas@gmail.com', 'min z <'],
  },
];

function emailBlob(email) {
  const from = email?.from?.text || email?.from || email?.fromAddress || '';
  const subject = email?.subject || '';
  return `${from} ${subject}`.toLowerCase();
}

function matchCleanupFolderRule(email) {
  const blob = emailBlob(email);
  for (const rule of BUILTIN_CLEANUP_FOLDER) {
    if (rule.needles.some((needle) => blob.includes(needle))) return rule;
  }
  return null;
}

function resolveCleanupFolderGroups(messages) {
  const byFolder = new Map();
  for (const msg of messages || []) {
    const uid = Number(msg?.uid);
    if (!Number.isFinite(uid)) continue;
    const rule = matchCleanupFolderRule(msg);
    if (!rule) continue;
    const key = rule.folder;
    if (!byFolder.has(key)) {
      byFolder.set(key, { rule, uids: [] });
    }
    byFolder.get(key).uids.push(uid);
  }
  return [...byFolder.values()];
}

function formatCleanupFolderPreview(groups) {
  if (!groups.length) return null;
  const lines = [
    '**Would copy to folder (cleanup rule; originals stay in INBOX):**',
    ...groups.map((g) => `- ${g.rule.label} → **${g.rule.folder}** folder (${g.uids.length} email(s))`),
  ];
  return lines.join('\n');
}

function formatCleanupFolderSummary(copies) {
  if (!copies.length) return null;
  return copies.map((m) =>
    `Copied ${m.uids.length} email(s) from ${m.rule.label} to folder "${m.rule.folder}" via Yahoo IMAP (originals kept in INBOX)`,
  ).join('\n');
}

async function maybeAutoFileCleanupFolders(messages, imapScript, { enabled = false, preview = false } = {}) {
  const empty = {
    executed: false,
    summary: null,
    error: null,
    copies: [],
    previewGroups: [],
    copiedUids: [],
  };
  if (!enabled || !imapScript || !Array.isArray(messages) || messages.length === 0) {
    return empty;
  }

  const groups = resolveCleanupFolderGroups(messages);
  if (groups.length === 0) return empty;

  if (preview) {
    return {
      ...empty,
      previewGroups: groups,
      summary: formatCleanupFolderPreview(groups),
    };
  }

  const copies = [];
  const errors = [];
  const copiedUids = [];

  for (const group of groups) {
    try {
      const result = await runImapCopyBatched(imapScript, group.uids, group.rule.folder);
      copies.push({ ...group, result });
      copiedUids.push(...group.uids);
    } catch (err) {
      const detail = err.stderr?.toString?.() || err.message || String(err);
      errors.push(`${group.rule.label} → ${group.rule.folder}: ${detail}`);
    }
  }

  if (copies.length === 0 && errors.length) {
    return {
      executed: false,
      summary: null,
      error: errors.join('; '),
      copies: [],
      previewGroups: groups,
      copiedUids: [],
    };
  }

  return {
    executed: copies.length > 0,
    summary: formatCleanupFolderSummary(copies),
    error: errors.length ? errors.join('; ') : null,
    copies,
    previewGroups: groups,
    copiedUids,
  };
}

module.exports = {
  BUILTIN_CLEANUP_FOLDER,
  matchCleanupFolderRule,
  resolveCleanupFolderGroups,
  maybeAutoFileCleanupFolders,
  formatCleanupFolderPreview,
};
