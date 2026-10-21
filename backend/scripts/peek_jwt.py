"""
Show what's inside a JWT — WITHOUT verifying it.

    python3 scripts/peek_jwt.py "$ID_TOKEN"

A JWT is three base64url chunks joined by dots: header.payload.signature. The
first two are plain JSON that anyone holding the token can read — which is why
a token must never carry a secret. The signature is what makes the claims
believable, and checking it is the API's job (app/auth.py), not this script's.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import sys


def decode_part(segment: str) -> dict:
    segment += "=" * (-len(segment) % 4)  # base64url drops its padding; put it back
    return json.loads(base64.urlsafe_b64decode(segment))


def main() -> None:
    token = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError:
        sys.exit("That isn't a JWT: expected three dot-separated parts.")

    header, payload = decode_part(header_b64), decode_part(payload_b64)
    print("HEADER")
    print(json.dumps(header, indent=2))
    print("\nPAYLOAD")
    print(json.dumps(payload, indent=2))
    print("\nTIMES (UTC)")
    for claim in ("auth_time", "iat", "exp"):
        if claim in payload:
            when = dt.datetime.fromtimestamp(payload[claim], dt.timezone.utc)
            print(f"  {claim:<9} {when:%Y-%m-%d %H:%M:%S}")
    print(f"\nSIGNATURE  {len(signature_b64)} base64url characters, not checked here")


if __name__ == "__main__":
    main()
