/**
 * Slack integration for the Continuum bridge.
 *
 * Uses the Slack Web API via a Bot/User OAuth token (xoxb-... / xoxp-...).
 * Provides channel listing, message reading, posting, and memory ingestion
 * (recent Slack messages → Continuum memory via /chat, with ts-based dedup).
 */
const fs = require('fs');
const path = require('path');

const SLACK_API = 'https://slack.com/api';
const TIMEOUT_MS = 25000;

const STATE_DIR = process.env.RENDER
  ? path.join('/opt/render/project/src', '.continuum-bridge-data')
  : path.join(process.env.HOME || '/root', '.config/continuum-openclaw');

async function slackRequest(token, method, body = {}) {
  if (!token) throw new Error('Slack token missing');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Slack API HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) {
      const msg = String(data.error || 'slack API error');
      if (msg === 'invalid_auth') throw new Error('Slack token is invalid or revoked');
      if (msg === 'not_in_channel') throw new Error('Bot is not in that channel');
      if (msg === 'channel_not_found') throw new Error('Channel not found');
      throw new Error(`Slack error: ${msg}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function listChannels(token) {
  const data = await slackRequest(token, 'conversations.list', {
    types: 'public_channel,private_channel',
    exclude_archived: true,
    limit: 200,
  });
  return (data.channels || []).map((c) => ({
    id: c.id,
    name: c.name,
    is_private: !!c.is_private,
    num_members: c.num_members || 0,
  }));
}

async function listUsers(token) {
  try {
    const data = await slackRequest(token, 'users.list', { limit: 200 });
    const map = {};
    for (const u of data.members || []) {
      map[u.id] = u.real_name || u.profile?.real_name || u.name || u.id;
    }
    return map;
  } catch (e) {
    // users.list may be outside token scopes — fall back to id-only labels.
    return {};
  }
}

async function readMessages(token, channel, limit = 50) {
  const data = await slackRequest(token, 'conversations.history', {
    channel,
    limit: Math.min(parseInt(limit, 10) || 50, 200),
  });
  const users = await listUsers(token);
  const messages = (data.messages || [])
    .filter((m) => !m.subtype || m.subtype === 'bot_message')
    .map((m) => ({
      ts: m.ts,
      user: users[m.user] || m.user || (m.username || 'bot'),
      text: String(m.text || m.attachments?.[0]?.fallback || '').trim(),
      ts_iso: m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : '',
    }))
    .filter((m) => m.text)
    .slice(0, limit);
  return messages;
}

async function postMessage(token, channel, text) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Message text is empty');
  const data = await slackRequest(token, 'chat.postMessage', { channel, text: clean });
  return { ts: data.ts, channel: data.channel };
}

function statePath(slug) {
  return path.join(STATE_DIR, `ingested-slack-${slug}.json`);
}

function loadState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ts: [] };
  }
}

function saveState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch (e) {
    console.warn('[slack] state save failed:', e.message);
  }
}

function formatMessagesForMemory(messages, channel) {
  const lines = [
    `REAL Slack messages from #${channel || 'channel'} (Slack).`,
    'Extract durable facts, decisions, commitments, dates, and project context into Continuum memory.',
    '',
  ];
  for (const m of messages) {
    lines.push(`[${m.ts_iso}] ${m.user}: ${m.text}`);
  }
  return lines.join('\n');
}

/**
 * Fetch recent messages from a Slack channel and feed new ones into
 * Continuum memory via /chat. Dedup by message ts. Returns a summary.
 */
async function ingestSlackChannel(token, channel, limit = 50) {
  const messages = await readMessages(token, channel, limit);
  if (!messages.length) return { fetched: 0, ingested: 0, messages: [], reply: null };

  const file = statePath(String(channel).replace(/[^A-Za-z0-9_.-]/g, '_'));
  const state = loadState(file);
  const seen = new Set(state.ts || []);
  const batch = messages.filter((m) => !seen.has(m.ts));

  if (!batch.length) return { fetched: messages.length, ingested: 0, messages, reply: null };

  const block = formatMessagesForMemory(batch, channel);
  const prompt = [
    block,
    '',
    '---',
    'Summarize key facts from these Slack messages and ensure important decisions, commitments, dates, and project details are captured in memory.',
    'Reply with a short confirmation of what was remembered (people, dates, action items).',
  ].join('\n');

  const { callContinuum } = require('../../skills/continuum-brain/scripts/ask');
  const { loadConfig } = require('../../skills/continuum-brain/scripts/config');
  const config = loadConfig();
  const result = await callContinuum(prompt, config, {
    channel: 'slack',
    sender: channel,
    clientTime: new Date().toLocaleString(),
  });

  saveState(file, { ts: [...new Set([...seen, ...batch.map((m) => m.ts)])] });

  return {
    fetched: messages.length,
    ingested: batch.length,
    messages,
    reply: result.reply,
  };
}

module.exports = {
  listChannels,
  listUsers,
  readMessages,
  postMessage,
  ingestSlackChannel,
  formatMessagesForMemory,
};
