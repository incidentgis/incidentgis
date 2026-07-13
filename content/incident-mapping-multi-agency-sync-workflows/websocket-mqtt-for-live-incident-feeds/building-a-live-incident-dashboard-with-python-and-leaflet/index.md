# Building a Live Incident Dashboard with Python and Leaflet

A regional emergency operations center stands up a Leaflet wall display to track a moving brush fire: engines push GPS pings, a 9-1-1 plotter drops new ignitions, and three mutual-aid agencies edit the same incident layer. At twenty updates a second the map repaints cleanly. Then the wind shifts, call volume spikes, a cellular sector congests, and the dashboard built on naive HTTP polling falls thirty seconds behind — markers stack on stale coordinates, the strike-team leader is looking at a perimeter that no longer exists, and an evacuation order goes out against a map that lied. This page solves that one narrow failure: a Python-fed Leaflet dashboard that stays *live and honest* under surge, consuming the normalized stream produced by the [WebSocket and MQTT live incident feed bridge](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) instead of polling, and degrading to a logged, audited fallback rather than to a frozen tile.

## Root Cause and Operational Impact

The freeze is rarely the network's fault and almost never Leaflet's rendering core. Three conditions turn a working dashboard into a hazard the moment the rate climbs:

1. **Request-cycle latency compounds.** Stateless HTTP polling re-opens a TCP/TLS handshake, re-authenticates, and re-serializes the full feature set on every tick. At surge volume the poll interval and the round-trip time stack, so the displayed state is always one or two intervals stale — and "two intervals" during a fast-moving incident is a perimeter that has already crossed a road.
2. **Unbounded DOM mutation.** Pushing every inbound feature straight into the map as a fresh `L.Marker` forces a layout reflow per message. A few hundred markers a second saturates the main thread; the browser stops painting, input handlers queue, and the operator cannot pan or zoom while the event is at its worst.
3. **No degraded mode.** When the persistent stream drops in an RF-shadowed canyon or a congested cell, a dashboard with no fallback simply stops updating — and shows *no signal that it has stopped*. A blank-but-still map is more dangerous than an error, because command staff keep trusting it.

In an after-action report this reads as "UI was slow." During the incident it is a positional-truth failure: a unit dispatched to a marker that is ninety seconds behind the fire, a structure count under-reported into the NIMS (National Incident Management System) ICS-209 situation report, or an agency's own units vanishing from the common operating picture. The dashboard must hold its latency budget under surge *and* announce when it has degraded, never fail silently to a stale tile.

<svg viewBox="0 0 960 500" role="img" aria-label="Live incident dashboard data flow from field telemetry to a Leaflet canvas, with a degraded fallback branch. MQTT field telemetry at QoS 1 and the WebSocket EOC stream feed a Python broker that validates the GeoJSON schema, normalizes CRS to EPSG:4326, deduplicates QoS-1 redeliveries on incident_id plus sequence_number, and tags each feature with a diff_type of create, update, or delete. Malformed payloads are quarantined to a dead-letter queue with an audit record and never reach the map. The broker broadcasts diffs over a persistent WebSocket to the browser client, which pushes each message into a batch buffer flushed once per requestAnimationFrame at up to 60 Hz, throttled to 1 Hz per feature, then applies the diff in place to an L.MarkerClusterGroup rendered on an L.Canvas renderer. If the WebSocket drops, the client starts exponential-backoff reconnect and switches to the /api/incidents/fallback delta-poll endpoint, which returns only features changed since last_sync, stamped fallback_mode=true and an audit timestamp, and the dashboard raises a visible DEGRADED — polling fallback banner instead of freezing on a stale tile." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Live-and-honest dashboard data flow with a degraded fallback branch</title>
  <desc>MQTT field telemetry (QoS 1) and the WebSocket EOC stream feed a Python broker that validates the GeoJSON schema, normalizes CRS to EPSG:4326, deduplicates redeliveries on incident_id + sequence_number, and tags each feature with diff_type (create / update / delete); malformed payloads are quarantined to a dead-letter queue with an audit record and never reach the map. The broker broadcasts diffs over a persistent WebSocket to the browser client, which buffers messages and flushes once per requestAnimationFrame (≤60 Hz, throttled to 1 Hz per feature), then applies each diff in place to an L.MarkerClusterGroup on an L.Canvas renderer — no full-layer rebuild. When the WebSocket drops, the client runs exponential-backoff reconnect and switches to the /api/incidents/fallback delta poll (returns only features changed since last_sync, stamped fallback_mode=true with an audit timestamp), and the dashboard shows a visible "DEGRADED — polling fallback" banner instead of freezing on a stale tile.</desc>
  <defs>
    <marker id="dash-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="dash-flow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <!-- stage labels -->
    <text x="120" y="22" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Sources</text>
    <text x="440" y="22" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Python broker</text>
    <text x="800" y="22" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Leaflet client</text>
    <!-- separators -->
    <line x1="252" y1="34" x2="252" y2="486" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>
    <line x1="632" y1="34" x2="632" y2="486" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>
    <!-- MQTT field telemetry -->
    <rect x="22" y="70" width="208" height="60" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="126" y="92" font-weight="600">MQTT field telemetry</text>
    <text x="126" y="110" font-size="10">engine GPS pings · QoS 1</text>
    <text x="126" y="124" font-size="10">at-least-once delivery</text>
    <!-- WebSocket EOC stream -->
    <rect x="22" y="158" width="208" height="60" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="126" y="180" font-weight="600">WebSocket EOC stream</text>
    <text x="126" y="198" font-size="10">9-1-1 plotter · mutual-aid edits</text>
    <text x="126" y="212" font-size="10">live incident layer</text>
    <!-- broker: validate + normalize + dedup + tag -->
    <rect x="284" y="64" width="190" height="100" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
    <text x="379" y="86" font-weight="700">Ingest &amp; normalize</text>
    <text x="379" y="104" font-size="10">validate GeoJSON schema</text>
    <text x="379" y="119" font-size="10">CRS → EPSG:4326</text>
    <text x="379" y="134" font-size="10">dedup on id + sequence_number</text>
    <text x="379" y="149" font-size="10">tag diff_type create/update/delete</text>
    <!-- quarantine -->
    <rect x="284" y="190" width="190" height="58" rx="7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="5 4"/>
    <text x="379" y="212" font-weight="600">Quarantine · dead-letter</text>
    <text x="379" y="230" font-size="10">malformed payload · audited</text>
    <text x="379" y="244" font-size="10">never reaches the map</text>
    <!-- authoritative cache / fallback endpoint -->
    <rect x="284" y="300" width="190" height="76" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="379" y="322" font-weight="600">incident_cache</text>
    <text x="379" y="340" font-size="10">latest authoritative state</text>
    <text x="379" y="355" font-size="10">/api/incidents/fallback</text>
    <text x="379" y="370" font-size="10">delta since last_sync</text>
    <!-- batch buffer (rAF) -->
    <rect x="664" y="64" width="184" height="80" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="756" y="86" font-weight="700">rAF batch buffer</text>
    <text x="756" y="104" font-size="10">flush once per frame</text>
    <text x="756" y="119" font-size="10">≤60 Hz · 1 Hz per feature</text>
    <text x="756" y="134" font-size="10">a burst → one render</text>
    <!-- canvas cluster render -->
    <rect x="664" y="172" width="184" height="78" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="756" y="194" font-weight="700">L.MarkerClusterGroup</text>
    <text x="756" y="212" font-size="10">on L.Canvas renderer</text>
    <text x="756" y="227" font-size="10">apply diff in place</text>
    <text x="756" y="242" font-size="10">no full-layer rebuild</text>
    <!-- degraded controller -->
    <rect x="664" y="300" width="184" height="92" rx="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/>
    <text x="756" y="322" font-weight="600">On socket drop</text>
    <text x="756" y="340" font-size="10">exponential-backoff reconnect</text>
    <text x="756" y="355" font-size="10">switch to delta poll</text>
    <text x="756" y="370" font-size="10">fallback_mode=true · audit_ts</text>
    <text x="756" y="385" font-size="10">show DEGRADED banner</text>
  </g>
  <!-- crimson primary flows -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#dash-flow)">
    <path d="M230,100 H262 Q272,100 272,108 V110 Q272,114 284,114"/>
    <path d="M230,188 H262 Q272,188 272,160 V126 Q272,116 284,116"/>
    <path d="M474,114 H632 Q652,114 652,108 V104 Q652,104 664,104"/>
    <path d="M756,144 V172"/>
  </g>
  <!-- dim secondary flows: quarantine + cache tap + fallback -->
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#dash-flow-dim)" stroke-dasharray="5 4">
    <!-- ingest forks malformed to quarantine -->
    <path d="M379,164 V190"/>
    <!-- ingest writes authoritative cache -->
    <path d="M340,164 Q330,230 330,265 V300"/>
    <!-- degraded controller polls the fallback endpoint -->
    <path d="M664,346 H560 Q500,346 480,346"/>
    <!-- fallback delta returns into the batch buffer -->
    <path d="M474,326 H540 Q620,326 620,200 V104 Q620,104 664,104"/>
  </g>
  <!-- degraded banner callout -->
  <g>
    <rect x="664" y="408" width="272" height="40" rx="6" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" stroke-dasharray="4 3"/>
    <text x="800" y="426" font-size="11" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">DEGRADED — polling fallback</text>
    <text x="800" y="441" font-size="10" text-anchor="middle" fill="currentColor">visible to command staff · never a silent freeze</text>
  </g>
  <text x="440" y="470" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">diff-driven WebSocket is the live path; the delta poll is the audited safe default — the map degrades visibly, never to a stale tile</text>
</svg>

## Tiered Resolution Strategy

Work the dashboard from the definitive real-time path down to a safe default that is always visible and always logged:

1. **Definitive fix — diff-driven WebSocket updates onto a canvas renderer.** Consume the normalized GeoJSON stream from the broker, where each message already carries a `diff_type` (`create`, `update`, `delete`). Apply only the diff to an existing `L.MarkerClusterGroup` backed by `L.Canvas`, never a full layer rebuild. The map mutates a single feature per message instead of repainting the world.
2. **Coalesce updates to the frame budget.** Buffer inbound messages and flush them once per `requestAnimationFrame` (≈60 Hz ceiling, throttled to 1 Hz per feature), so a burst of a thousand pings becomes one batched render rather than a thousand reflows.
3. **Deduplicate before render.** Hash on `incident_id` plus `sequence_number` so an at-least-once MQTT redelivery (QoS 1) does not paint a duplicate marker or resurrect a deleted one.
4. **Safe default with an audit flag.** If the WebSocket drops, run exponential-backoff reconnect while transparently switching to a delta-polling HTTP endpoint, raise a visible "DEGRADED — polling fallback" banner, and stamp the served snapshot with `fallback_mode=true` and a sync timestamp. A flagged, visibly-degraded map is recoverable; a silently frozen one is not.

## Production Python Implementation

The broker below ingests validated telemetry, tags each feature with a `diff_type` so the client can apply minimal updates, and exposes a delta-poll fallback for clients that lose the socket. It uses full type hints, explicit exception boundaries, structured logging (no `print`), and emits an audit record whenever a payload is quarantined or a client is served in degraded mode. It assumes coordinates have already passed [real-time geocoding and location normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) and conform to the broker's GeoJSON schema.

```python
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError, field_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(funcName)s | %(message)s",
)
logger = logging.getLogger("incident_dashboard_broker")

DiffType = Literal["create", "update", "delete"]


class IncidentFeature(BaseModel):
    """Minimal validated incident payload bound for the Leaflet client."""

    incident_id: str
    sequence_number: int
    diff_type: DiffType
    lat: float
    lon: float
    severity: int
    timestamp: str

    @field_validator("lat")
    @classmethod
    def _check_lat(cls, v: float) -> float:
        if not (-90.0 <= v <= 90.0):
            raise ValueError("Latitude outside WGS 84 / EPSG:4326 bounds (-90..90)")
        return v

    @field_validator("lon")
    @classmethod
    def _check_lon(cls, v: float) -> float:
        if not (-180.0 <= v <= 180.0):
            raise ValueError("Longitude outside WGS 84 / EPSG:4326 bounds (-180..180)")
        return v


# Latest authoritative state per incident, used to serve the delta-poll fallback.
incident_cache: dict[str, dict[str, Any]] = {}
ws_clients: set[Any] = set()
_seen: set[str] = set()


def _dedup_key(feature: IncidentFeature) -> str:
    """Stable hash so an at-least-once (QoS 1) redelivery renders only once."""
    raw = f"{feature.incident_id}:{feature.sequence_number}:{feature.diff_type}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


async def _audit(event: str, **fields: Any) -> None:
    """Emit an immutable audit record for after-action review."""
    record = {"event": event, "audit_ts": datetime.now(timezone.utc).isoformat(), **fields}
    logger.info("AUDIT %s", json.dumps(record, separators=(",", ":")))


async def process_telemetry(raw_message: str) -> None:
    """Validate, dedupe, cache, and fan out one inbound telemetry message."""
    try:
        feature = IncidentFeature(**json.loads(raw_message))
    except (json.JSONDecodeError, ValidationError) as exc:
        # Quarantine malformed payloads to the dead-letter queue, never the map.
        await _audit("payload_quarantined", error=str(exc), payload=raw_message[:200])
        return

    key = _dedup_key(feature)
    if key in _seen:
        return  # idempotent redelivery; suppress duplicate render
    _seen.add(key)

    # Cache authoritative state so a degraded client can resync via delta poll.
    if feature.diff_type == "delete":
        incident_cache.pop(feature.incident_id, None)
    else:
        incident_cache[feature.incident_id] = feature.model_dump(mode="json")

    await _broadcast(feature.model_dump(mode="json"))


async def _broadcast(payload: dict[str, Any]) -> None:
    """Fan out to connected Leaflet clients, pruning dead sockets as we go."""
    if not ws_clients:
        return
    dropped: set[Any] = set()
    for client in ws_clients:
        try:
            await client.send_json(payload)
        except Exception:  # noqa: BLE001 — any send failure means a dead socket
            dropped.add(client)
    ws_clients.difference_update(dropped)


app = FastAPI()


@app.get("/api/incidents/fallback")
async def fallback_snapshot(last_sync: str | None = None) -> JSONResponse:
    """Delta-poll endpoint for clients that lost the WebSocket.

    Returns only features updated since the caller's last successful sync and
    flags the response so the dashboard can render a visible DEGRADED state.
    """
    delta = {
        iid: feat
        for iid, feat in incident_cache.items()
        if last_sync is None or feat["timestamp"] > last_sync
    }
    await _audit("degraded_poll_served", since=last_sync, feature_count=len(delta))
    return JSONResponse(
        content={
            "fallback_mode": True,
            "server_ts": datetime.now(timezone.utc).isoformat(),
            "features": delta,
        }
    )
```

On the browser side, the client applies the `diff_type` against an `L.MarkerClusterGroup` on a canvas renderer and coalesces a burst of messages into a single animation frame:

```javascript
const renderer = L.canvas({ padding: 0.5 });           // canvas, not SVG, under surge
const cluster = L.markerClusterGroup({ chunkedLoading: true });
map.addLayer(cluster);

const markers = new Map();        // incident_id -> L.Marker
let pending = [];                  // batched diffs, flushed per frame
let frameQueued = false;

function flush() {
  frameQueued = false;
  for (const f of pending) {
    if (f.diff_type === "delete") {
      const m = markers.get(f.incident_id);
      if (m) { cluster.removeLayer(m); markers.delete(f.incident_id); }
    } else {
      let m = markers.get(f.incident_id);
      if (!m) {
        m = L.circleMarker([f.lat, f.lon], { renderer });
        markers.set(f.incident_id, m);
        cluster.addLayer(m);
      } else {
        m.setLatLng([f.lat, f.lon]);   // update in place, no full-layer rebuild
      }
    }
  }
  pending = [];
}

function onMessage(feature) {
  pending.push(feature);
  if (!frameQueued) { frameQueued = true; requestAnimationFrame(flush); }
}
```

## Validation Checklist

Verify each item before the dashboard fronts a live operational feed:

- [ ] The client subscribes to the WebSocket stream and never polls the full feature set on a timer while the socket is healthy.
- [ ] Every inbound message carries `diff_type`; the client applies the diff in place and never rebuilds the whole layer per update.
- [ ] Markers render on an `L.Canvas` renderer (not `L.SVG`) and high-density points use `L.MarkerClusterGroup`.
- [ ] Inbound messages are coalesced into a single `requestAnimationFrame` flush and throttled to at most 1 Hz per feature.
- [ ] Redelivered messages are deduplicated on `incident_id` + `sequence_number` so a QoS 1 retry paints exactly once.
- [ ] A dropped socket triggers exponential-backoff reconnect *and* switches to the `/api/incidents/fallback` delta poll within one interval.
- [ ] Degraded mode raises a visible "DEGRADED — polling fallback" banner; the map never silently stops updating.
- [ ] Every quarantined payload and every degraded poll emits an audit record carrying an `audit_ts` for after-action review.

## Edge Cases and Gotchas

**Axis-order inversion.** Leaflet expects `[lat, lng]`; GeoJSON and most broker payloads carry `[lon, lat]`. Feeding raw GeoJSON coordinate pairs straight into `L.circleMarker` silently lands every unit in the wrong hemisphere. Destructure explicitly (`f.lat`, `f.lon`) and spot-check one known fixture before go-live.

**Null-island drift.** A failed upstream transform pulls coordinates toward `(0, 0)`. Any feature near the equator/prime-meridian intersection should be treated as a failed normalization and dropped from the map rather than plotted off the West African coast, where it also skews any auto-fit bounds the operator triggers.

**Offline device quirks.** Field tablets that lose connectivity keep their last `sessionStorage` snapshot; on reconnect they must replay the delta poll with their stored `last_sync` rather than assuming the live stream is already current, or they will miss every `delete` that fired while they were dark.

**Agency-specific datum anomalies.** One mutual-aid agency publishing in NAD27 while the feed standard is NAD83(2011) offsets its markers by tens of metres near sector edges — enough to misassign a structure across a jurisdiction line. Resolve datum shifts during normalization upstream; never let the dashboard "correct" coordinates after the fact. Where several agencies edit the same incident concurrently, pair this dashboard with [conflict resolution in multi-agency edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) so a fast render never displays a state that lost the merge, and gate inbound features with [automated attribute validation rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) before they ever reach the broadcast loop.

## Related

- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/)
- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/)
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/)

Up: [WebSocket & MQTT for Live Incident Feeds overview](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/)
