/** Search L2–L4 (+ L1 pins) and build an injection block for cross-session recall. */

import {
  isLowValueForEmailRecall,
  rankMemoryFragment,
} from './memoryDisplay';

const DEFAULT_KEYWORDS = [
  'min zhang', 'min folder', '敏', 'boundary', '641820', '641814', '641826', '641807',
  'april 2026', '2026-04', 'child-related', 'boys',
];

function itemText(item) {
  return String(item?.content || item?.text || item?.summary || '').trim();
}

function itemDate(item) {
  return item?.created_at || item?.timestamp || item?.date || '';
}

function extractKeywords(message) {
  const text = String(message || '').toLowerCase();
  const keys = [...DEFAULT_KEYWORDS];
  const month = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\w*\s+(20\d{2})\b/i);
  if (month) keys.push(`${month[1]} ${month[2]}`.toLowerCase());
  const uid = text.match(/\b641\d{3}\b/g);
  if (uid) keys.push(...uid);
  if (/\bmin\b/i.test(text)) keys.push('min');
  if (/\bboundary\b/i.test(text)) keys.push('boundary');
  if (/\bemail/i.test(text)) keys.push('email');
  return [...new Set(keys.filter(Boolean))];
}

export function wantsContinuumMemoryRecall(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (/\b(?:what do you remember|from (?:continuum )?memory|in (?:continuum )?memory|check (?:continuum )?memory|memory store|memory vault|brain memory)\b/i.test(text)) {
    return true;
  }
  if (/\bremember\b/i.test(text) && /\b(?:min|zhang|\u654f|boundary|email|persona)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function buildMemoryRecallContext(layers, message, maxBytes = 28000) {
  const keywords = extractKeywords(message);
  const pools = [
    ...(layers?.pinnedMemories || layers?.pinned || []).map((item) => ({ layer: 'L1', item })),
    ...(layers?.episodicSegments || []).map((item) => ({ layer: 'L2', item })),
    ...(layers?.semanticProfile || []).map((item) => ({ layer: 'L3', item })),
    ...(layers?.temporalEvents || []).map((item) => ({ layer: 'L4', item })),
    ...(layers?.knowledgeBase || []).map((item) => ({ layer: 'L5', item })),
  ];

  const ranked = pools
    .map(({ layer, item }) => {
      const content = itemText(item);
      if (!content) return null;
      const layerKey = String(layer).toLowerCase();
      if (layerKey !== 'l1' && isLowValueForEmailRecall(content, layerKey)) return null;
      const score = rankMemoryFragment(content, layerKey, keywords, message);
      return score > 0 ? { layer, content, date: itemDate(item), score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));

  if (!ranked.length) {
    return [
      '[CONTINUUM MEMORY — retrieval for this turn]',
      'No email evidence (UID+Date) found in L1–L5 — only question logs or unrelated facts may exist.',
      'Offer a Min-folder fetch for the requested month; do NOT claim OOM unless shown in this turn.',
    ].join('\n');
  }

  const lines = [
    '[CONTINUUM MEMORY — L1–L5 retrieval for this turn]',
    'Use ONLY the fragments below for cross-session recall. Cite layer and date when quoting.',
    'Do NOT say you lack persistent memory when this block is present.',
    'Do NOT invent UIDs or dates not listed here.',
    '',
  ];

  let bytes = lines.join('\n').length;
  for (const row of ranked.slice(0, 40)) {
    const chunk = `- [${row.layer}${row.date ? ` | ${row.date}` : ''}] ${row.content}`;
    if (bytes + chunk.length > maxBytes) break;
    lines.push(chunk);
    bytes += chunk.length + 1;
  }

  return lines.join('\n');
}
