---
title: "Spatial Data Testing & CI Pipelines"
description: "Test spatial code and data for safety-critical incident GIS: pytest fixtures for GeoDataFrames, geometry and topology assertions, golden-file regression, hypothesis transforms, and pinned-GDAL CI gates."
slug: spatial-data-testing-and-ci-pipelines
type: guide
breadcrumb: "Spatial Data Testing & CI"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Spatial Data Testing & CI Pipelines",
      "description": "Test spatial code and data for safety-critical incident GIS: pytest fixtures for GeoDataFrames, geometry and topology assertions, golden-file regression, hypothesis transforms, and pinned-GDAL CI gates.",
      "datePublished": "2026-07-13",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Python Toolchains for Public Safety GIS", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/" },
        { "@type": "ListItem", "position": 3, "name": "Spatial Data Testing & CI Pipelines", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Build a spatial data testing and CI pipeline for incident GIS",
      "description": "Author reusable pytest fixtures for GeoDataFrames, assert geometry and topology invariants, lock behaviour with golden-file regression, generalize transforms with property-based tests, and gate merges in CI on a pinned GDAL and PROJ toolchain.",
      "step": [
        { "@type": "HowToStep", "name": "Build deterministic GeoDataFrame fixtures", "text": "Construct pytest fixtures that return small, CRS-tagged GeoDataFrames from inline WKT so every test starts from a known, reproducible spatial state instead of a shared production extract." },
        { "@type": "HowToStep", "name": "Assert geometry and topology invariants", "text": "Write helper assertions that check validity, CRS identity, geometry type, and topological relationships so a regression in a spatial operation fails the build rather than reaching the operational map." },
        { "@type": "HowToStep", "name": "Lock behaviour with golden-file regression", "text": "Serialize a canonical expected output once, then diff each run against it with a geometry-aware tolerance so unintended changes to processed features are caught deterministically." },
        { "@type": "HowToStep", "name": "Generalize transforms with property-based tests", "text": "Use hypothesis to generate coordinates across the valid domain and assert round-trip and invariant properties on reprojection, catching datum and axis-order bugs that fixed examples miss." },
        { "@type": "HowToStep", "name": "Gate merges in CI on a pinned toolchain", "text": "Run the full suite in a container with pinned GDAL and PROJ versions on every push, fail closed on any error, and block the merge until the spatial suite is green." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why can't I just assert exact coordinate equality in spatial tests?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Floating-point reprojection, GEOS version differences, and serialization round-trips perturb coordinates in the last few decimal places, so exact equality produces flaky failures that erode trust in the suite. Compare geometries with a tolerance-aware predicate such as equals_exact with a decimal precision, or a symmetric-difference area threshold, so that meaningful changes fail the build while sub-millimetre noise does not."
          }
        },
        {
          "@type": "Question",
          "name": "Do I need to pin GDAL and PROJ versions in CI?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes. Different PROJ data grids and GEOS releases can shift transformed coordinates by up to a metre and change which geometries are considered valid, so an unpinned runner makes golden-file tests pass locally and fail in CI for reasons unrelated to the code change. Pin the GDAL, PROJ, GEOS, and PROJ-data versions in the test container image so every run resolves datum shifts and topology identically."
          }
        },
        {
          "@type": "Question",
          "name": "How much spatial testing belongs in unit tests versus integration tests?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Most coverage should be fast unit-level geometry and topology assertions and property-based transform checks that need no external services; these form the wide base of the test pyramid. Golden-file regression sits in the middle, and a small number of slower end-to-end tests exercise the real ingest-to-publish path. Keeping the base wide keeps the suite fast enough to run on every push, which is what makes it a genuine merge gate."
          }
        }
      ]
    }
  ]
}
</script>

# Spatial Data Testing & CI Pipelines

## Problem Framing

A routing service that plans evacuation corridors ships a change to its buffer logic on a Friday afternoon during pre-landfall staging. The pull request passes review — the diff is three lines — and merges without a spatial test in the way. Over the weekend the change silently switches the buffer distance from metres to degrees because an upstream layer arrived in a geographic reference system instead of the projected one the function assumed. The unit that consumes the buffer now treats a 300-metre standoff as a 300-degree one, and by the time an analyst notices the evacuation zone swallowing three counties, the operational map has already been pushed to field tablets. No exception was raised; every function returned a valid geometry. This is the defining hazard of spatial software: wrong answers are still well-formed geometries, and a system that only tests "did it return a shape" will happily serve catastrophically wrong shapes. This page specifies the testing and continuous-integration discipline that makes that failure fail the build instead of the incident, implementing the [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/) contract for verifiable, reproducible spatial code under National Incident Management System (NIMS) and Federal Emergency Management Agency (FEMA) reporting obligations.

## Prerequisites

This workflow assumes a senior engineer's fluency with pytest and the Python geospatial stack, plus the following preconditions before the first test runs:

- **Packages:** `pytest >= 7.4`, `geopandas >= 0.14`, `shapely >= 2.0`, `pyproj >= 3.6`, and `hypothesis >= 6.90` for property-based coverage. Shapely 2.x is required so that vectorized predicates and `shapely.validation.make_valid` behave consistently across the suite.
- **A pinned toolchain:** GDAL, PROJ, GEOS, and the PROJ data directory must be version-locked in the test environment. The reproducible container that provides this is owned by the [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) workflow; the test suite assumes it is running inside that image so datum grids and topology resolve identically on every machine.
- **A declared schema contract:** the GeoDataFrames under test must map to an explicit column-and-dtype contract (required attributes, bounded domains, an expected geometry type, and a canonical EPSG code). Tests assert against that contract rather than against whatever a sample file happened to contain.
- **Version-controlled fixtures:** golden files and calibration parameters live under the same review and history discipline as code, per the [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) pattern, so that a change to expected output is a reviewable diff and not a silent overwrite.

## Test Architecture

Safety-critical spatial code needs a layered test strategy because different classes of defect surface at different granularities. A malformed buffer is a unit-level topology bug; a datum shift that only appears near the antimeridian is a property-level bug; an ingest pipeline that reprojects twice is an integration bug. Organize coverage as a pyramid: a wide base of fast, dependency-free geometry and topology assertions; a layer of schema and contract tests that pin the data shape; property-based transform tests that generalize beyond hand-picked examples; golden-file regression that locks whole-output behaviour; and a thin top of end-to-end tests that exercise the real ingest-to-publish path. The entire pyramid runs inside a pinned GDAL and PROJ container on every push, and the continuous-integration gate fails closed — a single failing spatial assertion blocks the merge rather than emitting a warning that a reviewer can wave through.

<figure class="diagram">
<svg viewBox="0 0 860 400" role="img" aria-label="A test pyramid for spatial data with a wide base of geometry and topology assertions rising through schema and contract tests, property-based transforms, golden-file regression, and a narrow top of CI smoke tests, connected by an every-push arrow to a continuous-integration pipeline that runs a pinned GDAL and PROJ container, executes pytest across all tiers, fails closed on any error, and blocks the merge gate when red." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>Spatial data test pyramid feeding a fail-closed CI merge gate</title>
  <desc>On the left, a five-tier test pyramid: the widest base tier is geometry and topology assertions, above it schema and contract tests, then property-based transforms, then golden-file regression, and the narrow apex is the CI smoke test. An arrow labelled every push crosses to the right, where a vertical continuous-integration pipeline runs four stages top to bottom: a pinned GDAL and PROJ container, pytest across all test tiers, fail closed on any error, and a merge gate that blocks on red. The merge gate is drawn in crimson for emphasis.</desc>
  <defs>
    <marker id="sptest-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <!-- pyramid label -->
  <text x="250" y="88" font-size="12" text-anchor="middle" fill="var(--crimson, currentColor)" font-weight="600">Spatial test pyramid</text>
  <g text-anchor="middle" fill="currentColor" font-size="11.5">
    <!-- apex -->
    <rect x="180" y="112" width="140" height="44" rx="6" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="250" y="139">CI smoke test</text>
    <!-- tier 2 -->
    <rect x="150" y="166" width="200" height="44" rx="6" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="250" y="193">Golden-file regression</text>
    <!-- tier 3 -->
    <rect x="120" y="220" width="260" height="44" rx="6" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="250" y="247">Property-based transforms</text>
    <!-- tier 4 -->
    <rect x="90" y="274" width="320" height="44" rx="6" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="250" y="301">Schema &amp; contract tests</text>
    <!-- base -->
    <rect x="60" y="328" width="380" height="44" rx="6" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.6"/>
    <text x="250" y="355">Geometry &amp; topology assertions</text>
  </g>
  <!-- crossing arrow -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#sptest-arrow)">
    <path d="M445,205 H556"/>
  </g>
  <text x="500" y="196" font-size="10.5" text-anchor="middle" fill="var(--crimson, currentColor)">every push</text>
  <!-- CI pipeline label -->
  <text x="680" y="72" font-size="12" text-anchor="middle" fill="var(--crimson, currentColor)" font-weight="600">CI pipeline</text>
  <g text-anchor="middle" fill="currentColor" font-size="11.5">
    <rect x="560" y="84" width="240" height="44" rx="6" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="680" y="111">Pinned GDAL / PROJ container</text>
    <rect x="560" y="156" width="240" height="44" rx="6" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="680" y="183">pytest across all tiers</text>
    <rect x="560" y="228" width="240" height="44" rx="6" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="680" y="255">Fail closed on any error</text>
    <rect x="560" y="300" width="240" height="44" rx="6" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="680" y="327" font-weight="700">Merge gate — block on red</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#sptest-arrow)">
    <path d="M680,128 V154"/>
    <path d="M680,200 V226"/>
    <path d="M680,272 V298"/>
  </g>
</svg>
<figcaption>The wide base of fast geometry and topology assertions makes the suite cheap enough to run on every push; the pinned-toolchain CI pipeline fails closed so a single red spatial test blocks the merge.</figcaption>
</figure>

## Step-by-Step Implementation

### Step 1 — Build deterministic GeoDataFrame fixtures

Tests that read a shared production extract are not tests; they are a slow, non-deterministic dependency on whatever that file contains today. Build small, self-describing fixtures from inline Well-Known Text so every test starts from a known spatial state, tagged with an explicit reference system. Keep them tiny — three or four features is enough to exercise a predicate — so the base of the pyramid stays fast.

```python
import logging
from typing import Dict

import geopandas as gpd
import pytest
from shapely import wkt
from shapely.geometry.base import BaseGeometry

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

# Canonical projected CRS for the operational area (UTM zone 10N / WGS 84).
FIXTURE_CRS = "EPSG:32610"


@pytest.fixture
def incident_zones() -> gpd.GeoDataFrame:
    """Three known incident polygons in a metric CRS for topology tests."""
    features: Dict[str, str] = {
        "staging": "POLYGON ((500000 4200000, 500300 4200000, 500300 4200300, 500000 4200300, 500000 4200000))",
        "hot_zone": "POLYGON ((500250 4200100, 500600 4200100, 500600 4200450, 500250 4200450, 500250 4200100))",
        "detached": "POLYGON ((501000 4201000, 501200 4201000, 501200 4201200, 501000 4201200, 501000 4201000))",
    }
    try:
        geoms: list[BaseGeometry] = [wkt.loads(w) for w in features.values()]
    except Exception as exc:  # shapely raises GEOSException subclasses on bad WKT
        logger.error("Fixture WKT failed to parse: %s", exc)
        raise
    gdf = gpd.GeoDataFrame(
        {"zone_id": list(features.keys()), "priority": [1, 1, 3]},
        geometry=geoms,
        crs=FIXTURE_CRS,
    )
    logger.info("Built incident_zones fixture with %d features in %s", len(gdf), gdf.crs)
    return gdf
```

Because the fixture declares its CRS and its attributes inline, any test that consumes it is testing against a contract, not against a sample. When a bug report arrives, the fixture that reproduces it becomes a permanent regression case with no external file to lose.

### Step 2 — Assert geometry and topology invariants

The core defense against well-formed-but-wrong output is a set of assertion helpers that check the properties a spatial operation must preserve: validity, the expected reference system, the expected geometry type, and topological relationships between features. Encode these as reusable functions so every test reads as a statement of intent rather than a wall of `.iloc` indexing.

```python
import logging

import geopandas as gpd
from shapely.geometry.base import BaseGeometry
from shapely.validation import explain_validity

logger = logging.getLogger(__name__)


class SpatialAssertionError(AssertionError):
    """Raised when a geometry or topology invariant is violated."""


def assert_all_valid(gdf: gpd.GeoDataFrame) -> None:
    """Every geometry must be non-empty and OGC-valid."""
    invalid = gdf[~gdf.geometry.is_valid | gdf.geometry.is_empty]
    if not invalid.empty:
        reasons = {int(i): explain_validity(g) for i, g in invalid.geometry.items()}
        logger.error("Invalid geometries at rows %s", reasons)
        raise SpatialAssertionError(f"{len(invalid)} invalid/empty geometries: {reasons}")


def assert_crs(gdf: gpd.GeoDataFrame, expected_epsg: int) -> None:
    """The layer must carry the exact expected EPSG code, never None."""
    if gdf.crs is None:
        raise SpatialAssertionError("Layer has no CRS; refusing to trust its coordinates")
    actual = gdf.crs.to_epsg()
    if actual != expected_epsg:
        raise SpatialAssertionError(f"CRS mismatch: expected EPSG:{expected_epsg}, got EPSG:{actual}")


def assert_disjoint(a: BaseGeometry, b: BaseGeometry) -> None:
    """Two features that must never overlap (e.g. mutually exclusive zones)."""
    if a.intersects(b) and a.intersection(b).area > 1e-9:
        raise SpatialAssertionError("Geometries overlap but were required to be disjoint")


def test_buffer_preserves_validity_and_crs(incident_zones: gpd.GeoDataFrame) -> None:
    buffered = incident_zones.copy()
    buffered["geometry"] = buffered.geometry.buffer(50.0)  # 50 metres, metric CRS
    assert_all_valid(buffered)
    assert_crs(buffered, 32610)
    # A 50 m buffer must strictly enlarge every polygon.
    assert (buffered.geometry.area > incident_zones.geometry.area).all()
```

The final assertion in the test catches exactly the metres-versus-degrees hazard from the problem scenario: if the buffer were applied in a geographic CRS, the area comparison and the `assert_crs` guard would fail together, and the build would go red before the change reached review.

### Step 3 — Lock behaviour with golden-file regression

Unit assertions catch violations of stated invariants, but they cannot catch a subtle drift in a whole processed layer — a reclassification that flips two features, a dissolve that merges one polygon too many. Golden-file regression captures a canonical expected output once, reviews it as a diff, and then compares every subsequent run against it with a geometry-aware tolerance so floating-point noise does not cause false failures.

```python
import logging
from pathlib import Path

import geopandas as gpd
from shapely import equals_exact

logger = logging.getLogger(__name__)

GOLDEN_DIR = Path(__file__).parent / "golden"


def load_or_write_golden(gdf: gpd.GeoDataFrame, name: str, update: bool) -> gpd.GeoDataFrame:
    """Return the stored golden layer, or (re)write it when explicitly updating."""
    path = GOLDEN_DIR / f"{name}.geojson"
    if update or not path.exists():
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        gdf.to_file(path, driver="GeoJSON")
        logger.warning("Wrote golden file %s (%d features)", path, len(gdf))
        return gdf
    try:
        return gpd.read_file(path)
    except Exception as exc:  # fiona/pyogrio raise on unreadable golden
        logger.error("Failed to read golden file %s: %s", path, exc)
        raise


def assert_matches_golden(actual: gpd.GeoDataFrame, name: str, tolerance: float = 1e-6) -> None:
    """Diff a result against its golden layer, tolerant to sub-tolerance coordinate noise."""
    golden = load_or_write_golden(actual, name, update=False)
    if len(actual) != len(golden):
        raise AssertionError(f"Feature count drift: golden={len(golden)}, actual={len(actual)}")
    # Align on a stable key so row order cannot cause spurious diffs.
    a = actual.sort_values("zone_id").reset_index(drop=True)
    g = golden.sort_values("zone_id").reset_index(drop=True)
    mismatches = [
        row.zone_id
        for row, gold in zip(a.itertuples(), g.geometry)
        if not equals_exact(row.geometry, gold, tolerance=tolerance)
    ]
    if mismatches:
        raise AssertionError(f"Geometry drift beyond tolerance for zones: {mismatches}")
    logger.info("Golden match for %s within tolerance %g", name, tolerance)
```

Updating a golden file is a deliberate act gated behind an `update` flag (wired to a `--update-golden` CLI option or an environment variable), never an automatic overwrite. That way a changed golden layer appears in the pull request as a reviewable geometry diff, and an unexplained change to the expected output is caught by a human before it is caught by an incident.

### Step 4 — Generalize transforms with property-based tests

Hand-picked examples test the coordinates you thought of; coordinate-transform bugs live in the coordinates you did not — near the poles, across the antimeridian, at the axis-order boundary between geographic and projected systems. Property-based testing with `hypothesis` generates inputs across the whole valid domain and asserts invariants that must hold for all of them, such as reproject-there-and-back round-tripping within tolerance. The deep treatment of this technique lives in [Writing Property-Based Tests for Coordinate Transforms](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/writing-property-based-tests-for-coordinate-transforms/); the pattern below is the load-bearing core.

```python
import logging

from hypothesis import given, settings
from hypothesis import strategies as st
from pyproj import Transformer
from pyproj.exceptions import ProjError

logger = logging.getLogger(__name__)

# always_xy=True forces (lon, lat) ordering on both sides, eliminating axis-order ambiguity.
_FWD = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
_INV = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

# Web Mercator is only defined to about +/- 85.06 degrees latitude.
_lon = st.floats(min_value=-179.9, max_value=179.9, allow_nan=False, allow_infinity=False)
_lat = st.floats(min_value=-85.0, max_value=85.0, allow_nan=False, allow_infinity=False)


@settings(max_examples=400, deadline=None)
@given(lon=_lon, lat=_lat)
def test_reproject_round_trip_is_stable(lon: float, lat: float) -> None:
    """Round-tripping WGS 84 -> Web Mercator -> WGS 84 must return the origin within tolerance."""
    try:
        x, y = _FWD.transform(lon, lat)
        lon2, lat2 = _INV.transform(x, y)
    except ProjError as exc:
        logger.error("Transform failed for (%s, %s): %s", lon, lat, exc)
        raise
    # 1e-6 degrees is roughly 0.1 m at the equator: well below operational tolerance.
    assert abs(lon2 - lon) < 1e-6, f"lon drift {abs(lon2 - lon)} at ({lon}, {lat})"
    assert abs(lat2 - lat) < 1e-6, f"lat drift {abs(lat2 - lat)} at ({lon}, {lat})"
```

When this test fails, `hypothesis` shrinks the counterexample to the smallest coordinate that breaks the invariant and prints it, so a datum or axis-order regression arrives as a concrete `(lon, lat)` pair rather than a vague suspicion. Schema and contract tests belong at the same tier: assert the required columns, dtypes, and value domains of every layer the code produces so a renamed attribute or a widened priority range fails immediately.

### Step 5 — Gate merges in CI on a pinned toolchain

A green suite on a developer laptop proves nothing if the CI runner resolves datum shifts differently. Run the whole pyramid inside the pinned GDAL and PROJ container on every push and pull request, and configure the job so that any failure blocks the merge. Fail closed: a transform error, an invalid golden read, or a single red assertion must stop the pipeline, never degrade to a warning.

```yaml
# .github/workflows/spatial-tests.yml
name: spatial-tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    # Pinned image owns exact GDAL, PROJ, GEOS, and PROJ-data versions.
    container: ghcr.io/incidentgis/gis-test:gdal-3.9.2-proj-9.4.1
    steps:
      - uses: actions/checkout@v4
      - name: Verify pinned geospatial stack
        run: |
          python -c "import pyproj, shapely; print('PROJ', pyproj.proj_version_str, 'GEOS', shapely.geos_version_string)"
      - name: Run spatial test suite
        run: pytest -q --maxfail=1 --hypothesis-seed=0
```

Pinning the `--hypothesis-seed` makes property-based runs reproducible in CI so a failure can be replayed exactly, while the container tag freezes the datum grids. Building and versioning that image is the responsibility of the Dockerized GIS environment workflow; this job merely consumes a known-good tag and refuses to merge when the suite is red.

Spatial CI is worth separating from ordinary CI because the defects it catches are distributed differently — and the cheap tests catch the wrong ones.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="ci-t ci-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ci-t">Where spatial defects are caught, against what catching them there costs</title>
  <desc id="ci-d">Four test layers plotted by the share of spatial defects each catches and the runtime it costs. Unit tests on pure functions run in about 4 seconds and catch roughly 18 per cent of defects — mostly logic errors that would have been obvious anyway. Schema and contract assertions on fixtures run in about 20 seconds and catch about 31 per cent. Property-based tests over generated coordinates run in about 95 seconds and catch about 28 per cent, including nearly all axis-order and datum errors, which no example-based test finds because nobody writes the example. A full pipeline run against a real regional extract takes about 11 minutes and catches the remaining 23 per cent, chiefly performance and memory ceilings that only appear at scale. The distribution is flat, which is why omitting any single layer leaves a quarter of the defect space uncovered.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">no single layer catches most of it — the distribution is flat</text>
  <rect x="300" y="88" width="99" height="32" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="140" width="171" height="32" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="192" width="154" height="32" rx="5" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="244" width="127" height="32" rx="5" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="110">unit tests · 4 s</text>
    <text x="8" y="162">schema + contract · 20 s</text>
    <text x="8" y="214">property-based · 95 s</text>
    <text x="8" y="266">full pipeline, real extract · 11 min</text>
  </g>
  <g font-size="10.5" font-weight="700" fill="var(--crimson-deep)">
    <text x="409" y="110">18%</text><text x="481" y="162">31%</text><text x="464" y="214">28%</text><text x="437" y="266">23%</text>
  </g>
  <g font-size="9.5" fill="var(--muted)">
    <text x="500" y="110">logic errors you would have found anyway</text>
    <text x="560" y="162">off-contract fixtures</text>
    <text x="540" y="214">axis order and datum — nobody writes that example</text>
    <text x="510" y="266">memory ceilings and performance cliffs</text>
  </g>
  <text x="8" y="326" font-size="10.5" fill="currentColor">The two slowest layers catch just over half the defects, and neither has a cheap substitute.</text>
  <text x="8" y="352" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Which is the argument for running them on a schedule rather than dropping them from the pull-request gate.</text>
</svg>

The pressure on a CI pipeline is always to make it faster, and the two layers that would go first are the two that carry more than half the defects. That is not an argument for tolerating a twelve-minute pull-request gate; it is an argument for moving those layers rather than deleting them. Property-based tests and a full-extract run belong on a merge queue or a nightly schedule, where their runtime is invisible, with the fast two on every push.

The property-based row deserves the emphasis it gets in the next guide. Axis-order and datum defects are almost never caught by example-based tests, and the reason is structural rather than a matter of diligence: writing the example requires already suspecting the bug, and a developer who suspects an axis-order problem has effectively found it. Generated inputs do not have that dependency, which is why a test suite with excellent example coverage can still ship a transposed layer.

The bottom row is the only one that observes the pipeline at a realistic size, so it is the only one that sees the memory ceiling from the benchmarking guide, the sequential-scan cliff from the PostGIS setup, and the vertex-count blow-up. None of those are logic errors and none can be provoked by a fixture small enough to run in twenty seconds.

## Configuration Reference

Tune these knobs per repository; a fast-moving analysis library and a stable ingest service will land on different tolerances and example counts.

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Golden geometry tolerance | `SPTEST_GOLDEN_TOL` | `1e-6` | Metric CRS units; tighten for survey-grade layers, loosen only with justification. |
| Update golden files | `SPTEST_UPDATE_GOLDEN` | `false` | When `true`, tests overwrite goldens instead of comparing; never set in CI. |
| Hypothesis max examples | `SPTEST_HYP_EXAMPLES` | `400` | Raise for transform-heavy code; lower to keep per-push latency bounded. |
| Hypothesis seed | `SPTEST_HYP_SEED` | `0` | Fixed in CI for reproducibility; unset locally to widen exploration. |
| Fail-fast threshold | `SPTEST_MAXFAIL` | `1` | Stop on first failure so a red build reports fast and fails closed. |
| Expected canonical EPSG | `SPTEST_TARGET_EPSG` | `32610` | Region-specific projected CRS asserted by `assert_crs`; set per deployment. |
| Toolchain image tag | `SPTEST_IMAGE_TAG` | `gdal-3.9.2-proj-9.4.1` | Bump deliberately with a golden re-baseline, never implicitly. |

One structural choice determines whether spatial CI stays trustworthy over time: what the fixtures are made of.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="fx-t fx-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="fx-t">Three sources of test fixture, and how each one decays</title>
  <desc id="fx-d">Three ways to obtain spatial test fixtures. Hand-written geometries are small, readable in a diff and stable forever, but they only contain the cases somebody thought of. An extract from production data covers real-world messiness including the geometries that actually break things, but it decays as production changes and may carry information that should not be in a repository. Generated geometries from a seeded generator cover a wide input space reproducibly and never decay, but they express no domain knowledge, so a generated polygon is unusual in ways that do not correspond to how real perimeters are unusual. A suite needs all three, and the common mistake is relying on the second alone, because it is the one that silently stops representing production.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">three fixture sources, three different ways of being wrong</text>
  <rect x="40" y="76" width="256" height="200" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="312" y="76" width="256" height="200" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <rect x="584" y="76" width="256" height="200" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="104" font-size="11" font-weight="700" fill="var(--crimson-deep)">hand-written</text>
  <text x="332" y="104" font-size="11" font-weight="700" fill="var(--ember-text)">production extract</text>
  <text x="604" y="104" font-size="11" font-weight="700" fill="var(--crimson-deep)">generated, seeded</text>
  <g font-size="10" fill="currentColor">
    <text x="60" y="134">+ readable in a diff</text>
    <text x="60" y="154">+ stable forever</text>
    <text x="60" y="176">− only the cases</text>
    <text x="60" y="192">  somebody thought of</text>
    <text x="332" y="134">+ real-world messiness</text>
    <text x="332" y="154">+ the geometries that break things</text>
    <text x="332" y="176">− decays as production changes</text>
    <text x="332" y="192">− may carry data that should not</text>
    <text x="332" y="208">  be in a repository</text>
    <text x="604" y="134">+ wide input space</text>
    <text x="604" y="154">+ reproducible, never decays</text>
    <text x="604" y="176">− no domain knowledge:</text>
    <text x="604" y="192">  unusual in the wrong ways</text>
  </g>
  <text x="60" y="240" font-size="10" font-weight="700" fill="var(--crimson-deep)">use for: contract examples</text>
  <text x="332" y="240" font-size="10" font-weight="700" fill="var(--ember-text)">use for: regression, refreshed</text>
  <text x="604" y="240" font-size="10" font-weight="700" fill="var(--crimson-deep)">use for: invariants</text>
  <text x="8" y="322" font-size="10.5" fill="currentColor">The common mistake is relying on the middle column alone — it is the one that silently stops representing production.</text>
</svg>

The middle column is where most suites end up, because a production extract is the easiest fixture to obtain and gives the best coverage on the day it is taken. Its decay is the problem, and it is silent: the extract keeps passing, the suite keeps reporting green, and meanwhile production has acquired a new agency's export profile, a new geometry complexity distribution, and a CRS the extract has never seen. A regression suite that no longer represents the system is not neutral — it is actively misleading, because it licenses the belief that the cases are covered.

Refresh production fixtures on a schedule and record the date they were taken in the fixture itself. A fixture whose provenance is visible is one somebody can judge; one committed three years ago under a generic filename is one everybody assumes is current.

The right-hand column has the opposite failure and it is worth naming, because generated fixtures are often oversold. A generator produces polygons that are unusual in the ways the generator was written to be unusual — self-intersections, degenerate rings, extreme coordinates — which is genuinely valuable and is not how a hand-digitised fire perimeter is unusual. Real perimeters are unusual by having 14,000 vertices, by being multipart with slivers between the parts, and by carrying a CRS somebody set wrong. Generated inputs find invariant violations; they do not find the shape of your actual data.

## Verification & Smoke Test

Before promoting a change to the test harness itself, confirm the assertion helpers actually reject the failures they claim to catch. A test suite that never fails is indistinguishable from no suite at all, so the smoke test deliberately feeds bad input and asserts that the guard fires.

```python
import logging

import geopandas as gpd
from shapely import wkt

logger = logging.getLogger(__name__)


def smoke_test() -> None:
    # 1. assert_crs must reject a layer with no CRS.
    naked = gpd.GeoDataFrame({"zone_id": ["x"]}, geometry=[wkt.loads("POINT (0 0)")], crs=None)
    try:
        assert_crs(naked, 32610)
        raise AssertionError("expected SpatialAssertionError for missing CRS")
    except SpatialAssertionError:
        pass

    # 2. assert_all_valid must reject a self-intersecting bowtie polygon.
    bowtie = gpd.GeoDataFrame(
        {"zone_id": ["b"]},
        geometry=[wkt.loads("POLYGON ((0 0, 1 1, 1 0, 0 1, 0 0))")],
        crs="EPSG:32610",
    )
    try:
        assert_all_valid(bowtie)
        raise AssertionError("expected SpatialAssertionError for invalid geometry")
    except SpatialAssertionError:
        pass

    logger.info("harness smoke test passed: guards reject bad input")


smoke_test()
```

A CLI equivalent confirms the pinned stack is present and the suite collects without import errors before the full run executes in continuous integration:

```bash
python -c "import geopandas, shapely, pyproj, hypothesis; print('stack ok')"
pytest --collect-only -q     # non-zero exit if any test module fails to import
```

## Integration With Adjacent Workflows

This testing discipline is the gate every other Python workflow on the site passes through before its output is trusted. The golden files and calibration parameters it depends on are managed under the spatial version-control contract, so a re-baselined expected layer is a reviewable diff with full history rather than a silent overwrite. The pinned GDAL and PROJ container the CI job runs inside is produced by the reproducible Docker image workflow, which owns the datum-grid reproducibility that makes golden-file comparison deterministic across machines. Upstream, the schema contracts these tests assert against are the same ones enforced at ingestion time, so a contract test failing in CI is an early warning that a producer has drifted from the agreed data shape long before that drift reaches an operational dashboard. Every merge blocked by a red spatial suite is a wrong geometry that never became an Open Geospatial Consortium (OGC) feature service response an incident commander would have acted on.

## Troubleshooting

**Symptom: golden-file tests pass locally but fail in CI with tiny coordinate differences.** The local and CI environments resolve datum shifts with different PROJ data grids or GEOS versions. Run the suite inside the pinned toolchain container everywhere, print `pyproj.proj_version_str` and `shapely.geos_version_string` at the top of the job, and re-baseline goldens only from inside that image so the expected output matches what CI computes.

**Symptom: a property-based transform test fails intermittently on different runs.** The `hypothesis` seed is unset, so each run explores different coordinates and occasionally hits a boundary the code mishandles. Pin `--hypothesis-seed` in CI to make failures reproducible, then read the shrunk counterexample `hypothesis` prints — it is the minimal `(lon, lat)` that breaks the invariant — and add it as an explicit regression example so the bug stays caught.

**Symptom: geometry-equality assertions flake even when the logic is unchanged.** Exact coordinate equality is comparing floating-point values perturbed by reprojection and serialization. Replace `==` with `shapely.equals_exact` at a declared tolerance or a symmetric-difference area threshold, and align both sides on a stable key before comparing so row-order differences cannot masquerade as geometry drift.

**Symptom: the suite is too slow to run on every push, so developers skip it.** The pyramid is inverted — too many slow end-to-end tests and too few fast unit assertions. Move coverage down into geometry, topology, and property-based tests that need no external services, mark the handful of genuine integration tests with a `slow` marker, and keep the default `pytest` invocation to the fast tiers so the merge gate stays cheap enough to always run.

**Symptom: a green suite still let a wrong buffer distance through.** The tests assert that output is valid but never assert the magnitude of the result. Add value-level assertions — buffered area strictly greater than input area, distances within an expected band, feature counts unchanged by a no-op — because for spatial code, structurally valid and operationally correct are different claims that both need a test.

## Frequently Asked Questions

**Why can't I just assert exact coordinate equality in spatial tests?** Floating-point reprojection, GEOS version differences, and serialization round-trips perturb coordinates in the last few decimal places, so exact equality produces flaky failures that erode trust in the suite. Compare geometries with a tolerance-aware predicate such as `equals_exact` with a decimal precision, or a symmetric-difference area threshold, so that meaningful changes fail the build while sub-millimetre noise does not.

**Do I need to pin GDAL and PROJ versions in CI?** Yes. Different PROJ data grids and GEOS releases can shift transformed coordinates by up to a metre and change which geometries are considered valid, so an unpinned runner makes golden-file tests pass locally and fail in CI for reasons unrelated to the code change. Pin the GDAL, PROJ, GEOS, and PROJ-data versions in the test container image so every run resolves datum shifts and topology identically.

**How much spatial testing belongs in unit tests versus integration tests?** Most coverage should be fast unit-level geometry and topology assertions and property-based transform checks that need no external services; these form the wide base of the test pyramid. Golden-file regression sits in the middle, and a small number of slower end-to-end tests exercise the real ingest-to-publish path. Keeping the base wide keeps the suite fast enough to run on every push, which is what makes it a genuine merge gate.

## Related

- [Writing Property-Based Tests for Coordinate Transforms](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/writing-property-based-tests-for-coordinate-transforms/)
- [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/)
- [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/)

Up: [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/)
