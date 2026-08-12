import grounding from '../../shared/grounding-prompt.json';

export const GLOBAL_GROUNDING_PROMPT = grounding.globalGroundingPrompt;

export const DOCUMENT_ATTACHMENT_APPEND = [
  'ATTACHED DOCUMENTS: File text was extracted on the device and included in the user message in a REAL ATTACHED FILE CONTENT block.',
  'Analyze ONLY that extracted content — treat it as the authoritative source for this turn.',
  'NEVER say you lack file-reading capabilities, cannot access attachments, or need the user to paste/upload the file again.',
  'NEVER substitute chat history, memory, or prior turns for the attached file when the user asks to analyze the attachment.',
  'Do NOT open with weather, persona boilerplate, or unrelated strategic summaries unless the file content supports them.',
].join(' ');

export const WEB_SEARCH_APPEND = [
  'WEB SEARCH: Live web results were fetched in the Continuum app for this turn.',
  'The content you need is in the [Web search] block below — you do NOT need to log in, have an account, or use credentials to read it.',
  'Answer directly from that content. Do NOT claim you lack internet, cannot search the web, or cannot access a site (such as LinkedIn, Facebook, GitHub) when its content is provided below.',
  'If a page excerpt for a profile is present, summarize that profile directly from the excerpt.',
  'Do NOT say "no results" or "cannot provide details" when sources are listed below.',
].join(' ');

/** Hands-free voice: keep replies speakable; UI still renders markdown if any slips through. */
export const VOICE_MODE_APPEND = [
  'VOICE MODE: This reply will be spoken aloud.',
  'Write in clear spoken prose with short paragraphs.',
  'Do NOT use markdown emphasis markers (asterisks *, underscores _), headings (#), bullet/numbered list markers, code fences, or table pipe syntax.',
  'Prefer plain sentences. Spell out emphasis with words when needed.',
].join(' ');

export function appendGroundingPersona(persona, extraBlocks = []) {
  const base = persona || '';
  const extras = extraBlocks.filter(Boolean);
  if (base.includes('GROUNDING RULES (always follow')) {
    return [base, ...extras].filter(Boolean).join('\n\n');
  }
  return [base, GLOBAL_GROUNDING_PROMPT, ...extras].filter(Boolean).join('\n\n');
}
