import grounding from '../../shared/grounding-prompt.json';

export const GLOBAL_GROUNDING_PROMPT = grounding.globalGroundingPrompt;

export const DOCUMENT_ATTACHMENT_APPEND = [
  'ATTACHED DOCUMENTS: File text was extracted on the device and included in the user message below.',
  'Analyze ONLY the extracted content blocks — do NOT claim you cannot read attachments.',
  'If extracted content is present, never ask the user to paste the file again.',
].join(' ');

export function appendGroundingPersona(persona, extraBlocks = []) {
  const base = persona || '';
  const extras = extraBlocks.filter(Boolean);
  if (base.includes('GROUNDING RULES (always follow')) {
    return [base, ...extras].filter(Boolean).join('\n\n');
  }
  return [base, GLOBAL_GROUNDING_PROMPT, ...extras].filter(Boolean).join('\n\n');
}
