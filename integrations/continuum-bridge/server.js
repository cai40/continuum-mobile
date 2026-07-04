#!/usr/bin/env node
'use strict';

/**
 * Continuum Bridge — thin HTTP router on the OpenClaw VPS.
 * POST /ask  → Continuum /chat (memory-aware brain)
 * GET  /health → liveness
 *
 * Bind loopback by default. Use SSH tunnel or reverse proxy for remote access.
 */

const http = require('http');
const path = require('path');

const skillRoot = path.join(__dirname, '../../skills/continuum-brain');
const { loadConfig } = require(path.join(skillRoot, 'scripts/config'));
const { callContinuum } = require(path.join(skillRoot, 'scripts/ask'));

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

async function handleAsk(req, res, config) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (config.bridgeSecret && token !== config.bridgeSecret) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }

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
    channel: body.channel,
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

const server = http.createServer(async (req, res) => {
  try {
    const config = loadConfig();

    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, {
        success: true,
        service: 'continuum-bridge',
        continuum_api: config.apiUrl,
      });
    }

    if (req.method === 'POST' && req.url === '/ask') {
      return await handleAsk(req, res, config);
    }

    return json(res, 404, { success: false, error: 'Not found' });
  } catch (err) {
    return json(res, 500, { success: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Continuum bridge listening on http://${HOST}:${PORT}`);
  console.log('  GET  /health');
  console.log('  POST /ask  (Authorization: Bearer <BRIDGE_SECRET>)');
});
