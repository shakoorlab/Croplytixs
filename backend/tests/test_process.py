"""
The processing job end to end on a tiny synthetic field, with an untrained
U-Net of the real architecture (its numbers mean nothing; the plumbing is the
point). Needs the processing image's libraries; skipped without them.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import pytest

pytest.importorskip("geopandas")
pytest.importorskip("skimage")
torch = pytest.importorskip("torch")
smp = pytest.importorskip("segmentation_models_pytorch")

import rasterio  # noqa: E402
from affine import Affine  # noqa: E402
from rasterio.enums import ColorInterp  # noqa: E402

from app import process as process_module  # noqa: E402
from app.jobs import process_after_ingest, queue_processing  # noqa: E402
from app.model_registry import ModelSpec  # noqa: E402
from app.process import process_flight  # noqa: E402
from app.settings import settings  # noqa: E402
from tests.test_pipeline import write_grid  # noqa: E402

GSD = 0.023
BASE = "accounts/u1/trials/t1/flights/flt_1"


@pytest.fixture
def weights(tmp_path):
    torch.manual_seed(0)
    model = smp.Unet(encoder_name="resnet34", encoder_weights=None, in_channels=3, classes=1)
    path = tmp_path / "weights.pt"
    torch.save(model.state_dict(), path)
    return path


@pytest.fixture
def spec(weights, monkeypatch):
    s = ModelSpec(
        id="test-unet",
        version="0",
        label="Test U-Net",
        scope="base",
        architecture="U-Net, ResNet34",
        weights_key="models/base/test-unet/weights.pt",
        sha256=hashlib.sha256(weights.read_bytes()).hexdigest(),
        gsd_cm=2.3,
        bands="RGB",
        trained_on="nothing",
    )
    monkeypatch.setattr(process_module, "resolve", lambda model_id: s)
    process_module._MODELS.clear()
    return s


def write_field(path, width=320, height=280):
    """RGBA at 2.3 cm, green blobs on brown, a transparent strip down the left."""
    yy, xx = np.mgrid[0:height, 0:width]
    rgb = np.stack([np.full_like(xx, 120), np.full_like(xx, 90), np.full_like(xx, 60)]).astype(np.uint8)
    for cx, cy in ((60, 230), (120, 230), (180, 230), (60, 170), (120, 170), (180, 170)):
        blob = (xx - cx) ** 2 + (yy - cy) ** 2 < 15**2
        rgb[:, blob] = np.array([[40], [160], [50]], np.uint8)
    alpha = np.where(xx < 10, 0, 255).astype(np.uint8)
    profile = dict(
        driver="GTiff", width=width, height=height, count=4, dtype="uint8", crs="EPSG:32620",
        transform=Affine(GSD, 0, 0, 0, -GSD, height * GSD + 0.0),
    )  # fmt: skip
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(np.concatenate([rgb, alpha[None]]))
        dst.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]
    return path


def put(store, key, path):
    with open(path, "rb") as f:
        return store.put(key, f)


def stored_flight(repo, store, tmp_path, spec, weights, *, grid=True, ingest_state="complete", **fields):
    files = []
    if grid:
        shp = write_grid(tmp_path / "plots.shp")
        for ext in (".shp", ".shx", ".dbf", ".prj"):
            p = shp.with_suffix(ext)
            files.append({"role": "shapefile", "name": p.name, "bytes": put(store, f"{BASE}/shapefile/{p.name}", p), "key": f"{BASE}/shapefile/{p.name}"})
    cog = write_field(tmp_path / "cog.tif")
    cog_bytes = put(store, f"{BASE}/derived/cog.tif", cog)
    put(store, spec.weights_key, weights)
    doc = {
        "id": "flt_1",
        "accountId": "u1",
        "trialId": "t1",
        "trialKey": "u1:t1",
        "storagePrefix": BASE,
        "flightDate": "2026-08-20",
        "source": "ortho",
        "capture": "12-rgb",
        "plots": 6,
        "status": "uploaded",
        "createdAt": "2026-08-20T10:00:00+00:00",
        "files": files,
        "mapping": {"identity": "grid", "row": "row", "col": "col", "genotype": "var"},
        "offset": {"dxCm": 0, "dyCm": 0, "rotDeg": 0},
        "ingest": {"state": ingest_state, "cog": {"key": f"{BASE}/derived/cog.tif", "bytes": cog_bytes, "compression": "DEFLATE"}},
        **fields,
    }
    repo.create_flight(doc)
    return doc


def test_a_run_writes_a_result_version_and_points_the_flight_at_it(repo, store, tmp_path, spec, weights):
    stored_flight(repo, store, tmp_path, spec, weights)
    queue_processing(repo.get_flight_unscoped("flt_1"), repo, spec.id)
    doc = process_flight("flt_1", repo, store)

    flight = repo.get_flight_unscoped("flt_1")
    assert flight["status"] == "complete" and flight["progress"] == 100 and flight["error"] is None
    assert flight["processing"]["state"] == "complete" and flight["processing"]["version"] == 1
    assert flight["result"]["id"] == "flt_1:v1" and flight["result"]["plots"] == 6
    assert flight["modelId"] == "test-unet" and flight["model"] == "Test U-Net"

    assert doc["version"] == 1 and doc["model"]["sha256"] == spec.sha256
    assert "weights_key" not in doc["model"]
    assert doc["field"]["factor"] == 1 and doc["settings"]["watershed"]["core_seeds"] is True
    for key in ("plots", "csv", "overlay", "assignment", "metadata", "probability"):
        assert store.exists(doc["files"][key]), key
        assert doc["files"][key].startswith(f"{BASE}/")
    rows = json.loads(b"".join(store.open(doc["files"]["plots"])))
    assert [r["plotId"] for r in rows] == ["1-1", "1-2", "1-3", "2-1", "2-2", "2-3"]
    csv_text = b"".join(store.open(doc["files"]["csv"])).decode()
    assert csv_text.count("\n") == 7 and ",test-unet,0,1" in csv_text
    meta = json.loads(b"".join(store.open(doc["files"]["metadata"])))
    assert meta["inputs"]["cog"]["key"].endswith("cog.tif") and "torch" in meta["software"]
    assert repo.list_results("flt_1")[0]["id"] == "flt_1:v1"


def test_a_rerun_is_a_new_version_and_reuses_the_canopy_map(repo, store, tmp_path, spec, weights):
    stored_flight(repo, store, tmp_path, spec, weights)
    first = process_flight("flt_1", repo, store)
    queue_processing(repo.get_flight_unscoped("flt_1"), repo, spec.id)
    second = process_flight("flt_1", repo, store)
    assert (first["version"], second["version"]) == (1, 2)
    assert not first["timings"]["reusedProbability"] and second["timings"]["reusedProbability"]
    assert first["files"]["probability"] == second["files"]["probability"]
    assert first["files"]["csv"] != second["files"]["csv"]
    assert [r["version"] for r in repo.list_results("flt_1")] == [2, 1]
    assert repo.get_flight_unscoped("flt_1")["result"]["version"] == 2


def test_a_nudged_grid_is_a_new_field(repo, store, tmp_path, spec, weights):
    stored_flight(repo, store, tmp_path, spec, weights)
    first = process_flight("flt_1", repo, store)
    repo.update_flight("flt_1", {"offset": {"dxCm": 50, "dyCm": 0, "rotDeg": 0}})
    queue_processing(repo.get_flight_unscoped("flt_1"), repo, spec.id)
    second = process_flight("flt_1", repo, store)
    assert second["files"]["probability"] != first["files"]["probability"]
    assert second["settings"]["offset"]["dxCm"] == 50


@pytest.mark.parametrize(
    "setup, words",
    [
        ({"grid": False}, "no plot grid"),
        ({"ingest_state": "running"}, "map copies aren't built"),
    ],
)
def test_a_flight_that_cant_be_processed_says_why(repo, store, tmp_path, spec, weights, setup, words):
    stored_flight(repo, store, tmp_path, spec, weights, **setup)
    record = process_flight("flt_1", repo, store)
    flight = repo.get_flight_unscoped("flt_1")
    assert record["state"] == "failed" and words in record["error"]
    assert flight["status"] == "failed" and flight["error"] == record["error"]


def test_weights_that_arent_the_models_are_refused(repo, store, tmp_path, spec, weights):
    stored_flight(repo, store, tmp_path, spec, weights)
    store.put(spec.weights_key, open(tmp_path / "cog.tif", "rb"))
    record = process_flight("flt_1", repo, store)
    assert record["state"] == "failed" and "aren't Test U-Net's" in record["error"]


def test_missing_weights_point_at_the_runbook(repo, store, tmp_path, spec, weights):
    stored_flight(repo, store, tmp_path, spec, weights)
    store.delete(spec.weights_key)
    record = process_flight("flt_1", repo, store)
    assert "Upload them first" in record["error"]


def test_a_field_too_big_for_the_job_is_refused_before_the_model_runs(repo, store, tmp_path, spec, weights, monkeypatch):
    stored_flight(repo, store, tmp_path, spec, weights)
    monkeypatch.setattr(settings, "PROCESS_MAX_MEGAPIXELS", 0)
    record = process_flight("flt_1", repo, store)
    assert "million pixels" in record["error"]


def test_ingest_starts_processing_only_for_a_flight_with_a_grid(repo, store, tmp_path, spec, weights, monkeypatch):
    monkeypatch.setattr(settings, "PROCESS_RUNNER", "off")
    stored_flight(repo, store, tmp_path, spec, weights)
    assert process_after_ingest("flt_1", repo, store) is True
    assert repo.get_flight_unscoped("flt_1")["processing"]["state"] == "queued"
    assert process_after_ingest("flt_1", repo, store) is False  # already queued

    repo.update_flight("flt_1", {"files": [], "processing": None})
    assert process_after_ingest("flt_1", repo, store) is False


def test_inline_runner_processes_right_after_ingest(repo, store, tmp_path, spec, weights, monkeypatch):
    monkeypatch.setattr(settings, "PROCESS_RUNNER", "inline")
    stored_flight(repo, store, tmp_path, spec, weights)
    assert process_after_ingest("flt_1", repo, store) is True
    assert repo.get_flight_unscoped("flt_1")["status"] == "complete"


def test_job_entry_point_needs_a_flight_id(monkeypatch):
    monkeypatch.delenv("FLIGHT_ID", raising=False)
    assert process_module.main([]) == 2
