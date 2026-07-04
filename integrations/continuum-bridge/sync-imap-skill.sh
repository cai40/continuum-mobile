#!/usr/bin/env bash
# Sync imap-smtp-email skill from continuum-mobile repo (includes delete command)
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:$PATH"
REPO="${CONTINUUM_MOBILE_REPO:-/tmp/continuum-mobile}"
SKILL_SRC="${REPO}/skills/@gzlicanyi/imap-smtp-email"
SKILL_DST="${HOME}/.openclaw/workspace/skills/@gzlicanyi/imap-smtp-email"
IMAP_JS="${SKILL_DST}/scripts/imap.js"

echo "=== Sync Yahoo IMAP skill (delete support) ==="

if [ ! -d "$SKILL_SRC" ]; then
  echo "Missing $SKILL_SRC — run: git clone https://github.com/cai40/continuum-mobile.git $REPO"
  exit 1
fi

if ! grep -q "case 'delete'" "${SKILL_SRC}/scripts/imap.js"; then
  echo "✗ Repo imap.js has no delete command — run: cd $REPO && git pull origin master"
  exit 1
fi
echo "✓ delete handler found in repo"

echo "Installing npm dependencies (repo + openclaw copy)..."
(cd "$SKILL_SRC" && npm install --production --no-audit --no-fund)

mkdir -p "$(dirname "$SKILL_DST")"
rm -rf "$SKILL_DST"
cp -r "$SKILL_SRC" "$SKILL_DST"
echo "Installed skill to $SKILL_DST"

(cd "$SKILL_DST" && npm install --production --no-audit --no-fund)

if ! grep -q "case 'delete'" "$IMAP_JS"; then
  echo "✗ Installed imap.js missing delete handler after copy"
  exit 1
fi
echo "✓ delete handler found in installed skill"

PROBE="$(node "$IMAP_JS" delete 2>&1 || true)"
if echo "$PROBE" | grep -qi 'unknown command'; then
  echo "✗ Runtime still reports unknown command: $PROBE"
  exit 1
fi
if echo "$PROBE" | grep -qi 'required'; then
  echo "✓ delete command registered (runtime probe OK)"
elif echo "$PROBE" | grep -qi 'no email configuration'; then
  echo "✓ delete command registered (mail config probe skipped — config exists for bridge)"
else
  echo "  Runtime probe: $PROBE"
  echo "✓ delete handler in source (bridge uses /tmp/continuum-mobile after git pull)"
fi

if systemctl --user is-active continuum-bridge >/dev/null 2>&1; then
  systemctl --user restart continuum-bridge
  echo "✓ continuum-bridge restarted"
fi

echo "Done. Bridge prefers $REPO/skills/.../imap.js after git pull."
