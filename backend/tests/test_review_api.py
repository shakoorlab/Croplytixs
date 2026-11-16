"""
Review decisions: Accept and Reject on a plot of the current result, how they
show in results, the flight's pending count and the CSV, and how they carry
over to a rerun that measured the plot the same (app/review.py).
"""

from __future__ import annotations

import io
import json

from app import review
from tests.conftest import TEST_USER
from tests.test_results_api import path, ready

FLAGGED = {
    "plotId": "1-1", "file": "r1_c1_5_t_08-20-26", "row": 1, "col": 1, "genotype": "5", "rep": None,
    "areaCm2": 120.0, "areaM2": 0.012, "boxAreaM2": 3.72, "boxCanopyM2": 0.012, "cover": 0.32, "gainM2": 0.0,
    "cutByReachM2": 0.0, "lostToNeighbourM2": 0.0, "neighbours": [], "bareCentre": True, "confidence": 0.95,
    "flags": ["near-zero"], "flag": "near-zero", "flagLabel": "Near-zero cover — failed plot?", "qc": "pending",
}  # fmt: skip
PASSED = {**FLAGGED, "plotId": "A/2", "file": "r1_c2_6_t_08-20-26", "col": 2, "areaCm2": 15690.9, "areaM2": 1.5691, "cover": 41.91,
          "flags": [], "flag": None, "flagLabel": None, "qc": "passed", "bareCentre": False}  # fmt: skip


def store_version(repo, store, flight, version, plots, current=True):
    prefix = f"{flight['storagePrefix']}/results/v{version}"
    files = {"plots": f"{prefix}/plots.json", "csv": f"{prefix}/canopy.csv", "overlay": f"{prefix}/overlay.webp"}
    store.put(files["plots"], io.BytesIO(json.dumps(plots).encode()))
    rows = "".join(f"{p['file']},{p['plotId']},{p['areaCm2']}\n" for p in plots)
    store.put(files["csv"], io.BytesIO(f"file,plot_id,canopy_area_cm2\n{rows}".encode()))
    store.put(files["overlay"], io.BytesIO(b"RIFF"))
    flagged = sum(1 for p in plots if p["flag"])
    doc = {
        "id": f"{flight['id']}:v{version}", "flightId": flight["id"], "accountId": flight["accountId"], "trialId": flight["trialId"],
        "trialKey": flight["trialKey"], "version": version, "createdAt": f"2026-11-1{version}T10:00:00+00:00",
        "model": {"id": "yam-canopy-unet-v1", "label": "Yam canopy U-Net · v1", "version": "1"},
        "settings": {}, "field": {}, "warnings": [], "timings": {},
        "summary": {"plots": len(plots), "meanCover": 21.1, "flaggedTotal": flagged, "pending": flagged, "pendingFlags": flagged,
                    "accepted": 0, "rejected": 0, "edited": 0, "audit": 0, "canopyCountedM2": 1.58},
        "files": files,
    }  # fmt: skip
    repo.create_result(doc)
    if current:
        repo.update_flight(flight["id"], {"status": "complete", "flagged": flagged, "result": {"id": doc["id"], "version": version}})
    return doc


def processed(client, repo, store, trial, plots=(FLAGGED, PASSED)):
    flight = repo.get_flight_unscoped(ready(client, repo, trial)["id"])
    store_version(repo, store, flight, 1, list(plots))
    return repo.get_flight_unscoped(flight["id"])


def decide(client, trial, flight, version, plot_id, decision=None, note=None):
    url = path(trial, flight, f"/results/{version}/decisions/{plot_id}")
    if decision is None:
        return client.delete(url)
    return client.put(url, json={"decision": decision, **({"note": note} if note else {})})


def test_rejecting_a_flagged_plot_clears_it_from_the_queue(client, repo, store, trial):
    flight = processed(client, repo, store, trial)
    r = decide(client, trial, flight, 1, "1-1", "rejected", note="weeds, not yam")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plot"]["qc"] == "rejected" and body["plot"]["decision"]["by"] == TEST_USER.email
    assert body["plot"]["decision"]["note"] == "weeds, not yam" and body["plot"]["decision"]["stale"] is False
    assert body["summary"]["pending"] == 0 and body["summary"]["rejected"] == 1 and body["summary"]["reviewed"] == 1

    assert repo.get_flight_unscoped(flight["id"])["flagged"] == 0  # the flights table and the trials list follow
    results = client.get(path(trial, flight, "/results")).json()
    assert {p["plotId"]: p["qc"] for p in results["plots"]} == {"1-1": "rejected", "A/2": "passed"}
    assert results["summary"]["pending"] == 0 and results["summary"]["rejected"] == 1
    assert client.get(f"/api/trials/{trial['id']}").json()["flagged"] == 0


def test_accepting_and_clearing_with_history(client, repo, store, trial):
    flight = processed(client, repo, store, trial)
    assert decide(client, trial, flight, 1, "A/2", "accepted").json()["plot"]["qc"] == "accepted"  # a slash in the id is fine
    decide(client, trial, flight, 1, "1-1", "accepted")
    cleared = decide(client, trial, flight, 1, "1-1").json()
    assert cleared["plot"]["qc"] == "pending" and cleared["plot"]["decision"] is None
    assert cleared["summary"]["pending"] == 1 and cleared["summary"]["accepted"] == 1
    assert repo.get_flight_unscoped(flight["id"])["flagged"] == 1
    stored = repo.get_decision(review.decision_id(flight["id"], "1-1"))
    assert stored["decision"] is None and stored["history"][0]["decision"] == "accepted"
    assert review.decision_id(flight["id"], "A/2").endswith(":A%2F2")  # Firestore ids can't hold a slash


def test_only_the_current_version_and_real_plots_can_be_decided(client, repo, store, trial):
    flight = processed(client, repo, store, trial)
    store_version(repo, store, flight, 2, [FLAGGED, PASSED])
    old = decide(client, trial, flight, 1, "1-1", "rejected")
    assert old.status_code == 409 and "review version 2" in old.json()["detail"]
    assert decide(client, trial, flight, 2, "9-9", "rejected").status_code == 404
    assert decide(client, trial, flight, 7, "1-1", "rejected").status_code == 404
    bad = client.put(path(trial, flight, "/results/2/decisions/1-1"), json={"decision": "maybe"})
    assert bad.status_code == 422


def test_another_accounts_plots_cant_be_decided(client, repo, store, trial):
    flight = processed(client, repo, store, trial)
    repo.update_flight(flight["id"], {"accountId": "someone-else"})
    assert decide(client, trial, flight, 1, "1-1", "rejected").status_code == 404


def test_a_decision_carries_over_while_the_measurement_is_the_same(client, repo, store, trial):
    flight = processed(client, repo, store, trial)
    decide(client, trial, flight, 1, "1-1", "rejected")

    store_version(repo, store, flight, 2, [FLAGGED, PASSED])  # a rerun that reused the canopy map
    same = {p["plotId"]: p for p in client.get(path(trial, flight, "/results")).json()["plots"]}
    assert same["1-1"]["qc"] == "rejected" and same["1-1"]["decision"]["version"] == 1 and not same["1-1"]["decision"]["stale"]

    store_version(repo, store, flight, 3, [{**FLAGGED, "cover": 0.8, "areaCm2": 300.0}, PASSED])  # a nudged grid
    moved = client.get(path(trial, flight, "/results")).json()
    plot = next(p for p in moved["plots"] if p["plotId"] == "1-1")
    assert plot["qc"] == "pending" and plot["decision"]["stale"] is True  # shown, but it doesn't stand
    assert moved["summary"]["pending"] == 1 and moved["summary"]["rejected"] == 0


def test_the_csv_says_how_each_plot_was_reviewed(client, repo, store, trial):
    flight = processed(client, repo, store, trial)
    decide(client, trial, flight, 1, "1-1", "rejected")
    r = client.get(path(trial, flight, "/results/csv"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.strip().splitlines()
    assert lines[0] == "file,plot_id,canopy_area_cm2,review,reviewed_by,reviewed_at"
    assert lines[1].startswith(f"r1_c1_5_t_08-20-26,1-1,120.0,rejected,{TEST_USER.email},2")
    assert lines[2] == "r1_c2_6_t_08-20-26,A/2,15690.9,passed,,"
    assert r.headers["content-length"] == str(len(r.content))
