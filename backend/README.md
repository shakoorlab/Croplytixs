# Croplytix backend

FastAPI service that owns two things: **trials** (a season-long experiment with a
plot roster) and **flights** (one capture date's inputs plus the run configuration).
Files go to a Cloud Storage bucket, records go to Firestore, the service runs on
Cloud Run. Setup and deploy: [`docs/gcp-setup.md`](docs/gcp-setup.md).

```
browser ──HTTPS──▶ Cloud Run: croplytix-api (this image)
   │                  │
   │                  ├── records ──▶ Firestore (default)   trials/{account}:{trial}, flights/{flight}
   │                  └── upload sessions, then checks ──┐
   │                                                     ▼
   └── file bytes, 8 MiB chunks ──────────────▶ GCS bucket   accounts/{account}/trials/{trial}/flights/{flight}/{role}/{file}
```

Every record and file belongs to one account — today, one per signed-in user —
and the API only ever shows a caller their own account's (`app/db.py`).

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

**File bytes never pass through the API.** Cloud Run refuses requests over 32 MiB,
and an orthophoto is gigabytes. The API opens a Cloud Storage *resumable upload
session* per file, the browser sends the bytes straight to the bucket, and a final
`complete` call has the API check every file arrived at its declared size before
the flight counts as uploaded (`app/routers/flights.py`, `app/storage.py`).

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
| GET | `/api/me` | who the token says you are |
| GET / POST | `/api/trials/{trial_id}/flights` | list / create: JSON `{meta, files: [{role, name, size}]}` → the flight (`awaiting_upload`) + one upload URL per file |
| GET | `/api/trials/{trial_id}/flights/{flight_id}` | one flight |
| POST | `/api/trials/{trial_id}/flights/{flight_id}/complete` | check the files arrived, record their MD5s, mark `uploaded`, start ingest |
| POST | `/api/trials/{trial_id}/flights/{flight_id}/uploads` | new upload URLs for files that haven't arrived (lost or expired URLs) |
| DELETE | `/api/trials/{trial_id}/flights/{flight_id}` | abandon a flight whose upload hasn't finished |
| POST | `/api/trials/{trial_id}/flights/{flight_id}/ingest` | build the flight's COGs again (`?force=true` if stuck) |
| GET | `/api/trials/{trial_id}/flights/{flight_id}/files/{role}/{name}` | stream a stored file back (up to 32 MiB) |
| PUT / DELETE | `/api/local-uploads/{session_id}` | local runs only: stands in for Cloud Storage's upload sessions |

Every route but `/api/health` and the local upload stand-in needs a signed-in user.

`/docs` has the live version with schemas and a try-it-out form.

## Known limits, and what fixes them

- **Downloads ≤ 32 MiB.** `GET …/files/…` streams through the API, so Cloud Run's
  response limit applies. Larger files will get short-lived signed download URLs,
  together with the map viewer, which takes the API out of the data path.
- **One account per user.** Nobody sees anyone else's trials yet. Sharing between
  accounts is a later decision; `app.auth.account_id_for` is the one place that
  decides which account a user acts for.
- **Status stops at `uploaded`.** Ingest (`app/ingest.py`, the Cloud Run job
  `croplytix-ingest`) turns each ortho into a lossless COG and a viewing COG and
  records them in the flight's `ingest` field. The clip-and-infer worker that moves
  `status` to `complete` and fills `meanCover` / `flagged` comes next, and will
  read the lossless COG.
