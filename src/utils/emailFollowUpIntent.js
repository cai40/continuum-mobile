/** Mirror bridge emailFollowUpIntent.js for client-side routing. */

import {
  needsTargetedRecallEvidenceFetch,
  buildTargetedRecallFetchMessage,
  parseRecallMonthFromMessage,
  resolveRecallMonthRange,
} from './emailRecallEvidence';
import { isExplicitFullEmailFetch, stripClientEmailEnvelope } from './emailRecallEvidence';

export {
  needsTargetedRecallEvidenceFetch,
  buildTargetedRecallFetchMessage,
  parseRecallMonthFromMessage,
  resolveRecallMonthRange,
  isExplicitFullEmailFetch,
  stripClientEmailEnvelope,
};

const ASSISTANT_EMAIL_ANALYSIS = /\b(?:UID\s+\d+|SENDER PERSONA|ATTITUDE TIMELINE|Persona of Min|Phase\s+[123]|Fetched\s+\d+\s+REAL\s+email|287\s+emails?|Emails loaded|mailbox\s+"|Date filter:|Matched:\s*\d+|boundary emails)/i;

export function isAnalysisRecallQuestion(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (/\bwhat do you remember\b/i.test(text)) return true;
  if (/\bfrom (?:chat|memory|prior|earlier|above|the prior)\b/i.test(text)) return true;
  if (/(?:cite|show|list|provide|verify|confirm|add)\s+(?:the\s+)?(?:uid|uids)(?:\s+and\s+date|\s*\+\s*date)?/i.test(text)) {
    return true;
  }
  if (/\buid\s+and\s+date\b/i.test(text)) return true;
  if (/\b(?:ground|evidence|proof|citation)\b/i.test(text)
    && /\b(?:quote|quotes|claim|timeline|analysis|persona|remember)\b/i.test(text)) {
    return true;
  }
  return false;
}

function isExplicitNewEmailFetch(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (isAnalysisRecallQuestion(text)) return false;
  if (/\b(?:clean\s*up|cleanup|clean)\b.*\b(?:emails?|inbox|mail|yahoo)\b/i.test(text)) return true;
  if (/\b(?:read|fetch|get|load|scan)\s+(?:all|every|\d+)\s+emails?\b/i.test(text)) return true;
  if (/\bfetch\s+and\s+clean\b/i.test(text)) return true;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:\d{4}\s+)?emails?\b/i.test(text)) return true;
  if (/\b(?:for|in|during)\s+(?:the\s+)?(?:whole\s+)?(?:year\s+)?(20\d{2})\b/i.test(text)
    && /\b(?:fetch|read|get|scan|clean|cleanup)\b/i.test(text)) return true;
  if (/\blimit\s+\d{3,}\b/i.test(text) && /\bemails?\b/i.test(text)) return true;
  if (/\bmin\s+folder\b/i.test(text) && /\b(?:read|fetch|get|from)\b/i.test(text)) return true;
  if (/\bwhen\s+did\b/i.test(text) && /[\u4e00-\u9fff]/.test(text)) return true;
  if (/\b(?:persona|attitude|timeline|psycholog)\b/i.test(text)
    && /\b(?:read|fetch|folder|from|since|202\d)\b/i.test(text)) return true;
  return false;
}

export function isEmailAnalysisFollowUp(message) {
  const text = String(message || '').trim();
  if (!text || text.length > 320) return false;
  if (isAnalysisRecallQuestion(text)) return true;
  if (isExplicitNewEmailFetch(text)) return false;

  if (/\b(?:revise|rewrite|expand|clarify|explain|summarize|elaborate)\b/i.test(text)
    && /\b(?:analysis|timeline|persona|attitude|above|prior|previous)\b/i.test(text)) {
    return true;
  }
  if (/[\u4e00-\u9fff]/.test(text) && /(?:引用|证据|uid|日期|上面|之前|刚才)/iu.test(text)) return true;
  if (/(?:心理分析|心理画像|人格分析|性格分析)/u.test(text) && !/\bmin\s+folder\b/i.test(text)) return true;
  if (/\b(?:persona|psycholog|attitude|timeline)\b/i.test(text)
    && !/\b(?:read|fetch|folder|from|since|202\d)\b/i.test(text)) return true;

  return false;
}

export function hasRecentEmailAnalysisContext(messages, maxLookback = 8) {
  const hist = Array.isArray(messages) ? messages.slice(-maxLookback) : [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const row = hist[i];
    const content = String(row?.content || '').trim();
    if (!content) continue;
    if (row.role === 'user') {
      if (/\b(?:read|fetch|persona|attitude|timeline|min\s+folder)\b/i.test(content)
        && /\b(?:emails?|mail|folder|min)\b/i.test(content)) {
        return true;
      }
      continue;
    }
    if (row.role === 'assistant' && ASSISTANT_EMAIL_ANALYSIS.test(content)) return true;
  }
  return false;
}

export function shouldSkipEmailFetchForFollowUp(message, messages) {
  if (needsTargetedRecallEvidenceFetch(message, messages)) return false;
  if (isAnalysisRecallQuestion(message)) return true;
  if (!isEmailAnalysisFollowUp(message)) return false;
  return hasRecentEmailAnalysisContext(messages);
}
