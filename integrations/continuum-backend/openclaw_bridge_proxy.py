"""
HTTPS proxy: Continuum mobile app → Render → VPS continuum-bridge (HTTP).

Deploy into continuum-backend and mount on main FastAPI app:
  app.include_router(openclaw_bridge_proxy.router)

Render env:
  OPENCLAW_BRIDGE_HOST=135.181.155.197
  OPENCLAW_BRIDGE_PORT=8787
  OPENCLAW_BRIDGE_SECRET=openclaw2026

Mobile app (after deploy):
  bridgeBaseUrl = f"{API_URL}/integrations/openclaw/bridge"
"""

from __future__ import annotations

import os
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/integrations/openclaw/bridge", tags=["integrations"])

BRIDGE_HOST = os.getenv("OPENCLAW_BRIDGE_HOST", "135.181.155.197")
BRIDGE_PORT = os.getenv("OPENCLAW_BRIDGE_PORT", "8787")
BRIDGE_SECRET = os.getenv("OPENCLAW_BRIDGE_SECRET", "")


def bridge_base(host: str | None = None) -> str:
    h = (host or BRIDGE_HOST).strip()
    return f"http://{h}:{BRIDGE_PORT}"


async def require_user_bearer(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    return authorization


@router.get("/health")
async def bridge_health(
    request: Request,
    x_bridge_host: str | None = Header(default=None, alias="X-Bridge-Host"),
) -> dict:
    headers = {}
    if BRIDGE_SECRET:
        headers["X-Bridge-Secret"] = BRIDGE_SECRET
    url = f"{bridge_base(x_bridge_host)}/health"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            data = res.json()
            data["proxy"] = "render"
            return data
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Bridge unreachable: {exc}") from exc


@router.post("/chat/stream")
async def bridge_chat_stream(
    request: Request,
    token: str = Depends(require_user_bearer),
    x_bridge_host: str | None = Header(default=None, alias="X-Bridge-Host"),
) -> StreamingResponse:
    body = await request.body()
    headers = {
        "Authorization": token,
        "Content-Type": request.headers.get("content-type", "application/json"),
    }
    if BRIDGE_SECRET:
        headers["X-Bridge-Secret"] = BRIDGE_SECRET

    url = f"{bridge_base(x_bridge_host)}/chat/stream"

    async def stream() -> AsyncIterator[bytes]:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, headers=headers, content=body) as res:
                if res.status_code >= 400:
                    detail = await res.aread()
                    raise HTTPException(res.status_code, detail.decode("utf-8", errors="replace"))
                async for chunk in res.aiter_bytes():
                    yield chunk

    return StreamingResponse(stream(), media_type="text/event-stream")
