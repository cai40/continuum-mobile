#!/usr/bin/env bash
# Quick VPS test: date-range IMAP fetch (bypasses Continuum)
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:$PATH"
IMAP="${CONTINUUM_MOBILE_REPO:-/tmp/continuum-mobile}/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js"
SINCE="${1:-2026-06-01}"
BEFORE="${2:-2026-06-04}"
LIMIT="${3:-5}"
SKILL_ROOT="$(dirname "$(dirname "$IMAP")")"
echo "=== IMAP date-range test: ${SINCE} .. ${BEFORE} (limit ${LIMIT}) ==="
echo "Skill: $IMAP"
set +e
timeout 180 node "$IMAP" check --since "$SINCE" --before "$BEFORE" --limit "$LIMIT" --lite \
  > /tmp/imap-date-out.json 2> >(tee /tmp/imap-date-err.log >&2)
EXIT=$?
set -e
echo "--- exit code: $EXIT ---"
if [ "$EXIT" -ne 0 ]; then
  echo "Command failed or timed out (exit $EXIT)"
fi
echo "--- stderr (last 15 lines) ---"
tail -15 /tmp/imap-date-err.log || true
echo "--- stdout bytes ---"
wc -c /tmp/imap-date-out.json || true
echo "--- stdout (first 2000 chars) ---"
head -c 2000 /tmp/imap-date-out.json || true
echo
