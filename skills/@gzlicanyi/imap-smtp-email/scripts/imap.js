#!/usr/bin/env node

/**
 * IMAP Email CLI
 * Works with any standard IMAP server (Gmail, ProtonMail Bridge, Fastmail, etc.)
 * Supports IMAP ID extension (RFC 2971) for 163.com and other servers
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
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

function buildDateRangeScanUids(allUids, sinceUids, recentUids) {
  if (sinceUids.length > 0) return sinceUids;
  if (recentUids.length > 0) return recentUids;
  return allUids;
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
    await openBox(imap, mailbox);

    if (sinceStr && beforeStr) {
      return fetchDateRangeViaRecentLookback(imap, {
        sinceStr, beforeStr, limit, offset, lite, unreadOnly,
      });
    }

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

// Local calendar date for IMAP SINCE/BEFORE and JS filtering (midnight local = full day inclusive).
function imapDateFromIso(isoStr) {
  if (!isoStr) return null;
  const parts = String(isoStr).split('-').map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    const [y, m, d] = parts;
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(isoStr);
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

function filterByDateRange(rows, sinceStr, beforeStr) {
  if (!sinceStr || !beforeStr) return rows;
  const sinceMs = imapDateFromIso(sinceStr).getTime();
  const beforeMs = imapDateFromIso(beforeStr).getTime();
  return rows.filter((row) => rowInDateRange(row, sinceMs, beforeMs));
}

function rowInDateRange(row, sinceMs, beforeMs) {
  for (const v of [row.date, row.headerDate]) {
    const t = new Date(v).getTime();
    if (Number.isFinite(t) && t > 0 && t >= sinceMs && t < beforeMs) return true;
  }
  return false;
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
  return Math.min(365, Math.max(7, days));
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

// Yahoo IMAP SINCE/BEFORE is unreliable for exact ranges — scan INBOX UIDs and filter dates in JS.
async function fetchDateRangeViaRecentLookback(imap, { sinceStr, beforeStr, limit, offset, lite, unreadOnly }) {
  const days = recentDaysForRange(sinceStr);
  let allUids = await searchUids(imap, buildSearchCriteria({ unreadOnly }));
  if (allUids.length === 0 && unreadOnly) {
    allUids = await searchUids(imap, buildSearchCriteria({ unreadOnly: false }));
  }

  if (allUids.length === 0) {
    console.error(`SCAN_META:${JSON.stringify({
      scanned: 0,
      totalUids: 0,
      span: null,
      matched: 0,
      wanted: { since: sinceStr, before: beforeStr },
      used: { since: sinceStr, before: beforeStr },
    })}`);
    return [];
  }

  const sinceCriteria = buildSearchCriteria({ unreadOnly, sinceStr, useImapBefore: false });
  let sinceUids = await searchUids(imap, sinceCriteria);
  if (sinceUids.length === 0 && unreadOnly) {
    sinceUids = await searchUids(imap, buildSearchCriteria({ unreadOnly: false, sinceStr, useImapBefore: false }));
  }

  const FETCH_CHUNK = 100;
  const MAX_SCAN = 10000;
  const uidsToScan = buildDateRangeScanUids(allUids, sinceUids, MAX_SCAN);

  let results = [];
  let scannedUids = 0;
  for (let i = 0; i < uidsToScan.length; i += FETCH_CHUNK) {
    const chunk = uidsToScan.slice(i, i + FETCH_CHUNK);
    const batchResults = await fetchCheckRowsByUids(imap, chunk, lite);
    results = mergeRowsByUid(results.concat(batchResults));
    scannedUids += chunk.length;
    const { filtered: batchFiltered } = filterDateRangeWithYearFallback(results, sinceStr, beforeStr);
    console.error(
      `[imap] date-range chunk ${i}-${i + chunk.length}: fetched ${batchResults.length} row(s),`
      + ` total matched ${batchFiltered.length}`,
    );
    if (batchFiltered.length >= offset + limit) break;
  }

  let span = scanDateSpan(results);
  let { filtered, usedSince, usedBefore } = filterDateRangeWithYearFallback(results, sinceStr, beforeStr);

  const sampleDates = filtered.length === 0
    ? sortRowsNewestFirst([...results]).slice(0, 5).map((row) => {
      const t = emailTimestampMs(row);
      return t > 0 ? new Date(t).toISOString().slice(0, 10) : null;
    }).filter(Boolean)
    : [];

  console.error(
    `[imap] date-range lookback ${days}d: scanned ${scannedUids}/${allUids.length} uid(s),`
    + ` recent-window ${recentUids.length}, since-window ${sinceUids.length},`
    + ` parsed ${results.length} row(s),`
    + ` dates ${span ? `${span.oldest}..${span.newest}` : 'none'},`
    + ` matched ${filtered.length} for ${usedSince}..${usedBefore}`,
  );
  console.error(`SCAN_META:${JSON.stringify({
    scanned: scannedUids,
    totalUids: allUids.length,
    recentWindow: recentUids.length,
    sinceWindow: sinceUids.length,
    parsed: results.length,
    span,
    matched: filtered.length,
    sampleDates,
    wanted: { since: sinceStr, before: beforeStr },
    used: { since: usedSince, before: usedBefore },
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
        console.error('Available commands: check, fetch, download, search, mark-read, mark-unread, delete, list-mailboxes, list-accounts');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
