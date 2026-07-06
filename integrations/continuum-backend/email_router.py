"""
HTTPS proxy: Continuum mobile app → Render FastAPI → Render email bridge (Node IMAP).

Deploy into continuum-backend and mount:
  from integrations.continuum_backend import email_router  # adjust import path
  app.include_router(email_router.router)

Main Render service env:
  CONTINUUM_EMAIL_BRIDGE_URL=https://continuum-email-bridge.onrender.com
  CONTINUUM_EMAIL_BRIDGE_SECRET=<shared secret with Node bridge>

Mobile app (after deploy):
  POST {API_URL}/integrations/email/chat/stream
  Authorization: Bearer <supabase session>
  (No VPS / Cloudflare tunnel required.)
"""

from __future__ import annotations

import os
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter(prefix="/integrations/email", tags=["integrations", "email"])

EMAIL_BRIDGE_URL = os.getenv("CONTINUUM_EMAIL_BRIDGE_URL", "").rstrip("/")
EMAIL_BRIDGE_SECRET = os.getenv(
    "CONTINUUM_EMAIL_BRIDGE_SECRET",
    os.getenv("RENDER_EMAIL_BRIDGE_SECRET", ""),
)


def bridge_base() -> str:
    url = EMAIL_BRIDGE_URL.strip()
    if not url:
        raise HTTPException(
            503,
            "Email bridge not configured. Set CONTINUUM_EMAIL_BRIDGE_URL on Render "
            "and deploy integrations/render-email-bridge (see README).",
        )
    return url


async def require_user_bearer(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    return authorization


def bridge_headers(token: str) -> dict[str, str]:
    headers = {
        "Authorization": token,
        "Content-Type": "application/json",
    }
    if EMAIL_BRIDGE_SECRET:
        headers["X-Bridge-Secret"] = EMAIL_BRIDGE_SECRET
    return headers


def _secret_headers() -> dict[str, str]:
    return {"X-Bridge-Secret": EMAIL_BRIDGE_SECRET} if EMAIL_BRIDGE_SECRET else {}


@router.get("/health")
async def email_health() -> dict:
    url = f"{bridge_base()}/health"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(url, headers=_secret_headers())
            res.raise_for_status()
            data = res.json()
            data["proxy"] = "render-email"
            return data
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Email bridge unreachable: {exc}") from exc


@router.post("/chat/stream")
async def email_chat_stream(
    request: Request,
    token: str = Depends(require_user_bearer),
) -> StreamingResponse:
    body = await request.body()
    headers = bridge_headers(token)
    headers["Content-Type"] = request.headers.get("content-type", "application/json")
    url = f"{bridge_base()}/chat/stream"

    async def stream() -> AsyncIterator[bytes]:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, headers=headers, content=body) as res:
                if res.status_code >= 400:
                    detail = await res.aread()
                    raise HTTPException(
                        res.status_code,
                        detail.decode("utf-8", errors="replace"),
                    )
                async for chunk in res.aiter_bytes():
                    yield chunk

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.get("/status")
async def email_status() -> JSONResponse:
    configured = bool(EMAIL_BRIDGE_URL.strip())
    return JSONResponse(
        {
            "configured": configured,
            "bridge_url_set": configured,
            "message": (
                "Render cloud email ready"
                if configured
                else "Deploy continuum-email-bridge and set CONTINUUM_EMAIL_BRIDGE_URL"
            ),
        }
    )
