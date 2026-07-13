"""
Reference: scheduled memory consolidation for continuum-backend (FastAPI).

Implements Phase 2 "Deep Neural Consolidation" from docs/PRD.md:
  - Punctuation-agnostic dedupe (keep newest per layer)
  - L2 conversational noise purge (entropy + filler patterns)
  - Ebbinghaus decay hard-delete (R < 0.4) on low-importance L2/L3

Mount in main app:
    from memory_consolidation_reference import router as memory_consolidation_router
    app.include_router(memory_consolidation_router)

Render Cron (daily 3:00 AM UTC):
    curl -sS -X POST "$CONTINUUM_API_URL/cron/memory-consolidate" \\
      -H "X-Consolidation-Secret: $CONSOLIDATION_SECRET"

Per-user (mobile / admin):
    POST /memories/consolidate   Authorization: Bearer <supabase_jwt>
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from memory_dedup import (
    ebbinghaus_retention,
    find_duplicate_groups,
    is_conversational_noise,
    layer_content_getter,
    pick_duplicate_removals,
)

router = APIRouter(tags=["memories"])

BATCH_SIZE = int(os.getenv("MEMORY_CONSOLIDATION_BATCH", "1000"))
RETENTION_THRESHOLD = float(os.getenv("MEMORY_RETENTION_THRESHOLD", "0.4"))
CONSOLIDATION_SECRET = os.getenv("CONSOLIDATION_SECRET", "")

LAYER_SPECS: list[tuple[str, str, str]] = [
    ("l1", "pinned_memories", "content"),
    ("l2", "episodic_segments", "content"),
    ("l3", "semantic_memories", "content"),
    ("l4", "temporal_events", "event_description"),
    ("l5", "document_chunks", "content"),
]

# In-memory last run log (replace with Redis/Postgres in production).
_LAST_RUNS: list[dict[str, Any]] = []


class DbClient(Protocol):
    async def fetch_user_ids(self, *, offset: int, limit: int) -> list[str]: ...
    async def fetch_rows(self, table: str, user_id: str, *, offset: int, limit: int) -> list[dict]: ...
    async def delete_rows(self, table: str, user_id: str, ids: list[str]) -> int: ...


@dataclass
class LayerReport:
    layer: str
    scanned: int = 0
    deduped: int = 0
    noise_purged: int = 0
    decay_purged: int = 0


@dataclass
class ConsolidationReport:
    user_id: str | None
    started_at: str
    finished_at: str | None = None
    layers: list[LayerReport] = field(default_factory=list)
    total_removed: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "total_removed": self.total_removed,
            "error": self.error,
            "layers": [layer.__dict__ for layer in self.layers],
        }


def get_db() -> DbClient:
    raise NotImplementedError("Wire get_db to Supabase/Postgres async client")


def get_current_user_id() -> str:
    raise NotImplementedError("Wire get_current_user_id to Supabase JWT")


def verify_consolidation_secret(x_consolidation_secret: str | None) -> None:
    if not CONSOLIDATION_SECRET:
        raise HTTPException(status_code=503, detail="CONSOLIDATION_SECRET not configured")
    if x_consolidation_secret != CONSOLIDATION_SECRET:
        raise HTTPException(status_code=401, detail="Invalid consolidation secret")


def _parse_dt(raw: Any) -> datetime | None:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


async def consolidate_layer_for_user(
    db: DbClient,
    user_id: str,
    layer: str,
    table: str,
    *,
    purge_l2_noise: bool = True,
    apply_decay: bool = True,
) -> LayerReport:
    report = LayerReport(layer=layer)
    getter = layer_content_getter(layer)
    offset = 0

    while True:
        rows = await db.fetch_rows(table, user_id, offset=offset, limit=BATCH_SIZE)
        if not rows:
            break
        report.scanned += len(rows)

        ids_to_delete: set[str] = set()

        # 1) Dedupe — keep newest fingerprint match
        for group in find_duplicate_groups(rows, getter):
            for victim in pick_duplicate_removals(group):
                vid = str(victim.get("id") or "")
                if vid and vid not in ids_to_delete:
                    ids_to_delete.add(vid)
                    report.deduped += 1

        # 2) L2 noise purge
        if purge_l2_noise and layer == "l2":
            for row in rows:
                rid = str(row.get("id") or "")
                if rid in ids_to_delete:
                    continue
                if is_conversational_noise(getter(row)):
                    ids_to_delete.add(rid)
                    report.noise_purged += 1

        # 3) Ebbinghaus incinerator (L2/L3)
        if apply_decay and layer in ("l2", "l3"):
            for row in rows:
                rid = str(row.get("id") or "")
                if rid in ids_to_delete:
                    continue
                created = _parse_dt(row.get("created_at") or row.get("timestamp"))
                mentions = int(row.get("mention_count") or row.get("mentions") or 1)
                importance = float(row.get("importance_score") or row.get("importance") or 5.0)
                if ebbinghaus_retention(
                    created_at=created,
                    mention_count=mentions,
                    importance_score=importance,
                ) < RETENTION_THRESHOLD:
                    ids_to_delete.add(rid)
                    report.decay_purged += 1

        if ids_to_delete:
            await db.delete_rows(table, user_id, sorted(ids_to_delete))

        if len(rows) < BATCH_SIZE:
            break
        offset += BATCH_SIZE

    return report


async def run_consolidation_for_user(db: DbClient, user_id: str) -> ConsolidationReport:
    report = ConsolidationReport(
        user_id=user_id,
        started_at=datetime.utcnow().isoformat() + "Z",
    )
    try:
        for layer, table, _column in LAYER_SPECS:
            layer_report = await consolidate_layer_for_user(db, user_id, layer, table)
            report.layers.append(layer_report)
            report.total_removed += (
                layer_report.deduped + layer_report.noise_purged + layer_report.decay_purged
            )
        report.finished_at = datetime.utcnow().isoformat() + "Z"
    except Exception as exc:  # noqa: BLE001 — top-level cron should log and continue users
        report.error = str(exc)
        report.finished_at = datetime.utcnow().isoformat() + "Z"
    return report


async def run_consolidation_all_users(db: DbClient) -> dict[str, Any]:
    started = datetime.utcnow().isoformat() + "Z"
    user_offset = 0
    user_limit = 100
    user_reports: list[dict[str, Any]] = []
    total_removed = 0
    errors = 0

    while True:
        user_ids = await db.fetch_user_ids(offset=user_offset, limit=user_limit)
        if not user_ids:
            break
        for uid in user_ids:
            result = await run_consolidation_for_user(db, uid)
            user_reports.append(result.to_dict())
            total_removed += result.total_removed
            if result.error:
                errors += 1
        if len(user_ids) < user_limit:
            break
        user_offset += user_limit

    summary = {
        "status": "success",
        "started_at": started,
        "finished_at": datetime.utcnow().isoformat() + "Z",
        "users_processed": len(user_reports),
        "total_removed": total_removed,
        "errors": errors,
        "users": user_reports[:50],  # trim payload; store full log in DB
    }
    _LAST_RUNS.insert(0, summary)
    del _LAST_RUNS[30:]
    return summary


class ConsolidationOptions(BaseModel):
    dedupe: bool = True
    purge_noise: bool = True
    apply_decay: bool = True


@router.post("/memories/consolidate")
async def consolidate_my_memories(
    options: ConsolidationOptions | None = None,
    user_id: str = Depends(get_current_user_id),
    db: DbClient = Depends(get_db),
):
    """Run consolidation for the authenticated user (mobile Setup button)."""
    _ = options  # wire flags into consolidate_layer_for_user when implementing
    report = await run_consolidation_for_user(db, user_id)
    _LAST_RUNS.insert(0, report.to_dict())
    del _LAST_RUNS[30:]
    if report.error:
        raise HTTPException(status_code=500, detail=report.error)
    return {"status": "success", **report.to_dict()}


@router.post("/cron/memory-consolidate")
async def cron_memory_consolidate(
    x_consolidation_secret: str | None = Header(default=None, alias="X-Consolidation-Secret"),
    db: DbClient = Depends(get_db),
):
    """Nightly job — all users. Auth via X-Consolidation-Secret."""
    verify_consolidation_secret(x_consolidation_secret)
    return await run_consolidation_all_users(db)


@router.get("/memories/consolidation/latest")
async def consolidation_latest(
    x_consolidation_secret: str | None = Header(default=None, alias="X-Consolidation-Secret"),
    user_id: str | None = Depends(get_current_user_id),
):
    """
    Return last consolidation runs.
    Cron/admin: X-Consolidation-Secret.
    User: Bearer token — returns runs where user_id matches (when logged).
    """
    if x_consolidation_secret:
        verify_consolidation_secret(x_consolidation_secret)
        return {"runs": _LAST_RUNS[:14]}
    if user_id:
        mine = [r for r in _LAST_RUNS if r.get("user_id") == user_id]
        return {"runs": mine[:14]}
    raise HTTPException(status_code=401, detail="Auth required")


# ---------------------------------------------------------------------------
# Example asyncpg DbClient (paste into continuum-backend db layer)
# ---------------------------------------------------------------------------
EXAMPLE_DB_CLIENT = '''
class PostgresMemoryDb:
    def __init__(self, pool):
        self.pool = pool

    async def fetch_user_ids(self, *, offset: int, limit: int) -> list[str]:
        rows = await self.pool.fetch(
            """
            SELECT DISTINCT user_id FROM (
              SELECT user_id FROM episodic_segments
              UNION SELECT user_id FROM semantic_memories
              UNION SELECT user_id FROM pinned_memories
            ) u
            ORDER BY user_id
            OFFSET $1 LIMIT $2
            """,
            offset, limit,
        )
        return [str(r["user_id"]) for r in rows]

    async def fetch_rows(self, table: str, user_id: str, *, offset: int, limit: int) -> list[dict]:
        rows = await self.pool.fetch(
            f"SELECT * FROM {table} WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT $3",
            user_id, offset, limit,
        )
        return [dict(r) for r in rows]

    async def delete_rows(self, table: str, user_id: str, ids: list[str]) -> int:
        if not ids:
            return 0
        result = await self.pool.execute(
            f"DELETE FROM {table} WHERE user_id = $1 AND id = ANY($2::uuid[])",
            user_id, ids,
        )
        return int(result.split()[-1])
'''

if __name__ == "__main__":
    print("memory_consolidation_reference.py — copy into continuum-backend")
    print("See integrations/continuum-backend/MEMORY_CONSOLIDATION.md")
