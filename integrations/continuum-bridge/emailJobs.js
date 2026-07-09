'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  fetchEmailContext,
  buildPrefilledSummaryReply,
  extractPrefilledSummaryFromText,
} = require('./emailContext');
const {
  wantsEmailFetch,
  wantsEmailSummaryOnly,
  resolveEmailFetchOptions,
  formatPreEmailFetchStatus,
  formatPostEmailFetchStatus,
} = require('./emailFetchOptions');
const { wantsEmailCleanup } = require('./emailDelete');
const { wantsEmailMemoryIngest, parseSenderFromMessage } = require('./emailSender');
const { wantsEmailMoveToFolder } = require('./emailMove');
const {
  appendGroundingPersona,
  EMAIL_LIVE_INBOX_APPEND,
  EMAIL_LIVE_INBOX_DELETE_APPEND,
  EMAIL_LIVE_INBOX_MOVE_APPEND,
  EMAIL_LIVE_INBOX_MEMORY_APPEND,
} = require('./groundingPrompt');

const MAX_STORED_JOBS = 40;
const MAX_LLM_MESSAGE_CHARS = 320_000;

/** In-memory cache survives file read races; repopulated from disk on load. */
const jobMemory = new Map();

function jobsPath() {
  if (process.env.EMAIL_JOBS_STATE_PATH) return process.env.EMAIL_JOBS_STATE_PATH;
  if (process.env.RENDER) {
    return path.join('/opt/render/project/src', '.continuum-bridge-data', 'email-jobs.json');
  }
  return path.join(process.env.HOME || '/root', '.config/continuum-bridge/email-jobs.json');
}

function loadJobsState() {
  try {
    const raw = fs.readFileSync(jobsPath(), 'utf8');
    const state = JSON.parse(raw);
    for (const job of state.jobs || []) {
      jobMemory.set(job.id, job);
    }
    return state;
  } catch {
    return { jobs: Array.from(jobMemory.values()) };
  }
}

function saveJobsState(state) {
  const file = jobsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const jobs = (state.jobs || []).slice(0, MAX_STORED_JOBS);
  for (const job of jobs) {
    jobMemory.set(job.id, job);
  }
  fs.writeFileSync(file, JSON.stringify({ jobs }, null, 2), 'utf8');
}

function newJobId() {
  return crypto.randomBytes(8).toString('hex');
}

function extractDailySummary(text) {
  const m = String(text || '').match(
    /\[DAILY CLEANUP SUMMARY[^\]]*\]\s*([\s\S]*?)\s*\[\/DAILY CLEANUP SUMMARY\]/i,
  );
  return m?.[1]?.trim() || null;
}

function truncateForLlm(text, maxChars = MAX_LLM_MESSAGE_CHARS) {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n\n[Context truncated for size]`;
}

function slimHistory(history) {
  return (history || []).slice(-4).map((m) => ({
    role: m.role || 'user',
    content: String(m.content || '').slice(0, 3000),
  }));
}

function buildContinuumForm(payload) {
  const form = new FormData();
  form.append('message', truncateForLlm(payload.message || ''));
  form.append('provider', payload.provider || 'gemini');
  form.append('history', JSON.stringify(slimHistory(payload.history)));
  if (payload.persona) form.append('persona', truncateForLlm(payload.persona, 24_000));
  if (payload.gemini_key) form.append('gemini_key', payload.gemini_key);
  if (payload.groq_key) form.append('groq_key', payload.groq_key);
  if (payload.api_key) form.append('api_key', payload.api_key);
  if (payload.lat) form.append('lat', String(payload.lat));
  if (payload.lon) form.append('lon', String(payload.lon));
  if (payload.client_time) form.append('client_time', payload.client_time);
  return form;
}

function parseSseResponse(body) {
  let reply = '';
  let currentEvent = '';
  for (const line of String(body || '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) {
      currentEvent = trimmed.slice(6).trim();
    } else if (trimmed.startsWith('data:')) {
      const rawData = trimmed.slice(5).trim();
      if (rawData === '[DONE]') break;
      try {
        const json = JSON.parse(rawData);
        if (currentEvent === 'text' && json.token) reply += json.token;
        else if (currentEvent === 'error' && json.detail) throw new Error(json.detail);
      } catch (err) {
        if (err.message && !err.message.includes('Unexpected token')) throw err;
      }
    }
  }
  return reply.trim();
}

async function callContinuumStream(apiUrl, userAuth, payload) {
  const res = await fetch(`${apiUrl}/chat/stream`, {
    method: 'POST',
    headers: { Authorization: userAuth },
    body: buildContinuumForm(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail || parsed.error || text;
    } catch {
      // keep raw
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  const reply = parseSseResponse(text);
  if (!reply) throw new Error('Continuum returned an empty reply.');
  return reply;
}

function resolvePrefilledJobResult(emailResult, { message, cleanupRequested, summaryOnly }) {
  const emailContext = emailResult.context || '';
  let prefilled = extractPrefilledSummaryFromText(emailContext)
    || extractPrefilledSummaryFromText(message)
    || extractDailySummary(emailContext);

  if (!prefilled && Array.isArray(emailResult.messages) && emailResult.messages.length > 0) {
    const built = buildPrefilledSummaryReply({
      dateRangeLabel: emailResult.fetchOptions?.dateRangeLabel,
      scanMeta: emailResult.scanMeta,
      messages: emailResult.messages,
      deleteResult: emailResult.deleteResult,
      permission: null,
      cleanupRequested,
    });
    prefilled = extractPrefilledSummaryFromText(built) || built;
  }

  if (prefilled) return prefilled;

  if (cleanupRequested || summaryOnly) {
    const compact = emailContext.slice(0, 12000).trim();
    return compact || 'Email cleanup finished but no summary was generated. Try again or narrow the date range.';
  }

  return null;
}

function updateJob(jobId, patch) {
  const state = loadJobsState();
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return null;
  state.jobs[idx] = {
    ...state.jobs[idx],
    ...patch,
    updated_at: new Date().toISOString(),
  };
  jobMemory.set(jobId, state.jobs[idx]);
  saveJobsState(state);
  return state.jobs[idx];
}

function getJob(jobId) {
  if (jobMemory.has(jobId)) return jobMemory.get(jobId);
  const fromDisk = loadJobsState().jobs.find((j) => j.id === jobId) || null;
  if (fromDisk) jobMemory.set(jobId, fromDisk);
  return fromDisk;
}

function createEmailJob({ message, payload }) {
  const state = loadJobsState();
  const job = {
    id: newJobId(),
    status: 'queued',
    progress: 'Queued',
    message: String(message || '').slice(0, 500),
    payload,
    result: null,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  state.jobs.unshift(job);
  jobMemory.set(job.id, job);
  saveJobsState(state);
  return job;
}

async function runEmailJob(jobId, { userAuth, config, onStatus }) {
  const job = getJob(jobId);
  if (!job) throw new Error('Job not found');
  if (job.status === 'completed') return job;

  updateJob(jobId, { status: 'running', progress: 'Starting…' });
  const status = (detail) => {
    if (onStatus) onStatus(detail);
    updateJob(jobId, { progress: detail });
  };

  try {
    const payload = { ...(job.payload || {}) };
    let message = (payload.message || job.message || '').trim();
    if (!message) throw new Error('Empty job message');

    const emailPayloadOptions = {
      email_limit: payload.email_limit,
      email_offset: payload.email_offset,
      email_recent: payload.email_recent,
      email_since: payload.email_since,
      email_before: payload.email_before,
      email_delete_enabled: payload.email_delete_enabled,
      email_auto_trash_junk: payload.email_auto_trash_junk,
      history: payload.history,
    };

    if (!wantsEmailFetch(message)) {
      throw new Error('Background jobs support email fetch/cleanup requests only.');
    }

    const preFetchOptions = resolveEmailFetchOptions(message, emailPayloadOptions);
    status(formatPreEmailFetchStatus(preFetchOptions));

    const emailResult = await fetchEmailContext(message, emailPayloadOptions);
    if (emailResult.error) {
      throw new Error(emailResult.error);
    }

    const postFetchStatus = formatPostEmailFetchStatus({
      fetchOptions: emailResult.fetchOptions,
      scanMeta: emailResult.scanMeta,
      loadedCount: emailResult.loadedCount,
    });
    if (postFetchStatus) status(postFetchStatus);

    const emailContext = emailResult.context;
    if (!emailContext || emailContext.startsWith('[Yahoo email not available]')) {
      throw new Error(emailContext || 'Email fetch failed.');
    }

    const cleanupRequested = wantsEmailCleanup(message);
    const summaryOnly = (wantsEmailSummaryOnly(message) || /SUMMARY MODE:/i.test(emailContext))
      && !cleanupRequested;

    const prefilledResult = resolvePrefilledJobResult(emailResult, {
      message,
      cleanupRequested,
      summaryOnly,
    });
    if (prefilledResult && (cleanupRequested || summaryOnly)) {
      status('Done');
      return updateJob(jobId, {
        status: 'completed',
        progress: 'Done',
        result: prefilledResult,
        error: null,
      });
    }

    message = [
      'IMPORTANT: Live Yahoo inbox data is provided below (user-authorized via OpenClaw VPS).',
      summaryOnly || cleanupRequested
        ? 'CLEANUP MODE: Your ENTIRE reply must be ONLY the text inside [PREFILLED SUMMARY]…[/PREFILLED SUMMARY] — copy verbatim.'
        : 'Summarize ONLY the emails explicitly listed below with their UIDs.',
      '',
      emailContext,
      '',
      '---',
      'User request:',
      message,
    ].join('\n');

    const hasLiveInbox = !emailContext.startsWith('[Yahoo email not available]');
    if (hasLiveInbox) {
      const memoryIngest = wantsEmailMemoryIngest(message)
        || (parseSenderFromMessage(message) && /\b(memory|continuum|remember|feed|ingest)\b/i.test(message));
      let inboxAppend = EMAIL_LIVE_INBOX_APPEND;
      if (memoryIngest && !payload.email_delete_enabled) inboxAppend = EMAIL_LIVE_INBOX_MEMORY_APPEND;
      if (payload.email_delete_enabled) {
        inboxAppend = wantsEmailMoveToFolder(message)
          ? EMAIL_LIVE_INBOX_MOVE_APPEND
          : EMAIL_LIVE_INBOX_DELETE_APPEND;
      }
      payload.persona = appendGroundingPersona(payload.persona || '', [inboxAppend]);
    } else {
      payload.persona = appendGroundingPersona(payload.persona || '');
    }

    payload.message = message;
    payload.history = [];

    status('Asking Continuum…');
    const reply = await callContinuumStream(config.apiUrl, userAuth, payload);
    status('Done');
    return updateJob(jobId, {
      status: 'completed',
      progress: 'Done',
      result: reply,
      error: null,
    });
  } catch (err) {
    return updateJob(jobId, {
      status: 'failed',
      progress: 'Failed',
      error: err.message || String(err),
    });
  }
}

function startEmailJob(jobId, options) {
  setImmediate(() => {
    runEmailJob(jobId, options).catch((err) => {
      updateJob(jobId, {
        status: 'failed',
        progress: 'Failed',
        error: err.message || String(err),
      });
    });
  });
}

function getLatestJobs(limit = 5) {
  loadJobsState();
  return Array.from(jobMemory.values())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

function wantsBackgroundEmailJob(message) {
  const text = String(message || '');
  if (!wantsEmailFetch(text)) return false;
  if (wantsEmailCleanup(text)) return true;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:\d{4}\s+)?emails?\b/i.test(text)) return true;
  if (/\b(?:for|in|during)\s+(?:the\s+)?(?:month\s+of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)) return true;
  if (/\b(?:for|in|during)\s+(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/i.test(text)) return true;
  if (/\b(?:for|in|during)\s+(?:the\s+)?(?:whole\s+)?(?:year\s+)?(20\d{2})\b/i.test(text)) return true;
  if (/\bfetch\s+and\s+clean\b/i.test(text)) return true;
  if (/\blimit\s+(\d{3,})\b/i.test(text) && parseInt(text.match(/\blimit\s+(\d{3,})\b/i)[1], 10) >= 250) return true;
  return false;
}

module.exports = {
  createEmailJob,
  getJob,
  getLatestJobs,
  runEmailJob,
  startEmailJob,
  wantsBackgroundEmailJob,
};
