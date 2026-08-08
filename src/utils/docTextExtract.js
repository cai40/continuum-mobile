/**
 * On-device legacy .doc text extraction for Continuum chat attachments.
 *
 * Legacy .doc files are OLE2 compound binary documents, not ZIPs. We use
 * word-extractor's OLE parser directly (word-ole-extractor + buffer-reader),
 * bypassing its fs/path-based entry points so the code runs in Hermes/React
 * Native. The only Node core dependency it pulls in is `stream`, which Metro
 * maps to a minimal in-repo shim (see metro.config.js).
 *
 * The result is the same shape as docxTextExtract: plain text for the chat
 * file-analysis pipeline.
 */
import { Buffer } from 'buffer';
import { toByteArray } from 'base64-js';

// word-extractor's OLE internals reference the `Buffer` global (they do not
// require('buffer') themselves) and one module uses it at load time. Hermes
// does not provide a Buffer global by default, so expose the npm `buffer`
// package before pulling word-extractor in (must be require(), not import(),
// so the global is set first).
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

const WordOleExtractor = require('word-extractor/lib/word-ole-extractor');
const BufferReader = require('word-extractor/lib/buffer-reader');

export async function extractDocTextFromBase64(base64) {
  const bytes = Buffer.from(toByteArray(String(base64 || '').replace(/\s+/g, '')));

  let doc;
  try {
    const extractor = new WordOleExtractor();
    doc = await extractor.extract(new BufferReader(bytes));
  } catch (err) {
    const reason = err && err.message ? String(err.message) : 'unknown';
    if (reason.toLowerCase().includes('magic number')) {
      throw new Error(
        'This file does not look like a valid Word .doc file. It may be an RTF saved '
        + 'with a .doc extension. Save it as .docx and try again.',
      );
    }
    throw new Error(
      'Could not read this Word file — it may be corrupted or password-protected. '
      + 'Save it as a .docx without a password and try again.',
    );
  }

  const parts = [];
  const body = doc.getBody();
  if (body && body.trim()) parts.push(body.trim());

  const headers = doc.getHeaders();
  if (headers && headers.trim()) parts.push(`[Headers/Footers]\n${headers.trim()}`);

  const textboxes = doc.getTextboxes();
  if (textboxes && textboxes.trim()) parts.push(`[Textboxes]\n${textboxes.trim()}`);

  if (parts.length === 0) {
    throw new Error('No text found in this Word document.');
  }
  return parts.join('\n\n');
}
