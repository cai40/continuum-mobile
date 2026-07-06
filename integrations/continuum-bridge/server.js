#!/usr/bin/env node
'use strict';

/**
 * Continuum ↔ OpenClaw bridge
 * - POST /chat/stream  ← Continuum mobile app (Continuum memory + OpenClaw email)
 * - POST /ask          ← CLI / OpenClaw skill
 * - GET  /health
 */

const http = require('http');
const path = require('path');

const skillRoot = path.join(__dirname, '../../skills/continuum-brain');
const { loadConfig } = require(path.join(skillRoot, 'scripts/config'));
const { callContinuum } = require(path.join(skillRoot, 'scripts/ask'));
const { fetchEmailContext, getEmailHealth } = require('./emailContext');
const { wantsEmailFetch, wantsEmailSummaryOnly } = require('./emailFetchOptions');
const { fetchWebContext } = require('./webContext');
const bridgeVersion = require('./bridgeVersion');
const { wantsEmailMemoryIngest, parseSenderFromMessage } = require('./emailSender');
const { wantsEmailMoveToFolder } = require('./emailMove');
const {
  appendGroundingPersona,
  EMAIL_LIVE_INBOX_APPEND,
  EMAIL_LIVE_INBOX_DELETE_APPEND,
  EMAIL_LIVE_INBOX_MOVE_APPEND,
  EMAIL_LIVE_INBOX_MEMORY_APPEND,
  WEB_SEARCH_APPEND,
} = require('./groundingPrompt');

const PORT = parseInt(process.env.CONTINUUM_BRIDGE_PORT || '8787', 10);
const HOST = process.env.CONTINUUM_BRIDGE_HOST || '127.0.0.1';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function verifyBridgeSecret(req, config) {
  const header = req.headers['x-bridge-secret'] || '';
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const secret = config.bridgeSecret || '';
  if (!secret) return true;
  return header === secret || bearer === secret;
}

function sanitizeUpstreamError(raw, status) {
  const text = String(raw || '').trim();
  if (!text) return `Upstream request failed (${status || 'unknown'})`;
  if (/^\s*</.test(text) || /<!DOCTYPE/i.test(text) || /<html/i.test(text)) {
    if (/cloudflare/i.test(text)) {
      return 'Cloudflare timed out or blocked the request. Email fetch can take 1–2 minutes — retry, or run a smaller date range with a lower limit.';
    }
    if (status === 502 || status === 503 || status === 504) {
      return `Continuum backend unavailable (${status}). Try again in a moment.`;
    }
    return `Server returned an HTML error page (${status || 'error'}) instead of a chat reply. Retry shortly.`;
  }
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

function beginSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const write = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const keepalive = setInterval(() => write('ping', { t: Date.now() }), 20000);
  const end = () => {
    clearInterval(keepalive);
    res.end();
  };
  return { write, end };
}

function slimHistory(history) {
  return (history || []).slice(-4).map((m) => ({
    role: m.role || 'user',
    content: String(m.content || '').slice(0, 3000),
  }));
}

function buildContinuumForm(payload) {
  const form = new FormData();
  const msg = String(payload.message || '');
  form.append('message', msg.length > 900000 ? `${msg.slice(0, 900000)}\n\n[truncated for size]` : msg);
  form.append('provider', payload.provider || 'gemini');
  form.append('history', JSON.stringify(slimHistory(payload.history)));
  if (payload.persona) form.append('persona', payload.persona);
  if (payload.gemini_key) form.append('gemini_key', payload.gemini_key);
  if (payload.groq_key) form.append('groq_key', payload.groq_key);
  if (payload.api_key) form.append('api_key', payload.api_key);
  if (payload.lat) form.append('lat', String(payload.lat));
  if (payload.lon) form.append('lon', String(payload.lon));
  if (payload.client_time) form.append('client_time', payload.client_time);
  if (payload.synthesize_voice) form.append('synthesize_voice', 'True');
  if (payload.voice_model) form.append('voice_model', payload.voice_model);
  return form;
}

async function maybeFetchWebContext(message) {
  const result = await fetchWebContext(message);
  if (!result.matched) return null;
  if (result.context) return result.context;
  if (result.error) return `[Web search not available]\n${result.error}`;
  return null;
}

async function maybeFetchEmailContext(message, payloadOptions = {}) {
  const result = await fetchEmailContext(message, payloadOptions);
  if (!result.matched) return null;
  if (result.context) return result.context;
  if (result.error) return `[Yahoo email not available]\n${result.error}`;
  return '[Yahoo email] No messages returned.';
}

async function handleAsk(req, res, config) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return json(res, 400, { success: false, error: 'Invalid JSON body' });
  }

  const message = (body.message || '').trim();
  if (!message) {
    return json(res, 400, { success: false, error: 'message is required' });
  }

  const result = await callContinuum(message, config, {
    channel: body.channel || 'bridge',
    sender: body.sender,
    history: body.history || [],
    clientTime: body.client_time,
  });

  return json(res, 200, {
    success: true,
    reply: result.reply,
    source: 'continuum',
    channel: body.channel || 'bridge',
  });
}

async function handleChatStream(req, res, config) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }

  const userAuth = req.headers.authorization || '';
  if (!userAuth.startsWith('Bearer ')) {
    return json(res, 401, { success: false, error: 'Missing Continuum session token' });
  }

  const raw = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return json(res, 400, { success: false, error: 'Invalid JSON body' });
  }

  let message = (payload.message || '').trim();
  if (!message) {
    return json(res, 400, { success: false, error: 'message is required' });
  }

  // Open SSE before slow IMAP / upstream work so Cloudflare tunnels stay alive.
  const sse = beginSse(res);
  sse.write('status', { detail: 'Starting…' });

  const isEmailRequest = wantsEmailFetch(message);
  let webContext = null;
  if (!isEmailRequest) {
    sse.write('status', { detail: 'Searching the web (if needed)…' });
    const alreadyHasWebSearch = /\[Web search\s*[—-]/i.test(message);
    webContext = alreadyHasWebSearch ? null : await maybeFetchWebContext(message);
  }

  const emailLimit = parseInt(payload.email_limit, 10) || 0;
  const emailStatus = emailLimit >= 500
    ? `Fetching Yahoo inbox (up to ${emailLimit} — may take 3–8 minutes)…`
    : 'Fetching Yahoo inbox (if requested)…';
  sse.write('status', { detail: emailStatus });
  const emailContext = await maybeFetchEmailContext(message, {
    email_limit: payload.email_limit,
    email_offset: payload.email_offset,
    email_recent: payload.email_recent,
    email_since: payload.email_since,
    email_before: payload.email_before,
    email_delete_enabled: payload.email_delete_enabled,
    email_auto_trash_junk: payload.email_auto_trash_junk,
    history: payload.history,
  });
  const hasLiveInbox = emailContext && !emailContext.startsWith('[Yahoo email not available]');
  const hasWebSearch = !!webContext && !webContext.startsWith('[Web search not available]');

  if (webContext) {
    message = [
      'IMPORTANT: Live web search results are provided below (OpenClaw VPS bridge).',
      'Use these results for current scores, news, weather, and live facts.',
      'Do NOT say you lack internet access or cannot search the web when this block is present.',
      'Cite source titles/URLs when summarizing. If results are insufficient, say what is missing.',
      '',
      webContext,
      '',
      '---',
      'User request:',
      message,
    ].join('\n');
    payload.message = message;
    if (!emailContext) payload.history = [];
  }

  if (emailContext) {
    const deleteEnabled = !!payload.email_delete_enabled;
    const summaryOnly = wantsEmailSummaryOnly(message) || /SUMMARY MODE:/i.test(emailContext);
    message = [
      'IMPORTANT: Live Yahoo inbox data is provided below (user-authorized via OpenClaw VPS).',
      summaryOnly
        ? 'SUMMARY MODE: Give aggregate counts, categories, top senders, and themes ONLY — do NOT list individual emails or UIDs. Distinguish MAILBOX SCAN "Matched" (inbox total for the filter) from SUMMARY MODE "loaded in this batch" (fetch cap). Never label the batch count as total emails for the month.'
        : 'Summarize ONLY the emails explicitly listed below with their UIDs.',
      'If a MAILBOX SCAN block appears below, copy its Scanned/ dates / Matched lines into your reply — never omit them.',
      'If [EMAIL TRASH RESULT] appears below, copy its trash line verbatim — do not paraphrase as a rounded number.',
      'NEVER invent, simulate, reconstruct, or guess any email, UID, sender, or subject.',
      'If fewer emails were fetched than the user requested, say exactly how many were returned and stop — do not fill in gaps.',
      'Do NOT reference emails from earlier chat turns unless they appear in the list below.',
      'Do NOT say you cannot access email or external accounts.',
      deleteEnabled
        ? 'The user has enabled move-to-Trash. The bridge may have ALREADY moved mail to Yahoo Trash via IMAP before this reply — check for [Email trash executed] or [Email cleanup executed] below. Confirm only what that block lists. NEVER say "deleted" or "permanently removed" — say "moved to Trash". NEVER tell the user to run terminal/bash/VPS commands.'
        : 'Do NOT move emails to Trash unless the user has enabled "Allow move to Trash" in app settings.',
      '',
      emailContext,
      '',
      '---',
      'User request:',
      message,
    ].join('\n');
    payload.message = message;
    // Fresh email fetch: drop chat history so prior (possibly hallucinated) summaries cannot contaminate.
    payload.history = [];
  }

  if (hasLiveInbox) {
    const memoryIngest = wantsEmailMemoryIngest(message)
      || (parseSenderFromMessage(message) && /\b(memory|continuum|remember|feed|ingest)\b/i.test(message));
    let inboxAppend = EMAIL_LIVE_INBOX_APPEND;
    if (memoryIngest && !payload.email_delete_enabled) inboxAppend = EMAIL_LIVE_INBOX_MEMORY_APPEND;
    if (payload.email_delete_enabled) {
      inboxAppend = wantsEmailMoveToFolder(message)
        ? EMAIL_LIVE_INBOX_MOVE_APPEND
        : EMAIL_LIVE_INBOX_DELETE_APPEND;
    }
    payload.persona = appendGroundingPersona(payload.persona || '', [inboxAppend]);
  } else if (hasWebSearch) {
    payload.persona = appendGroundingPersona(payload.persona || '', [WEB_SEARCH_APPEND]);
  } else {
    payload.persona = appendGroundingPersona(payload.persona || '');
  }

  sse.write('status', { detail: 'Asking Continuum…' });
  const form = buildContinuumForm(payload);
  const upstream = await fetch(`${config.apiUrl}/chat/stream`, {
    method: 'POST',
    headers: { Authorization: userAuth },
    body: form,
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    const hint = /not\s*found/i.test(detail) && upstream.status === 404
      ? `${detail}\n\nFix: set CONTINUUM_API_URL=https://continuum-backend-0q9j.onrender.com on Render (no /integrations/email path) and redeploy.`
      : detail;
    sse.write('error', { detail: sanitizeUpstreamError(hint, upstream.status) });
    sse.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    sse.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const config = loadConfig();

    if (req.method === 'GET' && req.url === '/health') {
      const quickHealth = process.env.RENDER === 'true' || process.env.HEALTH_CHECK_QUICK === '1';
      const emailHealth = await getEmailHealth({ quick: quickHealth });
      return json(res, 200, {
        success: true,
        service: 'continuum-bridge',
        bridge_version: bridgeVersion.version,
        features: bridgeVersion.features,
        continuum_api: config.apiUrl,
        openclaw: true,
        email: emailHealth,
      });
    }

    if (req.method === 'POST' && req.url === '/ask') {
      if (!verifyBridgeSecret(req, config)) {
        return json(res, 401, { success: false, error: 'Invalid bridge secret' });
      }
      return await handleAsk(req, res, config);
    }

    if (req.method === 'POST' && req.url === '/chat/stream') {
      return await handleChatStream(req, res, config);
    }

    return json(res, 404, { success: false, error: 'Not found' });
  } catch (err) {
    return json(res, 500, { success: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Continuum bridge listening on http://${HOST}:${PORT}`);
  console.log('  GET  /health');
  console.log('  POST /chat/stream  (Continuum app + OpenClaw email)');
  console.log('  POST /ask          (CLI / skill)');
});
