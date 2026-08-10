# Yam Canopy — Project Scope by Phase

A sequential plan: finish one phase, then move to the next. Each phase lists its
goal, the work, the deliverable, and an exit check ("done when…"). Phases 0–1 are
the science; 2–5 turn it into a usable tool; 6–8 are scale, downstream, and cloud.

---

## Phase 0 — Baseline model validated *(done)*

**Goal:** prove the pipeline is sound on a small pilot before investing in annotation.

- 20-plot 5-fold cross-validation, ImageNet normalization, letterbox padding, error maps.
- CV-fair ExG baseline + evaluation figures (1:1 scatter, residuals, per-stratum, bootstrap CIs).

**Deliverable:** `train_unet_5fold.py`, `predict_unet.py`, `Modeling/Analysis/` (ExG baseline, eval figures).
**Done when:** out-of-fold metrics on 20 plots are trustworthy and documented. ✅

---

## Phase 1 — Full annotation + baseline at scale (144)

**Goal:** turn the pilot into a real baseline model on all 144 plots.

- **Lock the annotation SOP first** (clear-green rule, mixed-pixel rule) — before mass labeling.
- Annotate all 144 in Label Studio.
- Convert Label Studio exports → training format (`images/*.tif` + `masks/*_mask.png`).
- Retrain 5-fold CV on 144 → versioned weights + CV report.
- Run the learning curve to confirm more data is still helping.

**Deliverable:** 144 aligned mask pairs, `unet_<date>_144.pt`, CV metrics, learning-curve figure.
**Done when:** mean ± std IoU/Dice and Fcover MAE on 144 are reported, and the model's standing vs. ExG is documented.

---

## Phase 2 — Model handoff API (wrap for integration)

**Goal:** make the model callable by a GUI without changing the model.

- `canopy_pre.py` — single shared preprocessing module (letterbox + normalize).
- `model_api.py` — `load_model()`, `train(images_dir, masks_dir, out_dir)`, `predict(image, plot_mask=None, gsd=None)`; **alpha- and GSD-optional** so plain uploads degrade to Fcover-only.
- `requirements.txt`, `INTERFACE.md` (the contract), shipped weights.

**Deliverable:** an importable model package + one-page interface doc.
**Done when:** a peer can `import model_api` and run `train`/`predict` from a script, no research code needed.

---

## Phase 3 — Ingestion & background processing

**Goal:** get user data into the model's expected shape automatically.

- Upload handler for per-plot `.tif` (RGBA GeoTIFF) — the source of truth.
- Background: `.tif` → 8-bit RGB **display PNG** for the canvas (keep the tif).
- Annotation mask → binary PNG **aligned to the tif** at native resolution.
- `manifest.csv` (filename ↔ plot metadata: row/col/genotype/site/date).
- `prep_check.py` — validator: missing pairs, channel/format issues, size mismatch, non-binary masks, empty plots, **mask↔tif alignment overlay**.

**Deliverable:** an ingestion + validation service.
**Done when:** dragging a folder of tifs yields validated, model-ready training pairs.

---

## Phase 4 — GUI v1 (annotate → train → predict)  *(Subterra-style)*

**Goal:** a working local, human-in-the-loop app.

- **FastAPI** service exposing `model_api` (segment, train, predict, annotation I/O).
- **React/Next** frontend: upload, canvas annotation with **model-assisted pre-label**, train trigger, results viewer.
- **SQLite** logging every step (annotations, training runs, `model_versions`, inferences).
- **Model registry**: versioned weights ↔ {training set, hyperparams, CV metrics, date}.
- **nginx + Docker Compose** for one-command local run.

**Deliverable:** a containerized local app.
**Done when:** a user annotates, retrains, and predicts end-to-end locally, with everything logged and versioned.

---

## Phase 5 — Traits & outputs

**Goal:** produce the measurements the science needs, per plot and per date.

- Compute Fcover %, canopy area (cm²/m²), **perimeter, compactness**.
- Batch inference over a folder / a whole flight date.
- Export per-plot trait tables (CSV) tagged with plot ID, date, GSD, model version.

**Deliverable:** phenotyping outputs joined to plot metadata.
**Done when:** one click produces a clean trait table for a full date, reproducible from the logged model version.

---

## Phase 6 — Scale & robustness (fine-tuning)

**Goal:** make the model hold up beyond one clean date.

- Broaden data: new **dates / sites / lighting** (the untested axis).
- Fine-tuning experiments: higher `IMG_SIZE`, ExG+RGB hybrid input, batch-norm handling — each judged by the same CV.
- Address radiometric consistency across flights.
- Observability dashboard over the SQLite logs.

**Deliverable:** an improved, monitored model with tested transfer.
**Done when:** performance is measured on held-out dates/sites, not just 12-12.

---

## Phase 7 — Downstream analytics (separate service)

**Goal:** connect canopy traits to agronomic outcomes.

- A **separate microservice** (mirrors Subterra's `genotype_service`) for: Kc estimation, genotype/breeding association, and — later — tuber yield prediction.
- Kept decoupled from the segmentation API; consumes trait tables + model versions.

**Deliverable:** an analytics service linking canopy traits → yield/Kc/genotype signals.
**Done when:** the Fcover/area → yield (or Kc) relationship is evaluated on real records.

---

## Phase 8 — Cloud migration *(optional / later)*

**Goal:** run the same app in the cloud without changing its logic.

- S3 (raw/masks/derived), ECS-Fargate or SageMaker (inference/training), RDS (Postgres) for logs, ECR + GitHub Actions CI/CD.
- Keep the REST contract and storage abstraction stable so local → AWS is an implementation swap.

**Deliverable:** cloud deployment.
**Done when:** the same workflow runs on AWS behind the same interfaces.

---

### Dependency at a glance
`0 ✅ → 1 (annotate 144) → 2 (API) → 3 (ingestion) → 4 (GUI) → 5 (traits) → 6 (scale) → 7 (downstream) → 8 (cloud)`

Phases 2 and 3 can overlap once Phase 1's format is locked; the GUI (4) can start against the Phase 2 contract before the 144 model is final — the app doesn't wait on model quality.
