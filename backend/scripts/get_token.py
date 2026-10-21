"""
Sign in to Identity Platform the way the browser will, and print the ID token.

    export FIREBASE_API_KEY=AIza...      # Identity Platform → Providers → Application setup details
    export ID_TOKEN=$(python3 scripts/get_token.py you@example.com)

The password is read without echoing, so it never lands in your shell history.
The token goes to stdout (so `$(...)` captures it); everything else to stderr.
Tokens last an hour: run it again when the API starts saying "expired".

Under the hood it is one HTTPS POST — the same call the Firebase JS SDK makes:

    POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=API_KEY
    {"email": "...", "password": "...", "returnSecureToken": true}

Standard library only, so it runs with any python3.
"""

from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.request

SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={key}"


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/get_token.py EMAIL   (with FIREBASE_API_KEY exported)")
    key = os.environ.get("FIREBASE_API_KEY")
    if not key:
        sys.exit("Export FIREBASE_API_KEY first (Identity Platform → Providers → Application setup details).")

    email = sys.argv[1]
    password = getpass.getpass(f"Password for {email}: ")
    request = urllib.request.Request(
        SIGN_IN_URL.format(key=key),
        data=json.dumps({"email": email, "password": password, "returnSecureToken": True}).encode(),
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.load(response)
    except urllib.error.HTTPError as err:
        message = json.load(err).get("error", {}).get("message", err.reason)
        sys.exit(f"Identity Platform refused the sign-in: {message}")

    print(f"signed in as {body['email']} (uid {body['localId']}); token valid for {body['expiresIn']} s", file=sys.stderr)
    print(body["idToken"])


if __name__ == "__main__":
    main()
