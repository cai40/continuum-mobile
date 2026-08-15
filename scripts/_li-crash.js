const fs = require('fs');
const vm = require('vm');

function load() {
  let src = fs.readFileSync('src/utils/webSearch.js', 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, fetch: global.fetch, AbortController, Date, URL, URLSearchParams };
  src = src
    .replace(/export function wantsWebSearch/, 'function wantsWebSearch')
    .replace(/export function isNoInternetClaim/, 'function isNoInternetClaim')
    .replace(/export function buildSearchQuery/, 'function buildSearchQuery')
    .replace(/export function buildSiteScopedQuery/, 'function buildSiteScopedQuery')
    .replace(/export function buildProfileCandidateUrls/, 'function buildProfileCandidateUrls')
    .replace(/export function extractProfileName/, 'function extractProfileName')
    .replace(/export async function fetchProfileDirectly/, 'async function fetchProfileDirectly')
    .replace(/export function isProfileFollowUp/, 'function isProfileFollowUp')
    .replace(/export function getCachedProfileContext/, 'function getCachedProfileContext')
    .replace(/export function buildSearchQueries/, 'function buildSearchQueries')
    .replace(/export async function lookUpErrorOnline/, 'async function lookUpErrorOnline')
    .replace(/export async function searchWeb\(/, 'async function searchWeb(')
    .replace(/export function formatSearchResults/, 'function formatSearchResults')
    .replace(/export async function fetchLocalWeather/, 'async function fetchLocalWeather')
    .replace(/export async function fetchWebSearchContext/, 'async function fetchWebSearchContext');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

(async () => {
  const s = load();
  console.log('--- test: direct profile fetch (success path) ---');
  try {
    const ctx = await s.fetchWebSearchContext('read my name yongyao cai on linkedin', null);
    console.log('success len:', ctx ? ctx.length : 0, '| profile:', ctx ? /Name: Yongyao/.test(ctx) : false);
  } catch (e) {
    console.error('CRASH in success path:', e && e.stack);
  }

  console.log('--- test: forced fallback path (profile fetch fails) ---');
  try {
    // Use a name that won't resolve to test the fallback branch.
    const ctx = await s.fetchWebSearchContext('read my name zzzqqqxnonexistent123 on linkedin', null);
    console.log('fallback ctx:', ctx ? ctx.slice(0, 300) : '(null)');
  } catch (e) {
    console.error('CRASH in fallback path:', e && e.stack);
  }
})().catch((e) => {
  console.error('TOP-LEVEL CRASH:', e && e.stack);
  process.exit(1);
});
