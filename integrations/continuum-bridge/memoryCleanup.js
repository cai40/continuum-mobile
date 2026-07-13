'use strict';

const fs = require('fs');
const path = require('path');
const {
  findDuplicateGroups,
  pickDuplicateRemovals,
  isConversationalNoise,
  ebbinghausRetention,
} = require('./memoryDedup');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://yybojfgjhtrwqhtavorg.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_o9AuvayIw6vnMtnqhdTpNg__V7pA5i5';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BATCH_SIZE = Math.min(1000, Math.max(100, parseInt(process.env.MEMORY_CONSOLIDATION_BATCH || '1000', 10)));
const RETENTION_THRESHOLD = parseFloat(process.env.MEMORY_RETENTION_THRESHOLD || '0.4');

const LAYERS = [
  { layer: 'l1', table: 'pinned_memories', textField: 'content' },
  { layer: 'l2', table: 'episodic_segments', textField: 'content' },
  { layer: 'l3', table: 'semantic_memories', textField: 'content' },
  { layer: 'l4', table: 'temporal_events', textField: 'event_description' },
  { layer: 'l5', table: 'document_chunks', textField: 'content' },
];

const DEFAULT_STATE_PATH = path.join(
  process.env.HOME || '/tmp',
  '.config/continuum-bridge/memory-cleanup.json',
);

function statePath() {
  return process.env.MEMORY_CLEANUP_STATE_PATH || DEFAULT_STATE_PATH;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return { runs: [] };
  }
}

function saveState(state) {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ runs: (state.runs || []).slice(0, 30) }, null, 2), 'utf8');
}

function serviceConfigured() {
  return Boolean(SUPABASE_SERVICE_ROLE_KEY.trim());
}

function adminHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
}

function rowText(row, spec) {
  if (spec.layer === 'l5') {
    const source = String(row?.source || '').trim();
    const content = String(row?.content || '').trim();
    return source ? `${source}: ${content}` : content;
  }
  return String(row?.[spec.textField] || row?.content || row?.text || '');
}

async function verifyBearerUser(authorization) {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: authorization,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id || null;
  } catch {
    return null;
  }
}

async function fetchRows(table, userId, offset, limit) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('order', 'created_at.desc.nullslast');

  const res = await fetch(url.toString(), {
    headers: {
      ...adminHeaders(),
      Range: `${offset}-${offset + limit - 1}`,
    },
  });
  if (res.status === 416 || res.status === 404) return [];
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase select ${table}: ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json();
}

async function deleteRows(table, userId, ids) {
  if (!ids.length) return 0;
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) {
    chunks.push(ids.slice(i, i + 100));
  }
  let deleted = 0;
  for (const batch of chunks) {
    const filter = batch.map((id) => encodeURIComponent(id)).join(',');
    const url = `${SUPABASE_URL}/rest/v1/${table}?id=in.(${filter})&user_id=eq.${encodeURIComponent(userId)}`;
    const res = await fetch(url, { method: 'DELETE', headers: adminHeaders() });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Supabase delete ${table}: ${res.status} ${detail.slice(0, 200)}`);
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
    const rows = await fetchRows(spec.table, userId, offset, BATCH_SIZE);
    if (!rows.length) break;
    report.scanned += rows.length;

    const idsToDelete = new Set();

    for (const group of findDuplicateGroups(rows, getText)) {
      for (const victim of pickDuplicateRemovals(group)) {
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

async function runConsolidationForUser(userId) {
  if (!serviceConfigured()) {
    const err = new Error('SUPABASE_SERVICE_ROLE_KEY not configured on email bridge');
    err.code = 'SERVICE_NOT_CONFIGURED';
    throw err;
  }

  const startedAt = new Date().toISOString();
  const layers = [];
  let totalRemoved = 0;

  for (const spec of LAYERS) {
    const layerReport = await consolidateLayer(userId, spec);
    layers.push(layerReport);
    totalRemoved += layerReport.removed;
  }

  const result = {
    status: 'success',
    user_id: userId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_removed: totalRemoved,
    layers,
  };

  const state = loadState();
  state.runs = [result, ...(state.runs || [])].slice(0, 30);
  saveState(state);

  return result;
}

async function fetchDistinctUserIds() {
  const ids = new Set();
  for (const spec of LAYERS) {
    let offset = 0;
    while (true) {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${spec.table}`);
      url.searchParams.set('select', 'user_id');
      const res = await fetch(url.toString(), {
        headers: {
          ...adminHeaders(),
          Range: `${offset}-${offset + 999}`,
        },
      });
      if (!res.ok) break;
      const rows = await res.json();
      if (!rows.length) break;
      for (const row of rows) {
        if (row?.user_id) ids.add(row.user_id);
      }
      if (rows.length < 1000) break;
      offset += 1000;
    }
  }
  return [...ids];
}

async function runConsolidationAllUsers() {
  const userIds = await fetchDistinctUserIds();
  const startedAt = new Date().toISOString();
  const users = [];
  let totalRemoved = 0;
  let errors = 0;

  for (const userId of userIds) {
    try {
      const report = await runConsolidationForUser(userId);
      users.push({
        user_id: userId,
        total_removed: report.total_removed,
        layers: report.layers,
      });
      totalRemoved += report.total_removed;
    } catch (e) {
      errors += 1;
      users.push({ user_id: userId, error: e.message });
    }
  }

  const summary = {
    status: 'success',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    users_processed: userIds.length,
    total_removed: totalRemoved,
    errors,
    users: users.slice(0, 50),
  };

  const state = loadState();
  state.last_cron = summary;
  state.runs = [summary, ...(state.runs || [])].slice(0, 30);
  saveState(state);

  return summary;
}

async function deleteMemoryForUser(userId, layer, id) {
  const spec = LAYERS.find((l) => l.layer === layer);
  if (!spec) throw new Error('Invalid layer');
  if (!id) throw new Error('Missing id');
  if (!serviceConfigured()) {
    const err = new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
    err.code = 'SERVICE_NOT_CONFIGURED';
    throw err;
  }
  await deleteRows(spec.table, userId, [String(id)]);
  return { status: 'success', layer, id };
}

function getLatestRuns(limit = 14) {
  const state = loadState();
  return {
    configured: serviceConfigured(),
    last_cron: state.last_cron || null,
    runs: (state.runs || []).slice(0, limit),
  };
}

module.exports = {
  serviceConfigured,
  verifyBearerUser,
  runConsolidationForUser,
  runConsolidationAllUsers,
  deleteMemoryForUser,
  getLatestRuns,
};
