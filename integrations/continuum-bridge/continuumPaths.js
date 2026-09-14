'use strict';

/**
 * Canonical on-disk locations for the Continuum bridge.
 *
 * The app used to be branded "OpenClaw" and stored its config / ingest state
 * under ~/.config/continuum-openclaw and ~/.openclaw/workspace/skills. Those
 * names are gone. Reads prefer the new ~/.config/continuum location and fall
 * back to the legacy directory only until it is migrated, so a redeployed
 * bridge keeps working with an existing install. Run
 * `integrations/continuum-bridge/migrate-paths.sh` to move the old files.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.HOME || os.homedir() || '/root';

const CONFIG_DIR = path.join(HOME, '.config', 'continuum');
const LEGACY_CONFIG_DIR = path.join(HOME, '.config', 'continuum-openclaw');
const SKILLS_DIR = path.join(HOME, '.continuum', 'workspace', 'skills');
const LEGACY_SKILLS_DIR = path.join(HOME, '.openclaw', 'workspace', 'skills');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Config/state dir: new path when present, else the not-yet-migrated legacy dir. */
function configDir() {
  if (exists(CONFIG_DIR)) return CONFIG_DIR;
  if (exists(LEGACY_CONFIG_DIR)) return LEGACY_CONFIG_DIR;
  return CONFIG_DIR;
}

/** Path to the bridge .env (CONTINUUM_API_URL, BRIDGE_SECRET, API keys). */
function configEnvPath() {
  return path.join(configDir(), '.env');
}

/** Installed skill workspace: new path when present, else the legacy dir. */
function skillsDir() {
  if (exists(SKILLS_DIR)) return SKILLS_DIR;
  if (exists(LEGACY_SKILLS_DIR)) return LEGACY_SKILLS_DIR;
  return SKILLS_DIR;
}

module.exports = {
  HOME,
  CONFIG_DIR,
  LEGACY_CONFIG_DIR,
  SKILLS_DIR,
  LEGACY_SKILLS_DIR,
  configDir,
  configEnvPath,
  skillsDir,
};
