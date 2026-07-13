# Converting CADRG Maps to GeoJSON with Python for Emergency Response Workflows

A wildfire incident management team inherits a stack of CADRG (Compressed ARC Digitized Raster Graphics) sheets from a federal liaison at 02:00, needs them on field tablets by the 06:00 operational period, and has no connectivity to a tile server. The single narrow failure that derails this every time is the same: a developer opens the CADRG `A.TOC` as if it were a text file, or runs raster-to-vector polygonization without reading the embedded projection, and the resulting GeoJSON lands the entire sheet hundreds of metres off true ground position. This page solves exactly that edge case — extracting the embedded Coordinate Reference System from a CADRG product and emitting standards-clean, position-correct GeoJSON with a deterministic Python pipeline, before any rendering happens on the [coordinate reference systems for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) baseline.

## Root Cause and Operational Impact

CADRG products embed military grid or Universal Transverse Mercator (UTM) projections that do not natively align with the WGS 84 / EPSG:4326 baseline that web-based incident mapping frameworks assume. The `A.TOC` (also written `A.toc`) frame-directory file is a **binary** National Imagery Transmission Format (NITF) / CADRG Table of Contents — a structured container, not a plain-text document. Two distinct mistakes produce the same dangerous symptom:

1. **Reading `A.TOC` as UTF-8 text.** The parse either throws or silently yields garbage, and the projection metadata that ties pixels to the earth is never recovered.
2. **Polygonizing without reprojection.** Even when GDAL opens the frames correctly, skipping the datum transform leaves vertices in the source projected coordinate system. A web client interprets those projected metres as degrees, and the overlay either drifts hundreds of metres or collapses toward null-island (0, 0).

In a routine office context this is an inconvenience. In an active incident it is a hazard: a hazard-zone polygon misaligned by 50 m can place an evacuation hold line on the wrong side of a road, and a misregistered staging marker can route a strike team into the burn. Silent coordinate drift also breaks multi-agency data fusion, because a downstream consumer trusts the GeoJSON header and never re-checks the math. The fix has to be explicit, logged, and audit-flagged rather than best-effort.

<svg viewBox="0 0 760 430" role="img" aria-label="Data-flow pipeline converting a binary CADRG A.TOC file into position-correct GeoJSON, with two failure branches: parsing A.TOC as text, and skipping reprojection so geometry drifts toward null-island." xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-width:760px;display:block;margin:1.5rem auto;font-family:inherit;color:var(--ink)">
  <title>CADRG to GeoJSON conversion pipeline with failure branches</title>
  <desc>The correct path flows left to right: the binary CADRG A.TOC frame directory is opened by the GDAL NITF/CADRG driver, which reads the embedded CRS; rasterio.features.shapes polygonizes each band; a pyproj Transformer reprojects every ring to EPSG:4326; and a validated GeoJSON FeatureCollection is emitted with audit metadata. Two red failure branches break off: reading A.TOC as UTF-8 text yields garbage and loses the projection, and skipping reprojection leaves coordinates in projected metres that drift toward null-island at zero, zero.</desc>
  <defs>
    <marker id="cadrg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="currentColor"/>
    </marker>
    <marker id="cadrg-arrow-fail" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--crimson)"/>
    </marker>
  </defs>
  <style>
    .cadrg-box{fill:var(--cream,#fff);stroke:currentColor;stroke-width:1.5;}
    .cadrg-accent{fill:var(--petal-soft,#ffe6ea);stroke:var(--crimson,#c8102e);stroke-width:1.5;}
    .cadrg-good{fill:#eef9f0;stroke:#1f7a3d;stroke-width:1.6;}
    .cadrg-fail{fill:var(--petal,#ffd1d8);stroke:var(--crimson,#c8102e);stroke-width:1.5;}
    .cadrg-t{fill:currentColor;font-size:13px;}
    .cadrg-sub{fill:var(--muted,#6b4549);font-size:11px;}
    .cadrg-failt{fill:var(--crimson-deep,#7a0a1f);font-size:12px;}
    .cadrg-flow{fill:none;stroke:currentColor;stroke-width:1.6;marker-end:url(#cadrg-arrow);}
    .cadrg-flowfail{fill:none;stroke:var(--crimson,#c8102e);stroke-width:1.6;stroke-dasharray:5 4;marker-end:url(#cadrg-arrow-fail);}
    .cadrg-lbl{font-size:13px;font-weight:600;}
  </style>
  <!-- Stage 1: A.TOC -->
  <rect class="cadrg-box" x="14" y="150" width="150" height="66" rx="8"/>
  <text class="cadrg-t cadrg-lbl" x="89" y="178" text-anchor="middle">A.TOC</text>
  <text class="cadrg-sub" x="89" y="196" text-anchor="middle">binary NITF / CADRG</text>
  <!-- Stage 2: GDAL driver -->
  <rect class="cadrg-accent" x="206" y="150" width="156" height="66" rx="8"/>
  <text class="cadrg-t cadrg-lbl" x="284" y="174" text-anchor="middle">GDAL NITF driver</text>
  <text class="cadrg-sub" x="284" y="192" text-anchor="middle">reads embedded CRS</text>
  <text class="cadrg-sub" x="284" y="206" text-anchor="middle">+ src.transform</text>
  <!-- Stage 3: polygonize -->
  <rect class="cadrg-box" x="404" y="150" width="156" height="66" rx="8"/>
  <text class="cadrg-t cadrg-lbl" x="482" y="174" text-anchor="middle">shapes()</text>
  <text class="cadrg-sub" x="482" y="192" text-anchor="middle">polygonize per band</text>
  <text class="cadrg-sub" x="482" y="206" text-anchor="middle">rasterio.features</text>
  <!-- Stage 4: reproject -->
  <rect class="cadrg-accent" x="602" y="150" width="146" height="66" rx="8"/>
  <text class="cadrg-t cadrg-lbl" x="675" y="174" text-anchor="middle">pyproj Transformer</text>
  <text class="cadrg-sub" x="675" y="192" text-anchor="middle">ring &#8594; EPSG:4326</text>
  <text class="cadrg-sub" x="675" y="206" text-anchor="middle">always_xy=True</text>
  <!-- Stage 5: GeoJSON output (good, below) -->
  <rect class="cadrg-good" x="544" y="318" width="204" height="74" rx="8"/>
  <text class="cadrg-t cadrg-lbl" x="646" y="344" text-anchor="middle" fill="#1f7a3d">GeoJSON FeatureCollection</text>
  <text class="cadrg-sub" x="646" y="362" text-anchor="middle">RFC 7946, position-correct</text>
  <text class="cadrg-sub" x="646" y="378" text-anchor="middle">crs_confirmed: true + audit</text>
  <!-- Main flow arrows -->
  <line class="cadrg-flow" x1="164" y1="183" x2="200" y2="183"/>
  <line class="cadrg-flow" x1="362" y1="183" x2="398" y2="183"/>
  <line class="cadrg-flow" x1="560" y1="183" x2="596" y2="183"/>
  <!-- reproject down to output -->
  <path class="cadrg-flow" d="M675 216 L675 280 Q675 290 665 290 L656 290 Q646 290 646 300 L646 312"/>
  <!-- Failure branch 1: text-parse of A.TOC -->
  <path class="cadrg-flowfail" d="M89 150 L89 70 Q89 60 99 60 L150 60"/>
  <rect class="cadrg-fail" x="156" y="34" width="220" height="52" rx="8"/>
  <text class="cadrg-failt cadrg-lbl" x="266" y="56" text-anchor="middle">FAIL: open A.TOC as UTF-8</text>
  <text class="cadrg-sub" x="266" y="74" text-anchor="middle">garbage / throws &#8594; CRS lost</text>
  <!-- Failure branch 2: skipped reprojection -> null island -->
  <path class="cadrg-flowfail" d="M482 216 L482 300 Q482 312 470 312 L300 312"/>
  <rect class="cadrg-fail" x="60" y="318" width="232" height="74" rx="8"/>
  <text class="cadrg-failt cadrg-lbl" x="176" y="344" text-anchor="middle">FAIL: skip reprojection</text>
  <text class="cadrg-sub" x="176" y="362" text-anchor="middle">projected metres read as degrees</text>
  <text class="cadrg-sub" x="176" y="378" text-anchor="middle">geometry drifts &#8594; null-island (0,0)</text>
  <!-- legend -->
  <line x1="14" y1="412" x2="44" y2="412" stroke="currentColor" stroke-width="1.6"/>
  <text class="cadrg-sub" x="50" y="416">correct path</text>
  <line x1="150" y1="412" x2="180" y2="412" stroke="var(--crimson,#c8102e)" stroke-width="1.6" stroke-dasharray="5 4"/>
  <text class="cadrg-sub" x="186" y="416">failure branch</text>
</svg>

## Tiered Resolution Strategy

Work the fix from the definitive, position-correct path down to a safe default that never ships silently:

1. **Definitive fix — let the GDAL NITF/CADRG driver read the binary TOC.** Open the `A.TOC` path (or a pre-converted GeoTIFF) with `rasterio`/GDAL so the driver resolves zone and projection metadata, then reproject every vertex to EPSG:4326 with `pyproj` before writing GeoJSON. This is the only path that produces ground-true output.
2. **Recover a confirmed CRS when the driver returns none.** If `src.crs` is `None`, run `gdalinfo` to inspect the reported projection and assign the published National Geospatial-Intelligence Agency (NGA) zone explicitly. Never guess the zone from the filename.
3. **Convert first, vectorize second, on constrained hardware.** For oversized sheets that exhaust memory, fall back to `gdal_translate` to GeoTIFF followed by `gdal_polygonize.py`, or tile the read with `rasterio.windows`.
4. **Safe default with an audit flag.** If, and only if, no CRS can be confirmed by any of the above, default to EPSG:4326, stamp the output with `crs_confirmed: false` and a loud warning in the metadata, and quarantine the file from automatic publication. A flagged, held artifact is recoverable; a silently mis-projected one that reaches a tablet is not.

## Production Python Implementation

The implementation below opens the CADRG dataset through the GDAL NITF/CADRG driver, polygonizes each band, reprojects every exterior ring to EPSG:4326 with `always_xy=True` to defeat axis-order inversion, and emits an audit trail recording whether the source CRS was actually confirmed. It uses structured logging and explicit exception boundaries throughout — no `print` statements, no silent fallbacks.

```python
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import rasterio
from rasterio.features import shapes
from shapely.geometry import shape, mapping
from shapely.validation import make_valid
from pyproj import Transformer

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("cadrg_to_geojson")


class CADRGConversionError(Exception):
    """Raised when a CADRG product cannot be converted to position-correct GeoJSON."""


def open_cadrg_dataset(cadrg_path: str) -> rasterio.DatasetReader:
    """
    Open a CADRG dataset via rasterio (GDAL NITF/CADRG driver).

    Pass either the A.TOC path (GDAL discovers all frames and embedded projection
    metadata) or a pre-converted GeoTIFF. Never read A.TOC as text; it is a binary
    NITF container.
    """
    try:
        return rasterio.open(cadrg_path)
    except Exception as exc:  # noqa: BLE001 - surface the GDAL driver error verbatim
        raise CADRGConversionError(
            f"Failed to open CADRG dataset '{cadrg_path}'. Verify the GDAL NITF "
            f"driver is compiled in (gdalinfo --formats | grep NITF): {exc}"
        ) from exc


def transform_and_vectorize(cadrg_path: str, threshold: int = 0) -> dict[str, Any]:
    """
    Convert a CADRG raster to GeoJSON with explicit CRS confirmation and reprojection.

    Polygonizes non-background pixels per band, then reprojects each exterior ring to
    WGS 84 / EPSG:4326. always_xy=True forces (lon, lat) order regardless of how the
    source CRS authority defines axis ordering.
    """
    crs_confirmed = True
    try:
        with open_cadrg_dataset(cadrg_path) as src:
            if src.crs is None:
                crs_confirmed = False
                logger.warning(
                    "Raster lacks an embedded CRS. Run 'gdalinfo %s' and assign the "
                    "published NGA zone explicitly. Defaulting to EPSG:4326 and "
                    "flagging output as UNCONFIRMED — do not auto-publish.",
                    cadrg_path,
                )
                source_crs = "EPSG:4326"
            else:
                source_crs = src.crs.to_string()
                logger.info("Confirmed source CRS: %s", source_crs)

            transformer = Transformer.from_crs(
                src.crs or "EPSG:4326", "EPSG:4326", always_xy=True
            )

            features: list[dict[str, Any]] = []
            for band_idx in range(1, src.count + 1):
                band_data = src.read(band_idx)
                mask = band_data > threshold

                for geom_dict, val in shapes(band_data, mask=mask, transform=src.transform):
                    poly = shape(geom_dict)
                    if not poly.is_valid:
                        poly = make_valid(poly)

                    ext_coords = list(poly.exterior.coords)
                    # transformer.transform(x, y) -> (lon, lat) because always_xy=True
                    reprojected = [transformer.transform(x, y) for x, y in ext_coords]
                    poly_wgs84 = shape({"type": "Polygon", "coordinates": [reprojected]})

                    features.append({
                        "type": "Feature",
                        "geometry": mapping(poly_wgs84),
                        "properties": {
                            "band": band_idx,
                            "pixel_value": int(val),
                            "source_crs": source_crs,
                            "crs_confirmed": crs_confirmed,
                        },
                    })

            logger.info("Vectorized %d features from %s", len(features), cadrg_path)
            return {
                "type": "FeatureCollection",
                "features": features,
                "crs": {
                    "type": "name",
                    "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
                },
                "_crs_confirmed": crs_confirmed,
            }
    except MemoryError as exc:
        logger.critical("Memory exceeded on %s; fall back to gdal_polygonize.py.", cadrg_path)
        raise CADRGConversionError(
            "Use gdal_translate + gdal_polygonize.py, or tile via rasterio.windows, "
            "for sheets that exhaust device memory."
        ) from exc
    except CADRGConversionError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("Vectorization failed for %s: %s", cadrg_path, exc)
        raise CADRGConversionError(f"Vectorization failed: {exc}") from exc


def export_geojson(geojson_data: dict[str, Any], output_path: str) -> None:
    """
    Write GeoJSON with an Open Geospatial Consortium (OGC) RFC 7946-aligned body and an
    ISO 19115 audit metadata block. UNCONFIRMED output is held, not published.
    """
    crs_confirmed = geojson_data.pop("_crs_confirmed", True)
    geojson_data["metadata"] = {
        "standard": "ISO 19115",
        "processed_utc": datetime.now(timezone.utc).isoformat(),
        "source_edition": "CADRG",
        "crs_transform": "source_embedded -> EPSG:4326",
        "crs_confirmed": crs_confirmed,
        "publication_status": "released" if crs_confirmed else "quarantined_unconfirmed_crs",
    }

    target = Path(output_path)
    if not crs_confirmed:
        target = target.with_suffix(".UNCONFIRMED.geojson")
        logger.warning("CRS unconfirmed — writing to quarantine path %s", target)

    with target.open("w", encoding="utf-8") as fh:
        json.dump(geojson_data, fh, indent=2)
    logger.info("GeoJSON written to %s", target)


if __name__ == "__main__":
    # For raw CADRG products pass the A.TOC path so the GDAL NITF driver discovers
    # every frame and its embedded projection metadata.
    CADRG_INPUT = "path/to/A.TOC"  # or a pre-converted GeoTIFF
    OUTPUT = "incident_zone.geojson"

    feature_collection = transform_and_vectorize(CADRG_INPUT, threshold=1)
    export_geojson(feature_collection, OUTPUT)
```

## Validation Checklist

Verify each item before the converted sheet reaches a field device:

- [ ] `gdalinfo --formats | grep NITF` confirms the local GDAL build includes NITF/CADRG support.
- [ ] The pipeline opened the `A.TOC` (or GeoTIFF) through the driver — no code path reads the TOC as text.
- [ ] `src.crs` was non-`None`, or the published NGA zone was assigned explicitly and the run logged `crs_confirmed: true`.
- [ ] A known control point (a road junction, summit, or staging area) overlays within tolerance in a viewer; checked drift is under 5 m, not the 50 m+ of an axis-order or wrong-zone error.
- [ ] Output validates against OGC GeoJSON (RFC 7946); self-intersections and slivers were repaired with `make_valid()`.
- [ ] No feature collapsed toward null-island (0, 0) — a tell-tale sign of a dropped or wrong transform.
- [ ] Any `UNCONFIRMED` artifact was quarantined and never auto-published.

## Edge Cases and Gotchas

**Axis-order inversion.** `pyproj` honours each CRS authority's declared axis order. Without `always_xy=True` a transform can return (lat, lon) and silently swap the entire sheet across the globe. Always force `always_xy=True` and spot-check one vertex.

**Null-island drift.** A `None` transform, an unset `src.transform`, or polygonizing pixel indices instead of georeferenced coordinates pulls geometry toward (0, 0). Treat any feature near the equator/prime-meridian intersection as a failed conversion until proven otherwise.

**Wrong UTM zone.** CADRG sheets spanning a zone boundary, or filename-inferred zones, produce a clean-looking GeoJSON offset by hundreds of metres. Confirm the GDAL-reported zone against the sheet's published NGA metadata, never the filename.

**Offline device quirks.** Field tablets bundle `pyproj` datum grids locally; if a high-accuracy NADCON/HARN grid is absent, the transform falls back to a lower-accuracy path without raising. Pin the grid set and assert grid availability before deployment so degraded accuracy never ships unannounced.

**Agency-specific datum anomalies.** Legacy sheets may reference NAD27 or older local datums while incoming live feeds use NAD83(2011) or ITRF2014. Resolve datum shifts explicitly during conversion rather than assuming a coincident datum — this is the same discipline applied when [handling missing CRS in field-collected GPS logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/). Pre-processing CADRG sheets into validated GeoJSON and caching them in a local store removes any dependence on cellular backhaul during an active incident.

## Related

- [How to Set Up PostGIS for Emergency Response](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/how-to-set-up-postgis-for-emergency-response/)
- [Handling Missing CRS in Field-Collected GPS Logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/)
- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/)

Up: [Coordinate Reference Systems for Disaster Zones overview](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/)
