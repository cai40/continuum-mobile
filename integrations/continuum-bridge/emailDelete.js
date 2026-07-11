'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { selectJunkUids, triageMessages } = require('./emailTriage');

const execFileAsync = promisify(execFile);

const MAX_DELETE_PER_REQUEST = 100;
/** Max move-to-Trash per cleanup run. */
const CLEANUP_DELETE_MAX = 10000;
const DELETE_BATCH_SIZE = 25;

const DELETE_INTENT = /\b(delete|remove|trash|purge|discard|move\s+(?:them|these|those|it|all)?\s*(?:to\s+)?(?:trash|bin)|clear\s+(?:out|my)?\s*(?:inbox|mail|junk))\b/i;
const DELETE_BLOCKED = /\b(don'?t|do not|never|without|not)\s+(delete|remove|trash|purge|move\s+.*\s+trash)\b/i;
const CLEANUP_INTENT = /\b(clean\s+up|cleanup|cleaning\s+up|clean\s+(?:my|the)\s+inbox|declutter|tidy\s+(?:up\s+)?(?:my\s+)?inbox)\b/i;
const JUNK_INTENT = /\b(junk|spam|promo(?:tional)?|marketing|newsletter|selectable|news\b|advertis(?:e|ing|ement)?s?)\b/i;
const CATEGORY_DELETE = /\bcategor(?:y|ies)\s*#?\s*\d|github\s*\/?\s*cursor|cursor\[bot\]|automated\s+cursor|promotions?\s*(?:&|and)\s*newsletters?\b/i;
const CHURCH_COMMUNITY_INTENT = /\b(church|grace chapel|grace\.org|@grace\.org|community|grace wilmington|wilmington campus|men'?s breakfast|e-?news|blue village|cogswell\.doug)\b/i;

function wantsEmailCleanup(message) {
  const text = message || '';
  if (CLEANUP_INTENT.test(text)) return true;
  if (/\bfetch\s+and\s+clean\b/i.test(text)) return true;
  if (/\bclean\b/i.test(text) && /\b(emails?|inbox|mail)\b/i.test(text)) return true;
  return false;
}

/** Dry-run cleanup: fetch + classify targets without moving to Trash. */
function wantsEmailCleanupPreview(message) {
  const text = message || '';
  if (!wantsEmailCleanup(text)) return false;
  if (/\b(apply|confirm|proceed|yes\s+proceed|go\s+ahead|for\s+real|actually\s+(?:delete|trash|clean))\b/i.test(text)) {
    return false;
  }
  if (/\b(preview|dry\s*run|scan\s+only|without\s+(?:deleting|trashing)|show\s+(?:me\s+)?(?:what|which)|would\s+be\s+trash)\b/i.test(text)) {
    return true;
  }
  if (/\bpreview\s+email\s+(?:album\s+)?cleanup\b/i.test(text)) return true;
  return false;
}

function wantsEmailDelete(message) {
  const text = message || '';
  if (DELETE_BLOCKED.test(text)) return false;
  if (wantsEmailCleanupPreview(text)) return false;
  if (wantsEmailCleanup(text)) return true;
  if (DELETE_INTENT.test(text)) return true;
  if (/\bmove\b/i.test(text) && /\b(trash|bin)\b/i.test(text)) return true;
  if (JUNK_INTENT.test(text) && /\b(trash|delete|remove|move|clear)\b/i.test(text)) return true;
  if (CATEGORY_DELETE.test(text) && /\b(trash|delete|remove|move)\b/i.test(text)) return true;
  if (CHURCH_COMMUNITY_INTENT.test(text) && /\b(trash|delete|remove|move)\b/i.test(text)) return true;
  return false;
}

function isGithubCursorRow(row) {
  return /github|cursor\[bot\]|cursor\s*bot/i.test(`${row.from} ${row.subject}`);
}

function parseRequestedCategoryNumbers(text) {
  const cats = new Set();
  const raw = String(text || '');

  const listMatch = raw.match(/\bcategor(?:y|ies)\s*(?:#?\s*)?([\d\s,and&–\-]+(?:\d+\s*(?:-|–|to|through)\s*\d+)?[\d\s,and&]*)/i);
  if (listMatch) {
    const chunk = listMatch[1];
    const range = chunk.match(/(\d+)\s*(?:-|–|to|through)\s*(\d+)/i);
    if (range) {
      const lo = Math.min(parseInt(range[1], 10), parseInt(range[2], 10));
      const hi = Math.max(parseInt(range[1], 10), parseInt(range[2], 10));
      for (let i = lo; i <= hi; i += 1) {
        if (i >= 1 && i <= 6) cats.add(i);
      }
    }
    for (const num of chunk.match(/\d+/g) || []) {
      const n = parseInt(num, 10);
      if (n >= 1 && n <= 6) cats.add(n);
    }
  }

  if (cats.size === 0) {
    if (/github\s*\/?\s*cursor|cursor\[bot\]|cursor\s*bot|automated\s+cursor|github\s+notifications?/i.test(raw)) {
      cats.add(1);
    }
    if (/promotions?\s*(?:&|and)\s*newsletters?|\bnewsletters?\s*(?:&|and)\s*promotions?/i.test(raw)) {
      cats.add(6);
    }
  }

  return cats;
}

function rowBlob(row) {
  return `${row.from} ${row.subject}`.toLowerCase();
}

function emailFullBlob(row, email) {
  const preview = String(email?.snippet || email?.text || email?.preview || '');
  return `${row.from} ${row.subject} ${preview}`.toLowerCase();
}

const CLEANUP_SECURITY_BLOCK = /\b(verification code|one.?time passcode|otp|security alert|fraud alert|password reset|sign.?in attempt|unauthorized|verify your identity|two.?step|app password)\b/i;
const CLEANUP_STATEMENT = /\b(e-?statement|account statement|monthly statement|statement ready|statement available|your statement|credit card statement|bank statement)\b/i;
const CLEANUP_BANK = /\b(bank of america|fidelity|greenwood credit|peoplesbank|charles schwab|chase|wells fargo|capital one|citi card|american express|credit union)\b/i;
const CLEANUP_NEWS = /\b(breaking news|news digest|news alert|daily briefing|top stories|news update|news@|@news\.|nytimes|cnn\.com|bbc\.|reuters|apnews|substack)\b/i;
const CLEANUP_DEV = /\b(github|gitlab|bitbucket|cursor\[bot\]|dependabot|circleci|travis.?ci|vercel|netlify|npmjs|docker\.com|pull request|workflow run|build failed|build passed|code review|stackoverflow|sentry\.io|heroku|render\.com|actions run|ci\/cd|jenkins)\b/i;
const CLEANUP_ADS = /\b(advertisement|sponsored|promo(?:tion|tional)?|marketing blast|%\s*off|deal of the day|limited.?time offer|shop now|buy now|free shipping)\b/i;
const CLEANUP_MARKETING_SENDERS = /\b(auction\.com|adc\.auction|realtytrac|foreclosurefortunes|foreclosure|shopifyemail\.com|@t\.shopifyemail|hit-reply@linkedin|mailer\.appfolio|appfolio\.us|mattressfirm|mattress\s+firm|@welcome\.americanexpress|@infos-|notifications@united\.com|bostonsailingcenter|auto-reply@usps\.com|@email\.usps\.gov|informeddelivery\.usps|@convo\.zillow\.com|convo\.zillow|update\.strava\.com|mail@update\.strava|gopassport\.com|mcinfo@ups\.com|shipment-tracking@amazon\.com|order-update@amazon\.com|auto-confirm@amazon\.com|return@amazon\.com|@e\.stessa\.com|stessa\.com)\b/i;
const CLEANUP_RECEIPT_KEEP = /\b(receipt|invoice|order confirm(?:ation)?|confirmation number|your order|shipped|delivery confirm|payment received|tracking number|out for delivery|has shipped|pickup ready|paid you|sent you \$|flight confirm(?:ation)?|itinerar|check.?in|boarding pass|e-?ticket|trip confirm(?:ation)?|on the way|in transit|delivered|parking (?:receipt|confirm|confirmation|ticket|pass))\b/i;

function matchesCleanupTarget(row, email) {
  if (row.uid == null) return false;

  const fullBlob = emailFullBlob(row, email);
  const { isNeverTrashEmail } = require('./emailNeverTrash');
  if (isNeverTrashEmail(email || { from: row.from, subject: row.subject })) return false;
  if (CLEANUP_SECURITY_BLOCK.test(fullBlob)) return false;

  if (CLEANUP_STATEMENT.test(fullBlob)) return true;
  if (CLEANUP_BANK.test(fullBlob) && /\bstatement|estatement\b/i.test(fullBlob)) return true;

  if (row.selectable_as_junk) return true;
  if (row.category === 'newsletter' || row.category === 'spam') return true;
  if (CLEANUP_NEWS.test(fullBlob)) return true;
  if (CLEANUP_DEV.test(fullBlob)) return true;
  if (CLEANUP_ADS.test(fullBlob)) return true;
  if (CLEANUP_MARKETING_SENDERS.test(fullBlob) && !CLEANUP_RECEIPT_KEEP.test(fullBlob)) return true;
  if (/\bnewsletter\b/i.test(fullBlob)) return true;

  return false;
}

function resolveCleanupUids(emails, maxCap = MAX_DELETE_PER_REQUEST) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const triaged = triageMessages(emails);
  const uids = [];
  for (let i = 0; i < triaged.length; i += 1) {
    const row = triaged[i];
    const email = emails[i];
    if (matchesCleanupTarget(row, email)) uids.push(Number(row.uid));
  }
  return uids.slice(0, maxCap);
}

function countCleanupTargets(emails) {
  if (!Array.isArray(emails) || emails.length === 0) return 0;
  const triaged = triageMessages(emails);
  let count = 0;
  for (let i = 0; i < triaged.length; i += 1) {
    if (matchesCleanupTarget(triaged[i], emails[i])) count += 1;
  }
  return count;
}

function formatSender(email, row) {
  return String(row?.from || email?.from?.text || email?.from || email?.fromAddress || 'Unknown')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function listCleanupTargets(emails, maxCap = CLEANUP_DELETE_MAX) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const triaged = triageMessages(emails);
  const rows = [];
  for (let i = 0; i < triaged.length; i += 1) {
    const row = triaged[i];
    const email = emails[i];
    if (!matchesCleanupTarget(row, email)) continue;
    rows.push({
      uid: Number(row.uid),
      subject: String(row.subject || email?.subject || '(no subject)').replace(/\s+/g, ' ').trim().slice(0, 200),
      from: formatSender(email, row),
      category: row.category || 'other',
    });
    if (rows.length >= maxCap) break;
  }
  return rows;
}

const CLEANUP_PREVIEW_LIST_MAX = 150;

function formatEmailCleanupPreviewNextSteps({ dateRangeLabel = null, cleanupCount = 0 } = {}) {
  const period = dateRangeLabel ? `**${dateRangeLabel}**` : 'the **same period** you just previewed';
  const chatApply = dateRangeLabel ? `clean up ${dateRangeLabel} emails` : 'clean up inbox';

  const lines = [
    '',
    '---',
    '',
    '## What to do next',
    '',
    'This was a **preview only** — nothing was moved to Trash.',
    '',
  ];

  if (cleanupCount <= 0) {
    lines.push(
      'No messages matched cleanup rules in this batch.',
      '',
      '**Options:**',
      '- Try a different date range from the **Email** tab.',
      '- Raise **Email Fetch Limit** in Setup if you expected more mail.',
      '- Preview again: **Email** tab → period → **Preview (dry run)**.',
    );
    return lines;
  }

  lines.push(
    '**Reply in chat with one word:**',
    '',
    '- **`apply`** (recommended)',
    '- **`proceed`**',
    '- **`yes`**',
    '- **`ok`**',
    '',
    'Same period as this preview. Do not say "preview" again.',
    '',
    '**Or apply from the Email tab:**',
    '',
    '1. Open **Setup** → **OpenClaw Gateway** → turn **ON** “Allow move to Trash” → **Save**.',
    `2. **Email** tab → choose ${period} → tap **Apply cleanup**.`,
    `3. Full chat command if needed: \`${chatApply}\``,
    '4. Keep the app open until the reply shows **Done** (large months may take 1–2 minutes).',
    '',
    '**Notes:**',
    `- **${cleanupCount}** message(s) above would move to Yahoo **Trash** (recoverable; not permanently deleted).`,
    '- Protected mail (banks, OTP/security, never-trash senders including MassHousing) is not in the list above.',
    '- **To skip:** do nothing — this preview made no changes.',
  );
  return lines;
}

function formatCleanupPreviewBlock(emails, { maxList = CLEANUP_PREVIEW_LIST_MAX, dateRangeLabel = null } = {}) {
  const targets = listCleanupTargets(emails);
  const lines = [
    '[EMAIL CLEANUP PREVIEW — dry run, nothing moved to Trash]',
    '',
    '**Reply in chat:** **`apply`**, **`proceed`**, **`yes`**, or **`ok`** (same period).',
    '',
    `**Would move to Trash (${targets.length})**`,
    '_Newsletters, promos, junk, statements, and dev/marketing mail matching cleanup rules._',
    '',
  ];

  if (!targets.length) {
    lines.push('- _(none in this batch)_');
  } else {
    for (const row of targets.slice(0, maxList)) {
      lines.push(`- UID ${row.uid}: "${row.subject}" — ${row.from}`);
    }
    if (targets.length > maxList) {
      lines.push(`- _…and ${targets.length - maxList} more_`);
    }
  }

  lines.push(...formatEmailCleanupPreviewNextSteps({ dateRangeLabel, cleanupCount: targets.length }));

  return {
    text: lines.join('\n'),
    targets,
    count: targets.length,
    truncated: targets.length > maxList,
  };
}

function extractEmailCleanupPreviewBlock(text) {
  const src = String(text || '');
  const idx = src.search(/\[EMAIL CLEANUP PREVIEW/i);
  if (idx < 0) return null;
  const slice = src.slice(idx);
  const cut = slice.search(/\n\[(?:PREFILLED|Email cleanup executed|Email trash|Email auto-trash|\/PREFILLED)/i);
  return (cut > 0 ? slice.slice(0, cut) : slice).trim();
}

function matchesSummaryCategory(row, catNum) {
  if (row.uid == null) return false;
  if (row.category === 'protected') return false;

  const blob = rowBlob(row);

  switch (catNum) {
    case 1:
      return isGithubCursorRow(row) && row.selectable_as_junk;
    case 2:
      return false;
    case 3:
      return row.selectable_as_junk
        && (row.category === 'newsletter' || row.category === 'spam')
        && !isGithubCursorRow(row);
    case 4:
      return /smtp|connection test|test email from the imap|imap\/smtp email skill/i.test(blob);
    case 5:
      if (/hertz.*reservation|reservation confirmation|national grid|ezdrive|peak demand|account statement|direct deposit|e-?statement|one.?time passcode|verification code/i.test(blob)) {
        return false;
      }
      return /sixt|promotional rental|auto insurance promotion|\$29\/month|reprocessed quote|home insurance options|nucar|service reminder|trugreen|renewal by andersen|flybussen|password reset|email verification link|automotive insurance info/i.test(blob)
        && (row.selectable_as_junk || /promo|promotion|deal|sale|offer/i.test(blob));
    case 6:
      return row.selectable_as_junk && (row.category === 'newsletter' || row.category === 'spam');
    default:
      return false;
  }
}

function resolveCategoryDeleteUids(text, emails) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const uids = new Set();
  const triaged = triageMessages(emails);
  const requested = parseRequestedCategoryNumbers(text);

  for (const row of triaged) {
    for (const cat of requested) {
      if (matchesSummaryCategory(row, cat)) {
        uids.add(Number(row.uid));
        break;
      }
    }
  }

  return Array.from(uids);
}

function resolveChurchCommunityUids(emails) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const uids = [];
  for (const email of emails) {
    const from = String(email.from?.text || email.from || email.fromAddress || '');
    const subject = String(email.subject || '');
    const preview = String(email.snippet || email.text || email.preview || '');
    const blob = `${from} ${subject} ${preview}`.toLowerCase();
    if (/grace\.org|@grace\.org|grace chapel|grace wilmington|wilmington campus|men'?s breakfast|e-?news|blue village|community activit|cogswell\.doug|wilmington men's breakfast/i.test(blob)) {
      if (email.uid != null) uids.push(Number(email.uid));
    }
  }
  return uids;
}

function filterToFetchedUids(candidateUids, emails) {
  const fetched = new Set(emails.map((e) => Number(e.uid)).filter(Number.isFinite));
  return candidateUids.filter((uid) => fetched.has(Number(uid)));
}

function parseIndexList(raw) {
  const values = new Set();
  const chunks = String(raw || '').split(/,|\band\b/i);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    const single = trimmed.match(/^(\d{1,4})$/);
    if (single) {
      values.add(parseInt(single[1], 10));
      continue;
    }
    const range = trimmed.match(/^(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})$/i);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = parseInt(range[2], 10);
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let i = lo; i <= hi; i += 1) values.add(i);
    }
  }
  return Array.from(values);
}

function parseExplicitUids(message) {
  const uids = new Set();
  const text = message || '';

  for (const match of text.matchAll(/\buids?\s*[:#]?\s*([\d,\s]+)/gi)) {
    for (const num of match[1].matchAll(/\d{4,}/g)) {
      uids.add(parseInt(num[0], 10));
    }
  }

  for (const match of text.matchAll(/\buid\s*[:#]?\s*(\d+)/gi)) {
    uids.add(parseInt(match[1], 10));
  }

  return Array.from(uids);
}

function resolveDeleteUids(message, emails, listOffset = 0, maxCap = MAX_DELETE_PER_REQUEST) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const text = message || '';
  const uids = new Set();

  for (const uid of parseExplicitUids(text)) {
    uids.add(uid);
  }

  for (const match of text.matchAll(/\b(?:emails?|messages?|mail)\s*#?\s*(\d+(?:\s*(?:,|and)\s*\d+|\s*-\s*\d+)*)/gi)) {
    for (const idx of parseIndexList(match[1])) {
      const email = emails[idx - 1 - listOffset];
      if (email?.uid) uids.add(Number(email.uid));
    }
  }

  const rangeMatch = text.match(/\b(?:emails?|messages?)\s*(\d+)\s*(?:-|–|to)\s*(\d+)/i);
  if (rangeMatch) {
    for (const idx of parseIndexList(`${rangeMatch[1]}-${rangeMatch[2]}`)) {
      const email = emails[idx - 1 - listOffset];
      if (email?.uid) uids.add(Number(email.uid));
    }
  }

  const fromMatch = text.match(/\b(?:from|sender)\s+["']?([^"'\n,]+?)["']?(?:\s|$|,|\.)/i);
  if (fromMatch) {
    const needle = fromMatch[1].trim().toLowerCase();
    for (const email of emails) {
      const from = String(email.from?.text || email.from || '').toLowerCase();
      if (from.includes(needle)) uids.add(Number(email.uid));
    }
  }

  const subjectMatch = text.match(/\bsubject\s+(?:contains\s+)?["']?([^"'\n]+?)["']?(?:\s|$|,|\.)/i);
  if (subjectMatch) {
    const needle = subjectMatch[1].trim().toLowerCase();
    for (const email of emails) {
      const subject = String(email.subject || '').toLowerCase();
      if (subject.includes(needle)) uids.add(Number(email.uid));
    }
  }

  if (/\bdelete\s+(all\s+)?unread\b/i.test(text)) {
    for (const email of emails) {
      const unread = Array.isArray(email.flags) && !email.flags.includes('\\Seen');
      if (unread) uids.add(Number(email.uid));
    }
  }

  if (wantsEmailCleanup(text)) {
    for (const uid of resolveCleanupUids(emails, maxCap)) uids.add(uid);
  }

  if (JUNK_INTENT.test(text) && (DELETE_INTENT.test(text) || /\b(trash|move)\b/i.test(text))) {
    const includeGithub = !/\b(keep|exclude|without|no)\s+github\b/i.test(text);
    const { uids: junkUids } = selectJunkUids(emails, { includeGithub, max: maxCap });
    for (const uid of junkUids) uids.add(uid);
  }

  if (CATEGORY_DELETE.test(text)) {
    for (const uid of resolveCategoryDeleteUids(text, emails)) uids.add(uid);
  }

  if (CHURCH_COMMUNITY_INTENT.test(text)) {
    for (const uid of resolveChurchCommunityUids(emails)) uids.add(uid);
  }

  if (/\bdelete\s+(all|every)\b/i.test(text) && uids.size === 0) {
    for (const email of emails) {
      if (email?.uid) uids.add(Number(email.uid));
    }
  }

  const candidates = Array.from(uids).filter((uid) => Number.isFinite(uid));
  const verified = filterToFetchedUids(candidates, emails);
  return verified.slice(0, maxCap);
}

async function runImapDelete(imapScript, uids, timeoutMs = 120000) {
  const skillRoot = path.dirname(path.dirname(imapScript));
  const args = [imapScript, 'delete', ...uids.map(String)];

  const { stdout, stderr } = await execFileAsync('node', args, {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    cwd: skillRoot,
    env: { ...process.env, NODE_PATH: path.join(skillRoot, 'node_modules') },
  });

  if (stderr?.trim()) {
    console.error('[continuum-bridge] imap delete stderr:', stderr.trim());
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return { success: true, uids, action: 'moved_to_trash', raw: stdout.trim() };
  }
}

async function runImapDeleteBatched(imapScript, uids) {
  const chunks = [];
  for (let i = 0; i < uids.length; i += DELETE_BATCH_SIZE) {
    chunks.push(uids.slice(i, i + DELETE_BATCH_SIZE));
  }
  const results = [];
  const batchTimeout = Math.min(3600000, 120000 + uids.length * 3000);
  for (const chunk of chunks) {
    results.push(await runImapDelete(imapScript, chunk, batchTimeout));
  }
  return {
    success: results.every((r) => r.success !== false),
    uids,
    action: 'moved_to_trash',
    count: uids.length,
    batches: chunks.length,
  };
}

function formatDeleteUidLines(emails, deletedUids) {
  return deletedUids.map((uid) => {
    const email = emails.find((item) => Number(item.uid) === Number(uid));
    if (!email) return `- UID ${uid}`;
    const from = email.from?.text || email.from || 'Unknown';
    const subject = email.subject || '(no subject)';
    return `- UID ${uid}: "${subject}" from ${from}`;
  });
}

function formatDeleteResult(result, emails, deletedUids, skippedUids = [], { headerLine = null } = {}) {
  const lines = formatDeleteUidLines(emails, deletedUids);

  const action = result?.action === 'moved_to_trash' ? 'Moved to Trash' : 'Deleted';
  const parts = [headerLine || `${action} ${deletedUids.length} email(s) via Yahoo IMAP:`];
  if (lines.length) parts.push(...lines);
  if (skippedUids.length) {
    parts.push(`Skipped ${skippedUids.length} UID(s) not in the fetched inbox (may be invalid or already removed): ${skippedUids.slice(0, 10).join(', ')}${skippedUids.length > 10 ? '...' : ''}`);
  }
  if (result?.batches > 1) {
    parts.push(`(Executed in ${result.batches} batch(es).)`);
  }
  return parts.join('\n');
}

function mergeDeleteResults(autoResult, manualResult, emails) {
  const autoUids = (autoResult?.uids || []).map(Number).filter(Number.isFinite);
  const manualUids = (manualResult?.uids || []).map(Number).filter(Number.isFinite);
  const autoSet = new Set(autoUids);
  const mergedUids = [...new Set([...autoUids, ...manualUids])];
  const cleanupAdded = manualUids.filter((uid) => !autoSet.has(uid)).length;
  const skippedUids = [...new Set([...(autoResult?.skippedUids || []), ...(manualResult?.skippedUids || [])])];
  const autoRan = !!(autoResult?.executed && autoUids.length);
  const manualRan = !!(manualResult?.executed && manualUids.length);
  const batches = (autoUids.length ? Math.ceil(autoUids.length / DELETE_BATCH_SIZE) : 0)
    + (manualUids.length ? Math.ceil(manualUids.length / DELETE_BATCH_SIZE) : 0);

  let headerLine;
  if (autoRan && manualRan) {
    let header = `Moved to Trash ${mergedUids.length} email(s) via Yahoo IMAP (auto-trash ${autoUids.length}`;
    if (cleanupAdded > 0) header += ` + cleanup ${cleanupAdded}`;
    header += '):';
    headerLine = header;
  }

  const combinedResult = {
    action: 'moved_to_trash',
    batches: batches > 1 ? batches : undefined,
  };

  return {
    executed: true,
    summary: formatDeleteResult(combinedResult, emails, mergedUids, skippedUids, { headerLine }),
    error: manualResult?.error || autoResult?.error || null,
    uids: mergedUids,
    skippedUids,
    auto: autoRan,
    manual: manualRan,
    autoCount: autoUids.length,
    cleanupAdded,
  };
}

async function maybeAutoTrashJunk(emails, imapScript, { enabled = false, includeGithub = false, max = MAX_DELETE_PER_REQUEST } = {}) {
  if (!enabled || !imapScript || !Array.isArray(emails) || emails.length === 0) {
    return { executed: false, summary: null, error: null, uids: [], skippedUids: [], auto: true };
  }

  const { uids } = selectJunkUids(emails, { includeGithub, max });
  if (uids.length === 0) {
    return { executed: false, summary: null, error: null, uids: [], skippedUids: [], auto: true };
  }

  try {
    const result = await runImapDeleteBatched(imapScript, uids);
    return {
      executed: true,
      summary: formatDeleteResult(result, emails, uids),
      error: null,
      uids,
      skippedUids: [],
      auto: true,
    };
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    return {
      executed: false,
      summary: null,
      error: `Auto-trash failed: ${detail}`,
      uids,
      skippedUids: [],
      auto: true,
    };
  }
}

async function maybeDeleteEmails(message, emails, imapScript, { enabled = false, listOffset = 0, maxDelete = MAX_DELETE_PER_REQUEST } = {}) {
  if (!enabled || !wantsEmailDelete(message) || !imapScript) {
    return { executed: false, summary: null, error: null, uids: [], skippedUids: [] };
  }

  const requestedUids = parseExplicitUids(message);
  const uids = resolveDeleteUids(message, emails, listOffset, maxDelete);
  const fetchedSet = new Set(emails.map((e) => Number(e.uid)));
  const skippedUids = requestedUids.filter((uid) => !fetchedSet.has(uid));

  if (uids.length === 0) {
    const hint = wantsEmailCleanup(message)
      ? 'No cleanup targets in the fetched slice. Clean up trashes: news, newsletters, promos, ads, GitHub/dev notifications, and bank statements (never OTP/security). Raise Email Fetch Limit or set Lookback to 30d.'
      : /\bcategor/i.test(message)
      ? 'Supported summary categories: 1=GitHub/Cursor bots, 4=SMTP self-tests only, 5=travel/auto/home promos, 6=newsletters/promos. Categories 2–3 (career/finance/real estate) and protected mail (banks, DocuSign, Hetzner OTP) are never auto-deleted. Try "move category 6 to trash" or list explicit UIDs.'
      : CHURCH_COMMUNITY_INTENT.test(message)
        ? 'Church/community mail was not matched in the fetched slice. Try "delete uid 962718, 962849, 962874", "delete emails 4, 60, 67", or widen Email Lookback to 7d/30d.'
        : JUNK_INTENT.test(message)
        ? 'No junk/spam matches in the fetched inbox slice. Try a higher Email Fetch Limit or say "delete email 1, 2, 3".'
        : 'Use "delete email 1", "delete uid 12345" (must be in fetched list), "move category 6 to trash", or "delete junk to trash".';
    return {
      executed: false,
      summary: null,
      error: `Delete requested but no matching fetched emails. ${hint}`,
      uids: [],
      skippedUids,
    };
  }

  try {
    const result = await runImapDeleteBatched(imapScript, uids);
    return {
      executed: true,
      summary: formatDeleteResult(result, emails, uids, skippedUids),
      error: null,
      uids,
      skippedUids,
    };
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    const syncHint = /unknown command:\s*delete/i.test(detail)
      ? ' Run on VPS: bash /tmp/continuum-mobile/integrations/continuum-bridge/sync-imap-skill.sh'
      : '';
    return {
      executed: false,
      summary: null,
      error: `Move to Trash failed: ${detail}.${syncHint}`,
      uids,
      skippedUids,
    };
  }
}

module.exports = {
  MAX_DELETE_PER_REQUEST,
  CLEANUP_DELETE_MAX,
  CLEANUP_PREVIEW_LIST_MAX,
  wantsEmailDelete,
  wantsEmailCleanup,
  wantsEmailCleanupPreview,
  resolveDeleteUids,
  resolveCleanupUids,
  countCleanupTargets,
  listCleanupTargets,
  formatCleanupPreviewBlock,
  formatEmailCleanupPreviewNextSteps,
  extractEmailCleanupPreviewBlock,
  resolveChurchCommunityUids,
  parseExplicitUids,
  mergeDeleteResults,
  maybeDeleteEmails,
  maybeAutoTrashJunk,
  CHURCH_COMMUNITY_INTENT,
  CLEANUP_INTENT,
};
