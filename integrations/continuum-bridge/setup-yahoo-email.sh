#!/usr/bin/env bash
# Install Yahoo IMAP skill on VPS and write mail config (~/.config/mail-skills/.env)
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:$PATH"
REPO="${CONTINUUM_MOBILE_REPO:-/tmp/continuum-mobile}"
SKILL_SRC="${REPO}/skills/@gzlicanyi/imap-smtp-email"
SKILL_DST="${HOME}/.openclaw/workspace/skills/@gzlicanyi/imap-smtp-email"
CONFIG_DIR="${HOME}/.config/mail-skills"
CONFIG_FILE="${CONFIG_DIR}/.env"

echo "=== Yahoo email skill (IMAP) for Continuum bridge ==="

if [ ! -d "$SKILL_SRC" ]; then
  echo "Missing skill source at $SKILL_SRC — run: git clone https://github.com/cai40/continuum-mobile.git $REPO"
  exit 1
fi

mkdir -p "$(dirname "$SKILL_DST")"
cp -r "$SKILL_SRC" "$SKILL_DST"
echo "Installed skill to $SKILL_DST"

echo "Installing npm dependencies..."
(cd "$SKILL_DST" && npm install --production --no-audit --no-fund)

if [ -f "$CONFIG_FILE" ] && [ "${FORCE_YAHOO_SETUP:-}" != "1" ]; then
  echo "Config already exists: $CONFIG_FILE"
  echo "Testing IMAP..."
  node "$SKILL_DST/scripts/imap.js" check --limit 3 --recent 24h && echo "Yahoo IMAP OK"
  exit 0
fi

YAHOO_EMAIL="${YAHOO_EMAIL:-cai40@yahoo.com}"
if [ -z "${YAHOO_APP_PASSWORD:-}" ]; then
  echo ""
  echo "Yahoo requires an App Password (not your login password):"
  echo "  Yahoo Account → Security → Generate app password → Mail"
  echo ""
  read -s -p "Yahoo App Password for ${YAHOO_EMAIL}: " YAHOO_APP_PASSWORD
  echo ""
fi

if [ -z "$YAHOO_APP_PASSWORD" ]; then
  echo "YAHOO_APP_PASSWORD is required."
  exit 1
fi

mkdir -p -m 700 "$CONFIG_DIR"
cat > "$CONFIG_FILE" <<EOF
PROVIDER=yahoo
USERNAME=${YAHOO_EMAIL}
PASSWORD=${YAHOO_APP_PASSWORD}
ALLOWED_READ_DIRS=${HOME}/Downloads,${HOME}/Documents
ALLOWED_WRITE_DIRS=${HOME}/Downloads
EOF
chmod 600 "$CONFIG_FILE"
echo "Wrote $CONFIG_FILE"

echo "Testing Yahoo IMAP..."
node "$SKILL_DST/scripts/imap.js" check --limit 5 --recent 24h
echo ""
echo "Yahoo email ready. In Continuum chat ask: check my Yahoo inbox"
