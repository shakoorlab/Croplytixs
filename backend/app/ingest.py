"""
Ingest — turns a flight's uploaded orthophoto into the two files everything
after it reads. Runs as the Cloud Run job `croplytix-ingest` (`python -m
app.ingest <flight_id>`), or inside the API for local runs (see app/jobs.py).

    derived/cog.tif   lossless COG: every band, the original data type, DEFLATE.
                      What the clip and inference jobs will read.
    derived/view.tif  viewing COG: natural-colour 8-bit RGB plus a mask, WebP or
                      JPEG. About a fifth of the original's size; what the map in
                      the browser reads.

Why COGs. A Cloud-Optimized GeoTIFF stores the image in 512 px tiles, with
reduced copies (overviews) inside the file and the index at the front. A reader
fetches the first few kilobytes with an HTTP Range request, learns where every
tile of every level sits, and from then on asks for exactly the tiles it needs.
That is what lets a browser show a multi-gigabyte ortho a screenful at a time,
straight from the bucket. Most orthos arrive the other way round: one strip per
few hundred rows, no overviews (the Roujol A sample is 512-row strips).

Why two. A screenful of lossless tiles is ~10 MB, which drags on field Wi-Fi;
the viewing copy is a tenth of that. The jobs measure pixels, so they need the
lossless one. The upload itself is never modified.

The viewing copy is built from a small VRT — an XML description of "bands
3,2,1 of the source, rescaled to 8 bits, with its mask" — rather than from a
full-size intermediate, so GDAL streams source → COG and the only big files on
disk are the source and the output. On Cloud Run that disk is RAM.

The band choice and contrast stretch match the upload page's preview
(frontend/src/sections/trials/flight-setup/geo/readOrtho.js), so the map shows
the colours the user saw when they checked the grid.
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from .db import Repo, utcnow
from .storage import ObjectStore

log = logging.getLogger("croplytix.ingest")

COG_MEDIA_TYPE = "image/tiff; application=geotiff; profile=cloud-optimized"

# Shared by both outputs. 512 px tiles are the COG default and what OpenLayers
# requests; AVERAGE keeps the overviews free of the ringing CUBIC adds to
# field edges; BIGTIFF=IF_SAFER lets a >4 GB output happen without a retry.
_COG_OPTIONS = {
    "driver": "COG",
    "BLOCKSIZE": "512",
    "BIGTIFF": "IF_SAFER",
    "OVERVIEW_RESAMPLING": "AVERAGE",
    "NUM_THREADS": "ALL_CPUS",
}
_VIEW_QUALITY = {"WEBP": "80", "JPEG": "85"}

# Longest edge of the decimated read the stretch is computed from.
_STRETCH_SAMPLE_EDGE = 2048


class IngestError(Exception):
    """A problem with the flight itself, as opposed to a bug."""


# ---------------------------------------------------------------------------
# what to show
# ---------------------------------------------------------------------------
def natural_colour_bands(src) -> list[int]:
    """The 1-based source bands to show as red, green, blue.

    Bands labelled red/green/blue are taken at their word. Otherwise this is
    readOrtho.js's `bandIndicesFor('natural', …)`: multispectral sensors
    commonly write B,G,R,NIR,RE, so five or more colour bands means 3,2,1; four
    is R,G,B,NIR; one band is shown as grey.
    """
    from rasterio.enums import ColorInterp

    interp = list(src.colorinterp)
    named = {ci: i + 1 for i, ci in enumerate(interp)}
    if all(ci in named for ci in (ColorInterp.red, ColorInterp.green, ColorInterp.blue)):
        return [named[ColorInterp.red], named[ColorInterp.green], named[ColorInterp.blue]]

    colour = interp.index(ColorInterp.alpha) if ColorInterp.alpha in interp else src.count
    if colour <= 1:
        return [1, 1, 1]
    order = [3, 2, 1] if colour >= 5 else [1, 2, 3]
    return [min(band, colour) for band in order]


def stretch_bounds(src, bands: list[int]) -> tuple[float, float] | None:
    """Source values to map onto 0 and 255, or None when the bands are already 8-bit.

    One 2nd–98th percentile pair shared by the three bands, as on the upload
    page: stretching each band to its own range normalises away the differences
    between them, which is exactly what colour is. Display only — the lossless
    copy keeps the real values.
    """
    import numpy as np

    if all(src.dtypes[b - 1] == "uint8" for b in bands):
        return None
    scale = min(1.0, _STRETCH_SAMPLE_EDGE / max(src.width, src.height))
    shape = (len(bands), max(1, round(src.height * scale)), max(1, round(src.width * scale)))
    sample = src.read(bands, out_shape=shape, masked=True).compressed().astype("float64")
    sample = sample[np.isfinite(sample)]
    if not sample.size:
        return 0.0, 1.0
    lo, hi = (float(v) for v in np.percentile(sample, [2, 98]))
    return (lo, hi) if hi > lo else (lo, lo + 1)


def view_vrt(src_path: Path, src, bands: list[int], bounds: tuple[float, float] | None) -> str:
    """The viewing copy as a VRT: three 8-bit bands drawn from `src`, plus its mask."""
    from rasterio.enums import MaskFlags

    path = escape(str(Path(src_path).resolve()))
    scaling = ""
    if bounds:
        lo, hi = bounds
        ratio = 255.0 / (hi - lo)
        # out = in × ratio + offset; converting to Byte saturates at 0 and 255.
        scaling = f"<ScaleOffset>{-lo * ratio!r}</ScaleOffset><ScaleRatio>{ratio!r}</ScaleRatio>"

    colour_bands = "".join(
        f'<VRTRasterBand dataType="Byte" band="{i}"><ColorInterp>{name}</ColorInterp>'
        f'<ComplexSource><SourceFilename relativeToVRT="0">{path}</SourceFilename>'
        f"<SourceBand>{band}</SourceBand>{scaling}</ComplexSource></VRTRasterBand>"
        for i, (band, name) in enumerate(zip(bands, ("Red", "Green", "Blue")), start=1)
    )
    # `mask,1` is band 1's mask: the alpha band, the nodata value or an internal
    # mask, whichever the source has. Left out when every pixel is valid, so the
    # output doesn't carry a mask that hides nothing.
    mask = ""
    if MaskFlags.all_valid not in src.mask_flag_enums[0]:
        mask = (
            '<MaskBand><VRTRasterBand dataType="Byte"><SimpleSource>'
            f'<SourceFilename relativeToVRT="0">{path}</SourceFilename><SourceBand>mask,1</SourceBand>'
            "</SimpleSource></VRTRasterBand></MaskBand>"
        )
    srs = f"<SRS>{escape(src.crs.to_wkt())}</SRS>" if src.crs else ""
    transform = ", ".join(repr(v) for v in src.transform.to_gdal())
    return (
        f'<VRTDataset rasterXSize="{src.width}" rasterYSize="{src.height}">{srs}'
        f"<GeoTransform>{transform}</GeoTransform>{colour_bands}{mask}</VRTDataset>"
    )


def raster_info(src) -> dict[str, Any]:
    """What the map needs to place the ortho, recorded on the flight."""
    from rasterio.warp import transform_bounds

    crs = src.crs
    info: dict[str, Any] = {
        "width": src.width,
        "height": src.height,
        "bandCount": src.count,
        "dtype": src.dtypes[0],
        "georeferenced": crs is not None,
        "crs": crs.to_string() if crs else None,
        "epsg": crs.to_epsg() if crs else None,
        # rasterio writes flags as `+no_defs=True`; proj4js (in the browser) wants `+no_defs`.
        "proj4": crs.to_proj4().replace("=True", "") if crs else None,
        "wkt": crs.to_wkt() if crs else None,
        "bounds": list(src.bounds),  # left, bottom, right, top in `crs` units
        "resolution": list(src.res),
        "lonLatBounds": list(transform_bounds(crs, "EPSG:4326", *src.bounds)) if crs else None,
        "gsdCm": None,
    }
    if crs and crs.is_projected and crs.linear_units in ("metre", "meter"):
        info["gsdCm"] = round(src.res[0] * 100, 3)
    return info


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def build_lossless(src_path: Path, out_path: Path) -> None:
    import rasterio.shutil

    # PREDICTOR=YES picks 2 (integers) or 3 (floats) for the data type.
    rasterio.shutil.copy(str(src_path), str(out_path), COMPRESS="DEFLATE", PREDICTOR="YES", **_COG_OPTIONS)


def build_view(src_path: Path, out_path: Path, compression: str = "WEBP") -> None:
    import rasterio
    import rasterio.shutil

    with rasterio.open(src_path) as src:
        bands = natural_colour_bands(src)
        vrt = view_vrt(src_path, src, bands, stretch_bounds(src, bands))
    vrt_path = out_path.with_suffix(".vrt")
    vrt_path.write_text(vrt)
    try:
        rasterio.shutil.copy(str(vrt_path), str(out_path), COMPRESS=compression, QUALITY=_VIEW_QUALITY[compression], **_COG_OPTIONS)
    finally:
        vrt_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# one flight, start to finish
# ---------------------------------------------------------------------------
def _upload(store: ObjectStore, key: str, path: Path) -> int:
    with path.open("rb") as f:
        return store.put(key, f, content_type=COG_MEDIA_TYPE)


def ingest_flight(flight_id: str, repo: Repo, store: ObjectStore, *, view_compression: str = "WEBP") -> dict[str, Any]:
    """Builds both COGs for one flight and records the outcome on it.

    Never raises for a bad flight: the failure is written to `ingest` instead,
    where the flight page shows it. Returns that record. Each output is
    uploaded and deleted before the next is built, so at most the source and
    one output occupy the disk at once.
    """
    flight = repo.get_flight(flight_id)
    if not flight:
        raise LookupError(f"No flight '{flight_id}'.")
    previous = flight.get("ingest") or {}
    record: dict[str, Any] = {"state": "running", "queuedAt": previous.get("queuedAt"), "startedAt": utcnow()}
    repo.update_flight(flight_id, {"ingest": record})

    ortho = next((f for f in flight.get("files", []) if f["role"] == "ortho"), None)
    prefix = f"trials/{flight['trialId']}/flights/{flight_id}/derived"
    try:
        if not ortho:
            raise IngestError("This flight has no orthophoto to ingest.")
        import rasterio
        from rasterio.errors import RasterioError

        with tempfile.TemporaryDirectory(prefix="ingest-") as work:
            # Saved under the user's own filename so GDAL's messages name the file
            # they uploaded; in its own folder so an upload called cog.tif can't
            # collide with an output.
            source = Path(work) / "source" / ortho["name"]
            source.parent.mkdir()
            with source.open("wb") as out:
                for chunk in store.open(ortho["key"]):
                    out.write(chunk)
            try:
                with rasterio.open(source) as src:
                    raster = raster_info(src)

                cog = Path(work) / "cog.tif"
                build_lossless(source, cog)
                cog_bytes = _upload(store, f"{prefix}/cog.tif", cog)
                cog.unlink()

                view = Path(work) / "view.tif"
                build_view(source, view, view_compression)
                view_bytes = _upload(store, f"{prefix}/view.tif", view)
            except RasterioError as exc:
                # Some GDAL messages give the full temp path; the name is enough.
                raise IngestError(str(exc).replace(str(source), ortho["name"])) from exc

        record.update(
            state="complete",
            finishedAt=utcnow(),
            cog={"key": f"{prefix}/cog.tif", "bytes": cog_bytes, "compression": "DEFLATE"},
            view={"key": f"{prefix}/view.tif", "bytes": view_bytes, "compression": view_compression},
            raster=raster,
        )
    except IngestError as exc:
        log.warning("ingest %s failed: %s", flight_id, exc)
        record.update(state="failed", finishedAt=utcnow(), error=str(exc))
    except Exception:
        log.exception("ingest %s crashed", flight_id)
        record.update(state="failed", finishedAt=utcnow(), error="Ingest crashed; the server logs have the details.")

    repo.update_flight(flight_id, {"ingest": record})
    return record


# ---------------------------------------------------------------------------
# the Cloud Run job's entry point
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    """`python -m app.ingest <flight_id>`, or FLIGHT_ID in the environment —
    which is how the API passes it when it starts a job execution."""
    from .deps import get_repo, get_store
    from .settings import settings

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = sys.argv[1:] if argv is None else argv
    flight_id = args[0] if args else os.environ.get("FLIGHT_ID")
    if not flight_id:
        print("usage: python -m app.ingest <flight_id>   (or set FLIGHT_ID)", file=sys.stderr)
        return 2

    record = ingest_flight(flight_id, get_repo(), get_store(), view_compression=settings.VIEW_COMPRESSION)
    log.info("ingest %s: %s", flight_id, record["state"])
    # Non-zero marks the execution failed in the Cloud Run console.
    return 0 if record["state"] == "complete" else 1


if __name__ == "__main__":
    sys.exit(main())
