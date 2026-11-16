from __future__ import annotations

import io

import numpy as np
import pytest
import rasterio
from rasterio.enums import ColorInterp, Compression, MaskFlags
from rasterio.transform import from_origin

from app import jobs
from app.ingest import build_lossless, build_view, ingest_flight, main, natural_colour_bands
from app.settings import settings
from tests.conftest import start_flight, upload_flight

# UTM 20N, Guadeloupe — the CRS of the Roujol A sample, at its 2.3 cm/px.
CRS = "EPSG:32620"
TRANSFORM = from_origin(650000.0, 1780000.0, 0.023, 0.023)
W, H = 1100, 900  # big enough that the COG driver builds an overview


def write_rgba(path, width=W, height=H):
    """8-bit RGBA with a transparent top-left triangle, like an ortho's footprint.
    Gradients rather than noise, so it DEFLATEs under the tests' 1 MB upload cap."""
    yy, xx = np.mgrid[0:height, 0:width]
    rgb = np.stack([xx % 180 + 40, yy % 180 + 40, (xx + yy) % 180 + 40]).astype(np.uint8)
    alpha = np.where(xx + yy < 300, 0, 255).astype(np.uint8)
    profile = dict(
        driver="GTiff", width=width, height=height, count=4, dtype="uint8", crs=CRS, transform=TRANSFORM, compress="deflate"
    )
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(np.concatenate([rgb, alpha[None]]))
        dst.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]
    return path


def write_multispectral(path):
    """5-band 16-bit B,G,R,NIR,RE: band b holds b × 3000, inside a nodata=0 frame."""
    data = np.zeros((5, H, W), dtype=np.uint16)
    for b in range(5):
        data[b, 50:-50, 50:-50] = (b + 1) * 3000
    profile = dict(driver="GTiff", width=W, height=H, count=5, dtype="uint16", crs=CRS, transform=TRANSFORM, nodata=0)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data)
    return path


def write_rgb(path):
    rng = np.random.default_rng(2)
    profile = dict(driver="GTiff", width=W, height=H, count=3, dtype="uint8", crs=CRS, transform=TRANSFORM)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(rng.integers(0, 255, size=(3, H, W), dtype=np.uint8))
    return path


def is_cog(ds) -> bool:
    return ds.tags(ns="IMAGE_STRUCTURE").get("LAYOUT") == "COG"


# ---------------------------------------------------------------------------
# the two files
# ---------------------------------------------------------------------------
def test_lossless_cog_keeps_every_band_and_value(tmp_path):
    src = write_rgba(tmp_path / "ortho.tif")
    build_lossless(src, tmp_path / "cog.tif")
    with rasterio.open(src) as a, rasterio.open(tmp_path / "cog.tif") as b:
        assert is_cog(b)
        assert b.compression == Compression.deflate
        assert b.count == 4 and b.dtypes == a.dtypes
        assert b.overviews(1), "a COG without overviews can't be read zoomed out"
        assert np.array_equal(a.read(), b.read())
        assert b.crs == a.crs and b.transform == a.transform


@pytest.mark.parametrize("compression", ["WEBP", "JPEG"])
def test_view_cog_is_8bit_rgb_with_the_footprint_masked(tmp_path, compression):
    src = write_rgba(tmp_path / "ortho.tif")
    build_view(src, tmp_path / "view.tif", compression)
    with rasterio.open(tmp_path / "view.tif") as v:
        assert is_cog(v)
        assert v.compression == Compression[compression.lower()]
        assert v.count == 3 and set(v.dtypes) == {"uint8"}
        assert v.overviews(1)
        assert v.mask_flag_enums[0] == [MaskFlags.per_dataset]
        mask = v.dataset_mask()
        assert mask[5, 5] == 0, "the transparent corner stays transparent"
        assert mask[H // 2, W // 2] == 255
        assert v.crs.to_string() == CRS and v.transform == TRANSFORM
    assert not (tmp_path / "view.vrt").exists()


def test_view_shows_multispectral_as_r_g_b_with_a_shared_stretch(tmp_path):
    src = write_multispectral(tmp_path / "ms.tif")
    with rasterio.open(src) as s:
        assert natural_colour_bands(s) == [3, 2, 1]
    build_view(src, tmp_path / "view.tif")
    with rasterio.open(tmp_path / "view.tif") as v:
        r, g, b = (int(x) for x in v.read()[:, H // 2, W // 2])
        # R (9000) is the 98th percentile → 255, B (3000) the 2nd → 0, G halfway.
        # One stretch for all three bands, so the bands stay distinct.
        assert r > 245 and b < 10 and 115 < g < 140
        assert v.dataset_mask()[10, 10] == 0, "nodata frame is masked"


def test_fully_valid_source_gets_no_mask(tmp_path):
    src = write_rgb(tmp_path / "rgb.tif")
    build_view(src, tmp_path / "view.tif")
    with rasterio.open(tmp_path / "view.tif") as v:
        assert v.mask_flag_enums[0] == [MaskFlags.all_valid]


# ---------------------------------------------------------------------------
# one flight, through the store and the repo
# ---------------------------------------------------------------------------
def stored_flight(repo, store, tmp_path, ortho_bytes: bytes, name="field.tif", prefix=None):
    """A flight as the API leaves it after `complete`. Without `prefix` it is one
    from before accounts, whose files sit under trials/ and that has no storagePrefix."""
    key = f"{prefix or 'trials/t1/flights/flt_1'}/ortho/{name}"
    store.put(key, io.BytesIO(ortho_bytes))
    doc = {
        "id": "flt_1",
        "trialId": "t1",
        "flightDate": "2026-08-20",
        "createdAt": "2026-08-20T12:00:00+00:00",
        "files": [{"role": "ortho", "name": name, "bytes": len(ortho_bytes), "key": key}],
        "ingest": jobs.queued(),
    }
    if prefix:
        doc.update(accountId="a1", trialKey="a1:t1", storagePrefix=prefix)
    repo.create_flight(doc)
    return key


def test_ingest_flight_writes_both_cogs_and_records_where_the_ortho_sits(repo, store, tmp_path):
    stored_flight(repo, store, tmp_path, write_rgba(tmp_path / "o.tif").read_bytes())
    record = ingest_flight("flt_1", repo, store)

    assert record["state"] == "complete", record
    assert repo.get_flight_unscoped("flt_1")["ingest"] == record
    assert record["readFrom"] == "copy"
    assert record["queuedAt"] and record["startedAt"] and record["finishedAt"]
    for part, compression in (("cog", "DEFLATE"), ("view", "WEBP")):
        assert record[part]["key"] == f"trials/t1/flights/flt_1/derived/{part}.tif"
        assert record[part]["compression"] == compression
        assert store.exists(record[part]["key"])
    raster = record["raster"]
    assert (raster["width"], raster["height"], raster["bandCount"]) == (W, H, 4)
    assert raster["epsg"] == 32620 and raster["gsdCm"] == 2.3
    lon_min, lat_min, lon_max, lat_max = raster["lonLatBounds"]
    assert -62 < lon_min < lon_max < -61 and 16 < lat_min < lat_max < 16.2


def test_outputs_go_under_the_flights_own_prefix(repo, store, tmp_path):
    prefix = "accounts/a1/trials/t1/flights/flt_1"
    stored_flight(repo, store, tmp_path, write_rgba(tmp_path / "o.tif").read_bytes(), prefix=prefix)
    record = ingest_flight("flt_1", repo, store)
    assert record["cog"]["key"] == f"{prefix}/derived/cog.tif"
    assert store.exists(f"{prefix}/derived/view.tif")


def test_ingest_reads_the_ortho_in_place_on_the_bucket_mount(repo, store, tmp_path):
    # The local store's folder *is* a mount of its bucket: same keys, same files.
    stored_flight(repo, store, tmp_path, write_rgba(tmp_path / "o.tif").read_bytes())
    record = ingest_flight("flt_1", repo, store, source_dir=str(store.root))
    assert record["state"] == "complete", record
    assert record["readFrom"] == "mount"


def test_ingest_copies_the_ortho_when_the_mount_lacks_it(repo, store, tmp_path):
    stored_flight(repo, store, tmp_path, write_rgba(tmp_path / "o.tif").read_bytes())
    (tmp_path / "empty-mount").mkdir()
    record = ingest_flight("flt_1", repo, store, source_dir=str(tmp_path / "empty-mount"))
    assert record["state"] == "complete", record
    assert record["readFrom"] == "copy"


def test_unreadable_ortho_on_the_mount_fails_with_the_users_filename(repo, store, tmp_path):
    stored_flight(repo, store, tmp_path, b"II*\x00not really a tiff")
    record = ingest_flight("flt_1", repo, store, source_dir=str(store.root))
    assert record["state"] == "failed"
    assert "field.tif" in record["error"] and str(store.root) not in record["error"]


def test_unreadable_ortho_fails_with_the_users_filename(repo, store, tmp_path):
    stored_flight(repo, store, tmp_path, b"II*\x00not really a tiff")
    record = ingest_flight("flt_1", repo, store)
    assert record["state"] == "failed"
    assert "field.tif" in record["error"] and "/ingest-" not in record["error"]
    assert not store.exists("trials/t1/flights/flt_1/derived/cog.tif")


def test_job_entry_point_needs_a_flight_id(monkeypatch):
    monkeypatch.delenv("FLIGHT_ID", raising=False)
    assert main([]) == 2


# ---------------------------------------------------------------------------
# started from the API
# ---------------------------------------------------------------------------
def upload(client, trial, tmp_path, ortho: bytes | None = None):
    if ortho is None:
        return upload_flight(client, trial)
    return upload_flight(client, trial, ortho=ortho)


def test_completed_upload_queues_ingest_and_inline_runs_it(client, trial, store, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "INGEST_RUNNER", "inline")
    flight = upload(client, trial, tmp_path, write_rgba(tmp_path / "o.tif").read_bytes())
    assert flight["ingest"]["state"] == "queued"  # the answer goes out before ingest runs

    after = client.get(f"/api/trials/{trial['id']}/flights/{flight['id']}").json()
    assert after["ingest"]["state"] == "complete", after["ingest"]
    assert store.exists(after["ingest"]["view"]["key"])
    # The flight has a plot grid, so ingest queued processing (which is off in tests).
    assert after["status"] == "queued"
    assert after["processing"]["state"] == "queued" and after["processing"]["version"] == 1


def test_runner_off_leaves_the_flight_queued(client, trial, tmp_path):
    flight = upload(client, trial, tmp_path)
    assert flight["ingest"]["state"] == "queued"


def test_nothing_is_ingested_before_the_upload_completes(client, trial):
    flight = start_flight(client, trial).json()["flight"]
    assert flight.get("ingest") is None
    assert client.post(f"/api/trials/{trial['id']}/flights/{flight['id']}/ingest").status_code == 409


def test_rerun_refuses_while_queued_unless_forced(client, trial, tmp_path, monkeypatch):
    flight = upload(client, trial, tmp_path)
    path = f"/api/trials/{trial['id']}/flights/{flight['id']}/ingest"
    assert client.post(path).status_code == 409
    assert client.post(f"{path}?force=true").status_code == 202

    # a failed ingest can be retried without forcing
    monkeypatch.setattr(settings, "INGEST_RUNNER", "inline")
    client.post(f"{path}?force=true")
    assert client.get(f"/api/trials/{trial['id']}/flights/{flight['id']}").json()["ingest"]["state"] == "failed"
    r = client.post(path)
    assert r.status_code == 202 and r.json()["ingest"]["state"] == "queued"


class FakeSession:
    def __init__(self, status=200, body=None):
        self.status, self.body, self.calls = status, body or {"name": "operations/op-1"}, []

    def post(self, url, json=None, timeout=None):
        self.calls.append((url, json))
        status, body = self.status, self.body

        class Response:
            status_code = status
            text = str(body)

            @staticmethod
            def json():
                return body

        return Response()


def test_cloudrun_runner_starts_the_job_with_the_flight_id(monkeypatch):
    monkeypatch.setattr(settings, "INGEST_REGION", "us-central1")
    session = FakeSession()
    assert jobs.run_cloud_job("flt_9", session=session, project="proj") == "operations/op-1"
    url, body = session.calls[0]
    assert url == "https://run.googleapis.com/v2/projects/proj/locations/us-central1/jobs/croplytix-ingest:run"
    assert body == {"overrides": {"containerOverrides": [{"env": [{"name": "FLIGHT_ID", "value": "flt_9"}]}]}}


def test_cloudrun_refusal_is_recorded_on_the_flight(client, trial, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "INGEST_RUNNER", "cloudrun")
    monkeypatch.setattr(settings, "INGEST_REGION", "us-central1")
    refused = FakeSession(403, {"error": {"message": "Permission 'run.jobs.runWithOverrides' denied"}})
    monkeypatch.setattr(jobs, "_cloud_session", lambda: (refused, "proj"))

    flight = upload(client, trial, tmp_path)
    assert flight["ingest"]["state"] == "failed"
    assert "runWithOverrides" in flight["ingest"]["error"]
    stored = client.get(f"/api/trials/{trial['id']}/flights/{flight['id']}").json()
    assert stored["ingest"]["state"] == "failed", "the upload itself still succeeded"


def test_an_ingest_running_past_the_jobs_timeout_reads_as_failed(client, trial, repo, monkeypatch):
    flight = upload(client, trial, None)
    path = f"/api/trials/{trial['id']}/flights/{flight['id']}"
    long_ago = "2026-01-01T00:00:00+00:00"
    repo.update_flight(flight["id"], {"ingest": {"state": "running", "queuedAt": long_ago, "startedAt": long_ago}})

    stalled = client.get(path).json()["ingest"]
    assert stalled["state"] == "failed" and "memory" in stalled["error"]
    assert client.get(f"/api/trials/{trial['id']}/flights").json()[0]["ingest"]["state"] == "failed"
    assert client.post(f"{path}/ingest").status_code == 202, "a stalled ingest can be retried without forcing"

    repo.update_flight(flight["id"], {"ingest": {"state": "running", "startedAt": jobs.utcnow()}})
    assert client.get(path).json()["ingest"]["state"] == "running"
