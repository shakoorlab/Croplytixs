"""
app/pipeline on small synthetic fields. The real check — against the model
handoff's expected outputs — is scripts/check_pipeline.py, which needs the lab's
data; these tests pin the pieces that port could break.

They need the processing image's libraries (requirements-process.txt and CPU
PyTorch) and are skipped where those aren't installed, as in the API's image.
"""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("geopandas")
pytest.importorskip("skimage")
rasterio = pytest.importorskip("rasterio")

from affine import Affine  # noqa: E402
from rasterio.io import MemoryFile  # noqa: E402
from shapely.geometry import Point, box  # noqa: E402

from app.pipeline import report  # noqa: E402
from app.pipeline.assign import WatershedSettings, assign_canopy, directional_gaps, median_gap_m  # noqa: E402
from app.pipeline.detect import TILE, DetectError, check_orthophoto, field_grid, predict_probability, tile_starts  # noqa: E402
from app.pipeline.grid import Plot, clean_genotype, guess_mapping, identify, nudge, read_plots  # noqa: E402

GSD = 0.023
CRS = "EPSG:32620"  # UTM 20N, Guadeloupe


# ---------------------------------------------------------------------------
# grid
# ---------------------------------------------------------------------------
def test_genotypes_are_named_as_the_clips_were():
    assert clean_genotype(49.0) == "49"
    assert clean_genotype("176") == "176"
    assert clean_genotype("TDa 98/01166") == "TDa 98/01166"
    for blank in (None, float("nan"), "", " nan ", "None"):
        assert clean_genotype(blank) == "nan"


def test_identity_by_row_and_column_or_by_plot_id():
    grid = {"identity": "grid", "row": "row", "col": "col", "genotype": "var"}
    assert identify({"row": 3.0, "col": 7, "var": 12.0}, grid, 0) == ("3-7", 3, 7, "12", None, False)
    assert identify({"row": None, "col": 7, "var": 1}, grid, 0) is None  # no row: left out, as the research scripts did
    assert identify({"row": 1, "col": 2, "var": None}, grid, 0)[5] is True  # blank genotype: a filler box

    single = {"identity": "single", "plot_id": "PLOT", "genotype": ""}
    assert identify({"PLOT": "A-12"}, single, 4) == ("A-12", None, None, None, None, False)
    assert identify({}, single, 4)[0] == "005"  # no id: numbered in file order
    # No genotype column mapped: no plot is blank.
    assert identify({"PLOT": "x"}, single, 0)[5] is False


def test_mapping_is_guessed_like_the_upload_page():
    assert guess_mapping(["row", "col", "var"]) == {
        "identity": "grid", "plot_id": "", "row": "row", "col": "col", "genotype": "var", "rep": ""
    }  # fmt: skip
    assert guess_mapping(["PLOT_NO", "Genotype", "Rep"])["plot_id"] == "PLOT_NO"


def test_nudge_moves_east_and_south_and_turns_clockwise():
    p = Point(0, 10)  # north of the centre
    turned = nudge(p, {"rotDeg": 90}, (0, 0))
    assert turned.x == pytest.approx(10) and turned.y == pytest.approx(0)  # clockwise: north → east
    moved = nudge(Point(0, 0), {"dxCm": 50, "dyCm": 20}, (0, 0))
    assert (moved.x, moved.y) == pytest.approx((0.5, -0.2))  # 50 cm east, 20 cm south
    assert nudge(p, None, (0, 0)) is p


def write_grid(path, rows=2, cols=3, crs=CRS, extra=None):
    import geopandas as gpd

    records = []
    for r in range(rows):
        for c in range(cols):
            x0, y0 = 1.0 + c * 1.4, 1.0 + r * 1.4
            records.append({"row": r + 1, "col": c + 1, "var": float(10 * r + c), "geometry": box(x0, y0, x0 + 0.92, y0 + 0.46)})
    records += extra or []
    gpd.GeoDataFrame(records, crs="EPSG:32620").to_crs(crs).to_file(path)
    return path


def test_read_plots_reprojects_and_keeps_every_polygon_in_the_bounds(tmp_path):
    shp = write_grid(tmp_path / "grid.shp", crs="EPSG:4326", extra=[{"row": None, "col": None, "var": 1.0, "geometry": box(9, 9, 9.5, 9.5)}])
    grid = read_plots(shp, "EPSG:32620", mapping={"identity": "grid", "row": "row", "col": "col", "genotype": "var"})
    assert [p.plot_id for p in grid.plots][:3] == ["1-1", "1-2", "1-3"]
    assert grid.left_out == 1
    assert grid.plots[0].geometry.bounds == pytest.approx((1.0, 1.0, 1.92, 1.46), abs=1e-4)
    assert grid.bounds[2] == pytest.approx(9.5, abs=1e-4)  # the unidentified polygon still sizes the field


def test_read_plots_without_a_mapping_guesses_one(tmp_path):
    grid = read_plots(write_grid(tmp_path / "grid.shp"), CRS)
    assert grid.mapping["identity"] == "grid" and grid.plots[4].genotype == "11"


# ---------------------------------------------------------------------------
# detect
# ---------------------------------------------------------------------------
def test_tiles_end_exactly_at_the_edge():
    assert tile_starts(100) == [0]
    assert tile_starts(128) == [0]
    assert tile_starts(300) == [0, 64, 128, 172]
    assert tile_starts(320) == [0, 64, 128, 192]


def research_predict_field(model, rgb):
    """full_predict_ortho.py's predict_field, verbatim but for the constants."""
    import torch

    from app.pipeline.detect import BATCH, IMAGENET_MEAN, IMAGENET_STD

    H, W = rgb.shape[:2]
    pad_h, pad_w = max(0, TILE - H), max(0, TILE - W)
    if pad_h or pad_w:
        rgb = np.pad(rgb, ((0, pad_h), (0, pad_w), (0, 0)))
    Hp, Wp = rgb.shape[:2]
    norm = (rgb.astype(np.float32) / 255.0 - IMAGENET_MEAN) / IMAGENET_STD
    prob_sum = np.zeros((Hp, Wp), np.float32)
    count = np.zeros((Hp, Wp), np.float32)
    coords = [(y, x) for y in tile_starts(Hp) for x in tile_starts(Wp)]
    with torch.no_grad():
        for i in range(0, len(coords), BATCH):
            batch = coords[i : i + BATCH]
            arr = np.stack([norm[y : y + TILE, x : x + TILE] for y, x in batch])
            out = torch.sigmoid(model(torch.from_numpy(arr).permute(0, 3, 1, 2)))[:, 0].numpy()
            for (y, x), p in zip(batch, out):
                prob_sum[y : y + TILE, x : x + TILE] += p
                count[y : y + TILE, x : x + TILE] += 1
    prob = (prob_sum / np.maximum(count, 1))[:H, :W]
    return (prob * 255).round().astype(np.uint8)


@pytest.mark.parametrize("shape", [(50, 70), (300, 200), (1100, 700), (1090, 1300)])
def test_strips_give_the_research_scripts_answer(shape):
    torch = pytest.importorskip("torch")
    torch.manual_seed(0)
    # A small conv net: each pixel depends on its neighbours, so tile edges matter.
    model = torch.nn.Sequential(torch.nn.Conv2d(3, 4, 5, padding=2), torch.nn.Tanh(), torch.nn.Conv2d(4, 1, 5, padding=2)).eval()
    rng = np.random.default_rng(1)
    rgb = rng.integers(0, 256, size=(*shape, 3), dtype=np.uint8)
    got = predict_probability(model, lambda y0, y1: rgb[y0:y1], *shape)
    expected = research_predict_field(model, rgb)
    assert got.shape == expected.shape
    assert int(np.abs(got.astype(int) - expected.astype(int)).max()) <= 1


def raster(width, height, gsd, count=4, dtype="uint8", crs=CRS, origin=(0.0, 20.0)):
    mem = MemoryFile()
    ds = mem.open(
        driver="GTiff", width=width, height=height, count=count, dtype=dtype, crs=crs, transform=Affine(gsd, 0, origin[0], 0, -gsd, origin[1])
    )
    ds.write(np.full((count, height, width), 200, dtype=dtype))
    return ds


def test_the_field_is_the_grid_plus_three_metres_snapped_to_pixels():
    with raster(1000, 1000, GSD) as src:
        f = field_grid(src, (5.0, 5.0, 10.0, 10.0))
        assert not f.resampled and f.factor == 1
        assert f.window.col_off == round(2.0 / GSD) and f.width == round(11.0 / GSD)
        assert f.transform.a == pytest.approx(GSD)


def test_a_much_finer_orthophoto_is_read_in_aligned_whole_blocks():
    fine = GSD / 3
    with raster(3000, 3000, fine) as src:
        f = field_grid(src, (5.0, 5.0, 10.0, 10.0), model_gsd_cm=2.3)
        assert f.factor == 3 and f.resampled
        assert f.window.col_off % 3 == 0 and f.window.row_off % 3 == 0 and f.window.width == 3 * f.width
        assert f.gsd_cm == pytest.approx(2.3)
    with raster(1000, 1000, GSD * 0.9) as src:  # close to the model's size: left alone
        assert field_grid(src, (5.0, 5.0, 10.0, 10.0), model_gsd_cm=2.3).factor == 1


@pytest.mark.parametrize(
    "kwargs, words",
    [
        ({"count": 5}, "5 bands"),
        ({"dtype": "uint16"}, "uint16"),
        ({"crs": "EPSG:4326"}, "latitude and longitude"),
    ],
)
def test_orthophotos_the_model_cant_read_are_refused(kwargs, words):
    with raster(64, 64, GSD, **kwargs) as src:
        with pytest.raises(DetectError, match=words):
            check_orthophoto(src)


# ---------------------------------------------------------------------------
# assign
# ---------------------------------------------------------------------------
H, W = 240, 330
TF = Affine(GSD, 0, 0, 0, -GSD, H * GSD)


def px_box(c0, r0, c1, r1):
    """A box in map coordinates from pixel columns/rows (exclusive ends)."""
    x0, y1 = TF @ (c0, r0)
    x1, y0 = TF @ (c1, r1)
    return box(x0, y0, x1, y1)


def grid_plots(blank=()):
    """2 rows × 3 columns of 40 × 20 px boxes, 20 px apart along the row and 40 across."""
    plots = []
    for r in range(2):
        for c in range(3):
            c0, r0 = 60 + c * 60, 60 + r * 60
            plots.append(Plot(px_box(c0, r0, c0 + 40, r0 + 20), f"{r + 1}-{c + 1}", r + 1, c + 1, str(c), None, (r + 1, c + 1) in blank))
    return plots


def disc(prob, cx, cy, radius):
    yy, xx = np.mgrid[0:H, 0:W]
    prob[(xx - cx) ** 2 + (yy - cy) ** 2 <= radius**2] = 255


def run(prob, plots, **settings):
    return assign_canopy(prob, np.ones((H, W), bool), TF, plots, WatershedSettings(**settings))


def label_of(result, plot_id):
    return 1 + [p.plot_id for p in result.plots].index(plot_id)


def test_spacing_is_measured_along_and_across_the_row():
    plots = grid_plots()
    along, across = directional_gaps([p.geometry for p in plots])
    assert along == pytest.approx(20 * GSD) and across == pytest.approx(40 * GSD)
    assert median_gap_m([p.geometry for p in plots]) == pytest.approx(20 * GSD)


def test_touching_plants_split_at_their_narrowest_link():
    prob = np.zeros((H, W), np.uint8)
    disc(prob, 80, 70, 16)  # plant in box 1-1
    disc(prob, 140, 70, 16)  # plant in box 1-2
    prob[69:71, 80:141] = 255  # a 2 px vine joining them
    result = run(prob, grid_plots())
    a, b = label_of(result, "1-1"), label_of(result, "1-2")
    regions = result.regions
    assert (regions[70, 70:90] == a).all() and (regions[70, 130:150] == b).all()
    split = [x for x in range(96, 125) if regions[70, x] != regions[70, x + 1]]
    assert len(split) == 1 and 100 <= split[0] <= 120  # one boundary, in the gap
    assert b in result.neighbours[a]


def test_canopy_past_the_reach_limit_is_dropped_and_counted():
    prob = np.zeros((H, W), np.uint8)
    disc(prob, 200, 130, 12)  # plant in box 2-3
    prob[128:133, 200:330] = 255  # runs on to the field's edge, far past the reach
    result = run(prob, grid_plots())
    k = label_of(result, "2-3")
    assert result.cut_px[k] > 0
    assert (result.regions[130, 250:] == 0).all()
    unlimited = run(prob, grid_plots(), territory_cap=False)
    assert unlimited.region_px[k] > result.region_px[k]


def test_a_blank_box_competes_but_is_never_reported():
    prob = np.zeros((H, W), np.uint8)
    disc(prob, 80, 130, 14)  # plant in blank box 2-1
    disc(prob, 140, 130, 14)  # plant in box 2-2
    prob[129:132, 80:141] = 255
    result = run(prob, grid_plots(blank={(2, 1)}))
    assert "2-1" not in [p.plot_id for p in result.plots] and result.blank_count == 1
    k = label_of(result, "2-2")
    assert (result.regions[130, 70:95] != k).all()  # its neighbour can't take the blank box's plant
    assert result.blank_held_px > 0


def test_box_canopy_cut_off_from_the_centre_stays_with_its_box():
    prob = np.zeros((H, W), np.uint8)
    disc(prob, 200, 70, 8)  # the plant at the centre of box 1-3
    prob[60:63, 180:183] = 255  # a speck in the box's corner, not connected
    result = run(prob, grid_plots())
    assert result.regions[61, 181] == label_of(result, "1-3")


def test_a_bare_centre_seeds_from_the_whole_box():
    prob = np.zeros((H, W), np.uint8)
    prob[60:64, 60:100] = 255  # canopy only along box 1-1's edge
    result = run(prob, grid_plots())
    k = label_of(result, "1-1")
    assert k in result.bare_centre and result.region_px[k] > 0


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------
def test_rows_flags_summary_and_csv():
    prob = np.zeros((H, W), np.uint8)
    disc(prob, 80, 70, 14)
    prob[120:140, 60:100] = 255  # box 2-1 completely covered
    prob[120:140, 120:160] = 128  # box 2-2: canopy, but the model was unsure of all of it
    result = run(prob, grid_plots())
    conf = report.plot_confidence(prob, np.ones((H, W), bool), result.boxes, len(result.plots))
    rows = report.plot_rows(result, (GSD * 100) ** 2, conf, date="2024-12-12", site="roujol-a")
    by_id = {r["plotId"]: r for r in rows}
    assert by_id["1-2"]["flag"] == "near-zero" and by_id["1-2"]["qc"] == "pending"
    assert by_id["2-1"]["flag"] == "saturated" and by_id["2-1"]["cover"] == 100
    assert by_id["2-2"]["flag"] == "low-confidence" and by_id["2-2"]["confidence"] < 0.01
    assert by_id["1-1"]["flag"] is None and by_id["1-1"]["qc"] == "passed"
    assert by_id["1-1"]["file"] == "r1_c1_0_roujol-a_12-12-24"
    assert by_id["2-1"]["areaM2"] == pytest.approx(800 * GSD**2, abs=1e-4)

    summary = report.summarize(rows, result, (GSD * 100) ** 2)
    assert summary["plots"] == 6 and summary["pending"] == summary["flaggedTotal"] == 5

    csv_text = report.to_csv(rows, date="2024-12-12", model_id="m", model_version="1", result_version=3)
    header, first = csv_text.splitlines()[:2]
    assert header.startswith("file,row,col,date,genotype,canopy_area_cm2,canopy_area_m2,")
    assert first.endswith(",m,1,3")


def test_overlay_renders_at_any_step():
    prob = np.zeros((H, W), np.uint8)
    disc(prob, 80, 70, 14)
    result = run(prob, grid_plots())
    rgb = np.full((H, W, 3), 90, np.uint8)
    full = report.render_overlay(rgb, np.ones((H, W), bool), result)
    half = report.render_overlay(rgb[::2, ::2], np.ones((H, W), bool)[::2, ::2], result, step=2)
    assert full.shape == (H, W, 3) and half.shape == (H // 2, W // 2, 3)
    assert (full[70, 80] != 90).any()  # the plant is coloured
    assert report.encode_image(full)[:4] == b"RIFF"  # WebP
