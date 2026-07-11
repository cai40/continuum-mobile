/** Mirror bridge emailComposeIntent.js for client-side routing. */

const INBOX_SIGNAL = /\b(?:inbox|yahoo|unread|imap|smtp|fetch|cleanup|clean\s*up|cleaning\s+up|trash|junk|spam|delete|remove|move|triage|newsletter|promo|summarize|summary|unseen|batch|page|offset|skip|uid|declutter|my\s+emails?|the\s+emails?|today\s+emails?|this\s+week(?:'?s)?\s+emails?|this\s+month(?:'?s)?\s+emails?)\b/i;

const MONTH_EMAIL = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:\d{4}\s+)?emails?\b/i;

export function isComposeEmailRequest(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (!/\bemails?\b|\bmail\b/i.test(text)) return false;

  if (INBOX_SIGNAL.test(text)) return false;
  if (MONTH_EMAIL.test(text)) return false;
  if (/\b(?:my|the)\s+(?:emails?|inbox|mail)\b/i.test(text)) return false;
  if (/\bemails?\s+\d{1,4}\s*[-–]\s*\d{1,4}\b/i.test(text)) return false;
  if (/\b(?:delete|remove|trash|move)\b.*\b(?:emails?|mail|inbox)\b/i.test(text)) return false;
  if (/\b(?:clean\s*up|cleanup|clean)\b.*\b(?:emails?|inbox|mail|yahoo)\b/i.test(text)) return false;
  if (/\bemails?\s+to\s+(?:trash|junk|spam|folder|archive|inbox|the\s+trash)\b/i.test(text)) return false;

  if (/\b(?:send|draft|write|compose|reply)\b[\s\S]{0,100}\b(?:an?\s+)?emails?\b/i.test(text)) return true;
  if (/\b(?:send|draft|write|compose)\b[\s\S]{0,60}\b(?:an?\s+)?mail\b/i.test(text)
    && !/\bmail\s+(?:server|bridge|inbox)\b/i.test(text)) {
    return true;
  }
  if (/\bemails?\s+(?:to|for)\s+(?!trash|junk|spam|folder|archive|inbox)[\w@]/i.test(text)) return true;
  if (/\bemail\s+(?!to\s+(?:trash|junk|spam|folder|archive|inbox))[\w@][\w@.'-]*/i.test(text)) return true;

  return false;
}
