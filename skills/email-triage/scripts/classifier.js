'use strict';

/**
 * Heuristic email triage classifier.
 * Ported for Continuum/OpenClaw from community patterns:
 * - briancolinger/email-triage (MIT, OpenClaw) — categories urgent/needs-response/informational/spam
 * - danieleschmidt/crewai-email-triage — keyword + sender reputation scoring
 */

const CATEGORIES = ['urgent', 'needs_response', 'informational', 'newsletter', 'spam', 'protected'];

const URGENT_KEYWORDS = [
  'urgent', 'asap', 'immediately', 'critical', 'emergency', 'outage', 'incident',
  'production down', 'sev1', 'sev-1', 'account suspended', 'security alert',
  'unauthorized access', 'verification code', 'one time passcode', 'otp',
  'two-step verification', 'app password',
];

const ACTION_KEYWORDS = [
  'please review', 'please confirm', 'please respond', 'your approval', 'sign off',
  'awaiting your', 'waiting on you', 'can you', 'could you', 'would you',
  'follow up', 'follow-up', 'due date', 'deadline', 'meeting request', 'rsvp',
  'docu sign', 'docusign', 'complete with docusign', 'signature required',
];

const NEWSLETTER_KEYWORDS = [
  'unsubscribe', 'newsletter', 'weekly digest', 'monthly digest', 'deal of the day',
  'promo', 'promotion', 'sale', 'offer', '% off', 'coupon', 'no-reply', 'noreply',
  'marketing@', 'hello@', 'news@', 'updates@', 'digest@', 'cash back', 'prime day',
];

const SPAM_KEYWORDS = [
  'you have won', "you've won", 'winner', 'lottery', 'claim your prize',
  'click here to claim', 'limited time', 'act now', 'free money', 'anti-virus',
  'antivirus', 'your computer at risk', 'device security', 'knee pain',
  'work from home', 'guaranteed income', 'wire transfer', '100% free', 'risk free',
];

const GITHUB_BOT = /\bcursor\[bot\]|github\.com|pull request|pr run failed|workflow run|dependabot/i;

const PROTECTED_PATTERNS = [
  /security@yahoo|account.?security|yahoo.*security/i,
  /cash app|bank of america|fidelity|greenwood credit|peoplesbank|charles schwab|estatement|invoice/i,
  /docu sign|docusign|jc realty|property management/i,
  /hetzner|termius|render services|stripe/i,
  /verification code|one.?time passcode|otp/i,
];

const TRUSTED_SENDERS = [
  /security@/i, /billing@/i, /support@/i, /alert@/i, /notifications@/i,
];

const CATEGORY_SCORE = {
  urgent: 9,
  needs_response: 6,
  informational: 3,
  newsletter: 1,
  spam: 0,
  protected: 8,
};

function extractDomain(from) {
  const match = String(from || '').match(/@([\w.-]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function emailBlob(email) {
  const from = email.from?.text || email.from || email.fromAddress || '';
  const subject = email.subject || '';
  const preview = email.snippet || email.text || email.preview || '';
  return `${from} ${subject} ${preview}`.toLowerCase();
}

function isProtected(email) {
  const blob = emailBlob(email);
  return PROTECTED_PATTERNS.some((re) => re.test(blob));
}

function classifyEmail(email) {
  if (isProtected(email)) {
    return {
      category: 'protected',
      score: CATEGORY_SCORE.protected,
      reasons: ['protected sender/subject pattern (financial, security, infra)'],
      selectable_as_junk: false,
    };
  }

  const from = String(email.from?.text || email.from || email.fromAddress || '');
  const subject = String(email.subject || '');
  const text = emailBlob(email);
  const reasons = [];

  const spamHits = SPAM_KEYWORDS.filter((kw) => text.includes(kw));
  if (spamHits.length) {
    reasons.push(`spam keywords: ${spamHits.slice(0, 3).join(', ')}`);
    return { category: 'spam', score: CATEGORY_SCORE.spam, reasons, selectable_as_junk: true };
  }

  if (GITHUB_BOT.test(text)) {
    reasons.push('automated GitHub/Cursor notification');
    return { category: 'newsletter', score: CATEGORY_SCORE.newsletter, reasons, selectable_as_junk: true };
  }

  const newsletterHits = NEWSLETTER_KEYWORDS.filter((kw) => text.includes(kw));
  if (newsletterHits.length >= 2) {
    reasons.push(`newsletter signals: ${newsletterHits.slice(0, 3).join(', ')}`);
    return { category: 'newsletter', score: CATEGORY_SCORE.newsletter, reasons, selectable_as_junk: true };
  }

  const urgentHits = URGENT_KEYWORDS.filter((kw) => text.includes(kw));
  const trusted = TRUSTED_SENDERS.some((re) => re.test(from));
  if (urgentHits.length) {
    reasons.push(`urgent keywords: ${urgentHits.slice(0, 3).join(', ')}`);
    if (trusted) reasons.push('trusted sender');
    return { category: 'urgent', score: CATEGORY_SCORE.urgent, reasons, selectable_as_junk: false };
  }

  const actionHits = ACTION_KEYWORDS.filter((kw) => text.includes(kw));
  if (actionHits.length) {
    reasons.push(`action keywords: ${actionHits.slice(0, 3).join(', ')}`);
    return { category: 'needs_response', score: CATEGORY_SCORE.needs_response, reasons, selectable_as_junk: false };
  }

  if (trusted) {
    reasons.push('trusted sender, no strong junk signals');
    return { category: 'informational', score: CATEGORY_SCORE.informational + 1, reasons, selectable_as_junk: false };
  }

  if (newsletterHits.length === 1) {
    reasons.push(`newsletter signal: ${newsletterHits[0]}`);
    return { category: 'newsletter', score: CATEGORY_SCORE.newsletter, reasons, selectable_as_junk: true };
  }

  reasons.push('no strong signals');
  return { category: 'informational', score: CATEGORY_SCORE.informational, reasons, selectable_as_junk: false };
}

function triageMessages(messages) {
  return (messages || []).map((msg, index) => {
    const triage = classifyEmail(msg);
    return {
      index: index + 1,
      uid: msg.uid,
      from: msg.from?.text || msg.from || msg.fromAddress || 'Unknown',
      subject: msg.subject || '(no subject)',
      unread: Array.isArray(msg.flags) && !msg.flags.includes('\\Seen'),
      ...triage,
    };
  });
}

function selectJunkUids(messages, { includeGithub = true, max = 100 } = {}) {
  const triaged = triageMessages(messages);
  const uids = [];
  for (const row of triaged) {
    if (!row.selectable_as_junk) continue;
    if (!includeGithub && /github|cursor\[bot\]/i.test(`${row.from} ${row.subject}`)) continue;
    if (row.uid != null) uids.push(Number(row.uid));
    if (uids.length >= max) break;
  }
  return { uids, triaged };
}

function formatTriageReport(triaged, { includeProtected = true } = {}) {
  const counts = {};
  for (const cat of CATEGORIES) counts[cat] = 0;
  for (const row of triaged) counts[row.category] = (counts[row.category] || 0) + 1;

  const junkRows = triaged.filter((r) => r.selectable_as_junk);
  const lines = [
    `Email triage (${triaged.length} messages):`,
    `Counts: urgent=${counts.urgent}, needs_response=${counts.needs_response}, informational=${counts.informational}, newsletter=${counts.newsletter}, spam=${counts.spam}, protected=${counts.protected}`,
    '',
    `Selectable junk/newsletter (${junkRows.length}):`,
  ];

  for (const row of junkRows.slice(0, 50)) {
    lines.push(`- [${row.category}] UID ${row.uid} | ${row.subject.slice(0, 60)} | ${row.from.slice(0, 40)}`);
  }
  if (junkRows.length > 50) lines.push(`... and ${junkRows.length - 50} more`);

  if (includeProtected) {
    const protectedRows = triaged.filter((r) => r.category === 'protected');
    if (protectedRows.length) {
      lines.push('', `Protected (never auto-junk, ${protectedRows.length}):`);
      for (const row of protectedRows.slice(0, 15)) {
        lines.push(`- UID ${row.uid} | ${row.subject.slice(0, 50)}`);
      }
    }
  }

  lines.push('', 'To trash junk: "move selectable junk to trash" or "delete all newsletter and spam from fetched list"');
  return lines.join('\n');
}

module.exports = {
  CATEGORIES,
  classifyEmail,
  triageMessages,
  selectJunkUids,
  formatTriageReport,
  isProtected,
};
