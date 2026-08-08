'use strict';

/**
 * Family memory ingest — during inbox cleanup, also read ALL emails from the
 * family senders (Min Zhang, Daniel Cai, Michael Cai) and Michelle Wang into
 * Continuum memory.
 *
 * Reuses ingest-sender-emails.js per sender, which tracks processed UIDs so
 * repeat runs only ingest mail not yet seen. Errors are collected per sender
 * and never break the cleanup itself.
 */

const { ingestSenderIntoMemory } = require('./ingest-sender-emails');
const { BUILTIN_CLEANUP_FOLDER } = require('./emailCleanupFolder');

const DEFAULT_INGEST_LIMIT = 500;
const DEFAULT_INGEST_RECENT = '3650d';

/** Senders whose mail is auto-filed to "Min and Kids" and read into memory on cleanup. */
const FAMILY_MEMORY_INGEST_SENDERS = [
  ...BUILTIN_CLEANUP_FOLDER
    .filter((rule) => rule.copy)
    .map((rule) => rule.label),
  // Michelle Wang is never trashed but kept in INBOX; her mail is also read into memory.
  'Michelle Wang',
];

/** Optional IMAP FROM search needle per sender label (email is more reliable than a display name). */
const SENDER_SEARCH_FROM = {
  'Michelle Wang': 'bingjing6699@gmail.com',
};

function familyIngestEnabled() {
  return process.env.EMAIL_FAMILY_INGEST_ENABLED !== 'false';
}

/**
 * Read all family emails into memory. Returns per-sender results:
 * [{ sender, fetched, ingested, uids, reply, error? }]
 */
async function runFamilyMemoryIngest({ imapScript = null, limit = null, recent = null, onStatus = null } = {}) {
  if (!familyIngestEnabled()) {
    return [];
  }

  const results = [];
  for (const sender of FAMILY_MEMORY_INGEST_SENDERS) {
    try {
      if (onStatus) onStatus(`Reading ${sender} emails into memory…`);
      const result = await ingestSenderIntoMemory({
        sender,
        searchFrom: SENDER_SEARCH_FROM[sender] || null,
        limit: limit || DEFAULT_INGEST_LIMIT,
        recent: recent || DEFAULT_INGEST_RECENT,
        allNew: true,
        imapScript,
      });
      results.push(result);
    } catch (err) {
      results.push({
        sender,
        fetched: 0,
        ingested: 0,
        uids: [],
        reply: null,
        error: err?.stderr?.toString?.() || err?.message || String(err),
      });
    }
  }
  return results;
}

function formatFamilyIngestSummary(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const lines = [
    '**Family memory ingest (auto):**',
    ...results.map((r) => {
      if (r.error) return `- ${r.sender}: failed (${r.error})`;
      if (r.ingested === 0) return `- ${r.sender}: no new emails (${r.fetched} scanned, already in memory)`;
      return `- ${r.sender}: ingested ${r.ingested} new email(s) into memory`;
    }),
  ];
  return lines.join('\n');
}

module.exports = {
  FAMILY_MEMORY_INGEST_SENDERS,
  SENDER_SEARCH_FROM,
  familyIngestEnabled,
  runFamilyMemoryIngest,
  formatFamilyIngestSummary,
};
