from scripts.assign_account import plan

OLD_TRIAL = ("guadeloupe-yam-2026", {"id": "guadeloupe-yam-2026", "name": "Guadeloupe Yam", "createdAt": "2026-10-01"})
OLD_FLIGHT = ("flt_1", {"id": "flt_1", "trialId": "guadeloupe-yam-2026"})


def test_unowned_trials_move_to_the_accounts_document_id():
    [change] = plan([OLD_TRIAL], [], "acct1")
    assert change.kind == "move-trial"
    assert (change.doc_id, change.new_id) == ("guadeloupe-yam-2026", "acct1:guadeloupe-yam-2026")
    assert change.fields == {**OLD_TRIAL[1], "accountId": "acct1"}


def test_unowned_flights_get_the_account_and_their_trials_key():
    [change] = plan([], [OLD_FLIGHT], "acct1")
    assert change.kind == "update-flight"
    assert change.fields == {"accountId": "acct1", "trialKey": "acct1:guadeloupe-yam-2026"}


def test_owned_records_are_left_alone_so_it_can_run_twice():
    owned_trial = ("acct1:x", {"id": "x", "accountId": "acct1"})
    owned_flight = ("flt_2", {"id": "flt_2", "trialId": "x", "accountId": "acct1"})
    assert plan([owned_trial], [owned_flight], "acct1") == []


def test_a_trial_the_account_already_has_is_skipped_not_overwritten():
    taken = ("acct1:guadeloupe-yam-2026", {"id": "guadeloupe-yam-2026", "accountId": "acct1"})
    changes = plan([OLD_TRIAL, taken], [], "acct1")
    assert [c.kind for c in changes] == ["skip-trial"]
