"""
Runs app/pipeline on the yam canopy model handoff's test data and compares the
result with the handoff's expected outputs, using the handoff's own tolerances
(check_against_expected.py): canopy probability within 2 of 255 per pixel, and
canopy area within 0.01 m² per plot.

The handoff isn't in this repository (the weights and orthophotos are the lab's).
Point at your copy of it:

    pip install -r requirements.txt -r requirements-process.txt   # plus CPU PyTorch, see Dockerfile.process
    python -m scripts.check_pipeline --handoff ~/path/to/Jakes-Handoff                  # every test date
    python -m scripts.check_pipeline --handoff ~/path/to/Jakes-Handoff --site RoujolA --date 2024-12-12

Run it after any change to app/pipeline, and before trusting a new model file
with the old expectations (a new model needs new expected outputs).
Godet25-26's grids carry only an `id` column; their row and column come from a
field map the research scripts rebuilt, which the platform doesn't do yet, so
those dates are skipped.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

PROB_TOL = 2
AREA_TOL_M2 = 0.01
MAPPING = {"identity": "grid", "plot_id": "", "row": "row", "col": "col", "genotype": "var", "rep": ""}


def find_inputs(date_dir: Path) -> tuple[Path, Path] | None:
    """The date's orthophoto and grid, by the research scripts' rules, or None."""
    tifs = [p for p in date_dir.glob("*.tif") if "mns" not in p.stem.lower() and "dsm" not in p.stem.lower()]
    shps = [p for p in date_dir.rglob("*.shp") if "bad" not in str(p).lower()]
    return (tifs[0], shps[0]) if len(tifs) == 1 and len(shps) == 1 else None


def check(handoff: Path, site: str, date: str, model) -> list[str]:
    import numpy as np
    import pandas as pd
    import rasterio

    from app.pipeline.assign import assign_canopy
    from app.pipeline.detect import FieldReader, check_orthophoto, detect_canopy, field_grid
    from app.pipeline.grid import read_plots
    from app.pipeline.report import plot_rows

    inputs = find_inputs(handoff / "test_data" / "Photos" / site / "RGB" / date)
    if inputs is None:
        print(f"  skip  {site:10s} {date}  (needs exactly one orthophoto and one .shp in test_data)")
        return None
    ortho, shp = inputs
    problems = []
    started = time.time()
    with rasterio.open(ortho) as src:
        check_orthophoto(src)
        grid = read_plots(shp, src.crs, mapping=MAPPING)
        field = field_grid(src, grid.bounds)  # at the orthophoto's own pixel size, as the handoff ran
        prob = detect_canopy(src, field, model)
        reader = FieldReader(src, field)
        _, valid = reader.read(0, field.height)
    result = assign_canopy(prob, valid, field.transform, grid.plots)
    rows = plot_rows(result, field.pixel_area_cm2, np.ones(len(result.plots) + 1), date=date, site=site)
    seconds = time.time() - started

    with rasterio.open(handoff / "expected_output" / "Canopy_Probability" / site / f"{site}_{date}_canopy_prob.tif") as exp:
        expected = exp.read(1)
        if exp.transform != field.transform:
            problems.append(f"grid differs: {field.transform} vs {exp.transform}")
    if expected.shape != prob.shape:
        problems.append(f"probability shape {prob.shape} vs {expected.shape} expected")
        prob_diff = None
    else:
        prob_diff = int(np.abs(prob.astype(int) - expected.astype(int)).max())
        if prob_diff > PROB_TOL:
            problems.append(f"probability differs by {prob_diff} > {PROB_TOL}")

    exp_rows = pd.read_csv(handoff / "expected_output" / "Estimates" / site / date / f"{site}_{date}.csv")
    got = pd.DataFrame([{"row": r["row"], "col": r["col"], "genotype": r["genotype"], "area": r["areaM2"]} for r in rows])
    merged = exp_rows.merge(got, on=["row", "col"], how="outer", indicator=True)
    if (merged["_merge"] != "both").any():
        problems.append(f"plot lists differ: {len(got)} plots vs {len(exp_rows)} expected")
    both = merged[merged["_merge"] == "both"]
    area_diff = float((both["area"] - both["canopy_area_m2"]).abs().max()) if len(both) else float("nan")
    if not area_diff <= AREA_TOL_M2:
        problems.append(f"area differs by {area_diff:.4f} m2 > {AREA_TOL_M2}")
    if (both["genotype_x"].astype(str) != both["genotype_y"].astype(str)).any():
        problems.append("genotypes differ")

    print(
        f"  {'PASS' if not problems else 'FAIL'}  {site:10s} {date}  plots={len(rows):4d}  "
        f"max area diff={area_diff:.4f} m2  max prob diff={prob_diff}  ({seconds:.0f} s)"
    )
    for p in problems:
        print(f"        - {p}")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--handoff", required=True, type=Path, help="the Jakes-Handoff folder")
    parser.add_argument("--site")
    parser.add_argument("--date")
    args = parser.parse_args(argv)

    from app.pipeline.detect import load_model

    model = load_model(args.handoff / "model" / "unet_canopy_full.pt")
    expected = sorted((d.parent.name, d.name) for d in (args.handoff / "expected_output" / "Estimates").glob("*/*") if d.is_dir())
    todo = [(s, d) for s, d in expected if (not args.site or s == args.site) and (not args.date or d == args.date)]
    failed, ran = [], 0
    for site, date in todo:
        if site == "Godet25-26":
            print(f"  skip  {site:10s} {date}  (id-only grid: needs the field-map row/col rebuild)")
            continue
        problems = check(args.handoff, site, date, model)
        if problems is None:
            continue
        ran += 1
        if problems:
            failed.append((site, date))
    print(f"\n{ran - len(failed)}/{ran} site/dates PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
