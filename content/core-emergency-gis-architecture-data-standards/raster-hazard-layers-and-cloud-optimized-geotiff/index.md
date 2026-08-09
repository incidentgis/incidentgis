---
title: "Raster Hazard Layers & Cloud-Optimized GeoTIFF"
description: "Produce, validate and serve flood-depth and fire-progression rasters as Cloud-Optimized GeoTIFFs so forward nodes read one division over a thin uplink instead of downloading a four-gigabyte grid."
slug: raster-hazard-layers-and-cloud-optimized-geotiff
type: guide
breadcrumb: "Raster Hazard Layers & COG"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Raster Hazard Layers & Cloud-Optimized GeoTIFF",
      "description": "Produce, validate and serve flood-depth and fire-progression rasters as Cloud-Optimized GeoTIFFs so forward nodes read one division over a thin uplink instead of downloading a four-gigabyte grid.",
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
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Publish a hazard raster as a validated Cloud-Optimized GeoTIFF",
      "description": "Write a flood-depth or fire-progression raster in a layout that supports HTTP range reads, preserve its nodata mask and vertical datum, build overviews matched to the display scales the field application uses, and assert the contract before publishing.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Settle the CRS, units and vertical datum",
          "text": "Choose the horizontal coordinate reference system once at production time, and record the value units and vertical datum explicitly, because a depth grid in feet above a tidal datum and one in metres above NAVD88 are numerically similar and operationally different."
        },
        {
          "@type": "HowToStep",
          "name": "Write internally tiled floating-point data",
          "text": "Write the array with a square internal block size and an explicit sentinel nodata value, so a rectangular window maps to contiguous byte ranges and unmodelled cells stay distinguishable from zero."
        },
        {
          "@type": "HowToStep",
          "name": "Build overviews matched to display scales",
          "text": "Generate internal overviews at factors corresponding to the scales the field application actually renders, using average resampling for continuous values and nearest for categorical hazard classes."
        },
        {
          "@type": "HowToStep",
          "name": "Stamp the model run into the file",
          "text": "Write the model, run identifier, forecast cycle, vertical datum and units as file tags rather than relying on the filename, so provenance survives copying and re-serving."
        },
        {
          "@type": "HowToStep",
          "name": "Assert the contract before publishing",
          "text": "Reopen the written file and fail closed if the nodata value, internal tiling, overviews or provenance tags are absent, since each of those defects leaves a file that opens correctly and is useless or misleading to a consumer."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not just render hazard rasters to image tiles on the server?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because a responder needs a value, not a colour. Asked how deep the water is on a given block, a pre-rendered tile can only be read against a legend, which introduces a rounding step nobody records and fails entirely where the underlying cell was nodata rather than zero. A Cloud-Optimized GeoTIFF lets the client fetch the actual depth values for a small window, so the number quoted on the radio is the number the model produced. Server-side rendering remains useful for a basemap layer, but it is a display convenience rather than a substitute for the data."
          }
        },
        {
          "@type": "Question",
          "name": "What actually makes a GeoTIFF cloud-optimized?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Three layout guarantees, all of which serve partial reads. The header and image file directory sit at the front of the file so a client learns the structure in one small read. Pixel data is internally tiled rather than stored as scanlines, so a rectangular window corresponds to contiguous byte ranges instead of fragments of every row it crosses. Overviews are stored inside the same file rather than in a sidecar, so a zoomed-out view reads a small pre-computed image. A file can be a perfectly valid GeoTIFF, open in every tool, and satisfy none of these, in which case every client downloads all of it."
          }
        },
        {
          "@type": "Question",
          "name": "What is the most common way a hazard raster is silently corrupted?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Losing the nodata mask during a conversion. A model leaves cells outside its solved domain, or where the solver failed to converge, as nodata. A tool that reads the array and writes a new file without carrying the mask turns those cells into zero, and zero is a valid depth meaning dry. The raster then asserts that unmodelled ground is safe, and it does so precisely where the model had difficulty. Asserting that nodata survived every write is a two-line check that prevents an entire class of dangerous output."
          }
        }
      ]
    }
  ]
}
</script>

# Raster Hazard Layers & Cloud-Optimized GeoTIFF

A flood model finishes at 03:40 and writes a 4-gigabyte depth grid covering three counties at two-metre resolution. Six forward command posts need it, each working one division, each on an uplink that would take four hours to move the whole file — and the forecast that produced it will be superseded in six. Publishing that raster as a plain GeoTIFF gives every consumer an all-or-nothing choice. Publishing it as a Cloud-Optimized GeoTIFF (COG) lets each post read the division it is working in, at the scale it is displaying, in a few hundred kilobytes.

## Problem Framing

Vector layers on this site have a well-developed story for constrained links: clip to the incident footprint, serialise deterministically, ship deltas, and let a seekable format serve a working extent without the archive. Raster hazard products — flood depth grids, fire progression rasters, smoke dispersion surfaces, damage-probability layers — have historically had no equivalent, so they are either shipped whole, downsampled beyond usefulness, or rendered server-side into pictures that discard the values responders need to query.

The failure this causes is specific and quiet. A division supervisor asked "how deep is the water on this block?" needs a *value*, not a colour, and a pre-rendered picture cannot answer. The workaround — reading the value off a legend — introduces a rounding step nobody records, and it fails completely where the underlying cell was nodata rather than zero. This topic implements the raster half of the [core architecture and data standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/) contract.

## Prerequisites

- **GDAL 3.1 or newer**, which can both write COGs through the `COG` driver and validate them, along with `rasterio` built against the same GDAL. The pinned-binary discipline from [Dockerized GIS environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) applies here as much as to vector work.
- **A settled horizontal CRS for the incident**, per the [coordinate reference system standard](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/). Raster reprojection is lossy in a way vector reprojection is not, so the target CRS should be chosen once and written at production time rather than per consumer.
- **An object store or web server that honours HTTP range requests.** The entire benefit depends on partial reads; a store that returns whole objects turns a COG back into a plain GeoTIFF with extra steps.
- **A declared vertical datum and unit for any depth or elevation product**, which is a separate decision from the horizontal CRS and is the one most often left implicit.

## What Makes a GeoTIFF Cloud-Optimized

A COG is not a new format. It is a GeoTIFF that satisfies layout constraints a range-reading client can exploit, and every one of those constraints exists to make some read cheap that would otherwise be expensive.

<svg viewBox="0 0 880 400" role="img" aria-labelledby="cg1-t cg1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cg1-t">The internal layout that lets a client read part of a Cloud-Optimized GeoTIFF</title>
  <desc id="cg1-d">A Cloud-Optimized GeoTIFF is an ordinary GeoTIFF with two additional guarantees. Its header and image file directory sit at the front of the file, so a client can learn the raster's structure from a small first read instead of seeking to the end. Its pixel data is tiled rather than stored in scanlines, so a rectangular window maps to a small set of contiguous byte ranges rather than to fragments of every row. Overviews, progressively coarser copies of the whole raster, are stored inside the same file, so a zoomed-out view reads a small overview rather than downsampling the full-resolution data. A client wanting one 512-pixel window of a 4-gigabyte flood-depth grid issues three range requests totalling a few hundred kilobytes.</desc>
  <rect x="0" y="0" width="880" height="400" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">a 4 GB flood-depth grid, and the three reads that answer one window query</text>
  <rect x="40" y="76" width="800" height="52" rx="6" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
  <rect x="40" y="76" width="34" height="52" rx="6" fill="var(--crimson-deep)"/>
  <rect x="74" y="76" width="96" height="52" fill="var(--petal)" stroke="var(--line-strong)" stroke-width="1"/>
  <rect x="170" y="76" width="150" height="52" fill="var(--crimson)" opacity="0.4"/>
  <rect x="470" y="76" width="70" height="52" fill="var(--crimson)"/>
  <g font-size="9.5" text-anchor="middle" fill="var(--muted)">
    <text x="57" y="146">header</text>
    <text x="122" y="146">IFD</text>
    <text x="245" y="146">overviews</text>
    <text x="505" y="146">the window's tiles</text>
    <text x="700" y="146">the rest of the full-resolution data — never fetched</text>
  </g>
  <text x="40" y="192" font-size="11" font-weight="700" fill="var(--crimson-deep)">three range requests · ~340 KB moved out of 4 GB</text>
  <rect x="40" y="216" width="800" height="60" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="240" font-size="11" font-weight="700" fill="var(--ember-text)">a plain GeoTIFF with scanline layout and no overviews</text>
  <text x="60" y="260" font-size="10" fill="currentColor">the same window touches a fragment of every row it crosses, and a zoomed-out view must read everything — so the client downloads 4 GB or nothing</text>
  <rect x="40" y="298" width="800" height="72" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="322" font-size="11" font-weight="700" fill="var(--crimson-deep)">what this buys an incident</text>
  <text x="60" y="344" font-size="10" fill="currentColor">a forward node with a thin uplink can open a regional hazard raster and read only the division it is working in —</text>
  <text x="60" y="360" font-size="10" fill="currentColor">the same property that makes FlatGeobuf work for vectors, applied to the raster side of the picture</text>
</svg>

The three properties are independent and all three are needed. Front-loading the header lets a client discover the structure in one small read. Internal tiling means a rectangular window corresponds to contiguous byte ranges rather than to slivers of every scanline it crosses. Internal overviews mean a zoomed-out view reads a small pre-computed image rather than reading full-resolution pixels and throwing most of them away.

Dropping any one of them degrades gracefully in appearance and catastrophically in cost, which is why validation matters more here than the format's simplicity suggests — a file can be a perfectly valid GeoTIFF, open correctly in every tool, and still force every client to download all of it.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="cg2-t cg2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cg2-t">Bytes read for one division-sized window at each zoom, with and without overviews</title>
  <desc id="cg2-d">Reading a division-sized window from a 4-gigabyte flood-depth grid at four display scales. With internal overviews, a 1 to 250,000 county view costs about 90 kilobytes, 1 to 50,000 about 340 kilobytes, 1 to 24,000 about 1.4 megabytes and 1 to 6,000 about 12 megabytes, because each scale reads the overview level matched to it. Without overviews every scale must read full-resolution pixels and then downsample, so all four cost about 12 megabytes regardless of how zoomed out the display is. The overview-less case is not merely slower: a situational-awareness view of a whole county costs the same as a street-level one, which on a constrained uplink is the difference between a usable map and none.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">bytes read for one division-sized window, by display scale</text>
  <rect x="300" y="90" width="19" height="30" rx="4" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="146" width="70" height="30" rx="4" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="202" width="146" height="30" rx="4" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="258" width="240" height="30" rx="4" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <g fill="none" stroke="var(--ember)" stroke-width="2" stroke-dasharray="5 3">
    <rect x="300" y="90" width="240" height="30" rx="4"/>
    <rect x="300" y="146" width="240" height="30" rx="4"/>
    <rect x="300" y="202" width="240" height="30" rx="4"/>
  </g>
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="110">1:250 000 · county view</text>
    <text x="8" y="166">1:50 000 · division view</text>
    <text x="8" y="222">1:24 000 · tactical</text>
    <text x="8" y="278">1:6 000 · structure</text>
  </g>
  <g font-size="10.5" font-weight="700" fill="var(--crimson-deep)">
    <text x="560" y="110">90 KB</text><text x="560" y="166">340 KB</text><text x="560" y="222">1.4 MB</text><text x="560" y="278">12 MB</text>
  </g>
  <text x="640" y="110" font-size="10" font-weight="700" fill="var(--ember-text)">dashed: no overviews — 12 MB at every scale</text>
  <path d="M300 306 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="8" y="342" font-size="10.5" fill="currentColor">Without overviews a county-wide situational view costs exactly as much as a street-level one —</text>
  <text x="8" y="362" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">which on a forward node's uplink is the difference between a usable map and no map.</text>
</svg>

The overview column is the one worth defending in a review. A production pipeline under time pressure will often skip overview generation because it roughly doubles write time and the output looks identical when opened locally. The cost lands entirely on the remote consumer, and it lands hardest on the situational-awareness view — the county-wide picture an operations chief looks at most often becomes the most expensive read in the system.

## What Must Survive the Conversion

The habit of treating a raster as an image is where hazard products go wrong, because three of their properties have no equivalent in an image and are silently discarded by tooling that assumes one.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="cg3-t cg3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cg3-t">Three properties a hazard raster must carry that an ordinary image does not</title>
  <desc id="cg3-d">Three attributes distinguish a hazard raster from a picture. A nodata value marks cells where the model produced no result, and it must be preserved exactly: if nodata is dropped or coerced, unmodelled cells become zero, and zero flood depth reads as dry ground rather than as unknown. Units and vertical datum must be recorded, because a depth grid in feet above a local tidal datum and one in metres above NAVD88 are numerically similar and operationally different. The model run identity — which model, which parameters, which forecast cycle — must travel with the raster, since two depth grids for the same county from different cycles are both correct and only one is current. None of the three survives a conversion that treats the file as an image.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">a hazard raster is not a picture — three things must survive every conversion</text>
  <rect x="40" y="72" width="800" height="76" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="98" font-size="11" font-weight="700" fill="var(--ember-text)">nodata, preserved exactly</text>
  <text x="60" y="120" font-size="10" fill="currentColor">cells the model did not solve are not zero — and zero flood depth reads as dry ground, not as unknown</text>
  <text x="60" y="138" font-size="10" fill="currentColor">a conversion that coerces nodata to 0 turns every unmodelled cell into an assertion of safety</text>
  <rect x="40" y="164" width="800" height="76" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="190" font-size="11" font-weight="700" fill="var(--crimson-deep)">units and vertical datum</text>
  <text x="60" y="212" font-size="10" fill="currentColor">depth in feet above a local tidal datum and depth in metres above NAVD88 look numerically similar</text>
  <text x="60" y="230" font-size="10" fill="currentColor">and differ by enough to move an evacuation line — the horizontal CRS is not the whole CRS story</text>
  <rect x="40" y="256" width="800" height="76" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="282" font-size="11" font-weight="700" fill="var(--crimson-deep)">model run identity</text>
  <text x="60" y="304" font-size="10" fill="currentColor">which model, which parameters, which forecast cycle — two depth grids for one county from two cycles</text>
  <text x="60" y="322" font-size="10" fill="currentColor">are both correct, and only one is current; the file name is not a durable place to record that</text>
</svg>

The nodata case deserves the emphasis. A flood model solves over a domain and leaves cells outside it — or cells where the solver failed to converge — as nodata. Convert with a tool that has no concept of nodata, or write a format that cannot express it, and those cells become zero. Zero is a perfectly good depth value meaning *dry*, so the raster now asserts that unmodelled ground is safe, and it does so in exactly the areas where the model had trouble.

## Production Python Implementation

The writer below produces a validated COG from a model output array, preserving nodata, stamping the vertical datum and model run into the file's own metadata, and building overviews sized to the display scales the field application actually uses.

```python
from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.errors import RasterioIOError
from rasterio.shutil import copy as rio_copy

logger = logging.getLogger("incidentgis.hazard_raster")

# Overview factors chosen to match the display scales the field app renders,
# not the generic powers of two. An unused level is pure write cost.
OVERVIEW_FACTORS = (2, 4, 8, 16, 32)


@dataclass(frozen=True)
class HazardProvenance:
    """Everything needed to identify which model run produced this raster."""
    model: str                  # e.g. "HEC-RAS 2D"
    run_id: str                 # the modelling system's own run identifier
    forecast_cycle: str         # ISO 8601 UTC of the forecast this run consumed
    vertical_datum: str         # e.g. "NAVD88"
    value_units: str            # e.g. "metres"
    quantity: str               # e.g. "water_surface_depth"


def write_hazard_cog(
    values: np.ndarray,
    *,
    transform,
    crs,
    nodata: float,
    provenance: HazardProvenance,
    destination: Path,
) -> Path:
    """Write a validated Cloud-Optimized GeoTIFF for a hazard surface.

    Raises rather than degrading: a hazard raster that silently lost its nodata
    mask or its vertical datum is more dangerous than a job that failed.
    """
    if not np.issubdtype(values.dtype, np.floating):
        raise TypeError("hazard values must be floating point to carry nodata")
    if np.isnan(nodata):
        # NaN nodata round-trips badly through several readers and cannot be
        # compared with ==; insist on a sentinel the format can store.
        raise ValueError("use an explicit sentinel nodata value, not NaN")
    if np.any(values[values != nodata] < 0.0):
        raise ValueError("negative depth outside the nodata mask — check solver output")

    profile = {
        "driver": "GTiff",
        "dtype": "float32",
        "count": 1,
        "height": values.shape[0],
        "width": values.shape[1],
        "transform": transform,
        "crs": crs,
        "nodata": nodata,
        "tiled": True,
        "blockxsize": 512,
        "blockysize": 512,
        "compress": "deflate",
        "predictor": 3,          # floating-point predictor; lossless
    }

    staging = destination.with_suffix(".staging.tif")
    try:
        with rasterio.open(staging, "w", **profile) as dst:
            dst.write(values.astype("float32"), 1)
            # Provenance lives in the file, not in the filename. A raster that
            # is copied, renamed or re-served must still say which forecast
            # cycle produced it.
            dst.update_tags(**{
                "INCIDENTGIS_" + key.upper(): str(val)
                for key, val in asdict(provenance).items()
            })
            dst.build_overviews(OVERVIEW_FACTORS, Resampling.average)
            dst.update_tags(ns="rio_overview", resampling="average")

        # The COG driver rewrites the staged file into the required layout:
        # header first, tiles contiguous, overviews internal.
        rio_copy(
            staging, destination, driver="COG",
            compress="deflate", predictor="YES",
            overview_resampling="average", blocksize=512,
        )
    except (RasterioIOError, ValueError) as exc:
        logger.error("hazard_cog_write_failed", exc_info=exc,
                     extra={"destination": str(destination)})
        raise
    finally:
        staging.unlink(missing_ok=True)

    _assert_cog_contract(destination, nodata=nodata)
    logger.info("hazard_cog_written", extra={
        "destination": str(destination),
        "run_id": provenance.run_id,
        "forecast_cycle": provenance.forecast_cycle,
    })
    return destination


def _assert_cog_contract(path: Path, *, nodata: float) -> None:
    """Fail closed if the written file lost a property consumers depend on."""
    with rasterio.open(path) as src:
        if src.nodata is None or src.nodata != nodata:
            raise ValueError("nodata not preserved: " + repr(src.nodata))
        if not src.profile.get("tiled", False):
            raise ValueError("not internally tiled — range reads will be useless")
        if not src.overviews(1):
            raise ValueError("no internal overviews — every scale costs full resolution")
        tags = src.tags()
        for field in ("VERTICAL_DATUM", "VALUE_UNITS", "RUN_ID"):
            if not tags.get("INCIDENTGIS_" + field):
                raise ValueError("missing provenance tag " + field)
    logger.info("hazard_cog_contract_ok", extra={"path": str(path)})
```

The `_assert_cog_contract` call is the load-bearing part. Every check in it corresponds to a way the file can be valid, open cleanly, and be useless or dangerous to a downstream consumer — and none of them is visible by looking at the raster.

## Configuration Reference

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Internal block size | `COG_BLOCKSIZE` | `512` | Suits division-sized windows; drop to 256 for very small windows. |
| Overview factors | `COG_OVERVIEWS` | `2,4,8,16,32` | Match the display scales the field app renders; an unused level is pure write cost. |
| Overview resampling | `COG_OVERVIEW_RESAMPLING` | `average` | Use `nearest` for categorical hazard classes — averaging class codes invents classes. |
| Compression | `COG_COMPRESS` | `deflate` | Lossless. Never use JPEG for a value raster; it changes the numbers. |
| Predictor | `COG_PREDICTOR` | `3` | Floating-point predictor. Set `2` for integer rasters, `1` to disable. |
| Nodata sentinel | `COG_NODATA` | `-9999.0` | Must be outside the valid value range and must not be NaN. |
| Vertical datum | `COG_VERTICAL_DATUM` | _unset_ | Mandatory for depth and elevation products; the writer refuses without it. |

## Verification and Smoke Test

Validate the output rather than the process. `gdalinfo` reports the layout, and a deliberate partial read proves the property the format exists for:

```bash
# Layout: expects "Block=512x512" and an Overviews line on band 1.
gdalinfo hazard_depth.tif | grep -E 'Block=|Overviews|NoData'

# Prove the range-read path: read one window over HTTP and count the ranges.
CPL_CURL_VERBOSE=YES CPL_VSIL_CURL_USE_HEAD=NO \
  gdal_translate -srcwin 4000 4000 512 512 \
  /vsicurl/https://example.invalid/hazard_depth.tif /tmp/window.tif 2>&1 \
  | grep -c 'Range: bytes'
```

A COG that needs more than a handful of range requests for a single window is tiled wrongly or has its overviews in a sidecar. Both open fine locally and both defeat the purpose.

## Integration With Adjacent Workflows

The published COG is consumed the same way the vector cache is. A forward node reads windows over its uplink while connected and falls back to a clipped local copy when it is not, which is the [offline caching](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) pattern applied to raster. The provenance tags feed the same [metadata governance](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) gate vector layers pass, and the model run identity is what lets a depth value quoted in an ICS-209 be traced to a forecast cycle.

## Troubleshooting

**Symptom: every window read downloads the whole file.** The file is not internally tiled, or overviews live in a `.ovr` sidecar the client never requests. Check `gdalinfo` for `Block=` with equal dimensions and an `Overviews:` line under band 1, not a separate file on disk.

**Symptom: unmodelled areas render as zero depth.** The nodata value was lost in a conversion step, most often by a tool that read the array and wrote a new file without carrying the mask. Assert `src.nodata` after every write, not only at the end of the pipeline.

**Symptom: depths disagree with a partner agency's product by roughly a metre.** Almost always a vertical datum difference rather than a modelling difference. Compare the `INCIDENTGIS_VERTICAL_DATUM` tags before investigating the models.

**Symptom: overviews look blocky and wrong on a categorical hazard layer.** `average` resampling on class codes produces values that are not classes. Rebuild with `nearest` for any categorical raster.

**Symptom: file size roughly triples after conversion.** The predictor is wrong for the data type — `3` on integer data or `2` on floats both defeat compression. Match the predictor to the dtype.

## Frequently Asked Questions

**Why not just render hazard rasters to image tiles on the server?** Because a responder needs a value, not a colour. Asked how deep the water is on a given block, a pre-rendered tile can only be read against a legend, which introduces a rounding step nobody records and fails entirely where the underlying cell was nodata rather than zero. A Cloud-Optimized GeoTIFF lets the client fetch the actual depth values for a small window, so the number quoted on the radio is the number the model produced. Server-side rendering remains useful for a basemap layer, but it is a display convenience rather than a substitute for the data.

**What actually makes a GeoTIFF cloud-optimized?** Three layout guarantees, all of which serve partial reads. The header and image file directory sit at the front of the file so a client learns the structure in one small read. Pixel data is internally tiled rather than stored as scanlines, so a rectangular window corresponds to contiguous byte ranges instead of fragments of every row it crosses. Overviews are stored inside the same file rather than in a sidecar, so a zoomed-out view reads a small pre-computed image. A file can be a perfectly valid GeoTIFF, open in every tool, and satisfy none of these, in which case every client downloads all of it.

**What is the most common way a hazard raster is silently corrupted?** Losing the nodata mask during a conversion. A model leaves cells outside its solved domain, or where the solver failed to converge, as nodata. A tool that reads the array and writes a new file without carrying the mask turns those cells into zero, and zero is a valid depth meaning dry. The raster then asserts that unmodelled ground is safe, and it does so precisely where the model had difficulty. Asserting that nodata survived every write is a two-line check that prevents an entire class of dangerous output.

## Related

- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) — the clipped local copy a forward node falls back to when its uplink drops.
- [FlatGeobuf vs GeoPackage for Offline Caching](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/flatgeobuf-vs-geopackage-for-offline-caching/) — the same partial-read argument, made on the vector side.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — the horizontal CRS contract a raster inherits, and why vertical datum is a separate decision.
- [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) — the lineage gate the provenance tags written here are designed to satisfy.

Up: [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/)
