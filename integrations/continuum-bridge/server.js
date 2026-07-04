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

function buildContinuumForm(payload) {
  const form = new FormData();
  form.append('message', payload.message);
  form.append('provider', payload.provider || 'gemini');
  form.append('history', JSON.stringify(payload.history || []));
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

async function maybeFetchEmailContext(message) {
  const result = await fetchEmailContext(message);
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

  const emailContext = await maybeFetchEmailContext(message);
  if (emailContext) {
    message = [
      '[OpenClaw Yahoo inbox snapshot — use for email questions]',
      emailContext,
      '',
      '[User message]',
      message,
    ].join('\n');
    payload.message = message;
  }

  const form = buildContinuumForm(payload);
  const upstream = await fetch(`${config.apiUrl}/chat/stream`, {
    method: 'POST',
    headers: { Authorization: userAuth },
    body: form,
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return json(res, upstream.status, { success: false, error: detail });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const config = loadConfig();

    if (req.method === 'GET' && req.url === '/health') {
      const emailHealth = await getEmailHealth();
      return json(res, 200, {
        success: true,
        service: 'continuum-bridge',
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
