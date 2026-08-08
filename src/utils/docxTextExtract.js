/**
 * On-device .docx text extraction for Continuum chat attachments.
 *
 * A .docx is a ZIP container whose body lives in word/document.xml. We unzip
 * with JSZip (pure JS, no native modules) and pull plain text out of the
 * WordprocessingML tree, skipping field codes, formatting properties, and
 * non-text runs. Everything here is pure JS so it runs in Hermes/React Native
 * (no TextDecoder or Node built-ins required).
 */
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { toByteArray } from 'base64-js';

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRICT_WORD_NAMESPACE = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

// WordprocessingML elements that carry layout/control data but no document text.
const SKIP_ELEMENTS = new Set([
  'instrText', // field instructions (page numbers, TOC codes, etc.)
  'fldChar', // field begin/separate/end markers
  'proofErr', // spelling/grammar proofing markers
  'bookmarkStart',
  'bookmarkEnd',
  'commentReference',
  'footnoteReference',
  'endnoteReference',
  'separator',
  'continuationSeparator',
  'pPr',
  'rPr',
  'tblPr',
  'trPr',
  'tcPr',
  'sectPr',
]);

function isWordElement(node) {
  return (
    node.namespaceURI === WORD_NAMESPACE
    || node.namespaceURI === STRICT_WORD_NAMESPACE
    || node.prefix === 'w'
  );
}

function collectInlineText(node, parts) {
  if (node.nodeType === 3) {
    parts.push(node.data);
    return;
  }
  if (node.nodeType !== 1) return;

  const local = node.localName || '';
  if (isWordElement(node)) {
    switch (local) {
      case 't':
        parts.push(node.firstChild ? node.firstChild.data : '');
        return;
      case 'tab':
        parts.push('\t');
        return;
      case 'br':
      case 'cr':
        parts.push('\n');
        return;
      case 'noBreakHyphen':
        parts.push('-');
        return;
      case 'softHyphen':
        return;
      default:
        if (SKIP_ELEMENTS.has(local)) return;
    }
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectInlineText(child, parts);
  }
}

function collectParagraphs(node, lines) {
  if (node.nodeType !== 1 && node.nodeType !== 9) return;

  const local = node.localName || '';
  if (isWordElement(node) && local === 'p') {
    const parts = [];
    collectInlineText(node, parts);
    const line = parts
      .join('')
      .replace(/\u00a0/g, ' ')
      .replace(/\u00ad/g, '');
    if (line.trim()) lines.push(line.trim());
    return;
  }
  if (isWordElement(node) && SKIP_ELEMENTS.has(local)) return;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectParagraphs(child, lines);
  }
}

export function extractDocxTextFromXml(xml) {
  const cleaned = String(xml || '').replace(/^\uFEFF/, '');
  const doc = new DOMParser().parseFromString(cleaned, 'text/xml');
  const lines = [];
  collectParagraphs(doc, lines);
  return lines.join('\n');
}

export async function extractDocxTextFromBase64(base64) {
  const bytes = toByteArray(String(base64 || '').replace(/\s+/g, ''));

  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    throw new Error(
      'Could not read this Word file — it may be corrupted or password-protected. '
      + 'Save it as a .docx without a password and try again.',
    );
  }

  const entry = zip.file('word/document.xml');
  if (!entry) {
    throw new Error(
      'No readable content found in this Word file. Legacy .doc files are not supported — '
      + 'save the document as .docx and try again.',
    );
  }

  let text;
  try {
    const xml = await entry.async('string');
    text = extractDocxTextFromXml(xml);
  } catch (err) {
    throw new Error('Could not parse the contents of this Word file.');
  }

  if (!text) {
    throw new Error('No text found in this Word document.');
  }
  return text;
}
