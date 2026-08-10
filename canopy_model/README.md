# Yam Canopy Model (20-Plot Pilot)

This repository holds the U-Net canopy segmentation model for the Yam project. The model takes a drone image of one field plot and reports the percentage of canopy cover (Fcover) and the canopy area. This is the initial pilot version, trained and validated on 20 hand-labelled plots from the 12-12-24 flight date.

## What is in this repository

Model code lives under `unet_v1/`, named for the architecture and version rather than just "model", since a future architecture or retrain would get its own sibling folder (for example `unet_v2/`) instead of a repository-wide rename.

- `unet_v1/train_unet_5fold.py` — trains the U-Net with 5-fold cross-validation and writes CV metrics plus a deployment model.
- `unet_v1/predict_unet.py` — loads the deployment weights and predicts Fcover and canopy area on new plot clips.
- `unet_v1/weights/unet_canopy_full.pt` — the trained deployment weights (all 20 pilot plots). Tracked with Git LFS; see the setup instructions below.
- `data/training_data_12-12/` — the 20 labelled plots used to train and validate the pilot model: `images/` (RGBA GeoTIFF clips) and `masks/` (binary canopy masks, one PNG per image).
- `data/pilot_preview_12-12-24/` — plain PNG previews of the same 20 plots, useful when a GeoTIFF viewer is not available. These previews carry no georeferencing; they are visual reference only, not model input.
- `docs/sample_outputs/` — real output from a run of `predict_unet.py` (`predictions.csv` and overlay images), plus the full 5-fold cross-validation report. This shows exactly what the model produces and how accurate it currently is.

## Data format

One plot equals one RGBA GeoTIFF (`images/<stem>.tif`) plus one binary mask (`masks/<stem>_mask.png`). The alpha channel marks which pixels fall inside the plot boundary. The mask is white where the image shows canopy and black elsewhere. Files pair by filename stem.

## Environment setup

Create a Python environment (conda or venv) and install the pinned packages.

```bash
python -m venv venv
source venv/bin/activate        # on Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Read the note at the top of `requirements.txt`. The version ranges are safe defaults, not an exact capture of the original training environment. Run `pip freeze > requirements.lock.txt` after your first successful run and commit that file, so future runs stay reproducible.

## How to run

Both scripts use paths relative to their own location, so they run as-is from a fresh clone. No path edits are required for the pilot data already in this repository.

```bash
# Retrain the pilot model and reproduce the 5-fold CV report.
# Writes output to train_output/ at the repo root (already gitignored).
python unet_v1/train_unet_5fold.py

# Predict on a new folder of plot clips.
# Edit CLIP_DIR near the top of the script first; it has no default value.
python unet_v1/predict_unet.py
```

`predict_unet.py` requires georeferenced GeoTIFF input, because it reads the ground sample distance (GSD) from the file to compute canopy area in square centimetres and square metres. Plain PNG images, including the ones in `data/pilot_preview_12-12-24/`, do not carry this information and will not work as direct input without changes to the script.

## What the model produces

Input: one RGBA GeoTIFF clip per plot (RGB plus an alpha channel marking the in-plot boundary).

Output per plot, one row in `predictions.csv`:

| column | meaning |
|---|---|
| `plot` | filename stem, for example `r2_c12_39_RoujolA_12-12-24` |
| `row`, `col` | plot grid position, parsed from the filename |
| `genotype` | genotype ID, parsed from the filename |
| `in_plot_px` | pixel count inside the plot boundary |
| `canopy_px` | pixel count classified as canopy |
| `fcover_pct` | canopy cover, `canopy_px / in_plot_px * 100` |
| `canopy_area_cm2`, `canopy_area_m2` | canopy area, computed from `canopy_px` and the image's ground sample distance |

An optional overlay PNG is written per plot, with predicted canopy pixels marked in magenta and out-of-plot pixels dimmed grey. See `docs/sample_outputs/predict_overlays/` and `docs/sample_outputs/cv_overlays/` for real examples of both this overlay style and the model's error maps (green agrees with the hand label, red is a false positive, blue is a false negative). The error maps only exist for the 20 plots that have a hand-labelled mask, since they need ground truth to compare against.

## Current model performance (20-plot pilot, out-of-fold cross-validation)

- Segmentation: mean IoU 0.719 (standard deviation 0.205), mean Dice 0.819 (standard deviation 0.152).
- Fcover (canopy percentage): mean absolute error 2.63 percentage points, RMSE 3.40, bias -0.79 (the model slightly under-predicts cover on average), R-squared 0.985.
- Full detail, per-plot numbers, and caveats about the small sample size are in `docs/sample_outputs/RESULTS_INTERPRETATION.txt` and `docs/sample_outputs/val_report_cv.csv`.

These numbers describe the training procedure's expected generalisation, not the accuracy of one single saved file. Treat them as a pipeline sanity check ahead of a larger, full-scale model, not as a final performance claim.

## Known limitations

This is pilot-stage research code, not a packaged library.

- `predict_unet.py` needs `CLIP_DIR` set to a real folder before it runs. This is deliberate, since the clips it was written against live outside this repository (they are a full-flight dataset, too large to check in here).
- The model is trained and validated on a single flight date and a single site (RoujolA, 12-12-24). Its accuracy on other dates, sites, or lighting conditions is untested.
- Sparse-canopy plots (low Fcover%) are the hardest case for the model. Check `docs/sample_outputs/val_report_cv.csv` for the per-plot IoU/Dice numbers; accuracy is lower at the low end of the cover range.
- `unet_canopy_full.pt` is tracked with Git LFS because of its size. Anyone cloning this repository needs Git LFS installed first, or the weight file downloads as a small text pointer instead of the real model.
