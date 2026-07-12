export const MEMORY_QUICK_FILTERS = [
  { label: 'Min', query: 'min zhang' },
  { label: 'boundary', query: 'boundary' },
  { label: 'April 2026', query: 'april 2026' },
  { label: 'UID', query: 'uid' },
  { label: 'email', query: 'email' },
];

export const MEMORY_PREVIEW_CHARS = 220;
export const MEMORY_DEFAULT_VISIBLE = 12;

/** L2 often stores "Interaction: <user question>" without email body or UIDs. */
export function isInteractionQuestionLog(text) {
  return /^Interaction:\s*/i.test(String(text || '').trim());
}

export function hasEmailEvidenceSignals(text) {
  const t = String(text || '');
  return /\bUID\s+\d{5,7}\b/i.test(t)
    || /\*\*UID\s+\d{5,7}\*\*/i.test(t)
    || /\b641\d{3}\b/.test(t)
    || /\b20\d{2}-\d{2}-\d{2}\b/.test(t)
    || /\bDate:\s*/i.test(t)
    || /\bPreview:/i.test(t)
    || /\bSubject:/i.test(t);
}

export function shouldOfferEmailEvidencePin(userMessage, {
  isEmailBridgeQuery = false,
  isRecallEvidenceFetch = false,
} = {}) {
  if (isRecallEvidenceFetch || isEmailBridgeQuery) return true;
  const text = String(userMessage || '');
  if (/\b(?:continuum memory|load(?:\s+\w+){0,4}\s+(?:to\s+)?memory|ingest|pin to l1)\b/i.test(text)) {
    return true;
  }
  if (/\bread\s+every\s+email\b/i.test(text) && /\b(?:memory|continuum)\b/i.test(text)) return true;
  return false;
}

export function isLowValueForEmailRecall(text, layer) {
  if (layer === 'l2' && isInteractionQuestionLog(text) && !hasEmailEvidenceSignals(text)) {
    return true;
  }
  return false;
}

export function memoryFragmentKind(text, layer) {
  if (isInteractionQuestionLog(text) && !hasEmailEvidenceSignals(text)) return 'question';
  if (hasEmailEvidenceSignals(text)) return 'evidence';
  if (layer === 'l3' || layer === 'l4') return 'fact';
  return 'other';
}

export function rankMemoryFragment(text, layer, keywords, query = '') {
  let score = 0;
  const lower = String(text || '').toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) score += kw.length > 4 ? 3 : 1;
  }
  if (hasEmailEvidenceSignals(text)) score += 20;
  if (isLowValueForEmailRecall(text, layer)) score -= 25;
  if (/^Interaction:/i.test(text) && /\b(?:remember|cite|boundary)\b/i.test(query)) score -= 10;
  return score;
}

export function isEmailEvidenceQuery(query) {
  const q = String(query || '').toLowerCase();
  return /\b(?:min|zhang|boundary|email|uid|april|641\d{3})\b/.test(q);
}

/** Compact UID+Date block from assistant reply for L1 pin. */
export function extractEmailEvidenceForPin(assistantText, maxChars = 1800) {
  const text = String(assistantText || '');
  const lines = text.split('\n');
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      /\bUID\s+\d{5,7}\b/i.test(trimmed)
      || /\*\*UID\s+\d{5,7}\*\*/i.test(trimmed)
      || /\b641\d{3}\b/.test(trimmed)
    ) {
      kept.push(trimmed.replace(/\*\*/g, ''));
    }
  }
  if (!kept.length) return '';
  const header = 'Min Zhang email evidence (UID + Date):';
  let body = kept.join('\n');
  if (`${header}\n${body}`.length > maxChars) {
    body = body.slice(0, maxChars - header.length - 16) + '\n… [truncated]';
  }
  return `${header}\n${body}`;
}

/** Attach pinOffer payload to the last assistant bubble in a split reply. */
export function attachPinOfferToMessages(messages, pinBody) {
  if (!pinBody || !Array.isArray(messages) || !messages.length) return messages;
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i]?.role === 'assistant') {
      out[i] = { ...out[i], pinOffer: pinBody };
      return out;
    }
  }
  return out;
}

export function memoryItemText(item, layer) {
  if (!item) return '';
  if (layer === 'l4') return String(item.event_description || '');
  if (layer === 'l5') {
    const source = item.source ? `${item.source}: ` : '';
    return `${source}${item.content || ''}`.trim();
  }
  return String(item.content || '');
}

export function memoryItemMeta(item, layer) {
  if (item?.local) {
    return `Local pin • ${formatShortDate(item.created_at)}`;
  }
  if (layer === 'l4') {
    return `[${String(item.state || 'planned').toUpperCase()}] • ${formatShortDate(item.created_at)}`;
  }
  if (layer === 'l5') {
    return `Vectorized ${formatShortDate(item.timestamp || item.created_at)}`;
  }
  if (layer === 'l3') {
    return `[${String(item.type || 'fact').toUpperCase()}] • ${formatShortDate(item.created_at)}`;
  }
  return formatShortDate(item.created_at);
}

function formatShortDate(raw) {
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(raw);
  }
}

export function matchesMemoryQuery(item, layer, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return memoryItemText(item, layer).toLowerCase().includes(q);
}

export function filterMemoryList(items, layer, query) {
  const list = Array.isArray(items) ? items : [];
  const q = String(query || '').trim();
  if (!q) return list;
  return list.filter((item) => matchesMemoryQuery(item, layer, q));
}

export function collectMemoryMatches(layers, query, limit = 48) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const keywords = q.split(/\s+/).filter((w) => w.length > 1);
  const emailQuery = isEmailEvidenceQuery(q);

  const pools = [
    ['L1', 'l1', layers.pinnedMemories],
    ['L2', 'l2', layers.episodicSegments],
    ['L3', 'l3', layers.semanticProfile],
    ['L4', 'l4', layers.temporalEvents],
    ['L5', 'l5', layers.knowledgeBase],
  ];

  const results = [];
  for (const [layerLabel, layer, items] of pools) {
    for (const item of items || []) {
      const text = memoryItemText(item, layer);
      if (!matchesMemoryQuery(item, layer, q)) continue;
      if (emailQuery && isLowValueForEmailRecall(text, layer)) continue;
      results.push({
        layer,
        layerLabel,
        item,
        text,
        meta: memoryItemMeta(item, layer),
        id: item.id || `${layer}_${results.length}`,
        kind: memoryFragmentKind(text, layer),
        score: rankMemoryFragment(text, layer, keywords, q),
      });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = String(a.item?.created_at || a.item?.timestamp || '');
    const db = String(b.item?.created_at || b.item?.timestamp || '');
    return db.localeCompare(da);
  });

  return results.slice(0, limit);
}

export function countInteractionOnlyMatches(layers, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 0;
  let count = 0;
  for (const item of layers.episodicSegments || []) {
    const text = memoryItemText(item, 'l2');
    if (matchesMemoryQuery(item, 'l2', q) && isInteractionQuestionLog(text)) count += 1;
  }
  return count;
}

export function memoryItemKey(layer, item, index = 0) {
  return `${layer}_${item?.id ?? index}`;
}
