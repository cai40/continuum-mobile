'use strict';

const fs = require('fs');
const path = require('path');

const EMAIL_BLOCK = /\b(emails?|inbox|yahoo|imap|smtp|uid\b|clean\s*up|move\s+all\s+emails|from\s+\d{1,2}[\/\-]\d{1,2})\b/i;
const SEARCH_TIMEOUT_MS = 20000;
const USER_AGENT = 'Mozilla/5.0 (compatible; ContinuumBridge/1.0; +https://github.com/cai40/continuum-mobile)';

function loadBraveApiKey() {
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) {
    return process.env.BRAVE_SEARCH_API_KEY.trim();
  }
  const cfgPath = path.join(process.env.HOME || '/root', '.config/continuum-openclaw/.env');
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const match = raw.match(/^BRAVE_SEARCH_API_KEY=(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    // optional config
  }
  return '';
}

function wantsWebSearch(message) {
  const text = String(message || '').trim();
  if (!text || EMAIL_BLOCK.test(text)) return false;

  if (/\b(search the web|web search|search online|look up online|google)\b/i.test(text)) {
    return true;
  }

  const live = /\b(latest|current|today|tonight|yesterday|live|score|scores|result|results|standings|who won|who beat|match|matches|game|games|weather|news|price|election)\b/i;
  const topic = /\b(soccer|football|nba|nfl|mlb|nhl|premier league|world cup|euro|olympics|tennis|formula 1|f1|norway|la liga|champions league)\b/i;

  if (live.test(text) && (topic.test(text) || /\?\s*$/.test(text))) return true;

  if (/\b(what is|what's|who is|who's|when is|how did|did .+ win|tell me about)\b/i.test(text) && live.test(text)) {
    return true;
  }

  if (/\b(find out|look up|lookup)\b/i.test(text) && !/\b(email|memory|continuum|inbox)\b/i.test(text)) {
    return true;
  }

  return false;
}

function buildSearchQuery(message) {
  let q = String(message || '').trim();
  q = q.replace(/^(please\s+)?(search the web for|web search for|search for|look up|lookup|google)\s+/i, '');
  q = q.replace(/\?+$/, '').trim();
  if (!q) q = String(message || '').trim();
  if (/\b(latest|current|today|score|result|match|news|standing)\b/i.test(q) && !/\b20\d{2}\b/.test(q)) {
    q += ` ${new Date().getFullYear()}`;
  }
  return q;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function searchBrave(query, apiKey) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`;
  const data = await fetchJson(url, {
    Accept: 'application/json',
    'X-Subscription-Token': apiKey,
  });
  const results = (data.web?.results || []).map((row) => ({
    title: row.title,
    url: row.url,
    snippet: row.description || '',
    source: 'brave',
  }));
  return { provider: 'brave', results, query };
}

async function searchWikipedia(query) {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=6`;
  const data = await fetchJson(searchUrl);
  const hits = data.query?.search || [];
  const results = [];

  for (const hit of hits.slice(0, 4)) {
    let extract = stripHtml(hit.snippet);
    try {
      const titleEnc = encodeURIComponent(hit.title.replace(/ /g, '_'));
      const summary = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${titleEnc}`);
      if (summary.extract) {
        extract = summary.extract.slice(0, 500);
      }
    } catch {
      // snippet only
    }
    results.push({
      title: hit.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      snippet: extract,
      source: 'wikipedia',
      updated: hit.timestamp,
    });
  }

  return { provider: 'wikipedia', results, query };
}

async function searchWeb(query) {
  const braveKey = loadBraveApiKey();
  if (braveKey) {
    try {
      const brave = await searchBrave(query, braveKey);
      if (brave.results.length > 0) return brave;
    } catch (err) {
      console.error('[continuum-bridge] brave search failed:', err.message);
    }
  }
  return searchWikipedia(query);
}

function formatSearchResults({ provider, results, query }) {
  if (!results.length) {
    return [
      '[Web search — no results]',
      `Query: ${query}`,
      'No results returned. Try rephrasing, add BRAVE_SEARCH_API_KEY for broader news search, or ask a more specific question.',
    ].join('\n');
  }

  const lines = [
    `[Web search — ${provider}]`,
    `Query: ${query}`,
    `Retrieved: ${new Date().toISOString()}`,
    '',
    'Use ONLY the sources below for current/live facts. Cite titles and URLs when summarizing.',
    '',
  ];

  results.forEach((row, idx) => {
    lines.push(`${idx + 1}. ${row.title}`);
    lines.push(`   URL: ${row.url}`);
    if (row.updated) lines.push(`   Updated: ${row.updated}`);
    if (row.snippet) lines.push(`   ${row.snippet}`);
    lines.push('');
  });

  return lines.join('\n').trim();
}

module.exports = {
  wantsWebSearch,
  buildSearchQuery,
  searchWeb,
  formatSearchResults,
  loadBraveApiKey,
};
