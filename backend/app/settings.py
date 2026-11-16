"""
Runtime configuration.

Everything the backend needs to know about *where it is running* comes in
through environment variables — never from code. That is what lets the same
Docker image run on your laptop (against local folders), on the free-tier VM
(against GCS + Firestore), and later on Cloud Run, with only the env changing.

Read once at import time; `settings` is the single instance the app uses.
"""

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ---- which adapters to use ---------------------------------------------
    # "local" + "memory" need no Google credentials at all: handy for tests and
    # for poking at the API before the cloud pieces exist.
    STORAGE_BACKEND: Literal["gcs", "local"] = "gcs"
    DB_BACKEND: Literal["firestore", "memory"] = "firestore"

    # ---- Google Cloud --------------------------------------------------------
    # Project is normally inferred from Application Default Credentials; set it
    # explicitly only if the client libraries can't work it out.
    GCP_PROJECT: str | None = None
    GCS_BUCKET: str | None = None
    # Firestore supports several databases per project now; "(default)" is the
    # one `gcloud firestore databases create` makes unless you name it.
    FIRESTORE_DATABASE: str = "(default)"

    # ---- sign-in ----------------------------------------------------------------
    # Which project's Identity Platform sign-ins to trust. An ID token names the
    # project it was minted for (its `aud` claim); tokens for any other project
    # are refused. Falls back to GCP_PROJECT. The API refuses to start with
    # neither set — failing at deploy beats failing on the first request.
    AUTH_PROJECT_ID: str | None = None

    # ---- local adapter ----------------------------------------------------------
    LOCAL_STORAGE_DIR: str = "./.data/objects"

    # ---- HTTP --------------------------------------------------------------
    # Only needed when the browser talks to the backend on a *different* origin
    # (Vite dev server without the proxy, or a frontend on its own Cloud Run
    # URL). Behind nginx it is moot. Comma-separated because env vars are flat
    # strings and a JSON list is awkward to pass through `gcloud`.
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    # ---- uploads ------------------------------------------------------------
    # The browser sends files straight to the bucket (see app/storage.py), so
    # these are not Cloud Run's limits; they are what the API agrees to open an
    # upload session for. Each session is opened for an exact size, and Cloud
    # Storage refuses to finish an object at any other, so a declared 2 GB file
    # can't turn into 200 GB on the way in. The ortho's ceiling is really set by
    # ingest, which needs memory for the COGs it writes (docs/gcp-setup.md, step 10).
    MAX_ORTHO_MB: int = 10 * 1024
    MAX_SHAPEFILE_MB: int = 100  # per file of the set

    # ---- ingest (orthophoto → COGs, see app/ingest.py) ------------------------
    # Where ingest runs when a flight is uploaded:
    #   inline   — in this process, after the response is sent. Local runs.
    #   cloudrun — as an execution of the Cloud Run job INGEST_JOB, so GDAL never
    #              shares the API's 512 MiB. Cloud Run.
    #   off      — record the flight as queued and leave it there. Tests.
    INGEST_RUNNER: Literal["inline", "cloudrun", "off"] = "inline"
    INGEST_JOB: str = "croplytix-ingest"
    INGEST_REGION: str | None = None  # the job's region, e.g. us-central1; required for cloudrun
    # Where the ingest job finds the bucket mounted as a folder (a Cloud Storage
    # volume on the job). When the ortho is there, ingest reads it in place
    # instead of copying it into the job's memory first — on Cloud Run the
    # disk is RAM, so that copy costs as much memory as the file. Unset, or the
    # file not found there: ingest copies it, as on a laptop.
    INGEST_SOURCE_DIR: str | None = None
    # The job's --task-timeout. A job killed for running out of memory can't
    # record that it failed, so an ingest still "running" this long after it
    # started is reported as failed (app/routers/flights.py).
    INGEST_TIMEOUT_MINUTES: int = 30
    # The viewing copy's compression. Both decode in every current browser;
    # WebP is ~15% smaller on the sample ortho, JPEG decodes without
    # createImageBitmap. Change it and re-run ingest to compare.
    VIEW_COMPRESSION: Literal["WEBP", "JPEG"] = "WEBP"

    # --- processing: canopy per plot (app/process.py) -------------------------
    # Where it runs, as for ingest: "cloudrun" starts the job PROCESS_JOB in
    # INGEST_REGION; "inline" runs it inside the API process (local runs, with
    # requirements-process.txt and CPU PyTorch installed); "off" only records
    # the request (tests).
    PROCESS_RUNNER: Literal["inline", "cloudrun", "off"] = "inline"
    PROCESS_JOB: str = "croplytix-process"
    # Start processing as soon as ingest has built the map copies, for flights
    # that have a plot grid. Off: processing waits for the Process button.
    PROCESS_AFTER_INGEST: bool = True
    # The job's --task-timeout; a run still "running" 5 minutes past it is
    # reported as failed, as for ingest.
    PROCESS_TIMEOUT_MINUTES: int = 60
    # The largest field, in millions of pixels at the model's pixel size, a run
    # takes on. The watershed holds the whole field: about 40 bytes a pixel,
    # so 150 MP is ~6 GB of the job's 8 GiB (about 8 ha at 2.3 cm).
    PROCESS_MAX_MEGAPIXELS: int = 150

    # ---- reading the map files in the browser ---------------------------------
    # How long a signed link to a map file (the viewing COG, a result's
    # assignment raster) works. The browser asks for fresh links before then.
    MAP_LINK_MINUTES: int = 60

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
