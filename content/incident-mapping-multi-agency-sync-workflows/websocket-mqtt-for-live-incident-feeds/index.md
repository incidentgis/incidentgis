---
title: "WebSocket & MQTT for Live Incident Feeds"
description: "Production Python workflow for live incident feeds over WebSocket and MQTT: a resilient async bridge, GeoJSON schema gating, QoS tuning, reconnect backoff, and verifiable broadcast to EOC consoles."
slug: websocket-mqtt-for-live-incident-feeds
type: guide
breadcrumb: "WebSocket & MQTT for Live Incident Feeds"
datePublished: "2025-02-25"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "WebSocket & MQTT for Live Incident Feeds",
      "description": "Production Python workflow for live incident feeds over WebSocket and MQTT: a resilient async bridge, GeoJSON schema gating, QoS tuning, reconnect backoff, and verifiable broadcast to EOC consoles.",
      "datePublished": "2025-02-25",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Incident Mapping & Multi-Agency Sync", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/" },
        { "@type": "ListItem", "position": 3, "name": "WebSocket & MQTT for Live Incident Feeds", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Bridge MQTT field telemetry to WebSocket EOC consoles in Python",
      "description": "Subscribe to authenticated MQTT incident topics, validate each GeoJSON payload against a schema, normalize geometry to a single CRS, and fan out the result to connected WebSocket clients with reconnect backoff and structured audit logging.",
      "step": [
        { "@type": "HowToStep", "name": "Subscribe to MQTT telemetry", "text": "Connect over TLS to the field broker and subscribe to per-agency incident topics at QoS 1 so no field update is silently dropped." },
        { "@type": "HowToStep", "name": "Validate the GeoJSON payload", "text": "Gate every inbound message against a strict GeoJSON Feature schema at the ingestion boundary and route failures to a dead-letter path rather than the live feed." },
        { "@type": "HowToStep", "name": "Normalize geometry", "text": "Enforce EPSG:4326 axis order and coordinate precision, then stamp a normalization timestamp so the COP store and audit trail agree." },
        { "@type": "HowToStep", "name": "Broadcast to WebSocket clients", "text": "Fan the normalized Feature out to every authenticated EOC console, pruning closed connections, and bridge the synchronous MQTT callback to the asyncio loop thread-safely." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "When should I use MQTT versus WebSocket for a live incident feed?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Use MQTT for the field-to-core leg, where intermittent cellular, radio, or satellite links demand Quality of Service guarantees, retained messages, and last-will notifications. Use WebSocket for the core-to-console leg, where authenticated browsers in the Emergency Operations Center need low-latency, full-duplex push. A bridge process subscribes to MQTT and fans out over WebSocket so each protocol runs where it is strongest."
          }
        },
        {
          "@type": "Question",
          "name": "Why must the paho-mqtt callback hand work to the asyncio loop?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "paho-mqtt's on_message callback fires on the MQTT network loop thread, not the asyncio event loop. Calling an async coroutine or touching the WebSocket client set directly from that thread is a race condition. Use loop.call_soon_threadsafe or asyncio.run_coroutine_threadsafe to marshal the payload back onto the event loop before processing or broadcasting it."
          }
        },
        {
          "@type": "Question",
          "name": "What QoS level should incident telemetry use?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Use QoS 1 (at-least-once) for incident status and position updates: a duplicate is harmless because the COP merge is idempotent on incident_id, but a lost 'structure now active' message is a safety risk. Reserve QoS 2 (exactly-once) for low-volume command-and-control where duplicates are unacceptable, and accept its extra round-trips. QoS 0 is acceptable only for high-frequency, disposable signals such as raw GPS heartbeats."
          }
        }
      ]
    }
  ]
}
</script>

# WebSocket & MQTT for Live Incident Feeds

A wildland fire crosses a county line at 02:00 and three agencies converge on the same fireline. A type-1 engine pushes a "structure now active" status from a tablet on a marginal LTE signal; the message has to reach every Emergency Operations Center (EOC) console before the next resource-allocation decision is made. If that update rides a synchronous polling loop, it lands seconds-to-minutes late, and command staff commit crews against stale geometry. This workflow exists to close that gap: a deterministic, low-latency transport that carries live incident telemetry from constrained field devices all the way to dashboard consoles without dropping, reordering, or corrupting a single status change. It is the streaming spine that feeds the rest of the [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/) architecture — every downstream consumer assumes the feed is ordered, validated, and resilient to the network actually being down.

The protocol split is the core decision. WebSocket provides full-duplex, HTTP-upgraded channels ideal for pushing updates to authenticated browser consoles and receiving synchronous acknowledgments. MQTT, running over TCP with selectable Quality of Service (QoS) levels 0–2, is built for exactly the constrained field environments — intermittent cellular, radio, or satellite — where WebSocket's assumption of a stable connection breaks. The production pattern is not to pick one but to bridge them: subscribe to MQTT where the field lives, fan out over WebSocket where the operators sit.

## Prerequisites

This pattern is a transport layer; it moves already-validated geometry, it does not invent it. Before it runs, assume the following are in place:

- **Python packages:** `paho-mqtt >= 2.0` (the v2 callback API used below), `websockets >= 12` (asyncio-native server), `jsonschema >= 4.0` for the GeoJSON gate, and `shapely >= 2.0` / `pyproj >= 3.6` for the normalization hook. Python 3.11+ for `asyncio.TaskGroup` and timezone-aware `datetime`.
- **CRS contract:** the COP store is EPSG:4326 (WGS84 geographic coordinates). Field inputs in any other system must already be reprojected through the [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) standard before they reach this bridge; the normalization hook here enforces precision and axis order, it is not a place to repair a wrong CRS.
- **Schema contract:** payloads are RFC 7946 GeoJSON `Feature` objects whose `properties` carry the COP record fields (`incident_id`, `agency_id`, `status`, `timestamp`). Coordinates that arrive as raw addresses or drift-prone GPS must have already passed through [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/); this bridge rejects, it does not geocode.
- **Transport security:** the MQTT broker terminates TLS and the WebSocket endpoint is served over WSS, with mutual TLS (mTLS) for field-agent authentication. The bridge process holds the client certificate, never the field device's private key.

## Protocol topology and message routing

<svg viewBox="0 0 960 470" role="img" aria-label="Data-flow topology for the live incident feed. Three field sources — an engine tablet, an IoT sensor, and a drone — publish GeoJSON over TLS to an MQTT broker on topics shaped incident slash agency slash type slash telemetry. The Python bridge subscribes at QoS 1 with a reconnect-backoff loop on the MQTT leg, then runs three stages in order: validate against the GeoJSON schema, normalize geometry to EPSG:4326, and tap an audit log. Payloads that fail the schema branch off to a dead-letter queue and never reach a console. Validated, normalized Features fan out over WSS to three authenticated EOC consoles." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>MQTT-to-WebSocket incident feed: field publishers, QoS 1 bridge with validate/normalize/audit, dead-letter branch, WSS fan-out</title>
  <desc>Field sources (engine tablet, IoT sensor, drone) publish GeoJSON over TLS to an MQTT broker on topics incident/{agency}/{type}/telemetry. The Python bridge subscribes at QoS 1 — with a reconnect-backoff loop on the MQTT leg — and runs three ordered stages: validate against the GeoJSON Feature schema, normalize geometry to EPSG:4326 precision and axis order, then tap an audit log. Payloads that fail validation branch to a dead-letter queue and are never forwarded. Validated, normalized Features fan out over WSS to authenticated EOC consoles.</desc>
  <defs>
    <marker id="wm-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="wm-flow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- column headers -->
  <g font-size="11" text-anchor="middle" fill="currentColor" opacity="0.65" font-weight="600" letter-spacing="0.5">
    <text x="95" y="24">FIELD SOURCES</text>
    <text x="320" y="24">MQTT · TLS</text>
    <text x="565" y="24">PYTHON BRIDGE</text>
    <text x="875" y="24">EOC · WSS</text>
  </g>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <!-- field sources -->
    <rect x="22" y="58" width="146" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="95" y="83" font-size="11.5">Engine tablet</text>
    <rect x="22" y="118" width="146" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="95" y="143" font-size="11.5">IoT sensor</text>
    <rect x="22" y="178" width="146" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="95" y="203" font-size="11.5">Drone</text>
    <!-- broker -->
    <rect x="246" y="88" width="148" height="100" rx="9" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="320" y="118" font-weight="700">MQTT broker</text>
    <text x="320" y="138" font-size="10">topic pattern</text>
    <text x="320" y="153" font-size="9.5">incident/{agency}/</text>
    <text x="320" y="166" font-size="9.5">{type}/telemetry</text>
    <text x="320" y="182" font-size="9.5" opacity="0.7">subscribe + ·  QoS 1</text>
    <!-- bridge container -->
    <rect x="452" y="42" width="212" height="266" rx="11" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" stroke-dasharray="6 5" opacity="0.85"/>
    <!-- stage 1: validate -->
    <rect x="478" y="66" width="174" height="48" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="565" y="86" font-weight="600" font-size="11.5">1 · Validate</text>
    <text x="565" y="102" font-size="9.5" opacity="0.8">GeoJSON Feature schema</text>
    <!-- stage 2: normalize -->
    <rect x="478" y="146" width="174" height="48" rx="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="565" y="166" font-weight="600" font-size="11.5">2 · Normalize</text>
    <text x="565" y="182" font-size="9.5" opacity="0.8">EPSG:4326 · precision</text>
    <!-- stage 3: audit -->
    <rect x="478" y="226" width="174" height="48" rx="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="565" y="246" font-weight="600" font-size="11.5">3 · Audit tap</text>
    <text x="565" y="262" font-size="9.5" opacity="0.8">stamp normalized_at</text>
    <!-- dead-letter queue -->
    <rect x="700" y="66" width="150" height="48" rx="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/>
    <text x="775" y="86" font-size="11">Dead-letter queue</text>
    <text x="775" y="102" font-size="9.5" opacity="0.8">off-contract payloads</text>
    <!-- EOC consoles -->
    <rect x="802" y="148" width="146" height="38" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="875" y="172" font-size="11">EOC console A</text>
    <rect x="802" y="200" width="146" height="38" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="875" y="224" font-size="11">EOC console B</text>
    <rect x="802" y="252" width="146" height="38" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="875" y="276" font-size="11">EOC console C</text>
  </g>
  <!-- publish flows (field -> broker) -->
  <g fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#wm-flow-dim)">
    <path d="M168,78 C205,78 215,128 244,135"/>
    <path d="M168,138 H244"/>
    <path d="M168,198 C205,198 215,150 244,153"/>
  </g>
  <!-- subscribe leg broker -> bridge (primary) with reconnect-backoff loop -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6">
    <path d="M394,118 C424,118 432,90 476,90" marker-end="url(#wm-flow)"/>
  </g>
  <!-- reconnect-backoff self-loop on the MQTT leg -->
  <g fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="4 3">
    <path d="M420,140 C420,178 320,206 320,190" marker-end="url(#wm-flow-dim)"/>
  </g>
  <text x="372" y="214" font-size="9.5" fill="currentColor" opacity="0.75" text-anchor="middle">reconnect backoff 1–30 s</text>
  <!-- bridge internal stages -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#wm-flow)">
    <path d="M565,114 V144"/>
    <path d="M565,194 V224"/>
  </g>
  <!-- validate -> dead-letter (failure branch) -->
  <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#wm-flow-dim)">
    <path d="M652,90 H698"/>
  </g>
  <text x="681" y="84" font-size="9" fill="currentColor" opacity="0.7" text-anchor="middle">fail</text>
  <!-- audit -> fan-out to consoles over WSS -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#wm-flow)">
    <path d="M652,250 C720,250 740,167 800,167"/>
    <path d="M652,250 C730,250 745,219 800,219"/>
    <path d="M652,250 H800"/>
  </g>
  <text x="726" y="300" font-size="9.5" fill="currentColor" opacity="0.75" text-anchor="middle">WSS fan-out</text>
  <!-- caption -->
  <text x="480" y="350" font-size="10.5" fill="currentColor" opacity="0.6" text-anchor="middle">Field-to-core rides MQTT QoS 1; core-to-console rides WebSocket. The bridge is the only seam between them.</text>
</svg>

A production routing layer keeps the two legs cleanly separated. MQTT topics are hierarchical and filterable: subscribing to `incident/+/+/telemetry` captures every agency and every incident type with a single subscription, while `incident/FIRE/structure/#` narrows to one branch. The bridge applies topic filtering, payload decryption, and a spatial bounding-box pre-filter so out-of-area noise is dropped before it costs CPU. On the WebSocket side, frames go only to authenticated consoles, and async generators drive fan-out without blocking the event loop, so a burst of GPS pings never starves a status update.

Both legs serialize spatial payloads as GeoJSON so heterogeneous GIS backends stay interoperable. The bridge never invents its own wire format; it carries the same contract the COP store enforces.

## Step-by-step implementation

### Step 1 — Define the ingestion schema

Gate the feed at the boundary. A strict GeoJSON `Feature` schema rejects malformed or off-contract payloads before they can reach a console, which is what keeps a legacy CAD export from rendering as `unknown` on every map.

```python
from typing import Final

# Minimal RFC 7946 GeoJSON Feature schema for incident telemetry.
# properties carries the COP record contract enforced site-wide.
INCIDENT_SCHEMA: Final[dict] = {
    "type": "object",
    "required": ["type", "geometry", "properties"],
    "properties": {
        "type": {"const": "Feature"},
        "geometry": {
            "type": "object",
            "required": ["type", "coordinates"],
            "properties": {
                "type": {"enum": ["Point", "Polygon"]},
                "coordinates": {"type": "array"},
            },
        },
        "properties": {
            "type": "object",
            "required": ["incident_id", "agency_id", "status", "timestamp"],
            "properties": {
                "incident_id": {"type": "string"},
                "agency_id": {"type": "string"},
                "status": {"enum": ["active", "contained", "resolved"]},
                "timestamp": {"type": "string", "format": "date-time"},
            },
        },
    },
}
```

### Step 2 — Construct the bridge and subscribe over TLS

The bridge owns one MQTT client and one set of WebSocket clients. The MQTT callbacks are wired in `__post_init__`; subscription happens on connect so a reconnect re-subscribes automatically.

```python
import asyncio
import logging
import ssl
from dataclasses import dataclass, field
from typing import Optional, Set

import paho.mqtt.client as mqtt
import websockets

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(module)s:%(funcName)s | %(message)s",
)
logger = logging.getLogger("incident_feed_bridge")


@dataclass
class IncidentFeedBridge:
    mqtt_broker: str = "mqtt.emergency.local"
    mqtt_port: int = 8883
    ws_host: str = "0.0.0.0"
    ws_port: int = 8765
    ws_clients: Set[websockets.WebSocketServerProtocol] = field(default_factory=set)
    mqtt_client: Optional[mqtt.Client] = None
    loop: Optional[asyncio.AbstractEventLoop] = None

    def __post_init__(self) -> None:
        self.mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.mqtt_client.tls_set_context(ssl.create_default_ssl_context())
        self.mqtt_client.reconnect_delay_set(min_delay=1, max_delay=30)  # backoff
        self.mqtt_client.on_connect = self._on_mqtt_connect
        self.mqtt_client.on_message = self._on_mqtt_message
        self.mqtt_client.on_disconnect = self._on_mqtt_disconnect

    def _on_mqtt_connect(self, client, userdata, flags, rc, properties=None) -> None:
        if rc == 0:
            logger.info("MQTT broker connected; subscribing to incident topics")
            client.subscribe("incident/+/+/telemetry", qos=1)
        else:
            logger.error("MQTT connection refused with code %s", rc)

    def _on_mqtt_disconnect(self, client, userdata, flags, rc, properties=None) -> None:
        # paho's reconnect_delay_set drives automatic backoff; we only log here.
        logger.warning("MQTT disconnected (rc=%s); auto-reconnect with backoff", rc)
```

### Step 3 — Marshal the MQTT callback onto the event loop

`on_message` runs on paho's network-loop thread. Touching the WebSocket client set or awaiting a coroutine from there is a race condition, so hand the payload back to the asyncio loop explicitly.

```python
    def _on_mqtt_message(self, client, userdata, msg: mqtt.MQTTMessage) -> None:
        # Runs on the MQTT loop thread — never touch async state directly here.
        if self.loop is None:
            logger.error("Event loop not ready; dropping message on %s", msg.topic)
            return
        asyncio.run_coroutine_threadsafe(
            self._process_mqtt_payload(msg), self.loop
        )
```

### Step 4 — Validate, normalize, and audit each payload

Validation, geometry normalization, and the audit stamp happen in one coroutine. Failures are logged and dropped to a dead-letter path; they never reach a console.

```python
import json
from datetime import datetime, timezone

from jsonschema import ValidationError, validate


    async def _process_mqtt_payload(self, msg: mqtt.MQTTMessage) -> None:
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            validate(instance=payload, schema=INCIDENT_SCHEMA)
            normalized = self._normalize_geometry(payload)
            await self._broadcast_ws(json.dumps(normalized))
        except ValidationError as ve:
            # Dead-letter: log the raw payload, never forward off-contract data.
            logger.error(
                "Schema validation failed on %s: %s | %.100s",
                msg.topic, ve.message, msg.payload,
            )
        except json.JSONDecodeError:
            logger.error("Malformed JSON from edge agent on %s", msg.topic)
        except Exception:
            logger.exception("Unexpected error processing message on %s", msg.topic)

    def _normalize_geometry(self, feature: dict) -> dict:
        """Enforce EPSG:4326 precision and stamp the normalization time.

        CRS repair belongs upstream; this only rounds and audits. Six decimal
        places is ~0.1 m at the equator — enough for incident positioning
        without leaking floating-point noise into the COP diff.
        """
        geom = feature["geometry"]
        if geom["type"] == "Point":
            geom["coordinates"] = [round(c, 6) for c in geom["coordinates"]]
        feature["properties"]["normalized_at"] = (
            datetime.now(timezone.utc).isoformat()
        )
        return feature
```

### Step 5 — Fan out to WebSocket consoles and run the bridge

Broadcasting prunes closed connections so the client set never leaks. `start` captures the running loop for the callback thread, then runs the MQTT loop and the WebSocket server concurrently.

```python
from websockets.exceptions import ConnectionClosed


    async def _broadcast_ws(self, message: str) -> None:
        if not self.ws_clients:
            return
        disconnected: Set[websockets.WebSocketServerProtocol] = set()
        for client in self.ws_clients:
            try:
                await client.send(message)
            except ConnectionClosed:
                disconnected.add(client)
            except Exception:
                logger.exception("WebSocket broadcast error; pruning client")
                disconnected.add(client)
        self.ws_clients -= disconnected

    async def ws_handler(self, websocket: websockets.WebSocketServerProtocol) -> None:
        self.ws_clients.add(websocket)
        logger.info("EOC console connected: %s", websocket.remote_address)
        try:
            await websocket.wait_closed()
        finally:
            self.ws_clients.discard(websocket)

    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()  # callback thread marshals here
        self.mqtt_client.connect_async(self.mqtt_broker, self.mqtt_port, keepalive=60)
        self.mqtt_client.loop_start()
        logger.info("WebSocket server on wss://%s:%s", self.ws_host, self.ws_port)
        async with websockets.serve(self.ws_handler, self.ws_host, self.ws_port):
            await asyncio.Future()  # run until cancelled


if __name__ == "__main__":
    bridge = IncidentFeedBridge()
    try:
        asyncio.run(bridge.start())
    except KeyboardInterrupt:
        logger.info("Shutting down incident feed bridge")
```

## Configuration reference

Tune the bridge through these parameters; values are starting points for a county-scale EOC, not hard limits.

| Parameter | Default | Effect | When to change |
|-----------|---------|--------|----------------|
| `mqtt_port` | `8883` | TLS MQTT listener | Match the broker's secure listener; never use plain `1883` in production |
| Subscription QoS | `1` | At-least-once delivery | Raise to `2` only for command-and-control topics where duplicates are unacceptable |
| `keepalive` | `60` s | MQTT PING interval | Lower on flaky links so dead connections are detected sooner |
| `reconnect_delay_set` | `1`–`30` s | Backoff bounds on reconnect | Widen `max_delay` to avoid hammering a broker during a region-wide outage |
| Topic filter | `incident/+/+/telemetry` | Subscription breadth | Narrow per agency or type to shed load during surge |
| Coordinate precision | `6` places | Position resolution / diff noise | Drop to `5` (~1 m) for very high-frequency feeds |
| `ws_port` | `8765` | WebSocket listener | Front with a reverse proxy terminating WSS and enforcing origin checks |

## Verification and smoke-test

Confirm the full path — subscribe, validate, normalize, broadcast — in a staging environment before the bridge carries live traffic. The schema gate is the highest-value assertion, since it is the line between a clean COP and a corrupted one.

```python
import json

from jsonschema import ValidationError, validate


def test_schema_gate() -> None:
    good = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [-119.701, 34.420]},
        "properties": {
            "incident_id": "CA-2026-00481",
            "agency_id": "FIRE-014",
            "status": "active",
            "timestamp": "2026-06-25T02:00:00Z",
        },
    }
    validate(instance=good, schema=INCIDENT_SCHEMA)  # must not raise

    bad = json.loads(json.dumps(good))
    bad["properties"]["status"] = "smoldering"  # off-contract enum value
    try:
        validate(instance=bad, schema=INCIDENT_SCHEMA)
        raise AssertionError("schema gate let an off-contract status through")
    except ValidationError:
        pass  # expected — the gate rejected it


if __name__ == "__main__":
    test_schema_gate()
    print("schema gate OK")
```

Then prove the wire path with command-line tools. Publish a test Feature to the broker and confirm a WebSocket client receives the normalized result:

```bash
# Publish one valid Feature to the field broker over TLS
mosquitto_pub -h mqtt.emergency.local -p 8883 --cafile ca.crt \
  -t "incident/FIRE/structure/telemetry" -q 1 \
  -m '{"type":"Feature","geometry":{"type":"Point","coordinates":[-119.701,34.420]},"properties":{"incident_id":"CA-2026-00481","agency_id":"FIRE-014","status":"active","timestamp":"2026-06-25T02:00:00Z"}}'

# In another shell, confirm the console leg receives the normalized Feature
websocat wss://localhost:8765
# expect a Feature whose properties now include "normalized_at"
```

## Integration with adjacent workflows

The bridge is a junction, not an island. Inbound payloads must already have been canonicalised by [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) — this transport rejects bad geometry but never repairs it. Before a normalized Feature is committed to the operational store, it should pass through [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) so concurrent updates from overlapping jurisdictions converge deterministically; tagging every broadcast with `agency_id` and the source `timestamp` is what makes that merge replayable. The same schema gate used here is the runtime cousin of the rules in [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/), which govern the static contract. On the console side, the normalized GeoJSON is consumed by [Building a live incident dashboard with Python and Leaflet](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/building-a-live-incident-dashboard-with-python-and-leaflet/), which expects a `diff_type` field (`create` / `update` / `delete`) so the map applies incremental layer updates instead of full redraws during a telemetry burst. The transport security and reproducibility assumptions for all of this trace back to [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/).

## Troubleshooting

**Symptom: messages arrive on the broker but never reach a console.** Root cause: the MQTT callback touched async state from the network-loop thread, so the coroutine never ran on the event loop. Confirm `_on_mqtt_message` routes through `asyncio.run_coroutine_threadsafe(..., self.loop)` and that `self.loop` was captured in `start` before the first message can arrive.

**Symptom: the bridge reconnects in a tight loop and hammers the broker.** Root cause: reconnect backoff is unset, so paho retries immediately after every drop. Call `reconnect_delay_set(min_delay=1, max_delay=30)` so a region-wide outage produces exponential backoff rather than a thundering herd against the broker.

**Symptom: a closed console keeps the bridge logging send errors.** Root cause: the WebSocket client set is leaking dead connections. Verify `_broadcast_ws` collects `ConnectionClosed` clients into `disconnected` and subtracts them, and that `ws_handler` discards the socket in a `finally` block.

**Symptom: field updates are silently lost during a surge.** Root cause: the subscription is at QoS 0, so the broker drops messages it cannot deliver immediately. Subscribe at QoS 1 for status and position topics so at-least-once delivery survives momentary backpressure; the COP merge is idempotent on `incident_id`, so duplicates are harmless.

**Symptom: incidents render at the wrong location after a status push.** Root cause: a payload arrived with swapped axis order or an un-reprojected CRS and the normalization hook only rounded it. The hook is not a CRS repair point — enforce the upstream [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) contract so coordinates reach the bridge already in EPSG:4326, lon/lat order.

## Related

- [Building a live incident dashboard with Python and Leaflet](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/building-a-live-incident-dashboard-with-python-and-leaflet/) — the console that consumes this feed and applies incremental map updates
- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) — canonicalises raw payloads before they reach this transport
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — converges concurrent updates carried over the feed
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — the static-contract counterpart to the runtime schema gate here

Up: [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/)
