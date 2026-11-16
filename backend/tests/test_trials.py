def test_health_reports_adapters(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["db"] == "memory"
    assert body["storage"].startswith("local:")


def test_create_trial_mints_readable_slug(trial):
    assert trial["id"] == "guadeloupe-yam-2026"
    assert trial["flightDates"] == 0
    assert trial["lastActivity"] == trial["createdAt"]


def test_slug_collision_gets_suffix(client):
    # Same slug source, different (case-insensitively unique) names.
    a = client.post("/api/trials", json={"name": "Yam A", "crop": "Yam", "site": "x", "season": "2026"}).json()
    b = client.post("/api/trials", json={"name": "Yam-A", "crop": "Yam", "site": "x", "season": "2026"}).json()
    assert a["id"] == "yam-a-2026"
    assert b["id"] == "yam-a-2026-2"


def test_duplicate_name_is_409(client, trial):
    r = client.post(
        "/api/trials",
        json={"name": "guadeloupe yam", "crop": "Yam", "site": "elsewhere", "season": "2027"},
    )
    assert r.status_code == 409


def test_validation_rejects_empty_name(client):
    r = client.post("/api/trials", json={"name": "", "crop": "Yam", "site": "x", "season": "2026"})
    assert r.status_code == 422


def test_list_and_get(client, trial):
    assert [t["id"] for t in client.get("/api/trials").json()] == [trial["id"]]
    assert client.get(f"/api/trials/{trial['id']}").json()["name"] == "Guadeloupe Yam"
    assert client.get("/api/trials/nope").status_code == 404


def test_a_trial_without_a_roster_takes_its_size_from_the_newest_grid(client):
    from tests.conftest import upload_flight

    trial = client.post("/api/trials", json={"name": "No roster", "crop": "Yam", "site": "x", "season": "2026"}).json()
    assert trial["plots"] == 0 and trial["gridPlots"] == 0
    upload_flight(client, trial, meta={"flightDate": "2026-08-20", "capture": "12-ms", "plots": 144})
    upload_flight(client, trial, meta={"flightDate": "2026-09-10", "capture": "12-ms", "plots": 142})
    upload_flight(client, trial, meta={"flightDate": "2026-09-24", "capture": "12-ms", "plots": 0}, shapefile={})
    listed = client.get("/api/trials").json()[0]
    assert listed["plots"] == 0 and listed["gridPlots"] == 142
    assert client.get(f"/api/trials/{trial['id']}").json()["gridPlots"] == 142
