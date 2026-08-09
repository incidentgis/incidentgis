---
title: "Async vs Threaded Python for Geospatial I/O"
description: "One blocking GDAL call inside a coroutine stalls every concurrent task at once, and it looks like a network fault. Splitting network wait, unyielding calls and GEOS arithmetic across the three models that fit them."
slug: async-vs-threaded-python-for-geospatial-io
type: guide
breadcrumb: "Async vs Threaded Python"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Async vs Threaded Python for Geospatial I/O",
      "description": "One blocking GDAL call inside a coroutine stalls every concurrent task at once, and it looks like a network fault. Splitting network wait, unyielding calls and GEOS arithmetic across the three models that fit them.",
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
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Choose a concurrency model per workload in a geospatial pipeline",
      "description": "Classify each call by what it waits on and whether it yields, keep network wait on the event loop, push blocking GDAL and GeoPackage calls onto a bounded thread pool, send GEOS and PROJ arithmetic to processes, and instrument the loop for stalls.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Classify every call by what it waits on",
          "text": "Separate network wait, blocking disk or driver calls that cannot yield, and CPU inside GEOS or PROJ, because the libraries give no signal at the call site and one model cannot serve all three."
        },
        {
          "@type": "HowToStep",
          "name": "Keep network wait on the event loop",
          "text": "Fan out concurrent HTTP range reads with an async client, which is where asyncio is genuinely strong — hundreds of in-flight requests on one thread with no CPU cost."
        },
        {
          "@type": "HowToStep",
          "name": "Push blocking calls onto a bounded thread pool",
          "text": "Wrap GDAL, rasterio, fiona and synchronous driver calls in run_in_executor, and bound the pool so a downstream stall cannot become thousands of threads each holding a dataset handle."
        },
        {
          "@type": "HowToStep",
          "name": "Send CPU work to processes",
          "text": "Run reprojection, geometry validation and spatial joins in a process pool sized to the deployment target's core count, since the global interpreter lock makes threads useless for them."
        },
        {
          "@type": "HowToStep",
          "name": "Instrument the loop for stalls",
          "text": "Measure how late the loop's scheduled wakes are and warn above a threshold, so a blocked loop is reported as a blocked loop rather than investigated as a network fault."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Is asyncio the right default for a geospatial service?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Only for the network-wait portion of it. Fetching tiles or Cloud-Optimized GeoTIFF ranges over HTTP is almost entirely waiting, and asyncio handles hundreds of concurrent requests on one thread very well. Reading a local GeoPackage is disk wait inside a C extension that never yields, so the loop cannot overlap it and threads are the right tool. Reprojection and geometry validation are CPU inside GEOS and PROJ, where neither asyncio nor threads help and only processes do. A pipeline that picks one model everywhere will be wrong in two of the three places."
          }
        },
        {
          "@type": "Question",
          "name": "Why is a single blocking call so damaging inside an event loop?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because it costs every concurrent task rather than one. An 800-millisecond synchronous GDAL open called from a coroutine stops the loop entirely, so 200 in-flight fetches all stall for the full 800 milliseconds and any scheduled callback is late by the same amount. The same call on a thread pool blocks only its own worker and the other requests proceed. What makes it hard to diagnose is the symptom: everything slows simultaneously, which is indistinguishable from a degraded link — especially on a forward node where the link genuinely is degraded."
          }
        },
        {
          "@type": "Question",
          "name": "How do you detect a blocked event loop rather than guessing?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Measure the loop's own scheduling drift. A task that sleeps for a fixed interval and compares the elapsed time against the interval it asked for will show the difference: a wake that is late by more than a couple of hundred milliseconds means something in a coroutine did not yield. Logging that drift turns an invisible global stall into a named event, so the investigation starts at the code rather than at the network. Without it a service reports high latency and nothing else, and the first place anyone looks is the link."
          }
        }
      ]
    }
  ]
}
</script>

# Async vs Threaded Python for Geospatial I/O

A tile-prefetch service written with `asyncio` fetches 200 COG windows concurrently and performs beautifully in testing. Deployed to a forward node it becomes erratic: latency spikes to nearly a second, all requests at once, with no correlation to network conditions. The cause is one line — a synchronous `rasterio.open` on a local file, called from inside a coroutine, which stops the entire event loop every time it runs.

## Problem Framing

Geospatial Python mixes three kinds of work that respond to concurrency in completely different ways, and the libraries do not signal which is which. `rasterio.open` on an HTTP URL is network wait; the same call on a local path is disk wait inside a C extension. `gdf.to_crs` looks like a method call and is several seconds of PROJ arithmetic. Choosing one concurrency model for the whole pipeline guarantees being wrong somewhere.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="as1-t as1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="as1-t">Where each kind of geospatial work actually spends its time</title>
  <desc id="as1-d">Four workloads classified by what they wait on. Fetching tiles or Cloud-Optimized GeoTIFF ranges over HTTP is almost entirely network wait, so concurrency helps enormously and asyncio is the natural fit. Reading a local GeoPackage is disk wait with a GIL-holding C extension in the middle, so threads help and asyncio does not, because the call never yields to the event loop. Reprojecting or validating geometry is pure CPU inside GEOS and PROJ, where neither model helps and only processes do. Writing to PostGIS is network wait again, but through a driver whose blocking calls will stall an event loop unless an async driver is used. The deciding question is never which model is faster — it is what the work is waiting on, and whether the call yields.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">what is this work waiting on, and does the call yield?</text>
  <text x="530" y="76" font-size="10" font-weight="700" fill="var(--muted)">async</text>
  <text x="620" y="76" font-size="10" font-weight="700" fill="var(--muted)">threads</text>
  <text x="720" y="76" font-size="10" font-weight="700" fill="var(--muted)">processes</text>
  <rect x="40" y="88" width="800" height="62" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="112" font-size="10.5" font-weight="700" fill="currentColor">fetching tiles / COG ranges over HTTP</text>
  <text x="60" y="132" font-size="10" fill="currentColor">almost entirely network wait — hundreds of concurrent requests, no CPU</text>
  <text x="530" y="122" font-size="11" font-weight="700" fill="var(--crimson-deep)">best</text>
  <text x="620" y="122" font-size="11" fill="currentColor">works</text>
  <text x="720" y="122" font-size="11" fill="var(--muted)">wasteful</text>
  <rect x="40" y="160" width="800" height="62" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="184" font-size="10.5" font-weight="700" fill="currentColor">reading a local GeoPackage</text>
  <text x="60" y="204" font-size="10" fill="currentColor">disk wait inside a GIL-holding C extension — the call never yields</text>
  <text x="530" y="194" font-size="11" font-weight="700" fill="var(--ember-text)">no help</text>
  <text x="620" y="194" font-size="11" font-weight="700" fill="var(--crimson-deep)">best</text>
  <text x="720" y="194" font-size="11" fill="currentColor">works</text>
  <rect x="40" y="232" width="800" height="62" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="256" font-size="10.5" font-weight="700" fill="var(--ember-text)">reprojecting / validating geometry</text>
  <text x="60" y="276" font-size="10" fill="currentColor">pure CPU inside GEOS and PROJ — nothing to overlap</text>
  <text x="530" y="266" font-size="11" font-weight="700" fill="var(--ember-text)">no help</text>
  <text x="620" y="266" font-size="11" font-weight="700" fill="var(--ember-text)">no help</text>
  <text x="720" y="266" font-size="11" font-weight="700" fill="var(--crimson-deep)">only option</text>
  <rect x="40" y="304" width="800" height="62" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="328" font-size="10.5" font-weight="700" fill="currentColor">writing to PostGIS</text>
  <text x="60" y="348" font-size="10" fill="currentColor">network wait — but a sync driver's calls will stall an event loop</text>
  <text x="530" y="338" font-size="11" font-weight="700" fill="var(--crimson-deep)">with an async driver</text>
  <text x="720" y="338" font-size="11" fill="var(--muted)">wasteful</text>
</svg>

The question that decides is not "which model is faster" but "what is this waiting on, and does the call yield?" Network wait through a library that yields is asyncio's case, and it is very strong there — hundreds of concurrent range reads on one thread. Blocking calls that cannot yield belong on threads. CPU inside GEOS or PROJ belongs on processes, because the global interpreter lock makes threads useless for it.

## Prerequisites

- **Python 3.11 or newer**, for task groups and improved `asyncio` timeout handling, in the pinned runtime described in [Dockerized GIS environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/).
- **An async HTTP client** — `httpx` or `aiohttp` — for anything reading tiles or COG ranges, per the [range-request serving guide](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/serving-hazard-rasters-over-range-requests-to-forward-nodes/).
- **An honest inventory of which calls block.** Every GDAL, `rasterio`, `fiona`, `shapely` and sync database call is blocking. There is no way to tell from the call site, so the inventory has to be deliberate.
- **A known core count** on the target node. A process pool sized for a workstation will thrash a field device.

## The Cost of One Blocking Call

<svg viewBox="0 0 880 380" role="img" aria-labelledby="as2-t as2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="as2-t">One blocking call inside an event loop, and what it costs everything else</title>
  <desc id="as2-d">An event loop is servicing 200 concurrent tile fetches when a coroutine calls a synchronous GDAL open on a local file that takes 800 milliseconds. Because the call does not yield, the loop cannot run any other task for that whole period: all 200 fetches stall, and any callback scheduled during it is late by up to 800 milliseconds. Under a thread pool the same call blocks only its own worker and the other 199 fetches proceed. The asymmetry is what makes a single accidental blocking call so damaging in an async design — it is not slow, it is globally slow, and it looks like a network problem because the symptom is that every request got slower at once.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one 800 ms blocking call, two concurrency models</text>
  <text x="8" y="82" font-size="10.5" font-weight="700" fill="currentColor">asyncio event loop</text>
  <rect x="200" y="94" width="120" height="30" rx="4" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <rect x="320" y="94" width="300" height="30" rx="4" fill="var(--ember)" opacity="0.5" stroke="var(--ember)" stroke-width="1.6"/>
  <rect x="620" y="94" width="200" height="30" rx="4" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <text x="336" y="114" font-size="10" font-weight="700" fill="currentColor">blocking GDAL open · 800 ms</text>
  <g fill="none" stroke="var(--ember)" stroke-width="1.6" stroke-dasharray="4 3">
    <path d="M320 134 H620"/><path d="M320 152 H620"/><path d="M320 170 H620"/>
  </g>
  <text x="336" y="192" font-size="10.5" font-weight="700" fill="var(--ember-text)">all 200 concurrent fetches stall for the full 800 ms</text>
  <text x="8" y="240" font-size="10.5" font-weight="700" fill="currentColor">thread pool</text>
  <rect x="200" y="252" width="120" height="26" rx="4" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <rect x="320" y="252" width="300" height="26" rx="4" fill="var(--ember)" opacity="0.5" stroke="var(--ember)" stroke-width="1.6"/>
  <text x="336" y="270" font-size="10" font-weight="700" fill="currentColor">the same 800 ms, on one worker</text>
  <g stroke="var(--crimson)" stroke-width="7" stroke-linecap="round">
    <path d="M200 292 H700"/><path d="M240 308 H760"/><path d="M210 324 H680"/>
  </g>
  <text x="200" y="348" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">the other 199 fetches proceed on other workers</text>
  <text x="8" y="372" font-size="10.5" fill="currentColor">The async failure is not that it is slow — it is that everything got slower at once, which reads as a network problem.</text>
</svg>

This is the failure that makes async designs fragile in this domain. A blocking call on a thread costs one worker. The same call on an event loop costs *every* concurrent task, because the loop cannot run anything while it is inside a function that does not yield.

The symptom is what makes it hard to diagnose: everything gets slower simultaneously, which looks exactly like a degraded link. On a forward node where the link genuinely is degraded, the two are almost impossible to separate without instrumenting the loop directly.

## The Hybrid Arrangement

<svg viewBox="0 0 880 360" role="img" aria-labelledby="as3-t as3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="as3-t">The hybrid arrangement most incident pipelines actually need</title>
  <desc id="as3-d">A realistic pipeline uses all three models in the places each one fits. An asyncio layer fans out hundreds of concurrent HTTP range reads for tiles and Cloud-Optimized GeoTIFF windows, because that work is pure network wait. Blocking GDAL and GeoPackage reads are pushed onto a bounded thread pool through run_in_executor, so they never stall the loop. CPU-bound reprojection and geometry validation go to a process pool sized to the core count, because the global interpreter lock makes threads useless for them. The rule is that the event loop owns waiting, threads own blocking calls that cannot be made to yield, and processes own arithmetic — and a pipeline that uses one model everywhere will be wrong in two of the three places.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the loop owns waiting · threads own unyielding calls · processes own arithmetic</text>
  <rect x="40" y="80" width="800" height="72" rx="9" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <text x="60" y="106" font-size="11" font-weight="700" fill="var(--cream)">asyncio event loop</text>
  <text x="60" y="128" font-size="10" fill="var(--cream)">hundreds of concurrent HTTP range reads — tiles, COG windows, partner APIs</text>
  <text x="60" y="146" font-size="10" fill="var(--cream)">pure network wait, no CPU, nothing that blocks</text>
  <rect x="40" y="166" width="800" height="72" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="192" font-size="11" font-weight="700" fill="currentColor">bounded thread pool · run_in_executor</text>
  <text x="60" y="214" font-size="10" fill="currentColor">blocking GDAL opens, GeoPackage reads, sync driver calls that cannot be made to yield</text>
  <text x="60" y="232" font-size="10" fill="currentColor">bounded, because an unbounded pool turns a stall into thousands of threads</text>
  <rect x="40" y="252" width="800" height="72" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="278" font-size="11" font-weight="700" fill="currentColor">process pool · sized to core count</text>
  <text x="60" y="300" font-size="10" fill="currentColor">reprojection, make_valid, spatial joins — CPU inside GEOS and PROJ</text>
  <text x="60" y="318" font-size="10" fill="currentColor">the GIL makes threads useless here, and oversubscription makes it worse</text>
  <text x="8" y="348" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">A pipeline that picks one model everywhere will be wrong in two of the three places.</text>
</svg>

In practice an incident pipeline needs all three. The loop fans out the network work, `run_in_executor` absorbs the blocking calls that cannot be made to yield, and a process pool takes the arithmetic. The important constraint is that the thread pool is *bounded* — an unbounded pool converts a downstream stall into thousands of threads, each holding a GDAL dataset handle, which fails the node rather than the request.

## Step-by-Step Implementation

```python
from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from dataclasses import dataclass

import httpx

logger = logging.getLogger("incidentgis.concurrency")

# Bounded deliberately: an unbounded pool turns a downstream stall into
# thousands of threads each holding a GDAL dataset handle.
BLOCKING_POOL_SIZE = 8
CPU_POOL_SIZE = max(1, (os.cpu_count() or 2) - 1)
# Anything longer than this inside the loop is a bug, not slow I/O.
LOOP_STALL_WARN_S = 0.25


@dataclass(frozen=True)
class WindowRequest:
    url: str
    offset: int
    length: int


class GeospatialRuntime:
    """One loop, one bounded thread pool, one process pool.

    The split is by what the work waits on, not by what is convenient to
    write: the loop owns network waiting, threads own calls that cannot
    yield, processes own arithmetic.
    """

    def __init__(self) -> None:
        self._threads = ThreadPoolExecutor(max_workers=BLOCKING_POOL_SIZE,
                                           thread_name_prefix="gis-blocking")
        self._procs = ProcessPoolExecutor(max_workers=CPU_POOL_SIZE)
        self._client = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=200), timeout=30.0
        )

    async def fetch_windows(self, requests: list[WindowRequest]) -> list[bytes]:
        """Pure network wait — exactly what the loop is for."""
        async def one(req: WindowRequest) -> bytes:
            headers = {"Range": f"bytes={req.offset}-{req.offset + req.length - 1}"}
            resp = await self._client.get(req.url, headers=headers)
            if resp.status_code != 206:
                # A 200 here means some hop stripped the Range header and we
                # just downloaded the whole object.
                raise RuntimeError(f"range not honoured for {req.url}")
            return resp.content

        async with asyncio.TaskGroup() as tg:
            tasks = [tg.create_task(one(r)) for r in requests]
        return [t.result() for t in tasks]

    async def read_local(self, path: str):
        """A blocking GDAL call, kept off the loop.

        Calling rasterio.open directly from a coroutine is the single most
        common way an async geospatial service acquires a global stall.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._threads, _blocking_read, path)

    async def reproject(self, payload: bytes, epsg: int):
        """CPU inside PROJ — threads cannot help, so use a process."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._procs, _cpu_reproject, payload, epsg)

    async def watch_for_stalls(self) -> None:
        """Detect a blocked loop directly rather than inferring it.

        The loop should wake on schedule; a wake that is late by more than the
        threshold means something in a coroutine did not yield.
        """
        while True:
            start = asyncio.get_running_loop().time()
            await asyncio.sleep(0.1)
            drift = asyncio.get_running_loop().time() - start - 0.1
            if drift > LOOP_STALL_WARN_S:
                logger.warning("event_loop_stalled", extra={"drift_s": round(drift, 3)})

    async def aclose(self) -> None:
        await self._client.aclose()
        self._threads.shutdown(wait=True)
        self._procs.shutdown(wait=True)


def _blocking_read(path: str):
    import rasterio
    with rasterio.open(path) as src:
        return src.read(1, masked=True)


def _cpu_reproject(payload: bytes, epsg: int):
    import geopandas as gpd
    from io import BytesIO
    return gpd.read_file(BytesIO(payload)).to_crs(epsg=epsg).to_json()
```

## Configuration Reference

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Blocking pool size | `GIS_BLOCKING_WORKERS` | `8` | Bounded on purpose; each worker may hold a GDAL handle. |
| CPU pool size | `GIS_CPU_WORKERS` | cores − 1 | Oversubscription thrashes, exactly as the ingestion worker curve shows. |
| Max HTTP connections | `GIS_MAX_CONNECTIONS` | `200` | Above the server's own limit this just queues in the client. |
| Loop stall threshold | `GIS_LOOP_STALL_S` | `0.25` | Anything longer inside the loop is a bug, not slow I/O. |
| HTTP timeout | `GIS_HTTP_TIMEOUT_S` | `30` | Lower on a flaky link so a stall fails fast rather than hanging. |
| Executor for GDAL | — | threads | Never the loop; never a process, which would copy the dataset. |

## Verification and Smoke Test

The stall watcher is the test. Run the service under load, call a deliberately blocking function from a coroutine, and assert the warning fires:

```python
async def test_stall_detected(runtime, caplog):
    watcher = asyncio.create_task(runtime.watch_for_stalls())
    time.sleep(0.6)                     # deliberately blocking, inside the loop
    await asyncio.sleep(0.3)
    watcher.cancel()
    assert any("event_loop_stalled" in r.message for r in caplog.records)
```

A service without this check will not report a blocked loop; it will report high latency, and the investigation will start at the network.

## Integration With Adjacent Workflows

The network side of this is what makes [range-request reads](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/serving-hazard-rasters-over-range-requests-to-forward-nodes/) fast enough to be useful on a forward node, and the CPU side is bounded by the same core-count reasoning as the [ingestion worker pool](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/). Both pools compete with PostGIS if it shares the host, which is the argument for the container CPU quota in the [Dockerized environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) guide.

A closing note on when none of this is worth doing. Concurrency is a response to a measured constraint, and a pipeline that processes a few hundred features per operational period has no constraint to respond to — adding an event loop, two executor pools and a stall watcher to it buys nothing and costs every future reader of the code. The threshold worth applying is whether the work is currently bounded by waiting: if a profile shows the process spending most of its time inside network or disk calls, the split described here will help, and if it shows time inside GEOS and PROJ, the answer is a process pool and nothing else.

The corollary matters more on a forward node than on a server. Each of the three models carries a fixed cost in memory and in complexity, and on a device that also runs a database, a sync client and a map application, that cost competes with the work itself. Start with the simplest model that meets the measured requirement, measure again on the target hardware rather than on a workstation, and add a second model only when a profile on the real device says the first one is the constraint.

## Troubleshooting

**Symptom: latency spikes across all requests simultaneously.** A blocking call inside a coroutine. Enable the stall watcher before investigating the network.

**Symptom: memory grows until the process is killed.** An unbounded thread pool holding GDAL dataset handles. Bound the pool and close datasets explicitly.

**Symptom: the process pool is slower than doing the work inline.** Payloads are being pickled across the process boundary. For small geometries the copy dominates; batch them or keep the work in-process.

**Symptom: `run_in_executor` calls never complete under load.** The pool is exhausted by long-running blocking calls with no timeout. Bound the call, not just the pool.

**Symptom: everything is fast on the workstation and slow on the node.** The CPU pool was sized from `os.cpu_count()` on a machine with far more cores. Size from the deployment target.

## Frequently Asked Questions

**Is asyncio the right default for a geospatial service?** Only for the network-wait portion of it. Fetching tiles or Cloud-Optimized GeoTIFF ranges over HTTP is almost entirely waiting, and asyncio handles hundreds of concurrent requests on one thread very well. Reading a local GeoPackage is disk wait inside a C extension that never yields, so the loop cannot overlap it and threads are the right tool. Reprojection and geometry validation are CPU inside GEOS and PROJ, where neither asyncio nor threads help and only processes do. A pipeline that picks one model everywhere will be wrong in two of the three places.

**Why is a single blocking call so damaging inside an event loop?** Because it costs every concurrent task rather than one. An 800-millisecond synchronous GDAL open called from a coroutine stops the loop entirely, so 200 in-flight fetches all stall for the full 800 milliseconds and any scheduled callback is late by the same amount. The same call on a thread pool blocks only its own worker and the other requests proceed. What makes it hard to diagnose is the symptom: everything slows simultaneously, which is indistinguishable from a degraded link — especially on a forward node where the link genuinely is degraded.

**How do you detect a blocked event loop rather than guessing?** Measure the loop's own scheduling drift. A task that sleeps for a fixed interval and compares the elapsed time against the interval it asked for will show the difference: a wake that is late by more than a couple of hundred milliseconds means something in a coroutine did not yield. Logging that drift turns an invisible global stall into a named event, so the investigation starts at the code rather than at the network. Without it a service reports high latency and nothing else, and the first place anyone looks is the link.

## Related

- [Serving Hazard Rasters Over Range Requests](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/serving-hazard-rasters-over-range-requests-to-forward-nodes/) — the concurrent network reads the event loop exists to serve.
- [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) — the CPU quota that stops these pools competing with the database on the same host.
- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) — the worker-count curve that explains why the CPU pool is sized below the core count.
- [Handling MQTT Reconnect Storms During Wildfire Surge](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/handling-mqtt-reconnect-storms-during-wildfire-surge/) — marshalling a broker callback onto the loop without blocking it.

Up: [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/)
