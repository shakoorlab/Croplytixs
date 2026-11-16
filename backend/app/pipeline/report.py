"""
Per-plot numbers, QC flags, the CSV and the overlay picture, from an Assignment.

Areas are the watershed's: canopy assigned to the plot, including what grew
past its box. `cover` is the classic ground cover, canopy inside the box as a
share of the box, which is bounded at 100% and what growth curves are built
on. Both are reported because they answer different questions.

Each plot gets at most one flag (the most serious), the reason a human should
look at it first:

  near-zero          under 1% cover in the box: a failed or missing plot?
  low-confidence     the model was unsure over the box (confidence below 0.6)
  cut-by-reach       canopy past the reach limit was dropped: may be undercounted
  lost-to-neighbour  a neighbour took canopy from inside this box
  saturated          over 98% cover in the box: an alley or weeds in the box?

`confidence` is the mean of |2p − 1| over the box's pixels: 1 when the model was
sure of every pixel either way, 0 when every pixel sat at 0.5.
"""

from __future__ import annotations

import csv
import io

import numpy as np

from .assign import Assignment

FLAG_LABELS = {
    "near-zero": "Near-zero cover — failed plot?",
    "low-confidence": "Low model confidence",
    "cut-by-reach": "Canopy cut at the reach limit — may be undercounted",
    "lost-to-neighbour": "A neighbour took canopy inside this box",
    "saturated": "Cover at ceiling — alley or weeds in the box?",
}
NEAR_ZERO_COVER = 1.0  # % of the box
SATURATED_COVER = 98.0
LOW_CONFIDENCE = 0.6
# A share of the plot's assigned area. Cutting a few pixels off a sprawling
# plant is the limit doing its job; a tenth of the plot is worth a look.
CUT_SHARE = 0.10
LOST_SHARE = 0.10

CSV_COLUMNS = [
    # the research pipeline's columns, in its order
    "file", "row", "col", "date", "genotype", "canopy_area_cm2", "canopy_area_m2",
    # what the platform adds
    "plot_id", "rep", "box_area_m2", "box_canopy_m2", "cover_pct", "gain_m2", "cut_by_reach_m2",
    "lost_to_neighbour_m2", "confidence", "flag", "model_id", "model_version", "result_version",
]  # fmt: skip

# 5 main colours, assigned so grid neighbours never share one, plus spares for
# irregular grids. No greens (canopy), white (box outlines) or dark grey (not counted).
PALETTE = np.array(
    [[255, 0, 255], [0, 220, 255], [255, 235, 0], [255, 120, 0], [60, 90, 255], [170, 70, 255], [255, 90, 150], [0, 160, 160]],
    dtype=np.float32,
)
NOT_COUNTED = np.array([70, 70, 70], np.float32)
BOX_OUTLINE = np.array([255, 0, 0], np.uint8)
BLANK_OUTLINE = np.array([150, 150, 150], np.uint8)


def plot_confidence(prob: np.ndarray, valid: np.ndarray, boxes: np.ndarray, n: int) -> np.ndarray:
    """Mean |2p − 1| over each box's pixels with data (index 0 unused)."""
    sure = np.abs(prob.astype(np.float32) * (2 / 255) - 1)
    inside = boxes.ravel() * valid.ravel()
    total = np.bincount(inside, weights=sure.ravel(), minlength=n + 1)[: n + 1]
    count = np.bincount(inside, minlength=n + 1)[: n + 1]
    return np.where(count > 0, total / np.maximum(count, 1), 0.0)


def plot_rows(result: Assignment, pixel_area_cm2: float, confidence: np.ndarray, *, date: str, site: str) -> list[dict]:
    """One dict per reported plot with pixels in the field, sorted by row and column."""
    rows = []
    tag = f"{date[5:7]}-{date[8:10]}-{date[2:4]}"  # YYYY-MM-DD -> MM-DD-YY, as the clip names had it
    for k, plot in enumerate(result.plots, start=1):
        box_px = int(result.box_px[k])
        if box_px == 0:
            continue
        box_canopy_px, region_px = int(result.box_canopy_px[k]), int(result.region_px[k])
        area_cm2 = region_px * pixel_area_cm2
        box_canopy_cm2 = box_canopy_px * pixel_area_cm2
        cover = 100 * box_canopy_px / box_px
        cut_m2 = int(result.cut_px[k]) * pixel_area_cm2 / 1e4
        lost_m2 = int(result.lost_px[k]) * pixel_area_cm2 / 1e4
        geno = plot.genotype if plot.genotype is not None else "nan"
        name = f"r{plot.row}_c{plot.col}_{geno}_{site}_{tag}" if plot.row is not None and plot.col is not None else f"{plot.plot_id}_{site}_{tag}"

        flags = []
        conf = float(confidence[k])
        if cover < NEAR_ZERO_COVER:
            flags.append("near-zero")
        if conf < LOW_CONFIDENCE:
            flags.append("low-confidence")
        if area_cm2 > 0 and cut_m2 * 1e4 > CUT_SHARE * area_cm2:
            flags.append("cut-by-reach")
        if box_canopy_cm2 > 0 and lost_m2 * 1e4 > LOST_SHARE * box_canopy_cm2:
            flags.append("lost-to-neighbour")
        if cover > SATURATED_COVER:
            flags.append("saturated")

        rows.append(
            {
                "plotId": plot.plot_id,
                "file": name,
                "row": plot.row,
                "col": plot.col,
                "genotype": plot.genotype,
                "rep": plot.rep,
                "areaCm2": round(area_cm2, 1),
                "areaM2": round(area_cm2 / 1e4, 4),
                "boxAreaM2": round(box_px * pixel_area_cm2 / 1e4, 4),
                "boxCanopyM2": round(box_canopy_cm2 / 1e4, 4),
                "cover": round(cover, 2),
                "gainM2": round((area_cm2 - box_canopy_cm2) / 1e4, 4),
                "cutByReachM2": round(cut_m2, 4),
                "lostToNeighbourM2": round(lost_m2, 4),
                "neighbours": [result.plots[j - 1].plot_id for j in result.neighbours.get(k, [])],
                "bareCentre": k in result.bare_centre,
                "confidence": round(conf, 3),
                "flags": flags,
                "flag": flags[0] if flags else None,
                "flagLabel": FLAG_LABELS[flags[0]] if flags else None,
                "qc": "pending" if flags else "passed",  # "accepted" and "rejected" are a reviewer's
            }
        )
    rows.sort(key=lambda r: (r["row"] if r["row"] is not None else 1 << 30, r["col"] if r["col"] is not None else 1 << 30, r["plotId"]))
    return rows


def summarize(rows: list[dict], result: Assignment, pixel_area_cm2: float) -> dict:
    flagged = sum(1 for r in rows if r["flag"])
    canopy_m2 = float(result.canopy.sum()) * pixel_area_cm2 / 1e4
    counted_m2 = sum(r["areaCm2"] for r in rows) / 1e4
    by_flag: dict[str, int] = {}
    for r in rows:
        if r["flag"]:
            by_flag[r["flag"]] = by_flag.get(r["flag"], 0) + 1
    return {
        "plots": len(rows),
        "meanCover": round(float(np.mean([r["cover"] for r in rows])), 2) if rows else 0.0,
        "meanAreaM2": round(float(np.mean([r["areaM2"] for r in rows])), 4) if rows else 0.0,
        "canopyCountedM2": round(counted_m2, 2),
        "canopyInViewM2": round(canopy_m2, 2),
        "flaggedTotal": flagged,
        "byFlag": by_flag,
        # Review state, in the Review page's terms. Until reviews are stored,
        # every flagged plot is pending and nothing is reviewed or audited.
        "pending": flagged,
        "pendingFlags": flagged,
        "audit": 0,
        "accepted": 0,
        "edited": 0,
        "rejected": 0,
        "blankPlots": result.blank_count,
        "bareCentre": len(result.bare_centre),
        "gapM": round(result.gap_m, 3),
        "reachAlongM": round(result.reach_along_m, 3),
        "reachAcrossM": round(result.reach_across_m, 3),
    }


def to_csv(rows: list[dict], *, date: str, model_id: str, model_version: str, result_version: int) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(CSV_COLUMNS)
    for r in rows:
        w.writerow(
            [
                r["file"], r["row"], r["col"], date, r["genotype"] if r["genotype"] is not None else "", r["areaCm2"], r["areaM2"],
                r["plotId"], r["rep"] or "", r["boxAreaM2"], r["boxCanopyM2"], r["cover"], r["gainM2"], r["cutByReachM2"],
                r["lostToNeighbourM2"], r["confidence"], r["flag"] or "", model_id, model_version, result_version,
            ]
        )  # fmt: skip
    return out.getvalue()


# ---------------------------------------------------------------------------
# the overlay picture
# ---------------------------------------------------------------------------
def _outline(mask: np.ndarray, width: int = 1) -> np.ndarray:
    from scipy import ndimage

    e = mask.copy()
    e[1:] &= mask[:-1]
    e[:-1] &= mask[1:]
    e[:, 1:] &= mask[:, :-1]
    e[:, :-1] &= mask[:, 1:]
    edge = mask & ~e
    if width > 1:
        edge = ndimage.binary_dilation(edge, iterations=width - 1)
    return edge


def assign_colours(result: Assignment, near_m: float) -> dict[int, int]:
    """Colour index per plot label. (col + 2·row) % 5 differs between all eight
    grid neighbours; geometry and touching regions are checked too, and a clash
    moves to the next free colour."""
    import shapely

    n = len(result.plots)
    geoms = np.array([p.geometry for p in result.plots], dtype=object)
    adj: dict[int, set[int]] = {k: set() for k in range(1, n + 1)}
    for i in range(n):
        d = shapely.distance(geoms, geoms[i])
        for j in np.nonzero(d <= near_m)[0]:
            if j != i:
                adj[i + 1].add(int(j) + 1)
    for a, nbs in result.neighbours.items():
        for b in nbs:
            adj[a].add(b)
            adj[b].add(a)
    colour: dict[int, int] = {}
    for k in range(1, n + 1):
        plot = result.plots[k - 1]
        used = {colour[j] for j in adj[k] if j in colour}
        pref = (plot.col + 2 * plot.row) % 5 if plot.row is not None and plot.col is not None else (k - 1) % 5
        if pref not in used:
            colour[k] = pref
        else:
            free = [c for c in range(len(PALETTE)) if c not in used]
            colour[k] = free[0] if free else pref
    return colour


def render_overlay(rgb: np.ndarray, valid: np.ndarray, result: Assignment, blank_mask: np.ndarray | None = None, *, step: int = 1) -> np.ndarray:
    """The field with each plot's canopy in its own colour, canopy nobody got in
    dark grey, plot boxes outlined in red and blank boxes in grey, as the research
    watershed PNG. `rgb` and `valid` may be every `step`th pixel of the field,
    to keep a large field's picture small; the result's arrays are taken the same way."""
    ws = result.regions[::step, ::step]
    canopy = result.canopy[::step, ::step]
    boxes = result.boxes[::step, ::step]
    colour = assign_colours(result, 2.5 * result.gap_m)
    ov = rgb.astype(np.float32)
    lut = np.zeros((max(int(ws.max()) if ws.size else 0, len(result.plots)) + 1, 3), np.float32)
    for k, c in colour.items():
        lut[k] = PALETTE[c]
    reg = ws > 0
    ov[reg] = 0.35 * ov[reg] + 0.65 * lut[ws[reg]]
    free = canopy & (ws == 0)
    ov[free] = 0.4 * ov[free] + 0.6 * NOT_COUNTED
    ov = ov.astype(np.uint8)
    ov[_outline(boxes > 0, 2)] = BOX_OUTLINE
    if blank_mask is not None:
        ov[_outline(blank_mask[::step, ::step], 2)] = BLANK_OUTLINE
    ov[~valid] = 0
    return ov


def encode_image(image: np.ndarray, *, max_side: int = 2000, fmt: str = "WEBP", quality: int = 75) -> bytes:
    """An overlay sized for the browser: at most `max_side` px on its long side."""
    from PIL import Image

    img = Image.fromarray(image)
    if max(img.size) > max_side:
        scale = max_side / max(img.size)
        img = img.resize((max(1, int(img.size[0] * scale)), max(1, int(img.size[1] * scale))), Image.Resampling.BOX)
    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=quality)
    return buf.getvalue()
