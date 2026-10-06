let WANQING_HEADSHOT = null;
try {
  WANQING_HEADSHOT = require('../assets/wanqing-headshot.jpg');
} catch (e) {
  // In Node.js testing environments where Metro bundler is not active
  WANQING_HEADSHOT = { uri: 'asset://wanqing-headshot.jpg' };
}

export { WANQING_HEADSHOT };

/**
 * Returns the avatar image source for the specified personaId, or null if none exists.
 * Validates that the asset is safely present.
 */
export function getPersonaAvatar(personaId) {
  if (personaId === 'wanqing' && WANQING_HEADSHOT) {
    return WANQING_HEADSHOT;
  }
  return null;
}

