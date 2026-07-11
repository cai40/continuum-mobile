'use strict';

const { hasBulkActionConfirm } = require('./emailPermission');
const { wantsEmailFetch } = require('./emailFetchOptions');
const { isComposeEmailRequest } = require('./emailComposeIntent');

function isConfirmOnlyMessage(message) {
  const text = String(message || '').trim();
  if (!hasBulkActionConfirm(text)) return false;
  if (wantsEmailFetch(text)) return false;
  return text.length < 120;
}

function isSkippableConfirmContent(content) {
  const text = String(content || '').trim();
  return !text || isConfirmOnlyMessage(text);
}

/** Turn a preview cleanup chat message into the matching apply command. */
function previewCleanupToApplyMessage(prior) {
  const text = String(prior || '').trim();
  if (!/\bpreview\b/i.test(text) && !/\bdry\s*run\b/i.test(text)) return null;

  if (/^preview\s+email\s+cleanup\s+for\s+today$/i.test(text)) {
    return 'clean up today emails';
  }
  const month = text.match(/^preview\s+email\s+cleanup\s+for\s+([A-Za-z]+)\s+(20\d{2})$/i);
  if (month) {
    return `clean up ${month[1]} ${month[2]} emails`;
  }
  const range = text.match(/^preview\s+email\s+cleanup\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (range) {
    return `clean up emails from ${range[1]} to ${range[2]}`;
  }
  if (/^preview\s+email\s+cleanup\s+inbox$/i.test(text)) {
    return 'clean up inbox';
  }

  return text
    .replace(/^preview\s+email\s+cleanup\s+/i, 'clean up ')
    .replace(/\bdry\s*run\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolvePriorEmailIntent(history) {
  const hist = Array.isArray(history) ? history : [];
  const userMessages = [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const row = hist[i];
    const content = String(row?.content || row?.message || '').trim();
    const role = String(row?.role || '').toLowerCase();
    if (role !== 'user' && role !== 'human') continue;
    if (isSkippableConfirmContent(content)) continue;
    userMessages.push(content);
  }

  const preview = userMessages.find((content) => /\bpreview\s+email\s+cleanup\b/i.test(content));
  if (preview) return preview;

  for (const content of userMessages) {
    if (wantsEmailFetch(content)) return content;
    if (isComposeEmailRequest(content)) continue;
    if (/\b(clean|fetch|apr|april|inbox|emails?|yahoo|mail)\b/i.test(content)) return content;
  }
  return null;
}

function buildEffectiveEmailMessage(message, history) {
  if (!isConfirmOnlyMessage(message)) return message;
  const prior = resolvePriorEmailIntent(history);
  if (!prior) return message;

  const applyFromPreview = previewCleanupToApplyMessage(prior);
  if (applyFromPreview) return applyFromPreview;

  return `${prior}\n\nUser confirmation: ${message}`;
}

module.exports = {
  isConfirmOnlyMessage,
  previewCleanupToApplyMessage,
  resolvePriorEmailIntent,
  buildEffectiveEmailMessage,
};
