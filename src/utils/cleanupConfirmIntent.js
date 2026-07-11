import { findPriorEmailUserMessage, isEmailConfirmMessage } from './openclawBridge';
import { findPriorPhotoUserMessage, isPhotoConfirmMessage } from './photoCleanupChat';

function matchesAny(text, patterns) {
  return patterns.some((re) => re instanceof RegExp && re.test(text));
}

/** e.g. "apply email", "proceed with inbox" */
export function isExplicitEmailConfirm(text) {
  const input = String(text || '').trim();
  if (input.length > 120) return false;
  return /\b(apply|proceed|yes|yeah|yep|ok(?:ay)?|confirm|go ahead|do it|run)\b/i.test(input)
    && /\b(emails?|inbox|mail|yahoo)\b/i.test(input);
}

/** e.g. "apply photo cleanup" */
export function isExplicitPhotoConfirm(text) {
  const input = String(text || '').trim();
  if (input.length > 120) return false;
  return /\b(apply|proceed|yes|ok(?:ay)?|confirm|go ahead|do it|run)\b/i.test(input)
    && /\b(photos?|pictures?|album|library)\b/i.test(input);
}

/** Short confirm after a dry-run preview (apply, yes, proceed, …). */
export function isGenericCleanupConfirm(text) {
  return isExplicitEmailConfirm(text)
    || isExplicitPhotoConfirm(text)
    || isEmailConfirmMessage(text)
    || isPhotoConfirmMessage(text);
}

function assistantPreviewKind(content) {
  const text = String(content || '');
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 40) return null;
  if (/^Photo cleanup stopped\.?$/i.test(trimmed)) return null;
  if (/^Cloud email cleanup stopped\.?$/i.test(trimmed)) return null;

  const emailPatterns = [
    /\bEMAIL CLEANUP PREVIEW\b/i,
    /\[\/?EMAIL CLEANUP PREVIEW/i,
    /\bpreview only\b/i,
    /\bnothing was moved to Trash\b/i,
    /\bwould move to Yahoo\b/i,
    /\bwould be moved to\b/i,
    /\bmoved to Yahoo\b/i,
    /\bMAILBOX SCAN\b/i,
    /\bEmails loaded for this reply\b/i,
    /\bcleanup targets in this batch\b/i,
    /\bProtected mail \(banks/i,
    /\bReply in chat with one word\b/i,
    /\bWhat to do next\b/i,
    /\bnever-trash senders\b/i,
    /\bdry-?run complete\b/i,
    /\bcleanup dry-?run\b/i,
    /\bmessage\(s\).*Trash\b/i,
  ];

  const photoPatterns = [
    /\bPhoto album cleanup\b/i,
    /\bno photos were deleted or favorited\b/i,
    /\bFinding duplicates\b/i,
    /\bContinuum Favorites\b/i,
    /\bduplicate.*coding screenshot/i,
    /\bcoding screenshots?\b/i,
  ];

  const email = matchesAny(text, emailPatterns);
  const photo = matchesAny(text, photoPatterns);

  if (email && !photo) return 'email';
  if (photo && !email) return 'photo';
  if (email && photo) {
    if (/\bEMAIL CLEANUP PREVIEW\b|\bwould move to Yahoo|\bWhat to do next\b/i.test(text)) return 'email';
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
  if (isExplicitEmailConfirm(text)) return 'email';
  if (isExplicitPhotoConfirm(text)) return 'photo';
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
  if (priorEmail && priorPhoto) return lastUserCleanupKind(messages) || 'email';
  return priorEmail ? 'email' : null;
}
