"""
Croplytix backend — FastAPI application factory.

Run locally:   uvicorn app.main:app --reload --port 8000
Docs:          http://localhost:8000/docs   (generated from the routers)
Health:        http://localhost:8000/api/health
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .deps import get_repo, get_store
from .routers import flights, trials
from .settings import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Croplytix API", version="0.1.0")

# CORS only matters when the browser hits the API on a different origin than it
# loaded the page from (Vite on :3000 → API on :8000 without the dev proxy).
# Behind nginx everything is same-origin and this middleware never fires.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Every route lives under /api so nginx can forward exactly one prefix.
app.include_router(trials.router, prefix="/api")
app.include_router(flights.router, prefix="/api")


@app.get("/api/health", tags=["ops"])
def health():
    """Cheap liveness check — also tells you which adapters this process wired
    up, which is the first thing to look at when 'it works on my laptop'."""
    return {
        "ok": True,
        "storage": get_store().describe(),
        "db": get_repo().describe(),
    }
