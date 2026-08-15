const fs = require('fs');
const vm = require('vm');

function loadWebSearch() {
  let src = fs.readFileSync('src/utils/webSearch.js', 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, fetch: global.fetch, AbortController, Date, URL, URLSearchParams };
  src = src
    .replace(/export function wantsWebSearch/, 'function wantsWebSearch')
    .replace(/export function isNoInternetClaim/, 'function isNoInternetClaim')
    .replace(/export function buildSearchQuery/, 'function buildSearchQuery')
    .replace(/export function buildSiteScopedQuery/, 'function buildSiteScopedQuery')
    .replace(/export function buildSearchQueries/, 'function buildSearchQueries')
    .replace(/export async function searchWeb\(/, 'async function searchWeb(')
    .replace(/export function formatSearchResults/, 'function formatSearchResults')
    .replace(/export async function fetchLocalWeather/, 'async function fetchLocalWeather')
    .replace(/export async function lookUpErrorOnline/, 'async function lookUpErrorOnline')
    .replace(/export async function fetchWebSearchContext/, 'async function fetchWebSearchContext');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

(async () => {
  const s = loadWebSearch();
  const phrases = [
    'read my name yongyao cai on linkedin',
    'can you see my profile',
    'search my name yongyao cai on linkedin',
  ];
  for (const msg of phrases) {
    const triggers = s.wantsWebSearch(msg);
    const ctx = triggers ? await s.fetchWebSearchContext(msg, null) : null;
    const hasProfile = ctx ? /Profile: Yongyao|linkedin\.com\/in\//i.test(ctx) : false;
    console.log('---', JSON.stringify(msg));
    console.log('  triggers search:', triggers);
    if (ctx) {
      console.log('  ctx len:', ctx.length, '| has profile:', hasProfile);
      console.log('  head:', ctx.slice(0, 200).replace(/\n/g, ' | '));
    } else {
      console.log('  no context');
    }
  }
})().catch((e) => {
  console.error('ERROR:', e && e.stack);
  process.exit(1);
});
