#!/usr/bin/env bash
# OpenClaw VPS setup helper for Continuum users
# Target: Ubuntu 22.04/24.04 on Hetzner, DigitalOcean, etc.
# Channels: WeChat, SMS (Twilio), Yahoo email (IMAP/SMTP)
#
# Usage:
#   curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
#   bash scripts/openclaw-vps-setup.sh
#
# Or run sections manually — see comments below.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[openclaw]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

# --- 1. Node.js 22.19+ (OpenClaw requirement) ---
ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local ver
    ver="$(node -p "process.versions.node.split('.').map(Number); const [a,b]=process.versions.node.split('.').map(Number); (a>22||(a===22&&b>=19))")" 2>/dev/null || true
    if node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=19)?0:1)" 2>/dev/null; then
      info "Node $(node -v) OK"
      return
    fi
    warn "Node $(node -v) is below 22.19 — upgrading recommended"
  fi
  info "Installing Node via OpenClaw installer or nvm..."
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$HOME/.nvm/nvm.sh"
    nvm install 22
    nvm use 22
  else
    curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
  fi
}

# --- 2. Install OpenClaw CLI ---
install_openclaw() {
  require_cmd npm
  info "Installing OpenClaw globally..."
  npm install -g openclaw@latest
  openclaw --version
}

# --- 3. Interactive onboarding (requires your API key) ---
run_onboard() {
  info "Starting interactive onboarding..."
  info "You will need: Anthropic/OpenAI/OpenRouter API key"
  openclaw onboard --install-daemon
}

# --- 4. Channel plugins & skills ---
install_channels() {
  info "Installing WeChat plugin..."
  openclaw plugins install "@tencent-weixin/openclaw-weixin" || warn "WeChat plugin install failed — check OpenClaw version >= 2026.3.22"
  openclaw config set plugins.entries.openclaw-weixin.enabled true

  info "Installing SMS plugin..."
  openclaw plugins install @openclaw/sms || openclaw plugins install sms || warn "SMS plugin install failed — check docs"

  info "Installing email skill (IMAP/SMTP)..."
  openclaw skills install @gzlicanyi/imap-smtp-email || npx -y clawhub@latest install @gzlicanyi/imap-smtp-email || warn "Email skill install failed"

  info "Installing Continuum brain skill..."
  local skill_src="${CONTINUUM_SKILL_SRC:-}"
  if [ -z "$skill_src" ] && [ -d "$(dirname "$0")/../skills/continuum-brain" ]; then
    skill_src="$(cd "$(dirname "$0")/../skills/continuum-brain" && pwd)"
  fi
  if [ -n "$skill_src" ] && [ -d "$skill_src" ]; then
    mkdir -p "${HOME}/.openclaw/workspace/skills"
    cp -r "$skill_src" "${HOME}/.openclaw/workspace/skills/continuum-brain"
    info "Continuum brain skill copied to ~/.openclaw/workspace/skills/continuum-brain"
  else
    warn "continuum-brain skill not found — clone continuum-mobile repo or set CONTINUUM_SKILL_SRC"
  fi
}

# --- 5. Example config patches (edit placeholders before applying) ---
write_config_templates() {
  local dir="${HOME}/openclaw-config-templates"
  mkdir -p "$dir"

  cat > "$dir/sms.patch.json5" <<'EOF'
{
  channels: {
    sms: {
      enabled: true,
      accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      authToken: "YOUR_TWILIO_AUTH_TOKEN",
      fromNumber: "+15551234567",
      publicWebhookUrl: "https://YOUR_VPS_DOMAIN/webhooks/sms",
      dmPolicy: "pairing",
    },
  },
}
EOF

  cat > "$dir/yahoo-email.env.example" <<'EOF'
# Copy to ~/.config/imap-smtp-email/.env
IMAP_HOST=imap.mail.yahoo.com
IMAP_PORT=993
IMAP_USER=your@yahoo.com
IMAP_PASS=your_yahoo_app_password
IMAP_TLS=true
IMAP_MAILBOX=INBOX
SMTP_HOST=smtp.mail.yahoo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@yahoo.com
SMTP_PASS=your_yahoo_app_password
SMTP_FROM=your@yahoo.com
EOF

  cat > "$dir/continuum-openclaw.env.example" <<'EOF'
# Copy to ~/.config/continuum-openclaw/.env
# Get values from Continuum app → Settings → OpenClaw Gateway
CONTINUUM_API_URL=https://continuum-backend-0q9j.onrender.com
SUPABASE_URL=https://yybojfgjhtrwqhtavorg.supabase.co
SUPABASE_ANON_KEY=sb_publishable_o9AuvayIw6vnMtnqhdTpNg__V7pA5i5
CONTINUUM_PROVIDER=gemini
CONTINUUM_REFRESH_TOKEN=your_supabase_refresh_token
GEMINI_API_KEY=your_gemini_api_key
BRIDGE_SECRET=your_bridge_secret
EOF

  info "Config templates written to $dir"
  info "  - sms.patch.json5 (edit Twilio + public URL, then: openclaw config patch --file $dir/sms.patch.json5)"
  info "  - yahoo-email.env.example (copy to ~/.config/imap-smtp-email/.env)"
  info "  - continuum-openclaw.env.example (copy to ~/.config/continuum-openclaw/.env)"
}

# --- 6. systemd linger (keep gateway running after SSH logout) ---
enable_linger() {
  if command -v loginctl >/dev/null 2>&1; then
    info "Enabling systemd linger for $USER..."
    sudo loginctl enable-linger "$USER" 2>/dev/null || warn "Could not enable linger — run: sudo loginctl enable-linger $USER"
  fi
}

print_next_steps() {
  cat <<EOF

${GREEN}=== Next steps (manual) ===${NC}

1. WeChat — on the VPS:
     openclaw channels login --channel openclaw-weixin
   Scan QR with WeChat on your phone. Use a secondary account if possible.

2. SMS — in Twilio console:
   - Buy an SMS number
   - Set webhook POST → https://YOUR_DOMAIN/webhooks/sms
   - Apply sms.patch.json5 after editing placeholders

3. Yahoo email:
   - Enable IMAP in Yahoo Mail settings
   - Create app password at https://login.yahoo.com/account/security
   - cp ~/openclaw-config-templates/yahoo-email.env.example ~/.config/imap-smtp-email/.env
   - Edit credentials, chmod 600 ~/.config/imap-smtp-email/.env

4. Continuum brain (memory bridge):
   - Continuum app → Settings → OpenClaw Gateway → Copy VPS Setup Commands
   - Paste on VPS one line at a time (iPhone SSH)
   - Or: cp ~/openclaw-config-templates/continuum-openclaw.env.example ~/.config/continuum-openclaw/.env
   - Test: node ~/.openclaw/workspace/skills/continuum-brain/scripts/ask.js "Hello"

5. Approve first senders:
     openclaw pairing list openclaw-weixin
     openclaw pairing approve openclaw-weixin <CODE>
     openclaw pairing list sms
     openclaw pairing approve sms <CODE>

6. Verify:
     openclaw doctor
     openclaw gateway status
     openclaw channels status --probe

7. Access dashboard from laptop (SSH tunnel):
     ssh -L 18789:127.0.0.1:18789 user@YOUR_VPS
     openclaw dashboard   # or open http://127.0.0.1:18789 in browser

Docs: https://docs.openclaw.ai/vps

EOF
}

main() {
  info "OpenClaw VPS setup helper"
  ensure_node
  install_openclaw
  install_channels
  write_config_templates
  enable_linger

  if [ "${SKIP_ONBOARD:-}" != "1" ]; then
    warn "Onboarding is interactive — run manually if this script is non-interactive:"
    warn "  openclaw onboard --install-daemon"
    if [ -t 0 ]; then
      read -r -p "Run onboarding now? [y/N] " ans
      if [[ "${ans,,}" == "y" ]]; then
        run_onboard
      fi
    fi
  fi

  print_next_steps
}

main "$@"
