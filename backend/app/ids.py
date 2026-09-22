"""Identifier helpers. Mirrors `slugify` in the frontend's trialsData.js so ids
look the same whether the fixture or the API minted them."""

from __future__ import annotations

import re
import secrets
import unicodedata
from typing import Callable


def slugify(value: str, max_len: int = 60) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return value[:max_len]


def unique_slug(base: str, exists: Callable[[str], bool]) -> str:
    """`guadeloupe-yam-2026`, then `-2`, `-3`… until one is free."""
    base = base or "trial"
    candidate, n = base, 2
    while exists(candidate):
        candidate = f"{base}-{n}"
        n += 1
    return candidate


def flight_id() -> str:
    # 12 hex chars ≈ 48 bits of randomness; readable in URLs, no collisions in practice.
    return "flt_" + secrets.token_hex(6)


_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._()-]+")


def safe_filename(name: str) -> str:
    """Strip directory parts and anything odd so a filename can be an object key segment."""
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = _SAFE_FILENAME.sub("_", name).strip("._") or "file"
    return name[:120]
