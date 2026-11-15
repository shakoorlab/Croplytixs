"""
Gives trials and flights made before accounts an owner.

Records written before accounts existed carry no `accountId`. The API now
shows each signed-in user only their own account's records (app/db.py), so
those records are invisible to everyone until they are assigned. This script
assigns every one of them to a single account:

  * each trial gets `accountId` and moves to its new document id,
    `{accountId}:{trialId}` — Firestore can't rename a document, so the new
    one is written and the old one deleted, together, in one batch;
  * each flight gets `accountId` and `trialKey`.

Files stay where they are. Each flight records its files' object keys, so the
old `trials/…` keys keep working next to the new `accounts/…` ones.

Run it from backend/ with Application Default Credentials for the project
(`gcloud auth application-default login`):

    python -m scripts.assign_account --project not-croplytixs --uid USER_UID           # what it would do
    python -m scripts.assign_account --project not-croplytixs --uid USER_UID --apply   # do it

USER_UID is in the Identity Platform console (Users → User UID). Running it
again is safe: records that already have an owner are left alone.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from typing import Any

from app.auth import account_id_for
from app.db import trial_key

Doc = dict[str, Any]


@dataclass
class Change:
    kind: str  # "move-trial", "update-flight" or "skip-trial"
    doc_id: str
    new_id: str | None = None
    fields: Doc = field(default_factory=dict)
    note: str = ""


def plan(trials: list[tuple[str, Doc]], flights: list[tuple[str, Doc]], account: str) -> list[Change]:
    """(document id, data) pairs in, the changes to make out. Pure, so it is
    tested without Firestore."""
    changes: list[Change] = []
    existing = {doc_id for doc_id, _ in trials}
    for doc_id, data in trials:
        if data.get("accountId"):
            continue
        new_id = trial_key(account, data.get("id") or doc_id)
        if new_id in existing:
            changes.append(Change("skip-trial", doc_id, note=f"the account already has a trial {new_id}"))
            continue
        changes.append(Change("move-trial", doc_id, new_id, {**data, "id": data.get("id") or doc_id, "accountId": account}))
    for doc_id, data in flights:
        if data.get("accountId"):
            continue
        changes.append(Change("update-flight", doc_id, fields={"accountId": account, "trialKey": trial_key(account, data["trialId"])}))
    return changes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Assign trials and flights that have no owner to one account.")
    parser.add_argument("--uid", required=True, help="the Identity Platform user id of the owner")
    parser.add_argument("--project", help="Google Cloud project (default: from Application Default Credentials)")
    parser.add_argument("--database", default="(default)")
    parser.add_argument("--apply", action="store_true", help="make the changes (without it, only show them)")
    args = parser.parse_args(argv)

    from google.cloud import firestore

    db = firestore.Client(project=args.project, database=args.database)
    account = account_id_for(args.uid)
    trials = [(s.id, s.to_dict() or {}) for s in db.collection("trials").stream()]
    flights = [(s.id, s.to_dict() or {}) for s in db.collection("flights").stream()]
    changes = plan(trials, flights, account)

    print(f"Account {account}: {len(trials)} trials and {len(flights)} flights in {db.project}/{args.database}.")
    for c in changes:
        if c.kind == "move-trial":
            print(f"  trial   {c.doc_id} → {c.new_id}")
        elif c.kind == "update-flight":
            print(f"  flight  {c.doc_id} → account {account}, trial {c.fields['trialKey']}")
        else:
            print(f"  skipped {c.doc_id}: {c.note}")
    if not changes:
        print("Nothing to do: every record has an owner.")
        return 0
    if not args.apply:
        print("Dry run. Add --apply to make these changes.")
        return 0

    for c in changes:
        if c.kind == "move-trial":
            batch = db.batch()
            batch.set(db.collection("trials").document(c.new_id), c.fields)
            batch.delete(db.collection("trials").document(c.doc_id))
            batch.commit()
    updates = [c for c in changes if c.kind == "update-flight"]
    for start in range(0, len(updates), 400):  # a batch takes at most 500 writes
        batch = db.batch()
        for c in updates[start : start + 400]:
            batch.update(db.collection("flights").document(c.doc_id), c.fields)
        batch.commit()
    print(f"Done: {sum(c.kind == 'move-trial' for c in changes)} trials and {len(updates)} flights assigned.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
