# Render Web Service — Continuum email bridge (Node)

Deploy as a **second Render Web Service** from this repo, or run locally for testing.

## Render settings

| Field | Value |
|-------|--------|
| **Root directory** | *(repo root)* |
| **Build command** | `cd skills/@gzlicanyi/imap-smtp-email && npm ci --omit=dev` |
| **Start command** | `bash integrations/render-email-bridge/start.sh` |
| **Health check path** | `/health` |

## Environment variables (Render dashboard → Secrets)

| Variable | Required | Example |
|----------|----------|---------|
| `YAHOO_EMAIL` | Yes | `you@yahoo.com` |
| `YAHOO_APP_PASSWORD` | Yes | Yahoo **app password** (Account → Security → Generate app password) |
| `CONTINUUM_API_URL` | No | `https://continuum-backend-0q9j.onrender.com` **only** — do not append `/integrations/email` |
| `BRIDGE_SECRET` or `RENDER_EMAIL_BRIDGE_SECRET` | Yes | Random string; must match `CONTINUUM_EMAIL_BRIDGE_SECRET` on main backend |

## Wire into continuum-backend (FastAPI)

1. Copy `integrations/continuum-backend/email_router.py` into your FastAPI app.
2. Mount: `app.include_router(email_router.router)`
3. Set on **main** Render service:

```
CONTINUUM_EMAIL_BRIDGE_URL=https://your-email-bridge.onrender.com
CONTINUUM_EMAIL_BRIDGE_SECRET=<same as BRIDGE_SECRET above>
```

4. Mobile app calls `POST /integrations/email/chat/stream` on `API_URL` (no VPS).

## Test locally

```bash
export YAHOO_EMAIL=you@yahoo.com
export YAHOO_APP_PASSWORD=your-app-password
export PORT=8787
bash integrations/render-email-bridge/start.sh
```

```bash
curl -s http://127.0.0.1:8787/health | jq .
```

## Architecture

```
iPhone → continuum-backend (Render) /integrations/email/chat/stream
              ↓ proxy (JWT + bridge secret)
         continuum-email-bridge (Render Node) → Yahoo IMAP
              ↓
         continuum-backend /chat/stream (memory + LLM)
```

No user VPS required when this path is enabled in the app (Settings → Render cloud email).
