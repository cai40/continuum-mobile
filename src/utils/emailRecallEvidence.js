/**
 * Mobile bridge to shared/emailRecallEvidence (CommonJS).
 * Metro/Hermes cannot re-export named bindings from module.exports via `export { x } from`.
 */
const ev = require('../../shared/emailRecallEvidence.js');

export const resolveRecallMonthRange = ev.resolveRecallMonthRange;
export const needsTargetedRecallEvidenceFetch = ev.needsTargetedRecallEvidenceFetch;
export const buildTargetedRecallFetchMessage = ev.buildTargetedRecallFetchMessage;
export const resolveRecallEvidenceMessage = ev.resolveRecallEvidenceMessage;
export const extractUserRecallQuestion = ev.extractUserRecallQuestion;
export const parseRecallMonthFromMessage = ev.parseRecallMonthFromMessage;
export const buildRecallEvidencePrefix = ev.buildRecallEvidencePrefix;
export const buildUidDateIndex = ev.buildUidDateIndex;
export const hasMonthEvidenceInPersona = ev.hasMonthEvidenceInPersona;
export const findLatestPersonaAnalysisContent = ev.findLatestPersonaAnalysisContent;
