#!/usr/bin/env bash
# Feed new Min Zhang emails into Continuum L1-L5 memory via continuum-brain /chat.
# Cron example (daily 8am): 0 8 * * * bash /tmp/continuum-mobile/integrations/continuum-bridge/ingest-min-zhang-emails.sh >> ~/.continuum-min-zhang.log 2>&1
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:$PATH"
REPO="${CONTINUUM_MOBILE_REPO:-/tmp/continuum-mobile}"
export CONTINUUM_MOBILE_REPO="$REPO"
export EMAIL_INGEST_SENDER="${EMAIL_INGEST_SENDER:-Min Zhang}"

echo "=== Min Zhang → Continuum memory $(date -Is) ==="
node "${REPO}/integrations/continuum-bridge/ingest-sender-emails.js" --from "$EMAIL_INGEST_SENDER" --all-new --limit "${EMAIL_INGEST_LIMIT:-50}" --recent "${EMAIL_INGEST_RECENT:-30d}"
