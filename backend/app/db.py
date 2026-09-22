"""
Records — where the *metadata* lives.

Same idea as storage.py: the routers talk to a `Repo` with a handful of
methods; Firestore is one implementation, an in-memory dict is the other.

Firestore layout
----------------
    trials/{trial_id}      one document per trial
    flights/{flight_id}    one document per flight, with a `trialId` field

Flights are a *top-level* collection rather than a subcollection under each
trial. Firestore can do either; the difference is what you can query later. A
background worker will eventually want "every flight with status == queued,
across all trials" — trivial on a top-level collection, awkward on
subcollections (collection-group queries need their own indexes).

Sorting is done in Python after the fetch. Firestore would happily sort for us,
but `where trialId == X` + `order by createdAt` is a *composite* query and
Firestore refuses composite queries until you create a matching index (it
fails with an error containing a link to create one). For a few hundred flights
per trial, sorting in memory costs nothing and can't break during a demo.

Timestamps are ISO-8601 strings in UTC. Firestore has a native timestamp type,
but strings round-trip through JSON unchanged and sort correctly as text, which
removes a whole class of "why is this date off by five hours" bugs.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Protocol

Doc = dict[str, Any]


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Repo(Protocol):
    # trials
    def create_trial(self, doc: Doc) -> Doc: ...
    def get_trial(self, trial_id: str) -> Doc | None: ...
    def list_trials(self) -> list[Doc]: ...
    def trial_exists(self, trial_id: str) -> bool: ...

    # flights
    def create_flight(self, doc: Doc) -> Doc: ...
    def get_flight(self, flight_id: str) -> Doc | None: ...
    def list_flights(self, trial_id: str) -> list[Doc]:
        """Newest first."""

    def describe(self) -> str: ...


# ---------------------------------------------------------------------------
# in-memory (tests / no credentials)
# ---------------------------------------------------------------------------
class MemoryRepo:
    def __init__(self):
        self._trials: dict[str, Doc] = {}
        self._flights: dict[str, Doc] = {}

    def create_trial(self, doc: Doc) -> Doc:
        self._trials[doc["id"]] = dict(doc)
        return dict(doc)

    def get_trial(self, trial_id: str) -> Doc | None:
        doc = self._trials.get(trial_id)
        return dict(doc) if doc else None

    def list_trials(self) -> list[Doc]:
        return sorted((dict(d) for d in self._trials.values()), key=lambda d: d["createdAt"], reverse=True)

    def trial_exists(self, trial_id: str) -> bool:
        return trial_id in self._trials

    def create_flight(self, doc: Doc) -> Doc:
        self._flights[doc["id"]] = dict(doc)
        return dict(doc)

    def get_flight(self, flight_id: str) -> Doc | None:
        doc = self._flights.get(flight_id)
        return dict(doc) if doc else None

    def list_flights(self, trial_id: str) -> list[Doc]:
        rows = [dict(d) for d in self._flights.values() if d["trialId"] == trial_id]
        return sorted(rows, key=lambda d: (d["flightDate"], d["createdAt"]), reverse=True)

    def describe(self) -> str:
        return "memory"


# ---------------------------------------------------------------------------
# Firestore
# ---------------------------------------------------------------------------
class FirestoreRepo:
    TRIALS = "trials"
    FLIGHTS = "flights"

    def __init__(self, project: str | None = None, database: str = "(default)"):
        from google.cloud import firestore

        # Application Default Credentials again — see storage.py.
        self._db = firestore.Client(project=project, database=database)
        self._database = database

    # -- trials ---------------------------------------------------------------
    def create_trial(self, doc: Doc) -> Doc:
        # `.document(id).set(doc)` chooses the id ourselves (a readable slug).
        # `.add(doc)` would have Firestore mint a random id instead.
        self._db.collection(self.TRIALS).document(doc["id"]).set(doc)
        return doc

    def get_trial(self, trial_id: str) -> Doc | None:
        snap = self._db.collection(self.TRIALS).document(trial_id).get()
        return snap.to_dict() if snap.exists else None

    def list_trials(self) -> list[Doc]:
        rows = [s.to_dict() for s in self._db.collection(self.TRIALS).stream()]
        return sorted(rows, key=lambda d: d.get("createdAt", ""), reverse=True)

    def trial_exists(self, trial_id: str) -> bool:
        return self._db.collection(self.TRIALS).document(trial_id).get().exists

    # -- flights --------------------------------------------------------------
    def create_flight(self, doc: Doc) -> Doc:
        self._db.collection(self.FLIGHTS).document(doc["id"]).set(doc)
        return doc

    def get_flight(self, flight_id: str) -> Doc | None:
        snap = self._db.collection(self.FLIGHTS).document(flight_id).get()
        return snap.to_dict() if snap.exists else None

    def list_flights(self, trial_id: str) -> list[Doc]:
        from google.cloud.firestore_v1 import FieldFilter

        query = self._db.collection(self.FLIGHTS).where(filter=FieldFilter("trialId", "==", trial_id))
        rows = [s.to_dict() for s in query.stream()]
        return sorted(rows, key=lambda d: (d.get("flightDate", ""), d.get("createdAt", "")), reverse=True)

    def describe(self) -> str:
        return f"firestore:{self._database}"
