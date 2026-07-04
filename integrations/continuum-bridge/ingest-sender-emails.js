#!/usr/bin/env node
'use strict';

/**
 * Fetch emails from a sender via IMAP and feed them to Continuum memory via /chat.
 * Tracks processed UIDs to avoid re-ingesting.
 *
 * Usage:
 *   node ingest-sender-emails.js --from "Min Zhang" --limit 50 --recent 30d
 *   node ingest-sender-emails.js --from "Min Zhang" --all-new
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { callContinuum } = require('../../skills/continuum-brain/scripts/ask');
const { loadConfig } = require('../../skills/continuum-brain/scripts/config');
const { clampLimit } = require('./emailFetchOptions');

const REPO = process.env.CONTINUUM_MOBILE_REPO || '/tmp/continuum-mobile';
const IMAP = process.env.IMAP_SCRIPT || path.join(REPO, 'skills/@gzlicanyi/imap-smtp-email/scripts/imap.js');
const STATE_DIR = path.join(process.env.HOME || '/root', '.config/continuum-openclaw');
const DEFAULT_SENDER = process.env.EMAIL_INGEST_SENDER || 'Min Zhang';

function parseArgs(argv) {
  const opts = {
    from: DEFAULT_SENDER,
    limit: clampLimit(process.env.EMAIL_INGEST_LIMIT || '50'),
    recent: process.env.EMAIL_INGEST_RECENT || '30d',
    dryRun: false,
    allNew: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--from') opts.from = args[++i];
    else if (arg === '--limit') opts.limit = clampLimit(args[++i]);
    else if (arg === '--recent') opts.recent = args[++i];
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--all-new') opts.allNew = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node ingest-sender-emails.js [--from "Min Zhang"] [--limit 50] [--recent 30d] [--all-new] [--dry-run]`);
      process.exit(0);
    }
  }
  return opts;
}

function statePath(sender) {
  const slug = sender.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sender';
  return path.join(STATE_DIR, `ingested-uids-${slug}.json`);
}

function loadState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { uids: [] };
  }
}

function saveState(file, uids) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ uids, updated: new Date().toISOString() }, null, 2));
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatEmailsForMemory(emails, sender) {
  const lines = [
    `REAL emails from ${sender} (Yahoo IMAP). Extract durable facts, commitments, dates, and relationship context into Continuum memory.`,
    'Do NOT invent content. Skip duplicates if already known.',
    '',
  ];
  for (const msg of emails) {
    const from = msg.from?.text || msg.from || 'Unknown';
    const subject = msg.subject || '(no subject)';
    const date = msg.date || msg.headerDate || '';
    const uid = msg.uid != null ? String(msg.uid) : '';
    const body = stripHtml(msg.text || msg.snippet || msg.preview || '').slice(0, 2000);
    lines.push(`--- UID ${uid} ---`);
    lines.push(`From: ${from}`);
    lines.push(`Subject: ${subject}`);
    lines.push(`Date: ${date}`);
    if (body) lines.push(`Body: ${body}`);
    lines.push('');
  }
  return lines.join('\n').slice(0, 75000);
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

async function main() {
  const opts = parseArgs(process.argv);
  const stateFile = statePath(opts.from);
  const state = loadState(stateFile);
  const seen = new Set((state.uids || []).map(Number));

  console.log(`Searching Yahoo for FROM "${opts.from}" limit=${opts.limit} recent=${opts.recent}`);
  const all = runImapSearch(opts.from, opts.limit, opts.recent);
  if (!Array.isArray(all) || all.length === 0) {
    console.log('No matching emails found.');
    return;
  }

  const batch = opts.allNew
    ? all.filter((m) => m.uid != null && !seen.has(Number(m.uid)))
    : all;

  if (batch.length === 0) {
    console.log(`All ${all.length} fetched email(s) already ingested.`);
    return;
  }

  console.log(`Ingesting ${batch.length} email(s) (${seen.size} previously ingested).`);
  if (opts.dryRun) {
    for (const m of batch) console.log(`- UID ${m.uid}: ${m.subject}`);
    return;
  }

  const config = loadConfig();
  const emailBlock = formatEmailsForMemory(batch, opts.from);
  const prompt = [
    emailBlock,
    '',
    '---',
    `Summarize key facts from these ${opts.from} emails and ensure important commitments, dates, and project details are captured in memory.`,
    'Reply with a short confirmation of what was remembered (names, dates, action items).',
  ].join('\n');

  const result = await callContinuum(prompt, config, {
    channel: 'email',
    sender: opts.from,
    clientTime: new Date().toLocaleString(),
  });

  const newUids = batch.map((m) => Number(m.uid)).filter(Number.isFinite);
  saveState(stateFile, [...new Set([...(state.uids || []), ...newUids])]);

  console.log('\n[Continuum memory ingest complete]');
  console.log(result.reply);
  console.log(`\nMarked ${newUids.length} UID(s) as ingested in ${stateFile}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
