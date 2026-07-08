import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { RENDER_EMAIL_BRIDGE_URL } from '../constants/Config';
import { resolveEmailFetchPayload } from './openclawEmailOptions';

const PENDING_JOB_KEY = '@continuum_pending_email_job';

/** Mirror bridge wantsBackgroundEmailJob for client-side routing. */
export function shouldRunEmailInBackground(message) {
  const text = String(message || '');
  if (!/\b(emails?|inbox|yahoo|mail|unread|smtp|imap|junk|spam|trash|skip|fetch|batch|page|clean)\b/i.test(text)) {
    return false;
  }
  if (/\b(clean\s*up|cleanup|cleaning\s+up|clean\s+(?:my|the)\s+inbox|declutter)\b/i.test(text)) return true;
  if (/\bfetch\s+and\s+clean\b/i.test(text)) return true;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:\d{4}\s+)?emails?\b/i.test(text)) return true;
  if (/\b(?:for|in|during)\s+(?:the\s+)?(?:month\s+of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)) return true;
  if (/\b(?:for|in|during)\s+(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/i.test(text)) return true;
  if (/\b(?:for|in|during)\s+(?:the\s+)?(?:whole\s+)?(?:year\s+)?(20\d{2})\b/i.test(text)) return true;
  const limitMatch = text.match(/\blimit\s+(\d{3,})\b/i);
  if (limitMatch && parseInt(limitMatch[1], 10) >= 250) return true;
  return false;
}

export async function savePendingEmailJob(jobId) {
  if (!jobId) return;
  await AsyncStorage.setItem(PENDING_JOB_KEY, String(jobId));
}

export async function loadPendingEmailJob() {
  try {
    return await AsyncStorage.getItem(PENDING_JOB_KEY);
  } catch {
    return null;
  }
}

export async function clearPendingEmailJob() {
  try {
    await AsyncStorage.removeItem(PENDING_JOB_KEY);
  } catch {
    // ignore
  }
}

export async function submitBackgroundEmailJob(bridgeSecret, payload, authToken, baseUrl = RENDER_EMAIL_BRIDGE_URL) {
  const root = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${root}/email-jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(bridgeSecret ? { 'X-Bridge-Secret': bridgeSecret } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `Background job failed (${res.status})`);
  }
  return data;
}

export async function fetchEmailJobStatus(bridgeSecret, jobId, authToken, baseUrl = RENDER_EMAIL_BRIDGE_URL) {
  const root = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${root}/email-jobs/${jobId}`, {
    headers: {
      Accept: 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(bridgeSecret ? { 'X-Bridge-Secret': bridgeSecret } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `Job status failed (${res.status})`);
  }
  return data.job || data;
}

/**
 * Poll a background email job until complete. Survives app backgrounding — resumes on foreground.
 */
export function pollEmailJobUntilDone({
  bridgeSecret,
  jobId,
  authToken,
  baseUrl = RENDER_EMAIL_BRIDGE_URL,
  onProgress,
  pollMs = 3000,
  maxWaitMs = 3600000,
}) {
  let cancelled = false;
  let timer = null;
  let sleeping = false;
  const started = Date.now();

  const cancel = () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    subscription?.remove();
  };

  const subscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active' && sleeping && !cancelled) {
      sleeping = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(runPoll, 300);
    }
  });

  const sleep = (ms) => new Promise((resolve) => {
    sleeping = true;
    timer = setTimeout(() => {
      sleeping = false;
      resolve();
    }, ms);
  });

  const runPoll = async () => {
    while (!cancelled) {
      if (Date.now() - started > maxWaitMs) {
        throw new Error('Background email job timed out after 1 hour.');
      }
      const job = await fetchEmailJobStatus(bridgeSecret, jobId, authToken, baseUrl);
      if (onProgress && job.progress) onProgress(job.progress, job.status);
      if (job.status === 'completed') {
        await clearPendingEmailJob();
        return job.result || '';
      }
      if (job.status === 'failed') {
        await clearPendingEmailJob();
        throw new Error(job.error || 'Background email job failed.');
      }
      await sleep(pollMs);
    }
    throw new Error('Background email job cancelled.');
  };

  return {
    promise: runPoll().then((result) => {
      cancel();
      return result;
    }).catch((err) => {
      cancel();
      throw err;
    }),
    cancel,
  };
}

export function buildEmailJobPayload({
  message,
  provider,
  persona,
  emailFetch,
  emailDeleteEnabled,
  emailAutoTrashJunk,
  keys,
  location,
  clientTime,
}) {
  return {
    message,
    provider,
    persona,
    ...emailFetch,
    email_delete_enabled: emailDeleteEnabled,
    email_auto_trash_junk: emailAutoTrashJunk,
    gemini_key: provider === 'gemini' ? (keys.geminiKey || '').trim() : '',
    groq_key: provider === 'groq' ? (keys.groqKey || '').trim() : '',
    api_key: (keys.apiKey || '').trim(),
    lat: location?.coords?.latitude?.toString(),
    lon: location?.coords?.longitude?.toString(),
    client_time: clientTime,
    history: [],
  };
}

export { resolveEmailFetchPayload };
