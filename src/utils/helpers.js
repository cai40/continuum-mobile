import { Platform } from 'react-native';

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

export const stringifyContent = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(i => stringifyContent(i)).join('\n');
  if (typeof content === 'object' && content !== null) return content.text || JSON.stringify(content);
  return String(content);
};

/** Backend multipart limit is 1024KB per form field. */
export const MAX_CHAT_UPLOAD_PART_BYTES = 900 * 1024;
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;

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
 */
export function trimChatHistoryForUpload(messages, maxMessages = 20, maxBytes = MAX_CHAT_UPLOAD_PART_BYTES) {
  const base = (Array.isArray(messages) ? messages : [])
    .slice(-maxMessages)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: truncateText(m.content, 8000),
    }));

  let trimmed = base;
  while (trimmed.length > 1 && utf8ByteLength(JSON.stringify(trimmed)) > maxBytes) {
    trimmed = trimmed.slice(1);
  }

  if (utf8ByteLength(JSON.stringify(trimmed)) > maxBytes) {
    trimmed = trimmed.map((m) => ({
      ...m,
      content: truncateText(m.content, 1500),
    }));
  }

  while (trimmed.length > 1 && utf8ByteLength(JSON.stringify(trimmed)) > maxBytes) {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
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

export function friendlyChatError(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'Could not send message.';

  try {
    const parsed = JSON.parse(text);
    if (parsed?.detail) return friendlyChatError(parsed.detail);
  } catch {
    // not JSON
  }

  if (/exceeded maximum size|1024\s*kb/i.test(text)) {
    return 'Message too large (1MB server limit). Clear chat history under Setup → Data, or remove large attachments, then try again.';
  }
  if (/RESOURCE_EXHAUSTED|Too Many Requests|quota|spend cap|billing/i.test(text)) {
    return 'API quota exceeded for the selected model. Check billing for your API key (Gemini spend cap or OpenRouter credits), or switch to another model.';
  }
  if (/invalid.*api.*key|401|403|unauthorized/i.test(text)) {
    return 'API key rejected. Check your key under Setup → Intelligence & API Keys.';
  }

  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}
