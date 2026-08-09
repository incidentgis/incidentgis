---
title: "Real-Time Geocoding & Location Normalization"
description: "Production Python workflow for real-time incident geocoding and location normalization: streaming address parsing, axis-order-safe CRS handling, deterministic normalization, tiered geocoding with backoff, and audit-ready deduplication."
slug: real-time-geocoding-location-normalization
type: guide
breadcrumb: "Real-Time Geocoding & Location Normalization"
datePublished: "2025-02-18"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Real-Time Geocoding & Location Normalization for Incident Workflows",
      "description": "Production Python workflow for real-time incident geocoding and location normalization: streaming address parsing, axis-order-safe CRS handling, deterministic normalization, tiered geocoding with backoff, and audit-ready deduplication.",
      "datePublished": "2025-02-18",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Incident Mapping & Multi-Agency Sync", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/" },
        { "@type": "ListItem", "position": 3, "name": "Real-Time Geocoding & Location Normalization", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Geocode and normalize incident locations in real time with Python",
      "description": "Parse raw dispatch payloads, canonicalise address strings, resolve coordinates against an authoritative locator with retry, validate against WGS84 bounds, and emit a deterministic location hash for deduplication and audit.",
      "step": [
        { "@type": "HowToStep", "name": "Parse the raw payload", "text": "Extract coordinate pairs, street addresses, and intersection descriptors from CAD strings and field telemetry in a single streaming pass." },
        { "@type": "HowToStep", "name": "Normalize the address string", "text": "Canonicalise directional, suffix, and unit tokens so equivalent addresses collapse to one form before geocoding." },
        { "@type": "HowToStep", "name": "Resolve coordinates", "text": "Route normalised strings through a tiered geocoder with exponential backoff and validate the result against WGS84 bounds and a null-island guard." },
        { "@type": "HowToStep", "name": "Hash and deduplicate", "text": "Emit a deterministic location hash on rounded coordinates for deduplication, conflict keys, and the audit trail." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does a geocoded incident sometimes land at coordinates (0, 0)?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "An unparseable address that a geocoder cannot resolve frequently returns (0.0, 0.0) — null island, off the coast of West Africa. Treat (0, 0) as a sentinel failure, not a location: reject it, log the raw input, and fall back to the address string rather than snapping the incident to the Gulf of Guinea."
          }
        },
        {
          "@type": "Question",
          "name": "How do I avoid latitude/longitude axis-order bugs in pyproj?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Construct every pyproj.Transformer with always_xy=True so it consistently expects (lon, lat) order, and build shapely points as Point(lon, lat). EPSG:4326's authority definition is lat/lon, so without always_xy a transform can silently swap axes and place an incident in the wrong hemisphere."
          }
        },
        {
          "@type": "Question",
          "name": "Should real-time geocoding be synchronous or asynchronous?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Use a tiered strategy. High-priority dispatches resolve synchronously so the Common Operating Picture updates immediately; lower-priority or ambiguous reports enter an async worker pool backed by a queue so a slow or rate-limited locator never blocks the live feed."
          }
        }
      ]
    }
  ]
}
</script>

# Real-Time Geocoding & Location Normalization

A wildfire dispatch arrives over the radio as "structure fire, Nth & Mariposa, behind the old Shell station." The CAD operator types it verbatim, the record streams into the Common Operating Picture (COP), and a naive geocoder — finding nothing it recognises — returns `(0.0, 0.0)`. The incident snaps to null island off the coast of West Africa, the nearest-engine routing query finds no units within range, and a structure burns while the map shows it 8,000 km out to sea. That is the failure this workflow exists to prevent: turning unstructured, error-prone field text into a validated, deduplicated coordinate before any routing, resource-allocation, or public-alerting decision is made. It is the canonicalisation stage that the rest of the [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/) architecture depends on — every downstream consumer assumes the geometry it receives is real, correctly projected, and stable.

## Prerequisites

This pattern is the entry point of the spatial pipeline; it produces clean geometry rather than consuming it. Before it runs, assume the following are in place:

- **Python packages:** `pyproj >= 3.6` (axis-order-aware `Transformer`), `shapely >= 2.0`, `geopandas >= 0.14`, `aiohttp` for the async locator client, and `tenacity` for retry/backoff. `redis` or an equivalent broker backs the async worker pool.
- **CRS contract:** raw payloads are accepted in EPSG:4326 (WGS84) for ingestion. Every projected operation — distance, snapping, UTM-zone alignment — happens through a `Transformer` built with `always_xy=True`. Downstream consumers such as [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) require coordinates already canonicalised here, because un-normalised axis order produces false-positive overlap flags from projection drift.
- **Upstream transport:** the raw event stream is delivered by [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/), which buffers high-velocity dispatch and telemetry into a queue so a slow locator never applies backpressure to the live socket.
- **Authoritative locator:** a self-hosted Pelias instance, an agency-managed Esri Locator Server, or a state GIS portal geocoder reachable from the worker network. Never depend on a public consumer geocoding API for life-safety routing.

## Pipeline Overview

The flow is strictly staged so that a malformed input fails early and visibly instead of producing a plausible-but-wrong point: parse, normalize, resolve, validate, hash. Each stage is stateless and can be scaled horizontally behind the ingestion queue.

<svg viewBox="-2 74 986 268" role="img" aria-label="Horizontal data-flow diagram of the real-time geocoding pipeline. A raw MQTT or WebSocket dispatch payload enters a Parse stage that runs a coordinate regex and address extraction. Output flows to Normalize, which canonicalises USPS-style directional and suffix tokens. Normalized text reaches a tiered Geocode stage: high-priority dispatches resolve synchronously while lower-priority reports enter an async worker pool, both wrapped in exponential backoff against the authoritative locator. Resolved coordinates flow to Validate, which enforces WGS84 bounds and a null-island guard. Valid points flow to Hash, which emits a deterministic dedup key, and on to the Common Operating Picture and spatial enrichment. A reject and fallback branch off Validate loops failures to an immutable audit log, which feeds unresolved records back to the address-fallback path at Normalize." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Real-time geocoding pipeline: parse, normalize, geocode, validate, hash</title>
  <desc>A raw MQTT/WebSocket dispatch payload streams through five strictly staged steps. Parse extracts coordinate pairs and address tokens. Normalize collapses directional and suffix tokens to a canonical USPS-aligned form. Geocode is tiered — high-priority dispatches resolve synchronously and the rest enter an async worker pool, both with exponential backoff against the authoritative locator. Validate enforces WGS84 bounds and rejects the null-island sentinel (0,0); rejected records fall back to an immutable audit log, which re-feeds the address path at Normalize. Valid points pass to Hash, which emits a deterministic dedup and conflict key, and on to the Common Operating Picture and spatial enrichment.</desc>
  <defs>
    <marker id="geo-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="geo-flow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <!-- source -->
    <rect x="14" y="120" width="118" height="60" rx="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/>
    <text x="73" y="142" font-size="11">MQTT /</text>
    <text x="73" y="156" font-size="11">WebSocket</text>
    <text x="73" y="171" font-size="10">raw payload</text>
    <!-- 1 parse -->
    <rect x="170" y="116" width="124" height="68" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="232" y="138" font-weight="700">1 · Parse</text>
    <text x="232" y="156" font-size="10">coord regex +</text>
    <text x="232" y="170" font-size="10">address extract</text>
    <!-- 2 normalize -->
    <rect x="332" y="116" width="124" height="68" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="394" y="138" font-weight="700">2 · Normalize</text>
    <text x="394" y="156" font-size="10">canonical USPS</text>
    <text x="394" y="170" font-size="10">tokens</text>
    <!-- 3 geocode (tiered) -->
    <rect x="494" y="100" width="150" height="100" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="569" y="120" font-weight="700">3 · Geocode</text>
    <line x1="506" y1="130" x2="632" y2="130" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3"/>
    <text x="569" y="148" font-size="10">sync · priority</text>
    <text x="569" y="164" font-size="10">async worker pool</text>
    <text x="569" y="183" font-size="9.5" font-style="italic">exponential backoff</text>
    <!-- 4 validate (diamond) -->
    <path d="M758,90 L838,150 L758,210 L678,150 Z" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="758" y="140" font-weight="700" font-size="11">4 · Validate</text>
    <text x="758" y="156" font-size="9.5">WGS84 bounds</text>
    <text x="758" y="169" font-size="9.5">null-island guard</text>
    <!-- 5 hash -->
    <rect x="864" y="116" width="104" height="68" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="916" y="138" font-weight="700">5 · Hash</text>
    <text x="916" y="156" font-size="10">deterministic</text>
    <text x="916" y="170" font-size="10">dedup key</text>
    <!-- COP / enrichment -->
    <rect x="838" y="262" width="130" height="56" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="903" y="285" font-size="11">COP +</text>
    <text x="903" y="301" font-size="10">spatial enrichment</text>
    <!-- audit log -->
    <rect x="430" y="270" width="170" height="56" rx="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/>
    <text x="515" y="293" font-size="11">Immutable audit log</text>
    <text x="515" y="309" font-size="10">reject + raw input</text>
  </g>
  <!-- primary flow -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#geo-flow)">
    <path d="M132,150 H168"/>
    <path d="M294,150 H330"/>
    <path d="M456,150 H492"/>
    <path d="M644,150 H676"/>
    <path d="M838,150 H862"/>
    <!-- hash down to COP -->
    <path d="M916,184 V230 H903 V260"/>
  </g>
  <!-- reject / fallback branch -->
  <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#geo-flow-dim)">
    <!-- validate reject down to audit log -->
    <path d="M758,210 V298 H602"/>
    <!-- audit log fallback back to normalize -->
    <path d="M430,298 H394 V186"/>
  </g>
  <g font-size="9.5" fill="currentColor" text-anchor="middle">
    <text x="678" y="232" font-style="italic">reject</text>
    <text x="412" y="245" font-style="italic">address fallback</text>
  </g>
</svg>

## Step-by-Step Implementation

### 1. Parse the raw payload

Dispatch platforms and field telemetry rarely transmit clean, pre-geocoded data. The parser isolates coordinate pairs, street addresses, intersection descriptors, and landmark names in a single pass, defaulting to EPSG:4326 when no CRS is declared. The critical guard here is the WGS84 bounds check — and rejecting the null-island sentinel `(0, 0)` outright.

```python
import re
import logging
from dataclasses import dataclass
from typing import Optional

import pyproj
from shapely.geometry import Point

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("incident_geocoder")

# always_xy=True forces (lon, lat) ordering and prevents EPSG:4326 axis-swap bugs.
TRANSFORMER = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
COORD_REGEX = re.compile(r"[-+]?\d+\.\d+")


@dataclass
class IncidentLocation:
    raw_input: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    crs: str = "EPSG:4326"
    geometry: Optional[Point] = None
    needs_geocode: bool = True


def parse_and_validate_location(raw_payload: str) -> IncidentLocation:
    """Extract a coordinate pair from a raw dispatch string, guarding WGS84 bounds and null island."""
    loc = IncidentLocation(raw_input=raw_payload)
    try:
        coords = COORD_REGEX.findall(raw_payload)
        if len(coords) < 2:
            raise ValueError("no coordinate pair present; defer to address geocoder")

        lat, lon = float(coords[0]), float(coords[1])
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            raise ValueError(f"coordinates out of WGS84 bounds: ({lat}, {lon})")
        if abs(lat) < 1e-7 and abs(lon) < 1e-7:
            raise ValueError("null-island sentinel (0, 0) rejected")

        loc.lat, loc.lon, loc.needs_geocode = lat, lon, False
        loc.geometry = Point(lon, lat)  # shapely is (x=lon, y=lat)
        return loc
    except (ValueError, IndexError) as exc:
        logger.warning("coordinate extraction failed for %r: %s", raw_payload[:60], exc)
        return loc  # needs_geocode stays True -> address path takes over
```

### 2. Normalize the address string

Location normalization standardises directional abbreviations, suffixes, and unit designations so that equivalent addresses collapse to one canonical form before spatial indexing — otherwise `"Nth St"`, `"North Street"`, and `"N. ST"` create three distinct features for one incident. Align the token map with USPS Publication 28 so the canonical form matches what authoritative locators index.

```python
from typing import Final

DIRECTIONALS: Final[dict[str, str]] = {
    "north": "N", "south": "S", "east": "E", "west": "W",
    "northeast": "NE", "northwest": "NW", "southeast": "SE", "southwest": "SW",
    "nth": "N", "sth": "S",
}
SUFFIXES: Final[dict[str, str]] = {
    "street": "ST", "str": "ST", "avenue": "AVE", "av": "AVE",
    "boulevard": "BLVD", "road": "RD", "drive": "DR", "lane": "LN",
    "court": "CT", "highway": "HWY", "place": "PL",
}


def normalize_address(raw: str) -> str:
    """Collapse directional, suffix, and unit tokens to a canonical, USPS-aligned form."""
    tokens = re.sub(r"[.,]", " ", raw.lower()).split()
    out: list[str] = []
    for tok in tokens:
        if tok in DIRECTIONALS:
            out.append(DIRECTIONALS[tok])
        elif tok in SUFFIXES:
            out.append(SUFFIXES[tok])
        else:
            out.append(tok.upper())
    canonical = " ".join(out).strip()
    logger.debug("normalized %r -> %r", raw, canonical)
    return canonical
```

### 3. Resolve coordinates with a tiered, backed-off geocoder

High-priority incidents bypass the queue and resolve synchronously so the COP updates immediately; lower-priority or ambiguous reports enter an async worker pool. Either way the locator call is wrapped in exponential backoff so a transient `429` or network blip retries instead of dropping the incident. Substitute your jurisdiction's authoritative endpoint for the placeholder URL.

```python
import asyncio

import aiohttp
from tenacity import (
    retry, stop_after_attempt, wait_exponential, retry_if_exception_type,
)


class GeocodingError(Exception):
    """Raised on a retryable geocoder failure (rate limit, 5xx, network)."""


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(GeocodingError),
)
async def resolve_address(address: str, session: aiohttp.ClientSession) -> dict:
    """Call the jurisdiction's authoritative locator with exponential backoff.

    Replace the URL and query-parameter name with your actual locator
    (Pelias /v1/search, an Esri Locator Server, or a state GIS portal).
    """
    geocoder_url = "https://your-agency-geocoder.example.gov/v1/search"
    try:
        async with session.get(geocoder_url, params={"text": address}) as resp:
            if resp.status == 200:
                payload = await resp.json()
                features = payload.get("features") or payload.get("results")
                if not features:
                    raise GeocodingError(f"zero results for {address!r}")
                return features[0]
            if resp.status == 429:
                raise GeocodingError("rate limit exceeded")
            raise GeocodingError(f"locator returned HTTP {resp.status}")
    except aiohttp.ClientError as exc:
        logger.error("network failure during geocoding of %r: %s", address, exc)
        raise GeocodingError("network unreachable") from exc
```

What the backoff schedule buys is a bounded worst case rather than a better success rate. Laid out on a timeline, the shape of the guarantee is easier to see than it is to read off the parameter table.

<svg viewBox="0 0 880 320" role="img" aria-labelledby="bk-title bk-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="bk-title">Three geocoder attempts with jittered exponential backoff, then the address fallback</title>
  <desc id="bk-desc">A fourteen-second timeline of one incident being geocoded. Attempt one runs for two seconds and fails. The client waits one second plus jitter and runs attempt two, which also fails after two seconds. It waits two seconds plus jitter and runs attempt three, which fails as well. Having exhausted GEO_RETRY_ATTEMPTS, the pipeline drops to the address-fallback path, which resolves against the road-segment centroid in under a second and commits the record tagged with locator_source equal to fallback and requires_review set true. The backoff ceiling caps how long each wait can grow, not how many attempts are made, so the worst-case latency is bounded and the record is never simply dropped.</desc>
  <rect x="0" y="0" width="880" height="320" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">GEO_RETRY_ATTEMPTS = 3 · jittered exponential backoff · GEO_BACKOFF_MAX caps the wait, not the count</text>
  <g font-size="10.5" fill="currentColor">
    <text x="120" y="112">attempt 1</text><text x="290" y="112">attempt 2</text>
    <text x="525" y="112">attempt 3</text><text x="645" y="112">fallback</text>
  </g>
  <g stroke-width="1.6">
    <rect x="120" y="123" width="100" height="34" rx="6" fill="var(--ember)" opacity="0.5" stroke="var(--ember)"/>
    <rect x="290" y="123" width="100" height="34" rx="6" fill="var(--ember)" opacity="0.5" stroke="var(--ember)"/>
    <rect x="525" y="123" width="100" height="34" rx="6" fill="var(--ember)" opacity="0.5" stroke="var(--ember)"/>
    <rect x="645" y="123" width="27" height="34" rx="6" fill="var(--petal-soft)" stroke="var(--crimson)"/>
  </g>
  <text x="700" y="136" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">committed with</text>
  <text x="700" y="152" font-size="10.5" fill="currentColor">locator_source = fallback</text>
  <g fill="none" stroke="var(--line-strong)" stroke-width="1.3" stroke-dasharray="4 4">
    <path d="M220 168 V184 H290 V168"/>
    <path d="M390 168 V184 H525 V168"/>
  </g>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="255" y="198">1.0 s + jitter</text>
    <text x="457" y="198">2.0 s + jitter</text>
  </g>
  <path d="M120 214 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="120" y="234">0 s</text><text x="220" y="234">2</text><text x="320" y="234">4</text><text x="420" y="234">6</text>
    <text x="520" y="234">8</text><text x="620" y="234">10</text><text x="720" y="234">12</text><text x="820" y="234">14 s</text>
    <text x="470" y="256" font-size="11">elapsed since the incident entered the queue</text>
  </g>
  <text x="440" y="296" font-size="11" text-anchor="middle" fill="var(--muted)">The record is never dropped — it is downgraded, tagged, and made someone's explicit problem.</text>
</svg>

Two properties of that schedule are worth defending against the pressure to "just retry harder". The first is the jitter. Without it, every incident that hits a degraded locator retries on exactly the same schedule, so a locator recovering from an outage receives its entire backlog as three synchronised thundering herds and fails again — the retry policy becomes the outage's own extension mechanism. The second is that `GEO_BACKOFF_MAX` bounds the *wait*, not the attempt count. Raising the ceiling makes a struggling locator's failures slower to detect without making them less likely, which is close to the worst combination during a surge.

The path that matters most is the last one. A record whose geocoding failed is not dropped and does not block; it is resolved to the centroid of its road segment, committed with `locator_source = fallback` and `requires_review = true`, and made visible as a lower-confidence position. That is a deliberate choice to prefer a known-approximate location over no location, on the reasoning that an incident marker with a review flag gets a unit dispatched to roughly the right place while an absent marker gets nothing dispatched at all.

### 4. Hash for deduplication and audit

A deterministic hash over rounded coordinates gives every resolved location a stable key for deduplication, conflict detection, and the immutable audit trail. Rounding to six decimal places (~11 cm) prevents floating-point jitter from minting a new key for the same point on every re-ingest.

```python
import hashlib


def location_hash(lat: float, lon: float, precision: int = 6) -> str:
    """Deterministic 16-char key over rounded coordinates for dedup and audit trails."""
    canonical = f"{round(lat, precision)}_{round(lon, precision)}"
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]
```

## Configuration Reference

These knobs govern throughput, accuracy, and how aggressively the pipeline retries before falling back. Set them per deployment from the environment so a surge response can widen pools without a code change.

| Parameter | Env var | Default | Purpose |
|---|---|---|---|
| Coordinate rounding precision | `GEO_HASH_PRECISION` | `6` | Decimal places for the dedup hash (~0.11 m). Lower to merge near-duplicates from low-accuracy GPS. |
| Geocoder retry attempts | `GEO_RETRY_ATTEMPTS` | `3` | Max attempts before an incident drops to the address-fallback path. |
| Backoff ceiling (s) | `GEO_BACKOFF_MAX` | `10` | Upper bound on exponential wait between locator retries. |
| Async pool size | `GEO_WORKER_POOL` | `16` | Concurrent locator calls for non-priority incidents. |
| Sync priority threshold | `GEO_SYNC_PRIORITY` | `1` | ICS priority at or below which geocoding runs synchronously. |
| Ingestion CRS | `GEO_INGEST_CRS` | `EPSG:4326` | Assumed CRS for payloads with no declared reference. |
| Locator base URL | `GEO_LOCATOR_URL` | — | Authoritative Pelias/Esri/state-portal endpoint. |

`GEO_HASH_PRECISION` looks like an accuracy setting and behaves like a merge policy, which is why its default is the parameter most often left wrong. Six decimal places is roughly eleven centimetres — a cell far finer than the position it is hashing.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="prec-title prec-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="prec-title">Deduplication hash cell size at each rounding precision, against the accuracy of the fixes being hashed</title>
  <desc id="prec-desc">A logarithmic scale from one centimetre to one kilometre. Rounding coordinates to six decimal places produces a cell about 0.11 metres across, five places about 1.1 metres, four places about 11 metres and three places about 111 metres. Plotted against the same scale are the accuracies of the fixes being hashed: real-time kinematic GNSS at about two centimetres, WAAS-corrected GPS at about three metres, consumer GPS at about five metres and an urban canyon fix at about twenty-five metres. Where the cell is smaller than the accuracy of the fix, two readings of the same physical location fall into different cells and can never be merged, so the default of six decimal places de-duplicates nothing at all for any device other than a survey-grade receiver.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">GEO_HASH_PRECISION — cell size against the accuracy of the fix being hashed</text>
  <g>
    <rect x="200" y="90" width="129.6" height="26" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
    <rect x="200" y="130" width="253.6" height="26" rx="5" fill="var(--petal)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="200" y="170" width="377.6" height="26" rx="5" fill="var(--petal)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="200" y="210" width="501.6" height="26" rx="5" fill="var(--petal)" stroke="var(--line-strong)" stroke-width="1.2"/>
  </g>
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="108">6 dp · 0.11 m</text>
    <text x="8" y="148">5 dp · 1.1 m</text>
    <text x="8" y="188">4 dp · 11 m</text>
    <text x="8" y="228">3 dp · 111 m</text>
  </g>
  <text x="8" y="76" font-size="9.5" fill="var(--muted)">default</text>
  <path d="M200 252 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g stroke="var(--crimson-deep)" stroke-width="1.6">
    <path d="M237.3 246 V258"/><path d="M507.1 246 V258"/><path d="M534.7 246 V258"/><path d="M621.4 246 V258"/>
  </g>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="200" y="272">0.01 m</text><text x="324" y="272">0.1</text><text x="448" y="272">1</text>
    <text x="572" y="272">10</text><text x="696" y="272">100</text><text x="820" y="272">1000 m</text>
  </g>
  <g font-size="10.5" font-weight="700" fill="var(--crimson-deep)">
    <text x="200" y="296">RTK ±0.02 m</text>
    <text x="470" y="296">WAAS ±3 m</text>
    <text x="600" y="296">urban canyon ±25 m</text>
    <text x="470" y="314">consumer GPS ±5 m</text>
  </g>
  <text x="440" y="344" font-size="11" text-anchor="middle" fill="var(--muted)">A cell finer than the fix's own accuracy cannot merge two readings of one place.</text>
</svg>

Read against the accuracy of real fixes, the default de-duplicates almost nothing. Two reports of the same doorway from two consumer handsets will differ by several metres, land in different eleven-centimetre cells, produce different hashes, and both commit as distinct incidents. The dedup layer is running, is consuming CPU, is emitting audit records, and is catching only exact byte-for-byte replays — which the ingestion boundary already caught upstream.

Choosing the value is a matter of matching the cell to the worst fix you accept, not the best. A response fed by consumer handsets and vehicle GPS wants four decimal places, whose eleven-metre cell sits comfortably outside the five-metre accuracy band and merges genuine re-reports of one location. Three places is right where urban-canyon multipath dominates, at the cost of merging genuinely distinct incidents on opposite sides of a large intersection — a trade worth taking for structure fires and refusing for individual medical calls. Six places is correct only for survey-grade receivers, where it is exactly right.

The safe way to change it is to run both precisions in shadow for an operational period and compare the merge counts before switching, because the failure mode of an over-coarse hash is silent and the wrong direction: it does not raise errors, it quietly collapses two incidents into one.

## Verification and Smoke Test

Before promoting a build, assert the two failure modes that cause the worst field outcomes — null-island drift and axis-order inversion — never slip through. These run with no network and belong in CI.

```python
def test_pipeline_guards() -> None:
    # null island must be rejected, not geocoded
    null_loc = parse_and_validate_location("incident at 0.0 0.0")
    assert null_loc.geometry is None and null_loc.needs_geocode is True

    # a valid point keeps (lon, lat) order in the shapely geometry
    sf = parse_and_validate_location("unit en route 37.7749 -122.4194")
    assert sf.geometry is not None
    assert abs(sf.geometry.x - (-122.4194)) < 1e-9  # x is lon
    assert abs(sf.geometry.y - 37.7749) < 1e-9      # y is lat

    # equivalent addresses collapse to one canonical form -> one hash
    a = normalize_address("123 North Mariposa Street")
    b = normalize_address("123 Nth Mariposa St.")
    assert a == b == "123 N MARIPOSA ST"

    print("OK: null-island, axis-order, and normalization guards hold")


if __name__ == "__main__":
    test_pipeline_guards()
```

Run it as `python -m incident_geocoder.smoke` in staging and gate the deploy on a zero exit code.

## Integration with Adjacent Workflows

This stage is the upstream contract for the rest of the synchronization architecture. Canonicalised, validated points flow into [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/), which assumes axis order and CRS are already correct so its spatial-overlap classification does not fire on projection drift. The field-level schema around each point — required attributes, value domains, the merge key — is enforced by [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/), which should reject records before they reach geocoding. Once a point is resolved, spatial enrichment attaches jurisdictional boundaries and hazard zones; keeping that join fast during surge is the focus of [Optimizing Spatial Joins for Incident Data](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/optimizing-spatial-joins-for-incident-data/), which leans on R-tree indexing and bounding-box pre-filtering rather than naive pairwise intersection.

## Troubleshooting

**Symptom: incidents cluster at `(0, 0)` off the African coast.** Root cause: the locator returned the null-island sentinel for an address it could not parse, and a caller bypassed the bounds guard. Confirm every coordinate path runs through `parse_and_validate_location`, which rejects `(0, 0)` and keeps `needs_geocode=True` so the address fallback takes over.

**Symptom: points land in the wrong hemisphere after reprojection.** Root cause: a `Transformer` was built without `always_xy=True`, so EPSG:4326's authority-defined lat/lon order silently swapped the axes. Build every transformer with `always_xy=True` and construct shapely points as `Point(lon, lat)`.

**Symptom: the same physical incident appears as several COP features.** Root cause: address strings were not normalised, so `"North Street"` and `"N St"` produced different geocoder hits and different hashes. Route all strings through `normalize_address` before geocoding so equivalent inputs collapse to one canonical form and one `location_hash`.

**Symptom: the live feed stalls during a surge.** Root cause: high-volume, low-priority geocoding is running synchronously and a rate-limited locator is applying backpressure to the socket. Lower `GEO_SYNC_PRIORITY` so only true priority dispatches resolve inline and the rest queue into the async pool.

**Symptom: the locator returns `429` and incidents drop.** Root cause: retry budget is exhausted or absent. Confirm `resolve_address` is wrapped by the `tenacity` retry with `wait_exponential`, and raise `GEO_RETRY_ATTEMPTS` for the locator's documented burst limit before falling back to the address path.

## Related

- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — the streaming transport that delivers raw payloads to this parser
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — consumes canonicalised coordinates for deterministic merges
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — enforces the field-level schema before geocoding
- [Optimizing Spatial Joins for Incident Data](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/optimizing-spatial-joins-for-incident-data/) — keeps post-geocode enrichment fast under surge load

Up: [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/)
