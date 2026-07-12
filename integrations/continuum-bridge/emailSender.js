'use strict';

const { parseAnyDateToken, addDays } = require('./emailDateRange');

/** Yahoo folders that map to a default sender when the user names the folder only. */
const FOLDER_SENDER_DEFAULTS = {
  min: 'Min Zhang',
};

function looksLikeDateToken(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (parseAnyDateToken(trimmed)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(trimmed)) return true;
  if (/^[a-z]+\s+\d{1,2},?\s+\d{4}/i.test(trimmed)) return true;
  return false;
}

function parseMailboxFromMessage(message) {
  const text = String(message || '');
  const patterns = [
    /\bin\s+(?:the\s+)?["']?([A-Za-z0-9][A-Za-z0-9 _-]{0,40}?)["']?\s+folder\b/i,
    /\b(?:read|feed|ingest|fetch|get|scan)\s+(?:all\s+)?(?:every\s+)?(?:the\s+)?(?:emails?\s+)?(?:in|from)\s+(?:the\s+)?["']?([A-Za-z0-9][A-Za-z0-9 _-]{0,40}?)["']?\s+folder\b/i,
    /\b(?:emails?\s+)?from\s+(?:the\s+)?["']?([A-Za-z0-9][A-Za-z0-9 _-]{0,40}?)["']?\s+folder\b/i,
    /\bfolder\s+["']?([A-Za-z0-9][A-Za-z0-9 _-]{0,40}?)["']?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const name = match[1].trim();
    if (/^(inbox|trash|bin|junk|spam)$/i.test(name)) continue;
    return name;
  }
  return null;
}

function stripFolderSuffix(sender) {
  return String(sender || '')
    .replace(/\s+in\s+(?:the\s+)?["']?[A-Za-z0-9][A-Za-z0-9 _-]{0,40}?["']?\s+folder\b.*$/i, '')
    .replace(/\s+(?:and|to|into)\s+.*$/i, '')
    .trim();
}

function parseSenderFromMessage(message) {
  const text = String(message || '');
  // "emails from 4/1/2026 to 6/15/2026" is a date range, not a sender filter.
  if (/\b(?:from|between)\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i.test(text)
    && !/\bemails?\s+from\s+[A-Za-z@]/i.test(text)) return null;
  if (/\b(?:from|between)\s+[a-z]+\s+\d{1,2},?\s+\d{4}/i.test(text)
    && !/\bemails?\s+from\s+[A-Za-z@]/i.test(text)) return null;

  const patterns = [
    /\b(?:read|feed|ingest|fetch|get)\s+(?:all\s+)?(?:every\s+)?emails?\s+from\s+(.+?)\s+from\s+(?:year\s+)?(?:\d{4}|\d{1,2}[\/\-])/i,
    /\b(?:read|feed|ingest|fetch|get)\s+(?:all\s+)?(?:every\s+)?emails?\s+from\s+(.+?)\s+(?:into|to)\s+(?:continuum\s+)?memory/i,
    /\b(?:read|feed|ingest|fetch|get)\s+(?:all\s+)?(?:every\s+)?emails?\s+from\s+(.+?)\s+in\s+(?:the\s+)?["']?[A-Za-z0-9][A-Za-z0-9 _-]{0,40}?["']?\s+folder\b/i,
    /\bfeed\s+(?:all\s+)?(?:emails?\s+from\s+)?["']?([^"'\n]+?)["']?\s+(?:emails?\s+)?to\s+(?:continuum|memory)/i,
    /\b(?:ingest|import|save|remember|store)\s+(?:all\s+)?(?:emails?\s+from\s+)?["']?([^"'\n]+?)["']?(?:\s+emails?)?\s+(?:to|into)\s+(?:continuum|memory)/i,
    /\bemails?\s+from\s+["']?([^"'\n]+?)["']?\s+from\s+(?:year\s+|\d{4}|\d{1,2}[\/\-])/i,
    /\bemails?\s+from\s+["']?([^"'\n]+?)["']?\s+in\s+(?:the\s+)?["']?[A-Za-z0-9][A-Za-z0-9 _-]{0,40}?["']?\s+folder\b/i,
    /\b(?:from|by)\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
    /\bemails?\s+from\s+["']?([^"'\n,]+?)["']?(?:\s+(?:to|into)\s+(?:continuum|memory)|$)/i,
    /\b(?:from|by)\s+["']?([A-Za-z0-9@.\s+'-]{2,60}?)["']?(?:\s+'s|\s+emails?|\s+mail)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      let sender = stripFolderSuffix(match[1].trim());
      sender = sender.replace(/\s+(to|into|for)\s+(continuum|memory).*$/i, '').trim();
      sender = sender.replace(/\s+from\s+(?:year\s+)?.*$/i, '').trim();
      if (sender.length >= 2 && !looksLikeDateToken(sender)) return sender;
    }
  }
  return null;
}

function resolveSenderForMailboxIngest(message) {
  const parsed = parseSenderFromMessage(message);
  if (parsed) {
    const cleaned = stripFolderSuffix(parsed);
    if (/^min$/i.test(cleaned)) return 'Min Zhang';
    if (cleaned.length >= 2) return cleaned;
  }
  const mailbox = parseMailboxFromMessage(message);
  if (mailbox) {
    const defaultSender = FOLDER_SENDER_DEFAULTS[mailbox.trim().toLowerCase()];
    if (defaultSender) return defaultSender;
  }
  if (parseMailboxFromMessage(message) && /\b(?:her|she|min\s+zhang)\b/i.test(message)) {
    return 'Min Zhang';
  }
  return null;
}

function wantsAttitudeTimelineAnalysis(message) {
  const text = String(message || '');
  return /\b(attitude|timeline|time[\s-]?line|how\s+(?:her|his|their)\s+(?:feelings?|tone|attitude)|change(?:s|d)?\s+(?:over|in)\s+time|towards?\s+me|toward\s+me|relationship\s+(?:evolv|chang))\b/i.test(text);
}

function wantsFolderPersonaIngest(message) {
  const text = String(message || '');
  if (!parseMailboxFromMessage(text)) return false;
  return wantsSenderPersonaAnalysis(text) || wantsEmailMemoryIngest(text);
}

function wantsSenderPersonaAnalysis(message) {
  const text = String(message || '');
  const hasPersonaKeywords = /\b(persona|analyze|analysis|thinking|communication\s+style|psycholog|attitude|timeline|time[\s-]?line|build(?:\s+up)?)\b/i.test(text);
  const hasSender = resolveSenderForMailboxIngest(text) != null
    || parseSenderFromMessage(text) != null
    || /\b(?:her|his|their)\s+(?:thinking|persona|style|attitude)\b/i.test(text);
  return hasPersonaKeywords && hasSender;
}

function wantsSequentialEmailIngest(message) {
  const text = String(message || '');
  return /\b(?:in\s+sequence|sequential(?:ly)?|chronolog(?:ical(?:ly)?)?|oldest[\s-]first|time\s+order)\b/i.test(text);
}

function wantsEmailMemoryIngest(message) {
  const text = String(message || '');
  if (wantsSenderPersonaAnalysis(text) && /\b(memory|continuum|remember|ingest|feed|into\s+memory|build|store|save)\b/i.test(text)) {
    return true;
  }
  if (wantsFolderPersonaIngest(text)) return true;
  return /\b(feed|ingest|import|add|save|remember|store|read\s+all|read\s+every)\b/i.test(text)
    && /\b(emails?|mail|inbox|messages?)\b/i.test(text)
    && /\b(continuum|memory|brain|into\s+memory|persona)\b/i.test(text);
}

function defaultFolderPersonaDateRange() {
  const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
  return {
    since: '2022-01-01',
    before: tomorrow,
    label: '2022 through today (folder persona scan)',
  };
}

function buildPersonaAnalysisNote(message) {
  if (!wantsSenderPersonaAnalysis(message)) return null;
  const lines = [
    'SENDER PERSONA (evidence-only): Use ONLY the emails listed below. State the actual earliest and latest Date: in the batch before any timeline.',
    'NEVER invent dialogue or put words in the sender\'s mouth — in any language.',
    'Every direct quote MUST appear verbatim in a Preview/body line below, with UID and Date cited on the same line.',
    'If a phrase is NOT in the fetched emails, say "not found in this batch" — never guess when something was said.',
    'Relationship labels (ex-partner, divorce, romantic): only if explicit in email text; otherwise label as INFERENCE or omit.',
    'Describe communication style, tone, priorities, and recurring topics from observed subjects/previews only.',
  ];
  if (wantsAttitudeTimelineAnalysis(message)) {
    lines.push(
      'ATTITUDE TIMELINE (evidence-only): Phase boundaries must align with actual email Date: headers — no invented months or events.',
      'For each phase: date range, dominant tone (from previews), themes, and 1–3 cited emails (UID + Date + Subject). No uncited Chinese/English quotes.',
      'If tone shifts are unclear from previews, say so — do not fabricate turning points.',
    );
  }
  return lines.join(' ');
}

function imapSearchArgs(fetchOptions, sender, { chronological = false, mailbox = null } = {}) {
  const args = ['search'];
  if (mailbox) args.push('--mailbox', mailbox);
  if (sender) args.push('--from', sender);
  args.push('--limit', String(fetchOptions.limit));
  args.push('--sort', chronological ? 'date-asc' : 'date');
  if (fetchOptions.since) {
    args.push('--since', fetchOptions.since);
    if (fetchOptions.before) args.push('--before', fetchOptions.before);
  } else {
    args.push('--recent', fetchOptions.recent || '7d');
  }
  if (fetchOptions.offset) args.push('--offset', String(fetchOptions.offset));
  args.push('--lite');
  if (fetchOptions.unreadOnly) args.push('--unseen');
  return args;
}

module.exports = {
  parseSenderFromMessage,
  parseMailboxFromMessage,
  resolveSenderForMailboxIngest,
  wantsEmailMemoryIngest,
  wantsSenderPersonaAnalysis,
  wantsAttitudeTimelineAnalysis,
  wantsFolderPersonaIngest,
  wantsSequentialEmailIngest,
  defaultFolderPersonaDateRange,
  buildPersonaAnalysisNote,
  imapSearchArgs,
};
