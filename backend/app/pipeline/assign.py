"""
Step 2: decide which plot owns each patch of canopy. The model doesn't run here,
so this step takes seconds and can be rerun on its own.

Ported from `full_predict_watershed.py` with its settings as shipped, all on
except the field boundary (layer 3), which the lab turned off:

1. Canopy is probability ≥ 128 (0.5) where the orthophoto has data.
2. Seeds. Each plot's flood starts from the centre of its box (the box shrunk
   by 20% of its short side on every edge), or from the whole box when the
   centre is bare.
3. Flood. Water spreads from every seed at once, through canopy only, thickest
   canopy first (a distance landscape), so touching plants split at their
   narrowest link. Canopy no seed reaches (weeds, border grass) isn't counted.
4. Reach. A plot can't keep canopy farther past its box's end than the date's
   median gap between boxes along the row, or farther past its side than the
   median gap across the row: an ellipse-cornered limit, measured from the boxes.
5. Blank boxes (a mapped genotype that is empty) flood like any plot, so their
   neighbours can't take the grass around them, but what they win is dropped.
6. Canopy inside a plot's own box that no real plot ended up with stays that
   plot's. A neighbour that really owns it keeps it, and the plot's report says
   how much it lost.

The numbers each plot gets (box, assigned, cut by the reach limit, lost to a
neighbour) are the ones the research CSV carried, so a result can be checked
against that pipeline column by column.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np

from .grid import Plot


@dataclass(frozen=True)
class WatershedSettings:
    """The research script's switches, defaulting to how the lab ran it.
    Stored with every result, so a number can be traced to how it was made."""

    threshold: float = 0.5
    territory_cap: bool = True
    reach_factor: float = 1.0
    skip_blank_plots: bool = True  # layer 1
    blank_plots_compete: bool = True  # layer 2
    field_boundary: bool = False  # layer 3: off, it cut real canopy on staggered edge plots
    field_margin_factor: float = 0.5
    core_seeds: bool = True  # layer 4
    core_shrink: float = 0.2
    distance_landscape: bool = True  # layer 4
    directional_reach: bool = True  # layer 5

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Assignment:
    """What the watershed decided. Arrays are indexed by plot label: 1..n for the
    reported plots in `plots` order, 0 for nobody."""

    plots: list[Plot]  # reported plots; plots[k - 1] has label k
    regions: np.ndarray  # HxW int32: the plot each canopy pixel went to, 0 = not counted
    boxes: np.ndarray  # HxW int32: each plot's own box
    canopy: np.ndarray  # HxW bool
    box_px: np.ndarray
    box_canopy_px: np.ndarray
    region_px: np.ndarray
    cut_px: np.ndarray  # reached, but beyond the reach limit
    lost_px: np.ndarray  # inside the box, but a neighbour owns it
    neighbours: dict[int, list[int]]
    bare_centre: set[int]  # seeded from the whole box: no canopy at its centre
    blank_count: int
    blank_held_px: int
    gap_m: float
    reach_along_m: float
    reach_across_m: float
    messages: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# box geometry (verbatim from the research script)
# ---------------------------------------------------------------------------
def box_frame(geom):
    """Centre, unit long axis, unit short axis, half length, half width of a (near-)rectangular box."""
    rect = geom.minimum_rotated_rectangle
    xs, ys = rect.exterior.coords.xy
    e1 = np.array([xs[1] - xs[0], ys[1] - ys[0]])
    e2 = np.array([xs[2] - xs[1], ys[2] - ys[1]])
    l1, l2 = np.hypot(*e1), np.hypot(*e2)
    ax = e1 / l1 if l1 >= l2 else e2 / l2
    if ax[0] < 0 or (ax[0] == 0 and ax[1] < 0):
        ax = -ax
    c = np.array(rect.centroid.coords[0])
    return c, ax, np.array([-ax[1], ax[0]]), max(l1, l2) / 2, min(l1, l2) / 2


def directional_gaps(geoms) -> tuple[float | None, float | None]:
    """Median gap end-to-end (along the box's long axis) and side-to-side (across
    it), from every box's nearest neighbour in that direction."""
    frames = [box_frame(g) for g in geoms]
    C = np.array([f[0] for f in frames])
    axes = np.array([f[1] for f in frames])
    ax = np.median(axes, 0)
    ax /= np.linalg.norm(ax)
    perp = np.array([-ax[1], ax[0]])
    HL = np.array([f[3] for f in frames])
    HW = np.array([f[4] for f in frames])
    along, across = [], []
    for i in range(len(C)):
        d = C - C[i]
        a, b = d @ ax, d @ perp
        same_row = (np.abs(b) < HW[i]) & (a > 0.05)
        same_col = (np.abs(a) < HL[i]) & (b > 0.05)
        if same_row.any():
            j = np.argmin(np.where(same_row, a, np.inf))
            along.append(a[j] - HL[i] - HL[j])
        if same_col.any():
            j = np.argmin(np.where(same_col, b, np.inf))
            across.append(b[j] - HW[i] - HW[j])

    def med(v):
        return float(np.median(v)) if len(v) >= 3 else None

    return med(along), med(across)


def median_gap_m(geoms) -> float:
    """Median distance from each box to its nearest neighbouring box (map units: metres)."""
    import shapely

    arr = np.array(geoms, dtype=object)
    if len(arr) < 2:
        return 0.0
    gaps = []
    for i, g in enumerate(arr):
        d = shapely.distance(arr, g)
        d[i] = np.inf
        gaps.append(d.min())
    return float(np.median(gaps))


def touching_pairs(lab: np.ndarray) -> set[tuple[int, int]]:
    """Label pairs that touch (4-neighbour), a < b, both > 0."""
    pairs: set[tuple[int, int]] = set()
    for a, b in ((lab[:, :-1], lab[:, 1:]), (lab[:-1, :], lab[1:, :])):
        m = (a != b) & (a > 0) & (b > 0)
        if m.any():
            p = np.stack([np.minimum(a[m], b[m]), np.maximum(a[m], b[m])], 1)
            pairs.update(map(tuple, np.unique(p, axis=0).tolist()))
    return pairs


# ---------------------------------------------------------------------------
def assign_canopy(prob: np.ndarray, valid: np.ndarray, transform, plots: list[Plot], settings: WatershedSettings = WatershedSettings()) -> Assignment:
    """Assigns the field's canopy to plots. `prob` is the uint8 probability raster,
    `valid` where the orthophoto has data, `transform` their shared grid, and
    `plots` the grid in that grid's CRS."""
    import shapely
    from rasterio.features import rasterize
    from scipy import ndimage
    from skimage.segmentation import watershed

    s = settings
    H, W = prob.shape
    gsd_x = abs(transform.a)
    messages: list[str] = []

    # 1. canopy, never on no-data
    canopy = (prob >= round(s.threshold * 255)) & valid

    # plot boxes -> labels; blank boxes kept apart
    reported: list[Plot] = []
    shapes, geoms, all_geoms, blank_shapes = [], [], [], []
    for plot in plots:
        all_geoms.append(plot.geometry)  # spacing is measured on every box
        if s.skip_blank_plots and plot.blank:
            blank_shapes.append((plot.geometry, 1))
            continue
        reported.append(plot)
        geoms.append(plot.geometry)
        shapes.append((plot.geometry, len(reported)))
    n = len(reported)
    labels = (
        rasterize(shapes, out_shape=(H, W), transform=transform, fill=0, all_touched=False, dtype="int32")
        if shapes
        else np.zeros((H, W), np.int32)
    )

    gap_m = median_gap_m(all_geoms)
    reach_m = s.reach_factor * gap_m
    reach_px = reach_m / gsd_x
    reach_along_m = reach_across_m = reach_m
    if s.directional_reach and len(all_geoms) >= 2:
        g_al, g_ac = directional_gaps(all_geoms)
        reach_along_m = s.reach_factor * (g_al if g_al is not None else gap_m)
        reach_across_m = s.reach_factor * (g_ac if g_ac is not None else gap_m)
        reach_px = max(reach_along_m, reach_across_m) / gsd_x  # window padding only

    # layer 2: blank boxes join the flood as ghost plots (labels n+1 ...), dropped after the cap
    ghosts = []
    flood_labels = labels
    if s.blank_plots_compete and s.skip_blank_plots and blank_shapes:
        ghosts = [(g, n + i + 1) for i, (g, _) in enumerate(blank_shapes)]
        flood_labels = rasterize(shapes + ghosts, out_shape=(H, W), transform=transform, fill=0, all_touched=False, dtype="int32")
    n_all = int(flood_labels.max()) if flood_labels.any() else n
    all_shapes = shapes + ghosts

    # layer 3: field boundary
    flood_canopy = canopy
    if s.field_boundary and all_geoms:
        field_geom = shapely.convex_hull(shapely.union_all(all_geoms)).buffer(s.field_margin_factor * gap_m)
        field_mask = rasterize([(field_geom, 1)], out_shape=(H, W), transform=transform, fill=0, all_touched=False, dtype="uint8") > 0
        flood_canopy = canopy & field_mask

    # 2. seeds
    bare_centre: set[int] = set()
    if s.core_seeds:
        core_shapes = []
        for g, k in all_shapes:
            rect = g.minimum_rotated_rectangle
            xs, ys = rect.exterior.coords.xy
            sides = [np.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]) for i in range(2)]
            core = g.buffer(-s.core_shrink * min(sides))
            core_shapes.append((core if not core.is_empty else g, k))
        core_labels = (
            rasterize(core_shapes, out_shape=(H, W), transform=transform, fill=0, all_touched=False, dtype="int32")
            if core_shapes
            else np.zeros((H, W), np.int32)
        )
        markers = np.where(flood_canopy, core_labels, 0)
        seeded = np.zeros(n_all + 1, bool)
        seeded[np.unique(markers)] = True
        objects = ndimage.find_objects(flood_labels)
        for k in np.nonzero(~seeded[1:])[0] + 1:
            sl = objects[k - 1] if k - 1 < len(objects) else None
            if sl is None:
                continue
            fb = (flood_labels[sl] == k) & flood_canopy[sl]
            markers[sl][fb] = k
        bare_centre = {int(k) for k in np.nonzero(~seeded[1 : n + 1])[0] + 1}
    else:
        markers = np.where(flood_canopy, flood_labels, 0)

    # 3. flood through canopy only
    if s.distance_landscape:
        landscape = -ndimage.distance_transform_edt(flood_canopy)
    else:
        landscape = np.zeros((H, W), np.float32)
    ws = watershed(landscape, markers=markers, mask=flood_canopy).astype(np.int32)
    del landscape, markers

    # 4. territory cap: drop pixels farther than reach from the plot's own box
    cut_px = np.zeros(n_all + 1, np.int64)
    if s.territory_cap:
        pad = int(np.ceil(reach_px)) + 2
        objs = ndimage.find_objects(flood_labels)
        frames = {k: box_frame(g) for g, k in all_shapes} if s.directional_reach else {}
        for k, sl in enumerate(objs, start=1):
            if sl is None:
                continue
            r0, r1 = max(0, sl[0].start - pad), min(H, sl[0].stop + pad)
            c0, c1 = max(0, sl[1].start - pad), min(W, sl[1].stop + pad)
            sub = ws[r0:r1, c0:c1]
            if s.directional_reach:
                c, ax, pp, hl, hw = frames[k]
                rr, cc = np.mgrid[r0:r1, c0:c1]
                X = transform.c + (cc + 0.5) * transform.a + (rr + 0.5) * transform.b
                Y = transform.f + (cc + 0.5) * transform.d + (rr + 0.5) * transform.e
                a = (X - c[0]) * ax[0] + (Y - c[1]) * ax[1]
                b = (X - c[0]) * pp[0] + (Y - c[1]) * pp[1]
                da = np.maximum(np.abs(a) - hl, 0) / reach_along_m if reach_along_m != 0 else np.where(np.abs(a) > hl, np.inf, 0)
                db = np.maximum(np.abs(b) - hw, 0) / reach_across_m if reach_across_m != 0 else np.where(np.abs(b) > hw, np.inf, 0)
                beyond = (da**2 + db**2) > 1
            else:
                box = flood_labels[r0:r1, c0:c1] == k
                beyond = ndimage.distance_transform_edt(~box) > reach_px
            drop = (sub == k) & beyond
            cut_px[k] = int(drop.sum())
            sub[drop] = 0
        # anything of plot k left outside its padded window is beyond reach too
        far = ws > 0
        for k, sl in enumerate(objs, start=1):
            if sl is None:
                continue
            r0, r1 = max(0, sl[0].start - pad), min(H, sl[0].stop + pad)
            c0, c1 = max(0, sl[1].start - pad), min(W, sl[1].stop + pad)
            far[r0:r1, c0:c1] &= ws[r0:r1, c0:c1] != k
        stray = far & (ws > 0)
        if stray.any():
            cut_px += np.bincount(ws[stray], minlength=n_all + 1)[: n_all + 1]
            ws[stray] = 0

    # layer 2: what the blank ghosts claimed goes to nobody
    blank_held_px = 0
    if n_all > n:
        ghost_px = ws > n
        blank_held_px = int(ghost_px.sum())
        ws[ghost_px] = 0
    cut_px = cut_px[: n + 1]

    # 6. box canopy no real plot ended up with stays with the box's owner
    orphan = canopy & (ws == 0) & (labels > 0)
    ws[orphan] = labels[orphan]

    # box canopy a neighbour took (only possible with core seeds)
    lost_mask = (labels > 0) & canopy & (ws > 0) & (ws != labels)
    lost_px = np.bincount(labels[lost_mask], minlength=n + 1)[: n + 1]

    box_px = np.bincount(labels.ravel(), minlength=n + 1)[: n + 1]
    box_canopy_px = np.bincount(labels.ravel(), weights=canopy.ravel(), minlength=n + 1)[: n + 1].astype(np.int64)
    region_px = np.bincount(ws.ravel(), minlength=n + 1)[: n + 1]

    neighbours: dict[int, list[int]] = {k: [] for k in range(1, n + 1)}
    for a, b in touching_pairs(ws):
        neighbours[a].append(b)
        neighbours[b].append(a)
    for k in neighbours:
        neighbours[k].sort()

    if bare_centre:
        messages.append(f"{len(bare_centre)} plots had no canopy at their centre and were seeded from the whole box.")
    return Assignment(
        plots=reported,
        regions=ws,
        boxes=labels,
        canopy=canopy,
        box_px=box_px,
        box_canopy_px=box_canopy_px,
        region_px=region_px,
        cut_px=cut_px,
        lost_px=lost_px,
        neighbours=neighbours,
        bare_centre=bare_centre,
        blank_count=len(blank_shapes),
        blank_held_px=blank_held_px,
        gap_m=gap_m,
        reach_along_m=reach_along_m,
        reach_across_m=reach_across_m,
        messages=messages,
    )
