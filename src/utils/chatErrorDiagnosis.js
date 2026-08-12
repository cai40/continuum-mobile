/**
 * Self-diagnosis for chat failures. Classifies an error, decides whether the
 * app can retry on its own, and produces a plain-language explanation + a
 * concrete fix, so the app behaves like an agent instead of dumping raw
 * errors on the user.
 */
import { friendlyChatError } from './helpers';

const AUTH = /401|403|unauthorized|invalid.*api.?key|api.?key.*(invalid|rejected)|permission denied|invalid authentication credentials|api key not valid/i;
const QUOTA = /429|rate.?limit|too many requests|quota|resource_exhausted|insufficient_quota|billing|spend cap|daily.?limit|monthly.?limit/i;
const CONTEXT = /context_length_exceeded|maximum context length|128000|128k|token limit|prompt too (long|large)|exceeded.*(context|token)/i;
const PAYLOAD = /1mb|exceeded maximum size|1024\s*kb|request too large|payload too large|413/i;
const BRIDGE = /email.?job.*(not found|expired)|job not found|bridge.*(down|unavailable|restart|oob)|heap out.?of.?memory|javascript heap oom/i;
const NETWORK = /network request failed|failed to fetch|network error|timed out|cannot reach|connection|socket|econn|etimedout|offline|internet|\b502\b|\b503\b|\b504\b/i;

/** Raw error string helper — accepts Error objects, JSON strings, or plain text. */
export function rawErrorMessage(raw) {
  const v = raw?.message || raw || '';
  let text = String(v).trim();
  try {
    const parsed = JSON.parse(text);
    text = String(parsed?.detail || parsed?.error || parsed?.message || text).trim();
  } catch {
    // not JSON
  }
  return text;
}

export function diagnoseChatError(raw, context = {}) {
  const text = rawErrorMessage(raw);
  const provider = context.provider || '';

  if (AUTH.test(text)) {
    return {
      kind: 'auth',
      retryable: false,
      title: 'Authentication failed',
      message: 'The app could not authenticate with the AI provider.',
      tip: provider === 'gemini'
        ? 'Open Setup → Intelligence & API Keys → check your Google Gemini key and that billing is enabled.'
        : provider === 'deepseek_v4_flash' || provider === 'deepseek_v4_pro'
          ? 'Open Setup → Intelligence & API Keys → check your DeepSeek platform key. If it starts with sk-or-…, that is an OpenRouter key — paste a key from platform.deepseek.com instead.'
          : 'Open Setup → Intelligence & API Keys → verify the API key for the selected provider, then try again.',
    };
  }

  if (QUOTA.test(text)) {
    return {
      kind: 'quota',
      retryable: true,
      retryDelayMs: 5000,
      title: 'API quota reached',
      message: 'The AI provider hit a rate or spending limit.',
      tip: 'The app will retry shortly. If it keeps failing, wait a minute or switch models under Setup → Intelligence & API Keys. Free-tier keys often have daily limits.',
    };
  }

  if (CONTEXT.test(text)) {
    return {
      kind: 'context',
      retryable: false,
      title: 'Too much content for the model',
      message: 'The request or chat history exceeded the model’s context limit.',
      tip: 'Start a new thread or clear chat history under Setup → Data. Large inbox fetches now return compact summaries.',
    };
  }

  if (PAYLOAD.test(text)) {
    return {
      kind: 'payload',
      retryable: false,
      title: 'Message too large',
      message: 'The message exceeded the server limit.',
      tip: 'Remove large attachments or clear chat history under Setup → Data, then try again.',
    };
  }

  if (BRIDGE.test(text) || (context.emailQuery && NETWORK.test(text))) {
    return {
      kind: 'bridge',
      retryable: true,
      retryDelayMs: 3000,
      title: 'Email bridge hiccup',
      message: 'The cloud email service did not respond properly.',
      tip: 'Wait a few seconds — the bridge wakes up after idle — and retry. Large cleanups continue in the background; keep the app open.',
    };
  }

  if (NETWORK.test(text)) {
    return {
      kind: 'network',
      retryable: true,
      retryDelayMs: 3000,
      title: 'Connection problem',
      message: 'The app could not reach the AI service.',
      tip: 'Check Wi-Fi/cellular, then retry. The app will try again automatically.',
    };
  }

  return {
    kind: 'unknown',
    retryable: false,
    title: 'Something went wrong',
    message: friendlyChatError(raw),
    tip: 'I will look this error up online and tell you what it usually means.',
  };
}
