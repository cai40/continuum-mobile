import { findPriorEmailUserMessage, isEmailConfirmMessage } from './openclawBridge';
import { findPriorPhotoUserMessage, isPhotoConfirmMessage } from './photoCleanupChat';

/** Short confirm after a dry-run preview (apply, yes, proceed, …). */
export function isGenericCleanupConfirm(text) {
  return isEmailConfirmMessage(text) || isPhotoConfirmMessage(text);
}

function assistantPreviewKind(content) {
  const text = String(content || '');
  if (!text) return null;

  const emailSignals = [
    /\bEMAIL CLEANUP PREVIEW\b/i,
    /\bnothing was moved to Trash\b/i,
    /\bmoved to Yahoo\s+\*?\*?Trash\*?\*?/i,
    /\bMAILBOX SCAN\b/i,
    /\bEmails loaded for this reply\b/i,
    /\bcleanup targets in this batch\b/i,
    /\bProtected mail \(banks/i,
    /\bReply in chat with one word\b/i.test(text) && /\bTrash\b/i.test(text),
  ].some(Boolean);

  const photoSignals = [
    /\bPhoto album cleanup\b/i,
    /\bno photos were deleted or favorited\b/i,
    /\bFinding duplicates\b/i,
    /\bContinuum Favorites\b/i.test(text) && /\bpreview only\b/i.test(text),
    /\bduplicate.*coding screenshot/i.test(text),
  ].some(Boolean);

  if (emailSignals && !photoSignals) return 'email';
  if (photoSignals && !emailSignals) return 'photo';
  if (emailSignals && photoSignals) {
    if (/\bEMAIL CLEANUP PREVIEW\b/i.test(text)) return 'email';
    if (/\bPhoto album cleanup\b/i.test(text)) return 'photo';
  }
  return null;
}

function lastUserCleanupKind(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row?.role !== 'user') continue;
    const text = String(row.content || '').trim();
    if (!text || isGenericCleanupConfirm(text)) continue;
    if (/\b(clean\s*up|cleanup)\b.*\b(emails?|inbox|mail|yahoo)\b/i.test(text)) return 'email';
    if (/\b(?:preview|apply)\s+email/i.test(text)) return 'email';
    if (/\b(clean\s*up|cleanup)\b.*\b(photos?|pictures?|album|library)\b/i.test(text)) return 'photo';
    if (/\b(?:preview|apply)\s+photo/i.test(text)) return 'photo';
  }
  return null;
}

/**
 * When the user sends a bare confirm (e.g. "apply"), pick email vs photo cleanup
 * from the most recent dry-run preview in chat — not both at once.
 * @returns {'email' | 'photo' | null}
 */
export function resolveConfirmCleanupKind(messages, text) {
  if (!isGenericCleanupConfirm(text)) return null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row?.role !== 'assistant') continue;
    const kind = assistantPreviewKind(row.content);
    if (kind) return kind;
  }

  const priorEmail = findPriorEmailUserMessage(messages);
  const priorPhoto = findPriorPhotoUserMessage(messages);
  if (priorEmail && !priorPhoto) return 'email';
  if (priorPhoto && !priorEmail) return 'photo';
  if (priorEmail && priorPhoto) return lastUserCleanupKind(messages);
  return null;
}
