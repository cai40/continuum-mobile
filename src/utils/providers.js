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
  }
  return lines.join('\n');
}
