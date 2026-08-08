const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

// Simulate Metro's stream -> shims/stream.js mapping.
const shimPath = path.join(__dirname, '../shims/stream.js');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'stream') return require(shimPath);
  return originalLoad.apply(this, arguments);
};

async function run() {
  // Simulate Hermes: no native global Buffer.
  const savedBuffer = global.Buffer;
  delete global.Buffer;

  try {
    const srcPath = path.join(__dirname, '../src/utils/docTextExtract.js');
    let src = fs.readFileSync(srcPath, 'utf8');
    src = src.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g, 'const { $1 } = require("$2");');
    src = src.replace(/import\s+(\w+)\s+from\s*'([^']+)';/g, 'const $1 = require("$2");');
    src = src.replace(/export\s+async\s+function\s+(\w+)/g, 'async function $1');
    src += '\nmodule.exports = { extractDocTextFromBase64 };\n';

    const sandbox = { module: { exports: {} }, exports: {}, require, console, process, global };
    vm.runInNewContext(src, sandbox, { filename: srcPath });

    if (typeof global.Buffer === 'undefined') {
      throw new Error('guard did not set global.Buffer');
    }

    const { extractDocTextFromBase64 } = sandbox.module.exports;
    const fixturePath = path.join(__dirname, 'fixtures', 'test09.doc');
    if (!fs.existsSync(fixturePath)) {
      fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
      const res = await fetch('https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test09.doc');
      if (!res.ok) throw new Error(`fixture fetch failed: HTTP ${res.status}`);
      fs.writeFileSync(fixturePath, Buffer.from(await res.arrayBuffer()));
    }
    const fixture = fs.readFileSync(fixturePath);
    const text = await extractDocTextFromBase64(fixture.toString('base64'));
    if (!text.trim()) throw new Error('no text extracted');
    console.log('global Buffer guard: OK ->', JSON.stringify(text.slice(0, 40)));
  } finally {
    global.Buffer = savedBuffer;
  }
}

run().catch((e) => {
  global.Buffer = savedBuffer;
  console.error('FAIL', e);
  process.exit(1);
});
