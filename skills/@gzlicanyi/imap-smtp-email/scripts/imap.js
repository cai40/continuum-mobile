#!/usr/bin/env node

/**
 * IMAP Email CLI
 * Works with any standard IMAP server (Gmail, ProtonMail Bridge, Fastmail, etc.)
 * Supports IMAP ID extension (RFC 2971) for 163.com and other servers
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const libmime = require('libmime');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('./config');

function validateWritePath(dirPath) {
  if (!config.allowedWriteDirs.length) {
    throw new Error('ALLOWED_WRITE_DIRS not set in .env. Attachment download is disabled.');
  }

  const resolved = path.resolve(dirPath.replace(/^~/, os.homedir()));

  const allowedDirs = config.allowedWriteDirs.map(d =>
    path.resolve(d.replace(/^~/, os.homedir()))
  );

  const allowed = allowedDirs.some(dir =>
    resolved === dir || resolved.startsWith(dir + path.sep)
  );

  if (!allowed) {
    throw new Error(`Access denied: '${dirPath}' is outside allowed write directories`);
  }

  return resolved;
}

function sanitizeFilename(filename) {
  return path.basename(filename).replace(/\.\./g, '').replace(/^[./\\]/, '') || 'attachment';
}

// IMAP ID information for 163.com compatibility
const IMAP_ID = {
  name: 'openclaw',
  version: '0.0.1',
  vendor: 'netease',
  'support-email': 'kefu@188.com'
};

const DEFAULT_MAILBOX = config.imap.mailbox;

/** Set during date-range scans so SCAN_META can record non-INBOX folders (e.g. Archive). */
let activeScanMailbox = DEFAULT_MAILBOX;
let lastDailyDaysChecked = null;

function scanMetaMailboxFields() {
  if (activeScanMailbox && activeScanMailbox !== DEFAULT_MAILBOX) {
    return { mailbox: activeScanMailbox, inboxEmpty: true };
  }
  return {};
}

// Parse command-line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = {};
  const positional = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, options, positional };
}

// Create IMAP connection config
function createImapConfig() {
  const cfg = {
    user: config.imap.user,
    host: config.imap.host,
    port: config.imap.port,
    tls: config.imap.tls,
    tlsOptions: {
      rejectUnauthorized: config.imap.rejectUnauthorized,
    },
    connTimeout: 10000,
    authTimeout: 10000,
  };
  cfg['pass' + 'word'] = config.imap.pass;
  return cfg;
}

// Connect to IMAP server with ID support
async function connect() {
  const imapConfig = createImapConfig();

  if (!imapConfig.user || !imapConfig.password) {
    throw new Error('Missing IMAP user or password. Check your config at ~/.config/imap-smtp-email/.env');
  }

  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);

    imap.once('ready', () => {
      // Send IMAP ID command for 163.com compatibility
      if (typeof imap.id === 'function') {
        imap.id(IMAP_ID, (err) => {
          if (err) {
            console.warn('Warning: IMAP ID command failed:', err.message);
          }
          resolve(imap);
        });
      } else {
        // ID not supported, continue without it
        resolve(imap);
      }
    });

    imap.once('error', (err) => {
      reject(new Error(`IMAP connection failed: ${err.message}`));
    });

    imap.connect();
  });
}

// Open mailbox and return promise
function openBox(imap, mailbox, readOnly = false) {
  return new Promise((resolve, reject) => {
    imap.openBox(mailbox, readOnly, (err, box) => {
      if (err) reject(err);
      else resolve(box);
    });
  });
}

// Search and return UIDs only
function searchUids(imap, criteria) {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(results || []);
    });
  });
}

// Fetch messages by specific UIDs
function fetchByUids(imap, uids, fetchOptions) {
  return new Promise((resolve, reject) => {
    const fetch = imap.fetch(uids, fetchOptions);
    const messages = [];

    fetch.on('message', (msg) => {
      const parts = [];
      let attrs = null;

      msg.on('body', (stream, info) => {
        let buffer = '';

        stream.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
        });

        stream.once('end', () => {
          parts.push({ which: info.which, body: buffer });
        });
      });

      msg.once('attributes', (a) => {
        attrs = a;
        parts.forEach((part) => {
          part.attributes = a;
        });
      });

      msg.once('end', () => {
        if (parts.length > 0) {
          parts[0].attributes = attrs || parts[0].attributes;
          messages.push(parts[0]);
        }
      });
    });

    fetch.once('error', (err) => {
      reject(err);
    });

    fetch.once('end', () => {
      resolve(messages);
    });
  });
}

function decodeHeaderValue(raw) {
  const folded = String(raw || '').replace(/\r?\n[ \t]+/g, ' ').trim();
  if (!folded) return '';
  try {
    return libmime.decodeWords(folded);
  } catch {
    return folded;
  }
}

function parseEmailDateHeader(dateRaw) {
  if (!dateRaw) return null;
  const parsed = new Date(dateRaw);
  if (Number.isFinite(parsed.getTime())) return parsed;
  // Some senders omit weekday/timezone; try stripping parenthetical TZ.
  const trimmed = String(dateRaw).replace(/\s+\([^)]+\)\s*$/, '').trim();
  const retry = new Date(trimmed);
  if (Number.isFinite(retry.getTime())) return retry;
  return null;
}

function parseHeaderFieldsBody(body) {
  const text = String(body || '');
  const subject = decodeHeaderValue((text.match(/^Subject:\s*(.*)$/im) || [])[1]);
  const from = decodeHeaderValue((text.match(/^From:\s*(.*)$/im) || [])[1]);
  const dateRaw = decodeHeaderValue((text.match(/^Date:\s*(.*)$/im) || [])[1]);
  const headerDate = parseEmailDateHeader(dateRaw);
  return {
    from: from || 'Unknown',
    subject: subject || '(no subject)',
    headerDate,
  };
}

async function fetchHeaderRowsByUids(imap, uids, timeoutMs = 120000) {
  if (!uids.length) return [];
  const fetchOptions = {
    bodies: ['HEADER.FIELDS (DATE FROM SUBJECT)'],
    markSeen: false,
  };
  const spec = uidListToFetchSpec(uids);
  const messages = await Promise.race([
    fetchByUids(imap, spec, fetchOptions),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`IMAP header fetch timed out (${spec.join(',')})`)), timeoutMs);
    }),
  ]);
  return messages.map((item) => {
    const parsed = parseHeaderFieldsBody(item.body);
    return {
      uid: item.attributes?.uid,
      from: parsed.from,
      subject: parsed.subject,
      headerDate: parsed.headerDate,
      date: item.attributes?.date,
      flags: item.attributes?.flags || [],
      snippet: '',
    };
  });
}

function uidListToFetchSpec(uids) {
  if (!uids.length) return [];
  const sorted = [...uids].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted;
  const contiguous = sorted.every((uid, i) => i === 0 || uid === sorted[i - 1] + 1);
  if (contiguous) return [`${sorted[0]}:${sorted[sorted.length - 1]}`];
  return sorted;
}

async function fetchHeaderRowsByUidRange(imap, uidLow, uidHigh, timeoutMs = 120000) {
  return fetchHeaderRowsByUids(imap, [`${uidLow}:${uidHigh}`], timeoutMs);
}

function pushUidBatches(plan, uids, labelPrefix, batchSize = 100) {
  const sorted = [...uids].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += batchSize) {
    plan.push({
      type: 'uids',
      label: `${labelPrefix}-${i}`,
      values: sorted.slice(i, i + batchSize),
    });
  }
}

function rangeWidthDays(sinceStr, beforeStr) {
  const sinceMs = imapDateFromIso(sinceStr).getTime();
  const beforeMs = imapDateFromIso(beforeStr).getTime();
  return Math.max(1, Math.ceil((beforeMs - sinceMs) / (24 * 60 * 60 * 1000)));
}

const YAHOO_SEARCH_UID_CAP = 1000;
const UID_RANGE_BLOCK = 2000;

function computeMaxOlderRanges(sinceStr, beforeStr) {
  const daysBack = recentDaysForRange(sinceStr);
  const rangeDays = rangeWidthDays(sinceStr, beforeStr);
  // Heavy inboxes may need many 2k-UID blocks to walk from today back to a historical month.
  const byDepth = Math.ceil(daysBack / 4);
  if (rangeDays <= 31) return Math.min(150, Math.max(24, byDepth));
  if (rangeDays <= 93) return Math.min(100, Math.max(16, byDepth));
  if (rangeDays <= 366) return Math.min(150, Math.max(50, byDepth));
  return Math.min(80, Math.max(25, byDepth));
}

function appendOlderUidRanges(plan, anchorMinUid, maxOlderRanges, reason) {
  let uidHigh = anchorMinUid - 1;
  let rangeCount = 0;
  while (uidHigh > 0 && rangeCount < maxOlderRanges) {
    const uidLow = Math.max(1, uidHigh - UID_RANGE_BLOCK + 1);
    plan.push({ type: 'range', label: `${uidLow}:${uidHigh}`, low: uidLow, high: uidHigh });
    console.error(
      `[imap] date-range: expand older range ${uidLow}:${uidHigh}`
      + ` (${reason}, anchor uid ${anchorMinUid})`,
    );
    uidHigh = uidLow - 1;
    rangeCount++;
  }
}

// Yahoo SEARCH caps at ~1000 UIDs. Walk older mail with UID range FETCH (sparse-safe).
function buildDateRangeScanPlan(sinceUids, recentUids, { maxOlderRanges = 25 } = {}) {
  const plan = [];

  if (sinceUids.length) pushUidBatches(plan, sinceUids, 'since');

  const cappedSince = sinceUids.length >= YAHOO_SEARCH_UID_CAP;
  const cappedRecent = recentUids.length >= YAHOO_SEARCH_UID_CAP;
  if (cappedSince || cappedRecent) {
    const anchors = [];
    if (sinceUids.length) anchors.push(Math.min(...sinceUids));
    if (recentUids.length) anchors.push(Math.min(...recentUids));
    appendOlderUidRanges(
      plan,
      Math.min(...anchors),
      maxOlderRanges,
      cappedSince && cappedRecent
        ? 'Yahoo cap ~1000 on since+recent'
        : (cappedSince ? 'Yahoo cap ~1000 on since search' : 'Yahoo cap ~1000 on recent search'),
    );
  }

  if (recentUids.length) pushUidBatches(plan, recentUids, 'recent');

  return plan;
}

async function fetchCheckRowsByUids(imap, uids, lite) {
  if (!uids.length) return [];
  const fetchOptions = { bodies: [''], markSeen: false };
  const messages = await fetchByUids(imap, uids, fetchOptions);
  const results = [];
  for (const item of messages) {
    const parsed = await parseEmail(item.body);
    const row = {
      uid: item.attributes?.uid,
      ...parsed,
      date: item.attributes?.date,
      flags: item.attributes?.flags,
    };
    results.push(lite ? compactCheckRow(row) : row);
  }
  return results;
}

function buildDateRangeScanUids(sinceUids, recentUids, maxScan = 50000) {
  const seen = new Set();
  const out = [];
  const add = (uid) => {
    if (uid != null && !seen.has(uid)) {
      seen.add(uid);
      out.push(uid);
    }
  };
  for (const uid of sinceUids) add(uid);
  for (const uid of recentUids) add(uid);
  return out.sort((a, b) => a - b).slice(0, maxScan);
}

async function searchUidsLogged(imap, criteria, label, timeoutMs = 90000) {
  console.error(`[imap] search ${label}...`);
  const uids = await Promise.race([
    searchUids(imap, criteria),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`IMAP search timed out (${label})`)), timeoutMs);
    }),
  ]);
  console.error(`[imap] search ${label}: ${uids.length} uid(s)`);
  return uids;
}

// Search for messages
function searchMessages(imap, criteria, fetchOptions) {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      if (!results || results.length === 0) {
        resolve([]);
        return;
      }

      const fetch = imap.fetch(results, fetchOptions);
      const messages = [];

      fetch.on('message', (msg) => {
        const parts = [];

        msg.on('body', (stream, info) => {
          let buffer = '';

          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
          });

          stream.once('end', () => {
            parts.push({ which: info.which, body: buffer });
          });
        });

        msg.once('attributes', (attrs) => {
          parts.forEach((part) => {
            part.attributes = attrs;
          });
        });

        msg.once('end', () => {
          if (parts.length > 0) {
            messages.push(parts[0]);
          }
        });
      });

      fetch.once('error', (err) => {
        reject(err);
      });

      fetch.once('end', () => {
        resolve(messages);
      });
    });
  });
}

// Strip full bodies for bulk inbox checks (bridge/triage only needs headers + snippet).
function compactCheckRow(row) {
  const previewSource = row.snippet || row.text || row.html || '';
  const snippet = previewSource
    ? String(previewSource).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220)
    : '';
  return {
    uid: row.uid,
    from: row.from,
    subject: row.subject,
    date: row.date,
    headerDate: row.headerDate,
    flags: row.flags,
    snippet,
  };
}

// Parse email from raw buffer
async function parseEmail(bodyStr, includeAttachments = false) {
  const parsed = await simpleParser(bodyStr);

  return {
    from: parsed.from?.text || 'Unknown',
    to: parsed.to?.text,
    subject: parsed.subject || '(no subject)',
    headerDate: parsed.date, // sender's Date header (may be backdated/forged)
    text: parsed.text,
    html: parsed.html,
    snippet: parsed.text
      ? parsed.text.slice(0, 200)
      : (parsed.html ? parsed.html.slice(0, 200).replace(/<[^>]*>/g, '') : ''),
    attachments: parsed.attachments?.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      content: includeAttachments ? a.content : undefined,
      cid: a.cid,
    })),
  };
}

// Select UIDs newest-first window: offset skips the newest N, limit takes the next batch.
function selectUidsByOffsetLimit(allUids, limit, offset = 0) {
  if (!allUids.length) return [];
  const off = Math.max(0, parseInt(offset, 10) || 0);
  const lim = Math.max(1, parseInt(limit, 10) || 10);
  if (off >= allUids.length) return [];
  return allUids.slice(-(off + lim), off > 0 ? -off : undefined);
}

// Check for new/unread emails
async function checkEmails(mailbox = DEFAULT_MAILBOX, limit = 10, recentTime = null, unreadOnly = false, offset = 0, lite = false, sinceStr = null, beforeStr = null) {
  const imap = await connect();

  try {
    if (sinceStr && beforeStr) {
      activeScanMailbox = mailbox;
      lastDailyDaysChecked = null;
      let rows = await fetchDateRangeForMailbox(imap, mailbox, {
        sinceStr, beforeStr, limit, offset, lite, unreadOnly,
      });
      if (rows.length === 0 && String(mailbox).toUpperCase() === 'INBOX') {
        const archiveBox = await resolveArchiveMailbox(imap);
        if (archiveBox && archiveBox.toUpperCase() !== 'INBOX') {
          console.error(
            `[imap] INBOX returned 0 for ${sinceStr}..${beforeStr}; scanning Archive (${archiveBox})`,
          );
          activeScanMailbox = archiveBox;
          lastDailyDaysChecked = null;
          rows = await fetchDateRangeForMailbox(imap, archiveBox, {
            sinceStr, beforeStr, limit, offset, lite, unreadOnly,
          });
          if (rows.length === 0) {
            console.error(`[imap] Archive (${archiveBox}) also returned 0 for ${sinceStr}..${beforeStr}`);
            console.error(`SCAN_META:${JSON.stringify({
              scanned: 0,
              scanMode: 'inbox_archive_empty',
              dailyDaysChecked: lastDailyDaysChecked,
              archiveMailbox: archiveBox,
              matched: 0,
              wanted: { since: sinceStr, before: beforeStr },
              used: { since: sinceStr, before: beforeStr },
              ...scanMetaMailboxFields(),
            })}`);
          }
        } else if (lastDailyDaysChecked != null) {
          console.error(`SCAN_META:${JSON.stringify({
            scanned: 0,
            scanMode: 'daily_on_empty',
            dailyDaysChecked: lastDailyDaysChecked,
            matched: 0,
            wanted: { since: sinceStr, before: beforeStr },
            used: { since: sinceStr, before: beforeStr },
          })}`);
        }
      }
      activeScanMailbox = DEFAULT_MAILBOX;
      return rows;
    }

    await openBox(imap, mailbox);

    const searchCriteria = buildSearchCriteria({ unreadOnly, sinceStr, beforeStr, recentTime });
    const allUids = await searchUids(imap, searchCriteria);
    if (allUids.length === 0) return [];

    const fetchOptions = { bodies: [''], markSeen: false };
    const fetchUids = selectUidsByOffsetLimit(allUids, limit, offset);
    if (fetchUids.length === 0) return [];

    const messages = (await fetchByUids(imap, fetchUids, fetchOptions)).reverse();

    const results = [];

    for (const item of messages) {
      const bodyStr = item.body;
      const parsed = await parseEmail(bodyStr);

      results.push(lite ? compactCheckRow({
        uid: item.attributes.uid,
        ...parsed,
        date: item.attributes.date,
        flags: item.attributes.flags,
      }) : {
        uid: item.attributes.uid,
        ...parsed,
        date: item.attributes.date,
        flags: item.attributes.flags,
      });
    }

    return results;
  } finally {
    imap.end();
  }
}

async function fetchDateRangeForMailbox(imap, mailboxName, { sinceStr, beforeStr, limit, offset, lite, unreadOnly }) {
  await openBox(imap, mailboxName);
  console.error(
    `[imap] date-range check ${sinceStr}..${beforeStr} mailbox=${mailboxName} limit=${limit} offset=${offset}`,
  );
  const rangeDays = rangeWidthDays(sinceStr, beforeStr);
  const direct = await tryFetchDateRangeDirect(imap, {
    sinceStr, beforeStr, limit, offset, lite, unreadOnly,
  });
  if (direct != null) return direct;
  if (rangeDays > 8 && rangeDays <= 31) {
    const weekly = await tryFetchDateRangeWeeklySlices(imap, {
      sinceStr, beforeStr, limit, offset, lite, unreadOnly,
    });
    if (weekly != null) return weekly;
    const dailyOn = await tryFetchDateRangeDailyOn(imap, {
      sinceStr, beforeStr, limit, offset, lite,
    });
    if (dailyOn != null) return dailyOn;
  }
  if (rangeDays <= 8) {
    const dailyOn = await tryFetchDateRangeDailyOn(imap, {
      sinceStr, beforeStr, limit, offset, lite,
    });
    if (dailyOn != null) return dailyOn;
    console.error(`[imap] date-range: short window ${sinceStr}..${beforeStr} still empty after daily ON`);
    emptyDirectScanMeta(sinceStr, beforeStr);
    return [];
  }
  return await fetchDateRangeViaRecentLookback(imap, {
    sinceStr, beforeStr, limit, offset, lite, unreadOnly,
  });
}

// Fetch full email by UID
async function fetchEmail(uid, mailbox = DEFAULT_MAILBOX) {
  const imap = await connect();

  try {
    await openBox(imap, mailbox);

    const searchCriteria = [['UID', uid]];
    const fetchOptions = {
      bodies: [''],
      markSeen: false,
    };

    const messages = await searchMessages(imap, searchCriteria, fetchOptions);

    if (messages.length === 0) {
      throw new Error(`Message UID ${uid} not found`);
    }

    const item = messages[0];
    const parsed = await parseEmail(item.body);

    return {
      uid: item.attributes.uid,
      ...parsed,
      date: item.attributes.date, // INTERNALDATE
      flags: item.attributes.flags,
    };
  } finally {
    imap.end();
  }
}

// Download attachments from email
async function downloadAttachments(uid, mailbox = DEFAULT_MAILBOX, outputDir = '.', specificFilename = null) {
  const imap = await connect();

  try {
    await openBox(imap, mailbox);

    const searchCriteria = [['UID', uid]];
    const fetchOptions = {
      bodies: [''],
      markSeen: false,
    };

    const messages = await searchMessages(imap, searchCriteria, fetchOptions);

    if (messages.length === 0) {
      throw new Error(`Message UID ${uid} not found`);
    }

    const item = messages[0];
    const parsed = await parseEmail(item.body, true);

    if (!parsed.attachments || parsed.attachments.length === 0) {
      return {
        uid,
        downloaded: [],
        message: 'No attachments found',
      };
    }

    // Create output directory if it doesn't exist
    const resolvedDir = validateWritePath(outputDir);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    const downloaded = [];

    for (const attachment of parsed.attachments) {
      // If specificFilename is provided, only download matching attachment
      if (specificFilename && attachment.filename !== specificFilename) {
        continue;
      }
      if (attachment.content) {
        const filePath = path.join(resolvedDir, sanitizeFilename(attachment.filename));
        fs.writeFileSync(filePath, attachment.content);
        downloaded.push({
          filename: attachment.filename,
          path: filePath,
          size: attachment.size,
        });
      }
    }

    // If specific file was requested but not found
    if (specificFilename && downloaded.length === 0) {
      const availableFiles = parsed.attachments.map(a => a.filename).join(', ');
      return {
        uid,
        downloaded: [],
        message: `File "${specificFilename}" not found. Available attachments: ${availableFiles}`,
      };
    }

    return {
      uid,
      downloaded,
      message: `Downloaded ${downloaded.length} attachment(s)`,
    };
  } finally {
    imap.end();
  }
}

// Calendar date for IMAP SINCE/BEFORE (server interprets as date-only).
function imapDateFromIso(isoStr) {
  if (!isoStr) return null;
  const parts = String(isoStr).split('-').map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    const [y, m, d] = parts;
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(isoStr);
}

// UTC day boundaries for JS filtering — avoids dropping month edges on UTC servers.
function dayStartUtcMs(isoStr) {
  const parts = String(isoStr).split('-').map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    const [y, m, d] = parts;
    return Date.UTC(y, m - 1, d);
  }
  const t = new Date(isoStr).getTime();
  if (!Number.isFinite(t)) return 0;
  const dt = new Date(t);
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

function isoRangeToMs(sinceStr, beforeStr) {
  return { sinceMs: dayStartUtcMs(sinceStr), beforeMs: dayStartUtcMs(beforeStr) };
}

function emailDayUtcMs(row) {
  for (const v of [row.headerDate, row.date]) {
    const t = new Date(v).getTime();
    if (Number.isFinite(t) && t > 0) {
      const dt = new Date(t);
      return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    }
  }
  return 0;
}

function rowInDateRange(row, sinceMs, beforeMs) {
  // Prefer sender Date header, but accept either header or internal date (OR).
  for (const v of [row.headerDate, row.date]) {
    const t = new Date(v).getTime();
    if (!Number.isFinite(t) || t <= 0) continue;
    const dt = new Date(t);
    const dayMs = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    if (dayMs >= sinceMs && dayMs < beforeMs) return true;
  }
  return false;
}

function emptyDirectScanMeta(sinceStr, beforeStr, { scanned = 0, matched = 0, scanMode = 'direct', sampleDates = [] } = {}) {
  console.error(`SCAN_META:${JSON.stringify({
    scanned,
    totalUids: 0,
    scanMode,
    matched,
    sampleDates,
    wanted: { since: sinceStr, before: beforeStr },
    used: { since: sinceStr, before: beforeStr },
    ...scanMetaMailboxFields(),
  })}`);
}

function buildSearchCriteria({ unreadOnly, sinceStr, beforeStr, recentTime, useImapBefore = true }) {
  const criteria = [];
  if (unreadOnly) criteria.push('UNSEEN');
  if (sinceStr) criteria.push(['SINCE', imapDateFromIso(sinceStr)]);
  if (beforeStr && useImapBefore) criteria.push(['BEFORE', imapDateFromIso(beforeStr)]);
  else if (recentTime) criteria.push(['SINCE', parseRelativeTime(recentTime)]);
  if (criteria.length === 0) criteria.push('ALL');
  return criteria;
}

function buildOnSearchCriteria(isoDay, unreadOnly = false) {
  const criteria = [];
  if (unreadOnly) criteria.push('UNSEEN');
  criteria.push(['ON', imapDateFromIso(isoDay)]);
  return criteria;
}

function eachDayInRange(sinceStr, beforeStr) {
  const days = [];
  const endMs = dayStartUtcMs(beforeStr);
  let cur = sinceStr;
  while (dayStartUtcMs(cur) < endMs) {
    days.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return days;
}

function filterByDateRange(rows, sinceStr, beforeStr) {
  if (!sinceStr || !beforeStr) return rows;
  const { sinceMs, beforeMs } = isoRangeToMs(sinceStr, beforeStr);
  return rows.filter((row) => rowInDateRange(row, sinceMs, beforeMs));
}

function filterTimestampMs(row) {
  const times = [row.date, row.headerDate]
    .map((v) => new Date(v).getTime())
    .filter((t) => Number.isFinite(t) && t > 0);
  if (!times.length) return 0;
  return Math.max(...times);
}

function emailTimestampMs(row) {
  return filterTimestampMs(row);
}

function displayTimestampMs(row) {
  for (const v of [row.headerDate, row.date]) {
    const t = new Date(v).getTime();
    if (Number.isFinite(t) && t > 0) return t;
  }
  return 0;
}

function shiftIsoYear(isoStr, deltaYears) {
  const [y, m, d] = String(isoStr).split('-').map(Number);
  if (!y || !m || !d) return isoStr;
  return `${y + deltaYears}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDaysIso(isoStr, days) {
  const [y, m, d] = String(isoStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function splitDateRangeIntoSlices(sinceStr, beforeStr, sliceDays = 7) {
  const slices = [];
  const endMs = dayStartUtcMs(beforeStr);
  let cur = sinceStr;
  while (dayStartUtcMs(cur) < endMs) {
    let next = addDaysIso(cur, sliceDays);
    if (dayStartUtcMs(next) > endMs) next = beforeStr;
    const lastDay = addDaysIso(next, -1);
    slices.push({ since: cur, before: next, label: `${cur}..${lastDay}` });
    if (next === beforeStr || dayStartUtcMs(next) >= endMs) break;
    cur = next;
  }
  return slices;
}

function scanDateSpan(rows) {
  const times = rows.map(emailTimestampMs).filter((t) => t > 0);
  if (!times.length) return null;
  return {
    oldest: new Date(Math.min(...times)).toISOString().slice(0, 10),
    newest: new Date(Math.max(...times)).toISOString().slice(0, 10),
  };
}

function recentDaysForRange(sinceStr) {
  const sinceMs = imapDateFromIso(sinceStr).getTime();
  const days = Math.ceil((Date.now() - sinceMs) / (24 * 60 * 60 * 1000)) + 14;
  return Math.min(730, Math.max(7, days));
}

async function fetchRowsByUids(imap, uids, { lite = false, compactNow = true } = {}) {
  if (!uids.length) return [];
  const fetchOptions = { bodies: [''], markSeen: false };
  const messages = await fetchByUids(imap, uids, fetchOptions);
  const results = [];
  for (const item of messages) {
    const parsed = await parseEmail(item.body);
    const row = {
      uid: item.attributes.uid,
      ...parsed,
      date: item.attributes.date,
      flags: item.attributes.flags,
    };
    results.push(compactNow && lite ? compactCheckRow(row) : row);
  }
  return results;
}

function compactRows(rows, lite) {
  return lite ? rows.map((row) => compactCheckRow(row)) : rows;
}

function filterDateRangeWithYearFallback(rows, sinceStr, beforeStr) {
  let filtered = filterByDateRange(rows, sinceStr, beforeStr);
  if (filtered.length > 0) return { filtered, usedSince: sinceStr, usedBefore: beforeStr };

  const sincePrev = shiftIsoYear(sinceStr, -1);
  const beforePrev = shiftIsoYear(beforeStr, -1);
  filtered = filterByDateRange(rows, sincePrev, beforePrev);
  if (filtered.length > 0) {
    console.error(`[imap] date-range: matched using ${sincePrev} .. ${beforePrev} (previous year)`);
    return { filtered, usedSince: sincePrev, usedBefore: beforePrev };
  }
  return { filtered: [], usedSince: sinceStr, usedBefore: beforeStr };
}

function mergeRowsByUid(rows) {
  const byUid = new Map();
  for (const row of rows) {
    if (row?.uid != null) byUid.set(row.uid, row);
  }
  return [...byUid.values()];
}

// Try Yahoo IMAP SINCE+BEFORE first — only fetch headers for matching UIDs (no Jan–Jun lookback scan).
async function tryFetchDateRangeDirect(imap, { sinceStr, beforeStr, limit, offset, lite, unreadOnly }) {
  const rangeDays = rangeWidthDays(sinceStr, beforeStr);
  const shortWindow = rangeDays <= 8;
  const monthWindow = rangeDays > 8 && rangeDays <= 31;
  const searchAttempts = shortWindow
    ? [
      { unreadOnly, useImapBefore: true, label: 'since-before' },
      { unreadOnly: false, useImapBefore: true, label: 'since-before-all' },
    ]
    : monthWindow
      ? [
        { unreadOnly, useImapBefore: true, label: 'since-before' },
        { unreadOnly: false, useImapBefore: true, label: 'since-before-all' },
      ]
      : [
        { unreadOnly, useImapBefore: true, label: 'since-before' },
        { unreadOnly: false, useImapBefore: true, label: 'since-before-all' },
        { unreadOnly, useImapBefore: false, label: 'since-only' },
        { unreadOnly: false, useImapBefore: false, label: 'since-only-all' },
      ];

  try {
    let uids = [];
    for (const attempt of searchAttempts) {
      if (uids.length > 0) break;
      uids = await searchUidsLogged(
        imap,
        buildSearchCriteria({
          unreadOnly: attempt.unreadOnly,
          sinceStr,
          beforeStr: attempt.useImapBefore ? beforeStr : null,
          useImapBefore: attempt.useImapBefore,
        }),
        `direct-${sinceStr}-${attempt.label}`,
        45000,
      );
    }
    if (uids.length === 0) {
      if (shortWindow) {
        console.error(`[imap] date-range direct: 0 uid(s) for ${sinceStr}..${beforeStr} (short window)`);
        emptyDirectScanMeta(sinceStr, beforeStr);
        return [];
      }
      return null;
    }

    if (uids.length >= YAHOO_SEARCH_UID_CAP) {
      console.error(
        `[imap] date-range direct: ${uids.length} uid(s) from search`
        + ' (Yahoo may cap at ~1000 — fetching headers to verify dates)',
      );
    } else {
      console.error(`[imap] date-range direct: ${uids.length} uid(s) from SINCE+BEFORE — header fetch only`);
    }
    const allRows = [];
    for (let i = 0; i < uids.length; i += 100) {
      const batch = uids.slice(i, i + 100);
      const batchRows = await fetchHeaderRowsByUids(imap, batch);
      allRows.push(...batchRows);
    }

    let { filtered, usedSince, usedBefore } = filterDateRangeWithYearFallback(allRows, sinceStr, beforeStr);
    if (filtered.length === 0) {
      const sampleDates = sortRowsNewestFirst([...allRows]).slice(0, 5).map((row) => {
        const t = emailTimestampMs(row);
        return t > 0 ? new Date(t).toISOString().slice(0, 10) : null;
      }).filter(Boolean);
      if (shortWindow) {
        console.error(
          `[imap] date-range direct: 0 in ${sinceStr}..${beforeStr} after checking ${allRows.length} header(s)`
          + (sampleDates.length ? `; sample dates: ${sampleDates.join(', ')}` : ''),
        );
        emptyDirectScanMeta(sinceStr, beforeStr, {
          scanned: allRows.length,
          matched: 0,
          sampleDates,
        });
        return [];
      }
      console.error('[imap] date-range direct: 0 matched after JS filter; trying weekly slices / lookback');
      return null;
    }

    const span = scanDateSpan(filtered);
    const sorted = sortRowsNewestFirst(filtered);
    console.error(
      `[imap] date-range direct: scanned ${allRows.length} header(s), matched ${filtered.length}`
      + ` for ${usedSince}..${usedBefore}`,
    );
    console.error(`SCAN_META:${JSON.stringify({
      scanned: allRows.length,
      totalUids: uids.length,
      scanMode: 'direct',
      span,
      matched: filtered.length,
      wanted: { since: sinceStr, before: beforeStr },
      used: { since: usedSince, before: usedBefore },
      ...scanMetaMailboxFields(),
    })}`);
    return compactRows(sorted.slice(offset, offset + limit), lite);
  } catch (err) {
    console.error(`[imap] date-range direct failed (${err.message}); falling back to lookback`);
    return null;
  }
}

// Yahoo often returns 0 for full-month SINCE+BEFORE on older mail — search week-by-week instead.
async function tryFetchDateRangeWeeklySlices(imap, { sinceStr, beforeStr, limit, offset, lite, unreadOnly }) {
  const slices = splitDateRangeIntoSlices(sinceStr, beforeStr, 7);
  console.error(
    `[imap] date-range weekly: ${slices.length} slice(s) for ${sinceStr}..${beforeStr}`,
  );

  let allRows = [];
  let totalScanned = 0;

  for (const slice of slices) {
    const attempts = [
      { unreadOnly, label: 'since-before' },
      { unreadOnly: false, label: 'since-before-all' },
    ];
    let uids = [];
    for (const attempt of attempts) {
      if (uids.length > 0) break;
      uids = await searchUidsLogged(
        imap,
        buildSearchCriteria({
          unreadOnly: attempt.unreadOnly,
          sinceStr: slice.since,
          beforeStr: slice.before,
          useImapBefore: true,
        }),
        `weekly-${slice.since}-${attempt.label}`,
        45000,
      );
    }

    if (uids.length === 0) {
      console.error(`[imap] date-range weekly slice ${slice.label}: 0 uid(s)`);
      continue;
    }

    console.error(`[imap] date-range weekly slice ${slice.label}: ${uids.length} uid(s)`);
    for (let i = 0; i < uids.length; i += 100) {
      const batch = uids.slice(i, i + 100);
      const batchRows = await fetchHeaderRowsByUids(imap, batch);
      totalScanned += batchRows.length;
      allRows = mergeRowsByUid(allRows.concat(batchRows));
    }

    const { filtered: sliceFiltered } = filterDateRangeWithYearFallback(allRows, sinceStr, beforeStr);
    console.error(
      `[imap] date-range weekly slice ${slice.label}:`
      + ` scanned ${totalScanned}, matched ${sliceFiltered.length} in ${sinceStr}..${beforeStr}`,
    );
    if (sliceFiltered.length >= offset + limit) break;
  }

  const { filtered, usedSince, usedBefore } = filterDateRangeWithYearFallback(allRows, sinceStr, beforeStr);
  if (filtered.length === 0) {
    const sampleDates = sortRowsNewestFirst([...allRows]).slice(0, 5).map((row) => {
      const t = emailTimestampMs(row);
      return t > 0 ? new Date(t).toISOString().slice(0, 10) : null;
    }).filter(Boolean);
    console.error(
      `[imap] date-range weekly: 0 matched after ${totalScanned} header(s)`
      + (sampleDates.length ? `; sample dates: ${sampleDates.join(', ')}` : ''),
    );
    return null;
  }

  const span = scanDateSpan(filtered);
  const sorted = sortRowsNewestFirst(filtered);
  console.error(
    `[imap] date-range weekly: matched ${filtered.length} for ${usedSince}..${usedBefore}`
    + ` (${totalScanned} header(s) scanned)`,
  );
  console.error(`SCAN_META:${JSON.stringify({
    scanned: totalScanned,
    totalUids: allRows.length,
    scanMode: 'weekly_slices',
    span,
    matched: filtered.length,
    wanted: { since: sinceStr, before: beforeStr },
    used: { since: usedSince, before: usedBefore },
    ...scanMetaMailboxFields(),
  })}`);
  return compactRows(sorted.slice(offset, offset + limit), lite);
}

// Yahoo often ignores SINCE+BEFORE on older months — ON (single day) usually works.
async function tryFetchDateRangeDailyOn(imap, { sinceStr, beforeStr, limit, offset, lite }) {
  const days = eachDayInRange(sinceStr, beforeStr);
  console.error(`[imap] date-range daily ON: ${days.length} day(s) for ${sinceStr}..${beforeStr}`);

  let allRows = [];
  let totalScanned = 0;
  let daysWithMail = 0;

  for (const day of days) {
    let uids = [];
    try {
      uids = await searchUidsLogged(
        imap,
        buildOnSearchCriteria(day, false),
        `on-${day}`,
        30000,
      );
    } catch (err) {
      console.error(`[imap] date-range ON ${day} failed (${err.message}); continuing`);
      continue;
    }
    if (uids.length === 0) continue;

    daysWithMail++;
    console.error(`[imap] date-range ON ${day}: ${uids.length} uid(s)`);
    for (let i = 0; i < uids.length; i += 100) {
      const batch = uids.slice(i, i + 100);
      const batchRows = await fetchHeaderRowsByUids(imap, batch);
      totalScanned += batchRows.length;
      allRows = mergeRowsByUid(allRows.concat(batchRows));
    }

    const { filtered: running } = filterDateRangeWithYearFallback(allRows, sinceStr, beforeStr);
    if (running.length >= offset + limit) break;
  }

  const { filtered, usedSince, usedBefore } = filterDateRangeWithYearFallback(allRows, sinceStr, beforeStr);

  if (daysWithMail === 0) {
    lastDailyDaysChecked = days.length;
    console.error(
      `[imap] date-range daily ON: 0 uid(s) on all ${days.length} day(s)`
      + ` — no mail indexed for ${sinceStr}..${addDaysIso(beforeStr, -1)}`
      + ` in ${activeScanMailbox || DEFAULT_MAILBOX}`,
    );
    return null;
  }

  if (filtered.length === 0) {
    const span = scanDateSpan(allRows);
    const sampleDates = sortRowsNewestFirst([...allRows]).slice(0, 5).map((row) => {
      const t = emailTimestampMs(row);
      return t > 0 ? new Date(t).toISOString().slice(0, 10) : null;
    }).filter(Boolean);
    console.error(
      `[imap] date-range daily ON: 0 matched in ${sinceStr}..${beforeStr}`
      + ` after ${totalScanned} header(s) on ${daysWithMail} day(s)`
      + (span ? `; span ${span.oldest}..${span.newest}` : '')
      + (sampleDates.length ? `; sample: ${sampleDates.join(', ')}` : ''),
    );
    return null;
  }

  const span = scanDateSpan(filtered);
  const sorted = sortRowsNewestFirst(filtered);
  console.error(
    `[imap] date-range daily ON: matched ${filtered.length} for ${usedSince}..${usedBefore}`
    + ` (${totalScanned} header(s) on ${daysWithMail} day(s))`,
  );
  console.error(`SCAN_META:${JSON.stringify({
    scanned: totalScanned,
    totalUids: allRows.length,
    scanMode: 'daily_on',
    dailyDaysWithMail: daysWithMail,
    span,
    matched: filtered.length,
    wanted: { since: sinceStr, before: beforeStr },
    used: { since: usedSince, before: usedBefore },
    ...scanMetaMailboxFields(),
  })}`);
  return compactRows(sorted.slice(offset, offset + limit), lite);
}

// Yahoo IMAP SINCE/BEFORE is unreliable for exact ranges — scan INBOX UIDs and filter dates in JS.
async function fetchDateRangeViaRecentLookback(imap, { sinceStr, beforeStr, limit, offset, lite, unreadOnly }) {
  const days = recentDaysForRange(sinceStr);
  const rangeDays = rangeWidthDays(sinceStr, beforeStr);
  const maxOlderRanges = computeMaxOlderRanges(sinceStr, beforeStr);
  console.error(`[imap] date-range start ${sinceStr}..${beforeStr} limit=${limit} offset=${offset} lookback=${days}d maxOlderRanges=${maxOlderRanges}`);

  // NEVER search ALL on Yahoo — hangs on large mailboxes. Use relative SINCE like "fetch last 100".
  let recentUids = await searchUidsLogged(
    imap,
    buildSearchCriteria({ unreadOnly, recentTime: `${days}d` }),
    `recent-${days}d`,
  );
  if (recentUids.length === 0 && unreadOnly) {
    recentUids = await searchUidsLogged(
      imap,
      buildSearchCriteria({ unreadOnly: false, recentTime: `${days}d` }),
      `recent-${days}d-no-unread`,
    );
  }

  // For month/year ranges, run SINCE search (recent window may miss early mail).
  const runSinceSearch = recentUids.length === 0 || rangeDays <= 31 || rangeDays >= 300;
  let sinceUids = [];
  if (runSinceSearch) {
    try {
      sinceUids = await searchUidsLogged(
        imap,
        buildSearchCriteria({ unreadOnly, sinceStr, useImapBefore: false }),
        `since-${sinceStr}`,
        30000,
      );
      if (sinceUids.length === 0 && unreadOnly) {
        sinceUids = await searchUidsLogged(
          imap,
          buildSearchCriteria({ unreadOnly: false, sinceStr, useImapBefore: false }),
          `since-${sinceStr}-no-unread`,
          30000,
        );
      }
    } catch (err) {
      console.error(`[imap] date-range: since search failed (${err.message}); continuing with recent window only`);
    }
  } else {
    console.error(
      `[imap] date-range: skip since-${sinceStr} search (${recentUids.length} recent uid(s); Yahoo-safe path)`,
    );
  }

  const scanPlan = buildDateRangeScanPlan(sinceUids, recentUids, { maxOlderRanges });
  console.error(
    `[imap] date-range scan: since=${sinceUids.length} recent=${recentUids.length}`
    + ` steps=${scanPlan.length}`,
  );

  if (scanPlan.length === 0) {
    console.error(`SCAN_META:${JSON.stringify({
      scanned: 0,
      totalUids: 0,
      sinceWindow: sinceUids.length,
      recentWindow: recentUids.length,
      span: null,
      matched: 0,
      wanted: { since: sinceStr, before: beforeStr },
      used: { since: sinceStr, before: beforeStr },
      ...scanMetaMailboxFields(),
    })}`);
    return [];
  }

  const { sinceMs, beforeMs } = isoRangeToMs(sinceStr, beforeStr);
  let results = [];
  let scannedRows = 0;
  let lowestUidScanned = Infinity;

  const processBatch = async (step, batchResults) => {
    scannedRows += batchResults.length;
    for (const row of batchResults) {
      if (row?.uid != null && row.uid < lowestUidScanned) lowestUidScanned = row.uid;
    }
    results = mergeRowsByUid(results.concat(batchResults));
    const { filtered: batchFiltered } = filterDateRangeWithYearFallback(results, sinceStr, beforeStr);
    console.error(
      `[imap] date-range ${step.label}: fetched ${batchResults.length} row(s),`
      + ` total matched ${batchFiltered.length}`,
    );
    return batchFiltered;
  };

  for (const step of scanPlan) {
    let batchResults = [];
    if (step.type === 'range') {
      batchResults = await fetchHeaderRowsByUidRange(imap, step.low, step.high);
    } else {
      batchResults = await fetchHeaderRowsByUids(imap, step.values);
    }
    const batchFiltered = await processBatch(step, batchResults);

    if (step.type === 'range' && batchResults.length > 0 && batchFiltered.length < offset + limit) {
      const times = batchResults.map(emailTimestampMs).filter((t) => t > 0);
      if (times.length > 0 && batchFiltered.length > 0) {
        const newestInBatch = Math.max(...times);
        if (newestInBatch > 0 && newestInBatch < sinceMs) {
          console.error(
            `[imap] date-range: stop older scan (newest in ${step.label} is`
            + ` ${new Date(newestInBatch).toISOString().slice(0, 10)} < since ${sinceStr})`,
          );
          break;
        }
      }
    }

    if (batchFiltered.length >= offset + limit) break;
  }

  // Yahoo since/recent searches cap at ~1000 UIDs — keep walking older UID blocks until we
  // overlap the target month or hit safety limits.
  const MAX_SCAN_ROWS = 50000;
  const MAX_EXTRA_BLOCKS = 80;
  let extraBlocks = 0;
  let uidHigh = Number.isFinite(lowestUidScanned) ? lowestUidScanned - 1 : 0;
  let { filtered: runningFiltered } = filterDateRangeWithYearFallback(results, sinceStr, beforeStr);

  while (
    uidHigh > 0
    && extraBlocks < MAX_EXTRA_BLOCKS
    && scannedRows < MAX_SCAN_ROWS
    && runningFiltered.length < offset + limit
  ) {
    const uidLow = Math.max(1, uidHigh - UID_RANGE_BLOCK + 1);
    const step = { type: 'range', label: `${uidLow}:${uidHigh}` };
    console.error(
      `[imap] date-range: expand older range ${uidLow}:${uidHigh}`
      + ` (continuing below uid ${lowestUidScanned}, block ${extraBlocks + 1}/${MAX_EXTRA_BLOCKS})`,
    );
    const batchResults = await fetchHeaderRowsByUidRange(imap, uidLow, uidHigh);
    runningFiltered = await processBatch(step, batchResults);
    lowestUidScanned = uidLow;
    uidHigh = uidLow - 1;
    extraBlocks++;

    if (batchResults.length > 0 && runningFiltered.length > 0) {
      const times = batchResults.map(emailTimestampMs).filter((t) => t > 0);
      if (times.length > 0) {
        const newestInBatch = Math.max(...times);
        if (newestInBatch > 0 && newestInBatch < sinceMs) break;
      }
    }
  }

  let { filtered, usedSince, usedBefore } = filterDateRangeWithYearFallback(results, sinceStr, beforeStr);
  const span = filtered.length > 0 ? scanDateSpan(filtered) : scanDateSpan(results);

  const sampleDates = filtered.length === 0
    ? sortRowsNewestFirst([...results]).slice(0, 5).map((row) => {
      const t = emailTimestampMs(row);
      return t > 0 ? new Date(t).toISOString().slice(0, 10) : null;
    }).filter(Boolean)
    : [];

  console.error(
    `[imap] date-range lookback ${days}d: fetched ${scannedRows} row(s) in ${scanPlan.length} step(s),`
    + ` since-window ${sinceUids.length}, recent-window ${recentUids.length},`
    + ` parsed ${results.length} row(s),`
    + ` dates ${span ? `${span.oldest}..${span.newest}` : 'none'},`
    + ` matched ${filtered.length} for ${usedSince}..${usedBefore}`,
  );
  console.error(`SCAN_META:${JSON.stringify({
    scanned: scannedRows,
    totalUids: buildDateRangeScanUids(sinceUids, recentUids).length,
    scanMode: 'lookback',
    scanSteps: scanPlan.length,
    sinceWindow: sinceUids.length,
    recentWindow: recentUids.length,
    parsed: results.length,
    span,
    matched: filtered.length,
    sampleDates,
    wanted: { since: sinceStr, before: beforeStr },
    used: { since: usedSince, before: usedBefore },
    ...scanMetaMailboxFields(),
  })}`);

  const sorted = sortRowsNewestFirst(filtered);
  return compactRows(sorted.slice(offset, offset + limit), lite);
}

function filterByBeforeDate(rows, beforeStr) {
  if (!beforeStr) return rows;
  const endMs = imapDateFromIso(beforeStr).getTime();
  return rows.filter((row) => {
    const t = new Date(row.date || row.headerDate || 0).getTime();
    return Number.isFinite(t) && t < endMs;
  });
}

function sortRowsNewestFirst(rows) {
  return rows.sort((a, b) => filterTimestampMs(b) - filterTimestampMs(a));
}

// Parse relative time (e.g., "2h", "30m", "7d") to Date
function parseRelativeTime(timeStr) {
  const match = timeStr.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error('Invalid time format. Use: 30m, 2h, 7d');
  }

  const value = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case 'm': // minutes
      return new Date(now.getTime() - value * 60 * 1000);
    case 'h': // hours
      return new Date(now.getTime() - value * 60 * 60 * 1000);
    case 'd': // days
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    default:
      throw new Error('Unknown time unit');
  }
}

// Search emails with criteria
async function searchEmails(options) {
  const imap = await connect();

  try {
    const mailbox = options.mailbox || DEFAULT_MAILBOX;
    await openBox(imap, mailbox);

    const criteria = [];

    if (options.unseen && options.seen) {
      throw new Error('--unseen and --seen cannot be used together');
    }
    if (options.unseen) criteria.push('UNSEEN');
    if (options.seen) criteria.push('SEEN');
    if (options.from) criteria.push(['FROM', options.from]);
    if (options.subject) criteria.push(['SUBJECT', options.subject]);

    // Handle relative time (--recent 2h)
    if (options.recent) {
      const sinceDate = parseRelativeTime(options.recent);
      criteria.push(['SINCE', sinceDate]);
    } else {
      if (options.since) criteria.push(['SINCE', imapDateFromIso(options.since)]);
      if (options.before) criteria.push(['BEFORE', imapDateFromIso(options.before)]);
    }

    // Default to all if no criteria
    if (criteria.length === 0) criteria.push('ALL');

    const limit = parseInt(options.limit) || 20;
    const offset = parseInt(options.offset) || 0;
    const lite = !!options.lite;
    const fetchOptions = { bodies: [''], markSeen: false };

    // Default UID-slice: fast, correct when UID order matches INTERNALDATE
    // order (true for SMTP-received mail). Use --sort date for strict
    // INTERNALDATE ordering when the mailbox may contain COPY'd or
    // backdated messages; that path fetches all matching bodies.
    if (options.sort !== 'date') {
      const allUids = await searchUids(imap, criteria);
      if (allUids.length === 0) return [];
      const fetchUids = selectUidsByOffsetLimit(allUids, limit, offset);
      if (fetchUids.length === 0) return [];
      const messages = (await fetchByUids(imap, fetchUids, fetchOptions)).reverse();
      const results = [];
      for (const item of messages) {
        const parsed = await parseEmail(item.body);
        results.push(lite ? compactCheckRow({
          uid: item.attributes.uid,
          ...parsed,
          date: item.attributes.date,
          flags: item.attributes.flags,
        }) : {
          uid: item.attributes.uid,
          ...parsed,
          date: item.attributes.date,
          flags: item.attributes.flags,
        });
      }
      return results;
    }

    // --sort date: fetch all matching, sort by INTERNALDATE desc, slice.
    const messages = await searchMessages(imap, criteria, fetchOptions);
    const sortedMessages = messages.sort((a, b) => {
      const dateA = a.attributes.date ? new Date(a.attributes.date) : new Date(0);
      const dateB = b.attributes.date ? new Date(b.attributes.date) : new Date(0);
      return dateB - dateA;
    }).slice(offset, offset + limit);

    const results = [];
    for (const item of sortedMessages) {
      const parsed = await parseEmail(item.body);
      results.push(lite ? compactCheckRow({
        uid: item.attributes.uid,
        ...parsed,
        date: item.attributes.date,
        flags: item.attributes.flags,
      }) : {
        uid: item.attributes.uid,
        ...parsed,
        date: item.attributes.date,
        flags: item.attributes.flags,
      });
    }
    return results;
  } finally {
    imap.end();
  }
}

// Mark message(s) as read
async function markAsRead(uids, mailbox = DEFAULT_MAILBOX) {
  const imap = await connect();

  try {
    await openBox(imap, mailbox);

    return new Promise((resolve, reject) => {
      imap.addFlags(uids, '\\Seen', (err) => {
        if (err) reject(err);
        else resolve({ success: true, uids, action: 'marked as read' });
      });
    });
  } finally {
    imap.end();
  }
}

// Mark message(s) as unread
async function markAsUnread(uids, mailbox = DEFAULT_MAILBOX) {
  const imap = await connect();

  try {
    await openBox(imap, mailbox);

    return new Promise((resolve, reject) => {
      imap.delFlags(uids, '\\Seen', (err) => {
        if (err) reject(err);
        else resolve({ success: true, uids, action: 'marked as unread' });
      });
    });
  } finally {
    imap.end();
  }
}

// Resolve Trash mailbox name (Yahoo uses MOVE to Trash, not EXPUNGE-only)
function findTrashMailboxName(boxes, prefix = '') {
  for (const [name, info] of Object.entries(boxes)) {
    const fullName = prefix ? `${prefix}${info.delimiter}${name}` : name;
    const attribs = info.attribs || [];
    if (attribs.includes('\\Trash') || /^Trash$/i.test(name)) {
      return fullName;
    }
    if (info.children) {
      const nested = findTrashMailboxName(info.children, fullName);
      if (nested) return nested;
    }
  }
  return null;
}

function getBoxesAsync(imap) {
  return new Promise((resolve, reject) => {
    imap.getBoxes((err, boxes) => {
      if (err) reject(err);
      else resolve(boxes);
    });
  });
}

async function resolveTrashMailbox(imap) {
  const boxes = await getBoxesAsync(imap);
  return findTrashMailboxName(boxes) || 'Trash';
}

function findArchiveMailboxName(boxes, prefix = '') {
  for (const [name, info] of Object.entries(boxes)) {
    const fullName = prefix ? `${prefix}${info.delimiter}${name}` : name;
    const attribs = info.attribs || [];
    if (attribs.includes('\\Archive') || /^Archive$/i.test(name)) {
      return fullName;
    }
    if (info.children) {
      const nested = findArchiveMailboxName(info.children, fullName);
      if (nested) return nested;
    }
  }
  return null;
}

async function resolveArchiveMailbox(imap) {
  const boxes = await getBoxesAsync(imap);
  return findArchiveMailboxName(boxes) || findMailboxByName(boxes, 'Archive');
}

function findMailboxByName(boxes, targetName, prefix = '') {
  const want = String(targetName || '').trim().toLowerCase();
  if (!want) return null;
  let partial = null;
  for (const [name, info] of Object.entries(boxes)) {
    const fullName = prefix ? `${prefix}${info.delimiter}${name}` : name;
    const leaf = name.toLowerCase();
    if (leaf === want || fullName.toLowerCase() === want) return fullName;
    if (leaf.includes(want) || want.includes(leaf)) partial = partial || fullName;
    if (info.children) {
      const nested = findMailboxByName(info.children, targetName, fullName);
      if (nested) return nested;
    }
  }
  return partial;
}

async function resolveDestinationMailbox(imap, destName) {
  const boxes = await getBoxesAsync(imap);
  const resolved = findMailboxByName(boxes, destName);
  if (!resolved) {
    const names = formatMailboxTree(boxes).map((b) => b.name).slice(0, 30);
    throw new Error(
      `Folder not found: "${destName}". Available: ${names.join(', ')}${names.length >= 30 ? '…' : ''}`,
    );
  }
  return resolved;
}

// Move message(s) to a named mailbox/folder (Yahoo IMAP MOVE)
async function moveMessagesToMailbox(uids, destName, mailbox = DEFAULT_MAILBOX) {
  if (!uids || uids.length === 0) {
    throw new Error('At least one UID is required');
  }
  if (!destName) {
    throw new Error('Destination folder required: node imap.js move <uid>... --to <folder>');
  }

  const normalizedUids = uids.map((uid) => parseInt(uid, 10)).filter((uid) => !Number.isNaN(uid));
  if (normalizedUids.length === 0) {
    throw new Error('No valid UIDs provided');
  }

  const imap = await connect();

  try {
    await openBox(imap, mailbox, false);
    const destBox = await resolveDestinationMailbox(imap, destName);

    return new Promise((resolve, reject) => {
      imap.move(normalizedUids, destBox, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          success: true,
          uids: normalizedUids,
          action: 'moved_to_folder',
          destination_mailbox: destBox,
          count: normalizedUids.length,
        });
      });
    });
  } finally {
    imap.end();
  }
}

// Move message(s) to Trash (Yahoo/Gmail standard) or permanently delete with permanent=true
async function deleteMessages(uids, mailbox = DEFAULT_MAILBOX, options = {}) {
  if (!uids || uids.length === 0) {
    throw new Error('At least one UID is required');
  }

  const normalizedUids = uids.map((uid) => parseInt(uid, 10)).filter((uid) => !Number.isNaN(uid));
  if (normalizedUids.length === 0) {
    throw new Error('No valid UIDs provided');
  }

  const imap = await connect();

  try {
    await openBox(imap, mailbox, false);

    if (options.permanent) {
      return new Promise((resolve, reject) => {
        imap.addFlags(normalizedUids, '\\Deleted', (err) => {
          if (err) {
            reject(err);
            return;
          }
          imap.expunge(normalizedUids, (expungeErr) => {
            if (expungeErr) {
              reject(expungeErr);
              return;
            }
            resolve({
              success: true,
              uids: normalizedUids,
              action: 'permanently_deleted',
              count: normalizedUids.length,
            });
          });
        });
      });
    }

    const trashBox = await resolveTrashMailbox(imap);

    return new Promise((resolve, reject) => {
      imap.move(normalizedUids, trashBox, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          success: true,
          uids: normalizedUids,
          action: 'moved_to_trash',
          trash_mailbox: trashBox,
          count: normalizedUids.length,
        });
      });
    });
  } finally {
    imap.end();
  }
}

// List all mailboxes
async function listMailboxes() {
  const imap = await connect();

  try {
    return new Promise((resolve, reject) => {
      imap.getBoxes((err, boxes) => {
        if (err) reject(err);
        else resolve(formatMailboxTree(boxes));
      });
    });
  } finally {
    imap.end();
  }
}

// Format mailbox tree recursively
function formatMailboxTree(boxes, prefix = '') {
  const result = [];
  for (const [name, info] of Object.entries(boxes)) {
    const fullName = prefix ? `${prefix}${info.delimiter}${name}` : name;
    result.push({
      name: fullName,
      delimiter: info.delimiter,
      attributes: info.attribs,
    });

    if (info.children) {
      result.push(...formatMailboxTree(info.children, fullName));
    }
  }
  return result;
}

// Display accounts in a formatted table
function displayAccounts(accounts, configPath) {
  // Handle no config file case
  if (!configPath) {
    console.error('No configuration file found.');
    console.error('Run "bash setup.sh" to configure your email account.');
    process.exit(1);
  }

  // Handle no accounts case
  if (accounts.length === 0) {
    console.error(`No accounts configured in ${configPath}`);
    process.exit(0);
  }

  // Display header with config path
  console.log(`Configured accounts (from ${configPath}):\n`);

  // Calculate column widths
  const maxNameLen = Math.max(7, ...accounts.map(a => a.name.length)); // 7 = 'Account'.length
  const maxEmailLen = Math.max(5, ...accounts.map(a => a.email.length)); // 5 = 'Email'.length
  const maxImapLen = Math.max(4, ...accounts.map(a => a.imapHost.length)); // 4 = 'IMAP'.length
  const maxSmtpLen = Math.max(4, ...accounts.map(a => a.smtpHost.length)); // 4 = 'SMTP'.length

  // Table header
  const header = `  ${padRight('Account', maxNameLen)}  ${padRight('Email', maxEmailLen)}  ${padRight('IMAP', maxImapLen)}  ${padRight('SMTP', maxSmtpLen)}  Status`;
  console.log(header);

  // Separator line
  const separator = '  ' + '─'.repeat(maxNameLen) + '  ' + '─'.repeat(maxEmailLen) + '  ' + '─'.repeat(maxImapLen) + '  ' + '─'.repeat(maxSmtpLen) + '  ' + '────────────────';
  console.log(separator);

  // Table rows
  for (const account of accounts) {
    const statusIcon = account.isComplete ? '✓' : '⚠';
    const statusText = account.isComplete ? 'Complete' : 'Incomplete';
    const row = `  ${padRight(account.name, maxNameLen)}  ${padRight(account.email, maxEmailLen)}  ${padRight(account.imapHost, maxImapLen)}  ${padRight(account.smtpHost, maxSmtpLen)}  ${statusIcon} ${statusText}`;
    console.log(row);
  }

  // Footer
  console.log(`\n  ${accounts.length} account${accounts.length > 1 ? 's' : ''} total`);
}

// Helper: right-pad a string to a fixed width
function padRight(str, len) {
  return (str + ' '.repeat(len)).slice(0, len);
}

// Main CLI handler
async function main() {
  const { command, options, positional } = parseArgs();

  try {
    let result;

    switch (command) {
      case 'check':
        result = await checkEmails(
          options.mailbox || DEFAULT_MAILBOX,
          parseInt(options.limit) || 10,
          options.recent || null,
          !!options.unseen,
          parseInt(options.offset) || 0,
          !!options.lite,
          options.since || null,
          options.before || null,
        );
        break;

      case 'fetch':
        if (!positional[0]) {
          throw new Error('UID required: node imap.js fetch <uid>');
        }
        result = await fetchEmail(positional[0], options.mailbox);
        break;

      case 'download':
        if (!positional[0]) {
          throw new Error('UID required: node imap.js download <uid>');
        }
        result = await downloadAttachments(positional[0], options.mailbox, options.dir || '.', options.file || null);
        break;

      case 'search':
        result = await searchEmails(options);
        break;

      case 'mark-read':
        if (positional.length === 0) {
          throw new Error('UID(s) required: node imap.js mark-read <uid> [uid2...]');
        }
        result = await markAsRead(positional, options.mailbox);
        break;

      case 'mark-unread':
        if (positional.length === 0) {
          throw new Error('UID(s) required: node imap.js mark-unread <uid> [uid2...]');
        }
        result = await markAsUnread(positional, options.mailbox);
        break;

      case 'delete':
        if (positional.length === 0) {
          throw new Error('UID(s) required: node imap.js delete <uid> [uid2...]  (moves to Trash; add --permanent to expunge)');
        }
        result = await deleteMessages(positional, options.mailbox, {
          permanent: !!options.permanent,
        });
        break;

      case 'move':
        if (positional.length === 0) {
          throw new Error('UID(s) required: node imap.js move <uid> [uid2...] --to <folder>');
        }
        if (!options.to) {
          throw new Error('Destination folder required: --to <folder>');
        }
        result = await moveMessagesToMailbox(positional, options.to, options.mailbox);
        break;

      case 'list-mailboxes':
        result = await listMailboxes();
        break;

      case 'list-accounts':
        {
          const { listAccounts } = require('./config');
          const { accounts, configPath } = listAccounts();
          displayAccounts(accounts, configPath);
        }
        return;  // Exit early, no JSON output

      default:
        console.error('Unknown command:', command);
        console.error('Available commands: check, fetch, download, search, mark-read, mark-unread, delete, move, list-mailboxes, list-accounts');
        process.exit(1);
    }

    console.log(JSON.stringify(result ?? [], null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err.message || err);
    process.exit(1);
  });
}
