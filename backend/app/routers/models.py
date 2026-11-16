"""
/api/models — the models a flight can be processed with (app/model_registry.py).
Read-only for now: the Base model. Private and Global models come with training.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..model_registry import BASE_MODELS, DEFAULT_MODEL_ID

router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
def list_models() -> list[dict]:
    return [{**spec.record(), "default": spec.id == DEFAULT_MODEL_ID} for spec in BASE_MODELS.values()]
