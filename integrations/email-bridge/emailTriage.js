'use strict';

const path = require('path');

let classifier;
try {
  classifier = require(path.join(__dirname, '../../skills/email-triage/scripts/classifier'));
} catch {
  classifier = require('../../skills/email-triage/scripts/classifier');
}

const {
  triageMessages,
  selectJunkUids,
  formatTriageReport,
  classifyEmail,
} = classifier;

function wantsTriage(message) {
  return /\b(triage|classify|categorize|select junk|junk candidates|which.*junk|flag spam)\b/i.test(message || '');
}

function buildTriageContext(messages, message) {
  const triaged = triageMessages(messages);
  const includeGithub = !/\b(keep|exclude|without|no)\s+github\b/i.test(message || '');
  const { uids: junkUids } = selectJunkUids(messages, { includeGithub });

  return {
    report: formatTriageReport(triaged),
    triaged,
    junkUids,
    junkCount: junkUids.length,
  };
}

module.exports = {
  wantsTriage,
  buildTriageContext,
  triageMessages,
  selectJunkUids,
  formatTriageReport,
  classifyEmail,
};
