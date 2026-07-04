---
name: continuum-brain
description: Route messages to Continuum backend for memory-aware replies (L1-L5). Use for conversational questions, identity-aware advice, and decisions that should persist in Continuum memory. Pair with imap-smtp-email for email actions on this VPS.
metadata:
  openclaw:
    emoji: "🧠"
    requires:
      bins:
        - node
      env:
        - CONTINUUM_REFRESH_TOKEN
        - GEMINI_API_KEY
    primaryEnv: CONTINUUM_REFRESH_TOKEN
---

# Continuum Brain

OpenClaw executes **channels and skills** (email, SMS, WeChat). **Continuum** is the memory-aware brain (L1–L5 identity, facts, documents).

Use this skill when the user asks anything that should use their Continuum memory — not just generic LLM answers.

## Setup

```bash
bash setup.sh
```

Or copy credentials from **Continuum app → Settings → OpenClaw Gateway** to `~/.config/continuum-openclaw/.env`.

## Ask Continuum

```bash
node scripts/ask.js "What do you know about my career goals?"
node scripts/ask.js --channel email --sender cai40@yahoo.com "Summarize my priorities"
node scripts/ask.js --json "Quick health check"
```

## When to use

| User intent | Skill |
|-------------|-------|
| Memory, identity, past conversations | **continuum-brain** |
| Read/send Yahoo email | **imap-smtp-email** |
| Both | Ask Continuum for plan → execute email skill |

## Example workflow (email triage)

1. `node scripts/imap.js check --limit 10 --unseen`
2. `node scripts/ask.js "Here is my unread mail: ... Summarize and flag spam. Never delete without confirmation."`
3. If user confirms, run imap mark-read or move via user-approved commands

## Config file

`~/.config/continuum-openclaw/.env`:

```bash
CONTINUUM_API_URL=https://continuum-backend-0q9j.onrender.com
SUPABASE_URL=https://yybojfgjhtrwqhtavorg.supabase.co
SUPABASE_ANON_KEY=sb_publishable_o9AuvayIw6vnMtnqhdTpNg__V7pA5i5
CONTINUUM_REFRESH_TOKEN=your_supabase_refresh_token
CONTINUUM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key
BRIDGE_SECRET=optional_shared_secret
```

## HTTP bridge (optional)

Run the bridge service so OpenClaw hooks or external channels can POST messages:

```bash
node ../../integrations/continuum-bridge/server.js
```

See `docs/OPENCLAW_INTEGRATION.md` in the Continuum mobile repo.
