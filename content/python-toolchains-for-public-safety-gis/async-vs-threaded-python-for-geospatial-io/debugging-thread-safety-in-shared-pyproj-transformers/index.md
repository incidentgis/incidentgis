---
title: "Debugging Thread Safety in Shared PyProj Transformers"
description: "A shared Transformer returns wrong coordinates rather than raising, and a bounds assertion passes on every one of them. Per-worker construction, and the CI check that actually detects it."
slug: debugging-thread-safety-in-shared-pyproj-transformers
type: article
breadcrumb: "Thread Safety in Transformers"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Debugging Thread Safety in Shared PyProj Transformers",
      "description": "A shared Transformer returns wrong coordinates rather than raising, and a bounds assertion passes on every one of them. Per-worker construction, and the CI check that actually detects it.",
      "datePublished": "2026-08-09",
      "dateModified": "2026-08-09",
      "author": {
        "@type": "Organization",
        "name": "Incident GIS"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Incident GIS"
      }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": "https://www.incidentgis.com/"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Python Toolchains for Public Safety GIS",
          "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/"
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "Async vs Threaded Python for Geospatial I/O",
          "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/async-vs-threaded-python-for-geospatial-io/"
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Debugging Thread Safety in Shared PyProj Transformers",
          "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/async-vs-threaded-python-for-geospatial-io/debugging-thread-safety-in-shared-pyproj-transformers/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Eliminate shared PROJ and GDAL state across worker threads",
      "description": "Construct a transformer per worker rather than sharing one, never share a dataset handle or prepared geometry, and run the known-answer transform test under contention with exact assertions.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Give every worker its own transformer",
          "text": "Construct a Transformer per thread and CRS pair rather than sharing an instance, since construction costs about 1.8 milliseconds once per worker and the correctness is unconditional."
        },
        {
          "@type": "HowToStep",
          "name": "Never share a dataset handle",
          "text": "Open GDAL and rasterio datasets per worker or serialise access behind a lock, because concurrent reads through one handle corrupt its internal block cache and return pixels from the wrong window."
        },
        {
          "@type": "HowToStep",
          "name": "Treat prepared geometries as per-worker",
          "text": "Build prepared geometries inside each worker, since they cache an index on first use behind an API that appears read-only."
        },
        {
          "@type": "HowToStep",
          "name": "Run the transform test under contention",
          "text": "Execute the known-answer transform with more workers than cores in continuous integration, because a single-threaded assertion cannot detect this class of defect at all."
        },
        {
          "@type": "HowToStep",
          "name": "Assert against a control point",
          "text": "Compare results to a known coordinate within a stated tolerance rather than checking they fall inside expected bounds, since every wrong answer this defect produces is inside the bounds."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What actually happens when a pyproj Transformer is shared across threads?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "It returns wrong coordinates rather than raising. Running one control point through a shared transformer on eight workers typically produces six correct results, one displaced by tens of centimetres, and one displaced by tens of metres where a thread picked up another's intermediate state mid-pipeline. All eight are plausible coordinates in the right region and none raises an exception, so a test asserting the transform completed passes, and so does one asserting the output falls inside the incident bounds."
          }
        },
        {
          "@type": "Question",
          "name": "Why is this so hard to catch in testing?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because the failure rate is low and the failures are plausible. At roughly one feature in four hundred, the symptom presents as a data-quality problem in the source rather than as a concurrency bug, and the investigation starts in the wrong system. The only assertion that separates a correct result from a corrupted one is an exact comparison against a known control point to a stated tolerance — bounds checks pass on every wrong answer — and it has to run under contention with enough iterations to hit the race, which a handful of points will not."
          }
        },
        {
          "@type": "Question",
          "name": "Which geospatial objects are safe to share between threads?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Immutable ones. A shapely geometry is safe to read from many threads once constructed. A pyproj Transformer holds internal state and is not documented as thread-safe. A rasterio or GDAL dataset handle is explicitly single-threaded and concurrent reads corrupt its block cache. A prepared geometry caches an index on first use, so despite a read-looking API it holds mutable state and is unsafe. The rule is that anything holding mutable internal state must be per-worker, and the two that matter most fail by returning wrong answers instead of raising."
          }
        }
      ]
    }
  ]
}
</script>

# Debugging Thread Safety in Shared PyProj Transformers

A batch reprojection job runs correctly for months, then a worker count is raised from four to sixteen and roughly one feature in four hundred comes out displaced by tens of metres. No exception is raised, every output is a plausible coordinate in the right county, and the job reports success.

## Root Cause and Operational Impact

The geospatial stack is a set of Python wrappers over C libraries, and thread safety is a property of the underlying object rather than of the Python API. Nothing at the call site distinguishes an object that is safe to share from one that is not, and the unsafe ones mostly do not raise — they return values.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="ts1-t ts1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ts1-t">Which geospatial objects survive being shared between threads</title>
  <desc id="ts1-d">Four objects a worker pool is commonly tempted to share. A pyproj Transformer is not documented as thread-safe and holds internal state, so sharing one across workers can produce transformed coordinates that are subtly wrong rather than an exception. A rasterio or GDAL dataset handle is explicitly single-threaded, and concurrent reads through one handle corrupt the internal block cache. A shapely geometry is immutable once constructed and is safe to read from many threads. A prepared geometry built for repeated predicate tests holds a cached index and is not safe to share. The pattern is that anything holding mutable internal state is unsafe, and the dangerous cases are the two that fail by returning wrong answers instead of raising.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the dangerous ones fail by returning wrong answers, not by raising</text>
  <text x="620" y="76" font-size="10" font-weight="700" fill="var(--muted)">shareable?</text>
  <rect x="40" y="88" width="800" height="58" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="112" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">pyproj.Transformer</text>
  <text x="300" y="112" font-size="10" fill="currentColor">holds internal state · not documented thread-safe</text>
  <text x="620" y="112" font-size="10.5" font-weight="700" fill="var(--ember-text)">no — silently wrong</text>
  <text x="300" y="132" font-size="9.5" fill="var(--muted)">build one per thread, or one per call</text>
  <rect x="40" y="156" width="800" height="58" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="180" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">rasterio / GDAL dataset</text>
  <text x="300" y="180" font-size="10" fill="currentColor">single-threaded · reads corrupt its cache</text>
  <text x="620" y="180" font-size="10.5" font-weight="700" fill="var(--ember-text)">no — corrupts</text>
  <rect x="40" y="224" width="800" height="58" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="248" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">shapely geometry</text>
  <text x="300" y="248" font-size="10" fill="currentColor">immutable once constructed</text>
  <text x="620" y="248" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">yes</text>
  <rect x="40" y="292" width="800" height="58" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="316" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">prepared geometry</text>
  <text x="300" y="316" font-size="10" fill="currentColor">caches an index on first use</text>
  <text x="620" y="316" font-size="10.5" font-weight="700" fill="var(--ember-text)">no</text>
</svg>

Two of those four are the dangerous cases, and they are dangerous in the specific way this site keeps returning to: they produce output that passes every plausibility check. A GDAL dataset handle shared across threads corrupts its block cache and returns pixels from the wrong window. A shared `Transformer` can return a coordinate assembled from two threads' intermediate state.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="ts2-t ts2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ts2-t">What a shared transformer actually produces under concurrency</title>
  <desc id="ts2-d">Eight worker threads transform the same control point through one shared transformer. Six return the correct coordinate. One returns a coordinate displaced by about 30 centimetres, and one returns a coordinate displaced by about 40 metres because it picked up another thread's intermediate state mid-pipeline. None of the eight raises an exception, and all eight are plausible coordinates in the right region. A test that asserts the transform ran, or that the output is inside the expected bounds, passes on all eight. Only an exact-value assertion against a known control point separates them, which is why the property test in the CI suite is the mechanism that catches this rather than any runtime check.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">eight threads, one shared transformer, one control point</text>
  <g font-size="10.5" fill="currentColor">
    <text x="60" y="90">worker 1</text><text x="60" y="118">worker 2</text><text x="60" y="146">worker 3</text><text x="60" y="174">worker 4</text>
    <text x="60" y="202">worker 5</text><text x="60" y="230">worker 6</text><text x="60" y="258">worker 7</text><text x="60" y="286">worker 8</text>
  </g>
  <g font-size="11" font-family="var(--font-mono)" fill="currentColor">
    <text x="180" y="90">353470.00, 3883100.00</text><text x="180" y="118">353470.00, 3883100.00</text>
    <text x="180" y="146">353470.00, 3883100.00</text><text x="180" y="174">353470.00, 3883100.00</text>
    <text x="180" y="202">353470.00, 3883100.00</text><text x="180" y="230">353470.00, 3883100.00</text>
  </g>
  <g font-size="11" font-family="var(--font-mono)" font-weight="700" fill="var(--ember-text)">
    <text x="180" y="258">353470.31, 3883099.88</text>
    <text x="180" y="286">353429.6, 3883114.2</text>
  </g>
  <g font-size="10" fill="var(--crimson-deep)">
    <text x="470" y="90">correct</text><text x="470" y="118">correct</text><text x="470" y="146">correct</text>
    <text x="470" y="174">correct</text><text x="470" y="202">correct</text><text x="470" y="230">correct</text>
  </g>
  <text x="470" y="258" font-size="10" font-weight="700" fill="var(--ember-text)">off by ~0.3 m</text>
  <text x="470" y="286" font-size="10" font-weight="700" fill="var(--ember-text)">off by ~40 m — picked up another thread's state</text>
  <rect x="40" y="304" width="800" height="46" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="332" font-size="10.5" font-weight="700" fill="var(--ember-text)">no exceptions · all eight are plausible coordinates in the right region · a bounds assertion passes on all eight</text>
</svg>

The distribution is what makes this hard to catch in testing. Most calls are correct, a few are off by centimetres, and an occasional one is off by tens of metres. A test asserting that the transform completed passes. A test asserting the result is inside the incident bounds passes. Only an exact comparison against a known control point separates them — which is exactly the [property-based transform test](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/writing-property-based-tests-for-coordinate-transforms/) the CI suite already runs, if it is run under concurrency.

## Tiered Resolution Strategy

1. **Give every worker its own transformer (definitive).** Construction is cheap relative to a batch and the correctness is unconditional.
2. **Never share a dataset handle.** Open per worker, or serialise access behind a lock. A handle is not a connection pool.
3. **Treat prepared geometries as per-worker too.** They cache an index on first use behind an API that looks read-only.
4. **Run the transform property test under concurrency in CI (safe default).** A single-threaded assertion cannot detect this class of defect at all.
5. **Assert on an exact control point, not on bounds.** Bounds checks pass on every one of the wrong answers.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="ts3-t ts3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ts3-t">Three ways to give each worker its own transformer, and what each costs</title>
  <desc id="ts3-d">Three safe patterns. Constructing a transformer inside every call is unconditionally correct and costs roughly 1.8 milliseconds per construction, which dominates a short transform and is irrelevant for a long batch. A thread-local transformer constructs once per worker and is reused, costing that 1.8 milliseconds once per thread and nothing thereafter, which is the right default for a bounded pool. A per-worker transformer created at pool start-up and passed as an initialiser argument is equivalent and makes the ownership explicit in the code rather than implicit in a thread-local. All three are correct; the choice is about how visible the ownership is, and thread-local storage is the one most likely to be undone by a later refactor that moves work between pools.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">all three are correct — the difference is how visible the ownership is</text>
  <rect x="40" y="76" width="800" height="66" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="100" font-size="10.5" font-weight="700" fill="currentColor">construct inside every call</text>
  <text x="60" y="122" font-size="10" fill="currentColor">unconditionally correct · ~1.8 ms per construction — dominates a short transform, irrelevant for a batch</text>
  <rect x="40" y="154" width="800" height="66" rx="9" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.7"/>
  <text x="60" y="178" font-size="10.5" font-weight="700" fill="var(--cream)">thread-local, constructed once per worker</text>
  <text x="60" y="200" font-size="10" fill="var(--cream)">the right default for a bounded pool · pays the 1.8 ms once per thread and nothing after</text>
  <rect x="40" y="232" width="800" height="66" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="256" font-size="10.5" font-weight="700" fill="currentColor">per-worker, passed as a pool initialiser</text>
  <text x="60" y="278" font-size="10" fill="currentColor">equivalent, and makes the ownership explicit in the code rather than implicit in thread-local storage</text>
  <text x="8" y="326" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Thread-local is the one most likely to be undone by a refactor that moves work between pools.</text>
</svg>

The three safe patterns differ only in how visible the ownership is. Thread-local storage is the most convenient and the most easily undone: a later refactor that moves the work onto a different pool, or into a `ProcessPoolExecutor`, silently changes which objects are shared, and nothing in the diff looks like a concurrency change.

## Production Python Implementation

```python
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from pyproj import Transformer

logger = logging.getLogger("incidentgis.thread_safety")

_local = threading.local()


def transformer_for(src_epsg: int, dst_epsg: int) -> Transformer:
    """One Transformer per thread per CRS pair.

    Construction costs roughly 1.8 ms, paid once per worker. Sharing a single
    instance across workers is the defect this exists to prevent, and its
    symptom is a wrong coordinate rather than an exception.
    """
    cache = getattr(_local, "transformers", None)
    if cache is None:
        cache = _local.transformers = {}
    key = (src_epsg, dst_epsg)
    if key not in cache:
        cache[key] = Transformer.from_crs(
            src_epsg, dst_epsg, always_xy=True,
        )
        logger.debug("transformer_constructed", extra={
            "thread": threading.current_thread().name, "pair": key,
        })
    return cache[key]


def reproject_batch(points, src_epsg: int, dst_epsg: int, *, workers: int):
    """Reproject in parallel with no shared PROJ state."""
    def one(pt):
        tf = transformer_for(src_epsg, dst_epsg)   # per-thread, never shared
        return tf.transform(pt[0], pt[1])

    with ThreadPoolExecutor(max_workers=workers,
                            thread_name_prefix="reproject") as pool:
        return list(pool.map(one, points))


# --- the CI check that actually catches this -------------------------------

CONTROL_POINT = (-106.61, 35.08)
EXPECTED = (353470.0, 3883100.0)     # metres, EPSG:32613, to 1 cm
TOLERANCE_M = 0.01


def test_transform_is_thread_safe() -> None:
    """Run the known-answer transform under contention and assert exactly.

    A bounds assertion passes on every wrong answer this defect produces, so
    the check has to compare against a control point to a stated tolerance.
    """
    results = reproject_batch([CONTROL_POINT] * 2000, 4326, 32613, workers=16)
    for x, y in results:
        assert abs(x - EXPECTED[0]) <= TOLERANCE_M, f"easting drifted: {x}"
        assert abs(y - EXPECTED[1]) <= TOLERANCE_M, f"northing drifted: {y}"
```

## Validation Checklist

- [ ] No `Transformer` instance is reachable from more than one thread.
- [ ] No dataset handle is shared; workers open their own or take a lock.
- [ ] Prepared geometries are constructed per worker, not module-level.
- [ ] The transform property test runs with more workers than cores in CI.
- [ ] Assertions compare against a control point to a stated tolerance, not against bounds.
- [ ] Thread-local ownership is documented at the definition, since a refactor can silently break it.
- [ ] Moving work between pool types is treated as a concurrency change in review.
- [ ] The test runs enough iterations to hit a rare race — a handful of points will not.

## Edge Cases and Gotchas

- **A module-level transformer that "has always worked".** It works while the pool has one worker. Raising the worker count is the change that exposes it, and the raise looks harmless in review.
- **`ProcessPoolExecutor` masking the bug.** Processes get their own memory, so the defect disappears — and returns the moment someone switches back to threads for the pickling cost.
- **Rare enough to look like bad data.** At one in four hundred, the symptom presents as a data-quality problem in the source, and the investigation starts in the wrong place.
- **`always_xy` set on one construction path and not another.** Per-thread construction multiplies the opportunities to get this wrong; build transformers through one factory, as above.
- **Locks that serialise the whole batch.** Wrapping a shared dataset in a lock is correct and removes the parallelism you added the pool for. Open per worker instead, and accept the file-handle cost.

## Frequently Asked Questions

**What actually happens when a pyproj Transformer is shared across threads?** It returns wrong coordinates rather than raising. Running one control point through a shared transformer on eight workers typically produces six correct results, one displaced by tens of centimetres, and one displaced by tens of metres where a thread picked up another's intermediate state mid-pipeline. All eight are plausible coordinates in the right region and none raises an exception, so a test asserting the transform completed passes, and so does one asserting the output falls inside the incident bounds.

**Why is this so hard to catch in testing?** Because the failure rate is low and the failures are plausible. At roughly one feature in four hundred, the symptom presents as a data-quality problem in the source rather than as a concurrency bug, and the investigation starts in the wrong system. The only assertion that separates a correct result from a corrupted one is an exact comparison against a known control point to a stated tolerance — bounds checks pass on every wrong answer — and it has to run under contention with enough iterations to hit the race, which a handful of points will not.

**Which geospatial objects are safe to share between threads?** Immutable ones. A shapely geometry is safe to read from many threads once constructed. A pyproj Transformer holds internal state and is not documented as thread-safe. A rasterio or GDAL dataset handle is explicitly single-threaded and concurrent reads corrupt its block cache. A prepared geometry caches an index on first use, so despite a read-looking API it holds mutable state and is unsafe. The rule is that anything holding mutable internal state must be per-worker, and the two that matter most fail by returning wrong answers instead of raising.

## Related

- [Async vs Threaded Python for Geospatial I/O](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/async-vs-threaded-python-for-geospatial-io/) — which work belongs on threads at all, and what belongs on processes instead.
- [Writing Property-Based Tests for Coordinate Transforms](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/writing-property-based-tests-for-coordinate-transforms/) — the known-answer assertion this check reuses, run under contention.
- [Pinning GDAL and PROJ Versions to Avoid Datum Grid Drift](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/pinning-gdal-and-proj-versions-to-avoid-datum-grid-drift/) — the other way a transform silently returns a different answer.
- [Spatial Data Testing & CI Pipelines](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/) — where a concurrency-aware transform test belongs in the suite.

Up: [Async vs Threaded Python for Geospatial I/O](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/async-vs-threaded-python-for-geospatial-io/)
