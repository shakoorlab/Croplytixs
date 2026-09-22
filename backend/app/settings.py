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

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
