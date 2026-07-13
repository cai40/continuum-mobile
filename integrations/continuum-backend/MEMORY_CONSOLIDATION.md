# Memory consolidation (backend deploy guide)

Scheduled **Phase 2** maintenance from `docs/PRD.md` and `docs/Engineering_Design.md`:

| Step | Logic | File |
|------|--------|------|
| Dedupe | Punctuation-insensitive; keep newest | `memory_dedup.py` |
| L2 noise | Shannon entropy & filler patterns | `memory_dedup.py` |
| Decay | Ebbinghaus \(R < 0.4\) on L2/L3 | `memory_consolidation_reference.py` |

Mobile app **manual dedupe** (`Setup → Remove duplicates`) uses the same fingerprint rules in `src/utils/memoryDedup.js`.

---

## 1. Copy into continuum-backend

```text
integrations/continuum-backend/memory_dedup.py              → app/memory_dedup.py
integrations/continuum-backend/memory_consolidation_reference.py → app/routers/memory_consolidation.py
integrations/continuum-backend/memory_delete_reference.py → app/routers/memory_delete.py  (optional, pairs with mobile trash icon)
```

Wire dependencies:

```python
# main.py
from app.routers.memory_consolidation import router as memory_consolidation_router
from app.routers.memory_delete import router as memory_delete_router

app.include_router(memory_consolidation_router)
app.include_router(memory_delete_router)
```

Implement `get_db()` and `get_current_user_id()` (see example `PostgresMemoryDb` at bottom of `memory_consolidation_reference.py`).

---

## 2. Environment variables (Render main backend)

| Variable | Example | Purpose |
|----------|---------|---------|
| `CONSOLIDATION_SECRET` | random 32+ chars | Cron auth (`X-Consolidation-Secret`) |
| `MEMORY_CONSOLIDATION_BATCH` | `1000` | Rows per pagination slice |
| `MEMORY_RETENTION_THRESHOLD` | `0.4` | Ebbinghaus incinerator cutoff |

---

## 3. Render Cron Job

**Dashboard → New → Cron Job** (same repo as continuum-backend or a ops repo)

| Field | Value |
|-------|--------|
| Schedule | `0 3 * * *` (3:00 AM UTC daily) |
| Command | see below |

```bash
curl -sS -X POST "https://continuum-backend-0q9j.onrender.com/cron/memory-consolidate" \
  -H "X-Consolidation-Secret: ${CONSOLIDATION_SECRET}" \
  -H "Content-Type: application/json"
```

Weekly deep pass (optional second job):

```bash
# 0 4 * * 0  — Sundays 4:00 AM UTC
```

---

## 4. API surface (after deploy)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/cron/memory-consolidate` | `X-Consolidation-Secret` | All users (nightly) |
| `POST` | `/memories/consolidate` | Bearer JWT | Current user on-demand |
| `GET` | `/memories/consolidation/latest` | Secret or JWT | Last run summaries |
| `POST` | `/memories/delete` | Bearer JWT | Single-item delete (mobile trash) |

Verify OpenAPI lists the new routes after deploy.

---

## 5. Manual test

```bash
# On-demand for your account (Supabase access token)
curl -sS -X POST "https://continuum-backend-0q9j.onrender.com/memories/consolidate" \
  -H "Authorization: Bearer YOUR_SUPABASE_JWT" \
  -H "Content-Type: application/json" \
  -d '{}'

# Cron dry-run (staging)
curl -sS -X POST "https://YOUR-STAGING/cron/memory-consolidate" \
  -H "X-Consolidation-Secret: YOUR_SECRET"
```

Expected response shape:

```json
{
  "status": "success",
  "user_id": "...",
  "total_removed": 42,
  "layers": [
    { "layer": "l1", "scanned": 120, "deduped": 15, "noise_purged": 0, "decay_purged": 0 },
    { "layer": "l2", "scanned": 800, "deduped": 20, "noise_purged": 5, "decay_purged": 2 }
  ]
}
```

---

## 6. Relationship to other jobs

| Job | Service | What it cleans |
|-----|---------|----------------|
| **Memory consolidation** | continuum-backend | L1–L5 dedupe, decay, L2 noise |
| **Daily email cleanup** | continuum-email-bridge | Inbox newsletters/promos → Trash |
| **Post-chat archiver** | continuum-backend (existing) | Real-time L2/L3 after each chat |

Memory consolidation does **not** replace post-chat archiving; it compacts duplicates and low-retention fragments on a schedule.

---

## 7. Mobile app (after backend deploy)

The app can call `POST /memories/consolidate` from Setup (optional button). Until the route is live, use **Remove duplicates (all)** in the vault for on-device cleanup.
