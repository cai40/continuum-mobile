"""
Reference: add granular memory delete to continuum-backend (FastAPI).

Mount in main app:
    from memory_delete_reference import router as memory_delete_router
    app.include_router(memory_delete_router)

Mobile client tries (in order):
    POST /memories/delete  { "layer": "l2", "id": "<uuid>" }
    DELETE /memories/{layer}/{id}
    DELETE /memories/pinned/{id}   (L1 only)

Tables (see docs/Engineering_Design.md):
    l1 -> pinned_memories
    l2 -> episodic_segments
    l3 -> semantic_memories
    l4 -> temporal_events
    l5 -> document_chunks
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(tags=["memories"])

LAYER_TABLE = {
    "l1": "pinned_memories",
    "l2": "episodic_segments",
    "l3": "semantic_memories",
    "l4": "temporal_events",
    "l5": "document_chunks",
}


class MemoryDeleteBody(BaseModel):
    layer: str = Field(..., pattern="^l[1-5]$")
    id: str


def get_current_user_id():  # noqa: D103 — replace with your auth dependency
    raise NotImplementedError("Wire get_current_user_id to Supabase JWT")


def get_db():  # noqa: D103 — replace with Supabase/Postgres client
    raise NotImplementedError("Wire get_db to your database layer")


@router.post("/memories/delete")
async def delete_memory(body: MemoryDeleteBody, user_id: str = Depends(get_current_user_id)):
    table = LAYER_TABLE.get(body.layer)
    if not table:
        raise HTTPException(status_code=400, detail="Invalid layer")
    db = get_db()
    # Example: await db.execute(f"DELETE FROM {table} WHERE id = $1 AND user_id = $2", body.id, user_id)
    deleted = False  # set True when row removed
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"status": "success", "layer": body.layer, "id": body.id}


@router.delete("/memories/{layer}/{memory_id}")
async def delete_memory_by_path(layer: str, memory_id: str, user_id: str = Depends(get_current_user_id)):
    return await delete_memory(MemoryDeleteBody(layer=layer, id=memory_id), user_id=user_id)


@router.delete("/memories/pinned/{memory_id}")
async def delete_pinned_memory(memory_id: str, user_id: str = Depends(get_current_user_id)):
    return await delete_memory(MemoryDeleteBody(layer="l1", id=memory_id), user_id=user_id)
