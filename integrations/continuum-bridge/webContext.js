'use strict';

const { wantsEmailFetch } = require('./emailFetchOptions');
const {
  wantsWebSearch,
  buildSearchQueries,
  searchWeb,
  formatSearchResults,
} = require('./webSearch');

async function fetchWebContext(message) {
  if (wantsEmailFetch(message)) {
    return { matched: false, context: null, error: null, query: null };
  }
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

module.exports = { fetchWebContext };
