'use strict';

const { wantsEmailFetch } = require('./emailFetchOptions');
const {
  wantsWebSearch,
  buildSearchQueries,
  searchWeb,
  formatSearchResults,
  fetchPageExcerpt,
  isScrapeableUrl,
} = require('./webSearch');

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/** Extract URLs the user pasted (e.g. a Zillow listing link). */
function extractUrls(message) {
  return [...new Set(String(message || '').match(URL_RE) || [])]
    .filter(isScrapeableUrl);
}

function wantsUrlFetch(message) {
  return extractUrls(message).length > 0;
}

async function fetchUrlContext(message) {
  const urls = extractUrls(message);
  if (!urls.length) {
    return { matched: false, context: null, error: null, urls: [] };
  }
  // Fetch the first (most relevant) URL; return up to its visible text.
  const url = urls[0];
  const text = await fetchPageExcerpt(url);
  if (!text) {
    return {
      matched: true,
      context: null,
      error: `Could not fetch ${url}. The site may block automated access.`,
      urls,
    };
  }
  return {
    matched: true,
    context: [
      `[Web page fetched — ${url}]`,
      'Use ONLY the page content below for facts about this link.',
      '',
      text,
    ].join('\n'),
    error: null,
    urls,
  };
}

async function fetchWebContext(message) {
  if (wantsEmailFetch(message)) {
    return { matched: false, context: null, error: null, query: null };
  }

  // If the user pasted a URL, fetch it directly (no search needed).
  const urlResult = await fetchUrlContext(message);
  if (urlResult.matched) return urlResult;

  if (!wantsWebSearch(message)) {
    return { matched: false, context: null, error: null, query: null };
  }

  const queries = buildSearchQueries(message);
  const [primary, ...extra] = queries;
  try {
    const data = await searchWeb(primary, extra);
    const context = formatSearchResults(data);
    console.error('[continuum-bridge] web search:', data.provider, `hits=${data.results.length}`, data.query || primary);
    return { matched: true, context, error: null, query: data.query || primary, provider: data.provider };
  } catch (err) {
    console.error('[continuum-bridge] web search failed:', err.message);
    return {
      matched: true,
      context: null,
      error: `Web search failed: ${err.message}`,
      query: primary,
    };
  }
}

module.exports = { fetchWebContext, wantsUrlFetch, extractUrls, fetchUrlContext };
