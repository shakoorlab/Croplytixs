"""
Object storage — where the *bytes* live.

The API code never touches Google Cloud Storage directly; it talks to an
`ObjectStore` with a handful of verbs: put, open, exists, stat, delete, and
start_upload. Two implementations:

  * GcsObjectStore   — the real thing. Used on Cloud Run.
  * LocalObjectStore — a folder on disk. Used in tests and for running the API
                       with no Google credentials at all.

Why bother with the seam? Because it makes the decision "images go in a bucket,
records go in a database" a *boundary* in the code rather than a comment. If the
bucket ever moves (S3, MinIO on the VM, whatever) only this file changes.

Object keys are paths like
`accounts/{account}/trials/{trial}/flights/{flight}/ortho/field.tif`. Buckets are
flat — the slashes are just characters in the name — but the convention makes
`gcloud storage ls` on the bucket read like a directory tree, and lets us later
apply lifecycle rules per prefix (e.g. delete `tmp/` after 7d).

Uploads don't pass through the API
----------------------------------
Cloud Run refuses HTTP/1 requests over 32 MiB, and an orthophoto is hundreds of
megabytes to several gigabytes. So the browser sends the bytes to the bucket
itself, through a Cloud Storage *resumable upload session* that the API opens
with its own service account (`start_upload`). The session URL is the only
credential the browser needs: anyone holding it can upload that one object, of
the size declared when it was opened, for about a week. It is handed only to
the uploader and never logged or stored.

The browser PUTs the file in chunks with a `Content-Range` header. Cloud Storage
answers 308 with `Range: bytes=0-N` (the bytes it has kept so far) until the last
chunk, then 200 with the object. After any error the browser asks "how much do
you have?" (`Content-Range: bytes */TOTAL`) and resumes from the answer, never
from its own count. `LocalObjectStore.receive` speaks the same protocol, so the
uploader is exercised end to end on a laptop and in the tests.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterator, Protocol

# Every chunk but the last must be a multiple of this; Cloud Storage refuses others.
UPLOAD_GRANULARITY = 256 * 1024


@dataclass(frozen=True)
class ObjectInfo:
    size: int
    md5: str | None  # hex digest, as `md5sum` prints it


class ObjectStore(Protocol):
    def put(self, key: str, fileobj: BinaryIO, content_type: str | None = None) -> int:
        """Stream `fileobj` into the store under `key`. Returns bytes written."""

    def open(self, key: str, chunk_size: int = 1 << 20) -> Iterator[bytes]:
        """Yield the object's bytes in chunks, so large files never sit in RAM."""

    def exists(self, key: str) -> bool: ...

    def stat(self, key: str) -> ObjectInfo | None:
        """Size and MD5 of a finished object, or None if there is none."""

    def delete(self, key: str) -> None:
        """Remove the object. Missing is fine."""

    def start_upload(self, key: str, size: int, content_type: str | None = None, origin: str | None = None) -> str:
        """Open a resumable upload session for exactly `size` bytes at `key`; returns its URL."""

    def describe(self) -> str:
        """Human-readable location, surfaced on /api/health."""


# ---------------------------------------------------------------------------
# local folder
# ---------------------------------------------------------------------------
class UploadProtocolError(Exception):
    """A request the Cloud Storage upload protocol would refuse with a 400."""


@dataclass(frozen=True)
class UploadReply:
    """What `receive` answers: 308 + how much is kept, or 200 + the object."""

    status: int
    persisted: int  # bytes kept so far
    body: dict | None = None


_CONTENT_RANGE = re.compile(r"bytes (?:\*|(\d+)-(\d+))/(\d+|\*)")
_SESSION_ID = re.compile(r"[A-Za-z0-9_-]{20,64}")


class LocalObjectStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        # Upload sessions live next to the objects, in a folder no key can reach
        # (keys are validated to stay under root, and this name is not a key).
        self._sessions = self.root / ".sessions"

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        # A key like `../../etc/passwd` must not escape the root.
        if self.root.resolve() not in path.parents:
            raise ValueError(f"key escapes storage root: {key}")
        return path

    def put(self, key: str, fileobj: BinaryIO, content_type: str | None = None) -> int:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as out:
            shutil.copyfileobj(fileobj, out, length=1 << 20)
        return path.stat().st_size

    def open(self, key: str, chunk_size: int = 1 << 20) -> Iterator[bytes]:
        with self._path(key).open("rb") as f:
            while chunk := f.read(chunk_size):
                yield chunk

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def stat(self, key: str) -> ObjectInfo | None:
        path = self._path(key)
        if not path.is_file():
            return None
        digest = hashlib.md5()
        with path.open("rb") as f:
            while chunk := f.read(1 << 20):
                digest.update(chunk)
        return ObjectInfo(size=path.stat().st_size, md5=digest.hexdigest())

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def describe(self) -> str:
        return f"local:{self.root}"

    # -- resumable uploads, the way Cloud Storage does them --------------------
    def start_upload(self, key: str, size: int, content_type: str | None = None, origin: str | None = None) -> str:
        self._path(key)  # refuse a bad key now, not on the last chunk
        self._sessions.mkdir(parents=True, exist_ok=True)
        session_id = secrets.token_urlsafe(24)
        self._session_file(session_id, ".json").write_text(json.dumps({"key": key, "size": size, "done": False}))
        self._session_file(session_id, ".part").touch()
        # Relative, so it resolves against whatever origin served the page: the
        # Vite dev proxy forwards it to this process like any other /api call.
        return f"/api/local-uploads/{session_id}"

    def _session_file(self, session_id: str, suffix: str) -> Path:
        if not _SESSION_ID.fullmatch(session_id):
            raise KeyError(session_id)
        return self._sessions / f"{session_id}{suffix}"

    def _session(self, session_id: str) -> dict:
        meta = self._session_file(session_id, ".json")
        if not meta.is_file():
            raise KeyError(session_id)
        return json.loads(meta.read_text())

    def receive(self, session_id: str, content_range: str | None, body: bytes) -> UploadReply:
        """One PUT to a session URL. Raises KeyError for an unknown session and
        UploadProtocolError for a request Cloud Storage would refuse."""
        session = self._session(session_id)
        size = session["size"]
        if session["done"]:
            info = self.stat(session["key"])
            return UploadReply(200, size, {"name": session["key"], "size": size, "md5Hash": _b64(info.md5) if info else None})

        part = self._session_file(session_id, ".part")
        persisted = part.stat().st_size
        match = _CONTENT_RANGE.fullmatch((content_range or "").strip())
        if not match:
            raise UploadProtocolError("Content-Range must be 'bytes FIRST-LAST/TOTAL' or 'bytes */TOTAL'.")
        first, last, total = match.groups()
        if total != "*" and int(total) != size:
            raise UploadProtocolError(f"This session is for {size} bytes, not {total}.")
        if first is None:  # "how much do you have?"
            if body:
                raise UploadProtocolError("A status query carries no body.")
            return UploadReply(308, persisted)

        first, last = int(first), int(last)
        if last < first or len(body) != last - first + 1:
            raise UploadProtocolError("The body's length doesn't match its Content-Range.")
        if first > persisted:
            raise UploadProtocolError(f"Chunk starts at byte {first}, but only {persisted} bytes are stored.")
        if last + 1 > size:
            raise UploadProtocolError("Chunk runs past the declared size.")
        if last + 1 < size and (last - first + 1) % UPLOAD_GRANULARITY:
            raise UploadProtocolError("Every chunk but the last must be a multiple of 256 KiB.")

        # Bytes already kept are skipped, the rest appended — a resend after a
        # lost reply overlaps what is stored, and that is allowed.
        if last + 1 > persisted:
            with part.open("ab") as out:
                out.write(body[persisted - first :])
            persisted = last + 1

        if persisted < size:
            return UploadReply(308, persisted)

        target = self._path(session["key"])
        target.parent.mkdir(parents=True, exist_ok=True)
        part.replace(target)
        session["done"] = True
        self._session_file(session_id, ".json").write_text(json.dumps(session))
        info = self.stat(session["key"])
        return UploadReply(200, size, {"name": session["key"], "size": size, "md5Hash": _b64(info.md5)})

    def cancel(self, session_id: str) -> None:
        """DELETE on a session URL: the upload is abandoned and its bytes dropped."""
        self._session(session_id)
        self._session_file(session_id, ".json").unlink(missing_ok=True)
        self._session_file(session_id, ".part").unlink(missing_ok=True)


def _b64(md5_hex: str | None) -> str | None:
    return base64.b64encode(bytes.fromhex(md5_hex)).decode() if md5_hex else None


# ---------------------------------------------------------------------------
# Google Cloud Storage
# ---------------------------------------------------------------------------
class GcsObjectStore:
    def __init__(self, bucket_name: str, project: str | None = None):
        # Imported lazily so the local adapter works without the library installed
        # / without credentials configured.
        from google.cloud import storage

        # `storage.Client()` with no arguments = Application Default Credentials.
        # Laptop: whatever `gcloud auth application-default login` produced.
        # VM:     the service account attached to the instance (via the metadata server).
        # Cloud Run: the service's runtime identity. Same line of code everywhere.
        self._client = storage.Client(project=project)
        self._bucket = self._client.bucket(bucket_name)
        self.bucket_name = bucket_name

    def put(self, key: str, fileobj: BinaryIO, content_type: str | None = None) -> int:
        blob = self._bucket.blob(key)
        # Send the file in 8 MiB pieces so at most 8 MiB of it is in memory at a
        # time. The library's default piece is 100 MiB, so without this a large
        # file would be read into memory whole — and on Cloud Run the disk is RAM
        # too. Must be a multiple of 256 KiB.
        blob.chunk_size = 8 * 1024 * 1024
        blob.upload_from_file(fileobj, content_type=content_type, rewind=True)
        blob.reload()
        return int(blob.size or 0)

    def open(self, key: str, chunk_size: int = 1 << 20) -> Iterator[bytes]:
        blob = self._bucket.blob(key)
        with blob.open("rb") as f:
            while chunk := f.read(chunk_size):
                yield chunk

    def exists(self, key: str) -> bool:
        return self._bucket.blob(key).exists()

    def stat(self, key: str) -> ObjectInfo | None:
        blob = self._bucket.get_blob(key)
        if blob is None:
            return None
        md5 = base64.b64decode(blob.md5_hash).hex() if blob.md5_hash else None
        return ObjectInfo(size=int(blob.size or 0), md5=md5)

    def delete(self, key: str) -> None:
        from google.cloud.exceptions import NotFound

        try:
            self._bucket.blob(key).delete()
        except NotFound:
            pass

    def start_upload(self, key: str, size: int, content_type: str | None = None, origin: str | None = None) -> str:
        # `size` goes out as X-Upload-Content-Length: Cloud Storage refuses to
        # finish the object at any other length, so a session can't be used to
        # store more than the API agreed to. `origin` is passed because Google's
        # docs ask for it on browser uploads; in practice the session answers
        # CORS for any origin. `checksum=None`: the library would only check the
        # bytes it sends itself, and the browser sends them.
        blob = self._bucket.blob(key)
        return blob.create_resumable_upload_session(content_type=content_type, size=size, origin=origin, checksum=None)

    def describe(self) -> str:
        return f"gs://{self.bucket_name}"
