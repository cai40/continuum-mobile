#!/usr/bin/env bash
# Start Continuum bridge for mobile app access (public port 8787)
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:$PATH"
BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$BRIDGE_DIR/../.." && pwd)"

echo "=== Continuum Bridge (mobile app chat) ==="

# Migrate the legacy config dir if it has not been moved yet.
if [ ! -d "$HOME/.config/continuum" ] && [ -d "$HOME/.config/continuum-openclaw" ]; then
  mv "$HOME/.config/continuum-openclaw" "$HOME/.config/continuum"
fi

if [ ! -f "$HOME/.config/continuum/.env" ]; then
  echo "Missing ~/.config/continuum/.env — run continuum-brain setup first."
  exit 1
fi

# Install systemd user service
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/continuum-bridge.service" <<EOF
[Unit]
Description=Continuum Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}/integrations/continuum-bridge
Environment=CONTINUUM_BRIDGE_HOST=0.0.0.0
Environment=CONTINUUM_BRIDGE_PORT=8787
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

# Copy latest server if repo present (skip when already in place)
if [ -f "${REPO_DIR}/integrations/continuum-bridge/server.js" ] && \
   [ "${REPO_DIR}/integrations/continuum-bridge/server.js" != "${BRIDGE_DIR}/server.js" ]; then
  cp "${REPO_DIR}/integrations/continuum-bridge/server.js" "${BRIDGE_DIR}/server.js"
fi

systemctl --user daemon-reload
systemctl --user enable continuum-bridge
systemctl --user restart continuum-bridge

if command -v ufw >/dev/null 2>&1; then
  ufw allow 8787/tcp comment 'Continuum bridge' || true
fi

sleep 1
curl -s "http://127.0.0.1:8787/health" && echo ""
echo ""
echo "Bridge running on 0.0.0.0:8787"
echo "In the Continuum app: Setup → Email & Bridge → use the same Bridge Secret saved there."
