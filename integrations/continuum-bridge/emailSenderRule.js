'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { triageMessages } = require('./emailTriage');
const { MAX_DELETE_PER_REQUEST, CLEANUP_DELETE_MAX } = require('./emailDelete');

const execFileAsync = promisify(execFile);

const RECEIPT_KEEP = /\b(receipt|invoice|purchase\s+history|order\s+confirm|confirmation\s+number|your\s+order|shipped|delivery\s+confirm|payment\s+received|paid|billing\s+statement)\b/i;
const PROMO_TRASH = /\b(promo|promotional|marketing|sale|deal|%\s*off|shop\s+now|limited\s+time|materials?)\b/i;

function parseSenderTrashRule(message) {
  const text = String(message || '').trim();
  if (!/\b(?:trash|trashed|remove|delete|move\s+(?:them|it|those)?\s*(?:to\s+)?trash)\b/i.test(text)) {
    return null;
  }

  const patterns = [
    /^([A-Za-z][A-Za-z0-9\s&'.-]{2,45}?)\s+(?:promotional|promo|marketing)/i,
    /^([A-Za-z][A-Za-z0-9\s&'.-]{2,45}?)\s+.*\b(?:emails?|mail)\b/i,
    /\b(?:trash|remove|delete)\s+(?:all\s+)?([A-Za-z][A-Za-z0-9\s&'.-]{2,45}?)\s+(?:promo|promotional|marketing)/i,
  ];
  let sender = null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      sender = match[1].trim().replace(/\s+(?:email|mail|emails)$/i, '').trim();
      break;
    }
  }
  if (!sender || sender.length < 3) return null;

  const keepReceipt = /\bunless\b/i.test(text)
    || /\b(?:keep|except|don't|do not|never)\s+.*\b(?:receipt|invoice|purchase|order)\b/i.test(text);

  return {
    senderNeedle: sender.toLowerCase(),
    senderLabel: sender,
    keepReceipt,
  };
}

function wantsSenderRuleTrash(message) {
  return parseSenderTrashRule(message) != null;
}

function emailFullBlob(row, email) {
  const preview = String(email?.snippet || email?.text || email?.preview || '');
  return `${row.from} ${row.subject} ${preview}`.toLowerCase();
}

function matchesSenderRuleTrash(row, email, rule) {
  if (row.uid == null) return false;
  const from = String(row.from || '').toLowerCase();
  const blob = emailFullBlob(row, email);
  if (!from.includes(rule.senderNeedle) && !blob.includes(rule.senderNeedle)) return false;
  if (rule.keepReceipt && RECEIPT_KEEP.test(blob)) return false;
  if (PROMO_TRASH.test(blob)) return true;
  if (row.selectable_as_junk && !RECEIPT_KEEP.test(blob)) return true;
  return false;
}

function resolveSenderRuleTrashUids(emails, rule, maxCap = MAX_DELETE_PER_REQUEST) {
  if (!rule || !Array.isArray(emails)) return [];
  const triaged = triageMessages(emails);
  const uids = [];
  for (let i = 0; i < triaged.length; i += 1) {
    if (matchesSenderRuleTrash(triaged[i], emails[i], rule)) {
      uids.push(Number(triaged[i].uid));
    }
  }
  return uids.slice(0, maxCap);
}

function countSenderRuleTrashTargets(emails, rule) {
  return resolveSenderRuleTrashUids(emails, rule, CLEANUP_DELETE_MAX).length;
}

async function runImapDeleteBatched(imapScript, uids) {
  const skillRoot = path.dirname(path.dirname(imapScript));
  const DELETE_BATCH_SIZE = 25;
  const chunks = [];
  for (let i = 0; i < uids.length; i += DELETE_BATCH_SIZE) {
    chunks.push(uids.slice(i, i + DELETE_BATCH_SIZE));
  }
  for (const chunk of chunks) {
    await execFileAsync('node', [imapScript, 'delete', ...chunk.map(String)], {
      timeout: Math.min(600000, 60000 + uids.length * 2500),
      maxBuffer: 1024 * 1024,
      cwd: skillRoot,
      env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
    });
  }
  return { success: true, uids, action: 'moved_to_trash', count: uids.length };
}

function formatSenderRuleResult(rule, emails, uids, kept) {
  const lines = uids.map((uid) => {
    const email = emails.find((item) => Number(item.uid) === Number(uid));
    if (!email) return `- UID ${uid}`;
    const from = email.from?.text || email.from || 'Unknown';
    const subject = email.subject || '(no subject)';
    return `- UID ${uid}: "${subject}" from ${from}`;
  });
  const parts = [
    `Moved to Trash ${uids.length} ${rule.senderLabel} promotional email(s) via Yahoo IMAP:`,
    ...lines,
  ];
  if (kept.length) {
    parts.push(
      `Kept ${kept.length} ${rule.senderLabel} message(s) (receipt/invoice/order):`,
      ...kept.slice(0, 10).map((row) => `- UID ${row.uid}: "${row.subject}"`),
    );
    if (kept.length > 10) parts.push(`... and ${kept.length - 10} more kept`);
  }
  if (uids.length === 0 && kept.length === 0) {
    return `No ${rule.senderLabel} promotional email in the fetched slice. Try "fetch emails from ${rule.senderLabel} limit 500" then repeat.`;
  }
  if (uids.length === 0) {
    return `No ${rule.senderLabel} promotional email to trash; ${kept.length} receipt/invoice/order message(s) kept as requested.`;
  }
  return parts.join('\n');
}

async function maybeSenderRuleTrash(message, emails, imapScript, { enabled = false, maxDelete = MAX_DELETE_PER_REQUEST } = {}) {
  const rule = parseSenderTrashRule(message);
  if (!rule || !imapScript) {
    return { executed: false, summary: null, error: null, uids: [], skippedUids: [], rule: null };
  }

  const uids = resolveSenderRuleTrashUids(emails, rule, maxDelete);
  const triaged = triageMessages(emails);
  const kept = [];
  for (let i = 0; i < triaged.length; i += 1) {
    const row = triaged[i];
    const from = String(row.from || '').toLowerCase();
    const blob = emailFullBlob(row, emails[i]);
    if ((from.includes(rule.senderNeedle) || blob.includes(rule.senderNeedle)) && RECEIPT_KEEP.test(blob)) {
      kept.push({ uid: row.uid, subject: String(emails[i].subject || '').slice(0, 80) });
    }
  }

  if (!enabled) {
    const summary = uids.length
      ? `Would move ${uids.length} ${rule.senderLabel} promotional email(s) to Trash once "Allow move to Trash" is enabled in app settings.`
      : formatSenderRuleResult(rule, emails, [], kept);
    return {
      executed: false,
      summary,
      error: null,
      uids,
      skippedUids: [],
      rule,
      kept,
    };
  }

  if (uids.length === 0) {
    return {
      executed: false,
      summary: formatSenderRuleResult(rule, emails, [], kept),
      error: null,
      uids: [],
      skippedUids: [],
      rule,
      kept,
    };
  }

  try {
    await runImapDeleteBatched(imapScript, uids);
    return {
      executed: true,
      summary: formatSenderRuleResult(rule, emails, uids, kept),
      error: null,
      uids,
      skippedUids: [],
      rule,
      kept,
    };
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    return {
      executed: false,
      summary: null,
      error: `Sender rule trash failed: ${detail}`,
      uids,
      skippedUids: [],
      rule,
      kept,
    };
  }
}

function formatSenderRuleBlock(summary) {
  if (!summary) return '';
  return [
    '[SENDER RULE RESULT — your ENTIRE reply must be ONLY the text between these markers; copy verbatim]',
    summary,
    '[/SENDER RULE RESULT]',
  ].join('\n');
}

function buildPrefilledSenderRuleReply(rule, senderResult, { deleteEnabled = false } = {}) {
  if (!rule) return null;
  const lines = [
    `## ${rule.senderLabel} email rule`,
    '',
    `**Rule:** Trash ${rule.senderLabel} promotional/marketing mail${rule.keepReceipt ? '; keep receipts, invoices, and purchase history' : ''}.`,
  ];
  if (!deleteEnabled) {
    lines.push(
      '',
      '**Action:** Move to Trash is **disabled** in app settings.',
      'Setup → turn on **Allow move to Trash**, Save, then send this message again.',
    );
    if (senderResult?.uids?.length) {
      lines.push(`**Would trash:** ${senderResult.uids.length} message(s) in the fetched batch.`);
    }
  } else if (senderResult?.executed) {
    lines.push('', `**Result:** ${senderResult.summary?.split('\n')[0] || 'Moved to Trash.'}`);
    if (senderResult.kept?.length) {
      lines.push(`**Kept:** ${senderResult.kept.length} receipt/invoice/order message(s).`);
    }
  } else if (senderResult?.summary) {
    lines.push('', senderResult.summary);
  } else if (senderResult?.error) {
    lines.push('', `**Error:** ${senderResult.error}`);
  }
  return formatSenderRuleBlock(lines.join('\n'));
}

module.exports = {
  parseSenderTrashRule,
  wantsSenderRuleTrash,
  resolveSenderRuleTrashUids,
  countSenderRuleTrashTargets,
  maybeSenderRuleTrash,
  formatSenderRuleBlock,
  buildPrefilledSenderRuleReply,
  RECEIPT_KEEP,
};
