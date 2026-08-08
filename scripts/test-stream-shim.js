const assert = require('assert');
const { Readable } = require('../shims/stream.js');
const { Buffer } = require('buffer');

// Mimic word-extractor's StorageStream usage: push() async chunks then null.
class FakeStorageStream extends Readable {
  constructor(totalChunks) {
    super();
    this._index = 0;
    this._total = totalChunks;
  }
  _read() {
    return Promise.resolve().then(() => {
      if (this._index >= this._total) {
        return this.push(null);
      }
      const chunk = Buffer.from(`chunk${this._index}`, 'utf8');
      this._index += 1;
      return this.push(chunk);
    });
  }
}

async function run() {
  // Normal flow: multiple data chunks then end.
  const s = new FakeStorageStream(3);
  const chunks = [];
  let ended = false;
  s.on('data', (c) => chunks.push(c.toString()));
  s.on('end', () => { ended = true; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(chunks.join(','), 'chunk0,chunk1,chunk2');
  assert.strictEqual(ended, true);

  // Single chunk then end (typical .doc case: WordDocument stream).
  const s2 = new FakeStorageStream(1);
  const chunks2 = [];
  let ended2 = false;
  s2.on('data', (c) => chunks2.push(c.toString()));
  s2.on('end', () => { ended2 = true; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(chunks2.join(','), 'chunk0');
  assert.strictEqual(ended2, true);

  // push() before any 'data' listener (streams created before consumption).
  const s3 = new FakeStorageStream(2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const chunks3 = [];
  s3.on('data', (c) => chunks3.push(c.toString()));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(chunks3.join(','), 'chunk0,chunk1');

  console.log('stream shim: all checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
