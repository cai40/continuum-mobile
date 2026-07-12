'use strict';

/** Words that must never be treated as Yahoo folder names when parsing chat text. */
const INVALID_FOLDER_NAMES = new Set([
  'a', 'an', 'the', 'my', 'your', 'in', 'from', 'of', 'for', 'is', 'are', 'was',
  'email', 'emails', 'mail', 'mails', 'message', 'messages', 'inbox',
  'name', 'named', 'called', 'folder', 'folders', 'mailbox', 'mailboxes',
  'available', 'listed', 'correct', 'exact', 'requested', 'scan', 'fetch',
  'read', 'list', 'copy', 'move', 'all', 'every', 'case', 'sensitive',
  'confirm', 'retry', 're', 'initiate',
]);

/** Explicit folder nicknames mentioned in chat (case preserved for IMAP resolve). */
const KNOWN_FOLDER_ALIASES = [
  { pattern: /\bmin\s+folder\b/i, name: 'Min' },
];

function isValidFolderName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (INVALID_FOLDER_NAMES.has(lower)) return false;
  if (/^(inbox|trash|bin|junk|spam)$/i.test(trimmed)) return false;
  return true;
}

function parseMailboxFromMessage(message) {
  const text = String(message || '');

  for (const alias of KNOWN_FOLDER_ALIASES) {
    if (alias.pattern.test(text)) return alias.name;
  }

  const patterns = [
    // "in Min folder", "from Min folder", "of Min folder"
    /\b(?:in|from|of)\s+(?:the\s+)?["']?([A-Za-z0-9][A-Za-z0-9_-]{0,40}?)["']?\s+folder\b/i,
    // "Min folder" (name before folder — most common; no spaces inside name)
    /\b["']?([A-Za-z0-9][A-Za-z0-9_-]{0,40}?)["']?\s+folder\b/i,
    // "read/scan … in Min folder"
    /\b(?:read|feed|ingest|fetch|get|scan|list|copy|open|retry|re-initiate)\s+(?:all\s+)?(?:every\s+)?(?:the\s+)?(?:emails?\s+)?(?:in|from|of)\s+(?:the\s+)?["']?([A-Za-z0-9][A-Za-z0-9_-]{0,40}?)["']?\s+folder\b/i,
    // "copy … from Min folder"
    /\b(?:emails?\s+)?from\s+(?:the\s+)?["']?([A-Za-z0-9][A-Za-z0-9_-]{0,40}?)["']?\s+folder\b/i,
    // "folder name (e.g., Min)" / "folder: Min"
    /\bfolder\s+(?:name\s+)?(?:\(e\.g\.?,?\s*)?["']?([A-Za-z0-9][A-Za-z0-9_-]{0,40}?)["']?\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const name = match[1].trim();
    if (isValidFolderName(name)) return name;
  }

  return null;
}

module.exports = {
  INVALID_FOLDER_NAMES,
  isValidFolderName,
  parseMailboxFromMessage,
};
