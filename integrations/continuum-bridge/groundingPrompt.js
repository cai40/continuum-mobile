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
  'If no inbox block appears below, tell the user their message did not trigger IMAP — ask them to send exactly: skip 100, fetch next 250 emails.',
  'NEVER ask the user to "let you know when the batch is ready" — that is impossible.',
].join(' ');

const EMAIL_LIVE_INBOX_MEMORY_APPEND = [
  EMAIL_LIVE_INBOX_APPEND,
  'The user asked to feed sender-filtered email into Continuum memory.',
  'Extract durable facts, commitments, dates, names, and project details from the REAL emails below.',
  'Confirm what you captured; post-chat archiving will store episodic/semantic/temporal memory.',
].join(' ');

const EMAIL_LIVE_INBOX_DELETE_APPEND = [
  EMAIL_LIVE_INBOX_APPEND,
  'The OpenClaw VPS bridge executes Yahoo email delete/trash automatically in this turn when the user asks — you do NOT run commands.',
  'NEVER tell the user to run terminal, bash, shell, VPS, or CLI commands for email.',
  'NEVER invent fake commands like "delete uid ..." in code blocks.',
  'If [Email delete executed] appears below, confirm exactly what was deleted from that block only.',
  'If no [Email delete executed] block is present, do NOT say emails were moved or deleted — tell the user deletion did not run yet and ask them to resend with explicit UIDs or "move category 1 and 3 to trash".',
  'If delete failed or was disabled, explain using the error text — do not claim you lack all execution ability.',
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
  appendGroundingPersona,
};
