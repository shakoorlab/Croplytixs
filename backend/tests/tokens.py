"""
Test-only token factory: real RS256 JWTs, signed with a key made for this test
run. The verifier under test is the real GoogleTokenVerifier — only its key
source is swapped for FakeKeySource — so the signature and claim checks the
tests exercise are the same code that runs on Cloud Run.
"""

from __future__ import annotations

import time
from types import SimpleNamespace

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

PROJECT = "test-project"
KID = "test-kid"

_signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUBLIC_KEY = _signing_key.public_key()

# Someone else's key: signatures made with it must never verify.
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)

DROP = object()  # claims(sub=DROP) leaves the claim out entirely


def claims(**overrides) -> dict:
    """What Identity Platform puts in an ID token for an email/password user."""
    now = int(time.time())
    base = {
        "iss": f"https://securetoken.google.com/{PROJECT}",
        "aud": PROJECT,
        "auth_time": now,
        "user_id": "uid-jake",
        "sub": "uid-jake",
        "iat": now,
        "exp": now + 3600,
        "email": "jake@example.com",
        "email_verified": False,
        "firebase": {"identities": {"email": ["jake@example.com"]}, "sign_in_provider": "password"},
    }
    base.update(overrides)
    return {name: value for name, value in base.items() if value is not DROP}


def mint(*, key=None, kid: str = KID, **overrides) -> str:
    """A signed ID token. Override any claim: mint(aud="other"), mint(sub=DROP)."""
    return jwt.encode(claims(**overrides), key or _signing_key, algorithm="RS256", headers={"kid": kid})


def ago(seconds: int) -> int:
    return int(time.time()) - seconds


def ahead(seconds: int) -> int:
    return int(time.time()) + seconds


class FakeKeySource:
    """Stands in for jwt.PyJWKClient: it knows exactly one key, KID."""

    def __init__(self):
        self.down = False  # flip to simulate Google's key endpoint being unreachable

    def get_signing_key_from_jwt(self, token: str):
        if self.down:
            raise jwt.PyJWKClientConnectionError("Fail to fetch data from the url")
        kid = jwt.get_unverified_header(token).get("kid")  # DecodeError on garbage, like the real client
        if kid != KID:
            raise jwt.PyJWKClientError(f'Unable to find a signing key that matches: "{kid}"')
        return SimpleNamespace(key=PUBLIC_KEY)
