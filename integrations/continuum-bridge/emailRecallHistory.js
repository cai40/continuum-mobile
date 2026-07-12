'use strict';

const PERSONA_ANALYSIS_MARKERS =
  /\b(?:UID\s+\d+|SENDER PERSONA|ATTITUDE TIMELINE|Persona of Min|Phase\s+[123]|Fetched\s+\d+\s+REAL\s+email|287\s+emails?|Emails loaded|mailbox\s+"|Date filter:|Matched:\s*\d+|boundary emails)/i;

const PERSONA_SECTION_PATTERNS = [
  /\bPhase\s*3\b[\s\S]{0,120000}/i,
  /\b(?:Apr(?:il)?(?:\s+2026)?|2026[\s\-–—/]0?4)\b[\s\S]{0,80000}/i,
  /\bboundary(?:\s+emails?)?\b[\s\S]{0,80000}/i,
  /\bSENDER PERSONA\b[\s\S]{0,120000}/i,
  /\bATTITUDE TIMELINE\b[\s\S]{0,120000}/i,
];

function utf8ByteLength(str) {
  return Buffer.byteLength(String(str || ''), 'utf8');
}

function truncateTextByBytes(text, maxBytes) {
  const s = String(text || '');
  if (utf8ByteLength(s) <= maxBytes) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (utf8ByteLength(s.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}… [truncated]`;
}

function extractPersonaExcerpt(content, maxBytes) {
  const text = String(content || '');
  if (!text) return '';
  if (utf8ByteLength(text) <= maxBytes) return text;

  const chunks = [];
  for (const re of PERSONA_SECTION_PATTERNS) {
    const match = text.match(re);
    if (match?.[0]) chunks.push(match[0]);
  }

  if (chunks.length) {
    const header = `[Prior persona analysis excerpt — full reply was ${text.length} chars]\n\n`;
    let combined = `${header}${chunks.join('\n\n---\n\n')}`;
    if (utf8ByteLength(combined) > maxBytes) {
      combined = truncateTextByBytes(combined, maxBytes);
    }
    return combined;
  }

  const uidBlocks = text.split(/(?=\bUID\s+\d+)/i).filter((b) => /\bUID\s+\d+/i.test(b));
  const aprilBlocks = uidBlocks.filter((b) =>
    /\b(?:Apr(?:il)?|2026[\s\-–—/]0?4|2026-04)\b/i.test(b) || /\bboundary\b/i.test(b),
  );
  const selected = (aprilBlocks.length ? aprilBlocks : uidBlocks).slice(0, 40);
  if (selected.length) {
    const header = `[Prior persona analysis (UID excerpts) — full reply was ${text.length} chars]\n\n`;
    let combined = `${header}${selected.join('\n')}`;
    if (utf8ByteLength(combined) > maxBytes) {
      combined = truncateTextByBytes(combined, maxBytes);
    }
    return combined;
  }

  return truncateTextByBytes(text, maxBytes);
}

function findLatestPersonaAnalysisMessage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    const content = String(row?.content || row?.message || '');
    const role = String(row?.role || '').toLowerCase();
    if ((role === 'assistant' || role === 'ai' || role === 'model')
      && PERSONA_ANALYSIS_MARKERS.test(content)) {
      return { index: i, message: row, content };
    }
  }
  return null;
}

function slimHistoryForEmailRecall(history, maxRecent = 8, maxBytes = 380 * 1024) {
  const all = Array.isArray(history) ? history : [];
  const persona = findLatestPersonaAnalysisMessage(all);
  const recentSlice = all.slice(-maxRecent);
  const entries = [];
  const seen = new Set();

  const push = (row, content) => {
    const id = row?.id || `${row?.role}-${entries.length}`;
    if (seen.has(id)) return;
    entries.push({
      role: row?.role || 'user',
      content: String(content ?? row?.content ?? row?.message ?? '').slice(0, 8000),
    });
    seen.add(id);
  };

  if (persona) {
    const personaBudget = Math.floor(maxBytes * 0.72);
    const personaContent = extractPersonaExcerpt(persona.content, personaBudget);
    const personaId = persona.message?.id || 'persona-analysis';
    if (!recentSlice.some((m) => m?.id === persona.message?.id)) {
      entries.push({ role: 'assistant', content: personaContent });
      seen.add(personaId);
    }
  }

  for (const row of recentSlice) {
    const id = row?.id || `${row?.role}-${entries.length}`;
    if (seen.has(id)) {
      if (persona && row?.id === persona.message?.id) {
        const idx = entries.findIndex((e) => e.role === 'assistant' && PERSONA_ANALYSIS_MARKERS.test(e.content));
        if (idx >= 0) {
          entries[idx].content = extractPersonaExcerpt(
            persona.content,
            Math.floor(maxBytes * 0.72),
          );
        }
      }
      continue;
    }
    let content = String(row?.content || row?.message || '');
    if (persona && row?.id === persona.message?.id) {
      content = extractPersonaExcerpt(persona.content, Math.floor(maxBytes * 0.72));
    } else {
      content = content.slice(0, 8000);
    }
    push(row, content);
  }

  let result = entries;
  while (result.length > 1 && utf8ByteLength(JSON.stringify(result)) > maxBytes) {
    result = result.slice(1);
  }

  return result.map((m) => ({
    role: m.role || 'user',
    content: String(m.content || '').slice(0, 8000),
  }));
}

module.exports = {
  slimHistoryForEmailRecall,
};
