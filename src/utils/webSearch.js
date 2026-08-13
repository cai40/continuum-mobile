const EMAIL_BLOCK = /\b(emails?|inbox|yahoo|mail|imap|smtp|uid\b|clean\s*up|clean\b.*\b(emails?|inbox|mail)\b|\bfetch\b.*\b(emails?|mail|inbox)\b|move\s+all\s+emails|from\s+\d{1,2}[\/\-]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:\d{4}\s+)?emails?)\b/i;
const SEARCH_TIMEOUT_MS = 20000;
const PAGE_SCRAPE_MAX_CHARS = 2500;
// Real browser UA — sites like LinkedIn, Facebook, and many news sites serve
// a login/bot wall to the previous "ContinuumApp/1.0" bot UA and hide the
// public content they show to normal visitors.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
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

/** True when an assistant reply claims it has no internet / cannot search. */
export function isNoInternetClaim(reply) {
  const text = String(reply || '');
  return /\b(no|without|don'?t have|do not have|cannot|can'?t|lack|no longer have)\b[\s\S]{0,40}\b(internet|web|online|network)\b/i.test(text)
    || /\b(no|without|don'?t have|do not have|cannot|can'?t)\b[\s\S]{0,40}\b(access|connection|browse|search)\b[\s\S]{0,30}\b(internet|web|online)\b/i.test(text)
    || /\b(no live (data|info|information|updates)|offline (mode|data)|cannot search the web|can'?t search the web|no web search|no internet access|no internet connection)\b/i.test(text)
    || /(没有|无|不能|无法|没办)[^。！？\n]{0,12}(互联网|网络|上网|联网|在线|实时数据|实时信息|实时资讯)/i.test(text)
    || /(无法访问互联网|无法联网|不能上网|没有网络|没有互联网|离线模式|无法实时)/i.test(text);
}

export function wantsWebSearch(message) {
  const text = String(message || '').trim();
  if (!text || EMAIL_BLOCK.test(text)) return false;

  // A pasted URL (e.g. a Zillow listing) should be fetched directly.
  if (/https?:\/\/[^\s<>"']+/i.test(text)) return true;

  // Any explicit "search ..." request is a web search: "search my name on
  // linkedin", "search for iphone 17 price", "search it". EMAIL_BLOCK above
  // already excludes email searches ("search my emails").
  if (/\b(search|searches|searching|searched|searching for)\b/i.test(text)) {
    return true;
  }

  // Opening / reading a profile on a named site is a web request:
  // "open my linkedin profile", "find my github", "what does my linkedin say".
  const siteMention = /\b(linkedin|facebook|instagram|twitter|x|github|youtube|reddit|tiktok|weibo)\b/i;
  const profileIntent = /\b(search|find|look up|lookup|open|read|show|see|view|get|profile|page|my name|my profile|say|says|about|mention)\b/i;
  if (siteMention.test(text) && (profileIntent.test(text) || /\b(what|how|is|are|does|do|show|tell)\b/i.test(text))) {
    return true;
  }

  if (/\b(search the web|web search|search online|look up online|google)\b/i.test(text)) {
    return true;
  }

  // Weather / current conditions are always live — no question mark or
  // sports topic required: "how is weather now", "weather in new york",
  // "is it raining outside", "forecast tomorrow".
  if (/\b(weather|forecast|temperature|rain(?:y|ing)?|snow(?:y|ing)?|sunny|cloudy|windy|humid|storm)\b/i.test(text)) {
    return true;
  }

  const topic = /\b(soccer|football|nba|nfl|mlb|nhl|premier league|world cup|euro|olympics|tennis|formula 1|f1|norway|la liga|champions league|national team|bitcoin|crypto|stock|stocks|market|etf)\b/i;
  const live = /\b(latest|current|today|tonight|last night|yesterday|last week|this week|this weekend|live|score|scores|result|results|standings|who won|who beat|match|matches|game|games|weather|news|price|prices|election|rate|rates|exchange|opening|closing|hours)\b/i;
  const sportsOutcome = /\b(win|won|lose|lost|beat|beats|beating|played|playing|defeat|defeated)\b/i;

  if (live.test(text) && (topic.test(text) || /\?\s*$/.test(text))) return true;

  // "who won the game last night", "what's the score", "did X win"
  if (/\b(who won|what('s| is) (the )?score|what was the score|did\s+\w+\s+(win|beat))\b/i.test(text) && live.test(text)) return true;

  if (topic.test(text) && sportsOutcome.test(text)) return true;

  if (/\bdid\b/i.test(text) && sportsOutcome.test(text) && topic.test(text)) return true;

  if (/\bwhat happened\b/i.test(text) && topic.test(text)) return true;

  if (/\blast night\b/i.test(text) && topic.test(text)) return true;

  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i.test(text) && topic.test(text)) {
    return true;
  }

  if (/\b\w+\s+vs\.?\s+\w+\b/i.test(text) && topic.test(text)) return true;

  if (/\b(what is|what's|who is|who's|when is|how did|tell me about)\b/i.test(text) && live.test(text)) {
    return true;
  }

  if (/\b(find out|look up|lookup)\b/i.test(text) && !/\b(email|memory|continuum|inbox)\b/i.test(text)) {
    return true;
  }

  // General "needs the internet" net: any question that asks about a current
  // state, an event, a place, a person's latest status, prices, or dates that
  // isn't clearly answerable offline. The no-internet-claim fallback in chat
  // catches anything this misses.
  const isQuestion = /\b(what|when|where|who|which|why|how|is|are|was|were|will|would|can|could|should|did|does|do)\b/i.test(text);
  const timeSensitive = /\b(today|tonight|now|right now|current|latest|recent|yesterday|last night|this week|this weekend|upcoming|live|news|breaking|price|prices|cost|stock|market|rate|exchange|election|score|result|winner|schedule|time|date|202\d|updating|new|changed|happening|happens|going on)\b/i;
  const offlineOnly = /^(hi|hello|hey|thanks|thank you|good (morning|afternoon|evening)|how are you|how'?s it going|what'?s up|how was your day)\b/i.test(text)
    || /\b(my name|my email|my password|my birthday|how old am i|what is love|meaning of life|2\+2|math|translate)\b/i.test(text)
    || /\b(who are you|what are you|what can you do|which model are you|what model are you)\b/i.test(text)
    || /\b(what time is it|what'?s the time|what day is it|what'?s today'?s date|what'?s the date)\b/i.test(text);

  // Calendar / scheduling questions need current info: "when is the next
  // solar eclipse", "what time does the store close", "when does it release".
  if (/\bwhen\s+(is|does|will|was|are)\b/i.test(text)
    && /\b(next|open|close|start|end|release|launch|air|premiere|eclipse|holiday|event|game|match)\b/i.test(text)) {
    return true;
  }

  // Chinese (and other CJK) live/current intents. CJK has no ASCII word
  // boundaries, so match literal keywords: 今天有什么新闻 (what news today),
  // 今天天气 (today's weather), 股票/汇率/比分, etc.
  if (/[\u4e00-\u9fff]/.test(text)) {
    const cnLive = /(今天|明天|现在|目前|最新|最近|近期|刚刚|昨晚|昨天晚上|昨天|今晚|本周|这周|新闻|热点|要闻|天气|气温|会不会下雨|会不会下雪|下雪|下雨|股票|股市|大盘|股价|金价|油价|价格|房价|汇率|利率|比分|比赛|赛果|战报|结果|选举|总统|发生了什么|有什么新闻|多少钱|涨了|跌了|谁赢了|谁赢)/;
    const cnOffline = /(你好|您好|谢谢|感谢|你是谁|你能做什么|你会什么|我的名字|我叫|我的生日|我几岁|我爱你|现在几点|几点了|今天几号|今天是几号|翻译|算术|数学|帮我算|讲个笑话)/;
    if (cnLive.test(text) && !cnOffline.test(text)) return true;
  }

  if (isQuestion && timeSensitive.test(text) && !offlineOnly) return true;

  if (timeSensitive.test(text) && /\b(latest|current|today|tonight|now|news|price)\b/i.test(text) && !offlineOnly) return true;

  return false;
}

export function buildSearchQuery(message) {
  let q = String(message || '').trim();

  // Strip conversational filler: "search the web for", "can you search",
  // "try to find", "read my name", "open my profile", etc.
  q = q.replace(/^(please\s+)?(can|could|would|will)\s+you\s+(try\s+to\s+)?/i, '');
  q = q.replace(/^(please\s+)?(search the web for|web search for|search for|look up|lookup|google|search online for|find)\s+/i, '');
  q = q.replace(/^search\s+my\s+name\s+(?:is\s+)?/i, '');
  q = q.replace(/^my\s+name\s+(?:is\s+)?/i, '');
  q = q.replace(/^find\s+my\s+(?:name\s+)?/i, '');
  // "read my name", "show my name", "open my profile", "tell me about ..."
  q = q.replace(/^(read|open|show|get|view|see|find|tell\s+me\s+about|what\s+does|what\s+is|what'?s)\s+(my\s+)?(name|profile|page)\s+(?:is\s+)?/i, '');
  q = q.replace(/^(read|open|show|get|view)\s+/i, '');

  // "search <term> on <site>" — keep the term, site is handled by
  // buildSearchQueries (site: operator). Drop common trailing site words
  // so the raw query stays clean.
  q = q.replace(/\s+on\s+(linkedin|facebook|instagram|twitter|x|github|youtube|google|amazon|reddit|tiktok|weibo)\s*$/i, '');
  q = q.replace(/\s+(on|at|via)\s+(linkedin|facebook|instagram|twitter|x|github|youtube|google|amazon|reddit|tiktok|weibo)\s*$/i, '');

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
  // Weather doesn't need the current year appended (it also hurts results).
  if (/\bweather|forecast\b/i.test(q)) {
    q = q.replace(/\s+\d{4}$/, '').trim();
  }
  return q;
}

const SITE_DOMAINS = {
  linkedin: 'linkedin.com',
  facebook: 'facebook.com',
  instagram: 'instagram.com',
  twitter: 'twitter.com',
  x: 'twitter.com',
  github: 'github.com',
  youtube: 'youtube.com',
  google: 'google.com',
  amazon: 'amazon.com',
  reddit: 'reddit.com',
  tiktok: 'tiktok.com',
  weibo: 'weibo.com',
};

/** When the user says "search <name> on linkedin", build a site-scoped query. */
export function buildSiteScopedQuery(message) {
  const text = String(message || '').trim();
  const m = text.match(/\bon\s+(linkedin|facebook|instagram|twitter|x|github|youtube|google|amazon|reddit|tiktok|weibo)\b/i);
  if (!m) return null;
  const domain = SITE_DOMAINS[m[1].toLowerCase()];
  if (!domain) return null;
  const base = buildSearchQuery(text);
  if (!base) return null;
  // Names are more precise quoted and site-scoped.
  return `"${base}" site:${domain}`;
}

/**
 * For "read <name> on linkedin", construct likely public profile URLs and try
 * them directly — more reliable than search (search engines can be slow,
 * rate-limited, or only return LinkedIn's directory page).
 */

/** Pull the person's name out of a profile request ("read yongyao cai on linkedin"). */
export function extractProfileName(message) {
  let text = String(message || '').trim();
  if (!text) return '';
  // Strip the site word + "on"/"at".
  text = text
    .replace(/\s+(?:on|at|via)\s+(linkedin|github|twitter|x|facebook|instagram)\b.*$/i, '')
    .trim();
  // Strip leading intent verbs + optional "my name is" / "my profile".
  text = text
    .replace(/^(?:please\s+)?(?:can|could|would|will|do|did)\s+you\s+/i, '')
    .replace(/^(?:search|look up|lookup|read|open|show|get|view|see|find|check|pull up|tell me about|what does|what is|what'?s)\s+/i, '')
    .replace(/^(?:my\s+)?(?:name|profile|page)\s+(?:is\s+)?/i, '')
    .replace(/^(?:my\s+)?name\s+/i, '')
    .replace(/^for\s+/i, '')
    .trim();
  // Remove leftover generic words that aren't part of a name.
  text = text.replace(/\b(?:please|now|first|up|for\s+me|online)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return text;
}

export function buildProfileCandidateUrls(message) {
  const text = String(message || '').trim();
  const siteMatch = text.match(/\bon\s+(linkedin|github|twitter|x)\b/i);
  if (!siteMatch) return [];
  const site = siteMatch[1].toLowerCase();
  const name = extractProfileName(text).trim();
  if (!name || name.split(/\s+/).length > 4) return [];

  const slug = name
    .toLowerCase()
    .replace(/\b(?:mr|ms|dr)\b\.?/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Split into first/last for common handle forms (e.g. yongyaocai, yongyao-cai).
  const parts = slug.split('-').filter(Boolean);
  const joined = parts.join('');
  const withDash = parts.join('-');

  const urls = [];
  if (site === 'linkedin') {
    const candidates = [slug, joined, withDash, `${parts[0] || ''}${parts[1] || ''}`, `${parts[0] || ''}-${parts.slice(1).join('')}`];
    for (const c of [...new Set(candidates.filter(Boolean))]) {
      urls.push(`https://www.linkedin.com/in/${encodeURIComponent(c)}`);
    }
  } else if (site === 'github') {
    urls.push(`https://github.com/${encodeURIComponent(slug)}`);
    urls.push(`https://github.com/${encodeURIComponent(joined)}`);
  } else if (site === 'twitter' || site === 'x') {
    const handle = text.match(/@([A-Za-z0-9_]{1,15})/) ? text.match(/@([A-Za-z0-9_]{1,15})/)[1] : slug;
    urls.push(`https://twitter.com/${encodeURIComponent(handle)}`);
    urls.push(`https://x.com/${encodeURIComponent(handle)}`);
  }

  return [...new Set(urls)];
}

/**
 * Try to fetch a social profile directly (LinkedIn/GitHub/Twitter) before
 * falling back to general web search. Returns a context block or null.
 */
let lastProfileContext = null;

export function getCachedProfileContext() {
  return lastProfileContext;
}

/** "can you see my profile", "what does my profile say", "is my profile there" */
export function isProfileFollowUp(message) {
  const text = String(message || '').trim();
  return /\b(profile|linkedin|github|page)\b/i.test(text)
    && /\b(can|could|do|does|did|what|see|read|view|look|find|show|open|access|say|says|still|now)\b/i.test(text)
    && !/\bon\s+(linkedin|github|twitter|x|facebook|instagram)\b/i.test(text);
}

export async function fetchProfileDirectly(message, braveApiKey = '') {
  const urls = buildProfileCandidateUrls(message);
  for (const url of urls) {
    try {
      const excerpt = await fetchPageExcerpt(url);
      if (excerpt && excerpt.length > 60) {
        const ctx = [
          `[Web page fetched — ${url}]`,
          'Use ONLY the page content below for facts about this profile.',
          'Do NOT say you need to log in or that the profile is inaccessible — its content is provided here.',
          '',
          excerpt,
        ].join('\n');
        lastProfileContext = ctx;
        return ctx;
      }
    } catch (err) {
      console.warn('[webSearch] direct profile fetch failed:', url, err?.message || err);
    }
  }
  return null;
}

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

export function buildSearchQueries(message) {
  const text = String(message || '');
  // Site-scoped ("search my name on linkedin") becomes the lead query.
  const siteQuery = buildSiteScopedQuery(text);
  const queries = siteQuery ? [siteQuery, buildSearchQuery(text)] : [buildSearchQuery(text)];

  const dateLong = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (dateLong) {
    const month = MONTHS[dateLong[1].toLowerCase()];
    const day = String(dateLong[2]).padStart(2, '0');
    const iso = `${dateLong[3]}-${month}-${day}`;
    if (/\bnorway\b/i.test(text)) queries.push(`Norway Brazil World Cup ${iso} result score`);
    if (/\bbrazil\b/i.test(text)) queries.push(`Brazil Norway World Cup ${iso} result score`);
  }

  if (/\bnorway\b/i.test(text)) {
    queries.push('Norway Brazil World Cup 2026 result score');
  }

  const vsMatch = text.match(/\b([A-Za-z]+)\s+vs\.?\s+([A-Za-z]+)\b/i);
  if (vsMatch) {
    queries.push(`${vsMatch[1]} ${vsMatch[2]} World Cup 2026 result score`);
  }

  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

function hasActionableResults(results) {
  if (!results?.length) return false;
  const text = results.map((r) => `${r.title} ${r.snippet || ''}`).join(' ');
  if (/\d{1,2}\s*[-–]\s*\d{1,2}/.test(text)) return true;
  if (/\b(beat|defeat|won|win|loss|lost|eliminated|advanced|stun|upset|brace|knock(?:ed)? out|distraught)\b/i.test(text)) return true;
  return false;
}

function extractHeadlineHints(results) {
  const hints = [];
  const seen = new Set();
  for (const row of results || []) {
    const title = String(row.title || '').trim();
    if (!title || seen.has(title)) continue;
    const blob = `${title} ${row.snippet || ''}`;
    if (/\d{1,2}\s*[-–]\s*\d{1,2}/.test(blob) || /\b(beat|defeat|won|win|loss|lost|eliminated|advanced|stun|upset|brace|knock(?:ed)? out|distraught)\b/i.test(blob)) {
      seen.add(title);
      hints.push(title);
    }
  }
  return hints.slice(0, 5);
}

function isLiveQuery(query) {
  return /\b(latest|current|today|tonight|last night|yesterday|last week|this week|live|score|scores|result|results|standings|news|weather|match|matches|who won|who beat|win|won|lose|lost|beat|now)\b/i.test(query)
    || /(新闻|天气|气温|比分|比赛|结果|股票|股市|汇率|利率|价格|选举|今天|最新|最近|发生了什么|谁赢了|热点|资讯)/.test(query);
}

function isWeatherQuery(query) {
  return /\b(weather|forecast|temperature|rain|snow|sunny|cloudy)\b/i.test(query)
    || /(天气|气温|会不会下雨|下雪|下雨|温度|降雨)/.test(query);
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

/** DuckDuckGo HTML search — full general web results (no API key). */
function decodeDuckDuckGoUrl(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const m = raw.match(/[?&]uddg=([^&]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return '';
    }
  }
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
}

function parseDuckDuckGoHtml(html) {
  const results = [];
  const blocks = String(html || '').split(/class="result results_links/);
  for (const block of blocks.slice(1)) {
    const aMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!aMatch) continue;
    const url = decodeDuckDuckGoUrl(aMatch[1]);
    const title = stripHtml(aMatch[2]).replace(/\s+/g, ' ').trim();
    // Skip paid/ads results — their redirect URLs are useless click-trackers.
    if (!url || !title || /duckduckgo\.com\/y\.js/i.test(url) || /ad_domain=/i.test(url)) continue;
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch
      ? stripHtml(snippetMatch[1]).replace(/\s+/g, ' ').trim().slice(0, 400)
      : '';
    results.push({ title, url, snippet, source: 'duckduckgo' });
    if (results.length >= 8) break;
  }
  return results;
}

async function searchDuckDuckGoHtml(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return { provider: 'duckduckgo', results: parseDuckDuckGoHtml(html), query };
  } finally {
    clearTimeout(timer);
  }
}

/** Merge several result sources into one list, deduped by URL. */
function mergeSearchSources(sources, query) {
  const seen = new Set();
  const results = [];
  for (const src of sources) {
    for (const row of src?.results || []) {
      const key = String(row?.url || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push(row);
      if (results.length >= 10) break;
    }
    if (results.length >= 10) break;
  }
  const provider = (sources.map((s) => s?.provider).filter(Boolean).join('+')) || 'web';
  return { provider, results, query };
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
  if (/duckduckgo\.com\/y\.js/.test(u)) return false;
  // LinkedIn directory pages always return 999 and contain no profile data.
  if (/linkedin\.com\/pub\//.test(u)) return false;
  return true;
}

function decodeBasicEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

/**
 * LinkedIn public profiles hide About/Experience behind JS, but with a real
 * browser UA the page ships og:title/og:description plus a JSON-LD Person
 * block (name, location, employer, languages, followers) and the member's
 * articles/publications. Extract those server-rendered fields.
 */
async function fetchLinkedInProfileExcerpt(url) {
  const html = await fetchText(url);
  const lines = [];

  const grab = (re) => {
    const m = html.match(re);
    return m ? decodeBasicEntities(m[1]).trim() : '';
  };

  const title = grab(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || grab(/<title>([\s\S]*?)<\/title>/i);
  const desc = grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (title) lines.push(`Profile: ${title}`);
  if (desc) lines.push(desc);

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (ld) {
    try {
      const graph = JSON.parse(ld[1]);
      const items = Array.isArray(graph['@graph']) ? graph['@graph'] : [];
      const person = items.find((i) => i['@type'] === 'Person');
      if (person) {
        const notMasked = (s) => String(s || '').trim() && !/[*]/.test(s);
        if (notMasked(person.name)) lines.push(`Name: ${person.name}`);
        const titles = (Array.isArray(person.jobTitle) ? person.jobTitle : [])
          .map((t) => String(t || '').trim()).filter(notMasked);
        if (titles.length) lines.push(`Job titles: ${titles.join(', ')}`);
        const orgs = (Array.isArray(person.worksFor) ? person.worksFor : [])
          .map((w) => w?.name).filter(notMasked);
        if (orgs.length) lines.push(`Experience at: ${orgs.join(', ')}`);
        const loc = person.address?.addressLocality || person.address?.addressCountry;
        if (loc) lines.push(`Location: ${loc}`);
        const langs = (Array.isArray(person.knowsLanguage) ? person.knowsLanguage : [])
          .map((l) => l?.name).filter(Boolean);
        if (langs.length) lines.push(`Languages: ${langs.join(', ')}`);
        const follows = person.interactionStatistic?.userInteractionCount;
        if (follows != null) lines.push(`Followers: ${follows}`);
        if (notMasked(person.description)) lines.push(`About: ${person.description}`);
      }

      const posts = items.filter((i) => i['@type'] === 'Article' || i['@type'] === 'PublicationIssue');
      if (posts.length) {
        lines.push(`Posts & publications (${posts.length}):`);
        posts.slice(0, 5).forEach((a) => {
          const t = a.name || a.headline || '';
          const d = String(a.description || '').trim();
          if (d) lines.push(`- ${t}: ${d.slice(0, 240)}`);
          else lines.push(`- ${t}`);
        });
      }
    } catch (e) {
      console.warn('[webSearch] linkedin ld+json parse failed:', e.message);
    }
  }

  return lines.length ? lines.join('\n').slice(0, PAGE_SCRAPE_MAX_CHARS) : '';
}

async function fetchPageExcerpt(url) {
  const target = String(url || '').trim();
  if (!isScrapeableUrl(target)) return '';

  try {
    // LinkedIn needs a dedicated extractor — its public profile data ships in
    // og tags + JSON-LD, not the visible DOM.
    if (/linkedin\.com\/(in|pub)\//i.test(target)) {
      try {
        const li = await fetchLinkedInProfileExcerpt(target);
        if (li) return li;
      } catch (err) {
        console.warn('[webSearch] linkedin fetch failed:', target, err.message);
      }
    }

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

  // When someone searches a person, the LinkedIn profile is the page they
  // want read — scrape it first even if it isn't the top result.
  const linkedInProfile = results.find((r) => /linkedin\.com\/in\//i.test(r.url || ''));

  const rowsToScrape = [];
  if (linkedInProfile) rowsToScrape.push(linkedInProfile);
  for (const row of results) {
    if (rowsToScrape.length >= maxPages) break;
    if (row === linkedInProfile) continue;
    rowsToScrape.push(row);
  }

  let scrapedCount = 0;
  for (const row of rowsToScrape) {
    if (scrapedCount >= maxPages) break;
    if (row.pageExcerpt || !isScrapeableUrl(row.url)) continue;
    const excerpt = await fetchPageExcerpt(row.url);
    if (!excerpt || excerpt.length < 80) continue;
    scraped = true;
    scrapedCount += 1;
    const idx = results.indexOf(row);
    results[idx] = {
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

/** A result set "finds the person" when it contains a real social profile page. */
function hasProfileResult(results) {
  return Array.isArray(results) && results.some((r) =>
    /(linkedin\.com\/in\/|facebook\.com\/[^/\s]+\/?$|instagram\.com\/[^/\s]+\/?$|twitter\.com\/[A-Za-z0-9_]+\/?$|x\.com\/[A-Za-z0-9_]+\/?$|github\.com\/[A-Za-z0-9_-]+)$/i.test(r.url || ''));
}

/** LinkedIn directory pages are dead-ends — prefer real /in/ profiles. */
function isDeadEndResultSet(results) {
  return Array.isArray(results) && results.length > 0
    && results.every((r) => /linkedin\.com\/pub\//i.test(r.url || ''));
}

export async function searchWeb(query, braveApiKey = '', extraQueries = []) {
  const allQueries = [...new Set([query, ...extraQueries].map((q) => String(q || '').trim()).filter(Boolean))];
  let best = null;

  for (const q of allQueries) {
    const data = await searchWebOnce(q, braveApiKey);
    if (!data.results?.length) continue;
    const isDeadEnd = isDeadEndResultSet(data.results);
    if (isDeadEnd) continue;
    const bestIsDeadEnd = best && isDeadEndResultSet(best.results);
    if (!best || (!bestIsDeadEnd && hasActionableResults(data.results) && !hasActionableResults(best.results))) {
      best = { ...data, query: q };
    }
    if (hasActionableResults(data.results)) return { ...data, query: q };
    // When searching for a person/site, a result set with the real profile
    // page beats a set with only directory/aggregator pages.
    if (hasProfileResult(data.results)) return { ...data, query: q };
  }

  if (best) return best;
  return searchWebOnce(allQueries[0] || query, braveApiKey);
}

async function searchWebOnce(query, braveApiKey = '') {
  const key = String(braveApiKey || '').trim();
  if (key) {
    try {
      const brave = await searchBrave(query, key);
      if (brave.results.length > 0) return enrichResultsWithPageText(brave);
    } catch (err) {
      console.warn('[webSearch] Brave failed:', err.message);
    }
  }

  // Weather is best served by DuckDuckGo's instant-answer card (current
  // conditions for a city), so prefer it over broad search for these.
  if (isWeatherQuery(query)) {
    try {
      const ddg = await searchDuckDuckGoInstant(query);
      if (ddg.results.length > 0) return enrichResultsWithPageText(ddg);
    } catch (err) {
      console.warn('[webSearch] DuckDuckGo failed:', err.message);
    }
  }

  // Broad general web search via DuckDuckGo HTML. For live/news queries,
  // Google News RSS is tried first and its headlines lead the merged list,
  // with general web pages (prices, docs, official sites) following.
  const isLive = isLiveQuery(query);
  const sources = [];
  if (isLive) {
    try {
      const news = await searchGoogleNewsRss(query);
      if (news.results.length > 0) sources.push(news);
    } catch (err) {
      console.warn('[webSearch] Google News RSS failed:', err.message);
    }
  }
  try {
    const html = await searchDuckDuckGoHtml(query);
    if (html.results.length > 0) sources.push(html);
  } catch (err) {
    console.warn('[webSearch] DuckDuckGo HTML failed:', err.message);
  }

  if (sources.length) {
    const merged = mergeSearchSources(sources, query);
    if (merged.results.length > 0) return enrichResultsWithPageText(merged);
  }

  if (isLive) {
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
    'The content you need is provided below — you do NOT need to log in, have an account, or use credentials to read any of it.',
    'Answer directly from the results. Do NOT say "no results", "no internet", or that you cannot access a site (e.g. LinkedIn) — its content is right here.',
    '',
  ];

  const hints = extractHeadlineHints(results);
  if (hints.length) {
    lines.push('KEY HEADLINES — state the outcome/score from these:');
    hints.forEach((h) => lines.push(`- ${h}`));
    lines.push('');
  }

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

const WEATHER_CODE_LABELS = {
  0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm',
};

/**
 * Live current weather for the user's coordinates via Open-Meteo (no key).
 * Returns null if location is unavailable or the API fails, so the caller
 * falls back to a normal web search.
 */
export async function fetchLocalWeather(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m'
    + '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto';
  try {
    const data = await fetchJson(url);
    const c = data?.current;
    if (!c || c.temperature_2m == null) return null;
    const label = WEATHER_CODE_LABELS[c.weather_code] || 'Unknown conditions';
    return [
      '[Local weather — live]',
      `Location: ${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      `Conditions: ${label}`,
      `Temperature: ${Math.round(c.temperature_2m)}°F (feels like ${Math.round(c.apparent_temperature ?? c.temperature_2m)}°F)`,
      `Humidity: ${c.relative_humidity_2m ?? 'n/a'}%`,
      `Wind: ${c.wind_speed_10m ?? 'n/a'} mph`,
      c.precipitation ? `Precipitation: ${c.precipitation} mm` : 'Precipitation: none',
      `Updated: ${new Date().toISOString()}`,
      '',
      'Answer the user\'s weather question from these live conditions.',
    ].join('\n');
  } catch (err) {
    console.warn('[webSearch] weather API failed:', err.message);
    return null;
  }
}

export async function fetchWebSearchContext(message, braveApiKey = '') {
  try {
    return await fetchWebSearchContextUnsafe(message, braveApiKey);
  } catch (err) {
    // Never let a web-search failure crash the chat flow — treat it as
    // "no context" so the model answers normally.
    console.warn('[webSearch] context build failed:', err?.message || err);
    return null;
  }
}

/**
 * Agent behavior: when an error is unknown, search the web for what it means
 * and return a readable summary. Returns null if nothing useful is found.
 */
export async function lookUpErrorOnline(errorText, braveApiKey = '') {
  let q = String(errorText || '').trim().replace(/["'\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  if (q.length > 120) q = q.slice(0, 120);
  try {
    const data = await searchWeb(q, braveApiKey, []);
    if (!data?.results?.length) return null;
    return formatSearchResults(data);
  } catch (err) {
    console.warn('[webSearch] error lookup failed:', err?.message || err);
    return null;
  }
}

async function fetchWebSearchContextUnsafe(message, braveApiKey = '') {
  if (!wantsWebSearch(message)) return null;

  // If the user pasted a URL, fetch it directly instead of searching.
  const urls = [...new Set(String(message || '').match(/https?:\/\/[^\s<>"']+/gi) || [])]
    .filter(isScrapeableUrl);
  if (urls.length) {
    const url = urls[0];
    const text = await fetchPageExcerpt(url);
    if (!text) return `[Web page fetch failed]\nCould not fetch ${url}.`;
    return [
      `[Web page fetched — ${url}]`,
      'Use ONLY the page content below for facts about this link.',
      '',
      text,
    ].join('\n');
  }

  // "read <name> on linkedin/github/twitter" → try direct profile URLs first
  // (search engines often only surface LinkedIn's directory page).
  if (/on\s+(linkedin|github|twitter|x)\b/i.test(String(message || ''))) {
    const direct = await fetchProfileDirectly(message, braveApiKey);
    if (direct) return direct;
    // Direct fetch failed — do a targeted search and pull the actual profile
    // page out of the results if one exists.
    const name = extractProfileName(message);
    const profileSearch = await searchWeb(`"${name}" ${/linkedin/i.test(message) ? 'site:linkedin.com/in' : ''}`.trim(), braveApiKey, []);
    const profileRow = (profileSearch?.results || []).find((r) => /linkedin\.com\/in\/|github\.com\/|twitter\.com\/|x\.com\//i.test(r.url || ''));
    if (profileRow && profileRow.url) {
      try {
        const excerpt = await fetchPageExcerpt(profileRow.url);
        if (excerpt && excerpt.length > 60) {
          const ctx = [
            `[Web page fetched — ${profileRow.url}]`,
            'Use ONLY the page content below for facts about this profile.',
            'Do NOT say you need to log in or that the profile is inaccessible — its content is provided here.',
            '',
            excerpt,
          ].join('\n');
          lastProfileContext = ctx;
          return ctx;
        }
      } catch (err) {
        console.warn('[webSearch] profile row fetch failed:', profileRow.url, err?.message || err);
      }
    }
    return [
      `[Could not retrieve the profile]`,
      `The app could not load the ${name ? `"${name}" ` : ''}profile from LinkedIn (the site blocks automated requests).`,
      'Ask the user to paste their public profile URL (linkedin.com/in/...) and the app will read it directly.',
    ].join('\n');
  }

  const queries = buildSearchQueries(message);
  const [primary, ...extra] = queries;
  const data = await searchWeb(primary, braveApiKey, extra);
  return formatSearchResults(data);
}
