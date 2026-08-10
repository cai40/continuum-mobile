const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

// Load zillowFeed.js with stubs for IMAP + Continuum.
const srcPath = path.join(__dirname, '../integrations/continuum-bridge/zillowFeed.js');
const src = fs.readFileSync(srcPath, 'utf8');

const scriptCalls = [];
const fakeExecFileSync = (script, args, opts) => {
  scriptCalls.push({ script, args });
  return JSON.stringify([
    { uid: 501, from: { text: 'Zillow Rental Manager <rental-manager@zillow.com>' }, subject: 'New application for Maple St', date: '2026-08-08T10:00:00Z', snippet: 'An applicant applied to your property' },
    { uid: 502, from: { text: 'Zillow <no-reply@zillow.com>' }, subject: 'Lease signed', date: '2026-08-08T11:00:00Z', snippet: 'Your tenant signed the lease' },
    { uid: 503, from: { text: 'Amazon <no-reply@amazon.com>' }, subject: 'Your order shipped', date: '2026-08-08T12:00:00Z', snippet: 'order' },
  ]);
};

const ingested = [];
const sandbox = {
  module: { exports: {} },
  exports: {},
  require: (name) => {
    if (name === 'child_process') {
      return { execFileSync: (script, args, opts) => fakeExecFileSync(script, args, opts) };
    }
    if (name === '../../skills/continuum-brain/scripts/ask') {
      return {
        callContinuum: async (prompt) => {
          ingested.push(prompt);
          return { reply: 'ok' };
        },
      };
    }
    if (name === '../../skills/continuum-brain/scripts/config') {
      return { loadConfig: () => ({ apiUrl: 'http://x', accessToken: 't' }) };
    }
    return Module.createRequire(srcPath)(name);
  },
  console,
  process: {
    env: { ...process.env, ZILLOW_STATE_DIR: path.join(__dirname, 'fixtures', 'zillow-state') },
  },
  __dirname: path.dirname(srcPath),
  __filename: srcPath,
};
vm.runInNewContext(src, sandbox, { filename: srcPath });
const zillow = sandbox.module.exports;

function resetState() {
  try { fs.rmSync(path.join(__dirname, 'fixtures', 'zillow-state'), { recursive: true, force: true }); } catch { /* ignore */ }
}

async function run() {
  resetState();

  // isZillowEmail only matches Zillow senders.
  assert.strictEqual(zillow.isZillowEmail({ from: { text: 'Zillow <no-reply@zillow.com>' }, subject: 'x' }), true);
  assert.strictEqual(zillow.isZillowEmail({ from: { text: 'Amazon <no-reply@amazon.com>' }, subject: 'x' }), false);

  // classify.
  assert.strictEqual(zillow.classifyZillowEmail({ subject: 'New application' }, 'applied'), 'application');
  assert.strictEqual(zillow.classifyZillowEmail({ subject: 'Lease signed' }, ''), 'lease');
  assert.strictEqual(zillow.classifyZillowEmail({ subject: 'Payment received' }, ''), 'payment');

  // sync: only 2 Zillow emails matched (Amazon excluded); both ingested.
  const result = await zillow.syncZillowEmails({});
  assert.strictEqual(result.fetched, 2, '2 Zillow emails matched (Amazon excluded)');
  assert.strictEqual(result.ingested, 2, 'both new Zillow emails ingested');
  assert.strictEqual(result.uids.length, 2);
  assert.ok(ingested.some((p) => /ZILLOW RENTAL MANAGER APPLICATION EMAIL/.test(p)), 'application prompt sent');
  assert.ok(ingested.some((p) => /ZILLOW RENTAL MANAGER LEASE EMAIL/.test(p)), 'lease prompt sent');

  // Second sync: nothing new (dedup works).
  const again = await zillow.syncZillowEmails({});
  assert.strictEqual(again.ingested, 0, 'dedup: nothing new on second run');

  console.log('zillowFeed: all checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
