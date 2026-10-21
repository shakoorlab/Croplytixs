"""
Croplytix backend — FastAPI application factory.

Run locally:   uvicorn app.main:app --reload --port 8000
Docs:          http://localhost:8000/docs   (generated from the routers)
Health:        http://localhost:8000/api/health
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import TokenVerifier, User, current_user, get_verifier
from .deps import get_repo, get_store
from .routers import flights, trials
from .settings import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Build the verifier at start-up, so a revision deployed without
    # AUTH_PROJECT_ID fails to start (Cloud Run keeps serving the old one)
    # instead of starting fine and refusing every request.
    get_verifier()
    yield


app = FastAPI(title="Croplytix API", version="0.1.0", lifespan=lifespan)

# CORS only matters when the browser hits the API on a different origin than it
# loaded the page from (Vite on :3000 → API on :8000 without the dev proxy).
# Behind nginx everything is same-origin and this middleware never fires.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Every route lives under /api so nginx can forward exactly one prefix, and every
# one of them needs a signed-in user — except /api/health below, so an uptime
# check (or you, with curl) can ask "are you up?" without a token.
# tests/test_auth.py fails if a router is ever added without this.
signed_in = [Depends(current_user)]
app.include_router(trials.router, prefix="/api", dependencies=signed_in)
app.include_router(flights.router, prefix="/api", dependencies=signed_in)


@app.get("/api/me", tags=["auth"])
def me(user: User = Depends(current_user)) -> User:
    """Who the API thinks you are — the quickest way to test a token."""
    return user


@app.get("/api/health", tags=["ops"])
def health(verifier: TokenVerifier = Depends(get_verifier)):
    """Cheap liveness check — also tells you which adapters this process wired
    up, which is the first thing to look at when 'it works on my laptop'."""
    return {
        "ok": True,
        "storage": get_store().describe(),
        "db": get_repo().describe(),
        "auth": verifier.describe(),
    }
