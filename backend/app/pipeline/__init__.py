"""
The image work behind processing a flight: an orthophoto and its plot grid in,
canopy area per plot out. Ported from the lab's research pipeline
(`full_predict_ortho.py` and `full_predict_watershed.py` in the yam canopy model
handoff) and checked against that handoff's expected outputs.

    grid.py    the plot grid: each polygon's identity, the user's grid nudge, the CRS
    detect.py  step 1, find canopy: the U-Net over the whole field in overlapping
               tiles, averaged into a canopy probability raster
    assign.py  step 2, decide which plot owns it: a seeded watershed from each
               plot's centre through connected canopy, with a reach limit
    report.py  per-plot numbers, QC flags, the CSV, the overlay picture

Nothing here knows about Firestore, buckets or HTTP: functions take arrays and
paths and return arrays and dataclasses, so each step is tested on its own and
any job can import them. `app/process.py` is the Cloud Run job that wires them
to a flight.

Imports of PyTorch, scikit-image and geopandas happen inside the functions that
need them. The API imports this package's names (for settings and model
records) without those libraries installed: they live in the processing job's
image only (Dockerfile.process).
"""
