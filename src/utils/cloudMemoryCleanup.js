import { supabase } from '../services/supabase';
import {
  findDuplicateGroups,
  pickDuplicateRemovals,
  isConversationalNoise,
  ebbinghausRetention,
} from './memoryDedup';
import { memoryItemText } from './memoryDisplay';

const BATCH_SIZE = 1000;
const RETENTION_THRESHOLD = 0.4;

const LAYERS = [
  { layer: 'l1', table: 'pinned_memories', textField: 'content' },
  { layer: 'l2', table: 'episodic_segments', textField: 'content' },
  { layer: 'l3', table: 'semantic_memories', textField: 'content' },
  { layer: 'l4', table: 'temporal_events', textField: 'event_description' },
  { layer: 'l5', table: 'document_chunks', textField: 'content' },
];

function rowText(row, spec) {
  if (spec.layer === 'l5') {
    const source = String(row?.source || '').trim();
    const content = String(row?.content || '').trim();
    return source ? `${source}: ${content}` : content;
  }
  return String(row?.[spec.textField] || row?.content || row?.text || '');
}

function classifySupabaseError(error) {
  const message = String(error?.message || error || '');
  const code = String(error?.code || '');
  if (code === '42501' || /policy|permission denied|RLS/i.test(message)) {
    return 'rls_blocked';
  }
  if (code === 'PGRST301' || /JWT|session|auth|401/i.test(message)) {
    return 'auth_failed';
  }
  return 'network';
}

async function deleteRows(table, userId, ids) {
  if (!ids.length) return 0;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId)
      .in('id', batch);
    if (error) {
      const reason = classifySupabaseError(error);
      if (reason === 'rls_blocked') {
        throw new Error(
          'Supabase RLS blocked delete. Run integrations/continuum-backend/memory_rls_delete_policies.sql in Supabase SQL Editor.',
        );
      }
      throw error;
    }
    deleted += batch.length;
  }
  return deleted;
}

async function consolidateLayer(userId, spec) {
  const report = {
    layer: spec.layer,
    scanned: 0,
    deduped: 0,
    noise_purged: 0,
    decay_purged: 0,
    removed: 0,
  };
  const getText = (row) => rowText(row, spec);
  let offset = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from(spec.table)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw error;
    if (!rows?.length) break;
    report.scanned += rows.length;

    const idsToDelete = new Set();

    for (const group of findDuplicateGroups(rows, spec.layer, getText)) {
      for (const victim of pickDuplicateRemovals(group, spec.layer, getText)) {
        const id = String(victim?.id || '');
        if (id && !idsToDelete.has(id)) {
          idsToDelete.add(id);
          report.deduped += 1;
        }
      }
    }

    if (spec.layer === 'l2') {
      for (const row of rows) {
        const id = String(row?.id || '');
        if (!id || idsToDelete.has(id)) continue;
        if (isConversationalNoise(getText(row))) {
          idsToDelete.add(id);
          report.noise_purged += 1;
        }
      }
    }

    if (spec.layer === 'l2' || spec.layer === 'l3') {
      for (const row of rows) {
        const id = String(row?.id || '');
        if (!id || idsToDelete.has(id)) continue;
        const retention = ebbinghausRetention({
          createdAt: row.created_at || row.timestamp,
          mentionCount: row.mention_count || row.mentions || 1,
          importanceScore: row.importance_score || row.importance || 5,
        });
        if (retention < RETENTION_THRESHOLD) {
          idsToDelete.add(id);
          report.decay_purged += 1;
        }
      }
    }

    if (idsToDelete.size) {
      report.removed += await deleteRows(spec.table, userId, [...idsToDelete]);
    }

    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return report;
}

async function consolidateAllLayers(userId) {
  const layers = [];
  let totalRemoved = 0;
  for (const spec of LAYERS) {
    const layerReport = await consolidateLayer(userId, spec);
    layers.push(layerReport);
    totalRemoved += layerReport.removed;
  }
  return { totalRemoved, layers };
}

/**
 * Cloud consolidation via Supabase session (user JWT + RLS).
 * Deletes duplicate/noise/decayed rows in L1–L5 vault tables.
 */
export async function runDirectSupabaseConsolidation(userId) {
  if (!userId) {
    return { serverRan: false, serverSkipped: true, serverRemoved: 0, skipReason: 'not_signed_in' };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { serverRan: false, serverSkipped: true, serverRemoved: 0, skipReason: 'not_signed_in' };
  }

  try {
    const { totalRemoved, layers } = await consolidateAllLayers(userId);
    return {
      serverRan: true,
      serverSkipped: false,
      serverRemoved: totalRemoved,
      skipReason: null,
      source: 'supabase_direct',
      layerReports: layers,
    };
  } catch (e) {
    const message = String(e?.message || e || '');
    if (/RLS blocked delete/i.test(message)) {
      return { serverRan: false, serverSkipped: true, serverRemoved: 0, skipReason: 'rls_blocked' };
    }
    const reason = classifySupabaseError(e);
    return { serverRan: false, serverSkipped: true, serverRemoved: 0, skipReason: reason };
  }
}

/** Resolve display text for a cloud row (used by tests and tooling). */
export function cloudRowText(row, layer) {
  const spec = LAYERS.find((entry) => entry.layer === layer);
  if (!spec) return memoryItemText(row, layer);
  return rowText(row, spec);
}
