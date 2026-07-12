'use strict';

const { parseAnyDateToken } = require('./emailDateRange');

function looksLikeDateToken(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (parseAnyDateToken(trimmed)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(trimmed)) return true;
  if (/^[a-z]+\s+\d{1,2},?\s+\d{4}/i.test(trimmed)) return true;
  return false;
}

function parseSenderFromMessage(message) {
  const text = String(message || '');
  // "emails from 4/1/2026 to 6/15/2026" is a date range, not a sender filter.
  if (/\b(?:from|between)\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i.test(text)
    && !/\bemails?\s+from\s+[A-Za-z@]/i.test(text)) return null;
  if (/\b(?:from|between)\s+[a-z]+\s+\d{1,2},?\s+\d{4}/i.test(text)
    && !/\bemails?\s+from\s+[A-Za-z@]/i.test(text)) return null;

  const patterns = [
    /\b(?:read|feed|ingest|fetch|get)\s+(?:all\s+)?emails?\s+from\s+(.+?)\s+from\s+(?:year\s+)?(?:\d{4}|\d{1,2}[\/\-])/i,
    /\b(?:read|feed|ingest|fetch|get)\s+(?:all\s+)?emails?\s+from\s+(.+?)\s+(?:into|to)\s+(?:continuum\s+)?memory/i,
    /\bfeed\s+(?:all\s+)?(?:emails?\s+from\s+)?["']?([^"'\n]+?)["']?\s+(?:emails?\s+)?to\s+(?:continuum|memory)/i,
    /\b(?:ingest|import|save|remember|store)\s+(?:all\s+)?(?:emails?\s+from\s+)?["']?([^"'\n]+?)["']?(?:\s+emails?)?\s+(?:to|into)\s+(?:continuum|memory)/i,
    /\bemails?\s+from\s+["']?([^"'\n]+?)["']?\s+from\s+(?:year\s+|\d{4}|\d{1,2}[\/\-])/i,
    /\b(?:from|by)\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
    /\bemails?\s+from\s+["']?([^"'\n,]+?)["']?(?:\s+(?:to|into)\s+(?:continuum|memory)|$)/i,
    /\b(?:from|by)\s+["']?([A-Za-z0-9@.\s+'-]{2,60}?)["']?(?:\s+'s|\s+emails?|\s+mail)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      let sender = match[1].trim();
      sender = sender.replace(/\s+(to|into|for)\s+(continuum|memory).*$/i, '').trim();
      sender = sender.replace(/\s+from\s+(?:year\s+)?.*$/i, '').trim();
      if (sender.length >= 2 && !looksLikeDateToken(sender)) return sender;
    }
  }
  return null;
}

function wantsSenderPersonaAnalysis(message) {
  const text = String(message || '');
  return /\b(persona|analyze|analysis|thinking|communication\s+style|psycholog)/i.test(text)
    && (parseSenderFromMessage(text) != null || /\b(?:her|his|their)\s+(?:thinking|persona|style)\b/i.test(text));
}

function wantsSequentialEmailIngest(message) {
  const text = String(message || '');
  return /\b(?:in\s+sequence|sequential(?:ly)?|chronolog(?:ical(?:ly)?)?|oldest[\s-]first|time\s+order)\b/i.test(text);
}

function wantsEmailMemoryIngest(message) {
  const text = String(message || '');
  if (wantsSenderPersonaAnalysis(text) && /\b(memory|continuum|remember|ingest|feed|into\s+memory)\b/i.test(text)) {
    return true;
  }
  return /\b(feed|ingest|import|add|save|remember|store|read\s+all)\b/i.test(text)
    && /\b(emails?|mail|inbox|messages?)\b/i.test(text)
    && /\b(continuum|memory|brain|into\s+memory)\b/i.test(text);
}

function imapSearchArgs(fetchOptions, sender, { chronological = false } = {}) {
  const args = [
    'search',
    '--from', sender,
    '--limit', String(fetchOptions.limit),
    '--sort', chronological ? 'date-asc' : 'date',
  ];
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
  wantsEmailMemoryIngest,
  wantsSenderPersonaAnalysis,
  wantsSequentialEmailIngest,
  imapSearchArgs,
};
