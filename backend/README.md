# Croplytix backend

FastAPI service that owns two things: **trials** (a season-long experiment with a
plot roster) and **flights** (one capture date's inputs plus the run configuration).
Files go to a Cloud Storage bucket, records go to Firestore, the service runs on
Cloud Run. Setup and deploy: [`docs/gcp-setup.md`](docs/gcp-setup.md).

```
browser ──HTTPS──▶ Cloud Run: croplytix-api (this image)
                      │
                      ├── records ──▶ Firestore (default)   trials/{id}, flights/{id}
                      └── bytes   ──▶ GCS bucket            trials/{id}/flights/{id}/{role}/{file}
```

## Why it is shaped this way

**Bytes in a bucket, records in a database.** A database is for things you query —
"every flight in trial X, newest first". Object storage is for things you stream —
a 40 MB GeoTIFF. Firestore caps documents at 1 MiB and bills per read, so an image
inside a document would be both impossible and expensive; a bucket bills per GB and
streams. Each flight document therefore stores *where* its files are (`files[].key`),
never the files.

**Adapters behind a seam.** `app/storage.py` and `app/db.py` each define a small
Protocol with two implementations: the Google one and a local one (folder / dict).
The routers only see the Protocol. That is what lets `pytest` run with no
credentials, lets you poke at `/docs` on a laptop with no cloud, and would let the
bucket move (S3, MinIO) by touching one file.

**Configuration by environment.** `app/settings.py` reads everything from env vars.
One Docker image, three environments: laptop (`.env`), Cloud Run
(`deploy/env.cloudrun.yaml`), and — if ever needed — the free-tier VM.

**Bytes first, record second.** The flight handler streams every file into the
bucket and only then writes the Firestore document. A crash in between leaves an
orphaned object (cents, sweepable); the other order would leave a record pointing
at nothing, which the UI would trip over forever.

**Sync handlers.** Google's client libraries block. FastAPI runs plain `def` routes
in a thread pool, so a slow upload never stalls the event loop; `async def` around
a blocking call would.

**Derived columns are derived.** `flightDates`, `processed`, `flagged` on a trial are
computed from its flights on every read rather than stored, so they cannot drift.

## Run locally

```bash
pip install -r requirements-dev.txt
cp .env.example .env            # defaults to local folder + in-memory records
uvicorn app.main:app --reload --port 8000
open http://localhost:8000/docs
pytest
```

To run locally against the real bucket and database, see the optional section at
the end of `docs/gcp-setup.md` (Application Default Credentials).

## API

| Method | Path | What |
|---|---|---|
| GET | `/api/health` | liveness + which adapters are wired |
| GET / POST | `/api/trials` | list / create (JSON body, see `TrialCreate`) |
| GET | `/api/trials/{trial_id}` | one trial with derived stats |
| GET / POST | `/api/trials/{trial_id}/flights` | list / create (multipart: `meta` JSON + `ortho`, `shapefile[]`, `clipped[]`) |
| GET | `/api/trials/{trial_id}/flights/{flight_id}` | one flight |
| GET | `/api/trials/{trial_id}/flights/{flight_id}/files/{role}/{name}` | stream a stored file back |

`/docs` has the live version with schemas and a try-it-out form.

## Known limits, and what fixes them

- **Uploads ≤ 30 MB per file.** Cloud Run rejects HTTP/1 requests over 32 MiB.
  Fine for pre-clipped plot TIFs and demo orthos; multi-GB orthos need the browser
  to upload straight to the bucket with a short-lived *signed URL* the API hands
  out, so the bytes never pass through Cloud Run. The seam is in place; it is the
  next backend slice after auth.
- **No authentication.** The service URL is public. Next slice: Identity Platform /
  Firebase Auth tokens checked in a dependency.
- **Status stops at `uploaded`.** The clip-and-infer worker that moves a flight to
  `complete` and fills `meanCover` / `flagged` is a Cloud Run *job* (or a worker
  pool), reading the same Firestore document this API writes.
