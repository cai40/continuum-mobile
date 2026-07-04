import grounding from '../../shared/grounding-prompt.json';

export const GLOBAL_GROUNDING_PROMPT = grounding.globalGroundingPrompt;

export function appendGroundingPersona(persona, extraBlocks = []) {
  const base = persona || '';
  const extras = extraBlocks.filter(Boolean);
  if (base.includes('GROUNDING RULES (always follow')) {
    return [base, ...extras].filter(Boolean).join('\n\n');
  }
  return [base, GLOBAL_GROUNDING_PROMPT, ...extras].filter(Boolean).join('\n\n');
}
