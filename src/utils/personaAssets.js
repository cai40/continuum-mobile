let WANQING_HEADSHOT = null;
try {
  WANQING_HEADSHOT = require('../assets/wanqing-headshot.jpg');
} catch {
  // In Node.js testing environments where Metro bundler is not active
  WANQING_HEADSHOT = { uri: 'asset://wanqing-headshot.jpg' };
}

export { WANQING_HEADSHOT };

export function getPersonaAvatar(personaId) {
  if (personaId === 'wanqing') {
    return WANQING_HEADSHOT;
  }
  return null;
}
