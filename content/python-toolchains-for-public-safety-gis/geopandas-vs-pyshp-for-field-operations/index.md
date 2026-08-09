# Geopandas vs PyShp for Field Operations: Choosing the Right Spatial Library

## Problem Framing

A wildfire perimeter update lands at a forward operating base running off a generator. The analyst on the ruggedized tablet needs to validate the geometry, reproject it to the local UTM zone, deduplicate it against the last drone pass, and re-emit a clean shapefile for the legacy computer-aided dispatch (CAD) system — all in under a minute, on 8 GB of RAM, with no upstream cellular backhaul. Reach for the wrong Python spatial library here and the failure is operational, not academic: Geopandas loaded against a multi-gigabyte orthomosaic footprint will exhaust the tablet's memory and the process will be killed mid-write, leaving a truncated `.shp` with no `.shx` index that the CAD importer silently rejects. PyShp pointed at a topology-reconciliation task will quietly write self-intersecting polygons because it has no concept of geometry validity at all. The two libraries are not competitors — they sit at different tiers of the same pipeline — and selecting between them per task is the discipline this guide enforces.

## Prerequisites

This pattern assumes a hardened runtime is already in place. Specifically, it depends on:

- **A pinned spatial stack.** GDAL, PROJ, `pyproj`, and `geopandas` must be version-locked inside a reproducible image — the contract established when [setting up Dockerized GIS environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/). PyShp is pure Python and adds no binary dependency, which is precisely why it survives where Geopandas' GDAL/PROJ chain cannot be compiled.
- **A declared coordinate reference system (CRS) contract.** Field collection arrives in EPSG:4326 (WGS 84); local analysis happens in a projected UTM zone (EPSG:326xx/327xx). Never assume a default — every block below sets its CRS explicitly, consistent with the [Coordinate Reference System standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/).
- **A schema contract.** Attribute fields, types, and order are fixed upstream so written shapefiles match what the consuming CAD/records-management system expects.
- **`always_xy=True` discipline.** Any `pyproj.Transformer` is constructed with `always_xy=True` so coordinates are consistently (longitude, latitude) and axis-order inversion cannot occur.

Spelled out once for this page: NIMS is the National Incident Management System, FEMA is the Federal Emergency Management Agency, OGC is the Open Geospatial Consortium, and ISO 22320 is the international standard for emergency-management operations.

## Decision: Which Library at Which Tier

The selection is a function of deployment tier and operational constraint, not preference. Geopandas is the analytics engine for command-center and aggregation nodes; PyShp is the dependency-minimal I/O layer for edge nodes and legacy export.

<svg viewBox="0 0 960 560" role="img" aria-label="Decision flowchart for choosing between Geopandas and PyShp by deployment tier. An incoming task is first tested for whether it needs a spatial join, topology validation, or reprojection of a large dataset. If yes, it routes to the Geopandas tier on a command-center node with sixteen gigabytes or more of RAM and GDAL and PROJ present. If no, a second test asks whether it needs a low-memory streaming write or runs on a constrained or offline edge node with no GDAL. If yes, it routes to the PyShp tier on a field tablet with eight gigabytes or less, pure Python with zero binary dependencies. The recommended hybrid path runs both in sequence: Geopandas reconciles, validates, and reprojects, then hands off finalized features to PyShp for a streaming export to the legacy CAD system on the offline tablet." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Library selection by tier: Geopandas for in-memory analytics, PyShp for constrained-edge export, hybrid handoff between them</title>
  <desc>A task is classified by its requirements. Work that needs a spatial join, topology validation, or reprojection of a large dataset goes to the Geopandas tier — a command-center node with sixteen gigabytes or more of RAM and the GDAL/PROJ binary chain present. Work that only needs a low-memory streaming write, or that runs on a constrained or offline edge node with no GDAL, goes to the PyShp tier — a field tablet of eight gigabytes or less running pure Python with zero binary dependencies. The two are not competitors but consecutive stages: the recommended hybrid pipeline has Geopandas reconcile, validate, and reproject features, then hand the finalized, validated set off to PyShp, which streams it record-by-record into the ESRI shapefile the legacy CAD importer expects on the disconnected tablet.</desc>
  <defs>
    <marker id="gp-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="gp-flow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <!-- entry -->
    <rect x="380" y="14" width="200" height="46" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="480" y="34" font-weight="700">Incoming task</text>
    <text x="480" y="50" font-size="10.5">field perimeter · telemetry batch</text>
    <!-- decision 1: spatial work? -->
    <path d="M480,92 L640,150 L480,208 L320,150 Z" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="480" y="138" font-size="11">Needs spatial join,</text>
    <text x="480" y="153" font-size="11">topology validation, or</text>
    <text x="480" y="168" font-size="11">reproject of large data?</text>
    <!-- decision 2: edge write? -->
    <path d="M480,300 L648,360 L480,420 L312,360 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="480" y="348" font-size="11">Low-memory streaming</text>
    <text x="480" y="363" font-size="11">write, or constrained /</text>
    <text x="480" y="378" font-size="11">offline edge, no GDAL?</text>
    <!-- Geopandas tier (left) -->
    <rect x="40" y="118" width="216" height="92" rx="9" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="148" y="142" font-weight="700" font-size="13">Geopandas tier</text>
    <text x="148" y="161" font-size="10.5">command center / regional EOC</text>
    <text x="148" y="177" font-size="10.5">≥ 16 GB RAM · GDAL + PROJ + GEOS</text>
    <text x="148" y="193" font-size="10.5">sjoin · make_valid · to_crs</text>
    <!-- PyShp tier (right) -->
    <rect x="704" y="328" width="216" height="92" rx="9" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="2"/>
    <text x="812" y="352" font-weight="700" font-size="13">PyShp tier</text>
    <text x="812" y="371" font-size="10.5">field tablet / edge gateway</text>
    <text x="812" y="387" font-size="10.5">≤ 8 GB RAM · pure Python, no deps</text>
    <text x="812" y="403" font-size="10.5">streaming .shp/.shx/.dbf write</text>
    <!-- arrows: entry -> decision 1 -->
    <line x1="480" y1="60" x2="480" y2="88" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#gp-flow)"/>
    <!-- decision1 YES -> Geopandas -->
    <path d="M320,150 L260,158" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#gp-flow)"/>
    <text x="298" y="132" font-size="10" font-weight="700" fill="var(--crimson, currentColor)">YES</text>
    <!-- decision1 NO -> decision 2 -->
    <line x1="480" y1="208" x2="480" y2="296" stroke="currentColor" stroke-width="1.6" marker-end="url(#gp-flow-dim)"/>
    <text x="498" y="256" font-size="10" font-weight="700">NO</text>
    <!-- decision2 YES -> PyShp -->
    <path d="M648,360 L700,362" fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#gp-flow-dim)"/>
    <text x="676" y="346" font-size="10" font-weight="700">YES</text>
    <!-- decision2 NO -> back to Geopandas (analytics anyway) -->
    <path d="M312,360 Q150,360 148,214" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#gp-flow-dim)"/>
    <text x="196" y="300" font-size="10" font-weight="700">NO</text>
    <!-- hybrid handoff band -->
    <rect x="40" y="466" width="880" height="78" rx="10" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" stroke-dasharray="3 4"/>
    <text x="480" y="490" font-weight="700" font-size="12.5" fill="var(--crimson, currentColor)">Recommended hybrid path</text>
    <rect x="68" y="500" width="220" height="34" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="178" y="521" font-size="11">Geopandas: validate · reproject</text>
    <rect x="372" y="500" width="160" height="34" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="452" y="516" font-size="10.5">handoff: valid,</text>
    <text x="452" y="529" font-size="10.5">singular features</text>
    <rect x="616" y="500" width="276" height="34" rx="7" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.8"/>
    <text x="754" y="521" font-size="11">PyShp: streaming export → legacy CAD</text>
    <line x1="288" y1="517" x2="368" y2="517" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#gp-flow)"/>
    <line x1="532" y1="517" x2="612" y2="517" stroke="currentColor" stroke-width="1.6" marker-end="url(#gp-flow-dim)"/>
    <!-- tier-to-hybrid connectors -->
    <line x1="148" y1="210" x2="148" y2="498" stroke="var(--crimson, currentColor)" stroke-width="1.2" stroke-dasharray="2 5"/>
    <line x1="812" y1="420" x2="812" y2="498" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 5"/>
  </g>
</svg>

| Decision axis | Geopandas | PyShp |
|---------------|-----------|-------|
| Memory model | In-memory `GeoDataFrame` (Pandas-backed) | Sequential streaming read/write |
| Footprint | GDAL + PROJ + GEOS + Pandas | Pure Python, zero binary deps |
| Spatial joins / topology | Native (`sjoin`, `make_valid`, `sindex`) | None |
| CRS transforms | Native via `pyproj`/Fiona | Manual; no datum awareness |
| Best tier | Command center, regional EOC | Field tablet, edge gateway, legacy export |
| Typical input | Multi-GB perimeters, orthomosaics | Per-record telemetry, point/polygon batches |

The practical consequence: reconcile and validate with Geopandas, then offload finalized features to PyShp for constrained-network distribution. The deduplication half of that handoff is covered in depth under [resolving duplicate incident reports across jurisdictions](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/resolving-duplicate-incident-reports-across-jurisdictions/).

The row that decides most deployments is the first one, and "in-memory versus streaming" understates it. The difference is not that one library uses more memory than the other; it is that their memory profiles have different *shapes*, and only one of those shapes has a ceiling you can plan around.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="mem-title mem-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="mem-title">Resident memory while writing a 250,000-feature export, GeoPandas against PyShp</title>
  <desc id="mem-desc">Resident set size plotted against features processed while exporting a 250,000-feature incident layer. GeoPandas materialises the whole frame before writing, so its memory climbs linearly from about 120 megabytes to roughly 1.9 gigabytes and crosses the 1.2 gigabyte ceiling of a ruggedized tablet at about 152,000 features, where the process is killed. PyShp writes sequentially and holds one record at a time, so it stays flat near 55 megabytes for the entire export regardless of how many features are written. The distinction is not that one library is lighter but that one has a memory profile proportional to the dataset and the other has a profile proportional to a single record.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="56" font-size="10.5" fill="var(--muted)">peak RSS (MB)</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 240 H820"/><path d="M180 180 H820"/><path d="M180 120 H820"/><path d="M180 60 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="110" y="304">0</text><text x="110" y="244">500</text><text x="104" y="184">1000</text>
    <text x="104" y="124">1500</text><text x="104" y="64">2000</text>
  </g>
  <path d="M180 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 156 H820" fill="none" stroke="var(--crimson-deep)" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="190" y="150" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">1.2 GB tablet ceiling</text>
  <path d="M180 285.6 L308 242.4 L436 200.4 L564 158.4 L692 116.4 L820 74.4" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <path d="M180 293.4 L308 292 L436 293.8 L564 292.4 L692 293.6 L820 292.8" fill="none" stroke="var(--crimson-deep)" stroke-width="2.8"/>
  <circle cx="564" cy="156" r="7" fill="var(--ember)" stroke="var(--crimson-deep)" stroke-width="2"/>
  <text x="424" y="180" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">OOM-killed at ~152k features</text>
  <text x="596" y="100" font-size="11" font-weight="700" fill="var(--crimson)">geopandas — full materialisation</text>
  <text x="556" y="282" font-size="11" font-weight="700" fill="var(--crimson-deep)">pyshp — sequential streaming</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="320">0</text><text x="308" y="320">50k</text><text x="436" y="320">100k</text>
    <text x="564" y="320">150k</text><text x="692" y="320">200k</text><text x="820" y="320">250k</text>
    <text x="500" y="344" font-size="11">features written</text>
  </g>
  <text x="440" y="368" font-size="11" text-anchor="middle" fill="var(--muted)">One profile scales with the dataset; the other scales with a single record.</text>
</svg>

GeoPandas' consumption is proportional to the dataset, so its peak is a function of the input you happen to be handed. That is entirely workable on a command-centre node, where the input is known and the RAM is provisioned for the largest layer in the catalogue. It is unworkable on an edge node, because the quantity that determines whether the process survives is not under the edge node's control — a mutual-aid partner joins the response, the regional layer grows by 40 per cent, and a tablet that has exported this file every morning for a month is killed mid-write.

PyShp's consumption is proportional to a single record. Two hundred and fifty thousand features and two and a half million cost the same 55 megabytes, because at no point does more than one record exist in memory. That is the property that makes it safe to ship to hardware you cannot profile in advance, and it is worth being precise about what it costs: no spatial index, no topology repair, no CRS awareness, no joins. PyShp is not a lighter GeoPandas. It is a serialiser, and every capability the analytics tier relies on has to have already happened before the data reaches it.

Which is exactly why the tier boundary sits where it does. Reconciliation, validation and reprojection run once in the command-centre tier where the memory to do them exists; the edge tier receives data that is already correct and does nothing but write it out. Attempting the reverse — pushing a spatial join to the edge because the edge is where the data is needed — is the single most common way these deployments fail, and it fails at exactly the moment the incident grows.

## Step-by-Step Implementation

### Step 1 — Memory-bounded ingestion with Geopandas (command-center tier)

On a node with adequate RAM, ingest field shapefiles in chunks, validate every geometry, and harmonize the CRS to the operational UTM zone. Chunking caps peak memory so a single oversized incident boundary cannot kill the process; `make_valid` repairs self-intersections before they propagate into joins.

```python
import geopandas as gpd
import pandas as pd
import logging
from pathlib import Path
from shapely.validation import make_valid

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)


def ingest_incident_boundaries(
    input_dir: Path,
    chunk_size: int = 5000,
    target_crs: str = "EPSG:32610",
) -> gpd.GeoDataFrame:
    """Chunked ingestion with explicit geometry validation and CRS harmonization.

    Caps peak memory by streaming features in fixed-size chunks, repairs invalid
    geometry, and forces a known CRS so downstream measurement is trustworthy.
    """
    all_features: list[gpd.GeoDataFrame] = []
    for shp_file in input_dir.glob("*.shp"):
        try:
            for chunk in gpd.read_file(shp_file, chunksize=chunk_size):
                chunk["geometry"] = chunk["geometry"].apply(
                    lambda g: make_valid(g) if g is not None and not g.is_valid else g
                )
                chunk = chunk[chunk["geometry"].notna()]
                if chunk.crs is None:
                    # Field collection default; never silently assume the target.
                    chunk.set_crs("EPSG:4326", inplace=True)
                chunk = chunk.to_crs(target_crs)
                all_features.append(chunk)
                logger.info("Processed %d features from %s", len(chunk), shp_file.name)
        except Exception as exc:
            logger.error("Failed to process %s: %s", shp_file.name, exc)
            continue

    if not all_features:
        raise RuntimeError("No valid spatial features ingested.")

    merged = gpd.GeoDataFrame(pd.concat(all_features, ignore_index=True), crs=target_crs)
    del all_features  # explicit release of intermediate chunks
    return merged
```

### Step 2 — Reconcile and reproject in the Geopandas tier

Once features are in memory and valid, this is where spatial joins, tolerance buffering, and authoritative-source precedence run — the work PyShp cannot do. Keep everything in the projected CRS so buffers and distances are in metres, then hand the resolved set downstream. The reconciliation logic itself is detailed in the duplicate-resolution guide linked above; the rule to enforce here is that PyShp never sees a geometry until Geopandas has declared it valid and singular.

### Step 3 — Low-memory streaming export with PyShp (edge tier)

On the constrained field node, write the finalized records straight to the ESRI Shapefile the legacy CAD system expects. PyShp streams record-by-record, so a long write never inflates RAM. Guard every record: a polygon with fewer than three vertices or coordinates outside WGS 84 bounds will corrupt the output, so reject them before the write rather than after.

```python
import shapefile  # pyshp
import logging
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)


def write_edge_shapefile(
    output_path: str,
    records: list[dict[str, Any]],
    schema: dict[str, str],
) -> int:
    """Low-memory streaming writer with strict schema and bounds enforcement.

    Returns the count of records written. Skips degenerate geometry; aborts on
    out-of-bounds coordinates to prevent silent shapefile corruption.
    """
    writer = shapefile.Writer(output_path)
    for field_name, field_type in schema.items():
        writer.field(field_name, field_type)

    valid_count = 0
    try:
        for record in records:
            coords = record.get("geometry")
            if not coords or len(coords) < 3:
                logger.warning("Skipping degenerate polygon: %s", record.get("id", "unknown"))
                continue
            if any(abs(x) > 180 or abs(y) > 90 for x, y in coords):
                raise ValueError(f"Coordinates exceed WGS 84 bounds in record {record.get('id')}")

            writer.poly([coords])
            writer.record(*[record.get(k) for k in schema])
            valid_count += 1
    except Exception as exc:
        logger.error("Shapefile write aborted: %s", exc)
        raise
    finally:
        writer.close()  # finalizes .shp/.shx/.dbf sidecars together
        logger.info("Wrote %d records to %s", valid_count, output_path)
    return valid_count
```

### Step 4 — Verify the sidecar set is complete before distribution

A shapefile is not one file. The `.shx` index and `.dbf` attribute table must travel with the `.shp`, or the CAD importer rejects the layer. Assert all three exist and are non-empty before the package leaves the node (see the verification section below).

## Configuration Reference

| Parameter | Applies to | Default | Tuning guidance |
|-----------|-----------|---------|-----------------|
| `chunk_size` | Geopandas ingest | 5000 | Lower on ≤8 GB nodes to cap peak memory; raise on EOC hardware for throughput |
| `target_crs` | Geopandas ingest | `EPSG:32610` | Set to the incident's actual UTM zone; never leave at a hardcoded default |
| `make_valid` | Geopandas ingest | enabled | Disable only if upstream already guarantees OGC-valid geometry |
| `schema` (field order) | PyShp writer | upstream contract | Must match the consuming CAD/RMS exactly; order is significant |
| Bounds check (`±180/±90`) | PyShp writer | enabled | Keep enabled for WGS 84 output; widen only for projected-coordinate export |
| `GDAL_DATA` / `PROJ_LIB` | Geopandas runtime | container-set | Must point at vendored offline grid-shift files for correct datum transforms |

Verifying the sidecar set sounds like defensive box-ticking until you notice that the format's own notion of which files are optional is exactly backwards from an operational point of view.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="side-title side-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="side-title">The shapefile sidecar set and what breaks, loudly or silently, when each file is absent</title>
  <desc id="side-desc">A shapefile is five files, not one. The shp file carries geometry, the shx file the index and the dbf file the attributes; all three are required by the format, and losing any of them fails loudly — nothing loads, the reader rebuilds the index, or features arrive with no attributes. The prj and cpg files are optional in the specification and mandatory in this workflow, because losing them fails silently: without a prj the reader substitutes its own default coordinate reference system and the data lands in the wrong place while looking fine, and without a cpg non-ASCII attribute text is decoded with the wrong codepage and becomes mojibake. Silent failures are the reason the export step verifies the sidecar set before distribution rather than trusting that a write succeeded.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">a shapefile is five files — and two of the five fail without saying so</text>
  <text x="8" y="70" font-size="10" fill="var(--muted)">what is missing</text>
  <text x="8" y="166" font-size="10" fill="var(--muted)">what a reader does</text>
  <rect x="40" y="90" width="140" height="56" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <text x="110" y="114" font-size="13" font-weight="700" text-anchor="middle" fill="var(--cream)">.shp</text>
  <text x="110" y="132" font-size="10" text-anchor="middle" fill="var(--cream)">geometry</text>
  <rect x="200" y="90" width="140" height="56" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <text x="270" y="114" font-size="13" font-weight="700" text-anchor="middle" fill="var(--cream)">.shx</text>
  <text x="270" y="132" font-size="10" text-anchor="middle" fill="var(--cream)">index</text>
  <rect x="360" y="90" width="140" height="56" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <text x="430" y="114" font-size="13" font-weight="700" text-anchor="middle" fill="var(--cream)">.dbf</text>
  <text x="430" y="132" font-size="10" text-anchor="middle" fill="var(--cream)">attributes</text>
  <rect x="520" y="90" width="140" height="56" rx="8" fill="var(--petal-soft)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="590" y="114" font-size="13" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">.prj</text>
  <text x="590" y="132" font-size="10" text-anchor="middle" fill="var(--crimson-deep)">CRS</text>
  <rect x="680" y="90" width="140" height="56" rx="8" fill="var(--petal-soft)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="750" y="114" font-size="13" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">.cpg</text>
  <text x="750" y="132" font-size="10" text-anchor="middle" fill="var(--crimson-deep)">encoding</text>
  <rect x="40" y="180" width="140" height="66" rx="8" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="52" y="206" font-size="10" fill="currentColor">nothing loads —</text>
  <text x="52" y="222" font-size="10" fill="currentColor">not a dataset</text>
  <rect x="200" y="180" width="140" height="66" rx="8" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="212" y="206" font-size="10" fill="currentColor">most readers</text>
  <text x="212" y="222" font-size="10" fill="currentColor">rebuild it</text>
  <rect x="360" y="180" width="140" height="66" rx="8" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="372" y="206" font-size="10" fill="currentColor">geometry only,</text>
  <text x="372" y="222" font-size="10" fill="currentColor">no attributes</text>
  <rect x="520" y="180" width="140" height="66" rx="8" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="532" y="206" font-size="10" fill="currentColor">the reader guesses</text>
  <text x="532" y="222" font-size="10" fill="currentColor">its own CRS</text>
  <rect x="680" y="180" width="140" height="66" rx="8" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="692" y="206" font-size="10" fill="currentColor">non-ASCII text</text>
  <text x="692" y="222" font-size="10" fill="currentColor">becomes mojibake</text>
  <text x="110" y="268" font-size="10.5" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">loud</text>
  <text x="270" y="268" font-size="10.5" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">loud</text>
  <text x="430" y="268" font-size="10.5" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">loud</text>
  <text x="590" y="268" font-size="10.5" font-weight="700" text-anchor="middle" fill="var(--ember-text)">silent</text>
  <text x="750" y="268" font-size="10.5" font-weight="700" text-anchor="middle" fill="var(--ember-text)">silent</text>
  <circle cx="206" cy="304" r="7" fill="var(--crimson)"/>
  <text x="220" y="308" font-size="10.5" fill="currentColor">required by the format</text>
  <circle cx="456" cy="304" r="7" fill="var(--petal-soft)" stroke="var(--ember)" stroke-width="2"/>
  <text x="470" y="308" font-size="10.5" fill="currentColor">optional by spec — mandatory here</text>
  <text x="440" y="344" font-size="11" text-anchor="middle" fill="var(--muted)">The two the specification calls optional are the two whose absence you will not notice.</text>
</svg>

The three files the specification calls mandatory are the three whose absence is impossible to miss. Ship a `.shp` without its `.dbf` and every reader in the response reports features with no attributes within seconds of opening it; somebody notices immediately and asks for a resend. That is an inconvenience, not an incident.

The two the specification calls optional are the dangerous ones, because their absence produces a file that opens cleanly and is wrong. Without a `.prj`, a reader does not refuse — it substitutes a default, which for most desktop GIS clients is whatever the current project frame is using. The layer draws, the symbology renders, and the perimeter sits in the wrong place by however far the two coordinate systems disagree. Without a `.cpg`, attribute text is decoded with the reader's platform codepage, so a street name carrying a diacritic arrives mangled, and the operator who eventually spots it has no way to tell whether the export was corrupt or the source data was.

This asymmetry is the whole argument for verifying the set explicitly rather than checking that the write returned successfully. A successful write tells you the bytes reached the disk; it says nothing about whether the five files that constitute a usable dataset are all present. Assert on the file set, assert that the `.prj` contains the CRS you intended rather than merely existing, and treat a missing `.cpg` as a failed export rather than a warning — the cost of a re-export is a minute, and the cost of a silently reprojected evacuation boundary is the reason this site exists.

## Verification and Smoke Test

Run these assertions in staging before any field deployment. They confirm the Geopandas tier produced valid, correctly-projected geometry and the PyShp tier emitted a complete, importable shapefile set.

```python
from pathlib import Path
import geopandas as gpd


def smoke_test(merged: gpd.GeoDataFrame, output_stem: str, expected_crs: str = "EPSG:32610") -> None:
    """Fail loudly in staging if the pipeline output is not field-ready."""
    assert not merged.empty, "ingest produced zero features"
    assert merged.crs is not None and merged.crs.to_string() == expected_crs, "CRS not harmonized"
    assert merged.geometry.is_valid.all(), "invalid geometry survived validation"

    # All three shapefile sidecars must exist and be non-empty.
    for ext in (".shp", ".shx", ".dbf"):
        sidecar = Path(f"{output_stem}{ext}")
        assert sidecar.exists() and sidecar.stat().st_size > 0, f"missing/empty {ext}"

    # The written file must round-trip through Geopandas (proves importer-readability).
    roundtrip = gpd.read_file(f"{output_stem}.shp")
    assert len(roundtrip) > 0, "written shapefile reads back empty"
    print("SMOKE TEST PASSED")
```

CLI equivalent for a field tech without a Python shell:

```bash
ogrinfo -so -al edge_output.shp | grep -E "Feature Count|Geometry|EPSG"
```

## A note on the third option nobody costs

There is a version of this decision that skips both libraries: hand the edge node a GeoPackage and let it read the container directly. It is worth costing honestly rather than dismissing, because for a growing share of field applications it is the right answer.

The case for it is that a GeoPackage is a single file with an embedded CRS, real attribute typing, no codepage ambiguity and no sidecar set to verify — every silent failure mode described above simply does not exist. The case against it is dependency weight: reading one properly means GDAL, which is precisely the binary surface the edge tier was built to avoid, and a pure-Python SQLite reader gives you the container without the spatial semantics that make it worth having.

The deciding question is usually not technical but institutional: what can the receiving agency open? A shapefile is the format every partner in a multi-agency response can read without a conversation, which is a real operational property and the reason it persists three decades after it should have been retired. Where the consumer is your own field application, ship a GeoPackage and delete this entire class of problem. Where the consumer is a partner agency's decade-old desktop install, ship the shapefile and verify all five files — and see the [FlatGeobuf versus GeoPackage comparison](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/flatgeobuf-vs-geopackage-for-offline-caching/) for the streaming-read alternative when the consumer is a cache rather than a person.

## Integration with Adjacent Workflows

This two-tier pattern is one stage of a longer chain. The records PyShp writes are frequently sourced from streaming telemetry, normalized through [Python ETL for sensor and IoT data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/) before any deduplication runs. The pinned library versions both tiers depend on are governed by [version control for spatial workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/), so that a Geopandas product built at the EOC is reproducible bit-for-bit on the edge tablet. All of it sits inside the broader [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/) discipline, which enforces the CRS and schema contracts these libraries assume.

## Troubleshooting

**Symptom: the Geopandas process is killed (exit 137) during ingest.** Root cause: an oversized feature collection — typically a high-resolution orthomosaic footprint — loaded whole into RAM. Remediation: lower `chunk_size`, confirm `gpd.read_file` is called with `chunksize=`, and `del` intermediate frames as shown in Step 1.

**Symptom: the CAD importer rejects the shapefile as corrupt.** Root cause: a missing or zero-byte `.shx`/`.dbf` sidecar, usually because the writer was not closed. Remediation: ensure `writer.close()` runs in a `finally` block (Step 3) and run the sidecar assertion (Step 4) before packaging.

**Symptom: features land hundreds of metres off true position.** Root cause: axis-order inversion — coordinates interpreted as (lat, lon). Remediation: construct every `pyproj.Transformer` with `always_xy=True`, and never write WGS 84 lat/lon through PyShp without confirming vertex order matches the schema contract.

**Symptom: `sjoin` returns empty or nonsensical matches.** Root cause: the two layers are in different CRSs, so geometries do not overlap in coordinate space. Remediation: assert `left.crs == right.crs` (both in the projected UTM zone) before joining; reproject in Geopandas first.

**Symptom: PyShp writes polygons that fail downstream validation.** Root cause: PyShp performs no validity check, so self-intersecting rings pass straight through. Remediation: validate with `make_valid` in the Geopandas tier (Step 1) before handoff; PyShp must never receive unvalidated geometry.

## Related

- [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) — the reproducible runtime both tiers depend on.
- [Python ETL for Sensor & IoT Data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/) — upstream normalization that feeds these records.
- [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) — pinning the library versions that make products reproducible.
- [Resolving Duplicate Incident Reports Across Jurisdictions](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/resolving-duplicate-incident-reports-across-jurisdictions/) — the deduplication stage of the Geopandas → PyShp handoff.

Up: [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/)
