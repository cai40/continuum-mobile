#!/usr/bin/env bash
# Start continuum-bridge on Render (Yahoo IMAP + chat/stream) — no user VPS required.
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:$PATH"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export CONTINUUM_MOBILE_REPO="$REPO_ROOT"

if [ -z "${YAHOO_EMAIL:-}" ] || [ -z "${YAHOO_APP_PASSWORD:-}" ]; then
  echo "ERROR: Set Render env YAHOO_EMAIL and YAHOO_APP_PASSWORD (Yahoo app password, not login password)."
  exit 1
fi

echo "=== Render email bridge setup ==="

CONFIG_DIR="${HOME}/.config/mail-skills"
mkdir -p -m 700 "$CONFIG_DIR"
cat > "${CONFIG_DIR}/.env" <<EOF
PROVIDER=yahoo
USERNAME=${YAHOO_EMAIL}
PASSWORD=${YAHOO_APP_PASSWORD}
ALLOWED_READ_DIRS=${HOME}/Downloads,${HOME}/Documents
ALLOWED_WRITE_DIRS=${HOME}/Downloads
EOF
chmod 600 "${CONFIG_DIR}/.env"
# imap.js prefers ~/.config/imap-smtp-email/.env when present but expects LEGACY keys
# (IMAP_USER/IMAP_PASS). Our shared format uses USERNAME/PASSWORD — keep only mail-skills.
rm -f "${HOME}/.config/imap-smtp-email/.env"
echo "Wrote Yahoo IMAP config at ${CONFIG_DIR}/.env"

bash "$REPO_ROOT/integrations/continuum-bridge/sync-imap-skill.sh"

OPENCLAW_DIR="${HOME}/.config/continuum-openclaw"
mkdir -p -m 700 "$OPENCLAW_DIR"
cat > "${OPENCLAW_DIR}/.env" <<EOF
CONTINUUM_API_URL=$(echo "${CONTINUUM_API_URL:-https://continuum-backend-0q9j.onrender.com}" | sed 's#/*$##' | sed 's#/integrations/email$##i')
BRIDGE_SECRET=${BRIDGE_SECRET:-${RENDER_EMAIL_BRIDGE_SECRET:-}}
EOF
chmod 600 "${OPENCLAW_DIR}/.env"

export CONTINUUM_BRIDGE_HOST="0.0.0.0"
export CONTINUUM_BRIDGE_PORT="${PORT:-8787}"

echo "Starting continuum-bridge on ${CONTINUUM_BRIDGE_HOST}:${CONTINUUM_BRIDGE_PORT}..."
exec node "$REPO_ROOT/integrations/continuum-bridge/server.js"
