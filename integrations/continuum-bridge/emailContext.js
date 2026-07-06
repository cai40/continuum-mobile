'use strict';

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolveEmailFetchOptions, MAX_LIMIT, wantsEmailFetch, wantsEmailSummaryOnly, parseLimitFromMessage } = require('./emailFetchOptions');
const { parseSenderFromMessage, wantsEmailMemoryIngest, imapSearchArgs } = require('./emailSender');
const { maybeDeleteEmails, maybeAutoTrashJunk, wantsEmailDelete, wantsEmailCleanup, resolveChurchCommunityUids, CHURCH_COMMUNITY_INTENT, countCleanupTargets, mergeDeleteResults } = require('./emailDelete');
const { maybeMoveEmailsToFolder, wantsEmailMoveToFolder, parseDestinationFolder, parseMoveSenderFromMessage } = require('./emailMove');
const { evaluateOverLimitPermission, formatPermissionBlock } = require('./emailPermission');
const { wantsTriage, buildTriageContext, classifyEmail, triageMessages } = require('./emailTriage');

const { buildEffectiveEmailMessage } = require('./emailConfirmIntent');

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

function formatScanDiagnostic(scanMeta, dateRangeLabel) {
  if (!scanMeta) return null;
  const span = scanMeta.span
    ? `dates in scanned mail: ${scanMeta.span.oldest} through ${scanMeta.span.newest}`
    : 'no parseable dates in scanned mail';
  const samples = Array.isArray(scanMeta.sampleDates) && scanMeta.sampleDates.length
    ? ` Sample newest dates: ${scanMeta.sampleDates.join(', ')}.`
    : '';
  const used = scanMeta.used?.since && scanMeta.used?.before
    && scanMeta.wanted?.since && scanMeta.wanted?.before
    && (scanMeta.used.since !== scanMeta.wanted.since || scanMeta.used.before !== scanMeta.wanted.before)
    ? ` (year-adjusted filter: ${scanMeta.used.since} .. ${scanMeta.used.before})`
    : '';
  const matched = scanMeta.matched ?? 0;
  let scanLine;
  if (scanMeta.recentWindow != null || scanMeta.parsed != null) {
    const headers = scanMeta.scanned ?? scanMeta.parsed ?? 0;
    const recent = scanMeta.recentWindow ?? '?';
    scanLine = `- Scanned ${headers} message header(s) across inbox; Yahoo recent search window: ${recent} UID(s). ${span}.${samples}`;
  } else {
    scanLine = `- Scanned ${scanMeta.scanned} of ${scanMeta.totalUids} INBOX message(s); ${span}.${samples}`;
  }
  return [
    'MAILBOX SCAN (you MUST include all lines below in your reply):',
    scanLine,
    `- Requested range: ${dateRangeLabel || 'unknown'}. Matched: ${matched}${used}.`,
  ].join('\n');
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
  const scanBlock = formatScanDiagnostic(scanMeta, dateRangeLabel);
  const matched = scanMeta?.matched ?? null;
  const batchLine = matched != null && matched > parsed.length
    ? `${parsed.length} of ${matched} matched email(s) loaded in this batch (fetch limit ${limit}, offset ${offset}).`
    : `${parsed.length} email(s) loaded (fetch limit ${limit}, offset ${offset}).`;
  const shortfallNote = matched != null && matched > parsed.length
    ? `${matched - parsed.length} more matched email(s) were not loaded — raise Email Fetch Limit or say "limit 5000".`
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
    `Cleanup targets in this batch (news/promo/junk): ${cleanupCount} (max 100 per path; auto-trash + cleanup report one combined total).`,
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
    const scanBlock = formatScanDiagnostic(scanMeta, dateRangeLabel);
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
  const summaryOnly = options.summaryOnly || wantsEmailSummaryOnly(options.message || '') || fetchedCount > 250;

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

async function runImapCheckOnce(imapScript, message, payloadOptions = {}) {
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
    ? Math.min(600000, 120000 + fetchOptions.limit * 2000)
    : Math.min(360000, 60000 + fetchOptions.limit * 2000);
  const maxBuffer = Math.min(128 * 1024 * 1024, 16 * 1024 * 1024 + fetchOptions.limit * 256 * 1024);

  const { stdout, stderr } = await execFileAsync(
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
    { summaryOnly: wantsEmailSummaryOnly(message), message },
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

async function runImapCheck(imapScript, message, payloadOptions = {}) {
  let result = await runImapCheckOnce(imapScript, message, payloadOptions);
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

async function fetchEmailContext(message, payloadOptions = {}) {
  const effectiveMessage = buildEffectiveEmailMessage(message, payloadOptions.history);
  const deleteRequested = wantsEmailDelete(effectiveMessage);
  const moveRequested = wantsEmailMoveToFolder(effectiveMessage);
  const triageRequested = wantsTriage(effectiveMessage);
  const memoryIngestRequested = wantsEmailMemoryIngest(effectiveMessage);
  if (!wantsEmailFetch(effectiveMessage, payloadOptions) && !deleteRequested && !moveRequested && !triageRequested && !memoryIngestRequested) {
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
    const { context, messages, fetchOptions, scanMeta } = await runImapCheck(imapScript, effectiveMessage, payloadOptions);

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

    if (payloadOptions.email_auto_trash_junk && payloadOptions.email_delete_enabled && !permission && !moveRequested) {
      deleteResult = await maybeAutoTrashJunk(messages, imapScript, {
        enabled: true,
        includeGithub: false,
      });
    }

    if (deleteRequested && !permission) {
      const manualResult = await maybeDeleteEmails(effectiveMessage, messages, imapScript, {
        enabled: !!payloadOptions.email_delete_enabled,
        listOffset: fetchOptions.offset || 0,
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

    return {
      matched: true,
      context: finalContext,
      error: null,
      fetchOptions,
      scanMeta,
      loadedCount: messages?.length ?? 0,
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

module.exports = { fetchEmailContext, getEmailHealth, findImapScript };
