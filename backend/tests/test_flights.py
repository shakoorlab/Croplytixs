import json

from tests.conftest import ortho_flight_parts


def test_create_ortho_flight_stores_every_file(client, trial, store):
    data, files = ortho_flight_parts()
    r = client.post(f"/api/trials/{trial['id']}/flights", data=data, files=files)
    assert r.status_code == 201, r.text
    flight = r.json()

    assert flight["id"].startswith("flt_")
    assert flight["status"] == "uploaded"
    assert flight["model"] == "cc-v1"  # falls back to modelId when no label given
    assert flight["denominator"] == "polygon"  # default filled in by FlightMeta

    roles = sorted((f["role"], f["name"]) for f in flight["files"])
    assert roles == [("ortho", "field.tif"), ("shapefile", "plots.prj"), ("shapefile", "plots.shp")]
    # Every recorded key really exists in the object store — the record is
    # written *after* the bytes, so this must never be false.
    for f in flight["files"]:
        assert f["key"].startswith(f"trials/{trial['id']}/flights/{flight['id']}/")
        assert store.exists(f["key"])


def test_trial_stats_derive_from_flights(client, trial):
    data, files = ortho_flight_parts()
    client.post(f"/api/trials/{trial['id']}/flights", data=data, files=files)
    t = client.get(f"/api/trials/{trial['id']}").json()
    assert t["flightDates"] == 1
    assert t["expected"] == 144
    assert t["processed"] == 0  # nothing is "complete" until a worker exists


def test_ortho_source_requires_ortho_and_shapefile(client, trial):
    data, files = ortho_flight_parts()
    only_shapefile = [f for f in files if f[0] == "shapefile"]
    r = client.post(f"/api/trials/{trial['id']}/flights", data=data, files=only_shapefile)
    assert r.status_code == 422
    assert "ortho" in r.json()["detail"]


def test_clipped_source_requires_clipped_files(client, trial):
    data = {"meta": json.dumps({"flightDate": "2026-08-20", "source": "clipped", "capture": "12-ms", "modelId": "cc-v1"})}
    assert client.post(f"/api/trials/{trial['id']}/flights", data=data).status_code == 422

    files = [("clipped", (f"plot_{i:03d}.tif", b"II*\x00", "image/tiff")) for i in range(3)]
    r = client.post(f"/api/trials/{trial['id']}/flights", data=data, files=files)
    assert r.status_code == 201, r.text
    assert len(r.json()["files"]) == 3


def test_bad_meta_is_422_not_500(client, trial):
    _, files = ortho_flight_parts()
    r = client.post(f"/api/trials/{trial['id']}/flights", data={"meta": "{not json"}, files=files)
    assert r.status_code == 422
    r = client.post(f"/api/trials/{trial['id']}/flights", data={"meta": json.dumps({"flightDate": "20/08/2026"})}, files=files)
    assert r.status_code == 422


def test_oversized_file_is_413(client, trial):
    data, files = ortho_flight_parts()
    big = ("ortho", ("huge.tif", b"x" * (1024 * 1024 + 1), "image/tiff"))  # MAX_UPLOAD_MB=1 in conftest
    r = client.post(f"/api/trials/{trial['id']}/flights", data=data, files=[big, *files[1:]])
    assert r.status_code == 413


def test_flight_belongs_to_trial(client, trial):
    data, files = ortho_flight_parts()
    fid = client.post(f"/api/trials/{trial['id']}/flights", data=data, files=files).json()["id"]
    other = client.post("/api/trials", json={"name": "Other", "crop": "Yam", "site": "x", "season": "2026"}).json()
    assert client.get(f"/api/trials/{trial['id']}/flights/{fid}").status_code == 200
    assert client.get(f"/api/trials/{other['id']}/flights/{fid}").status_code == 404


def test_download_streams_original_bytes(client, trial):
    data, files = ortho_flight_parts()
    fid = client.post(f"/api/trials/{trial['id']}/flights", data=data, files=files).json()["id"]
    r = client.get(f"/api/trials/{trial['id']}/flights/{fid}/files/ortho/field.tif")
    assert r.status_code == 200
    assert r.content == b"II*\x00fake-geotiff"
    assert r.headers["content-type"].startswith("image/tiff")
    assert client.get(f"/api/trials/{trial['id']}/flights/{fid}/files/ortho/missing.tif").status_code == 404


def test_filenames_are_sanitised(client, trial):
    data, files = ortho_flight_parts()
    files[0] = ("ortho", ("../../etc/passwd", b"II*\x00", "image/tiff"))
    flight = client.post(f"/api/trials/{trial['id']}/flights", data=data, files=files).json()
    ortho = next(f for f in flight["files"] if f["role"] == "ortho")
    assert ortho["name"] == "passwd"
    assert ".." not in ortho["key"]
