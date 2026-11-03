"""
Starting ingest. Where it runs is a setting (INGEST_RUNNER), not a code path:

  inline    the API runs app.ingest itself, after the response has gone out.
            Local runs only — on Cloud Run, a container's CPU is throttled
            once its response is sent, and GDAL has no place in the API's 512 MiB.
  cloudrun  the API asks Cloud Run to execute the job INGEST_JOB with
            FLIGHT_ID set, and returns. The job is the same image with a
            different command, sized for rasters, billed only while it runs.
  off       the flight is recorded as queued and nothing starts. Tests.

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


def run_cloud_job(flight_id: str, session=None, project: str | None = None) -> str:
    """Starts one execution of the ingest job. Returns the operation name."""
    if not settings.INGEST_REGION:
        raise JobStartError("INGEST_RUNNER=cloudrun needs INGEST_REGION (the job's region).")
    if session is None:
        session, adc_project = _cloud_session()
        project = project or settings.GCP_PROJECT or adc_project
    url = f"{RUN_API}/projects/{project}/locations/{settings.INGEST_REGION}/jobs/{settings.INGEST_JOB}:run"
    body = {"overrides": {"containerOverrides": [{"env": [{"name": "FLIGHT_ID", "value": flight_id}]}]}}
    response = session.post(url, json=body, timeout=20)
    if response.status_code >= 400:
        try:
            detail = response.json()["error"]["message"]
        except Exception:
            detail = response.text[:300]
        raise JobStartError(f"Cloud Run refused to start {settings.INGEST_JOB} ({response.status_code}): {detail}")
    return response.json().get("name", "")


def queued() -> dict:
    return {"state": "queued", "queuedAt": utcnow()}


def start_ingest(flight_id: str, repo: Repo, store: ObjectStore, background: BackgroundTasks) -> dict:
    """Kicks off ingest for a flight already recorded as queued. Returns the
    flight's `ingest` record as it stands when the request answers."""
    record = (repo.get_flight(flight_id) or {}).get("ingest") or queued()
    if settings.INGEST_RUNNER == "off":
        return record
    if settings.INGEST_RUNNER == "inline":
        from .ingest import ingest_flight

        background.add_task(ingest_flight, flight_id, repo, store, view_compression=settings.VIEW_COMPRESSION)
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
