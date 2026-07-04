#!/usr/bin/env node
'use strict';

/**
 * CLI: classify emails from imap.js check JSON on stdin or file
 * Usage:
 *   node scripts/imap.js check --limit 50 --recent 7d | node scripts/triage.js
 *   node scripts/triage.js --select-junk --json
 */

const fs = require('fs');
const {
  triageMessages,
  selectJunkUids,
  formatTriageReport,
} = require('./classifier');

function readInput() {
  if (process.argv.includes('--file')) {
    const idx = process.argv.indexOf('--file');
    const path = process.argv[idx + 1];
    return fs.readFileSync(path, 'utf8');
  }
  return fs.readFileSync(0, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const selectJunk = args.includes('--select-junk');
  const noGithub = args.includes('--no-github');

  let raw = readInput().trim();
  if (!raw) {
    console.error('No input. Pipe imap check JSON: node imap.js check --limit 20 | node triage.js');
    process.exit(1);
  }

  let messages;
  try {
    messages = JSON.parse(raw);
  } catch (err) {
    console.error('Invalid JSON input:', err.message);
    process.exit(1);
  }

  if (!Array.isArray(messages)) {
    console.error('Expected JSON array of emails from imap.js check');
    process.exit(1);
  }

  const triaged = triageMessages(messages);

  if (selectJunk) {
    const { uids, triaged: full } = selectJunkUids(messages, { includeGithub: !noGithub });
    if (asJson) {
      console.log(JSON.stringify({ uids, triaged: full, count: uids.length }, null, 2));
    } else {
      console.log(formatTriageReport(full));
      console.log('\nSelected junk UIDs:', uids.join(', ') || '(none)');
    }
    return;
  }

  if (asJson) {
    console.log(JSON.stringify({ triaged, count: triaged.length }, null, 2));
  } else {
    console.log(formatTriageReport(triaged));
  }
}

main();
