/**
 * Chat intent detection for Slack: reading channels into memory and posting
 * messages. Mirrors the pattern used for email/photo intents.
 */

export function wantsSlackRead(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (!/\bslack\b/i.test(text)) return false;
  return /\b(?:read|check|show|what'?s|what\s+is|messages?|updates?|new|recent|ingest|load|fetch|see|catch|summarize|summary)\b/i.test(text);
}

export function wantsSlackPost(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (!/\bslack\b/i.test(text)) return false;
  return /\b(?:post|send|tell|message|announce|ping|write|share)\b/i.test(text);
}

/** Extract the channel name from "post X to #general on slack" / "#general". */
export function extractSlackChannel(message) {
  const text = String(message || '');
  const m = text.match(/#([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Extract the text to post: content after post/send + any "to #channel" removed. */
export function extractSlackPostText(message) {
  let text = String(message || '').trim();
  text = text.replace(/\b(?:please|can\s+you|could\s+you|would\s+you|you\s+should|go\s+ahead\s+and)\b/gi, ' ');
  text = text.replace(/\bpost\s+(?:this\s+)?(?:message\s+)?/i, '');
  text = text.replace(/\bsend\s+(?:this\s+)?(?:message\s+)?/i, '');
  text = text.replace(/to\s+#[A-Za-z0-9_-]+/i, '');
  text = text.replace(/on\s+slack/i, '');
  text = text.replace(/\bto\s+slack\b/i, '');
  text = text.replace(/\bin\s+slack\b/i, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/** Resolve a channel name from the message, with a default fallback. */
export function resolveSlackChannel(message, channels) {
  const fromMessage = extractSlackChannel(message);
  if (fromMessage) return fromMessage;
  const list = Array.isArray(channels) ? channels : [];
  if (list.length === 1) return list[0].name;
  return null;
}
