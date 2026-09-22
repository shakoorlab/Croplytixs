"""
Wiring: builds the one ObjectStore and one Repo the process uses, based on
settings. Routers ask for them via FastAPI's `Depends`, which keeps the
routers testable — a test can override `get_repo` with a MemoryRepo.
"""

from __future__ import annotations

from functools import lru_cache

from .db import FirestoreRepo, MemoryRepo, Repo
from .settings import settings
from .storage import GcsObjectStore, LocalObjectStore, ObjectStore


@lru_cache(maxsize=1)
def get_store() -> ObjectStore:
    if settings.STORAGE_BACKEND == "local":
        return LocalObjectStore(settings.LOCAL_STORAGE_DIR)
    if not settings.GCS_BUCKET:
        raise RuntimeError("STORAGE_BACKEND=gcs but GCS_BUCKET is not set")
    return GcsObjectStore(settings.GCS_BUCKET, project=settings.GCP_PROJECT)


@lru_cache(maxsize=1)
def get_repo() -> Repo:
    if settings.DB_BACKEND == "memory":
        return MemoryRepo()
    return FirestoreRepo(project=settings.GCP_PROJECT, database=settings.FIRESTORE_DATABASE)
