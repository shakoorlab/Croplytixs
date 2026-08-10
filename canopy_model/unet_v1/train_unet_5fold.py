"""
train_unet_5fold.py
-------------------
Same U-Net pipeline as train_unet.py, with 5-FOLD CROSS-VALIDATION plus four
review fixes applied. Dataset content, model, and loss are otherwise unchanged
so results stay comparable to the original.

WHAT 5-FOLD CV MEASURES (read this before interpreting the numbers)  [fix #6]
    Cross-validation estimates how well the *training procedure* generalizes, not
    the accuracy of one specific model file. The 20 out-of-fold predictions come
    from 5 different models (each trained on a different 16 plots). The deployed
    model saved at the end (unet_canopy_full.pt) is a 6th model trained on all 20
    plots; its accuracy is *estimated* by the CV, never measured directly. Report
    the headline numbers as "estimated out-of-fold generalization", and lean on
    the mean +/- std across plots rather than any single fold at n=20.

FIXES vs the earlier CV version
    #1 ImageNet input normalization: inputs are normalized with ImageNet mean/std
       (matching the pretrained ResNet34 encoder) instead of a bare /255. Applied
       identically in training, validation, and (you must mirror this) prediction.
    #2 Training-curve logging: per-epoch train loss is saved per fold and a short
       plateau/min summary is printed, so EPOCHS can be chosen from evidence
       rather than assumed. (We keep fixed EPOCHS: in CV you must NOT early-stop on
       the validation fold, or it leaks. Use the curves to pick EPOCHS a priori.)
    #4 Letterbox padding: clips are resized preserving aspect ratio (longest side
       -> IMG_SIZE) and zero-padded to a square, instead of being squashed. Padded
       pixels get alpha=0, so they are ignored by the loss and by every metric.

Ground truth = your hand-labeled masks in masks/*_mask.png.
Metrics per plot: predicted vs true canopy%, IoU, Dice.

Outputs (into OUT_DIR):
  val_report_cv.csv               per-plot true vs pred canopy% + IoU/Dice + fold
  fold_summary.csv                per-fold mean IoU / Dice / canopy% error
  loss_curves/<tag>.csv           per-epoch train loss for each fold + full model
  fold_models/unet_fold{k}.pt     each fold's weights
  unet_canopy_full.pt             model retrained on ALL 20 plots (for prediction)
  overlays/<plot>_overlay.png     out-of-fold prediction overlay for every plot
  RESULTS_INTERPRETATION.txt      plain-language summary of what the numbers mean

Run in the yam-fcover env (MPS/Apple-GPU used automatically if available).

PATHS IN THIS REPO COPY
  DATA_DIR and OUT_DIR below are repo-relative and need no edits to reproduce the
  20-plot pilot CV. DATA_DIR expects images/*.tif + masks/*_mask.png, matching
  this repo's data/training_data_12-12/ folder (the mask folder is named "masks"
  here; it is named "Annotated_masks" in the original lab-drive copy, so rename
  if you pull data from there instead of from this repo).
"""

import csv
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from PIL import Image
import albumentations as A
import segmentation_models_pytorch as smp

# ----------------------------------------------------------------------
# CONFIG
# ----------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data" / "training_data_12-12"
OUT_DIR  = REPO_ROOT / "train_output"

K_FOLDS  = 5            # 5-fold cross-validation
IMG_SIZE = 128          # model input (clips letterboxed to this square)  [#3 later: raise this]
EPOCHS   = 150          # fixed on purpose; use loss_curves/ to justify this number  [#2]
BATCH    = 4
LR       = 1e-3
SEED     = 42

STRATIFY_BY_COVER = True   # deal folds across the cover range (recommended at n=20)
TRAIN_FULL_MODEL  = True    # after CV, retrain on all 20 plots for downstream prediction

# ImageNet statistics the ResNet34 encoder was pretrained with  [#1]
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD  = (0.229, 0.224, 0.225)
normalize = A.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD, max_pixel_value=255.0)

torch.manual_seed(SEED); np.random.seed(SEED)
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
print("device:", DEVICE)

OUT_DIR.mkdir(parents=True, exist_ok=True)
(OUT_DIR / "overlays").mkdir(exist_ok=True)
(OUT_DIR / "fold_models").mkdir(exist_ok=True)
(OUT_DIR / "loss_curves").mkdir(exist_ok=True)

# ----------------------------------------------------------------------
# letterbox: aspect-preserving resize + zero-pad to square  [#4]
# ----------------------------------------------------------------------
def letterbox(arr, interp):
    """Resize so the longest side == IMG_SIZE (aspect preserved), then center-pad
    with zeros to IMG_SIZE x IMG_SIZE. Works for 3-channel images and 2-D masks.
    Returns (canvas, (top, left, new_h, new_w)) so the padding can be inverted."""
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
# DATASET   (same content as train_unet.py; letterbox + ImageNet normalize added)
# ----------------------------------------------------------------------
class CanopyDataset(Dataset):
    """Returns letterboxed+normalized RGB, canopy mask, and alpha (in-plot) mask."""
    def __init__(self, stems, augment):
        self.stems = stems
        self.augment = augment
        # geometric + mild photometric aug, then ImageNet normalize.
        # NO strong color shift (color = signal). No resize here: letterbox already
        # produced an IMG_SIZE square, so augmentations are size-preserving.  [#1][#4]
        if augment:
            self.tf = A.Compose([
                A.HorizontalFlip(p=0.5),
                A.VerticalFlip(p=0.5),
                A.RandomRotate90(p=0.5),
                A.RandomBrightnessContrast(brightness_limit=0.15, contrast_limit=0.15, p=0.5),
                normalize,
            ])
        else:
            self.tf = A.Compose([normalize])

    def __len__(self):
        return len(self.stems)

    def __getitem__(self, i):
        stem = self.stems[i]
        rgba = np.array(Image.open(DATA_DIR / "images" / f"{stem}.tif"))
        rgb = rgba[:, :, :3]
        alpha = (rgba[:, :, 3] > 0).astype(np.uint8)
        canopy = (np.array(Image.open(DATA_DIR / "masks" / f"{stem}_mask.png")) > 128).astype(np.uint8)

        # letterbox image (bilinear) and both masks (nearest, keep them binary)  [#4]
        rgb_lb, _ = letterbox(rgb, Image.BILINEAR)
        canopy_lb, _ = letterbox(canopy, Image.NEAREST)
        alpha_lb, _ = letterbox(alpha, Image.NEAREST)

        # same geometric transform to image + both masks; normalize hits image only
        out = self.tf(image=rgb_lb, masks=[canopy_lb, alpha_lb])
        img = out["image"]                       # float32 HWC, already ImageNet-normalized [#1]
        canopy_r, alpha_r = out["masks"]

        img = torch.from_numpy(img).permute(2, 0, 1)                 # HWC -> CHW
        canopy_r = torch.from_numpy(canopy_r).float().unsqueeze(0)   # 1HW
        alpha_r = torch.from_numpy(alpha_r).float().unsqueeze(0)
        return img, canopy_r, alpha_r, stem

# ----------------------------------------------------------------------
# loss   (unchanged from train_unet.py: BCE + Dice on in-plot pixels only)
# ----------------------------------------------------------------------
bce = nn.BCEWithLogitsLoss(reduction="none")

def masked_loss(logits, target, alpha):
    """BCE + Dice, restricted to in-plot (alpha>0) pixels. Padded corners (alpha=0)
    contribute nothing, so letterbox padding is automatically ignored.  [#4]"""
    b = bce(logits, target) * alpha
    bce_loss = b.sum() / (alpha.sum() + 1e-6)
    prob = torch.sigmoid(logits) * alpha
    tgt = target * alpha
    inter = (prob * tgt).sum()
    dice = 1 - (2 * inter + 1e-6) / (prob.sum() + tgt.sum() + 1e-6)
    return bce_loss + dice

# ----------------------------------------------------------------------
# build 5 folds over all 20 plots
# ----------------------------------------------------------------------
all_stems = sorted(p.stem for p in (DATA_DIR / "images").glob("*.tif"))
print(f"found {len(all_stems)} annotated plots")

def true_cover_pct(stem):
    """True (hand-labeled) canopy% for a plot, used only to stratify the folds."""
    rgba = np.array(Image.open(DATA_DIR / "images" / f"{stem}.tif"))
    alpha = rgba[:, :, 3] > 0
    canopy = (np.array(Image.open(DATA_DIR / "masks" / f"{stem}_mask.png")) > 128) & alpha
    return canopy.sum() / alpha.sum() * 100 if alpha.sum() else 0.0

if STRATIFY_BY_COVER:
    ordered = sorted(all_stems, key=true_cover_pct)                 # sparse -> full
    fold_of = {s: (rank % K_FOLDS) for rank, s in enumerate(ordered)}
else:
    rng = np.random.default_rng(SEED)
    perm = list(rng.permutation(all_stems))
    fold_of = {s: (i % K_FOLDS) for i, s in enumerate(perm)}

folds = [[s for s in all_stems if fold_of[s] == k] for k in range(K_FOLDS)]
print("fold sizes:", [len(f) for f in folds])

# ----------------------------------------------------------------------
# train a fresh model on `train_stems`; return model + per-epoch loss list  [#2]
# ----------------------------------------------------------------------
def train_model(train_stems, tag):
    train_dl = DataLoader(CanopyDataset(train_stems, augment=True),
                          batch_size=BATCH, shuffle=True)
    # same model + optimizer as train_unet.py
    model = smp.Unet(encoder_name="resnet34", encoder_weights="imagenet",
                     in_channels=3, classes=1).to(DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=LR)

    losses = []
    model.train()
    for epoch in range(1, EPOCHS + 1):
        tot = 0.0
        for img, canopy, alpha, _ in train_dl:
            img, canopy, alpha = img.to(DEVICE), canopy.to(DEVICE), alpha.to(DEVICE)
            opt.zero_grad()
            loss = masked_loss(model(img), canopy, alpha)
            loss.backward(); opt.step()
            tot += loss.item()
        epoch_loss = tot / len(train_dl)
        losses.append(epoch_loss)
        if epoch % 25 == 0 or epoch == 1:
            print(f"    [{tag}] epoch {epoch:3d}  train_loss {epoch_loss:.4f}")

    # save the loss curve + print a plateau/min summary so EPOCHS is evidence-based [#2]
    with open(OUT_DIR / "loss_curves" / f"{tag}.csv", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["epoch", "train_loss"])
        w.writerows([(e + 1, round(l, 5)) for e, l in enumerate(losses)])
    best_ep = int(np.argmin(losses)) + 1
    # first epoch after which loss improved < 1% for 10 straight epochs (rough plateau)
    plateau = EPOCHS
    for e in range(10, len(losses)):
        if losses[e - 10] > 0 and (losses[e - 10] - losses[e]) / losses[e - 10] < 0.01:
            plateau = e + 1; break
    print(f"    [{tag}] loss: start {losses[0]:.4f} -> end {losses[-1]:.4f}"
          f"  (min at epoch {best_ep}; ~plateau by epoch {plateau})")
    return model

# ----------------------------------------------------------------------
# validate one plot: hand-label vs prediction, at native resolution   [#4 invert pad]
# ----------------------------------------------------------------------
def validate_plot(model, stem, fold):
    model.eval()
    with torch.no_grad():
        rgba = np.array(Image.open(DATA_DIR / "images" / f"{stem}.tif"))
        H, W = rgba.shape[:2]
        rgb = rgba[:, :, :3]; alpha = rgba[:, :, 3] > 0
        true = (np.array(Image.open(DATA_DIR / "masks" / f"{stem}_mask.png")) > 128)

        # letterbox + normalize exactly like training, remembering the pad geometry [#1][#4]
        canvas, (top, left, nh, nw) = letterbox(rgb, Image.BILINEAR)
        inp = normalize(image=canvas)["image"]
        inp = torch.from_numpy(inp).permute(2, 0, 1).unsqueeze(0).to(DEVICE)
        prob_sq = torch.sigmoid(model(inp))[0, 0].cpu().numpy()      # IMG_SIZE x IMG_SIZE

        # undo the padding, then resize the real content back to native (W, H)  [#4]
        crop = prob_sq[top:top + nh, left:left + nw]
        prob = np.array(Image.fromarray((crop * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)) / 255.0
        pred = (prob > 0.5) & alpha              # threshold + restrict to in-plot

        true = true & alpha
        inter = (pred & true).sum(); union = (pred | true).sum()
        iou = inter / (union + 1e-6)
        dice = 2 * inter / (pred.sum() + true.sum() + 1e-6)
        pred_pct = pred.sum() / alpha.sum() * 100
        true_pct = true.sum() / alpha.sum() * 100

        ov = rgb.copy(); ov[pred] = [255, 0, 255]; ov[~alpha] = [128, 128, 128]
        Image.fromarray(ov).resize((W * 4, H * 4), Image.NEAREST).save(
            OUT_DIR / "overlays" / f"{stem}_overlay.png")

        # error map: where the model agrees/disagrees with your hand label  [#4]
        #   green = true positive (canopy correct)   red = false positive (over-segment)
        #   blue  = false negative (missed canopy)    dim RGB = correct background
        em = (rgb.astype(np.float32) * 0.45).astype(np.uint8)
        tp = pred & true
        fp = pred & (~true) & alpha
        fn = (~pred) & true & alpha
        em[tp] = [0, 220, 0]; em[fp] = [230, 0, 0]; em[fn] = [0, 90, 255]
        em[~alpha] = [128, 128, 128]
        Image.fromarray(em).resize((W * 4, H * 4), Image.NEAREST).save(
            OUT_DIR / "overlays" / f"{stem}_errormap.png")

    return (stem, fold, round(float(true_pct), 1), round(float(pred_pct), 1),
            round(float(iou), 3), round(float(dice), 3))

# ----------------------------------------------------------------------
# cross-validation loop
# ----------------------------------------------------------------------
print("\n5-fold cross-validation...")
rows = []                                  # one out-of-fold row per plot
for k in range(K_FOLDS):
    val_stems = folds[k]
    train_stems = [s for s in all_stems if s not in val_stems]
    print(f"\n=== fold {k+1}/{K_FOLDS}   train {len(train_stems)}   val {len(val_stems)} ===")

    model = train_model(train_stems, tag=f"fold{k+1}")
    torch.save(model.state_dict(), OUT_DIR / "fold_models" / f"unet_fold{k+1}.pt")

    for stem in val_stems:
        r = validate_plot(model, stem, k + 1)
        rows.append(r)
        print(f"    {r[0]:32s} true {r[2]:>5} pred {r[3]:>5}  IoU {r[4]:.3f}  Dice {r[5]:.3f}")

# ----------------------------------------------------------------------
# reports
# ----------------------------------------------------------------------
rows.sort(key=lambda r: r[2])              # sort by true canopy% for readability

with open(OUT_DIR / "val_report_cv.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["plot", "fold", "true_canopy_pct", "pred_canopy_pct", "IoU", "Dice"])
    w.writerows(rows)

with open(OUT_DIR / "fold_summary.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["fold", "n_val", "mean_IoU", "mean_Dice", "mean_abs_canopy_err_pct"])
    for k in range(1, K_FOLDS + 1):
        fr = [r for r in rows if r[1] == k]
        w.writerow([k, len(fr),
                    round(np.mean([r[4] for r in fr]), 3),
                    round(np.mean([r[5] for r in fr]), 3),
                    round(np.mean([abs(r[3] - r[2]) for r in fr]), 2)])

# aggregate over all 20 out-of-fold plots
iou  = np.array([r[4] for r in rows])
dice = np.array([r[5] for r in rows])
t    = np.array([r[2] for r in rows])
p    = np.array([r[3] for r in rows])
err  = p - t
mae  = float(np.abs(err).mean())
rmse = float(np.sqrt((err ** 2).mean()))
bias = float(err.mean())                                    # + = over-predicts cover
r2   = float(1 - ((t - p) ** 2).sum() / (((t - t.mean()) ** 2).sum() + 1e-9))

print("\n===== 5-FOLD CV: estimated out-of-fold generalization (all 20 plots) =====")  # [#6]
print(f"{'plot':32s} {'fold':>4} {'true%':>6} {'pred%':>6} {'IoU':>6} {'Dice':>6}")
for r in rows:
    print(f"{r[0]:32s} {r[1]:>4} {r[2]:>6} {r[3]:>6} {r[4]:>6} {r[5]:>6}")
print("-" * 70)
print(f"Segmentation : mean IoU {iou.mean():.3f} +/- {iou.std():.3f}   "
      f"mean Dice {dice.mean():.3f} +/- {dice.std():.3f}")
print(f"Canopy% (Fcover): MAE {mae:.2f}   RMSE {rmse:.2f}   bias {bias:+.2f}   R2 {r2:.3f}")

# plain-language interpretation written to disk  [#6]
with open(OUT_DIR / "RESULTS_INTERPRETATION.txt", "w") as f:
    f.write(
        "5-FOLD CROSS-VALIDATION RESULTS - HOW TO READ THEM\n"
        "==================================================\n\n"
        f"Plots: {len(all_stems)}   Folds: {K_FOLDS}   Epochs/fold: {EPOCHS}   "
        f"Input: {IMG_SIZE}px letterboxed, ImageNet-normalized\n\n"
        "WHAT THESE NUMBERS ARE\n"
        "  These are OUT-OF-FOLD estimates: each plot was scored by a model that never\n"
        "  saw it in training. The 20 predictions come from 5 different models. The\n"
        "  numbers estimate how well the TRAINING PROCEDURE generalizes -- they are NOT\n"
        "  the measured accuracy of any single saved model.\n\n"
        "  unet_canopy_full.pt (trained on all 20 plots) is the model you deploy for\n"
        "  prediction. Its true accuracy is ESTIMATED by this CV, not measured directly.\n\n"
        "HEADLINE (mean over 20 plots; trust mean +/- std, not any one fold at n=20)\n"
        f"  Segmentation   : IoU {iou.mean():.3f} +/- {iou.std():.3f}   "
        f"Dice {dice.mean():.3f} +/- {dice.std():.3f}\n"
        f"  Fcover (canopy%): MAE {mae:.2f} pts   RMSE {rmse:.2f}   "
        f"bias {bias:+.2f}   R2 {r2:.3f}\n"
        f"  (bias > 0 means the model over-predicts canopy cover on average.)\n\n"
        "CAVEATS\n"
        "  * n=20 is small: fold-to-fold variance is expected and is not model failure.\n"
        "  * Sparse-canopy plots are hardest; check them specifically in val_report_cv.csv.\n"
        "  * Treat this as a pipeline sanity check. Re-run after each annotation batch\n"
        "    and watch MAE trend down / R2 up.\n"
        "  * See loss_curves/ to judge whether EPOCHS is sensible before scaling up.\n"
    )

# ----------------------------------------------------------------------
# deployment model: retrain on ALL 20 plots
# ----------------------------------------------------------------------
if TRAIN_FULL_MODEL:
    print("\n=== retraining on all 20 plots for deployment ===")
    full = train_model(all_stems, tag="full")
    torch.save(full.state_dict(), OUT_DIR / "unet_canopy_full.pt")
    print("saved unet_canopy_full.pt  (point predict_unet.py MODEL_PATH here)")

print(f"\noutputs in {OUT_DIR}")
