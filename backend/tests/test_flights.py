import hashlib

import pytest

from app.settings import settings
from tests.conftest import FAKE_ORTHO, TEST_USER, declare, put_file, shapefile_set, start_flight, upload_flight


def flights_url(trial, *rest):
    return "/".join([f"/api/trials/{trial['id']}/flights", *rest])


# ---------------------------------------------------------------------------
# declare → upload → complete
# ---------------------------------------------------------------------------
def test_create_opens_one_session_per_file_and_stores_nothing_yet(client, trial, store):
    r = start_flight(client, trial)
    assert r.status_code == 201, r.text
    flight, uploads = r.json()["flight"], r.json()["uploads"]

    assert flight["id"].startswith("flt_")
    assert flight["status"] == "awaiting_upload"
    assert flight["model"] is None  # chosen when the flight is run, not at upload
    names = sorted(f["name"] for f in flight["files"])
    assert names == ["field.tif", "plots.dbf", "plots.prj", "plots.shp", "plots.shx"]
    assert sorted(u["name"] for u in uploads) == names
    prefix = f"accounts/{TEST_USER.uid}/trials/{trial['id']}/flights/{flight['id']}/"
    for f in flight["files"]:
        assert f["key"].startswith(prefix)
        assert f["md5"] is None
        assert not store.exists(f["key"]), "nothing is in the bucket until the browser sends it"


def test_complete_records_each_files_md5_and_marks_the_flight_uploaded(client, trial, store):
    flight = upload_flight(client, trial)
    assert flight["status"] == "uploaded"
    assert flight["uploadedAt"]
    ortho = next(f for f in flight["files"] if f["role"] == "ortho")
    assert ortho["md5"] == hashlib.md5(FAKE_ORTHO).hexdigest()
    assert ortho["contentType"] == "image/tiff"
    for f in flight["files"]:
        assert store.exists(f["key"])
    assert client.get(flights_url(trial, flight["id"])).json()["status"] == "uploaded"


def test_complete_before_the_bytes_arrive_says_what_is_missing(client, trial):
    body = start_flight(client, trial, declare(shapefile={})).json()
    r = client.post(flights_url(trial, body["flight"]["id"], "complete"))
    assert r.status_code == 409
    assert r.json()["missing"] == ["field.tif"]
    assert "field.tif" in r.json()["detail"]
    assert client.get(flights_url(trial, body["flight"]["id"])).json()["status"] == "awaiting_upload"


def test_complete_refuses_a_file_of_the_wrong_size(client, trial, store):
    import io

    body = start_flight(client, trial, declare(shapefile={})).json()
    key = body["flight"]["files"][0]["key"]
    store.put(key, io.BytesIO(b"short"))  # not via the session, which would refuse it
    r = client.post(flights_url(trial, body["flight"]["id"], "complete"))
    assert r.status_code == 409
    assert r.json()["wrongSize"] == [{"name": "field.tif", "expected": len(FAKE_ORTHO), "received": 5}]


def test_complete_is_safe_to_repeat(client, trial):
    first = upload_flight(client, trial)
    again = client.post(flights_url(trial, first["id"], "complete"))
    assert again.status_code == 200
    assert again.json()["uploadedAt"] == first["uploadedAt"]
    assert again.json()["ingest"]["queuedAt"] == first["ingest"]["queuedAt"], "ingest is not queued twice"


def test_a_shapefile_is_optional(client, trial):
    flight = upload_flight(client, trial, shapefile={})
    assert [f["role"] for f in flight["files"]] == ["ortho"]


def test_a_zipped_shapefile_and_a_cpg_are_accepted(client, trial):
    assert start_flight(client, trial, declare(shapefile={"plots.zip": b"PK"})).status_code == 201
    with_cpg = {**shapefile_set(), "plots.cpg": b"UTF-8"}
    flight = upload_flight(client, trial, shapefile=with_cpg)
    assert next(f for f in flight["files"] if f["name"] == "plots.cpg")["contentType"] == "text/plain"


def test_createdBy_comes_from_the_token_not_the_page(client, trial):
    flight = start_flight(client, trial, meta={"createdBy": "Somebody Else"}).json()["flight"]
    assert flight["createdBy"] == TEST_USER.email


def test_the_page_cannot_set_fields_the_api_owns(client, trial):
    sneaky = {"status": "complete", "accountId": "someone", "ingest": {"state": "complete"}, "storagePrefix": "x/"}
    flight = start_flight(client, trial, meta=sneaky).json()["flight"]
    assert flight["status"] == "awaiting_upload"
    assert flight["accountId"] == TEST_USER.uid
    assert flight.get("ingest") is None
    assert flight["storagePrefix"].startswith("accounts/")


# ---------------------------------------------------------------------------
# what a create request may declare
# ---------------------------------------------------------------------------
REFUSED = {
    "no ortho": ([{"role": "shapefile", "name": "plots.zip", "size": 9}], "exactly one orthophoto"),
    "two orthos": ([{"role": "ortho", "name": "a.tif", "size": 9}, {"role": "ortho", "name": "b.tif", "size": 9}], "exactly one"),
    "ortho not a tiff": (declare(ortho_name="field.jpg", shapefile={}), "isn't a GeoTIFF"),
    "shapefile without .prj": (declare(shapefile={k: v for k, v in shapefile_set().items() if k != "plots.prj"}), "missing its .prj"),
    "two .prj files": (declare(shapefile={**shapefile_set(), "other.prj": b"x"}), "One shapefile per flight"),
    "parts named differently": (declare(shapefile={"a.shp": b"1", "a.shx": b"1", "a.dbf": b"1", "b.prj": b"1"}), "different names"),
    "zip and parts together": (declare(shapefile={**shapefile_set(), "plots.zip": b"PK"}), "zipped shapefile on its own"),
    "not a shapefile part": (declare(shapefile={**shapefile_set(), "notes.txt": b"hi"}), "isn't part of a shapefile"),
    "two files with one name": (declare(shapefile={}) + [{"role": "ortho", "name": "FIELD.tif", "size": 3}], "both named"),
}


@pytest.mark.parametrize(("files", "reason"), REFUSED.values(), ids=REFUSED.keys())
def test_bad_file_sets_are_422_with_a_reason(client, trial, files, reason):
    r = start_flight(client, trial, files)
    assert r.status_code == 422, r.text
    assert reason in r.json()["detail"]


def test_oversized_files_are_413(client, trial, monkeypatch):
    monkeypatch.setattr(settings, "MAX_ORTHO_MB", 1)
    monkeypatch.setattr(settings, "MAX_SHAPEFILE_MB", 1)
    big = 1024 * 1024 + 1
    r = start_flight(client, trial, [{"role": "ortho", "name": "huge.tif", "size": big}])
    assert r.status_code == 413
    assert "huge.tif" in r.json()["detail"]
    files = declare(shapefile={})[:1] + [{"role": "shapefile", "name": "plots.zip", "size": big}]
    assert start_flight(client, trial, files).status_code == 413


def test_bad_meta_is_422_not_500(client, trial):
    assert start_flight(client, trial, meta={"flightDate": "20/08/2026"}).status_code == 422
    assert client.post(flights_url(trial), json={"files": declare()}).status_code == 422
    assert start_flight(client, trial, meta={"source": "clipped"}).status_code == 422, "pre-clipped uploads are gone"


def test_filenames_are_sanitised(client, trial):
    flight = start_flight(client, trial, declare(ortho_name="../../etc/passwd.tif", shapefile={})).json()["flight"]
    ortho = flight["files"][0]
    assert ortho["name"] == "passwd.tif"
    assert ".." not in ortho["key"]


# ---------------------------------------------------------------------------
# lost URLs, cancelling
# ---------------------------------------------------------------------------
def test_reopening_gives_new_sessions_only_for_files_still_missing(client, trial):
    body = start_flight(client, trial).json()
    fid = body["flight"]["id"]
    contents = {"field.tif": FAKE_ORTHO, **shapefile_set()}
    for target in body["uploads"]:
        if target["name"] != "field.tif":
            put_file(client, target["url"], contents[target["name"]])

    reopened = client.post(flights_url(trial, fid, "uploads"))
    assert reopened.status_code == 200
    assert [u["name"] for u in reopened.json()["uploads"]] == ["field.tif"]
    put_file(client, reopened.json()["uploads"][0]["url"], FAKE_ORTHO)
    assert client.post(flights_url(trial, fid, "complete")).json()["status"] == "uploaded"
    assert client.post(flights_url(trial, fid, "uploads")).status_code == 409


def test_cancel_removes_what_arrived_and_the_record(client, trial, store):
    body = start_flight(client, trial).json()
    fid = body["flight"]["id"]
    shp = next(u for u in body["uploads"] if u["name"] == "plots.shp")
    put_file(client, shp["url"], b"fake-shp")
    key = next(f["key"] for f in body["flight"]["files"] if f["name"] == "plots.shp")
    assert store.exists(key)

    assert client.delete(flights_url(trial, fid)).status_code == 204
    assert not store.exists(key)
    assert client.get(flights_url(trial, fid)).status_code == 404


def test_an_uploaded_flight_cannot_be_cancelled(client, trial):
    flight = upload_flight(client, trial)
    assert client.delete(flights_url(trial, flight["id"])).status_code == 409


# ---------------------------------------------------------------------------
# reading flights back
# ---------------------------------------------------------------------------
def test_trial_stats_derive_from_flights(client, trial):
    upload_flight(client, trial)
    t = client.get(f"/api/trials/{trial['id']}").json()
    assert t["flightDates"] == 1
    assert t["expected"] == 144
    assert t["processed"] == 0  # nothing is "complete" until a worker exists


def test_flight_belongs_to_trial(client, trial):
    fid = upload_flight(client, trial)["id"]
    other = client.post("/api/trials", json={"name": "Other", "crop": "Yam", "site": "x", "season": "2026"}).json()
    assert client.get(flights_url(trial, fid)).status_code == 200
    assert client.get(f"/api/trials/{other['id']}/flights/{fid}").status_code == 404


def test_download_streams_original_bytes(client, trial):
    fid = upload_flight(client, trial)["id"]
    r = client.get(flights_url(trial, fid, "files", "ortho", "field.tif"))
    assert r.status_code == 200
    assert r.content == FAKE_ORTHO
    assert r.headers["content-type"].startswith("image/tiff")
    assert client.get(flights_url(trial, fid, "files", "ortho", "missing.tif")).status_code == 404


def test_download_of_a_file_still_on_its_way_is_404(client, trial):
    fid = start_flight(client, trial).json()["flight"]["id"]
    assert client.get(flights_url(trial, fid, "files", "ortho", "field.tif")).status_code == 404
