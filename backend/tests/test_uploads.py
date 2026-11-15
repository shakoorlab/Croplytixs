"""
The local stand-in for Cloud Storage's upload sessions (app/routers/local_uploads.py).
The browser's uploader is written against Cloud Storage's protocol; these tests
pin the stand-in to that protocol, so what works on a laptop works on Cloud Run.
"""

import hashlib
import os

import pytest

from app.storage import UPLOAD_GRANULARITY
from tests.conftest import put_file

CHUNK = UPLOAD_GRANULARITY  # the smallest legal chunk


@pytest.fixture
def session(client, store):
    def open_session(size: int, key: str = "accounts/a/x/field.tif") -> str:
        return store.start_upload(key, size, "image/tiff")

    return open_session


def status(client, url, size):
    return client.put(url, headers={"Content-Range": f"bytes */{size}"})


def test_chunks_resume_from_what_the_server_kept(client, store, session):
    data = os.urandom(3 * CHUNK + 1000)
    url = session(len(data))

    r = status(client, url, len(data))
    assert r.status_code == 308
    assert "range" not in r.headers, "no Range until a byte is kept — like Cloud Storage"

    r = client.put(url, content=data[:CHUNK], headers={"Content-Range": f"bytes 0-{CHUNK - 1}/{len(data)}"})
    assert r.status_code == 308
    assert r.headers["range"] == f"bytes=0-{CHUNK - 1}"
    assert status(client, url, len(data)).headers["range"] == f"bytes=0-{CHUNK - 1}"

    done = put_file(client, url, data, chunk=CHUNK)  # resends nothing it was told is kept
    assert done.status_code == 200
    assert store.stat("accounts/a/x/field.tif").md5 == hashlib.md5(data).hexdigest()
    assert status(client, url, len(data)).status_code == 200, "a finished session answers 200 to a status query"


def test_a_resend_overlapping_kept_bytes_is_accepted(client, store, session):
    data = os.urandom(2 * CHUNK)
    url = session(len(data))
    client.put(url, content=data[:CHUNK], headers={"Content-Range": f"bytes 0-{CHUNK - 1}/{len(data)}"})
    # the reply to that chunk was "lost", so the browser sends it again with the rest
    r = client.put(url, content=data, headers={"Content-Range": f"bytes 0-{len(data) - 1}/{len(data)}"})
    assert r.status_code == 200
    assert b"".join(store.open("accounts/a/x/field.tif")) == data


REFUSED = {
    "no Content-Range": ({}, b"x"),
    "total differs from the session's": ({"Content-Range": "bytes 0-0/99"}, b"x"),
    "body shorter than its range": ({"Content-Range": f"bytes 0-9/{2 * CHUNK}"}, b"abc"),
    "chunk not a multiple of 256 KiB": ({"Content-Range": f"bytes 0-999/{2 * CHUNK}"}, b"x" * 1000),
    "gap before the chunk": ({"Content-Range": f"bytes {CHUNK}-{2 * CHUNK - 1}/{2 * CHUNK}"}, b"x" * CHUNK),
}


@pytest.mark.parametrize(("headers", "body"), REFUSED.values(), ids=REFUSED.keys())
def test_requests_cloud_storage_would_refuse_are_400(client, session, headers, body):
    url = session(2 * CHUNK)
    assert client.put(url, content=body, headers=headers).status_code == 400


def test_unknown_session_is_404(client):
    assert status(client, "/api/local-uploads/" + "x" * 32, 10).status_code == 404
    assert status(client, "/api/local-uploads/../../etc", 10).status_code == 404


def test_cancelled_session_answers_499_then_404(client, store, session):
    url = session(10)
    assert client.delete(url).status_code == 499
    assert status(client, url, 10).status_code == 404
    assert not store.exists("accounts/a/x/field.tif")
