'use strict';

const {
  wantsWebSearch,
  buildSearchQuery,
  searchWeb,
  formatSearchResults,
} = require('./webSearch');

async function fetchWebContext(message) {
  if (!wantsWebSearch(message)) {
    return { matched: false, context: null, error: null, query: null };
  }

  const query = buildSearchQuery(message);
  try {
    const data = await searchWeb(query);
    const context = formatSearchResults(data);
    console.error('[continuum-bridge] web search:', data.provider, `hits=${data.results.length}`, query);
    return { matched: true, context, error: null, query, provider: data.provider };
  } catch (err) {
    console.error('[continuum-bridge] web search failed:', err.message);
    return {
      matched: true,
      context: null,
      error: `Web search failed: ${err.message}`,
      query,
    };
  }
}

module.exports = { fetchWebContext };
