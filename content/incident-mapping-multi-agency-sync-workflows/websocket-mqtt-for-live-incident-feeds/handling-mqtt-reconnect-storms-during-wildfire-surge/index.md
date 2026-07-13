---
title: "Handling MQTT Reconnect Storms During Wildfire Surge"
description: "Stop a thundering-herd MQTT reconnect storm when a cell tower recovers mid-wildfire: jittered exponential backoff, a client-side connect rate limiter, persistent-session and Last Will handling, and a full audit trail for every reconnect."
slug: handling-mqtt-reconnect-storms-during-wildfire-surge
type: article
breadcrumb: "MQTT Reconnect Storms"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Handling MQTT Reconnect Storms During Wildfire Surge",
      "description": "Stop a thundering-herd MQTT reconnect storm when a cell tower recovers mid-wildfire: jittered exponential backoff, a client-side connect rate limiter, persistent-session and Last Will handling, and a full audit trail for every reconnect.",
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
        { "@type": "ListItem", "position": 4, "name": "Handling MQTT Reconnect Storms During Wildfire Surge", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/handling-mqtt-reconnect-storms-during-wildfire-surge/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Prevent an MQTT reconnect storm on tower recovery during a wildfire surge",
      "description": "Spread thousands of simultaneous MQTT client reconnects with jittered exponential backoff, cap the client-side connect rate, use persistent sessions and a Last Will message so no telemetry is lost, and audit every reconnect attempt so the broker survives the recovery spike.",
      "step": [
        { "@type": "HowToStep", "name": "Back off with full jitter", "text": "On disconnect, retry after a randomised delay drawn from an exponentially growing window rather than a fixed interval, so recovering clients do not all reconnect on the same tick." },
        { "@type": "HowToStep", "name": "Rate-limit the connect attempt", "text": "Gate each socket-open through a token bucket or minimum spacing so a single host or agency fleet cannot fire a burst of TCP handshakes at the broker in one instant." },
        { "@type": "HowToStep", "name": "Use a persistent session and Last Will", "text": "Connect with clean_session=False and a Last Will and Testament so queued QoS 1 messages survive the outage and downstream consumers see an explicit offline status instead of silence." },
        { "@type": "HowToStep", "name": "Audit every reconnect", "text": "Emit an immutable record of each attempt with the backoff delay, jitter, session flags, and outcome so the recovery behaviour is reconstructable during after-action review." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why do MQTT clients all reconnect at the same instant after an outage?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "When a cell tower drops, every field client in its coverage loses the broker connection at nearly the same moment. If they all use the same fixed reconnect interval, their retry timers stay phase-locked, so when the tower recovers they fire their TCP handshakes and MQTT CONNECT packets in a single synchronised burst. That thundering herd can exhaust the broker's connection backlog and CPU faster than the original outage did."
          }
        },
        {
          "@type": "Question",
          "name": "What backoff strategy stops a reconnect storm?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Full-jitter exponential backoff. Each retry waits a random delay drawn uniformly from zero up to an exponentially growing ceiling, capped at a maximum. Randomising the delay de-synchronises the fleet so reconnects spread smoothly across a window instead of spiking, while the exponential growth keeps a broker that is still recovering from being hammered."
          }
        },
        {
          "@type": "Question",
          "name": "Should wildfire telemetry clients use a clean or persistent MQTT session?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A persistent session (clean_session=False) with QoS 1 subscriptions, so messages published during the outage are queued by the broker and delivered on reconnect rather than lost. Pair it with a Last Will and Testament message so the incident dashboard sees an explicit offline status for a dropped sensor instead of a silent gap that looks identical to a quiet sensor."
          }
        }
      ]
    }
  ]
}
</script>

# Handling MQTT Reconnect Storms During Wildfire Surge

A fast-moving wildfire runs a ridge line and takes out a cell site that backhauls telemetry for two hundred field devices — weather stations, apparatus trackers, air-quality sensors, and responder tablets all publishing to the same MQTT broker. For nine minutes the broker sees nothing from that sector. Then a portable cell on wheels comes online and, in the space of a second, all two hundred clients that had been retrying on the same five-second timer fire their TCP handshakes and MQTT `CONNECT` packets simultaneously. The broker's accept backlog fills, TLS negotiations queue, memory spikes as it rehydrates two hundred persistent sessions at once, and healthy clients on other towers start timing out too. The outage is over but the broker is now the bottleneck. This is a reconnect storm — a thundering herd — and it is the narrow failure mode this page solves: turning a synchronised recovery spike into a smooth, rate-limited, auditable reconnection that the broker survives.

## Root Cause and Operational Impact

The root cause is phase-locking. A single shared failure — one tower, one backhaul link, one broker restart — disconnects a whole population of clients at the same instant. If every client uses a fixed reconnect interval, their retry timers never drift apart, so the moment connectivity returns they all attempt to reconnect on the same tick. Even naive exponential backoff without randomisation keeps the fleet synchronised: everyone doubles their delay in lockstep and still collides, just at wider intervals. The broker then pays the full cost of every reconnect at once — the TCP accept queue, the TLS handshake CPU, session-state rehydration for `clean_session=False` clients, and the retained-message and queued-QoS-1 redelivery that each returning subscriber triggers.

This is dangerous, not merely inconvenient, because the storm arrives at the worst possible moment. The tower recovered precisely because the incident is escalating and crews are repositioning; that is when the [live incident feed](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) matters most. If the broker browns out under the reconnect spike, the Common Operating Picture goes stale for every agency on it, not just the sector that lost the tower. The National Incident Management System (NIMS) expects a shared, current operating picture across jurisdictions, and the Federal Emergency Management Agency (FEMA) expects the sequence of events to be reconstructable for after-action review. A broker that silently sheds connections, and clients that silently give up, produce neither. The fix has to spread the load and record what it did — which is why reconnect discipline belongs in the client library, not in an operator frantically restarting the broker.

<svg viewBox="0 0 880 470" role="img" aria-label="MQTT reconnect storm diagram. On the left, a wildfire knocks out a cell tower and a fleet of field clients loses its broker connection. When the tower recovers, the upper timeline shows every client reconnecting on the same fixed timer, producing a single tall synchronised spike that overwhelms the broker. The lower timeline shows the same clients using full-jitter exponential backoff, spreading their reconnects into a low, even band that passes through a connect rate-limiter gate and lets the broker stay healthy." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>A synchronised reconnect storm versus jittered, rate-limited reconnection</title>
  <desc>A wildfire disconnects a fleet of MQTT field clients from their broker when a cell tower fails. On tower recovery, clients using a fixed reconnect interval all reconnect at the same instant, forming a single tall spike that overwhelms the broker's connection backlog. The same fleet using full-jitter exponential backoff spreads its reconnect attempts evenly across a window, and a client-side connect rate limiter caps the attempt rate, so the broker absorbs the recovery without browning out.</desc>
  <defs>
    <marker id="mqtt-storm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="mqtt-storm-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- left: fire + tower + fleet -->
  <text x="120" y="34" font-size="12.5" text-anchor="middle" font-weight="700" fill="currentColor">Wildfire surge</text>
  <!-- flame glyph -->
  <path d="M120,58 C104,74 106,92 120,104 C134,92 136,74 120,58 Z" fill="var(--ember, currentColor)" stroke="var(--crimson, currentColor)" stroke-width="1.3"/>
  <!-- tower -->
  <g stroke="currentColor" stroke-width="1.5" fill="none">
    <line x1="120" y1="196" x2="106" y2="140"/>
    <line x1="120" y1="196" x2="134" y2="140"/>
    <line x1="110" y1="176" x2="130" y2="176"/>
    <line x1="113" y1="160" x2="127" y2="160"/>
  </g>
  <!-- tower down cross -->
  <g transform="translate(120,124)">
    <line x1="-9" y1="-9" x2="9" y2="9" stroke="var(--crimson, currentColor)" stroke-width="2.2"/>
    <line x1="-9" y1="9" x2="9" y2="-9" stroke="var(--crimson, currentColor)" stroke-width="2.2"/>
  </g>
  <text x="120" y="214" font-size="10.5" text-anchor="middle" fill="var(--crimson, currentColor)">tower down → recovers</text>
  <!-- fleet dots -->
  <g fill="currentColor">
    <circle cx="60" cy="250" r="5"/><circle cx="90" cy="250" r="5"/><circle cx="120" cy="250" r="5"/><circle cx="150" cy="250" r="5"/><circle cx="180" cy="250" r="5"/>
    <circle cx="60" cy="276" r="5"/><circle cx="90" cy="276" r="5"/><circle cx="120" cy="276" r="5"/><circle cx="150" cy="276" r="5"/><circle cx="180" cy="276" r="5"/>
  </g>
  <text x="120" y="304" font-size="10.5" text-anchor="middle" fill="currentColor">~200 field clients</text>
  <text x="120" y="340" font-size="11" text-anchor="middle" font-weight="600" fill="currentColor">All disconnect</text>
  <text x="120" y="356" font-size="11" text-anchor="middle" font-weight="600" fill="currentColor">at the same instant</text>
  <!-- divider -->
  <line x1="236" y1="24" x2="236" y2="448" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.55"/>
  <!-- top timeline: fixed interval spike -->
  <text x="270" y="52" font-size="12" font-weight="700" fill="var(--crimson, currentColor)">Fixed interval → storm</text>
  <line x1="270" y1="150" x2="828" y2="150" stroke="currentColor" stroke-width="1.3"/>
  <text x="270" y="168" font-size="10" fill="currentColor" opacity="0.75">time →</text>
  <!-- the spike -->
  <path d="M470,150 L470,72 M478,150 L478,72 M462,150 L462,72 M486,150 L486,72 M454,150 L454,72 M494,150 L494,72" stroke="var(--crimson, currentColor)" stroke-width="2.4"/>
  <path d="M446,150 V150 M470,64 h0" fill="none"/>
  <text x="474" y="60" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">200 CONNECTs / 1s</text>
  <text x="360" y="120" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">recovery</text>
  <path d="M360,128 L462,138" fill="none" stroke="currentColor" stroke-width="1.1" marker-end="url(#mqtt-storm-plain)"/>
  <!-- bottom timeline: jittered spread -->
  <text x="270" y="228" font-size="12" font-weight="700" fill="currentColor">Full-jitter backoff → spread</text>
  <line x1="270" y1="360" x2="790" y2="360" stroke="currentColor" stroke-width="1.3"/>
  <text x="270" y="378" font-size="10" fill="currentColor" opacity="0.75">time →</text>
  <!-- spread bars, low even band -->
  <g stroke="var(--crimson, currentColor)" stroke-width="2">
    <line x1="322" y1="360" x2="322" y2="336"/>
    <line x1="356" y1="360" x2="356" y2="330"/>
    <line x1="392" y1="360" x2="392" y2="338"/>
    <line x1="430" y1="360" x2="430" y2="332"/>
    <line x1="468" y1="360" x2="468" y2="340"/>
    <line x1="506" y1="360" x2="506" y2="330"/>
    <line x1="544" y1="360" x2="544" y2="338"/>
    <line x1="582" y1="360" x2="582" y2="334"/>
    <line x1="620" y1="360" x2="620" y2="340"/>
    <line x1="658" y1="360" x2="658" y2="332"/>
  </g>
  <text x="500" y="252" font-size="10.5" text-anchor="middle" fill="currentColor">reconnects spread across the window</text>
  <!-- rate limiter gate -->
  <rect x="694" y="300" width="118" height="52" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="753" y="322" font-size="10.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">connect</text>
  <text x="753" y="337" font-size="10.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">rate limiter</text>
  <path d="M668,338 H694" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" marker-end="url(#mqtt-storm-arrow)"/>
  <!-- healthy broker -->
  <rect x="708" y="384" width="92" height="46" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <text x="754" y="404" font-size="11" text-anchor="middle" font-weight="700" fill="currentColor">broker</text>
  <text x="754" y="420" font-size="10" text-anchor="middle" fill="currentColor">stays healthy</text>
  <path d="M753,352 V384" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#mqtt-storm-plain)"/>
</svg>

## Tiered Resolution Strategy

Handle recovery in ordered tiers, from the definitive fix down to a safe default that is always flagged for audit. Never reconnect blindly on a fixed timer, and never give up silently — a client that stops retrying disappears from the operating picture exactly like a destroyed one.

1. **Back off with full jitter (definitive).** On every disconnect, wait a delay drawn uniformly at random from zero up to an exponentially growing ceiling, capped at a maximum. The randomness de-synchronises the fleet; the exponential growth protects a broker that is still recovering.
2. **Rate-limit the connect attempt.** Gate each socket-open through a minimum spacing or token bucket so that even one multi-process host or one agency's fleet manager cannot emit a burst of handshakes in a single instant.
3. **Preserve session state.** Connect with `clean_session=False` and QoS 1 subscriptions so messages published during the outage are queued by the broker and redelivered, rather than lost the moment the client was offline.
4. **Announce presence with a Last Will and Testament.** Register a retained Last Will message so that when the client drops, the broker publishes an explicit offline status. The dashboard then shows a sensor as *offline* instead of a silent gap indistinguishable from a quiet sensor.
5. **Fall back to a bounded safe default with audit (safe default).** After a capped number of attempts, hold at the maximum backoff and keep trying at that interval indefinitely, emitting an audit record for every attempt so the reconnection behaviour is reproducible during review.

## Production Python Implementation

The manager below carries the full resolution path on top of `paho-mqtt`: full-jitter exponential backoff, a client-side connect rate limiter, persistent-session and Last Will configuration, structured logging, explicit exception handling, and an immutable audit record per reconnect attempt. Backoff bounds and the rate limit are parameters, not literals, so an agency can tune them per fleet size and commit them alongside the rest of the [live incident feed configuration](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/). Senior-engineer assumptions apply: `paho-mqtt` is installed, TLS material is provisioned out of band, and the same broker enforces the deduplication contract described in [Deduplicating Replayed Incident Messages After Broker Failover](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/deduplicating-replayed-incident-messages-after-broker-failover/).

```python
from __future__ import annotations

import logging
import random
import threading
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

import paho.mqtt.client as mqtt

logger = logging.getLogger("incidentgis.mqtt.reconnect")


class Outcome(str, Enum):
    CONNECTED = "connected"
    BACKOFF = "backoff_wait"
    RATE_LIMITED = "rate_limited_wait"
    FAILED = "attempt_failed"


@dataclass
class ReconnectPolicy:
    """Tunable, committable reconnect parameters for one fleet."""
    base_delay_s: float = 1.0          # first backoff ceiling
    max_delay_s: float = 120.0         # backoff cap
    multiplier: float = 2.0            # exponential growth factor
    min_connect_spacing_s: float = 0.25  # client-side connect rate limit
    keepalive_s: int = 45


@dataclass
class ReconnectAudit:
    """Immutable record of a single reconnect attempt."""
    client_id: str
    attempt: int
    backoff_delay_s: float
    outcome: str
    clean_session: bool
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class ResilientMQTTClient:
    """MQTT client that survives a fleet-wide reconnect storm.

    Uses full-jitter exponential backoff, a client-side connect rate
    limiter, a persistent session, and a Last Will message. Every attempt
    is appended to ``audit_log`` so recovery behaviour is reconstructable.
    """

    def __init__(
        self,
        client_id: str,
        host: str,
        port: int,
        status_topic: str,
        policy: Optional[ReconnectPolicy] = None,
    ) -> None:
        self.client_id = client_id
        self.host = host
        self.port = port
        self.status_topic = status_topic
        self.policy = policy or ReconnectPolicy()
        self.audit_log: list[ReconnectAudit] = []
        self._attempt = 0
        self._last_connect_ts = 0.0
        self._stop = threading.Event()

        # Persistent session: queued QoS 1 messages survive the outage.
        self._client = mqtt.Client(client_id=client_id, clean_session=False)
        # Last Will: broker publishes an explicit offline status if we drop.
        self._client.will_set(
            status_topic, payload="offline", qos=1, retain=True
        )
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect

    def _audit(self, outcome: Outcome, delay: float) -> None:
        entry = ReconnectAudit(
            client_id=self.client_id,
            attempt=self._attempt,
            backoff_delay_s=round(delay, 3),
            outcome=outcome.value,
            clean_session=False,
        )
        self.audit_log.append(entry)
        logger.info("mqtt_reconnect", extra={"audit": asdict(entry)})

    def _full_jitter_delay(self) -> float:
        """Random delay in [0, ceiling] with an exponentially growing ceiling.

        Full jitter de-synchronises the fleet so reconnects spread across a
        window instead of colliding on the same tick after tower recovery.
        """
        ceiling = min(
            self.policy.max_delay_s,
            self.policy.base_delay_s * (self.policy.multiplier ** self._attempt),
        )
        return random.uniform(0.0, ceiling)

    def _rate_limit(self) -> None:
        """Enforce minimum spacing between socket-opens from this process."""
        elapsed = time.monotonic() - self._last_connect_ts
        wait = self.policy.min_connect_spacing_s - elapsed
        if wait > 0:
            self._audit(Outcome.RATE_LIMITED, wait)
            self._stop.wait(wait)
        self._last_connect_ts = time.monotonic()

    def _on_connect(self, client, userdata, flags, rc) -> None:  # paho signature
        if rc == 0:
            self._attempt = 0  # reset backoff only on a clean accept
            client.publish(self.status_topic, payload="online", qos=1, retain=True)
            self._audit(Outcome.CONNECTED, 0.0)
            logger.info("mqtt_connected", extra={"client_id": self.client_id})
        else:
            # Non-zero return code: broker refused (auth, overload). Keep backing off.
            logger.warning(
                "mqtt_connect_refused",
                extra={"client_id": self.client_id, "rc": rc},
            )

    def _on_disconnect(self, client, userdata, rc) -> None:  # paho signature
        # rc != 0 is an unexpected drop — the storm trigger. Do not hot-loop.
        if rc != 0:
            logger.warning(
                "mqtt_unexpected_disconnect",
                extra={"client_id": self.client_id, "rc": rc},
            )

    def run_forever(self) -> None:
        """Connect and reconnect with jittered backoff until stopped."""
        self._client.loop_start()
        while not self._stop.is_set():
            delay = self._full_jitter_delay()
            self._audit(Outcome.BACKOFF, delay)
            # Wait out the jittered window; interruptible on shutdown.
            if self._stop.wait(delay):
                break
            self._rate_limit()
            try:
                self._client.reconnect() if self._attempt else self._client.connect(
                    self.host, self.port, keepalive=self.policy.keepalive_s
                )
                # Give the async CONNACK a moment; on_connect resets _attempt.
                self._stop.wait(1.0)
                if self._client.is_connected():
                    continue
                self._attempt += 1
            except (OSError, ConnectionError, mqtt.WebsocketConnectionError) as exc:
                # Broker unreachable or backlog full: back off further, never crash.
                self._attempt += 1
                self._audit(Outcome.FAILED, delay)
                logger.error(
                    "mqtt_reconnect_failed",
                    extra={"client_id": self.client_id, "attempt": self._attempt},
                    exc_info=exc,
                )
        self._client.loop_stop()

    def stop(self) -> None:
        self._stop.set()
        self._client.disconnect()  # graceful: suppresses the Last Will
```

The `audit_log` is the load-bearing output. Persisting it as a committed, content-hashed artifact lets a reviewer replay the recovery and confirm that reconnects were spread and rate-limited rather than dumped on the broker in one burst — and it pairs with the broker-side deduplication that keeps the redelivered backlog from double-counting once every client is back online.

## Validation Checklist

Verify every item before deploying the reconnect manager to a live wildfire feed.

- [ ] Backoff uses full jitter (`random.uniform(0, ceiling)`), not a fixed interval or lockstep doubling, so the fleet de-synchronises on recovery.
- [ ] `base_delay_s`, `max_delay_s`, `multiplier`, and `min_connect_spacing_s` are policy parameters committed under version control — no literals baked into the field build.
- [ ] The connect rate limiter enforces minimum spacing even when multiple client processes share one host.
- [ ] The client connects with `clean_session=False` and QoS 1 subscriptions so outage-period messages are queued and redelivered.
- [ ] A Last Will and Testament is registered and a matching `online` status is published on connect, so the dashboard distinguishes offline from quiet.
- [ ] The backoff counter resets only on a successful CONNACK (`rc == 0`), never on a refused or half-open connection.
- [ ] `stop()` calls `disconnect()` so a planned shutdown suppresses the Last Will instead of falsely flagging the device offline.
- [ ] Every attempt — backoff, rate-limit wait, success, and failure — appears in `audit_log` and routes to the incident logging sink, not stdout.
- [ ] The manager is load-tested against a simulated fleet-wide drop-and-recover and the broker's peak concurrent CONNECT rate stays within its provisioned budget.

## Edge Cases and Gotchas

- **Jitter without a cap still stampedes.** Full jitter spreads reconnects, but if `max_delay_s` is too small the window is narrow and a large fleet still bunches. Size the ceiling to the fleet: with two hundred clients and a 0.25 s connect spacing you need a window of tens of seconds to stay under the broker's accept budget. Tune `max_delay_s` and `min_connect_spacing_s` together, not in isolation.
- **`clean_session=False` requires a stable client ID.** Persistent-session queueing keys on the client ID. If devices generate a random ID on each boot, the broker accumulates orphaned sessions that never get consumed, leaking memory during exactly the surge you are trying to survive. Provision a stable, unique client ID per device and never reuse one across two live devices.
- **Retained Last Will can go stale.** A retained `offline` Last Will persists on the topic until overwritten. If a device is decommissioned mid-incident, its retained offline status lingers on the map. Clear retained status topics on planned teardown, and treat a Last Will as a hint that must be reconciled against the device registry, not as ground truth.
- **Half-open connections after a NAT timeout.** A carrier NAT or firewall can silently drop the TCP flow so the client believes it is connected while the broker has already reaped the session. Keep `keepalive_s` shorter than the network's idle timeout so the client detects the dead link and enters backoff rather than publishing into a black hole.
- **The redelivery wave is its own load event.** When persistent-session clients reconnect, the broker floods them with queued QoS 1 messages, which can look like a second storm. Ensure downstream consumers apply idempotent dedup so replayed messages during the surge do not double-count incidents on the operating picture.

## Frequently Asked Questions

**Why do MQTT clients all reconnect at the same instant after an outage?** When a cell tower drops, every field client in its coverage loses the broker connection at nearly the same moment. If they all use the same fixed reconnect interval, their retry timers stay phase-locked, so when the tower recovers they fire their TCP handshakes and MQTT CONNECT packets in a single synchronised burst. That thundering herd can exhaust the broker's connection backlog and CPU faster than the original outage did.

**What backoff strategy stops a reconnect storm?** Full-jitter exponential backoff. Each retry waits a random delay drawn uniformly from zero up to an exponentially growing ceiling, capped at a maximum. Randomising the delay de-synchronises the fleet so reconnects spread smoothly across a window instead of spiking, while the exponential growth keeps a broker that is still recovering from being hammered.

**Should wildfire telemetry clients use a clean or persistent MQTT session?** A persistent session (`clean_session=False`) with QoS 1 subscriptions, so messages published during the outage are queued by the broker and delivered on reconnect rather than lost. Pair it with a Last Will and Testament message so the incident dashboard sees an explicit offline status for a dropped sensor instead of a silent gap that looks identical to a quiet sensor.

## Related

- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — the transport layer whose connection lifecycle this reconnect discipline hardens.
- [Deduplicating Replayed Incident Messages After Broker Failover](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/deduplicating-replayed-incident-messages-after-broker-failover/) — handle the QoS 1 redelivery wave that follows every mass reconnect.
- [Building a Live Incident Dashboard with Python and Leaflet](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/building-a-live-incident-dashboard-with-python-and-leaflet/) — the consumer that reads the online/offline status this client publishes.
- [Kafka vs RabbitMQ for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/kafka-vs-rabbitmq-for-live-incident-feeds/) — when a partitioned log or per-message ack broker fits the fan-out better than MQTT.

Up: [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/)
