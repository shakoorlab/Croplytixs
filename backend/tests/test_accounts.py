"""
Every trial, flight and file belongs to one account, and nobody sees another
account's: its records answer 404, exactly like ones that don't exist.
"""

import pytest

from app import auth
from app.auth import account_id_for
from app.main import app
from tests.conftest import TEST_USER, start_flight, upload_flight

OTHER_USER = auth.User(uid="uid-other", email="other@example.com")


@pytest.fixture
def as_other():
    """Switches the signed-in user for the rest of the test."""

    def switch(user=OTHER_USER):
        app.dependency_overrides[auth.current_user] = lambda: user

    return switch


def test_another_account_sees_none_of_it(client, trial, as_other):
    flight = upload_flight(client, trial)
    base = f"/api/trials/{trial['id']}"
    as_other()

    assert client.get("/api/trials").json() == []
    assert client.get(base).status_code == 404
    assert client.get(f"{base}/flights").status_code == 404
    for method, path in [
        ("get", f"{base}/flights/{flight['id']}"),
        ("post", f"{base}/flights/{flight['id']}/complete"),
        ("post", f"{base}/flights/{flight['id']}/uploads"),
        ("post", f"{base}/flights/{flight['id']}/ingest"),
        ("delete", f"{base}/flights/{flight['id']}"),
        ("get", f"{base}/flights/{flight['id']}/files/ortho/field.tif"),
    ]:
        assert getattr(client, method)(path).status_code == 404, f"{method} {path}"
    assert start_flight(client, trial).status_code == 404, "can't add a flight to someone else's trial"


def test_the_same_trial_name_in_two_accounts_gets_the_same_id(client, trial, as_other):
    as_other()
    theirs = client.post("/api/trials", json={"name": "Guadeloupe Yam", "crop": "Yam", "site": "x", "season": "2026"})
    assert theirs.status_code == 201, "names are unique within an account, not across them"
    assert theirs.json()["id"] == trial["id"] == "guadeloupe-yam-2026"
    assert [t["id"] for t in client.get("/api/trials").json()] == ["guadeloupe-yam-2026"]

    as_other(TEST_USER)
    flights = client.get(f"/api/trials/{trial['id']}/flights")
    assert flights.status_code == 200 and flights.json() == []


def test_files_are_kept_under_the_accounts_prefix(client, trial):
    flight = upload_flight(client, trial)
    assert flight["accountId"] == TEST_USER.uid
    assert flight["storagePrefix"] == f"accounts/{TEST_USER.uid}/trials/{trial['id']}/flights/{flight['id']}"
    assert all(f["key"].startswith(flight["storagePrefix"] + "/") for f in flight["files"])


def test_a_trial_records_who_created_it(client, repo, trial):
    assert repo.get_trial(TEST_USER.uid, trial["id"])["createdBy"] == TEST_USER.email


def test_account_id_is_the_uid_when_it_is_safe_in_a_key():
    assert account_id_for("Xq3vT9bW2mYkL8pRzN4aC7dE1fG0") == "Xq3vT9bW2mYkL8pRzN4aC7dE1fG0"


@pytest.mark.parametrize("uid", ["a/b", "../x", "user@example.com", "ü", "a:b", "x" * 129])
def test_other_uids_become_a_stable_safe_hash(uid):
    account = account_id_for(uid)
    assert account == account_id_for(uid)
    assert account.startswith("u") and len(account) == 33 and account.isalnum()
    assert account != account_id_for(uid + "!")
