const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.join(__dirname, '../integrations/continuum-bridge/emailCleanupFolder.js');
const noopMove = require.resolve('./shims/noop-move.js');
const src = fs.readFileSync(srcPath, 'utf8')
  .replace(/require\('\.\/emailMove'\)/g, `require(${JSON.stringify(noopMove)})`);
const sandbox = { module: { exports: {} }, exports: {}, require, console, process };
vm.runInNewContext(src, sandbox, { filename: srcPath });
const {
  BUILTIN_CLEANUP_FOLDER,
  matchCleanupFolderRule,
  resolveCleanupFolderGroups,
} = sandbox.module.exports;

// All built-in rules must target the renamed folder.
const folders = [...new Set(BUILTIN_CLEANUP_FOLDER.map((r) => r.folder))].join(',');
assert.strictEqual(folders, 'Min and Kids', 'all rules must copy to "Min and Kids"');

// Labels cover Min Zhang plus the two kids.
const labels = BUILTIN_CLEANUP_FOLDER.map((r) => r.label).join(',');
assert.strictEqual(labels, 'Min Zhang,Daniel Cai,Michael Cai');

// Min Zhang still matches.
assert.strictEqual(matchCleanupFolderRule({ from: 'Min Zhang <njsgas@gmail.com>', subject: 'dinner' })?.folder, 'Min and Kids');

// Daniel Cai by name.
assert.strictEqual(matchCleanupFolderRule({ from: 'Daniel Cai <daniel@example.com>', subject: 'hi mom' })?.folder, 'Min and Kids');

// Daniel Cai by exact email address.
assert.strictEqual(matchCleanupFolderRule({ from: 'Daniel Cai <danielcai297@gmail.com>', subject: 'lunch' })?.label, 'Daniel Cai');
assert.strictEqual(matchCleanupFolderRule({ from: 'Daniel <danielcai297@gmail.com>', subject: 'hi' })?.label, 'Daniel Cai');

// Michael Cai by name.
assert.strictEqual(matchCleanupFolderRule({ from: 'Michael Cai <mike@example.com>', subject: 'baseball' })?.folder, 'Min and Kids');

// Abbreviated display name form ("Michael C <...>") matches too.
assert.strictEqual(matchCleanupFolderRule({ from: 'Michael C <michael@example.com>' })?.label, 'Michael Cai');

// Non-family mail does not match any cleanup-folder rule.
assert.strictEqual(matchCleanupFolderRule({ from: 'Netflix <info@netflix.com>', subject: 'new season' }), null);

// Grouping: matching UIDs grouped under the single folder.
const groups = resolveCleanupFolderGroups([
  { uid: 1, from: 'Min Zhang <njsgas@gmail.com>' },
  { uid: 2, from: 'Daniel Cai <daniel@example.com>' },
  { uid: 3, from: 'Michael Cai <michael@example.com>' },
  { uid: 4, from: 'Someone Else <x@y.com>' },
]);
assert.strictEqual(groups.length, 1);
assert.strictEqual(groups[0].rule.folder, 'Min and Kids');
assert.strictEqual(groups[0].uids.map(String).join(','), '1,2,3');

console.log('emailCleanupFolder: all checks passed');
