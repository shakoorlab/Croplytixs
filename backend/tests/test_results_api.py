"""
POST …/process and the results endpoints. Processing itself is off in route
tests (PROCESS_RUNNER=off, tests/conftest.py); results are stored by hand the
way app/process.py writes them, so these run without PyTorch.
"""

from __future__ import annotations

import io
import json

import pytest

from app import jobs
from app.settings import settings
from tests.conftest import TEST_USER, upload_flight


def ready(client, repo, trial, shapefile=None, ingest_state="complete"):
    """An uploaded flight whose map copies are built (or not)."""
    flight = upload_flight(client, trial, shapefile=shapefile)
    repo.update_flight(flight["id"], {"ingest": {"state": ingest_state, "cog": {"key": "x/cog.tif", "bytes": 1, "compression": "DEFLATE"}}})
    return flight


def path(trial, flight, tail=""):
    return f"/api/trials/{trial['id']}/flights/{flight['id']}{tail}"


def test_process_queues_a_new_version_with_the_default_model(client, repo, trial):
    flight = ready(client, repo, trial)
    r = client.post(path(trial, flight, "/process"))
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "queued" and body["resultCount"] == 1
    assert body["processing"] == {**body["processing"], "state": "queued", "version": 1, "modelId": "yam-canopy-unet-v1"}


def test_process_refuses_while_a_run_is_under_way_unless_forced(client, repo, trial):
    flight = ready(client, repo, trial)
    assert client.post(path(trial, flight, "/process")).status_code == 202
    again = client.post(path(trial, flight, "/process"))
    assert again.status_code == 409 and "already queued" in again.json()["detail"]
    forced = client.post(path(trial, flight, "/process?force=true"))
    assert forced.status_code == 202 and forced.json()["processing"]["version"] == 2


@pytest.mark.parametrize(
    "shapefile, ingest_state, status, words",
    [
        ({}, "complete", 422, "no plot grid"),
        (None, "running", 409, "still being built"),
        (None, "failed", 409, "retry them first"),
    ],
)
def test_process_says_what_is_missing(client, repo, trial, shapefile, ingest_state, status, words):
    flight = ready(client, repo, trial, shapefile=shapefile, ingest_state=ingest_state)
    r = client.post(path(trial, flight, "/process"))
    assert r.status_code == status and words in r.json()["detail"]


def test_process_rejects_an_unknown_model(client, repo, trial):
    flight = ready(client, repo, trial)
    r = client.post(path(trial, flight, "/process"), json={"modelId": "canopy-seg-ms12-v2.1"})
    assert r.status_code == 422 and "yam-canopy-unet-v1" in r.json()["detail"]


def test_a_refused_job_start_is_recorded_on_the_flight(client, repo, trial, monkeypatch):
    monkeypatch.setattr(settings, "PROCESS_RUNNER", "cloudrun")

    def refuse(flight_id, **kwargs):
        assert kwargs["job"] == settings.PROCESS_JOB
        raise jobs.JobStartError("permission denied on croplytix-process")

    monkeypatch.setattr(jobs, "run_cloud_job", refuse)
    flight = ready(client, repo, trial)
    body = client.post(path(trial, flight, "/process")).json()
    assert body["status"] == "failed" and "permission denied" in body["error"]
    assert repo.get_flight_unscoped(flight["id"])["processing"]["state"] == "failed"


def test_a_run_past_the_jobs_timeout_reads_as_failed(client, repo, trial):
    flight = ready(client, repo, trial)
    repo.update_flight(flight["id"], {"status": "running", "processing": {"state": "running", "version": 1, "startedAt": "2020-01-01T00:00:00+00:00"}})
    body = client.get(path(trial, flight)).json()
    assert body["status"] == "failed" and "ran out of memory" in body["error"]
    assert client.post(path(trial, flight, "/process")).status_code == 202  # no force needed


# ---------------------------------------------------------------------------
# results
# ---------------------------------------------------------------------------
PLOT = {
    "plotId": "1-1", "file": "r1_c1_5_t_08-20-26", "row": 1, "col": 1, "genotype": "5", "rep": None,
    "areaCm2": 15690.9, "areaM2": 1.5691, "boxAreaM2": 3.72, "boxCanopyM2": 1.559, "cover": 41.91, "gainM2": 0.01,
    "cutByReachM2": 0.0, "lostToNeighbourM2": 0.0, "neighbours": [], "bareCentre": False, "confidence": 0.79,
    "flags": [], "flag": None, "flagLabel": None, "qc": "passed",
}  # fmt: skip


def store_result(repo, store, flight, version, current=True):
    prefix = f"{flight['storagePrefix']}/results/v{version}"
    files = {"plots": f"{prefix}/plots.json", "csv": f"{prefix}/canopy.csv", "overlay": f"{prefix}/overlay.webp"}
    store.put(files["plots"], io.BytesIO(json.dumps([PLOT]).encode()))
    store.put(files["csv"], io.BytesIO(b"file,row\nr1_c1,1\n"))
    store.put(files["overlay"], io.BytesIO(b"RIFF....WEBP"))
    doc = {
        "id": f"{flight['id']}:v{version}", "flightId": flight["id"], "accountId": flight["accountId"], "trialId": flight["trialId"],
        "trialKey": flight["trialKey"], "version": version, "createdAt": f"2026-11-1{version}T10:00:00+00:00",
        "model": {"id": "yam-canopy-unet-v1", "label": "Yam canopy U-Net · v1", "version": "1"},
        "settings": {"watershed": {}}, "field": {"gsdCm": 2.3}, "warnings": [], "timings": {},
        "summary": {"plots": 1, "meanCover": 41.91, "flaggedTotal": 0, "pending": 0, "canopyCountedM2": 1.57},
        "files": files,
    }  # fmt: skip
    repo.create_result(doc)
    if current:
        repo.update_flight(flight["id"], {"status": "complete", "result": {"id": doc["id"], "version": version, "createdAt": doc["createdAt"],
            "modelId": "yam-canopy-unet-v1", "modelLabel": "Yam canopy U-Net · v1", "plots": 1, "meanCover": 41.91,
            "flaggedTotal": 0, "canopyCountedM2": 1.57}})  # fmt: skip
    return doc


def test_no_results_before_processing(client, repo, trial):
    flight = ready(client, repo, trial)
    r = client.get(path(trial, flight, "/results"))
    assert r.status_code == 404 and "No results" in r.json()["detail"]


def test_results_give_the_current_version_its_plots_and_every_version(client, repo, store, trial):
    flight = repo.get_flight_unscoped(ready(client, repo, trial)["id"])
    store_result(repo, store, flight, 1, current=False)
    store_result(repo, store, flight, 2)
    body = client.get(path(trial, flight, "/results")).json()
    assert body["version"] == 2 and body["current"] is True
    assert body["plots"][0]["plotId"] == "1-1" and body["plots"][0]["areaM2"] == 1.5691
    assert [v["version"] for v in body["versions"]] == [2, 1] and [v["current"] for v in body["versions"]] == [True, False]
    assert "files" not in body and "accountId" not in body

    old = client.get(path(trial, flight, "/results?version=1")).json()
    assert old["version"] == 1 and old["current"] is False
    assert client.get(path(trial, flight, "/results?version=9")).status_code == 404


def test_csv_and_overlay_download(client, repo, store, trial):
    flight = repo.get_flight_unscoped(ready(client, repo, trial)["id"])
    store_result(repo, store, flight, 1)
    csv = client.get(path(trial, flight, "/results/csv"))
    assert csv.status_code == 200 and csv.text.startswith("file,row")
    assert csv.headers["content-type"].startswith("text/csv")
    assert f'attachment; filename="{trial["id"]}_2026-08-20_canopy_v1.csv"' == csv.headers["content-disposition"]
    picture = client.get(path(trial, flight, "/results/overlay"))
    assert picture.status_code == 200 and picture.headers["content-type"] == "image/webp"
    assert picture.headers["content-length"] == str(len(b"RIFF....WEBP"))


def test_another_accounts_results_are_not_found(client, repo, store, trial):
    flight = repo.get_flight_unscoped(ready(client, repo, trial)["id"])
    store_result(repo, store, flight, 1)
    repo.update_flight(flight["id"], {"accountId": "someone-else"})
    assert client.get(path(trial, flight, "/results")).status_code == 404
    assert client.get(path(trial, flight, "/results/csv")).status_code == 404


def test_the_models_list_names_the_default(client):
    models = client.get("/api/models").json()
    assert [m["id"] for m in models] == ["yam-canopy-unet-v1"]
    assert models[0]["default"] is True and models[0]["gsd_cm"] == 2.3 and "weights_key" not in models[0]


def test_results_fields_cant_be_set_by_the_upload(client, trial):
    flight = upload_flight(client, trial, meta={"result": {"id": "x"}, "resultCount": 9, "processing": {"state": "complete"}})
    assert flight.get("result") is None and flight["resultCount"] == 0 and flight.get("processing") is None
    assert TEST_USER.uid  # the upload was the test user's
