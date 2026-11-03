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
    # Hard ceiling on a single uploaded file. Cloud Run rejects HTTP/1 requests
    # over 32 MiB before they reach us, so the default sits under that and turns
    # an opaque gateway error into a clear 413. Multi-GB orthos are a different
    # upload design (direct-to-bucket signed URLs), not a bigger number here.
    MAX_UPLOAD_MB: int = 30

    # ---- ingest (orthophoto → COGs, see app/ingest.py) ------------------------
    # Where ingest runs when a flight is uploaded:
    #   inline   — in this process, after the response is sent. Local runs.
    #   cloudrun — as an execution of the Cloud Run job INGEST_JOB, so GDAL never
    #              shares the API's 512 MiB. Cloud Run.
    #   off      — record the flight as queued and leave it there. Tests.
    INGEST_RUNNER: Literal["inline", "cloudrun", "off"] = "inline"
    INGEST_JOB: str = "croplytix-ingest"
    INGEST_REGION: str | None = None  # the job's region, e.g. us-central1; required for cloudrun
    # The viewing copy's compression. Both decode in every current browser;
    # WebP is ~15% smaller on the sample ortho, JPEG decodes without
    # createImageBitmap. Change it and re-run ingest to compare.
    VIEW_COMPRESSION: Literal["WEBP", "JPEG"] = "WEBP"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
