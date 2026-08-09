const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load emailFamilyIngest with its deps stubbed so the test does not touch IMAP/Continuum.
function loadModule(relPath, stub) {
  const srcPath = path.join(__dirname, '..', relPath);
  const src = fs.readFileSync(srcPath, 'utf8');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: (name) => stub[name] || require(name),
    console,
    process,
    __dirname: path.dirname(srcPath),
    __filename: srcPath,
  };
  vm.runInNewContext(src, sandbox, { filename: srcPath });
  return sandbox.module.exports;
}

const familyStub = {
  './ingest-sender-emails': {
    ingestSenderIntoMemory: async ({ sender }) => ({
      sender,
      fetched: 12,
      ingested: 3,
      uids: [100, 101, 102],
      reply: `remembered ${sender}`,
    }),
  },
  './emailCleanupFolder': {
    BUILTIN_CLEANUP_FOLDER: [
      { label: 'Min Zhang', folder: 'Min and Kids', copy: true, needles: ['min zhang', 'njsgas@gmail.com'] },
      { label: 'Daniel Cai', folder: 'Min and Kids', copy: true, needles: ['daniel cai', 'danielcai297@gmail.com'] },
      { label: 'Michael Cai', folder: 'Min and Kids', copy: true, needles: ['michael cai'] },
    ],
  },
};

const familyIngest = loadModule('integrations/continuum-bridge/emailFamilyIngest.js', familyStub);

async function run() {
  assert.strictEqual(
    familyIngest.FAMILY_MEMORY_INGEST_SENDERS.join(','),
    'Min Zhang,Daniel Cai,Michael Cai,Michelle Wang',
    'family senders come from the copy rules plus Michelle Wang',
  );

  // Michelle's IMAP search uses her email address.
  assert.strictEqual(
    familyIngest.SENDER_SEARCH_FROM['Michelle Wang'],
    'bingjing6699@gmail.com',
    'Michelle Wang searches by email',
  );

  // Every family sender has a needles filter (so junk/promos are excluded).
  assert.ok(Array.isArray(familyIngest.SENDER_NEEDLES['Min Zhang']) && familyIngest.SENDER_NEEDLES['Min Zhang'].length >= 1, 'Min Zhang has needles');
  assert.ok(familyIngest.SENDER_NEEDLES['Daniel Cai'].includes('danielcai297@gmail.com'), 'Daniel Cai needles include his email');
  assert.ok(familyIngest.SENDER_NEEDLES['Michelle Wang'].includes('bingjing6699@gmail.com'), 'Michelle needles include her email');

  assert.strictEqual(familyIngest.familyIngestEnabled(), true, 'enabled by default');
  process.env.EMAIL_FAMILY_INGEST_ENABLED = 'false';
  assert.strictEqual(familyIngest.familyIngestEnabled(), false, 'toggleable');
  delete process.env.EMAIL_FAMILY_INGEST_ENABLED;

  const results = await familyIngest.runFamilyMemoryIngest({});
  assert.strictEqual(results.length, 4, 'one result per family sender');
  for (const r of results) assert.strictEqual(r.ingested, 3);

  const summary = familyIngest.formatFamilyIngestSummary(results);
  assert.ok(summary.includes('Min Zhang'), 'summary lists Min Zhang');
  assert.ok(summary.includes('Daniel Cai'), 'summary lists Daniel Cai');
  assert.ok(summary.includes('Michael Cai'), 'summary lists Michael Cai');
  assert.ok(summary.includes('Michelle Wang'), 'summary lists Michelle Wang');
  assert.ok(summary.includes('ingested 3 new email(s)'), 'summary reports counts');

  // Error handling: a failing sender does not break others.
  const failing = await familyIngest.runFamilyMemoryIngest({
    _inject: null,
  }).catch(() => null);
  // Override stubbed ingest to throw for one sender via re-load.
  const failingStub = {
    './ingest-sender-emails': {
      ingestSenderIntoMemory: async ({ sender }) => {
        if (sender === 'Daniel Cai') throw new Error('boom');
        return { sender, fetched: 1, ingested: 1, uids: [1], reply: 'ok' };
      },
    },
    './emailCleanupFolder': familyStub['./emailCleanupFolder'],
  };
  const familyIngest2 = loadModule('integrations/continuum-bridge/emailFamilyIngest.js', failingStub);
  const results2 = await familyIngest2.runFamilyMemoryIngest({});
  const daniel = results2.find((r) => r.sender === 'Daniel Cai');
  assert.ok(daniel.error.includes('boom'), 'sender error captured');
  assert.strictEqual(results2.filter((r) => !r.error).length, 3, 'others still ingested');
  const summary2 = familyIngest2.formatFamilyIngestSummary(results2);
  assert.ok(summary2.includes('failed (boom)'), 'summary surfaces failure');

  console.log('emailFamilyIngest: all checks passed');
  return failing;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
