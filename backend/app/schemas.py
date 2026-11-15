"""
Request / response shapes.

Pydantic models do the validation *and* generate the OpenAPI docs you see at
/docs. Field names are camelCase on purpose — they match what the React pages
already destructure from the mock fixtures, so swapping fixtures for fetches
does not ripple into the components.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# trials
# ---------------------------------------------------------------------------
class TrialCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    crop: str = Field(min_length=1, max_length=60)
    site: str = Field(min_length=1, max_length=120)
    season: str = Field(min_length=1, max_length=20)
    plots: int = Field(default=0, ge=0)
    rosterFile: str | None = None


class Trial(BaseModel):
    """What the lobby table renders. The last five fields are *derived* from the
    trial's flights on every read, never stored — so they cannot drift."""

    id: str
    name: str
    crop: str
    site: str
    season: str
    plots: int
    rosterFile: str | None = None
    createdAt: str
    flightDates: int = 0
    processed: int = 0
    expected: int = 0
    flagged: int = 0
    lastActivity: str  # ISO timestamp; the UI formats it relatively


# ---------------------------------------------------------------------------
# flights
# ---------------------------------------------------------------------------
class GridOffset(BaseModel):
    dxCm: float = 0
    dyCm: float = 0
    rotDeg: float = 0


class FlightMeta(BaseModel):
    """Everything the upload page knows *about* the flight, sent alongside the
    list of files it is about to upload. Extra keys (ortho band count,
    shapefile fields…) are kept verbatim: `extra="allow"` means the page can add
    detail without a backend deploy.

    The model and the area denominator are *processing* choices, made when a
    flight is run rather than when its files arrive, so an upload may leave
    them out. Flights uploaded with them keep them."""

    model_config = ConfigDict(extra="allow")

    flightDate: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    # Pre-clipped plot images are gone: plots are cut from the ortho by the
    # processing jobs. Older flights may still say "clipped" (Flight.source is a str).
    source: Literal["ortho"] = "ortho"
    capture: str  # e.g. "12-ms" — the code from ALTITUDES in constants.js
    captureLabel: str | None = None  # e.g. "12 m · MS"
    modelId: str | None = None
    modelLabel: str | None = None
    denominator: Literal["polygon", "clip"] | None = None
    plots: int = Field(default=0, ge=0)
    offset: GridOffset = GridOffset()
    insetCm: float = 0
    mapping: dict[str, Any] = {}
    ortho: dict[str, Any] | None = None
    shapefile: dict[str, Any] | None = None


class StoredFile(BaseModel):
    role: Literal["ortho", "shapefile", "clipped", "roster"]
    name: str
    bytes: int
    contentType: str | None = None
    key: str  # object key inside the bucket
    # Cloud Storage's MD5 of what arrived, as hex — the input-file hash a run's
    # metadata records. None until the upload completes (and on older flights).
    md5: str | None = None


class FileDeclaration(BaseModel):
    """One file the browser is about to upload. Its size is binding: the upload
    session is opened for exactly this many bytes."""

    role: Literal["ortho", "shapefile"]
    name: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0)
    # The browser's guess is ignored (a .dbf often comes with none); the API
    # sets the content type from the extension. Accepted so a client may send it.
    contentType: str | None = None


class FlightCreate(BaseModel):
    """POST /api/trials/{id}/flights: the flight's facts and the files to come.
    Exactly one ortho; the plot shapefile is optional — a complete
    .shp/.shx/.dbf/.prj set (with an optional .cpg) or a single .zip."""

    meta: FlightMeta
    files: list[FileDeclaration] = Field(min_length=1, max_length=10)


class UploadTarget(BaseModel):
    """Where the browser sends one file: a resumable upload session URL. It is
    the only credential the upload needs, so it is returned to this caller once
    and never stored or logged."""

    role: str
    name: str
    url: str


class FlightUploads(BaseModel):
    flight: "Flight"
    uploads: list[UploadTarget]


class IngestOutput(BaseModel):
    key: str  # object key inside the bucket
    bytes: int
    compression: str


class Ingest(BaseModel):
    """What ingest has made of the flight's orthophoto (app/ingest.py). Its own
    state, separate from `Flight.status`: ingest is the first step of
    processing, and a flight with its COGs built still has no results."""

    state: Literal["queued", "running", "complete", "failed"]
    queuedAt: str | None = None
    startedAt: str | None = None
    finishedAt: str | None = None
    error: str | None = None
    cog: IngestOutput | None = None  # lossless, every band — for the jobs
    view: IngestOutput | None = None  # 8-bit natural colour + mask — for the map
    raster: dict[str, Any] | None = None  # size, bands, CRS, bounds; see ingest.raster_info
    # "mount" when the job read the ortho in place from the bucket mount,
    # "copy" when it had to copy it to local disk first (see INGEST_SOURCE_DIR).
    readFrom: Literal["mount", "copy"] | None = None


class Flight(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    trialId: str
    flightDate: str
    source: str
    capture: str
    plots: int
    model: str | None = None  # None until a model is chosen to process the flight
    modelId: str | None = None
    # awaiting_upload: the record exists, the files are on their way to the
    # bucket. `complete` on the upload moves it to uploaded, and ingest starts.
    status: Literal["awaiting_upload", "uploaded", "queued", "running", "complete", "failed"]
    progress: int = 0
    flagged: int | None = None
    meanCover: float | None = None
    error: str | None = None
    createdBy: str | None = None
    createdAt: str
    uploadedAt: str | None = None
    files: list[StoredFile] = []
    ingest: Ingest | None = None  # source=ortho flights only


FlightUploads.model_rebuild()
