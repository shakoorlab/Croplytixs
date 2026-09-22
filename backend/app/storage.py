"""
Object storage — where the *bytes* live.

The API code never touches Google Cloud Storage directly; it talks to an
`ObjectStore` with three verbs: put, open, exists. Two implementations:

  * GcsObjectStore   — the real thing. Used on the VM and on Cloud Run.
  * LocalObjectStore — a folder on disk. Used in tests and for running the API
                       with no Google credentials at all.

Why bother with the seam? Because it makes the decision "images go in a bucket,
records go in a database" a *boundary* in the code rather than a comment. If the
bucket ever moves (S3, MinIO on the VM, whatever) only this file changes.

Object keys are paths like `trials/{trial_id}/flights/{flight_id}/ortho.tif`.
Buckets are flat — the slashes are just characters in the name — but the
convention makes `gcloud storage ls` on the bucket read like a directory tree,
and lets us later apply lifecycle rules per prefix (e.g. delete `tmp/` after 7d).
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import BinaryIO, Iterator, Protocol


class ObjectStore(Protocol):
    def put(self, key: str, fileobj: BinaryIO, content_type: str | None = None) -> int:
        """Stream `fileobj` into the store under `key`. Returns bytes written."""

    def open(self, key: str, chunk_size: int = 1 << 20) -> Iterator[bytes]:
        """Yield the object's bytes in chunks, so large files never sit in RAM."""

    def exists(self, key: str) -> bool: ...

    def describe(self) -> str:
        """Human-readable location, surfaced on /api/health."""


# ---------------------------------------------------------------------------
# local folder
# ---------------------------------------------------------------------------
class LocalObjectStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

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

    def describe(self) -> str:
        return f"local:{self.root}"


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
        # time. The library's default piece is 100 MiB, larger than any file we
        # accept, so without this every upload was read into memory whole. On
        # Cloud Run that doubles up: FastAPI has already saved the upload to /tmp,
        # and /tmp there is RAM. Must be a multiple of 256 KiB.
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

    def describe(self) -> str:
        return f"gs://{self.bucket_name}"
