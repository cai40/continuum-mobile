'use strict';

/**
 * Zillow Rental Manager feed for Continuum.
 *
 * Zillow has no public API for individual landlords, but it emails the
 * landlord about every important event: new rental inquiries, tenant
 * applications, screening reports, lease signatures, rent payments, and
 * listing digests. This module watches the inbox for those emails, extracts
 * the relevant facts, and feeds them into Continuum memory.
 *
 * Reuses the IMAP skill (search by FROM) and the memory /chat ingest. Tracks
 * processed UIDs on persistent disk so redeploys don't re-ingest everything.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { callContinuum } = require('../../skills/continuum-brain/scripts/ask');
const { loadConfig } = require('../../skills/continuum-brain/scripts/config');

const REPO = process.env.CONTINUUM_MOBILE_REPO || '/tmp/continuum-mobile';
const IMAP = process.env.IMAP_SCRIPT || path.join(REPO, 'skills/@gzlicanyi/imap-smtp-email/scripts/imap.js');
const STATE_DIR = process.env.ZILLOW_STATE_DIR
  || (process.env.RENDER
    ? path.join('/opt/render/project/src', '.continuum-bridge-data')
    : path.join(process.env.HOME || '/root', '.config/continuum-openclaw'));

const ZILLOW_SENDERS = [
  'zillow.com',
  'rental-manager@zillow.com',
  'no-reply@zillow.com',
  'zillow@',
];

const DEFAULT_LIMIT = 100;
const DEFAULT_RECENT = '3650d';

function stateFile() {
  return path.join(STATE_DIR, 'zillow-ingested-uids.json');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { uids: [] };
  }
}

function saveState(uids) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(stateFile(), JSON.stringify({ uids, updated: new Date().toISOString() }, null, 2));
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isZillowEmail(msg) {
  const from = String(msg?.from?.text || msg?.from || msg?.fromAddress || '');
  const subject = String(msg?.subject || '');
  const lower = `${from} ${subject}`.toLowerCase();
  return ZILLOW_SENDERS.some((needle) => lower.includes(needle));
}

/** Classify the Zillow email type from subject + body keywords. */
function classifyZillowEmail(msg, body) {
  const blob = `${msg.subject || ''} ${body || ''}`.toLowerCase();
  if (/\b(application|applied|applicant)\b/i.test(blob)) return 'application';
  if (/\b(screening|credit|background|tenant screening)\b/i.test(blob)) return 'screening';
  if (/\b(lease signed|lease executed|sign(?:ed|ature)|e-?sign)\b/i.test(blob)) return 'lease';
  if (/\b(payment|paid|rent received|charge|payout|receipt)\b/i.test(blob)) return 'payment';
  if (/\b(inquir|message|question|contact|showing|tour)\b/i.test(blob)) return 'inquiry';
  if (/\b(listing|property|view(s)?|digest|update)\b/i.test(blob)) return 'listing';
  return 'other';
}

function formatZillowEmailForMemory(msg, body) {
  const kind = classifyZillowEmail(msg, body);
  return [
    `ZILLOW RENTAL MANAGER ${kind.toUpperCase()} EMAIL`,
    `From: ${msg.from?.text || msg.from || 'Unknown'}`,
    `Subject: ${msg.subject || '(no subject)'}`,
    `Date: ${msg.date || msg.headerDate || ''}`,
    '',
    (body || '').slice(0, 3000),
    '',
    '---',
    `Extract any durable facts from this Zillow Rental Manager email: the property/listing involved, applicant or tenant names, rent amounts, dates, application/screening status, lease or payment details. Store them in Continuum memory as structured facts. Reply with a short confirmation of what was remembered.`,
  ].join('\n');
}

function runImapSearch(from, limit, recent) {
  const skillRoot = path.dirname(path.dirname(IMAP));
  const args = [IMAP, 'search', '--from', from, '--limit', String(limit), '--recent', recent, '--sort', 'date'];
  const stdout = execFileSync('node', args, {
    cwd: skillRoot,
    env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout.toString());
}

/**
 * Fetch new Zillow Rental Manager emails and feed them into memory.
 * Returns { fetched, matched, ingested, uids, errors }.
 */
async function syncZillowEmails({ limit = DEFAULT_LIMIT, recent = DEFAULT_RECENT, dryRun = false, onLog = null } = {}) {
  const log = onLog || ((line) => console.log(line));
  const state = loadState();
  const seen = new Set((state.uids || []).map(Number));

  let matched = [];
  for (const sender of ZILLOW_SENDERS) {
    try {
      log(`Searching Yahoo for Zillow FROM "${sender}" limit=${limit} recent=${recent}`);
      const rows = runImapSearch(sender, limit, recent);
      if (Array.isArray(rows)) {
        const zillowRows = rows.filter(isZillowEmail);
        matched = matched.concat(zillowRows);
        log(`  -> ${zillowRows.length} Zillow email(s)`);
      }
    } catch (err) {
      log(`  search ${sender} failed: ${err.message || err}`);
    }
  }

  // Dedupe by UID.
  const byUid = new Map();
  for (const row of matched) {
    if (row.uid != null) byUid.set(Number(row.uid), row);
  }
  const all = [...byUid.values()];
  const batch = all.filter((m) => !seen.has(Number(m.uid)));

  log(`Found ${all.length} Zillow email(s); ${batch.length} new.`);

  if (batch.length === 0 || dryRun) {
    return { fetched: all.length, matched: all.length, ingested: 0, uids: [], dryRun };
  }

  const config = loadConfig();
  const newUids = [];
  const errors = [];

  for (const msg of batch) {
    try {
      const body = stripHtml(msg.text || msg.snippet || msg.preview || '');
      const prompt = formatZillowEmailForMemory(msg, body);
      await callContinuum(prompt, config, {
        channel: 'email',
        sender: 'Zillow Rental Manager',
        clientTime: new Date().toLocaleString(),
      });
      newUids.push(Number(msg.uid));
      log(`  ingested UID ${msg.uid}: ${msg.subject}`);
    } catch (err) {
      errors.push(`UID ${msg.uid}: ${err.message || err}`);
    }
  }

  if (newUids.length) {
    saveState([...new Set([...(state.uids || []), ...newUids])]);
  }

  return { fetched: all.length, matched: all.length, ingested: newUids.length, uids: newUids, errors };
}

module.exports = {
  syncZillowEmails,
  isZillowEmail,
  classifyZillowEmail,
  stripHtml,
};
