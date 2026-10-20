"""
What the API must do with sign-in tokens — written before app/auth.py was
finished, as its specification. Make these pass.

Part 1 checks GoogleTokenVerifier on its own: every rule on Google's list, plus
the two classic JWT attacks. Part 2 checks current_user through HTTP, the way a
browser meets it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from fastapi.routing import APIRoute

from app.auth import GoogleTokenVerifier, TokenExpired, TokenInvalid, VerifierUnavailable, current_user
from app.main import app
from tests.tokens import DROP, KID, OTHER_KEY, PROJECT, PUBLIC_KEY, ago, ahead, claims, mint


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unsigned_token() -> str:
    """alg "none": a token that says "trust me" and carries no signature."""
    header = _b64(json.dumps({"alg": "none", "typ": "JWT", "kid": KID}).encode())
    return f"{header}.{_b64(json.dumps(claims()).encode())}."


def hmac_with_public_key_token() -> str:
    """Algorithm confusion: sign with HS256, using the *public* key as the HMAC
    secret. A verifier that trusts the token's own `alg` would check an HMAC with
    that same public key — which anyone can download — and accept a forgery."""
    secret = PUBLIC_KEY.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    signing_input = f"{_b64(json.dumps({'alg': 'HS256', 'typ': 'JWT', 'kid': KID}).encode())}.{_b64(json.dumps(claims()).encode())}"
    signature = hmac.new(secret, signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64(signature)}"


def tampered_token() -> str:
    """A genuine token whose payload was edited afterwards to name another user."""
    header, _, signature = mint().split(".")
    return f"{header}.{_b64(json.dumps(claims(sub='uid-admin', user_id='uid-admin')).encode())}.{signature}"


# ==============================================================================
# Part 1 — the verifier
# ==============================================================================
@pytest.fixture
def verifier(keys) -> GoogleTokenVerifier:
    return GoogleTokenVerifier(PROJECT, keys=keys)


def test_genuine_token_returns_its_claims(verifier):
    got = verifier.verify(mint())
    assert got["sub"] == "uid-jake"
    assert got["email"] == "jake@example.com"


def test_expired_token_is_expired_not_invalid(verifier):
    with pytest.raises(TokenExpired):
        verifier.verify(mint(auth_time=ago(7200), iat=ago(7200), exp=ago(3600)))


REJECTED = {
    "signed with someone else's key": lambda: mint(key=OTHER_KEY),
    "names a key Google never published": lambda: mint(kid="not-a-google-key"),
    "minted for another project (aud)": lambda: mint(aud="someone-elses-project"),
    "issued by someone else (iss)": lambda: mint(iss="https://securetoken.google.com/someone-elses-project"),
    "issued in the future (iat)": lambda: mint(iat=ahead(600)),
    "no subject (sub)": lambda: mint(sub=DROP),
    "empty subject (sub)": lambda: mint(sub=""),
    "no sign-in time (auth_time)": lambda: mint(auth_time=DROP),
    "signed in in the future (auth_time)": lambda: mint(auth_time=ahead(600)),
    "no expiry (exp)": lambda: mint(exp=DROP),
    "payload edited after signing": tampered_token,
    'unsigned, alg "none"': unsigned_token,
    "HMAC signed with the public key": hmac_with_public_key_token,
    "not a JWT at all": lambda: "not-a-jwt",
}


@pytest.mark.parametrize("make_token", REJECTED.values(), ids=REJECTED.keys())
def test_rejected(verifier, make_token):
    with pytest.raises(TokenInvalid):
        verifier.verify(make_token())


def test_unreachable_keys_mean_unavailable_not_invalid(verifier, keys):
    keys.down = True
    with pytest.raises(VerifierUnavailable):
        verifier.verify(mint())


# ==============================================================================
# Part 2 — through HTTP, the way a browser meets it
# ==============================================================================
def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_signed_in_request_knows_who_you_are(browser):
    r = browser.get("/api/me", headers=bearer(mint()))
    assert r.status_code == 200, r.text
    assert r.json() == {"uid": "uid-jake", "email": "jake@example.com"}


NO_USABLE_TOKEN = {
    "no header": {},
    "wrong scheme": {"Authorization": "Basic amFrZTpodW50ZXIy"},
    "scheme, no token": {"Authorization": "Bearer"},
    "not a JWT": {"Authorization": "Bearer not-a-jwt"},
}


@pytest.mark.parametrize("headers", NO_USABLE_TOKEN.values(), ids=NO_USABLE_TOKEN.keys())
def test_no_usable_token_is_401_with_a_challenge(browser, headers):
    r = browser.get("/api/trials", headers=headers)
    assert r.status_code == 401, r.text
    assert r.headers.get("www-authenticate") == "Bearer"


def test_scheme_is_case_insensitive(browser):
    assert browser.get("/api/me", headers={"Authorization": f"bearer {mint()}"}).status_code == 200


def test_expired_token_is_401_that_says_expired(browser):
    r = browser.get("/api/me", headers=bearer(mint(auth_time=ago(7200), iat=ago(7200), exp=ago(3600))))
    assert r.status_code == 401
    assert r.headers.get("www-authenticate") == "Bearer"
    assert "expired" in r.json()["detail"].lower()


def test_rejection_does_not_say_which_check_failed(browser):
    """A forger learns nothing from the reply. Log the reason; don't send it."""
    r = browser.get("/api/me", headers=bearer(mint(aud="someone-elses-project")))
    assert r.status_code == 401
    detail = r.json()["detail"].lower()
    assert "aud" not in detail and "audience" not in detail


def test_key_outage_is_503_not_401(browser, keys):
    keys.down = True
    r = browser.get("/api/me", headers=bearer(mint()))
    assert r.status_code == 503


def test_refused_write_never_reaches_the_handler(browser, repo):
    r = browser.post("/api/trials", json={"name": "Sneaky", "crop": "Yam", "site": "Roujol", "season": "2026"})
    assert r.status_code == 401
    assert repo.list_trials() == []


def test_signed_in_write_goes_through(browser):
    body = {"name": "Roujol A", "crop": "Yam", "site": "Roujol", "season": "2026", "plots": 142}
    r = browser.post("/api/trials", json=body, headers=bearer(mint()))
    assert r.status_code == 201, r.text


def test_health_needs_no_token_and_names_the_project_it_trusts(browser):
    r = browser.get("/api/health")
    assert r.status_code == 200
    assert r.json()["auth"] == f"identity-platform:{PROJECT}"


def _runs(dependant, target) -> bool:
    return any(dep.call is target or _runs(dep, target) for dep in dependant.dependencies)


def test_every_api_route_requires_sign_in():
    """Guards the future: a router added without auth fails here, not in production."""
    public = {"/api/health"}
    routes = [r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api") and r.path not in public]
    assert routes, "no /api routes found"
    unguarded = [f"{sorted(r.methods)} {r.path}" for r in routes if not _runs(r.dependant, current_user)]
    assert not unguarded, f"reachable without signing in: {unguarded}"
