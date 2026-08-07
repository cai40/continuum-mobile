/** Continuum provider ids and DeepSeek platform (api.deepseek.com) model mapping. */

export const PROVIDER_LABELS = {
  openrouter: 'CLAUDE',
  or_free: 'OR FREE',
  deepseek: 'DS V4 FLASH',
  'deepseek_v3.2': 'DS V3.2',
  deepseek_v4_pro: 'DS V4 PRO',
  deepseek_v4_flash: 'DS V4 FLASH',
  qwen: 'QWEN',
  gpt4o_mini: '4O MINI',
  'kimi_k2.6': 'KIMI',
  minimax: 'MINIMAX',
  gemini: 'GEMINI',
  groq: 'GROQ',
  openai: 'OPENAI',
};

/**
 * Official DeepSeek platform model ids (https://api.deepseek.com).
 * NOT OpenRouter slugs — Continuum DeepSeek buttons use the DeepSeek API directly.
 */
export const DEEPSEEK_PLATFORM_MODELS = {
  deepseek: 'deepseek-v4-flash',
  'deepseek_v3.2': 'deepseek-v4-flash', // DS platform retired V3.2; Flash is the direct-API replacement
  deepseek_v4_pro: 'deepseek-v4-pro',
  deepseek_v4_flash: 'deepseek-v4-flash',
};

/** @deprecated OpenRouter mappings kept only for non-DeepSeek Continuum providers. */
export const PROVIDER_OPENROUTER_MODELS = {
  openrouter: 'anthropic/claude-sonnet-4',
  or_free: 'openrouter/free',
  qwen: 'qwen/qwen3-235b-a22b',
  gpt4o_mini: 'openai/gpt-4o-mini',
  'kimi_k2.6': 'moonshotai/kimi-k2.5',
  minimax: 'minimax/minimax-m2.5',
};

export const DEEPSEEK_PROVIDERS = [
  'deepseek',
  'deepseek_v3.2',
  'deepseek_v4_pro',
  'deepseek_v4_flash',
];

export function isDeepseekProvider(provider) {
  return DEEPSEEK_PROVIDERS.includes(normalizeProviderId(provider));
}

export function isOpenRouterKey(apiKey) {
  return String(apiKey || '').trim().startsWith('sk-or-');
}

export function normalizeProviderId(provider) {
  if (!provider) return 'deepseek_v4_flash';
  if (provider === 'deepseek') return 'deepseek_v4_flash';
  return provider;
}

export function deepseekPlatformModel(provider) {
  const id = normalizeProviderId(provider);
  return DEEPSEEK_PLATFORM_MODELS[id] || 'deepseek-v4-flash';
}

export function providerDisplayLabel(provider) {
  const id = normalizeProviderId(provider);
  return PROVIDER_LABELS[id] || String(id).toUpperCase();
}

export function providerBadgeColor(provider, colors) {
  const id = normalizeProviderId(provider);
  if (id === 'deepseek_v4_flash' || id === 'deepseek') return '#00B894';
  if (id === 'deepseek_v4_pro') return '#6C5CE7';
  if (id === 'deepseek_v3.2') return colors?.secondary || '#FF9F43';
  if (id === 'gemini') return colors?.primary || '#007AFF';
  return colors?.gray || '#8E8E93';
}

export function providerSelectionMessage(provider) {
  const id = normalizeProviderId(provider);
  const label = providerDisplayLabel(id);
  const lines = [
    `Active Continuum provider: ${id}`,
    `Header badge: ${label}`,
  ];
  if (isDeepseekProvider(id)) {
    lines.push(`DeepSeek API model: ${deepseekPlatformModel(id)}`);
    lines.push('Uses api.deepseek.com directly (not OpenRouter).');
    lines.push('Paste your DeepSeek platform key in the DeepSeek box, then SECURE ALL KEYS.');
    if (id === 'deepseek_v3.2') {
      lines.push('Note: DeepSeek platform no longer serves V3.2 — this button calls deepseek-v4-flash.');
    }
  } else if (PROVIDER_OPENROUTER_MODELS[id]) {
    lines.push(`OpenRouter model: ${PROVIDER_OPENROUTER_MODELS[id]}`);
  }
  return lines.join('\n');
}

/**
 * Verify DeepSeek platform API key + model against api.deepseek.com.
 */
export async function verifyProviderRouting(provider, apiKey) {
  const id = normalizeProviderId(provider);
  const key = String(apiKey || '').trim();

  if (!isDeepseekProvider(id)) {
    return { ok: false, error: 'Select a DeepSeek model (DS V4 FLASH / PRO) to verify the DeepSeek API.' };
  }

  const model = deepseekPlatformModel(id);
  if (!key) {
    return { ok: false, error: 'Add your DeepSeek platform API key in the DeepSeek box first.' };
  }
  if (isOpenRouterKey(key)) {
    return {
      ok: false,
      error:
        'That looks like an OpenRouter key (sk-or-…). '
        + 'For direct DeepSeek API, paste a key from https://platform.deepseek.com',
      provider: id,
      expectedModel: model,
    };
  }

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      max_tokens: 8,
      thinking: { type: 'disabled' },
    }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) {
    return {
      ok: false,
      provider: id,
      expectedModel: model,
      error: json?.error?.message || text.slice(0, 240) || `DeepSeek API error ${res.status}`,
    };
  }
  const served = json?.model || model;
  return {
    ok: true,
    provider: id,
    expectedModel: model,
    servedModel: served,
    matched: String(served).includes('v4-flash') || String(served).includes('v4-pro') || served === model,
    via: 'api.deepseek.com',
  };
}
