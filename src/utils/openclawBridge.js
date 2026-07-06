import { OPENCLAW_BRIDGE_PORT, DEFAULT_OPENCLAW_BRIDGE_SECRET } from '../constants/Config';

export function resolveBridgeSecret(storedSecret) {
  const trimmed = storedSecret?.trim();
  return trimmed || DEFAULT_OPENCLAW_BRIDGE_SECRET;
}

/** Render email bridge has its own BRIDGE_SECRET on Render — no VPS default. */
export function resolveRenderEmailBridgeSecret(storedSecret) {
  return storedSecret?.trim() || "";
}

/**
 * Prefer HTTPS tunnel URL (Cloudflare) — iPhone blocks plain HTTP to VPS IP.
 */
export function resolveBridgeBaseUrl({ httpsUrl, vpsIp, defaultVpsIp }) {
  const https = httpsUrl?.trim();
  if (https) {
    return https.replace(/\/$/, '');
  }
  const ip = vpsIp?.trim() || defaultVpsIp?.trim();
  if (!ip) return null;
  if (/^https:\/\//i.test(ip)) {
    return ip.replace(/\/$/, '');
  }
  return `http://${ip}:${OPENCLAW_BRIDGE_PORT}`;
}

export function isHttpsBridgeUrl(url) {
  return /^https:\/\//i.test(url || '');
}

/** Last user message that requested inbox fetch/cleanup (for "yes proceed" confirm). */
export function findPriorEmailUserMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row?.role !== 'user') continue;
    const text = String(row.content || '').trim();
    if (!text) continue;
    if (/\b(emails?|inbox|yahoo|mail|clean|fetch|apr|april)\b/i.test(text)) return text;
  }
  return null;
}

export function isEmailConfirmMessage(text) {
  const input = String(text || '').trim();
  if (input.length > 120) return false;
  return /\b(yes|yeah|yep|confirm|confirmed|proceed|go ahead|do it|approved|approve)\b/i.test(input)
    && !/\b(emails?|inbox|clean|fetch|apr|april|yahoo)\b/i.test(input);
}
