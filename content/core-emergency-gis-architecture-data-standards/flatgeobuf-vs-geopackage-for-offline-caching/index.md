---
title: "FlatGeobuf vs GeoPackage for Offline Caching"
description: "FlatGeobuf vs GeoPackage for on-device offline caching in disconnected field ops: streaming HTTP range reads against an editable, queryable SQLite store."
slug: flatgeobuf-vs-geopackage-for-offline-caching
type: guide
breadcrumb: "FlatGeobuf vs GeoPackage"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "FlatGeobuf vs GeoPackage for Offline Caching",
      "description": "A decision guide for choosing FlatGeobuf or GeoPackage as the on-device cache format for disconnected field operations, with runnable Python read and write patterns for both.",
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
        { "@type": "ListItem", "position": 3, "name": "FlatGeobuf vs GeoPackage for Offline Caching", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/flatgeobuf-vs-geopackage-for-offline-caching/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Choose and build an on-device cache format for disconnected field operations",
      "description": "Profile the field constraint, then materialize either a queryable, editable GeoPackage or a streamable FlatGeobuf, and fetch only the working extent with a bounding-box range read so a narrow link is never asked to move more bytes than the mission needs.",
      "step": [
        { "@type": "HowToStep", "name": "Profile the field constraint and select a format", "text": "Decide whether the device needs offline attribute edits and ad-hoc queries or only fast read-only display over an intermittent link, then map that constraint to GeoPackage or FlatGeobuf with an explicit, logged rule rather than habit." },
        { "@type": "HowToStep", "name": "Write a queryable, editable GeoPackage cache", "text": "Materialize the layer as a GeoPackage with a built spatial index so the device can run bounding-box queries and accept local edits while disconnected." },
        { "@type": "HowToStep", "name": "Write a streamable FlatGeobuf cache", "text": "Materialize the same layer as FlatGeobuf with its packed Hilbert R-tree so a client can range-fetch only the features intersecting an area of interest instead of downloading the whole file." },
        { "@type": "HowToStep", "name": "Fetch only the working extent with a bounding-box range read", "text": "Query both formats by bounding box, and for a remote FlatGeobuf issue HTTP range reads so a degraded link transfers only the header, the index, and the intersecting features." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "When should field crews cache in FlatGeobuf instead of GeoPackage?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Cache in FlatGeobuf when the device only needs fast, read-only display and is fetching over a narrow or intermittent link, because its packed Hilbert R-tree lets a client range-fetch just the features intersecting the working extent instead of downloading the whole file. Choose GeoPackage when the device must run attribute queries or accept edits while disconnected, since FlatGeobuf is effectively an append-only, read-optimized stream with no in-place update path."
          }
        },
        {
          "@type": "Question",
          "name": "Can a device edit features offline in a FlatGeobuf cache?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Not in place. FlatGeobuf is a write-once, read-many format whose header stores a spatial index and feature offsets that an in-place edit would invalidate, so an update means rewriting the file. GeoPackage is a full SQLite database, so a field application can update attributes, insert new incident features, and commit those edits in a transaction while disconnected, then reconcile them upstream when the link returns."
          }
        },
        {
          "@type": "Question",
          "name": "How does FlatGeobuf fetch only part of a file over a bad link?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "FlatGeobuf places a packed Hilbert R-tree in the file header, so a client first reads the small header and index with an HTTP range request, computes which byte ranges hold the features intersecting the requested bounding box, and then requests only those ranges. A responder pulling a single county's road network from a national layer moves kilobytes rather than gigabytes, which is decisive when the uplink is a saturated cellular or satellite channel."
          }
        }
      ]
    }
  ]
}
</script>

# FlatGeobuf vs GeoPackage for Offline Caching

## Problem Framing

A strike team stages at a rural fairground turned incident base the night before a forecasted wildfire run. The cellular tower two ridgelines away is already congested, and by mid-morning it will be carrying evacuation traffic and losing packets. Onto each of forty ruggedized tablets, the geographic information system lead needs to push the same working set: the road network for three counties, parcel outlines inside the projected fire footprint, hydrant and water-source points, and the current incident perimeter that command will redraw a dozen times before nightfall. Two of those layers are read-only reference data that the tablets will only ever pan and display; two of them are live and editable, because division supervisors will drop spot fires and correct the perimeter from the field with no connectivity at all. Push everything as one monolithic download over the dying uplink and half the tablets never finish syncing before the crews roll. Push everything as a heavyweight editable database and the read-only reference layers waste storage and read latency that the read-only path never needed. The format you cache in is not a filing decision — it decides whether a tablet can pull one county's roads in kilobytes or is forced to drag the whole national layer through a saturated channel, and whether a supervisor can commit a perimeter edit while completely offline. This page is a decision guide for that choice, implementing the [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) contract for disconnected field operations under National Incident Management System (NIMS) and Federal Emergency Management Agency (FEMA) reporting requirements.

## Prerequisites

This workflow assumes a senior engineer's fluency with the Python geospatial stack and the following preconditions before any layer is written to a device:

- **Packages:** `geopandas >= 0.13`, `pyogrio >= 0.7` (the vectorized I/O backend that both formats read and write through), `shapely >= 2.0`, and `pyproj >= 3.4`. The underlying `GDAL` build must be 3.5 or newer so that the `FlatGeobuf` driver honors bounding-box spatial filters against the packed index rather than falling back to a full scan.
- **A normalized upstream layer:** every layer handed to the cache writer must already carry a valid CRS and a validated geometry. Format selection is a packaging decision, not a cleaning stage — the schema enforcement, de-duplication, and CRS normalization happen upstream in the [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) boundary, and this stage assumes their guarantees hold.
- **A canonical CRS decision:** both formats store the CRS in their metadata, so caches are written in a single interchange reference system, EPSG:4326 (WGS 84) by default, so that a tablet joining data from three agencies never has to reproject on the device.
- **A declared edit policy per layer:** for each layer, decide in advance whether the device may edit it offline. That single boolean drives the format choice, and it must be recorded as configuration, not inferred at write time.

## Choosing a Format: The Decision Flow

FlatGeobuf and GeoPackage are both endorsed by the Open Geospatial Consortium (OGC) — GeoPackage is a full OGC standard, and FlatGeobuf is an OGC community standard — so this is not a question of standards conformance. It is a question of access pattern. GeoPackage is a single-file SQLite database: it carries an R-tree spatial index, stores arbitrary attribute tables, and supports transactional in-place edits, which makes it the queryable, editable store of record on a disconnected device. FlatGeobuf is a single-file, write-once binary stream of features with a packed Hilbert R-tree in its header; that layout lets a client read the index first and then fetch only the byte ranges holding the features it wants — including over HTTP range requests against a remote file — which makes it the low-latency, partial-fetch format for read-only reference data over a bad link. The decision flow below routes each layer to a format on two questions: does the device need to edit or query it offline, and is it being pulled over a narrow or intermittent link.

<figure class="diagram">
<svg viewBox="0 0 820 470" role="img" aria-label="Decision-flow diagram routing an on-device layer to either GeoPackage or FlatGeobuf. Starting from the field cache decision, the first question asks whether the device needs offline edits or attribute queries; if yes the layer is cached as a GeoPackage. If no, a second question asks whether the layer is fetched over a narrow or intermittent link; if yes the layer is cached as FlatGeobuf for partial range-read fetch, and if no it defaults to GeoPackage for queryability." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>FlatGeobuf versus GeoPackage offline cache decision flow</title>
  <desc>The flow begins at a field cache decision box. The first decision asks whether the device needs offline edits or attribute queries. A yes branch routes left to the GeoPackage card, described as a SQLite-backed, queryable, editable single file with an R-tree index. A no branch descends to a second decision asking whether the layer is fetched over a narrow or intermittent link. A yes branch routes right to the FlatGeobuf card, described as a streamable, read-optimized single file with a packed Hilbert R-tree that supports HTTP range reads and partial bounding-box fetch. A no branch defaults left to GeoPackage for offline queryability.</desc>
  <defs>
    <marker id="fgbgpkg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <!-- start -->
    <rect x="305" y="16" width="210" height="40" rx="7" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="410" y="41" font-weight="700">Field cache decision</text>
    <!-- decision 1 -->
    <rect x="278" y="94" width="264" height="54" rx="7" fill="var(--blush, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="410" y="116" font-weight="600">Offline edits or</text>
    <text x="410" y="134">attribute queries needed?</text>
    <!-- decision 2 -->
    <rect x="278" y="204" width="264" height="54" rx="7" fill="var(--blush, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="410" y="226" font-weight="600">Fetched over a narrow</text>
    <text x="410" y="244">or intermittent link?</text>
    <!-- GeoPackage card -->
    <rect x="36" y="312" width="330" height="140" rx="8" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
    <text x="201" y="338" font-weight="700" font-size="14">GeoPackage (.gpkg)</text>
    <g text-anchor="start" font-size="12">
      <text x="56" y="364">SQLite database in one file</text>
      <text x="56" y="386">R-tree spatial index</text>
      <text x="56" y="408">attribute queries offline</text>
      <text x="56" y="430">transactional in-place edits</text>
    </g>
    <!-- FlatGeobuf card -->
    <rect x="454" y="312" width="330" height="140" rx="8" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
    <text x="619" y="338" font-weight="700" font-size="14">FlatGeobuf (.fgb)</text>
    <g text-anchor="start" font-size="12">
      <text x="474" y="364">streamable, read-optimized</text>
      <text x="474" y="386">packed Hilbert R-tree in header</text>
      <text x="474" y="408">HTTP range reads</text>
      <text x="474" y="430">partial bbox fetch, write-once</text>
    </g>
  </g>
  <!-- forward flow -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#fgbgpkg-arrow)">
    <path d="M410,56 V92"/>
    <path d="M410,148 V202"/>
  </g>
  <!-- decision 1 yes -> geopackage -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#fgbgpkg-arrow)">
    <path d="M278,121 H180 V310"/>
    <!-- decision 2 yes -> flatgeobuf -->
    <path d="M542,231 H640 V310"/>
    <!-- decision 2 no -> geopackage (default) -->
    <path d="M278,231 H120 V310"/>
  </g>
  <g font-size="10.5" fill="var(--crimson, currentColor)" text-anchor="middle">
    <text x="230" y="112">yes</text>
    <text x="590" y="222">yes</text>
    <text x="150" y="222">no · default gpkg</text>
    <text x="428" y="178" text-anchor="start">no</text>
  </g>
</svg>
<figcaption>Each layer is routed on two questions: if the device must edit or query it offline it becomes a GeoPackage; otherwise, if it is pulled over a narrow link it becomes a FlatGeobuf for partial range-read fetch, and if not it defaults to GeoPackage for offline queryability.</figcaption>
</figure>

The property that actually separates them is not encoding efficiency — the two are within a factor of two on size for typical incident layers — but whether a client can read a *part* of the file without holding the whole thing.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="fgb1-t fgb1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="fgb1-t">What each format has to move to answer one bounding-box query on a field device</title>
  <desc id="fgb1-d">A 340 megabyte regional layer is queried for one 4-kilometre working extent. FlatGeobuf, laid out as a header, a packed Hilbert R-tree index and Hilbert-sorted features, answers with three HTTP range reads: 1 kilobyte of header, 480 kilobytes of index, and 2.1 megabytes of contiguous feature bytes, because features near each other in space are near each other in the file. GeoPackage is a SQLite database and cannot be range-read usefully over HTTP, so the device must hold the whole 340 megabyte file locally before the same query can run at all; once it is local the query is fast and the file is also writable. The choice is therefore not about speed but about whether the working set can be fetched without the whole archive.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one bounding-box query against a 340 MB regional layer</text>
  <text x="8" y="80" font-size="11" font-weight="700" fill="currentColor">FlatGeobuf — seekable, Hilbert-sorted</text>
  <rect x="60" y="94" width="760" height="46" rx="6" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <rect x="60" y="94" width="26" height="46" rx="6" fill="var(--crimson-deep)"/>
  <rect x="86" y="94" width="96" height="46" fill="var(--petal)" stroke="var(--line-strong)" stroke-width="1"/>
  <rect x="330" y="94" width="150" height="46" fill="var(--crimson)"/>
  <text x="73" y="164" font-size="9.5" text-anchor="middle" fill="var(--muted)">header</text>
  <text x="134" y="164" font-size="9.5" text-anchor="middle" fill="var(--muted)">R-tree index</text>
  <text x="405" y="164" font-size="9.5" text-anchor="middle" fill="var(--crimson-deep)" font-weight="700">the working extent</text>
  <text x="640" y="164" font-size="9.5" text-anchor="middle" fill="var(--muted)">the rest of the region — never fetched</text>
  <text x="60" y="200" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">3 range reads · 1 KB + 480 KB + 2.1 MB = 2.6 MB moved</text>
  <text x="8" y="248" font-size="11" font-weight="700" fill="currentColor">GeoPackage — SQLite, not seekable over HTTP</text>
  <rect x="60" y="262" width="760" height="46" rx="6" fill="var(--ember)" opacity="0.4" stroke="var(--ember)" stroke-width="1.6"/>
  <text x="440" y="290" font-size="11" font-weight="700" text-anchor="middle" fill="currentColor">the entire file must be local first</text>
  <text x="60" y="336" font-size="10.5" font-weight="700" fill="var(--ember-text)">340 MB moved — then the same query is fast, and the file is writable</text>
</svg>

FlatGeobuf's layout is what makes that possible: a fixed header, then a packed Hilbert R-tree, then features sorted along the same Hilbert curve. Because spatially adjacent features are adjacent in the file, the extent a crew is working in resolves to a small number of contiguous byte ranges, and three HTTP range requests fetch it. The 337 megabytes describing the rest of the region are never transferred and never touch the device's disk.

GeoPackage cannot do this, and the reason is structural rather than a missing feature. It is SQLite, and SQLite's pages are arranged for a random-access block device, not for a reader who can only afford a few ranges — a query walks B-tree pages scattered through the file, so "fetch what the query needs" degenerates to "fetch most of the file in small pieces", which is worse than fetching it once. What GeoPackage gives in exchange is everything FlatGeobuf structurally cannot: transactions, updates, deletes, multiple layers, and attribute indexes.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="fgb2-t fgb2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="fgb2-t">Which format each field role needs, and the one property that decides it</title>
  <desc id="fgb2-d">Four field roles plotted against the two properties that separate the formats. A reconnaissance tablet reading a regional layer over a thin link needs partial fetch and does not write, so FlatGeobuf fits. A forward command post editing a perimeter offline needs writes and transactions, so GeoPackage fits. A drone ground station streaming a fresh orthomosaic footprint needs append-only writing at speed, which FlatGeobuf gives. A shelter intake tablet updating occupancy all shift needs durable local writes with rollback, which only GeoPackage gives. The deciding question is never which format is faster — it is whether the device has to write, and whether it can afford the whole file.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the deciding question is not speed — it is writes, and whether the whole file fits</text>
  <text x="300" y="80" font-size="10.5" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">must write?</text>
  <text x="470" y="80" font-size="10.5" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">whole file fits?</text>
  <text x="620" y="80" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">format</text>
  <g>
    <rect x="230" y="94" width="140" height="52" rx="7" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="400" y="94" width="140" height="52" rx="7" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="230" y="160" width="140" height="52" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="400" y="160" width="140" height="52" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="230" y="226" width="140" height="52" rx="7" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="400" y="226" width="140" height="52" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="230" y="292" width="140" height="52" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="400" y="292" width="140" height="52" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  </g>
  <g font-size="11" font-weight="700" text-anchor="middle">
    <text x="300" y="126" fill="var(--ember-text)">no</text><text x="470" y="126" fill="var(--ember-text)">no</text>
    <text x="300" y="192" fill="var(--crimson-deep)">yes</text><text x="470" y="192" fill="var(--crimson-deep)">yes</text>
    <text x="300" y="258" fill="var(--ember-text)">no</text><text x="470" y="258" fill="var(--crimson-deep)">yes</text>
    <text x="300" y="324" fill="var(--crimson-deep)">yes</text><text x="470" y="324" fill="var(--crimson-deep)">yes</text>
  </g>
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="118" font-weight="700">recon tablet</text><text x="8" y="134" font-size="9.5" fill="var(--muted)">regional layer, thin link</text>
    <text x="8" y="184" font-weight="700">forward command post</text><text x="8" y="200" font-size="9.5" fill="var(--muted)">editing the perimeter offline</text>
    <text x="8" y="250" font-weight="700">drone ground station</text><text x="8" y="266" font-size="9.5" fill="var(--muted)">streaming a fresh footprint</text>
    <text x="8" y="316" font-weight="700">shelter intake tablet</text><text x="8" y="332" font-size="9.5" fill="var(--muted)">occupancy all shift</text>
  </g>
  <g font-size="11" font-weight="700" fill="var(--crimson-deep)">
    <text x="600" y="118">FlatGeobuf</text>
    <text x="600" y="184">GeoPackage</text>
    <text x="600" y="250">FlatGeobuf</text>
    <text x="600" y="316">GeoPackage</text>
  </g>
  <g font-size="9.5" fill="var(--muted)">
    <text x="600" y="134">fetch the extent, not the archive</text>
    <text x="600" y="200">transactions and rollback offline</text>
    <text x="600" y="266">append-only, at streaming speed</text>
    <text x="600" y="332">durable local writes all shift</text>
  </g>
</svg>

Which is why the decision reduces to two questions asked in order. If the device writes, it needs GeoPackage and the whole-file transfer is simply the cost of doing business — schedule it during a connectivity window rather than trying to be clever. If it only reads, ask whether the whole file fits within budget: if it does, either format works and GeoPackage's tooling is more familiar; if it does not, FlatGeobuf is not the faster option, it is the only option.

The trap is the third row. A drone ground station "writes", so it looks like a GeoPackage case, but it only ever appends and never updates — which FlatGeobuf handles at streaming speed and GeoPackage handles with transaction overhead it does not need. Distinguish appending from editing before letting the word "write" decide.

## Step-by-Step Implementation

### Step 1 — Profile the field constraint and select a format

The format choice must be an explicit, logged decision keyed off the layer's edit policy and the link profile, never a habit. Encode the decision flow as a pure function so the same input always produces the same format and the reasoning is captured in the log for after-action review.

```python
import logging
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger(__name__)

CacheFormat = Literal["GPKG", "FlatGeobuf"]


@dataclass(frozen=True)
class LayerProfile:
    """Field constraints that decide a single layer's cache format."""

    name: str
    edits_offline: bool          # device must update or insert features while disconnected
    queries_offline: bool        # device runs ad-hoc attribute/spatial queries offline
    narrow_link: bool            # pulled over an intermittent or bandwidth-starved uplink


def select_cache_format(profile: LayerProfile) -> CacheFormat:
    # A layer that must be edited or queried offline requires a real database on-device.
    if profile.edits_offline or profile.queries_offline:
        chosen: CacheFormat = "GPKG"
        reason = "offline edit/query requires SQLite-backed GeoPackage"
    elif profile.narrow_link:
        # Read-only over a bad link: range-fetch only the working extent.
        chosen = "FlatGeobuf"
        reason = "read-only over narrow link favors range-read FlatGeobuf"
    else:
        # Read-only on a good link: default to the queryable, widely supported format.
        chosen = "GPKG"
        reason = "read-only on good link defaults to GeoPackage"
    logger.info("layer %s -> %s (%s)", profile.name, chosen, reason)
    return chosen
```

Because `select_cache_format` is deterministic and side-effect free, it can be unit tested exhaustively across the small input space and its output committed alongside the cache manifest, so a post-incident review can prove why the perimeter layer shipped as a GeoPackage and the county road network shipped as FlatGeobuf.

### Step 2 — Write a queryable, editable GeoPackage cache

For any layer the device must edit or query offline, materialize a GeoPackage with an explicit spatial index. The index is what keeps a bounding-box query on the device responsive; without it, GeoPackage answers a spatial query with a full table scan. Guard against the two failures that silently corrupt an offline cache: an empty layer and an untagged CRS.

```python
import logging
from pathlib import Path

import geopandas as gpd

logger = logging.getLogger(__name__)


class CacheWriteError(RuntimeError):
    """Raised when an on-device cache layer cannot be materialized."""


def write_geopackage_cache(
    gdf: gpd.GeoDataFrame,
    cache_path: Path,
    layer: str,
    target_epsg: int = 4326,
) -> Path:
    if gdf.empty:
        raise CacheWriteError(f"refusing to write empty layer {layer!r}")
    if gdf.crs is None:
        raise CacheWriteError(f"layer {layer!r} has no CRS; normalize before caching")
    try:
        if gdf.crs.to_epsg() != target_epsg:
            # Reproject to the canonical interchange CRS so the device never has to.
            gdf = gdf.to_crs(epsg=target_epsg)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        # SPATIAL_INDEX=YES builds the R-tree so on-device bbox queries stay fast.
        gdf.to_file(
            cache_path,
            layer=layer,
            driver="GPKG",
            engine="pyogrio",
            SPATIAL_INDEX="YES",
        )
    except CacheWriteError:
        raise
    except Exception as exc:  # pyogrio/GDAL surfaces write faults as generic errors
        logger.exception("GeoPackage cache write failed for layer %s", layer)
        raise CacheWriteError(str(exc)) from exc
    logger.info("wrote %d features to %s::%s", len(gdf), cache_path, layer)
    return cache_path
```

A GeoPackage can hold many layers in one file, so the whole disconnected working set that needs editing — perimeter, spot fires, corrected hydrant positions — lives in a single `.gpkg` that a field application opens once and updates transactionally. Those local edits are exactly what the sync layer reconciles when connectivity returns.

### Step 3 — Write a streamable FlatGeobuf cache

For read-only reference layers pulled over a bad link, write FlatGeobuf. The critical detail is the packed spatial index: it is what turns a remote `.fgb` into a partially fetchable resource. Write it with the index enabled and validate the geometry column is present before committing bytes to the device or the tile server.

```python
import logging
from pathlib import Path

import geopandas as gpd

logger = logging.getLogger(__name__)


def write_flatgeobuf_cache(
    gdf: gpd.GeoDataFrame,
    cache_path: Path,
    target_epsg: int = 4326,
) -> Path:
    if gdf.empty:
        raise CacheWriteError(f"refusing to write empty FlatGeobuf {cache_path.name!r}")
    if gdf.crs is None:
        raise CacheWriteError("input layer has no CRS; normalize before caching")
    if gdf.geometry.isna().any():
        # A null geometry breaks the packed R-tree that partial fetch depends on.
        raise CacheWriteError("null geometries present; drop or repair before writing")
    try:
        if gdf.crs.to_epsg() != target_epsg:
            gdf = gdf.to_crs(epsg=target_epsg)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        # SPATIAL_INDEX=YES writes the packed Hilbert R-tree that enables range reads.
        gdf.to_file(
            cache_path,
            driver="FlatGeobuf",
            engine="pyogrio",
            SPATIAL_INDEX="YES",
        )
    except CacheWriteError:
        raise
    except Exception as exc:
        logger.exception("FlatGeobuf cache write failed for %s", cache_path)
        raise CacheWriteError(str(exc)) from exc
    logger.info("wrote %d features to %s", len(gdf), cache_path)
    return cache_path
```

FlatGeobuf is write-once: there is no in-place update path, because inserting a feature would invalidate the byte offsets recorded in the header index. That constraint is not a defect — it is exactly why the read path is so fast — but it is the reason an editable layer must never be routed here.

### Step 4 — Fetch only the working extent with a bounding-box range read

The payoff for writing FlatGeobuf is on the read side. A bounding-box query against a local file uses the index to skip non-intersecting features; the same query against a *remote* `.fgb` over GDAL's `/vsicurl/` virtual filesystem issues HTTP range requests, pulling the header, the index, and only the intersecting feature bytes. That is how a tablet pulls one county from a national layer without downloading the nation.

```python
import logging
from typing import Tuple

import geopandas as gpd

logger = logging.getLogger(__name__)

BBox = Tuple[float, float, float, float]  # (minx, miny, maxx, maxy) in the cache CRS


def read_working_extent(cache_uri: str, bbox: BBox) -> gpd.GeoDataFrame:
    minx, miny, maxx, maxy = bbox
    if minx >= maxx or miny >= maxy:
        raise ValueError(f"degenerate bbox {bbox!r}: min must be strictly below max")
    try:
        # For a remote FlatGeobuf, pass a /vsicurl/ URI; GDAL turns the bbox filter
        # into HTTP range reads against the packed index instead of a full download.
        gdf = gpd.read_file(cache_uri, bbox=bbox, engine="pyogrio")
    except Exception as exc:
        logger.exception("bbox read failed for %s", cache_uri)
        raise CacheWriteError(f"could not read working extent from {cache_uri}") from exc
    logger.info("fetched %d features from %s within %s", len(gdf), cache_uri, bbox)
    return gdf
```

The same call works against a local `.gpkg`, a local `.fgb`, or a remote `/vsicurl/https://.../roads.fgb`; only the remote FlatGeobuf turns the bounding box into a partial byte fetch. Size the bounding box to the operational area of interest plus a small pad, so a supervisor panning to the edge of the current extent does not immediately stall on a fresh fetch.

## Configuration Reference

Tune these per deployment; a base-of-operations staging node that seeds tablets over local wifi and a forward tablet on a satellite uplink will diverge.

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Cache CRS | `CACHE_TARGET_EPSG` | `4326` | WGS 84 interchange CRS; both formats store it so devices never reproject. |
| Spatial index | `CACHE_SPATIAL_INDEX` | `YES` | Never `NO` for a field cache; without it, bbox queries and range reads both degrade to full scans. |
| I/O engine | `CACHE_IO_ENGINE` | `pyogrio` | Vectorized reader/writer; required for reliable FlatGeobuf bbox filtering. |
| Default read-only format | `CACHE_RO_FORMAT` | `FlatGeobuf` | Format for read-only layers on a narrow link; falls back to GPKG on a good link. |
| Bbox pad (metres) | `CACHE_BBOX_PAD_M` | `500` | Padding around the area of interest so edge panning does not stall on a refetch. |
| Range-read block size (KiB) | `CACHE_VSICURL_BLOCK_KIB` | `256` | GDAL `/vsicurl/` chunk; smaller for high-latency links, larger for fat pipes. |
| Max cache file (MiB) | `CACHE_MAX_FILE_MIB` | `2048` | Guard rail; a single file above this should be tiled or split by county. |

## Verification & Smoke Test

Run these assertions on a staging node before a cache is pushed to any device. They confirm both writers produce readable files, the spatial index actually filters, and format selection is deterministic.

```python
import logging
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point

logger = logging.getLogger(__name__)


def smoke_test(tmp: Path) -> None:
    # A 3x3 grid of points spanning a small extent.
    pts = [Point(x, y) for x in (-122.5, -122.4, -122.3) for y in (37.7, 37.8, 37.9)]
    gdf = gpd.GeoDataFrame({"fid": range(len(pts))}, geometry=pts, crs="EPSG:4326")

    gpkg = write_geopackage_cache(gdf, tmp / "cache.gpkg", layer="pts")
    fgb = write_flatgeobuf_cache(gdf, tmp / "cache.fgb")

    # 1. Both formats round-trip every feature.
    assert len(gpd.read_file(gpkg, layer="pts")) == 9, "GeoPackage lost features"
    assert len(gpd.read_file(fgb)) == 9, "FlatGeobuf lost features"

    # 2. A tight bbox returns only the intersecting subset from each format.
    tight = (-122.46, 37.66, -122.34, 37.74)  # covers only the lower-left corner point
    assert len(read_working_extent(str(gpkg), tight)) == 1, "GPKG bbox filter wrong"
    assert len(read_working_extent(str(fgb), tight)) == 1, "FGB bbox filter wrong"

    # 3. Format selection is deterministic for the field constraints.
    edit = LayerProfile("perimeter", edits_offline=True, queries_offline=False, narrow_link=True)
    ref = LayerProfile("roads", edits_offline=False, queries_offline=False, narrow_link=True)
    assert select_cache_format(edit) == "GPKG"
    assert select_cache_format(ref) == "FlatGeobuf"

    logger.info("smoke test passed")
```

A CLI check for continuous integration confirms the stack is wired and the FlatGeobuf driver is present in the GDAL build:

```bash
python -c "import geopandas, pyogrio, shapely, pyproj; print('stack ok')"
python -c "from pyogrio import list_drivers; assert 'FlatGeobuf' in list_drivers(); print('fgb driver ok')"
```

## Integration With Adjacent Workflows

This format decision sits between ingestion and the device. The layers it packages are the validated, CRS-tagged outputs of the [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) boundary; nothing should reach a cache writer that has not already passed schema and geometry validation there. The seeding, eviction, and refresh policy around these files — how much of a tablet's storage a cache may claim and when a stale layer is invalidated — is owned by the [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) workflow, which treats FlatGeobuf and GeoPackage as two interchangeable payload formats behind one caching contract. And because the edit path only exists for GeoPackage layers, every offline edit committed to a `.gpkg` must be reconciled upstream when the link returns, carrying the lineage the parent [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/) contract requires so that a field correction is auditable back to the device and the operator that made it.

## Troubleshooting

**Symptom: a remote FlatGeobuf bounding-box query downloads the entire file.** The layer was written without a spatial index, so there is no packed R-tree for the client to consult and GDAL falls back to reading every feature. Rewrite the `.fgb` with `SPATIAL_INDEX="YES"` (Step 3), and confirm the reader is on `pyogrio` with GDAL 3.5 or newer so the bbox filter is pushed down to the index rather than applied after a full read.

**Symptom: a field application cannot save an edit to a cached layer.** The layer was cached as FlatGeobuf, which is write-once and has no in-place update path. This is a routing error in Step 1: the layer's `edits_offline` flag should have sent it to `write_geopackage_cache`. Re-seed that layer as a GeoPackage, and treat any attempt to open a `.fgb` for writing on the device as a hard configuration failure.

**Symptom: an on-device GeoPackage query is slow even on a small layer.** The GeoPackage was written without its R-tree, so the spatial query is doing a full table scan. Confirm `SPATIAL_INDEX="YES"` was set at write time; a GeoPackage exported by some tools ships without an index and must be rewritten, since the index cannot be assumed present just because the file opens.

**Symptom: features land near null island at (0, 0) after caching.** A layer was written with a missing or wrong CRS and the coordinates were interpreted as degrees. The writers reject a `None` CRS, so the offender is a layer whose CRS was mislabeled upstream rather than absent; fix the tag at the ingestion boundary and re-cache, and never let a cache writer silently assume WGS 84.

**Symptom: tablet storage fills before the working set finishes seeding.** A single cache file exceeded the size guard, usually a national or statewide reference layer pushed whole instead of clipped. Enforce `CACHE_MAX_FILE_MIB`, clip read-only reference layers to the incident's area of interest plus a pad before writing, and prefer FlatGeobuf served remotely with range reads over materializing the whole layer on every device.

## Frequently Asked Questions

**When should field crews cache in FlatGeobuf instead of GeoPackage?** Cache in FlatGeobuf when the device only needs fast, read-only display and is fetching over a narrow or intermittent link, because its packed Hilbert R-tree lets a client range-fetch just the features intersecting the working extent instead of downloading the whole file. Choose GeoPackage when the device must run attribute queries or accept edits while disconnected, since FlatGeobuf is effectively an append-only, read-optimized stream with no in-place update path.

**Can a device edit features offline in a FlatGeobuf cache?** Not in place. FlatGeobuf is a write-once, read-many format whose header stores a spatial index and feature offsets that an in-place edit would invalidate, so an update means rewriting the file. GeoPackage is a full SQLite database, so a field application can update attributes, insert new incident features, and commit those edits in a transaction while disconnected, then reconcile them upstream when the link returns.

**How does FlatGeobuf fetch only part of a file over a bad link?** FlatGeobuf places a packed Hilbert R-tree in the file header, so a client first reads the small header and index with an HTTP range request, computes which byte ranges hold the features intersecting the requested bounding box, and then requests only those ranges. A responder pulling a single county's road network from a national layer moves kilobytes rather than gigabytes, which is decisive when the uplink is a saturated cellular or satellite channel.

## Related

- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/)
- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/)
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/)
- [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/)

Up: [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/)
