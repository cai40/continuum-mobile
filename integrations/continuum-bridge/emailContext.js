'use strict';

const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { resolveEmailFetchOptions, MAX_LIMIT, wantsEmailFetch, wantsEmailSummaryOnly, parseLimitFromMessage } = require('./emailFetchOptions');
const { parseSenderFromMessage, wantsEmailMemoryIngest, imapSearchArgs } = require('./emailSender');
const { maybeDeleteEmails, maybeAutoTrashJunk, wantsEmailDelete, wantsEmailCleanup, wantsEmailCleanupPreview, resolveChurchCommunityUids, CHURCH_COMMUNITY_INTENT, countCleanupTargets, mergeDeleteResults, formatCleanupPreviewBlock, formatEmailCleanupPreviewNextSteps, extractEmailCleanupPreviewBlock, CLEANUP_PREVIEW_LIST_MAX } = require('./emailDelete');
const { maybeMoveEmailsToFolder, wantsEmailMoveToFolder, parseDestinationFolder, parseMoveSenderFromMessage } = require('./emailMove');
const { evaluateOverLimitPermission, formatPermissionBlock, resolveDeleteCap } = require('./emailPermission');
const { wantsTriage, buildTriageContext, classifyEmail, triageMessages } = require('./emailTriage');

const { buildEffectiveEmailMessage } = require('./emailConfirmIntent');
const { wantsYearCleanup, runYearCleanup } = require('./yearCleanup');

const execFileAsync = promisify(execFile);

async function probeImapDeleteCommand(imapScript) {
  try {
    const fs = require('fs');
    const source = fs.readFileSync(imapScript, 'utf8');
    if (!source.includes("case 'delete'")) return false;
  } catch {
    return false;
  }
  try {
    await execFileAsync('node', [imapScript, 'delete'], {
      timeout: 10000,
      cwd: path.dirname(path.dirname(imapScript)),
      env: {
        ...process.env,
        NODE_PATH: path.join(path.dirname(path.dirname(imapScript)), 'node_modules'),
      },
    });
    return false;
  } catch (err) {
    const msg = `${err.stderr || ''} ${err.message || ''}`.toLowerCase();
    if (msg.includes('unknown command')) return false;
    if (msg.includes('required')) return true;
    // Config missing during probe — source check above is enough
    if (msg.includes('no email configuration')) return true;
    return false;
  }
}

function findImapScript() {
  const home = process.env.HOME || '/root';
  const candidates = [
    '/tmp/continuum-mobile/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js',
    path.join(home, '.openclaw/workspace/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js'),
    path.join(home, '.openclaw/workspace/skills/imap-smtp-email/scripts/imap.js'),
  ];
  return candidates.find((p) => {
    try {
      fs.accessSync(p);
      const skillRoot = path.dirname(path.dirname(p));
      const hasDeps = fs.existsSync(path.join(skillRoot, 'node_modules', 'imap'));
      const source = fs.readFileSync(p, 'utf8');
      const hasDelete = source.includes("case 'delete'");
      return hasDeps && hasDelete;
    } catch {
      return false;
    }
  }) || candidates.find((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseScanMeta(stderr) {
  const text = String(stderr || '');
  const idx = text.indexOf('SCAN_META:');
  if (idx >= 0) {
    const jsonStart = text.indexOf('{', idx);
    if (jsonStart >= 0) {
      let depth = 0;
      for (let i = jsonStart; i < text.length; i += 1) {
        if (text[i] === '{') depth += 1;
        if (text[i] === '}') depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(jsonStart, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  const log = text.match(
    /fetched (\d+)\/(\d+) uid\(s\),\s*scanned ([^,]+),\s*matched (\d+) for (\S+)\.\.(\S+)/,
  );
  if (!log) return null;
  const [, scanned, totalUids, spanRaw, matched, usedSince, usedBefore] = log;
  let span = null;
  if (spanRaw && spanRaw !== 'no dates' && spanRaw.includes('..')) {
    const [oldest, newest] = spanRaw.split('..');
    span = { oldest, newest };
  }
  return {
    scanned: parseInt(scanned, 10),
    totalUids: parseInt(totalUids, 10),
    span,
    matched: parseInt(matched, 10),
    used: { since: usedSince, before: usedBefore },
  };
}

function formatScanDiagnostic(scanMeta, dateRangeLabel, loadedCount = null) {
  if (!scanMeta) return null;
  const matched = scanMeta.matched ?? 0;
  const used = scanMeta.used?.since && scanMeta.used?.before
    && scanMeta.wanted?.since && scanMeta.wanted?.before
    && (scanMeta.used.since !== scanMeta.wanted.since || scanMeta.used.before !== scanMeta.wanted.before)
    ? ` (year-adjusted: ${scanMeta.used.since} .. ${scanMeta.used.before})`
    : '';
  const loadedLine = loadedCount != null
    ? `- Emails loaded for this reply: ${loadedCount}${matched ? ` of ${matched} matched` : ''}.`
    : null;

  let scanLine;
  if (dateRangeLabel && scanMeta.scanMode === 'direct') {
    const span = scanMeta.span;
    const spanNote = span ? ` Mail dates: ${span.oldest} through ${span.newest}.` : '';
    scanLine = `- Date filter: ${dateRangeLabel}. Matched: ${matched}.${spanNote} Headers scanned: ${scanMeta.scanned ?? matched} (direct search — no wide inbox lookback).`;
  } else if (dateRangeLabel) {
    scanLine = `- Date filter: ${dateRangeLabel}. Matched: ${matched}${used}. Headers scanned: ${scanMeta.scanned ?? '?'}.`;
  } else if (scanMeta.recentWindow != null || scanMeta.parsed != null) {
    const headers = scanMeta.scanned ?? scanMeta.parsed ?? 0;
    const span = scanMeta.span
      ? `dates: ${scanMeta.span.oldest} through ${scanMeta.span.newest}`
      : 'no parseable dates';
    scanLine = `- Scanned ${headers} INBOX header(s). ${span}.`;
  } else {
    const span = scanMeta.span
      ? `dates: ${scanMeta.span.oldest} through ${scanMeta.span.newest}`
      : 'no parseable dates';
    scanLine = `- Scanned ${scanMeta.scanned} of ${scanMeta.totalUids} INBOX message(s); ${span}.`;
  }

  return [
    'MAILBOX SCAN (include these lines; do NOT mention unrelated months or a "1000 UID window"):',
    scanLine,
    loadedLine,
    dateRangeLabel ? null : `- Matched: ${matched}${used}.`,
    'Use Matched and Emails loaded only — never claim the whole inbox was scanned.',
  ].filter(Boolean).join('\n');
}

function inlineScanSummary(scanMeta) {
  if (!scanMeta) return '';
  const span = scanMeta.span
    ? ` Inbox dates scanned: ${scanMeta.span.oldest} to ${scanMeta.span.newest}.`
    : ' No parseable dates in scanned mail.';
  return `Scanned ${scanMeta.scanned}/${scanMeta.totalUids} INBOX messages.${span} Matched: ${scanMeta.matched ?? 0}.`;
}

function formatTrashReportBlock(deleteResult) {
  if (!deleteResult?.executed || !deleteResult.summary) return '';
  const header = deleteResult.summary.split('\n')[0];
  return [
    '[EMAIL TRASH RESULT — copy the next line verbatim; do not paraphrase or round]',
    header,
    '[/EMAIL TRASH RESULT]',
  ].join('\n');
}

function buildCompactEmailSummary(parsed, { limit, offset, dateRangeLabel, scanMeta }) {
  const triaged = triageMessages(parsed);
  const byCategory = {};
  const bySender = {};
  let unread = 0;
  for (let i = 0; i < parsed.length; i += 1) {
    const msg = parsed[i];
    const row = triaged[i];
    const cat = row?.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    const from = String(msg.from?.text || msg.from || msg.fromAddress || 'Unknown').replace(/\s+/g, ' ').slice(0, 72);
    bySender[from] = (bySender[from] || 0) + 1;
    if (Array.isArray(msg.flags) && !msg.flags.includes('\\Seen')) unread += 1;
  }
  const topSenders = Object.entries(bySender).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const cleanupCount = countCleanupTargets(parsed);
  const scanBlock = formatScanDiagnostic(scanMeta, dateRangeLabel, parsed.length);
  const matched = scanMeta?.matched ?? null;
  const batchLine = matched != null && matched > parsed.length
    ? `${parsed.length} of ${matched} matched email(s) loaded in this batch (fetch limit ${limit}, offset ${offset}).`
    : `${parsed.length} email(s) loaded (fetch limit ${limit}, offset ${offset}).`;
  const shortfallNote = matched != null && matched > parsed.length
    ? `${matched - parsed.length} more matched email(s) were not loaded — raise Email Fetch Limit or say "limit 50000".`
    : null;

  const lines = [
    `SUMMARY MODE: ${batchLine}`,
    'Do NOT report the loaded batch count as the total for the month/year — use MAILBOX SCAN "Matched" for inbox totals.',
    shortfallNote,
    'User asked for aggregate summary ONLY — do NOT list individual emails or long UID lists.',
    dateRangeLabel ? `Date filter: ${dateRangeLabel}.` : null,
    scanBlock,
    `Unread: ${unread}. Read: ${parsed.length - unread}.`,
    '',
    'By category:',
    ...Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([c, n]) => `- ${c}: ${n}`),
    '',
    'Top senders:',
    ...topSenders.map(([s, n]) => `- ${s}: ${n}`),
    '',
    `Cleanup targets in this batch (news/promo/junk): ${cleanupCount} (fetch-and-clean moves up to 10,000 to Trash per run).`,
    'Give counts and high-level themes only. Confirm trash results only from [Email cleanup executed] blocks.',
  ].filter(Boolean);

  if (parsed.length > 0) {
    lines.push('', 'Sample subjects (max 5, for context only):');
    for (const msg of parsed.slice(0, 5)) {
      lines.push(`- "${String(msg.subject || '(no subject)').slice(0, 100)}"`);
    }
  }
  return lines.join('\n');
}

function extractPrefilledSummaryFromText(text) {
  const m = String(text || '').match(
    /\[PREFILLED SUMMARY[^\]]*\]\s*([\s\S]*?)\s*\[\/PREFILLED SUMMARY\]/i,
  );
  return m?.[1]?.trim() || null;
}

function buildPrefilledSummaryReply({ dateRangeLabel, scanMeta, messages, deleteResult, permission, cleanupRequested, cleanupPreviewRequested, cleanupPreviewBlock }) {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const triaged = triageMessages(messages);
  const byCategory = {};
  const bySender = {};
  let unread = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const row = triaged[i];
    const cat = row?.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    const from = String(messages[i].from?.text || messages[i].from || messages[i].fromAddress || 'Unknown')
      .replace(/\s+/g, ' ').slice(0, 72);
    bySender[from] = (bySender[from] || 0) + 1;
    if (Array.isArray(messages[i].flags) && !messages[i].flags.includes('\\Seen')) unread += 1;
  }
  const topSenders = Object.entries(bySender).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const matched = scanMeta?.matched ?? messages.length;
  const loaded = messages.length;
  const cleanupCount = countCleanupTargets(messages);
  const trashHeader = deleteResult?.executed && deleteResult.summary
    ? deleteResult.summary.split('\n')[0]
    : null;
  const shortfall = matched > loaded ? matched - loaded : 0;

  const lines = [
    '[PREFILLED SUMMARY — your ENTIRE reply must be ONLY the text between these markers; copy verbatim]',
    '',
    `## ${dateRangeLabel || 'Inbox'} Summary`,
    '',
    `- **Matched:** ${matched}`,
    `- **Loaded for analysis:** ${loaded}`,
    shortfall > 0 ? `- **Not loaded this batch:** ${shortfall} more matched — say "fetch 2025 limit 50000" or rerun after cleanup.` : null,
    `- **Unread:** ${unread}. **Read:** ${loaded - unread}.`,
    '',
    '**By Category:**',
    ...Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([c, n]) => `- ${c}: ${n}`),
    '',
    '**Top Senders:**',
    ...topSenders.map(([s, n]) => `- ${s}: ${n}`),
    '',
    `**Cleanup targets:** ${cleanupCount}`,
  ];
  if (trashHeader) {
    lines.push('', '**Cleanup Results:**', `- ${trashHeader}`);
  } else if (permission && cleanupRequested) {
    lines.push(
      '',
      '**Cleanup:** Not run yet.',
      `- ${permission.cleanupTargets || cleanupCount} cleanup target(s) found but more mail matched than loaded, or fetch cap hit.`,
      '- Reply **yes proceed** to move up to 500 newsletters/promos to Trash per run.',
    );
  } else if (cleanupPreviewRequested) {
    lines.push(
      '',
      '**Cleanup:** Preview only — no mail was moved.',
      `- **Would trash:** ${cleanupCount}`,
      '',
      '**Reply in chat:** **`apply`**, **`proceed`**, **`yes`**, or **`ok`** — same period, no need to say "preview" again.',
      '',
      '**Would move to Trash (subject + sender):**',
    );
    const targets = cleanupPreviewBlock?.targets || [];
    const maxInline = CLEANUP_PREVIEW_LIST_MAX;
    if (!targets.length) {
      lines.push('- _(none in this batch)_');
    } else {
      for (const row of targets.slice(0, maxInline)) {
        lines.push(`- UID ${row.uid}: "${row.subject}" — ${row.from}`);
      }
      if (targets.length > maxInline) {
        lines.push(`- _…and ${targets.length - maxInline} more_`);
      }
    }
    lines.push(...formatEmailCleanupPreviewNextSteps({ dateRangeLabel, cleanupCount }));
  } else if (cleanupRequested && cleanupCount > 0) {
    lines.push(
      '',
      '**Cleanup:** Not run — check that **Allow move to Trash** is ON in app Setup.',
    );
  } else if (cleanupRequested && cleanupCount === 0) {
    lines.push(
      '',
      '**Cleanup:** Nothing trashed — no newsletter/promo targets in this batch.',
      'Most mail was classified informational (alerts, receipts, account mail).',
      'For a specific retailer: *"Mattress firm promotional should be trashed unless receipt or invoice"*.',
    );
  }
  lines.push('', '[/PREFILLED SUMMARY]');
  return lines.join('\n');
}

function formatUidList(uids) {
  if (uids.length <= 50) return uids.join(', ');
  return `${uids.slice(0, 50).join(', ')} ... and ${uids.length - 50} more (use summary mode for large batches)`;
}

function formatEmailMessages(rawStdout, limit, offset = 0, dateRangeLabel = null, scanMeta = null, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(rawStdout);
  } catch {
    return { text: rawStdout.trim().slice(0, 12000), messages: [] };
  }
  if (!Array.isArray(parsed)) {
    return { text: rawStdout.trim().slice(0, 12000), messages: [] };
  }
  if (parsed.length === 0) {
    const scanBlock = formatScanDiagnostic(scanMeta, dateRangeLabel, 0);
    const inline = inlineScanSummary(scanMeta);
    const hint = dateRangeLabel
      ? `No messages found in INBOX for ${dateRangeLabel}.${inline ? ` ${inline}` : ''}`
      : `No messages found in INBOX for the requested period.${inline ? ` ${inline}` : ''}`;
    const footer = 'Next step: fetch last 100 emails — list date and subject only — to see actual inbox dates. If scanned dates show a different year, retry with that year (e.g. 4/1/2025 to 6/15/2025).';
    const text = [hint, scanBlock, footer].filter(Boolean).join('\n\n');
    return { text, messages: [], fetchedCount: 0 };
  }

  const maxChars = Math.min(1_000_000, Math.max(10000, limit * 200));
  const uids = parsed.map((msg) => msg.uid).filter((uid) => uid != null);
  const fetchedCount = parsed.length;
  const cleanupRequested = wantsEmailCleanup(options.message || '');
  const summaryOnly = options.summaryOnly
    || wantsEmailSummaryOnly(options.message || '')
    || fetchedCount > 250
    || cleanupRequested;

  if (summaryOnly) {
    return {
      text: buildCompactEmailSummary(parsed, { limit, offset, dateRangeLabel, scanMeta }),
      messages: parsed,
      fetchedCount,
    };
  }

  const uidList = formatUidList(uids);
  const shortfall = limit > fetchedCount
    ? `\nNOTE: Requested up to ${limit} emails but only ${fetchedCount} exist in INBOX for this lookback period. Do NOT invent the missing ${limit - fetchedCount}.`
    : '';

  const offsetNote = offset > 0
    ? `Skipped newest ${offset} email(s); showing the next batch.`
    : null;
  const dateNote = dateRangeLabel ? `Date filter: ${dateRangeLabel} (inclusive).` : null;
  const header = [
    `Fetched ${fetchedCount} REAL email(s) from Yahoo IMAP (offset ${offset}, limit ${limit}, max ${MAX_LIMIT} per request).`,
    dateNote,
    offsetNote,
    uids.length ? `Valid UIDs ONLY: ${uidList}` : null,
    'ANTI-HALLUCINATION: Summarize ONLY the emails listed below. NEVER invent, simulate, reconstruct, or guess emails, UIDs, senders, or subjects not in this list.',
    shortfall || null,
    '',
  ].filter(Boolean).join('\n');

  const body = parsed.map((msg, idx) => {
    const from = msg.from?.text || msg.from || msg.fromAddress || 'Unknown';
    const subject = msg.subject || '(no subject)';
    const date = msg.headerDate || msg.date || msg.receivedDate || '';
    const uid = msg.uid != null ? String(msg.uid) : '';
    const unread = Array.isArray(msg.flags) && !msg.flags.includes('\\Seen');
    const previewSource = msg.snippet || msg.text || msg.preview || msg.html || '';
    const preview = stripHtml(previewSource).slice(0, 220);
    const triage = classifyEmail(msg);
    return [
      `--- Email ${idx + 1 + offset}${unread ? ' (unread)' : ''} [${triage.category}] ---`,
      uid ? `UID: ${uid}` : null,
      `From: ${from}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      preview ? `Preview: ${preview}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return { text: (header + body).slice(0, maxChars), messages: parsed, fetchedCount };
}

function imapCheckArgs(fetchOptions) {
  const args = ['check', '--limit', String(fetchOptions.limit)];
  if (fetchOptions.since) {
    args.push('--since', fetchOptions.since);
    if (fetchOptions.before) args.push('--before', fetchOptions.before);
  } else {
    args.push('--recent', fetchOptions.recent || '7d');
  }
  if (fetchOptions.offset > 0) {
    args.push('--offset', String(fetchOptions.offset));
  }
  if (fetchOptions.unreadOnly) {
    args.push('--unseen');
  }
  args.push('--lite');
  return args;
}

/**
 * Translate IMAP script stderr lines into user-friendly progress messages.
 * Returns null for lines that aren't useful to surface to the user.
 */
function parseImapProgressLine(line) {
  const text = String(line || '').trim();
  if (!text || !text.startsWith('[imap]')) return null;

  let m;
  if ((m = text.match(/^\[imap\]\s+search\s+(.+?)\.\.\.$/i))) {
    const direct = m[1].match(/^direct-(\d{4}-\d{2}-\d{2})-since-before/i);
    if (direct) return null;
    const label = m[1].replace(/SINCE\s+(\S+)\s+BEFORE\s+(\S+)/i, '$1 to $2').toLowerCase();
    return `Searching ${label}…`;
  }
  if ((m = text.match(/^\[imap\]\s+search\s+(.+?):\s+(\d+)\s+uid/i))) {
    const count = parseInt(m[2], 10);
    const direct = m[1].match(/^direct-(\d{4}-\d{2}-\d{2})-since-before/i);
    if (direct) {
      const since = direct[1];
      return count === 0
        ? `No mail found from ${since} in this slice`
        : `Found ${count} email(s) from ${since} in this slice`;
    }
    const label = m[1].replace(/SINCE\s+(\S+)\s+BEFORE\s+(\S+)/i, '$1 to $2').toLowerCase();
    return count === 0
      ? `No mail found in ${label}`
      : `Found ${count} email(s) in ${label}`;
  }
  if ((m = text.match(/^\[imap\]\s+date-range\s+check\s+(\S+)\.\.(\S+)\s+limit=(\d+)/i))) {
    return `Scanning ${m[1]} to ${m[2]} (up to ${m[3]})…`;
  }
  if ((m = text.match(/^\[imap\]\s+date-range\s+start\s+(\S+)\.\.(\S+)\s+limit=\d+.*lookback=(\d+)d/i))) {
    return `Scanning ${m[1]} to ${m[2]} (lookback ${m[3]}d)…`;
  }
  if (/date-range:\s+expand\s+older\s+range/i.test(text)) {
    return 'Expanding scan to older messages…';
  }
  if ((m = text.match(/^\[imap\]\s+date-range\s+lookback\s+\d+d:\s+fetched\s+(\d+)\s+row/i))) {
    const matched = text.match(/matched\s+(\d+)/i);
    const matchedN = matched ? parseInt(matched[1], 10) : null;
    if (matchedN === 0) {
      return `Scan complete: ${m[1]} headers checked, 0 in date range`;
    }
    return `Scan complete: ${m[1]} fetched${matched ? `, ${matched[1]} matched` : ''}`;
  }
  if ((m = text.match(/^\[imap\]\s+date-range\s+(.+?):\s+fetched\s+(\d+)\s+row/i))) {
    const totalMatch = text.match(/total\s+matched\s+(\d+)/i);
    const total = totalMatch ? `, matched so far: ${totalMatch[1]}` : '';
    return `Fetched ${m[2]} from ${m[1]}${total}`;
  }
  if (/date-range:\s+stop\s+older\s+scan/i.test(text)) {
    return 'Found all messages in range — finishing…';
  }
  if ((m = text.match(/^\[imap\]\s+date-range\s+direct:\s+(\d+)\s+uid/i))) {
    const count = parseInt(m[1], 10);
    if (count === 0) return null;
    return `Found ${count} email(s) in date range — fetching headers…`;
  }
  if (/date-range\s+direct:\s+hit\s+yahoo/i.test(text)) {
    return 'Yahoo search cap hit — switching to lookback scan…';
  }
  if (/date-range\s+direct\s+failed/i.test(text)) {
    return 'Direct search failed — switching to lookback scan…';
  }
  return null;
}

/**
 * Run the IMAP script via spawn, streaming stderr to onProgress in real time.
 * Collects stdout for later parsing.
 */
function runImapSpawned(args, { timeoutMs, cwd, env, onProgress, cancelJobId = null }) {
  const { isJobCancelled, registerImapChild } = require('./emailJobCancel');
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (cancelJobId) registerImapChild(cancelJobId, child);
    let stdout = '';
    let stderr = '';
    let stderrBuf = '';
    let timedOut = false;
    let killedForCancel = false;
    let lastProgressAt = 0;
    let lastProgressMsg = '';

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, timeoutMs);

    let cancelTimer = null;
    if (cancelJobId) {
      cancelTimer = setInterval(() => {
        if (isJobCancelled(cancelJobId)) {
          killedForCancel = true;
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }, 500);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 256 * 1024 * 1024) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    });

    child.stderr.on('data', (chunk) => {
      const piece = chunk.toString();
      stderr += piece;
      stderrBuf += piece;
      let nl;
      while ((nl = stderrBuf.indexOf('\n')) >= 0) {
        const line = stderrBuf.slice(0, nl);
        stderrBuf = stderrBuf.slice(nl + 1);
        const friendly = parseImapProgressLine(line);
        if (friendly && onProgress) {
          const now = Date.now();
          // Throttle: skip if same message within 1.5s
          if (friendly !== lastProgressMsg || now - lastProgressAt > 1500) {
            lastProgressMsg = friendly;
            lastProgressAt = now;
            try { onProgress(friendly); } catch { /* ignore */ }
          }
        }
        if (stderr.trim()) {
          // Keep raw stderr for debugging but don't spam console per-line
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (cancelTimer) clearInterval(cancelTimer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (cancelTimer) clearInterval(cancelTimer);
      if (killedForCancel || (cancelJobId && isJobCancelled(cancelJobId))) {
        const err = new Error('Email job cancelled by user.');
        err.code = 'EMAIL_JOB_CANCELLED';
        reject(err);
        return;
      }
      if (timedOut) {
        const err = new Error(`Yahoo IMAP timed out after ${Math.round(timeoutMs / 1000)}s`);
        err.stderr = stderr;
        reject(err);
        return;
      }
      if (code !== 0) {
        const err = new Error(`Yahoo IMAP exited with code ${code}`);
        err.stderr = stderr;
        err.code = code;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runImapCheckOnce(imapScript, message, payloadOptions = {}, onProgress = null) {
  const fetchOptions = resolveEmailFetchOptions(message, payloadOptions);
  const isDateRange = !!(fetchOptions.since && fetchOptions.before);
  const sender = isDateRange
    ? null
    : (parseMoveSenderFromMessage(message) || parseSenderFromMessage(message));
  const skillRoot = path.dirname(path.dirname(imapScript));
  const args = sender
    ? [imapScript, ...imapSearchArgs(fetchOptions, sender)]
    : [imapScript, ...imapCheckArgs(fetchOptions)];
  console.error('[continuum-bridge] imap args:', args.slice(1).join(' '));
  const timeoutMs = fetchOptions.since && fetchOptions.before
    ? Math.min(3600000, 180000 + fetchOptions.limit * 1500)
    : Math.min(3600000, 90000 + fetchOptions.limit * 1500);
  const maxBuffer = Math.min(128 * 1024 * 1024, 16 * 1024 * 1024 + fetchOptions.limit * 256 * 1024);

  const { stdout, stderr } = onProgress
    ? await runImapSpawned(args, {
        timeoutMs,
        cwd: skillRoot,
        env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
        onProgress,
        cancelJobId: payloadOptions._cancel_job_id || null,
      })
    : await execFileAsync(
        'node',
        args,
        {
          timeout: timeoutMs,
          maxBuffer,
          cwd: skillRoot,
          env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
        },
      );
  if (stderr?.trim()) {
    console.error('[continuum-bridge] imap stderr:', stderr.trim());
  }
  const scanMeta = parseScanMeta(stderr);
  const formatted = formatEmailMessages(
    stdout,
    fetchOptions.limit,
    fetchOptions.offset || 0,
    fetchOptions.dateRangeLabel || null,
    scanMeta,
    { summaryOnly: wantsEmailSummaryOnly(message) && !wantsEmailCleanup(message), message },
  );
  console.error(
    '[continuum-bridge] email fetch result:',
    `count=${formatted.fetchedCount ?? formatted.messages?.length ?? 0}`,
    fetchOptions.dateRangeLabel || fetchOptions.recent || '',
  );
  let context = formatted.text;
  if (sender) {
    context = [
      `Sender filter: FROM "${sender}" (${fetchOptions.recent}, limit ${fetchOptions.limit}${fetchOptions.offset ? `, offset ${fetchOptions.offset}` : ''}).`,
      wantsEmailMemoryIngest(message)
        ? 'MEMORY INGEST: User wants these emails fed into Continuum memory. Extract durable facts, commitments, dates, and relationship context. Confirm what you captured.'
        : null,
      '',
      context,
    ].filter(Boolean).join('\n');
  }
  return {
    context,
    messages: formatted.messages,
    fetchOptions: { ...fetchOptions, sender },
    scanMeta,
  };
}

async function runImapCheck(imapScript, message, payloadOptions = {}, onProgress = null) {
  let result = await runImapCheckOnce(imapScript, message, payloadOptions, onProgress);
  const matched = result.scanMeta?.matched;
  const loaded = result.messages?.length ?? 0;
  const explicitLimit = parseLimitFromMessage(message) != null;
  const isDateRange = !!(result.fetchOptions?.since && result.fetchOptions?.before);

  if (
    !explicitLimit
    && isDateRange
    && matched != null
    && matched > loaded
    && matched <= MAX_LIMIT
  ) {
    const expandedLimit = Math.min(MAX_LIMIT, matched);
    if (expandedLimit > (result.fetchOptions?.limit || 0)) {
      console.error(
        '[continuum-bridge] expanding date-range fetch:',
        `limit ${result.fetchOptions.limit} → ${expandedLimit} (${matched} matched)`,
      );
      if (onProgress) onProgress(`Expanding scan to load all ${matched} matched…`);
      result = await runImapCheckOnce(imapScript, message, {
        ...payloadOptions,
        email_limit: expandedLimit,
      });
    }
  }
  return result;
}

function formatImapError(err, fetchOptions = {}) {
  const detail = err.stderr?.toString?.() || err.message || String(err);
  if (/maxBuffer|stdout maxBuffer/i.test(detail)) {
    const limit = fetchOptions.limit || '?';
    return `Yahoo IMAP failed: inbox response too large (${limit} emails). The bridge now uses lite mode; run git pull and restart continuum-bridge. If it persists, try limit 100.`;
  }
  if (/auth|login|invalid credentials|authentication failed|password/i.test(detail)) {
    return `Yahoo IMAP failed: ${detail}. Check app password at ~/.config/mail-skills/.env`;
  }
  return `Yahoo IMAP failed: ${detail}`;
}

async function fetchEmailContext(message, payloadOptions = {}, onProgress = null) {
  const effectiveMessage = buildEffectiveEmailMessage(message, payloadOptions.history);

  if (wantsYearCleanup(effectiveMessage)) {
    const { parseYearRangeFromMessage } = require('./emailDateRange');
    const yearRange = parseYearRangeFromMessage(effectiveMessage);
    if (yearRange) {
      if (onProgress) onProgress(`Starting whole-year cleanup for ${yearRange.label || yearRange.since?.slice(0, 4)}…`);
      return runYearCleanup({
        message: effectiveMessage,
        yearRange,
        payloadOptions,
        onProgress,
      });
    }
  }

  const deleteRequested = wantsEmailDelete(effectiveMessage);
  const cleanupPreviewRequested = wantsEmailCleanupPreview(effectiveMessage);
  const moveRequested = wantsEmailMoveToFolder(effectiveMessage);
  const triageRequested = wantsTriage(effectiveMessage);
  const memoryIngestRequested = wantsEmailMemoryIngest(effectiveMessage);
  if (!wantsEmailFetch(effectiveMessage, payloadOptions) && !deleteRequested && !cleanupPreviewRequested && !moveRequested && !triageRequested && !memoryIngestRequested) {
    return { matched: false, context: null, error: null, fetchOptions: null, deleteResult: null, moveResult: null };
  }

  const imapScript = findImapScript();
  if (!imapScript) {
    return {
      matched: true,
      context: null,
      error: 'Yahoo IMAP skill not installed on VPS. Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh',
      fetchOptions: null,
      deleteResult: null,
      moveResult: null,
    };
  }

  const configPaths = [
    path.join(process.env.HOME || '/root', '.config/mail-skills/.env'),
    path.join(process.env.HOME || '/root', '.config/imap-smtp-email/.env'),
  ];
  const hasConfig = configPaths.some((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  });

  if (!hasConfig) {
    return {
      matched: true,
      context: null,
      error: 'Yahoo credentials missing. Run on VPS: bash /tmp/continuum-mobile/integrations/continuum-bridge/setup-yahoo-email.sh',
      fetchOptions: null,
      deleteResult: null,
      moveResult: null,
    };
  }

  if ((deleteRequested || moveRequested) && !payloadOptions.email_delete_enabled) {
    return {
      matched: true,
      context: null,
      error: 'Move-to-Trash is disabled in the app. Setup → OpenClaw Gateway → turn on "Allow move to Trash", Save, then try again.',
      fetchOptions: null,
      deleteResult: null,
      moveResult: null,
    };
  }

  const resolvedFetchOptions = resolveEmailFetchOptions(effectiveMessage, payloadOptions);
  const destFolder = moveRequested ? parseDestinationFolder(effectiveMessage) : null;

  try {
    const { context, messages, fetchOptions, scanMeta } = await runImapCheck(imapScript, effectiveMessage, payloadOptions, onProgress);

    let deleteResult = { executed: false, summary: null, error: null, uids: [], skippedUids: [] };
    let moveResult = { executed: false, summary: null, error: null, uids: [], destFolder: null, sender: null };

    const permission = evaluateOverLimitPermission({
      message: effectiveMessage,
      fetchOptions,
      scanMeta,
      messages,
      deleteRequested,
      moveRequested,
      destFolder,
    });

    const deleteCap = resolveDeleteCap({ message: effectiveMessage, messages, permission });
    const skipAutoTrashForCleanup = wantsEmailCleanup(effectiveMessage) && deleteRequested && !permission;
    let cleanupPreviewBlock = null;

    if (cleanupPreviewRequested) {
      cleanupPreviewBlock = formatCleanupPreviewBlock(messages, {
        dateRangeLabel: fetchOptions.dateRangeLabel,
      });
    }

    if (payloadOptions.email_auto_trash_junk && payloadOptions.email_delete_enabled && !permission && !moveRequested && !skipAutoTrashForCleanup && !cleanupPreviewRequested) {
      deleteResult = await maybeAutoTrashJunk(messages, imapScript, {
        enabled: true,
        includeGithub: false,
        max: deleteCap,
      });
    }

    if (deleteRequested && !permission && !cleanupPreviewRequested) {
      const manualResult = await maybeDeleteEmails(effectiveMessage, messages, imapScript, {
        enabled: !!payloadOptions.email_delete_enabled,
        listOffset: fetchOptions.offset || 0,
        maxDelete: deleteCap,
      });
      if (manualResult.executed) {
        deleteResult = deleteResult.executed
          ? mergeDeleteResults(deleteResult, manualResult, messages)
          : manualResult;
      } else if (manualResult.error && !deleteResult.executed) {
        deleteResult = manualResult;
      }
    }

    if (moveRequested && !permission) {
      moveResult = await maybeMoveEmailsToFolder(effectiveMessage, messages, imapScript, {
        enabled: !!payloadOptions.email_delete_enabled,
      });
    }

    let finalContext = context;
    if (permission) {
      finalContext = [
        context,
        '',
        formatPermissionBlock(permission),
      ].join('\n');
    }
    if (triageRequested) {
      const triage = buildTriageContext(messages, effectiveMessage);
      finalContext = [
        context,
        '',
        '[Email triage]',
        triage.report,
        triage.junkCount
          ? `\nJunk UIDs for trash/delete (from fetched list only): ${triage.junkUids.join(', ')}`
          : '\nNo selectable junk in the fetched inbox slice. Raise Email Fetch Limit or widen lookback.',
      ].join('\n');
    }
    if (deleteResult.executed && deleteResult.summary) {
      const label = deleteResult.auto && !deleteRequested
        ? '[Email auto-trash executed]'
        : wantsEmailCleanup(effectiveMessage)
          ? '[Email cleanup executed — moved to Trash]'
          : '[Email trash executed]';
      finalContext = [finalContext, '', label, deleteResult.summary, formatTrashReportBlock(deleteResult)].filter(Boolean).join('\n');
    } else if (deleteResult.error) {
      let errBlock = `[Email trash] ${deleteResult.error}`;
      if (CHURCH_COMMUNITY_INTENT.test(effectiveMessage)) {
        const churchUids = resolveChurchCommunityUids(messages);
        if (churchUids.length) {
          errBlock += [
            '',
            '[Church/community matches in fetched inbox]',
            `UIDs: ${churchUids.join(', ')}`,
            `Retry: delete uid ${churchUids.join(', ')}`,
            'Or by list number: delete emails 4, 60, 67',
          ].join('\n');
        }
      }
      finalContext = [finalContext, '', errBlock].filter(Boolean).join('\n');
    }
    if (moveResult.executed && moveResult.summary) {
      finalContext = [finalContext, '', '[Email move executed]', moveResult.summary].join('\n');
    } else if (moveResult.error) {
      finalContext = [finalContext, '', `[Email move] ${moveResult.error}`].filter(Boolean).join('\n');
    }

    const cleanupRequested = wantsEmailCleanup(effectiveMessage);
    if (wantsEmailSummaryOnly(effectiveMessage) || /SUMMARY MODE:/i.test(context || '') || cleanupRequested || cleanupPreviewRequested) {
      const prefilled = buildPrefilledSummaryReply({
        dateRangeLabel: fetchOptions.dateRangeLabel,
        scanMeta,
        messages,
        deleteResult,
        permission,
        cleanupRequested,
        cleanupPreviewRequested,
        cleanupPreviewBlock,
      });
      if (prefilled) {
        if (cleanupRequested || cleanupPreviewRequested) {
          const scanBlock = formatScanDiagnostic(
            scanMeta,
            fetchOptions.dateRangeLabel,
            messages?.length ?? 0,
          );
          const trashBlocks = [];
          if (cleanupPreviewBlock?.text) {
            trashBlocks.push(cleanupPreviewBlock.text);
          }
          if (deleteResult.executed && deleteResult.summary) {
            const label = deleteResult.auto && !deleteRequested
              ? '[Email auto-trash executed]'
              : '[Email cleanup executed — moved to Trash]';
            trashBlocks.push(label, deleteResult.summary, formatTrashReportBlock(deleteResult));
          } else if (deleteResult.error) {
            trashBlocks.push(`[Email trash] ${deleteResult.error}`);
          }
          if (moveResult.executed && moveResult.summary) {
            trashBlocks.push('[Email move executed]', moveResult.summary);
          } else if (moveResult.error) {
            trashBlocks.push(`[Email move] ${moveResult.error}`);
          }
          if (permission) {
            trashBlocks.push(formatPermissionBlock(permission));
          }
          finalContext = [scanBlock, prefilled, ...trashBlocks].filter(Boolean).join('\n\n');
        } else {
          finalContext = [finalContext, '', prefilled].join('\n');
        }
      }
    }

    return {
      matched: true,
      context: finalContext,
      error: null,
      fetchOptions,
      scanMeta,
      loadedCount: messages?.length ?? 0,
      messages,
      deleteResult,
      moveResult,
    };
  } catch (err) {
    return {
      matched: true,
      context: null,
      error: formatImapError(err, resolvedFetchOptions),
      fetchOptions: null,
      deleteResult: null,
      moveResult: null,
    };
  }
}

async function getEmailHealth({ quick = false } = {}) {
  const imapScript = findImapScript();
  if (!imapScript) {
    return { ready: false, reason: 'imap skill not installed' };
  }
  const configPath = [
    path.join(process.env.HOME || '/root', '.config/mail-skills/.env'),
    path.join(process.env.HOME || '/root', '.config/imap-smtp-email/.env'),
  ].find((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!configPath) {
    return { ready: false, reason: 'mail config missing' };
  }
  if (quick) {
    return {
      ready: true,
      config: configPath,
      quick: true,
      note: 'IMAP probe skipped for fast platform health check',
    };
  }
  try {
    await runImapCheck(imapScript, 'check inbox', { email_limit: 3, email_recent: '24h' });
    const deleteSupported = await probeImapDeleteCommand(imapScript);
    return {
      ready: true,
      config: configPath,
      max_limit: MAX_LIMIT,
      delete_supported: deleteSupported,
      delete_hint: deleteSupported
        ? null
        : 'Run: bash /tmp/continuum-mobile/integrations/continuum-bridge/sync-imap-skill.sh',
    };
  } catch (err) {
    return { ready: false, reason: err.message || String(err) };
  }
}

module.exports = {
  fetchEmailContext,
  getEmailHealth,
  findImapScript,
  buildPrefilledSummaryReply,
  extractPrefilledSummaryFromText,
  extractPrefilledSummary: extractPrefilledSummaryFromText,
};
