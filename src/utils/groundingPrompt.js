import grounding from '../../shared/grounding-prompt.json';

export const GLOBAL_GROUNDING_PROMPT = grounding.globalGroundingPrompt;

export const DOCUMENT_ATTACHMENT_APPEND = [
  'ATTACHED DOCUMENTS: File text was extracted on the device and included in the user message in a REAL ATTACHED FILE CONTENT block.',
  'Analyze ONLY that extracted content — treat it as the authoritative source for this turn.',
  'NEVER say you lack file-reading capabilities, cannot access attachments, or need the user to paste/upload the file again.',
  'NEVER substitute chat history, memory, or prior turns for the attached file when the user asks to analyze the attachment.',
  'Do NOT open with weather, persona boilerplate, or unrelated strategic summaries unless the file content supports them.',
].join(' ');

export function appendGroundingPersona(persona, extraBlocks = []) {
  const base = persona || '';
  const extras = extraBlocks.filter(Boolean);
  if (base.includes('GROUNDING RULES (always follow')) {
    return [base, ...extras].filter(Boolean).join('\n\n');
  }
  return [base, GLOBAL_GROUNDING_PROMPT, ...extras].filter(Boolean).join('\n\n');
}
