"""
predict_unet.py
---------------
Load the trained U-Net and run it on plot clips.
For each clip: segment canopy, restrict to in-plot (alpha) pixels, and report
  * Fcover  (%)               = canopy_px / in-plot_px
  * canopy area (cm^2, m^2)   = canopy_px * (GSD_x * GSD_y), read from georeferencing

Test mode: set N_TEST to run on a stratified sample spanning the cover range
(sparse -> full) instead of all clips. Set N_TEST = None for the full folder.

Output: predictions.csv (one row per clip) + optional overlay PNGs.
Run in the yam-fcover env.

PREPROCESSING MUST MATCH train_unet_5fold.py  [fixes #1 + #4]
  Inputs are letterboxed (aspect-preserving resize + zero-pad to a square) and then
  ImageNet-normalized, exactly as in training. If this ever drifts from the training
  script, predicted Fcover will silently disagree with the cross-validated numbers.

PATHS IN THIS REPO COPY
  MODEL_PATH below is repo-relative (model/weights/unet_canopy_full.pt) and needs
  no edits. CLIP_DIR and OUT_DIR are placeholders -- CLIP_DIR must point at a folder
  of RGBA GeoTIFF clips (see docs/sample_outputs/ for the expected output shape,
  and data/training_data_12-12/images/ for example input clips). Set both to real
  paths on your machine before running.
"""

import csv
from pathlib import Path

import numpy as np
import torch
import rasterio
from PIL import Image
import albumentations as A
import segmentation_models_pytorch as smp

# ----------------------------------------------------------------------
# CONFIG
# ----------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent

# deployment model = trained on ALL 20 plots by train_unet_5fold.py
MODEL_PATH = REPO_ROOT / "unet_v1" / "weights" / "unet_canopy_full.pt"

# EDIT ME: folder of RGBA GeoTIFF clips to run prediction on.
CLIP_DIR = Path("/path/to/your/clips")

# EDIT ME: where predictions.csv + overlays/ get written.
OUT_DIR = REPO_ROOT / "predict_output"

IMG_SIZE = 128
SAVE_OVERLAYS = True      # write an overlay PNG per predicted clip
N_TEST = 10               # test on N clips spanning cover range; None = all clips
EXCLUDE_TRAINED = True   # True = skip the 20 already-annotated plots from the sample

# ImageNet stats, same as training  [#1]
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD  = (0.229, 0.224, 0.225)
normalize = A.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD, max_pixel_value=255.0)

TRAINED_PLOTS = {
    "r1_c2_106_RoujolA_12-12-24", "r1_c7_140_RoujolA_12-12-24", "r2_c5_27_RoujolA_12-12-24",
    "r3_c7_225_RoujolA_12-12-24", "r4_c6_128_RoujolA_12-12-24", "r4_c7_210_RoujolA_12-12-24",
    "r4_c12_214_RoujolA_12-12-24", "r5_c4_147_RoujolA_12-12-24", "r6_c10_235_RoujolA_12-12-24",
    "r7_c2_54_RoujolA_12-12-24", "r8_c2_43_RoujolA_12-12-24", "r8_c4_143_RoujolA_12-12-24",
    "r8_c5_105_RoujolA_12-12-24", "r8_c10_131_RoujolA_12-12-24", "r9_c12_163_RoujolA_12-12-24",
    "r10_c2_11_RoujolA_12-12-24", "r10_c4_217_RoujolA_12-12-24", "r10_c9_24_RoujolA_12-12-24",
    "r11_c3_134_RoujolA_12-12-24", "r11_c6_128_RoujolA_12-12-24",
}

DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
print("device:", DEVICE)

OUT_DIR.mkdir(parents=True, exist_ok=True)
if SAVE_OVERLAYS:
    (OUT_DIR / "overlays").mkdir(exist_ok=True)

# ----------------------------------------------------------------------
# letterbox: aspect-preserving resize + zero-pad to square  [#4]
# (identical to train_unet_5fold.py; keep the two in sync)
# ----------------------------------------------------------------------
def letterbox(arr, interp):
    """Resize so the longest side == IMG_SIZE (aspect preserved), then center-pad
    with zeros to IMG_SIZE x IMG_SIZE. Returns (canvas, (top, left, new_h, new_w))."""
    H, W = arr.shape[:2]
    scale = IMG_SIZE / max(H, W)
    new_w, new_h = max(1, round(W * scale)), max(1, round(H * scale))
    resized = np.array(Image.fromarray(arr).resize((new_w, new_h), interp))
    top  = (IMG_SIZE - new_h) // 2
    left = (IMG_SIZE - new_w) // 2
    if resized.ndim == 3:
        canvas = np.zeros((IMG_SIZE, IMG_SIZE, resized.shape[2]), dtype=arr.dtype)
    else:
        canvas = np.zeros((IMG_SIZE, IMG_SIZE), dtype=arr.dtype)
    canvas[top:top + new_h, left:left + new_w] = resized
    return canvas, (top, left, new_h, new_w)

# ----------------------------------------------------------------------
# load model
# ----------------------------------------------------------------------
model = smp.Unet(encoder_name="resnet34", encoder_weights=None,
                 in_channels=3, classes=1).to(DEVICE)
model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
model.eval()
print("model loaded")

# ----------------------------------------------------------------------
# gather clips (with optional stratified test sampling)
# ----------------------------------------------------------------------
def exg_cover(p):
    """Quick ExG-based cover fraction (2G-R-B), no model - used only to stratify
    the test sample so it spans sparse -> full canopy. Pure RGB math."""
    a = np.array(Image.open(p)).astype(np.float64)
    plot = a[:, :, 3] > 0
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    s = R + G + B + 1e-6
    exg = 2 * (G / s) - (R / s) - (B / s)
    return (plot & (exg > 0.30)).sum() / plot.sum() if plot.sum() else 0.0

clips = sorted(CLIP_DIR.glob("*.tif"))

if EXCLUDE_TRAINED:
    clips = [p for p in clips if p.stem not in TRAINED_PLOTS]
    print(f"excluded trained plots; {len(clips)} unseen clips remain")

if N_TEST is not None and N_TEST < len(clips):
    scored = sorted(((p, exg_cover(p)) for p in clips), key=lambda x: x[1])
    idx = np.linspace(0, len(scored) - 1, N_TEST).round().astype(int)
    clips = [scored[i][0] for i in idx]
    print("test sample (spanning cover range, sparse -> full):")
    for p in clips:
        print("  ", p.stem)

print(f"predicting on {len(clips)} clips")

# ----------------------------------------------------------------------
# predict
# ----------------------------------------------------------------------
rows = []
with torch.no_grad():
    for path in clips:
        with rasterio.open(path) as src:
            arr = src.read()
            gsd_x = abs(src.transform.a)
            gsd_y = abs(src.transform.e)
        img_full = np.transpose(arr, (1, 2, 0))
        H, W = img_full.shape[:2]
        rgb = img_full[:, :, :3]
        alpha = img_full[:, :, 3] > 0 if img_full.shape[2] > 3 else np.ones((H, W), bool)

        px_area_cm2 = (gsd_x * 100) * (gsd_y * 100)

        # letterbox + ImageNet-normalize (must match training)  [#1][#4]
        canvas, (top, left, nh, nw) = letterbox(rgb, Image.BILINEAR)
        inp = normalize(image=canvas)["image"]
        inp = torch.from_numpy(inp).permute(2, 0, 1).unsqueeze(0).to(DEVICE)
        prob_sq = torch.sigmoid(model(inp))[0, 0].cpu().numpy()      # IMG_SIZE x IMG_SIZE

        # undo padding, resize the real content back to native (W, H)  [#4]
        crop = prob_sq[top:top + nh, left:left + nw]
        prob = np.array(Image.fromarray((crop * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)) / 255.0
        canopy = (prob > 0.5) & alpha

        in_plot_px = int(alpha.sum())
        canopy_px = int(canopy.sum())
        fcover = canopy_px / in_plot_px * 100 if in_plot_px else 0.0
        area_cm2 = canopy_px * px_area_cm2
        area_m2 = area_cm2 / 10000.0

        parts = path.stem.split("_")
        row = parts[0][1:] if parts[0].startswith("r") else ""
        col = parts[1][1:] if len(parts) > 1 and parts[1].startswith("c") else ""
        geno = parts[2] if len(parts) > 2 else ""

        rows.append((path.stem, row, col, geno, in_plot_px, canopy_px,
                     round(fcover, 1), round(area_cm2, 1), round(area_m2, 4)))

        if SAVE_OVERLAYS:
            ov = rgb.copy(); ov[canopy] = [255, 0, 255]; ov[~alpha] = [128, 128, 128]
            Image.fromarray(ov).resize((W * 4, H * 4), Image.NEAREST).save(
                OUT_DIR / "overlays" / f"{path.stem}_pred.png")

# ----------------------------------------------------------------------
# write CSV
# ----------------------------------------------------------------------
with open(OUT_DIR / "predictions.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["plot", "row", "col", "genotype", "in_plot_px", "canopy_px",
                "fcover_pct", "canopy_area_cm2", "canopy_area_m2"])
    w.writerows(rows)

print(f"\nwrote predictions.csv ({len(rows)} rows) to {OUT_DIR}")
print(f"{'plot':32s} {'fcover%':>8} {'area_m2':>8}")
for r in rows:
    print(f"{r[0]:32s} {r[6]:>8} {r[8]:>8}")
