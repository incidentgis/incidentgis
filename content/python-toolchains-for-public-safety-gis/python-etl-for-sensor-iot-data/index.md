---
title: "Python ETL for Sensor & IoT Data"
description: "Production Python ETL for emergency-response IoT telemetry: async MQTT/HTTP ingestion, Pydantic schema validation, CRS-correct spatial transformation, dead-letter recovery, and audit-grade logging for incident GIS."
slug: python-etl-for-sensor-iot-data
type: guide
breadcrumb: "Sensor & IoT ETL"
datePublished: "2025-02-18"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Python ETL for Sensor & IoT Data in Emergency Response GIS",
      "description": "Production Python ETL for emergency-response IoT telemetry: async MQTT/HTTP ingestion, Pydantic schema validation, CRS-correct spatial transformation, dead-letter recovery, and audit-grade logging for incident GIS.",
      "datePublished": "2025-02-18",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Python Toolchains for Public Safety GIS", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/" },
        { "@type": "ListItem", "position": 3, "name": "Python ETL for Sensor & IoT Data", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Build a Python ETL pipeline for emergency-response IoT sensor data",
      "description": "Ingest IoT telemetry over MQTT/HTTP, validate it against a Pydantic schema, transform coordinates into a metric CRS, route failures to a dead-letter queue, and emit an immutable audit trail.",
      "step": [
        { "@type": "HowToStep", "name": "Establish the ingestion contract", "text": "Define a Pydantic payload model that enforces coordinate bounds, UTC timestamps, and CRS metadata before any record enters the pipeline." },
        { "@type": "HowToStep", "name": "Ingest asynchronously with backpressure", "text": "Consume MQTT and HTTP streams with asyncio, bounding concurrency with a semaphore so surge load cannot exhaust workers." },
        { "@type": "HowToStep", "name": "Validate and quarantine", "text": "Reject malformed payloads to a dead-letter queue instead of crashing the consumer, preserving the raw bytes for replay." },
        { "@type": "HowToStep", "name": "Transform to a metric CRS", "text": "Reproject WGS 84 points to the operational UTM zone, attach jurisdiction via spatial join, and buffer hazard radii in metres." },
        { "@type": "HowToStep", "name": "Load and audit", "text": "Write reconciled features to the spatial store inside a single transaction and emit an audit record capturing the source, transform, and outcome." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why validate IoT payloads with Pydantic before they enter the pipeline?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Field sensors emit malformed JSON, out-of-range coordinates, and missing CRS metadata. Enforcing a Pydantic model at the ingestion boundary turns a silent topology corruption downstream into an explicit, quarantinable validation error that can be replayed once the device is fixed."
          }
        },
        {
          "@type": "Question",
          "name": "Can sensor coordinates be buffered for proximity alerts in EPSG:4326?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No. A buffer distance in EPSG:4326 is in degrees, not metres, so a 500 m hazard radius would be wildly wrong and latitude-dependent. Reproject to the operational UTM zone first, buffer in metres, then convert back for display only."
          }
        },
        {
          "@type": "Question",
          "name": "What happens to telemetry when the cellular or satellite link drops mid-incident?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The consumer applies retry with exponential backoff and routes records it still cannot process to a dead-letter queue keyed by device. When connectivity returns the queue is replayed, so no reading is lost — degraded transport delays data rather than discarding it."
          }
        }
      ]
    }
  ]
}
</script>

# Python ETL for Sensor & IoT Data in Emergency Response GIS

At 03:10 during a wildland-urban-interface incident, a ridge-line weather station starts reporting a wind shift that will push the fire toward an evacuation corridor. The reading travels over a saturated cellular link as a truncated MQTT payload with a null timestamp and a longitude written before its latitude. If the ingestion service trusts that payload, the station's hazard buffer lands in the wrong census block, the corridor alert never fires, and the gap surfaces only in the after-action review. This workflow exists to prevent exactly that: a deterministic extract-transform-load (ETL) path that converts high-velocity, frequently-malformed IoT telemetry into coordinate-correct, audit-traceable spatial features, and quarantines anything it cannot trust rather than guessing. It is the real-time ingestion arm of the broader [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/), and it honours the same reproducibility contract every node in an incident must satisfy.

## Prerequisites

This pattern reconciles and projects sensor deltas; it assumes the transport and the spatial contracts below are already in place.

- **Python packages:** `pydantic >= 2.5` (for `model_validate` and field constraints), `aiohttp >= 3.9` and `paho-mqtt >= 2.0` for async ingestion, `geopandas >= 0.14`, `shapely >= 2.0`, and `pyproj >= 3.6`. The standard-library `asyncio`, `sqlite3`, and `logging` modules carry the orchestration, dead-letter store, and audit trail.
- **CRS contract:** every payload is stored in EPSG:4326 (WGS 84) and reprojected to the operational projected CRS — an appropriate UTM zone (EPSG:326xx / 327xx) — before any distance, area, or buffer is computed. `pyproj` transforms must run with `always_xy=True` so a lat/lon device never inverts axis order. The canonical rules live in the [Coordinate Reference System standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/).
- **Upstream pipeline:** transport buffering, ordering, and replay are owned by [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/); this ETL consumes from that queue. The generic ingestion contract it extends is described in [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/).
- **Schema contract:** every reading carries a stable `device_id`, a bounded `latitude`/`longitude`, a `reading_type`, a `reading_value`, and a UTC `observed_at`. Records missing the contract are quarantined, never coerced.

## Pipeline Architecture

The pipeline runs as four stateless stages — extract, validate, transform, load — so it can be containerized and scaled horizontally behind the feed queue. Each stage has one job and one failure mode, which keeps the audit trail readable: a record is either valid and projected, or quarantined with a reason. Standards alignment is enforced at the boundary, not retrofitted: the Open Geospatial Consortium (OGC) SensorThings observation shape is normalized on ingest, and Common Alerting Protocol (CAP) fields are preserved through the transform so a downstream alert can be emitted without a second parse.

<svg viewBox="0 0 880 282" role="img" aria-label="Data-flow diagram of the four-stage IoT ETL pipeline: heterogeneous sensor sources feed a semaphore-bounded async extract stage with a retry-and-backoff loop, then Pydantic validation branches valid records into CRS transform and load while invalid records route to a device-keyed dead-letter queue that replays on reconnect." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Four-stage IoT sensor ETL data flow</title>
  <desc>Four IoT source types — weather stations, air-quality monitors, mobile CAD GPS, and UAV telemetry — enter a semaphore-bounded MQTT/HTTP extract stage that carries a retry-with-backoff loop for degraded links. Records pass to Pydantic validation, which branches: valid payloads flow right through CRS transform (reproject EPSG:4326 to UTM, spatial join to jurisdiction, buffer hazard radii in metres) into an atomic load to PostGIS or GeoPackage with an audit log; invalid payloads drop into a dead-letter queue keyed by device id that replays on reconnect.</desc>
  <defs>
    <marker id="etl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <!-- flow connectors -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#etl-arrow)">
    <path d="M170,96 H214"/>
    <path d="M362,96 H406"/>
    <path d="M554,90 H600 V56 H636"/>
    <path d="M480,144 V176"/>
  </g>
  <!-- valid / invalid branch labels -->
  <g font-size="11.5" text-anchor="middle" fill="var(--crimson, currentColor)">
    <text x="606" y="44">valid</text>
    <text x="510" y="166" text-anchor="start">invalid</text>
  </g>
  <!-- retry/backoff self-loop on extract -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#etl-arrow)">
    <path d="M236,144 C236,178 332,178 332,148"/>
  </g>
  <text x="284" y="194" font-size="11" text-anchor="middle" fill="var(--crimson, currentColor)">retry · exp. backoff</text>
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <!-- sources -->
    <rect x="20" y="36" width="150" height="120" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="95" y="56" font-weight="600" font-size="12">IoT sources</text>
    <text x="95" y="80" font-size="11">weather stations</text>
    <text x="95" y="98" font-size="11">air-quality monitors</text>
    <text x="95" y="116" font-size="11">mobile CAD GPS</text>
    <text x="95" y="134" font-size="11">UAV telemetry</text>
    <!-- extract -->
    <rect x="214" y="68" width="148" height="76" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="288" y="92" font-weight="600">1 · Extract</text>
    <text x="288" y="110" font-size="11">async MQTT / HTTP</text>
    <text x="288" y="127" font-size="11">semaphore-bounded</text>
    <!-- validate -->
    <rect x="406" y="68" width="148" height="76" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="480" y="92" font-weight="600">2 · Validate</text>
    <text x="480" y="110" font-size="11">Pydantic contract</text>
    <text x="480" y="127" font-size="11">bounds · UTC · CRS</text>
    <!-- transform -->
    <rect x="636" y="20" width="224" height="80" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="748" y="42" font-weight="600">3 · Transform</text>
    <text x="748" y="60" font-size="11">EPSG:4326 &#8594; UTM reproject</text>
    <text x="748" y="76" font-size="11">spatial join &#183; jurisdiction</text>
    <text x="748" y="92" font-size="11">buffer hazard radius (m)</text>
    <!-- load -->
    <rect x="636" y="180" width="224" height="80" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="748" y="202" font-weight="700">4 · Load + Audit</text>
    <text x="748" y="220" font-size="11">PostGIS / GeoPackage</text>
    <text x="748" y="236" font-size="11">single transaction</text>
    <text x="748" y="252" font-size="11">immutable audit row</text>
    <!-- dead-letter queue -->
    <rect x="406" y="180" width="148" height="80" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="480" y="204" font-weight="700" font-size="12">Dead-letter</text>
    <text x="480" y="221" font-size="11">keyed by device_id</text>
    <text x="480" y="238" font-size="11">raw bytes preserved</text>
    <text x="480" y="254" font-size="11">replay on reconnect</text>
  </g>
  <!-- transform -> load connector -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#etl-arrow)">
    <path d="M748,100 V176"/>
  </g>
  <!-- dead-letter replay back to extract -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#etl-arrow)">
    <path d="M406,236 H250 V148"/>
  </g>
  <text x="330" y="252" font-size="11" text-anchor="middle" fill="var(--crimson, currentColor)">replay on reconnect</text>
</svg>

## Step-by-Step Implementation

### 1. Define the ingestion contract

The pipeline's first guarantee is that nothing untyped flows past the boundary. The Pydantic model encodes the schema contract — coordinate bounds, an enumerated reading type, and a timezone-aware timestamp — so a malformed payload fails loudly here instead of corrupting a spatial join three stages later.

```python
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
)
logger = logging.getLogger("etl.contract")


class ReadingType(str, Enum):
    WIND_SPEED = "wind_speed"
    AIR_QUALITY = "air_quality"
    WATER_LEVEL = "water_level"
    TEMPERATURE = "temperature"


class SensorPayload(BaseModel):
    """The ingestion contract. Every field is mandatory and bounded."""

    device_id: str = Field(min_length=1)
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    reading_type: ReadingType
    reading_value: float
    observed_at: datetime
    crs: str = "EPSG:4326"

    @field_validator("observed_at")
    @classmethod
    def enforce_utc(cls, value: datetime) -> datetime:
        """Reject naive timestamps and normalise everything to UTC."""
        if value.tzinfo is None:
            raise ValueError("observed_at must be timezone-aware")
        return value.astimezone(timezone.utc)


def validate_payload(raw: dict[str, Any]) -> SensorPayload | None:
    """Validate a raw record; return None (and log) instead of raising on failure."""
    try:
        return SensorPayload.model_validate(raw)
    except Exception as exc:  # pydantic.ValidationError and malformed input
        logger.warning("Payload rejected at boundary: %s", exc)
        return None
```

### 2. Ingest asynchronously with bounded concurrency

IoT telemetry arrives faster than it can be projected, and a surge event must not exhaust the worker pool. The extract stage consumes both HTTP and MQTT sources under an `asyncio.Semaphore` that caps in-flight work, with exponential backoff so a degraded link delays a reading rather than dropping it.

```python
import asyncio

import aiohttp

logger = logging.getLogger("etl.extract")


async def fetch_with_backoff(
    url: str,
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    *,
    max_attempts: int = 4,
) -> dict[str, Any] | None:
    """Fetch one endpoint, retrying transient transport failures with backoff."""
    async with sem:  # bound concurrency so surge load cannot exhaust the pool
        for attempt in range(1, max_attempts + 1):
            try:
                timeout = aiohttp.ClientTimeout(total=5)
                async with session.get(url, timeout=timeout) as response:
                    response.raise_for_status()
                    return await response.json()
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                wait = 2 ** (attempt - 1)
                logger.warning(
                    "Transport failure (%s) on %s, attempt %d/%d; retry in %ds",
                    exc, url, attempt, max_attempts, wait,
                )
                await asyncio.sleep(wait)
    logger.error("Endpoint exhausted retries, deferring to dead-letter: %s", url)
    return None


async def extract_batch(urls: list[str], concurrency: int = 32) -> list[dict[str, Any]]:
    """Pull a batch of endpoints concurrently and drop exhausted ones."""
    sem = asyncio.Semaphore(concurrency)
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_with_backoff(u, session, sem) for u in urls]
        results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]
```

### 3. Quarantine what fails the contract

A record that cannot be validated is not discarded — its raw bytes are written to a dead-letter queue keyed by `device_id` so it can be replayed once the device firmware or the link is fixed. This is what makes the pipeline safe to leave unattended during an active incident.

```python
import json
import sqlite3

logger = logging.getLogger("etl.deadletter")


def init_dead_letter(conn: sqlite3.Connection) -> None:
    """Create the quarantine table if absent."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dead_letter (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT,
            raw_payload TEXT NOT NULL,
            reason TEXT NOT NULL,
            quarantined_at TEXT NOT NULL
        )
        """
    )


def quarantine(conn: sqlite3.Connection, raw: dict[str, Any], reason: str) -> None:
    """Persist a rejected payload for later replay; never lose the bytes."""
    try:
        with conn:  # atomic insert
            conn.execute(
                "INSERT INTO dead_letter (device_id, raw_payload, reason, quarantined_at)"
                " VALUES (?, ?, ?, ?)",
                (
                    str(raw.get("device_id", "unknown")),
                    json.dumps(raw, default=str),
                    reason,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        logger.info("Quarantined payload from %s: %s", raw.get("device_id"), reason)
    except sqlite3.Error as exc:
        logger.critical("Dead-letter write failed; payload at risk: %s", exc)
        raise
```

### 4. Transform to a metric CRS and attach jurisdiction

Only validated payloads reach the transform. Coordinates are reprojected from EPSG:4326 to the operational UTM zone before any metric work, joined to jurisdictional boundaries so an alert can be routed, and buffered in metres for the hazard radius. Computing the buffer in degrees is the single most common positional bug in field ETL, so the reprojection is mandatory and explicit.

```python
import geopandas as gpd
from shapely.geometry import Point

logger = logging.getLogger("etl.transform")


def transform_to_incident_layer(
    payloads: list[SensorPayload],
    jurisdictions: gpd.GeoDataFrame,
    *,
    target_epsg: int = 26910,   # UTM Zone 10N — set per operational area
    hazard_radius_m: float = 500.0,
) -> gpd.GeoDataFrame:
    """Project validated readings, attach jurisdiction, and buffer hazard radii in metres."""
    if not payloads:
        return gpd.GeoDataFrame()

    records = [p.model_dump() for p in payloads]
    geometry = [Point(p.longitude, p.latitude) for p in payloads]

    # Build in the storage CRS, then reproject for all metric operations.
    sensors = gpd.GeoDataFrame(records, geometry=geometry, crs="EPSG:4326")
    sensors = sensors.to_crs(epsg=target_epsg)

    if jurisdictions.crs is None or jurisdictions.crs.to_epsg() != target_epsg:
        jurisdictions = jurisdictions.to_crs(epsg=target_epsg)

    joined = gpd.sjoin(sensors, jurisdictions, how="left", predicate="within")

    unmatched = int(joined["index_right"].isna().sum())
    if unmatched:
        logger.warning("%d reading(s) fell outside all jurisdiction polygons", unmatched)

    # Buffer in metres — valid only because we are in a projected CRS.
    joined["hazard_buffer"] = joined.geometry.buffer(hazard_radius_m)
    return joined
```

### 5. Load inside a transaction and emit the audit trail

The load stage writes the reconciled feature and an immutable audit record in one transaction, so a mid-write failure can never leave a feature persisted without its provenance. The audit row captures the source device, the transform applied, and the outcome — the chain of custody an after-action review depends on.

```python
logger = logging.getLogger("etl.load")


def init_audit(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS etl_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            target_epsg INTEGER NOT NULL,
            jurisdiction_id TEXT,
            outcome TEXT NOT NULL,
            committed_at TEXT NOT NULL
        )
        """
    )


def load_and_audit(
    conn: sqlite3.Connection,
    feature: dict[str, Any],
    target_epsg: int,
) -> None:
    """Persist one feature and its audit record atomically."""
    try:
        with conn:  # both writes commit or roll back together
            conn.execute(
                "INSERT OR REPLACE INTO incident_features"
                " (device_id, observed_at, geom_wkt) VALUES (?, ?, ?)",
                (feature["device_id"], feature["observed_at"], feature["geom_wkt"]),
            )
            conn.execute(
                "INSERT INTO etl_audit"
                " (device_id, observed_at, target_epsg, jurisdiction_id, outcome, committed_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    feature["device_id"],
                    feature["observed_at"],
                    target_epsg,
                    feature.get("jurisdiction_id"),
                    "loaded",
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        logger.info("Loaded reading from %s", feature["device_id"])
    except sqlite3.Error as exc:
        logger.critical("Load transaction failed for %s: %s", feature["device_id"], exc)
        raise
```

Sensor-derived coordinates also arrive as unstructured location text — a station label, a cross-street, a milepost. Normalising that into authoritative addressing is a workflow of its own; see [Automating address standardization for 911 logs](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/automating-address-standardization-for-911-logs/) for the deterministic parsing path into Next Generation 911 (NG911) routing tables and parcel datasets.

Sensor ETL differs from ordinary ETL in one respect that shapes every design decision downstream: the data arrives late, out of order, and indefinitely.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="lt-t lt-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="lt-t">When readings from one hour of incident time actually arrive</title>
  <desc id="lt-d">Readings observed between 14:00 and 15:00 plotted by when the pipeline received them. Sensors on mains power with a live backhaul deliver within seconds, and about 71 per cent of the hour's readings are present by 15:05. Battery sensors that batch their uploads every fifteen minutes bring the total to 89 per cent by 15:20. Sensors behind a repeater that lost power deliver nothing until it is restored, arriving in a burst at 18:40 and taking the total to 97 per cent. The remaining 3 per cent arrives over the following two days as devices are physically reached. A window that closes at 15:05 therefore publishes an hour that is missing nearly a third of its observations, and no amount of waiting makes the tail finite.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">readings observed 14:00–15:00, by the time they actually arrived</text>
  <text x="8" y="90" font-size="10" fill="var(--muted)">share present</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 240 H820"/><path d="M180 180 H820"/><path d="M180 120 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="132" y="304">0%</text><text x="124" y="244">25%</text><text x="124" y="184">50%</text><text x="124" y="124">75%</text><text x="120" y="64">100%</text>
  </g>
  <path d="M180 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 300 L250 130 L330 129 L420 126 L470 86 L560 84 L640 82 L700 68 L820 62" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <path d="M250 60 V300" fill="none" stroke="var(--ember)" stroke-width="1.6" stroke-dasharray="5 4"/>
  <text x="258" y="76" font-size="10.5" font-weight="700" fill="var(--ember-text)">a 5-minute window closes here — 71%</text>
  <circle cx="470" cy="86" r="7" fill="var(--crimson)"/>
  <text x="410" y="112" font-size="10" font-weight="700" fill="var(--crimson-deep)">repeater restored · 97%</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="320">15:00</text><text x="330" y="320">15:30</text><text x="470" y="320">18:40</text><text x="640" y="320">+1 day</text><text x="820" y="320">+2 days</text>
  </g>
  <text x="8" y="352" font-size="10.5" fill="currentColor">The tail is not long — it is unbounded. Some devices are reached physically, days later.</text>
  <text x="8" y="370" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">So the question is not how long to wait; it is how to publish now and correct later.</text>
</svg>

The shape of that curve rules out the obvious design. Waiting for completeness never terminates, because the tail is bounded by physical access to devices rather than by any network property. Publishing at a fixed window is defensible but has to be understood for what it is: an hour published at 15:05 is an hour containing 71 per cent of its observations, and the missing 29 per cent are not randomly distributed — they are concentrated in exactly the areas where infrastructure failed, which during an incident is where the hazard is.

So the pipeline has to be built for restatement from the beginning. Readings are keyed on their observation time rather than their arrival time; aggregates are recomputed when late data lands; and every published figure carries the arrival watermark it was computed against, so a consumer can tell that the 15:00 hour it read at 15:05 is not the 15:00 hour it would read now.

Retrofitting this is expensive, which is why it belongs in the prerequisites rather than in a later hardening pass. A pipeline that assumed arrival order — appending to partitions by arrival, aggregating once, publishing immutable outputs — cannot absorb the 18:40 burst without recomputing history it structurally cannot address.

## Configuration Reference

Tune these per deployment; the defaults are sized for a single mobile-command node under moderate surge.

| Parameter | Env var | Default | Purpose |
|-----------|---------|---------|---------|
| Ingest concurrency | `ETL_CONCURRENCY` | `32` | Semaphore cap on in-flight fetches; lower on constrained edge hardware |
| Max fetch attempts | `ETL_MAX_ATTEMPTS` | `4` | Retry budget before a record defers to the dead-letter queue |
| Fetch timeout (s) | `ETL_FETCH_TIMEOUT` | `5` | Per-request transport timeout |
| Target projected CRS | `ETL_TARGET_EPSG` | `26910` | Operational UTM zone for all metric work; set per area of operations |
| Hazard radius (m) | `ETL_HAZARD_RADIUS_M` | `500` | Proximity buffer applied around each reading |
| Dead-letter path | `ETL_DLQ_PATH` | `./dlq.sqlite` | Quarantine store for replay |
| Batch size | `ETL_BATCH_SIZE` | `500` | Records per transform pass; chunk larger streams to bound memory |

One consequence of building for restatement is that the pipeline needs an explicit answer to "how complete is this figure?", and that answer is a watermark rather than a boolean.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="wm-t wm-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="wm-t">The same aggregate published three times as late data arrives</title>
  <desc id="wm-d">A peak-wind figure for the 14:00 hour is published three times. At 15:05 it reads 34 knots against a watermark stating 71 per cent of expected sensors reported. At 15:20 late batch uploads raise it to 41 knots at 89 per cent. At 18:40, when a failed repeater is restored, a burst of readings raises it to 52 knots at 97 per cent — a figure half again as large as the first publication. Each version is correct for the data available when it was computed, and each carries the watermark that says so, which is what lets a consumer tell a revision from a contradiction.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">peak wind for the 14:00 hour, published three times</text>
  <rect x="40" y="86" width="250" height="130" rx="9" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.5"/>
  <rect x="315" y="86" width="250" height="130" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="590" y="86" width="250" height="130" rx="9" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <text x="60" y="114" font-size="10.5" font-weight="700" fill="currentColor">published 15:05</text>
  <text x="335" y="114" font-size="10.5" font-weight="700" fill="currentColor">republished 15:20</text>
  <text x="610" y="114" font-size="10.5" font-weight="700" fill="var(--cream)">republished 18:40</text>
  <text x="60" y="158" font-size="22" font-weight="700" fill="var(--crimson-deep)">34 kt</text>
  <text x="335" y="158" font-size="22" font-weight="700" fill="var(--crimson-deep)">41 kt</text>
  <text x="610" y="158" font-size="22" font-weight="700" fill="var(--cream)">52 kt</text>
  <text x="60" y="186" font-size="10" fill="var(--muted)">watermark: 71% reported</text>
  <text x="335" y="186" font-size="10" fill="currentColor">watermark: 89% reported</text>
  <text x="610" y="186" font-size="10" fill="var(--cream)">watermark: 97% reported</text>
  <text x="60" y="204" font-size="9.5" fill="var(--muted)">mains-powered sensors only</text>
  <text x="335" y="204" font-size="9.5" fill="currentColor">battery batches landed</text>
  <text x="610" y="204" font-size="9.5" fill="var(--cream)">repeater restored</text>
  <rect x="40" y="250" width="800" height="60" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="274" font-size="10.5" font-weight="700" fill="var(--ember-text)">without the watermark, these three are a system that contradicts itself</text>
  <text x="60" y="294" font-size="10" fill="currentColor">with it, they are one figure improving as its inputs arrive — and a duty officer can see that 34 kt was never wrong, just early</text>
</svg>

A 53 per cent increase in a peak-wind figure between two readings of the same hour is, without context, evidence that the system cannot be trusted. With the watermark attached it is evidence of exactly the opposite: the figure moved because the sensors in the area whose repeater had failed finally reported, and the pipeline said so.

That distinction has an operational edge to it. A duty officer who saw 34 knots at 15:05 and acted on it needs to know at 18:40 that the basis for the decision has changed — not that a number was wrong, but that the hour they planned against was substantially windier than the data then available showed. A revision without a watermark cannot communicate that; it just looks like the system changed its mind.

Publish the watermark as a first-class field on every aggregate, and make the smoke test assert that it is present and monotonic per hour. An aggregate whose watermark goes down has been recomputed against a subset of its own inputs, which means a partition was dropped somewhere — a defect that is otherwise very hard to see.

## Verification and Smoke Test

Confirm the contract and the projection invariant in staging before the pipeline touches a live feed. The assertions below are runnable and fail fast.

```python
from datetime import datetime, timezone


def smoke_test() -> None:
    # 1. The contract rejects an out-of-range coordinate.
    bad = {"device_id": "wx-07", "latitude": 95.0, "longitude": -120.0,
           "reading_type": "wind_speed", "reading_value": 18.0,
           "observed_at": datetime.now(timezone.utc)}
    assert validate_payload(bad) is None, "latitude > 90 must be rejected"

    # 2. The contract rejects a naive timestamp.
    naive = dict(bad, latitude=45.0, observed_at=datetime.now())
    assert validate_payload(naive) is None, "naive observed_at must be rejected"

    # 3. A buffer is only metric in a projected CRS.
    p = validate_payload(dict(bad, latitude=45.0))
    assert p is not None
    import geopandas as gpd
    from shapely.geometry import Point
    g = gpd.GeoDataFrame(geometry=[Point(p.longitude, p.latitude)], crs="EPSG:4326")
    g = g.to_crs(epsg=26910)
    assert g.geometry.buffer(500).area.iloc[0] > 700_000, "buffer area must be ~785k m^2"

    print("smoke test passed")


if __name__ == "__main__":
    smoke_test()
```

Run it directly — `python -m etl.smoke` — and gate merges on it in continuous integration alongside the spatial unit tests that validate projection integrity and schema drift.

## Integration with Adjacent Workflows

This pipeline is one stage in a longer chain and relies on its neighbours holding their contracts. Transport ordering, reconnect handling, and micro-batching are owned upstream by [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/), so the ETL can assume an ordered stream rather than re-implementing buffering. The reproducibility guarantees that let the same code project identically on a command laptop and an emergency operations centre come from running inside the hardened image described in [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/). When the volume of vector operations grows, the choice of spatial library starts to dominate latency on constrained hardware — [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/) covers that trade-off. Telemetry that must survive a backhaul outage is staged through [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) before the dead-letter queue replays it.

## Troubleshooting

**Symptom: hazard buffers are kilometres off and stretch east-west.** Root cause: the buffer was computed in EPSG:4326, so the radius is in degrees and distorts with latitude. Confirm `to_crs(epsg=target_epsg)` runs before `.buffer()`; the smoke test's area assertion catches this regression.

**Symptom: a station's points land in the ocean (null-island drift toward 0,0).** Root cause: latitude and longitude were swapped by a device emitting lon/lat order. Keep `pyproj` transforms on `always_xy=True` and reject readings whose coordinates fail the bounds in `SensorPayload` rather than coercing them.

**Symptom: the consumer stalls and memory climbs during a surge.** Root cause: unbounded concurrency — every endpoint was fetched at once. Lower `ETL_CONCURRENCY` and process in `ETL_BATCH_SIZE` chunks so the transform never holds the whole stream in memory.

**Symptom: readings vanish silently when the link degrades.** Root cause: exhausted fetches were dropped without quarantine. Ensure `fetch_with_backoff` returning `None` routes the raw record through `quarantine()`; verify rows accumulate in `dead_letter` during a simulated outage.

**Symptom: a feature is present but has no audit row.** Root cause: the feature write and audit insert were not in one transaction. Keep both inside the single `with conn:` block in `load_and_audit` so they commit or roll back together.

## Related

- [Automating address standardization for 911 logs](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/automating-address-standardization-for-911-logs/) — normalise unstructured sensor location text into NG911 routing tables
- [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) — the reproducible runtime this pipeline executes in
- [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/) — spatial-library selection under hardware constraints
- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — the transport layer that feeds this ETL

Up: [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/)
