/**
 * Email / SMS / text draft requests: separate copy-ready bubble in chat.
 */

export const DRAFT_OUTPUT_APPEND = [
  'DRAFT / MESSAGE MODE: The user wants copy-ready email or text content.',
  'Format your reply EXACTLY like this:',
  '(1) Optional ONE short intro sentence only, then a blank line.',
  '(2) [COPY_DRAFT_START] on its own line.',
  '(3) ONLY the raw draft inside the markers — Subject: line + body for email; message body for texts. Plain text, no markdown fences, no commentary inside.',
  '(4) [COPY_DRAFT_END] on its own line.',
  '(5) Optional one-line tip after the end marker (e.g. "Copy into Mail or Messages.").',
  'Never put "Here is your draft" or explanations inside [COPY_DRAFT_START]…[COPY_DRAFT_END].',
].join(' ');

const COMMENTARY_LINE = /^(let me know|feel free|copy and paste|hope this helps|you can edit|i hope|note:|tip:)/i;

export function wantsDraftOutput(message) {
  const text = String(message || '').trim();
  if (!text) return false;

  if (/\b(?:send|draft|write|compose|reply)\b[\s\S]{0,100}\b(?:an?\s+)?emails?\b/i.test(text)) return true;
  if (/\b(?:send|draft|write|compose)\b[\s\S]{0,60}\b(?:an?\s+)?mail\b/i.test(text)
    && !/\bmail\s+(?:server|bridge|inbox)\b/i.test(text)) {
    return true;
  }
  if (/\bemails?\s+(?:to|for)\s+(?!trash|junk|spam|folder|archive|inbox)/i.test(text)) return true;
  if (/\bemail\s+(?!to\s+(?:trash|junk|spam|folder|archive|inbox))[\w@]/i.test(text)) return true;

  if (/\b(?:draft|write|compose)\b[\s\S]{0,80}\b(?:text|sms|imessage|message|note|letter)\b/i.test(text)) return true;
  if (/\b(?:text|sms|message)\b[\s\S]{0,40}\b(?:to|for)\b/i.test(text)
    && /\b(?:draft|write|compose|send)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:draft|write)\s+(?:me\s+)?(?:an?\s+)?(?:email|text|sms|message|reply|response)\b/i.test(text)) return true;

  return false;
}

function stripTrailingCommentary(draft) {
  const lines = String(draft || '').split('\n');
  while (lines.length > 1 && COMMENTARY_LINE.test(lines[lines.length - 1].trim())) {
    lines.pop();
  }
  return lines.join('\n').trim();
}

function splitMarkedDraft(raw) {
  const match = raw.match(/\[COPY_DRAFT_START\]\s*([\s\S]*?)\s*\[COPY_DRAFT_END\]/i);
  if (!match) return null;
  const draft = stripTrailingCommentary(match[1].trim());
  if (!draft) return null;
  const before = raw.slice(0, match.index).trim();
  const after = raw.slice(match.index + match[0].length).trim();
  const intro = [before, after].filter(Boolean).join('\n\n').trim() || null;
  return { intro, draft };
}

function splitEmailDraftFallback(raw) {
  const subjectIdx = raw.search(/^Subject:/im);
  if (subjectIdx < 0) return null;
  const draft = stripTrailingCommentary(raw.slice(subjectIdx).trim());
  if (!draft) return null;
  let intro = raw.slice(0, subjectIdx).trim();
  intro = intro.replace(/Here['']s[^.\n]*[.:]?\s*$/i, '').trim();
  return { intro: intro || null, draft };
}

function splitParagraphDraftFallback(raw) {
  const parts = raw.split(/\n\n+/);
  if (parts.length < 2) return null;
  if (parts[0].length > 200) return null;
  const draft = stripTrailingCommentary(parts.slice(1).join('\n\n').trim());
  if (!draft || draft.length < 8) return null;
  return { intro: parts[0].trim(), draft };
}

/**
 * @returns {{ intro: string|null, draft: string }|null}
 */
export function splitDraftForCopy(text, { requestedDraft = false } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const marked = splitMarkedDraft(raw);
  if (marked) return marked;

  if (!requestedDraft) return null;

  return splitEmailDraftFallback(raw) || splitParagraphDraftFallback(raw);
}

export function buildDraftAssistantMessages(finalText, { requestedDraft = false, baseId = Date.now() } = {}) {
  const split = splitDraftForCopy(finalText, { requestedDraft });
  if (!split?.draft) {
    return [{ id: `${baseId}-reply`, role: 'assistant', content: finalText }];
  }
  const out = [];
  if (split.intro) {
    out.push({ id: `${baseId}-intro`, role: 'assistant', content: split.intro });
  }
  out.push({
    id: `${baseId}-draft`,
    role: 'assistant',
    content: split.draft,
    copyDraft: true,
  });
  return out;
}
