#!/usr/bin/env bash
# Sync imap-smtp-email skill from continuum-mobile repo (includes delete command)
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:$PATH"
REPO="${CONTINUUM_MOBILE_REPO:-/tmp/continuum-mobile}"
SKILL_SRC="${REPO}/skills/@gzlicanyi/imap-smtp-email"
SKILL_DST="${HOME}/.openclaw/workspace/skills/@gzlicanyi/imap-smtp-email"

echo "=== Sync Yahoo IMAP skill (delete support) ==="

if [ ! -d "$SKILL_SRC" ]; then
  echo "Missing $SKILL_SRC — run: git clone https://github.com/cai40/continuum-mobile.git $REPO"
  exit 1
fi

mkdir -p "$(dirname "$SKILL_DST")"
rm -rf "$SKILL_DST"
cp -r "$SKILL_SRC" "$SKILL_DST"
echo "Installed skill to $SKILL_DST"

(cd "$SKILL_DST" && npm install --production --no-audit --no-fund)

echo "Verifying delete command..."
if node "$SKILL_DST/scripts/imap.js" delete 2>&1 | grep -qi 'uid(s) required'; then
  echo "✓ delete command available"
else
  echo "✗ delete command missing — check git pull on $REPO"
  exit 1
fi

if systemctl --user is-active continuum-bridge >/dev/null 2>&1; then
  systemctl --user restart continuum-bridge
  echo "✓ continuum-bridge restarted"
fi

echo "Done. Retry delete/trash in Continuum chat."
