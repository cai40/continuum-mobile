import AsyncStorage from '@react-native-async-storage/async-storage';
import { memoryContentFingerprint } from './memoryDedup';

const STORAGE_PREFIX = '@continuum/hidden_memories_';

const EMPTY = { l1: [], l2: [], l3: [], l4: [], l5: [], fingerprints: { l1: [], l2: [], l3: [], l4: [], l5: [] } };

function storageKey(userId) {
  return `${STORAGE_PREFIX}${userId || 'anon'}`;
}

function normalizeHidden(raw) {
  const base = { ...EMPTY, fingerprints: { ...EMPTY.fingerprints } };
  if (!raw || typeof raw !== 'object') return base;
  for (const layer of ['l1', 'l2', 'l3', 'l4', 'l5']) {
    base[layer] = Array.isArray(raw[layer]) ? raw[layer].map(String) : [];
    base.fingerprints[layer] = Array.isArray(raw.fingerprints?.[layer])
      ? raw.fingerprints[layer].map(String)
      : [];
  }
  return base;
}

export async function loadHiddenMemories(userId) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? normalizeHidden(JSON.parse(raw)) : { ...EMPTY, fingerprints: { ...EMPTY.fingerprints } };
  } catch {
    return { ...EMPTY, fingerprints: { ...EMPTY.fingerprints } };
  }
}

async function saveHiddenMemories(userId, hidden) {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(normalizeHidden(hidden)));
}

export async function hideMemoryItem(userId, layer, { id, contentFingerprint }) {
  const hidden = await loadHiddenMemories(userId);
  const layerKey = String(layer || '').toLowerCase();
  if (!['l1', 'l2', 'l3', 'l4', 'l5'].includes(layerKey)) return hidden;

  if (id != null && String(id).trim()) {
    const sid = String(id);
    if (!hidden[layerKey].includes(sid)) hidden[layerKey].push(sid);
  }
  if (contentFingerprint) {
    const fp = String(contentFingerprint);
    if (!hidden.fingerprints[layerKey].includes(fp)) {
      hidden.fingerprints[layerKey].push(fp);
    }
  }
  await saveHiddenMemories(userId, hidden);
  return hidden;
}

export function isMemoryItemHidden(item, layer, hidden, getText) {
  if (!item || !hidden) return false;
  const layerKey = String(layer || '').toLowerCase();
  const id = item?.id != null ? String(item.id) : '';
  if (id && hidden[layerKey]?.includes(id)) return true;
  const fp = memoryContentFingerprint(getText(item, layerKey));
  if (fp && hidden.fingerprints?.[layerKey]?.includes(fp)) return true;
  return false;
}

export function filterHiddenMemoryList(items, layer, hidden, getText) {
  const list = Array.isArray(items) ? items : [];
  if (!hidden) return list;
  return list.filter((item) => !isMemoryItemHidden(item, layer, hidden, getText));
}
