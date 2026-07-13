#!/usr/bin/env node
'use strict';

/**
 * Continuum ↔ OpenClaw bridge
 * - POST /chat/stream  ← Continuum mobile app (Continuum memory + OpenClaw email)
 * - POST /ask          ← CLI / OpenClaw skill
 * - GET  /health
 */

const http = require('http');
const path = require('path');

const skillRoot = path.join(__dirname, '../../skills/continuum-brain');
const { loadConfig } = require(path.join(skillRoot, 'scripts/config'));
const { callContinuum } = require(path.join(skillRoot, 'scripts/ask'));
const { fetchEmailContext, getEmailHealth } = require('./emailContext');
const { wantsEmailFetch, wantsEmailSummaryOnly, resolveEmailFetchOptions, formatPreEmailFetchStatus, formatPostEmailFetchStatus } = require('./emailFetchOptions');
const { wantsEmailCleanup } = require('./emailDelete');
const { buildEffectiveEmailMessage } = require('./emailConfirmIntent');
const { shouldSkipEmailFetch, buildFollowUpChatMessage } = require('./emailFollowUpIntent');
const {
  needsTargetedRecallEvidenceFetch,
  resolveRecallEvidenceMessage,
  extractUserRecallQuestion,
  stripClientEmailEnvelope,
  resolveRecallMonthRange,
  isExplicitFullEmailFetch,
} = require('../../shared/emailRecallEvidence');
const { slimHistoryForEmailRecall } = require('./emailRecallHistory');
const { fetchWebContext } = require('./webContext');
const bridgeVersion = require('./bridgeVersion');
const { wantsEmailMemoryIngest, parseSenderFromMessage, shouldBypassEmailSummaryMode } = require('./emailSender');
const { wantsEmailMoveToFolder, wantsEmailCopyFolderToInbox } = require('./emailMove');
const {
  appendGroundingPersona,
  EMAIL_LIVE_INBOX_APPEND,
  EMAIL_LIVE_INBOX_DELETE_APPEND,
  EMAIL_LIVE_INBOX_MOVE_APPEND,
  EMAIL_LIVE_INBOX_COPY_APPEND,
  EMAIL_LIVE_INBOX_MEMORY_APPEND,
  EMAIL_FOLLOW_UP_APPEND,
  EMAIL_RECALL_EVIDENCE_APPEND,
  RECALL_TURN_APPEND,
  MEMORY_RECALL_APPEND,
  LIVE_INBOX_UNAVAILABLE_APPEND,
  FULL_FOLDER_PERSONA_APPEND,
  WEB_SEARCH_APPEND,
} = require('./groundingPrompt');
const {
  runDailyCleanup,
  getDailyCleanupHistory,
  buildPrefilledDailySummary,
  wantsDailyCleanupSummary,
  wantsDailyCleanupSetup,
  buildSetupReply,
  loadState,
  saveState,
} = require('./dailyCleanup');
const {
  serviceConfigured: memoryServiceRoleConfigured,
  cleanupConfigured: memoryCleanupConfigured,
  verifyBearerUser,
  runConsolidationForUser,
  runConsolidationAllUsers,
  deleteMemoryForUser,
  getLatestRuns: getMemoryCleanupLatest,
} = require('./memoryCleanup');
const { handleNeverTrashRequest, wantsNeverTrashRequest } = require('./emailNeverTrash');
const {
  createEmailJob,
  getJob,
  getLatestJobs,
  startEmailJob,
  cancelEmailJob,
  cancelAllActiveEmailJobs,
} = require('./emailJobs');

const PORT = parseInt(process.env.CONTINUUM_BRIDGE_PORT || '8787', 10);
const HOST = process.env.CONTINUUM_BRIDGE_HOST || '127.0.0.1';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function verifyBridgeSecret(req, config) {
  const header = req.headers['x-bridge-secret'] || '';
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const secret = config.bridgeSecret || '';
  if (!secret) return true;
  return header === secret || bearer === secret;
}

function sanitizeUpstreamError(raw, status) {
  const text = String(raw || '').trim();
  if (!text) return `Upstream request failed (${status || 'unknown'})`;
  if (/^\s*</.test(text) || /<!DOCTYPE/i.test(text) || /<html/i.test(text)) {
    if (/cloudflare/i.test(text)) {
      return 'Cloudflare timed out or blocked the request. Email fetch can take 1–2 minutes — retry, or run a smaller date range with a lower limit.';
    }
    if (status === 502 || status === 503 || status === 504) {
      return `Continuum backend unavailable (${status}). Try again in a moment.`;
    }
    return `Server returned an HTML error page (${status || 'error'}) instead of a chat reply. Retry shortly.`;
  }
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

function beginSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const write = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const keepalive = setInterval(() => write('ping', { t: Date.now() }), 20000);
  const end = () => {
    clearInterval(keepalive);
    res.end();
  };
  return { write, end };
}

function slimHistory(history) {
  return (history || []).slice(-4).map((m) => ({
    role: m.role || 'user',
    content: String(m.content || '').slice(0, 3000),
  }));
}

/** ~80k tokens safety cap for upstream LLM (128k models leave room for persona/tools). */
const MAX_LLM_MESSAGE_CHARS = 320_000;

function truncateForLlm(text, maxChars = MAX_LLM_MESSAGE_CHARS) {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n\n[Context truncated — ${s.length - maxChars} chars omitted. Retry with a smaller date range or say "limit 250".]`;
}

function buildContinuumForm(payload) {
  const form = new FormData();
  const msg = truncateForLlm(payload.message || '');
  form.append('message', msg);
  form.append('provider', payload.provider || 'gemini');
  form.append('history', JSON.stringify(slimHistory(payload.history)));
  if (payload.persona) form.append('persona', truncateForLlm(payload.persona, 24_000));
  if (payload.gemini_key) form.append('gemini_key', payload.gemini_key);
  if (payload.groq_key) form.append('groq_key', payload.groq_key);
  if (payload.api_key) form.append('api_key', payload.api_key);
  if (payload.lat) form.append('lat', String(payload.lat));
  if (payload.lon) form.append('lon', String(payload.lon));
  if (payload.client_time) form.append('client_time', payload.client_time);
  if (payload.synthesize_voice) form.append('synthesize_voice', 'True');
  if (payload.voice_model) form.append('voice_model', payload.voice_model);
  return form;
}

async function maybeFetchWebContext(message) {
  const result = await fetchWebContext(message);
  if (!result.matched) return null;
  if (result.context) return result.context;
  if (result.error) return `[Web search not available]\n${result.error}`;
  return null;
}

async function maybeFetchEmailContext(message, payloadOptions = {}) {
  const result = await fetchEmailContext(message, payloadOptions);
  if (!result.matched) return { context: null, result: null };
  if (result.context) return { context: result.context, result };
  if (result.error) return { context: `[Yahoo email not available]\n${result.error}`, result };
  return { context: '[Yahoo email] No messages returned.', result };
}

async function handleDailyCleanupCron(req, res, config) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }
  const enabled = process.env.DAILY_CLEANUP_ENABLED !== 'false';
  const state = loadState();
  if (!enabled && !state.enabled) {
    return json(res, 200, {
      success: true,
      skipped: true,
      reason: 'Daily cleanup not enabled. Set DAILY_CLEANUP_ENABLED=true on Render or ask app to enable.',
    });
  }
  try {
    const { run } = await runDailyCleanup({ setEnabled: true });
    return json(res, 200, { success: true, run });
  } catch (err) {
    return json(res, 500, { success: false, error: err.message || String(err) });
  }
}

async function handleDailyCleanupLatest(req, res, config) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }
  const history = getDailyCleanupHistory(14);
  return json(res, 200, { success: true, ...history });
}

async function handleDailyCleanupRunNow(req, res, config) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }
  try {
    const { run } = await runDailyCleanup({ setEnabled: true });
    return json(res, 200, { success: true, run });
  } catch (err) {
    return json(res, 500, { success: false, error: err.message || String(err) });
  }
}

async function handleMemoryConsolidate(req, res) {
  const authorization = req.headers.authorization || '';
  const userId = await verifyBearerUser(authorization);
  if (!userId) {
    return json(res, 401, { success: false, error: 'Missing or invalid bearer token' });
  }
  if (!memoryCleanupConfigured()) {
    return json(res, 503, {
      success: false,
      error: 'Memory cleanup not configured. Set SUPABASE_ANON_KEY on Render email bridge.',
    });
  }
  try {
    const report = await runConsolidationForUser(userId, authorization);
    return json(res, 200, report);
  } catch (err) {
    return json(res, 500, { success: false, error: err.message || String(err) });
  }
}

async function handleMemoryConsolidateCron(req, res, config) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }
  if (!memoryServiceRoleConfigured()) {
    return json(res, 503, {
      success: false,
      error: 'Cron requires SUPABASE_SERVICE_ROLE_KEY on Render email bridge.',
    });
  }
  try {
    const summary = await runConsolidationAllUsers();
    return json(res, 200, { success: true, ...summary });
  } catch (err) {
    return json(res, 500, { success: false, error: err.message || String(err) });
  }
}

async function handleMemoryDelete(req, res) {
  const authorization = req.headers.authorization || '';
  const userId = await verifyBearerUser(authorization);
  if (!userId) {
    return json(res, 401, { success: false, error: 'Missing or invalid bearer token' });
  }
  if (!memoryCleanupConfigured()) {
    return json(res, 503, { success: false, error: 'Supabase not configured' });
  }
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return json(res, 400, { success: false, error: 'Invalid JSON' });
  }
  const layer = String(body.layer || '').toLowerCase();
  const id = body.id;
  if (!layer || !id) {
    return json(res, 400, { success: false, error: 'layer and id required' });
  }
  try {
    const result = await deleteMemoryForUser(userId, layer, id, authorization);
    return json(res, 200, result);
  } catch (err) {
    return json(res, 500, { success: false, error: err.message || String(err) });
  }
}

async function handleMemoryCleanupLatest(req, res, config) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }
  return json(res, 200, { success: true, ...getMemoryCleanupLatest(14) });
}

async function handleEmailJobCreate(req, res, config) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }
  const userAuth = req.headers.authorization || '';
  if (!userAuth.startsWith('Bearer ')) {
    return json(res, 401, { success: false, error: 'Missing Continuum session token' });
  }

  const raw = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return json(res, 400, { success: false, error: 'Invalid JSON body' });
  }

  const message = (payload.message || '').trim();
  if (!message) {
    return json(res, 400, { success: false, error: 'message is required' });
  }

  const job = createEmailJob({ message, payload });
  cancelAllActiveEmailJobs(job.id);
  startEmailJob(job.id, { userAuth, config });
  return json(res, 202, {
    success: true,
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    message: 'Email job started on server. Poll GET /email-jobs/:id for results.',
  });
}

async function handleEmailJobGet(req, res, config, jobId) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }
  const job = getJob(jobId);
  if (!job) {
    return json(res, 404, { success: false, error: 'Job not found' });
  }
  return json(res, 200, {
    success: true,
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      result: job.result,
      error: job.error,
      checkpoint: job.checkpoint || null,
      created_at: job.created_at,
      updated_at: job.updated_at,
    },
  });
}

async function handleEmailJobCancel(req, res, config, jobId) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }
  const job = cancelEmailJob(jobId);
  if (!job) {
    return json(res, 404, { success: false, error: 'Job not found' });
  }
  return json(res, 200, {
    success: true,
    job_id: job.id,
    status: job.status,
    progress: job.progress,
  });
}

async function handleEmailJobsLatest(req, res, config) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }
  const jobs = getLatestJobs(8).map((job) => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    result: job.status === 'completed' ? job.result : null,
    error: job.error,
    checkpoint: job.checkpoint || null,
    created_at: job.created_at,
    updated_at: job.updated_at,
  }));
  return json(res, 200, { success: true, jobs });
}

function streamTextReply(sse, text) {
  sse.write('status', { detail: 'Done' });
  sse.write('text', { token: text });
  sse.end();
}

async function handleAsk(req, res, config) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return json(res, 400, { success: false, error: 'Invalid JSON body' });
  }

  const message = (body.message || '').trim();
  if (!message) {
    return json(res, 400, { success: false, error: 'message is required' });
  }

  const result = await callContinuum(message, config, {
    channel: body.channel || 'bridge',
    sender: body.sender,
    history: body.history || [],
    clientTime: body.client_time,
  });

  return json(res, 200, {
    success: true,
    reply: result.reply,
    source: 'continuum',
    channel: body.channel || 'bridge',
  });
}

async function handleChatStream(req, res, config) {
  if (!verifyBridgeSecret(req, config)) {
    return json(res, 401, { success: false, error: 'Invalid bridge secret' });
  }

  const userAuth = req.headers.authorization || '';
  if (!userAuth.startsWith('Bearer ')) {
    return json(res, 401, { success: false, error: 'Missing Continuum session token' });
  }

  const raw = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return json(res, 400, { success: false, error: 'Invalid JSON body' });
  }

  let message = (payload.message || '').trim();
  if (!message) {
    return json(res, 400, { success: false, error: 'message is required' });
  }
  const originalMessage = message;
  const fetchIntentMessage = stripClientEmailEnvelope(originalMessage) || extractUserRecallQuestion(originalMessage) || originalMessage;
  const recallEvidenceFetch = needsTargetedRecallEvidenceFetch(fetchIntentMessage, payload.history || []);
  const skipEmailFetch = shouldSkipEmailFetch(fetchIntentMessage, payload.history || []);
  const historyBeforeFetch = payload.history || [];
  const recallUserQuestion = extractUserRecallQuestion(fetchIntentMessage);
  message = skipEmailFetch
    ? buildFollowUpChatMessage(originalMessage, payload.history || [])
    : recallEvidenceFetch
      ? resolveRecallEvidenceMessage(originalMessage, payload.history || [])
      : buildEffectiveEmailMessage(originalMessage, payload.history || []);
  payload.message = message;

  // Open SSE before slow IMAP / upstream work so Cloudflare tunnels stay alive.
  const sse = beginSse(res);
  sse.write('status', { detail: 'Starting…' });

  if (wantsNeverTrashRequest(message)) {
    sse.write('status', { detail: 'Updating never-trash rules and recovering mail…' });
    try {
      const result = await handleNeverTrashRequest(message);
      const state = loadState();
      state.never_trash_senders = result.allSenders.map((s) => s.label);
      saveState(state);
      streamTextReply(sse, result.reply);
    } catch (err) {
      sse.write('error', { detail: err.message || String(err) });
      sse.end();
    }
    return;
  }

  if (wantsDailyCleanupSetup(message)) {
    const state = loadState();
    state.enabled = true;
    saveState(state);
    let reply = buildSetupReply();
    if (/\b(inform|summary|report|tell\s+me)\b/i.test(message)) {
      sse.write('status', { detail: 'Running first daily cleanup…' });
      try {
        const { run } = await runDailyCleanup({ setEnabled: true });
        reply = `${buildPrefilledDailySummary(run)}\n\n${reply}`;
      } catch (err) {
        reply = `First cleanup failed: ${err.message || String(err)}\n\n${reply}`;
      }
    }
    streamTextReply(sse, reply);
    return;
  }

  if (wantsDailyCleanupSummary(message)) {
    const latest = getDailyCleanupHistory(1).last_run;
    const prefilled = latest
      ? buildPrefilledDailySummary(latest)
      : '[DAILY CLEANUP SUMMARY]\n\nNo daily cleanup has run yet. Enable Render Cron (Setup → Daily cleanup) or say **run daily cleanup now**.\n[/DAILY CLEANUP SUMMARY]';
    streamTextReply(sse, prefilled);
    return;
  }

  if (/\brun\s+daily\s+cleanup\s+now\b/i.test(message)) {
    sse.write('status', { detail: 'Running daily cleanup…' });
    try {
      const { run } = await runDailyCleanup({ setEnabled: true });
      streamTextReply(sse, buildPrefilledDailySummary(run));
    } catch (err) {
      sse.write('error', { detail: err.message || String(err) });
      sse.end();
    }
    return;
  }

  const isEmailRequest = !skipEmailFetch && wantsEmailFetch(
    recallEvidenceFetch ? recallUserQuestion : buildEffectiveEmailMessage(originalMessage, payload.history || []),
  );
  let webContext = null;
  if (!isEmailRequest) {
    sse.write('status', { detail: skipEmailFetch ? 'Using prior email analysis…' : 'Searching the web (if needed)…' });
    const alreadyHasWebSearch = /\[Web search\s*[—-]/i.test(message);
    webContext = alreadyHasWebSearch ? null : await maybeFetchWebContext(message);
  }

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
  const preFetchOptions = isEmailRequest
    ? resolveEmailFetchOptions(message, emailPayloadOptions)
    : null;
  sse.write('status', { detail: formatPreEmailFetchStatus(preFetchOptions) });
  const { context: emailContext, result: emailResult } = await maybeFetchEmailContext(message, emailPayloadOptions);
  const postFetchStatus = formatPostEmailFetchStatus({
    fetchOptions: emailResult?.fetchOptions,
    scanMeta: emailResult?.scanMeta,
    loadedCount: emailResult?.loadedCount,
  });
  if (postFetchStatus) {
    sse.write('status', { detail: postFetchStatus });
  }
  const hasLiveInbox = emailContext && !emailContext.startsWith('[Yahoo email not available]');
  const hasWebSearch = !!webContext && !webContext.startsWith('[Web search not available]');

  if (webContext) {
    message = [
      'IMPORTANT: Live web search results are provided below (OpenClaw VPS bridge).',
      'Use these results for current scores, news, weather, and live facts.',
      'Do NOT say you lack internet access or cannot search the web when this block is present.',
      'Cite source titles/URLs when summarizing. If results are insufficient, say what is missing.',
      '',
      webContext,
      '',
      '---',
      'User request:',
      message,
    ].join('\n');
    payload.message = message;
    if (!emailContext) payload.history = [];
  }

  if (emailContext) {
    const deleteEnabled = !!payload.email_delete_enabled;
    const cleanupRequested = wantsEmailCleanup(message);
    const summaryOnly = !shouldBypassEmailSummaryMode(message)
      && (wantsEmailSummaryOnly(message) || /SUMMARY MODE:/i.test(emailContext))
      && !cleanupRequested;
    message = [
      'IMPORTANT: Live Yahoo inbox data is provided below (user-authorized via OpenClaw VPS).',
      summaryOnly
        ? 'SUMMARY MODE: Your ENTIRE reply must be ONLY the text inside [PREFILLED SUMMARY]…[/PREFILLED SUMMARY] — copy verbatim. Do NOT invent "6728 headers", "1000 UID window", or Jan–Jun scan spans. Do NOT rephrase counts.'
        : cleanupRequested
          ? 'CLEANUP MODE: Your ENTIRE reply must be ONLY the text inside [PREFILLED SUMMARY]…[/PREFILLED SUMMARY] — copy verbatim. Include the **Cleanup Results** or **Cleanup:** section if present. Do NOT omit trash counts.'
          : recallEvidenceFetch
            ? 'EVIDENCE RECALL: Use [CONTINUUM MEMORY] (if in User request below), chat history, AND fetched emails below. Cite UID and Date for every boundary quote. Do NOT write meta-denial lists.'
            : 'Summarize ONLY the emails explicitly listed below with their UIDs.',
      'If a MAILBOX SCAN block appears below, copy its Date filter / Matched / Emails loaded lines — do not mention wide inbox scan spans or internal UID windows.',
      'If [EMAIL TRASH RESULT] appears below, copy its trash line verbatim — do not paraphrase as a rounded number.',
      'NEVER invent, simulate, reconstruct, or guess any email, UID, sender, or subject.',
      'If fewer emails were fetched than the user requested, say exactly how many were returned and stop — do not fill in gaps.',
      'Do NOT reference emails from earlier chat turns unless they appear in the list below.',
      'Do NOT say you cannot access email or external accounts.',
      deleteEnabled
        ? 'The user has enabled move-to-Trash. The bridge may have ALREADY moved mail to Yahoo Trash via IMAP before this reply — check for [Email trash executed] or [Email cleanup executed] below. Confirm only what that block lists. NEVER say "deleted" or "permanently removed" — say "moved to Trash". NEVER tell the user to run terminal/bash/VPS commands.'
        : 'Do NOT move emails to Trash unless the user has enabled "Allow move to Trash" in app settings.',
      '',
      emailContext,
      '',
      '---',
      'User request:',
      message,
    ].join('\n');
    payload.message = message;
    payload.history = recallEvidenceFetch
      ? slimHistoryForEmailRecall(historyBeforeFetch)
      : [];
  }

  if (skipEmailFetch) {
    payload.history = slimHistoryForEmailRecall(payload.history || []);
  }

  if (hasLiveInbox) {
    const memoryIngest = wantsEmailMemoryIngest(message)
      || (parseSenderFromMessage(message) && /\b(memory|continuum|remember|feed|ingest)\b/i.test(message));
    let inboxAppend = EMAIL_LIVE_INBOX_APPEND;
    if (memoryIngest && !payload.email_delete_enabled) inboxAppend = EMAIL_LIVE_INBOX_MEMORY_APPEND;
    if (payload.email_delete_enabled) {
      inboxAppend = wantsEmailCopyFolderToInbox(message)
        ? EMAIL_LIVE_INBOX_COPY_APPEND
        : wantsEmailMoveToFolder(message)
          ? EMAIL_LIVE_INBOX_MOVE_APPEND
          : EMAIL_LIVE_INBOX_DELETE_APPEND;
    }
    const fullFolderFetch = isExplicitFullEmailFetch(fetchIntentMessage);
    const liveExtras = recallEvidenceFetch
      ? [RECALL_TURN_APPEND, EMAIL_RECALL_EVIDENCE_APPEND, inboxAppend]
      : fullFolderFetch
        ? [FULL_FOLDER_PERSONA_APPEND, inboxAppend]
        : [inboxAppend];
    payload.persona = appendGroundingPersona(payload.persona || '', liveExtras);
  } else if (skipEmailFetch) {
    const recallExtras = [
      RECALL_TURN_APPEND,
      /\[(?:CONTINUUM MEMORY|RECALL TURN STATUS)/i.test(originalMessage) ? MEMORY_RECALL_APPEND : null,
      EMAIL_FOLLOW_UP_APPEND,
    ];
    payload.persona = appendGroundingPersona(payload.persona || '', recallExtras);
  } else if (recallEvidenceFetch || /\[(?:CONTINUUM MEMORY|RECALL TURN STATUS)/i.test(originalMessage)) {
    const recallExtras = [
      RECALL_TURN_APPEND,
      MEMORY_RECALL_APPEND,
      recallEvidenceFetch ? EMAIL_RECALL_EVIDENCE_APPEND : null,
      LIVE_INBOX_UNAVAILABLE_APPEND,
    ];
    payload.persona = appendGroundingPersona(payload.persona || '', recallExtras);
    if (emailContext && emailContext.startsWith('[Yahoo email not available]')) {
      message = [
        emailContext,
        '',
        'The Min-folder fetch attempt finished but returned no usable inbox rows.',
        'Answer the user recall question NOW from [CONTINUUM MEMORY] (in User request below) and chat history.',
        'Do NOT say you are awaiting fetch completion.',
        '',
        '---',
        'User request:',
        message,
      ].join('\n');
      payload.message = message;
    }
  } else if (hasWebSearch) {
    payload.persona = appendGroundingPersona(payload.persona || '', [WEB_SEARCH_APPEND]);
  } else {
    payload.persona = appendGroundingPersona(payload.persona || '');
  }

  sse.write('status', { detail: 'Asking Continuum…' });
  const form = buildContinuumForm(payload);
  const upstream = await fetch(`${config.apiUrl}/chat/stream`, {
    method: 'POST',
    headers: { Authorization: userAuth },
    body: form,
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    const hint = /not\s*found/i.test(detail) && upstream.status === 404
      ? `${detail}\n\nFix: set CONTINUUM_API_URL=https://continuum-backend-0q9j.onrender.com on Render (no /integrations/email path) and redeploy.`
      : detail;
    sse.write('error', { detail: sanitizeUpstreamError(hint, upstream.status) });
    sse.end();
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let gotText = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
      sseBuffer += decoder.decode(value, { stream: true });
      let lineBreak;
      while ((lineBreak = sseBuffer.indexOf('\n')) >= 0) {
        const line = sseBuffer.slice(0, lineBreak).trim();
        sseBuffer = sseBuffer.slice(lineBreak + 1);
        if (!line.startsWith('data:')) continue;
        const rawData = line.slice(5).trim();
        if (rawData === '[DONE]') continue;
        try {
          const json = JSON.parse(rawData);
          if (json.token && String(json.token).trim()) gotText = true;
        } catch {
          // ignore partial/invalid SSE lines
        }
      }
    }
  } finally {
    if (!gotText) {
      const detail = hasLiveInbox
        ? 'Continuum returned an empty reply after loading emails. Large folder persona scans now use compact formatting — please retry. If it persists, check your Gemini / 4o MINI API key.'
        : 'Continuum returned an empty reply. Check your API key for the selected model (Gemini / 4o MINI).';
      sse.write('error', { detail });
    }
    sse.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const config = loadConfig();

    if (req.method === 'GET' && req.url === '/health') {
      const quickHealth = process.env.RENDER === 'true' || process.env.HEALTH_CHECK_QUICK === '1';
      const emailHealth = await getEmailHealth({ quick: quickHealth });
      return json(res, 200, {
        success: true,
        service: 'continuum-bridge',
        bridge_version: bridgeVersion.version,
        features: bridgeVersion.features,
        continuum_api: config.apiUrl,
        openclaw: true,
        email: emailHealth,
        memory_cleanup: {
          configured: memoryCleanupConfigured(),
          user_scoped: memoryCleanupConfigured(),
          cron_ready: memoryServiceRoleConfigured(),
        },
      });
    }

    if (req.method === 'GET' && req.url === '/daily-cleanup/latest') {
      return await handleDailyCleanupLatest(req, res, config);
    }

    if (req.method === 'POST' && req.url === '/cron/daily-cleanup') {
      return await handleDailyCleanupCron(req, res, config);
    }

    if (req.method === 'POST' && req.url === '/daily-cleanup/run') {
      return await handleDailyCleanupRunNow(req, res, config);
    }

    if (req.method === 'POST' && req.url === '/memories/consolidate') {
      return await handleMemoryConsolidate(req, res);
    }

    if (req.method === 'POST' && req.url === '/memories/delete') {
      return await handleMemoryDelete(req, res);
    }

    if (req.method === 'POST' && req.url === '/cron/memory-consolidate') {
      return await handleMemoryConsolidateCron(req, res, config);
    }

    if (req.method === 'GET' && req.url === '/memories/consolidation/latest') {
      return await handleMemoryCleanupLatest(req, res, config);
    }

    if (req.method === 'POST' && req.url === '/email-jobs') {
      return await handleEmailJobCreate(req, res, config);
    }

    if (req.method === 'GET' && req.url === '/email-jobs/latest') {
      return await handleEmailJobsLatest(req, res, config);
    }

    const jobMatch = req.method === 'GET' && req.url?.match(/^\/email-jobs\/([a-f0-9]+)$/);
    if (jobMatch) {
      return await handleEmailJobGet(req, res, config, jobMatch[1]);
    }

    const cancelMatch = req.method === 'POST' && req.url?.match(/^\/email-jobs\/([a-f0-9]+)\/cancel$/);
    if (cancelMatch) {
      return await handleEmailJobCancel(req, res, config, cancelMatch[1]);
    }

    if (req.method === 'POST' && req.url === '/ask') {
      if (!verifyBridgeSecret(req, config)) {
        return json(res, 401, { success: false, error: 'Invalid bridge secret' });
      }
      return await handleAsk(req, res, config);
    }

    if (req.method === 'POST' && req.url === '/chat/stream') {
      return await handleChatStream(req, res, config);
    }

    return json(res, 404, { success: false, error: 'Not found' });
  } catch (err) {
    return json(res, 500, { success: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Continuum bridge listening on http://${HOST}:${PORT}`);
  console.log('  GET  /health');
  console.log('  GET  /daily-cleanup/latest');
  console.log('  POST /cron/daily-cleanup');
  console.log('  POST /daily-cleanup/run');
  console.log('  POST /memories/consolidate');
  console.log('  POST /memories/delete');
  console.log('  POST /cron/memory-consolidate');
  console.log('  GET  /memories/consolidation/latest');
  console.log('  POST /email-jobs       (background email fetch/cleanup)');
  console.log('  GET  /email-jobs/latest');
  console.log('  GET  /email-jobs/:id');
  console.log('  POST /email-jobs/:id/cancel');
  console.log('  POST /chat/stream  (Continuum app + OpenClaw email)');
  console.log('  POST /ask          (CLI / skill)');
});
