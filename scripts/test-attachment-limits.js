const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.join(__dirname, '../src/utils/helpers.js');
const src = fs.readFileSync(srcPath, 'utf8');
// Evaluate only the attachment-limit helpers (file also has ESM exports used by Metro).
const start = src.indexOf('/** Chat history JSON field');
const end = src.indexOf('function utf8ByteLength');
assert.ok(start >= 0 && end > start, 'helper block markers missing');
const block = src.slice(start, end)
  .replace(/\bexport\s+/g, '')
  + '\nmodule.exports = { MAX_ATTACHMENT_BYTES, MAX_IMAGE_ATTACHMENT_BYTES, attachmentSizeLimitBytes, formatAttachmentBytes };\n';
const sandbox = { module: { exports: {} }, exports: {} };
vm.runInNewContext(block, sandbox);
const {
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_ATTACHMENT_BYTES,
  attachmentSizeLimitBytes,
  formatAttachmentBytes,
} = sandbox.module.exports;

assert.strictEqual(MAX_IMAGE_ATTACHMENT_BYTES, 20 * 1024 * 1024);
assert.strictEqual(MAX_ATTACHMENT_BYTES, 1024 * 1024);
assert.strictEqual(attachmentSizeLimitBytes({ type: 'image/jpeg' }), MAX_IMAGE_ATTACHMENT_BYTES);
assert.strictEqual(attachmentSizeLimitBytes({ type: 'application/pdf' }), MAX_ATTACHMENT_BYTES);
assert.strictEqual(formatAttachmentBytes(20 * 1024 * 1024), '20MB');
assert.strictEqual(formatAttachmentBytes(1024 * 1024), '1MB');
assert.strictEqual(formatAttachmentBytes(512 * 1024), '512KB');

console.log('attachment limits: all checks passed');
