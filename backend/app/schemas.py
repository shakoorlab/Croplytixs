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
    """Everything the upload page knows *about* the flight, sent as one JSON
    field alongside the files. Extra keys (ortho band count, shapefile fields…)
    are kept verbatim: `extra="allow"` means the page can add detail without a
    backend deploy."""

    model_config = ConfigDict(extra="allow")

    flightDate: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    source: Literal["ortho", "clipped"]
    capture: str  # e.g. "12-ms" — the code from ALTITUDES in constants.js
    captureLabel: str | None = None  # e.g. "12 m · MS"
    modelId: str
    modelLabel: str | None = None
    denominator: Literal["polygon", "clip"] = "polygon"
    plots: int = Field(default=0, ge=0)
    offset: GridOffset = GridOffset()
    insetCm: float = 0
    mapping: dict[str, Any] = {}
    ortho: dict[str, Any] | None = None
    shapefile: dict[str, Any] | None = None
    filenamePattern: str | None = None
    createdBy: str | None = None


class StoredFile(BaseModel):
    role: Literal["ortho", "shapefile", "clipped", "roster"]
    name: str
    bytes: int
    contentType: str | None = None
    key: str  # object key inside the bucket


class Flight(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    trialId: str
    flightDate: str
    source: str
    capture: str
    plots: int
    model: str
    modelId: str
    status: Literal["uploaded", "queued", "running", "complete", "failed"]
    progress: int = 0
    flagged: int | None = None
    meanCover: float | None = None
    error: str | None = None
    createdBy: str | None = None
    createdAt: str
    files: list[StoredFile] = []
