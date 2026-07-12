'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function findImapScriptLocal() {
  const home = process.env.HOME || '/root';
  const candidates = [
    '/tmp/continuum-mobile/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js',
    `${home}/.openclaw/workspace/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js`,
    `${home}/.openclaw/workspace/skills/imap-smtp-email/scripts/imap.js`,
  ];
  const fs = require('fs');
  return candidates.find((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

const STATE_PATH = path.join(
  process.env.HOME || '/root',
  '.config/continuum-bridge/never-trash-senders.json',
);

const BUILTIN_NEVER_TRASH = [
  { label: 'Michelle Wang', needles: ['michelle wang', 'bingjing6699@gmail.com'] },
  {
    label: 'MassHousing',
    needles: [
      'masshousing',
      'masshousing.com',
      '@masshousing.com',
      'massachusetts housing finance agency',
    ],
  },
  {
    label: 'Boston Sailing Center',
    needles: [
      'boston sailing center',
      'bostonsailingcenter',
      'bostonsailingcenter.com',
      '@bostonsailingcenter',
    ],
  },
  {
    label: 'Mass.gov notices',
    needles: [
      'notice.mass.gov',
      '@notice.mass.gov',
      'mass.gov notice',
    ],
  },
  {
    label: 'Min Zhang',
    needles: ['min zhang', 'njsgas@gmail.com', 'min z <'],
  },
];

const INVALID_SENDER_LABELS = new Set([
  'her', 'his', 'him', 'them', 'their', 'they', 'she', 'he',
  'these', 'those', 'this', 'that', 'it', 'email', 'mail', 'emails',
  'messages', 'message', 'the', 'and', 'from', 'trash',
]);

function isValidSenderLabel(label) {
  const cleaned = String(label || '').trim().toLowerCase();
  if (cleaned.length < 3) return false;
  if (INVALID_SENDER_LABELS.has(cleaned)) return false;
  if (/^[a-z]{1,3}$/.test(cleaned) && !cleaned.includes('@')) return false;
  return true;
}

function pruneInvalidNeverTrashSenders() {
  const custom = loadNeverTrashState().filter((entry) => {
    const norm = normalizeSenderEntry(entry);
    return norm && isValidSenderLabel(norm.label);
  });
  saveNeverTrashState(custom);
}

function loadNeverTrashState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.senders) ? parsed.senders : [];
  } catch {
    return [];
  }
}

function saveNeverTrashState(senders) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ senders, updated_at: new Date().toISOString() }, null, 2), 'utf8');
}

function normalizeSenderEntry({ label, needles, email }) {
  const list = new Set();
  if (label) list.add(String(label).trim().toLowerCase());
  if (email) list.add(String(email).trim().toLowerCase());
  for (const n of needles || []) {
    if (n) list.add(String(n).trim().toLowerCase());
  }
  const merged = [...list].filter((n) => n.length >= 3);
  if (!merged.length) return null;
  return {
    label: label || merged[0],
    needles: merged,
  };
}

function getAllNeverTrashSenders() {
  pruneInvalidNeverTrashSenders();
  const custom = loadNeverTrashState();
  const byLabel = new Map();
  for (const entry of [...BUILTIN_NEVER_TRASH, ...custom]) {
    const norm = normalizeSenderEntry(entry);
    if (!norm) continue;
    const key = norm.label.toLowerCase();
    if (byLabel.has(key)) {
      const existing = byLabel.get(key);
      existing.needles = [...new Set([...existing.needles, ...norm.needles])];
    } else {
      byLabel.set(key, norm);
    }
  }
  return [...byLabel.values()];
}

function emailBlob(email) {
  const from = email?.from?.text || email?.from || email?.fromAddress || email?.from || '';
  const subject = email?.subject || '';
  const preview = email?.snippet || email?.text || email?.preview || '';
  return `${from} ${subject} ${preview}`.toLowerCase();
}

function isNeverTrashEmail(emailOrRow) {
  const blob = typeof emailOrRow === 'string'
    ? emailOrRow.toLowerCase()
    : emailBlob(emailOrRow);
  return getAllNeverTrashSenders().some((entry) =>
    entry.needles.some((needle) => blob.includes(needle)));
}

function parseNeverTrashSender(message) {
  const text = String(message || '');

  if (/\bmichelle\s+wang\b/i.test(text)) {
    return { label: 'Michelle Wang', needles: ['michelle wang', 'bingjing6699@gmail.com'] };
  }

  if (/\bmass\s*housing\b/i.test(text) || /\bmasshousing\b/i.test(text)) {
    return {
      label: 'MassHousing',
      needles: [
        'masshousing',
        'masshousing.com',
        '@masshousing.com',
        'massachusetts housing finance agency',
      ],
    };
  }

  if (/\bboston\s+sailing\s+center\b/i.test(text) || /\bbostonsailingcenter\b/i.test(text)) {
    return {
      label: 'Boston Sailing Center',
      needles: [
        'boston sailing center',
        'bostonsailingcenter',
        'bostonsailingcenter.com',
        '@bostonsailingcenter',
      ],
    };
  }

  if (/notice\.mass\.gov/i.test(text)) {
    return {
      label: 'Mass.gov notices',
      needles: ['notice.mass.gov', '@notice.mass.gov', 'mass.gov notice'],
    };
  }

  const keepFromMatch = text.match(/\bkeep\s+emails?\s+from\s+(@?[A-Za-z0-9._@-]{4,100})/i);
  if (keepFromMatch?.[1]) {
    const raw = keepFromMatch[1].trim().toLowerCase();
    const needles = new Set([raw]);
    if (raw.startsWith('@')) {
      needles.add(raw.slice(1));
    } else if (raw.includes('@')) {
      needles.add(`@${raw.split('@').pop()}`);
    } else if (raw.includes('.')) {
      needles.add(`@${raw}`);
    }
    const label = raw.startsWith('@')
      ? raw.slice(1)
      : (raw.includes('@') ? raw.split('@').pop() : raw);
    const merged = [...needles].filter((n) => n.length >= 3);
    if (merged.length) return { label, needles: merged };
  }

  const patterns = [
    /\bkeep\s+emails?\s+from\s+([A-Za-z][A-Za-z0-9\s'.-]{2,50}?)(?:\s*$|,|\.|and\b)/i,
    /\b(?:never|don't|do not|stop)\s+trash(?:ing)?\s+([A-Za-z][A-Za-z0-9\s'.-]{2,50}?)(?:\s+emails?|\s*$|,|\.|and\b)/i,
    /\b(?:recover|restore|untrash|move\s+back)\s+(?:emails?\s+from\s+)([A-Za-z][A-Za-z0-9\s'.-]{2,50}?)(?:\s+emails?|\s*$|,|\.)/i,
    /\b([A-Za-z][A-Za-z0-9\s'.-]{2,50}?)\s+(?:emails?\s+)?should\s+never\s+be\s+trash(?:ed)?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const label = match[1].trim().replace(/\s+(?:email|mail|emails)$/i, '').trim();
      if (isValidSenderLabel(label)) {
        const needles = [label.toLowerCase()];
        if (label.toLowerCase().includes('michelle')) {
          needles.push('bingjing6699@gmail.com');
        }
        return { label, needles };
      }
    }
  }
  return null;
}

function resolveRecoverTargets(message, parsedSender) {
  const all = getAllNeverTrashSenders();
  if (parsedSender && isValidSenderLabel(parsedSender.label)) {
    return [normalizeSenderEntry(parsedSender)].filter(Boolean);
  }
  if (/\b(?:recover|restore|untrash)\s+(?:her|his|their|them|these)\b/i.test(message)) {
    return all;
  }
  return all;
}

function wantsNeverTrashRequest(message) {
  const text = String(message || '');
  if (parseNeverTrashSender(text)) return true;
  if (/\bkeep\s+emails?\s+from\b/i.test(text)) return true;
  return /\b(?:never\s+trash|don't\s+trash|do not\s+trash|stop\s+trash(?:ing)?)\b/i.test(text)
    && /\b(?:recover|restore|untrash|update|scheduled|daily\s+cleanup)\b/i.test(text);
}

function wantsRecoverFromTrash(message) {
  return /\b(?:recover|restore|untrash|move\s+back|undo\s+trash)\b/i.test(String(message || ''));
}

function addNeverTrashSender(entry) {
  const norm = normalizeSenderEntry(entry);
  if (!norm) return getAllNeverTrashSenders();
  const custom = loadNeverTrashState().filter((s) => s.label.toLowerCase() !== norm.label.toLowerCase());
  custom.push(norm);
  saveNeverTrashState(custom);
  return getAllNeverTrashSenders();
}

async function searchTrashBySender(imapScript, senderEntry, { limit = 200, recent = '30d' } = {}) {
  const skillRoot = path.dirname(path.dirname(imapScript));
  const emailNeedle = senderEntry.needles.find((n) => n.includes('@'));
  const searchNeedles = emailNeedle
    ? [emailNeedle, ...senderEntry.needles.filter((n) => n !== emailNeedle)]
    : senderEntry.needles;

  for (const needle of searchNeedles) {
    const args = [
      imapScript, 'search',
      '--mailbox', 'Trash',
      '--from', needle,
      '--limit', String(limit),
      '--recent', recent,
      '--lite',
    ];
    try {
      const { stdout } = await execFileAsync('node', args, {
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        cwd: skillRoot,
        env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
      });
      const messages = JSON.parse(stdout);
      if (Array.isArray(messages) && messages.length) {
        return messages.filter((msg) => {
          const blob = emailBlob(msg);
          return senderEntry.needles.some((n) => blob.includes(n));
        });
      }
    } catch {
      // try next needle
    }
  }

  // Fallback: scan recent Trash and filter by sender needles
  try {
    const { stdout } = await execFileAsync('node', [
      imapScript, 'search',
      '--mailbox', 'Trash',
      '--limit', String(limit),
      '--recent', recent,
      '--lite',
    ], {
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
      cwd: skillRoot,
      env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
    });
    const messages = JSON.parse(stdout);
    if (!Array.isArray(messages)) return [];
    return messages.filter((msg) => {
      const blob = emailBlob(msg);
      return senderEntry.needles.some((n) => blob.includes(n));
    });
  } catch {
    return [];
  }
}

async function moveUidsFromTrash(imapScript, uids) {
  if (!uids.length) return { count: 0, uids: [] };
  const skillRoot = path.dirname(path.dirname(imapScript));
  const BATCH = 25;
  const moved = [];
  for (let i = 0; i < uids.length; i += BATCH) {
    const chunk = uids.slice(i, i + BATCH);
    await execFileAsync('node', [
      imapScript, 'move', ...chunk.map(String), '--to', 'INBOX', '--mailbox', 'Trash',
    ], {
      timeout: 120000,
      cwd: skillRoot,
      env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
    });
    moved.push(...chunk);
  }
  return { count: moved.length, uids: moved };
}

async function recoverNeverTrashSenders(senderEntries, imapScript = null) {
  const script = imapScript || findImapScriptLocal();
  if (!script) {
    return { executed: false, error: 'IMAP skill not installed', recovered: [], bySender: [] };
  }
  const entries = senderEntries?.length ? senderEntries : getAllNeverTrashSenders();
  const bySender = [];
  let allUids = [];
  for (const entry of entries) {
    try {
      const messages = await searchTrashBySender(script, entry);
      const uids = messages.map((m) => Number(m.uid)).filter(Number.isFinite);
      if (uids.length) {
        const moved = await moveUidsFromTrash(script, uids);
        bySender.push({ label: entry.label, recovered: moved.count, uids: moved.uids });
        allUids.push(...moved.uids);
      } else {
        bySender.push({ label: entry.label, recovered: 0, uids: [] });
      }
    } catch (err) {
      bySender.push({ label: entry.label, recovered: 0, error: err.message || String(err) });
    }
  }
  return {
    executed: allUids.length > 0,
    recovered: allUids,
    bySender,
    error: null,
  };
}

function buildNeverTrashReply({ sender, recoverResult, allSenders }) {
  const lines = [
    '[NEVER-TRASH RESULT — your ENTIRE reply must be ONLY the text between these markers; copy verbatim]',
    '',
    `## Never-trash rule: ${sender?.label || 'updated'}`,
    '',
    `- **Protected senders:** ${allSenders.map((s) => s.label).join(', ')}`,
    '- **Daily cleanup updated** — these senders are excluded from auto-trash and scheduled cleanup.',
  ];
  if (recoverResult) {
    const total = recoverResult.bySender?.reduce((sum, row) => sum + (row.recovered || 0), 0) || 0;
    lines.push('', `**Recovered from Trash:** ${total} email(s) moved back to INBOX`);
    for (const row of recoverResult.bySender || []) {
      if (row.recovered > 0) {
        lines.push(`- ${row.label}: ${row.recovered} restored`);
      } else if (row.error) {
        lines.push(`- ${row.label}: recovery failed (${row.error})`);
      } else {
        lines.push(`- ${row.label}: none in Trash`);
      }
    }
  }
  lines.push('', '[/NEVER-TRASH RESULT]');
  return lines.join('\n');
}

async function handleNeverTrashRequest(message) {
  const text = String(message || '');
  pruneInvalidNeverTrashSenders();

  let sender = parseNeverTrashSender(text);
  if (sender && isValidSenderLabel(sender.label)) {
    addNeverTrashSender(sender);
  }

  const allSenders = getAllNeverTrashSenders();
  const primarySender = sender && isValidSenderLabel(sender.label)
    ? normalizeSenderEntry(sender)
    : allSenders.find((s) => /michelle/i.test(s.label)) || allSenders[0];

  let recoverResult = null;
  if (wantsRecoverFromTrash(text) || /\brecover\b/i.test(text) || /\bkeep\s+emails?\s+from\b/i.test(text)) {
    const targets = resolveRecoverTargets(text, sender);
    recoverResult = await recoverNeverTrashSenders(targets);
  }

  return {
    sender: primarySender,
    recoverResult,
    allSenders,
    reply: buildNeverTrashReply({ sender: primarySender, recoverResult, allSenders }),
  };
}

module.exports = {
  BUILTIN_NEVER_TRASH,
  getAllNeverTrashSenders,
  isNeverTrashEmail,
  parseNeverTrashSender,
  wantsNeverTrashRequest,
  wantsRecoverFromTrash,
  addNeverTrashSender,
  recoverNeverTrashSenders,
  handleNeverTrashRequest,
  buildNeverTrashReply,
};
