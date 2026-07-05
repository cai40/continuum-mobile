'use strict';

function parseSenderFromMessage(message) {
  const text = String(message || '');
  const patterns = [
    /\bfeed\s+(?:all\s+)?(?:emails?\s+from\s+)?["']?([^"'\n,]+?)["']?\s+(?:emails?\s+)?to\s+(?:continuum|memory)/i,
    /\b(?:ingest|import|save|remember|store)\s+(?:all\s+)?(?:emails?\s+from\s+)?["']?([^"'\n,]+?)["']?(?:\s+emails?)?\s+(?:to|into)\s+(?:continuum|memory)/i,
    /\bemails?\s+from\s+["']?([^"'\n,]+?)["']?(?:\s|$|,|\.)/i,
    /\b(?:from|by)\s+["']?([A-Za-z0-9@.\s+'-]{2,60}?)["']?(?:\s+'s|\s+emails?|\s+mail)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const sender = match[1].trim().replace(/\s+(to|into|for)\s+.*$/i, '').trim();
      if (sender.length >= 2) return sender;
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
    '--recent', fetchOptions.recent,
    '--sort', 'date',
  ];
  if (fetchOptions.since) {
    args.push('--since', fetchOptions.since);
    if (fetchOptions.before) args.push('--before', fetchOptions.before);
  } else {
    args.push('--recent', fetchOptions.recent);
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
