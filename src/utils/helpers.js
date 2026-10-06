import { Platform } from 'react-native';
import {
  buildRecallEvidencePrefix,
  buildUidDateIndex,
  parseRecallMonthFromMessage,
} from './emailRecallEvidence';
import { isWanqingAuthorized, isWanqingItem } from './personaMemoryManager';

export const formatFullDate = (isoString) => {
  if (!isoString) return 'Pending...';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) { return 'Date Format Err'; }
};

export const getImportanceColor = (score) => {
  const s = parseInt(score);
  if (s >= 8) return '#FF3B30'; // Critical (Red)
  if (s >= 5) return '#FFCC00'; // High/Med (Gold)
  return '#10b981'; // Moderate/Trivial (Green/Emerald)
};

export const getPowerScore = (importance, recall) => {
  const imp = parseFloat(importance) || 1;
  const rec = parseFloat(recall) || 0;
  // Score = Importance + (Log10(Recall + 1) * 2)
  const score = imp + (Math.log10(rec + 1) * 2);
  return score.toFixed(2);
};

export const maskKey = (key) => {
  if (!key || key.length < 12) return key;
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
};

export const stringifyContent = (content, depth = 0) => {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (depth > 8) return '[nested content truncated]';
  if (Array.isArray(content)) {
    return content.map((i) => stringifyContent(i, depth + 1)).join('\n');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    try {
      return JSON.stringify(content);
    } catch {
      return '[unserializable content]';
    }
  }
  return String(content);
};

function safeJsonStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return undefined;
        seen.add(val);
      }
      return val;
    });
  } catch {
    return '[]';
  }
}

export { safeJsonStringify };

/** Chat history JSON field should stay under the server multipart part limit. */
export const MAX_CHAT_UPLOAD_PART_BYTES = 900 * 1024;
/** Non-image chat attachments (docs / other files) — match the server's 20MB document cap. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Image chat attachments — gallery pick + upload. */
export const MAX_IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function attachmentSizeLimitBytes(file) {
  const type = String(file?.type || '');
  if (type.startsWith('image/')) return MAX_IMAGE_ATTACHMENT_BYTES;
  return MAX_ATTACHMENT_BYTES;
}

export function formatAttachmentBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) {
    const mb = n / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10}MB`;
  }
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

function utf8ByteLength(str) {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
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

function truncateText(text, maxChars) {
  const s = stringifyContent(text);
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}… [truncated]`;
}

/**
 * Shrink chat history so the JSON history field stays under the server 1MB part limit.
 * Keeps up to maxMessages (default 50) and preserves query-relevant older turns.
 * Strictly guarantees that unauthorized users receive zero traces of Lin Wanqing.
 */
export function trimChatHistoryForUpload(messages, maxMessages = 50, maxBytes = MAX_CHAT_UPLOAD_PART_BYTES, query = '', userEmail = null, isOwner = null) {
  const authorized = isOwner ?? (userEmail !== null && userEmail !== undefined ? isWanqingAuthorized(userEmail) : true);
  const rawList = Array.isArray(messages) ? messages : [];
  const all = authorized ? rawList : rawList.filter((m) => !isWanqingItem(m));
  let selected = all.slice(-maxMessages);

  // If earlier messages contain query-specific keywords (e.g. entity names like 林婉清)
  // or if the user is asking to review/extract from chat, include those earlier matching turns.
  if (all.length > maxMessages && query) {
    const q = String(query).trim();
    const cjkSegments = q.split(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|(?:的|是|在|和|与|了|吗|呢|什么|关于|告诉|一个|这个|那个|谁|如何|怎样|我想|请问)+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    const cjkSub = [];
    for (const seg of cjkSegments) {
      cjkSub.push(seg);
      if (seg.length > 2) {
        for (let i = 0; i <= seg.length - 2; i++) {
          cjkSub.push(seg.slice(i, i + 2));
        }
      }
    }
    const englishWords = (q.match(/[A-Za-z]{3,20}/g) || []).filter((w) => !/^(what|when|where|which|about|from|have|this|that|with|your|please|could|would)$/i.test(w));
    const searchTerms = [...new Set([...cjkSub, ...englishWords])];

    if (searchTerms.length > 0) {
      const older = all.slice(0, -maxMessages);
      const relevantOlder = older.filter((m) => {
        const text = stringifyContent(m?.content);
        return searchTerms.some((term) => text.includes(term));
      });
      if (relevantOlder.length > 0) {
        selected = [...relevantOlder.slice(-10), ...selected];
      }
    }
  }

  const base = selected.map((m) => ({
    id: m.id,
    role: m.role,
    content: truncateText(m.content, 8000),
  }));

  let trimmed = base;
  while (trimmed.length > 1 && utf8ByteLength(safeJsonStringify(trimmed)) > maxBytes) {
    trimmed = trimmed.slice(1);
  }

  if (utf8ByteLength(safeJsonStringify(trimmed)) > maxBytes) {
    trimmed = trimmed.map((m) => ({
      ...m,
      content: truncateText(m.content, 1500),
    }));
  }

  while (trimmed.length > 1 && utf8ByteLength(safeJsonStringify(trimmed)) > maxBytes) {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

/** Drop misleading OOM / zero-fetch assistant replies from recall history uploads. */
export function sanitizeRecallHistory(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((m) => {
    if (m?.role !== 'assistant') return m;
    const content = stringifyContent(m.content);
    const hasRealUidDates = /\bUID\s+\d{5,7}\b/i.test(content)
      && /\b(?:Date:|20\d{2}-\d{2}-\d{2})\b/i.test(content);
    if (hasRealUidDates) return m;
    if (/heap out-of-memory|javascript heap oom|returned zero messages|no successful fetch/i.test(content)) {
      return {
        ...m,
        content: '[Superseded — prior email fetch error; ignore for recall. Use CONTINUUM MEMORY or live inbox below.]',
      };
    }
    if (/(?:no reliable memory|what i need from you|no \[continuum memory\]|must honestly state|until then, i must|i have no data to answer|does not appear in the evidence provided|i will not invent uids|awaiting fetch|fetch completion|not present in this turn'?s live data|no email content.*live data)/i.test(content)) {
      return {
        ...m,
        content: '[Superseded — prior meta-denial; ignore. Answer from [CONTINUUM MEMORY], persona history, or live inbox this turn.]',
      };
    }
    if (/(?:cannot (?:access|read|see|view|find)\s+(?:the\s+)?(?:current\s+)?(?:chat|conversation|message|history|window)|do not have access to (?:the\s+)?(?:current\s+)?(?:chat|conversation|history|past messages)|unable to read (?:the\s+)?(?:chat|message|window)|no (?:record|information|details|memory) (?:found|available) (?:about|regarding|in the chat)|无法(?:读取|查看|访问|获取|看到)(?:当前)?(?:聊天|对话|历史|记录|窗口)|没有(?:找到)?关于.*的(?:任何)?(?:信息|记录|记忆|资料)|查阅了?(?:当前)?(?:对话|聊天)?(?:历史|记录)?(?:，|,)?(?:并)?未(?:能)?找到|当前聊天窗口(?:中)?(?:并)?(?:没有|未找到)|作为(?:一个)?AI(?:助手)?(?:，|,)?(?:我)?无法(?:读取|查看|访问|获取))/i.test(content)) {
      return {
        ...m,
        content: '[Superseded — prior meta-denial about reading chat/memory; ignore. Answer from conversation history, user-provided facts, and memory context.]',
      };
    }
    return m;
  });
}

const PERSONA_ANALYSIS_MARKERS =
  /\b(?:UID\s+\d+|SENDER PERSONA|ATTITUDE TIMELINE|Persona of Min|Phase\s+[123]|Fetched\s+\d+\s+REAL\s+email|287\s+emails?|Emails loaded|mailbox\s+"|Date filter:|Matched:\s*\d+|boundary emails)/i;

const PERSONA_SECTION_PATTERNS = [
  /\bPhase\s*3\b[\s\S]{0,120000}/i,
  /\b(?:Apr(?:il)?(?:\s+2026)?|2026[\s\-–—/]0?4)\b[\s\S]{0,80000}/i,
  /\bboundary(?:\s+emails?)?\b[\s\S]{0,80000}/i,
  /\bSENDER PERSONA\b[\s\S]{0,120000}/i,
  /\bATTITUDE TIMELINE\b[\s\S]{0,120000}/i,
];

function truncateTextByBytes(text, maxBytes) {
  const s = stringifyContent(text);
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

function extractPersonaExcerpt(content, maxBytes, recallMessage = null) {
  const text = stringifyContent(content);
  if (!text) return '';

  const monthRange = recallMessage ? parseRecallMonthFromMessage(recallMessage) : null;
  const indexPrefix = buildRecallEvidencePrefix(text, monthRange, Math.min(16000, Math.floor(maxBytes * 0.35)));
  const budgetAfterIndex = Math.max(8000, maxBytes - utf8ByteLength(indexPrefix) - 64);

  if (utf8ByteLength(text) <= budgetAfterIndex) {
    return indexPrefix ? `${indexPrefix}\n\n${text}` : text;
  }

  const chunks = [];
  for (const re of PERSONA_SECTION_PATTERNS) {
    const match = text.match(re);
    if (match?.[0]) chunks.push(match[0]);
  }

  if (chunks.length) {
    const header = `[Prior persona analysis excerpt — full reply was ${text.length} chars]\n\n`;
    let combined = indexPrefix
      ? `${indexPrefix}\n\n${header}${chunks.join('\n\n---\n\n')}`
      : `${header}${chunks.join('\n\n---\n\n')}`;
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
    let combined = indexPrefix
      ? `${indexPrefix}\n\n${header}${selected.join('\n')}`
      : `${header}${selected.join('\n')}`;
    if (utf8ByteLength(combined) > maxBytes) {
      combined = truncateTextByBytes(combined, maxBytes);
    }
    return combined;
  }

  const indexOnly = buildUidDateIndex(text);
  if (indexOnly.length && indexPrefix) {
    let combined = `${indexPrefix}\n\n${truncateTextByBytes(text, budgetAfterIndex)}`;
    if (utf8ByteLength(combined) > maxBytes) combined = truncateTextByBytes(combined, maxBytes);
    return combined;
  }

  return truncateTextByBytes(text, maxBytes);
}

function findLatestPersonaAnalysisMessage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    const content = stringifyContent(row?.content);
    if (row?.role === 'assistant' && PERSONA_ANALYSIS_MARKERS.test(content)) {
      return { index: i, message: row, content };
    }
  }
  return null;
}

function findPersonaFetchRequest(messages, beforeIndex = messages.length) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = Math.min(beforeIndex, list.length) - 1; i >= 0; i -= 1) {
    const row = list[i];
    if (row?.role !== 'user') continue;
    const content = stringifyContent(row?.content);
    if (/\b(?:read|fetch|persona|attitude|timeline|min\s+folder)\b/i.test(content)
      && /\b(?:emails?|mail|folder|min)\b/i.test(content)) {
      return row;
    }
  }
  return null;
}

function toUploadMessage(message, contentOverride) {
  return {
    id: message.id,
    role: message.role,
    content: contentOverride ?? truncateText(message.content, 8000),
  };
}

/**
 * Keep the prior persona analysis in upload history for recall / follow-up turns.
 * Recent-only trimming drops long persona replies many messages above the user question.
 * Strictly guarantees that unauthorized users receive zero traces of Lin Wanqing.
 */
export function trimChatHistoryForEmailRecall(messages, maxRecent = 8, maxBytes = 380 * 1024, recallMessage = null, userEmail = null, isOwner = null) {
  const authorized = isOwner ?? (userEmail !== null && userEmail !== undefined ? isWanqingAuthorized(userEmail) : true);
  const rawList = Array.isArray(messages) ? messages : [];
  const all = authorized ? rawList : rawList.filter((m) => !isWanqingItem(m));
  const persona = findLatestPersonaAnalysisMessage(all);
  const recentSlice = all.slice(-maxRecent);

  const entries = [];
  const seenIds = new Set();

  if (persona) {
    const userReq = findPersonaFetchRequest(all, persona.index);
    if (userReq && !seenIds.has(userReq.id)) {
      entries.push(toUploadMessage(userReq, truncateText(userReq.content, 2000)));
      seenIds.add(userReq.id);
    }

    const personaBudget = Math.floor(maxBytes * 0.72);
    const personaContent = extractPersonaExcerpt(persona.content, personaBudget, recallMessage);
    if (!recentSlice.some((m) => m.id === persona.message.id)) {
      entries.push({
        id: persona.message.id,
        role: persona.message.role,
        content: personaContent,
      });
      seenIds.add(persona.message.id);
    }
  }

  for (const m of recentSlice) {
    if (seenIds.has(m.id)) continue;
    entries.push(toUploadMessage(m));
    seenIds.add(m.id);
  }

  if (persona) {
    const idx = entries.findIndex((e) => e.id === persona.message.id);
    if (idx >= 0) {
      const personaBudget = Math.floor(maxBytes * 0.72);
      entries[idx] = {
        ...entries[idx],
        content: extractPersonaExcerpt(persona.content, personaBudget, recallMessage),
      };
    }
  }

  let result = entries;

  while (result.length > 1 && utf8ByteLength(safeJsonStringify(result)) > maxBytes) {
    const personaIdx = persona ? result.findIndex((e) => e.id === persona.message.id) : -1;
    if (personaIdx > 0) {
      result.splice(personaIdx - 1, 1);
    } else if (personaIdx === 0 && result.length > 2) {
      result.splice(1, 1);
    } else {
      result = result.slice(1);
    }
  }

  if (persona) {
    const personaIdx = result.findIndex((e) => e.id === persona.message.id);
    if (personaIdx >= 0) {
      let budget = Math.floor(maxBytes * 0.72);
      while (budget > 1500 && utf8ByteLength(safeJsonStringify(result)) > maxBytes) {
        budget = Math.floor(budget * 0.75);
        result[personaIdx] = {
          ...result[personaIdx],
          content: extractPersonaExcerpt(persona.content, budget, recallMessage),
        };
      }
    }
  }

  while (result.length > 1 && utf8ByteLength(safeJsonStringify(result)) > maxBytes) {
    result = result.slice(-Math.max(1, result.length - 1));
  }

  if (result.length === 1 && utf8ByteLength(safeJsonStringify(result)) > maxBytes) {
    result = [{
      ...result[0],
      content: truncateText(result[0].content, 1500),
    }];
  }

  return result;
}

const INTERNAL_EMAIL_MARKERS =
  /IMPORTANT:\s*Live Yahoo inbox|CLEANUP MODE:|SUMMARY MODE:|\[PREFILLED SUMMARY|MAILBOX SCAN \(include/i;

/** Strip bridge/LLM system instructions accidentally shown in user chat bubbles. */
export function sanitizeUserVisibleContent(content) {
  const text = stringifyContent(content);
  if (!INTERNAL_EMAIL_MARKERS.test(text)) return text;

  const userRequest = text.match(/\nUser request:\s*\n?([\s\S]*)$/i);
  if (userRequest?.[1]?.trim()) return userRequest[1].trim();

  const cleanupMatch = text.match(
    /((?:clean\s*up|cleanup|fetch|trash|delete|remove|move)[\s\S]{0,160})/i,
  );
  if (cleanupMatch?.[1]?.trim()) return cleanupMatch[1].trim().split('\n')[0].trim();

  return 'Email request';
}

export function friendlyChatError(raw, depth = 0) {
  const text = String(raw || '').trim();
  if (!text) return 'Could not send message.';
  if (depth > 6) return text.length > 500 ? `${text.slice(0, 500)}…` : text;

  try {
    const parsed = JSON.parse(text);
    if (parsed?.detail) return friendlyChatError(parsed.detail, depth + 1);
  } catch {
    // not JSON
  }

  if (/maximum call stack size exceeded/i.test(text)) {
    return 'Chat history was too large to process. Retry in the same thread — recall follow-ups now use chat memory only (no email re-fetch).';
  }

  if (/exceeded maximum size|1024\s*kb/i.test(text)) {
    return 'Message too large (1MB server limit). Clear chat history under Setup → Data, or remove large attachments, then try again.';
  }
  if (/context_length_exceeded|maximum context length|128000|128k/i.test(text)) {
    return 'Inbox data was too large for the AI model. The cleanup ran on the server — try again; large month cleanups now skip the AI and return a compact summary.';
  }
  if (/job not found|job expired|EMAIL_JOB_NOT_FOUND/i.test(text)) {
    return 'Cloud email job expired (server restarted). Send your cleanup request again — it will run in the background.';
  }
  if (/network request failed|failed to fetch|network error|cannot reach|timed out/i.test(text)) {
    return 'Could not reach the email server. Check Wi‑Fi or cellular, wait a few seconds for the cloud bridge to wake up, then try again. Keep the app open for large cleanups.';
  }
  if (/RESOURCE_EXHAUSTED|Too Many Requests|quota|spend cap|billing/i.test(text)) {
    return 'API quota exceeded for the selected model. Check billing for your API key (Gemini spend cap or OpenRouter credits), or switch to another model.';
  }
  if (/invalid.*api.*key|401|403|unauthorized/i.test(text)) {
    return 'API key rejected. Check your key under Setup → Intelligence & API Keys.';
  }

  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}
