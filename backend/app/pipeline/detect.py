"""
Step 1: find the canopy. The U-Net runs over the whole field, not plot by plot,
so plants are seen with their real surroundings rather than cut at the box edge.

Ported from `full_predict_ortho.py`, with the same numbers:

- The field is the plot grid's bounding box plus 3 m of orthophoto on every
  side, snapped to whole pixels. Outside the orthophoto, and wherever its alpha
  band is 0, pixels are black, as in the clips the model was trained on.
- The model sees 128 px tiles at the orthophoto's own pixel size, every 64 px
  (half a tile), so each pixel is predicted up to four times; the predictions
  are averaged. The last tile in each direction is moved back to end exactly at
  the edge.
- Input is RGB divided by 255 with ImageNet normalisation; output is a sigmoid.
  The probability raster stores it as 0–255; canopy is 128 and above.

Two things differ, neither changing a number:

- Memory. The research script normalised and accumulated the whole field at
  once: about 16 bytes a pixel, 6 GB for a 20,000 px square field. Here the
  tiles are taken eight rows of tiles at a time, in the same order, and every
  pixel row is finished as soon as no later tile can reach it, so memory follows
  the field's width, not its area. Only the 1-byte result is kept whole.
- Pixel size. The model was trained at about 2.3 cm. An orthophoto more than
  1.5 times finer than that (a low flight, or a high-resolution camera) is read
  at close to the model's pixel size instead, each pixel the mean of a whole
  block of the orthophoto's (3 × 3 for 0.77 cm), which is also what keeps a
  multi-gigabyte orthophoto's field to a size a job can hold. The result records it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import numpy as np

TILE = 128  # model input size, in pixels
STRIDE = 64  # tile step: 50% overlap
BATCH = 32  # tiles per forward pass
TILE_ROWS_PER_STRIP = 8  # rows of tiles held at once: 8 × 64 = 512 finished pixel rows per strip
FIELD_MARGIN_M = 3.0  # orthophoto kept around the plots, for edge plots' context
THRESHOLD = 0.5
RESAMPLE_WHEN_FINER = 1.5  # read at the model's pixel size when the ortho's is this many times finer

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class DetectError(Exception):
    """A problem with the orthophoto the user can fix."""


@dataclass(frozen=True)
class FieldGrid:
    """The pixel grid every later step works on: the field's window of the
    orthophoto, each grid pixel `factor` × `factor` of the orthophoto's."""

    transform: Any  # affine.Affine
    width: int
    height: int
    crs: Any
    source_gsd_cm: float
    window: Any  # the orthophoto window it covers
    factor: int = 1  # orthophoto pixels per grid pixel, along each side

    @property
    def resampled(self) -> bool:
        return self.factor > 1

    @property
    def gsd_cm(self) -> float:
        return abs(self.transform.a) * 100

    @property
    def pixel_area_cm2(self) -> float:
        return (abs(self.transform.a) * 100) * (abs(self.transform.e) * 100)

    def describe(self) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            "gsdCm": round(self.gsd_cm, 3),
            "sourceGsdCm": round(self.source_gsd_cm, 3),
            "factor": self.factor,
            "transform": list(self.transform)[:6],
            "crs": self.crs.to_string() if self.crs else None,
        }


def check_orthophoto(src) -> None:
    """What the model can read: 8-bit RGB or RGBA, north up, in metres."""
    if src.count not in (3, 4):
        raise DetectError(
            f"The orthophoto has {src.count} bands. The model reads RGB (3 bands) or RGB with alpha (4); "
            "multispectral orthophotos aren't supported yet."
        )
    if src.dtypes[0] != "uint8":
        raise DetectError(f"The orthophoto is {src.dtypes[0]}. The model reads 8-bit RGB; export it as 8-bit.")
    if src.transform.b or src.transform.d:
        raise DetectError("The orthophoto is rotated in its file. Export it north up.")
    if src.crs is None:
        raise DetectError("The orthophoto has no coordinate system.")
    if src.crs.is_geographic:
        raise DetectError(
            "The orthophoto is in latitude and longitude. Areas need a projected coordinate system in metres, "
            "such as the UTM zone of the field; export it in one."
        )


def field_grid(src, plot_bounds, *, model_gsd_cm: float | None = None, margin_m: float = FIELD_MARGIN_M) -> FieldGrid:
    """The field: the plots' bounding box plus `margin_m`, snapped to the
    orthophoto's pixels exactly as the research script did.

    When the orthophoto is much finer than the model's pixel size, each grid
    pixel is the mean of a whole block of orthophoto pixels: the nearest whole
    number of them per side, with blocks aligned to the orthophoto's own grid,
    so nothing is interpolated and an upsampled orthophoto comes back exactly."""
    from affine import Affine
    from rasterio.windows import Window, from_bounds

    minx, miny, maxx, maxy = plot_bounds
    m = margin_m
    window = from_bounds(minx - m, miny - m, maxx + m, maxy + m, src.transform).round_offsets().round_lengths()
    source_gsd_cm = abs(src.transform.a) * 100
    factor = 1
    if model_gsd_cm and source_gsd_cm * RESAMPLE_WHEN_FINER < model_gsd_cm:
        factor = max(1, round(model_gsd_cm / source_gsd_cm))
    if factor == 1:
        transform = src.window_transform(window)
        return FieldGrid(transform, int(window.width), int(window.height), src.crs, source_gsd_cm, window)
    col0, row0 = (int(window.col_off) // factor) * factor, (int(window.row_off) // factor) * factor
    col1 = -(-(int(window.col_off) + int(window.width)) // factor) * factor
    row1 = -(-(int(window.row_off) + int(window.height)) // factor) * factor
    window = Window(col0, row0, col1 - col0, row1 - row0)
    transform = src.window_transform(window) @ Affine.scale(factor)
    return FieldGrid(transform, (col1 - col0) // factor, (row1 - row0) // factor, src.crs, source_gsd_cm, window, factor)


class FieldReader:
    """Rows of the field as RGB (no-data black) plus where the orthophoto has data."""

    def __init__(self, src, grid: FieldGrid):
        self.src, self.grid = src, grid

    def read(self, y0: int, y1: int) -> tuple[np.ndarray, np.ndarray]:
        from rasterio.enums import Resampling
        from rasterio.windows import Window

        g, w, k = self.grid, self.grid.window, self.grid.factor
        window = Window(w.col_off, w.row_off + y0 * k, w.width, (y1 - y0) * k)
        if k == 1:
            data = self.src.read(window=window, boundless=True, fill_value=0)
        else:
            data = self.src.read(
                window=window, out_shape=(self.src.count, y1 - y0, g.width), resampling=Resampling.average, boundless=True, fill_value=0
            )
        rgb = np.transpose(data[:3], (1, 2, 0)).copy()
        valid = data[3] > 0 if data.shape[0] >= 4 else np.ones(rgb.shape[:2], bool)
        rgb[~valid] = 0
        return rgb, valid

    def close(self) -> None:
        pass


def load_model(weights_path, device: str = "cpu"):
    """The handoff's U-Net: ResNet34 encoder, 3 bands in, 1 class out, from a state_dict."""
    import segmentation_models_pytorch as smp
    import torch

    model = smp.Unet(encoder_name="resnet34", encoder_weights=None, in_channels=3, classes=1)
    model.load_state_dict(torch.load(weights_path, map_location=device))
    return model.to(device).eval()


def tile_starts(n: int) -> list[int]:
    """Every STRIDE px, with the last tile moved back to end at the edge."""
    if n <= TILE:
        return [0]
    starts = list(range(0, n - TILE + 1, STRIDE))
    if starts[-1] != n - TILE:
        starts.append(n - TILE)
    return starts


def predict_probability(
    model,
    read_rgb: Callable[[int, int], np.ndarray],
    height: int,
    width: int,
    *,
    device: str = "cpu",
    progress: Callable[[float], None] | None = None,
) -> np.ndarray:
    """The field's canopy probability as uint8 0–255 (HxW).

    `read_rgb(y0, y1)` returns rows y0..y1 of the field as HxWx3 uint8. Tiles
    run in the same order as the research script (row by row, left to right),
    so every pixel adds up the same predictions in the same order."""
    import torch

    pad_h, pad_w = max(0, TILE - height), max(0, TILE - width)
    hp, wp = height + pad_h, width + pad_w
    ys, xs = tile_starts(hp), tile_starts(wp)
    out = np.zeros((height, width), np.uint8)
    total = len(ys) * len(xs)
    done = 0

    carry_sum = carry_count = None  # partial sums for rows the next strip's tiles still reach
    carry_top = 0
    for g in range(0, len(ys), TILE_ROWS_PER_STRIP):
        group = ys[g : g + TILE_ROWS_PER_STRIP]
        top, bottom = group[0], group[-1] + TILE
        rgb = np.zeros((bottom - top, wp, 3), np.uint8)
        if top < height:
            rgb[: min(bottom, height) - top, :width] = read_rgb(top, min(bottom, height))
        norm = (rgb.astype(np.float32) / 255.0 - IMAGENET_MEAN) / IMAGENET_STD
        prob_sum = np.zeros((bottom - top, wp), np.float32)
        count = np.zeros((bottom - top, wp), np.float32)
        if carry_sum is not None:
            rows = carry_sum.shape[0]
            prob_sum[:rows] = carry_sum
            count[:rows] = carry_count
            assert carry_top == top

        coords = [(y, x) for y in group for x in xs]
        with torch.no_grad():
            for i in range(0, len(coords), BATCH):
                batch = coords[i : i + BATCH]
                arr = np.stack([norm[y - top : y - top + TILE, x : x + TILE] for y, x in batch])
                inp = torch.from_numpy(arr).permute(0, 3, 1, 2).to(device)
                pred = torch.sigmoid(model(inp))[:, 0].cpu().numpy()
                for (y, x), p in zip(batch, pred):
                    prob_sum[y - top : y - top + TILE, x : x + TILE] += p
                    count[y - top : y - top + TILE, x : x + TILE] += 1
                done += len(batch)
                if progress:
                    progress(done / total)

        # Rows above the next strip's first tile are final.
        next_top = ys[g + TILE_ROWS_PER_STRIP] if g + TILE_ROWS_PER_STRIP < len(ys) else hp
        final = next_top - top
        stop = min(next_top, height)
        if stop > top:
            prob = prob_sum[: stop - top, :width] / np.maximum(count[: stop - top, :width], 1)
            out[top:stop] = (prob * 255).round().astype(np.uint8)
        carry_sum, carry_count, carry_top = prob_sum[final:].copy(), count[final:].copy(), next_top
    return out


def detect_canopy(src, grid: FieldGrid, model, *, device: str = "cpu", progress=None) -> np.ndarray:
    """Runs the model over the field. Returns the uint8 probability raster on `grid`."""
    reader = FieldReader(src, grid)
    try:
        return predict_probability(model, lambda y0, y1: reader.read(y0, y1)[0], grid.height, grid.width, device=device, progress=progress)
    finally:
        reader.close()


def write_probability(path, prob: np.ndarray, grid: FieldGrid) -> None:
    """The probability raster as a georeferenced, tiled, DEFLATE GeoTIFF (0–255)."""
    import rasterio

    profile = dict(
        driver="GTiff",
        height=grid.height,
        width=grid.width,
        count=1,
        dtype="uint8",
        crs=grid.crs,
        transform=grid.transform,
        compress="deflate",
        tiled=True,
        blockxsize=512,
        blockysize=512,
    )
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(prob, 1)


def read_probability(path) -> tuple[np.ndarray, Any, Any]:
    """(probability, transform, crs) of a raster written by write_probability."""
    import rasterio

    with rasterio.open(path) as src:
        return src.read(1), src.transform, src.crs
