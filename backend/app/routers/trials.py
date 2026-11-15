"""
/api/trials

A trial is the long-lived thing: it owns a plot roster and accumulates flights
across a season. Creating one is a single Firestore write. Listing them is a
read of the caller's trials plus, per trial, its flights — that N+1 is fine
at this scale and keeps the "derived from flights" columns honest. If it ever
shows up in a profiler, the fix is to keep counters on the trial document and
update them in the same transaction that creates a flight.

Everything is scoped to the caller's account: a trial id is unique within an
account, and another account's trial answers 404 like a missing one.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..auth import User, current_account, current_user
from ..db import Repo, utcnow
from ..deps import get_repo
from ..ids import slugify, unique_slug
from ..schemas import Trial, TrialCreate

router = APIRouter(prefix="/trials", tags=["trials"])


def _with_stats(trial: dict, flights: list[dict]) -> Trial:
    complete = [f for f in flights if f.get("status") == "complete"]
    last = max([trial["createdAt"], *[f["createdAt"] for f in flights]])
    return Trial(
        **trial,
        flightDates=len(flights),
        processed=sum(f.get("plots", 0) for f in complete),
        expected=sum(f.get("plots", 0) for f in flights),
        flagged=sum(f.get("flagged") or 0 for f in flights),
        lastActivity=last,
    )


@router.get("", response_model=list[Trial])
def list_trials(account: str = Depends(current_account), repo: Repo = Depends(get_repo)):
    return [_with_stats(t, repo.list_flights(account, t["id"])) for t in repo.list_trials(account)]


@router.post("", response_model=Trial, status_code=201)
def create_trial(
    body: TrialCreate,
    user: User = Depends(current_user),
    account: str = Depends(current_account),
    repo: Repo = Depends(get_repo),
):
    # Name uniqueness is enforced here, not only in the dialog: the UI check
    # only knows about trials it has loaded. Unique within the account.
    if any(t["name"].lower() == body.name.lower() for t in repo.list_trials(account)):
        raise HTTPException(409, f"A trial named '{body.name}' already exists.")

    doc = {
        "id": unique_slug(slugify(f"{body.name}-{body.season}"), lambda slug: repo.trial_exists(account, slug)),
        "accountId": account,
        **body.model_dump(),
        "createdBy": user.email or user.uid,
        "createdAt": utcnow(),
    }
    repo.create_trial(doc)
    return _with_stats(doc, [])


@router.get("/{trial_id}", response_model=Trial)
def get_trial(trial_id: str, account: str = Depends(current_account), repo: Repo = Depends(get_repo)):
    trial = repo.get_trial(account, trial_id)
    if not trial:
        raise HTTPException(404, f"No trial with id '{trial_id}'.")
    return _with_stats(trial, repo.list_flights(account, trial_id))
