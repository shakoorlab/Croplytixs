"""
GET …/flights/{id}/map: signed links the browser reads the map files through,
and the local stand-in for Cloud Storage's signed URLs (/api/local-objects),
which has to answer Range requests the way the bucket does. Then the Cloud
Storage adapter's signing, offline, with a throwaway service-account key.
"""

from __future__ import annotations

import io

import pytest

from app.storage import GcsObjectStore, SigningUnavailable
from tests.test_results_api import path, ready, store_result

VIEW = bytes(range(256)) * 64  # 16 KiB standing in for the viewing COG


def with_view(client, repo, store, trial, **kwargs):
    flight = ready(client, repo, trial, **kwargs)
    key = f"{repo.get_flight_unscoped(flight['id'])['storagePrefix']}/derived/view.tif"
    store.put(key, io.BytesIO(VIEW))
    ingest = {**repo.get_flight_unscoped(flight["id"])["ingest"], "view": {"key": key, "bytes": len(VIEW), "compression": "WEBP"}}
    repo.update_flight(flight["id"], {"ingest": ingest})
    return repo.get_flight_unscoped(flight["id"])


def test_no_links_before_the_map_copies_exist(client, repo, trial):
    flight = ready(client, repo, trial, ingest_state="running")
    r = client.get(path(trial, flight, "/map"))
    assert r.status_code == 409 and "aren't built" in r.json()["detail"]


def test_a_flight_without_results_gets_the_view_link_only(client, repo, store, trial):
    flight = with_view(client, repo, store, trial)
    r = client.get(path(trial, flight, "/map"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"] is None and body["view"]["bytes"] == len(VIEW)
    assert body["view"]["url"].startswith("/api/local-objects/")
    assert body["expiresInSeconds"] == 3600 and body["expiresAt"]
    assert r.headers["cache-control"] == "no-store"  # the links are credentials


def test_the_link_reads_the_file_whole_or_by_range(client, repo, store, trial):
    flight = with_view(client, repo, store, trial)
    url = client.get(path(trial, flight, "/map")).json()["view"]["url"]
    whole = client.get(url)
    assert whole.status_code == 200 and whole.content == VIEW
    part = client.get(url, headers={"Range": "bytes=100-163"})
    assert part.status_code == 206 and part.content == VIEW[100:164]
    assert part.headers["content-range"] == f"bytes 100-163/{len(VIEW)}"
    assert client.head(url).headers["content-length"] == str(len(VIEW))


def test_a_result_adds_its_assignment_raster(client, repo, store, trial):
    flight = with_view(client, repo, store, trial)
    for version, content in ((1, b"II*\x00older"), (2, b"II*\x00labels")):
        doc = store_result(repo, store, flight, version, current=version == 2)
        key = f"{flight['storagePrefix']}/results/v{version}/assignment.tif"
        store.put(key, io.BytesIO(content))
        repo._results[doc["id"]]["files"]["assignment"] = key
    repo._results[doc["id"]]["layers"] = {"noPlotValue": 65535, "plotBoxes": True}  # only v2 was made with them

    current = client.get(path(trial, flight, "/map")).json()["result"]
    assert current["version"] == 2 and current["noPlotValue"] == 65535 and current["plotBoxes"] is True
    assert client.get(current["assignment"]["url"]).content == b"II*\x00labels"

    older = client.get(path(trial, flight, "/map?version=1")).json()["result"]
    assert older["version"] == 1 and older["noPlotValue"] is None and older["plotBoxes"] is False  # made before both existed
    assert client.get(older["assignment"]["url"]).content == b"II*\x00older"
    assert client.get(path(trial, flight, "/map?version=7")).status_code == 404


def test_a_tampered_or_expired_link_is_refused(client, repo, store, trial):
    flight = with_view(client, repo, store, trial)
    url = client.get(path(trial, flight, "/map")).json()["view"]["url"]
    claims, signature = url.rsplit("/", 1)[1].split(".")
    assert client.get(f"/api/local-objects/{claims}.{signature[:-2]}AA").status_code == 403
    assert client.get(f"/api/local-objects/{claims}").status_code == 403
    expired = store.signed_url(flight["ingest"]["view"]["key"], -1)
    assert client.get(expired).status_code == 403


def test_another_accounts_flight_gets_no_links(client, repo, store, trial):
    flight = with_view(client, repo, store, trial)
    repo.update_flight(flight["id"], {"accountId": "someone-else"})
    assert client.get(path(trial, flight, "/map")).status_code == 404


def test_a_store_that_cant_sign_says_what_to_set_up(client, repo, store, trial, monkeypatch):
    flight = with_view(client, repo, store, trial)

    def refuse(key, ttl):
        raise SigningUnavailable("give croplytix-api Token Creator on itself (step 14)")

    monkeypatch.setattr(store, "signed_url", refuse)
    r = client.get(path(trial, flight, "/map"))
    assert r.status_code == 503 and "step 14" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Cloud Storage's signed URLs, offline
# ---------------------------------------------------------------------------
def gcs_store(signer):
    from google.auth.credentials import AnonymousCredentials
    from google.cloud import storage

    store = GcsObjectStore.__new__(GcsObjectStore)
    store._client = storage.Client(project="p", credentials=AnonymousCredentials())
    store._bucket = store._client.bucket("croplytix-test")
    store.bucket_name = "croplytix-test"
    store._signer = signer
    return store


def test_a_service_account_key_signs_a_v4_get_link():
    pytest.importorskip("cryptography")
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from google.oauth2 import service_account

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    creds = service_account.Credentials.from_service_account_info(
        {"type": "service_account", "client_email": "api@p.iam.gserviceaccount.com", "private_key": pem, "token_uri": "https://oauth2.googleapis.com/token"}
    )
    url = gcs_store(creds).signed_url("accounts/u/trials/t/flights/f/derived/view.tif", 600)
    assert url.startswith("https://storage.googleapis.com/croplytix-test/accounts/u/trials/t/flights/f/derived/view.tif?")
    assert "X-Goog-Algorithm=GOOG4-RSA-SHA256" in url and "X-Goog-Expires=600" in url and "X-Goog-Signature=" in url


class MetadataServerCreds:
    """Cloud Run's identity: a token and an email, no private key."""

    def __init__(self, email="croplytix-api@p.iam.gserviceaccount.com"):
        self.valid, self.token, self.service_account_email = True, "ya29.token", email


def test_without_a_key_it_signs_through_iam_as_the_service_account(monkeypatch):
    from google.cloud.storage.blob import Blob

    seen = {}

    def fake_sign(self, **kwargs):
        seen.update(kwargs)
        return "https://storage.googleapis.com/croplytix-test/x?X-Goog-Signature=abc"

    monkeypatch.setattr(Blob, "generate_signed_url", fake_sign)
    creds = MetadataServerCreds()
    assert gcs_store(creds).signed_url("x", 3600).endswith("abc")
    assert seen["service_account_email"] == "croplytix-api@p.iam.gserviceaccount.com" and seen["access_token"] == "ya29.token"
    assert seen["version"] == "v4" and seen["method"] == "GET" and seen["expiration"].total_seconds() == 3600


def test_iam_refusing_to_sign_points_at_the_setup_step(monkeypatch):
    from google.cloud.storage.blob import Blob

    def denied(self, **kwargs):
        raise PermissionError("iam.serviceAccounts.signBlob denied")

    monkeypatch.setattr(Blob, "generate_signed_url", denied)
    with pytest.raises(SigningUnavailable, match="step 14"):
        gcs_store(MetadataServerCreds()).signed_url("x", 60)


def test_user_credentials_cant_sign_and_say_how_to_impersonate():
    with pytest.raises(SigningUnavailable, match="impersonate-service-account"):
        gcs_store(MetadataServerCreds(email=None)).signed_url("x", 60)
