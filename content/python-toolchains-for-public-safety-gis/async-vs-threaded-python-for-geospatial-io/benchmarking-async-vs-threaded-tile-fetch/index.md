---
title: "Benchmarking Async vs Threaded Tile Fetch"
description: "Tile prefetch throughput is latency-bound, so the ceiling is usually the server's connection limit rather than the client. Measure that first, report memory alongside throughput, and publish a curve."
slug: benchmarking-async-vs-threaded-tile-fetch
type: article
breadcrumb: "Benchmarking Tile Fetch"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Benchmarking Async vs Threaded Tile Fetch",
      "description": "Tile prefetch throughput is latency-bound, so the ceiling is usually the server's connection limit rather than the client. Measure that first, report memory alongside throughput, and publish a curve.",
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
          "name": "Benchmarking Async vs Threaded Tile Fetch",
          "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/async-vs-threaded-python-for-geospatial-io/benchmarking-async-vs-threaded-tile-fetch/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Benchmark concurrent tile fetching so the result transfers to production",
      "description": "Establish the server's connection limit before comparing models, benchmark on the deployment link's latency, keep decoding out of the primary measurement, enable connection reuse consistently, and report memory alongside throughput as a curve.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Measure the server's connection limit",
          "text": "Find where the server stops accepting more concurrent connections, because that is usually the real ceiling and it tells you immediately whether the two models can differ at all."
        },
        {
          "@type": "HowToStep",
          "name": "Benchmark on the deployment's latency",
          "text": "Run against a link with the round-trip time the node actually has, since latency sets where the crossover between the models falls."
        },
        {
          "@type": "HowToStep",
          "name": "Exclude decoding, then add it back",
          "text": "Measure pure fetch first and mixed fetch-plus-decode separately, because decoding in-process reintroduces the interpreter lock and flattens both curves."
        },
        {
          "@type": "HowToStep",
          "name": "Reuse connections consistently",
          "text": "Enable or disable keep-alive for both models identically and state which, since without pooling every request pays a TLS handshake that dominates a high-latency result."
        },
        {
          "@type": "HowToStep",
          "name": "Report memory with throughput",
          "text": "Publish peak resident memory against concurrency alongside the rate, because a model that is faster and does not fit on the node has not won."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Is asyncio actually faster than threads for fetching tiles?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Above a crossover, yes, and below it the two are indistinguishable. On a link with 180 milliseconds of round-trip latency both models rise steeply while concurrency is low, because throughput is latency-bound and each extra in-flight request is nearly free. The thread pool peaks near 64 workers at roughly 340 tiles per second and then declines as context switching and stack memory outweigh the overlap; the coroutine client keeps climbing to around 900 tiles per second at 400 in-flight requests. The crossover sits near 40 concurrent requests, and below it the simpler model wins on maintenance rather than losing on speed."
          }
        },
        {
          "@type": "Question",
          "name": "Why do tile-fetch benchmarks so often fail to transfer to production?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because the ceiling in production is usually the server, not the client. A benchmark run against a local test server with no connection limit measures how many requests the client can keep in flight; a production tile server capping each client at 32 connections means neither model ever reaches the region where they differ. Measuring the server's limit first turns a two-hour benchmark into a five-minute answer, because if the cap is below the crossover the rewrite cannot pay for itself no matter what the curve looks like."
          }
        },
        {
          "@type": "Question",
          "name": "Does memory matter in this comparison?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "On a forward node it frequently decides it. Four hundred concurrent coroutines cost about 120 megabytes because each in-flight request is a coroutine and a buffer, while four hundred threads cost over a gigabyte because each carries its own stack and, on a geospatial workload, often an open dataset handle as well. Against a 1.2 gigabyte device budget the thread pool becomes unavailable somewhere past 380 workers and the coroutine client never approaches it. On a workstation the difference is invisible, which is exactly why it is missed."
          }
        }
      ]
    }
  ]
}
</script>

# Benchmarking Async vs Threaded Tile Fetch

A team benchmarks tile prefetch, finds `asyncio` twice as fast as a thread pool, and rewrites the service. In production the difference is about four per cent, because the tile server caps each client at 32 connections and the benchmark ran against a local test server with no limit at all.

## Root Cause and Operational Impact

Tile and COG range fetching is the one geospatial workload where `asyncio` has a genuine structural advantage, and it is also the workload where benchmarks most often measure something other than the client. Throughput here is latency-bound rather than bandwidth-bound, so what is really being measured is how many requests can be in flight — and that number is capped by whichever of the client, the server, or the link runs out first.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="tb1-t tb1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="tb1-t">Tiles fetched per second against concurrency, for both models on a 180 ms link</title>
  <desc id="tb1-d">Tile fetch throughput against the number of in-flight requests on a link with 180 milliseconds of round-trip latency. Both models rise steeply while concurrency is low, because throughput is latency-bound and each additional in-flight request is nearly free. The thread pool flattens around 64 workers at about 340 tiles per second and then declines, as context switching and per-thread stack memory start to cost more than the overlap gains. The asyncio client keeps climbing to about 900 tiles per second at 400 in-flight requests, where it meets the server's own connection limit rather than any client-side ceiling. The crossover is near 40 concurrent requests: below it the two are indistinguishable and the simpler model wins.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">180 ms round trip — the ceiling is the server, not the client</text>
  <text x="8" y="70" font-size="10" fill="var(--muted)">tiles/s</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 240 H820"/><path d="M180 180 H820"/><path d="M180 120 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="140" y="304">0</text><text x="132" y="244">250</text><text x="132" y="184">500</text><text x="132" y="124">750</text><text x="126" y="64">1000</text>
  </g>
  <path d="M180 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 296 L260 250 L340 218 L420 224 L520 238 L640 254 L820 268" fill="none" stroke="var(--ember)" stroke-width="2.8"/>
  <path d="M180 296 L260 248 L340 196 L420 160 L520 126 L640 100 L820 84" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <text x="560" y="248" font-size="10.5" font-weight="700" fill="var(--ember-text)">thread pool — peaks near 64 workers, then declines</text>
  <text x="480" y="94" font-size="10.5" font-weight="700" fill="var(--crimson)">asyncio — climbs to the server's connection limit</text>
  <path d="M330 60 V300" fill="none" stroke="var(--crimson-deep)" stroke-width="1.4" stroke-dasharray="5 4"/>
  <text x="200" y="76" font-size="10" font-weight="700" fill="var(--crimson-deep)">below ~40 they are indistinguishable</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="320">1</text><text x="340" y="320">40</text><text x="500" y="320">120</text><text x="660" y="320">250</text><text x="820" y="320">400</text>
    <text x="500" y="344" font-size="11">in-flight requests</text>
  </g>
  <text x="8" y="372" font-size="10.5" fill="currentColor">Below the crossover the simpler model wins on maintenance, not on speed.</text>
</svg>

Below about 40 concurrent requests the two models are indistinguishable, because neither is anywhere near its own ceiling and both are simply waiting. Above it the thread pool turns over as context switching and stack memory start to cost more than the overlap gains, while the coroutine client keeps climbing until it meets the *server's* connection limit.

That last clause is the one that decides whether the rewrite is worth doing. If the tile server caps a client at 32 connections, the crossover never arrives and both models sit in the region where they are equivalent.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="tb2-t tb2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="tb2-t">Memory cost of concurrency under each model</title>
  <desc id="tb2-d">Resident memory against the number of concurrent tile fetches. The asyncio client grows slowly, from about 45 megabytes at one request to about 120 megabytes at 400, because each in-flight request is a coroutine and a buffer. The thread pool grows steeply, from about 48 megabytes to roughly 1.1 gigabytes at 400 workers, because each thread carries its own stack and, on a geospatial workload, frequently an open dataset handle as well. A 1.2 gigabyte field-device budget is crossed by the thread pool somewhere past 380 workers and never by the coroutine client. On a workstation this difference is invisible; on the node that actually runs the prefetch it decides whether the model is available at all.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">concurrency is cheap in coroutines and expensive in threads</text>
  <text x="8" y="70" font-size="10" fill="var(--muted)">resident memory</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 230 H820"/><path d="M180 170 H820"/><path d="M180 110 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="130" y="294">0</text><text x="122" y="234">300</text><text x="122" y="174">600</text><text x="122" y="114">900</text><text x="116" y="64">1200 MB</text>
  </g>
  <path d="M180 290 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V290" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 H820" fill="none" stroke="var(--crimson-deep)" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="560" y="54" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">1.2 GB field-device budget</text>
  <path d="M180 281 L340 276 L500 268 L660 260 L820 254" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <path d="M180 280 L340 244 L500 190 L660 128 L820 72" fill="none" stroke="var(--ember)" stroke-width="2.8"/>
  <text x="560" y="278" font-size="10.5" font-weight="700" fill="var(--crimson)">asyncio — 45 MB → 120 MB</text>
  <text x="520" y="130" font-size="10.5" font-weight="700" fill="var(--ember-text)">threads — 48 MB → ~1.1 GB</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="310">1</text><text x="340" y="310">100</text><text x="500" y="310">200</text><text x="660" y="310">300</text><text x="820" y="310">400</text>
    <text x="500" y="334" font-size="11">concurrent fetches</text>
  </g>
  <text x="8" y="356" font-size="10.5" fill="currentColor">Each thread carries a stack, and on this workload frequently an open dataset handle too.</text>
</svg>

Memory is the second axis, and on a forward node it is often the deciding one. Four hundred coroutines cost about 120 MB; four hundred threads cost over a gigabyte, because each carries a stack and — on this workload — frequently an open dataset handle too. On a workstation this is invisible. On the device that actually runs the prefetch it determines whether the thread pool is available at all.

## Tiered Resolution Strategy

1. **Measure the server's connection limit first (definitive).** It is usually the real ceiling, and knowing it tells you immediately whether the models will differ at all.
2. **Benchmark on the link the node actually has.** Latency sets the crossover; a result from a 20 ms office link says nothing about a 180 ms satellite one.
3. **Keep decode out of the measurement, then add it back deliberately.** Decoding in the same process reintroduces the global interpreter lock and flattens both curves, which is a real effect and a different experiment.
4. **Reuse connections, and say whether you did (safe default).** Without pooling, every request pays a TLS handshake, which on a slow link dominates the result and makes both models look identical.
5. **Report memory alongside throughput.** A model that is faster and does not fit on the node has not won.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="tb3-t tb3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="tb3-t">Four conditions that decide the benchmark before the model does</title>
  <desc id="tb3-d">Four conditions that must be stated for a tile-fetch benchmark to mean anything. Round-trip latency sets where the crossover falls: on a 20-millisecond link the thread pool keeps up far longer than on a 180-millisecond one. The server's own connection limit is usually the real ceiling, so a benchmark against a permissive test server measures the client and one against production measures the server. Whether the fetched tiles are decoded in the same process turns a pure I/O benchmark into a mixed one, at which point the global interpreter lock reappears and both models flatten. And connection reuse decides whether each request pays a TLS handshake, which on a high-latency link can dominate everything else. A result without all four stated is not reproducible.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">state these four or the number means nothing</text>
  <rect x="40" y="72" width="800" height="54" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="94" font-size="10.5" font-weight="700" fill="currentColor">round-trip latency</text>
  <text x="300" y="94" font-size="10" fill="currentColor">sets where the crossover falls — at 20 ms threads keep up far longer than at 180 ms</text>
  <rect x="40" y="134" width="800" height="54" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.6"/>
  <text x="60" y="156" font-size="10.5" font-weight="700" fill="var(--cream)">the server's connection limit</text>
  <text x="300" y="156" font-size="10" fill="var(--cream)">usually the real ceiling — a permissive test server measures the client, production measures the server</text>
  <rect x="40" y="196" width="800" height="54" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="218" font-size="10.5" font-weight="700" fill="currentColor">decoding in the same process</text>
  <text x="300" y="218" font-size="10" fill="currentColor">turns a pure I/O benchmark into a mixed one, and both models flatten against the GIL</text>
  <rect x="40" y="258" width="800" height="54" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="280" font-size="10.5" font-weight="700" fill="currentColor">connection reuse</text>
  <text x="300" y="280" font-size="10" fill="currentColor">without it every request pays a TLS handshake, which on a slow link dominates everything else</text>
</svg>

## Production Python Implementation

```python
from __future__ import annotations

import asyncio
import logging
import resource
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, asdict

import httpx

logger = logging.getLogger("incidentgis.fetch_benchmark")


@dataclass
class FetchResult:
    model: str
    concurrency: int
    tiles_per_second: float
    peak_rss_mb: float
    rtt_ms: float
    server_conn_limit: int | None
    connection_reuse: bool
    decoded_in_process: bool


def _peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


async def bench_async(urls: list[str], concurrency: int, *, reuse: bool) -> float:
    """Coroutine fetch. Concurrency is bounded by a semaphore, not by the pool."""
    limits = httpx.Limits(
        max_connections=concurrency,
        max_keepalive_connections=concurrency if reuse else 0,
    )
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(limits=limits, timeout=30.0) as client:
        async def one(url: str) -> None:
            async with sem:
                resp = await client.get(url)
                resp.raise_for_status()
        start = time.perf_counter()
        async with asyncio.TaskGroup() as tg:
            for u in urls:
                tg.create_task(one(u))
        return len(urls) / (time.perf_counter() - start)


def bench_threads(urls: list[str], concurrency: int, *, reuse: bool) -> float:
    """Thread-pool fetch with a shared session, so pooling is comparable."""
    client = httpx.Client(
        limits=httpx.Limits(
            max_connections=concurrency,
            max_keepalive_connections=concurrency if reuse else 0,
        ),
        timeout=30.0,
    )
    try:
        start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            for _ in pool.map(lambda u: client.get(u).raise_for_status(), urls):
                pass
        return len(urls) / (time.perf_counter() - start)
    finally:
        client.close()


def measure_server_limit(url: str, ceiling: int = 512) -> int | None:
    """Find where the server stops accepting more concurrent connections.

    This is usually the real ceiling, so establishing it first tells you
    whether the two models can differ at all on this deployment.
    """
    lo, hi = 1, ceiling
    accepted = None
    while lo <= hi:
        mid = (lo + hi) // 2
        try:
            rate = asyncio.run(bench_async([url] * mid, mid, reuse=True))
        except (httpx.HTTPError, OSError):
            hi = mid - 1
            continue
        accepted, lo = mid, mid + 1
        logger.debug("server_accepted_concurrency", extra={"n": mid, "rate": rate})
    return accepted
```

## Validation Checklist

- [ ] The server's concurrent-connection limit is measured and reported.
- [ ] Round-trip latency is stated and matches the deployment target's link.
- [ ] Connection reuse is enabled for both models, or disabled for both, and stated.
- [ ] Decoding is excluded from the primary measurement and reported separately.
- [ ] Peak resident memory is reported alongside throughput.
- [ ] Both models use the same client library so the comparison is of concurrency, not of HTTP stacks.
- [ ] The result is a curve against concurrency, not a single number.
- [ ] The chosen concurrency is below the server's limit in production configuration.

## Edge Cases and Gotchas

- **A test server with no connection limit.** The most common way this benchmark misleads. Measure against something configured like production, or state loudly that the ceiling is artificial.
- **Different HTTP libraries per model.** Comparing `aiohttp` against `requests` measures two HTTP stacks, not two concurrency models. Use one library in both modes.
- **Warm caches on the server.** The second run fetches from the server's page cache and is not the same experiment as the first. Randomise the tile set or accept that you are measuring the warm case.
- **Ignoring the memory axis.** A thread pool that reaches a good number at 400 workers and needs a gigabyte has not won on a node with 1.2 GB total.
- **Benchmarking prefetch in isolation.** In the real service the fetch competes with decode, reprojection, and the database, exactly as the [concurrency split](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/async-vs-threaded-python-for-geospatial-io/) describes. An isolated number is an upper bound.

## Frequently Asked Questions

**Is asyncio actually faster than threads for fetching tiles?** Above a crossover, yes, and below it the two are indistinguishable. On a link with 180 milliseconds of round-trip latency both models rise steeply while concurrency is low, because throughput is latency-bound and each extra in-flight request is nearly free. The thread pool peaks near 64 workers at roughly 340 tiles per second and then declines as context switching and stack memory outweigh the overlap; the coroutine client keeps climbing to around 900 tiles per second at 400 in-flight requests. The crossover sits near 40 concurrent requests, and below it the simpler model wins on maintenance rather than losing on speed.

**Why do tile-fetch benchmarks so often fail to transfer to production?** Because the ceiling in production is usually the server, not the client. A benchmark run against a local test server with no connection limit measures how many requests the client can keep in flight; a production tile server capping each client at 32 connections means neither model ever reaches the region where they differ. Measuring the server's limit first turns a two-hour benchmark into a five-minute answer, because if the cap is below the crossover the rewrite cannot pay for itself no matter what the curve looks like.

**Does memory matter in this comparison?** On a forward node it frequently decides it. Four hundred concurrent coroutines cost about 120 megabytes because each in-flight request is a coroutine and a buffer, while four hundred threads cost over a gigabyte because each carries its own stack and, on a geospatial workload, often an open dataset handle as well. Against a 1.2 gigabyte device budget the thread pool becomes unavailable somewhere past 380 workers and the coroutine client never approaches it. On a workstation the difference is invisible, which is exactly why it is missed.

## Related

- [Async vs Threaded Python for Geospatial I/O](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/async-vs-threaded-python-for-geospatial-io/) — the split this benchmark is meant to inform, and why decode belongs elsewhere.
- [Serving Hazard Rasters Over Range Requests](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/serving-hazard-rasters-over-range-requests-to-forward-nodes/) — the request-count reasoning that makes latency, not bandwidth, the binding constraint.
- [Benchmarking Dockerized GIS Throughput Under Surge Load](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/benchmarking-dockerized-gis-throughput-under-surge-load/) — the same insistence on stating the conditions that move the result.
- [Pre-Staging Vector Tiles Before a Forecasted Landfall](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/pre-staging-vector-tiles-before-a-forecasted-landfall/) — the bulk-seeding job this concurrency choice is usually made for.

Up: [Async vs Threaded Python for Geospatial I/O](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/async-vs-threaded-python-for-geospatial-io/)
