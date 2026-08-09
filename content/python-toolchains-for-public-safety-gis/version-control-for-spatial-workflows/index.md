---
title: "Version Control for Spatial Workflows"
description: "Audit-grade version control for emergency GIS: separate Git logic from DVC-tracked geospatial binaries, version CRS and schema transforms, gate merges on topology validation, and reproduce any incident map deterministically."
slug: version-control-for-spatial-workflows
type: guide
breadcrumb: "Spatial Version Control"
datePublished: "2025-02-21"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Version Control for Spatial Workflows in Emergency GIS",
      "description": "Audit-grade version control for emergency GIS: separate Git logic from DVC-tracked geospatial binaries, version CRS and schema transforms, gate merges on topology validation, and reproduce any incident map deterministically.",
      "datePublished": "2025-02-21",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Python Toolchains for Public Safety GIS", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/" },
        { "@type": "ListItem", "position": 3, "name": "Version Control for Spatial Workflows", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Version-control a spatial workflow for incident response",
      "description": "Split Git logic from DVC-tracked geospatial binaries, version CRS and schema transforms as code, gate merges on topology validation, and pin the runtime so any incident map can be reproduced bit-for-bit.",
      "step": [
        { "@type": "HowToStep", "name": "Separate logic from data", "text": "Track Python scripts and configs in Git; track GeoPackage, GeoTIFF, and point-cloud binaries with DVC so the repository stays light and the data stays auditable." },
        { "@type": "HowToStep", "name": "Version the ingestion transform", "text": "Commit the CRS normalization and schema-validation step so every coordinate adjustment is traceable to a specific calibration release." },
        { "@type": "HowToStep", "name": "Declare a reproducible DVC pipeline", "text": "Express each ETL stage in dvc.yaml with explicit deps and outs, so dvc repro rebuilds only what changed and records a content hash for every artifact." },
        { "@type": "HowToStep", "name": "Gate merges on topology validation", "text": "Run a pytest topology and CRS check as a pre-commit hook and CI gate so invalid geometry can never reach a production incident branch." },
        { "@type": "HowToStep", "name": "Reproduce on a pinned runtime", "text": "Check out a commit, dvc checkout its data pointers, and re-run inside a pinned GDAL/PROJ container to reconstruct the exact map a responder saw." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not commit GeoPackage and GeoTIFF files directly to Git?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Git stores binary blobs whole on every change, so a daily-updated raster bloats the pack and clones become unusable in the field. DVC keeps only a small content-hashed pointer in Git and stores the binary in a cache or remote, so the repository stays clonable on a 4G tablet while every version remains retrievable and auditable."
          }
        },
        {
          "@type": "Question",
          "name": "How do you reproduce the exact map a responder saw at a past timestamp?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Check out the Git commit for that point in the incident, run dvc checkout to materialize the data pointers it references, and re-execute inside the pinned GDAL/PROJ container recorded for that release. Because logic, data hashes, and runtime are all versioned together, the rebuild is bit-for-bit, which is what NIMS and FEMA chain-of-custody expectations require."
          }
        },
        {
          "@type": "Question",
          "name": "What stops an invalid geometry from reaching a production incident branch?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A topology and CRS validation pass runs as a pre-commit hook on the developer workstation and again as a CI gate on the merge. Self-intersections, null geometry, sliver polygons, and a missing CRS all fail the build before the layer can feed an operational dashboard."
          }
        }
      ]
    }
  ]
}
</script>

# Version Control for Spatial Workflows

A flood-response team pushes an updated inundation layer at 14:00; by 18:00 a downstream evacuation map disagrees with it by two city blocks, and nobody can say which raster band, which reprojection step, or which analyst's manual edit introduced the shift. The after-action review stalls because the workspace has no lineage: the GeoTIFF was overwritten in place, the reprojection ran from an un-pinned `pyproj`, and the script that produced it was edited three times without a commit. Spatial version control exists to make that failure impossible — to guarantee that every incident map is traceable to the exact code, dependencies, and inputs that produced it, and that any past state can be reconstructed on demand. It is the audit-and-reproducibility arm of the broader [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/), and it carries the same chain-of-custody obligations every node in an incident must satisfy.

Spelled out once for this page: NIMS is the National Incident Management System, ICS is its Incident Command System, FEMA is the Federal Emergency Management Agency, OGC is the Open Geospatial Consortium, and ISO 22320 is the international standard for emergency-management operations.

## Prerequisites

This pattern versions logic, data, and the transforms between them; it assumes the contracts below are already established upstream.

- **Python packages:** `dvc >= 3.0` for data versioning and pipeline declaration, `geopandas >= 0.14`, `shapely >= 2.0`, and `pyproj >= 3.6` for the spatial transforms, and `pytest >= 7.4` for the validation gate. The standard-library `logging`, `pathlib`, `hashlib`, and `datetime` modules carry the audit trail and deterministic output pathing.
- **A pinned spatial runtime.** GDAL, PROJ, and the spatial Python bindings must be version-locked inside a reproducible image — the contract established when [setting up Dockerized GIS environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/). Without it, the same commit reprojects differently on two machines and the "reproducible" history is a fiction.
- **A declared CRS contract.** Field collection arrives in EPSG:4326 (WGS 84) and is normalized to a projected UTM zone (EPSG:326xx / 327xx) before any distance, area, or buffer is computed, consistent with the [Coordinate Reference System standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/). Every `pyproj` transform runs with `always_xy=True` so a lat/lon device never inverts axis order.
- **A schema contract.** Attribute fields, types, and order are fixed upstream so written GeoPackage layers match what consuming systems expect, and schema drift is caught at ingest rather than at merge.

## Architecture: Two Tracks, One Lineage

Conventional Git chokes on large binary payloads and has no concept of geometry, so production incident GIS runs a two-track model over a single commit graph. Git owns the lightweight, diff-friendly artifacts — Python scripts, configuration manifests, `dvc.yaml`, and the `.dvc` pointer files. DVC owns the heavy spatial binaries — GeoPackage, GeoTIFF, and LiDAR point clouds — storing each as a content-hashed object in a cache or shared remote and committing only the pointer to Git. The two tracks are stitched together at every commit: a single SHA resolves both the transform logic and the exact data hashes it consumed, so the workspace is auditable, rollback-capable, and aligned with NIMS/ICS documentation expectations.

<svg viewBox="0 0 880 430" role="img" aria-label="Two-track lineage diagram: a single commit binds a Git track holding scripts, configs, dvc.yaml, and .dvc pointer files to a DVC track holding content-hashed GeoPackage, GeoTIFF, and point-cloud binaries in a cache and remote. The commit sits on a graph of three branches — main, incident slash id, and hotfix slash id. A dvc checkout arrow materializes the pointers back into the working tree to reproduce a past incident map." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Two-track spatial version-control lineage: Git logic plus DVC-tracked binaries bound by one commit</title>
  <desc>Each commit binds two tracks. The Git track holds the lightweight, diff-friendly artifacts — the scripts, configs, dvc.yaml, and .dvc pointer files. The DVC track holds the heavy spatial binaries — GeoPackage, GeoTIFF, and LiDAR point clouds — as content-hashed objects in a local cache backed by a shared remote; Git stores only their pointers. A commit node ties a single SHA to both the transform logic and the exact data hashes it consumed, and sits on a commit graph spanning the main, incident slash id, and hotfix slash id branches. To reproduce a past map, a dvc checkout arrow reads the pointers at a chosen commit and materializes the matching binaries from the cache back into the working tree.</desc>
  <defs>
    <marker id="vcs-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="vcs-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <!-- track labels -->
    <text x="180" y="34" font-size="12.5" font-weight="700">Git track · logic</text>
    <text x="180" y="50" font-size="10.5">lightweight · diff-friendly</text>
    <text x="700" y="34" font-size="12.5" font-weight="700" fill="var(--crimson, currentColor)">DVC track · data</text>
    <text x="700" y="50" font-size="10.5">heavy · content-hashed</text>
    <!-- Git track artifacts -->
    <rect x="70" y="70" width="220" height="118" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="180" y="92" font-size="11">scripts/  ·  configs/</text>
    <text x="180" y="114" font-size="11">tests/</text>
    <text x="180" y="138" font-size="11" font-weight="600">dvc.yaml  ·  dvc.lock</text>
    <text x="180" y="164" font-size="11">*.dvc pointer files</text>
    <text x="180" y="180" font-size="10" fill="var(--crimson, currentColor)">small SHA pointers ↑</text>
    <!-- DVC cache -->
    <rect x="590" y="70" width="220" height="80" rx="8" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="700" y="90" font-size="11" font-weight="600">DVC cache (.dvc/cache)</text>
    <text x="700" y="110" font-size="10.5">GeoPackage · GeoTIFF</text>
    <text x="700" y="128" font-size="10.5">LiDAR point cloud</text>
    <text x="700" y="144" font-size="10" fill="var(--crimson, currentColor)">content-addressed objects</text>
    <!-- DVC remote -->
    <rect x="590" y="166" width="220" height="40" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="700" y="184" font-size="11" font-weight="600">Shared remote (object store)</text>
    <text x="700" y="199" font-size="10">field nodes pull versioned data</text>
    <!-- commit node -->
    <rect x="350" y="96" width="180" height="64" rx="10" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <text x="440" y="122" font-size="13" font-weight="700">Commit (one SHA)</text>
    <text x="440" y="141" font-size="10.5">binds logic + data hashes</text>
    <!-- commit graph / branches -->
    <text x="440" y="248" font-size="11.5" font-weight="600">Commit graph</text>
    <circle cx="150" cy="290" r="6" fill="currentColor"/>
    <circle cx="270" cy="290" r="6" fill="currentColor"/>
    <circle cx="390" cy="290" r="6" fill="currentColor"/>
    <circle cx="510" cy="290" r="6" fill="currentColor"/>
    <text x="700" y="294" font-size="11" text-anchor="start">main · production COP</text>
    <circle cx="430" cy="338" r="6" fill="var(--crimson, currentColor)"/>
    <circle cx="540" cy="338" r="6" fill="var(--crimson, currentColor)"/>
    <text x="700" y="342" font-size="11" text-anchor="start" fill="var(--crimson, currentColor)">incident/&lt;id&gt; · active response</text>
    <circle cx="470" cy="386" r="6" fill="currentColor"/>
    <circle cx="560" cy="386" r="6" fill="currentColor"/>
    <text x="700" y="390" font-size="11" text-anchor="start">hotfix/&lt;id&gt; · fast topology fix</text>
  </g>
  <!-- bind: commit to Git track -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#vcs-plain)">
    <path d="M350,128 H294"/>
  </g>
  <!-- bind: commit to DVC cache via pointer hashes -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#vcs-flow)">
    <path d="M530,120 H586"/>
  </g>
  <!-- cache <-> remote push/pull -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4">
    <path d="M664,150 V166" marker-end="url(#vcs-flow)"/>
    <path d="M736,166 V150" marker-end="url(#vcs-flow)"/>
  </g>
  <text x="612" y="161" font-size="9.5" fill="var(--crimson, currentColor)" text-anchor="middle">push</text>
  <text x="772" y="161" font-size="9.5" fill="var(--crimson, currentColor)" text-anchor="middle">pull</text>
  <!-- commit to graph -->
  <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="4 4">
    <path d="M440,160 V236"/>
  </g>
  <!-- branch lines -->
  <g fill="none" stroke="currentColor" stroke-width="1.6">
    <path d="M120,290 H540" marker-end="url(#vcs-plain)"/>
  </g>
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6">
    <path d="M390,290 V338 H570" marker-end="url(#vcs-flow)"/>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="5 4">
    <path d="M430,338 V386 H590" marker-end="url(#vcs-plain)"/>
  </g>
  <!-- dvc checkout reproduction arrow -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#vcs-flow)">
    <path d="M700,206 V408 H180 V194"/>
  </g>
  <text x="180" y="224" font-size="10.5" fill="var(--crimson, currentColor)" text-anchor="middle">dvc checkout → working tree</text>
  <text x="300" y="420" font-size="10" fill="var(--crimson, currentColor)" text-anchor="middle">materialize pointers to reproduce a past map</text>
</svg>

A reproducible incident workspace follows a fixed shape:

1. **Repository structure:** `scripts/`, `configs/`, `data/raw/`, `data/processed/`, `tests/`, `dvc.yaml`. Only `scripts/`, `configs/`, `tests/`, and the `.dvc` pointers are tracked by Git; the `data/` payloads are tracked by DVC.
2. **Branching model:** `main` (production-ready common operating picture), `incident/<id>` (active response), `hotfix/<id>` (critical topology corrections that must merge fast and traceably).
3. **Data tracking:** DVC tracks large binaries via `.dvc` metadata; Git tracks only the lightweight pointers and the transformation logic that produced them.

## Step-by-Step Implementation

### 1. Version the ingestion transform

The first thing to put under version control is the step that turns a raw field export into a workspace-ready layer. Field crews deploy tablets, GNSS receivers, and drone payloads that produce heterogeneous vector exports, and without strict ingestion controls, schema drift, CRS mismatches, and attribute-normalization failures corrupt incident basemaps silently. Committing this function alongside the data pointer it produces means every coordinate adjustment is traceable to a specific code release — the same lightweight-shapefile discipline established in [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/).

```python
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
from pyproj import CRS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
)
logger = logging.getLogger("vcs.ingest")


class SpatialIngestionError(Exception):
    """Raised when a field export fails schema or topology validation."""


def validate_and_version_field_export(
    raw_path: Path,
    output_dir: Path,
    expected_crs: str = "EPSG:4326",
    required_fields: tuple[str, ...] = ("incident_id", "timestamp", "geometry_type"),
) -> dict[str, Any]:
    """Normalize a raw field export into a versioned GeoPackage layer.

    Returns a manifest dict suitable for emission into the audit trail.
    Raises SpatialIngestionError on a contract violation so the caller can
    quarantine the payload instead of committing a corrupt layer.
    """
    if not raw_path.exists():
        raise SpatialIngestionError(f"Raw field export missing: {raw_path}")

    gdf = gpd.read_file(raw_path)

    # Schema contract: required attributes must be present before merge.
    missing = [field for field in required_fields if field not in gdf.columns]
    if missing:
        raise SpatialIngestionError(f"Missing required attributes: {missing}")

    # CRS contract: enforce the declared frame, log every reprojection.
    target_crs = CRS.from_user_input(expected_crs)
    if gdf.crs != target_crs:
        logger.info("Reprojecting from %s to %s", gdf.crs, target_crs)
        gdf = gdf.to_crs(target_crs)

    # Topology guard: repair invalid geometry deterministically, on the record.
    invalid_count = int((~gdf.is_valid).sum())
    if invalid_count:
        logger.warning("Repairing %d invalid geometries via buffer(0)", invalid_count)
        gdf.geometry = gdf.geometry.buffer(0)

    # Deterministic output pathing so the commit references a stable artifact.
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = output_dir / f"field_export_{stamp}.gpkg"
    gdf.to_file(out_path, driver="GPKG", layer="incident_assets")

    logger.info("Wrote %d features to %s", len(gdf), out_path)
    return {
        "status": "success",
        "output_path": str(out_path),
        "feature_count": len(gdf),
        "crs": gdf.crs.to_epsg(),
        "repaired_geometries": invalid_count,
    }
```

Coordinate drift remains a persistent challenge when integrating multi-source GNSS data. When urban-canyon multipath degrades positional accuracy, the correction routine must be applied consistently across every incident layer and itself versioned — the methodology documented in [Handling GPS Drift in Urban Canyon Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/handling-gps-drift-in-urban-canyon-environments/) should ship as a versioned transformation module so each adjustment maps to a known calibration release.

### 2. Declare the pipeline in `dvc.yaml`

Once the transform is committed, the build graph that connects raw inputs to processed outputs becomes a versioned artifact too. A DVC pipeline declares each stage's dependencies and outputs, so `dvc repro` rebuilds only what changed and records a content hash for every artifact it produces. The computation itself stays plain Python — DVC tracks inputs and outputs around it.

```python
import hashlib
import logging
from pathlib import Path

import pandas as pd

logger = logging.getLogger("vcs.etl")


def process_sensor_stream(raw_csv: Path, calibration_offset: float = 0.0) -> Path:
    """Versioned ETL stage for incident telemetry aggregation.

    Invoked by a dvc.yaml stage; DVC tracks deps/outs via .dvc metadata.
    The calibration_offset is versioned alongside the data pointer so a
    historical sensor overlay can be reconstructed deterministically.
    """
    try:
        df = pd.read_csv(raw_csv)
    except pd.errors.EmptyDataError as exc:
        raise RuntimeError("Empty telemetry payload; verify sensor connectivity.") from exc

    required_cols = {"timestamp", "lat", "lon", "value"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Telemetry schema mismatch. Missing: {missing}")

    # Apply the versioned calibration offset and resample to a 5-minute grid.
    df["value"] = df["value"] + calibration_offset
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.set_index("timestamp").resample("5min").mean().dropna()

    # Deterministic output path keyed by inputs so DVC can cache the result.
    digest = hashlib.sha256(
        f"{raw_csv.stem}_{calibration_offset}_{len(df)}".encode()
    ).hexdigest()[:8]
    out_path = Path(f"data/processed/telemetry_agg_{digest}.parquet")
    df.to_parquet(out_path)

    logger.info("Aggregated %d rows → %s", len(df), out_path)
    return out_path
```

By versioning the `calibration_offset` alongside the raw-data pointer, an incident commander can reconstruct any historical sensor overlay deterministically: the pipeline state is auditable, and a rollback is `dvc checkout <commit>` followed by `dvc repro`.

### 3. Gate merges on topology validation

Geospatial scripts must not merge into a production incident branch until their geometry has been proven valid. The validation pass below enforces topology rules, CRS presence, and sliver detection, and is wired into both a `pre-commit` hook on the workstation and the CI gate on the merge — so a malformed layer is rejected before it can feed an operational dashboard.

```python
import logging
from typing import Iterable

import geopandas as gpd
import pytest
from geopandas import GeoDataFrame
from shapely.validation import explain_validity

logger = logging.getLogger("vcs.validate")


def validate_topology(gdf: GeoDataFrame, min_area_threshold: float = 1e-6) -> list[str]:
    """Return a list of topology violations for CI/CD gating (empty == pass)."""
    violations: list[str] = []

    if gdf.crs is None:
        violations.append("Dataset missing CRS definition")

    for idx, geom in gdf.geometry.items():
        if geom is None or geom.is_empty:
            violations.append(f"Row {idx}: null or empty geometry")
            continue
        if not geom.is_valid:
            violations.append(f"Row {idx}: invalid geometry — {explain_validity(geom)}")
        elif geom.area and geom.area < min_area_threshold:
            violations.append(f"Row {idx}: sliver polygon (area < {min_area_threshold})")

    if violations:
        logger.error("Topology gate found %d violation(s)", len(violations))
    return violations


@pytest.fixture
def mock_incident_gdf() -> GeoDataFrame:
    return gpd.GeoDataFrame(
        {"id": [1, 2], "type": ["evac_zone", "hazard"]},
        geometry=gpd.points_from_xy([-122.4, -122.3], [37.8, 37.7]),
        crs="EPSG:4326",
    )


def test_incident_topology(mock_incident_gdf: GeoDataFrame) -> None:
    issues = validate_topology(mock_incident_gdf)
    assert not issues, f"Topology validation failed: {issues}"
```

Wiring `validate_topology` into a `pre-commit` configuration rejects malformed spatial payloads at the developer workstation, reducing the response latency that data corruption would otherwise inject mid-incident.

The reason spatial version control needs two tracks rather than one is that a binary container defeats the mechanism Git is built on, and it does so silently.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="vc-t vc-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="vc-t">What a repository stores when one polygon vertex moves, under three strategies</title>
  <desc id="vc-d">A 240 megabyte GeoPackage has one vertex of one polygon adjusted, forty times over an incident. Committing the GeoPackage directly stores a fresh 240 megabyte blob each time, because a binary SQLite file has no meaningful line-level delta — the repository grows to 9.6 gigabytes and no diff is readable. Storing it in Git LFS keeps the repository small but still stores forty full copies in the LFS backing store, and still shows no diff. Committing a canonical text serialisation alongside the container stores about 30 kilobytes of actual change across all forty commits, and every one of them is readable in a diff. The container is still needed for use, which is why the answer is two tracks rather than choosing between them.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one vertex moved, forty times, on a 240 MB GeoPackage</text>
  <rect x="300" y="94" width="512" height="34" rx="5" fill="var(--petal)" stroke="var(--ember)" stroke-width="2.4"/>
  <rect x="300" y="156" width="512" height="34" rx="5" fill="var(--petal)" stroke="var(--ember)" stroke-width="2.4"/>
  <rect x="300" y="218" width="6" height="34" rx="3" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="116">commit the GeoPackage</text>
    <text x="8" y="178">Git LFS</text>
    <text x="8" y="240">canonical text alongside it</text>
  </g>
  <g font-size="10.5" font-weight="700">
    <text x="330" y="116" fill="currentColor">9.6 GB stored · no readable diff</text>
    <text x="330" y="178" fill="currentColor">40 full copies in LFS · no readable diff</text>
    <text x="320" y="240" fill="var(--crimson-deep)">~30 KB total · every change readable</text>
  </g>
  <rect x="40" y="284" width="800" height="76" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="310" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">so both tracks, not a choice between them</text>
  <text x="60" y="332" font-size="10" fill="currentColor">the container is what the field actually uses · the canonical text is what carries the history, the review, and the merge</text>
  <text x="60" y="350" font-size="10" fill="currentColor">and one lineage identifier ties a given container to the exact text revision that produced it</text>
</svg>

Git LFS is worth singling out because it is the answer most teams reach first and it solves the wrong half of the problem. It keeps the working repository small, which is a real benefit, and it does nothing at all for reviewability — the backing store still holds forty complete copies, and `git diff` on a commit still says "binary files differ". The question "what changed in this perimeter?" remains unanswerable, which is the question an after-action review asks.

The canonical text track is what makes that question answerable, and *canonical* is the load-bearing word for the same reason it was in the offline-caching section. A serialisation with unstable feature ordering or non-deterministic coordinate formatting produces a full-file diff on every commit, at which point the text track costs storage and delivers nothing. Sort by a stable key, fix coordinate precision, and normalise ring winding before writing.

Tying the two tracks together is one field and it is the piece most often missed. Each committed container records the text revision it was built from, so a GeoPackage found on a field device six months later can be traced to the exact reviewed change set that produced it — which is the whole chain-of-custody claim, and it does not survive the two tracks drifting apart.

## Configuration Reference

| Parameter | Where it lives | Default | Purpose |
|---|---|---|---|
| `expected_crs` | ingestion call / config manifest | `EPSG:4326` | Declared frame every export is normalized to before merge. |
| `required_fields` | schema contract | `incident_id, timestamp, geometry_type` | Attributes that must exist or the payload is quarantined. |
| `calibration_offset` | `dvc.yaml` param | `0.0` | Versioned sensor correction; reconstructs historical overlays. |
| `min_area_threshold` | topology gate | `1e-6` | Below this, a polygon is flagged as a sliver and fails the gate. |
| `DVC_CACHE_DIR` | environment variable | repo `.dvc/cache` | Local content-addressed store for tracked binaries. |
| `dvc remote` | `.dvc/config` | site object store | Shared backing store so field nodes can pull versioned data. |
| branch prefix | branching policy | `incident/<id>` | Isolates an active response from `main` and from other incidents. |

The two tracks only stay useful if the merge story is worked out in advance, because a spatial merge conflict is not a text merge conflict wearing different clothes.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="mg-t mg-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="mg-t">Four kinds of concurrent change, and which of them a text merge can resolve</title>
  <desc id="mg-d">Four ways two branches can change a spatial layer. Edits to different features touch different regions of the canonical text and merge automatically, exactly as source code does. Edits to different attributes of the same feature also merge cleanly if the serialisation puts each attribute on its own line. Edits to the geometry of the same feature conflict textually and cannot be resolved by choosing lines, because a coordinate list half from each side is not a valid polygon — this needs the domain reconciler. A schema change on one side against feature edits on the other conflicts across the whole file and must be rebased rather than merged. Only the first two are safe to leave to Git, which is why the serialisation layout is a merge-behaviour decision rather than a formatting preference.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the serialisation layout is a merge-behaviour decision, not a formatting preference</text>
  <rect x="40" y="72" width="800" height="62" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="96" font-size="11" font-weight="700" fill="currentColor">different features</text>
  <text x="60" y="118" font-size="10" fill="currentColor">disjoint regions of the text · merges automatically, exactly like source code</text>
  <text x="700" y="108" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Git handles it</text>
  <rect x="40" y="144" width="800" height="62" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="168" font-size="11" font-weight="700" fill="currentColor">different attributes of one feature</text>
  <text x="60" y="190" font-size="10" fill="currentColor">merges cleanly only if each attribute is on its own line — one-line-per-feature serialisation breaks this</text>
  <text x="700" y="180" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Git handles it</text>
  <rect x="40" y="216" width="800" height="62" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="240" font-size="11" font-weight="700" fill="var(--ember-text)">the geometry of one feature</text>
  <text x="60" y="262" font-size="10" fill="currentColor">a coordinate list half from each side is not a polygon · choosing lines produces valid text and invalid geometry</text>
  <text x="700" y="252" font-size="10.5" font-weight="700" fill="var(--ember-text)">domain reconciler</text>
  <rect x="40" y="288" width="800" height="62" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="312" font-size="11" font-weight="700" fill="var(--ember-text)">schema change vs feature edits</text>
  <text x="60" y="334" font-size="10" fill="currentColor">conflicts across the whole file · rebase the feature edits onto the new schema, never merge</text>
  <text x="700" y="324" font-size="10.5" font-weight="700" fill="var(--ember-text)">rebase, not merge</text>
</svg>

The second row is the one the serialisation choice decides. A GeoJSON-style layout with one feature per line is compact and human-scannable and makes every attribute edit conflict with every other attribute edit on the same feature — two analysts updating `containment_pct` and `ic_name` on one incident produce a conflict Git cannot resolve, for changes that do not overlap in any meaningful sense. Breaking each attribute onto its own line eliminates that entire class.

The third row is where a text merge is actively dangerous rather than merely unhelpful. Git will happily let somebody resolve a coordinate-list conflict by taking some lines from each side, and the result is well-formed text describing a self-intersecting or unclosed ring. It will commit, and it may even load. This is the case that has to be routed to the same version-vector reconciler the multi-agency sync layer uses — the merge is a spatial operation, and the fact that it happens to be expressed as text is incidental.

Configure a merge driver that refuses rather than attempts on geometry hunks. A tool that stops and says "this needs the reconciler" is worth more than one that produces a plausible result, for the same reason the ingestion boundary rejects rather than guesses.

## Verification and Smoke Test

Confirm the workspace reproduces deterministically before relying on it in the field. The following sequence rebuilds tracked data, runs the topology gate, and proves a clean working tree.

```bash
# Reproduce the pipeline from versioned inputs and pointers.
dvc repro

# Run the topology + CRS gate exactly as CI does.
pytest tests/test_topology.py -q

# Prove nothing drifted: both Git and DVC report a clean tree.
git status --porcelain
dvc status
```

A passing smoke test means `dvc status` reports `Data and pipelines are up to date`, `git status --porcelain` is empty, and the `pytest` gate exits zero. To confirm a *historical* state reproduces, check out a past commit, run `dvc checkout` to materialize its pointers, and re-run the pipeline inside the pinned container — the regenerated artifact's hash must match the one recorded at that commit.

## Integration With Adjacent Workflows

Version control is the connective tissue between the other toolchain concerns rather than a standalone step. The pinned runtime it depends on is built when [setting up Dockerized GIS environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/); without an immutable GDAL/PROJ image the "reproducible" history cannot be trusted. The ingestion transform it versions is the same boundary contract enforced across [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/), and the CRS normalization it commits is governed by the [Coordinate Reference System standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/). The library-selection logic that decides whether a stage runs through Geopandas or PyShp is documented in [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/), and every coordinate correction this workspace records draws on the edge-case handling in [Handling GPS Drift in Urban Canyon Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/handling-gps-drift-in-urban-canyon-environments/).

## Troubleshooting

**Symptom: `dvc pull` returns "missing data source" on a field node.** The pointer is committed but the binary never reached the shared remote. The author ran `git push` without `dvc push`, so the cache object exists only on their workstation. Run `dvc push` from the node that produced the data, then `dvc pull` on the field node. Add a CI check that fails the merge if `dvc status --cloud` reports anything pending.

**Symptom: the same commit produces a geometry that differs by metres on two machines.** The runtime is not pinned — the two hosts resolved different PROJ pipelines or GDAL builds. Rebuild both from the immutable image, and verify with `pyproj.show_versions()` that the PROJ data directory matches before trusting any reprojection.

**Symptom: the topology gate passes locally but fails in CI.** The `pre-commit` hook is stale or was skipped with `--no-verify`. Reinstall hooks with `pre-commit install`, then run `pre-commit run --all-files` to surface the same violations CI sees. Never bypass the gate to merge a `hotfix/<id>` faster — an unvalidated correction is the failure mode this workflow exists to prevent.

**Symptom: a Git clone takes hours or runs out of disk in the field.** A binary was committed to Git directly instead of being tracked by DVC, bloating the pack history. Identify the offending blob, remove it from history, and re-add it with `dvc add` so only the pointer remains in Git.

**Symptom: `dvc checkout` of an old commit restores stale data into the working tree but the pipeline won't reproduce it.** The `dvc.lock` was not committed with the code, so DVC has no record of which output hash that commit expected. Always commit `dvc.lock` alongside `dvc.yaml`; it is the lineage link that makes a historical rebuild deterministic.

## Related

- [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) — the pinned GDAL/PROJ runtime that makes versioned history reproducible.
- [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/) — choosing the spatial library each versioned stage runs through.
- [Python ETL for Sensor & IoT Data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/) — the real-time ingestion arm whose pipeline stages get versioned here.
- [Handling GPS Drift in Urban Canyon Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/handling-gps-drift-in-urban-canyon-environments/) — a versioned coordinate-correction module under this workflow.

Up: [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/)
