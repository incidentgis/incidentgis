---
title: "Setting Up Dockerized GIS Environments"
description: "Build reproducible Dockerized Python GIS runtimes for emergency response: multi-stage GDAL/PROJ pinning, lockfile-driven dependencies, hardened Compose, and smoke-test verification for incident workflows."
slug: setting-up-dockerized-gis-environments
type: guide
breadcrumb: "Dockerized GIS Environments"
datePublished: "2025-02-11"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Setting Up Dockerized GIS Environments for Emergency Response",
      "description": "Build reproducible Dockerized Python GIS runtimes for emergency response: multi-stage GDAL/PROJ pinning, lockfile-driven dependencies, hardened Compose, and smoke-test verification for incident workflows.",
      "datePublished": "2025-02-11",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Python Toolchains for Public Safety GIS", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/" },
        { "@type": "ListItem", "position": 3, "name": "Setting Up Dockerized GIS Environments", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Build a reproducible Dockerized Python GIS environment for incident response",
      "description": "Pin spatial binaries in a multi-stage image, resolve Python dependencies into a verifiable lockfile, harden the container under CIS and NIST guidance, and prove correct CRS behavior with a startup smoke test.",
      "step": [
        { "@type": "HowToStep", "name": "Pin the spatial base image", "text": "Use a multi-stage Debian/Ubuntu build that pins exact GDAL and PROJ package versions and sets GDAL_DATA and PROJ_LIB explicitly." },
        { "@type": "HowToStep", "name": "Lock the Python toolchain", "text": "Resolve geopandas, shapely, and pyproj into a cryptographically verifiable lockfile with uv or pip-tools, mounted read-only at build time." },
        { "@type": "HowToStep", "name": "Add a startup pre-flight check", "text": "Validate GDAL and PROJ versions and a known EPSG transform before the container launches any incident workflow." },
        { "@type": "HowToStep", "name": "Harden and orchestrate", "text": "Run non-root with a read-only root filesystem, drop all Linux capabilities, set memory and CPU limits, and isolate the network in Docker Compose." },
        { "@type": "HowToStep", "name": "Verify before field deployment", "text": "Run the smoke-test assertions and a CVE scan against the built image so a node is only trusted once its CRS behavior and dependencies are confirmed." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not use Alpine Linux for a GIS container?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Alpine ships musl libc, which frequently breaks precompiled GDAL and PROJ wheels and can introduce silent coordinate-transformation failures. Debian Slim or Ubuntu LTS provide a glibc environment with broader binary compatibility and predictable package lifecycles, which matters when a positional error is an operational hazard rather than a build inconvenience."
          }
        },
        {
          "@type": "Question",
          "name": "How do you guarantee two nodes produce identical geometry?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Pin the GDAL and PROJ apt packages to exact versions, vendor the PROJ grid-shift files offline, resolve Python dependencies into a committed lockfile, and run a startup smoke test that asserts the GDAL/PROJ versions and a known EPSG transform. If any of those drift between a command laptop and an emergency operations center, the pre-flight check fails fast instead of emitting drifted coordinates."
          }
        },
        {
          "@type": "Question",
          "name": "What spatial-specific environment variables must the container set?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Set GDAL_DATA and PROJ_LIB so the runtime resolves CRS definitions deterministically, PROJ_NETWORK=OFF so the container never silently fetches grids over a degraded link, and GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR to keep I/O bounded on slow field storage."
          }
        }
      ]
    }
  ]
}
</script>

# Setting Up Dockerized GIS Environments for Emergency Response

## Problem Framing

A type-3 wildfire incident stands up three compute nodes in the same afternoon: a ruggedized laptop in a mobile command vehicle on a ridgeline, a forward operating base running off a generator, and a regional emergency operations center on hardened fibre. All three run the *same* Python spatial code against the *same* perimeter and damage-assessment datasets, and all three are expected to emit identical geometry. When the laptop was provisioned with `pip install geopandas` against whatever GDAL the host happened to carry, and the operations center was built from a pinned image, the two nodes resolve different PROJ transformation pipelines — and the evacuation polygon lands tens of metres off true position with no exception raised. Containerization is the control that closes that gap: an immutable image pins the spatial binaries, the Python toolchain, and the coordinate-reference-system data so that bit-for-bit reproducible output is a property of the runtime rather than a hope. This guide builds that image, hardens it for tactical deployment, and proves it correct before it is ever trusted with a field product.

## Prerequisites

This pattern is the foundation that the rest of the [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/) stack assumes is already in place. Before applying it, confirm:

- **A glibc base, not musl.** Debian Slim or Ubuntu LTS. Alpine's musl libc breaks precompiled GDAL/PROJ wheels and can corrupt transforms silently.
- **An explicit coordinate reference system (CRS) contract.** Field collection arrives in EPSG:4326 (WGS 84); local analysis runs in a projected UTM zone (EPSG:326xx/327xx); display is EPSG:3857 (Web Mercator) only. The image must vendor the PROJ grid-shift files that back these transforms, consistent with the [Coordinate Reference System standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/).
- **`always_xy=True` discipline.** Any `pyproj.Transformer` constructed inside the container is built with `always_xy=True` so coordinates are consistently (longitude, latitude) and axis-order inversion cannot occur.
- **A lockfile, not a bare `requirements.txt`.** Dependencies are resolved into a cryptographically verifiable lockfile so transitive drift cannot enter during an active deployment.

Spelled out once for this page: NIMS is the National Incident Management System, FEMA is the Federal Emergency Management Agency, OGC is the Open Geospatial Consortium, NIST is the National Institute of Standards and Technology, CIS is the Center for Internet Security, and ISO 22320 is the international standard for emergency-management operations.

## Build Architecture

The image is best understood as two stages joined by a single artifact boundary. The build stage compiles the locked dependency set against pinned development headers; the runtime stage carries only the resolved packages, the matching shared libraries, and the explicit CRS data paths — nothing that could be used to mutate the environment in the field. Every layer below is a contract: pinned apt versions, a read-only lockfile, a non-root user, and a startup gate that refuses to launch a workflow if the spatial binaries are wrong.

<svg viewBox="0 0 880 470" role="img" aria-label="Two-stage Docker build for a reproducible GIS image. Stage one, the builder, runs on Ubuntu LTS with pinned gdal-bin, libgdal-dev and libproj-dev packages and compiles a locked virtual environment from a pyproject lockfile. A single artifact handoff copies the resolved site-packages plus GDAL and PROJ data into stage two, the runtime, a slim Ubuntu image carrying runtime libraries only, with GDAL_DATA and PROJ_LIB set, a non-root gisuser, and a read-only root filesystem. A startup pre-flight smoke test gates the runtime: it asserts the GDAL and PROJ versions and a known EPSG transform, passing the container into service or aborting with a non-zero exit. The whole runtime sits inside a hardened Compose boundary that enforces memory and CPU limits, drops all Linux capabilities, isolates an internal network, mounts config read-only, and mounts data read-write." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Two-stage build and hardened runtime for a reproducible GIS container</title>
  <desc>Stage one is a builder on Ubuntu LTS that installs pinned gdal-bin, libgdal-dev and libproj-dev and compiles a locked virtual environment from the pyproject lockfile. A single artifact handoff copies the resolved site-packages and GDAL/PROJ data into stage two, a slim Ubuntu runtime that keeps runtime libraries only, sets GDAL_DATA and PROJ_LIB, runs as a non-root gisuser, and uses a read-only root filesystem. Before any workflow runs, a CRS-aware pre-flight smoke test asserts the GDAL and PROJ versions and a known EPSG transform; a pass routes the container into service while a failure aborts with a non-zero exit. The runtime is wrapped by a hardened Docker Compose boundary enforcing memory and CPU limits, cap_drop ALL, an internal-only network, a read-only config volume and a read-write data volume.</desc>
  <defs>
    <marker id="docker-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <!-- Compose boundary -->
    <rect x="14" y="150" width="852" height="306" rx="12" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" stroke-dasharray="7 5"/>
    <text x="150" y="172" font-size="11.5" font-weight="700" fill="var(--crimson, currentColor)">Hardened Compose boundary</text>
    <text x="850" y="172" font-size="10" text-anchor="end" fill="var(--crimson, currentColor)">mem 2g · cpus 2 · cap_drop ALL · no-new-privileges</text>
    <!-- Stage 1: builder -->
    <rect x="40" y="40" width="300" height="86" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="190" y="64" font-weight="700">Stage 1 · builder</text>
    <text x="190" y="84" font-size="11">Ubuntu LTS · pinned gdal-bin /</text>
    <text x="190" y="100" font-size="11">libgdal-dev / libproj-dev</text>
    <text x="190" y="118" font-size="10.5" fill="var(--crimson, currentColor)">compiles locked venv ← pyproject lockfile</text>
    <!-- handoff -->
    <text x="440" y="74" font-size="10.5" fill="var(--crimson, currentColor)">COPY --from=builder</text>
    <text x="440" y="90" font-size="10">site-packages + GDAL/PROJ data</text>
    <!-- Stage 2: runtime -->
    <rect x="540" y="40" width="300" height="86" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="690" y="64" font-weight="700">Stage 2 · runtime</text>
    <text x="690" y="84" font-size="11">slim Ubuntu · runtime libs only</text>
    <text x="690" y="100" font-size="10.5">GDAL_DATA · PROJ_LIB · non-root gisuser</text>
    <text x="690" y="118" font-size="10.5" fill="var(--crimson, currentColor)">read-only rootfs</text>
    <!-- pre-flight gate -->
    <rect x="333" y="210" width="214" height="74" rx="8" fill="none" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="440" y="236" font-weight="700">Pre-flight gate</text>
    <text x="440" y="254" font-size="10.5">assert GDAL / PROJ version</text>
    <text x="440" y="270" font-size="10.5">+ known EPSG transform</text>
    <!-- pass -->
    <rect x="333" y="330" width="214" height="58" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="440" y="354" font-weight="700">In service</text>
    <text x="440" y="372" font-size="10.5">runs incident workflow</text>
    <!-- fail -->
    <rect x="620" y="330" width="214" height="58" rx="8" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="727" y="354" font-weight="700">Abort · exit ≠ 0</text>
    <text x="727" y="372" font-size="10.5">orchestrator skips node</text>
    <!-- volumes -->
    <rect x="46" y="210" width="214" height="58" rx="8" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="153" y="234" font-weight="600" font-size="11.5">./config → :ro</text>
    <text x="153" y="252" font-size="10.5">immutable base layer</text>
    <rect x="46" y="290" width="214" height="58" rx="8" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="153" y="314" font-weight="600" font-size="11.5">./data → :rw</text>
    <text x="153" y="332" font-size="10.5">incident products</text>
    <text x="153" y="400" font-size="10.5" fill="var(--crimson, currentColor)">network: internal only</text>
  </g>
  <!-- handoff arrow -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.8" marker-end="url(#docker-flow)">
    <path d="M340,83 H538"/>
  </g>
  <!-- runtime down into gate -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#docker-flow)">
    <path d="M690,126 V190 H440 V208"/>
    <path d="M440,284 V328"/>
    <path d="M260,239 H331"/>
    <path d="M260,319 H331"/>
  </g>
  <!-- fail branch -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#docker-flow)">
    <path d="M547,259 H727 V328"/>
  </g>
  <g font-size="10.5" text-anchor="middle">
    <text x="478" y="320" fill="var(--crimson, currentColor)">pass</text>
    <text x="637" y="280" fill="var(--crimson, currentColor)">fail</text>
  </g>
</svg>

## Step-by-Step Implementation

### Step 1 — Pin the spatial binaries in a multi-stage image

Separate the compilation layer from the runtime layer to minimize attack surface and image footprint. Pin exact `apt` versions of GDAL and PROJ so an upstream point release cannot change transformation behavior mid-incident, and set `GDAL_DATA` and `PROJ_LIB` explicitly so the runtime never falls back to path resolution.

```dockerfile
# Stage 1: Build & dependency resolution
FROM ubuntu:22.04 AS builder
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gdal-bin=3.4.1+dfsg-1build4 \
    libgdal-dev=3.4.1+dfsg-1build4 \
    libproj-dev=8.2.1-1build1 \
    python3-dev python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Stage 2: Runtime execution
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive \
    GDAL_DATA=/usr/share/gdal \
    PROJ_LIB=/usr/share/proj \
    PYTHONUNBUFFERED=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gdal-bin=3.4.1+dfsg-1build4 \
    libproj19=8.2.1-1build1 \
    python3=3.10.6-1~22.04 \
    python3-pip=22.0.2+dfsg-1ubuntu0.4 && \
    useradd -m -s /bin/bash -u 1000 gisuser && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/python3.10/dist-packages /usr/local/lib/python3.10/dist-packages
WORKDIR /opt/incident-gis
USER gisuser
ENTRYPOINT ["python3", "main.py"]
```

### Step 2 — Resolve the Python toolchain into a verifiable lockfile

Relying on `requirements.txt` alone admits transitive dependency drift. Declare direct dependencies in `pyproject.toml` and resolve them with a modern resolver — `uv` or `pip-tools` — into a hash-pinned lockfile that is generated in continuous integration and mounted read-only during the build. Compile wheels inside the container so their application binary interface matches the image's GDAL/PROJ, rather than binding to host packages.

```toml
# pyproject.toml
[project]
name = "incident-gis-pipeline"
version = "2.1.0"
requires-python = ">=3.10"
dependencies = [
    "geopandas==1.0.1",
    "shapely==2.0.6",
    "pyproj==3.7.1",
    "pyogrio==0.9.0",
    "requests==2.32.3",
    "tenacity==9.0.0",
]

[tool.uv]
resolution = "lowest-direct"
```

### Step 3 — Gate startup with a CRS-aware pre-flight check

Missing CRS definitions or a mismatched PROJ/GDAL pair will silently corrupt incident geometry. Validate the spatial binaries *before* any workflow runs, and exit non-zero so an orchestrator never routes traffic to a misconfigured node. This is the runtime equivalent of the build-time pinning above.

```python
import logging
import subprocess
import sys

from pyproj import Transformer
from pyproj.exceptions import ProjError

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("preflight")

EXPECTED_GDAL = "3.4.1"
EXPECTED_PROJ_PREFIX = "8.2"


def verify_spatial_runtime() -> None:
    """Fail fast if GDAL/PROJ versions or a known transform drift from the contract."""
    try:
        gdal_version = subprocess.check_output(
            ["gdal-config", "--version"], text=True, timeout=10
        ).strip()
    except (subprocess.SubprocessError, OSError) as exc:
        logger.error("gdal-config unavailable: %s", exc)
        sys.exit(1)

    if gdal_version != EXPECTED_GDAL:
        logger.error("GDAL drift: expected %s, got %s", EXPECTED_GDAL, gdal_version)
        sys.exit(1)

    try:
        # WGS 84 -> UTM 10N: a fixed point with a known projected answer.
        transformer = Transformer.from_crs("EPSG:4326", "EPSG:32610", always_xy=True)
        easting, northing = transformer.transform(-122.0, 37.0)
    except ProjError as exc:
        logger.error("PROJ transform failed; grid data likely missing: %s", exc)
        sys.exit(1)

    if not (580000 < easting < 600000 and 4090000 < northing < 4110000):
        logger.error("Transform produced drifted coordinates: %.1f, %.1f", easting, northing)
        sys.exit(1)

    logger.info("Spatial runtime verified: GDAL %s, PROJ transform within tolerance", gdal_version)


if __name__ == "__main__":
    verify_spatial_runtime()
```

### Step 4 — Process vector data with explicit memory and CRS guards

Incident mapping frequently runs in bandwidth-constrained or disconnected environments where container memory footprint directly limits operational readiness. The library you reach for matters: as covered in [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/), PyShp carries no GDAL dependency and streams writes at low memory on a constrained tablet, while GeoPandas enables vectorized spatial joins at the cost of RAM. The module below uses GeoPandas for a join-and-validate task on a node that has the memory for it, with explicit CRS validation and graceful degradation for malformed geometry so a single bad feature never halts the pipeline.

```python
import logging
import sys
from pathlib import Path

import geopandas as gpd
from shapely.validation import explain_validity

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("boundaries")


def process_incident_boundaries(
    input_path: str, output_path: str, target_crs: str = "EPSG:3857"
) -> None:
    try:
        gdf = gpd.read_file(input_path)
        logger.info("Loaded %d features from %s", len(gdf), input_path)
    except (OSError, ValueError) as exc:
        logger.error("Failed to read spatial file: %s", exc)
        sys.exit(1)

    if gdf.crs is None:
        logger.warning("Input missing CRS; assuming EPSG:4326 for incident mapping")
        gdf.set_crs("EPSG:4326", inplace=True)

    try:
        gdf = gdf.to_crs(target_crs)
    except (ValueError, RuntimeError) as exc:
        logger.error("CRS transformation failed: %s", exc)
        sys.exit(1)

    invalid_mask = ~gdf.is_valid
    if invalid_mask.any():
        logger.warning("Detected %d invalid geometries; attempting buffer(0) repair", invalid_mask.sum())
        gdf.loc[invalid_mask, "geometry"] = gdf.loc[invalid_mask, "geometry"].buffer(0)
        first_invalid = gdf[invalid_mask].iloc[0]
        logger.warning("Example invalid geometry: %s", explain_validity(first_invalid.geometry))

    try:
        # pyogrio + GPKG keeps the write memory-bounded on low-resource field laptops.
        gdf.to_file(output_path, driver="GPKG", engine="pyogrio")
        logger.info("Exported incident boundaries to %s", output_path)
    except (OSError, RuntimeError) as exc:
        logger.error("Export failed: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    process_incident_boundaries("/data/incidents.geojson", "/data/processed_incidents.gpkg")
```

### Step 5 — Ingest telemetry with fault-tolerant ETL

Situational-awareness platforms depend on continuous ingestion of environmental sensors, drone telemetry, and IoT weather stations, and the network at an incident perimeter is unreliable by definition. The container's ETL must retry with exponential backoff, validate schema and coordinate precision, and write idempotently so a dropped link delays data rather than losing it. The transport contracts this consumer assumes — ordered streams and reconnect handling — are owned by the [Python ETL for Sensor & IoT Data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/) pattern; here the focus is running that ingestion safely *inside* the hardened image.

```python
import logging
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("telemetry")


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((requests.exceptions.RequestException, ValueError)),
    reraise=True,
)
def fetch_sensor_feed(api_url: str, timeout: int = 10) -> dict:
    response = requests.get(api_url, timeout=timeout)
    response.raise_for_status()
    data = response.json()
    if "features" not in data:
        raise ValueError("Invalid sensor payload: missing GeoJSON features array")
    return data


def ingest_telemetry(api_url: str, output_gpkg: str) -> None:
    try:
        raw = fetch_sensor_feed(api_url)
    except (requests.exceptions.RequestException, ValueError) as exc:
        logger.error("Sensor feed ingestion failed after retries: %s", exc)
        return

    try:
        gdf = gpd.GeoDataFrame.from_features(raw["features"])
        if gdf.crs is None:
            gdf.set_crs("EPSG:4326", inplace=True)

        if "timestamp" not in gdf.columns:
            gdf["timestamp"] = datetime.now(timezone.utc).isoformat()
        else:
            gdf["timestamp"] = pd.to_datetime(gdf["timestamp"], errors="coerce")
        gdf.dropna(subset=["timestamp"], inplace=True)

        existing = gpd.read_file(output_gpkg) if Path(output_gpkg).exists() else gpd.GeoDataFrame()
        combined = pd.concat([existing, gdf], ignore_index=True)
        combined.to_file(output_gpkg, driver="GPKG", engine="pyogrio")
        logger.info("Appended %d sensor records to %s", len(gdf), output_gpkg)
    except (ValueError, RuntimeError, OSError) as exc:
        logger.error("Telemetry processing error: %s", exc)


if __name__ == "__main__":
    ingest_telemetry("https://sensors.internal/air-quality", "/data/incident_telemetry.gpkg")
```

### Step 6 — Harden and orchestrate with Compose

Public safety containers must comply with the CIS Docker Benchmark and NIST SP 800-190. Run non-root, enforce a read-only root filesystem, drop all Linux capabilities, restrict network egress, and set memory and CPU limits so a spatial job cannot starve incident-communication services. Mount data volumes `rw` and configuration `ro` so a multi-user command post cannot accidentally overwrite a base layer.

```yaml
# docker-compose.incident.yml
services:
  gis-processor:
    build: .
    mem_limit: 2g
    cpus: 2
    read_only: true
    tmpfs:
      - /tmp
      - /var/tmp
    volumes:
      - ./data:/opt/incident-gis/data:rw
      - ./config:/opt/incident-gis/config:ro
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    environment:
      - GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR
      - PROJ_NETWORK=OFF
    networks:
      - incident_net

networks:
  incident_net:
    driver: bridge
    internal: true
```

## Configuration Reference

These are the load-bearing knobs. Treat the defaults as the contract a node must satisfy before it is trusted with a field product.

| Parameter | Where | Recommended value | Why it matters |
|-----------|-------|-------------------|----------------|
| `GDAL_DATA` | image env | `/usr/share/gdal` | Deterministic resolution of GDAL CRS/driver data; prevents fallback path errors |
| `PROJ_LIB` | image env | `/usr/share/proj` | Points PROJ at the vendored grid-shift files for offline transforms |
| `PROJ_NETWORK` | Compose env | `OFF` | Stops the container silently fetching grids over a degraded link |
| `GDAL_DISABLE_READDIR_ON_OPEN` | Compose env | `EMPTY_DIR` | Bounds I/O on slow field storage |
| `read_only` | Compose | `true` | Immutable root filesystem; mutation only via declared volumes |
| `cap_drop` | Compose | `ALL` | Removes unneeded Linux capabilities (NIST SP 800-190) |
| `mem_limit` / `cpus` | Compose | `2g` / `2` | Prevents a spatial job starving comms services |
| `resolution` | `pyproject.toml` | `lowest-direct` | Reproducible, conservative dependency resolution |
| pinned apt versions | Dockerfile | exact | No GDAL/PROJ point-release drift between nodes |

## Verification and Smoke Test

Treat the image as untrusted until it proves both correct CRS behavior and a clean dependency surface. Run the pre-flight check and a CVE scan against the *built* image, not the source tree.

```bash
# 1. Build the pinned image.
docker compose -f docker-compose.incident.yml build

# 2. Run the CRS-aware pre-flight gate; non-zero exit blocks deployment.
docker compose -f docker-compose.incident.yml run --rm \
  --entrypoint python3 gis-processor preflight.py

# 3. Assert the locked versions actually landed in the runtime layer.
docker compose -f docker-compose.incident.yml run --rm \
  --entrypoint python3 gis-processor - <<'PY'
import geopandas, pyproj
assert geopandas.__version__ == "1.0.1", geopandas.__version__
assert pyproj.__proj_version__.startswith("8.2"), pyproj.__proj_version__
print("toolchain versions verified")
PY

# 4. Scan the built image for CVEs in the spatial binaries before field use.
trivy image incident-gis-pipeline:latest --severity HIGH,CRITICAL
```

A green run means every node built from this image will read the same drivers, resolve the same PROJ pipeline, and produce the same geometry — the reproducibility guarantee the response depends on.

## Integration with Adjacent Workflows

This image is the substrate the rest of the toolchain runs on. The library-selection trade-offs that decide what executes inside it are worked out in [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/), and the streaming ingestion the container hosts is specified by [Python ETL for Sensor & IoT Data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/). Because the image pins datasets by hash, it is only reproducible when paired with the asset-versioning discipline in [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/). The CRS contracts the pre-flight check enforces are defined once in the [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/), and telemetry that must survive a backhaul outage is staged through [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) before replay.

## Troubleshooting

**Symptom: identical code produces different coordinates on two nodes.** Root cause: unpinned GDAL/PROJ — one node pulled a newer apt point release with a changed transformation pipeline. Pin exact `apt` versions in the Dockerfile and let the Step 3 pre-flight gate fail the divergent node before it serves traffic.

**Symptom: `pyproj` raises a missing-grid error in the field but not in the lab.** Root cause: `PROJ_NETWORK` was left on, so the lab silently downloaded grids the disconnected node cannot reach. Set `PROJ_NETWORK=OFF` and vendor the grid-shift files into the image so transforms are fully offline.

**Symptom: the build works locally but the container immediately exits with an import error.** Root cause: wheels compiled against the host's GDAL were copied into an image with a different GDAL ABI. Compile inside the builder stage against the pinned `libgdal-dev` rather than binding to host packages.

**Symptom: the process is OOM-killed mid-write, leaving a truncated GeoPackage.** Root cause: a GeoPandas operation loaded a dataset larger than `mem_limit`. Lower the working set with geometry simplification and lazy reads, or hand the streaming write to PyShp on that tier; the `mem_limit` is doing its job by containing the blast radius.

**Symptom: a CVE scan flags HIGH vulnerabilities in the spatial binaries.** Root cause: the pinned base image has aged past its security baseline. Rebuild against a current LTS point release, re-run the smoke test to confirm the CRS contract still holds, then re-pin — never ship an image that fails Step 4 of the verification above.

## Related

- [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/) — spatial-library selection for the code that runs inside this image
- [Python ETL for Sensor & IoT Data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/) — the ingestion pipeline this container hosts
- [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) — hash-pinned datasets that make the image reproducible
- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) — staging telemetry through a backhaul outage

Up: [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/)
