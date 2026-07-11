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

function resolvePriorEmailIntent(history) {
  const hist = Array.isArray(history) ? history : [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const row = hist[i];
    const content = String(row?.content || row?.message || '').trim();
    const role = String(row?.role || '').toLowerCase();
    if (role !== 'user' && role !== 'human') continue;
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
  return `${prior}\n\nUser confirmation: ${message}`;
}

module.exports = {
  isConfirmOnlyMessage,
  resolvePriorEmailIntent,
  buildEffectiveEmailMessage,
};
