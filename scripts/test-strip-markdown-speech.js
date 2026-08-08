const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.join(__dirname, '../src/utils/stripMarkdownForSpeech.js');
const src = fs.readFileSync(srcPath, 'utf8')
  .replace(/export\s*\{[^}]+\};?/g, 'module.exports = { stripMarkdownForSpeech };');
const sandbox = { module: { exports: {} }, exports: {} };
vm.runInNewContext(src, sandbox);
const { stripMarkdownForSpeech } = sandbox.module.exports;

function check(input, expected) {
  const got = stripMarkdownForSpeech(input);
  assert.strictEqual(got, expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}

check('Hello **world**', 'Hello world');
check('This is *italic* text', 'This is italic text');
check('***bold italic***', 'bold italic');
check('Use `code` here', 'Use code here');
check('## Heading\n\nNext', 'Heading\n\nNext');
check('- item one\n- item two', 'item one\nitem two');
check('1. first\n2. second', 'first\nsecond');
check('[Click](https://example.com)', 'Click');
check('![Alt](https://example.com/a.png)', 'Alt');
check('| A | B |\n| --- | --- |\n| 1 | 2 |', 'A, B\n\n1, 2');
check('She said * hello', 'She said hello');
check('Score: **12** *points*', 'Score: 12 points');
check('```js\nconst x = 1;\n```', 'const x = 1;');
check('***', '');
check(null, '');

console.log('stripMarkdownForSpeech: all checks passed');
