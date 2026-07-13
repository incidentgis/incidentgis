---
title: "Writing Property-Based Tests for Coordinate Transforms"
description: "Property-test CRS transforms with Hypothesis: assert round-trip invariants within tolerance, catch axis-order inversion, and pin antimeridian and pole edge cases so a datum bug can never silently ship into an incident map."
slug: writing-property-based-tests-for-coordinate-transforms
type: article
breadcrumb: "Property-Based Transform Tests"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Writing Property-Based Tests for Coordinate Transforms",
      "description": "Property-test CRS transforms with Hypothesis: assert round-trip invariants within tolerance, catch axis-order inversion, and pin antimeridian and pole edge cases so a datum bug can never silently ship into an incident map.",
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
        { "@type": "ListItem", "position": 3, "name": "Spatial Data Testing & CI Pipelines", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/" },
        { "@type": "ListItem", "position": 4, "name": "Writing Property-Based Tests for Coordinate Transforms", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/writing-property-based-tests-for-coordinate-transforms/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Property-test a coordinate transform for round-trip and edge-case correctness",
      "description": "Generate coordinates with Hypothesis, assert that projecting and un-projecting returns the input within tolerance, verify axis order, and pin antimeridian and pole cases so datum and axis bugs fail the build instead of shipping.",
      "step": [
        { "@type": "HowToStep", "name": "Define a bounded coordinate strategy", "text": "Draw longitude and latitude from Hypothesis float strategies constrained to valid geographic ranges, excluding NaN and infinity so every drawn value is a physically meaningful position." },
        { "@type": "HowToStep", "name": "Assert the round-trip invariant", "text": "Project each generated coordinate to the target CRS and back with always_xy transformers, then assert the recovered longitude and latitude match the input within an explicit tolerance." },
        { "@type": "HowToStep", "name": "Pin the edge cases with explicit examples", "text": "Add antimeridian, pole, equator, and null-island coordinates as forced examples so the suite always exercises the seams where projections wrap, singularize, or overflow." },
        { "@type": "HowToStep", "name": "Emit an audit record for every counterexample", "text": "When a property fails, record the minimal failing coordinate, the CRS pair, the observed error, and the PROJ version to an immutable audit trail so the regression is reproducible in CI." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why use property-based testing instead of hardcoded coordinate fixtures?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Hand-picked fixtures only exercise the coordinates an engineer thought to write down, and datum and axis bugs almost always hide in the coordinates nobody thought of — near the antimeridian, at the poles, or at the exact edge of a projection's valid area. Property-based testing draws thousands of coordinates across the whole valid range each run, asserts an invariant that must hold for all of them, and automatically shrinks any failure to the smallest coordinate that still breaks, so the transform is exercised far beyond a fixed sample."
          }
        },
        {
          "@type": "Question",
          "name": "What tolerance should a round-trip coordinate test assert?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Set the tolerance from the operational accuracy the map requires, not from machine epsilon. A round-trip through a well-conditioned projection like Web Mercator recovers geographic coordinates to well under a micro-degree away from the poles, so a ceiling around 1e-7 degrees (roughly a centimetre) catches real regressions while tolerating floating-point noise. Loosen it deliberately near the poles, where projection math is ill-conditioned, and commit the chosen value as a named constant so any failure is judged against a versioned threshold."
          }
        },
        {
          "@type": "Question",
          "name": "How do you keep property-based transform tests reproducible in CI?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Two things drive reproducibility: the Hypothesis database and a pinned PROJ stack. Commit the .hypothesis example database or use a derived seed so a counterexample found once is replayed on every subsequent run, and pin the GDAL and PROJ versions plus the datum grids in the container image, because a different PROJ release can shift a transform by sub-metre amounts and turn a passing property into a flaky one. Record the PROJ version in each audit entry so a failure is always tied to the exact math that produced it."
          }
        }
      ]
    }
  ]
}
</script>

# Writing Property-Based Tests for Coordinate Transforms

A wildfire perimeter arrives from a partner agency in EPSG:4326 and the ingest service reprojects it to the incident's local projected system before it renders on the operational map. The unit test suite is green: three hand-written fixtures — a point in the city, a point in the next county, a point offshore — all round-trip cleanly. Then a crew is dispatched to a spot that plots forty metres inside a river because a single vertex sat within a hundredth of a degree of the antimeridian, where the reprojection wrapped the longitude the wrong way. No fixture ever tested a coordinate that close to ±180°, so no test caught it. This is the narrow failure this page solves: a coordinate transform that is correct for the cases an engineer thought to write down and silently wrong for the ones they did not. Property-based testing closes that gap by generating the coordinates nobody thought of and asserting an invariant that must hold for every one of them.

## Root Cause and Operational Impact

A coordinate transform is deceptively easy to test badly. The happy path — a mid-latitude point far from any seam — round-trips within floating-point noise through almost any projection, so a handful of fixtures produce a confident green suite. But the defects that matter do not live on the happy path. Axis-order inversion swaps longitude and latitude and only reveals itself outside the roughly ±90° band where the two are numerically indistinguishable. Antimeridian wrapping breaks at ±180°. Projection singularities appear at the poles, where a small change in projected space maps to a huge change in longitude. Datum-grid differences between two PROJ builds shift results by sub-metre amounts that no fixed fixture is precise enough to notice. Every one of these lives in a thin region of the input space that example-based tests systematically miss.

The impact is not cosmetic. A transposed or wrapped coordinate places a resource, a hazard, or an evacuation zone in the wrong location on the Common Operating Picture, and downstream consumers treat that location as ground truth. A perimeter vertex that jumps across the antimeridian can invert an entire polygon, flipping which side of a line is "inside the evacuation area." Because the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both require that spatial products be reconstructable for after-action review, a transform bug that shipped undetected is not just an operational error — it undermines the defensibility of every decision made on that map. The transform therefore has to be tested against its whole valid input domain, and it has to fail loudly in continuous integration before it reaches the field, which is exactly the discipline that [spatial data testing and CI pipelines](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/) exist to enforce.

<svg viewBox="0 0 880 470" role="img" aria-label="Property-based round-trip test diagram. On the left, a Hypothesis strategy draws bounded longitude and latitude values and feeds them into a forward transform from EPSG:4326 to a projected CRS, then an inverse transform back to EPSG:4326, and finally an assertion that the recovered coordinate matches the input within tolerance. A dashed feedback arrow labelled shrink returns from the assertion to the strategy, minimising any failing coordinate. On the right, a panel lists four edge-case zones the strategy deliberately probes — antimeridian at plus or minus 180 degrees, the poles at plus or minus 90 degrees, null island at zero zero, and axis-order longitude-latitude swap — each feeding an audit record on failure." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>The round-trip invariant loop and the edge-case zones a property-based suite probes</title>
  <desc>A Hypothesis strategy generates bounded longitude and latitude coordinates and passes each one through a forward projection to a target coordinate reference system and back again through the inverse projection. The suite then asserts that the recovered coordinate matches the generated input within an explicit tolerance. When the assertion fails, Hypothesis shrinks the input to the smallest coordinate that still breaks the property and an audit record is emitted. The right panel lists the four seams the strategy deliberately targets with forced examples: the antimeridian at plus or minus 180 degrees, the poles at plus or minus 90 degrees, null island at zero zero, and axis-order swaps between longitude and latitude.</desc>
  <defs>
    <marker id="pbt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
    <marker id="pbt-arrow-crimson" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <text x="40" y="34" font-size="13" font-weight="700" fill="currentColor">The round-trip invariant</text>
  <!-- Strategy box -->
  <rect x="40" y="58" width="180" height="60" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="130" y="82" font-size="12" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Hypothesis strategy</text>
  <text x="130" y="99" font-size="10" text-anchor="middle" fill="currentColor">draws &#955; &#8712; [-180,180],</text>
  <text x="130" y="112" font-size="10" text-anchor="middle" fill="currentColor">&#966; &#8712; [-90,90] &#183; no NaN</text>
  <!-- forward -->
  <path d="M220,88 H300" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#pbt-arrow)"/>
  <text x="260" y="80" font-size="10" text-anchor="middle" fill="currentColor">forward</text>
  <!-- Forward transform box -->
  <rect x="300" y="58" width="180" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="390" y="82" font-size="12" text-anchor="middle" font-weight="600" fill="currentColor">forward transform</text>
  <text x="390" y="101" font-size="10.5" text-anchor="middle" fill="currentColor">EPSG:4326 &#8594; 3857</text>
  <!-- down to inverse -->
  <path d="M390,118 V158" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#pbt-arrow)"/>
  <text x="452" y="142" font-size="10" text-anchor="middle" fill="currentColor">(x, y)</text>
  <!-- Inverse transform box -->
  <rect x="300" y="158" width="180" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="390" y="182" font-size="12" text-anchor="middle" font-weight="600" fill="currentColor">inverse transform</text>
  <text x="390" y="201" font-size="10.5" text-anchor="middle" fill="currentColor">3857 &#8594; EPSG:4326</text>
  <!-- back to assert -->
  <path d="M300,188 H220" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#pbt-arrow)"/>
  <text x="260" y="180" font-size="10" text-anchor="middle" fill="currentColor">inverse</text>
  <!-- Assert box -->
  <rect x="40" y="158" width="180" height="60" rx="8" fill="var(--blush, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="130" y="182" font-size="12" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">assert round-trip</text>
  <text x="130" y="201" font-size="10.5" text-anchor="middle" fill="currentColor">|&#916;&#955;|, |&#916;&#966;| &lt; tol</text>
  <!-- shrink feedback -->
  <path d="M60,158 C60,138 60,138 60,118" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#pbt-arrow-crimson)"/>
  <text x="70" y="142" font-size="10" text-anchor="start" fill="var(--crimson, currentColor)">shrink failing coord</text>
  <!-- pass note -->
  <text x="130" y="244" font-size="10.5" text-anchor="middle" fill="currentColor" opacity="0.85">pass &#8594; property holds for all drawn coords</text>
  <!-- divider -->
  <line x1="560" y1="46" x2="560" y2="446" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>
  <!-- right panel -->
  <text x="588" y="34" font-size="13" font-weight="700" fill="currentColor">Edge-case zones probed</text>
  <g font-size="11" fill="currentColor">
    <rect x="588" y="52" width="256" height="52" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="602" y="73" font-weight="600">Antimeridian &#183; &#955; = &#177;180&#176;</text>
    <text x="602" y="91" font-size="10">longitude wrap / polygon inversion</text>
    <rect x="588" y="112" width="256" height="52" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="602" y="133" font-weight="600">Poles &#183; &#966; = &#177;90&#176;</text>
    <text x="602" y="151" font-size="10">projection singularity, ill-conditioned</text>
    <rect x="588" y="172" width="256" height="52" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="602" y="193" font-weight="600">Null island &#183; (0, 0)</text>
    <text x="602" y="211" font-size="10">failed-geocode sentinel</text>
    <rect x="588" y="232" width="256" height="52" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="602" y="253" font-weight="700" fill="var(--crimson, currentColor)">Axis order &#183; &#955;/&#966; swap</text>
    <text x="602" y="271" font-size="10">latitude in the longitude slot</text>
  </g>
  <!-- audit flow -->
  <path d="M716,284 V312" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#pbt-arrow-crimson)"/>
  <text x="726" y="302" font-size="10" text-anchor="start" fill="var(--crimson, currentColor)">on failure</text>
  <rect x="588" y="312" width="256" height="58" rx="8" fill="var(--blush, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="716" y="336" font-size="12" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">emit audit record</text>
  <text x="716" y="354" font-size="10" text-anchor="middle" fill="currentColor">minimal coord + CRS pair + PROJ version</text>
  <text x="588" y="398" font-size="10.5" fill="currentColor" opacity="0.85">Forced @example seeds guarantee every seam is</text>
  <text x="588" y="414" font-size="10.5" fill="currentColor" opacity="0.85">exercised on every run, not left to chance.</text>
</svg>

## Tiered Resolution Strategy

Build the suite in ordered tiers, from the invariant that must always hold down to the audit hook that makes every failure reproducible. The goal is a property that fails the build the instant a transform regresses, never a test that only checks the coordinates someone remembered.

1. **Assert the round-trip invariant (definitive).** For any valid coordinate, projecting to the target system and inverting back must recover the input within an explicit tolerance. This single property catches datum errors, axis swaps, and precision loss across the entire input domain, because Hypothesis draws across the whole valid range rather than a fixed sample.
2. **Constrain the strategy to physically meaningful inputs.** Bound longitude to ±180° and latitude to ±90°, exclude NaN and infinity, and — depending on the projection — exclude latitudes outside its valid area. An unbounded strategy wastes runs on inputs the transform is not defined for and produces false failures.
3. **Force the seams as explicit examples.** Pin the antimeridian, both poles, the equator, and null island with forced examples so the suite always exercises them regardless of what the random draw happens to cover, converting a probabilistic check into a guaranteed one.
4. **Guard axis order independently.** Add a dedicated property that a longitude-heavy coordinate never round-trips as if it were latitude, so an `always_xy` regression is caught directly rather than hidden inside the tolerance, the same contract described in [fixing axis-order inversion in cross-agency GeoJSON](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/fixing-axis-order-inversion-in-cross-agency-geojson/).
5. **Emit an audit record for every counterexample (safe default).** On any failure, record the shrunk minimal coordinate, the CRS pair, the observed error, and the PROJ version so the regression is reproducible against the exact math that produced it — and so a flaky failure can be traced to a datum-grid change rather than the code.

## Production Python Implementation

The module below is a complete Hypothesis suite for a longitude/latitude to Web Mercator transform. It carries the full path: a bounded coordinate strategy, the round-trip invariant, an independent axis-order property, forced antimeridian and pole examples, structured logging, explicit exception handling around transform construction, and an audit-trail emission for every counterexample. Senior-engineer assumptions apply: `pyproj` and `hypothesis` are available, transformers are built once with `always_xy=True`, and the tolerance is a named, versioned constant rather than a literal buried in an assertion.

```python
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Final

import pyproj
from hypothesis import given, example, settings, HealthCheck, note
from hypothesis import strategies as st

logger = logging.getLogger("incidentgis.transform_tests")

# Round-trip tolerance in degrees. ~1e-7 deg is roughly a centimetre at the
# equator: tight enough to catch real datum/axis regressions, loose enough to
# absorb floating-point noise. Committed as a named constant, not a literal.
ROUND_TRIP_TOL_DEG: Final[float] = 1e-7
# Web Mercator is undefined beyond ~85.06 deg latitude; stay inside its area.
MERCATOR_LAT_LIMIT: Final[float] = 85.05

SOURCE_CRS: Final[str] = "EPSG:4326"   # geographic lon/lat
TARGET_CRS: Final[str] = "EPSG:3857"   # Web Mercator


@dataclass(frozen=True)
class TransformAudit:
    """Immutable record of a failing property, appended to the audit trail."""
    reason: str
    source_crs: str
    target_crs: str
    coordinate: tuple[float, float]      # (lon, lat) that broke the property
    recovered: tuple[float, float]
    error_deg: float
    proj_version: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


AUDIT_LOG: list[TransformAudit] = []


def _build_transformers() -> tuple[pyproj.Transformer, pyproj.Transformer]:
    """Construct forward/inverse transformers once, enforcing x,y axis order.

    Raises pyproj.exceptions.CRSError if the CRS codes are unknown, which is a
    genuine environment fault (missing PROJ data) and must fail loudly.
    """
    try:
        fwd = pyproj.Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)
        inv = pyproj.Transformer.from_crs(TARGET_CRS, SOURCE_CRS, always_xy=True)
    except pyproj.exceptions.CRSError as exc:
        logger.error("transformer_build_failed", exc_info=exc)
        raise
    return fwd, inv


_FORWARD, _INVERSE = _build_transformers()


def _emit_audit(
    reason: str, coord: tuple[float, float],
    recovered: tuple[float, float], error_deg: float,
) -> None:
    """Record a counterexample so the regression is reproducible in CI."""
    entry = TransformAudit(
        reason=reason,
        source_crs=SOURCE_CRS,
        target_crs=TARGET_CRS,
        coordinate=coord,
        recovered=recovered,
        error_deg=error_deg,
        proj_version=pyproj.proj_version_str,
    )
    AUDIT_LOG.append(entry)
    logger.error("transform_property_failed", extra={"audit": asdict(entry)})


def _round_trip(lon: float, lat: float) -> tuple[float, float]:
    """Project to the target CRS and back; return recovered (lon, lat)."""
    x, y = _FORWARD.transform(lon, lat)
    if not (math.isfinite(x) and math.isfinite(y)):
        # A non-finite projected value is itself a defect worth surfacing.
        raise ValueError(f"non-finite projection for ({lon}, {lat}) -> ({x}, {y})")
    return _INVERSE.transform(x, y)


# Bounded, physically meaningful coordinates: no NaN/inf, within Mercator's area.
_lon = st.floats(min_value=-180.0, max_value=180.0,
                 allow_nan=False, allow_infinity=False)
_lat = st.floats(min_value=-MERCATOR_LAT_LIMIT, max_value=MERCATOR_LAT_LIMIT,
                 allow_nan=False, allow_infinity=False)
coordinates = st.tuples(_lon, _lat)


@settings(max_examples=500, deadline=None,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(coord=coordinates)
# Force every seam so the property is guaranteed, not merely probable.
@example(coord=(180.0, 0.0))       # antimeridian
@example(coord=(-180.0, 0.0))      # antimeridian, other side
@example(coord=(0.0, MERCATOR_LAT_LIMIT))   # near north pole (in-area)
@example(coord=(0.0, -MERCATOR_LAT_LIMIT))  # near south pole (in-area)
@example(coord=(0.0, 0.0))         # null island
def test_round_trip_invariant(coord: tuple[float, float]) -> None:
    """Projecting and inverting must recover the input within tolerance."""
    lon, lat = coord
    try:
        r_lon, r_lat = _round_trip(lon, lat)
    except (ValueError, pyproj.exceptions.ProjError) as exc:
        _emit_audit("transform_raised", coord, (math.nan, math.nan), math.inf)
        raise AssertionError(f"transform raised for {coord}: {exc}") from exc

    # Compare longitude modulo 360 so +180 and -180 are treated as identical.
    dlon = abs((r_lon - lon + 180.0) % 360.0 - 180.0)
    dlat = abs(r_lat - lat)
    error = max(dlon, dlat)
    note(f"coord={coord} recovered=({r_lon}, {r_lat}) error={error}")
    if error > ROUND_TRIP_TOL_DEG:
        _emit_audit("round_trip_exceeded_tol", coord, (r_lon, r_lat), error)
        raise AssertionError(
            f"round-trip error {error:.3e} deg > tol {ROUND_TRIP_TOL_DEG:.1e} "
            f"for {coord}"
        )


@settings(max_examples=300, deadline=None)
@given(lon=st.floats(min_value=100.0, max_value=180.0,
                     allow_nan=False, allow_infinity=False),
       lat=st.floats(min_value=-10.0, max_value=10.0,
                     allow_nan=False, allow_infinity=False))
def test_axis_order_not_swapped(lon: float, lat: float) -> None:
    """A high-longitude, low-latitude point must not round-trip transposed.

    If always_xy silently regresses, the recovered longitude collapses toward
    the latitude band; asserting the sign/magnitude survives catches it before
    the tolerance check would mask it as a large numeric error.
    """
    try:
        r_lon, r_lat = _round_trip(lon, lat)
    except (ValueError, pyproj.exceptions.ProjError) as exc:
        _emit_audit("transform_raised", (lon, lat), (math.nan, math.nan), math.inf)
        raise AssertionError(f"transform raised for ({lon}, {lat}): {exc}") from exc
    if abs(r_lon - lat) < abs(r_lon - lon):
        _emit_audit("axis_order_inverted", (lon, lat), (r_lon, r_lat),
                    abs(r_lon - lon))
        raise AssertionError(
            f"axis order looks inverted: input lon={lon} recovered lon={r_lon} "
            f"is closer to the input lat={lat}"
        )
```

The `AUDIT_LOG` is the load-bearing output. Persisting it as a committed, content-hashed artifact — alongside the Hypothesis example database that replays each counterexample — lets a reviewer confirm exactly which coordinate broke, under which PROJ version, which is the reproducibility guarantee the [version control workflow for spatial data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) is built to provide.

## Validation Checklist

Tick every item before wiring the suite into the build gate.

- [ ] `ROUND_TRIP_TOL_DEG` and the latitude limit are named constants committed under version control — no bare literals in assertions.
- [ ] The coordinate strategy excludes NaN and infinity and is bounded to the projection's valid area, so no run fails on an out-of-area input.
- [ ] Antimeridian (±180°), both poles, the equator, and null island are pinned as forced `@example` cases and run on every invocation.
- [ ] Longitude comparison is done modulo 360 so `+180` and `−180` are treated as identical rather than a 360° error.
- [ ] Both transformers are built with `always_xy=True`, and a dedicated property asserts axis order independently of the tolerance check.
- [ ] Every property failure appends a `TransformAudit` entry carrying the minimal coordinate, CRS pair, error, and `pyproj.proj_version_str`.
- [ ] The `.hypothesis` example database is committed or seeded so a counterexample found once is replayed on every subsequent CI run.
- [ ] GDAL and PROJ versions plus datum grids are pinned in the container image so the transform math is identical across machines.

## Edge Cases and Gotchas

- **Antimeridian wrap.** A naive subtraction treats a recovered `−179.9999999°` against an input `+180.0°` as a ~360° error and fails a perfectly correct transform. Always compare longitude modulo 360 (as the implementation does) so the seam is measured as the small angular difference it actually is, not a full wrap.
- **Pole singularity.** Web Mercator is undefined beyond about 85.06° latitude, and true polar projections lose all longitude information at exactly ±90°, where any longitude maps to the same point. Bound the strategy inside the projection's valid area and treat the pole as its own forced example with a deliberately looser tolerance, rather than expecting longitude to survive a round trip through a singularity.
- **Null-island sentinel.** `(0.0, 0.0)` round-trips cleanly and will pass silently, so the transform test is the wrong place to reject it. Catch failed-geocode null island in an attribute-validation rule at ingest instead; the transform property only proves the math is invertible there, not that the coordinate is real.
- **Axis-order invisibility mid-latitude.** A swap between longitude and latitude is numerically undetectable inside roughly ±45° of both, so the axis property deliberately draws high-longitude, low-latitude points where the two are far apart. Testing only near-origin coordinates would let an `always_xy` regression pass.
- **Datum-grid drift between PROJ builds.** The same code can round-trip to different sub-metre results under two PROJ releases, turning a passing property into an intermittent CI failure. Pin the toolchain as described in [pinning GDAL and PROJ versions to avoid datum-grid drift](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/pinning-gdal-and-proj-versions-to-avoid-datum-grid-drift/) and record `proj_version` in every audit entry so a flaky failure is traceable to the grid, not the code.

## Frequently Asked Questions

**Why use property-based testing instead of hardcoded coordinate fixtures?** Hand-picked fixtures only exercise the coordinates an engineer thought to write down, and datum and axis bugs almost always hide in the coordinates nobody thought of — near the antimeridian, at the poles, or at the exact edge of a projection's valid area. Property-based testing draws thousands of coordinates across the whole valid range each run, asserts an invariant that must hold for all of them, and automatically shrinks any failure to the smallest coordinate that still breaks, so the transform is exercised far beyond a fixed sample.

**What tolerance should a round-trip coordinate test assert?** Set the tolerance from the operational accuracy the map requires, not from machine epsilon. A round-trip through a well-conditioned projection like Web Mercator recovers geographic coordinates to well under a micro-degree away from the poles, so a ceiling around `1e-7` degrees (roughly a centimetre) catches real regressions while tolerating floating-point noise. Loosen it deliberately near the poles, where projection math is ill-conditioned, and commit the chosen value as a named constant so any failure is judged against a versioned threshold.

**How do you keep property-based transform tests reproducible in CI?** Two things drive reproducibility: the Hypothesis database and a pinned PROJ stack. Commit the `.hypothesis` example database or use a derived seed so a counterexample found once is replayed on every subsequent run, and pin the GDAL and PROJ versions plus the datum grids in the container image, because a different PROJ release can shift a transform by sub-metre amounts and turn a passing property into a flaky one. Record the PROJ version in each audit entry so a failure is always tied to the exact math that produced it.

## Related

- [Spatial Data Testing & CI Pipelines](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/) — the wider testing and build-gate strategy this suite plugs into.
- [Fixing Axis-Order Inversion in Cross-Agency GeoJSON](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/fixing-axis-order-inversion-in-cross-agency-geojson/) — the production-side counterpart to the axis-order property tested here.
- [Pinning GDAL & PROJ Versions to Avoid Datum-Grid Drift](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/pinning-gdal-and-proj-versions-to-avoid-datum-grid-drift/) — keep the transform math identical across machines so the property never goes flaky.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — the CRS contract these transforms must honour.

Up: [Spatial Data Testing & CI Pipelines](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/)
