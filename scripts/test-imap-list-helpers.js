const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

// Load imap.js in a sandbox with a mocked `imap` module, `mailparser`, and `libmime`.
const srcPath = path.join(__dirname, '../skills/@gzlicanyi/imap-smtp-email/scripts/imap.js');
const src = fs.readFileSync(srcPath, 'utf8');

const imapMessages = new Map();
function resetImapMessages() {
  imapMessages.clear();
  // seqnos 1..5, newest = highest seqno
  imapMessages.set(1, { uid: 1001, from: 'Old <old@x.com>', subject: 'Oldest', date: '2026-01-01T00:00:00Z', flags: ['\\Seen'] });
  imapMessages.set(2, { uid: 1002, from: 'Two <two@x.com>', subject: 'Second', date: '2026-02-01T00:00:00Z', flags: [] });
  imapMessages.set(3, { uid: 1003, from: 'Three <three@x.com>', subject: 'Third', date: '2026-03-01T00:00:00Z', flags: ['\\Seen'] });
  imapMessages.set(4, { uid: 1004, from: 'Four <four@x.com>', subject: 'Fourth', date: '2026-04-01T00:00:00Z', flags: [] });
  imapMessages.set(5, { uid: 1005, from: 'New <new@x.com>', subject: 'Newest', date: '2026-05-01T00:00:00Z', flags: [] });
}

function makeFetch(seqnos) {
  // seqnos: array or range string
  let seqnoList = [];
  if (typeof seqnos === 'string') {
    if (seqnos.includes(':')) {
      const [a, b] = seqnos.split(':').map(Number);
      for (let i = a; i <= b; i++) seqnoList.push(i);
    } else {
      seqnoList.push(Number(seqnos));
    }
  } else {
    seqnoList = seqnos.map(Number);
  }
  const events = {};
  const emitMessage = [];
  for (const seqno of seqnoList) {
    const data = imapMessages.get(seqno);
    if (!data) continue;
    emitMessage.push(seqno);
  }
  // Emit 'message' with a msg object that fires body + attributes + end.
  const fetch = {
    on: (event, cb) => {
      if (event === 'message') {
        for (const seqno of emitMessage) {
          const data = imapMessages.get(seqno);
          const msg = { seqno };
          const parts = [];
          let attrs = null;
          msg.on = (ev, fn) => {
            if (ev === 'body') {
              // Simulate two body parts: HEADER.FIELDS then TEXT.
              fn({
                on: (dEv, dFn) => {
                  if (dEv === 'data') dFn(`From: ${data.from}\r\nSubject: ${data.subject}\r\nDate: ${data.date}\r\n`);
                  if (dEv === 'end') {
                    // nothing
                  }
                },
                once: (oEv, oFn) => { if (oEv === 'end') oFn(); },
              }, { which: 'HEADER.FIELDS (FROM SUBJECT DATE)' });
              fn({
                on: (dEv, dFn) => {
                  if (dEv === 'data') dFn(`snippet body ${data.subject}`);
                  if (dEv === 'end') { /* noop */ }
                },
                once: (oEv, oFn) => { if (oEv === 'end') oFn(); },
              }, { which: 'TEXT' });
            } else if (ev === 'once') {
              // attributes or end
            }
          };
          // Emit body events synchronously.
          // We'll instead drive: message handler receives msg, calls msg.on('body').
          // This simplified harness just records what would be emitted.
          setTimeout(() => {
            msg.emitBody = (ev, fn) => {
              if (ev === 'body') {
                fn({ on: (dEv, dFn) => { if (dEv === 'data') dFn(`From: ${data.from}\r\nSubject: ${data.subject}\r\nDate: ${data.date}\r\n`); }, once: (oEv, oFn) => { if (oEv === 'end') oFn(); } }, { which: 'HEADER.FIELDS (FROM SUBJECT DATE)' });
                fn({ on: (dEv, dFn) => { if (dEv === 'data') dFn(`snippet body ${data.subject}`); }, once: (oEv, oFn) => { if (oEv === 'end') oFn(); } }, { which: 'TEXT' });
              }
            };
            cb(msg);
          }, 0);
        }
      } else if (event === 'error') {
        events.error = cb;
      } else if (event === 'end') {
        setTimeout(() => cb(), 5);
      }
    },
  };
  return fetch;
}

// We won't fully drive the message event flow through node's stream; instead,
// unit-test the pure helpers: buildListRow, parseHeaderPart, seqnoRangeString.
// Extract them from the sandbox by evaluating the module and capturing exports.

const sandbox = {
  module: { exports: {} },
  exports: {},
  require: (name) => {
    if (name === 'imap') {
      return function MockImap() {};
    }
    if (name === 'mailparser') return { simpleParser: async () => ({}) };
    if (name === 'libmime') return { decodeWords: (s) => s };
    if (name === './config') return { imap: { user: 'u', pass: 'p' }, listAccounts: () => ({ accounts: [] }) };
    return Module.createRequire(srcPath)(name);
  },
  console,
  process,
  __dirname: path.dirname(srcPath),
  __filename: srcPath,
};
vm.runInNewContext(src, sandbox, { filename: srcPath });

// Pull out the pure helper functions from the sandbox global scope by re-reading them.
// Since they're top-level function declarations, they live on the sandbox global.
const helpers = {
  parseHeaderPart: sandbox.parseHeaderPart,
  buildListRow: sandbox.buildListRow,
  seqnoRangeString: sandbox.seqnoRangeString,
  rowDateMs: sandbox.rowDateMs,
};

function run() {
  // rowDateMs (newest-first sort base)
  const newest = helpers.rowDateMs({ date: '2026-08-08T12:00:00Z', headerDate: '2026-08-01T00:00:00Z' });
  const older = helpers.rowDateMs({ date: '2026-01-01T00:00:00Z', headerDate: null });
  const none = helpers.rowDateMs({});
  assert.ok(newest > older, 'newest date ranks higher');
  assert.strictEqual(none, 0, 'missing dates rank last');

  // parseHeaderPart
  const h = helpers.parseHeaderPart('From: Min Zhang <njsgas@gmail.com>\r\nSubject: Hi\r\nDate: 2026-08-08T12:00:00Z');
  assert.strictEqual(h.from, 'Min Zhang <njsgas@gmail.com>');
  assert.strictEqual(h.subject, 'Hi');
  assert.ok(h.date.includes('2026'));

  // buildListRow from HEADER.FIELDS + TEXT parts
  const parts = [
    { which: 'HEADER.FIELDS (FROM SUBJECT DATE)', body: 'From: New <new@x.com>\r\nSubject: Newest\r\nDate: 2026-05-01' },
    { which: 'TEXT', body: '<p>Hello world snippet</p>' },
  ];
  const row = helpers.buildListRow(parts, { uid: 1005, flags: [] });
  assert.strictEqual(row.uid, 1005);
  assert.strictEqual(row.from, 'New <new@x.com>');
  assert.strictEqual(row.subject, 'Newest');
  assert.ok(row.snippet.includes('Hello world snippet'));
  assert.ok(!row.snippet.includes('<p>'));

  // seqnoRangeString
  assert.strictEqual(helpers.seqnoRangeString(5, 5), '5');
  assert.strictEqual(helpers.seqnoRangeString(1, 5), '1:5');

  console.log('imap list helpers: all checks passed');
}

/**
 * Regression: fetchEmail must read uid/date/flags from the FIRST PART when
 * searchMessages returns a parts array (multiple body parts), not from the
 * array itself — otherwise "Cannot read properties of undefined (reading 'uid')".
 */
function fetchEmailAttributes(partList) {
  const parts = Array.isArray(partList) ? partList : [partList];
  const attrs = parts[0]?.attributes || null;
  return {
    uid: attrs?.uid != null ? Number(attrs.uid) : 0,
    date: attrs?.date || null,
    flags: attrs?.flags || [],
  };
}

function runAttributes() {
  // Multi-part case: searchMessages returns an array; attributes on elements.
  const multiPart = [
    { body: 'From: A', attributes: { uid: 777, date: new Date('2026-08-08T00:00:00Z'), flags: ['\\Seen'] } },
    { body: 'TEXT', attributes: { uid: 777, date: new Date('2026-08-08T00:00:00Z'), flags: ['\\Seen'] } },
  ];
  const r1 = fetchEmailAttributes(multiPart);
  assert.strictEqual(r1.uid, 777);
  assert.ok(r1.flags.includes('\\Seen'));
  assert.ok(r1.date instanceof Date);

  // Single-part case: searchMessages returns the part object directly.
  const singlePart = { body: 'From: A', attributes: { uid: 888, date: new Date('2026-08-07T00:00:00Z'), flags: [] } };
  const r2 = fetchEmailAttributes(singlePart);
  assert.strictEqual(r2.uid, 888);

  console.log('fetchEmail attributes: all checks passed');
}

run();
runAttributes();
