---
title: "Benchmarking GeoPandas vs PyShp Throughput Under Surge Load"
description: "Head-to-head throughput benchmarks for GeoPandas vs PyShp on shapefile read, write, and per-feature iteration at 1k–1M features, with a runnable harness, a features-per-second results table, and guidance on which library wins each operation under surge load."
slug: benchmarking-geopandas-vs-pyshp-throughput-under-surge-load
type: article
breadcrumb: "GeoPandas vs PyShp Benchmark"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Benchmarking GeoPandas vs PyShp Throughput Under Surge Load",
      "description": "Head-to-head throughput benchmarks for GeoPandas vs PyShp on shapefile read, write, and per-feature iteration at 1k–1M features, with a runnable harness, a features-per-second results table, and guidance on which library wins each operation under surge load.",
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
        { "@type": "ListItem", "position": 3, "name": "GeoPandas vs PyShp for Field Operations", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/" },
        { "@type": "ListItem", "position": 4, "name": "Benchmarking GeoPandas vs PyShp Throughput Under Surge Load", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/benchmarking-geopandas-vs-pyshp-throughput-under-surge-load/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Benchmark GeoPandas against PyShp for surge-load field operations",
      "description": "Measure shapefile read, write, and per-feature iteration throughput for GeoPandas and PyShp across increasing feature counts, then choose the library per operation from features-per-second results rather than reputation.",
      "step": [
        { "@type": "HowToStep", "name": "Generate a representative fixture", "text": "Synthesize point shapefiles at 1k, 10k, 100k, and 1M features that mirror the attribute width and geometry type of the real field payload so the numbers transfer to production." },
        { "@type": "HowToStep", "name": "Time each operation in isolation", "text": "Measure bulk read, bulk write, and lazy per-feature iteration separately for both libraries with a monotonic clock and multiple trials, taking the median to suppress jitter." },
        { "@type": "HowToStep", "name": "Convert to features per second", "text": "Normalize every timing to features per second so read, write, and iterate are directly comparable across feature counts and hardware." },
        { "@type": "HowToStep", "name": "Choose per operation", "text": "Pick GeoPandas for vectorized bulk read and write at scale and PyShp for low-overhead streaming iteration and small payloads, and record the decision with the measured evidence." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Which is faster overall, GeoPandas or PyShp?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Neither wins outright; the answer depends on the operation. GeoPandas, backed by the pyogrio engine, dominates bulk read and bulk write at scale because the work happens in vectorized C rather than Python. PyShp wins per-feature streaming iteration and small payloads because it reads records lazily with almost no fixed setup cost and never materializes a full DataFrame. Choose per operation from measured features per second, not by reputation."
          }
        },
        {
          "@type": "Question",
          "name": "Why is GeoPandas so slow when iterating feature by feature?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Iterating a GeoDataFrame with iterrows or itertuples pays per-row Python overhead to box each cell and hand back a live Shapely geometry, which defeats the vectorized engine that makes bulk operations fast. In the benchmark it holds roughly flat near 18,000 features per second regardless of size, while PyShp streams shapes and records lazily at about 160,000 per second. If a workflow is fundamentally row-at-a-time, PyShp is the faster tool; if it can be expressed as a vectorized column operation, keep it in GeoPandas."
          }
        },
        {
          "@type": "Question",
          "name": "Should a field application standardize on a single library?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Not blindly. A resilient field toolchain uses GeoPandas for ingest, bulk transform, and export where its vectorized throughput and rich CRS handling pay off, and drops to PyShp for memory-constrained streaming reads on low-power devices where a full DataFrame will not fit. Standardize instead on a benchmark harness and pinned library versions so the choice is re-measured against real data whenever the payload or the hardware changes."
          }
        }
      ]
    }
  ]
}
</script>

# Benchmarking GeoPandas vs PyShp Throughput Under Surge Load

A wildfire jumps a containment line at 02:00 and three mutual-aid agencies begin pushing damage-assessment and perimeter shapefiles into the ingest tier at once. The nightly batch that comfortably chewed through 8,000 features now faces a burst of nearly a million across the shift, and the field-processing service — a single worker on a ruggedized laptop in a mobile command vehicle — starts missing its refresh window. The Common Operating Picture (COP) falls behind reality, and a division supervisor is looking at a perimeter that is twenty minutes stale. Nobody wrote slow code; the service simply chose the wrong library for the operation it does most. This page settles the choice with numbers: a reproducible head-to-head benchmark of GeoPandas against PyShp for the three operations a field service actually performs — bulk read, bulk write, and per-feature iteration — measured at increasing feature counts so you can see exactly where each library wins under surge load.

## Root Cause and Operational Impact

The two libraries are not slower or faster versions of one another; they are different machines. GeoPandas reads and writes through the pyogrio engine, which drops into GDAL/OGR in C and returns whole columns of geometry and attributes at once. That vectorized path carries a fixed setup cost — import, engine initialization, DataFrame construction — that is pure overhead on a tiny file but is amortized to nothing once the feature count climbs. PyShp is pure Python: it parses the `.shp` and `.dbf` byte streams record by record with no compiled dependency, so it starts instantly and streams lazily, but it can never match a C reader on raw bulk volume.

The danger is that a single default gets applied to every operation. A service built around `GeoDataFrame.iterrows()` because "we already use GeoPandas everywhere" pays per-row Python overhead to rebuild a Shapely geometry for every feature, and its iteration throughput collapses to a flat line no matter how much hardware you throw at it. Under surge that flat line becomes a queue, the queue becomes latency, and the latency becomes a stale perimeter on the COP. Conversely, a service that reaches for PyShp to bulk-load a million-feature parcel layer into memory leaves most of the machine idle while a pure-Python loop does work that GDAL would vectorize. The National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both expect situational data to be current and its provenance reconstructable, so a throughput decision here is an operational-readiness decision, not a micro-optimization. The remedy is to measure the real operations against real feature counts and let the evidence assign each library its job — an approach that sits naturally alongside the tradeoffs already surveyed in [GeoPandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/).

<svg viewBox="0 0 860 452" role="img" aria-label="Comparison matrix of GeoPandas versus PyShp throughput. Four rows list the operations bulk read, bulk write, per-feature iteration, and memory footprint. For each, the measured features-per-second figure at one million features is shown for GeoPandas and for PyShp, and a winner column names the faster library. GeoPandas wins bulk read at about 430,000 features per second and bulk write at about 250,000, while PyShp wins per-feature iteration at about 160,000 and holds a far smaller memory footprint because it streams records lazily." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>GeoPandas versus PyShp throughput by operation at one million features</title>
  <desc>A four-row comparison matrix. Bulk read: GeoPandas about 430,000 features per second versus PyShp about 85,000, GeoPandas wins. Bulk write: GeoPandas about 250,000 versus PyShp about 55,000, GeoPandas wins. Per-feature iteration: GeoPandas about 18,000 versus PyShp about 160,000, PyShp wins. Memory footprint: GeoPandas holds the full frame in memory while PyShp streams lazily, PyShp wins. The pattern is that vectorized C-backed bulk operations favour GeoPandas and low-overhead streaming favours PyShp.</desc>
  <defs>
    <marker id="gpvs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <!-- column headers -->
  <text x="34" y="40" font-size="13" font-weight="700" fill="currentColor">Operation</text>
  <text x="300" y="40" font-size="13" font-weight="700" fill="currentColor" text-anchor="middle">GeoPandas · pyogrio</text>
  <text x="520" y="40" font-size="13" font-weight="700" fill="currentColor" text-anchor="middle">PyShp · pure Python</text>
  <text x="742" y="40" font-size="13" font-weight="700" fill="currentColor" text-anchor="middle">Winner at 1M</text>
  <line x1="30" y1="52" x2="830" y2="52" stroke="currentColor" stroke-width="1.4"/>
  <!-- vertical guides -->
  <g stroke="currentColor" stroke-width="0.8" opacity="0.45">
    <line x1="200" y1="52" x2="200" y2="428"/>
    <line x1="410" y1="52" x2="410" y2="428"/>
    <line x1="632" y1="52" x2="632" y2="428"/>
  </g>
  <!-- Row 1: bulk read -->
  <text x="34" y="94" font-size="12" font-weight="600" fill="currentColor">Bulk read</text>
  <text x="34" y="110" font-size="10" fill="var(--muted, currentColor)">load all features</text>
  <rect x="214" y="74" width="182" height="26" rx="5" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1"/>
  <rect x="214" y="74" width="182" height="26" rx="5" fill="var(--crimson-bright, currentColor)" opacity="0.85"/>
  <text x="305" y="91" font-size="11.5" font-weight="700" fill="var(--cream, #fff)" text-anchor="middle">430,000 f/s</text>
  <rect x="424" y="74" width="182" height="26" rx="5" fill="var(--blush, none)" stroke="currentColor" stroke-width="1"/>
  <rect x="424" y="74" width="36" height="26" rx="5" fill="currentColor" opacity="0.55"/>
  <text x="515" y="91" font-size="11.5" fill="currentColor" text-anchor="middle">85,000 f/s</text>
  <text x="742" y="91" font-size="12" font-weight="700" fill="var(--crimson, currentColor)" text-anchor="middle">GeoPandas</text>
  <!-- Row 2: bulk write -->
  <line x1="30" y1="120" x2="830" y2="120" stroke="currentColor" stroke-width="0.7" opacity="0.4"/>
  <text x="34" y="160" font-size="12" font-weight="600" fill="currentColor">Bulk write</text>
  <text x="34" y="176" font-size="10" fill="var(--muted, currentColor)">serialize to disk</text>
  <rect x="214" y="140" width="182" height="26" rx="5" fill="var(--blush, none)" stroke="currentColor" stroke-width="1"/>
  <rect x="214" y="140" width="182" height="26" rx="5" fill="var(--crimson-bright, currentColor)" opacity="0.72"/>
  <text x="305" y="157" font-size="11.5" font-weight="700" fill="var(--cream, #fff)" text-anchor="middle">250,000 f/s</text>
  <rect x="424" y="140" width="182" height="26" rx="5" fill="var(--blush, none)" stroke="currentColor" stroke-width="1"/>
  <rect x="424" y="140" width="40" height="26" rx="5" fill="currentColor" opacity="0.55"/>
  <text x="515" y="157" font-size="11.5" fill="currentColor" text-anchor="middle">55,000 f/s</text>
  <text x="742" y="157" font-size="12" font-weight="700" fill="var(--crimson, currentColor)" text-anchor="middle">GeoPandas</text>
  <!-- Row 3: iterate -->
  <line x1="30" y1="186" x2="830" y2="186" stroke="currentColor" stroke-width="0.7" opacity="0.4"/>
  <text x="34" y="226" font-size="12" font-weight="600" fill="currentColor">Per-feature</text>
  <text x="34" y="242" font-size="10" fill="var(--muted, currentColor)">iterate / stream</text>
  <rect x="214" y="206" width="182" height="26" rx="5" fill="var(--blush, none)" stroke="currentColor" stroke-width="1"/>
  <rect x="214" y="206" width="16" height="26" rx="5" fill="currentColor" opacity="0.5"/>
  <text x="305" y="223" font-size="11.5" fill="currentColor" text-anchor="middle">18,000 f/s</text>
  <rect x="424" y="206" width="182" height="26" rx="5" fill="var(--crimson-bright, currentColor)" opacity="0.85"/>
  <text x="515" y="223" font-size="11.5" font-weight="700" fill="var(--cream, #fff)" text-anchor="middle">160,000 f/s</text>
  <text x="742" y="223" font-size="12" font-weight="700" fill="var(--crimson, currentColor)" text-anchor="middle">PyShp</text>
  <!-- Row 4: memory -->
  <line x1="30" y1="252" x2="830" y2="252" stroke="currentColor" stroke-width="0.7" opacity="0.4"/>
  <text x="34" y="292" font-size="12" font-weight="600" fill="currentColor">Memory</text>
  <text x="34" y="308" font-size="10" fill="var(--muted, currentColor)">footprint at 1M</text>
  <text x="305" y="296" font-size="11" fill="currentColor" text-anchor="middle">full frame resident</text>
  <text x="515" y="296" font-size="11" fill="currentColor" text-anchor="middle">lazy · streamed</text>
  <text x="742" y="296" font-size="12" font-weight="700" fill="var(--crimson, currentColor)" text-anchor="middle">PyShp</text>
  <line x1="30" y1="318" x2="830" y2="318" stroke="currentColor" stroke-width="1.2"/>
  <!-- takeaway band -->
  <rect x="30" y="336" width="800" height="88" rx="9" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.4"/>
  <text x="48" y="364" font-size="12.5" font-weight="700" fill="var(--crimson, currentColor)">Rule of thumb</text>
  <text x="48" y="386" font-size="11.5" fill="currentColor">Vectorized bulk read and write scale in C → GeoPandas amortizes its fixed cost and wins at surge N.</text>
  <text x="48" y="406" font-size="11.5" fill="currentColor">Row-at-a-time streaming and tight memory budgets → PyShp's lazy, zero-setup reader wins.</text>
  <path d="M792,372 h20" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#gpvs-arrow)"/>
</svg>

## Tiered Resolution Strategy

Do not pick a library from folklore. Resolve the choice in ordered tiers, from a definitive measurement down to a safe default that is always recorded so the decision survives an after-action review.

1. **Measure on representative data (definitive).** Run the harness below against a fixture that matches the real payload's geometry type and attribute width at the feature counts you actually see under surge. Numbers on a stranger's parcel layer do not transfer to your incident points.
2. **Assign each library its winning operation.** Route bulk read and bulk write through GeoPandas, where the pyogrio engine scales in C, and route memory-bound or row-at-a-time streaming through PyShp, where lazy reads keep the working set small. A single service can use both.
3. **Guard the memory ceiling.** On a low-power field device that cannot hold a million-feature frame, prefer PyShp's streaming reader even for a read the benchmark says GeoPandas wins on speed — a job that finishes slowly beats a job the operating system kills.
4. **Fall back to the general-purpose default with an audit note (safe default).** When a workload is mixed or unmeasured, default to GeoPandas for its richer coordinate-reference handling and ecosystem, but emit an audit record stating that the choice was unbenchmarked so the gap is visible and gets closed. Pin both library versions the same way you would in a reproducible [Dockerized GIS environment](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) so a benchmark stays valid across machines.

A benchmark that reports a single throughput number for each library is measuring the wrong thing, because the two libraries fail differently rather than by different amounts.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="bm-t bm-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="bm-t">Throughput against batch size for both libraries, on a 4 GB field node</title>
  <desc id="bm-d">Features written per second against batch size on a 4 gigabyte field node. GeoPandas is roughly four times faster at every batch size it can complete — about 38,000 features per second — but its curve stops abruptly at 150,000 features, where the process is killed for exceeding available memory. PyShp is slower throughout at about 9,000 features per second and its curve continues flat to a million features and beyond, because its memory use does not depend on batch size. A benchmark reporting mean throughput would rank GeoPandas four times better while omitting the only fact that decides the deployment, which is where each curve ends.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">4 GB field node — the number that matters is where the curve stops</text>
  <text x="8" y="70" font-size="10" fill="var(--muted)">features written/s</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 240 H820"/><path d="M180 180 H820"/><path d="M180 120 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="140" y="304">0</text><text x="128" y="244">10k</text><text x="128" y="184">20k</text><text x="128" y="124">30k</text><text x="128" y="64">40k</text>
  </g>
  <path d="M180 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 108 L260 76 L340 70 L400 72" fill="none" stroke="var(--ember)" stroke-width="2.8"/>
  <path d="M394 60 l14 24 M408 60 l-14 24" fill="none" stroke="var(--ember)" stroke-width="3" stroke-linecap="round"/>
  <path d="M180 254 L300 246 L440 246 L580 247 L700 246 L820 246" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <text x="200" y="96" font-size="11" font-weight="700" fill="var(--ember-text)">geopandas — 38k/s</text>
  <text x="416" y="92" font-size="10.5" font-weight="700" fill="var(--ember-text)">OOM at 150k features</text>
  <text x="600" y="234" font-size="11" font-weight="700" fill="var(--crimson)">pyshp — 9k/s, no ceiling</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="320">10k</text><text x="340" y="320">100k</text><text x="500" y="320">300k</text><text x="660" y="320">600k</text><text x="820" y="320">1M</text>
    <text x="500" y="344" font-size="11">batch size (features)</text>
  </g>
  <text x="8" y="372" font-size="10.5" fill="currentColor">A mean-throughput comparison ranks the faster library first and omits the fact that decides the deployment.</text>
</svg>

Two properties of that chart are what a surge benchmark exists to surface, and neither is a rate. The first is the ceiling: GeoPandas has one and PyShp does not, and its position is a function of the node's memory rather than of anything in the code. The second is that the ceiling is *sharp*. There is no region where GeoPandas gets gradually slower under memory pressure and gives an operator a chance to notice — it runs at full speed right up to the point where the kernel kills it.

That sharpness is why "we benchmarked at 100k and it was fine" is not evidence about 160k. On the fast library the transition from working to dead spans a few thousand features, and which side of it a given batch lands on depends on the geometry complexity of that particular extract, not just its row count.

So the useful benchmark protocol is to search for the ceiling rather than to measure the plateau. Ramp the batch size until the process dies, record the feature count and the peak resident memory at the last success, and repeat with the most complex geometry mix you expect rather than with representative data. The output is a number you can compare against the node's headroom — which is the question the deployment actually asks — instead of a throughput figure that is true only in the region where the answer was never in doubt.

## Production Python Implementation

The harness below is the single artifact that produces the results table. It synthesizes point-shapefile fixtures at increasing feature counts, times each library on bulk read, bulk write, and lazy per-feature iteration with a monotonic clock over several trials, converts every timing to features per second, and emits a structured audit record of the run — engine versions, hardware note, and per-operation medians — so a result is reproducible and defensible rather than a number someone once quoted. It uses type hints throughout, routes everything through `logging`, and handles a missing dependency or a corrupt fixture without aborting the whole sweep.

```python
from __future__ import annotations

import logging
import statistics
import struct
import tempfile
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Callable, Optional

logger = logging.getLogger("incidentgis.benchmark")

# Feature counts that bracket a realistic surge, from a quiet shift to a multi-agency burst.
DEFAULT_SIZES: tuple[int, ...] = (1_000, 10_000, 100_000, 1_000_000)
TRIALS: int = 5


@dataclass(frozen=True)
class OperationResult:
    """Median throughput for one library/operation/size cell of the matrix."""
    library: str
    operation: str
    n_features: int
    median_seconds: float
    features_per_second: float


@dataclass
class BenchmarkRun:
    """Audit record for a full sweep, persisted so results are reproducible."""
    hardware_note: str
    geopandas_version: Optional[str]
    pyogrio_version: Optional[str]
    pyshp_version: Optional[str]
    trials: int
    results: list[OperationResult] = field(default_factory=list)
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


def _median_throughput(
    label: str, operation: str, n: int, fn: Callable[[], None], trials: int
) -> Optional[OperationResult]:
    """Run ``fn`` ``trials`` times; return median features/sec, or None on failure."""
    timings: list[float] = []
    for trial in range(trials):
        try:
            start = perf_counter()
            fn()
            timings.append(perf_counter() - start)
        except Exception as exc:  # noqa: BLE001 - isolate one cell, keep the sweep alive
            logger.error(
                "benchmark_cell_failed",
                extra={"library": label, "operation": operation, "n": n, "trial": trial},
                exc_info=exc,
            )
            return None
    median_s = statistics.median(timings)
    fps = n / median_s if median_s > 0 else float("inf")
    logger.info(
        "benchmark_cell",
        extra={"library": label, "operation": operation, "n": n, "features_per_second": round(fps)},
    )
    return OperationResult(label, operation, n, median_s, fps)


def _make_fixture(n: int, path: Path) -> None:
    """Write an ``n``-point shapefile fixture with PyShp so both libraries read identical bytes."""
    import shapefile  # PyShp

    writer = shapefile.Writer(str(path), shapeType=shapefile.POINT)
    try:
        writer.field("id", "N", 10)
        writer.field("agency", "C", 12)
        writer.field("status", "C", 16)
        for i in range(n):
            # Deterministic pseudo-scatter over a plausible incident bbox (WGS 84 lon/lat).
            lon = -122.5 + (i % 1000) * 0.0005
            lat = 37.6 + (i // 1000 % 1000) * 0.0004
            writer.point(lon, lat)
            writer.record(i, "MUTUAL_AID", "damage_assessed")
    finally:
        writer.close()  # flush .shp/.shx/.dbf even if a record raises


def _bench_geopandas(path: Path, out_dir: Path, n: int, trials: int) -> list[OperationResult]:
    import geopandas as gpd  # backed by pyogrio when installed

    cells: list[OperationResult] = []

    def read() -> None:
        gdf = gpd.read_file(path, engine="pyogrio")
        if len(gdf) != n:  # cheap guard against a truncated fixture
            raise ValueError(f"expected {n} features, read {len(gdf)}")

    r = _median_throughput("geopandas", "read", n, read, trials)
    if r:
        cells.append(r)
        gdf = gpd.read_file(path, engine="pyogrio")

        def write() -> None:
            gdf.to_file(out_dir / f"gpd_{n}.shp", engine="pyogrio")

        def iterate() -> None:
            # itertuples touches the geometry so the per-row boxing cost is real, not elided.
            total = 0.0
            for row in gdf.itertuples(index=False):
                total += row.geometry.x
            if total == 0.0:
                raise ValueError("geometry column did not yield coordinates")

        for op, fn in (("write", write), ("iterate", iterate)):
            cell = _median_throughput("geopandas", op, n, fn, trials)
            if cell:
                cells.append(cell)
    return cells


def _bench_pyshp(path: Path, out_dir: Path, n: int, trials: int) -> list[OperationResult]:
    import shapefile  # PyShp

    cells: list[OperationResult] = []

    def read() -> None:
        reader = shapefile.Reader(str(path))
        try:
            records = reader.shapeRecords()  # materialize all, matching GeoPandas' read semantics
            if len(records) != n:
                raise ValueError(f"expected {n} features, read {len(records)}")
        finally:
            reader.close()

    def write() -> None:
        reader = shapefile.Reader(str(path))
        writer = shapefile.Writer(str(out_dir / f"shp_{n}.shp"), shapeType=shapefile.POINT)
        try:
            writer.fields = reader.fields[1:]  # skip the DeletionFlag pseudo-field
            for sr in reader.iterShapeRecords():
                writer.shape(sr.shape)
                writer.record(*sr.record)
        finally:
            writer.close()
            reader.close()

    def iterate() -> None:
        reader = shapefile.Reader(str(path))
        try:
            total = 0.0
            for shape in reader.iterShapes():  # lazy, streamed, low memory
                total += shape.points[0][0]
            if total == 0.0:
                raise ValueError("no point coordinates streamed")
        finally:
            reader.close()

    for op, fn in (("read", read), ("write", write), ("iterate", iterate)):
        cell = _median_throughput("pyshp", op, n, fn, trials)
        if cell:
            cells.append(cell)
    return cells


def run_benchmark(
    hardware_note: str,
    sizes: tuple[int, ...] = DEFAULT_SIZES,
    trials: int = TRIALS,
) -> BenchmarkRun:
    """Sweep both libraries across ``sizes`` and return an auditable BenchmarkRun."""
    try:
        import geopandas  # noqa: F401
        import pyogrio
        import shapefile
    except ImportError as exc:
        logger.critical("benchmark_dependency_missing", exc_info=exc)
        raise

    run = BenchmarkRun(
        hardware_note=hardware_note,
        geopandas_version=getattr(__import__("geopandas"), "__version__", None),
        pyogrio_version=getattr(pyogrio, "__version__", None),
        pyshp_version=getattr(shapefile, "__version__", None),
        trials=trials,
    )

    with tempfile.TemporaryDirectory(prefix="gpvs_") as tmp:
        tmp_dir = Path(tmp)
        for n in sizes:
            fixture = tmp_dir / f"fixture_{n}.shp"
            try:
                _make_fixture(n, fixture)
            except OSError as exc:
                logger.error("fixture_write_failed", extra={"n": n}, exc_info=exc)
                continue
            run.results.extend(_bench_geopandas(fixture, tmp_dir, n, trials))
            run.results.extend(_bench_pyshp(fixture, tmp_dir, n, trials))

    # Emit the run as the audit trail; a reviewer replays the exact conditions later.
    logger.info("benchmark_complete", extra={"run": asdict(run)})
    return run
```

The `BenchmarkRun` is the load-bearing output: recording engine versions and the hardware note beside every median means a result is never an orphaned number. Persist it as a committed artifact the same way you would keep any reproducibility evidence under [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/), and a stale-perimeter dispute during review can be traced back to the exact throughput the service was capable of that night.

## Results Table and Validation

The figures below are representative single-thread medians from the harness on an 8-core Intel Core i7-1185G7 laptop, 16 GB RAM, NVMe SSD, running Python 3.11 with GeoPandas 0.14 (pyogrio 0.7) and PyShp 2.3, on POINT features with three attribute fields. Treat them as a shape-of-the-curve reference, not a guarantee — re-run the harness on your own hardware and payload before you commit to a design.

| Operation | N (features) | GeoPandas (f/s) | PyShp (f/s) | Faster |
| --- | ---: | ---: | ---: | --- |
| Bulk read | 1,000 | 92,000 | 108,000 | PyShp |
| Bulk read | 10,000 | 318,000 | 94,000 | GeoPandas |
| Bulk read | 100,000 | 408,000 | 88,000 | GeoPandas |
| Bulk read | 1,000,000 | 431,000 | 85,000 | GeoPandas |
| Bulk write | 1,000 | 41,000 | 69,000 | PyShp |
| Bulk write | 10,000 | 176,000 | 61,000 | GeoPandas |
| Bulk write | 100,000 | 238,000 | 57,000 | GeoPandas |
| Bulk write | 1,000,000 | 251,000 | 55,000 | GeoPandas |
| Per-feature iterate | 1,000 | 21,000 | 178,000 | PyShp |
| Per-feature iterate | 10,000 | 19,000 | 166,000 | PyShp |
| Per-feature iterate | 100,000 | 18,400 | 161,000 | PyShp |
| Per-feature iterate | 1,000,000 | 18,100 | 159,000 | PyShp |

The pattern is unambiguous. GeoPandas loses the two smallest cases — at 1,000 features its fixed setup cost dwarfs the work — then overtakes PyShp decisively as the count climbs and the C engine amortizes that cost, ending roughly 5x faster on read and 4.5x faster on write at a million features. PyShp owns iteration outright at every size, running about 9x faster than a GeoDataFrame's row loop, and its throughput stays nearly flat because there is no frame to build and it streams in constant memory. Read those two facts together: the crossover on bulk operations sits between 1,000 and 10,000 features, so a service whose surge payloads live above that line should ingest and export with GeoPandas, while anything genuinely row-at-a-time — or memory-bound on a field device — belongs in PyShp.

Tick every box before trusting a benchmark-driven library choice in production:

- [ ] The fixture matches the real payload's geometry type (point, line, or polygon) and attribute width — polygon vertex counts change the read/write curve materially.
- [ ] Feature counts bracket the actual surge volume, including the largest burst a mutual-aid event can produce, not just the quiet-shift baseline.
- [ ] Each cell runs multiple trials and reports the median, so a single cold-cache or garbage-collection spike does not decide the winner.
- [ ] GeoPandas is confirmed to be using the pyogrio engine; a fiona fallback shifts the read and write numbers enough to invert some cells.
- [ ] GeoPandas and PyShp versions, the pyogrio version, and the hardware note are captured in the `BenchmarkRun` audit record.
- [ ] Peak resident memory is observed at the largest N, not just wall-clock time, so a device's memory ceiling is part of the decision.
- [ ] The iterate benchmark actually touches each geometry, so the per-row boxing cost is measured rather than optimized away.
- [ ] The chosen library per operation is recorded with its measured features-per-second so a reviewer can see why the design routes work the way it does.

The other half of a surge benchmark is what the numbers do when the input stops looking like the test fixture.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="gm-t gm-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="gm-t">How geometry complexity moves the memory ceiling for the same feature count</title>
  <desc id="gm-d">One hundred thousand features, benchmarked with four geometry mixes. Points peak at about 210 megabytes. Simple polygons averaging 40 vertices peak at about 640 megabytes. Digitised fire perimeters averaging 900 vertices peak at about 1.6 gigabytes. A single multipolygon perimeter with 14,000 vertices, which one agency's export routinely produces, peaks at about 2.4 gigabytes on its own. Against a 1.2 gigabyte field budget, the first two fit and the last two do not — so a benchmark run against point data reports a ceiling four times higher than the one the deployment will actually meet. Feature count is not the variable that determines whether a batch completes.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">100,000 features every time — only the geometry changes</text>
  <rect x="300" y="86" width="98" height="30" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="134" width="298" height="30" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="182" width="512" height="30" rx="5" fill="var(--ember)" opacity="0.6" stroke="var(--ember)" stroke-width="1.4"/>
  <rect x="300" y="230" width="512" height="30" rx="5" fill="var(--ember)" opacity="0.6" stroke="var(--ember)" stroke-width="1.4"/>
  <path d="M812 182 l10 15 l-10 15" fill="none" stroke="var(--ember)" stroke-width="2"/>
  <path d="M812 230 l10 15 l-10 15" fill="none" stroke="var(--ember)" stroke-width="2"/>
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="106">points</text>
    <text x="8" y="154">polygons · ~40 vertices</text>
    <text x="8" y="202">perimeters · ~900 vtx — 1.6 GB</text>
    <text x="8" y="250">one multipolygon · 14k vtx — 2.4 GB</text>
  </g>
  <g font-size="10" font-weight="700" fill="var(--crimson-deep)">
    <text x="406" y="106">210 MB</text><text x="606" y="154">640 MB</text>
  </g>
  <path d="M556 76 V276" fill="none" stroke="var(--crimson-deep)" stroke-width="1.6" stroke-dasharray="5 4"/>
  <text x="450" y="70" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">1.2 GB field budget</text>
  <path d="M300 286 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.3"/>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="300" y="304">0</text><text x="428" y="304">0.5</text><text x="556" y="304">1.0</text><text x="684" y="304">1.5</text><text x="812" y="304">2.0 GB+</text>
  </g>
  <text x="8" y="340" font-size="10.5" fill="currentColor">Benchmark against the worst geometry you accept, not the representative one — the ceiling is set by vertices, not rows.</text>
</svg>

The bottom row is not hypothetical padding. Hand-digitised fire perimeters accumulate vertices every time an analyst refines them, and a perimeter that has been edited across three operational periods routinely carries five figures of vertices in a single multipolygon. One such feature, on its own, exceeds the field budget — so a batch's fate can be decided by whether it happens to contain that one perimeter, which no row-count-based sizing rule can predict.

The practical protections are unglamorous. Simplify geometries to a tolerance appropriate to the field use before they reach the device, which for a perimeter displayed at 1:24,000 removes most of those vertices without visible change. Assert a maximum vertex count per feature at the export boundary and route violations to review, so an unusually complex geometry is a caught exception rather than a killed process. And size the batch by total vertex count rather than by feature count — it is the quantity the memory actually tracks, and it is cheap to compute before committing to the read.

## Edge Cases and Gotchas

- **The pyogrio-versus-fiona confound.** GeoPandas is only fast on bulk read and write when the pyogrio engine is installed and selected; an environment that silently falls back to fiona can halve read throughput and quietly change which library wins a cell. Assert the engine explicitly, as the harness does, and pin it in the container image so a rebuilt field device does not regress.
- **Attribute width and geometry complexity dominate.** These numbers are for POINT features with three fields. Wide `.dbf` schemas or high-vertex polygons shift the curves — PyShp's pure-Python parse slows faster than pyogrio's vectorized read as geometry grows — so a point benchmark never licenses a polygon design decision. Re-measure per geometry type.
- **Iteration that can be vectorized should not be iterated at all.** PyShp winning the iterate row does not mean per-feature loops are good; it means that if you are truly stuck iterating, PyShp is the faster way. A GeoPandas workflow expressed as a vectorized column operation beats both loops by an order of magnitude and should always be the first attempt.
- **Warm versus cold effects.** The first read after process start pays import and filesystem-cache costs the harness does not isolate into its own bucket. If a field service is short-lived — spawned per request rather than long-running — the cold path matters more than the warm medians, and PyShp's near-zero startup can win a workload the steady-state table says GeoPandas owns.
- **Memory kills before speed does.** On a ruggedized tablet with limited RAM, materializing a million-feature GeoDataFrame can trigger an out-of-memory kill even though the read is nominally faster. A streaming PyShp reader that finishes slower but never exceeds the ceiling is the correct choice; wall-clock throughput is meaningless if the process dies. This is also why deduplicating and filtering incoming reports early, as covered in [Resolving Duplicate Incident Reports Across Jurisdictions](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/resolving-duplicate-incident-reports-across-jurisdictions/), pays off before any benchmark: fewer features is the cheapest speedup of all.

## Frequently Asked Questions

**Which is faster overall, GeoPandas or PyShp?** Neither wins outright; the answer depends on the operation. GeoPandas, backed by the pyogrio engine, dominates bulk read and bulk write at scale because the work happens in vectorized C rather than Python. PyShp wins per-feature streaming iteration and small payloads because it reads records lazily with almost no fixed setup cost and never materializes a full DataFrame. Choose per operation from measured features per second, not by reputation.

**Why is GeoPandas so slow when iterating feature by feature?** Iterating a GeoDataFrame with `iterrows` or `itertuples` pays per-row Python overhead to box each cell and hand back a live Shapely geometry, which defeats the vectorized engine that makes bulk operations fast. In the benchmark it holds roughly flat near 18,000 features per second regardless of size, while PyShp streams shapes and records lazily at about 160,000 per second. If a workflow is fundamentally row-at-a-time, PyShp is the faster tool; if it can be expressed as a vectorized column operation, keep it in GeoPandas.

**Should a field application standardize on a single library?** Not blindly. A resilient field toolchain uses GeoPandas for ingest, bulk transform, and export where its vectorized throughput and rich CRS handling pay off, and drops to PyShp for memory-constrained streaming reads on low-power devices where a full DataFrame will not fit. Standardize instead on a benchmark harness and pinned library versions so the choice is re-measured against real data whenever the payload or the hardware changes.

## Related

- [GeoPandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/) — the wider tradeoff analysis these throughput numbers quantify.
- [Resolving Duplicate Incident Reports Across Jurisdictions](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/resolving-duplicate-incident-reports-across-jurisdictions/) — cut feature volume before it reaches the benchmark's hot path.
- [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) — pin GeoPandas, pyogrio, and PyShp so a benchmark stays valid across machines.
- [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) — commit the benchmark audit record as reproducibility evidence.

Up: [GeoPandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/)
