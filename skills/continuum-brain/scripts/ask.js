#!/usr/bin/env node
'use strict';

const { loadConfig, saveAccessToken } = require('./config');

async function refreshAccessToken(config) {
  if (!config.refreshToken || !config.supabaseAnonKey) {
    throw new Error(
      'CONTINUUM_ACCESS_TOKEN expired. Set CONTINUUM_REFRESH_TOKEN in ~/.config/continuum-openclaw/.env (copy from Continuum app Settings → OpenClaw Gateway).',
    );
  }

  const res = await fetch(
    `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: config.refreshToken }),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase token refresh failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Supabase refresh returned no access_token');
  }

  saveAccessToken(data.access_token);
  return data.access_token;
}

async function ensureAccessToken(config) {
  if (config.accessToken) return config.accessToken;
  return refreshAccessToken(config);
}

function buildFormData(message, config, options = {}) {
  const form = new FormData();
  form.append('message', message);
  form.append('provider', config.provider || 'gemini');
  form.append('history', JSON.stringify(options.history || []));

  if (config.geminiKey) form.append('gemini_key', config.geminiKey);
  if (config.groqKey) form.append('groq_key', config.groqKey);
  if (config.openaiKey) form.append('api_key', config.openaiKey);
  if (config.openrouterKey) form.append('api_key', config.openrouterKey);

  let persona = config.persona || '';
  if (options.channel) {
    persona = [
      persona,
      `Channel context: message arrived via ${options.channel}.`,
      options.sender ? `Sender: ${options.sender}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (persona) form.append('persona', persona);
  if (options.clientTime) form.append('client_time', options.clientTime);

  return form;
}

async function callContinuum(message, config, options = {}) {
  let token = await ensureAccessToken(config);
  const form = buildFormData(message, config, options);

  let res = await fetch(`${config.apiUrl}/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (res.status === 401) {
    token = await refreshAccessToken(config);
    res = await fetch(`${config.apiUrl}/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: buildFormData(message, config, options),
    });
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Continuum /chat failed (${res.status}): ${detail}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await res.json();
    return {
      reply: json.reply || json.response || json.content || json.message || JSON.stringify(json),
      raw: json,
    };
  }

  const text = await res.text();
  return { reply: text.trim(), raw: { text } };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = { history: [] };
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--channel') {
      options.channel = args[++i];
    } else if (arg === '--sender') {
      options.sender = args[++i];
    } else if (arg === '--history') {
      options.history = JSON.parse(args[++i] || '[]');
    } else if (arg === '--json') {
      options.json = true;
    } else {
      positional.push(arg);
    }
  }

  const message = positional.join(' ').trim();
  if (!message) {
    console.error('Usage: node scripts/ask.js [--channel sms|email|cli] [--sender ID] "your message"');
    process.exit(1);
  }

  return { message, options };
}

async function main() {
  const { message, options } = parseArgs(process.argv);
  const config = loadConfig();
  const result = await callContinuum(message, config, options);

  if (options.json) {
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
  } else {
    console.log(result.reply);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  });
}

module.exports = { callContinuum, refreshAccessToken };
