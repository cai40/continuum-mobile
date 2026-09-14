'use strict';

/**
 * Canonical on-disk locations for the Continuum email bridge.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.HOME || os.homedir() || '/root';

const CONFIG_DIR = path.join(HOME, '.config', 'continuum');
const SKILLS_DIR = path.join(HOME, '.continuum', 'workspace', 'skills');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Config/state dir for the bridge. */
function configDir() {
  return CONFIG_DIR;
}

/** Path to the bridge .env (CONTINUUM_API_URL, BRIDGE_SECRET, API keys). */
function configEnvPath() {
  return path.join(configDir(), '.env');
}

/** Installed skill workspace. */
function skillsDir() {
  return SKILLS_DIR;
}

module.exports = {
  HOME,
  CONFIG_DIR,
  SKILLS_DIR,
  configDir,
  configEnvPath,
  skillsDir,
  exists,
};
