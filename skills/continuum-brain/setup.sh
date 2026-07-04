#!/bin/bash
set -euo pipefail

CONFIG_DIR="$HOME/.config/continuum-openclaw"
CONFIG_FILE="$CONFIG_DIR/.env"

echo "================================"
echo "  Continuum Brain Skill Setup"
echo "================================"
echo ""
echo "Links OpenClaw on this VPS to your Continuum memory backend."
echo "Get credentials from Continuum app → Settings → OpenClaw Gateway."
echo ""

mkdir -p -m 700 "$CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
  echo "Existing config found at $CONFIG_FILE"
  read -p "Overwrite? (y/N): " OVERWRITE
  if [ "${OVERWRITE,,}" != "y" ]; then
    echo "Keeping existing config."
    exit 0
  fi
fi

read -p "Continuum API URL [https://continuum-backend-0q9j.onrender.com]: " API_URL
API_URL="${API_URL:-https://continuum-backend-0q9j.onrender.com}"

read -p "Supabase refresh token (from Continuum app): " REFRESH_TOKEN
read -p "Gemini API key: " GEMINI_KEY
read -sp "Bridge secret (optional, for HTTP bridge): " BRIDGE_SECRET
echo ""

cat > "$CONFIG_FILE" <<EOF
CONTINUUM_API_URL=${API_URL}
SUPABASE_URL=https://yybojfgjhtrwqhtavorg.supabase.co
SUPABASE_ANON_KEY=sb_publishable_o9AuvayIw6vnMtnqhdTpNg__V7pA5i5
CONTINUUM_PROVIDER=gemini
CONTINUUM_REFRESH_TOKEN=${REFRESH_TOKEN}
GEMINI_API_KEY=${GEMINI_KEY}
BRIDGE_SECRET=${BRIDGE_SECRET}
EOF

chmod 600 "$CONFIG_FILE"

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
echo ""
echo "Testing Continuum connection..."
if node "$SKILL_DIR/scripts/ask.js" --json "Reply with exactly: Continuum bridge OK"; then
  echo ""
  echo "Setup complete. Config: $CONFIG_FILE"
else
  echo ""
  echo "Config written but test failed — check refresh token and Gemini key in Continuum app."
fi
