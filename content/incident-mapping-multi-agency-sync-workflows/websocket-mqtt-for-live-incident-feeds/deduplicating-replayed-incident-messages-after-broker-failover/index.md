---
title: "Deduplicating Replayed Incident Messages After Broker Failover"
description: "Stop QoS 1 broker failover from double-counting incident messages: derive a stable idempotency key, keep a bounded dedup window, apply exactly-once effects at the consumer, preserve per-key ordering, and audit every suppressed replay."
slug: deduplicating-replayed-incident-messages-after-broker-failover
type: article
breadcrumb: "Deduplicating Replayed Messages"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Deduplicating Replayed Incident Messages After Broker Failover",
      "description": "Stop QoS 1 broker failover from double-counting incident messages: derive a stable idempotency key, keep a bounded dedup window, apply exactly-once effects at the consumer, preserve per-key ordering, and audit every suppressed replay.",
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
        { "@type": "ListItem", "position": 3, "name": "WebSocket & MQTT for Live Incident Feeds", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/" },
        { "@type": "ListItem", "position": 4, "name": "Deduplicating Replayed Incident Messages After Broker Failover", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/deduplicating-replayed-incident-messages-after-broker-failover/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Deduplicate replayed incident messages after an MQTT broker failover",
      "description": "Derive a stable idempotency key from message content, check it against a bounded dedup window, apply each incident effect exactly once at the consumer, preserve per-key ordering, and emit an audit record for every suppressed replay.",
      "step": [
        { "@type": "HowToStep", "name": "Derive a stable idempotency key", "text": "Compute the key from producer-controlled fields — agency, source id, and event sequence — not from broker-assigned metadata, so a replayed copy hashes identically to the original." },
        { "@type": "HowToStep", "name": "Check a bounded dedup window", "text": "Look the key up in a time-bounded or size-bounded store; a hit means the message already had its effect and this delivery is a failover replay to suppress." },
        { "@type": "HowToStep", "name": "Apply the effect exactly once", "text": "Only first-seen keys mutate the operational store, and the effect is written together with the key so a crash cannot leave the effect applied but the key unrecorded." },
        { "@type": "HowToStep", "name": "Preserve per-key ordering", "text": "Reject an out-of-order sequence for a key that has already advanced so a late replay cannot overwrite newer state on the Common Operating Picture." },
        { "@type": "HowToStep", "name": "Audit every suppression", "text": "Record the key, reason, and sequence for each dropped replay so operators can prove no genuine incident update was lost." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does an MQTT broker failover produce duplicate messages?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "At QoS 1, at-least-once delivery, the broker holds an in-flight message until the consumer acknowledges it. If the broker fails over to a standby before that acknowledgement is durably recorded, the standby re-delivers every unacknowledged message from its persisted session state. The consumer that already processed the original now receives an identical copy, so the same incident update is applied twice unless it is deduplicated."
          }
        },
        {
          "@type": "Question",
          "name": "Why not just use MQTT 5 QoS 2 for exactly-once delivery?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "QoS 2 guarantees exactly-once delivery of a packet between one client and one broker, but it does not survive a failover to a broker that never saw the four-way handshake, and it says nothing about a producer that re-publishes after its own reconnect. Exactly-once effect has to be enforced at the consumer with an idempotency key and a dedup window, which also protects against duplicates the transport layer can never see."
          }
        },
        {
          "@type": "Question",
          "name": "How large should the deduplication window be?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "It must be at least as long as the maximum time a message can survive in a failed-over broker's persisted session plus the worst-case producer replay delay — typically several minutes for MQTT session expiry. Size it as a committed parameter, bound it by both time and entry count so it cannot grow without limit, and back it with a durable store so the window is not lost when the consumer itself restarts."
          }
        }
      ]
    }
  ]
}
</script>

# Deduplicating Replayed Incident Messages After Broker Failover

At 02:14 a hurricane band takes down the primary message broker carrying the live incident feed. A standby promotes itself in under a second, and the operations floor barely notices — except that the Common Operating Picture (COP) now shows a structure-fire incident with a reported casualty count of six, when the field only ever reported three. Two engine-status updates that had already turned a unit "available" have flipped it back to "assigned". Nothing malfunctioned: the standby broker did exactly what at-least-once delivery promises, re-delivering every message the failed broker had not yet seen acknowledged. The consumer that already applied those updates has now applied them a second time. This page solves that one narrow, dangerous failure mode — turning a burst of replayed messages after a broker failover into a stream where every incident effect lands exactly once, without ever silently dropping a genuine update.

## Root Cause and Operational Impact

Message Queuing Telemetry Transport (MQTT) and every comparable broker default to at-least-once semantics for reliable topics: QoS 1. The broker persists an in-flight message and keeps re-sending it until the consumer returns a `PUBACK`. That acknowledgement is what lets the broker forget the message. When the primary fails over to a standby, the standby restores its state from the last persisted, replicated session — which almost always predates the acknowledgements that were in flight at the moment of failure. So the standby re-delivers messages the original consumer already processed. The transport did not lie; at-least-once means at-least-once, and a failover is precisely when the "more than once" case fires.

The impact is not cosmetic. An incident feed carries state transitions that are frequently non-idempotent by nature: increment a casualty tally, append a resource to an assignment, advance an incident to a new operational period. Apply any of those twice and the operational store diverges from ground truth. A double-counted casualty figure drives a mutual-aid request that pulls units off other incidents. A replayed "assigned" event re-commits an engine that dispatch had already released. Because the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both require that the decision record be reconstructable for after-action review, a COP that quietly absorbed duplicate updates is not defensible — and neither is one that dropped a real update while trying to suppress a fake one. The correct behaviour is exactly-once *effect* at the consumer, enforced with an idempotency key and a bounded dedup window, and it belongs in the same feed layer described in [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) rather than trusted to the broker's delivery guarantee alone.

<svg viewBox="0 0 880 440" role="img" aria-label="Sequence diagram of broker failover replay and consumer-side deduplication. A publisher sends incident messages with sequence numbers to a primary broker, which delivers them to the consumer; the consumer applies each effect and records its idempotency key. The primary broker fails, a standby promotes and replays the unacknowledged messages, and the consumer recognises their keys in the dedup window, suppresses the duplicates, and emits an audit record while the Common Operating Picture receives each effect exactly once." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Broker failover replay and consumer-side deduplication by idempotency key</title>
  <desc>A publisher emits incident messages carrying producer-controlled sequence numbers to a primary broker at QoS 1. The primary delivers them to the consumer, which derives an idempotency key, applies the incident effect once, and stores the key in a bounded dedup window. The primary broker then fails and a standby promotes itself, restoring session state that predates the in-flight acknowledgements, so it replays the same messages. The consumer finds their keys already present in the dedup window, suppresses the replays, emits an audit record for each, and the Common Operating Picture receives every effect exactly once.</desc>
  <defs>
    <marker id="dedup-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
    <marker id="dedup-arrow-crimson" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <!-- lifelines -->
  <g font-size="11.5" font-weight="700" fill="currentColor" text-anchor="middle">
    <text x="90" y="30">Publisher</text>
    <text x="330" y="30">Broker (primary → standby)</text>
    <text x="640" y="30">Consumer + dedup window</text>
    <text x="820" y="30">COP</text>
  </g>
  <g stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.5">
    <line x1="90" y1="40" x2="90" y2="410"/>
    <line x1="330" y1="40" x2="330" y2="410"/>
    <line x1="640" y1="40" x2="640" y2="410"/>
    <line x1="820" y1="40" x2="820" y2="410"/>
  </g>
  <!-- first delivery: publish seq 41 -->
  <path d="M90,70 H330" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#dedup-arrow)"/>
  <text x="210" y="63" font-size="10" text-anchor="middle" fill="currentColor">publish seq 41 · QoS 1</text>
  <path d="M330,96 H640" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#dedup-arrow)"/>
  <text x="485" y="89" font-size="10" text-anchor="middle" fill="currentColor">deliver seq 41</text>
  <!-- apply + store key -->
  <rect x="560" y="112" width="160" height="34" rx="6" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.3"/>
  <text x="640" y="127" font-size="9.5" text-anchor="middle" fill="currentColor">key A1 first-seen →</text>
  <text x="640" y="139" font-size="9.5" text-anchor="middle" fill="currentColor">apply · store key</text>
  <path d="M720,129 H820" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#dedup-arrow)"/>
  <text x="770" y="122" font-size="9.5" text-anchor="middle" fill="currentColor">effect #1</text>
  <!-- failover marker -->
  <g transform="translate(330,182)">
    <line x1="-12" y1="-12" x2="12" y2="12" stroke="var(--crimson, currentColor)" stroke-width="2.4"/>
    <line x1="-12" y1="12" x2="12" y2="-12" stroke="var(--crimson, currentColor)" stroke-width="2.4"/>
  </g>
  <text x="330" y="210" font-size="10.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">primary fails · standby promotes</text>
  <text x="330" y="224" font-size="9.5" text-anchor="middle" fill="var(--crimson, currentColor)">session state predates PUBACK</text>
  <!-- replay -->
  <path d="M330,252 H640" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#dedup-arrow-crimson)"/>
  <text x="485" y="245" font-size="10" text-anchor="middle" fill="var(--crimson, currentColor)">replay seq 41 (unacked)</text>
  <!-- dedup suppress -->
  <rect x="556" y="268" width="168" height="46" rx="6" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
  <text x="640" y="284" font-size="9.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">key A1 already seen</text>
  <text x="640" y="297" font-size="9.5" text-anchor="middle" fill="var(--crimson, currentColor)">suppress replay</text>
  <text x="640" y="309" font-size="9.5" text-anchor="middle" fill="var(--crimson, currentColor)">emit audit record</text>
  <!-- no effect to COP -->
  <path d="M724,291 H812" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" stroke-dasharray="5 5"/>
  <g transform="translate(806,291)">
    <line x1="-7" y1="-7" x2="7" y2="7" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <line x1="-7" y1="7" x2="7" y2="-7" stroke="var(--crimson, currentColor)" stroke-width="2"/>
  </g>
  <text x="768" y="284" font-size="9.5" text-anchor="middle" fill="var(--crimson, currentColor)">no second effect</text>
  <!-- next genuine message seq 42 -->
  <path d="M90,344 H330" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#dedup-arrow)"/>
  <text x="210" y="337" font-size="10" text-anchor="middle" fill="currentColor">publish seq 42</text>
  <path d="M330,370 H640" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#dedup-arrow)"/>
  <text x="485" y="363" font-size="10" text-anchor="middle" fill="currentColor">deliver seq 42</text>
  <path d="M640,392 H820" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#dedup-arrow)"/>
  <text x="732" y="385" font-size="9.5" text-anchor="middle" fill="currentColor">key A2 first-seen → effect #2</text>
</svg>

## Tiered Resolution Strategy

Resolve the stream in ordered tiers, from the definitive fix down to a safe default that always leaves an audit trail. The governing rule: suppress a proven duplicate, but never discard a message you cannot prove is one — an incident update lost to over-aggressive deduplication is worse than a duplicate caught later.

1. **Derive a stable idempotency key (definitive).** Hash producer-controlled fields — agency identifier, source device id, and a monotonic event sequence — into one key. Because the key comes from the payload, a broker replay of the identical bytes hashes to the identical key, while two genuinely distinct events never collide.
2. **Check a bounded dedup window.** Look the key up in a store bounded by both time and entry count. A hit means the effect already happened and this delivery is a replay; a miss means first-seen. The window must outlive the longest possible failover replay delay.
3. **Apply the effect exactly once, atomically.** Only first-seen keys mutate the operational store, and the effect plus the key are committed together so a crash can never leave the effect applied but the key unrecorded — which would re-open the duplicate on restart.
4. **Preserve per-key ordering.** Track the highest sequence seen per source. A replay carrying a sequence at or below the last applied value for that source is rejected even if the key store was trimmed, so a late replay can never overwrite newer COP state.
5. **Suppress with a full audit record (safe default).** Every dropped message emits an entry — key, source, sequence, reason — so an after-action reviewer can confirm each suppression removed a true duplicate and no genuine update vanished.

Everything in tier one turns on one distinction, and getting it wrong produces a deduplicator that is worse than no deduplicator because it looks like one.

<svg viewBox="0 0 880 400" role="img" aria-labelledby="ik-t ik-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ik-t">Which fields may enter the idempotency key, and which silently break it</title>
  <desc id="ik-d">Seven candidate fields for an idempotency key. The agency identifier, incident identifier, sequence number and a hash of the payload body are all producer-controlled and stable across a republish, so they belong in the key. The broker's message identifier, the receiver's arrival timestamp and the topic partition are all transport metadata that changes when a message is replayed after a failover, so including any one of them produces a key that never repeats — which means the deduplicator runs, consumes resources, reports healthy, and suppresses nothing at all. The distinguishing test is whether the field would be identical if the same producer sent the same message twice.</desc>
  <rect x="0" y="0" width="880" height="400" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the test: would this field be identical if the producer sent the same message twice?</text>
  <text x="8" y="76" font-size="10" fill="var(--muted)">candidate field</text>
  <rect x="200" y="90" width="270" height="30" rx="6" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="216" y="110" font-size="10.5" font-weight="700" fill="currentColor">agency_id</text>
  <text x="490" y="110" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">in the key</text>
  <text x="620" y="110" font-size="10" fill="var(--muted)">producer-controlled, stable</text>
  <rect x="200" y="128" width="270" height="30" rx="6" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="216" y="148" font-size="10.5" font-weight="700" fill="currentColor">incident_id</text>
  <text x="490" y="148" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">in the key</text>
  <text x="620" y="148" font-size="10" fill="var(--muted)">producer-controlled, stable</text>
  <rect x="200" y="166" width="270" height="30" rx="6" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="216" y="186" font-size="10.5" font-weight="700" fill="currentColor">sequence_number</text>
  <text x="490" y="186" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">in the key</text>
  <text x="620" y="186" font-size="10" fill="var(--muted)">producer-controlled, stable</text>
  <rect x="200" y="204" width="270" height="30" rx="6" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="216" y="224" font-size="10.5" font-weight="700" fill="currentColor">payload body hash</text>
  <text x="490" y="224" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">in the key</text>
  <text x="620" y="224" font-size="10" fill="var(--muted)">producer-controlled, stable</text>
  <rect x="200" y="242" width="270" height="30" rx="6" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.5"/>
  <text x="216" y="262" font-size="10.5" font-weight="700" fill="currentColor">broker message_id</text>
  <text x="490" y="262" font-size="10.5" font-weight="700" fill="var(--ember-text)">never in the key</text>
  <text x="620" y="262" font-size="10" fill="var(--muted)">regenerated on republish</text>
  <rect x="200" y="280" width="270" height="30" rx="6" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.5"/>
  <text x="216" y="300" font-size="10.5" font-weight="700" fill="currentColor">received_at timestamp</text>
  <text x="490" y="300" font-size="10.5" font-weight="700" fill="var(--ember-text)">never in the key</text>
  <text x="620" y="300" font-size="10" fill="var(--muted)">differs on every delivery</text>
  <rect x="200" y="318" width="270" height="30" rx="6" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.5"/>
  <text x="216" y="338" font-size="10.5" font-weight="700" fill="currentColor">topic partition</text>
  <text x="490" y="338" font-size="10.5" font-weight="700" fill="var(--ember-text)">never in the key</text>
  <text x="620" y="338" font-size="10" fill="var(--muted)">reassigned on failover</text>
  <rect x="200" y="356" width="640" height="34" rx="7" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.6"/>
  <text x="216" y="378" font-size="10.5" font-weight="700" fill="var(--ember-text)">one transport field in the key = a deduplicator that suppresses nothing and reports healthy</text>
</svg>

The failure is specific and quiet. Include the broker's `message_id` and every replayed message hashes to a key that has never been seen, so nothing is suppressed. The dedup store fills, the counters increment, the health check passes — and duplicate incidents land in the Common Operating Picture at exactly the rate they would without the layer. Nobody investigates a component that is running.

The rule that catches all three bad fields is to ask whether the producer controls the value. `agency_id`, `incident_id` and `sequence_number` are written by the device that observed the incident and travel with the payload; a republish carries the identical values because it is the identical payload. `message_id`, arrival time and partition are assigned by the transport, and the whole premise of a failover is that the transport changed.

Hashing the payload body alongside the identifiers is worth the extra bytes. It catches the case where a producer reuses a sequence number after a restart — genuinely different content under a colliding identifier — which the identifier triple alone would suppress as a duplicate. That is the opposite error and rarer, but it loses real data rather than admitting redundant data, so it deserves the cheaper defence.

## Production Python Implementation

The consumer below carries the full resolution path: idempotency-key derivation, a bounded dedup window with time and size limits, per-source ordering enforcement, exactly-once effect application, structured logging, explicit exception handling, and an immutable audit record for every suppressed replay. The dedup window and ordering map are shown in-process for clarity; in production, back them with a durable store (Redis with a TTL, or a small table) so the window survives a consumer restart. Thresholds are parameters, not literals, so they can be committed alongside the feed contract. Senior-engineer assumptions apply: message payloads are already decoded dictionaries, and the effect applier is injected so this component stays transport- and schema-agnostic.

```python
from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Optional

logger = logging.getLogger("incidentgis.dedup")


class Outcome(str, Enum):
    APPLIED = "applied"
    DUPLICATE = "duplicate_suppressed"
    STALE = "stale_out_of_order"
    MALFORMED = "malformed_rejected"


@dataclass
class IncidentMessage:
    agency: str
    source_id: str          # producer-controlled device / feed id
    sequence: int           # monotonic per (agency, source_id)
    payload: dict


@dataclass
class AuditEntry:
    """Immutable record of one dedup decision, emitted to the audit trail."""
    key: str
    source: str
    sequence: int
    outcome: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class ReplayDeduplicator:
    """Enforce exactly-once effect for an at-least-once incident feed.

    ``apply_effect`` is called only for first-seen, in-order messages. Every
    decision is logged and appended to ``audit_log`` so a corrected feed can be
    reconstructed against the exact window that produced it.
    """

    def __init__(
        self,
        apply_effect: Callable[[IncidentMessage], None],
        window_seconds: float = 600.0,
        max_entries: int = 100_000,
    ) -> None:
        self._apply_effect = apply_effect
        self.window_seconds = window_seconds
        self.max_entries = max_entries
        # key -> epoch seconds seen; OrderedDict gives O(1) FIFO eviction.
        self._seen: "OrderedDict[str, float]" = OrderedDict()
        # (agency, source_id) -> highest applied sequence.
        self._high_water: dict[tuple[str, str], int] = {}
        self.audit_log: list[AuditEntry] = []

    @staticmethod
    def idempotency_key(msg: IncidentMessage) -> str:
        """Stable key from producer-controlled fields only — never broker metadata."""
        raw = f"{msg.agency}|{msg.source_id}|{msg.sequence}".encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def _evict(self, now: float) -> None:
        """Bound the window by both age and size so it cannot grow without limit."""
        cutoff = now - self.window_seconds
        while self._seen:
            key, ts = next(iter(self._seen.items()))
            if ts < cutoff or len(self._seen) > self.max_entries:
                self._seen.popitem(last=False)
            else:
                break

    def _audit(self, key: str, msg: IncidentMessage, outcome: Outcome) -> None:
        entry = AuditEntry(
            key=key, source=f"{msg.agency}/{msg.source_id}",
            sequence=msg.sequence, outcome=outcome.value,
        )
        self.audit_log.append(entry)
        logger.info("dedup_decision", extra={"audit": asdict(entry)})

    def process(self, msg: IncidentMessage) -> Outcome:
        now = datetime.now(timezone.utc).timestamp()
        try:
            # Guard: a malformed message can never advance state silently.
            if not msg.agency or not msg.source_id or msg.sequence < 0:
                self._audit("<none>", msg, Outcome.MALFORMED)
                return Outcome.MALFORMED

            key = self.idempotency_key(msg)
            self._evict(now)

            # Tier 2: already in the window → this is a failover replay.
            if key in self._seen:
                self._seen.move_to_end(key)
                self._audit(key, msg, Outcome.DUPLICATE)
                return Outcome.DUPLICATE

            # Tier 4: ordering guard catches replays evicted from the window.
            src = (msg.agency, msg.source_id)
            last = self._high_water.get(src)
            if last is not None and msg.sequence <= last:
                self._audit(key, msg, Outcome.STALE)
                return Outcome.STALE

            # Tier 3: first-seen and in-order → record key + apply effect together.
            # Recording the key before the effect keeps a retry idempotent even
            # if apply_effect raises; on failure we roll the key back below.
            self._seen[key] = now
            try:
                self._apply_effect(msg)
            except Exception:
                del self._seen[key]      # allow a genuine redelivery to retry
                raise
            self._high_water[src] = msg.sequence
            self._audit(key, msg, Outcome.APPLIED)
            return Outcome.APPLIED

        except Exception as exc:
            # Never let one bad message stall the feed; surface it for replay.
            logger.error("dedup_process_failed", exc_info=exc,
                         extra={"source": f"{msg.agency}/{msg.source_id}"})
            raise
```

The `audit_log` is the load-bearing output. Persisted as a committed, append-only artifact, it lets a post-incident reviewer replay every decision and confirm that each suppression removed a true duplicate — the reproducibility guarantee that keeps a deduplicated feed defensible and interoperable with downstream [conflict resolution in multi-agency edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/).

Tier two says "bounded by both time and entry count", and the conjunction is doing real work — each bound alone fails, in opposite directions.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="bw-t bw-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="bw-t">Why the dedup window needs both a time bound and an entry bound</title>
  <desc id="bw-d">Two failure modes bound the deduplication store from different directions. Bounded only by time, at a 24-hour window, a surge producing 90,000 messages an hour accumulates 2.16 million keys and the store exhausts memory before the window expires. Bounded only by entry count, at 100,000 entries, that same surge evicts the oldest keys after about 67 minutes, so a broker failover replaying messages from 90 minutes earlier finds none of them remembered and every replayed message is admitted as new. Applying both bounds together means the store is capped in memory and the eviction age is observable: when entries start being evicted below the intended time window, that is a signal to raise the cap, not a silent loss of protection.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">a surge at 90,000 messages/hour, against each bound alone</text>
  <rect x="40" y="76" width="380" height="200" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <rect x="460" y="76" width="380" height="200" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="104" font-size="11" font-weight="700" fill="currentColor">time bound only · 24 h</text>
  <text x="480" y="104" font-size="11" font-weight="700" fill="currentColor">entry bound only · 100 k</text>
  <text x="60" y="136" font-size="10.5" fill="currentColor">2,160,000 keys accumulate before</text>
  <text x="60" y="154" font-size="10.5" fill="currentColor">anything expires</text>
  <text x="480" y="136" font-size="10.5" fill="currentColor">oldest keys evicted after ~67 min</text>
  <text x="480" y="154" font-size="10.5" fill="currentColor">of surge traffic</text>
  <text x="60" y="192" font-size="11" font-weight="700" fill="var(--ember-text)">the store runs out of memory</text>
  <text x="60" y="212" font-size="10" fill="currentColor">and takes the consumer with it</text>
  <text x="480" y="192" font-size="11" font-weight="700" fill="var(--ember-text)">a 90-minute replay is all new</text>
  <text x="480" y="212" font-size="10" fill="currentColor">protection silently lapses</text>
  <text x="60" y="248" font-size="10" fill="var(--muted)">loud failure — you find out</text>
  <text x="480" y="248" font-size="10" fill="var(--muted)">silent failure — you do not</text>
  <rect x="40" y="296" width="800" height="60" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="60" y="322" font-size="11" font-weight="700" fill="var(--crimson-deep)">both bounds together</text>
  <text x="60" y="342" font-size="10.5" fill="currentColor">memory is capped, and the eviction age becomes an observable: evicting below the intended window is an alert, not a loss.</text>
</svg>

The asymmetry is what decides the design. Running out of memory is a loud failure: the consumer dies, something pages, and the fix is obvious. A lapsed window is silent, and it lapses precisely during a surge — the condition that also makes a broker failover likely, which is the condition the deduplicator exists for. So the entry bound is not a safety net for the time bound; it is the thing that will actually fire, and its firing must be visible.

That is why the useful instrumentation is not the store's size but the *age of the oldest entry it still holds*. When that age is 24 hours, the time bound is governing and everything is nominal. When it drops to 67 minutes, the entry cap is governing, the effective protection window has shrunk by a factor of twenty, and somebody should know before the failover rather than after it. Export it as a gauge and alert on it falling below the intended window — it is one metric that turns the silent failure into the loud one.

## Validation Checklist

Verify every item before deploying the deduplicator to a live incident feed.

- [ ] The idempotency key is derived from producer-controlled fields only — never from broker-assigned message ids or timestamps that change on replay.
- [ ] The dedup window is bounded by both time and entry count, and `window_seconds` exceeds the maximum failover replay delay plus MQTT session expiry.
- [ ] The window and per-source high-water marks are backed by a durable store so a consumer restart does not re-open every recent duplicate.
- [ ] The key is recorded together with the effect atomically; a crash cannot leave the effect applied but the key unrecorded, or vice versa.
- [ ] A replay whose key was already evicted is still caught by the per-source ordering guard and never overwrites newer COP state.
- [ ] The first message from a new source (no high-water mark yet) is applied without raising.
- [ ] Malformed messages are audited and rejected, never applied silently.
- [ ] Every suppression appears in `audit_log` and routes to the incident logging sink, not stdout.

## Edge Cases and Gotchas

- **Non-monotonic producer sequences.** The whole scheme rests on a sequence that only ever increases per source. A device that resets its counter on reboot will emit low sequences that the ordering guard rejects as stale. Namespace the sequence with a boot-session id, or fold a producer restart epoch into the key so a legitimate post-reboot message is first-seen rather than a false duplicate.
- **Window shorter than the replay delay.** If a broker persists an unacknowledged message for longer than `window_seconds`, its key is evicted before the replay arrives and the ordering guard becomes the only line of defence. Size the window against the broker's real session-expiry and retry configuration, not an optimistic guess.
- **Effect that is itself non-idempotent on retry.** Recording the key before `apply_effect` and rolling it back on failure keeps retries safe only if the effect is transactional. If the applier writes to an external system that partially commits, wrap it so the key and the effect share one transaction, or the rollback re-opens the duplicate.
- **Fan-out to multiple consumers.** Where several consumers share a subscription for throughput, an in-process window on each one misses duplicates delivered to a different instance after failover. The dedup store must be shared across the consumer group, which is one more reason to keep it in a durable, central backend rather than local memory.
- **Legitimate resend versus replay.** A field app that re-publishes after its own reconnect looks identical to a broker replay — and that is correct: both carry the same producer sequence, so both hash to the same key and are suppressed. Only a genuinely new event with a new sequence should ever apply, which is why the key must never include the transport's delivery attempt.

## Frequently Asked Questions

**Why does an MQTT broker failover produce duplicate messages?** At QoS 1, at-least-once delivery, the broker holds an in-flight message until the consumer acknowledges it. If the broker fails over to a standby before that acknowledgement is durably recorded, the standby re-delivers every unacknowledged message from its persisted session state. The consumer that already processed the original now receives an identical copy, so the same incident update is applied twice unless it is deduplicated.

**Why not just use MQTT 5 QoS 2 for exactly-once delivery?** QoS 2 guarantees exactly-once delivery of a packet between one client and one broker, but it does not survive a failover to a broker that never saw the four-way handshake, and it says nothing about a producer that re-publishes after its own reconnect. Exactly-once effect has to be enforced at the consumer with an idempotency key and a dedup window, which also protects against duplicates the transport layer can never see.

**How large should the deduplication window be?** It must be at least as long as the maximum time a message can survive in a failed-over broker's persisted session plus the worst-case producer replay delay — typically several minutes for MQTT session expiry. Size it as a committed parameter, bound it by both time and entry count so it cannot grow without limit, and back it with a durable store so the window is not lost when the consumer itself restarts.

## Related

- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — the feed layer where at-least-once delivery and this deduplication contract live.
- [Handling MQTT Reconnect Storms During Wildfire Surge](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/handling-mqtt-reconnect-storms-during-wildfire-surge/) — the reconnect surge that most often triggers the replays this page suppresses.
- [Kafka vs RabbitMQ for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/kafka-vs-rabbitmq-for-live-incident-feeds/) — how a replayable log versus per-message acks changes where you place the dedup boundary.
- [Building a Live Incident Dashboard with Python and Leaflet](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/building-a-live-incident-dashboard-with-python-and-leaflet/) — the downstream consumer that must honour exactly-once effects on the map.

Up: [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/)
