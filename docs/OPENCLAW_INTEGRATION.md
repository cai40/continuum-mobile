# Continuum ↔ OpenClaw Integration

Connect **Continuum** (memory + mobile app) with **OpenClaw** (VPS channels: Yahoo email, SMS, WeChat).

```
You (Continuum app)  ←→  Continuum Backend (Render)  ←→  L1–L5 Memory
                              ↑
                    continuum-brain skill
                              ↑
OpenClaw VPS  ←→  imap-smtp-email / SMS / WeChat
```

## Phase 1 (available now): VPS skill bridge

OpenClaw calls Continuum's existing `/chat` API with your Supabase refresh token. No backend deploy required.

### On your iPhone (Continuum app)

1. Open **Settings → OpenClaw Gateway**
2. Enter VPS IP: `135.181.155.197`
3. Tap **Copy VPS Setup Commands**
4. SSH to VPS and paste commands **one line at a time**

### On your VPS

```bash
export PATH="/usr/local/bin:/usr/bin:$PATH"
mkdir -p ~/.openclaw/workspace/skills
cp -r /path/to/continuum-mobile/skills/continuum-brain ~/.openclaw/workspace/skills/
cd ~/.openclaw/workspace/skills/continuum-brain
bash setup.sh
```

Or paste the echo commands from the Continuum app.

### Test

```bash
node scripts/ask.js "What do you remember about me?"
openclaw gateway restart
openclaw chat
```

In chat, ask: *"Use Continuum brain: summarize my top priorities."*

For email + memory:

```
Check my Yahoo unread mail, send the list to Continuum brain for triage advice, don't delete anything.
```

### Feed a sender's emails into Continuum memory (e.g. Min Zhang)

**From Continuum app chat** (OpenClaw bridge ON):

```
Feed all Min Zhang emails to Continuum memory
```

Or: `Ingest emails from Min Zhang into memory — last 30 days, limit 100`

The bridge IMAP-searches `FROM "Min Zhang"`, injects real mail into `/chat/stream`, and post-chat archiving stores L2–L4 facts.

**From VPS (batch / cron):**

```bash
cd /tmp/continuum-mobile && git pull origin master
bash integrations/continuum-bridge/ingest-min-zhang-emails.sh
```

Only **new** UIDs are ingested (tracked in `~/.config/continuum-openclaw/ingested-uids-min-zhang.json`).

Daily cron:

```bash
0 8 * * * bash /tmp/continuum-mobile/integrations/continuum-bridge/ingest-min-zhang-emails.sh >> ~/.continuum-min-zhang.log 2>&1
```

**Historical archive (L5 knowledge base):** export Min Zhang threads to a `.txt` file and upload via Settings → Layer 5 → Sync Document Intelligence.

### Config file

`~/.config/continuum-openclaw/.env`:

| Variable | Source |
|----------|--------|
| `CONTINUUM_REFRESH_TOKEN` | Continuum app → OpenClaw Gateway |
| `GEMINI_API_KEY` | Same key as Continuum Settings → API Keys |
| `BRIDGE_SECRET` | Generated in app (optional) |

JWT access tokens refresh automatically via Supabase.

---

## Phase 2 (optional): HTTP bridge service

Runs on VPS loopback port 8787:

```bash
node integrations/continuum-bridge/server.js
```

```bash
curl -s http://127.0.0.1:8787/health
curl -s -X POST http://127.0.0.1:8787/ask \
  -H "Authorization: Bearer YOUR_BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello from bridge","channel":"cli"}'
```

Enable systemd (edit paths in service file):

```bash
mkdir -p ~/.config/systemd/user
cp integrations/continuum-bridge/continuum-bridge.service.example ~/.config/systemd/user/continuum-bridge.service
systemctl --user enable continuum-bridge
systemctl --user start continuum-bridge
```

---

## Phase 3 (planned): Backend channel gateway

Reference code: `integrations/continuum-backend/openclaw_router.py`

Adds `POST /integrations/channel` to continuum-backend so OpenClaw posts inbound SMS/email/WeChat directly to Render — no refresh token on VPS.

Requires:
- `openclaw_pairings` table (sender → user_id)
- `CONTINUUM_OPENCLAW_TOKEN` env on Render
- Render always-on tier (avoid cold-start on real-time SMS)

See PRD §2.11.6 L6 Phase C on branch `cursor/l6-procedural-skills-prd-50ef`.

---

## Architecture roles

| Component | Role |
|-----------|------|
| **Continuum app** | Daily chat UI + memory vault |
| **Continuum backend** | L1–L5 retrieval, LLM, chat history |
| **OpenClaw gateway** | 24/7 channel daemon on VPS |
| **continuum-brain skill** | Calls `/chat` from VPS |
| **imap-smtp-email skill** | Yahoo read/send on VPS |

Continuum owns memory. OpenClaw owns channels. Neither duplicates the other.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Missing config` | Run `bash setup.sh` or paste app setup commands |
| `token refresh failed` | Re-copy refresh token from Continuum app |
| `401 on /chat` | Log out/in on Continuum app, copy new refresh token |
| Agent ignores skill | Say "use continuum-brain skill" explicitly |
| Render timeout | First request after idle may take 30–60s (cold start) |

---

## Security

- `~/.config/continuum-openclaw/.env` must be `chmod 600`
- Rotate `BRIDGE_SECRET` if exposed
- Refresh tokens are sensitive — treat like passwords
- Gateway stays loopback-only; don't expose port 18789 to the internet without auth
