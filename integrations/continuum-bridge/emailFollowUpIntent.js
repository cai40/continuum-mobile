'use strict';

const { parseDateRangeFromMessage } = require('./emailDateRange');
const { parseLimitFromMessage } = require('./emailFetchOptions');
const { wantsEmailCleanup, wantsEmailDelete, wantsEmailCleanupPreview } = require('./emailDelete');
const { wantsEmailMoveToFolder, wantsEmailCopyFolderToInbox } = require('./emailMove');
const { wantsEmailQuoteSearch } = require('./emailQuoteSearch');
const { parseMailboxFromMessage } = require('./emailFolderParse');
const { isPersonaFetchIntent, resolvePriorEmailIntent } = require('./emailConfirmIntent');
const { wantsSenderPersonaAnalysis, wantsChinesePersonaAnalysis } = require('./emailSender');

const ASSISTANT_EMAIL_ANALYSIS = /\b(?:UID\s+\d+|SENDER PERSONA|ATTITUDE TIMELINE|Fetched\s+\d+\s+REAL\s+email|Emails loaded|mailbox\s+"|Date filter:|Matched:\s*\d+)/i;

function isExplicitNewEmailFetch(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (wantsEmailCleanup(text) || wantsEmailDelete(text) || wantsEmailCleanupPreview(text)) return true;
  if (wantsEmailMoveToFolder(text) || wantsEmailCopyFolderToInbox(text)) return true;
  if (parseDateRangeFromMessage(text)) return true;
  if (parseLimitFromMessage(text) != null && /\bemails?\b/i.test(text)) return true;
  if (/\b(?:read|fetch|get|load|scan)\s+(?:all|every|\d+)\s+emails?\b/i.test(text)) return true;
  if (/\b(?:clean\s*up|cleanup|clean)\b.*\b(?:emails?|inbox|mail|yahoo)\b/i.test(text)) return true;
  if (/\bfetch\s+and\s+clean\b/i.test(text)) return true;
  if (parseMailboxFromMessage(text) && /\b(?:read|fetch|get|from|folder)\b/i.test(text)) return true;
  if (wantsEmailQuoteSearch(text)) return true;
  if (wantsSenderPersonaAnalysis(text) && /\b(?:from|folder|since|202\d|read|fetch)\b/i.test(text)) return true;
  return false;
}

function isEmailAnalysisFollowUp(message) {
  const text = String(message || '').trim();
  if (!text || text.length > 320) return false;
  if (isExplicitNewEmailFetch(text)) return false;

  if (/(?:cite|show|add|include|need|give|list|provide|verify|confirm)\s+(?:the\s+)?(?:uid|uids)(?:\s+and\s+date|\s*\+\s*date)?/i.test(text)) {
    return true;
  }
  if (/\buid\s+and\s+date\b/i.test(text)) return true;
  if (/\b(?:ground|evidence|proof|citation|source)\b/i.test(text)
    && /\b(?:quote|quotes|claim|timeline|analysis|persona)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:revise|rewrite|expand|clarify|explain|summarize|elaborate)\b/i.test(text)
    && /\b(?:analysis|timeline|persona|attitude|above|prior|previous)\b/i.test(text)) {
    return true;
  }
  if (/[\u4e00-\u9fff]/.test(text) && /(?:引用|证据|uid|日期|上面|之前|刚才)/iu.test(text)) return true;

  if (wantsChinesePersonaAnalysis(text) && !parseMailboxFromMessage(text)) return true;
  if (wantsSenderPersonaAnalysis(text) && !/\b(?:read|fetch|get|folder|from|since|202\d)\b/i.test(text)) return true;
  if (/[\u4e00-\u9fff]/.test(text) && /(?:心理|人格|性格|态度|分析)/u.test(text) && !parseMailboxFromMessage(text)) {
    return true;
  }

  return false;
}

function hasRecentEmailAnalysisContext(history, maxLookback = 8) {
  const hist = Array.isArray(history) ? history.slice(-maxLookback) : [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const row = hist[i];
    const content = String(row?.content || row?.message || '').trim();
    if (!content) continue;
    const role = String(row?.role || '').toLowerCase();
    if (role === 'user' || role === 'human') {
      if (isPersonaFetchIntent(content)) return true;
      if (/\b(?:read|fetch|persona|attitude|timeline|min\s+folder)\b/i.test(content)
        && /\b(?:emails?|mail|folder|min)\b/i.test(content)) {
        return true;
      }
      continue;
    }
    if (role === 'assistant' || role === 'ai' || role === 'model') {
      if (ASSISTANT_EMAIL_ANALYSIS.test(content)) return true;
    }
  }
  return false;
}

function shouldSkipEmailFetch(message, history) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (isExplicitNewEmailFetch(text)) return false;
  if (!hasRecentEmailAnalysisContext(history)) return false;
  return isEmailAnalysisFollowUp(text);
}

function buildFollowUpChatMessage(message, history) {
  const prior = resolvePriorEmailIntent(history);
  return [
    'FOLLOW-UP (no new IMAP fetch): The emails were already analyzed in chat history above.',
    'Answer using ONLY that prior analysis and any UID/Date citations already present.',
    'Do NOT invent quotes — if evidence is missing from the prior reply, say so and ask whether to re-scan.',
    prior ? `Original email request (context only): ${prior.slice(0, 600)}` : null,
    '',
    'User follow-up:',
    message,
  ].filter(Boolean).join('\n');
}

module.exports = {
  isExplicitNewEmailFetch,
  isEmailAnalysisFollowUp,
  hasRecentEmailAnalysisContext,
  shouldSkipEmailFetch,
  buildFollowUpChatMessage,
};
