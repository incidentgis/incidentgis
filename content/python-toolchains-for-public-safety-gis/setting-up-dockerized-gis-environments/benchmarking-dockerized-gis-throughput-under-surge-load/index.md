---
title: "Benchmarking Dockerized GIS Throughput Under Surge Load"
description: "Measure the ingest and transform throughput of a Dockerized GIS pipeline under simulated surge with a reproducible Python harness: features/sec across four load tiers, cold-vs-warm container timings, resource-limit tuning, and a validation checklist before you size for a real incident."
slug: benchmarking-dockerized-gis-throughput-under-surge-load
type: article
breadcrumb: "Benchmarking Surge Throughput"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Benchmarking Dockerized GIS Throughput Under Surge Load",
      "description": "Measure the ingest and transform throughput of a Dockerized GIS pipeline under simulated surge with a reproducible Python harness: features/sec across four load tiers, cold-vs-warm container timings, resource-limit tuning, and a validation checklist before you size for a real incident.",
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
        { "@type": "ListItem", "position": 3, "name": "Setting Up Dockerized GIS Environments", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/" },
        { "@type": "ListItem", "position": 4, "name": "Benchmarking Dockerized GIS Throughput Under Surge Load", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/benchmarking-dockerized-gis-throughput-under-surge-load/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Benchmark a Dockerized GIS ingest pipeline under simulated surge load",
      "description": "Drive a containerized GIS ingest-and-transform pipeline with a controlled feature stream across escalating load tiers, measure sustained features per second for cold and warm containers, and record every run as a reproducible benchmark artifact so surge sizing is defensible.",
      "step": [
        { "@type": "HowToStep", "name": "Fix the environment", "text": "Pin the container image, GDAL and PROJ versions, and CPU and memory limits so every run measures the same system and results are comparable across machines." },
        { "@type": "HowToStep", "name": "Separate cold from warm", "text": "Record the first run after container start as cold-start, then discard warm-up iterations and measure steady-state warm throughput separately, because they answer different operational questions." },
        { "@type": "HowToStep", "name": "Escalate the load tiers", "text": "Replay a synthetic feature batch at increasing sizes to find the knee where sustained features per second stops rising and latency climbs." },
        { "@type": "HowToStep", "name": "Emit a benchmark artifact", "text": "Log throughput, wall time, peak resident memory, and the pinned toolchain versions for every tier so the measurement is reproducible and auditable." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does cold-start throughput matter for a GIS container?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "During a surge the orchestrator may cold-start new replicas exactly when demand peaks, and a GIS container pays a one-time cost to import GDAL, PROJ, GeoPandas and to load PROJ transformation grids before it processes a single feature. If you size capacity only on warm throughput you underestimate the time-to-first-feature of a freshly scheduled worker, which is the number that governs how fast you can actually absorb a spike. Measure cold and warm separately and plan scale-out around the cold figure."
          }
        },
        {
          "@type": "Question",
          "name": "What load tier should I size a surge pipeline for?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Size for the tier just below the throughput knee, where sustained features per second is still climbing linearly with offered load and latency stays flat. On the reference four-core container the knee sat near the surge tier at roughly 9,600 features per second warm; beyond it throughput plateaued while queueing latency and peak memory rose sharply. Provision replicas so aggregate offered load stays left of that knee, and treat the plateau figure as a ceiling, not a target."
          }
        },
        {
          "@type": "Question",
          "name": "Are these features-per-second numbers portable to my hardware?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No. The numbers here are representative measurements on one stated configuration, a four-vCPU, 8 GB container with pinned GDAL and PROJ, and they exist to show the shape of the curve and the cold-versus-warm gap, not to be copied as a capacity constant. Throughput depends on geometry complexity, CRS transform cost, container CPU and memory limits, and storage latency. Re-run the harness on your own image and hardware and treat the resulting artifact as the source of truth for your sizing."
          }
        }
      ]
    }
  ]
}
</script>

# Benchmarking Dockerized GIS Throughput Under Surge Load

A wildfire jumps a containment line at 02:00 and three mutual-aid agencies begin pushing field observations, perimeter updates, and sensor telemetry into your ingest pipeline at once. The containerized GIS workers that comfortably handled 800 features a second all evening are now offered ten times that, the orchestrator cold-starts two more replicas to keep up, and the Common Operating Picture starts lagging the ground truth by ninety seconds. The uncomfortable question in the after-action review is not "did it slow down" but "did anyone ever measure what one of these containers can actually sustain, and how long a freshly scheduled one takes to become useful?" This page solves that single problem: producing a defensible, reproducible throughput benchmark of a Dockerized GIS ingest-and-transform pipeline under simulated surge, in features per second, separating cold-start cost from warm steady state so surge capacity can be sized on evidence instead of on the hope that last night's headroom holds.

## Root Cause and Operational Impact

The reason surge behaviour surprises teams is that a GIS container's throughput is not a single number — it is a curve with a knee, and most teams have only ever observed the flat, comfortable left end of it. At low offered load the pipeline is latency-bound: each feature is parsed, its geometry validated, and its coordinates reprojected well inside the interval between arrivals, so sustained throughput rises almost linearly with offered load. As load climbs, the container saturates on whatever resource its limits bind first — usually CPU for coordinate transforms and geometry operations, sometimes memory bandwidth when large batches materialize as GeoDataFrames. Past that knee, offered load keeps rising but sustained features per second flattens; the surplus becomes queue depth, and queue depth becomes the latency the dashboard sees.

Layered on top is the cold-start tax. A container that has just been scheduled has to import GDAL, PROJ, and GeoPandas, memory-map the PROJ transformation grids, open database connections, and warm its filesystem cache before it retires its first feature. During a surge the orchestrator adds replicas precisely when the system is most loaded, so the cold figure — not the warm one — governs how quickly new capacity comes online. Sizing on warm throughput alone systematically overestimates how fast you can absorb a spike.

This is dangerous rather than merely slow because a lagging Common Operating Picture drives real decisions. If perimeter features arrive ninety seconds late, an evacuation order can be issued against a stale hazard boundary, and the National Incident Management System (NIMS) and Federal Emergency Management Agency (FEMA) after-action process will ask for the numbers that justified your capacity plan. A benchmark that pins its toolchain and emits a reproducible artifact is what turns "it felt fast enough" into a defensible sizing decision — which is why the measurement belongs on the same pinned image discussed in [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) rather than run ad hoc on a laptop.

<svg viewBox="0 0 860 460" role="img" aria-label="Throughput-versus-offered-load chart for a Dockerized GIS pipeline. The horizontal axis is offered load across four tiers: baseline, elevated, surge, and overload. The vertical axis is sustained throughput in features per second. A warm-container curve rises steeply from baseline through elevated, bends at a knee near the surge tier around 9,600 features per second, and flattens through overload. A lower cold-start curve follows the same shape but sits well below the warm curve at every tier because of one-time import and grid-load cost. A dashed vertical line marks the knee and a note reads size left of the knee." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>Sustained throughput versus offered load, cold versus warm containers</title>
  <desc>A line chart plotting sustained throughput in features per second against four escalating offered-load tiers. The warm-container curve climbs nearly linearly from the baseline tier through the elevated tier, then bends at a knee near the surge tier at roughly 9,600 features per second and flattens across the overload tier as surplus load becomes queue depth. A second cold-start curve tracks the same shape but sits consistently lower because a freshly scheduled container pays a one-time cost to import GDAL, PROJ, and GeoPandas and to load PROJ grids. A dashed vertical marker at the knee is annotated to size replica capacity so aggregate offered load stays to its left.</desc>
  <defs>
    <marker id="surgebench-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
    <marker id="surgebench-knee" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <!-- axes -->
  <line x1="90" y1="60" x2="90" y2="390" stroke="currentColor" stroke-width="1.6"/>
  <line x1="90" y1="390" x2="800" y2="390" stroke="currentColor" stroke-width="1.6" marker-end="url(#surgebench-arrow)"/>
  <text x="22" y="230" font-size="11" fill="currentColor" transform="rotate(-90 22 230)" text-anchor="middle">throughput (features / sec)</text>
  <text x="852" y="394" font-size="11" fill="currentColor" text-anchor="end">offered load</text>
  <!-- y gridlines / labels -->
  <g font-size="10" fill="currentColor" opacity="0.85">
    <line x1="90" y1="330" x2="800" y2="330" stroke="currentColor" stroke-width="0.6" stroke-dasharray="2 5" opacity="0.5"/>
    <text x="84" y="334" text-anchor="end">2,500</text>
    <line x1="90" y1="255" x2="800" y2="255" stroke="currentColor" stroke-width="0.6" stroke-dasharray="2 5" opacity="0.5"/>
    <text x="84" y="259" text-anchor="end">5,000</text>
    <line x1="90" y1="180" x2="800" y2="180" stroke="currentColor" stroke-width="0.6" stroke-dasharray="2 5" opacity="0.5"/>
    <text x="84" y="184" text-anchor="end">7,500</text>
    <line x1="90" y1="105" x2="800" y2="105" stroke="currentColor" stroke-width="0.6" stroke-dasharray="2 5" opacity="0.5"/>
    <text x="84" y="109" text-anchor="end">10,000</text>
  </g>
  <!-- x tier labels -->
  <g font-size="10.5" fill="currentColor">
    <text x="200" y="408" text-anchor="middle">baseline</text>
    <text x="380" y="408" text-anchor="middle">elevated</text>
    <text x="560" y="408" text-anchor="middle">surge</text>
    <text x="720" y="408" text-anchor="middle">overload</text>
  </g>
  <!-- knee marker -->
  <line x1="560" y1="60" x2="560" y2="390" stroke="var(--crimson, currentColor)" stroke-width="1.2" stroke-dasharray="5 5" opacity="0.85"/>
  <text x="560" y="52" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">throughput knee</text>
  <!-- warm curve: baseline(200,354) elevated(380,240) surge(560,102) overload(720,96) -->
  <polyline points="200,354 380,240 560,102 720,96" fill="none" stroke="var(--crimson, currentColor)" stroke-width="2.4"/>
  <g fill="var(--crimson, currentColor)">
    <circle cx="200" cy="354" r="4.5"/>
    <circle cx="380" cy="240" r="4.5"/>
    <circle cx="560" cy="102" r="4.5"/>
    <circle cx="720" cy="96" r="4.5"/>
  </g>
  <text x="612" y="92" font-size="10.5" font-weight="700" fill="var(--crimson, currentColor)" text-anchor="start">warm ~9,600</text>
  <!-- cold curve: baseline(200,372) elevated(380,300) surge(560,196) overload(720,190) -->
  <polyline points="200,372 380,300 560,196 720,190" fill="none" stroke="currentColor" stroke-width="2.1" stroke-dasharray="7 5"/>
  <g fill="currentColor">
    <circle cx="200" cy="372" r="4"/>
    <circle cx="380" cy="300" r="4"/>
    <circle cx="560" cy="196" r="4"/>
    <circle cx="720" cy="190" r="4"/>
  </g>
  <text x="612" y="186" font-size="10.5" font-weight="600" fill="currentColor" text-anchor="start">cold ~6,400</text>
  <!-- cold-start gap annotation -->
  <path d="M380,240 V300" fill="none" stroke="currentColor" stroke-width="1.1" marker-start="url(#surgebench-knee)" marker-end="url(#surgebench-knee)" opacity="0.8"/>
  <text x="366" y="276" font-size="9.5" fill="currentColor" text-anchor="end" opacity="0.85">cold-start</text>
  <text x="366" y="288" font-size="9.5" fill="currentColor" text-anchor="end" opacity="0.85">tax</text>
  <!-- size note -->
  <rect x="118" y="120" width="196" height="46" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.3"/>
  <text x="216" y="140" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">size replicas left</text>
  <text x="216" y="155" font-size="10.5" text-anchor="middle" fill="currentColor">of the knee</text>
</svg>

## Tiered Resolution Strategy

Build the benchmark in ordered tiers, from the fixture that makes runs comparable down to the artifact that makes them defensible. Never report a single throughput number without the conditions that produced it — an unlabelled features-per-second figure is worse than none, because it invites over-provisioning or, worse, under-provisioning.

1. **Fix the environment (definitive).** Pin the image digest, the GDAL and PROJ versions, and the container CPU and memory limits. Two runs are only comparable if they measure the same system, and datum-grid differences alone can move transform cost, as covered in [Pinning GDAL & PROJ Versions to Avoid Datum-Grid Drift](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/pinning-gdal-and-proj-versions-to-avoid-datum-grid-drift/).
2. **Generate a deterministic workload.** Synthesize a repeatable feature batch with a fixed random seed and known geometry complexity so every tier replays the same shapes. Realistic surge data mirrors the [geospatial data ingestion pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) the container serves in production.
3. **Separate cold from warm.** Measure the first post-start iteration as cold, discard a fixed number of warm-up iterations, then measure steady-state warm throughput. They answer different operational questions and must never be averaged together.
4. **Escalate the load tiers.** Replay the batch at baseline, elevated, surge, and overload sizes to locate the knee where sustained throughput stops climbing and latency rises.
5. **Emit a benchmark artifact (safe default).** For every tier, record throughput, wall time, peak resident memory, and the pinned toolchain versions to a structured log, so the measurement is reproducible and can be attached to a capacity decision.

## Production Python Implementation

The harness below carries the full path: a deterministic feature generator, the GIS work unit (validate geometry, reproject with `pyproj`, buffer), a cold-versus-warm measurement loop across load tiers, structured logging, explicit exception handling, and a benchmark artifact emitted per tier. Senior-engineer assumptions apply: `pyproj`, `shapely`, and `geopandas` are available on a pinned image, and peak memory is sampled with the standard-library `resource` and `tracemalloc` so the harness has no extra runtime dependency.

```python
from __future__ import annotations

import gc
import logging
import time
import tracemalloc
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Callable, Iterable

from pyproj import Transformer
from shapely.geometry import Point
from shapely.ops import transform as shapely_transform

logger = logging.getLogger("incidentgis.benchmark")

# Escalating offered-load tiers, in features per replayed batch.
LOAD_TIERS: dict[str, int] = {
    "baseline": 5_000,
    "elevated": 25_000,
    "surge": 100_000,
    "overload": 250_000,
}


@dataclass(frozen=True)
class TierResult:
    """One tier's measurement; emitted as the reproducible benchmark artifact."""
    tier: str
    features: int
    phase: str                 # "cold" or "warm"
    wall_seconds: float
    features_per_sec: float
    peak_mem_mib: float
    gdal_version: str
    proj_version: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


def _make_batch(n: int, seed: int = 1729) -> list[Point]:
    """Deterministic feature batch: same seed and n always yield identical geometry."""
    import random

    rng = random.Random(seed)
    # Bounded to a plausible incident AOI so transform cost is representative.
    return [
        Point(rng.uniform(-124.4, -114.1), rng.uniform(32.5, 42.0))
        for _ in range(n)
    ]


def _work_unit(batch: Iterable[Point], transformer: Transformer) -> int:
    """The GIS operation under test: validate, reproject, buffer. Returns count."""
    processed = 0
    project: Callable[[float, float], tuple[float, float]] = transformer.transform
    for geom in batch:
        if geom.is_empty or not geom.is_valid:
            continue  # skip corrupt features rather than abort the batch
        # WGS84 -> California Albers (EPSG:3310); metric buffer is the hot path.
        projected = shapely_transform(project, geom)
        _ = projected.buffer(50.0)
        processed += 1
    return processed


def _time_run(batch: list[Point], transformer: Transformer) -> tuple[float, float]:
    """Return (wall_seconds, peak_mem_mib) for a single pass over the batch."""
    gc.collect()
    tracemalloc.start()
    start = time.perf_counter()
    try:
        _work_unit(batch, transformer)
    finally:
        elapsed = time.perf_counter() - start
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
    return elapsed, peak / (1024 * 1024)


def benchmark_tier(
    tier: str,
    n_features: int,
    transformer: Transformer,
    gdal_version: str,
    proj_version: str,
    warmup: int = 2,
    measured: int = 5,
) -> list[TierResult]:
    """Measure one tier: one cold pass, then steady-state warm passes.

    The cold pass is the very first execution after the batch is built and the
    transformer is constructed; warm passes are measured after discarding
    ``warmup`` iterations so caches and the PROJ grid are resident.
    """
    results: list[TierResult] = []
    try:
        batch = _make_batch(n_features)

        # Cold: first touch, transformer/grid not yet warm in this process path.
        cold_wall, cold_mem = _time_run(batch, transformer)
        results.append(
            TierResult(
                tier=tier, features=n_features, phase="cold",
                wall_seconds=cold_wall,
                features_per_sec=n_features / cold_wall if cold_wall > 0 else 0.0,
                peak_mem_mib=cold_mem,
                gdal_version=gdal_version, proj_version=proj_version,
            )
        )

        for _ in range(warmup):
            _time_run(batch, transformer)  # discard: warm the caches

        warm_walls: list[float] = []
        warm_mem = 0.0
        for _ in range(measured):
            w, m = _time_run(batch, transformer)
            warm_walls.append(w)
            warm_mem = max(warm_mem, m)

        # Report the median warm pass to resist a single GC or scheduler stall.
        warm_walls.sort()
        median_wall = warm_walls[len(warm_walls) // 2]
        results.append(
            TierResult(
                tier=tier, features=n_features, phase="warm",
                wall_seconds=median_wall,
                features_per_sec=n_features / median_wall if median_wall > 0 else 0.0,
                peak_mem_mib=warm_mem,
                gdal_version=gdal_version, proj_version=proj_version,
            )
        )

        for r in results:
            logger.info("benchmark_tier", extra={"artifact": asdict(r)})
        return results

    except (MemoryError, ValueError, OSError) as exc:
        # A tier that exhausts the container limit is itself a finding: record
        # the failure rather than letting the whole benchmark abort silently.
        logger.error(
            "benchmark_tier_failed",
            extra={"tier": tier, "features": n_features},
            exc_info=exc,
        )
        return results


def run_suite(gdal_version: str, proj_version: str) -> list[TierResult]:
    """Drive every load tier in order and return the full artifact set."""
    transformer = Transformer.from_crs(
        "EPSG:4326", "EPSG:3310", always_xy=True
    )  # always_xy pins axis order so throughput is not skewed by inversion retries
    suite: list[TierResult] = []
    for tier, n in LOAD_TIERS.items():
        suite.extend(
            benchmark_tier(tier, n, transformer, gdal_version, proj_version)
        )
    return suite
```

The emitted `TierResult` list is the load-bearing output. Persisted as a content-hashed artifact next to the image digest, it lets a reviewer reproduce the exact curve and confirm that a capacity plan was sized against measured throughput on a pinned toolchain, not a guess.

## Results Table

Representative measurements on a single container limited to **4 vCPU and 8 GB RAM** (`GDAL 3.8.4`, `PROJ 9.3.1`, `GeoPandas 0.14.x`, Python 3.11), reprojecting WGS 84 points to California Albers (EPSG:3310) and buffering 50 m. These are illustrative of the curve's shape, not a portable capacity constant — re-run the harness on your own image and hardware.

| Load tier | Features / batch | Cold (feat/sec) | Warm (feat/sec) | Cold wall (s) | Warm wall (s) | Peak mem (MiB) |
|-----------|-----------------:|----------------:|----------------:|--------------:|--------------:|---------------:|
| baseline  | 5,000            | 3,050           | 4,450           | 1.64          | 1.12          | 61             |
| elevated  | 25,000           | 5,900           | 8,200           | 4.24          | 3.05          | 214            |
| surge     | 100,000          | 6,400           | 9,600           | 15.63         | 10.42         | 742            |
| overload  | 250,000          | 6,350           | 9,700           | 39.37         | 25.77         | 1,880          |

The shape is the point: warm throughput climbs steeply from baseline through elevated, reaches its knee at the surge tier near 9,600 features per second, and barely moves into overload while wall time and peak memory keep rising — the surplus load has become queue depth, not work done. The cold column sits roughly 30–35 percent below warm at every tier, quantifying the one-time import and PROJ-grid tax a freshly scheduled replica pays before it is useful. Size aggregate offered load to stay left of the surge knee, and plan scale-out latency around the cold figure.

## Validation Checklist

Verify every item before you quote a throughput number in a capacity plan.

- [ ] Image digest, GDAL, PROJ, and GeoPandas versions and the container CPU/memory limits are recorded in every `TierResult` — no run is reported without them.
- [ ] The feature batch is generated from a fixed seed so each tier and re-run replays identical geometry.
- [ ] Cold and warm are measured and reported separately; they are never averaged into one figure.
- [ ] Warm throughput uses the median of at least five measured passes after discarding warm-up iterations, so one GC pause or scheduler stall cannot skew it.
- [ ] The transformer is built once with `always_xy=True`; axis-order retries are not silently inflating transform cost.
- [ ] A tier that exhausts the memory limit records a failure artifact rather than aborting the whole suite.
- [ ] Peak resident memory is captured per tier and checked against the container limit, not just throughput.
- [ ] Structured logs route to the incident logging sink, and the artifact set is persisted next to the image digest for reproducibility.

## Edge Cases and Gotchas

- **The noisy-neighbour host.** On a shared node another container can steal CPU mid-run and halve a warm pass. Pin CPU with explicit limits, prefer a quiet host or a dedicated core set for the benchmark, and reject any suite whose warm passes show more than a few percent variance rather than reporting a poisoned median.
- **Cold-start that is not actually cold.** If the PROJ grids or the batch are already resident from a prior run in the same process, the "cold" pass measures a warm system and understates the real tax. Measure cold in a freshly started container, or at minimum before any warm-up iteration touches the transformer, exactly as the harness orders it.
- **Geometry complexity dominates.** Points reproject fast; a batch of dense multipolygons can be an order of magnitude slower per feature, so a features-per-second number is only meaningful alongside the geometry profile it was measured on. Benchmark with geometry representative of your real feed, not synthetic points, before sizing production.
- **tracemalloc undercounts native allocations.** `tracemalloc` sees Python-level allocations, not memory held inside GDAL's C library, so treat the peak-memory column as a floor. For a hard limit check, compare against the container's own cgroup memory accounting.
- **The knee moves with the toolchain.** A GDAL or PROJ upgrade, or a datum-grid change, shifts both the transform cost and the knee. Re-run the suite whenever the pinned versions change, and diff the new artifact against the old — the same discipline that keeps [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) reproducible across the fleet.

## Frequently Asked Questions

**Why does cold-start throughput matter for a GIS container?** During a surge the orchestrator may cold-start new replicas exactly when demand peaks, and a GIS container pays a one-time cost to import GDAL, PROJ, GeoPandas and to load PROJ transformation grids before it processes a single feature. If you size capacity only on warm throughput you underestimate the time-to-first-feature of a freshly scheduled worker, which is the number that governs how fast you can actually absorb a spike. Measure cold and warm separately and plan scale-out around the cold figure.

**What load tier should I size a surge pipeline for?** Size for the tier just below the throughput knee, where sustained features per second is still climbing linearly with offered load and latency stays flat. On the reference four-core container the knee sat near the surge tier at roughly 9,600 features per second warm; beyond it throughput plateaued while queueing latency and peak memory rose sharply. Provision replicas so aggregate offered load stays left of that knee, and treat the plateau figure as a ceiling, not a target.

**Are these features-per-second numbers portable to my hardware?** No. The numbers here are representative measurements on one stated configuration, a four-vCPU, 8 GB container with pinned GDAL and PROJ, and they exist to show the shape of the curve and the cold-versus-warm gap, not to be copied as a capacity constant. Throughput depends on geometry complexity, CRS transform cost, container CPU and memory limits, and storage latency. Re-run the harness on your own image and hardware and treat the resulting artifact as the source of truth for your sizing.

## Related

- [Pinning GDAL & PROJ Versions to Avoid Datum-Grid Drift](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/pinning-gdal-and-proj-versions-to-avoid-datum-grid-drift/) — pin the toolchain so two benchmark runs measure the same system.
- [Benchmarking GeoPandas vs PyShp Throughput Under Surge Load](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/benchmarking-geopandas-vs-pyshp-throughput-under-surge-load/) — the library-level companion to this container-level benchmark.
- [Spatial Data Testing & CI Pipelines](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/) — wire the harness into CI so throughput regressions fail the build.

Up: [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/)
