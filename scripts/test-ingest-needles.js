const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

// Load ingest-sender-emails.js with stubs so we can test the needles filter.
const srcPath = path.join(__dirname, '../integrations/continuum-bridge/ingest-sender-emails.js');
const src = fs.readFileSync(srcPath, 'utf8');

const scriptCalls = [];
const fakeExecFileSync = (script, args, opts) => {
  scriptCalls.push({ script, args, opts });
  // Return a mix: real family mail + junk/promo that loosely matched the search.
  return JSON.stringify([
    { uid: 1, from: { text: 'Min Zhang <njsgas@gmail.com>' }, subject: 'Dinner plans', date: '2026-08-01' },
    { uid: 2, from: { text: 'Min Zhang <njsgas@gmail.com>' }, subject: 'Family update', date: '2026-08-02' },
    { uid: 3, from: { text: 'Newsletter <news@promo.com>' }, subject: 'Min Zhang promo', date: '2026-08-03' },
    { uid: 4, from: { text: 'Ads <ads@market.com>' }, subject: '50% off', date: '2026-08-04' },
  ]);
};

const sandbox = {
  module: { exports: {} },
  exports: {},
  require: (name) => {
    if (name === 'child_process') {
      return { execFileSync: (script, args, opts) => fakeExecFileSync(script, args, opts) };
    }
    if (name === '../../skills/continuum-brain/scripts/ask') {
      return { callContinuum: async () => ({ reply: 'ok' }) };
    }
    if (name === '../../skills/continuum-brain/scripts/config') {
      return { loadConfig: () => ({ apiUrl: 'http://x', accessToken: 't' }) };
    }
    if (name === './emailFetchOptions') {
      return { clampLimit: (v) => parseInt(v, 10) || 50 };
    }
    return Module.createRequire(srcPath)(name);
  },
  console,
  process: {
    env: { ...process.env, EMAIL_INGEST_STATE_DIR: path.join(__dirname, 'fixtures', 'ingest-state') },
  },
  __dirname: path.dirname(srcPath),
  __filename: srcPath,
};
vm.runInNewContext(src, sandbox, { filename: srcPath });
const ingest = sandbox.module.exports;

function resetState() {
  try { fs.rmSync(path.join(__dirname, 'fixtures', 'ingest-state'), { recursive: true, force: true }); } catch { /* ignore */ }
}

async function run() {
  resetState();

  // With needles, junk/promo mail is filtered out and only family mail ingested.
  const result = await ingest.ingestSenderIntoMemory({
    sender: 'Min Zhang',
    searchFrom: 'Min Zhang',
    needles: ['min zhang', 'njsgas@gmail.com'],
    limit: 50,
    recent: '3650d',
    allNew: true,
  });
  assert.strictEqual(result.ingested, 2, 'only family emails ingested (2 of 4)');
  assert.strictEqual(result.uids.length, 2, 'two UIDs marked');
  assert.ok(result.uids.includes(1) && result.uids.includes(2), 'family UIDs kept');
  assert.ok(!result.uids.includes(3) && !result.uids.includes(4), 'junk/promo UIDs excluded');

  resetState();

  // Without needles, everything is ingested (backwards-compatible behavior).
  const allResult = await ingest.ingestSenderIntoMemory({
    sender: 'Min Zhang',
    searchFrom: 'Min Zhang',
    limit: 50,
    recent: '3650d',
    allNew: true,
  });
  assert.strictEqual(allResult.ingested, 4, 'no needles -> all ingested');

  console.log('ingestSenderIntoMemory needles filter: all checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
