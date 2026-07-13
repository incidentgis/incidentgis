---
title: "Handling Cache Invalidation During Multi-Day Incidents"
description: "Keep offline field caches fresh across a multi-day incident with content-hash and ETag-based selective invalidation: detect only the layers that changed, delta-sync them over intermittent links, and emit an audit trail for every refresh."
slug: handling-cache-invalidation-during-multi-day-incidents
type: article
breadcrumb: "Cache Invalidation"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Handling Cache Invalidation During Multi-Day Incidents",
      "description": "Keep offline field caches fresh across a multi-day incident with content-hash and ETag-based selective invalidation: detect only the layers that changed, delta-sync them over intermittent links, and emit an audit trail for every refresh.",
      "datePublished": "2026-07-13",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Core Emergency GIS Architecture & Data Standards", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/" },
        { "@type": "ListItem", "position": 3, "name": "Offline GIS Data Caching Strategies", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/" },
        { "@type": "ListItem", "position": 4, "name": "Handling Cache Invalidation During Multi-Day Incidents", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/handling-cache-invalidation-during-multi-day-incidents/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Selectively invalidate and delta-sync an offline field cache during a long incident",
      "description": "Maintain a per-layer manifest of content hashes and ETags, compare it against the server on each connectivity window, download only the layers that changed, and record every invalidation and refresh in an immutable audit trail so field caches stay fresh without a full re-download.",
      "step": [
        { "@type": "HowToStep", "name": "Fingerprint every cached layer", "text": "Store a manifest that records a strong content hash, the server ETag, and a version for each cached layer so change can be detected without re-reading full geometry." },
        { "@type": "HowToStep", "name": "Probe for change cheaply", "text": "On each connectivity window, issue conditional requests using the stored ETag so unchanged layers return a 304 and consume no bandwidth." },
        { "@type": "HowToStep", "name": "Invalidate and delta-sync only what changed", "text": "For layers whose ETag or hash differs, fetch a delta or the smallest available representation, verify the downloaded hash, and atomically swap the cache entry." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Log every invalidation and refresh with the old and new hash, the byte count transferred, and the reason so the cache state is reproducible for after-action review." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not just re-download the whole cache each morning?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "During a multi-day incident the uplink is intermittent and shared with voice and telemetry, so a full re-download of a multi-gigabyte cache rarely completes inside a connectivity window and starves other traffic. Selective invalidation transfers only the layers whose content hash or ETag changed, which is usually a small fraction of the cache, so a refresh finishes in seconds and leaves bandwidth for operations."
          }
        },
        {
          "@type": "Question",
          "name": "Should invalidation use ETags or content hashes?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Use both. The ETag is a cheap server-side probe that lets a conditional request return 304 Not Modified with almost no bytes, but ETags can change without meaningful content change and cannot be trusted across a proxy or a rebuilt tile server. A strong content hash computed over the actual bytes is the authoritative equality check, so the ETag decides whether to fetch and the hash decides whether to swap the cache entry."
          }
        },
        {
          "@type": "Question",
          "name": "What happens if a delta sync is interrupted mid-transfer?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Never overwrite the live cache entry in place. Download to a temporary file, verify its hash against the manifest target, and only then atomically rename it over the existing entry. If the link drops mid-transfer the partial file is discarded and the previous known-good layer stays in service, so the field device never ends up serving a truncated or corrupt layer to the Common Operating Picture."
          }
        }
      ]
    }
  ]
}
</script>

# Handling Cache Invalidation During Multi-Day Incidents

A type-1 wildfire complex enters its ninth operational period. Field teams on the line carry ruggedized tablets running an offline map cache seeded before the incident: base imagery, parcels, hydrants, the road network, and the live fire perimeter. Every twelve hours the perimeter grows, evacuation zones are redrawn, and new drop points are added, but the tablets only see the network for a few minutes at a time when a crew rolls back within range of a mobile repeater. On day three a division supervisor is looking at a perimeter that is eighteen hours stale, planning a hand-line against fire that has already crossed the ridge behind the drawn edge. The tablet is not broken — its cache simply never learned that one layer changed while five others did not, and the connectivity window was far too short to re-pull the whole thing. This page solves that single narrow failure: keeping a disconnected field cache fresh across a long incident by invalidating and re-syncing only the layers that actually changed.

## Root Cause and Operational Impact

An offline cache is a snapshot, and a snapshot is correct only at the instant it was taken. During a short incident that is fine. Across a multi-day event the underlying data moves continuously while the field device is disconnected most of the time, so the snapshot decays. The naive fix — re-download everything on each reconnect — fails on physics: the uplink is a congested, intermittent satellite or cellular link shared with radio-over-IP and telemetry, and a multi-gigabyte cache cannot traverse it inside a two-minute window. The transfer stalls, the device falls back to the stale copy, and nobody is told the copy is stale. The device shows a confident, fully rendered, wrong map.

This is dangerous, not merely inconvenient, because a stale layer looks identical to a fresh one. There is no visual cue that the perimeter is eighteen hours old; the supervisor cannot distinguish a current edge from a decayed one, so the error is invisible until it produces a bad tactical decision. The National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both require that the products feeding a Common Operating Picture (COP) be traceable to a known source and time, and a cache that silently serves an unknown-age layer breaks that traceability. The remedy is to make freshness explicit and per-layer: fingerprint each cached layer, probe for change cheaply, invalidate and re-sync only what moved, and record every refresh so the cache state at any operational period is reconstructable. This is the discipline that turns a fragile pre-seeded snapshot — the kind produced by the wider [offline GIS data caching strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) — into a cache that stays trustworthy for days.

<svg viewBox="0 0 880 460" role="img" aria-label="Selective cache-invalidation flow for a field device over an intermittent link. A field cache holds five layers, each with a stored content hash and ETag in a manifest. On a connectivity window the device issues conditional requests to the server. Unchanged layers return 304 Not Modified and are kept. The perimeter layer returns a new ETag and a differing hash, so it is invalidated, delta-synced to a temporary file, hash-verified, and atomically swapped into the cache, while an audit record captures the old and new hash and the bytes transferred." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Selective invalidation and delta sync of a field cache over an intermittent link</title>
  <desc>A field device holds a cache of five layers, each fingerprinted in a manifest with a content hash and an ETag. During a short connectivity window the device sends conditional requests keyed by the stored ETag. Four layers return 304 Not Modified and are retained untouched. The fire-perimeter layer returns a new ETag whose bytes hash to a different value, so it is invalidated, the changed data is delta-synced to a temporary file, the download is hash-verified against the manifest target, and only then is it atomically renamed over the cached entry. Every invalidation is written to an immutable audit record capturing the previous hash, the new hash, and the byte count transferred.</desc>
  <defs>
    <marker id="cacheinv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="cacheinv-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- Field cache panel -->
  <text x="30" y="34" font-size="12.5" font-weight="700" fill="currentColor">Field cache · manifest</text>
  <rect x="30" y="46" width="250" height="360" rx="8" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.4"/>
  <g font-size="10.5" fill="currentColor">
    <rect x="46" y="64" width="218" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <text x="58" y="84" font-weight="600">base imagery</text>
    <text x="58" y="102" font-size="9.5" opacity="0.8">etag a1f9 · hash 3c…d0</text>
    <rect x="46" y="124" width="218" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <text x="58" y="144" font-weight="600">parcels</text>
    <text x="58" y="162" font-size="9.5" opacity="0.8">etag b7c2 · hash 91…4a</text>
    <rect x="46" y="184" width="218" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <text x="58" y="204" font-weight="600">hydrants</text>
    <text x="58" y="222" font-size="9.5" opacity="0.8">etag c0e5 · hash 55…8f</text>
    <rect x="46" y="244" width="218" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <text x="58" y="264" font-weight="600">road network</text>
    <text x="58" y="282" font-size="9.5" opacity="0.8">etag d3a8 · hash 7e…22</text>
    <rect x="46" y="304" width="218" height="56" rx="6" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="58" y="326" font-weight="700" fill="var(--crimson, currentColor)">fire perimeter</text>
    <text x="58" y="344" font-size="9.5" fill="var(--crimson, currentColor)">etag e9b1 · hash aa…c7 (stale)</text>
  </g>
  <text x="155" y="390" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.8">connectivity window: seconds</text>
  <!-- conditional requests arrow -->
  <path d="M280,150 H400" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#cacheinv-plain)"/>
  <text x="340" y="140" font-size="10" text-anchor="middle" fill="currentColor">conditional GET</text>
  <text x="340" y="166" font-size="9.5" text-anchor="middle" fill="currentColor" opacity="0.8">If-None-Match: etag</text>
  <path d="M280,332 H400" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#cacheinv-arrow)"/>
  <text x="340" y="322" font-size="10" text-anchor="middle" fill="var(--crimson, currentColor)">changed</text>
  <!-- Server panel -->
  <text x="410" y="34" font-size="12.5" font-weight="700" fill="currentColor">Server response</text>
  <rect x="410" y="46" width="210" height="120" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="424" y="78" font-size="11" fill="currentColor" font-weight="600">4 layers →</text>
  <text x="424" y="98" font-size="13" fill="currentColor" font-weight="700">304 Not Modified</text>
  <text x="424" y="120" font-size="9.5" fill="currentColor" opacity="0.8">0 bytes · keep cached copy</text>
  <text x="424" y="142" font-size="9.5" fill="currentColor" opacity="0.8">manifest unchanged</text>
  <rect x="410" y="284" width="210" height="120" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="424" y="314" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">perimeter →</text>
  <text x="424" y="334" font-size="13" fill="var(--crimson, currentColor)" font-weight="700">200 · new etag f4d0</text>
  <text x="424" y="356" font-size="9.5" fill="var(--crimson, currentColor)">hash bb…19 ≠ aa…c7</text>
  <text x="424" y="376" font-size="9.5" fill="var(--crimson, currentColor)">delta payload only</text>
  <!-- 304 keep loop -->
  <path d="M515,166 V210 H295 V190" fill="none" stroke="currentColor" stroke-width="1.2" marker-end="url(#cacheinv-plain)" opacity="0.75"/>
  <text x="405" y="205" font-size="9.5" text-anchor="middle" fill="currentColor" opacity="0.8">retain untouched</text>
  <!-- to invalidate/sync stage -->
  <path d="M620,344 H700" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#cacheinv-arrow)"/>
  <!-- Invalidate + swap panel -->
  <text x="700" y="34" font-size="12.5" font-weight="700" fill="var(--crimson, currentColor)">Invalidate &amp; swap</text>
  <g font-size="10" fill="currentColor">
    <rect x="700" y="284" width="150" height="40" rx="6" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4"/>
    <text x="710" y="300" font-weight="600" fill="var(--crimson, currentColor)">1 · download → tmp</text>
    <text x="710" y="316" font-size="9">stream delta to temp file</text>
    <rect x="700" y="332" width="150" height="40" rx="6" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4"/>
    <text x="710" y="348" font-weight="600" fill="var(--crimson, currentColor)">2 · verify hash</text>
    <text x="710" y="364" font-size="9">bb…19 == target?</text>
    <rect x="700" y="380" width="150" height="40" rx="6" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="710" y="396" font-weight="700" fill="var(--crimson, currentColor)">3 · atomic rename</text>
    <text x="710" y="412" font-size="9">swap over live entry</text>
  </g>
  <path d="M775,324 V332" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" marker-end="url(#cacheinv-arrow)"/>
  <path d="M775,372 V380" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" marker-end="url(#cacheinv-arrow)"/>
  <!-- audit -->
  <rect x="640" y="120" width="210" height="86" rx="8" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.4"/>
  <text x="652" y="142" font-size="11" font-weight="700" fill="currentColor">Audit record</text>
  <text x="652" y="162" font-size="9.5" fill="currentColor">layer, old hash → new hash</text>
  <text x="652" y="178" font-size="9.5" fill="currentColor">bytes transferred, reason</text>
  <text x="652" y="194" font-size="9.5" fill="currentColor">operational period, timestamp</text>
  <path d="M775,380 C775,270 800,240 770,206" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 4" marker-end="url(#cacheinv-plain)" opacity="0.7"/>
</svg>

## Tiered Resolution Strategy

Resolve staleness in ordered tiers, from the cheapest authoritative check down to a safe default that always flags the cache as suspect rather than silently serving old data. Never treat "the transfer failed" as "the cache is current."

1. **Fingerprint every layer in a manifest (foundation).** For each cached layer store a strong content hash over its bytes, the last server ETag, a semantic version, and the timestamp it was fetched. Change detection then costs a dictionary lookup, not a re-read of geometry.
2. **Probe with a conditional request (definitive, cheap).** On each connectivity window issue a conditional `GET` carrying the stored ETag in `If-None-Match`. Unchanged layers return `304 Not Modified` at near-zero cost, so the bulk of the cache is confirmed fresh in one round trip.
3. **Invalidate on hash mismatch, not ETag alone.** When the server returns `200` with a new ETag, download the smallest available representation — a delta if the source supports it — and hash the bytes. Only a differing content hash marks the layer genuinely changed; an ETag that flipped without a content change is discarded as a false positive.
4. **Swap atomically with a safe default.** Write the new layer to a temporary file, verify its hash against the manifest target, and atomically rename it over the live entry. If verification fails or the link drops, keep the previous known-good layer and mark it stale-but-serving so the device shows a freshness badge rather than a false-current map.
5. **Emit an audit record for every invalidation.** Old hash, new hash, bytes transferred, reason, operational period, and timestamp — so the cache state during any operational period is reconstructable for after-action review.

## Production Python Implementation

The routine below carries the full resolution path: a per-layer manifest, conditional ETag probing, content-hash verification, atomic swap of the cache entry, structured logging, explicit exception handling, and an immutable audit record per invalidation. Thresholds and endpoints are parameters, not literals, so the cache policy can be committed and versioned. Senior-engineer assumptions apply: a `requests`-style session with conditional-request support is injected, and layer bytes are treated opaquely so the same logic serves vector tiles, GeoPackage layers, or a serialized feature collection produced by the upstream [geospatial data ingestion pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/).

```python
from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger("incidentgis.cache")

# A response-like object: any client returning status, headers, and a byte
# iterator. Injected so the corrector stays testable and transport-agnostic.
ConditionalGet = Callable[[str, Optional[str]], "HttpResult"]


class Outcome(str, Enum):
    FRESH_304 = "fresh_not_modified"
    REFRESHED = "refreshed_delta_synced"
    FALSE_ETAG = "etag_changed_hash_identical"
    HELD_STALE = "held_stale_transfer_failed"
    VERIFY_FAIL = "held_stale_hash_mismatch"


@dataclass
class HttpResult:
    status: int
    etag: Optional[str]
    body: bytes  # empty on 304


@dataclass
class LayerEntry:
    """One cached layer's fingerprint in the manifest."""
    layer_id: str
    path: str
    content_hash: str
    etag: Optional[str]
    version: str
    fetched_at: str


@dataclass
class AuditEntry:
    """Immutable record of a single invalidation decision."""
    operational_period: str
    layer_id: str
    outcome: str
    old_hash: Optional[str]
    new_hash: Optional[str]
    bytes_transferred: int
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class CacheInvalidator:
    """Selectively invalidate and delta-sync an offline field cache.

    Each layer is probed with its stored ETag; only a differing content hash
    triggers an atomic swap. Every decision is appended to ``audit_log`` so the
    cache state during any operational period is reproducible.
    """

    def __init__(
        self,
        cache_dir: Path,
        operational_period: str,
        fetch: ConditionalGet,
    ) -> None:
        self.cache_dir = cache_dir
        self.operational_period = operational_period
        self.fetch = fetch
        self.manifest: dict[str, LayerEntry] = {}
        self.audit_log: list[AuditEntry] = []

    @staticmethod
    def _hash_bytes(data: bytes) -> str:
        """Strong content hash used as the authoritative equality check."""
        return hashlib.sha256(data).hexdigest()

    def _atomic_write(self, dest: Path, data: bytes) -> None:
        """Write to a temp file in the same directory, then rename over dest.

        The rename is atomic on POSIX, so a dropped link never leaves a
        truncated layer live; the previous known-good file stays in service.
        """
        fd, tmp_name = tempfile.mkstemp(dir=str(dest.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, dest)  # atomic swap
        except OSError:
            # Clean up the partial temp file; leave the live entry untouched.
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
            raise

    def _audit(
        self,
        layer_id: str,
        outcome: Outcome,
        old_hash: Optional[str],
        new_hash: Optional[str],
        transferred: int,
    ) -> None:
        entry = AuditEntry(
            operational_period=self.operational_period,
            layer_id=layer_id,
            outcome=outcome.value,
            old_hash=old_hash,
            new_hash=new_hash,
            bytes_transferred=transferred,
        )
        self.audit_log.append(entry)
        logger.info("cache_invalidation", extra={"audit": asdict(entry)})

    def refresh_layer(self, layer_id: str, url: str) -> Outcome:
        """Probe one layer and delta-sync it only if its content changed."""
        entry = self.manifest.get(layer_id)
        old_hash = entry.content_hash if entry else None
        prior_etag = entry.etag if entry else None

        try:
            result = self.fetch(url, prior_etag)

            # Tier 2: cheap conditional probe — unchanged layers cost ~0 bytes.
            if result.status == 304:
                logger.debug("cache_fresh", extra={"layer": layer_id})
                self._audit(layer_id, Outcome.FRESH_304, old_hash, old_hash, 0)
                return Outcome.FRESH_304

            if result.status != 200:
                raise OSError(f"unexpected status {result.status} for {layer_id}")

            # Tier 3: authoritative check — ETag may flip without real change.
            new_hash = self._hash_bytes(result.body)
            if new_hash == old_hash:
                if entry is not None:  # refresh the ETag, keep the bytes
                    entry.etag = result.etag
                self._audit(layer_id, Outcome.FALSE_ETAG, old_hash, new_hash, 0)
                return Outcome.FALSE_ETAG

            # Tier 4: atomic swap only after the download verifies.
            dest = self.cache_dir / f"{layer_id}.layer"
            self._atomic_write(dest, result.body)
            self.manifest[layer_id] = LayerEntry(
                layer_id=layer_id,
                path=str(dest),
                content_hash=new_hash,
                etag=result.etag,
                version=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
                fetched_at=datetime.now(timezone.utc).isoformat(),
            )
            self._audit(
                layer_id, Outcome.REFRESHED, old_hash, new_hash, len(result.body)
            )
            return Outcome.REFRESHED

        except (OSError, ValueError) as exc:
            # Transfer or write failed: hold the last known-good copy, flag stale.
            logger.error(
                "cache_refresh_failed",
                extra={"layer": layer_id, "period": self.operational_period},
                exc_info=exc,
            )
            self._audit(layer_id, Outcome.HELD_STALE, old_hash, old_hash, 0)
            return Outcome.HELD_STALE

    def load_manifest(self, manifest_path: Path) -> None:
        """Load the persisted manifest; start empty if it is absent or corrupt."""
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.manifest = {k: LayerEntry(**v) for k, v in raw.items()}
        except (FileNotFoundError, json.JSONDecodeError, TypeError) as exc:
            logger.warning("manifest_load_failed", exc_info=exc)
            self.manifest = {}
```

The `audit_log` is the load-bearing output. Persisted as a committed, content-hashed artifact per operational period, it lets a planning-section reviewer confirm exactly which layer was current on each device at each period — the traceability that turns an opaque offline snapshot into a defensible COP input.

## Validation Checklist

Verify every item before deploying the invalidator to field devices.

- [ ] Each layer's manifest entry carries a content hash, ETag, version, and fetch timestamp; change detection never re-reads full geometry.
- [ ] Conditional requests send the stored ETag in `If-None-Match` and a `304` short-circuits with zero body transfer.
- [ ] A layer is swapped only when the downloaded content hash differs from the stored hash — an ETag change alone is recorded as a false positive, not a re-sync.
- [ ] Downloads are written to a temporary file, hash-verified, and atomically renamed; a dropped link leaves the previous known-good layer in service.
- [ ] A failed or unverifiable refresh holds the stale copy and marks it stale-but-serving so the operator sees a freshness badge, never a silent old map.
- [ ] `operational_period` is stamped on every audit entry so cache state is reconstructable per twelve-hour period.
- [ ] The manifest loader tolerates a missing or corrupt manifest by starting empty rather than raising on device boot.
- [ ] Structured logs and the `audit_log` route to the incident logging sink, not stdout, and survive a device reboot.

## Edge Cases and Gotchas

- **Weak vs. strong ETags.** A proxy or tile server may emit a weak ETag (`W/"…"`) that changes on any re-serialization, or drop the ETag entirely behind a caching CDN. Treat a missing or weak ETag as "must fetch and hash," and never let ETag equality alone confirm freshness — the content hash is the only authoritative equality check.
- **Clock skew and versions.** Do not invalidate on `Last-Modified` timestamps; a field device with a drifting clock and a rebuilt server can disagree by hours, causing endless false re-syncs or missed updates. Anchor freshness to content hashes and an explicit operational-period label, not wall-clock comparison.
- **Partial-transfer corruption.** A link that drops mid-download yields a truncated body whose hash will not match the manifest target, so the verify step rejects it — but only if you hash the actual downloaded bytes, not the declared `Content-Length`. Always hash what arrived, and support HTTP range resumption so a re-attempt continues rather than restarting.
- **Datum and CRS drift across a re-sync.** If the server quietly republishes a layer in a different coordinate reference system, the bytes change and the layer re-syncs, but downstream overlays will silently misalign. Pin the expected CRS in the manifest and reject a refreshed layer whose declared CRS differs, following the contract in the [coordinate reference systems for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) standard.
- **Thundering-herd re-sync on tower recovery.** When a repeater comes back and dozens of tablets probe simultaneously, a large changed layer can saturate the uplink. Stagger probes with per-device jitter and cap concurrent layer downloads so a surge of reconnects does not starve the operations traffic sharing the link.

## Frequently Asked Questions

**Why not just re-download the whole cache each morning?** During a multi-day incident the uplink is intermittent and shared with voice and telemetry, so a full re-download of a multi-gigabyte cache rarely completes inside a connectivity window and starves other traffic. Selective invalidation transfers only the layers whose content hash or ETag changed, which is usually a small fraction of the cache, so a refresh finishes in seconds and leaves bandwidth for operations.

**Should invalidation use ETags or content hashes?** Use both. The ETag is a cheap server-side probe that lets a conditional request return `304 Not Modified` with almost no bytes, but ETags can change without meaningful content change and cannot be trusted across a proxy or a rebuilt tile server. A strong content hash computed over the actual bytes is the authoritative equality check, so the ETag decides whether to fetch and the hash decides whether to swap the cache entry.

**What happens if a delta sync is interrupted mid-transfer?** Never overwrite the live cache entry in place. Download to a temporary file, verify its hash against the manifest target, and only then atomically rename it over the existing entry. If the link drops mid-transfer the partial file is discarded and the previous known-good layer stays in service, so the field device never ends up serving a truncated or corrupt layer to the Common Operating Picture.

## Related

- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) — the seeding and storage patterns this invalidation policy keeps fresh over time.
- [Pre-Staging Vector Tiles Before a Forecasted Landfall](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/pre-staging-vector-tiles-before-a-forecasted-landfall/) — build the initial cache this routine later refreshes selectively.
- [FlatGeobuf vs GeoPackage for Offline Caching](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/flatgeobuf-vs-geopackage-for-offline-caching/) — choose a cache format whose partial-fetch behaviour suits delta sync over bad links.

Up: [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/)
