'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'continuum-openclaw', '.env');

function parseEnv(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Missing config at ${CONFIG_PATH}. Run: bash setup.sh`,
    );
  }
  const raw = parseEnv(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return {
    apiUrl: raw.CONTINUUM_API_URL || 'https://continuum-backend-0q9j.onrender.com',
    supabaseUrl: raw.SUPABASE_URL || 'https://yybojfgjhtrwqhtavorg.supabase.co',
    supabaseAnonKey: raw.SUPABASE_ANON_KEY || '',
    accessToken: raw.CONTINUUM_ACCESS_TOKEN || '',
    refreshToken: raw.CONTINUUM_REFRESH_TOKEN || '',
    provider: raw.CONTINUUM_PROVIDER || 'gemini',
    geminiKey: raw.GEMINI_API_KEY || '',
    groqKey: raw.GROQ_API_KEY || '',
    openaiKey: raw.OPENAI_API_KEY || '',
    openrouterKey: raw.OPENROUTER_API_KEY || '',
    persona: raw.CONTINUUM_PERSONA || '',
    bridgeSecret: raw.BRIDGE_SECRET || '',
    configPath: CONFIG_PATH,
  };
}

function saveAccessToken(token) {
  const content = fs.readFileSync(CONFIG_PATH, 'utf8');
  if (/^CONTINUUM_ACCESS_TOKEN=/m.test(content)) {
    fs.writeFileSync(
      CONFIG_PATH,
      content.replace(/^CONTINUUM_ACCESS_TOKEN=.*$/m, `CONTINUUM_ACCESS_TOKEN=${token}`),
      { mode: 0o600 },
    );
    return;
  }
  fs.appendFileSync(CONFIG_PATH, `\nCONTINUUM_ACCESS_TOKEN=${token}\n`, { mode: 0o600 });
}

module.exports = { loadConfig, saveAccessToken, CONFIG_PATH };
