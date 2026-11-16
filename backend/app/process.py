"""
Processing — canopy area per plot for one flight. Runs as the Cloud Run job
`croplytix-process` (`python -m app.process <flight_id>`, or FLIGHT_ID in the
environment) from its own image, which has PyTorch (Dockerfile.process); or
inside the API for local runs (PROCESS_RUNNER=inline, app/jobs.py).

It reads the lossless COG ingest built, the plot grid and the model's weights,
runs app/pipeline, and writes under the flight's prefix:

    pred/<model>/<fingerprint>/canopy_prob.tif   probability raster, 0–255
    results/v<n>/plots.json      per-plot numbers and QC flags
    results/v<n>/canopy.csv      the export, in the research CSV's columns first
    results/v<n>/overlay.webp    each plot's canopy in its colour, ≤ 2000 px
    results/v<n>/assignment.tif  which plot each pixel went to (0 = nobody)
    results/v<n>/run.json        inputs and their hashes, model, settings, timings

then a `results` record in Firestore (summary, file keys, model, settings) and
points the flight at it. Every run is a new version n: nothing is overwritten,
so two runs can be compared and an export always names the version it came from.

The probability raster is keyed by the model, the COG and the field it covers.
A rerun with all three unchanged (a different grid nudge inside the same field
is a different field) reuses it, and skips the model: the watershed alone takes
seconds. That is the design's split between predict and watershed, ready for the
correction layer that will rerun only the watershed.

Failures are written on the flight (`processing.error`, `status: failed`) and
never raise out of `process_flight`, so the flight page always says what happened.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np

from .db import Repo, utcnow
from .model_registry import BASE_MODELS, ModelSpec, UnknownModel, resolve
from .storage import ObjectStore

log = logging.getLogger("croplytix.process")

OVERLAY_MAX_SIDE = 2000
STRIP_ROWS = 512


class ProcessError(Exception):
    """A problem with the flight or its inputs, said so the user can act on it."""


# ---------------------------------------------------------------------------
# inputs
# ---------------------------------------------------------------------------
def _local(store: ObjectStore, key: str, name: str, work: Path, source_dir: str | None) -> Path:
    """The object as a local path: in place on the bucket mount when there is
    one (see app/ingest.py), otherwise copied into its own folder under `work`."""
    if source_dir:
        mounted = Path(source_dir) / key
        if mounted.is_file():
            return mounted
        log.warning("process: %s is not under %s; copying it instead", key, source_dir)
    folder = work / "copies" / hashlib.sha1(key.encode()).hexdigest()[:12]
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    with path.open("wb") as out:
        for chunk in store.open(key):
            out.write(chunk)
    return path


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


_MODELS: dict[str, Any] = {}  # by weights SHA-256: an inline API process loads each model once


def _model(spec: ModelSpec, store: ObjectStore, work: Path, source_dir: str | None):
    if spec.sha256 in _MODELS:
        return _MODELS[spec.sha256]
    from .pipeline.detect import load_model

    if not store.exists(spec.weights_key):
        raise ProcessError(
            f"The weights for {spec.label} aren't in the bucket at {spec.weights_key}. "
            "Upload them first (docs/gcp-setup.md, step 12)."
        )
    folder = work / "model"
    folder.mkdir(exist_ok=True)
    path = _local(store, spec.weights_key, PurePosixPath(spec.weights_key).name, folder, source_dir)
    digest = _sha256(path)
    if spec.sha256 and digest != spec.sha256:
        raise ProcessError(f"The weights at {spec.weights_key} aren't {spec.label}'s (SHA-256 {digest[:12]}…, expected {spec.sha256[:12]}…).")
    _MODELS[spec.sha256] = load_model(path)
    return _MODELS[spec.sha256]


def _plot_grid(store: ObjectStore, flight: dict, work: Path) -> Path:
    """The flight's shapefile as a local .shp next to its .shx/.dbf/.prj/.cpg,
    from the separate files or a .zip."""
    files = [f for f in flight.get("files", []) if f["role"] == "shapefile"]
    if not files:
        raise ProcessError("This flight has no plot grid. Upload its shapefile to process it.")
    folder = work / "grid"
    folder.mkdir()
    for f in files:
        target = folder / f["name"]
        with target.open("wb") as out:
            for chunk in store.open(f["key"]):
                out.write(chunk)
        if target.suffix.lower() == ".zip":
            with zipfile.ZipFile(target) as z:
                for member in z.infolist():
                    name = PurePosixPath(member.filename).name
                    if member.is_dir() or not name or member.filename.startswith("__MACOSX") or name.startswith("."):
                        continue
                    (folder / name).write_bytes(z.read(member))  # flattened: names only, never paths
    shps = sorted(folder.glob("*.shp"))
    if len(shps) != 1:
        raise ProcessError(f"The plot grid should hold exactly one .shp; it has {len(shps)}.")
    return shps[0]


def _fingerprint(spec: ModelSpec, cog: dict, field: dict) -> str:
    """What the probability raster depends on: the weights, the COG, the field's grid."""
    payload = json.dumps({"model": spec.sha256, "cog": [cog.get("key"), cog.get("bytes")], "field": field}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# progress on the flight
# ---------------------------------------------------------------------------
class _Progress:
    """Writes `progress` (0–100) to the flight at most every few seconds; Firestore
    allows about one write a second to a document."""

    def __init__(self, repo: Repo, flight_id: str, record: dict):
        self.repo, self.flight_id, self.record = repo, flight_id, record
        self.last_write, self.last_value = 0.0, -1

    def stage(self, name: str, percent: int) -> None:
        self.record["stage"] = name
        self.set(percent, force=True)

    def set(self, percent: float, force: bool = False) -> None:
        value = int(max(0, min(99, percent)))
        now = time.time()
        if force or (value >= self.last_value + 2 and now - self.last_write >= 3):
            self.repo.update_flight(self.flight_id, {"progress": value, "processing": dict(self.record)})
            self.last_write, self.last_value = now, value


# ---------------------------------------------------------------------------
def _read_field(reader, height: int, step: int) -> tuple[np.ndarray, np.ndarray]:
    """The field's data mask in full, and its RGB every `step`th pixel (for the
    overlay), read a strip at a time so the full RGB is never held."""
    valid = np.zeros((height, reader.grid.width), bool)
    small = []
    for y0 in range(0, height, STRIP_ROWS):
        y1 = min(height, y0 + STRIP_ROWS)
        rgb, v = reader.read(y0, y1)
        valid[y0:y1] = v
        first = (-y0) % step  # keep rows whose field index is a multiple of step
        small.append(rgb[first::step, ::step])
    return valid, np.concatenate(small) if small else np.zeros((0, 0, 3), np.uint8)


def _put_bytes(store: ObjectStore, key: str, data: bytes, content_type: str) -> int:
    import io

    return store.put(key, io.BytesIO(data), content_type=content_type)


def _put_file(store: ObjectStore, key: str, path: Path, content_type: str) -> int:
    with path.open("rb") as f:
        return store.put(key, f, content_type=content_type)


def process_flight(flight_id: str, repo: Repo, store: ObjectStore, *, source_dir: str | None = None, max_megapixels: int | None = None) -> dict:
    """Processes one flight and records the outcome on it. Returns the result
    record, or the flight's failed `processing` record. Never raises for a bad flight."""
    from .settings import settings

    flight = repo.get_flight_unscoped(flight_id)
    if not flight:
        raise LookupError(f"No flight '{flight_id}'.")
    queued = flight.get("processing") or {}
    version = queued.get("version") or (flight.get("resultCount") or 0) + 1
    record: dict[str, Any] = {
        "state": "running",
        "version": version,
        "modelId": queued.get("modelId"),
        "queuedAt": queued.get("queuedAt"),
        "startedAt": utcnow(),
        "stage": "preparing",
    }
    repo.update_flight(
        flight_id,
        {"status": "running", "progress": 1, "error": None, "processing": dict(record), "resultCount": max(version, flight.get("resultCount") or 0)},
    )
    progress = _Progress(repo, flight_id, record)
    limit = max_megapixels or settings.PROCESS_MAX_MEGAPIXELS
    base = flight.get("storagePrefix") or f"trials/{flight['trialId']}/flights/{flight_id}"
    started = time.time()

    try:
        try:
            spec = resolve(record["modelId"])
        except UnknownModel as exc:
            raise ProcessError(str(exc)) from exc
        record["modelId"] = spec.id
        ingest = flight.get("ingest") or {}
        cog = ingest.get("cog") or {}
        if ingest.get("state") != "complete" or not cog.get("key"):
            raise ProcessError("The map copies aren't built yet. Once ingest finishes, process the flight again.")

        import rasterio

        from .pipeline import report
        from .pipeline.assign import WatershedSettings, assign_canopy
        from .pipeline.detect import (
            FieldReader,
            DetectError,
            check_orthophoto,
            detect_canopy,
            field_grid,
            read_probability,
            write_probability,
        )
        from .pipeline.grid import GridError, read_plots

        warnings: list[str] = []
        timings: dict[str, float] = {}
        with tempfile.TemporaryDirectory(prefix="process-") as tmp, rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            work = Path(tmp)
            shp = _plot_grid(store, flight, work)
            cog_path = _local(store, cog["key"], "cog.tif", work, source_dir)
            try:
                with rasterio.open(cog_path) as src:
                    check_orthophoto(src)
                    b = src.bounds
                    grid = read_plots(
                        shp, src.crs, mapping=flight.get("mapping") or None, offset=flight.get("offset"), centre=((b.left + b.right) / 2, (b.bottom + b.top) / 2)
                    )
                    field = field_grid(src, grid.bounds, model_gsd_cm=spec.gsd_cm)
                    megapixels = field.width * field.height / 1e6
                    if megapixels > limit:
                        raise ProcessError(
                            f"The field is {megapixels:.0f} million pixels at {field.gsd_cm:.1f} cm, more than the {limit} million a run takes on. "
                            "Split the grid, or raise PROCESS_MAX_MEGAPIXELS with the job's memory."
                        )
                    if field.resampled:
                        warnings.append(
                            f"The orthophoto's pixels are {field.source_gsd_cm:.2f} cm. It was read at {field.gsd_cm:.2f} cm, "
                            f"each pixel the mean of {field.factor} × {field.factor}, close to the {spec.gsd_cm} cm the model was trained at."
                        )
                    elif field.source_gsd_cm > spec.gsd_cm * 1.5:
                        warnings.append(
                            f"The orthophoto's pixels are {field.source_gsd_cm:.1f} cm; the model was trained at {spec.gsd_cm} cm, "
                            "so expect less accurate canopy edges."
                        )
                    if grid.left_out:
                        warnings.append(f"{grid.left_out} polygons in the plot grid had no usable plot identity and were left out.")

                    # 1. predict, unless this exact field has been predicted with this model
                    described = field.describe()
                    fingerprint = _fingerprint(spec, cog, described)
                    prob_key = f"{base}/pred/{spec.id}/{fingerprint}/canopy_prob.tif"
                    t0 = time.time()
                    if store.exists(prob_key):
                        progress.stage("reusing the canopy map", 80)
                        prob, _, _ = read_probability(_local(store, prob_key, "canopy_prob.tif", work, source_dir))
                        timings["reusedProbability"] = True
                    else:
                        progress.stage("loading the model", 4)
                        model = _model(spec, store, work, source_dir)
                        progress.stage("finding canopy", 5)
                        prob = detect_canopy(src, field, model, progress=lambda f: progress.set(5 + 75 * f))
                        prob_path = work / "canopy_prob.tif"
                        write_probability(prob_path, prob, field)
                        _put_file(store, prob_key, prob_path, "image/tiff")
                        prob_path.unlink()
                        timings["reusedProbability"] = False
                    timings["predictSeconds"] = round(time.time() - t0, 1)

                    step = max(1, max(field.width, field.height) // OVERLAY_MAX_SIDE)  # then BOX-resized to the size
                    reader = FieldReader(src, field)
                    valid, small_rgb = _read_field(reader, field.height, step)
            except (DetectError, GridError) as exc:
                raise ProcessError(str(exc)) from exc

            # 2. watershed
            progress.stage("assigning canopy to plots", 85)
            t0 = time.time()
            ws_settings = WatershedSettings()
            result = assign_canopy(prob, valid, field.transform, grid.plots, ws_settings)
            timings["assignSeconds"] = round(time.time() - t0, 1)
            warnings.extend(result.messages)
            n = len(result.plots)
            confidence = report.plot_confidence(prob, valid, result.boxes, n)
            date = flight.get("flightDate") or ""
            rows = report.plot_rows(result, field.pixel_area_cm2, confidence, date=date, site=flight.get("trialId", ""))
            if not rows:
                raise ProcessError("No plot in the grid falls on the orthophoto. Check the grid is for this field and date.")
            outside = n - len(rows)
            if outside:
                warnings.append(f"{outside} plots fall outside the orthophoto and have no result.")
            summary = report.summarize(rows, result, field.pixel_area_cm2)

            # 3. write the outputs
            progress.stage("writing results", 95)
            prefix = f"{base}/results/v{version}"
            files = {
                "plots": f"{prefix}/plots.json",
                "csv": f"{prefix}/canopy.csv",
                "overlay": f"{prefix}/overlay.webp",
                "assignment": f"{prefix}/assignment.tif",
                "metadata": f"{prefix}/run.json",
                "probability": prob_key,
            }
            _put_bytes(store, files["plots"], json.dumps(rows, separators=(",", ":")).encode(), "application/json")
            csv_text = report.to_csv(rows, date=date, model_id=spec.id, model_version=spec.version, result_version=version)
            _put_bytes(store, files["csv"], csv_text.encode(), "text/csv")

            blank_mask = None
            blanks = [(p.geometry, 1) for p in grid.plots if p.blank]
            if blanks:
                from rasterio.features import rasterize

                blank_mask = rasterize(blanks, out_shape=prob.shape, transform=field.transform, fill=0, dtype="uint8") > 0
            overlay = report.render_overlay(small_rgb, valid[::step, ::step], result, blank_mask, step=step)
            _put_bytes(store, files["overlay"], report.encode_image(overlay, max_side=OVERLAY_MAX_SIDE), "image/webp")

            assignment_path = work / "assignment.tif"
            with rasterio.open(
                assignment_path,
                "w",
                driver="GTiff",
                height=field.height,
                width=field.width,
                count=1,
                dtype="uint16" if n < 65535 else "uint32",
                crs=field.crs,
                transform=field.transform,
                compress="deflate",
                tiled=True,
                blockxsize=512,
                blockysize=512,
                nodata=0,
            ) as dst:
                dst.write(result.regions.astype(dst.dtypes[0]), 1)
            _put_file(store, files["assignment"], assignment_path, "image/tiff")

            timings["totalSeconds"] = round(time.time() - started, 1)
            settings_record = {
                "watershed": ws_settings.as_dict(),
                "field": {"marginM": 3.0, "tilePx": 128, "stridePx": 64},
                "offset": flight.get("offset"),
                "mapping": grid.mapping,
                "flags": {
                    "nearZeroCoverPct": report.NEAR_ZERO_COVER,
                    "saturatedCoverPct": report.SATURATED_COVER,
                    "lowConfidence": report.LOW_CONFIDENCE,
                    "cutShare": report.CUT_SHARE,
                    "lostShare": report.LOST_SHARE,
                },
            }
            inputs = {
                "cog": {"key": cog["key"], "bytes": cog.get("bytes")},
                "files": [{"role": f["role"], "name": f["name"], "md5": f.get("md5"), "bytes": f.get("bytes")} for f in flight.get("files", [])],
            }
            metadata = {
                "flightId": flight_id,
                "trialId": flight.get("trialId"),
                "flightDate": date,
                "version": version,
                "createdAt": utcnow(),
                "model": spec.record(),
                "settings": settings_record,
                "field": described,
                "inputs": inputs,
                "summary": summary,
                "warnings": warnings,
                "timings": timings,
                "software": _software(),
            }
            _put_bytes(store, files["metadata"], json.dumps(metadata, indent=2).encode(), "application/json")

        doc = {
            "id": f"{flight_id}:v{version}",
            "flightId": flight_id,
            "accountId": flight.get("accountId"),
            "trialId": flight.get("trialId"),
            "trialKey": flight.get("trialKey"),
            "version": version,
            "createdAt": metadata["createdAt"],
            "model": spec.record(),
            "settings": settings_record,
            "field": described,
            "summary": summary,
            "warnings": warnings,
            "timings": timings,
            "files": files,
        }
        repo.create_result(doc)
        record.update(state="complete", finishedAt=utcnow(), stage=None)
        repo.update_flight(
            flight_id,
            {
                "status": "complete",
                "progress": 100,
                "error": None,
                "processing": record,
                "result": {
                    "id": doc["id"],
                    "version": version,
                    "createdAt": doc["createdAt"],
                    "modelId": spec.id,
                    "modelLabel": spec.label,
                    "plots": summary["plots"],
                    "meanCover": summary["meanCover"],
                    "flaggedTotal": summary["flaggedTotal"],
                    "canopyCountedM2": summary["canopyCountedM2"],
                    "warnings": len(warnings),
                },
                "flagged": summary["pending"],
                "meanCover": summary["meanCover"],
                "modelId": spec.id,
                "model": spec.label,
            },
        )
        log.info("process %s: v%s complete, %s plots in %ss", flight_id, version, summary["plots"], timings["totalSeconds"])
        return doc
    except ProcessError as exc:
        log.warning("process %s failed: %s", flight_id, exc)
        message = str(exc)
    except MemoryError:
        log.exception("process %s ran out of memory", flight_id)
        message = "Processing ran out of memory. Give the job more (docs/gcp-setup.md, step 13), then process the flight again."
    except Exception:
        log.exception("process %s crashed", flight_id)
        message = "Processing crashed; the job's logs have the details."
    record.update(state="failed", finishedAt=utcnow(), stage=None, error=message)
    repo.update_flight(flight_id, {"status": "failed", "error": message, "processing": record})
    return record


def _software() -> dict:
    versions = {"python": sys.version.split()[0]}
    for name in ("torch", "segmentation_models_pytorch", "rasterio", "skimage", "numpy", "geopandas", "shapely"):
        module = sys.modules.get(name)
        if module is not None:
            versions[name] = getattr(module, "__version__", "?")
    return versions


# ---------------------------------------------------------------------------
# the Cloud Run job's entry point
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    """`python -m app.process <flight_id>`, or FLIGHT_ID in the environment."""
    from .deps import get_repo, get_store
    from .settings import settings

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = sys.argv[1:] if argv is None else argv
    flight_id = args[0] if args else os.environ.get("FLIGHT_ID")
    if not flight_id:
        print("usage: python -m app.process <flight_id>   (or set FLIGHT_ID)", file=sys.stderr)
        return 2
    try:
        import torch

        torch.set_num_threads(os.cpu_count() or 1)
    except ImportError:
        pass
    outcome = process_flight(flight_id, get_repo(), get_store(), source_dir=settings.INGEST_SOURCE_DIR)
    ok = outcome.get("state") != "failed"
    log.info("process %s: %s", flight_id, "complete" if ok else outcome.get("error"))
    return 0 if ok else 1


__all__ = ["BASE_MODELS", "ProcessError", "process_flight", "main"]

if __name__ == "__main__":
    sys.exit(main())
