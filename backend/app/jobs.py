"""
Starting the jobs that work on a flight: ingest (orthophoto → COGs) and
processing (canopy per plot), in that order. Where each runs is a setting
(INGEST_RUNNER, PROCESS_RUNNER), not a code path:

  inline    the API runs app.ingest itself, after the response has gone out.
            Local runs only — on Cloud Run, a container's CPU is throttled
            once its response is sent, and GDAL has no place in the API's 512 MiB.
  cloudrun  the API asks Cloud Run to execute the job INGEST_JOB with
            FLIGHT_ID set, and returns. The job is the same image with a
            different command, sized for rasters, billed only while it runs.
  off       the flight is recorded as queued and nothing starts. Tests.

Processing follows ingest by itself (PROCESS_AFTER_INGEST): when ingest has
built the COGs of a flight with a plot grid, it starts processing. On Cloud
Run that call comes from inside the ingest job, which runs as the API's
account, so that account needs the same role on croplytix-process.

Starting a job execution is one authenticated POST to the Cloud Run Admin API.
It goes through google-auth's AuthorizedSession — already installed with
google-cloud-storage — rather than the google-cloud-run client library, which
would add a dependency for a single call. The API's service account needs
`run.jobs.runWithOverrides` on the job (roles/run.jobsExecutorWithOverrides);
the runbook grants it.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from fastapi import BackgroundTasks

from .db import Repo, utcnow
from .settings import settings
from .storage import ObjectStore

log = logging.getLogger("croplytix.jobs")

RUN_API = "https://run.googleapis.com/v2"


class JobStartError(Exception):
    pass


@lru_cache(maxsize=1)
def _cloud_session():
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    credentials, project = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    return AuthorizedSession(credentials), project


def run_cloud_job(flight_id: str, session=None, project: str | None = None, job: str | None = None) -> str:
    """Starts one execution of a job (the ingest job unless `job` says otherwise)
    with FLIGHT_ID set. Returns the operation name."""
    job = job or settings.INGEST_JOB
    if not settings.INGEST_REGION:
        raise JobStartError("Running jobs on Cloud Run needs INGEST_REGION (the jobs' region).")
    if session is None:
        session, adc_project = _cloud_session()
        project = project or settings.GCP_PROJECT or adc_project
    url = f"{RUN_API}/projects/{project}/locations/{settings.INGEST_REGION}/jobs/{job}:run"
    body = {"overrides": {"containerOverrides": [{"env": [{"name": "FLIGHT_ID", "value": flight_id}]}]}}
    response = session.post(url, json=body, timeout=20)
    if response.status_code >= 400:
        try:
            detail = response.json()["error"]["message"]
        except Exception:
            detail = response.text[:300]
        raise JobStartError(f"Cloud Run refused to start {job} ({response.status_code}): {detail}")
    return response.json().get("name", "")


def queued() -> dict:
    return {"state": "queued", "queuedAt": utcnow()}


def start_ingest(flight_id: str, repo: Repo, store: ObjectStore, background: BackgroundTasks) -> dict:
    """Kicks off ingest for a flight already recorded as queued. Returns the
    flight's `ingest` record as it stands when the request answers."""
    record = (repo.get_flight_unscoped(flight_id) or {}).get("ingest") or queued()
    if settings.INGEST_RUNNER == "off":
        return record
    if settings.INGEST_RUNNER == "inline":
        from .ingest import ingest_flight

        background.add_task(
            ingest_flight,
            flight_id,
            repo,
            store,
            view_compression=settings.VIEW_COMPRESSION,
            source_dir=settings.INGEST_SOURCE_DIR,
            then_process=settings.PROCESS_AFTER_INGEST,
        )
        return record

    # cloudrun: synchronous on purpose — one quick HTTPS call, made while the
    # request still holds the CPU.
    try:
        operation = run_cloud_job(flight_id)
        log.info("ingest %s: started %s", flight_id, operation)
        return record
    except Exception as exc:
        log.exception("ingest %s: could not start the job", flight_id)
        failed = {**record, "state": "failed", "finishedAt": utcnow(), "error": f"Could not start ingest: {exc}"}
        repo.update_flight(flight_id, {"ingest": failed})
        return failed


# ---------------------------------------------------------------------------
# processing
# ---------------------------------------------------------------------------
def has_plot_grid(flight: dict) -> bool:
    return any(f["role"] == "shapefile" for f in flight.get("files", []))


def queue_processing(flight: dict, repo: Repo, model_id: str) -> dict:
    """Records a processing run as queued under the flight's next result
    version and returns the fields written. Versions only go up, so a run
    never overwrites another's outputs."""
    version = (flight.get("resultCount") or 0) + 1
    fields = {
        "status": "queued",
        "progress": 0,
        "error": None,
        "resultCount": version,
        "processing": {"state": "queued", "version": version, "modelId": model_id, "queuedAt": utcnow()},
    }
    repo.update_flight(flight["id"], fields)
    return fields


def start_processing(flight_id: str, repo: Repo, store: ObjectStore, background: BackgroundTasks | None) -> dict:
    """Starts a run already recorded as queued. Returns the flight's fields as
    they stand when the call returns. Without `background` (inside the ingest
    job, or after an inline ingest) an inline run happens right here."""
    if settings.PROCESS_RUNNER == "off":
        return {}
    if settings.PROCESS_RUNNER == "inline":
        from .process import process_flight

        if background is None:
            process_flight(flight_id, repo, store, source_dir=settings.INGEST_SOURCE_DIR)
        else:
            background.add_task(process_flight, flight_id, repo, store, source_dir=settings.INGEST_SOURCE_DIR)
        return {}
    try:
        operation = run_cloud_job(flight_id, job=settings.PROCESS_JOB)
        log.info("process %s: started %s", flight_id, operation)
        return {}
    except Exception as exc:
        log.exception("process %s: could not start the job", flight_id)
        flight = repo.get_flight_unscoped(flight_id) or {}
        processing = {**(flight.get("processing") or {}), "state": "failed", "finishedAt": utcnow(), "error": f"Could not start processing: {exc}"}
        fields = {"status": "failed", "error": processing["error"], "processing": processing}
        repo.update_flight(flight_id, fields)
        return fields


def process_after_ingest(flight_id: str, repo: Repo, store: ObjectStore) -> bool:
    """Called when ingest has built a flight's COGs: starts processing with the
    default model if the flight has a plot grid and no run is under way."""
    from .model_registry import DEFAULT_MODEL_ID

    flight = repo.get_flight_unscoped(flight_id)
    if not flight or not has_plot_grid(flight):
        return False
    if (flight.get("processing") or {}).get("state") in ("queued", "running"):
        return False
    queue_processing(flight, repo, DEFAULT_MODEL_ID)
    start_processing(flight_id, repo, store, None)
    return True
