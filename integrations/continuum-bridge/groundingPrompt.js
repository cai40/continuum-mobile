'use strict';

const path = require('path');
const fs = require('fs');

const promptPath = path.join(__dirname, '../../shared/grounding-prompt.json');
const { globalGroundingPrompt } = JSON.parse(fs.readFileSync(promptPath, 'utf8'));

const EMAIL_LIVE_INBOX_APPEND = [
  'EMAIL CONTEXT: Live Yahoo inbox content was fetched via IMAP in this turn.',
  'Use ONLY the UIDs and headers in this message. Never invent, simulate, or reconstruct emails.',
  'If the user asked for more emails than were fetched, state the actual count and stop.',
  'Never claim you lack email access when inbox data is present below.',
  'NEVER say you are waiting for the system to load the next batch — you cannot self-fetch; the user must send a new message with skip/fetch phrasing.',
  'If a MAILBOX SCAN block appears below, you MUST quote its scanned date span and matched count verbatim — do not omit or paraphrase it.',
  'NEVER ask the user to "let you know when the batch is ready" — that is impossible.',
].join(' ');

const EMAIL_LIVE_INBOX_MEMORY_APPEND = [
  EMAIL_LIVE_INBOX_APPEND,
  'The user asked to feed sender-filtered email into Continuum memory.',
  'Extract durable facts, commitments, dates, names, and project details from the REAL emails below.',
  'When SENDER PERSONA or ATTITUDE TIMELINE instructions appear below, follow them using only the listed emails.',
  'NEVER invent quotes in Chinese or English — every quote must match a Preview line with UID and Date.',
  'If the user challenges a date or quote, search the email list below; if not found, admit it was not in the fetched batch.',
  'For attitude timeline requests: produce dated phases, cite email evidence, and describe how tone toward the user changed over time.',
  'Confirm what you captured; post-chat archiving will store episodic/semantic/temporal memory.',
].join(' ');

const EMAIL_LIVE_INBOX_DELETE_APPEND = [
  EMAIL_LIVE_INBOX_APPEND,
  'The OpenClaw bridge MOVES Yahoo mail to Trash via IMAP (not permanent deletion) when the user asks — you do NOT run commands.',
  'ALWAYS say "move to Trash" or "trashed" — NEVER say "delete", "deletion", "permanently remove", or "erase" unless [Email permanently deleted] appears (it never does for normal cleanup).',
  'NEVER tell the user to run terminal, bash, shell, VPS, or CLI commands for email.',
  'NEVER invent fake commands like "delete uid ..." in code blocks.',
  'If [Permission required] appears below, do NOT say emails were trashed — ask the user to reply "yes proceed" or raise the limit.',
  'If [Email trash executed], [Email cleanup executed], or [Email auto-trash executed] appears below, confirm exactly what was moved to Trash from that block only.',
  'If [EMAIL TRASH RESULT] appears below, copy its trash line verbatim — it may show a combined total (auto-trash + cleanup), not just 100.',
  'Cleanup ("clean up inbox") moves news, newsletters, promos, ads, GitHub/dev notifications, and bank statements to Trash — never OTP or security alerts.',
  'If no trash-executed block is present, do NOT say emails were moved — tell the user trashing did not run yet and ask them to resend with explicit UIDs or "move category 1 and 3 to trash".',
  'If trashing failed or was disabled, explain using the error text — do not claim you lack all execution ability.',
].join(' ');

const EMAIL_LIVE_INBOX_MOVE_APPEND = [
  EMAIL_LIVE_INBOX_APPEND,
  'The OpenClaw VPS bridge moves Yahoo mail to folders via IMAP when the user asks — you do NOT run commands.',
  'NEVER tell the user to run terminal, bash, shell, VPS, or CLI commands for email.',
  'If [Permission required] appears below, do NOT say emails were moved — ask the user to reply "yes proceed" or raise the limit.',
  'If [Email move executed] appears below, confirm exactly which UIDs were moved and the destination folder name from that block only.',
  'If no [Email move executed] block is present, do NOT claim mail was filed — tell the user the move did not run yet.',
].join(' ');

const EMAIL_LIVE_INBOX_COPY_APPEND = [
  EMAIL_LIVE_INBOX_APPEND,
  'The OpenClaw VPS bridge COPIES Yahoo mail between folders via IMAP when the user asks — you do NOT run commands.',
  'COPY leaves originals in the source folder; only duplicates appear in the destination (usually INBOX).',
  'NEVER tell the user to run terminal, bash, shell, VPS, or CLI commands for email.',
  'If [Permission required] appears below, do NOT say emails were copied — ask the user to reply "yes proceed" or raise the limit.',
  'If [Email copy executed] appears below, confirm the source folder, destination, and count from that block only.',
  'If no [Email copy executed] block is present, do NOT claim mail was copied — tell the user the copy did not run yet.',
].join(' ');

const WEB_SEARCH_APPEND = [
  'WEB SEARCH: Live web results were fetched on the OpenClaw VPS bridge for this turn.',
  'Use ONLY the [Web search] block for current events, scores, news, and weather.',
  'Do NOT claim you lack internet, cannot search the web, or recommend ESPN/BBC/social media when that block is present.',
  'Answer directly from the search results and KEY HEADLINES. If headlines mention a score or winner, state it.',
  'Do NOT say "no results" or "cannot provide details" when headlines or sources are listed below.',
].join(' ');

function appendGroundingPersona(persona, extraBlocks = []) {
  const base = persona || '';
  const extras = extraBlocks.filter(Boolean);
  if (base.includes('GROUNDING RULES (always follow')) {
    return [base, ...extras].filter(Boolean).join('\n\n');
  }
  return [base, globalGroundingPrompt, ...extras].filter(Boolean).join('\n\n');
}

module.exports = {
  GLOBAL_GROUNDING_PROMPT: globalGroundingPrompt,
  EMAIL_LIVE_INBOX_APPEND,
  EMAIL_LIVE_INBOX_MEMORY_APPEND,
  EMAIL_LIVE_INBOX_DELETE_APPEND,
  EMAIL_LIVE_INBOX_MOVE_APPEND,
  EMAIL_LIVE_INBOX_COPY_APPEND,
  WEB_SEARCH_APPEND,
  appendGroundingPersona,
};
