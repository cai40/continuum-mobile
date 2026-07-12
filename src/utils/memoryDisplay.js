export const MEMORY_QUICK_FILTERS = [
  { label: 'Min', query: 'min zhang' },
  { label: 'boundary', query: 'boundary' },
  { label: 'April 2026', query: 'april 2026' },
  { label: 'UID', query: 'uid' },
  { label: 'email', query: 'email' },
];

export const MEMORY_PREVIEW_CHARS = 220;
export const MEMORY_DEFAULT_VISIBLE = 12;

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
      if (matchesMemoryQuery(item, layer, q)) {
        results.push({
          layer,
          layerLabel,
          item,
          text: memoryItemText(item, layer),
          meta: memoryItemMeta(item, layer),
          id: item.id || `${layer}_${results.length}`,
        });
      }
    }
  }

  results.sort((a, b) => {
    const da = String(a.item?.created_at || a.item?.timestamp || '');
    const db = String(b.item?.created_at || b.item?.timestamp || '');
    return db.localeCompare(da);
  });

  return results.slice(0, limit);
}

export function memoryItemKey(layer, item, index = 0) {
  return `${layer}_${item?.id ?? index}`;
}
