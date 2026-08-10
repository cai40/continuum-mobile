const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

// Test webContext URL detection without network.
const ctxSrc = fs.readFileSync(path.join(__dirname, '../integrations/continuum-bridge/webContext.js'), 'utf8');
const webSearchStub = {
  wantsWebSearch: () => false,
  buildSearchQueries: () => [''],
  searchWeb: async () => ({ provider: 'x', results: [], query: '' }),
  formatSearchResults: () => '',
  fetchPageExcerpt: async (url) => {
    if (url.includes('zillow.com')) return '123 Main St, Boston MA — $2,500/mo, 3 bed 2 bath, available 2026-09-01. Zillow listing text.';
    return '';
  },
  isScrapeableUrl: (url) => String(url).startsWith('http'),
};
const ctxSandbox = {
  module: { exports: {} },
  exports: {},
  require: (name) => {
    if (name === './emailFetchOptions') return { wantsEmailFetch: () => false };
    if (name === './webSearch') return webSearchStub;
    return Module.createRequire(path.join(__dirname, '../integrations/continuum-bridge/webContext.js'))(name);
  },
  console,
  process,
  __dirname: path.join(__dirname, '../integrations/continuum-bridge'),
  __filename: path.join(__dirname, '../integrations/continuum-bridge/webContext.js'),
};
vm.runInNewContext(ctxSrc, ctxSandbox, { filename: 'webContext.js' });
const webContext = ctxSandbox.module.exports;

function run() {
  // URL detection
  assert.strictEqual(
    webContext.extractUrls('Look at my listing https://www.zillow.com/homedetails/123/xyz').join(','),
    'https://www.zillow.com/homedetails/123/xyz',
    'extracts the URL',
  );
  assert.strictEqual(webContext.wantsUrlFetch('no url here'), false, 'no url -> false');
  assert.strictEqual(webContext.wantsUrlFetch('see https://zillow.com/x'), true, 'url -> true');

  console.log('webContext url fetch: all checks passed');
}

run();
