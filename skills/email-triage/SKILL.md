---
name: email-triage
version: 1.0.0
description: Classify Yahoo/IMAP inbox mail as urgent, needs-response, informational, newsletter, spam, or protected. Select junk UIDs for bridge trash/bulk actions. Node heuristics — no Ollama required.
metadata:
  openclaw:
    emoji: "📬"
    requires:
      bins:
        - node
    primaryEnv: PROVIDER
---

# Email Triage (Continuum port)

Heuristic inbox triage for the Continuum OpenClaw bridge. Classifies fetched emails and **selects junk UIDs** for safe bulk trash.

## Credits

- [briancolinger/email-triage](https://clawhub.ai/briancolinger/email-triage) (MIT) — category model
- [danieleschmidt/crewai-email-triage](https://github.com/danieleschmidt/crewai-email-triage) — keyword/sender heuristics
- Integrated with `@gzlicanyi/imap-smtp-email` + `continuum-bridge`

## Categories

| Category | Meaning | Auto-junk? |
|----------|---------|------------|
| `urgent` | Security, OTP, outages | No |
| `needs_response` | DocuSign, questions, deadlines | No |
| `informational` | Receipts, notifications | No |
| `newsletter` | Promo, digests, GitHub bots | Yes |
| `spam` | Scams, fake AV, junk | Yes |
| `protected` | Bank, Cash App, Hetzner, Yahoo security | **Never** |

## CLI

```bash
# Classify last 50 inbox messages
node ~/.openclaw/workspace/skills/@gzlicanyi/imap-smtp-email/scripts/imap.js check --limit 50 --recent 7d \
  | node ~/.openclaw/workspace/skills/email-triage/scripts/triage.js

# JSON junk UID list for scripts
node imap.js check --limit 100 | node triage.js --select-junk --json

# Exclude GitHub/Cursor bot mail from junk selection
node imap.js check --limit 100 | node triage.js --select-junk --no-github --json
```

## Continuum chat examples

- "Triage my Yahoo inbox and list selectable junk"
- "Move selectable junk to trash"
- "Delete all newsletter and spam from the fetched list"

## Install on VPS

```bash
cp -r /tmp/continuum-mobile/skills/email-triage ~/.openclaw/workspace/skills/
```

Or run `bash integrations/continuum-bridge/sync-imap-skill.sh` (syncs IMAP + triage).
