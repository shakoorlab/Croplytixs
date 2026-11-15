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
os.environ["AUTH_PROJECT_ID"] = "test-project"  # the start-up check needs one; never used to fetch keys
os.environ["INGEST_RUNNER"] = "off"  # route tests upload fake TIFFs; tests/test_ingest.py turns it on

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, deps  # noqa: E402
from app.db import MemoryRepo  # noqa: E402
from app.main import app  # noqa: E402
from app.storage import LocalObjectStore  # noqa: E402
from tests.tokens import PROJECT, FakeKeySource  # noqa: E402

# Route tests are about trials and flights, not sign-in: their requests arrive
# already signed in as this user. tests/test_auth.py covers the real thing.
TEST_USER = auth.User(uid="uid-test", email="test@example.com")


@pytest.fixture
def repo() -> MemoryRepo:
    return MemoryRepo()


@pytest.fixture
def store(tmp_path) -> LocalObjectStore:
    return LocalObjectStore(tmp_path / "objects")


@pytest.fixture
def keys() -> FakeKeySource:
    return FakeKeySource()


@pytest.fixture
def client(repo, store, keys) -> TestClient:
    app.dependency_overrides[deps.get_repo] = lambda: repo
    app.dependency_overrides[deps.get_store] = lambda: store
    app.dependency_overrides[auth.current_user] = lambda: TEST_USER
    app.dependency_overrides[auth.get_verifier] = lambda: auth.GoogleTokenVerifier(PROJECT, keys=keys)
    deps.get_repo.cache_clear()
    deps.get_store.cache_clear()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def browser(repo, store, keys) -> TestClient:
    """A client with no sign-in shortcut: current_user runs for real, against
    tokens from tests/tokens.py."""
    app.dependency_overrides[deps.get_repo] = lambda: repo
    app.dependency_overrides[deps.get_store] = lambda: store
    app.dependency_overrides[auth.get_verifier] = lambda: auth.GoogleTokenVerifier(PROJECT, keys=keys)
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


# ---------------------------------------------------------------------------
# uploading a flight the way the browser does
# ---------------------------------------------------------------------------
FAKE_ORTHO = b"II*\x00fake-geotiff"
DEFAULT_META = {"flightDate": "2026-08-20", "capture": "12-ms", "plots": 144}


def shapefile_set(stem: str = "plots") -> dict[str, bytes]:
    return {f"{stem}.{ext}": f"fake-{ext}".encode() for ext in ("shp", "shx", "dbf", "prj")}


def declare(ortho: bytes = FAKE_ORTHO, shapefile: dict[str, bytes] | None = None, ortho_name: str = "field.tif") -> list[dict]:
    """The `files` list of a create request. shapefile=None → a complete set; {} → none."""
    shapefile = shapefile_set() if shapefile is None else shapefile
    return [{"role": "ortho", "name": ortho_name, "size": len(ortho)}] + [
        {"role": "shapefile", "name": name, "size": len(data)} for name, data in shapefile.items()
    ]


def start_flight(client, trial: dict, files: list[dict] | None = None, meta: dict | None = None):
    """POST …/flights — returns the raw response."""
    body = {"meta": {**DEFAULT_META, **(meta or {})}, "files": files if files is not None else declare()}
    return client.post(f"/api/trials/{trial['id']}/flights", json=body)


def put_file(client, url: str, data: bytes, chunk: int | None = None):
    """Sends `data` to an upload session as the browser does: PUTs with a
    Content-Range, each resuming from the Range the last 308 reported.
    `chunk` must be a multiple of 256 KiB. Returns the final response."""
    size, chunk, offset = len(data), chunk or len(data), 0
    while True:
        end = min(offset + chunk, size)
        r = client.put(url, content=data[offset:end], headers={"Content-Range": f"bytes {offset}-{end - 1}/{size}"})
        if r.status_code == 200:
            return r
        assert r.status_code == 308, r.text
        offset = int(r.headers["range"].rsplit("-", 1)[1]) + 1


def upload_flight(
    client,
    trial: dict,
    ortho: bytes = FAKE_ORTHO,
    shapefile: dict[str, bytes] | None = None,
    meta: dict | None = None,
    ortho_name: str = "field.tif",
) -> dict:
    """The whole browser flow — declare, PUT every file, complete. Returns the completed flight."""
    shapefile = shapefile_set() if shapefile is None else shapefile
    r = start_flight(client, trial, declare(ortho, shapefile, ortho_name), meta)
    assert r.status_code == 201, r.text
    body = r.json()
    contents = {ortho_name: ortho, **shapefile}
    for target in body["uploads"]:
        put_file(client, target["url"], contents[target["name"]])
    done = client.post(f"/api/trials/{trial['id']}/flights/{body['flight']['id']}/complete")
    assert done.status_code == 200, done.text
    return done.json()
