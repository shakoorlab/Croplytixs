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
