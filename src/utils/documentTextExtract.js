import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { isPdfAttachment, resolveDocumentMimeType } from './documentTypes';

const MAX_EXTRACT_CHARS = 60000;

function truncate(text) {
  const raw = String(text || '').trim();
  if (raw.length <= MAX_EXTRACT_CHARS) return raw;
  return `${raw.slice(0, MAX_EXTRACT_CHARS)}\n\n[Truncated — file exceeds ${MAX_EXTRACT_CHARS} characters]`;
}

async function readBase64(uri) {
  return readAsStringAsync(uri, {
    encoding: EncodingType.Base64,
  });
}

async function extractExcelText(uri) {
  const base64 = await readBase64(uri);
  const workbook = XLSX.read(base64, { type: 'base64' });
  const parts = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      parts.push(`## Sheet: ${sheetName}\n${csv}`);
    }
  }
  return truncate(parts.join('\n\n'));
}

async function extractPlainText(uri) {
  const text = await readAsStringAsync(uri);
  return truncate(text);
}

export async function extractAttachmentText(file) {
  const name = file?.name || 'document';
  const uri = file?.uri;
  if (!uri) return null;

  if (isPdfAttachment(file)) {
    return null;
  }

  const resolved = resolveDocumentMimeType(name, file.type);
  const ext = String(name).split('.').pop()?.toLowerCase() || '';

  if (
    ext === 'xlsx'
    || ext === 'xls'
    || resolved.includes('spreadsheet')
    || resolved.includes('excel')
  ) {
    return extractExcelText(uri);
  }

  if (ext === 'txt' || ext === 'csv' || resolved.includes('text/plain') || resolved.includes('csv')) {
    return extractPlainText(uri);
  }

  return null;
}

export async function buildMessageWithAttachments(userMessage, attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const blocks = [];
  const pdfFiles = [];

  for (const file of list) {
    if (file.type?.startsWith('image/')) continue;
    if (isPdfAttachment(file)) {
      pdfFiles.push(file.name || 'document.pdf');
      continue;
    }
    const text = await extractAttachmentText(file);
    if (text) {
      blocks.push(`[Attached file: ${file.name}]\n${text}`);
    }
  }

  for (const name of pdfFiles) {
    blocks.push(
      `[Attached PDF: ${name}]\n`
      + 'The PDF binary is included in this request as a multipart file upload. '
      + 'Analyze the document from the uploaded file content.',
    );
  }

  if (blocks.length === 0) {
    return { message: userMessage, documentTextInjected: false };
  }

  const instruction = String(userMessage || '').trim() || 'Analyze the attached file(s) below.';
  return {
    message: [
      '[FILE ANALYSIS MODE — device-extracted document text is included below. Analyze ONLY this content. Do NOT claim you lack file-reading capabilities, cannot access attachments, or need the user to paste the file. Ignore unrelated prior chat or memory unless the user explicitly asks.]',
      '',
      instruction,
      '',
      '---',
      'REAL ATTACHED FILE CONTENT (extracted on device — use ONLY this text for analysis):',
      '',
      blocks.join('\n\n---\n\n'),
    ].join('\n'),
    documentTextInjected: true,
    extractedFileCount: blocks.length,
    pdfFileCount: pdfFiles.length,
  };
}
