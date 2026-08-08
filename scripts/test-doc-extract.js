const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

// Simulate Metro's stream -> shims/stream.js mapping (see metro.config.js) so
// the test exercises the same runtime composition React Native will bundle.
const shimPath = path.join(__dirname, '../shims/stream.js');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'stream') return require(shimPath);
  return originalLoad.apply(this, arguments);
};

const srcPath = path.join(__dirname, '../src/utils/docTextExtract.js');
let src = fs.readFileSync(srcPath, 'utf8');
src = src.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g, 'const { $1 } = require("$2");');
src = src.replace(/import\s+(\w+)\s+from\s*'([^']+)';/g, 'const $1 = require("$2");');
src = src.replace(/export\s+async\s+function\s+(\w+)/g, 'async function $1');
src += '\nmodule.exports = { extractDocTextFromBase64 };\n';

const sandbox = { module: { exports: {} }, exports: {}, require, console, process, global };
vm.runInNewContext(src, sandbox, { filename: srcPath });
const { extractDocTextFromBase64 } = sandbox.module.exports;

const fixturesDir = path.join(__dirname, 'fixtures');

const FIXTURE_URLS = {
  'test01.doc': 'https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test01.doc',
  'test04.doc': 'https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test04.doc',
  'test06.doc': 'https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test06.doc',
  'test09.doc': 'https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test09.doc',
  'bigfile-01.doc': 'https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/bigfile-01.doc',
  'badfile-01-bad-header.doc': 'https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/badfile-01-bad-header.doc',
};

async function ensureFixture(name) {
  const dest = path.join(fixturesDir, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(fixturesDir, { recursive: true });
  const res = await fetch(FIXTURE_URLS[name]);
  if (!res.ok) throw new Error(`Failed to fetch fixture ${name}: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function loadBase64(name) {
  return fs.readFileSync(path.join(fixturesDir, name)).toString('base64');
}

async function run() {
  for (const name of Object.keys(FIXTURE_URLS)) {
    await ensureFixture(name);
  }

  for (const name of ['test01.doc', 'test04.doc', 'test06.doc', 'test09.doc', 'bigfile-01.doc']) {
    const text = await extractDocTextFromBase64(loadBase64(name));
    console.log(`=== ${name} (${text.length} chars) ===`);
    console.log(text.slice(0, 300).replace(/\n/g, '\\n\n'));
    assert.ok(text.trim(), `${name} should extract non-empty text`);
  }

  // base64 with embedded newlines (Android readAsStringAsync quirk)
  const withNewlines = loadBase64('test01.doc').replace(/.{48}/g, '$&\n');
  const text = await extractDocTextFromBase64(withNewlines);
  assert.ok(text.trim(), 'base64 with newlines should still extract');

  // Corrupt/invalid doc -> friendly error
  await assert.rejects(
    () => extractDocTextFromBase64(fs.readFileSync(path.join(fixturesDir, 'badfile-01-bad-header.doc')).toString('base64')),
    /Could not read this Word file|does not look like a valid Word/,
  );

  // Random binary that is not a doc -> friendly error
  await assert.rejects(
    () => extractDocTextFromBase64(Buffer.from('this is definitely not a word doc file at all').toString('base64')),
    /Could not read this Word file|does not look like a valid Word/,
  );

  console.log('docTextExtract: all checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
