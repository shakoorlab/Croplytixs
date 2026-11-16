"""
The models a flight can be processed with.

For now that is the Base model alone: the lab's yam canopy U-Net from the model
handoff. Its weights live in the bucket (they are the lab's and stay out of this
public repository); the runbook's step 12 uploads them. The SHA-256 pins the
exact file, so a result always names the weights that made it, and a job
refuses a file that isn't them.

The design's Private and Global models (per account, or shared and gated) will
be Firestore records with the same fields; this module is where a run looks a
model up, so that change stays here.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class ModelSpec:
    id: str
    version: str
    label: str
    scope: str  # base | private | global
    architecture: str
    weights_key: str  # object key in the bucket
    sha256: str
    gsd_cm: float  # the pixel size it was trained at
    bands: str
    trained_on: str
    scores: dict = field(default_factory=dict)

    def record(self) -> dict:
        """What a result stores about the model that made it."""
        return {k: v for k, v in asdict(self).items() if k != "weights_key"}


BASE_MODELS: dict[str, ModelSpec] = {
    spec.id: spec
    for spec in [
        ModelSpec(
            id="yam-canopy-unet-v1",
            version="1",
            label="Yam canopy U-Net · v1",
            scope="base",
            architecture="U-Net, ResNet34 encoder (segmentation_models_pytorch 0.5), RGB in, canopy out",
            weights_key="models/base/yam-canopy-unet-v1/unet_canopy_full.pt",
            sha256="416dfd6c05ffba5e9383d7810df580a6c39aae014877990b5540d6a7c37a5043",
            gsd_cm=2.3,
            bands="RGB",
            trained_on="75 hand-labelled Roujol A yam plots, flown 12 Dec 2024 at 12 m (2.3 cm)",
            scores={"iou": 0.68, "dice": 0.79, "coverMaePoints": 5.7, "r2": 0.91, "method": "5-fold cross-validation, out of fold"},
        )
    ]
}
DEFAULT_MODEL_ID = "yam-canopy-unet-v1"


class UnknownModel(LookupError):
    pass


def resolve(model_id: str | None) -> ModelSpec:
    spec = BASE_MODELS.get(model_id or DEFAULT_MODEL_ID)
    if spec is None:
        raise UnknownModel(f"No model '{model_id}'. Available: {', '.join(BASE_MODELS)}.")
    return spec
