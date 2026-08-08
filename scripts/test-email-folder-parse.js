const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.join(__dirname, '../integrations/continuum-bridge/emailFolderParse.js');
const src = fs.readFileSync(srcPath, 'utf8');
const sandbox = { module: { exports: {} }, exports: {}, require, console, process };
vm.runInNewContext(src, sandbox, { filename: srcPath });
const { parseMailboxFromMessage } = sandbox.module.exports;

assert.strictEqual(parseMailboxFromMessage('read every email from Min in Min folder'), 'Min and Kids');
assert.strictEqual(parseMailboxFromMessage('read every email from Min in Min and Kids folder'), 'Min and Kids');
assert.strictEqual(parseMailboxFromMessage('copy all emails in Min and Kids folder to inbox'), 'Min and Kids');
assert.strictEqual(parseMailboxFromMessage('scan the Min folder for persona'), 'Min and Kids');
assert.strictEqual(parseMailboxFromMessage('what is the weather today'), null);

console.log('emailFolderParse: all checks passed');
