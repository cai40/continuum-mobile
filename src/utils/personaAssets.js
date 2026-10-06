import { isWanqingAuthorized } from './personaMemoryManager';

let WANQING_HEADSHOT = null;
try {
  WANQING_HEADSHOT = require('../assets/wanqing-headshot.jpg');
} catch (e) {
  // In Node.js testing environments where Metro bundler is not active
  WANQING_HEADSHOT = { uri: 'asset://wanqing-headshot.jpg' };
}

export { WANQING_HEADSHOT };

/**
 * Returns the avatar image source for the specified personaId, or null if unauthorized or none exists.
 * Validates that the caller is authorized if accessing Lin Wanqing's picture.
 */
export function getPersonaAvatar(personaId, userEmail = null) {
  if (personaId === 'wanqing') {
    if (!isWanqingAuthorized(userEmail)) {
      return null;
    }
    return WANQING_HEADSHOT;
  }
  return null;
}

/**
 * Returns Lin Wanqing's portrait headshot strictly if the caller is authorized.
 */
export function getWanqingHeadshot(userEmail) {
  if (!isWanqingAuthorized(userEmail)) {
    return null;
  }
  return WANQING_HEADSHOT;
}

