const EMAIL_BLOCK = /\b(emails?|inbox|yahoo|imap|smtp|uid\b|clean\s*up|move\s+all\s+emails|from\s+\d{1,2}[\/\-]\d{1,2})\b/i;
const SEARCH_TIMEOUT_MS = 20000;
const PAGE_SCRAPE_MAX_CHARS = 2500;
const USER_AGENT = 'Mozilla/5.0 (compatible; ContinuumApp/1.0; +https://github.com/cai40/continuum-mobile)';

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

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export function wantsWebSearch(message) {
  const text = String(message || '').trim();
  if (!text || EMAIL_BLOCK.test(text)) return false;

  if (/\b(search the web|web search|search online|look up online|google)\b/i.test(text)) {
    return true;
  }

  const topic = /\b(soccer|football|nba|nfl|mlb|nhl|premier league|world cup|euro|olympics|tennis|formula 1|f1|norway|la liga|champions league|national team)\b/i;
  const live = /\b(latest|current|today|tonight|last night|yesterday|last week|this week|this weekend|live|score|scores|result|results|standings|who won|who beat|match|matches|game|games|weather|news|price|election)\b/i;
  const sportsOutcome = /\b(win|won|lose|lost|beat|beats|beating|played|playing|defeat|defeated)\b/i;

  if (live.test(text) && (topic.test(text) || /\?\s*$/.test(text))) return true;

  if (topic.test(text) && sportsOutcome.test(text)) return true;

  if (/\bdid\b/i.test(text) && sportsOutcome.test(text) && topic.test(text)) return true;

  if (/\bwhat happened\b/i.test(text) && topic.test(text)) return true;

  if (/\blast night\b/i.test(text) && topic.test(text)) return true;

  if (/\b(what is|what's|who is|who's|when is|how did|tell me about)\b/i.test(text) && live.test(text)) {
    return true;
  }

  if (/\b(find out|look up|lookup)\b/i.test(text) && !/\b(email|memory|continuum|inbox)\b/i.test(text)) {
    return true;
  }

  return false;
}

export function buildSearchQuery(message) {
  let q = String(message || '').trim();
  q = q.replace(/^(please\s+)?(search the web for|web search for|search for|look up|lookup|google)\s+/i, '');
  q = q.replace(/\?+$/, '').trim();
  if (!q) q = String(message || '').trim();

  if (/\blast night\b/i.test(q)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    q = q.replace(/\blast night\b/i, d.toISOString().slice(0, 10));
  }

  if (/\b(latest|current|today|score|result|match|news|standing|yesterday|win|won|lose|lost)\b/i.test(q) && !/\b20\d{2}\b/.test(q)) {
    q += ` ${new Date().getFullYear()}`;
  }
  return q;
}

function isLiveQuery(query) {
  return /\b(latest|current|today|tonight|last night|yesterday|last week|this week|live|score|scores|result|results|standings|news|weather|match|matches|who won|who beat|win|won|lose|lost|beat)\b/i.test(query);
}

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*',
        'User-Agent': USER_AGENT,
        ...headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseRssItems(xml) {
  const results = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && results.length < 6) {
    const block = match[1];
    const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim();
    const link = block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1]?.trim();
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
    const desc = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]?.trim();
    if (title && link) {
      const decodedDesc = decodeXmlEntities(desc || '');
      const snippet = stripHtml(decodedDesc).replace(/\s+/g, ' ').trim().slice(0, 400);
      results.push({
        title: decodeXmlEntities(stripHtml(title)),
        url: link.trim(),
        snippet,
        source: 'google_news',
        updated: pubDate,
      });
    }
  }
  return results;
}

async function searchGoogleNewsRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchText(url);
  const results = parseRssItems(xml);
  return { provider: 'google_news', results, query };
}

async function searchDuckDuckGoInstant(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const data = await fetchJson(url);
  const results = [];

  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: String(data.AbstractText).slice(0, 500),
      source: 'duckduckgo',
    });
  }

  for (const topic of data.RelatedTopics || []) {
    if (results.length >= 4) break;
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: String(topic.Text).split(' - ')[0] || topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text,
        source: 'duckduckgo',
      });
    } else if (topic.Topics) {
      for (const sub of topic.Topics) {
        if (results.length >= 4) break;
        if (sub.Text && sub.FirstURL) {
          results.push({
            title: sub.Text,
            url: sub.FirstURL,
            snippet: sub.Text,
            source: 'duckduckgo',
          });
        }
      }
    }
  }

  return { provider: 'duckduckgo', results, query };
}

async function searchBrave(query, apiKey) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`;
  const data = await fetchJson(url, {
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
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=6&origin=*`;
  const data = await fetchJson(searchUrl);
  const hits = data.query?.search || [];
  const results = [];

  for (const hit of hits.slice(0, 4)) {
    let extract = stripHtml(hit.snippet);
    try {
      const titleEnc = encodeURIComponent(hit.title.replace(/ /g, '_'));
      const summary = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${titleEnc}`);
      if (summary.extract) extract = summary.extract.slice(0, 500);
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

function isScrapeableUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u.startsWith('http')) return false;
  if (/news\.google\.com/.test(u)) return false;
  if (/duckduckgo\.com/.test(u)) return false;
  return true;
}

async function fetchPageExcerpt(url) {
  const target = String(url || '').trim();
  if (!isScrapeableUrl(target)) return '';

  try {
    const html = await fetchText(target);
    const metaDesc =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
      || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

    let text = metaDesc ? decodeXmlEntities(metaDesc[1]) : '';
    if (text.length < 200) {
      const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '');
      text = stripHtml(cleaned);
    }

    return text.slice(0, PAGE_SCRAPE_MAX_CHARS);
  } catch (err) {
    console.warn('[webSearch] page fetch failed:', target, err.message);
    return '';
  }
}

async function enrichResultsWithPageText(data, maxPages = 1) {
  if (!data?.results?.length) return data;

  const results = [...data.results];
  let scraped = false;

  let scrapedCount = 0;
  for (let i = 0; i < results.length && scrapedCount < maxPages; i++) {
    const row = results[i];
    if (row.pageExcerpt || !isScrapeableUrl(row.url)) continue;
    const excerpt = await fetchPageExcerpt(row.url);
    if (!excerpt || excerpt.length < 80) continue;
    scraped = true;
    scrapedCount += 1;
    results[i] = {
      ...row,
      pageExcerpt: excerpt,
      snippet: stripHtml(row.snippet || excerpt.slice(0, 400)),
    };
  }

  return {
    ...data,
    provider: scraped ? `${data.provider}+scrape` : data.provider,
    results,
  };
}

export async function searchWeb(query, braveApiKey = '') {
  const key = String(braveApiKey || '').trim();
  if (key) {
    try {
      const brave = await searchBrave(query, key);
      if (brave.results.length > 0) return enrichResultsWithPageText(brave);
    } catch (err) {
      console.warn('[webSearch] Brave failed:', err.message);
    }
  }

  if (isLiveQuery(query)) {
    try {
      const news = await searchGoogleNewsRss(query);
      if (news.results.length > 0) return enrichResultsWithPageText(news);
    } catch (err) {
      console.warn('[webSearch] Google News RSS failed:', err.message);
    }
  }

  try {
    const ddg = await searchDuckDuckGoInstant(query);
    if (ddg.results.length > 0) return enrichResultsWithPageText(ddg);
  } catch (err) {
    console.warn('[webSearch] DuckDuckGo failed:', err.message);
  }

  const wiki = await searchWikipedia(query);
  return enrichResultsWithPageText(wiki);
}

export function formatSearchResults({ provider, results, query }) {
  if (!results.length) {
    return [
      '[Web search — no results]',
      `Query: ${query}`,
      'No results returned. Try rephrasing or ask a more specific question.',
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
    if (row.pageExcerpt && row.pageExcerpt !== row.snippet) {
      lines.push(`   Page excerpt: ${row.pageExcerpt}`);
    }
    lines.push('');
  });

  return lines.join('\n').trim();
}

export async function fetchWebSearchContext(message, braveApiKey = '') {
  if (!wantsWebSearch(message)) return null;
  const query = buildSearchQuery(message);
  const data = await searchWeb(query, braveApiKey);
  return formatSearchResults(data);
}
