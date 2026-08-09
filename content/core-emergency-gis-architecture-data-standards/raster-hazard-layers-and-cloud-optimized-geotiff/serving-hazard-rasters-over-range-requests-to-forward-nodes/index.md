---
title: "Serving Hazard Rasters Over Range Requests"
description: "A correct Cloud-Optimized GeoTIFF still downloads whole if any hop strips the Range header. Diagnosing request counts, aligning block sizes, and staging a division before the uplink dies rather than after."
slug: serving-hazard-rasters-over-range-requests-to-forward-nodes
type: article
breadcrumb: "Serving Rasters Over Range Requests"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Serving Hazard Rasters Over Range Requests",
      "description": "A correct Cloud-Optimized GeoTIFF still downloads whole if any hop strips the Range header. Diagnosing request counts, aligning block sizes, and staging a division before the uplink dies rather than after.",
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
          "name": "Core Emergency GIS Architecture & Data Standards",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/"
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "Raster Hazard Layers & Cloud-Optimized GeoTIFF",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/"
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Serving Hazard Rasters Over Range Requests",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/serving-hazard-rasters-over-range-requests-to-forward-nodes/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Diagnose and fix a Cloud-Optimized GeoTIFF delivery path",
      "description": "Confirm every hop honours HTTP range requests, count requests rather than timing reads, align the client's read window to the file's block size, and stage a local copy on a degradation signal rather than after a failure.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Confirm the path honours ranges",
          "text": "Issue a Range request against the URL field nodes actually use and check for a 206 response with a Content-Range header, since a proxy or CDN between the client and the store is the usual place the property is lost."
        },
        {
          "@type": "HowToStep",
          "name": "Count requests, not seconds",
          "text": "Enable curl verbosity in GDAL and count the range requests one window read issues; four to six is healthy and dozens indicate wrong tiling or an undersized client cache."
        },
        {
          "@type": "HowToStep",
          "name": "Align the read window to the block size",
          "text": "Match the client's read window and block cache to the file's internal block size, or each block is fetched several times and the request count multiplies on a high-latency link."
        },
        {
          "@type": "HowToStep",
          "name": "Stage on degradation, not failure",
          "text": "Trigger local staging from rising round-trip time or error rate while bandwidth still exists, because once requests are failing there is no capacity left to stage anything."
        },
        {
          "@type": "HowToStep",
          "name": "Audit range counts per session",
          "text": "Log requests and bytes per window read so a change in the delivery path becomes visible before the next incident rather than during it."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How do I tell whether a slow raster read is the file or the delivery path?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Count requests and bytes rather than timing the read. A single Range request against the published URL should return 206 Partial Content with a Content-Range header; if it returns 200 with the whole object, some hop is stripping the header and the file is irrelevant. If ranges are honoured but a window read issues dozens of requests, the file's internal tiling or the client's read window is wrong. Both failures present identically as 'the map is slow on satellite', which is why elapsed time is the one measurement that cannot distinguish them."
          }
        },
        {
          "@type": "Question",
          "name": "Why does request count matter more than bytes on a satellite link?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because latency dominates. At a 700-millisecond round trip, forty sequential range requests cost about 28 seconds of pure waiting no matter how few bytes each carries, while four requests cost about 3 seconds. On a 30-millisecond terrestrial link the same two files differ by roughly a second and nobody notices. Since forward nodes are exactly the consumers on high-latency links, block size and tile contiguity are worth tuning at production time even when the byte totals look similar."
          }
        },
        {
          "@type": "Question",
          "name": "When should a forward node stage a local copy instead of reading remotely?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "On the first sign of degradation, not on the first failure. Staging needs bandwidth, and by the time requests are failing there is none left, so a job triggered by an outage never completes. Trigger on rising round-trip time, rising retransmits or a falling success rate, give the job a hard time budget derived from current throughput, and stage from an overview level rather than full resolution — a coarser complete copy is worth far more in the field than a finer incomplete one."
          }
        }
      ]
    }
  ]
}
</script>

# Serving Hazard Rasters Over Range Requests

A command vehicle parks on a ridge with a satellite terminal, opens the regional flood-depth COG, and waits eleven seconds for a county-wide view that should have taken three. The file is correct, the server supports ranges, and the object store is fast. The problem is that a reverse proxy in front of the store is buffering responses and stripping `Range`, so every "partial" read is a full object fetch that the proxy truncates before forwarding.

## Root Cause and Operational Impact

A Cloud-Optimized GeoTIFF's entire benefit is contractual rather than intrinsic: the file promises that a small number of byte ranges answer a window query, and every hop between the client and the bytes has to honour that promise. Producing a correct COG is the easy half. The delivery path — object store, signing scheme, CDN, reverse proxy, and the client's own configuration — is where the property is quietly lost, and losing it anywhere produces the same symptom.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="rr1-t rr1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="rr1-t">One window read, traced through the request chain</title>
  <desc id="rr1-d">A forward node opening a window of a remote Cloud-Optimized GeoTIFF issues four HTTP requests. A HEAD establishes the object size and confirms the server accepts ranges. A first range read of the leading 16 kilobytes returns the header and image file directory, from which the client learns the tile layout and overview offsets. A second range read fetches the overview block covering the requested extent. A third fetches the full-resolution tiles only if the display scale requires them. Each hop that fails to support ranges collapses the chain into a whole-object download: a proxy that strips the Range header, a CDN that does not honour partial content, or a signed URL scheme that rejects range requests all produce the same symptom, which is a client that appears simply slow.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">four requests to read one window — and every hop must preserve them</text>
  <rect x="40" y="76" width="800" height="46" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="96" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">HEAD /hazard_depth.tif</text>
  <text x="60" y="113" font-size="10" fill="currentColor">object size · Accept-Ranges: bytes — if this header is absent the client gives up on partial reads entirely</text>
  <rect x="40" y="132" width="800" height="46" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="152" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">GET Range: bytes=0-16383</text>
  <text x="60" y="169" font-size="10" fill="currentColor">header + IFD — the tile layout and overview offsets, ~16 KB</text>
  <rect x="40" y="188" width="800" height="46" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.5"/>
  <text x="60" y="208" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--cream)">GET Range: bytes=&lt;overview block&gt;</text>
  <text x="60" y="225" font-size="10" fill="var(--cream)">the coarse tiles covering the extent — this is the whole read at a situational scale</text>
  <rect x="40" y="244" width="800" height="46" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="264" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">GET Range: bytes=&lt;full-res tiles&gt;</text>
  <text x="60" y="281" font-size="10" fill="currentColor">only when the display scale needs them</text>
  <rect x="40" y="308" width="800" height="56" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="330" font-size="10.5" font-weight="700" fill="var(--ember-text)">any hop that drops Range collapses this into a 4 GB download</text>
  <text x="60" y="350" font-size="10" fill="currentColor">a proxy that strips the header · a CDN not honouring 206 · a signing scheme that rejects ranges — all present as "the client is slow"</text>
</svg>

The symptom is the reason this is worth its own guide. A path that has stopped honouring ranges does not error; it returns correct pixels, slowly, so the report that reaches an engineer is "the map is slow on satellite", which is also what genuine bandwidth constraints look like. Distinguishing them requires counting requests and bytes rather than timing the operation.

The second failure mode is subtler and belongs to the file rather than the path: a COG whose window read needs forty requests instead of four. On a terrestrial link nobody notices. On the link a forward node actually has, latency dominates completely.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="rr2-t rr2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="rr2-t">Latency of one window read against link round-trip time, by request count</title>
  <desc id="rr2-d">Time to open a window plotted against the link's round-trip time, for a well-formed file needing four requests and a poorly tiled one needing forty. On a 30-millisecond terrestrial link the four-request read takes about 0.2 seconds and the forty-request read about 1.4 seconds — both acceptable. On a 700-millisecond satellite link the four-request read takes about 3.1 seconds while the forty-request read takes about 29 seconds, because latency, not bandwidth, dominates. Request count is therefore the property that matters on the links forward nodes actually have, which is why block size and tile contiguity are worth tuning even when the byte totals look similar.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">on a satellite link, request count matters more than byte count</text>
  <text x="8" y="76" font-size="10" fill="var(--muted)">time to open one window</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M200 220 H820"/><path d="M200 160 H820"/><path d="M200 100 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="150" y="284">0.1 s</text><text x="158" y="224">1 s</text><text x="152" y="164">10 s</text><text x="146" y="104">100 s</text>
  </g>
  <path d="M200 280 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M200 60 V280" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M200 262 L420 236 L620 196 L820 168" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <path d="M200 212 L420 186 L620 142 L820 112" fill="none" stroke="var(--ember)" stroke-width="2.8"/>
  <text x="560" y="188" font-size="10.5" font-weight="700" fill="var(--crimson)">4 requests — well-tiled</text>
  <text x="560" y="132" font-size="10.5" font-weight="700" fill="var(--ember-text)">40 requests — poorly tiled</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="200" y="300">10 ms</text><text x="420" y="300">100 ms</text><text x="620" y="300">400 ms</text><text x="820" y="300">700 ms</text>
    <text x="510" y="324" font-size="11">link round-trip time</text>
  </g>
  <text x="8" y="352" font-size="10.5" fill="currentColor">Both are fine on a terrestrial link. Only one is usable from a command vehicle on satellite.</text>
</svg>

At 700 milliseconds round-trip, forty sequential range requests cost 28 seconds of pure waiting regardless of how few bytes they carry. This is why block size and tile contiguity are worth tuning even when the byte totals look similar — the quantity that matters over satellite is round trips, and the fix is at production time.

## Tiered Resolution Strategy

1. **Verify the path preserves ranges before blaming the file (definitive).** A single `curl` with a `Range` header against the published URL, checking for `206 Partial Content` and a `Content-Range` header, settles it in seconds. Run it against the real published URL, not the origin — the proxy is the usual culprit and it is invisible from inside.
2. **Count requests and bytes, not elapsed time.** GDAL's `CPL_CURL_VERBOSE` reports every range it issues. Four to six for a window is healthy; dozens means the file is tiled wrongly or the client's block cache is undersized.
3. **Tune the client's read window to the file's block size.** A client reading in 256-pixel windows against a 512-pixel-blocked file fetches each block up to four times. Aligning them is a client configuration change, not a rebuild.
4. **Pre-fetch on degradation, not on failure (safe default).** When round-trip time or error rate crosses a threshold, stage the division's overview levels locally while there is still bandwidth to do it. Waiting for a request to fail means waiting until staging is impossible.
5. **Emit an audit record of range counts per session.** A node whose request count per window has quietly doubled has had something change in its path, and that is worth knowing before the next incident.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="rr3-t rr3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="rr3-t">What the forward node keeps locally as connectivity degrades</title>
  <desc id="rr3-d">Three connectivity states and what a forward node reads in each. Connected, it reads windows over range requests and keeps nothing but a small tile cache. Degraded, it continues to serve from that cache and pre-fetches the overview levels for its assigned division so a subsequent outage does not blank the map. Disconnected, it serves entirely from a clipped local copy of its division that was written while connectivity existed. The transition that must be prepared in advance is the second one: pre-fetching after the link has already gone is impossible, so the trigger for staging is a degradation signal rather than an outage.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the staging trigger is degradation, not outage — after the link is gone it is too late</text>
  <rect x="40" y="76" width="256" height="150" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="312" y="76" width="256" height="150" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="584" y="76" width="256" height="150" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="104" font-size="11" font-weight="700" fill="var(--crimson-deep)">connected</text>
  <text x="332" y="104" font-size="11" font-weight="700" fill="var(--crimson-deep)">degraded</text>
  <text x="604" y="104" font-size="11" font-weight="700" fill="var(--ember-text)">disconnected</text>
  <text x="60" y="132" font-size="10" fill="currentColor">read windows over ranges</text>
  <text x="60" y="150" font-size="10" fill="currentColor">keep a small tile cache</text>
  <text x="60" y="168" font-size="10" fill="currentColor">nothing staged</text>
  <text x="332" y="132" font-size="10" fill="currentColor">serve from the tile cache</text>
  <text x="332" y="150" font-size="10" fill="currentColor">pre-fetch division overviews</text>
  <text x="332" y="168" font-size="10" fill="currentColor">write the clipped local copy</text>
  <text x="604" y="132" font-size="10" fill="currentColor">serve the clipped copy only</text>
  <text x="604" y="150" font-size="10" fill="currentColor">stamp every layer with its age</text>
  <text x="604" y="168" font-size="10" fill="currentColor">queue nothing — this is read-only</text>
  <text x="60" y="204" font-size="10" font-weight="700" fill="var(--crimson-deep)">cheapest</text>
  <text x="332" y="204" font-size="10" font-weight="700" fill="var(--crimson-deep)">the only chance to prepare</text>
  <text x="604" y="204" font-size="10" font-weight="700" fill="var(--ember-text)">whatever was staged</text>
  <text x="8" y="272" font-size="10.5" fill="currentColor">Detect degradation from round-trip time and error rate, not from a failed request — by the time a request fails,</text>
  <text x="8" y="292" font-size="10.5" fill="currentColor">the bandwidth needed to stage the division no longer exists.</text>
</svg>

Tier four is the one that has to be designed rather than added later. The window in which a forward node can prepare for an outage is the degraded period *before* it, and by the time a request actually fails there is no capacity left to stage anything. Trigger on the leading indicators — rising round-trip time, rising retransmits, a falling success rate — and treat the staging job as something that competes for the last usable bandwidth rather than as a background task.

## Production Python Implementation

```python
from __future__ import annotations

import logging
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import rasterio
from rasterio.errors import RasterioIOError

logger = logging.getLogger("incidentgis.cog_serving")

RANGE_LOG = re.compile(rb"Range: bytes=")
HEALTHY_REQUESTS_PER_WINDOW = 8


@dataclass(frozen=True)
class ReadProfile:
    """What one window read actually cost on the wire."""
    requests: int
    bytes_moved: int
    honoured_ranges: bool


def probe_window_read(url: str, *, col: int, row: int, size: int = 512) -> ReadProfile:
    """Read one window over HTTP and report requests, bytes and range support.

    Deliberately shells out to gdal_translate so the measurement covers the
    real GDAL/curl path the field client uses, including its proxy settings,
    rather than a Python HTTP client that would bypass them.
    """
    env = {
        **os.environ,
        "CPL_CURL_VERBOSE": "YES",
        "CPL_VSIL_CURL_USE_HEAD": "YES",
        # Match the client's block cache to the file, or every block is
        # fetched more than once and the request count multiplies.
        "GDAL_CACHEMAX": "256",
    }
    cmd = [
        "gdal_translate", "-q",
        "-srcwin", str(col), str(row), str(size), str(size),
        f"/vsicurl/{url}", "/vsimem/probe.tif",
    ]
    proc = subprocess.run(cmd, env=env, capture_output=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace")[-500:])

    requests = len(RANGE_LOG.findall(proc.stderr))
    honoured = b"206" in proc.stderr or b"Partial Content" in proc.stderr
    bytes_moved = sum(
        int(m) for m in re.findall(rb"Content-Length: (\d+)", proc.stderr)
    )
    profile = ReadProfile(requests, bytes_moved, honoured)

    if not profile.honoured_ranges:
        # The file may be perfect; the path is not. Say so explicitly, because
        # the alternative report is "the map is slow", which sends an engineer
        # to the wrong system.
        logger.error("range_requests_not_honoured", extra={"url": url})
    elif profile.requests > HEALTHY_REQUESTS_PER_WINDOW:
        logger.warning("excessive_range_requests", extra={
            "url": url, "requests": profile.requests,
            "hint": "check internal block size against the client read window",
        })

    logger.info("window_read_profiled", extra={
        "url": url, "requests": profile.requests,
        "bytes": profile.bytes_moved, "ranges": profile.honoured_ranges,
    })
    return profile


def stage_division_overviews(url: str, destination: Path, *, bounds) -> Path:
    """Write a clipped local copy while bandwidth still exists.

    Called on a degradation signal, not on a failure: once requests are
    failing there is no capacity left to stage anything.
    """
    try:
        with rasterio.open(f"/vsicurl/{url}") as src:
            window = src.window(*bounds)
            # Read from the coarsest overview that still satisfies the
            # division's display scale — staging full resolution over a
            # degrading link is how staging jobs fail to finish.
            data = src.read(1, window=window, masked=True,
                            out_shape=(1, int(window.height // 8),
                                       int(window.width // 8)))
            profile = src.profile.copy()
            profile.update(
                height=data.shape[-2], width=data.shape[-1],
                transform=src.window_transform(window) * src.transform.scale(8, 8),
                driver="GTiff", tiled=True, blockxsize=512, blockysize=512,
            )
            with rasterio.open(destination, "w", **profile) as dst:
                dst.write(data.filled(src.nodata), 1)
                dst.update_tags(**src.tags())
    except RasterioIOError as exc:
        logger.error("division_staging_failed", exc_info=exc)
        raise

    logger.info("division_staged", extra={"destination": str(destination)})
    return destination
```

## Validation Checklist

- [ ] A `curl -H 'Range: bytes=0-1023'` against the published URL returns `206` and a `Content-Range` header.
- [ ] The check runs against the URL field nodes actually use, not the origin bucket.
- [ ] A single window read issues fewer than about eight range requests.
- [ ] The client's read window is aligned to the file's internal block size.
- [ ] `GDAL_CACHEMAX` is large enough that a block is not re-fetched within one render.
- [ ] Staging is triggered by a degradation signal — round-trip time, error rate — and not by a failed request.
- [ ] The staged local copy is read from an overview level, not from full resolution.
- [ ] Range counts per session are logged, so a change in the delivery path is visible before the next incident.

## Edge Cases and Gotchas

- **A CDN that caches whole objects.** Some edge configurations fetch and cache the full object on first request, then serve ranges from the cache. The first client pays for the whole file and subsequent ones do not, which makes the problem intermittent and very hard to reproduce.
- **Signed URLs that exclude the Range header from the signature.** Some signing schemes reject requests carrying headers not covered by the signature. The failure is a 403 on the second request only, after the header read has already succeeded.
- **`CPL_VSIL_CURL_USE_HEAD=NO` masking the diagnosis.** Disabling the HEAD request is a common tuning tweak and it removes the one place `Accept-Ranges` is visible. Leave it on while diagnosing.
- **Overviews present but the client ignoring them.** A client asked for a specific resolution rather than a display scale will read full resolution regardless of the pyramid. Confirm the read is going to an overview level, not just that overviews exist.
- **Staging that finishes after the link dies.** A staging job with no deadline will happily still be running when connectivity goes. Give it a hard time budget derived from the current throughput, and prefer a coarser complete copy over a finer incomplete one.

## Frequently Asked Questions

**How do I tell whether a slow raster read is the file or the delivery path?** Count requests and bytes rather than timing the read. A single Range request against the published URL should return 206 Partial Content with a Content-Range header; if it returns 200 with the whole object, some hop is stripping the header and the file is irrelevant. If ranges are honoured but a window read issues dozens of requests, the file's internal tiling or the client's read window is wrong. Both failures present identically as 'the map is slow on satellite', which is why elapsed time is the one measurement that cannot distinguish them.

**Why does request count matter more than bytes on a satellite link?** Because latency dominates. At a 700-millisecond round trip, forty sequential range requests cost about 28 seconds of pure waiting no matter how few bytes each carries, while four requests cost about 3 seconds. On a 30-millisecond terrestrial link the same two files differ by roughly a second and nobody notices. Since forward nodes are exactly the consumers on high-latency links, block size and tile contiguity are worth tuning at production time even when the byte totals look similar.

**When should a forward node stage a local copy instead of reading remotely?** On the first sign of degradation, not on the first failure. Staging needs bandwidth, and by the time requests are failing there is none left, so a job triggered by an outage never completes. Trigger on rising round-trip time, rising retransmits or a falling success rate, give the job a hard time budget derived from current throughput, and stage from an overview level rather than full resolution — a coarser complete copy is worth far more in the field than a finer incomplete one.

## Related

- [Raster Hazard Layers & Cloud-Optimized GeoTIFF](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/) — the production contract that makes a small range read possible in the first place.
- [Sizing COG Overviews for Field Display Scales](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/sizing-cog-overviews-for-field-display-scales/) — the pyramid the situational-scale read depends on.
- [Handling Cache Invalidation During Multi-Day Incidents](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/handling-cache-invalidation-during-multi-day-incidents/) — how the staged copy is kept current once the node is back on a usable link.
- [FlatGeobuf vs GeoPackage for Offline Caching](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/flatgeobuf-vs-geopackage-for-offline-caching/) — the vector equivalent, where the same range-read property decides the format.

Up: [Raster Hazard Layers & Cloud-Optimized GeoTIFF](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/)
