import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { RENDER_EMAIL_BRIDGE_URL } from '../constants/Config';
import { resolveEmailFetchPayload } from './openclawEmailOptions';

const PENDING_JOB_KEY = '@continuum_pending_email_job';
const PENDING_JOB_META_KEY = '@continuum_pending_email_job_meta';

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
  if (/\b(?:clean\s*up|cleanup|clean)\s+(?:all\s+of|entire|whole|full)\s+(20\d{2})\b/i.test(text)) return true;
  if (/\b(?:clean\s*up|cleanup|clean)\s+(20\d{2})\b/i.test(text)) return true;
  if (/\b(?:whole|full|entire)\s+year\s+(20\d{2})\b/i.test(text)) return true;
  const limitMatch = text.match(/\blimit\s+(\d{3,})\b/i);
  if (limitMatch && parseInt(limitMatch[1], 10) >= 250) return true;
  return false;
}

function normalizeJobMessage(message) {
  return String(message || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isYearCleanupMessage(message) {
  return /\b(?:clean\s*up|cleanup|clean)\s+(?:all\s+of|entire|whole|full\s+)?(?:year\s+)?(20\d{2})\b/i.test(String(message || ''))
    || /\b(?:whole|full|entire)\s+year\s+(20\d{2})\b/i.test(String(message || ''));
}

function jobMaxWaitMs(message) {
  return isYearCleanupMessage(message) ? 7200000 : 3600000;
}

export async function savePendingEmailJob(jobId, meta = null) {
  if (!jobId) return;
  await AsyncStorage.setItem(PENDING_JOB_KEY, String(jobId));
  if (meta) {
    await AsyncStorage.setItem(PENDING_JOB_META_KEY, JSON.stringify(meta));
  }
}

export async function loadPendingEmailJob() {
  try {
    return await AsyncStorage.getItem(PENDING_JOB_KEY);
  } catch {
    return null;
  }
}

export async function loadPendingEmailJobMeta() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_JOB_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearPendingEmailJob() {
  try {
    await AsyncStorage.multiRemove([PENDING_JOB_KEY, PENDING_JOB_META_KEY]);
  } catch {
    // ignore
  }
}

function jobHeaders(bridgeSecret, authToken) {
  return {
    Accept: 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(bridgeSecret ? { 'X-Bridge-Secret': bridgeSecret } : {}),
  };
}

export function isNetworkFailure(err) {
  const msg = String(err?.message || err || '');
  return /network request failed|failed to fetch|network error|timed out|timeout|ENOTFOUND|ECONNREFUSED|socket closed/i.test(msg);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wake Render email bridge (cold start can drop the first request). */
export async function wakeEmailBridge(bridgeSecret, baseUrl = RENDER_EMAIL_BRIDGE_URL) {
  const root = baseUrl.replace(/\/$/, '');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${root}/health`, {
        headers: jobHeaders(bridgeSecret, null),
        method: 'GET',
      });
      if (res.ok) return true;
    } catch {
      // retry once after brief pause (Render spin-up)
    }
    if (attempt === 0) await sleep(2500);
  }
  return false;
}

async function fetchWithRetry(url, options, { attempts = 3, baseDelayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1 && isNetworkFailure(err)) {
        await sleep(baseDelayMs * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function fetchLatestEmailJobs(bridgeSecret, authToken, baseUrl = RENDER_EMAIL_BRIDGE_URL) {
  const root = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${root}/email-jobs/latest`, {
    headers: jobHeaders(bridgeSecret, authToken),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `Latest jobs failed (${res.status})`);
  }
  return data.jobs || [];
}

export async function submitBackgroundEmailJob(bridgeSecret, payload, authToken, baseUrl = RENDER_EMAIL_BRIDGE_URL) {
  const root = baseUrl.replace(/\/$/, '');
  await wakeEmailBridge(bridgeSecret, baseUrl);
  const res = await fetchWithRetry(`${root}/email-jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...jobHeaders(bridgeSecret, authToken),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `Background job failed (${res.status})`);
  }
  return data;
}

async function recoverJobFromLatest(bridgeSecret, jobId, authToken, baseUrl, expectedMessage) {
  try {
    const jobs = await fetchLatestEmailJobs(bridgeSecret, authToken, baseUrl);
    const byId = jobs.find((job) => job.id === jobId);
    if (byId) return byId;
    if (expectedMessage) {
      const norm = normalizeJobMessage(expectedMessage);
      const match = jobs.find((job) => normalizeJobMessage(job.message) === norm);
      if (match) return match;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check whether a job still exists on the bridge. Returns null on 404 (no throw).
 */
export async function peekEmailJobStatus(bridgeSecret, jobId, authToken, baseUrl = RENDER_EMAIL_BRIDGE_URL) {
  const root = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${root}/email-jobs/${jobId}`, {
      headers: jobHeaders(bridgeSecret, authToken),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return data.job || data;
  } catch {
    return null;
  }
}

export async function fetchEmailJobStatus(
  bridgeSecret,
  jobId,
  authToken,
  baseUrl = RENDER_EMAIL_BRIDGE_URL,
  { expectedMessage, allowRestart = false, restartContext = null } = {},
) {
  const root = baseUrl.replace(/\/$/, '');
  const res = await fetchWithRetry(`${root}/email-jobs/${jobId}`, {
    headers: jobHeaders(bridgeSecret, authToken),
  }, { attempts: 2, baseDelayMs: 1500 });
  const data = await res.json().catch(() => ({}));

  if (res.status === 404) {
    const recovered = await recoverJobFromLatest(bridgeSecret, jobId, authToken, baseUrl, expectedMessage);
    if (recovered) return recovered;

    if (allowRestart && restartContext?.payload && (restartContext.restartCount || 0) < 1) {
      const checkpoint = restartContext.checkpoint || null;
      const payload = {
        ...restartContext.payload,
        ...(checkpoint ? { email_year_checkpoint: checkpoint } : {}),
      };
      const created = await submitBackgroundEmailJob(bridgeSecret, payload, authToken, baseUrl);
      const nextMeta = {
        message: restartContext.message,
        payload: restartContext.payload,
        restartCount: (restartContext.restartCount || 0) + 1,
        checkpoint,
      };
      await savePendingEmailJob(created.job_id, nextMeta);
      return {
        id: created.job_id,
        status: created.status || 'queued',
        progress: created.progress || 'Restarting after server refresh…',
        restarted: true,
      };
    }

    await clearPendingEmailJob();
    const err = new Error(
      'Cloud email job expired (server restarted). Send your cleanup request again — it will run in the background.',
    );
    err.code = 'EMAIL_JOB_NOT_FOUND';
    throw err;
  }

  if (!res.ok) {
    throw new Error(data.error || data.detail || `Job status failed (${res.status})`);
  }
  return data.job || data;
}

/**
 * Poll a background email job until complete. Survives app backgrounding — resumes on foreground.
 * Auto-restarts once if the bridge loses the job mid-run (Render restart).
 */
export function pollEmailJobUntilDone({
  bridgeSecret,
  jobId,
  authToken,
  baseUrl = RENDER_EMAIL_BRIDGE_URL,
  onProgress,
  pollMs = 2000,
  maxWaitMs,
  jobMeta = null,
}) {
  let cancelled = false;
  let timer = null;
  let sleeping = false;
  const started = Date.now();
  let currentJobId = jobId;
  let meta = jobMeta || null;
  let checkpoint = meta?.checkpoint || null;
  const effectiveMaxWait = maxWaitMs || jobMaxWaitMs(meta?.message);

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

  const persistMeta = async (patch) => {
    meta = { ...(meta || {}), ...patch };
    if (meta.message && meta.payload) {
      await savePendingEmailJob(currentJobId, meta);
    }
  };

  const runPoll = async () => {
    while (!cancelled) {
      if (Date.now() - started > effectiveMaxWait) {
        await clearPendingEmailJob();
        throw new Error('Background email job timed out.');
      }
      const job = await fetchEmailJobStatus(bridgeSecret, currentJobId, authToken, baseUrl, {
        expectedMessage: meta?.message,
        allowRestart: true,
        restartContext: meta ? { ...meta, checkpoint } : null,
      });
      if (job.restarted) {
        currentJobId = job.id;
        await persistMeta({ restartCount: (meta?.restartCount || 0) + 1 });
        if (onProgress) onProgress(job.progress || 'Restarting cloud email job…');
        await sleep(pollMs);
        continue;
      }
      if (job.checkpoint) {
        checkpoint = job.checkpoint;
        await persistMeta({ checkpoint });
      }
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
  yearCheckpoint = null,
}) {
  return {
    message,
    provider,
    persona,
    ...emailFetch,
    email_delete_enabled: emailDeleteEnabled,
    email_auto_trash_junk: emailAutoTrashJunk,
    ...(yearCheckpoint ? { email_year_checkpoint: yearCheckpoint } : {}),
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
