#!/usr/bin/env bash
# One-shot: wire OpenClaw chat to Continuum memory via AGENTS.md
set -euo pipefail

WORKSPACE="${HOME}/.openclaw/workspace"
AGENTS="${WORKSPACE}/AGENTS.md"
SNIPPET_MARK="Continuum brain (required for personal questions)"

mkdir -p "$WORKSPACE"

if [ -f "$AGENTS" ] && grep -q "$SNIPPET_MARK" "$AGENTS"; then
  echo "Already configured in $AGENTS"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cat "${SCRIPT_DIR}/AGENTS-continuum.snippet.md" >> "$AGENTS"
echo "Appended Continuum instructions to $AGENTS"

export PATH="/usr/local/bin:/usr/bin:${PATH:-}"
if command -v openclaw >/dev/null 2>&1; then
  openclaw gateway restart || true
  echo "Gateway restarted."
fi

echo "Done. Run: openclaw chat"
