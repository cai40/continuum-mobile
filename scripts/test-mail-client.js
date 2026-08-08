const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

// Load mailClient.js in a sandbox that stubs child_process.execFile so we never
// touch a real IMAP/SMTP server.
const srcPath = path.join(__dirname, '../integrations/continuum-bridge/mailClient.js');
const src = fs.readFileSync(srcPath, 'utf8');

const scriptCalls = [];
const fakeExecFile = (script, args, opts, cb) => {
  scriptCalls.push({ script, args, opts });
  const command = args[1] || '';
  let out;
  if (command === 'list-mailboxes') {
    out = JSON.stringify([{ name: 'INBOX' }, { name: 'Min and Kids' }, { name: 'Archive' }]);
  } else if (command === 'check') {
    out = JSON.stringify([
      { uid: 101, from: 'Min Zhang <njsgas@gmail.com>', subject: 'Hi', date: '2026-08-08T12:00:00Z', flags: ['\\Seen'], snippet: 'hello there' },
      { uid: 102, from: 'Daniel Cai', subject: 'Lunch', date: '2026-08-07T12:00:00Z', flags: [], text: '<p>let\'s do lunch</p>' },
    ]);
  } else if (command === 'fetch') {
    out = JSON.stringify({
      uid: 101,
      from: 'Min Zhang <njsgas@gmail.com>',
      to: 'me@example.com',
      subject: 'Hi',
      date: '2026-08-08T12:00:00Z',
      flags: ['\\Seen'],
      text: 'Hello world body',
      html: '<p>Hello <b>world</b> body</p>',
    });
  } else if (command === 'mark-read') {
    out = JSON.stringify({ success: true, uids: args.slice(2, -2) });
  } else if (command === 'send') {
    out = JSON.stringify({ success: true, messageId: 'fake-123', to: args[args.indexOf('--to') + 1] });
  } else {
    out = JSON.stringify([]);
  }
  cb(null, out, '');
};

const sandbox = {
  module: { exports: {} },
  exports: {},
  require: (name) => {
    if (name === 'child_process') {
      return {
        execFile: (script, args, opts, cb) => fakeExecFile(script, args, opts, cb),
      };
    }
    if (name === 'util') return { promisify: (fn) => (...a) => new Promise((resolve, reject) => {
      fn(...a, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })));
    }) };
    return Module.createRequire(srcPath)(name);
  },
  console,
  process,
  __dirname: path.dirname(srcPath),
  __filename: srcPath,
};
vm.runInNewContext(src, sandbox, { filename: srcPath });
const mail = sandbox.module.exports;

async function run() {
  // Point findImapScript at a fake path so the sandboxed execFile is used.
  const fakeImap = path.join(__dirname, 'fixtures', 'imap-smtp-email', 'scripts', 'imap.js');
  fs.mkdirSync(path.dirname(fakeImap), { recursive: true });
  fs.writeFileSync(fakeImap, 'module.exports = {};');
  fs.writeFileSync(path.join(path.dirname(fakeImap), 'smtp.js'), 'module.exports = {};');
  process.env.IMAP_SCRIPT = fakeImap;

  // stripHtml
  assert.strictEqual(mail.stripHtml('<p>Hello&nbsp;world &amp; friends</p>'), 'Hello world & friends');

  // normalizeEmailRow
  const row = mail.normalizeEmailRow({ uid: '5', from: 'X', subject: 'S', html: '<p>hey</p>' });
  assert.strictEqual(row.uid, 5);
  assert.ok(row.snippet.includes('hey'));

  // listMailboxes
  const folders = await mail.listMailboxes();
  assert.strictEqual(folders.map((f) => f.name).join(','), 'INBOX,Min and Kids,Archive');

  // listEmails
  const emails = await mail.listEmails({ folder: 'INBOX', limit: 50, offset: 0 });
  assert.strictEqual(emails.length, 2);
  assert.strictEqual(emails[0].uid, 101);
  assert.strictEqual(emails[1].snippet, "let's do lunch"); // HTML stripped to text

  // fetchEmail
  const email = await mail.fetchEmail(101, 'INBOX');
  assert.strictEqual(email.subject, 'Hi');
  assert.ok(email.text.includes('Hello world'));

  // markRead
  const marked = await mail.markRead([101, 102], 'INBOX');
  assert.ok(marked.success);

  // sendEmail
  const sent = await mail.sendEmail({ to: 'njsgas@gmail.com', subject: 'Re: Hi', body: 'Thanks!' });
  assert.ok(sent.success);
  assert.strictEqual(sent.to, 'njsgas@gmail.com');

  console.log('mailClient: all checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
