/**
 * Server-side page excerpt fetcher for the Continuum bridge.
 *
 * The mobile app fetches social profile pages directly, but pages like
 * LinkedIn's are ~800KB and processing them on-device can crash the app
 * (native OOM). This endpoint does the heavy fetch + extraction here on
 * Render instead and returns only the compact excerpt.
 */
const fs = require('fs');
const path = require('path');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 30000;
const MAX_EXCERPT_CHARS = 2500;

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

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*',
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Extract public LinkedIn profile data from server-rendered og tags + JSON-LD. */
function extractLinkedInProfile(html) {
  const lines = [];
  const grab = (re) => {
    const m = html.match(re);
    return m ? decodeEntities(m[1]).trim() : '';
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
      const notMasked = (s) => String(s || '').trim() && !/[*]/.test(s);
      if (person) {
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
          lines.push(d ? `- ${t}: ${d.slice(0, 240)}` : `- ${t}`);
        });
      }
    } catch (e) {
      // fall through to generic extraction
    }
  }
  return lines.join('\n');
}

/** Generic excerpt for any page: meta description, then visible text. */
function extractGeneric(html) {
  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
    || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  let text = metaDesc ? decodeEntities(metaDesc[1]) : '';
  if (text.length < 200) {
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');
    text = stripHtml(cleaned);
  }
  return text;
}

function isSafeUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!/^https?:\/\//i.test(u)) return false;
  if (u.includes('@')) return false; // no credentials in URL
  return true;
}

/**
 * Fetch a page and return a compact excerpt. Returns { excerpt } or throws.
 */
async function fetchPageExcerpt(url) {
  if (!isSafeUrl(url)) throw new Error('Invalid URL');
  const html = await fetchText(url);
  let text;
  if (/linkedin\.com\/(in|pub)\//i.test(url)) {
    text = extractLinkedInProfile(html);
  }
  if (!text) text = extractGeneric(html);
  const out = String(text || '').trim().slice(0, MAX_EXCERPT_CHARS);
  if (!out) throw new Error('No readable content');
  return out;
}

async function handleFetchExcerpt(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const url = parsed.searchParams.get('url') || '';
  try {
    const excerpt = await fetchPageExcerpt(url);
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ success: true, url, excerpt }),
    );
  } catch (err) {
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ success: false, url, error: err.message }),
    );
  }
}

module.exports = { handleFetchExcerpt, fetchPageExcerpt, isSafeUrl, stripHtml, decodeEntities };
