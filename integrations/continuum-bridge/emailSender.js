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
  if (/\b(?:from|between)\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i.test(text)) return null;
  if (/\b(?:from|between)\s+[a-z]+\s+\d{1,2},?\s+\d{4}/i.test(text)) return null;

  const patterns = [
    /\bfeed\s+(?:all\s+)?(?:emails?\s+from\s+)?["']?([^"'\n,]+?)["']?\s+(?:emails?\s+)?to\s+(?:continuum|memory)/i,
    /\b(?:ingest|import|save|remember|store)\s+(?:all\s+)?(?:emails?\s+from\s+)?["']?([^"'\n,]+?)["']?(?:\s+emails?)?\s+(?:to|into)\s+(?:continuum|memory)/i,
    /\bemails?\s+from\s+["']?([^"'\n,]+?)["']?(?:\s|$|,)/i,
    /\b(?:from|by)\s+["']?([A-Za-z0-9@.\s+'-]{2,60}?)["']?(?:\s+'s|\s+emails?|\s+mail)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const sender = match[1].trim().replace(/\s+(to|into|for)\s+.*$/i, '').trim();
      if (sender.length >= 2 && !looksLikeDateToken(sender)) return sender;
    }
  }
  return null;
}

function wantsEmailMemoryIngest(message) {
  const text = String(message || '');
  return /\b(feed|ingest|import|add|save|remember|store)\b/i.test(text)
    && /\b(emails?|mail|inbox|messages?)\b/i.test(text)
    && /\b(continuum|memory|brain)\b/i.test(text);
}

function imapSearchArgs(fetchOptions, sender) {
  const args = [
    'search',
    '--from', sender,
    '--limit', String(fetchOptions.limit),
    '--sort', 'date',
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
  imapSearchArgs,
};
