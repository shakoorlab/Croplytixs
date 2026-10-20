"""
Who is calling? — the API's half of sign-in.

The browser signs in to Identity Platform (Firebase Auth) and gets back an
**ID token**: a JWT that Google signs, saying "this is user <sub>, signed in to
project <aud>, valid until <exp>". The browser sends it on every request:

    Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6...

This module turns that header into a `User` — or refuses the request:

    no token, or not a Bearer token        → 401
    token not genuine, or not for us       → 401
    token genuine but expired              → 401 that says so (the browser refreshes and retries)
    Google's public keys unreachable       → 503 (our outage, not the caller's fault)
    all good                               → User(uid, email)

Every 401 carries `WWW-Authenticate: Bearer` — RFC 6750's way of telling a
client *how* to authenticate, not just that it failed.

Two layers, the same shape as storage.py and db.py:

    GoogleTokenVerifier   "Is this token genuine, and what does it say?"
                          Checks the signature against Google's published keys and
                          the claims against the rules Google documents. Knows
                          nothing about HTTP. Tests hand it their own key.
    current_user          "Turn this request into a User, or refuse it."
                          The FastAPI dependency every protected route runs before
                          its handler. Knows HTTP; knows nothing about keys or JWTs.

Why not the Firebase Admin SDK's verify_id_token()? It runs the same checks but
insists on Google credentials even just to verify — it raised
DefaultCredentialsError on a garbage token when no credentials were around —
which would drag a credential into every test and every laptop run. The checks
here are the list Google publishes for "verify ID tokens using a third-party JWT
library": https://firebase.google.com/docs/auth/admin/verify-id-tokens
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .settings import settings

log = logging.getLogger(__name__)

# Google publishes the public halves of the keys that sign ID tokens here, as a
# JWK Set. They rotate every few days; each token's header names its key (`kid`).
GOOGLE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"

# Fetch that key set about once an hour per process, not once per request. A
# `kid` the cache has never seen (right after a rotation) triggers one refetch.
KEYS_CACHE_SECONDS = 3600

# Google's clocks and ours can disagree by a few seconds. Without some slack, a
# token minted "now" by a clock 2 s ahead of ours would look issued in the future.
CLOCK_SKEW_SECONDS = 10

# Every claim in Google's list must be present. A token missing one is invalid.
REQUIRED_CLAIMS = ["exp", "iat", "aud", "iss", "sub", "auth_time"]

Claims = dict[str, Any]


@dataclass(frozen=True)
class User:
    """Who the API is acting for. `uid` is the stable identity; an email can change."""

    uid: str
    email: str | None = None


# ---- what a verifier can say besides "genuine" ---------------------------------
class TokenExpired(Exception):
    """Genuine, but past its `exp`. The browser should get a fresh one and retry."""


class TokenInvalid(Exception):
    """Anything else: malformed, unknown key, bad signature, wrong project, bad claims."""


class VerifierUnavailable(Exception):
    """We couldn't check the token at all — Google's keys were unreachable."""


class KeySource(Protocol):
    """Finds the public key that should have signed a token: `jwt.PyJWKClient`
    in production, a single throwaway key in the tests."""

    def get_signing_key_from_jwt(self, token: str) -> Any:  # has `.key`
        ...


class TokenVerifier(Protocol):
    def verify(self, token: str) -> Claims: ...

    def describe(self) -> str: ...


class GoogleTokenVerifier:
    def __init__(self, project_id: str, keys: KeySource | None = None):
        self.project_id = project_id
        self.issuer = f"https://securetoken.google.com/{project_id}"
        self._keys = keys or jwt.PyJWKClient(GOOGLE_JWKS_URL, cache_keys=True, lifespan=KEYS_CACHE_SECONDS)

    def describe(self) -> str:
        return f"identity-platform:{self.project_id}"

    def verify(self, token: str) -> Claims:
        """Return the token's claims if it is a genuine, current ID token for this
        project. Otherwise raise one of:

            TokenExpired          the only thing wrong is that `exp` has passed
            TokenInvalid          anything else wrong with the token
            VerifierUnavailable   Google's keys couldn't be fetched

        Two stages:

          1. Which key?  `self._keys.get_signing_key_from_jwt(token)` reads the
             token's `kid` and returns the matching public key as `.key`.
          2. Genuine, current, and ours?  `jwt.decode(...)` checks the signature
             and the standard claims. PyJWT covers most of Google's list, but not
             all of it — compare, and the tests will show you what's left.

        Nothing from `jwt` may escape this method: translate its exceptions into
        the three above.
        """
        # TODO(Jake): step 2a
        raise NotImplementedError("app/auth.py: GoogleTokenVerifier.verify")


@lru_cache(maxsize=1)
def get_verifier() -> TokenVerifier:
    """One verifier per process, so every request shares its key cache."""
    project = settings.AUTH_PROJECT_ID or settings.GCP_PROJECT
    if not project:
        raise RuntimeError("Set AUTH_PROJECT_ID (or GCP_PROJECT): the API must know which project's sign-ins to trust.")
    return GoogleTokenVerifier(project)


# HTTPBearer pulls "Bearer <token>" out of the Authorization header (the scheme
# is matched case-insensitively) and gives /docs an "Authorize" button.
# auto_error=False: hand us None instead of raising, so the 401 is ours to shape.
bearer = HTTPBearer(auto_error=False, description="Identity Platform ID token")


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    verifier: TokenVerifier = Depends(get_verifier),
) -> User:
    """The dependency every protected route runs before its handler.

    `credentials` is None when there is no usable "Bearer <token>" header;
    otherwise `credentials.credentials` is the token itself.

    Refuse with an HTTPException (401 or 503, see the module docstring), or
    return the User the token names. The user id is the `sub` claim.
    """
    # TODO(Jake): step 2b
    raise NotImplementedError("app/auth.py: current_user")
