"""
Test wiring.

Settings are read once at import time, so the adapter choice has to be in the
environment *before* `app` is imported — hence the os.environ lines at the top,
not in a fixture. Real env vars beat anything in a .env file, so a developer's
local .env can't leak Google credentials into the test run.

Each test gets a fresh MemoryRepo and a fresh temp folder for objects; the
lru_cache on deps is cleared so /api/health (which calls get_store/get_repo
directly rather than through Depends) sees the same instances.
"""

from __future__ import annotations

import os

os.environ["STORAGE_BACKEND"] = "local"
os.environ["DB_BACKEND"] = "memory"
os.environ["MAX_UPLOAD_MB"] = "1"  # small so the 413 path is cheap to exercise

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import deps  # noqa: E402
from app.db import MemoryRepo  # noqa: E402
from app.main import app  # noqa: E402
from app.storage import LocalObjectStore  # noqa: E402


@pytest.fixture
def repo() -> MemoryRepo:
    return MemoryRepo()


@pytest.fixture
def store(tmp_path) -> LocalObjectStore:
    return LocalObjectStore(tmp_path / "objects")


@pytest.fixture
def client(repo, store) -> TestClient:
    app.dependency_overrides[deps.get_repo] = lambda: repo
    app.dependency_overrides[deps.get_store] = lambda: store
    deps.get_repo.cache_clear()
    deps.get_store.cache_clear()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def trial(client) -> dict:
    r = client.post(
        "/api/trials",
        json={"name": "Guadeloupe Yam", "crop": "Yam", "site": "Guadeloupe", "season": "2026", "plots": 144},
    )
    assert r.status_code == 201, r.text
    return r.json()


def ortho_flight_parts(meta_overrides: dict | None = None):
    """Multipart body for a source=ortho flight: one ortho + a .shp/.prj pair."""
    import json

    meta = {"flightDate": "2026-08-20", "source": "ortho", "capture": "12-ms", "modelId": "cc-v1", "plots": 144}
    meta.update(meta_overrides or {})
    data = {"meta": json.dumps(meta)}
    files = [
        ("ortho", ("field.tif", b"II*\x00fake-geotiff", "image/tiff")),
        ("shapefile", ("plots.shp", b"fake-shp", "application/octet-stream")),
        ("shapefile", ("plots.prj", b"fake-prj", "text/plain")),
    ]
    return data, files
