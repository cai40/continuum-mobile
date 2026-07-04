#!/usr/bin/env node
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { maybeAutoTrashJunk } = require('./emailDelete');

const REPO = process.env.CONTINUUM_MOBILE_REPO || '/tmp/continuum-mobile';
const IMAP = process.env.IMAP_SCRIPT || path.join(REPO, 'skills/@gzlicanyi/imap-smtp-email/scripts/imap.js');
const LIMIT = String(process.env.AUTO_TRASH_LIMIT || '100');
const RECENT = process.env.AUTO_TRASH_RECENT || '7d';

async function main() {
  const skillRoot = path.dirname(path.dirname(IMAP));
  const stdout = execFileSync('node', [IMAP, 'check', '--limit', LIMIT, '--recent', RECENT], {
    cwd: skillRoot,
    env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
    maxBuffer: 16 * 1024 * 1024,
  });
  const messages = JSON.parse(stdout.toString());
  const result = await maybeAutoTrashJunk(messages, IMAP, { enabled: true, includeGithub: false });
  if (result.executed) {
    console.log(result.summary);
  } else if (result.error) {
    console.error(result.error);
    process.exit(1);
  } else {
    console.log('No junk/newsletter matches in fetched slice.');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
