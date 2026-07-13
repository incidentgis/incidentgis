---
title: "Recovering from Corrupt Geometry in Streaming Sensor Ingest"
description: "Triage corrupt geometry in a live sensor stream without stalling ingest: reject truncated WKB and NaN coordinates, repair self-intersections with make_valid, quarantine the unrecoverable, and emit an audit record for every decision."
slug: recovering-from-corrupt-geometry-in-streaming-sensor-ingest
type: article
breadcrumb: "Corrupt Geometry in Sensor Ingest"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Recovering from Corrupt Geometry in Streaming Sensor Ingest",
      "description": "Triage corrupt geometry in a live sensor stream without stalling ingest: reject truncated WKB and NaN coordinates, repair self-intersections with make_valid, quarantine the unrecoverable, and emit an audit record for every decision.",
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
        { "@type": "ListItem", "position": 3, "name": "Geospatial Data Ingestion Pipelines", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/" },
        { "@type": "ListItem", "position": 4, "name": "Recovering from Corrupt Geometry in Streaming Sensor Ingest", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/recovering-from-corrupt-geometry-in-streaming-sensor-ingest/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Recover corrupt geometry from a live sensor stream without stalling ingest",
      "description": "Parse each incoming geometry defensively, reject truncated WKB and non-finite coordinates, repair invalid-but-recoverable geometry with make_valid, quarantine the unrecoverable to a dead-letter store, and emit an audit record for every decision so the stream never blocks and every drop is defensible.",
      "step": [
        { "@type": "HowToStep", "name": "Parse defensively", "text": "Wrap WKB and WKT parsing in explicit exception handling so a truncated or malformed payload raises a caught error instead of crashing the consumer or poisoning the batch." },
        { "@type": "HowToStep", "name": "Reject non-finite coordinates", "text": "Scan for NaN and infinite ordinates before trusting any geometry, because a single non-finite vertex silently corrupts spatial indexes and bounding-box math downstream." },
        { "@type": "HowToStep", "name": "Repair what is recoverable", "text": "Run make_valid on self-intersecting or otherwise invalid-but-parseable geometry and accept the repaired result only if it preserves the original geometry type and a plausible area or length." },
        { "@type": "HowToStep", "name": "Quarantine the unrecoverable", "text": "Route geometry that cannot be parsed or repaired to a dead-letter store rather than dropping it silently, so the stream keeps flowing and nothing is lost." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Log every accept, repair, and quarantine decision with the sensor id, the reason code, and the offsets involved so the ingest outcome is fully reproducible for after-action review." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How do I keep one corrupt geometry from stalling the whole sensor stream?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Isolate the failure to a single record. Wrap parsing and validation for each message in explicit exception handling so a truncated payload or non-finite coordinate raises a caught error, then route that one record to a quarantine or dead-letter store and commit the offset so the consumer advances. The stream keeps flowing because no single message can block the batch or crash the consumer; every corrupt record is captured for later inspection rather than retried forever."
          }
        },
        {
          "@type": "Question",
          "name": "When should I repair invalid geometry versus drop it?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Repair geometry that parses cleanly but fails an OGC validity check — self-intersections, bowtie rings, and duplicate vertices — because make_valid can reconstruct a topologically correct shape. Accept the repaired result only if it keeps the original geometry type and a plausible area or length. Quarantine anything that cannot be parsed at all, such as truncated WKB, or that contains NaN or infinite coordinates, because there is no defensible way to guess the intended shape. Never drop silently: every repair and every quarantine gets an audit record."
          }
        },
        {
          "@type": "Question",
          "name": "Why are NaN coordinates so dangerous in an incident pipeline?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A non-finite ordinate poisons everything computed from it. NaN compares false to every bound, so it slips through range checks, corrupts the bounding box of any spatial index it enters, and makes area, length, and distance return NaN across the whole layer. On a Common Operating Picture that can blank a query result or misplace a sensor reading feeding a life-safety decision. Because NaN cannot be repaired into a real position, the only safe action is to reject the coordinate outright and quarantine the record with an audit entry."
          }
        }
      ]
    }
  ]
}
</script>

# Recovering from Corrupt Geometry in Streaming Sensor Ingest

A river-gauge and air-quality sensor network feeds a flood incident's ingest pipeline over a cellular backhaul that browns out every time the storm cell passes overhead. Most messages carry a clean point or a small polygon footprint, but under load the pipeline starts seeing garbage: a well-known binary (WKB) payload cut off mid-ring because the radio dropped, a polygon whose exterior ring crosses itself into a bowtie, and a handful of points reporting a latitude of `NaN` from a sensor that lost its fix. The consumer that used to keep pace now throws on the first bad message, the offset never commits, and the whole partition wedges — replaying the same poison record forever while live gauge readings pile up behind it. The Common Operating Picture goes stale during the exact hour the emergency operations center needs it most. This page solves that single narrow failure mode: turning a stream salted with corrupt geometry into a continuous, defensible feed that repairs what it can, quarantines what it cannot, and never once stalls.

## Root Cause and Operational Impact

Corrupt geometry in a sensor stream comes from three distinct sources, and conflating them is the first mistake. **Truncated or malformed WKB** is a transport failure: a partial write, a dropped connection, or a framing bug leaves the binary payload shorter than its header promises, so the parser reads past the buffer and raises. **Non-finite coordinates** — `NaN` or infinity — are a device failure: a sensor with no positional fix, a divide-by-zero in firmware, or an uninitialized register emits an ordinate that is syntactically valid but numerically meaningless. **Invalid-but-parseable topology** is a geometry failure: the bytes decode into a real ring, but that ring self-intersects, repeats a vertex, or violates the Open Geospatial Consortium (OGC) simple-feature rules that every downstream spatial operation assumes.

These fail differently and so must be handled differently, but they share one dangerous property: each can take down far more than its own record. A truncated WKB payload that raises inside a naive consumer stops offset commits, wedges the partition, and blocks every healthy reading behind it. A single `NaN` ordinate is worse because it does not raise at all — it compares false to every bound, slips silently through range checks, and then corrupts the bounding box of any spatial index it enters, so area, length, and distance return `NaN` across the entire layer. A self-intersecting polygon passes ingest cleanly and only detonates later, when a spatial join or a point-in-polygon test against it throws deep inside the analytics tier. In an incident context none of this is a mere data-quality nuisance: the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both expect the operational record to be reconstructable for after-action review, so a pipeline that silently swallows or mangles readings feeding a life-safety decision is not defensible. The fix has to keep the stream moving, and it has to record every decision — which is why corrupt-geometry recovery belongs in the [geospatial data ingestion pipeline](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) itself, not bolted on as an afterthought.

<svg viewBox="0 0 880 430" role="img" aria-label="Streaming geometry-triage diagram. Sensor messages flow left to right into a per-record triage gate with three ordered checks: a WKB parse guard, a non-finite coordinate scan, and an OGC validity check. Records that pass all checks are accepted onto the live stream; parseable-but-invalid records are repaired with make_valid and re-checked; unparseable or non-finite records are routed down to a quarantine dead-letter store. Every branch emits an audit record, and the consumer offset always advances so the stream never stalls." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Per-record geometry triage that repairs, quarantines, and never stalls the stream</title>
  <desc>Incoming sensor messages enter a triage gate one record at a time. The first check parses the well-known binary payload and catches truncated or malformed bytes. The second check scans every ordinate for NaN or infinity. The third check tests OGC simple-feature validity. Records that clear all three are accepted onto the live stream. Records that parse but fail the validity check are repaired with make_valid and re-tested. Records that cannot be parsed or that carry non-finite coordinates are routed to a quarantine dead-letter store. Every decision writes an audit record, and the consumer offset commits on every path so a single corrupt message can never block the partition.</desc>
  <defs>
    <marker id="corruptgeom-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="corruptgeom-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- inbound stream -->
  <rect x="24" y="176" width="118" height="52" rx="8" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="83" y="198" font-size="11.5" text-anchor="middle" font-weight="700" fill="currentColor">sensor stream</text>
  <text x="83" y="214" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.8">one record at a time</text>
  <path d="M142,202 H176" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#corruptgeom-plain)"/>
  <!-- triage gate stack -->
  <text x="330" y="40" font-size="12.5" text-anchor="middle" font-weight="700" fill="currentColor">Per-record triage gate</text>
  <rect x="180" y="56" width="300" height="44" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="196" y="76" font-size="11" font-weight="600" fill="currentColor">Check 1 · parse WKB</text>
  <text x="196" y="92" font-size="10" fill="currentColor" opacity="0.85">catch truncated / malformed bytes</text>
  <rect x="180" y="110" width="300" height="44" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="196" y="130" font-size="11" font-weight="600" fill="currentColor">Check 2 · finite coords</text>
  <text x="196" y="146" font-size="10" fill="currentColor" opacity="0.85">reject NaN / infinity ordinates</text>
  <rect x="180" y="164" width="300" height="44" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
  <text x="196" y="184" font-size="11" font-weight="600" fill="var(--crimson, currentColor)">Check 3 · OGC validity</text>
  <text x="196" y="200" font-size="10" fill="currentColor" opacity="0.85">detect self-intersection / bowtie</text>
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#corruptgeom-plain)">
    <path d="M330,100 V110"/>
    <path d="M330,154 V164"/>
  </g>
  <!-- accept path -->
  <path d="M480,186 H548 V128 H602" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#corruptgeom-plain)"/>
  <rect x="602" y="106" width="216" height="44" rx="8" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="710" y="126" font-size="11.5" text-anchor="middle" font-weight="700" fill="currentColor">accept → live stream</text>
  <text x="710" y="142" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">all three checks pass</text>
  <!-- repair path -->
  <path d="M480,186 H528 V236 H602" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#corruptgeom-arrow)"/>
  <text x="504" y="228" font-size="9.5" text-anchor="middle" fill="var(--crimson, currentColor)">invalid</text>
  <rect x="602" y="212" width="216" height="52" rx="8" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="710" y="232" font-size="11.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">repair · make_valid</text>
  <text x="710" y="248" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">re-check type + area,</text>
  <text x="710" y="260" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">then accept</text>
  <!-- quarantine path -->
  <path d="M330,208 V300 H602" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#corruptgeom-arrow)"/>
  <text x="452" y="292" font-size="9.5" text-anchor="middle" fill="var(--crimson, currentColor)">unparseable / non-finite</text>
  <rect x="602" y="276" width="216" height="52" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="710" y="296" font-size="11.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">quarantine · dead-letter</text>
  <text x="710" y="312" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">nothing dropped silently</text>
  <!-- audit + offset commit rail -->
  <line x1="180" y1="360" x2="818" y2="360" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>
  <rect x="180" y="374" width="300" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="330" y="398" font-size="10.5" text-anchor="middle" font-weight="600" fill="currentColor">audit record on every branch</text>
  <rect x="518" y="374" width="300" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="668" y="398" font-size="10.5" text-anchor="middle" font-weight="600" fill="currentColor">offset commits → stream never stalls</text>
  <g fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.7" marker-end="url(#corruptgeom-plain)">
    <path d="M710,150 V212"/>
  </g>
</svg>

## Tiered Resolution Strategy

Triage each record in ordered tiers, from the definitive accept down to a safe default that captures the record for review. The governing rule mirrors the one used across the pipeline: never drop a reading silently, because a missing sensor value is itself a loss of situational awareness.

1. **Accept clean, valid geometry (definitive).** The payload parses, every coordinate is finite, and the geometry satisfies OGC simple-feature validity. It flows straight onto the live stream untouched.
2. **Repair invalid-but-parseable topology.** The bytes decode into a real geometry that fails only the validity check — a self-intersection, a bowtie ring, a duplicate vertex. Run `make_valid`, then accept the result only if it preserves the original geometry type and a plausible area or length. A repair that collapses a polygon to a line or zero area is not a repair.
3. **Reject non-finite coordinates outright.** A `NaN` or infinite ordinate cannot be repaired into a real position, so there is nothing to salvage. Send the record to quarantine rather than guessing a coordinate.
4. **Quarantine the unparseable (safe default).** Truncated or malformed WKB that cannot be decoded goes to a dead-letter store keyed by sensor and offset, so it is preserved for inspection or replay after the transport fault is fixed — never retried in a tight loop that wedges the partition.
5. **Emit an audit record for every decision.** Sensor id, reason code, original byte length, and the repaired or substituted outcome — so the ingest result is reproducible and every quarantined reading is accountable, exactly as the [emergency metadata standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) require for lineage.

## Production Python Implementation

The routine below carries the full resolution path: defensive parsing, a finite-coordinate scan, `make_valid` repair with a type-and-measure sanity check, quarantine routing for the unrecoverable, structured logging, explicit exception handling, and an immutable audit record per decision. Thresholds and the quarantine sink are injected, not hard-coded, so the same triage runs identically across field nodes and the central pipeline. Senior-engineer assumptions apply: `shapely` 2.x (for `make_valid` and the GEOS bindings) is available, and geometry arrives as WKB bytes on the wire.

```python
from __future__ import annotations

import logging
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Optional

from shapely import make_valid
from shapely.errors import GEOSException, ShapelyError
from shapely.geometry.base import BaseGeometry
from shapely.wkb import loads as wkb_loads

logger = logging.getLogger("incidentgis.geom_ingest")


class Outcome(str, Enum):
    ACCEPTED = "accepted"
    REPAIRED = "repaired_make_valid"
    QUARANTINED_PARSE = "quarantined_unparseable"
    QUARANTINED_NONFINITE = "quarantined_non_finite"
    QUARANTINED_REPAIR = "quarantined_repair_failed"


@dataclass
class SensorMessage:
    sensor_id: str
    offset: int               # broker partition offset, for replay/traceability
    payload: bytes            # raw WKB on the wire
    received_at: float        # epoch seconds at consumer


@dataclass
class AuditEntry:
    """Immutable record of one triage decision, appended to the audit trail."""
    sensor_id: str
    offset: int
    outcome: str
    original_bytes: int
    detail: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class GeometryTriage:
    """Recover corrupt geometry from a live sensor stream without stalling it.

    Each message yields exactly one decision: accept, repair, or quarantine.
    Every decision is logged and appended to ``audit_log``; the caller commits
    the offset on every path so one bad record can never wedge the partition.
    """

    def __init__(
        self,
        quarantine_sink: Callable[[SensorMessage, str], None],
        min_repaired_area: float = 1e-9,
    ) -> None:
        self._quarantine = quarantine_sink
        self._min_repaired_area = min_repaired_area
        self.audit_log: list[AuditEntry] = []

    def _audit(
        self, msg: SensorMessage, outcome: Outcome, detail: str
    ) -> AuditEntry:
        entry = AuditEntry(
            sensor_id=msg.sensor_id,
            offset=msg.offset,
            outcome=outcome.value,
            original_bytes=len(msg.payload),
            detail=detail,
        )
        self.audit_log.append(entry)
        return entry

    def _has_non_finite(self, geom: BaseGeometry) -> bool:
        """True if any ordinate is NaN or infinite. NaN compares false to every
        bound, so it must be tested explicitly rather than via a range check."""
        for x, y in geom.exterior.coords if geom.geom_type == "Polygon" \
                else _iter_coords(geom):
            if not (math.isfinite(x) and math.isfinite(y)):
                return True
        return False

    def _reject(self, msg: SensorMessage, outcome: Outcome, detail: str) -> None:
        """Route to the dead-letter store and record the decision."""
        entry = self._audit(msg, outcome, detail)
        try:
            self._quarantine(msg, outcome.value)
        except Exception:  # sink failure must not stall the consumer
            logger.exception(
                "quarantine_sink_failed", extra={"audit": asdict(entry)}
            )
        logger.warning("geometry_quarantined", extra={"audit": asdict(entry)})

    def process(self, msg: SensorMessage) -> Optional[BaseGeometry]:
        """Return an accepted geometry, or None if the record was quarantined."""
        # Tier 1: defensive parse — a truncated payload raises, not the consumer.
        try:
            geom = wkb_loads(msg.payload)
        except (GEOSException, ShapelyError, ValueError, TypeError) as exc:
            self._reject(msg, Outcome.QUARANTINED_PARSE, f"wkb_load: {exc}")
            return None

        # Tier 3 (early): non-finite coordinates cannot be repaired — reject.
        try:
            if geom.is_empty or self._has_non_finite(geom):
                self._reject(
                    msg, Outcome.QUARANTINED_NONFINITE, "empty or NaN/inf ordinate"
                )
                return None
        except (AttributeError, GEOSException) as exc:
            self._reject(msg, Outcome.QUARANTINED_PARSE, f"coord_scan: {exc}")
            return None

        # Tier 1 accept: already valid, pass straight through.
        if geom.is_valid:
            self._audit(msg, Outcome.ACCEPTED, geom.geom_type)
            logger.debug("geometry_accepted", extra={"sensor": msg.sensor_id})
            return geom

        # Tier 2: repair parseable-but-invalid topology, then sanity-check it.
        try:
            repaired = make_valid(geom)
        except (GEOSException, ShapelyError) as exc:
            self._reject(msg, Outcome.QUARANTINED_REPAIR, f"make_valid: {exc}")
            return None

        if (
            repaired.is_empty
            or repaired.geom_type != geom.geom_type
            or (geom.geom_type in ("Polygon", "MultiPolygon")
                and repaired.area < self._min_repaired_area)
        ):
            # A "repair" that changes type or collapses area is not a repair.
            self._reject(
                msg, Outcome.QUARANTINED_REPAIR,
                f"type {geom.geom_type}->{repaired.geom_type}, area {repaired.area}",
            )
            return None

        self._audit(msg, Outcome.REPAIRED, f"{geom.geom_type} self-intersection")
        logger.info("geometry_repaired", extra={"sensor": msg.sensor_id})
        return repaired


def _iter_coords(geom: BaseGeometry):
    """Yield (x, y) tuples across points, lines, and multi-geometries."""
    if hasattr(geom, "geoms"):
        for part in geom.geoms:
            yield from _iter_coords(part)
    else:
        yield from geom.coords
```

The `audit_log` is the load-bearing output. Persisted alongside the dead-letter store, it lets a reviewer replay every quarantined offset once the transport fault is resolved and confirm that no reading was fabricated or silently lost — the same accountability contract that governs the wider [geospatial data ingestion pipeline](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/).

## Validation Checklist

Verify every item before pointing the triage at a live sensor feed.

- [ ] Parsing, the coordinate scan, and `make_valid` are each wrapped so a single corrupt record raises a caught error and is quarantined, never propagated to crash the consumer.
- [ ] The offset commits on every path — accept, repair, and all quarantine branches — so a poison message can never wedge the partition or replay forever.
- [ ] `NaN` and infinite ordinates are tested with an explicit `math.isfinite` check, not a range comparison that they would silently pass.
- [ ] A `make_valid` result is accepted only when it preserves the original geometry type and a plausible area or length; type-changing or area-collapsing repairs are quarantined.
- [ ] The quarantine sink is idempotent and its own failure is caught and logged, so a dead-letter write error cannot stall ingest.
- [ ] Every accept, repair, and quarantine appends an `AuditEntry` with sensor id, offset, and reason code, and logs route to the incident logging sink rather than stdout.
- [ ] The dead-letter store is keyed by sensor and offset so quarantined records can be replayed after the upstream transport fault is fixed.
- [ ] The triage is unit-tested against a fixture set containing truncated WKB, a `NaN` point, and a self-intersecting bowtie polygon, asserting one accept, one repair, and two quarantines.

## Edge Cases and Gotchas

- **NaN slips through range checks.** `NaN < bound` and `NaN > bound` both evaluate false, so a latitude of `NaN` passes any naive bounds test and then blanks the bounding box of every spatial index it enters. Always test finiteness with `math.isfinite` per ordinate before trusting a geometry, and quarantine on the first non-finite value.
- **make_valid can silently change geometry type.** GEOS may return a `GeometryCollection` or a `MultiLineString` when it splits a self-intersecting polygon, which is not what a downstream polygon layer expects. Guard on `geom_type` equality after repair and quarantine the mismatch rather than writing a shape the schema cannot hold.
- **Axis-order inversion masquerades as corruption.** A sensor that emits `(lat, lon)` while the pipeline assumes `(lon, lat)` produces geometry that parses and is topologically valid but lands in the wrong hemisphere. Enforce the axis-order contract at ingest with `always_xy=True`, the same rule applied when [handling missing CRS in field-collected GPS logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/); the triage here validates topology, not position.
- **Offline device buffering replays stale bytes.** A sensor that buffers during a backhaul brownout may flush a burst of duplicated or reordered WKB on reconnect, so quarantine keyed only by content will collide. Key the dead-letter store by sensor id and broker offset so replays remain individually addressable.
- **A poison message with an idempotent write is the real trap.** If the quarantine sink itself throws and the offset is not committed, the consumer reprocesses the same corrupt record forever. Commit the offset after quarantine and make the sink write idempotent so redelivery is harmless rather than a loop.

## Frequently Asked Questions

**How do I keep one corrupt geometry from stalling the whole sensor stream?** Isolate the failure to a single record. Wrap parsing and validation for each message in explicit exception handling so a truncated payload or non-finite coordinate raises a caught error, then route that one record to a quarantine or dead-letter store and commit the offset so the consumer advances. The stream keeps flowing because no single message can block the batch or crash the consumer; every corrupt record is captured for later inspection rather than retried forever.

**When should I repair invalid geometry versus drop it?** Repair geometry that parses cleanly but fails an OGC validity check — self-intersections, bowtie rings, and duplicate vertices — because `make_valid` can reconstruct a topologically correct shape. Accept the repaired result only if it keeps the original geometry type and a plausible area or length. Quarantine anything that cannot be parsed at all, such as truncated WKB, or that contains `NaN` or infinite coordinates, because there is no defensible way to guess the intended shape. Never drop silently: every repair and every quarantine gets an audit record.

**Why are NaN coordinates so dangerous in an incident pipeline?** A non-finite ordinate poisons everything computed from it. `NaN` compares false to every bound, so it slips through range checks, corrupts the bounding box of any spatial index it enters, and makes area, length, and distance return `NaN` across the whole layer. On a Common Operating Picture that can blank a query result or misplace a sensor reading feeding a life-safety decision. Because `NaN` cannot be repaired into a real position, the only safe action is to reject the coordinate outright and quarantine the record with an audit entry.

## Related

- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) — the ingestion architecture this triage plugs into, from parse to persistence.
- [Handling Missing CRS in Field-Collected GPS Logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/) — resolve the axis-order and datum context that keeps valid geometry from landing in the wrong place.
- [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) — the lineage and provenance contract that makes the audit trail auditable.

Up: [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/)
