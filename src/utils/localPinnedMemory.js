import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = '@continuum/l1_pins_';
const MAX_LOCAL_PINS = 64;

function storageKey(userId) {
  return `${STORAGE_PREFIX}${userId || 'anon'}`;
}

function normalizePin(item) {
  const content = String(item?.content || item?.text || '').trim();
  if (!content) return null;
  return {
    id: String(item?.id || `local-${Date.now()}`),
    content,
    label: String(item?.label || 'Pinned').trim() || 'Pinned',
    created_at: item?.created_at || new Date().toISOString(),
    local: true,
  };
}

export async function loadLocalPinnedMemories(userId) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePin).filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveLocalPinnedMemory(userId, content, label = 'Pinned') {
  const pin = normalizePin({ content, label, id: `local-${Date.now()}` });
  if (!pin) throw new Error('Empty pin content');

  const existing = await loadLocalPinnedMemories(userId);
  const deduped = existing.filter(
    (row) => row.content.trim().toLowerCase() !== pin.content.toLowerCase(),
  );
  const next = [pin, ...deduped].slice(0, MAX_LOCAL_PINS);
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  return pin;
}

export function mergePinnedMemories(cloudPins, localPins) {
  const cloud = Array.isArray(cloudPins) ? cloudPins : [];
  const local = Array.isArray(localPins) ? localPins : [];
  const seen = new Set();
  const merged = [];

  for (const row of [...cloud, ...local]) {
    const content = String(row?.content || row?.text || '').trim().toLowerCase();
    if (!content || seen.has(content)) continue;
    seen.add(content);
    merged.push(row);
  }

  return merged.sort(
    (a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')),
  );
}
