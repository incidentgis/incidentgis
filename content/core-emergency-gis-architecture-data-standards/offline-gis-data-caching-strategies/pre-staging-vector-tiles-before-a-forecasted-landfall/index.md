---
title: "Pre-Staging Vector Tiles Before a Forecasted Landfall"
description: "Bulk-seed an offline vector-tile cache for a forecast impact polygon before a hurricane knocks out connectivity: enumerate tiles from the storm bbox, enforce a size budget, fetch with retries, and verify coverage with a full audit trail."
slug: pre-staging-vector-tiles-before-a-forecasted-landfall
type: article
breadcrumb: "Pre-Staging Vector Tiles"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Pre-Staging Vector Tiles Before a Forecasted Landfall",
      "description": "Bulk-seed an offline vector-tile cache for a forecast impact polygon before a hurricane knocks out connectivity: enumerate tiles from the storm bbox, enforce a size budget, fetch with retries, and verify coverage with a full audit trail.",
      "datePublished": "2026-07-13",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Core Emergency GIS Architecture & Data Standards", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/" },
        { "@type": "ListItem", "position": 3, "name": "Offline GIS Data Caching Strategies", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/" },
        { "@type": "ListItem", "position": 4, "name": "Pre-Staging Vector Tiles Before a Forecasted Landfall", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/pre-staging-vector-tiles-before-a-forecasted-landfall/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Pre-seed an offline vector-tile cache for a forecast landfall zone",
      "description": "Enumerate the tile pyramid that covers a forecast impact polygon, enforce a storage budget before any download, fetch each tile with bounded retries, and verify coverage completeness with an audit record so field devices keep a usable basemap after connectivity is lost.",
      "step": [
        { "@type": "HowToStep", "name": "Bound the impact zone", "text": "Buffer the official forecast track or cone into an impact polygon and derive its bounding box in the tile server's coordinate reference system." },
        { "@type": "HowToStep", "name": "Enumerate the tile pyramid", "text": "Convert the bounding box into the set of z/x/y tile coordinates across the zoom range the field application needs, so the download list is deterministic and countable." },
        { "@type": "HowToStep", "name": "Enforce a size budget", "text": "Estimate the byte footprint of the enumerated tiles and refuse to start if it exceeds the device or link budget, so a run never half-fills a cache and strands responders." },
        { "@type": "HowToStep", "name": "Fetch with bounded retries", "text": "Download each tile with capped retries and backoff, writing to a transactional store, and record every failure rather than aborting the whole seed." },
        { "@type": "HowToStep", "name": "Verify coverage and audit", "text": "Confirm every enumerated tile is present and non-empty, then emit an audit record of counts, bytes, gaps, and the source version so the cache is defensible." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How large a zoom range should a landfall cache cover?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Cache only the zoom levels the field application actually renders. Each additional zoom level roughly quadruples the tile count, so seeding one level deeper than needed can turn a two-gigabyte cache into an eight-gigabyte one that will not fit on the tablet. A common pattern is a wide overview range for situational awareness plus the two or three detail levels used for navigation inside the impact polygon, with the exact range committed as a versioned parameter."
          }
        },
        {
          "@type": "Question",
          "name": "Why estimate the cache size before downloading anything?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because a half-filled cache is worse than no cache. If a seed runs out of disk or the storm arrives mid-download, responders discover the gap in the field with no way to backfill it. Estimating the byte footprint from the enumerated tile count against a committed budget lets the run refuse to start when it cannot finish, so an operator can widen the budget, shrink the zoom range, or split the region before connectivity is lost rather than after."
          }
        },
        {
          "@type": "Question",
          "name": "How do you prove a pre-staged cache is actually complete?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Verify against the enumeration, not the download log. After fetching, walk the deterministic z/x/y list and confirm every tile is present and non-empty in the store, then record the enumerated count, the stored count, the byte total, any gap coordinates, and the source dataset version in an audit entry. Coverage is defensible only when the missing-tile set is explicitly zero or explicitly listed, not merely assumed from a successful run."
          }
        }
      ]
    }
  ]
}
</script>

# Pre-Staging Vector Tiles Before a Forecasted Landfall

A category-three hurricane is forecast to make landfall in seventy-two hours across three coastal counties. The emergency operations center knows that when the eyewall arrives, cellular towers will fail, backhaul will flood, and the field tablets carried by damage-assessment and search teams will lose every online basemap they depend on. The teams will still need to navigate flooded road networks, locate shelters, and mark structures — offline, on battery, for days. The single narrow problem this page solves is turning the remaining connected hours into a complete, verified, offline vector-tile cache that covers exactly the forecast impact zone: not the whole state, which will not fit on the device, and not a guessed rectangle that leaves a team staring at blank tiles at the edge of the storm.

## Root Cause and Operational Impact

An online vector-tile basemap is a pyramid of small `z/x/y` tiles fetched on demand as the map pans and zooms. That model is efficient precisely because it assumes connectivity — the client only ever holds the handful of tiles currently on screen. When landfall severs the link, that assumption inverts: any tile the responder has not already viewed simply never renders, and the map decays into grey voids exactly where the team is driving. Unlike a raster snapshot, a vector cache cannot be "mostly there" and still usable at the boundary; a missing tile at the impact edge is a hole in the operating picture at the most dangerous moment.

This is dangerous rather than merely inconvenient because the failure surfaces in the field, after the window to fix it has closed. A seed job that silently ran out of disk at zoom 14, or that used a bounding box a few kilometres too narrow, produces a cache that looks populated in the operations center and fails only when a crew reaches the coast. Because the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both expect the common operating picture to be reconstructable for after-action review, a basemap with unrecorded gaps is not defensible: no one can later prove which areas the field teams could actually see. The fix therefore has to be countable and auditable end to end, which is why pre-staging belongs inside a disciplined [offline GIS data caching strategy](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) rather than an ad-hoc bulk download.

<svg viewBox="0 0 880 440" role="img" aria-label="Pre-staging pipeline diagram. A forecast hurricane cone is buffered into an impact polygon, whose bounding box is enumerated into a grid of z, x, y vector tiles. The enumerated tile list passes through a size-budget gate that either proceeds to a bounded-retry fetch stage writing into an on-device cache, or halts the run when the estimated bytes exceed the budget. A final verify stage compares stored tiles against the enumeration and emits an audit record listing counts, bytes, and any gaps." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>From a forecast cone to a verified offline tile cache</title>
  <desc>The forecast track cone is buffered into an impact polygon and its bounding box is converted into a deterministic set of z/x/y tile coordinates. That enumerated list passes through a size-budget gate: if the estimated byte footprint exceeds the device budget the run halts so an operator can narrow the zoom range or region, otherwise the pipeline fetches every tile with capped retries into an on-device cache. A final verification step walks the enumeration, confirms each tile is present and non-empty, and emits an audit record of enumerated count, stored count, total bytes, and any missing-tile coordinates.</desc>
  <defs>
    <marker id="prestage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="prestage-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- forecast cone + impact polygon -->
  <text x="96" y="32" font-size="12.5" text-anchor="middle" font-weight="700" fill="currentColor">Forecast cone</text>
  <path d="M40,150 L96,60 L152,150 Z" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6" opacity="0.9"/>
  <circle cx="96" cy="70" r="5" fill="var(--crimson, currentColor)"/>
  <path d="M62,132 Q96,150 130,132 Q124,168 96,172 Q68,168 62,132 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4"/>
  <text x="96" y="192" font-size="10.5" text-anchor="middle" fill="currentColor">buffered impact polygon</text>
  <!-- bbox -> tile grid -->
  <line x1="160" y1="115" x2="212" y2="115" stroke="currentColor" stroke-width="1.4" marker-end="url(#prestage-plain)"/>
  <text x="290" y="32" font-size="12.5" text-anchor="middle" font-weight="700" fill="currentColor">z/x/y tile grid</text>
  <g stroke="currentColor" stroke-width="1.1">
    <rect x="222" y="52" width="136" height="112" rx="3" fill="none"/>
    <line x1="256" y1="52" x2="256" y2="164"/><line x1="290" y1="52" x2="290" y2="164"/><line x1="324" y1="52" x2="324" y2="164"/>
    <line x1="222" y1="80" x2="358" y2="80"/><line x1="222" y1="108" x2="222" y2="108"/><line x1="222" y1="108" x2="358" y2="108"/><line x1="222" y1="136" x2="358" y2="136"/>
  </g>
  <rect x="256" y="80" width="68" height="56" fill="var(--petal, none)" opacity="0.55"/>
  <text x="290" y="182" font-size="10.5" text-anchor="middle" fill="currentColor">enumerate bbox → tiles</text>
  <!-- budget gate -->
  <line x1="366" y1="108" x2="416" y2="108" stroke="currentColor" stroke-width="1.4" marker-end="url(#prestage-plain)"/>
  <path d="M470,66 L520,108 L470,150 L420,108 Z" fill="var(--blush, none)" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
  <text x="470" y="104" font-size="11" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">size</text>
  <text x="470" y="118" font-size="11" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">budget?</text>
  <!-- halt branch -->
  <path d="M470,150 V196" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#prestage-arrow)"/>
  <text x="486" y="176" font-size="10" fill="var(--crimson, currentColor)">over budget</text>
  <rect x="392" y="198" width="156" height="42" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="470" y="216" font-size="11" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Halt — narrow</text>
  <text x="470" y="231" font-size="10" text-anchor="middle" fill="currentColor">zoom range or region</text>
  <!-- proceed branch -->
  <line x1="520" y1="108" x2="574" y2="108" stroke="currentColor" stroke-width="1.4" marker-end="url(#prestage-plain)"/>
  <text x="548" y="98" font-size="10" text-anchor="middle" fill="currentColor">fits</text>
  <rect x="578" y="72" width="150" height="72" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="653" y="98" font-size="11.5" text-anchor="middle" font-weight="700" fill="currentColor">Fetch tiles</text>
  <text x="653" y="116" font-size="10" text-anchor="middle" fill="currentColor">bounded retries</text>
  <text x="653" y="130" font-size="10" text-anchor="middle" fill="currentColor">+ backoff</text>
  <!-- cache store -->
  <path d="M600,180 q0,-9 26,-9 q26,0 26,9 v40 q0,9 -26,9 q-26,0 -26,-9 Z" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
  <ellipse cx="626" cy="180" rx="26" ry="9" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="626" y="248" font-size="10.5" text-anchor="middle" fill="currentColor">on-device cache</text>
  <path d="M653,144 V168" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#prestage-plain)"/>
  <!-- verify + audit -->
  <line x1="728" y1="108" x2="770" y2="108" stroke="currentColor" stroke-width="1.4" marker-end="url(#prestage-plain)"/>
  <rect x="742" y="270" width="112" height="120" rx="8" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="798" y="292" font-size="11.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Verify</text>
  <text x="798" y="312" font-size="9.5" text-anchor="middle" fill="currentColor">stored vs enumerated</text>
  <text x="798" y="332" font-size="9.5" text-anchor="middle" fill="currentColor">counts · bytes · gaps</text>
  <line x1="742" y1="344" x2="854" y2="344" stroke="currentColor" stroke-width="0.9" stroke-dasharray="3 3" opacity="0.6"/>
  <text x="798" y="362" font-size="10.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">audit record</text>
  <text x="798" y="378" font-size="9.5" text-anchor="middle" fill="currentColor">+ source version</text>
  <path d="M708,180 C740,210 780,240 798,268" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#prestage-plain)"/>
  <text x="778" y="210" font-size="10" text-anchor="middle" fill="currentColor">walk enumeration</text>
</svg>

Sizing the job is the first place this goes wrong, and it goes wrong because the relationship between zoom depth and cache size is not the one intuition supplies.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="ps1-t ps1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ps1-t">Cache size by maximum seed zoom for one coastal impact corridor, against the device budget</title>
  <desc id="ps1-d">Tile counts and cache size for a single coastal impact corridor seeded to each maximum zoom level. Zoom 10 needs 12 tiles and 0.4 megabytes, zoom 11 needs 48 tiles and 1.6 megabytes, zoom 12 needs 190 tiles and 6.2 megabytes, zoom 13 needs 760 tiles and 25 megabytes, zoom 14 needs 3,040 tiles and 99 megabytes, and zoom 15 needs 12,160 tiles and 396 megabytes. Each zoom level quadruples both figures. A 120 megabyte per-corridor device budget is drawn across them: zoom 14 fits with headroom and zoom 15 does not, by more than a factor of three. This is why a seed job configured for zoom 15 runs out of disk partway through and leaves a cache that looks populated in the operations centre and has holes at the impact edge.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">every zoom level quadruples the job — one corridor, seeded to each maximum zoom</text>
  <rect x="240" y="92" width="0.6" height="24" rx="4" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
  <rect x="240" y="130" width="2.3" height="24" rx="4" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
  <rect x="240" y="168" width="8.8" height="24" rx="4" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
  <rect x="240" y="206" width="35.4" height="24" rx="4" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
  <rect x="240" y="244" width="140.0" height="24" rx="4" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
  <rect x="240" y="282" width="560.0" height="24" rx="4" fill="var(--ember)" opacity="0.6" stroke="var(--crimson-deep)" stroke-width="1.1"/>
  <text x="8" y="109" font-size="10.5" fill="currentColor">z10 · 12 tiles · 0.4 MB</text>
  <text x="8" y="147" font-size="10.5" fill="currentColor">z11 · 48 tiles · 1.6 MB</text>
  <text x="8" y="185" font-size="10.5" fill="currentColor">z12 · 190 tiles · 6.2 MB</text>
  <text x="8" y="223" font-size="10.5" fill="currentColor">z13 · 760 tiles · 25 MB</text>
  <text x="8" y="261" font-size="10.5" fill="currentColor">z14 · 3,040 tiles · 99 MB</text>
  <text x="8" y="299" font-size="10.5" fill="currentColor">z15 · 12,160 tiles · 396 MB</text>
  <path d="M409.7 82 V326" fill="none" stroke="var(--crimson-deep)" stroke-width="1.6" stroke-dasharray="5 4"/>
  <text x="418" y="76" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">120 MB per-corridor device budget</text>
  <path d="M240 332 H800" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="240" y="350">0</text><text x="381.4" y="350">100</text><text x="522.8" y="350">200</text>
    <text x="664.2" y="350">300</text><text x="805.6" y="350">400 MB</text>
  </g>
  <text x="440" y="374" font-size="11" text-anchor="middle" fill="var(--muted)">A seed job set one zoom too deep does not fail loudly — it fills the disk and stops.</text>
</svg>

Each additional zoom level quadruples both the tile count and the bytes, so the difference between "seed to 14" and "seed to 15" is not a 7 per cent increase in thoroughness — it is a four-fold increase in a job that was already the largest thing the device will hold. A planner who reasons "z15 gives crews street-level detail, and we have 400 MB free" has committed the device to a single corridor, which is fine right up to the moment a second corridor is opened.

Worse, the failure when the budget is exceeded is not a refusal. The seed job runs, writes tiles until the allocation is gone, and stops. What it leaves behind depends entirely on the order it happened to walk the pyramid.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="ps2-t ps2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ps2-t">Where a truncated seed leaves its hole, relative to the forecast track</title>
  <desc id="ps2-d">A coastal corridor is drawn with the forecast landfall track crossing it. The seed job walks the tile pyramid in z, x, y order, which for this corridor means it fills from the inland edge outward. When it exhausts its disk allocation partway through zoom 14 it stops, leaving the inland two-thirds complete and a band along the coast unseeded. That band is precisely where crews will be working, so a cache that reports eighty per cent coverage is missing the only part that matters. The remedy is to seed in order of operational priority — the impact edge first, then inland — so that a truncated job degrades from the least important tiles rather than the most important ones.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">a truncated seed loses whichever tiles it happened to reach last</text>
  <path d="M120 80 H760 V300 H120 Z" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M120 80 H545 V300 H120 Z" fill="var(--petal-soft)"/>
  <path d="M545 80 H760 V300 H545 Z" fill="var(--ember)" opacity="0.3"/>
  <path d="M545 80 V300" fill="none" stroke="var(--ember)" stroke-width="2" stroke-dasharray="6 4"/>
  <path d="M700 60 Q660 180 720 320" fill="none" stroke="var(--crimson)" stroke-width="3"/>
  <text x="614" y="60" font-size="10.5" font-weight="700" fill="var(--crimson)">forecast track</text>
  <text x="140" y="112" font-size="11" font-weight="700" fill="var(--crimson-deep)">seeded — inland</text>
  <text x="140" y="130" font-size="10" fill="currentColor">z10–z14 complete</text>
  <text x="562" y="112" font-size="11" font-weight="700" fill="var(--ember-text)">unseeded — impact edge</text>
  <text x="562" y="130" font-size="10" fill="currentColor">disk exhausted here</text>
  <path d="M140 270 H520" fill="none" stroke="var(--crimson-deep)" stroke-width="1.6"/>
  <path d="M520 270 l-9 -5 M520 270 l-9 5" fill="none" stroke="var(--crimson-deep)" stroke-width="1.6"/>
  <text x="140" y="260" font-size="10" fill="var(--muted)">seed order: z, then x, then y — inland first</text>
  <text x="8" y="332" font-size="11" fill="currentColor">Seed by operational priority instead, and a truncated job loses the tiles nobody was going to open.</text>
</svg>

A conventional seeder iterates z, then x, then y, which has no relationship to operational priority and for a coastal corridor typically means filling from the inland edge outward. The resulting cache reports high coverage and is missing the impact edge — the one part of the map crews will actually be standing on. Nothing in the operations centre reveals this: the tile count is large, the file exists, and spot-checking a few tiles succeeds because the tiles you would think to check are the inland ones near the staging area.

Two changes make the truncation safe. Seed in order of operational priority — impact edge first, then the evacuation routes leading away from it, then inland fill — so that whatever the job fails to reach is the part nobody was going to open. And assert coverage against the *forecast corridor polygon* rather than against a tile count, so a job that stopped early fails its own verification instead of reporting a large number.

## Tiered Resolution Strategy

Seed the cache in ordered tiers, from the definitive fix down to a safe default that always leaves an audit flag. The governing rule is that a run either finishes completely or reports exactly what it could not do — a half-populated cache must never be presented as ready.

1. **Bound the impact zone from the authoritative forecast (definitive).** Buffer the official track or forecast cone into an impact polygon and derive its bounding box in the tile server's coordinate reference system. Deriving the extent from the forecast — not a hand-drawn rectangle — is what makes the coverage match the hazard.
2. **Enumerate the tile pyramid deterministically.** Convert the bounding box into the explicit set of `z/x/y` coordinates for the committed zoom range. A countable, ordered list is the backbone of every later guarantee: you can budget it, retry it, and verify against it.
3. **Enforce the size budget before the first byte.** Estimate the footprint from the tile count and refuse to start when it exceeds the device or link budget. This is the gate that prevents the half-filled cache — it fails in the operations center, where an operator can still act, rather than in the field.
4. **Fetch with bounded retries and a transactional write (safe default).** Download each tile with capped retries and backoff into an atomic store. A tile that exhausts its retries is recorded as a gap and the seed continues, so one flaky tile never aborts the whole region.
5. **Verify coverage and emit an audit record.** Walk the enumeration, confirm every tile is present and non-empty, and record enumerated count, stored count, byte total, the explicit gap list, and the source dataset version so the cache is reproducible and defensible.

## Production Python Implementation

The routine below carries the full resolution path: bounding-box tile enumeration, a pre-flight size-budget guard, bounded-retry fetching into a transactional cache, coverage verification, structured logging, explicit exception handling, and an immutable audit record. Thresholds are parameters, not literals, so a zoom range or budget can be committed and versioned alongside the rest of the caching policy. Senior-engineer assumptions apply: the tile source speaks the standard slippy-map `z/x/y` scheme, and the store is any transactional key-value or SQLite-backed sink — the same store you would query when comparing [FlatGeobuf and GeoPackage for offline caching](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/flatgeobuf-vs-geopackage-for-offline-caching/).

```python
from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Callable, Iterator, Optional, Protocol

logger = logging.getLogger("incidentgis.prestage")


class TileStore(Protocol):
    """Transactional sink for tile bytes, keyed by (z, x, y)."""

    def put(self, z: int, x: int, y: int, blob: bytes) -> None: ...
    def size(self, z: int, x: int, y: int) -> Optional[int]: ...
    def commit(self) -> None: ...


@dataclass(frozen=True)
class BBox:
    """Geographic bounds of the forecast impact polygon (EPSG:4326, always_xy)."""
    west: float
    south: float
    east: float
    north: float


@dataclass
class SeedAudit:
    """Immutable record of a pre-staging run, emitted to the audit trail."""
    source_version: str
    zoom_min: int
    zoom_max: int
    enumerated: int
    stored: int
    bytes_total: int
    gaps: list[tuple[int, int, int]]
    halted: bool
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class BudgetExceeded(RuntimeError):
    """Raised before any download when the estimated footprint exceeds budget."""


def enumerate_tiles(bbox: BBox, zoom_min: int, zoom_max: int) -> Iterator[tuple[int, int, int]]:
    """Yield every z/x/y tile covering the bbox across the zoom range.

    Uses the standard Web Mercator slippy-map transform. Longitudes and
    latitudes are clamped so a forecast polygon touching the poles or the
    antimeridian never produces an out-of-range tile index.
    """
    for z in range(zoom_min, zoom_max + 1):
        n = 2 ** z
        lat_s = max(min(bbox.south, 85.05112878), -85.05112878)
        lat_n = max(min(bbox.north, 85.05112878), -85.05112878)
        x_min = int((bbox.west + 180.0) / 360.0 * n)
        x_max = int((bbox.east + 180.0) / 360.0 * n)

        def _ytile(lat: float) -> int:
            r = math.radians(lat)
            return int((1.0 - math.asinh(math.tan(r)) / math.pi) / 2.0 * n)

        # North latitude maps to the smaller y index; order the range accordingly.
        y_top, y_bot = _ytile(lat_n), _ytile(lat_s)
        for x in range(max(0, x_min), min(n - 1, x_max) + 1):
            for y in range(max(0, y_top), min(n - 1, y_bot) + 1):
                yield (z, x, y)


class LandfallTileSeeder:
    """Pre-seed an offline vector-tile cache for a forecast impact zone.

    Enumerates the tile pyramid, enforces a byte budget before downloading,
    fetches with bounded retries, verifies coverage, and appends a single
    ``SeedAudit`` so the cache is reproducible and defensible.
    """

    def __init__(
        self,
        store: TileStore,
        fetch: Callable[[int, int, int], bytes],
        source_version: str,
        avg_tile_bytes: int = 18_000,
        budget_bytes: int = 4 * 1024 ** 3,
        max_retries: int = 3,
        backoff_base_s: float = 0.5,
    ) -> None:
        self.store = store
        self.fetch = fetch
        self.source_version = source_version
        self.avg_tile_bytes = avg_tile_bytes
        self.budget_bytes = budget_bytes
        self.max_retries = max_retries
        self.backoff_base_s = backoff_base_s
        self.audit_log: list[SeedAudit] = []

    def _fetch_with_retry(self, z: int, x: int, y: int) -> Optional[bytes]:
        """Return tile bytes, or None after exhausting bounded retries."""
        for attempt in range(1, self.max_retries + 1):
            try:
                blob = self.fetch(z, x, y)
                if not blob:
                    raise ValueError("empty tile body")
                return blob
            except (OSError, ValueError) as exc:
                # Transient link failure during the pre-landfall window: back off,
                # but never let one tile abort the region.
                wait = self.backoff_base_s * (2 ** (attempt - 1))
                logger.warning(
                    "tile_fetch_retry",
                    extra={"z": z, "x": x, "y": y, "attempt": attempt, "err": str(exc)},
                )
                if attempt < self.max_retries:
                    time.sleep(wait)
        logger.error("tile_fetch_exhausted", extra={"z": z, "x": x, "y": y})
        return None

    def seed(self, bbox: BBox, zoom_min: int, zoom_max: int) -> SeedAudit:
        tiles = list(enumerate_tiles(bbox, zoom_min, zoom_max))
        enumerated = len(tiles)
        estimated = enumerated * self.avg_tile_bytes

        # Pre-flight budget gate: fail here, in the EOC, not in the field.
        if estimated > self.budget_bytes:
            audit = SeedAudit(
                source_version=self.source_version, zoom_min=zoom_min, zoom_max=zoom_max,
                enumerated=enumerated, stored=0, bytes_total=0, gaps=[], halted=True,
            )
            self.audit_log.append(audit)
            logger.error(
                "seed_over_budget",
                extra={"estimated": estimated, "budget": self.budget_bytes, "audit": asdict(audit)},
            )
            raise BudgetExceeded(
                f"{enumerated} tiles ~ {estimated} B exceeds budget {self.budget_bytes} B"
            )

        stored, bytes_total = 0, 0
        try:
            for z, x, y in tiles:
                blob = self._fetch_with_retry(z, x, y)
                if blob is None:
                    continue  # recorded as a gap during verification below
                self.store.put(z, x, y, blob)
                stored += 1
                bytes_total += len(blob)
            self.store.commit()
        except Exception as exc:
            # Never present a partial cache as ready; record the failure and re-raise.
            logger.error("seed_write_failed", exc_info=exc)
            raise
        finally:
            # Verify against the enumeration regardless of how the loop ended.
            gaps = [
                (z, x, y) for (z, x, y) in tiles
                if not (self.store.size(z, x, y) or 0)
            ]
            audit = SeedAudit(
                source_version=self.source_version, zoom_min=zoom_min, zoom_max=zoom_max,
                enumerated=enumerated, stored=stored, bytes_total=bytes_total,
                gaps=gaps, halted=False,
            )
            self.audit_log.append(audit)
            level = logging.WARNING if gaps else logging.INFO
            logger.log(level, "seed_complete", extra={"audit": asdict(audit)})

        return audit
```

The `SeedAudit` is the load-bearing output. Persisting it as a committed, content-hashed artifact lets a post-incident reviewer confirm that the field basemap covered the entire forecast impact zone at the required zoom range — or see precisely which tiles were missing and why. That reproducibility is the same guarantee the wider [offline GIS data caching strategy](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) is built to provide, and it dovetails with [handling cache invalidation during multi-day incidents](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/handling-cache-invalidation-during-multi-day-incidents/) when the forecast — and therefore the impact polygon — shifts.

## Validation Checklist

Verify every item before declaring a pre-staged cache field-ready.

- [ ] The impact polygon is derived from the current authoritative forecast track or cone, buffered to the agreed margin, and its bounding box is in the tile server's coordinate reference system.
- [ ] The zoom range is passed as a committed parameter, and every additional level was justified against the roughly fourfold growth in tile count it costs.
- [ ] The size-budget gate runs before the first download and raises `BudgetExceeded` — the run refuses to half-fill the cache.
- [ ] `avg_tile_bytes` is calibrated from a real sample of the target layer, not a default, so the estimate reflects actual vector-tile density in the region.
- [ ] Each tile fetch uses bounded retries with backoff, and an exhausted tile is recorded as a gap rather than aborting the region.
- [ ] Verification walks the full enumeration and confirms every tile is present and non-empty; the `gaps` list is empty or explicitly reviewed.
- [ ] The `SeedAudit` — enumerated count, stored count, bytes, gaps, and `source_version` — is persisted to the audit sink, not just logged to stdout.
- [ ] A restore test loads the cache on a representative field device with networking disabled and confirms the impact polygon renders with no grey voids at its edges.

## Edge Cases and Gotchas

- **Antimeridian and pole clamping.** A forecast cone straddling the 180° meridian, or a high-latitude storm, will produce out-of-range or wrapped tile indices if the transform is naive. The enumerator clamps latitude to the Web Mercator limit and bounds `x`/`y` to the grid, but a bbox that crosses the antimeridian must be split into two boxes before enumeration or half the coverage silently vanishes.
- **Axis-order inversion.** If the impact polygon arrives as `(lat, lon)` from an agency tool that emits EPSG:4326 in y,x order, the bounding box is transposed and the enumeration covers open ocean. Normalize to `always_xy` at ingest and reproject to the tile CRS, the same contract enforced in the [coordinate reference systems for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) standard, before any tiles are enumerated.
- **The budget estimate lies for dense layers.** `avg_tile_bytes` from a rural sample badly under-estimates a dense urban downtown, so a run that "fit" the budget can overflow the disk mid-seed. Sample the average from tiles inside the impact polygon itself, and keep headroom below the device's true free space, not its nominal capacity.
- **Forecasts move.** The cone at seventy-two hours is not the cone at twenty-four. A cache seeded once against an early track can miss the actual landfall county entirely. Re-run against the latest forecast while connectivity remains, and let the audit gap list drive a delta top-up rather than a full re-download.
- **Empty-but-present tiles.** A tile server may return a valid 200 response with a zero-feature vector tile for out-of-data areas. Treating "present" as "covered" hides genuine data holes; the verification here checks non-empty size, but a layer-completeness check against the source dataset version catches tiles that are structurally valid yet contain nothing to render.

## Frequently Asked Questions

**How large a zoom range should a landfall cache cover?** Cache only the zoom levels the field application actually renders. Each additional zoom level roughly quadruples the tile count, so seeding one level deeper than needed can turn a two-gigabyte cache into an eight-gigabyte one that will not fit on the tablet. A common pattern is a wide overview range for situational awareness plus the two or three detail levels used for navigation inside the impact polygon, with the exact range committed as a versioned parameter.

**Why estimate the cache size before downloading anything?** Because a half-filled cache is worse than no cache. If a seed runs out of disk or the storm arrives mid-download, responders discover the gap in the field with no way to backfill it. Estimating the byte footprint from the enumerated tile count against a committed budget lets the run refuse to start when it cannot finish, so an operator can widen the budget, shrink the zoom range, or split the region before connectivity is lost rather than after.

**How do you prove a pre-staged cache is actually complete?** Verify against the enumeration, not the download log. After fetching, walk the deterministic z/x/y list and confirm every tile is present and non-empty in the store, then record the enumerated count, the stored count, the byte total, any gap coordinates, and the source dataset version in an audit entry. Coverage is defensible only when the missing-tile set is explicitly zero or explicitly listed, not merely assumed from a successful run.

## Related

- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) — the caching policy this pre-staging run seeds against.
- [Handling Cache Invalidation During Multi-Day Incidents](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/handling-cache-invalidation-during-multi-day-incidents/) — keep the seeded cache current as the forecast and impact zone shift.
- [FlatGeobuf vs GeoPackage for Offline Caching](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/flatgeobuf-vs-geopackage-for-offline-caching/) — choose the on-device store the seeded tiles write into.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — the CRS and axis-order contract that keeps the impact bbox from enumerating the wrong region.

Up: [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/)
