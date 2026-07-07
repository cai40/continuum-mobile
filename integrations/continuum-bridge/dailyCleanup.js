'use strict';

const fs = require('fs');
const path = require('path');
const { fetchEmailContext } = require('./emailContext');
const { triageMessages } = require('./emailTriage');
const { countCleanupTargets } = require('./emailDelete');

const DEFAULT_STATE_PATH = path.join(
  process.env.HOME || '/root',
  '.config/continuum-bridge/daily-cleanup.json',
);

function statePath() {
  return process.env.DAILY_CLEANUP_STATE_PATH || DEFAULT_STATE_PATH;
}

function loadState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { enabled: false, runs: [] };
  }
}

function saveState(state) {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const runs = (state.runs || []).slice(0, 30);
  fs.writeFileSync(file, JSON.stringify({ ...state, runs }, null, 2), 'utf8');
}

function formatRunTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

function buildTrashedSenderBreakdown(messages, trashedUids) {
  const uidSet = new Set((trashedUids || []).map(Number));
  const counts = {};
  for (const msg of messages || []) {
    if (!uidSet.has(Number(msg.uid))) continue;
    const from = String(msg.from?.text || msg.from || msg.fromAddress || 'Unknown')
      .replace(/\s+/g, ' ').slice(0, 72);
    counts[from] = (counts[from] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function buildCategoryCounts(messages) {
  const triaged = triageMessages(messages || []);
  const byCategory = {};
  for (const row of triaged) {
    const cat = row.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }
  return byCategory;
}

function buildSummaryText(run) {
  const lines = [
    `## Daily email cleanup — ${formatRunTimestamp(run.ran_at)}`,
    '',
    `- **Scanned:** ${run.fetched} email(s) (${run.lookback})`,
    `- **Cleanup targets:** ${run.cleanup_targets}`,
    `- **Moved to Trash:** ${run.moved_to_trash}`,
  ];
  if (run.error) {
    lines.push('', `**Error:** ${run.error}`);
  } else if (run.moved_to_trash === 0) {
    lines.push('', 'No newsletters or promos to trash in this window.');
  }
  if (run.top_trashed_senders?.length) {
    lines.push('', '**Top trashed senders:**');
    for (const [sender, n] of run.top_trashed_senders) {
      lines.push(`- ${sender}: ${n}`);
    }
  }
  if (run.by_category && Object.keys(run.by_category).length) {
    lines.push('', '**Inbox breakdown (scanned batch):**');
    for (const [cat, n] of Object.entries(run.by_category).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${cat}: ${n}`);
    }
  }
  return lines.join('\n');
}

function buildPrefilledDailySummary(run) {
  if (!run) return null;
  return [
    '[DAILY CLEANUP SUMMARY — your ENTIRE reply must be ONLY the text between these markers; copy verbatim]',
    '',
    buildSummaryText(run),
    '',
    '[/DAILY CLEANUP SUMMARY]',
  ].join('\n');
}

async function runDailyCleanup(options = {}) {
  const lookback = options.recent || process.env.DAILY_CLEANUP_RECENT || '24h';
  const limit = parseInt(options.limit || process.env.DAILY_CLEANUP_LIMIT || '500', 10);
  const ranAt = new Date().toISOString();

  const result = await fetchEmailContext('fetch and clean inbox', {
    email_limit: limit,
    email_recent: lookback,
    email_delete_enabled: options.deleteEnabled !== false,
    email_auto_trash_junk: false,
  });

  const messages = result?.messages || [];
  const deleteResult = result?.deleteResult || {};
  const trashedUids = deleteResult.uids || [];
  const moved = deleteResult.executed ? trashedUids.length : 0;

  const run = {
    id: `run-${Date.now()}`,
    ran_at: ranAt,
    lookback,
    limit,
    fetched: messages.length,
    cleanup_targets: countCleanupTargets(messages),
    moved_to_trash: moved,
    trashed_uids: trashedUids.slice(0, 50),
    top_trashed_senders: buildTrashedSenderBreakdown(messages, trashedUids),
    by_category: buildCategoryCounts(messages),
    error: result?.error || deleteResult?.error || null,
    summary_text: null,
  };
  run.summary_text = buildSummaryText(run);

  const state = loadState();
  state.enabled = options.setEnabled !== false;
  state.last_run = run;
  state.runs = [run, ...(state.runs || [])].slice(0, 30);
  saveState(state);

  return { run, state, result };
}

function getLatestRun() {
  const state = loadState();
  return state.last_run || state.runs?.[0] || null;
}

function getDailyCleanupHistory(limit = 7) {
  const state = loadState();
  return {
    enabled: !!state.enabled,
    last_run: state.last_run || state.runs?.[0] || null,
    runs: (state.runs || []).slice(0, limit),
  };
}

function wantsDailyCleanupSummary(message) {
  const text = String(message || '');
  return /\b(daily\s+cleanup|cleanup\s+summary|what\s+was\s+cleaned|mail\s+cleaned|cleaned\s+today|yesterday'?s?\s+cleanup)\b/i.test(text)
    && /\b(summary|report|show|tell|what|how\s+many)\b/i.test(text);
}

function wantsDailyCleanupSetup(message) {
  const text = String(message || '');
  return /\b(daily\s+(?:email\s+)?cleanup|cleanup\s+daily|auto\s+clean(?:up)?\s+daily)\b/i.test(text)
    && /\b(setup|set\s*up|enable|schedule|automate|start)\b/i.test(text);
}

function buildSetupReply() {
  const bridgeUrl = process.env.RENDER_EXTERNAL_URL
    || process.env.CONTINUUM_EMAIL_BRIDGE_URL
    || 'https://continuum-email-bridge.onrender.com';
  return [
    '[DAILY CLEANUP SETUP — copy verbatim]',
    '',
    '## Daily email cleanup enabled',
    '',
    'The bridge will trash newsletters/promos from the last **24 hours** (up to **500** per run) when the daily job runs.',
    '',
    '**Render Cron Job** (one-time setup):',
    `1. [Render Dashboard](https://dashboard.render.com/) → **New** → **Cron Job**`,
    '2. Connect this repo; command:',
    `   \`curl -sS -X POST "${bridgeUrl}/cron/daily-cleanup" -H "X-Bridge-Secret: YOUR_BRIDGE_SECRET"\``,
    '3. Schedule: `0 8 * * *` (8:00 AM UTC daily) — adjust to your timezone',
    '',
    '**In the app:** Setup → Daily cleanup shows the latest report when you open Continuum.',
    'Ask anytime: **"daily cleanup summary"** or **"what mail was cleaned?"**',
    '',
    '[/DAILY CLEANUP SETUP]',
  ].join('\n');
}

module.exports = {
  runDailyCleanup,
  getLatestRun,
  getDailyCleanupHistory,
  buildPrefilledDailySummary,
  buildSummaryText,
  wantsDailyCleanupSummary,
  wantsDailyCleanupSetup,
  buildSetupReply,
  loadState,
  saveState,
};
