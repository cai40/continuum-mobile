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

/**
 * Pins the reply to the language the user just used. Hands-free mode needs this because
 * the spoken voice is chosen from the reply's language: if the model drifts back to the
 * persona's English, a Chinese or Spanish pick silently stops being used. Returns '' for
 * an unknown tag so the caller can leave the persona untouched.
 */
export const replyLanguageAppend = (langTag) => {
  const name = { zh: 'Chinese', en: 'English', es: 'Spanish' }[String(langTag || '').split('-')[0].toLowerCase()];
  if (!name) return '';
  return `REPLY LANGUAGE: The user's latest message is in ${name}. `
    + `Write the entire reply in ${name}, even if earlier turns, the persona above, or `
    + `the app's interface are in another language.`;
};

/** Bound the always-on block so it cannot crowd out the turn's own context. */
export const CORE_PIN_MAX_ITEMS = 60;         // user-chosen, so in practice all of them
export const CORE_IDENTITY_MAX_ITEMS = 150;   // L3 identity rows (they describe who the user is)
export const CORE_FACT_MAX_ITEMS = 300;       // backend-ranked by ACT-R activation
export const CORE_MEMORY_MAX_CHARS = 60000;   // combined, sized so all of the above fit

/** Case/whitespace-insensitive key, so a hand-pinned fact is not repeated by the selector. */
const coreKey = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Explicit/intimate recollections are kept out of the always-on block. They stay
 * retrievable through normal RAG when a conversation is actually about them; what they
 * must not do is ride along on every unrelated turn. Applied to auto-derived identity rows
 * and ranked facts, but NOT to pins — those the user chose by hand. Mirrors
 * ALWAYS_ON_EXCLUDE_RE in continuum-core/memory_engine.py; keep the term lists in sync.
 */
export const CORE_EXCLUDE_RE = /(sexual|sex|intimat|erotic|orgasm|ejaculat|masturbat|porn|fetish|libido|arous|roleplay|nsfw)/i;

/**
 * Identity rows carry a real `confidence`; conversation facts carry `importance_score`,
 * which has no spread in this corpus (median and max are both 1.0), so it cannot rank
 * them — those keep the newest-first order /memories already returns.
 */
const coreConfidence = (row) => {
  const raw = row?.confidence ?? row?.importance_score;
  let n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n > 1) n = n / 10; // tolerate the legacy 0-10 scale
  return Math.max(0, Math.min(1, n));
};

/**
 * Pinned (L1) memories and the most valuable L3 facts must ride on EVERY turn — not only
 * when the user asks to "look up memory". Previously both could be missing from an ordinary
 * turn: the backend function written to inject the pins (PinnedMemory.format_for_prompt)
 * was dead code, and the client recall block only ran on an explicit memory ask, so a
 * pinned fact (the children, family, key history) was silently absent and the app appeared
 * to forget it. Pins lead, then identity rows by confidence, then conversation facts.
 * Returns '' when there is nothing to say so the caller can leave the persona untouched.
 */
export const coreMemoryAppend = (pins = [], profile = []) => {
  const { pinLines, identityLines, factLines } = coreMemorySelection(pins, profile);

  const sections = [];
  if (pinLines.length) sections.push('PINNED BY THE USER (highest priority):', ...pinLines.map((c) => `- ${c}`));
  if (identityLines.length) sections.push('WHO THE USER IS (identity profile):', ...identityLines.map((c) => `- ${c}`));
  if (factLines.length) sections.push('ALWAYS-ON BACKGROUND (ranked by how often relied on):', ...factLines.map((c) => `- ${c}`));
  if (!sections.length) return '';

  return [
    'CORE MEMORY (always present):',
    'These facts the user cares about are always in context. Treat them as already known:',
    'refer to them naturally without being asked, and never say you do not know them or',
    'need to look them up.',
    ...sections,
  ].join('\n');
};

/**
 * The same selection `coreMemoryAppend` renders, returned as data so the UI can show what is
 * actually always present. Setup's "L1" metric counts only the hand-pinned rows, which
 * understates the block by an order of magnitude — the rest is selected from L3 here, at
 * prompt-build time, so it is not stored as rows anywhere and cannot be counted in a table.
 */
export const coreMemorySelection = (pins = [], profile = []) => {
  let chars = 0;
  const seen = new Set();

  const take = (rows, maxItems, guard = true) => {
    const kept = [];
    for (const row of (Array.isArray(rows) ? rows : [])) {
      if (kept.length >= maxItems) break;
      const content = String(row?.content ?? row?.text ?? '').trim();
      if (!content) continue;
      if (guard && CORE_EXCLUDE_RE.test(content)) continue;
      const key = coreKey(content);
      if (!key || seen.has(key)) continue;
      // Over-long entries (e.g. pinned email evidence) are skipped whole rather than
      // truncated, so the block stays readable facts and never a partial sentence.
      // Charge the "- " prefix and newline too, so the cap reflects the real block.
      const cost = content.length + 3;
      if (chars + cost > CORE_MEMORY_MAX_CHARS) continue;
      seen.add(key);
      chars += cost;
      kept.push(content);
    }
    return kept;
  };

  // Pins go first, so `seen` already excludes anything the selector would repeat. Identity
  // rows and ranked facts get SEPARATE budgets: a shared cap let the 124 identity rows eat
  // most of the fact budget, so only ~176 of the backend's 300 ranked facts were used.
  const pinLines = take(pins, CORE_PIN_MAX_ITEMS, false);

  // Identity rows lead by confidence; the facts arrive already ranked by ACT-R activation.
  const identity = [];
  const facts = [];
  for (const row of (Array.isArray(profile) ? profile : [])) {
    (row?.confidence != null ? identity : facts).push(row);
  }
  identity.sort((a, b) => coreConfidence(b) - coreConfidence(a));
  const identityLines = take(identity, CORE_IDENTITY_MAX_ITEMS);
  const factLines = take(facts, CORE_FACT_MAX_ITEMS);

  return {
    pinLines,
    identityLines,
    factLines,
    total: pinLines.length + identityLines.length + factLines.length,
  };
};

export function appendGroundingPersona(persona, extraBlocks = []) {
  const base = persona || '';
  const extras = extraBlocks.filter(Boolean);
  if (base.includes('GROUNDING RULES (always follow')) {
    return [base, ...extras].filter(Boolean).join('\n\n');
  }
  return [base, GLOBAL_GROUNDING_PROMPT, ...extras].filter(Boolean).join('\n\n');
}
