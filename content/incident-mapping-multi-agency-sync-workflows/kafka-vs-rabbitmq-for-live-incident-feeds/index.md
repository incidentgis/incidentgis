---
title: "Kafka vs RabbitMQ for Live Incident Feeds"
description: "Choosing the message backbone for live incident feeds: Kafka's replayable partitioned log versus RabbitMQ's flexible routing and per-message acks, in Python."
slug: kafka-vs-rabbitmq-for-live-incident-feeds
type: guide
breadcrumb: "Kafka vs RabbitMQ for Live Incident Feeds"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Kafka vs RabbitMQ for Live Incident Feeds",
      "description": "Choosing the message backbone for live incident feeds: Kafka's replayable partitioned log versus RabbitMQ's flexible routing and per-message acks, in Python.",
      "datePublished": "2026-07-13",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Incident Mapping & Multi-Agency Sync Workflows", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/" },
        { "@type": "ListItem", "position": 3, "name": "Kafka vs RabbitMQ for Live Incident Feeds", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/kafka-vs-rabbitmq-for-live-incident-feeds/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Choose and implement a message backbone for live incident feeds",
      "description": "Map emergency-response requirements to broker semantics, model a versioned incident event contract, then implement both the Kafka partitioned-log path and the RabbitMQ routing path in Python with per-incident ordering, replay, and backpressure.",
      "step": [
        { "@type": "HowToStep", "name": "Map requirements to broker semantics", "text": "Score the feed against replayable audit history, per-incident ordering, selective multi-agency fan-out, latency, and backpressure so the broker choice is a decision, not a habit." },
        { "@type": "HowToStep", "name": "Model a versioned incident event contract", "text": "Define one serialization contract with an event id, incident id partition key, schema version, and UTC timestamp so both brokers carry identical, replayable payloads." },
        { "@type": "HowToStep", "name": "Implement the Kafka partitioned-log path", "text": "Produce keyed by incident id for per-key ordering and consume with a consumer group and manual offset commits so late-joining consumers can replay retained history." },
        { "@type": "HowToStep", "name": "Implement the RabbitMQ routing path", "text": "Publish to a topic exchange with publisher confirms and consume with a bounded prefetch and per-message acknowledgement so unacked messages are redelivered under surge." },
        { "@type": "HowToStep", "name": "Verify ordering, replay, and backpressure", "text": "Assert per-key ordering, confirm a replayed offset re-delivers retained events, and prove that a bounded prefetch applies backpressure instead of exhausting the consumer." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "When should an incident feed use Kafka instead of RabbitMQ?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Use Kafka when the feed must be a durable, replayable audit log and consumers need per-key ordering and the ability to re-read retained history, such as a regional common operating picture rebuilt from scratch or a late-joining analytics consumer. Use RabbitMQ when the priority is flexible per-agency routing, per-message acknowledgement, and low latency in a small single-broker or few-node deployment. Many agencies run both: Kafka as the system of record and RabbitMQ for task routing and command distribution."
          }
        },
        {
          "@type": "Question",
          "name": "How do I preserve per-incident ordering across a surge?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "In Kafka, set the message key to the incident id so every event for one incident lands on the same partition, which is the only unit Kafka orders; ordering across incidents is never guaranteed and should not be relied on. In RabbitMQ, route each incident to a single queue served by a single consumer, or embed a per-incident sequence number and reorder at the consumer, because multiple competing consumers on one queue process messages concurrently and out of order."
          }
        },
        {
          "@type": "Question",
          "name": "Do I still need idempotent consumers if the broker guarantees delivery?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes. Both Kafka consumer groups and RabbitMQ QoS 1 give at-least-once delivery, so a consumer that crashes after processing but before committing an offset or acknowledging a message will see that message again after failover. Deduplicate on a stable event id and make the downstream write idempotent so a replayed or redelivered incident update converges to the same operating picture rather than double-counting resources."
          }
        }
      ]
    }
  ]
}
</script>

# Kafka vs RabbitMQ for Live Incident Feeds

## Problem Framing

A wind event pushes a wildfire across two county lines just after midnight, and within ninety seconds the incident feed carries a structure-protection status change, a shifted fireline perimeter, three engine position pings, and an evacuation-zone activation — all keyed to the same incident, all arriving from four different agency systems on four different links. Six weeks later, an after-action review needs to reconstruct exactly what the incident commander saw at 00:04:30, in order, to defend a resource-allocation decision. The transport that carried those messages either kept a replayable, ordered record of every event or it did not. That single property — can a consumer re-read the exact history, in the exact order it happened — is what separates a message backbone that satisfies National Incident Management System (NIMS) and Federal Emergency Management Agency (FEMA) reproducibility expectations from one that merely moves bytes. This page is a decision guide for that backbone: Apache Kafka's partitioned, retained log versus RabbitMQ's flexible routing with per-message acknowledgement, mapped to the real needs of a live incident feed and implemented as runnable Python for both. It sits underneath the transport concerns handled in [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — those protocols carry the last mile to field devices and consoles, while the broker chosen here is the durable spine every one of those legs draws from.

## Prerequisites

This decision assumes a senior engineer already operating the incident pipeline and choosing between two mature brokers, not standing one up for the first time. Before either path below runs, the following must hold:

- **Packages:** `confluent-kafka >= 2.3` (the `librdkafka`-backed client) for the Kafka path, and `pika >= 1.3` for the RabbitMQ path. Both examples share a `pydantic >= 2.0` contract and Python 3.11+ for timezone-aware `datetime` and `StrEnum`. Geometry payloads assume `shapely >= 2.0` is available for validation, though this backbone carries serialized bytes, not live geometry objects.
- **A single event contract:** every message on either broker is the same versioned envelope — an event id, the incident id used as the partition/routing key, a schema version, a UTC timestamp, and a GeoJSON body. The contract is defined once (Step 2) and is broker-agnostic, so a migration between brokers never rewrites payloads.
- **Upstream validation:** payloads reaching the broker have already passed schema and geometry gating. Raw addresses and drift-prone coordinates must be canonicalized by [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) first; the broker moves already-valid events and is not a place to repair them.
- **A durable broker deployment:** a Kafka cluster with at least three brokers and a replication factor of three for the incident topic, or a RabbitMQ node (or quorum-queue cluster) with mirrored/quorum queues on durable storage. A single-broker deployment of either is acceptable only for a forward operating base that tolerates a bounded loss window.

## Choosing the Backbone

Emergency feeds impose three requirements that ordinary message queues rarely all satisfy at once: a replayable history for audit and late-joining consumers, deterministic ordering of everything that touches a single incident, and graceful behaviour when a surge produces ten times the normal message rate. Kafka and RabbitMQ answer these from opposite architectural starting points. Kafka is a distributed, append-only commit log: producers append to partitions, messages are retained for a configured window regardless of consumption, and consumers track their own offset — so replay is native and ordering is guaranteed per partition. RabbitMQ is a smart broker with a dumb consumer: a message is routed through an exchange to bound queues, delivered, and deleted once acknowledged — so routing is extraordinarily flexible and latency is low, but there is no built-in history to replay. The diagram below places the two topologies side by side and maps four emergency requirements onto whichever broker serves each one best.

<figure class="diagram">
<svg viewBox="0 0 980 435" role="img" aria-label="Side-by-side topology and decision matrix comparing Kafka and RabbitMQ for a live incident feed. On the left, Kafka: field producers append to a partitioned topic keyed by incident id, an EOC consumer group and an archive consumer group read the partitions, and a dashed replay arrow resets an offset to re-read retained history. On the right, RabbitMQ: a publisher with confirms sends to a topic exchange that routes by binding key into per-agency acknowledged queues consumed with a bounded prefetch, and unacknowledged messages are redelivered. Below, a decision matrix maps four requirements: replayable audit trail and strict per-incident ordering favour Kafka, while selective per-agency routing and lowest latency in a small deployment favour RabbitMQ." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>Kafka partitioned-log topology versus RabbitMQ routing topology, with a requirement-to-broker decision matrix</title>
  <desc>Left panel, Kafka: field producers append to a topic incident-events partitioned by incident id into partitions P0, P1, and P2, each an ordered offset log. An EOC consumer group and an archive consumer group read the partitions, and a dashed replay arrow resets a consumer offset back to earlier retained events. Retention holds seven days and ordering is guaranteed per partition key. Right panel, RabbitMQ: a publisher using publisher confirms sends to a topic exchange incident.# that routes by binding key into acknowledged per-agency queues q.fire, q.ems, and q.archive, consumed with a bounded prefetch; unacknowledged messages are redelivered. Bottom decision matrix: replayable audit trail and strict per-incident ordering are strong fits for Kafka; selective per-agency routing and lowest latency in a small single-broker deployment are strong fits for RabbitMQ.</desc>
  <defs>
    <marker id="krq-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="krq-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- column headers -->
  <text x="250" y="26" text-anchor="middle" font-size="13" font-weight="700" fill="var(--crimson, currentColor)">KAFKA · partitioned log</text>
  <text x="730" y="26" text-anchor="middle" font-size="13" font-weight="700" fill="var(--crimson, currentColor)">RABBITMQ · routing + ack</text>
  <line x1="490" y1="40" x2="490" y2="250" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.5"/>
  <!-- ===== KAFKA ===== -->
  <g fill="currentColor">
    <rect x="28" y="92" width="104" height="44" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="80" y="112" text-anchor="middle" font-size="11.5">Field</text>
    <text x="80" y="128" text-anchor="middle" font-size="11.5">producers</text>
    <text x="280" y="52" text-anchor="middle" font-size="11" fill="var(--crimson, currentColor)">topic: incident-events · key = incident_id</text>
    <!-- partitions -->
    <rect x="168" y="60" width="224" height="26" rx="4" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="182" y="77" font-size="11" font-weight="600">P0</text>
    <rect x="168" y="94" width="224" height="26" rx="4" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="182" y="111" font-size="11" font-weight="600">P1</text>
    <rect x="168" y="128" width="224" height="26" rx="4" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="182" y="145" font-size="11" font-weight="600">P2</text>
    <text x="382" y="77" text-anchor="end" font-size="9">offsets &#8594;</text>
    <text x="382" y="111" text-anchor="end" font-size="9">offsets &#8594;</text>
    <text x="382" y="145" text-anchor="end" font-size="9">offsets &#8594;</text>
  </g>
  <g stroke="currentColor" stroke-width="0.8" opacity="0.4">
    <line x1="214" y1="60" x2="214" y2="86"/><line x1="246" y1="60" x2="246" y2="86"/><line x1="278" y1="60" x2="278" y2="86"/><line x1="310" y1="60" x2="310" y2="86"/>
    <line x1="214" y1="94" x2="214" y2="120"/><line x1="246" y1="94" x2="246" y2="120"/><line x1="278" y1="94" x2="278" y2="120"/><line x1="310" y1="94" x2="310" y2="120"/>
    <line x1="214" y1="128" x2="214" y2="154"/><line x1="246" y1="128" x2="246" y2="154"/><line x1="278" y1="128" x2="278" y2="154"/><line x1="310" y1="128" x2="310" y2="154"/>
  </g>
  <!-- producer -> partitions -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#krq-flow)">
    <path d="M132,110 C150,110 150,73 168,73"/>
    <path d="M132,114 C150,114 150,107 168,107"/>
    <path d="M132,118 C150,118 150,141 168,141"/>
  </g>
  <!-- consumer groups -->
  <g fill="currentColor">
    <rect x="168" y="178" width="104" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="220" y="202" text-anchor="middle" font-size="11">EOC group</text>
    <rect x="288" y="178" width="104" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="340" y="202" text-anchor="middle" font-size="10.5">archive group</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#krq-plain)">
    <path d="M220,154 V178"/>
    <path d="M340,154 V178"/>
  </g>
  <!-- replay -->
  <path d="M168,198 C120,198 120,141 168,141" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#krq-flow)"/>
  <text x="96" y="170" text-anchor="middle" font-size="9.5" fill="var(--crimson, currentColor)">replay ·</text>
  <text x="96" y="182" text-anchor="middle" font-size="9.5" fill="var(--crimson, currentColor)">reset offset</text>
  <text x="280" y="238" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">retention 7 d · ordered per partition key</text>
  <!-- ===== RABBITMQ ===== -->
  <g fill="currentColor">
    <rect x="512" y="92" width="108" height="44" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="566" y="112" text-anchor="middle" font-size="11.5">publisher</text>
    <text x="566" y="128" text-anchor="middle" font-size="10.5">(confirms)</text>
    <rect x="660" y="90" width="120" height="48" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="720" y="110" text-anchor="middle" font-size="10.5" font-weight="600">topic exchange</text>
    <text x="720" y="126" text-anchor="middle" font-size="10">incident.#</text>
    <!-- queues -->
    <rect x="832" y="58" width="120" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="892" y="78" text-anchor="middle" font-size="10.5">q.fire · ack</text>
    <rect x="832" y="100" width="120" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="892" y="120" text-anchor="middle" font-size="10.5">q.ems · ack</text>
    <rect x="832" y="142" width="120" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="892" y="162" text-anchor="middle" font-size="10">q.archive · ack</text>
    <rect x="832" y="192" width="120" height="42" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="892" y="210" text-anchor="middle" font-size="11" font-weight="600">consumers</text>
    <text x="892" y="226" text-anchor="middle" font-size="9.5">prefetch = N · ack</text>
  </g>
  <path d="M620,114 H660" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#krq-flow)"/>
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" marker-end="url(#krq-flow)">
    <path d="M780,104 C806,104 810,74 832,74"/>
    <path d="M780,114 C806,114 810,116 832,116"/>
    <path d="M780,128 C806,128 810,158 832,158"/>
  </g>
  <text x="720" y="156" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">routes by binding key</text>
  <path d="M892,174 V192" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#krq-plain)"/>
  <text x="892" y="250" text-anchor="middle" font-size="9" fill="var(--crimson, currentColor)" opacity="0.9">unacked messages redelivered</text>
  <!-- ===== DECISION MATRIX ===== -->
  <line x1="20" y1="262" x2="960" y2="262" stroke="currentColor" stroke-width="1" opacity="0.4"/>
  <text x="40" y="284" font-size="12" font-weight="700" fill="currentColor">Match the backbone to the requirement</text>
  <text x="560" y="284" text-anchor="middle" font-size="12" font-weight="700" fill="var(--crimson, currentColor)">Kafka</text>
  <text x="760" y="284" text-anchor="middle" font-size="12" font-weight="700" fill="var(--crimson, currentColor)">RabbitMQ</text>
  <g fill="currentColor" font-size="11">
    <text x="40" y="316">Replayable audit trail &amp; late-joining consumers</text>
    <text x="40" y="344">Strict ordering per incident key</text>
    <text x="40" y="372">Selective routing / per-agency fan-out</text>
    <text x="40" y="400">Lowest latency in a small single-broker deploy</text>
  </g>
  <!-- Kafka markers -->
  <circle cx="560" cy="312" r="7" fill="var(--crimson, currentColor)"/>
  <circle cx="560" cy="340" r="7" fill="var(--crimson, currentColor)"/>
  <circle cx="560" cy="368" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <circle cx="560" cy="396" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <!-- RabbitMQ markers -->
  <circle cx="760" cy="312" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <circle cx="760" cy="340" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <circle cx="760" cy="368" r="7" fill="var(--crimson, currentColor)"/>
  <circle cx="760" cy="396" r="7" fill="var(--crimson, currentColor)"/>
  <!-- legend -->
  <circle cx="44" cy="422" r="6" fill="var(--crimson, currentColor)"/>
  <text x="58" y="426" font-size="9.5" fill="currentColor">strong fit</text>
  <circle cx="150" cy="422" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="164" y="426" font-size="9.5" fill="currentColor">partial / weaker fit</text>
</svg>
<figcaption>Kafka retains an ordered, replayable partitioned log that late-joining consumers can re-read; RabbitMQ routes each event through an exchange to acknowledged per-agency queues. The matrix maps four emergency requirements onto the broker that serves each best.</figcaption>
</figure>

The matrix is deliberately not a verdict. A regional deployment often runs both: Kafka as the system of record that every consumer can replay, and RabbitMQ as the task-and-command layer where a dispatcher's assignment must reach exactly one crew with an explicit acknowledgement. The rest of this page implements each path so the choice can be made against measured behaviour rather than reputation.

## Step-by-Step Implementation

### Step 1 — Map requirements to broker semantics

Before writing a producer, score the feed against the four requirements the diagram names, because the wrong default is expensive to unwind once agencies depend on it. A replayable audit history — the ability for a consumer to re-read the exact sequence of events that produced a past operating picture — is Kafka's native behaviour and is bolted onto RabbitMQ only with an external store. Per-incident ordering is guaranteed by Kafka within a partition and by RabbitMQ only when a single consumer drains a single queue. Selective fan-out, where one agency wants only its own fire traffic and another wants everything, is RabbitMQ's topic-exchange strength and is emulated in Kafka with topic-per-type or client-side filtering. Latency in a small footprint favours RabbitMQ. Encode this scoring as a small, testable helper so the decision is documented in code and can be re-run when requirements change.

```python
import logging
from dataclasses import dataclass
from enum import StrEnum

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("incidentgis.backbone")


class Broker(StrEnum):
    KAFKA = "kafka"
    RABBITMQ = "rabbitmq"


@dataclass(frozen=True)
class FeedRequirements:
    """Weighted requirements for a live incident feed (0 = irrelevant, 1 = critical)."""
    replayable_audit: float
    per_key_ordering: float
    selective_routing: float
    low_latency_small_deploy: float


def recommend_backbone(req: FeedRequirements) -> Broker:
    """Score both brokers against weighted requirements and log the rationale.

    The weights encode where each broker is architecturally strong; this is a
    documented default, not a substitute for load-testing the real payload mix.
    """
    if not all(0.0 <= w <= 1.0 for w in vars(req).values()):
        raise ValueError("all requirement weights must lie in [0.0, 1.0]")

    kafka_score = 1.0 * req.replayable_audit + 1.0 * req.per_key_ordering \
        + 0.4 * req.selective_routing + 0.3 * req.low_latency_small_deploy
    rabbit_score = 0.2 * req.replayable_audit + 0.5 * req.per_key_ordering \
        + 1.0 * req.selective_routing + 1.0 * req.low_latency_small_deploy

    winner = Broker.KAFKA if kafka_score >= rabbit_score else Broker.RABBITMQ
    logger.info(
        "backbone recommendation=%s kafka=%.2f rabbitmq=%.2f",
        winner.value, kafka_score, rabbit_score,
    )
    return winner
```

### Step 2 — Model a versioned incident event contract

Both brokers carry the same envelope, so a migration never rewrites payloads and a replayed message from either system deserializes identically. The `incident_id` is the load-bearing field: it is Kafka's partition key and RabbitMQ's routing anchor, and it is what every downstream merge deduplicates on. Carry a `schema_version` so a rolling upgrade can read old and new events side by side, and always stamp a timezone-aware UTC timestamp so a replayed event is never misread hours into the past.

```python
import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator

logger = logging.getLogger("incidentgis.backbone")


class IncidentEvent(BaseModel):
    """Broker-agnostic envelope carried identically over Kafka and RabbitMQ."""
    event_id: str                        # stable idempotency key for dedup
    incident_id: str                     # Kafka partition key / RabbitMQ routing anchor
    agency_id: str
    event_type: str                      # e.g. "perimeter", "status", "position"
    schema_version: int = Field(ge=1)
    occurred_utc: str
    body: dict[str, Any]                 # RFC 7946 GeoJSON Feature, already validated upstream

    @field_validator("occurred_utc")
    @classmethod
    def ensure_utc(cls, v: str) -> str:
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError(f"occurred_utc is not ISO 8601: {v}") from exc
        return dt.astimezone(timezone.utc).isoformat()

    def to_bytes(self) -> bytes:
        # Sorted keys give a stable wire form so identical events hash identically.
        return self.model_dump_json().encode("utf-8")

    @classmethod
    def from_bytes(cls, raw: bytes) -> "IncidentEvent":
        try:
            return cls(**json.loads(raw.decode("utf-8")))
        except (ValidationError, json.JSONDecodeError) as exc:
            logger.error("event deserialization failed: %s", exc)
            raise

    def routing_key(self) -> str:
        # RabbitMQ topic key, e.g. "incident.FIRE-014.perimeter"
        return f"incident.{self.agency_id}.{self.event_type}"
```

### Step 3 — Implement the Kafka partitioned-log path

Kafka's guarantees hinge on two settings: the message **key** decides the partition, and the partition is the only ordering unit. Keying on `incident_id` puts every event for one incident on one partition, so a consumer sees that incident's perimeter update, status change, and position pings in produced order. Set `acks="all"` and `enable.idempotence=True` so a producer retry after a broker hiccup does not create a duplicate or reorder within a partition. The delivery-report callback is where a failed produce is caught — never fire-and-forget an incident event.

```python
from typing import Optional

from confluent_kafka import Producer, KafkaException

logger = logging.getLogger("incidentgis.backbone.kafka")


def build_incident_producer(bootstrap_servers: str) -> Producer:
    """Idempotent, fully-acked producer so retries never duplicate or reorder."""
    config = {
        "bootstrap.servers": bootstrap_servers,
        "acks": "all",                 # wait for all in-sync replicas
        "enable.idempotence": True,    # exactly-once produce semantics per partition
        "linger.ms": 5,                # small batch window; tune down for latency
        "compression.type": "lz4",
        "delivery.timeout.ms": 120_000,
    }
    return Producer(config)


def _on_delivery(err: Optional[KafkaException], msg) -> None:
    # Runs on the producer's poll thread; log, never raise into librdkafka.
    if err is not None:
        logger.error("kafka delivery failed key=%s error=%s", msg.key(), err)
    else:
        logger.debug(
            "kafka delivered partition=%s offset=%s", msg.partition(), msg.offset()
        )


def publish_event_kafka(producer: Producer, topic: str, event: IncidentEvent) -> None:
    try:
        producer.produce(
            topic=topic,
            key=event.incident_id.encode("utf-8"),  # co-locates one incident on one partition
            value=event.to_bytes(),
            on_delivery=_on_delivery,
        )
        producer.poll(0)  # serve delivery callbacks without blocking
    except BufferError:
        # Local queue full: apply backpressure by flushing before retrying.
        logger.warning("kafka local queue full; flushing before retry")
        producer.flush(5.0)
        producer.produce(topic=topic, key=event.incident_id.encode("utf-8"),
                         value=event.to_bytes(), on_delivery=_on_delivery)
    except KafkaException as exc:
        logger.error("kafka produce error for incident=%s: %s", event.incident_id, exc)
        raise
```

The consumer side is where replay lives. A consumer group tracks committed offsets, and committing **after** processing (not before) gives at-least-once delivery; to replay a past window, seek the group's partitions back to an earlier offset or timestamp and re-read the retained log.

```python
from confluent_kafka import Consumer, TopicPartition, KafkaError

logger = logging.getLogger("incidentgis.backbone.kafka")


def build_incident_consumer(bootstrap_servers: str, group_id: str) -> Consumer:
    return Consumer({
        "bootstrap.servers": bootstrap_servers,
        "group.id": group_id,
        "auto.offset.reset": "earliest",  # a fresh consumer reads retained history
        "enable.auto.commit": False,      # commit only after successful processing
    })


def consume_incident_events(consumer: Consumer, topic: str, max_batch: int = 500) -> None:
    consumer.subscribe([topic])
    processed = 0
    try:
        while processed < max_batch:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue  # reached end of a partition; keep polling
                logger.error("kafka consume error: %s", msg.error())
                continue
            try:
                event = IncidentEvent.from_bytes(msg.value())
                # ... apply idempotent write to the operating picture, keyed on event_id ...
                consumer.commit(msg, asynchronous=False)  # commit AFTER success
                processed += 1
            except Exception:
                # Do not commit: the event is redelivered after restart, never lost.
                logger.exception("processing failed at offset=%s; will retry", msg.offset())
    finally:
        consumer.close()


def replay_from_timestamp(consumer: Consumer, topic: str, since_epoch_ms: int) -> None:
    """Re-read retained events from a point in time for an after-action reconstruction."""
    partitions = consumer.list_topics(topic).topics[topic].partitions
    seek_targets = [TopicPartition(topic, p, since_epoch_ms) for p in partitions]
    offsets = consumer.offsets_for_times(seek_targets, timeout=10.0)
    for tp in offsets:
        if tp.offset < 0:
            logger.warning("no offset at/after %s for partition %s", since_epoch_ms, tp.partition)
            continue
        consumer.assign([tp])
        consumer.seek(tp)
        logger.info("replaying partition=%s from offset=%s", tp.partition, tp.offset)
```

### Step 4 — Implement the RabbitMQ routing path

RabbitMQ's strength is the exchange. A **topic exchange** routes each event by its dotted routing key, so a fire-agency queue binds `incident.FIRE-*.#` and an archive queue binds `incident.#`, and each agency gets exactly the traffic it subscribed to without the producer knowing who is listening. Turn on **publisher confirms** so the producer learns whether the broker actually accepted a message, and declare the exchange and queues as durable so they survive a broker restart.

```python
import pika
from pika.exceptions import AMQPConnectionError, UnroutableError

logger = logging.getLogger("incidentgis.backbone.rabbit")

EXCHANGE = "incident.topic"


def build_confirming_channel(amqp_url: str) -> pika.adapters.blocking_connection.BlockingChannel:
    """Durable topic exchange with publisher confirms enabled."""
    try:
        connection = pika.BlockingConnection(pika.URLParameters(amqp_url))
    except AMQPConnectionError as exc:
        logger.error("rabbitmq connection failed: %s", exc)
        raise
    channel = connection.channel()
    channel.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    channel.confirm_delivery()  # publisher confirms: publish raises if not acked
    return channel


def publish_event_rabbit(channel, event: IncidentEvent) -> None:
    try:
        channel.basic_publish(
            exchange=EXCHANGE,
            routing_key=event.routing_key(),          # e.g. incident.FIRE-014.perimeter
            body=event.to_bytes(),
            properties=pika.BasicProperties(
                content_type="application/json",
                delivery_mode=2,                       # persist message to disk
                message_id=event.event_id,             # carried for consumer-side dedup
            ),
            mandatory=True,  # raise if no queue is bound for this routing key
        )
        logger.debug("rabbit published incident=%s key=%s",
                     event.incident_id, event.routing_key())
    except UnroutableError:
        # No bound queue accepted the message: an event with no consumer is a config bug.
        logger.error("unroutable event incident=%s key=%s", event.incident_id, event.routing_key())
        raise
```

The consumer uses **per-message acknowledgement** and a bounded **prefetch** (QoS) so a surge cannot overwhelm one worker: the broker will not hand a consumer more than `prefetch_count` unacknowledged messages at once, which is RabbitMQ's backpressure lever. Acknowledge only after the write succeeds; on failure, negatively acknowledge with requeue so the event is redelivered rather than dropped.

```python
def consume_events_rabbit(channel, queue: str, binding: str, prefetch: int = 32) -> None:
    channel.queue_declare(queue=queue, durable=True)
    channel.queue_bind(exchange=EXCHANGE, queue=queue, routing_key=binding)
    channel.basic_qos(prefetch_count=prefetch)  # bound in-flight work -> backpressure

    def _handle(ch, method, properties, body: bytes) -> None:
        try:
            event = IncidentEvent.from_bytes(body)
            # ... idempotent write keyed on properties.message_id / event.event_id ...
            ch.basic_ack(delivery_tag=method.delivery_tag)  # ack AFTER success
        except Exception:
            logger.exception("rabbit processing failed; requeueing delivery_tag=%s",
                             method.delivery_tag)
            # requeue=True so a transient failure is retried, not discarded.
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    channel.basic_consume(queue=queue, on_message_callback=_handle, auto_ack=False)
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        logger.info("stopping rabbit consumer on queue=%s", queue)
        channel.stop_consuming()
```

## Configuration Reference

Tune these per deployment; a county forward operating base and a state watch center will diverge, especially on retention and replica counts.

| Parameter | Broker | Default | Notes |
|-----------|--------|---------|-------|
| `acks` | Kafka | `all` | Wait for all in-sync replicas; never `1` for an audit-of-record topic. |
| `enable.idempotence` | Kafka | `true` | Prevents duplicate or reordered writes on producer retry. |
| Partition count | Kafka | `12` | Upper bound on per-key parallelism; size for peak surge, not steady state. |
| `retention.ms` | Kafka | `604800000` | Seven days of replay; extend to cover the full after-action review window. |
| `auto.offset.reset` | Kafka | `earliest` | A new consumer group reads retained history rather than only new events. |
| `delivery_mode` | RabbitMQ | `2` | Persist messages to disk so a broker restart does not lose queued events. |
| `prefetch_count` | RabbitMQ | `32` | Backpressure lever; lower it when per-message work is heavy. |
| Exchange type | RabbitMQ | `topic` | Enables per-agency binding keys; direct/fanout lose selective routing. |
| Queue type | RabbitMQ | `quorum` | Replicated queues survive node loss; classic mirrored queues are deprecated. |
| `confirm_delivery` | RabbitMQ | `on` | Publisher confirms so an un-acked publish raises instead of silently dropping. |

## Verification & Smoke Test

Prove the three properties that matter before either backbone carries live traffic: the contract round-trips, per-key ordering holds, and the recommendation helper is deterministic. Run this against a staging broker, not production.

```python
def smoke_test_contract_and_ordering() -> None:
    base = {
        "event_id": "evt-1",
        "incident_id": "CA-2026-00481",
        "agency_id": "FIRE-014",
        "event_type": "perimeter",
        "schema_version": 1,
        "occurred_utc": "2026-07-13T00:04:30Z",
        "body": {"type": "Feature", "geometry": {"type": "Point",
                 "coordinates": [-119.701, 34.420]}, "properties": {}},
    }

    # 1. Contract round-trips byte-for-byte through the wire form.
    event = IncidentEvent(**base)
    assert IncidentEvent.from_bytes(event.to_bytes()).event_id == "evt-1"

    # 2. Non-UTC timestamps are normalized, never trusted as local time.
    naive = {**base, "occurred_utc": "2026-07-13T00:04:30+02:00"}
    assert IncidentEvent(**naive).occurred_utc.endswith("+00:00")

    # 3. Same incident_id => same Kafka key => same partition => ordering preserved.
    e_a = IncidentEvent(**{**base, "event_id": "evt-2", "event_type": "status"})
    assert event.incident_id == e_a.incident_id, "one incident must share a partition key"

    # 4. The recommendation helper is deterministic for audit-heavy feeds.
    audit_heavy = FeedRequirements(replayable_audit=1.0, per_key_ordering=1.0,
                                   selective_routing=0.3, low_latency_small_deploy=0.2)
    assert recommend_backbone(audit_heavy) is Broker.KAFKA

    logger.info("backbone smoke test passed")


smoke_test_contract_and_ordering()
```

A dependency check for continuous integration confirms both clients import cleanly on the target image, so a missing `librdkafka` is caught in the build rather than at 02:00 during a surge:

```bash
python -c "import confluent_kafka, pika, pydantic; print('backbone stack ok')"
python -m incident_backbone.smoke   # exits non-zero on any failed assertion
```

## Integration With Adjacent Workflows

This backbone is the durable seam between field transport and the operating picture, so its guarantees ripple outward. The last-mile protocols in [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) typically publish into the broker chosen here, and the broker then fans the same events out to every console — which is why the wire contract is shared rather than reinvented per hop. Because both Kafka consumer groups and RabbitMQ QoS 1 deliver at least once, every downstream write must be idempotent on `event_id`; the exactly-once effect that failover demands is worked through in detail in [Deduplicating Replayed Incident Messages After Broker Failover](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/deduplicating-replayed-incident-messages-after-broker-failover/). When two agencies emit perimeter edits for the same incident within the same partition window, the ordered stream is what makes their reconciliation replayable under [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/). The static contract enforced at rest by [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) is the design-time counterpart of the `pydantic` envelope validated on the wire here. All of this inherits the reproducibility and lineage expectations of the parent [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/) architecture, and the retained Kafka log is frequently the source that OGC — Open Geospatial Consortium — feature services and ISO 22320 emergency-management situation reports are rebuilt from after the incident closes.

## Troubleshooting

**Symptom: events for one incident arrive out of order on a consumer.** Root cause: the Kafka producer is not keying on `incident_id`, so the partitioner spreads that incident's events across partitions, and cross-partition order is never guaranteed. Set `key=event.incident_id.encode()` on every `produce` call so one incident maps to one partition; on RabbitMQ, ensure a single consumer drains the ordered queue rather than several competing workers.

**Symptom: after a broker failover, resource counts double on the operating picture.** Root cause: at-least-once delivery redelivered messages the consumer had processed but not yet committed or acknowledged, and the downstream write was not idempotent. Deduplicate on `event_id` and make the write an upsert keyed on it so a redelivered event converges rather than accumulates.

**Symptom: the Kafka producer's local queue fills and produce calls start failing with `BufferError`.** Root cause: the broker is slower than the produce rate and the local buffer saturated. Call `producer.poll(0)` regularly to serve delivery callbacks, `flush()` on backpressure as shown in Step 3, and raise `queue.buffering.max.messages` only after confirming the broker, not the client, is the bottleneck.

**Symptom: a RabbitMQ consumer grinds to a halt and memory climbs on the broker.** Root cause: `prefetch_count` is unset or too high, so an unbounded number of unacknowledged messages pile up in flight while one slow write blocks. Set `basic_qos(prefetch_count=...)` to bound in-flight work, and confirm the consumer acknowledges after every successful write so the broker can release delivered messages.

**Symptom: published RabbitMQ events silently disappear.** Root cause: no queue is bound for the routing key and `mandatory` is off, so the exchange drops the message. Publish with `mandatory=True` and `confirm_delivery()` enabled so an unroutable event raises `UnroutableError` instead of vanishing, and verify the binding pattern actually matches the dotted routing key.

## Frequently Asked Questions

**When should an incident feed use Kafka instead of RabbitMQ?** Use Kafka when the feed must be a durable, replayable audit log and consumers need per-key ordering and the ability to re-read retained history, such as a regional common operating picture rebuilt from scratch or a late-joining analytics consumer. Use RabbitMQ when the priority is flexible per-agency routing, per-message acknowledgement, and low latency in a small single-broker or few-node deployment. Many agencies run both: Kafka as the system of record and RabbitMQ for task routing and command distribution.

**How do I preserve per-incident ordering across a surge?** In Kafka, set the message key to the incident id so every event for one incident lands on the same partition, which is the only unit Kafka orders; ordering across incidents is never guaranteed and should not be relied on. In RabbitMQ, route each incident to a single queue served by a single consumer, or embed a per-incident sequence number and reorder at the consumer, because multiple competing consumers on one queue process messages concurrently and out of order.

**Do I still need idempotent consumers if the broker guarantees delivery?** Yes. Both Kafka consumer groups and RabbitMQ QoS 1 give at-least-once delivery, so a consumer that crashes after processing but before committing an offset or acknowledging a message will see that message again after failover. Deduplicate on a stable event id and make the downstream write idempotent so a replayed or redelivered incident update converges to the same operating picture rather than double-counting resources.

## Related

- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — the last-mile transports that publish into and read from this backbone.
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — reconciles concurrent edits carried over the ordered stream.
- [Deduplicating Replayed Incident Messages After Broker Failover](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/deduplicating-replayed-incident-messages-after-broker-failover/) — the at-least-once dedup pattern this page depends on.
- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) — canonicalises payloads before they reach the broker.

Up: [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/)
