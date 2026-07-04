import { OPENCLAW_BRIDGE_PORT, DEFAULT_OPENCLAW_BRIDGE_SECRET } from '../constants/Config';

export function resolveBridgeSecret(storedSecret) {
  const trimmed = storedSecret?.trim();
  return trimmed || DEFAULT_OPENCLAW_BRIDGE_SECRET;
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
  return `http://${ip}:${OPENCLAW_BRIDGE_PORT}`;
}

export function isHttpsBridgeUrl(url) {
  return /^https:\/\//i.test(url || '');
}
