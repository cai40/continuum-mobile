/** Continuum provider ids sent to /chat/stream as form field `provider`. */

export const PROVIDER_LABELS = {
  openrouter: 'CLAUDE',
  or_free: 'OR FREE',
  deepseek: 'DS V3.2',
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

/** OpenRouter model ids Continuum backend is expected to map providers to. */
export const PROVIDER_OPENROUTER_MODELS = {
  deepseek: 'deepseek/deepseek-v3.2',
  'deepseek_v3.2': 'deepseek/deepseek-v3.2',
  deepseek_v4_pro: 'deepseek/deepseek-v4-pro',
  deepseek_v4_flash: 'deepseek/deepseek-v4-flash',
  openrouter: 'anthropic/claude-sonnet-4',
  or_free: 'openrouter/free',
  qwen: 'qwen/qwen3-235b-a22b',
  gpt4o_mini: 'openai/gpt-4o-mini',
  'kimi_k2.6': 'moonshotai/kimi-k2.5',
  minimax: 'minimax/minimax-m2.5',
};

export function normalizeProviderId(provider) {
  if (!provider) return 'deepseek_v3.2';
  if (provider === 'deepseek') return 'deepseek_v3.2';
  return provider;
}

export function providerDisplayLabel(provider) {
  const id = normalizeProviderId(provider);
  return PROVIDER_LABELS[id] || String(id).toUpperCase();
}

export function providerBadgeColor(provider, colors) {
  const id = normalizeProviderId(provider);
  if (id === 'deepseek_v4_flash') return '#00B894';
  if (id === 'deepseek_v4_pro') return '#6C5CE7';
  if (id === 'deepseek_v3.2' || id === 'deepseek') return colors?.secondary || '#FF9F43';
  if (id === 'gemini') return colors?.primary || '#007AFF';
  return colors?.gray || '#8E8E93';
}

export function providerSelectionMessage(provider) {
  const id = normalizeProviderId(provider);
  const label = providerDisplayLabel(id);
  const openRouterModel = PROVIDER_OPENROUTER_MODELS[id];
  const lines = [
    `Active Continuum provider: ${id}`,
    `Header badge: ${label}`,
  ];
  if (openRouterModel) {
    lines.push(`Backend should call OpenRouter model: ${openRouterModel}`);
  }
  if (id.startsWith('deepseek')) {
    lines.push(
      'Paste your key in the DeepSeek box (OpenRouter key also works as fallback), then tap SECURE ALL KEYS.',
    );
    lines.push(
      'Asking the chat “what model are you?” is unreliable — models often misname themselves. Use Verify routing in Setup, or check OpenRouter usage.',
    );
  }
  return lines.join('\n');
}

/**
 * Ask OpenRouter which model id it actually served.
 * Uses the Continuum→OpenRouter mapping for the selected provider.
 */
export async function verifyProviderRouting(provider, apiKey) {
  const id = normalizeProviderId(provider);
  const model = PROVIDER_OPENROUTER_MODELS[id];
  const key = String(apiKey || '').trim();
  if (!model) {
    return { ok: false, error: `No OpenRouter model mapping for provider ${id}` };
  }
  if (!key) {
    return { ok: false, error: 'Add an OpenRouter or DeepSeek (OpenRouter) key first.' };
  }
  if (!key.startsWith('sk-or-') && id.startsWith('deepseek')) {
    // Platform DeepSeek keys cannot query OpenRouter model routing.
    return {
      ok: false,
      error:
        'Your key does not look like an OpenRouter key (sk-or-…). '
        + 'Continuum DeepSeek buttons are routed through OpenRouter model ids. '
        + 'Paste an OpenRouter key to verify V4 Flash routing, or check OpenRouter activity after a chat.',
      provider: id,
      expectedModel: model,
    };
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://continuum.advisor',
      'X-Title': 'Continuum Mobile',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      max_tokens: 8,
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
      error: json?.error?.message || text.slice(0, 240) || `OpenRouter error ${res.status}`,
    };
  }
  const served = json?.model || null;
  return {
    ok: true,
    provider: id,
    expectedModel: model,
    servedModel: served,
    matched: !served || String(served).includes('v4-flash') || served === model || served.startsWith(`${model}`),
  };
}
