"""
/api/trials/{trial_id}/flights

A flight = one capture date's inputs (ortho + shapefile, or a folder of
pre-clipped plot images) plus the run configuration chosen on the upload page.

Creating one is the interesting request: it is `multipart/form-data` carrying
a JSON `meta` field and 1..N files. The handler streams each file into the
bucket, then writes ONE Firestore document that records where every file
landed. Order matters — bytes first, record second — so a record never points
at an object that doesn't exist. (A crash between the two leaves an orphaned
object, which costs fractions of a cent and can be swept up later; the reverse
would leave a broken row the UI trips over forever.)

These handlers are plain `def`, not `async def`. FastAPI runs sync handlers in
a threadpool, which is exactly right for the Google client libraries — they
are blocking, and an `async def` around them would stall the event loop for
the whole upload.

Today status ends at "uploaded". The clip + inference worker that moves it to
queued → running → complete is the next slice of backend, and it will read the
same document this writes.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from ..db import Repo, utcnow
from ..deps import get_repo, get_store
from ..ids import flight_id, safe_filename
from ..schemas import Flight, FlightMeta, StoredFile
from ..settings import settings
from ..storage import ObjectStore

router = APIRouter(prefix="/trials/{trial_id}/flights", tags=["flights"])


def _require_trial(trial_id: str, repo: Repo) -> dict:
    trial = repo.get_trial(trial_id)
    if not trial:
        raise HTTPException(404, f"No trial with id '{trial_id}'.")
    return trial


def _size_of(upload: UploadFile) -> int:
    # Starlette spools uploads to a temp file past ~1 MB, so seeking is cheap
    # and tells us the size without reading the bytes into memory.
    upload.file.seek(0, 2)
    size = upload.file.tell()
    upload.file.seek(0)
    return size


def _store_all(store: ObjectStore, prefix: str, role: str, uploads: list[UploadFile]) -> list[StoredFile]:
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    stored: list[StoredFile] = []
    for upload in uploads:
        size = _size_of(upload)
        if size == 0:
            continue
        if size > limit:
            raise HTTPException(413, f"{upload.filename} is {size >> 20} MB; the limit is {settings.MAX_UPLOAD_MB} MB.")
        name = safe_filename(upload.filename or role)
        key = f"{prefix}/{role}/{name}"
        written = store.put(key, upload.file, content_type=upload.content_type)
        stored.append(StoredFile(role=role, name=name, bytes=written, contentType=upload.content_type, key=key))
    return stored


@router.get("", response_model=list[Flight])
def list_flights(trial_id: str, repo: Repo = Depends(get_repo)):
    _require_trial(trial_id, repo)
    return repo.list_flights(trial_id)


@router.post("", response_model=Flight, status_code=201)
def create_flight(
    trial_id: str,
    meta: Annotated[str, Form(description="FlightMeta as a JSON string")],
    ortho: Annotated[UploadFile | None, File()] = None,
    shapefile: Annotated[list[UploadFile], File()] = [],
    clipped: Annotated[list[UploadFile], File()] = [],
    repo: Repo = Depends(get_repo),
    store: ObjectStore = Depends(get_store),
):
    _require_trial(trial_id, repo)

    # `meta` arrives as text because multipart has no JSON part type; parse and
    # validate it with the same model the docs show.
    try:
        parsed = FlightMeta.model_validate(json.loads(meta))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(422, f"meta is not valid: {exc}") from exc

    if parsed.source == "ortho" and not (ortho and shapefile):
        raise HTTPException(422, "source=ortho needs an `ortho` file and at least one `shapefile` part.")
    if parsed.source == "clipped" and not clipped:
        raise HTTPException(422, "source=clipped needs one or more `clipped` files.")

    fid = flight_id()
    prefix = f"trials/{trial_id}/flights/{fid}"

    files: list[StoredFile] = []
    if ortho:
        files += _store_all(store, prefix, "ortho", [ortho])
    files += _store_all(store, prefix, "shapefile", shapefile)
    files += _store_all(store, prefix, "clipped", clipped)

    doc = {
        "id": fid,
        "trialId": trial_id,
        **parsed.model_dump(),
        # what the runs table shows in its Model column
        "model": parsed.modelLabel or parsed.modelId,
        "status": "uploaded",
        "progress": 0,
        "flagged": None,
        "meanCover": None,
        "error": None,
        "createdAt": utcnow(),
        "files": [f.model_dump() for f in files],
    }
    repo.create_flight(doc)
    return doc


@router.get("/{flight_id}", response_model=Flight)
def get_flight(trial_id: str, flight_id: str, repo: Repo = Depends(get_repo)):
    flight = repo.get_flight(flight_id)
    if not flight or flight["trialId"] != trial_id:
        raise HTTPException(404, f"No flight '{flight_id}' in trial '{trial_id}'.")
    return flight


@router.get("/{flight_id}/files/{role}/{name}")
def download_file(
    trial_id: str,
    flight_id: str,
    role: str,
    name: str,
    repo: Repo = Depends(get_repo),
    store: ObjectStore = Depends(get_store),
):
    """Streams an input file back out of the bucket.

    The bucket has public-access-prevention on, so this endpoint is the only
    door. For big files in production you would hand the browser a short-lived
    *signed URL* and let it fetch from the bucket directly, taking the backend
    out of the data path; that needs the service account to be able to sign,
    which is a small IAM step we have not done yet.
    """
    flight = get_flight(trial_id, flight_id, repo)
    match = next((f for f in flight.get("files", []) if f["role"] == role and f["name"] == name), None)
    if not match:
        raise HTTPException(404, "No such file on this flight.")
    return StreamingResponse(
        store.open(match["key"]),
        media_type=match.get("contentType") or "application/octet-stream",
        headers={"Content-Length": str(match["bytes"]), "Content-Disposition": f'inline; filename="{name}"'},
    )
