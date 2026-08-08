const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  // word-extractor's OLE reader requires Node's `stream`. Route it to a minimal
  // in-repo shim so the bundle stays free of Node core modules.
  stream: require.resolve('./shims/stream.js'),
};

module.exports = config;
