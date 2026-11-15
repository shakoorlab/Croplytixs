"""
/api/trials/{trial_id}/flights

A flight = one capture date's orthophoto, optionally its plot shapefile, and
what the upload page knows about them (date, camera, grid alignment).

Uploading one takes three requests, because the files never pass through the
API — Cloud Run refuses requests over 32 MiB, and an ortho is gigabytes:

  1. POST …/flights          {meta, files: [{role, name, size}]}
                             → the flight, status `awaiting_upload`, plus one
                               resumable upload session URL per file.
  2. the browser PUTs each file to its URL, in chunks, straight to the bucket
     (app/storage.py describes the protocol).
  3. POST …/flights/{fid}/complete
                             → the API checks every file arrived at its declared
                               size, records each one's MD5, marks the flight
                               `uploaded` and starts ingest (app/jobs.py).

A session URL is a credential for one object: it goes back to the uploader in
the response to (1) and is never stored or logged. If it is lost — a different
browser, or more than a week later — POST …/{fid}/uploads opens new sessions
for the files that haven't arrived. DELETE …/{fid} abandons an unfinished upload.

The record is written *after* the upload sessions open, so a flight never
exists without a way to upload its files; and `complete` is the only way to
`uploaded`, so a flight never claims files the bucket doesn't hold.

Every lookup is scoped to the caller's account (app/db.py): another account's
flight answers 404, exactly like one that doesn't exist.

These handlers are plain `def`, not `async def`. FastAPI runs sync handlers in
a threadpool, which is exactly right for the Google client libraries — they
are blocking, and an `async def` around them would stall the event loop.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from ..auth import User, current_account, current_user
from ..db import Repo, trial_key, utcnow
from ..deps import get_repo, get_store
from ..ids import flight_id as new_flight_id
from ..ids import safe_filename
from ..jobs import queued, start_ingest
from ..schemas import FileDeclaration, Flight, FlightCreate, FlightUploads, StoredFile, UploadTarget
from ..settings import settings
from ..storage import ObjectStore

log = logging.getLogger("croplytix.flights")

router = APIRouter(prefix="/trials/{trial_id}/flights", tags=["flights"])

ORTHO_EXTENSIONS = (".tif", ".tiff")
SHAPEFILE_REQUIRED = (".shp", ".shx", ".dbf", ".prj")
SHAPEFILE_OPTIONAL = (".cpg",)  # the .dbf's text encoding — matters for accented variety names
CONTENT_TYPES = {".tif": "image/tiff", ".tiff": "image/tiff", ".zip": "application/zip", ".prj": "text/plain", ".cpg": "text/plain"}

# Fields the API owns. FlightMeta keeps unknown keys so the page can record more
# detail without a backend deploy, but none of these may come from the client.
SERVER_FIELDS = {
    "id", "accountId", "trialId", "trialKey", "storagePrefix", "status", "progress", "flagged", "meanCover",
    "error", "model", "createdBy", "createdAt", "uploadedAt", "files", "ingest", "results",
}  # fmt: skip


STALLED_INGEST = (
    "Ingest stopped without finishing. On a large orthophoto that usually means the job ran out "
    "of memory: give it more (docs/gcp-setup.md, step 10), then Retry."
)


def _settled(flight: dict) -> dict:
    """The flight as it really stands. A job killed for running out of memory
    can't write that it failed, so an ingest still "running" well past the
    job's timeout is reported as failed — read-only; nothing is written."""
    ingest = flight.get("ingest") or {}
    started = ingest.get("startedAt")
    if ingest.get("state") == "running" and started:
        limit = timedelta(minutes=settings.INGEST_TIMEOUT_MINUTES + 5)
        if datetime.now(timezone.utc) - datetime.fromisoformat(started) > limit:
            return {**flight, "ingest": {**ingest, "state": "failed", "error": STALLED_INGEST}}
    return flight


def _require_trial(account: str, trial_id: str, repo: Repo) -> dict:
    trial = repo.get_trial(account, trial_id)
    if not trial:
        raise HTTPException(404, f"No trial with id '{trial_id}'.")
    return trial


def _require_flight(account: str, trial_id: str, flight_id: str, repo: Repo) -> dict:
    flight = repo.get_flight(account, flight_id)
    if not flight or flight["trialId"] != trial_id:
        raise HTTPException(404, f"No flight '{flight_id}' in trial '{trial_id}'.")
    return _settled(flight)


def _megabytes(n: int) -> str:
    return f"{n / 2**30:.1f} GB" if n >= 2**30 else f"{n / 2**20:.1f} MB"


def _plan_files(declared: list[FileDeclaration]) -> list[FileDeclaration]:
    """Checks the files a flight is about to upload and returns them with safe
    names. Every refusal says what to change."""
    files = [d.model_copy(update={"name": safe_filename(d.name)}) for d in declared]

    seen: set[str] = set()
    for f in files:
        if f.name.lower() in seen:
            raise HTTPException(422, f"Two files are both named {f.name}.")
        seen.add(f.name.lower())

    orthos = [f for f in files if f.role == "ortho"]
    if len(orthos) != 1:
        raise HTTPException(422, "A flight needs exactly one orthophoto.")
    ortho = orthos[0]
    if PurePosixPath(ortho.name).suffix.lower() not in ORTHO_EXTENSIONS:
        raise HTTPException(422, f"{ortho.name} isn't a GeoTIFF. The orthophoto must be a .tif or .tiff file.")
    if ortho.size > settings.MAX_ORTHO_MB * 2**20:
        raise HTTPException(
            413, f"{ortho.name} is {_megabytes(ortho.size)}; orthophotos up to {_megabytes(settings.MAX_ORTHO_MB * 2**20)} are accepted."
        )

    parts = [f for f in files if f.role == "shapefile"]
    for part in parts:
        if part.size > settings.MAX_SHAPEFILE_MB * 2**20:
            raise HTTPException(
                413, f"{part.name} is {_megabytes(part.size)}; shapefile files up to {settings.MAX_SHAPEFILE_MB} MB are accepted."
            )
    _check_shapefile_set(parts)
    return files


def _check_shapefile_set(parts: list[FileDeclaration]) -> None:
    """None, a single .zip, or one complete set of parts sharing a name."""
    if not parts:
        return
    exts = [PurePosixPath(p.name).suffix.lower() for p in parts]
    if exts == [".zip"]:
        return
    if ".zip" in exts:
        raise HTTPException(422, "Send a zipped shapefile on its own, or its .shp, .shx, .dbf and .prj without the zip.")
    for part, ext in zip(parts, exts):
        if ext not in SHAPEFILE_REQUIRED + SHAPEFILE_OPTIONAL:
            raise HTTPException(422, f"{part.name} isn't part of a shapefile (.shp, .shx, .dbf, .prj, .cpg).")
    for ext in set(exts):
        if exts.count(ext) > 1:
            raise HTTPException(422, f"One shapefile per flight: there are {exts.count(ext)} {ext} files.")
    missing = [ext for ext in SHAPEFILE_REQUIRED if ext not in exts]
    if missing:
        raise HTTPException(
            422,
            f"The shapefile is missing its {', '.join(missing)}. All four are needed; "
            "the .prj says which coordinate system the plots are in.",
        )
    stems = sorted({PurePosixPath(p.name).stem.lower() for p in parts})
    if len(stems) > 1:
        raise HTTPException(422, f"The shapefile's files have different names ({', '.join(stems)}). Its parts must share one name.")


def _content_type(name: str) -> str:
    return CONTENT_TYPES.get(PurePosixPath(name).suffix.lower(), "application/octet-stream")


def _open_sessions(store: ObjectStore, files: list[StoredFile], origin: str | None) -> list[UploadTarget]:
    try:
        return [UploadTarget(role=f.role, name=f.name, url=store.start_upload(f.key, f.bytes, f.contentType, origin)) for f in files]
    except Exception:
        # The traceback can't contain a session URL: the call that failed never returned one.
        log.exception("could not open upload sessions")
        raise HTTPException(502, "Cloud Storage didn't open the upload. Try again in a moment.") from None


def _arrived(store: ObjectStore, file: dict) -> bool:
    info = store.stat(file["key"])
    return info is not None and info.size == file["bytes"]


@router.get("", response_model=list[Flight])
def list_flights(trial_id: str, account: str = Depends(current_account), repo: Repo = Depends(get_repo)):
    _require_trial(account, trial_id, repo)
    return [_settled(f) for f in repo.list_flights(account, trial_id)]


@router.post("", response_model=FlightUploads, status_code=201)
def create_flight(
    trial_id: str,
    body: FlightCreate,
    request: Request,
    user: User = Depends(current_user),
    account: str = Depends(current_account),
    repo: Repo = Depends(get_repo),
    store: ObjectStore = Depends(get_store),
):
    """Records the flight and opens one upload session per file."""
    _require_trial(account, trial_id, repo)
    planned = _plan_files(body.files)

    fid = new_flight_id()
    prefix = f"accounts/{account}/trials/{trial_id}/flights/{fid}"
    files = [
        StoredFile(role=f.role, name=f.name, bytes=f.size, contentType=_content_type(f.name), key=f"{prefix}/{f.role}/{f.name}")
        for f in planned
    ]
    uploads = _open_sessions(store, files, request.headers.get("origin"))

    meta = {k: v for k, v in body.meta.model_dump().items() if k not in SERVER_FIELDS}
    doc = {
        **meta,
        "id": fid,
        "accountId": account,
        "trialId": trial_id,
        "trialKey": trial_key(account, trial_id),
        "storagePrefix": prefix,
        # what the runs table shows in its Model column; None until a model is chosen
        "model": body.meta.modelLabel or body.meta.modelId,
        "status": "awaiting_upload",
        "progress": 0,
        "flagged": None,
        "meanCover": None,
        "error": None,
        "createdBy": user.email or user.uid,
        "createdAt": utcnow(),
        "files": [f.model_dump() for f in files],
    }
    repo.create_flight(doc)
    return {"flight": doc, "uploads": uploads}


@router.get("/{flight_id}", response_model=Flight)
def get_flight(trial_id: str, flight_id: str, account: str = Depends(current_account), repo: Repo = Depends(get_repo)):
    return _require_flight(account, trial_id, flight_id, repo)


@router.post("/{flight_id}/uploads", response_model=FlightUploads)
def reopen_uploads(
    trial_id: str,
    flight_id: str,
    request: Request,
    account: str = Depends(current_account),
    repo: Repo = Depends(get_repo),
    store: ObjectStore = Depends(get_store),
):
    """New upload sessions for the files that haven't arrived — when the old
    URLs are lost (another browser) or expired (Cloud Storage keeps a session
    for about a week). A file already in the bucket at its size gets none."""
    flight = _require_flight(account, trial_id, flight_id, repo)
    if flight["status"] != "awaiting_upload":
        raise HTTPException(409, "This flight's files have all been uploaded.")
    pending = [StoredFile(**f) for f in flight["files"] if not _arrived(store, f)]
    return {"flight": flight, "uploads": _open_sessions(store, pending, request.headers.get("origin"))}


@router.post("/{flight_id}/complete", response_model=Flight, responses={409: {"description": "Files missing or the wrong size"}})
def complete_upload(
    trial_id: str,
    flight_id: str,
    background: BackgroundTasks,
    account: str = Depends(current_account),
    repo: Repo = Depends(get_repo),
    store: ObjectStore = Depends(get_store),
):
    """Checks every file is in the bucket at its declared size, records its
    MD5, marks the flight uploaded and starts ingest. Safe to repeat: a
    flight that is already uploaded comes back as it is."""
    flight = _require_flight(account, trial_id, flight_id, repo)
    if flight["status"] != "awaiting_upload":
        return flight

    missing, wrong_size, files = [], [], []
    for f in flight["files"]:
        info = store.stat(f["key"])
        if info is None:
            missing.append(f["name"])
        elif info.size != f["bytes"]:
            wrong_size.append({"name": f["name"], "expected": f["bytes"], "received": info.size})
        else:
            files.append({**f, "md5": info.md5})
    if missing or wrong_size:
        detail = "Some files arrived at the wrong size." if wrong_size else f"Still waiting for {', '.join(missing)}."
        return JSONResponse(status_code=409, content={"detail": detail, "missing": missing, "wrongSize": wrong_size})

    has_ortho = any(f["role"] == "ortho" for f in files)
    fields = {"status": "uploaded", "uploadedAt": utcnow(), "files": files}
    if has_ortho:
        fields["ingest"] = queued()
    # Atomic, so of two racing completes exactly one starts ingest; the other
    # returns the flight as the winner left it.
    if not repo.transition_flight(flight_id, "awaiting_upload", fields):
        return repo.get_flight(account, flight_id)
    flight.update(fields)
    if has_ortho:
        flight["ingest"] = start_ingest(flight_id, repo, store, background)
    return flight


@router.delete("/{flight_id}", status_code=204)
def cancel_upload(
    trial_id: str,
    flight_id: str,
    account: str = Depends(current_account),
    repo: Repo = Depends(get_repo),
    store: ObjectStore = Depends(get_store),
):
    """Abandons a flight whose upload hasn't finished: removes any files that
    did arrive, then the record. Uploaded flights can't be deleted yet."""
    flight = _require_flight(account, trial_id, flight_id, repo)
    if flight["status"] != "awaiting_upload":
        raise HTTPException(409, "Only an upload that hasn't finished can be cancelled. Deleting flights isn't available yet.")
    for f in flight.get("files", []):
        store.delete(f["key"])
    repo.delete_flight(flight_id)
    return Response(status_code=204)


@router.post("/{flight_id}/ingest", response_model=Flight, status_code=202)
def rerun_ingest(
    trial_id: str,
    flight_id: str,
    background: BackgroundTasks,
    force: bool = False,
    account: str = Depends(current_account),
    repo: Repo = Depends(get_repo),
    store: ObjectStore = Depends(get_store),
):
    """Builds the flight's COGs again — after a failure, or for a flight
    uploaded before ingest existed. The outputs are overwritten in place."""
    flight = _require_flight(account, trial_id, flight_id, repo)
    if flight["status"] == "awaiting_upload":
        raise HTTPException(409, "The files haven't finished uploading yet.")
    if not any(f["role"] == "ortho" for f in flight.get("files", [])):
        raise HTTPException(422, "This flight has no orthophoto to ingest.")
    state = (flight.get("ingest") or {}).get("state")
    if state in ("queued", "running") and not force:
        raise HTTPException(409, f"Ingest is already {state}. Add ?force=true if it is stuck.")
    repo.update_flight(flight_id, {"ingest": queued()})
    record = start_ingest(flight_id, repo, store, background)
    return {**flight, "ingest": record}


@router.get("/{flight_id}/files/{role}/{name}")
def download_file(
    trial_id: str,
    flight_id: str,
    role: str,
    name: str,
    account: str = Depends(current_account),
    repo: Repo = Depends(get_repo),
    store: ObjectStore = Depends(get_store),
):
    """Streams an input file back out of the bucket.

    The bucket has public-access-prevention on, so this endpoint is the only
    door. It works for files up to Cloud Run's 32 MiB response limit; larger
    ones will get a short-lived signed download URL instead (with the map viewer),
    which takes the API out of the data path.
    """
    flight = _require_flight(account, trial_id, flight_id, repo)
    match = next((f for f in flight.get("files", []) if f["role"] == role and f["name"] == name), None)
    if not match or not store.exists(match["key"]):
        raise HTTPException(404, "No such file on this flight.")
    return StreamingResponse(
        store.open(match["key"]),
        media_type=match.get("contentType") or "application/octet-stream",
        headers={"Content-Length": str(match["bytes"]), "Content-Disposition": f'inline; filename="{name}"'},
    )
