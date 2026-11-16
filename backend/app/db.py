"""
Records — where the *metadata* lives.

Same idea as storage.py: the routers talk to a `Repo` with a handful of
methods; Firestore is one implementation, an in-memory dict is the other.

Every record belongs to an account
----------------------------------
Each trial and flight carries the `accountId` of the account that owns it, and
every method a router uses takes the caller's account and only ever returns
that account's records. Another account's trial is indistinguishable from one
that doesn't exist: the routers answer 404 for both.

Firestore layout
----------------
    trials/{accountId}:{trialId}   one document per trial
    flights/{flightId}             one document per flight

A trial's id (`guadeloupe-yam-2026`, minted from its name) only has to be
unique within its account, so the account is part of the document id. Two
accounts can both have a `guadeloupe-yam-2026`, neither learns about the other,
and reading a trial by id can't reach another account's document even if a
check were forgotten. Flight ids are random (`flt_…`), so flights keep their
own id; they carry `accountId`, `trialId`, and `trialKey` — the trial's
document id — which is what a trial's flights are queried by.

Flights are a *top-level* collection rather than a subcollection under each
trial. Firestore can do either; the difference is what you can query later. A
background worker will eventually want "every flight with status == queued,
across all trials" — trivial on a top-level collection, awkward on
subcollections (collection-group queries need their own indexes).

Every query is a single equality filter, which Firestore serves from its
automatic single-field indexes. Sorting is done in Python after the fetch:
`where trialKey == X` + `order by createdAt` would be a *composite* query, and
Firestore refuses those until you create a matching index. For a few hundred
flights per trial, sorting in memory costs nothing and can't break.

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


def trial_key(account_id: str, trial_id: str) -> str:
    """A trial's document id: its account and its id. Account ids are letters,
    digits, `-` and `_` (app.auth.account_id_for), so the colon is unambiguous."""
    return f"{account_id}:{trial_id}"


class Repo(Protocol):
    # trials — a trial doc carries `id` and `accountId`
    def create_trial(self, doc: Doc) -> Doc: ...
    def get_trial(self, account_id: str, trial_id: str) -> Doc | None: ...
    def list_trials(self, account_id: str) -> list[Doc]: ...
    def trial_exists(self, account_id: str, trial_id: str) -> bool: ...

    # flights — a flight doc carries `id`, `accountId`, `trialId`, `trialKey`
    def create_flight(self, doc: Doc) -> Doc: ...
    def get_flight(self, account_id: str, flight_id: str) -> Doc | None:
        """None when the flight doesn't exist *or* belongs to another account."""

    def list_flights(self, account_id: str, trial_id: str) -> list[Doc]:
        """Newest first."""

    def update_flight(self, flight_id: str, fields: Doc) -> None:
        """Replace the given top-level fields, leave the rest of the document alone."""

    def transition_flight(self, flight_id: str, from_status: str, fields: Doc) -> bool:
        """Apply `fields` only if the flight's status is still `from_status`, atomically.
        False if it has moved on — so of two racing requests, exactly one wins."""

    def delete_flight(self, flight_id: str) -> None: ...

    def get_flight_unscoped(self, flight_id: str) -> Doc | None:
        """For jobs only: they are handed a flight id by the API, not by a user."""

    # results — one per processing run, never overwritten. A result doc carries
    # `id` ("{flightId}:v{version}"), `flightId`, `accountId` and `version`, and
    # is only ever reached through its flight, which is account-scoped.
    def create_result(self, doc: Doc) -> Doc: ...
    def get_result(self, result_id: str) -> Doc | None: ...
    def list_results(self, flight_id: str) -> list[Doc]:
        """Newest version first."""

    def describe(self) -> str: ...


# ---------------------------------------------------------------------------
# in-memory (tests / no credentials)
# ---------------------------------------------------------------------------
class MemoryRepo:
    def __init__(self):
        self._trials: dict[str, Doc] = {}  # by trial_key
        self._flights: dict[str, Doc] = {}
        self._results: dict[str, Doc] = {}

    def create_trial(self, doc: Doc) -> Doc:
        self._trials[trial_key(doc["accountId"], doc["id"])] = dict(doc)
        return dict(doc)

    def get_trial(self, account_id: str, trial_id: str) -> Doc | None:
        doc = self._trials.get(trial_key(account_id, trial_id))
        return dict(doc) if doc else None

    def list_trials(self, account_id: str) -> list[Doc]:
        rows = [dict(d) for d in self._trials.values() if d["accountId"] == account_id]
        return sorted(rows, key=lambda d: d["createdAt"], reverse=True)

    def trial_exists(self, account_id: str, trial_id: str) -> bool:
        return trial_key(account_id, trial_id) in self._trials

    def create_flight(self, doc: Doc) -> Doc:
        self._flights[doc["id"]] = dict(doc)
        return dict(doc)

    def get_flight(self, account_id: str, flight_id: str) -> Doc | None:
        doc = self._flights.get(flight_id)
        return dict(doc) if doc and doc.get("accountId") == account_id else None

    def list_flights(self, account_id: str, trial_id: str) -> list[Doc]:
        key = trial_key(account_id, trial_id)
        rows = [dict(d) for d in self._flights.values() if d.get("trialKey") == key]
        return sorted(rows, key=lambda d: (d["flightDate"], d["createdAt"]), reverse=True)

    def update_flight(self, flight_id: str, fields: Doc) -> None:
        self._flights[flight_id].update(fields)

    def transition_flight(self, flight_id: str, from_status: str, fields: Doc) -> bool:
        doc = self._flights.get(flight_id)
        if not doc or doc.get("status") != from_status:
            return False
        doc.update(fields)
        return True

    def delete_flight(self, flight_id: str) -> None:
        self._flights.pop(flight_id, None)

    def get_flight_unscoped(self, flight_id: str) -> Doc | None:
        doc = self._flights.get(flight_id)
        return dict(doc) if doc else None

    def create_result(self, doc: Doc) -> Doc:
        self._results[doc["id"]] = dict(doc)
        return doc

    def get_result(self, result_id: str) -> Doc | None:
        doc = self._results.get(result_id)
        return dict(doc) if doc else None

    def list_results(self, flight_id: str) -> list[Doc]:
        rows = [dict(d) for d in self._results.values() if d.get("flightId") == flight_id]
        return sorted(rows, key=lambda d: d.get("version", 0), reverse=True)

    def describe(self) -> str:
        return "memory"


# ---------------------------------------------------------------------------
# Firestore
# ---------------------------------------------------------------------------
class FirestoreRepo:
    TRIALS = "trials"
    FLIGHTS = "flights"
    RESULTS = "results"

    def __init__(self, project: str | None = None, database: str = "(default)"):
        from google.cloud import firestore

        # Application Default Credentials again — see storage.py.
        self._db = firestore.Client(project=project, database=database)
        self._database = database

    def _where(self, collection: str, field: str, value: str):
        from google.cloud.firestore_v1 import FieldFilter

        return self._db.collection(collection).where(filter=FieldFilter(field, "==", value))

    # -- trials ---------------------------------------------------------------
    def create_trial(self, doc: Doc) -> Doc:
        # `.document(id).set(doc)` chooses the id ourselves (account + slug).
        # `.add(doc)` would have Firestore mint a random id instead.
        self._db.collection(self.TRIALS).document(trial_key(doc["accountId"], doc["id"])).set(doc)
        return doc

    def get_trial(self, account_id: str, trial_id: str) -> Doc | None:
        snap = self._db.collection(self.TRIALS).document(trial_key(account_id, trial_id)).get()
        return snap.to_dict() if snap.exists else None

    def list_trials(self, account_id: str) -> list[Doc]:
        rows = [s.to_dict() for s in self._where(self.TRIALS, "accountId", account_id).stream()]
        return sorted(rows, key=lambda d: d.get("createdAt", ""), reverse=True)

    def trial_exists(self, account_id: str, trial_id: str) -> bool:
        return self._db.collection(self.TRIALS).document(trial_key(account_id, trial_id)).get().exists

    # -- flights --------------------------------------------------------------
    def create_flight(self, doc: Doc) -> Doc:
        self._db.collection(self.FLIGHTS).document(doc["id"]).set(doc)
        return doc

    def get_flight(self, account_id: str, flight_id: str) -> Doc | None:
        doc = self.get_flight_unscoped(flight_id)
        return doc if doc and doc.get("accountId") == account_id else None

    def list_flights(self, account_id: str, trial_id: str) -> list[Doc]:
        rows = [s.to_dict() for s in self._where(self.FLIGHTS, "trialKey", trial_key(account_id, trial_id)).stream()]
        return sorted(rows, key=lambda d: (d.get("flightDate", ""), d.get("createdAt", "")), reverse=True)

    def update_flight(self, flight_id: str, fields: Doc) -> None:
        # `update` replaces each named field whole (a map value included) and
        # fails if the document is missing — never a half-written new flight.
        self._db.collection(self.FLIGHTS).document(flight_id).update(fields)

    def transition_flight(self, flight_id: str, from_status: str, fields: Doc) -> bool:
        from google.cloud import firestore

        ref = self._db.collection(self.FLIGHTS).document(flight_id)

        # A transaction re-runs if the document changes under it, so the status
        # read and the write that depends on it can't interleave with another's.
        @firestore.transactional
        def apply(transaction) -> bool:
            snap = ref.get(transaction=transaction)
            if not snap.exists or (snap.to_dict() or {}).get("status") != from_status:
                return False
            transaction.update(ref, fields)
            return True

        return apply(self._db.transaction())

    def delete_flight(self, flight_id: str) -> None:
        self._db.collection(self.FLIGHTS).document(flight_id).delete()

    def get_flight_unscoped(self, flight_id: str) -> Doc | None:
        snap = self._db.collection(self.FLIGHTS).document(flight_id).get()
        return snap.to_dict() if snap.exists else None

    # -- results --------------------------------------------------------------
    def create_result(self, doc: Doc) -> Doc:
        self._db.collection(self.RESULTS).document(doc["id"]).set(doc)
        return doc

    def get_result(self, result_id: str) -> Doc | None:
        snap = self._db.collection(self.RESULTS).document(result_id).get()
        return snap.to_dict() if snap.exists else None

    def list_results(self, flight_id: str) -> list[Doc]:
        # One equality filter, so no composite index; sorted here.
        rows = [s.to_dict() for s in self._where(self.RESULTS, "flightId", flight_id).stream()]
        return sorted(rows, key=lambda d: d.get("version", 0), reverse=True)

    def describe(self) -> str:
        return f"firestore:{self._database}"
