'use strict';

function wantsEmailQuoteSearch(message) {
  const text = String(message || '');
  if (parseQuoteSearchPhrase(text)) return true;
  return /\b(when\s+did\s+(?:she|he|they|min)|find\s+(?:the\s+)?email\s+(?:where|that|with)|which\s+email\s+(?:has|contains|said|mentions)|did\s+(?:she|he|they|min)\s+(?:say|write|send|mention))\b/i.test(text)
    && /[\u4e00-\u9fff]/.test(text);
}

function parseQuoteSearchPhrase(message) {
  const text = String(message || '');
  const patterns = [
    /["'「""]([^"'」""]{2,120})["'」""]/,
    /\bsay\s+(.+?)(?:\s+in\s+(?:the\s+)?(?:min\s+)?folder|\s+from\s+min|\?|$)/i,
    /\bsaid\s+(.+?)(?:\s+in\s+(?:the\s+)?(?:min\s+)?folder|\?|$)/i,
    /说\s*[「""']?([^「""'\?？]{2,80})/,
    /(?:phrase|words|line|sentence)\s+(.+?)(?:\s+in\s+|\?|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const phrase = match[1].trim().replace(/[?？。.!！]+$/, '').trim();
    if (phrase.length >= 2) return phrase;
  }
  return null;
}

function messageSearchBlob(msg) {
  const parts = [
    msg.subject,
    msg.snippet,
    msg.text,
    msg.preview,
    msg.html,
    msg.from?.text,
    msg.from,
  ];
  return parts.filter(Boolean).join('\n');
}

function searchMessagesForPhrase(messages, phrase) {
  if (!phrase || !Array.isArray(messages)) return [];
  const needle = phrase.trim();
  if (!needle) return [];
  const lowerNeedle = needle.toLowerCase();
  const matches = [];
  for (const msg of messages) {
    const blob = messageSearchBlob(msg);
    const stripped = blob.replace(/<[^>]+>/g, ' ');
    if (stripped.includes(needle) || stripped.toLowerCase().includes(lowerNeedle)) {
      matches.push(msg);
    }
  }
  return matches;
}

function formatQuoteSearchResults(phrase, matches, { totalScanned = 0, sender = null, mailbox = null } = {}) {
  const lines = [
    `[QUOTE SEARCH — phrase: "${phrase}"]`,
    `Scanned ${totalScanned} fetched email(s)${sender ? ` from ${sender}` : ''}${mailbox ? ` in mailbox "${mailbox}"` : ''}.`,
  ];
  if (matches.length === 0) {
    lines.push(
      `NOT FOUND: "${phrase}" does not appear verbatim in any fetched email subject or body preview.`,
      'Do NOT invent a date or UID. Say the phrase was not found in this batch.',
      'If the user expected it elsewhere, suggest widening the date range or searching INBOX + Min folder separately.',
    );
    return lines.join('\n');
  }
  lines.push(`FOUND ${matches.length} match(es):`);
  for (const msg of matches.slice(0, 20)) {
    const from = msg.from?.text || msg.from || 'Unknown';
    const subject = msg.subject || '(no subject)';
    const date = msg.headerDate || msg.date || msg.receivedDate || '(no date)';
    const uid = msg.uid != null ? String(msg.uid) : '?';
    lines.push(`- UID ${uid} | Date: ${date} | From: ${from} | Subject: ${subject}`);
  }
  if (matches.length > 20) {
    lines.push(`… and ${matches.length - 20} more match(es).`);
  }
  lines.push('Report ONLY these UID/date lines for this phrase — do not paraphrase or add other dates.');
  return lines.join('\n');
}

function computeEmailDateSpan(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const times = [];
  for (const msg of messages) {
    const raw = msg.headerDate || msg.date || msg.receivedDate;
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) times.push(t);
  }
  if (times.length === 0) return null;
  times.sort((a, b) => a - b);
  const earliest = new Date(times[0]).toISOString().slice(0, 10);
  const latest = new Date(times[times.length - 1]).toISOString().slice(0, 10);
  return { earliest, latest, count: messages.length, datedCount: times.length };
}

function formatEmailDateSpanBlock(span) {
  if (!span) return null;
  return [
    '[FETCHED EMAIL DATE SPAN]',
    `Earliest dated email in this batch: ${span.earliest}`,
    `Latest dated email in this batch: ${span.latest}`,
    `Emails in batch: ${span.count} (${span.datedCount} with parseable dates).`,
    'Do NOT describe emails, quotes, or relationship events outside this span unless they appear verbatim below.',
  ].join('\n');
}

module.exports = {
  wantsEmailQuoteSearch,
  parseQuoteSearchPhrase,
  searchMessagesForPhrase,
  formatQuoteSearchResults,
  computeEmailDateSpan,
  formatEmailDateSpanBlock,
};
