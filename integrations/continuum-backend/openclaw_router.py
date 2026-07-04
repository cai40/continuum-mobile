"""
Continuum ↔ OpenClaw channel router (reference implementation).

Deploy into continuum-backend when ready for L6 Phase C.
Adds POST /integrations/channel for OpenClaw gateway webhooks.

Auth: X-Continuum-Integration-Token header (service token per user or global).
Maps (channel, sender_id) → Supabase user_id via openclaw_pairings table.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/integrations", tags=["integrations"])

INTEGRATION_TOKEN = os.getenv("CONTINUUM_OPENCLAW_TOKEN", "")


class ChannelInbound(BaseModel):
    channel: str = Field(..., description="sms | email | wechat | cli")
    sender_id: str = Field(..., description="Channel-native sender identifier")
    message: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChannelOutbound(BaseModel):
    reply: str
    actions: list[dict[str, Any]] = Field(default_factory=list)
    memory_saved: bool = True


def verify_integration_token(header: str | None) -> None:
    if not INTEGRATION_TOKEN:
        raise HTTPException(503, "Integration token not configured on server")
    if header != INTEGRATION_TOKEN:
        raise HTTPException(401, "Invalid integration token")


async def resolve_user_id(channel: str, sender_id: str) -> str:
    """
    Lookup openclaw_pairings table:
      (channel, sender_id) -> user_id (Supabase auth UUID)

    TODO: implement DB query when Phase C ships.
    """
    raise HTTPException(
        501,
        f"Pairing not configured for {channel}:{sender_id}. "
        "Link channel in Continuum app → Settings → OpenClaw Gateway.",
    )


@router.post("/channel", response_model=ChannelOutbound)
async def channel_inbound(
    payload: ChannelInbound,
    x_continuum_integration_token: str | None = Header(default=None),
) -> ChannelOutbound:
    """
    OpenClaw gateway posts inbound channel messages here.
    Continuum runs full L1-L5 retrieval + LLM, returns reply text.
    Optional actions[] are executed by OpenClaw (email send, etc.).
    """
    verify_integration_token(x_continuum_integration_token)
    user_id = await resolve_user_id(payload.channel, payload.sender_id)

    # TODO: delegate to existing chat pipeline:
    #   reply = await run_chat_for_user(user_id, payload.message, source=payload.channel)
    _ = user_id

    raise HTTPException(
        501,
        "Channel gateway not enabled on this deployment. "
        "Use continuum-brain skill on VPS for Phase 1 bridge.",
    )


@router.get("/channel/health")
async def channel_health() -> dict[str, str]:
    return {"status": "planned", "phase": "C"}
