"""
Review decisions — a person's Accept or Reject on a plot's measurement.

A result version is never changed (app/process.py), so a decision is stored
beside it, not in it: one record per plot of a flight (`decisions/{flightId}:{plotId}`
in Firestore), holding the latest decision and a short history of earlier ones.
Reading a result merges the decisions in: an accepted or rejected plot's `qc`
says so, and the summary's counts (`pending`, `accepted`, `rejected`) follow.

A decision is made on a version, about the numbers that version measured. It
carries over to a later version only while that version measures the plot the
same: a rerun that reuses the canopy map (to add plot boxes, say) keeps every
decision, while a nudged grid or another model brings the plot back for review,
with the earlier decision shown as `stale`. A human decision is never applied
to numbers it didn't see.

`rejected` keeps a plot out of the trait series (frontend/src/api/traits.js) and
is marked in the CSV; `accepted` confirms the model's number. Neither changes
the number itself: correcting the canopy is a later step, and makes a new
version.
"""

from __future__ import annotations

from urllib.parse import quote

DECISIONS = ("accepted", "rejected")
HISTORY_LIMIT = 20


def decision_id(flight_id: str, plot_id: str) -> str:
    """The record's id. Plot ids come from the user's shapefile, so they are
    escaped: Firestore ids can't hold a slash."""
    return f"{flight_id}:{quote(plot_id, safe='')}"


def measured(plot: dict) -> dict:
    """What a decision was about: the numbers a reviewer saw."""
    return {"areaCm2": plot.get("areaCm2"), "cover": plot.get("cover")}


def applies(record: dict | None, plot: dict, version: int) -> bool:
    """Whether a stored decision stands for this plot in this version."""
    if not record or record.get("decision") not in DECISIONS:
        return False
    return record.get("version") == version or record.get("measured") == measured(plot)


def merge(plots: list[dict], records: list[dict], version: int) -> list[dict]:
    """The plots of one version with their decisions: `qc` is `accepted` or
    `rejected` where a decision stands, the model's `pending` or `passed`
    otherwise; `decision` says who decided what, when, and whether it is stale."""
    by_plot = {r["plotId"]: r for r in records if r.get("decision") in DECISIONS}
    out = []
    for plot in plots:
        record = by_plot.get(plot["plotId"])
        merged = {**plot, "decision": None}
        if record:
            stands = applies(record, plot, version)
            merged["decision"] = {
                "decision": record["decision"],
                "version": record.get("version"),
                "by": record.get("by"),
                "at": record.get("at"),
                "note": record.get("note"),
                "stale": not stands,
            }
            if stands:
                merged["qc"] = record["decision"]
        out.append(merged)
    return out


def summarize(summary: dict, plots: list[dict]) -> dict:
    """The model's summary with the review counts recounted from merged plots."""
    pending = [p for p in plots if p.get("qc") == "pending"]
    accepted = sum(1 for p in plots if p.get("qc") == "accepted")
    rejected = sum(1 for p in plots if p.get("qc") == "rejected")
    return {
        **summary,
        "pending": len(pending),
        "pendingFlags": sum(1 for p in pending if p.get("flag")),
        "accepted": accepted,
        "rejected": rejected,
        "reviewed": accepted + rejected,
        "edited": 0,
        "audit": 0,
    }


def record(existing: dict | None, *, flight: dict, plot: dict, version: int, decision: str | None, note: str | None, by: str, at: str) -> dict:
    """The new record for a plot: this decision (None clears it), with what it
    replaced pushed onto the history."""
    history = list((existing or {}).get("history") or [])
    if existing and existing.get("decision"):
        history.insert(0, {k: existing.get(k) for k in ("decision", "version", "by", "at", "note")})
    return {
        "id": decision_id(flight["id"], plot["plotId"]),
        "flightId": flight["id"],
        "accountId": flight["accountId"],
        "trialId": flight["trialId"],
        "trialKey": flight.get("trialKey"),
        "plotId": plot["plotId"],
        "decision": decision,
        "version": version,
        "measured": measured(plot),
        "note": note,
        "by": by,
        "at": at,
        "history": history[:HISTORY_LIMIT],
    }
