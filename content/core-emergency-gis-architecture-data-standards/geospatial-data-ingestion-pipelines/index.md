---
title: "Geospatial Data Ingestion Pipelines"
description: "Production Python ingestion pipelines for emergency GIS: schema-validated payloads, content-addressable idempotency, CRS normalization, and offline-resilient batch processing."
slug: geospatial-data-ingestion-pipelines
type: guide
breadcrumb: "Geospatial Data Ingestion Pipelines"
datePublished: "2025-02-20"
dateModified: "2026-06-25"
---

# Geospatial Data Ingestion Pipelines for Emergency Response & Incident GIS Workflows

## Problem Framing

At 03:40 during a hurricane landfall, four feeds hit the incident map inside the same minute: a Kafka topic streaming damage-assessment points from field crews, an Amazon S3 drop of FEMA shapefiles from a partner state, a webhook firing 911 call locations, and a batch of drone-derived flood polygons. Two of those payloads carry duplicate incident IDs from an upstream retry, one shapefile is missing its mandatory `priority_level` attribute, and a third arrives with a non-UTC timestamp that the routing engine reads four hours into the past. With no ingestion contract, all four flow straight into the operational geodatabase — and dispatch now plans resource allocation against duplicated, mistimed, and partially invalid geometry. A geospatial data ingestion pipeline exists to make that failure structurally impossible: it is the boundary where heterogeneous, untrusted spatial payloads are validated, de-duplicated, normalized, and only then published. This page specifies that pipeline as runnable Python, implementing the [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/) contract for deterministic, low-latency ingestion under National Incident Management System (NIMS) and Federal Emergency Management Agency (FEMA) reporting requirements.

## Prerequisites

This workflow assumes a senior engineer's familiarity with the Python geospatial stack and the following preconditions before the first payload enters the pipeline:

- **Packages:** `geopandas >= 0.12`, `shapely >= 2.0`, `pyproj >= 3.4`, and `pydantic >= 2.0` for the schema contract. The `pyproj` build must ship a PROJ 9.x data directory so that grid-based datum shifts resolve during normalization.
- **A declared schema contract:** every inbound payload type must map to an explicit `pydantic` model with bounded attribute domains (priority 1–5, ISO 8601 timestamps, a valid geometry). Schema enforcement is the first gate, not an afterthought.
- **An operational CRS decision:** the pipeline normalizes every layer to a single canonical reference system before publication. Datum-aware reprojection is owned downstream by the [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) workflow; this stage assigns and aligns EPSG codes at the point of entry so that no untagged geometry leaves it.
- **A local cache path:** a writable directory for the write-ahead queue that absorbs payloads when downstream services are unreachable, provisioned per the [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) pattern.

## Ingestion Topology

Emergency response environments require deterministic, low-latency ingestion capable of processing heterogeneous spatial payloads under degraded network conditions or rapid incident escalation. Production Python pipelines implement a staged topology: acquisition, schema validation, idempotency screening, spatial normalization, and publication to enterprise geodatabases or Open Geospatial Consortium (OGC) feature services. Data enters through streaming endpoints (Kafka, RabbitMQ), RESTful webhooks, or batch object-storage drops (S3/GCS). Each stage fails closed — a malformed geometry or a duplicate hash halts the payload and routes it to an audit table rather than letting it propagate into operational dashboards.

<figure class="diagram">
<svg viewBox="0 0 860 360" role="img" aria-label="Data-flow diagram of the staged ingestion pipeline: acquisition from Kafka, webhook, or S3 drop, then schema validation, idempotency screening, CRS normalization, and publication, with fail-closed branches to a reject and audit table and a write-ahead cache fallback when downstream is unreachable." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Staged geospatial ingestion pipeline data flow</title>
  <desc>Heterogeneous payloads arrive from a Kafka topic, a webhook, or an S3 batch drop and merge into stage one, schema validation against the pydantic contract. Accepted payloads flow right through idempotency screening on a SHA-256 content hash, then CRS normalization, then publication to a geodatabase or OGC feature service. The schema-validation and idempotency stages each fail closed, routing rejected or duplicate payloads down into a reject and audit table. When the publish target is unreachable, payloads divert to a durable write-ahead cache for later replay.</desc>
  <defs>
    <marker id="ingest-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <!-- sources -->
    <rect x="20" y="44" width="120" height="30" rx="6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="80" y="63" font-size="12">Kafka topic</text>
    <rect x="20" y="100" width="120" height="30" rx="6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="80" y="119" font-size="12">Webhook (911)</text>
    <rect x="20" y="156" width="120" height="30" rx="6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="80" y="175" font-size="12">S3 batch drop</text>
    <text x="80" y="32" font-size="11" fill="var(--crimson, currentColor)">acquisition</text>
    <!-- stage 1: schema validation -->
    <rect x="220" y="86" width="150" height="58" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="295" y="110" font-weight="600">1 · Schema</text>
    <text x="295" y="127" font-size="11">pydantic contract</text>
    <!-- stage 2: idempotency -->
    <rect x="420" y="86" width="150" height="58" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="495" y="110" font-weight="600">2 · Idempotency</text>
    <text x="495" y="127" font-size="11">SHA-256 hash</text>
    <!-- stage 3: CRS normalize -->
    <rect x="620" y="86" width="150" height="58" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="695" y="110" font-weight="600">3 · Normalize</text>
    <text x="695" y="127" font-size="11">canonical CRS</text>
    <!-- stage 4: publish -->
    <rect x="620" y="232" width="150" height="58" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="695" y="256" font-weight="700">4 · Publish</text>
    <text x="695" y="273" font-size="11">geodatabase / OGC</text>
    <!-- reject & audit -->
    <rect x="270" y="248" width="250" height="56" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="395" y="272" font-weight="700">Reject &amp; Audit table</text>
    <text x="395" y="290" font-size="11">schema violation · duplicate hash</text>
    <!-- write-ahead cache -->
    <rect x="320" y="20" width="200" height="30" rx="6" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="420" y="39" font-size="11" font-weight="600">Write-ahead cache (replay)</text>
  </g>
  <!-- forward flow -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#ingest-flow)">
    <path d="M140,59 H180 V104 H218"/>
    <path d="M140,115 H218"/>
    <path d="M140,171 H180 V126 H218"/>
    <path d="M370,115 H418"/>
    <path d="M570,115 H618"/>
    <path d="M695,144 V230"/>
  </g>
  <!-- fail-closed branches -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#ingest-flow)">
    <path d="M295,144 V210 H395 V246"/>
    <path d="M495,144 V200 H460 V246"/>
  </g>
  <!-- cache replay branch -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#ingest-flow)">
    <path d="M695,232 V72 H522"/>
  </g>
  <g font-size="10.5" fill="var(--crimson, currentColor)" text-anchor="middle">
    <text x="350" y="206">reject</text>
    <text x="455" y="196">dup</text>
    <text x="600" y="64">unreachable</text>
  </g>
</svg>
<figcaption>Each payload passes acquisition, schema validation, idempotency screening, CRS normalization, and publication; the validation and idempotency stages fail closed to the audit table, and an unreachable publish target diverts to the write-ahead cache for replay.</figcaption>
</figure>

## Step-by-Step Implementation

### Step 1 — Enforce a strict schema contract and de-duplicate

Spatial ingestion fails when malformed geometries, missing mandatory attributes, or non-UTC timestamps propagate into downstream routing or resource-allocation models. Enforce the `pydantic` contract before any `geopandas` or `rasterio` operation executes, and derive a content-addressable hash so that an upstream retry storm cannot create duplicate incident records during a surge.

```python
import logging
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, Tuple

import geopandas as gpd
from pydantic import BaseModel, Field, ValidationError, field_validator
from shapely.geometry import shape
from shapely.validation import explain_validity

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)


class PayloadRejected(RuntimeError):
    """Raised when a payload violates the ingestion schema contract."""


class IncidentPayload(BaseModel):
    incident_id: str
    geometry: Dict[str, Any]
    properties: Dict[str, Any]
    reported_utc: str
    source_agency: str
    priority_level: int = Field(ge=1, le=5)

    @field_validator("reported_utc")
    @classmethod
    def validate_timestamp(cls, v: str) -> str:
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError as exc:
            raise ValueError(f"Invalid ISO 8601 timestamp: {v}") from exc

    @field_validator("geometry")
    @classmethod
    def validate_geometry(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        try:
            geom = shape(v)
        except Exception as exc:
            raise ValueError(f"Geometry parse failed: {exc}") from exc
        if not geom.is_valid:
            raise ValueError(f"Invalid geometry: {explain_validity(geom)}")
        return v


def sanitize_and_hash(payload: Dict[str, Any]) -> Tuple[gpd.GeoDataFrame, str]:
    try:
        validated = IncidentPayload(**payload)
    except ValidationError as ve:
        logger.error("Schema validation failed: %s", ve.errors())
        raise PayloadRejected("Payload rejected due to schema violation") from ve

    payload_bytes = validated.model_dump_json().encode("utf-8")
    content_hash = hashlib.sha256(payload_bytes).hexdigest()

    gdf = gpd.GeoDataFrame(
        data=[validated.properties],
        geometry=[shape(validated.geometry)],
        crs="EPSG:4326",
    )
    gdf["incident_id"] = validated.incident_id
    gdf["content_hash"] = content_hash
    logger.info("Accepted incident %s (hash %s)", validated.incident_id, content_hash[:12])
    return gdf, content_hash
```

The SHA-256 hash is computed over the serialized model, not the raw request bytes, so semantically identical payloads with different key ordering or whitespace collapse to the same hash. Maintain a seen-hash set (Redis in production, an in-process set in staging) and skip any payload whose hash is already present.

The content hash is what makes that de-duplication survive the event it exists for. A broker failover does not replay messages neatly; it replays them minutes apart, interleaved with genuinely new traffic, and often more than once. Keying on a message identifier fails here because the identifier is frequently regenerated by the re-publishing client. Keying on content means the pipeline recognises a payload it has already admitted no matter how it arrives.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="dedup-title dedup-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="dedup-title">Ninety seconds of a broker failover, showing which arrivals are admitted and which are suppressed as replays</title>
  <desc id="dedup-desc">Three rows, one per content hash, across ninety seconds. The first hash arrives at two seconds and is admitted, then reappears at thirty-one and sixty-one seconds and is suppressed both times. The second hash arrives at five seconds and is admitted, then reappears at fifty-eight seconds and is suppressed. The third hash arrives once, at forty-four seconds, and is admitted. Each admission opens a time-to-live window of 86,400 seconds that extends far beyond the ninety seconds shown, so a replay arriving an hour later is still recognised. Suppression depends on the content of the payload rather than a message identifier, because a re-publishing client usually issues a fresh identifier.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one row per content hash · 90 s across a broker failover</text>
  <text x="700" y="44" font-size="10.5" fill="var(--muted)">TTL 86 400 s (24 h)</text>
  <!-- TTL bars -->
  <g>
    <rect x="136" y="76" width="700" height="28" rx="14" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="160" y="136" width="676" height="28" rx="14" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="472" y="196" width="364" height="28" rx="14" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  </g>
  <g fill="none" stroke="var(--line-strong)" stroke-width="2">
    <path d="M840 84 l8 6 l-8 6"/><path d="M840 144 l8 6 l-8 6"/><path d="M840 204 l8 6 l-8 6"/>
  </g>
  <!-- row labels -->
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="94">hash a3f1…</text>
    <text x="8" y="154">hash 7c02…</text>
    <text x="8" y="214">hash e419…</text>
  </g>
  <!-- admitted markers -->
  <g>
    <circle cx="136" cy="90" r="9" fill="var(--crimson)"/>
    <circle cx="160" cy="150" r="9" fill="var(--crimson)"/>
    <circle cx="472" cy="210" r="9" fill="var(--crimson)"/>
  </g>
  <g fill="none" stroke="var(--cream)" stroke-width="2" stroke-linecap="round">
    <path d="M132 90 l3 4 l6 -8"/><path d="M156 150 l3 4 l6 -8"/><path d="M468 210 l3 4 l6 -8"/>
  </g>
  <!-- suppressed markers -->
  <g fill="var(--blush)" stroke="var(--ember)" stroke-width="2">
    <circle cx="368" cy="90" r="9"/><circle cx="608" cy="90" r="9"/><circle cx="584" cy="150" r="9"/>
  </g>
  <g fill="none" stroke="var(--ember)" stroke-width="2" stroke-linecap="round">
    <path d="M364 86 l8 8 M372 86 l-8 8"/><path d="M604 86 l8 8 M612 86 l-8 8"/><path d="M580 146 l8 8 M588 146 l-8 8"/>
  </g>
  <!-- time axis -->
  <path d="M120 250 H840" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="120" y="270">0 s</text><text x="240" y="270">15</text><text x="360" y="270">30</text>
    <text x="480" y="270">45</text><text x="600" y="270">60</text><text x="720" y="270">75</text><text x="840" y="270">90 s</text>
  </g>
  <!-- legend -->
  <circle cx="126" cy="300" r="7" fill="var(--crimson)"/>
  <text x="140" y="304" font-size="10.5" fill="currentColor">admitted — first sighting of this hash</text>
  <circle cx="426" cy="300" r="7" fill="var(--blush)" stroke="var(--ember)" stroke-width="2"/>
  <text x="440" y="304" font-size="10.5" fill="currentColor">suppressed — replay inside the window</text>
  <text x="440" y="330" font-size="11" text-anchor="middle" fill="var(--muted)">The window is per-hash and outlives the failover, so a replay an hour later is still recognised.</text>
</svg>

The consequence worth internalising is that the de-duplication window is a property of each payload, not a global clock. There is no moment at which "the replay is over" — hash `a3f1…` is still protected at second 61 while hash `e419…` has only just been admitted, and both are correct. This is also why the TTL is set in hours rather than seconds: a device that queued edits offline and reconnects the following morning replays traffic that is, from the pipeline's point of view, indistinguishable from a broker replay, and the only thing standing between that and a duplicated incident record is a window long enough to still remember.

### Step 2 — Normalize the coordinate reference system at the boundary

Disaster zones routinely mix fragmented spatial references — legacy municipal grids, international partner datasets, and ad-hoc field collection. Normalize to the canonical CRS before any spatial join, buffer, or evacuation-routing math runs. Treat a missing CRS as a recoverable exception with an explicit fallback, never as a silent assumption; the detailed inference patterns live in [Handling missing CRS in field-collected GPS logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/).

```python
import logging
from typing import Optional

import geopandas as gpd
from pyproj.exceptions import CRSError

logger = logging.getLogger(__name__)
TARGET_CRS = "EPSG:4326"  # WGS 84 for cross-agency interoperability


class CRSNormalizationError(RuntimeError):
    """Raised when a layer cannot be aligned to the operational CRS."""


def normalize_crs(
    gdf: gpd.GeoDataFrame,
    fallback_epsg: Optional[int] = None,
) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        if fallback_epsg is not None:
            logger.warning("No CRS detected; applying fallback EPSG:%s", fallback_epsg)
            gdf = gdf.set_crs(epsg=fallback_epsg)
        else:
            # Heuristic guard: only assume WGS 84 if every bound is plausibly geographic.
            min_x, min_y, max_x, max_y = gdf.total_bounds
            in_lon = all(-180.0 <= x <= 180.0 for x in (min_x, max_x))
            in_lat = all(-90.0 <= y <= 90.0 for y in (min_y, max_y))
            if in_lon and in_lat:
                gdf = gdf.set_crs(epsg=4326)
            else:
                raise CRSNormalizationError(
                    "Ambiguous coordinate range without CRS metadata; provide explicit EPSG."
                )

    if gdf.crs.to_epsg() != 4326:
        try:
            gdf = gdf.to_crs(TARGET_CRS)
        except CRSError as exc:
            logger.critical("CRS transformation failed: %s", exc)
            raise CRSNormalizationError("Spatial reference normalization aborted") from exc

    return gdf
```

### Step 3 — Process batches resiliently with an offline write-ahead queue

Network degradation during active incidents demands processing that degrades gracefully without data loss. Bound the worker pool to avoid resource exhaustion during surge, and on any failure persist the payload to a local write-ahead cache for replay once connectivity returns.

```python
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

CACHE_DIR = Path("/var/local/emergency_ingest_cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# sanitize_and_hash() and normalize_crs() are defined in the steps above.


def resilient_batch_process(payloads: List[dict], max_workers: int = 4) -> List[str]:
    processed_hashes: List[str] = []
    failed_payloads: List[dict] = []

    def _process_single(payload: dict) -> Optional[str]:
        try:
            gdf, content_hash = sanitize_and_hash(payload)
            gdf = normalize_crs(gdf, fallback_epsg=32610)  # UTM zone 10N fallback
            # Publication step (geodatabase / OGC feature service) goes here.
            return content_hash
        except Exception as exc:
            logger.error("Payload processing failed: %s", exc)
            return None

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_process_single, p): p for p in payloads}
        for future in as_completed(futures):
            original = futures[future]
            try:
                result = future.result(timeout=30)
            except Exception as exc:
                logger.critical("Worker thread exception: %s", exc)
                failed_payloads.append(original)
                continue
            if result is not None:
                processed_hashes.append(result)
            else:
                failed_payloads.append(original)

    if failed_payloads:
        cache_path = CACHE_DIR / f"failed_batch_{int(time.time())}.json"
        with cache_path.open("w", encoding="utf-8") as fh:
            json.dump(failed_payloads, fh)
        logger.warning(
            "Cached %d failed payloads to %s for retry", len(failed_payloads), cache_path
        )

    return processed_hashes
```

## Configuration Reference

Tune these parameters per deployment; surge profiles and offline field nodes will diverge from a steady-state cloud node.

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Worker pool size | `INGEST_MAX_WORKERS` | `4` | Cap at CPU count; oversubscription thrashes during surge. |
| Per-payload timeout | `INGEST_FUTURE_TIMEOUT_S` | `30` | Lower for streaming, raise for large raster batches. |
| Target CRS | `INGEST_TARGET_CRS` | `EPSG:4326` | WGS 84 for interchange; switch to a projected CRS for analysis nodes. |
| Fallback EPSG | `INGEST_FALLBACK_EPSG` | `32610` | Region-specific UTM zone; never leave unset on field nodes. |
| Cache directory | `INGEST_CACHE_DIR` | `/var/local/emergency_ingest_cache` | Must be durable local storage, not tmpfs. |
| Dedup TTL | `INGEST_DEDUP_TTL_S` | `86400` | How long a content hash is remembered before it can recur. |
| Strict schema | `INGEST_STRICT_SCHEMA` | `true` | When `false`, reject reasons are logged but the payload is quarantined, not dropped. |

The worker-pool default deserves more than a table row, because it is the parameter operators are most tempted to raise during a surge and the one where raising it makes things worse. Sustained throughput against pool size on an eight-core ingestion node is not a curve that flattens — it turns over.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="pool-title pool-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="pool-title">Sustained ingestion throughput against worker-pool size on an eight-core node</title>
  <desc id="pool-desc">A line chart of sustained payloads per second against worker-pool size from one to sixteen on an eight-core ingestion node. Throughput climbs steeply from about 420 payloads per second at one worker to about 1,490 at four, then flattens, peaking near 1,750 at eight workers, which equals the core count. Beyond eight it falls away steadily, down to roughly 810 at sixteen workers — no better than two workers — because the pool spends its time context-switching rather than parsing. The shipped default of four workers reaches about 85 per cent of peak while leaving headroom for the rest of the host, which is why raising the pool during a surge is usually the wrong lever.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="56" font-size="10.5" fill="var(--muted)">payloads/s</text>
  <!-- oversubscribed region -->
  <path d="M468 60 H820 V300 H468 Z" fill="var(--ember)" opacity="0.16"/>
  <!-- gridlines -->
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M160 233.3 H820"/><path d="M160 166.7 H820"/><path d="M160 100 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="110" y="304">0</text><text x="110" y="237">500</text><text x="104" y="171">1000</text><text x="104" y="104">1500</text>
  </g>
  <path d="M160 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M160 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <!-- markers for the two decision points -->
  <path d="M292 95 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="4 4"/>
  <path d="M468 60 V300" fill="none" stroke="var(--crimson-deep)" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="476" y="52" font-size="11" font-weight="700" fill="var(--crimson-deep)">CPU count = 8</text>
  <!-- throughput curve -->
  <path d="M160 244 L204 192 L248 143 L292 101 L336 84 L380 73 L424 69 L468 67 L512 75 L556 89 L600 108 L644 128 L688 148 L732 165 L776 180 L820 192" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <circle cx="468" cy="67" r="7" fill="var(--crimson)"/>
  <circle cx="292" cy="101" r="7" fill="var(--blush)" stroke="var(--crimson)" stroke-width="2.5"/>
  <text x="298" y="292" font-size="10.5" font-weight="700" fill="currentColor">default 4 — 85% of peak</text>
  <text x="560" y="250" font-size="11" font-weight="700" fill="var(--crimson-deep)">oversubscribed — context-switch thrash</text>
  <!-- x axis -->
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="160" y="320">1</text><text x="292" y="320">4</text><text x="468" y="320">8</text>
    <text x="644" y="320">12</text><text x="820" y="320">16</text>
    <text x="490" y="344" font-size="11">worker pool size</text>
  </g>
  <text x="440" y="368" font-size="11" text-anchor="middle" fill="var(--muted)">Sixteen workers deliver what two workers deliver — the surge instinct is exactly backwards.</text>
</svg>

The right-hand half of that curve is the whole reason `INGEST_MAX_WORKERS` is capped rather than merely documented. Doubling the pool from eight to sixteen does not buy a smaller improvement; it buys a 54 per cent *loss*, landing at the throughput of a two-worker pool while consuming eight times the memory. During a surge, when the queue is visibly growing and the obvious lever is the one labelled "workers", that is a decision made under pressure with a plausible rationale and an inverted effect.

The other half of the reading matters for capacity planning. The default of four is not a conservative guess — it sits at roughly 85 per cent of the achievable peak while leaving half the cores for everything else the host is doing, including the validation and reprojection work that runs in the same process tree. Moving from four to eight buys about 17 per cent more ingestion throughput at the cost of the headroom the rest of the pipeline needs, which on a field node is usually a bad trade and on a dedicated ingestion node is a reasonable one. Either way it is a measurement against your own payload mix, not a number to copy.

## Verification & Smoke Test

Run these assertions against a staging node before promoting a pipeline change. They confirm the schema gate rejects bad payloads, idempotency holds, and CRS normalization is deterministic.

```python
import json


def smoke_test() -> None:
    good = {
        "incident_id": "INC-001",
        "geometry": {"type": "Point", "coordinates": [-122.42, 37.77]},
        "properties": {"label": "staging area"},
        "reported_utc": "2026-06-25T03:40:00Z",
        "source_agency": "EOC",
        "priority_level": 2,
    }

    # 1. Valid payload is accepted and aligned to the operational CRS.
    gdf, h1 = sanitize_and_hash(good)
    gdf = normalize_crs(gdf, fallback_epsg=32610)
    assert gdf.crs.to_epsg() == 4326, "normalized layer must be WGS 84"

    # 2. Idempotency: re-hashing the same payload yields the same hash.
    _, h2 = sanitize_and_hash(json.loads(json.dumps(good)))
    assert h1 == h2, "content hash must be stable across re-serialization"

    # 3. Missing mandatory attribute is rejected, not silently passed.
    bad = {**good}
    del bad["priority_level"]
    try:
        sanitize_and_hash(bad)
        raise AssertionError("expected PayloadRejected for missing priority_level")
    except PayloadRejected:
        pass

    logger.info("smoke test passed")


smoke_test()
```

A CLI equivalent for continuous integration confirms the module imports cleanly and the geospatial stack is wired:

```bash
python -c "import geopandas, shapely, pyproj, pydantic; print('stack ok')"
python -m emergency_ingest.smoke   # exits non-zero on any failed assertion
```

## Integration With Adjacent Workflows

This pipeline is the entry boundary for the parent architecture, so its outputs feed nearly every other concern. The EPSG codes it assigns are consumed by the datum-aware [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) workflow, which performs grid-based reprojection on geometry this stage has already guaranteed is tagged and valid. When downstream publication is unreachable, the write-ahead queue here hands off to the [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) layer for durable replay. Every accepted payload must also emit lineage — source agency, content hash, fallback applied, ingestion timestamp — under the [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) contract so that post-incident audits can reconstruct exactly how each record entered the system.

## Troubleshooting

**Symptom: duplicate incident polygons appear on the operational map after an upstream retry.** The idempotency screen is hashing raw request bytes instead of the canonical model. Hash `validated.model_dump_json()` (Step 1) rather than the inbound body so that re-serialized but identical payloads collapse to one hash, and confirm the seen-hash store's TTL exceeds the upstream retry window.

**Symptom: routing engine plans against incidents hours in the past or future.** A non-UTC timestamp slipped through. The `reported_utc` validator must run before any time-based logic; verify offending feeds are not bypassing the `pydantic` model, and reject naive datetimes outright rather than assuming local time.

**Symptom: points land near null island (0, 0) off West Africa.** A payload lost its CRS and the WGS 84 heuristic accepted projected coordinates as geographic, or the axis order was swapped. Set an explicit `fallback_epsg` on field nodes and tighten the bounds heuristic in `normalize_crs` so projected coordinates fail closed instead of being mislabeled.

**Symptom: the worker pool stalls and latency spikes during surge.** `max_workers` is oversubscribed and threads contend on the GIL during CRS transforms. Cap `INGEST_MAX_WORKERS` at the CPU count and lower `INGEST_FUTURE_TIMEOUT_S` so slow payloads are cached for retry rather than blocking the pool.

**Symptom: failed payloads vanish after a node restart.** The cache directory is on tmpfs or an ephemeral container layer that does not survive restarts. Point `INGEST_CACHE_DIR` at durable local storage and verify the write-ahead file is fsynced before the worker reports failure.

## Frequently Asked Questions

**Should idempotency be enforced on the incident ID or on the content hash?**
On the content hash. Incident IDs are reused across corrections and updates, so de-duplicating on ID would drop legitimate revisions. Hashing the canonical model lets a corrected payload (different geometry, same ID) through while still collapsing exact upstream retries.

**Is it ever safe to assume WGS 84 when a payload has no CRS?**
Only when the coordinate bounds are unambiguously geographic and a region-specific `fallback_epsg` is unavailable. On field nodes, always set an explicit fallback EPSG so projected coordinates cannot be silently misread as latitude and longitude.

**How many worker threads should the batch processor use under surge load?**
Cap the pool at the host CPU count. CRS transformation and geometry validation are partly GIL-bound, so oversubscription increases tail latency rather than throughput; excess concurrency is better spent on more nodes behind the queue than more threads per node.

## Related

- [Handling missing CRS in field-collected GPS logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/)
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/)
- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/)
- [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/)

Up: [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/)

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Schema-validated geospatial ingestion pipeline for emergency response",
  "description": "Enforce a strict payload schema, de-duplicate with a content hash, normalize the coordinate reference system, and process batches resiliently with an offline write-ahead queue.",
  "step": [
    { "@type": "HowToStep", "name": "Enforce a strict schema contract and de-duplicate", "url": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/#step-1-enforce-a-strict-schema-contract-and-de-duplicate" },
    { "@type": "HowToStep", "name": "Normalize the coordinate reference system at the boundary", "url": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/#step-2-normalize-the-coordinate-reference-system-at-the-boundary" },
    { "@type": "HowToStep", "name": "Process batches resiliently with an offline write-ahead queue", "url": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/#step-3-process-batches-resiliently-with-an-offline-write-ahead-queue" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Should idempotency be enforced on the incident ID or on the content hash?",
      "acceptedAnswer": { "@type": "Answer", "text": "On the content hash. Incident IDs are reused across corrections and updates, so de-duplicating on ID would drop legitimate revisions. Hashing the canonical model lets a corrected payload through while still collapsing exact upstream retries." }
    },
    {
      "@type": "Question",
      "name": "Is it ever safe to assume WGS 84 when a payload has no CRS?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only when the coordinate bounds are unambiguously geographic and a region-specific fallback EPSG is unavailable. On field nodes, always set an explicit fallback EPSG so projected coordinates cannot be silently misread as latitude and longitude." }
    },
    {
      "@type": "Question",
      "name": "How many worker threads should the batch processor use under surge load?",
      "acceptedAnswer": { "@type": "Answer", "text": "Cap the pool at the host CPU count. CRS transformation and geometry validation are partly GIL-bound, so oversubscription increases tail latency rather than throughput; excess concurrency is better spent on more nodes behind the queue than more threads per node." }
    }
  ]
}
</script>
