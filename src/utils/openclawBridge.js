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
  const userMessages = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row?.role !== 'user') continue;
    const text = String(row.content || '').trim();
    if (!text || isEmailConfirmMessage(text)) continue;
    userMessages.push(text);
  }

  const preview = userMessages.find((text) => /\bpreview\s+email\s+cleanup\b/i.test(text));
  if (preview) return preview;

  for (const text of userMessages) {
    if (/\b(clean\s*up|cleanup)\b.*\b(emails?|inbox|mail)\b/i.test(text)) return text;
    if (/\b(emails?|inbox|yahoo|mail|clean|fetch|apr|april)\b/i.test(text)) return text;
  }
  return null;
}

export function isEmailConfirmMessage(text) {
  const input = String(text || '').trim();
  if (input.length > 120) return false;
  return /\b(yes|yeah|yep|ok(?:ay)?|apply|confirm|confirmed|proceed|go ahead|do it|approved|approve|run)\b/i.test(input)
    && !/\b(emails?|inbox|clean|fetch|apr|april|yahoo|preview)\b/i.test(input);
}

/** Merge a short confirm after preview into an apply command for the email bridge. */
export function buildEmailConfirmPayloadMessage(priorMessage, confirmText) {
  const prior = String(priorMessage || '').trim();
  const confirm = String(confirmText || '').trim();
  if (!prior || !confirm) return confirmText;

  if (/\bpreview\s+email\s+cleanup\b/i.test(prior)) {
    if (/^preview\s+email\s+cleanup\s+for\s+today$/i.test(prior)) {
      return 'clean up today emails';
    }
    const month = prior.match(/^preview\s+email\s+cleanup\s+for\s+([A-Za-z]+)\s+(20\d{2})$/i);
    if (month) {
      return `clean up ${month[1]} ${month[2]} emails`;
    }
    const range = prior.match(/^preview\s+email\s+cleanup\s+from\s+(.+?)\s+to\s+(.+)$/i);
    if (range) {
      return `clean up emails from ${range[1]} to ${range[2]}`;
    }
    if (/^preview\s+email\s+cleanup\s+inbox$/i.test(prior)) {
      return 'clean up inbox';
    }
  }

  return `${prior}\n\nUser confirmation: ${confirm}`;
}
