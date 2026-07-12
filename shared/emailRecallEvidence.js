'use strict';

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

const PERSONA_ANALYSIS_MARKERS =
  /\b(?:UID\s+\d+|SENDER PERSONA|ATTITUDE TIMELINE|Persona of Min|Phase\s+[123]|Fetched\s+\d+\s+REAL\s+email|287\s+emails?|Emails loaded|mailbox\s+"|Date filter:|Matched:\s*\d+|boundary emails)/i;

function utf8ByteLength(str) {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(String(str || ''), 'utf8');
  let bytes = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c < 0xd800 || c >= 0xe000) bytes += 3;
    else {
      bytes += 4;
      i += 1;
    }
  }
  return bytes;
}

function normalizeIsoDate(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const iso = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${String(parseInt(iso[2], 10)).padStart(2, '0')}-${String(parseInt(iso[3], 10)).padStart(2, '0')}`;
  }
  const named = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (!month) return null;
    return `${named[3]}-${String(month).padStart(2, '0')}-${String(parseInt(named[2], 10)).padStart(2, '0')}`;
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function parseRecallMonthFromMessage(message) {
  const text = String(message || '').trim();
  const monthPat = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  const patterns = [
    new RegExp(`\\b(?:in|during|from|for)\\s+(?:the\\s+)?(?:month\\s+of\\s+)?(${monthPat})\\s+(20\\d{2})\\b`, 'i'),
    new RegExp(`\\b(${monthPat})\\s+(20\\d{2})\\b`, 'i'),
    /\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    let year;
    let month;
    if (/^20\d{2}$/.test(match[1])) {
      year = parseInt(match[1], 10);
      month = parseInt(match[2], 10);
    } else {
      year = parseInt(match[2], 10);
      month = MONTHS[match[1].toLowerCase()];
    }
    if (!month || month < 1 || month > 12 || year < 1970 || year > 2100) continue;
    const since = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
    const before = `${next.y}-${String(next.m).padStart(2, '0')}-01`;
    const label = `${match[1].charAt(0).toUpperCase()}${String(match[1]).slice(1).toLowerCase()} ${year}`;
    return { since, before, label, year, month };
  }
  return null;
}

function buildUidDateIndex(text) {
  const source = String(text || '');
  const entries = [];
  const seen = new Set();

  const push = (uid, dateRaw, context) => {
    const iso = normalizeIsoDate(dateRaw);
    if (!uid || !iso) return;
    const key = `${uid}|${iso}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ uid: String(uid), date: iso, context: context?.slice(0, 240) || '' });
  };

  const pipeRe = /\bUID[:\s]+(\d{5,7})\s*\|\s*Date:\s*([^\n|]+)/gi;
  let m;
  while ((m = pipeRe.exec(source)) !== null) {
    push(m[1], m[2], m[0]);
  }

  const lineRe = /^.*\bUID[:\s]+(\d{5,7}).*?(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}).*$/gim;
  while ((m = lineRe.exec(source)) !== null) {
    const uid = m[1];
    const datePart = m[2];
    push(uid, datePart, m[0]);
  }

  const uidDateRe = /\bUID[:\s]+(\d{5,7})[^\n]{0,120}?(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})/gi;
  while ((m = uidDateRe.exec(source)) !== null) {
    push(m[1], m[2], m[0]);
  }

  entries.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
  return entries;
}

function formatUidDateIndex(entries, { title = 'UID + DATE INDEX (from prior analysis)', maxEntries = 80 } = {}) {
  if (!entries.length) return '';
  const lines = [title];
  for (const row of entries.slice(0, maxEntries)) {
    lines.push(`- UID ${row.uid} | Date: ${row.date}${row.context ? ` | ${row.context.replace(/\s+/g, ' ').trim()}` : ''}`);
  }
  if (entries.length > maxEntries) {
    lines.push(`… and ${entries.length - maxEntries} more indexed line(s).`);
  }
  return lines.join('\n');
}

function filterIndexByMonth(entries, monthRange) {
  if (!monthRange?.since || !monthRange?.before) return entries;
  return entries.filter((row) => row.date >= monthRange.since && row.date < monthRange.before);
}

function findLatestPersonaAnalysisContent(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    const content = String(row?.content || row?.message || '');
    const role = String(row?.role || '').toLowerCase();
    if ((role === 'assistant' || role === 'ai' || role === 'model')
      && PERSONA_ANALYSIS_MARKERS.test(content)) {
      return content;
    }
  }
  return '';
}

function hasMonthEvidenceInPersona(messages, monthRange) {
  const content = findLatestPersonaAnalysisContent(messages);
  if (!content) return false;
  const index = buildUidDateIndex(content);
  return filterIndexByMonth(index, monthRange).length > 0;
}

function resolveRecallMonthRange(message, messages) {
  let monthRange = parseRecallMonthFromMessage(message);
  if (monthRange) return monthRange;

  const hist = findLatestPersonaAnalysisContent(messages);
  if (hist) {
    monthRange = parseRecallMonthFromMessage(hist);
    if (monthRange) return monthRange;
  }

  const text = String(message || '');
  if (/\bboundary\b/i.test(text) && (/\b(?:min\s+zhang|min\s+folder|\u654f)\b/i.test(text) || /\bmin\b/i.test(text))) {
    return {
      since: '2026-04-01',
      before: '2026-05-01',
      label: 'April 2026',
      year: 2026,
      month: 4,
    };
  }
  return null;
}

function isExplicitFullEmailFetch(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (/\b(?:read|fetch|get|load|scan)\s+(?:all|every)\s+emails?\b/i.test(text)) return true;
  if (/\b(?:read|fetch|get|load|scan)\s+(?:all|every)\s+email\b/i.test(text)) return true;
  if (/\b(?:feed|ingest|import|load)\b/i.test(text)
    && /\b(?:continuum|memory|brain|into\s+memory|persona)\b/i.test(text)
    && /\b(?:emails?|mail|folder|min)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:persona|attitude|timeline)\b/i.test(text)
    && /\b(?:read|fetch|folder|from|since|202\d)\b/i.test(text)) {
    return true;
  }
  return false;
}

function needsTargetedRecallEvidenceFetch(message, messages) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (isExplicitFullEmailFetch(text)) return false;

  const isEmailRecall = /\b(?:what do you remember|cite\s+(?:the\s+)?(?:uid|uids)|uid\s+and\s+date|boundary|persona|timeline|evidence|proof)\b/i.test(text);
  const mentionsMin = /\b(?:min\s+zhang|min\s+folder|\u654f)\b/i.test(text) || /\bmin\b/i.test(text);
  const monthRange = resolveRecallMonthRange(text, messages);

  // Recall questions only — NOT "read every email from Min folder" (mentionsMin alone must not trigger).
  if (monthRange && isEmailRecall && (mentionsMin || /\bboundary\b/i.test(text))) {
    if (hasMonthEvidenceInPersona(messages, monthRange)) return false;
    return true;
  }

  if (!isEmailRecall) return false;
  if (!monthRange) return false;
  if (!findLatestPersonaAnalysisContent(messages)) return false;
  if (hasMonthEvidenceInPersona(messages, monthRange)) return false;
  return true;
}

function isClientRecallEnvelope(message) {
  return /\[(?:RECALL TURN STATUS|CONTINUUM MEMORY)/i.test(String(message || ''));
}

/** Strip client-side recall envelope blocks to recover the bare user question. */
function extractUserRecallQuestion(message) {
  const text = String(message || '').trim();
  if (!text) return '';

  const tagged = text.match(/User recall question:\s*([\s\S]+?)$/im);
  if (tagged) {
    const block = tagged[1].trim();
    const firstLine = block.split('\n')[0].trim();
    if (firstLine.length >= 12 && !/^\[/.test(firstLine)) return firstLine;
    const para = block.split('\n\n')[0].trim();
    if (para.length >= 12 && !/^\[/.test(para)) return para;
  }

  return text
    .replace(/^\[RECALL TURN STATUS\][\s\S]*?(?=\n\n\[CONTINUUM MEMORY|\n\nReturn every email|$)/im, '')
    .replace(/^\[CONTINUUM MEMORY[^\]]*\][\s\S]*?\n\n/im, '')
    .replace(/^Return every email[\s\S]*?User recall question:\s*/im, '')
    .trim() || text;
}

function buildTargetedRecallFetchMessage(message, monthRange) {
  const bareQuestion = extractUserRecallQuestion(message);
  const resolved = monthRange || resolveRecallMonthRange(bareQuestion, []);
  const monthLabel = resolved?.label || 'requested month';
  return [
    `Target month: ${monthLabel}. Return every email in that month with UID and Date cited.`,
    'Quote boundary-related subjects/previews verbatim.',
    'Do NOT rebuild the full 287-email persona — answer the recall question with UID + Date proof only.',
    'Do NOT write meta-commentary about missing data — use live inbox below and/or [CONTINUUM MEMORY].',
    'Do NOT say you are awaiting fetch completion — answer now from available evidence.',
    '',
    `User recall question: ${bareQuestion}`,
  ].join('\n');
}

function resolveRecallEvidenceMessage(originalMessage, history) {
  const text = String(originalMessage || '').trim();
  if (!text) return text;
  if (isClientRecallEnvelope(text)) return text;
  const bareQuestion = extractUserRecallQuestion(text);
  const monthRange = resolveRecallMonthRange(bareQuestion, history || []);
  return buildTargetedRecallFetchMessage(bareQuestion, monthRange);
}

function buildRecallEvidencePrefix(content, monthRange, maxBytes = 12000) {
  const index = buildUidDateIndex(content);
  const monthIndex = monthRange ? filterIndexByMonth(index, monthRange) : index;
  const chosen = monthIndex.length ? monthIndex : index;
  if (!chosen.length) return '';
  const block = formatUidDateIndex(chosen, {
    title: monthRange
      ? `UID + DATE INDEX (${monthRange.label} — extracted from prior persona analysis)`
      : 'UID + DATE INDEX (extracted from prior persona analysis)',
  });
  if (utf8ByteLength(block) > maxBytes) {
    return `${block.slice(0, Math.max(0, maxBytes - 24))}… [index truncated]`;
  }
  return block;
}

module.exports = {
  PERSONA_ANALYSIS_MARKERS,
  parseRecallMonthFromMessage,
  buildUidDateIndex,
  formatUidDateIndex,
  filterIndexByMonth,
  findLatestPersonaAnalysisContent,
  hasMonthEvidenceInPersona,
  resolveRecallMonthRange,
  needsTargetedRecallEvidenceFetch,
  isExplicitFullEmailFetch,
  isClientRecallEnvelope,
  extractUserRecallQuestion,
  buildTargetedRecallFetchMessage,
  resolveRecallEvidenceMessage,
  buildRecallEvidencePrefix,
};
