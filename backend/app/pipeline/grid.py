"""
The plot grid: which polygon is which plot, moved to where the user put it.

The upload page records how the shapefile's columns map to plot identity
(`flight.mapping`: one plot-id column, or a row and a column) and genotype, and
any nudge the user gave the whole grid over the ortho (`flight.offset`). Both
are applied here, so every later step works with plots already in the
orthophoto's coordinate system and in their adjusted place.

Identity follows the research scripts where they overlap: row and column are
integers, and a genotype is normalised the way the clip names were (49.0 → "49";
blank, "nan" and "none" → "nan"). A plot whose mapped genotype is blank is an
alley or filler box: the watershed still lets it compete for canopy, so its
neighbours can't claim the weeds around it, but it is never reported.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

BLANK_GENOTYPES = {"", "nan", "none", "null"}

# The upload page's guesses (frontend flight-date-setup.jsx, FIELD_HINTS), for a
# flight recorded without a mapping.
_HINTS = {
    "plot_id": [r"^plot[_ ]?(no|id|num)?$", r"parcelle", r"^id$", r"plot"],
    "row": [r"^row$", r"^ligne$", r"^rang$"],
    "col": [r"^col(umn)?$", r"^range$", r"^colonne$"],
    "genotype": [r"^geno(type)?$", r"^var(iety)?$", r"accession", r"entry", r"cultivar"],
    "rep": [r"^rep(licate)?$", r"^block$", r"^bloc$"],
}


class GridError(Exception):
    """A problem with the plot grid the user can fix."""


@dataclass
class Plot:
    geometry: Any  # shapely geometry, in the orthophoto's CRS, nudge applied
    plot_id: str
    row: int | None
    col: int | None
    genotype: str | None  # None when no genotype column is mapped
    rep: str | None
    blank: bool  # a genotype column is mapped and this plot's value is empty

    @property
    def ref(self) -> str:
        """How the research outputs name a plot: r5_c8, or the plot id without a row and column."""
        return f"r{self.row}_c{self.col}" if self.row is not None and self.col is not None else self.plot_id


def guess_mapping(columns: list[str]) -> dict[str, str]:
    """The upload page's column guesses, for a flight that was recorded without them."""

    def pick(key: str) -> str:
        for pattern in _HINTS[key]:
            for name in columns:
                if re.search(pattern, name, re.IGNORECASE):
                    return name
        return ""

    plot_id, row, col = pick("plot_id"), pick("row"), pick("col")
    return {
        "identity": "grid" if not plot_id and row and col else "single",
        "plot_id": plot_id,
        "row": row,
        "col": col,
        "genotype": pick("genotype"),
        "rep": pick("rep"),
    }


def _text(record: dict, column: str | None) -> str | None:
    if not column or column not in record:
        return None
    value = record[column]
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def _integer(text: str | None) -> int | None:
    if text is None:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def clean_genotype(value: Any) -> str:
    """As the research scripts name plots: numbers lose their ".0", blanks become "nan"."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "nan"
    raw = str(value).strip()
    if raw.lower() in BLANK_GENOTYPES:
        return "nan"
    try:
        return str(int(float(raw)))
    except ValueError:
        return raw


def identify(record: dict, mapping: dict, index: int) -> tuple[str, int | None, int | None, str | None, str | None, bool] | None:
    """(plot id, row, col, genotype, rep, blank) for one polygon's attributes, or
    None when the mapping says rows and columns identify plots and this one has none."""
    row = _integer(_text(record, mapping.get("row")))
    col = _integer(_text(record, mapping.get("col")))
    if mapping.get("identity") == "grid":
        if row is None or col is None:
            return None
        plot_id = f"{row}-{col}"
    else:
        plot_id = _text(record, mapping.get("plot_id")) or f"{index + 1:03d}"
    genotype_column = mapping.get("genotype")
    genotype = clean_genotype(record.get(genotype_column)) if genotype_column else None
    blank = genotype == "nan"
    return plot_id, row, col, genotype, _text(record, mapping.get("rep")), blank


def nudge(geometry, offset: dict | None, centre: tuple[float, float]):
    """The upload page's grid nudge, in map units (metres): rotate about the
    orthophoto's centre, then move. dx is east, dy is south and a positive angle
    is clockwise, as the page shows them (an SVG transform over the north-up preview)."""
    if not offset:
        return geometry
    from shapely import affinity

    rot = float(offset.get("rotDeg") or 0)
    dx = float(offset.get("dxCm") or 0) / 100
    dy = float(offset.get("dyCm") or 0) / 100
    if rot:
        geometry = affinity.rotate(geometry, -rot, origin=centre)  # shapely's angles are anticlockwise
    if dx or dy:
        geometry = affinity.translate(geometry, xoff=dx, yoff=-dy)
    return geometry


@dataclass
class Grid:
    plots: list[Plot]  # file order
    left_out: int  # polygons with no usable identity or no geometry
    bounds: tuple[float, float, float, float]  # of every polygon, as the research scripts sized the field
    mapping: dict


def read_plots(shapefile_path, crs, *, mapping: dict | None = None, offset: dict | None = None, centre=(0.0, 0.0)) -> Grid:
    """The grid's plots, in file order, in `crs` (the orthophoto's) with the
    nudge applied."""
    import geopandas as gpd

    try:
        gdf = gpd.read_file(shapefile_path)
    except Exception as exc:  # pyogrio's errors name the temp path; the file name is enough
        raise GridError(f"The plot grid couldn't be read as a shapefile ({type(exc).__name__}). Check all of .shp, .shx, .dbf and .prj are there.") from exc
    if gdf.crs is None:
        raise GridError("The plot grid has no coordinate system. Upload it with its .prj file.")
    if len(gdf) == 0:
        raise GridError("The plot grid has no polygons.")
    columns = [c for c in gdf.columns if c != "geometry"]
    if not mapping or not any(mapping.get(key) for key in ("plot_id", "row", "col")):
        mapping = guess_mapping(columns)
    gdf = gdf.to_crs(crs)
    if offset and any(offset.get(k) for k in ("dxCm", "dyCm", "rotDeg")):
        gdf["geometry"] = [nudge(g, offset, centre) if g is not None else g for g in gdf.geometry]

    plots: list[Plot] = []
    left_out = 0
    for index, (_, r) in enumerate(gdf.iterrows()):
        ident = identify({c: r[c] for c in columns}, mapping, index)
        if ident is None or r.geometry is None or r.geometry.is_empty:
            left_out += 1
            continue
        plot_id, row, col, genotype, rep, blank = ident
        plots.append(Plot(r.geometry, plot_id, row, col, genotype, rep, blank))
    if not plots:
        raise GridError("No polygon in the plot grid has a usable plot identity. Check the column mapping.")
    return Grid(plots, left_out, tuple(float(v) for v in gdf.total_bounds), mapping)
