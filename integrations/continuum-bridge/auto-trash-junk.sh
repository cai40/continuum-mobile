#!/usr/bin/env bash
# Cron-friendly: fetch Yahoo inbox and auto-trash newsletters/promos/spam (not protected mail).
# Example crontab (every 6 hours):
#   0 */6 * * * bash /tmp/continuum-mobile/integrations/continuum-bridge/auto-trash-junk.sh >> ~/.continuum-auto-trash.log 2>&1
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:$PATH"
REPO="${CONTINUUM_MOBILE_REPO:-/tmp/continuum-mobile}"
export CONTINUUM_MOBILE_REPO="$REPO"

echo "=== Auto-trash junk $(date -Is) limit=${AUTO_TRASH_LIMIT:-100} recent=${AUTO_TRASH_RECENT:-7d} ==="
node "${REPO}/integrations/continuum-bridge/auto-trash-junk.js"
