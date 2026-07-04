#!/usr/bin/env bash
# Expose continuum-bridge (127.0.0.1:8787) over HTTPS for iPhone (no App Store rebuild).
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:$PATH"

echo "=== Cloudflare HTTPS tunnel → continuum-bridge:8787 ==="

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installing cloudflared..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) CF_ARCH="amd64" ;;
    aarch64|arm64) CF_ARCH="arm64" ;;
    *) echo "Unsupported arch: $ARCH"; exit 1 ;;
  esac
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
    -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/continuum-bridge-tunnel.service" <<EOF
[Unit]
Description=Cloudflare HTTPS tunnel to Continuum bridge
After=network.target continuum-bridge.service

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:8787
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable continuum-bridge-tunnel
systemctl --user restart continuum-bridge-tunnel

echo "Waiting for tunnel URL..."
sleep 4
TUNNEL_URL=""
for _ in 1 2 3 4 5; do
  TUNNEL_URL="$(journalctl --user -u continuum-bridge-tunnel -n 50 --no-pager 2>/dev/null \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 2
done

if [ -n "$TUNNEL_URL" ]; then
  echo "$TUNNEL_URL" > "$HOME/.continuum-bridge-tunnel.url"
  echo ""
  echo "HTTPS Bridge URL (paste in Continuum app):"
  echo "$TUNNEL_URL"
  echo ""
  echo "Saved to ~/.continuum-bridge-tunnel.url"
else
  echo "Tunnel started. Fetch URL with:"
  echo "  journalctl --user -u continuum-bridge-tunnel -n 30 | grep trycloudflare"
fi
