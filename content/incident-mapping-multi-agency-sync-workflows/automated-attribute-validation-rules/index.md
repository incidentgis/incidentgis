---
title: "Automated Attribute Validation Rules"
description: "Production Python patterns for automated attribute validation in incident GIS: declarative Pydantic/Pandera schemas, geometry gates, quarantine routing, and CI smoke tests for multi-agency sync."
slug: automated-attribute-validation-rules
type: guide
breadcrumb: "Automated Attribute Validation Rules"
datePublished: "2025-02-18"
dateModified: "2026-06-25"
---

# Automated Attribute Validation Rules for Incident GIS Workflows

A wildfire branch director commits a perimeter polygon from a field tablet. The record carries `status: "CONTAINED"` but `containment_percentage: 0`, a self-intersecting ring from a GPS that jittered while the responder walked the line, and a `reported_utc` timestamp that — because the device clock never synced — sits three days in the future. Without a deterministic gate at the ingestion boundary, that single payload propagates into the Common Operating Picture (COP), flips a dashboard tile to "contained," and pulls two engine companies off the active flank. Automated attribute validation rules exist to stop exactly this: they enforce structural, semantic, and spatial constraints on every feature *before* it reaches an operational datastore, so malformed telemetry is quarantined and audited rather than acted upon.

This is the validation layer that sits between transport and storage in [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/). It assumes you have already normalized location attributes upstream and that you need a versioned, testable rule set rather than scattered `if`-checks. The patterns below are framed for senior engineers — `pydantic`, `shapely`, `geopandas`, and `pyproj` are assumed knowledge.

## Problem Framing

In high-velocity incident management, an unvalidated attribute payload is the primary vector for spatial drift, resource misallocation, and inter-agency communication breakdown. The records arrive faster than any human can inspect them, from heterogeneous sources — computer-aided dispatch (CAD) bridges, mobile responders, partner-agency feeds, drone telemetry — each with its own idea of what a "valid" incident looks like. The failure this topic prevents is the *silent* one: a record that parses as JSON, passes a transport handshake, and is structurally plausible enough to commit, yet is semantically wrong in a way that costs response time. Validation is the deterministic point where that record is caught, labelled, and routed away from the active layer with an audit trail intact.

## Prerequisites

Before this pattern applies, the following must already be true in your pipeline:

- **Python 3.11+** with `pydantic>=2.0`, `pandera`, `geopandas`, `shapely>=2.0`, and `pyproj` installed. Pydantic 2's Rust-backed validation is what makes per-record gating viable at ingestion throughput.
- **A normalized coordinate frame.** Validation assumes geometries already arrive in EPSG:4326 (WGS 84 geographic coordinates). Reprojection is not validation's job; inputs in other systems must pass through the [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) standard first, or a perfectly "valid" centroid check will pass on the wrong datum.
- **Location attributes resolved.** Address-to-coordinate resolution and field cleanup belong to [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/); validation enforces the *thresholds* (precision, bounding box, null-island rejection) that normalization is expected to satisfy.
- **A canonical record contract.** Agency adapters must translate into the shared COP field set (the `incident_id` / `agency_code` / `status` / `geometry` contract) *before* validation runs, so rules target one schema rather than N integration shapes.

## Validation Topology

Production-grade validation is not a single function call — it executes across three synchronized tiers, each tuned for a different network condition and operational phase. Pushing every check to one tier either wastes field bandwidth (too much server-side) or leaks bad data past offline devices (too much client-side).

<svg viewBox="0 0 920 430" role="img" aria-label="Three-tier validation topology. Tier 1, edge or client pre-validation on field tablets, runs offline and checks mandatory fields, enum constraints, and geometry parsing before transmission. Tier 2, the ingestion microservice, applies business logic, jurisdiction cross-reference, and cross-field dependency rules, then forks failing records to a quarantine queue and taps an append-only audit log. Records that pass commit to the central geodatabase. Tier 3, post-sync reconciliation, runs asynchronously across agency replicas to detect attribute drift, orphaned geometries, and conflicting status flags." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Three-tier automated attribute validation topology</title>
  <desc>Field payloads pass through Tier 1 edge pre-validation on tablets — mandatory-field, enum, and geometry-parse checks that run offline to preserve bandwidth. Surviving records reach Tier 2, the ingestion microservice, where business logic, jurisdiction cross-reference, and cross-field dependency rules run. Failing records fork to a quarantine queue and every disposition taps an append-only audit log; passing records commit to the central geodatabase. Tier 3 reconciliation then runs asynchronously across agency replicas, auditing for attribute drift, orphaned geometries, and conflicting status flags, and feeding anomalies back to the same audit log.</desc>
  <defs>
    <marker id="val-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="val-flow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <!-- tier labels -->
    <text x="135" y="22" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Tier 1 · edge / client</text>
    <text x="460" y="22" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Tier 2 · ingestion microservice</text>
    <text x="800" y="22" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Tier 3 · post-sync reconciliation</text>
    <!-- tier separators -->
    <line x1="270" y1="34" x2="270" y2="410" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>
    <line x1="650" y1="34" x2="650" y2="410" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>
    <!-- field source -->
    <rect x="22" y="92" width="104" height="56" rx="7" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="74" y="115" font-size="11.5">Field tablet</text>
    <text x="74" y="132" font-size="10">CAD · responder</text>
    <!-- tier 1 box -->
    <rect x="150" y="74" width="104" height="92" rx="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/>
    <text x="202" y="98" font-weight="600">Pre-validate</text>
    <text x="202" y="116" font-size="10">runs offline</text>
    <text x="202" y="134" font-size="10">required · enum</text>
    <text x="202" y="149" font-size="10">geometry parse</text>
    <!-- tier 2 main box -->
    <rect x="296" y="74" width="142" height="92" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
    <text x="367" y="97" font-weight="700">Rule engine</text>
    <text x="367" y="115" font-size="10">business logic</text>
    <text x="367" y="130" font-size="10">jurisdiction x-ref</text>
    <text x="367" y="145" font-size="10">cross-field deps</text>
    <text x="367" y="160" font-size="10">Pydantic · shapely</text>
    <!-- quarantine queue (side branch) -->
    <rect x="296" y="208" width="142" height="50" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4"/>
    <text x="367" y="230" font-weight="600">Quarantine queue</text>
    <text x="367" y="247" font-size="10">failed records · held</text>
    <!-- audit log (side branch) -->
    <rect x="296" y="300" width="142" height="50" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4"/>
    <text x="367" y="322" font-weight="600">Audit log</text>
    <text x="367" y="339" font-size="9.5">append-only · chain of custody</text>
    <!-- commit / geodatabase -->
    <rect x="478" y="74" width="142" height="92" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="549" y="112" font-weight="700">Central</text>
    <text x="549" y="129" font-weight="700">geodatabase</text>
    <text x="549" y="148" font-size="10">committed COP</text>
    <!-- tier 3 reconciliation -->
    <rect x="676" y="74" width="142" height="92" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="747" y="97" font-weight="600">Reconcile</text>
    <text x="747" y="115" font-size="10">async audit</text>
    <text x="747" y="130" font-size="10">drift · orphans</text>
    <text x="747" y="145" font-size="10">status conflicts</text>
    <!-- agency replicas -->
    <rect x="676" y="246" width="142" height="56" rx="7" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="747" y="269" font-size="11.5">Agency replicas</text>
    <text x="747" y="286" font-size="10">multi-jurisdiction</text>
  </g>
  <!-- flows -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#val-flow)">
    <path d="M126,120 H150"/>
    <path d="M254,120 H296"/>
    <path d="M438,120 H478"/>
    <path d="M620,120 H676"/>
    <!-- quarantine fork -->
    <path d="M367,166 V208"/>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#val-flow-dim)" stroke-dasharray="5 4">
    <!-- audit taps -->
    <path d="M367,258 V300"/>
    <path d="M478,150 Q452,300 438,322"/>
    <!-- tier 3 reads replicas and feeds audit -->
    <path d="M747,166 V246"/>
    <path d="M676,290 Q470,380 438,344"/>
  </g>
  <g font-size="9.5" fill="currentColor" text-anchor="middle">
    <text x="458" y="113" fill="var(--crimson, currentColor)">pass</text>
    <text x="392" y="190" fill="var(--crimson, currentColor)">fail</text>
    <text x="747" y="216">audit across replicas</text>
  </g>
</svg>

1. **Edge / client-side pre-validation.** Lightweight schema checks executed on field tablets or ruggedized edge gateways. These validate mandatory fields, enforce enum constraints, and reject unparseable geometries before transmission, preserving bandwidth during degraded connectivity.
2. **Ingestion microservice validation.** High-throughput Python engines in containerized services. This tier applies complex business logic, cross-references jurisdictional boundaries, and runs the cross-field dependency rules before any feature is committed to the central geodatabase. For live streams, this tier must evaluate rules statelessly against message payloads so [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) never block the event bus on a slow check.
3. **Post-sync reconciliation validation.** Asynchronous audit routines triggered after multi-jurisdictional commit cycles. These detect attribute drift, orphaned geometries, and conflicting status flags across agency boundaries — the safety net behind [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/).

## Step-by-Step Implementation

The engine below is field-tested for emergency response workloads. It validates each record independently with `pydantic` so one bad feature never aborts a batch, runs geometry checks through `shapely` inside field validators (Pandera has no native `GeoSeries` dtype, so geometry validation does not belong in a DataFrameSchema), and routes failures to a quarantine report rather than dropping them.

### Step 1 — Define the declarative record schema

Hardcoded validation logic fails under the dynamic requirements of emergency operations. Keep rule definitions declarative and version-controlled alongside infrastructure-as-code, so a schema change is a reviewable diff, not a silent code edit.

```python
import logging
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from shapely.geometry import shape
from shapely.validation import explain_validity

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("incident_validation_engine")

# (min_lon, min_lat, max_lon, max_lat) — Continental United States envelope
CONUS_BOUNDS: tuple[float, float, float, float] = (-125.0, 24.4, -66.9, 49.38)
MAX_AGE_DAYS: int = 30


class IncidentRecord(BaseModel):
    incident_id: str = Field(..., pattern=r"^INC-\d{8}-[A-Z]{3}$")
    agency_code: str = Field(..., pattern=r"^(FD|PD|EMS|EMA|USAR|FEMA)$")
    severity_level: int = Field(..., ge=1, le=5)
    status: str = Field(..., pattern=r"^(ACTIVE|CONTAINED|RESOLVED|ARCHIVED)$")
    containment_percentage: float = Field(0.0, ge=0.0, le=100.0)
    reported_utc: datetime
    geometry: dict[str, Any]  # GeoJSON geometry dict (validated last)
```

### Step 2 — Enforce temporal guardrails

Stale or future-dated timestamps let dispatch act on expired intelligence. Reject anything outside the operational window and normalize to UTC so the downstream last-writer-wins conflict logic compares like with like.

```python
    @field_validator("reported_utc")
    @classmethod
    def validate_temporal_window(cls, v: datetime) -> datetime:
        """Reject timestamps older than MAX_AGE_DAYS or dated in the future."""
        now = datetime.now(timezone.utc)
        v_utc = v.astimezone(timezone.utc) if v.tzinfo else v.replace(tzinfo=timezone.utc)
        if v_utc > now:
            raise ValueError("Future timestamp rejected — check device clock sync")
        if (now - v_utc).days > MAX_AGE_DAYS:
            raise ValueError(f"Timestamp outside {MAX_AGE_DAYS}-day operational window")
        return v_utc
```

### Step 3 — Gate geometry validity and spatial extent

Validate that the geometry parses, is topologically valid, and falls inside the expected operational envelope. The centroid-in-CONUS check is a cheap guard against null-island `(0, 0)` drift and gross datum errors; tighten it to your incident's actual bounding box in production.

```python
    @field_validator("geometry")
    @classmethod
    def validate_geometry(cls, v: dict[str, Any]) -> dict[str, Any]:
        try:
            geom = shape(v)
        except Exception as exc:  # noqa: BLE001 — surface any parse failure as a field error
            raise ValueError(f"Unparseable geometry: {exc}") from exc
        if geom.is_empty:
            raise ValueError("Empty geometry rejected")
        if not geom.is_valid:
            raise ValueError(f"Invalid geometry: {explain_validity(geom)}")
        cx, cy = geom.centroid.x, geom.centroid.y
        min_lon, min_lat, max_lon, max_lat = CONUS_BOUNDS
        if not (min_lon <= cx <= max_lon and min_lat <= cy <= max_lat):
            raise ValueError(f"Centroid ({cx:.4f}, {cy:.4f}) outside operational bounds")
        return v
```

### Step 4 — Add the cross-field dependency rule

The hardest defects are inter-field contradictions a single-field validator cannot see. A model validator runs after all fields are populated, so it can assert that a `CONTAINED` status carries a non-zero containment figure — the exact contradiction from the opening scenario.

```python
    @model_validator(mode="after")
    def validate_status_dependencies(self) -> "IncidentRecord":
        if self.status == "CONTAINED" and self.containment_percentage <= 0.0:
            raise ValueError("status=CONTAINED requires containment_percentage > 0")
        if self.status == "RESOLVED" and self.containment_percentage < 100.0:
            logger.warning(
                "incident_id=%s RESOLVED with containment_percentage=%.1f",
                self.incident_id, self.containment_percentage,
            )
        return self
```

The rule is easier to get right when it is written down as a table of admissible pairs rather than as a chain of conditionals, because the shape of the table is the specification and the conditionals are only one encoding of it.

<svg viewBox="0 0 880 400" role="img" aria-labelledby="xfield-title xfield-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="xfield-title">Which combinations of incident status and containment percentage the cross-field rule admits</title>
  <desc id="xfield-desc">A matrix of five incident status values against four containment percentage bands. NEW admits only zero per cent, because nothing has been assessed yet. ACTIVE admits zero through ninety-nine but not one hundred. CONTAINED, CONTROLLED and OUT admit only one hundred per cent, because this site's contract defines all three as requiring a fully lined perimeter. Every other combination is a contradiction. The outlined cell is the opening scenario — status CONTAINED carrying zero per cent containment — which passes every single-field check because the status is a legal enum value and the percentage is a legal number; only a validator that runs after both fields are populated can see that together they are impossible.</desc>
  <rect x="0" y="0" width="880" height="400" fill="var(--blush)"/>
  <text x="8" y="44" font-size="10.5" fill="var(--muted)">contract: CONTAINED · CONTROLLED · OUT all require a fully lined perimeter</text>
    <text x="295" y="76" font-size="11" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">0%</text>
    <text x="445" y="76" font-size="11" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">1–49%</text>
    <text x="595" y="76" font-size="11" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">50–99%</text>
    <text x="745" y="76" font-size="11" font-weight="700" text-anchor="middle" fill="var(--crimson-deep)">100%</text>
    <rect x="220" y="90" width="150" height="50" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="370" y="90" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="520" y="90" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="670" y="90" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="220" y="140" width="150" height="50" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="370" y="140" width="150" height="50" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="520" y="140" width="150" height="50" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="670" y="140" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="220" y="190" width="150" height="50" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2.4"/>
    <rect x="370" y="190" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="520" y="190" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="670" y="190" width="150" height="50" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="220" y="240" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="370" y="240" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="520" y="240" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="670" y="240" width="150" height="50" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="220" y="290" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="370" y="290" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="520" y="290" width="150" height="50" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <rect x="670" y="290" width="150" height="50" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
    <path d="M287 115 l6 7 l11 -14" fill="none" stroke="var(--crimson-deep)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M438 108 l14 14 M452 108 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M588 108 l14 14 M602 108 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M738 108 l14 14 M752 108 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M287 165 l6 7 l11 -14" fill="none" stroke="var(--crimson-deep)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M437 165 l6 7 l11 -14" fill="none" stroke="var(--crimson-deep)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M587 165 l6 7 l11 -14" fill="none" stroke="var(--crimson-deep)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M738 158 l14 14 M752 158 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M288 208 l14 14 M302 208 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M438 208 l14 14 M452 208 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M588 208 l14 14 M602 208 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M737 215 l6 7 l11 -14" fill="none" stroke="var(--crimson-deep)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M288 258 l14 14 M302 258 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M438 258 l14 14 M452 258 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M588 258 l14 14 M602 258 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M737 265 l6 7 l11 -14" fill="none" stroke="var(--crimson-deep)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M288 308 l14 14 M302 308 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M438 308 l14 14 M452 308 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M588 308 l14 14 M602 308 l-14 14" fill="none" stroke="var(--ember)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M737 315 l6 7 l11 -14" fill="none" stroke="var(--crimson-deep)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <g fill="currentColor">
    <text x="8" y="120" font-size="11" font-weight="700">NEW</text>
    <text x="8" y="170" font-size="11" font-weight="700">ACTIVE</text>
    <text x="8" y="220" font-size="11" font-weight="700">CONTAINED</text>
    <text x="8" y="270" font-size="11" font-weight="700">CONTROLLED</text>
    <text x="8" y="320" font-size="11" font-weight="700">OUT</text>
  </g>
  <text x="440" y="374" font-size="11" text-anchor="middle" fill="var(--muted)">The outlined cell is the opening scenario — legal in every single-field check, impossible as a pair.</text>
</svg>

What the matrix makes obvious is that the contradictions are not evenly distributed — they cluster, and they cluster around the transitions. Twelve of the twenty combinations are impossible, and every one of them involves a status that has an implied containment and a figure that disagrees with it. That is a useful property when writing the validator: the rule is not twenty special cases, it is one statement per status about the containment range it implies, which is four lines of policy an operations chief can read and sign off on.

It is also the reason this belongs in a model validator rather than a field validator. Both halves of every contradiction are individually valid — `CONTAINED` is a legal enum member and `0` is a legal percentage — so no amount of per-field strictness will catch them. Only a check that runs once all fields are populated can see the pair.

### Step 5 — Batch-validate with quarantine routing

Validate per record, aggregate every failure into a structured report, and isolate bad records rather than dropping them. Quarantine preserves the audit trail required for post-incident review and compliance audits.

```python
from dataclasses import dataclass, field as dc_field


@dataclass
class ValidationIssue:
    record_index: int
    field: str
    error_type: str
    actual: Any
    severity: str = "ERROR"


@dataclass
class ValidationReport:
    total_records: int = 0
    passed: int = 0
    failed: int = 0
    issues: list[ValidationIssue] = dc_field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "summary": {"total": self.total_records, "passed": self.passed, "failed": self.failed},
            "issues": [i.__dict__ for i in self.issues],
        }


def validate_incident_batch(records: list[dict[str, Any]]) -> ValidationReport:
    """Validate each record independently; aggregate failures for quarantine routing."""
    report = ValidationReport(total_records=len(records))
    for idx, raw in enumerate(records):
        try:
            IncidentRecord.model_validate(raw)
            report.passed += 1
        except ValidationError as exc:
            report.failed += 1
            for err in exc.errors():
                loc = ".".join(str(part) for part in err["loc"])
                report.issues.append(
                    ValidationIssue(
                        record_index=idx,
                        field=loc,
                        error_type=err["type"],
                        actual=str(err.get("input", "N/A")),
                        severity="CRITICAL" if "incident_id" in err["loc"] else "WARNING",
                    )
                )
            logger.warning("Record %d quarantined: %d error(s)", idx, exc.error_count())
    logger.info("Batch complete: %d passed, %d quarantined.", report.passed, report.failed)
    return report
```

### Step 6 — Wrap the ingestion entry point

The handler flattens GeoJSON features to the canonical record shape, runs the batch, and returns an explicit disposition. A clean batch commits; any failure quarantines the whole payload for review rather than partially committing an inconsistent set.

```python
import json


def process_ingestion_payload(json_payload: str) -> dict[str, Any]:
    """End-to-end ingestion handler with explicit, auditable dispositions."""
    try:
        raw_data = json.loads(json_payload)
    except json.JSONDecodeError as exc:
        logger.error("Malformed JSON payload: %s", exc)
        return {"status": "PARSE_ERROR", "details": str(exc)}

    features = raw_data.get("features", [])
    flat = [
        {**feat.get("properties", {}), "geometry": feat.get("geometry")}
        for feat in features
    ]
    report = validate_incident_batch(flat)

    if report.failed == 0:
        return {"status": "COMMITTED", "report": report.to_dict()}
    logger.info("Routing %d failed record(s) to quarantine queue.", report.failed)
    return {"status": "QUARANTINED", "report": report.to_dict()}
```

For rigid federal submissions — damage-assessment layers, shelter locations, hazard perimeters — the per-record contract above is wrapped by a format-specific pre-check; see [Validating FEMA Shapefile Schemas Automatically](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/validating-fema-shapefile-schemas-automatically/) for the DBF-truncation and `.prj` mismatch handling that must run before these rules apply.

## Configuration Reference

Expose the tunable policy as environment variables or a versioned rule registry so operators can tighten thresholds per incident without redeploying code.

| Parameter | Env var | Default | Purpose |
|-----------|---------|---------|---------|
| Operational age window | `IVE_MAX_AGE_DAYS` | `30` | Max age of `reported_utc` before rejection |
| Spatial envelope | `IVE_BOUNDS` | CONUS | `min_lon,min_lat,max_lon,max_lat` extent gate |
| Auto-commit confidence floor | `IVE_MIN_CONFIDENCE` | `0.80` | Below this, route to review queue not active layer |
| Quarantine mode | `IVE_QUARANTINE_MODE` | `batch` | `batch` rejects whole payload; `record` commits the clean subset |
| Geometry repair | `IVE_AUTOFIX_TOPOLOGY` | `false` | If `true`, attempt `make_valid()` before failing |
| Audit sink | `IVE_AUDIT_SINK` | `stdout` | Where the quarantine report is emitted for chain-of-custody |
| Log level | `IVE_LOG_LEVEL` | `INFO` | Structured-logging verbosity |

The quarantine mode is the one setting on that list with no safe default, because the two options fail in opposite directions and which failure you prefer depends on what the payload means.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="qmode-title qmode-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="qmode-title">What batch and record quarantine modes do to one payload containing three invalid records</title>
  <desc id="qmode-desc">A fifty-record payload is drawn as fifty squares, three of which are invalid. Under batch quarantine mode the whole payload is rejected: nothing is committed and all fifty records go to the review queue, so three bad records hold forty-seven good ones. Under record mode the clean subset commits: forty-seven records reach the active layer and only the three invalid ones return to the authoring agency. Batch mode preserves the payload as an atomic unit, which matters when the records are interdependent; record mode preserves availability, which matters when they are not.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="200" y="52" font-size="11" font-weight="700" fill="var(--crimson-deep)">a 50-record payload carrying 3 invalid records</text>
  <text x="8" y="86" font-size="11" font-weight="700" fill="currentColor">MODE = batch</text>
  <text x="8" y="102" font-size="10" fill="var(--muted)">0 committed</text>
  <text x="8" y="116" font-size="10" fill="var(--muted)">50 quarantined</text>
    <rect x="200" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="219" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="238" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="257" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="276" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="295" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="314" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="333" y="92" width="15" height="15" rx="3" fill="var(--ember)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
    <rect x="352" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="371" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="390" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="409" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="428" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="447" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="466" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="485" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="504" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="523" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="542" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="561" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="580" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="599" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="618" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="637" y="92" width="15" height="15" rx="3" fill="var(--ember)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
    <rect x="656" y="92" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="200" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="219" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="238" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="257" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="276" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="295" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="314" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="333" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="352" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="371" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="390" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="409" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="428" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="447" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="466" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="485" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="504" y="116" width="15" height="15" rx="3" fill="var(--ember)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
    <rect x="523" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="542" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="561" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="580" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="599" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="618" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="637" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="656" y="116" width="15" height="15" rx="3" fill="var(--ember)" opacity="0.55" stroke="var(--line-strong)" stroke-width="1.1"/>
  <text x="710" y="104" font-size="10.5" fill="currentColor">three bad records</text>
  <text x="710" y="119" font-size="10.5" fill="currentColor">hold 47 good ones</text>
  <text x="8" y="206" font-size="11" font-weight="700" fill="currentColor">MODE = record</text>
  <text x="8" y="222" font-size="10" fill="var(--muted)">47 committed</text>
  <text x="8" y="236" font-size="10" fill="var(--muted)">3 quarantined</text>
    <rect x="200" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="219" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="238" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="257" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="276" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="295" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="314" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="333" y="212" width="15" height="15" rx="3" fill="var(--ember)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
    <rect x="352" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="371" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="390" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="409" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="428" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="447" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="466" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="485" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="504" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="523" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="542" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="561" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="580" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="599" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="618" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="637" y="212" width="15" height="15" rx="3" fill="var(--ember)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
    <rect x="656" y="212" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="200" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="219" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="238" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="257" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="276" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="295" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="314" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="333" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="352" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="371" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="390" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="409" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="428" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="447" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="466" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="485" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="504" y="236" width="15" height="15" rx="3" fill="var(--ember)" stroke="var(--crimson-deep)" stroke-width="1.1"/>
    <rect x="523" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="542" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="561" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="580" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="599" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="618" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="637" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
    <rect x="656" y="236" width="15" height="15" rx="3" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <text x="710" y="224" font-size="10.5" fill="currentColor">clean subset commits;</text>
  <text x="710" y="239" font-size="10.5" fill="currentColor">3 return to the author</text>
  <circle cx="206" cy="288" r="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <text x="220" y="292" font-size="10.5" fill="currentColor">committed to the active layer</text>
  <circle cx="446" cy="288" r="7" fill="var(--ember)" opacity="0.55"/>
  <text x="460" y="292" font-size="10.5" fill="currentColor">quarantined for review</text>
  <text x="440" y="322" font-size="11" text-anchor="middle" fill="var(--muted)">Neither mode is safer in general — they trade atomicity against availability.</text>
</svg>

Choose `batch` when the records in a payload are interdependent — a perimeter and the division breaks that reference it, or a shelter roster whose totals must reconcile. Committing forty-seven of fifty there produces a Common Operating Picture that is internally inconsistent in a way no single record reveals, which is worse than having nothing, because it looks complete. Choose `record` when the payload is merely a batch of independent observations that happened to travel together, which is the common case for sensor and field-collection traffic. There, holding forty-seven valid observations because three were malformed is a self-inflicted outage.

The mode is per-source, not global, and it should be set by whoever knows what the payload represents rather than by whoever operates the pipeline. A useful default is to start every new integration in `batch` and relax it to `record` once someone has confirmed the records are genuinely independent — the direction of that migration matters, because relaxing after evidence is a decision and tightening after an incident is a post-mortem action item.

## Verification & Smoke Test

Treat the rule set as code: a failing validator is a failing test. The smoke test below asserts that each guard fires on a known-bad fixture, which is what you run in staging before promoting a schema change.

```python
def _smoke_test() -> None:
    good = {
        "incident_id": "INC-20260625-WLD",
        "agency_code": "USAR",
        "severity_level": 4,
        "status": "CONTAINED",
        "containment_percentage": 35.0,
        "reported_utc": "2026-06-25T14:00:00Z",
        "geometry": {"type": "Point", "coordinates": [-119.7, 37.5]},
    }
    report = validate_incident_batch([good])
    assert report.passed == 1 and report.failed == 0, "valid record must pass"

    # Contradiction: CONTAINED with 0% containment must be quarantined
    bad = {**good, "containment_percentage": 0.0}
    assert validate_incident_batch([bad]).failed == 1, "cross-field rule must fire"

    # Null-island drift must be rejected by the bounds gate
    drift = {**good, "geometry": {"type": "Point", "coordinates": [0.0, 0.0]}}
    assert validate_incident_batch([drift]).failed == 1, "bounds gate must fire"

    logger.info("Smoke test passed: all guards fire on known-bad fixtures.")


if __name__ == "__main__":
    _smoke_test()
```

Run it in CI on every change to the schema module:

```bash
python -m incident_validation_engine        # exits non-zero if any assertion fails
```

## Integration With Adjacent Workflows

Validation is one stage in a chain, not an island. Upstream, the geocoding layer is expected to deliver coordinates that already satisfy the bounds and precision thresholds these rules enforce — when the geocoder and the validator disagree, the geocoder's confidence score is the field that gates auto-commit versus the review queue. Downstream, every record that survives validation still has to merge cleanly across jurisdictions, which is where conflict resolution takes over using the same normalized `updated_at` timestamp this layer guarantees. On the transport edge, the stateless evaluation pattern keeps rule checks inline with the live-feed transport without blocking the bus. All four stages report into the same audit sink so the chain of custody is reconstructable end to end. The parent guide, [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/), shows how these stages compose into one architecture rather than four scripts.

## Troubleshooting

**Symptom: valid records are quarantined with `geometry.value_error` after a CRS change.**
Root cause: the centroid check assumes EPSG:4326, but features arrived in a projected CRS (state plane), so coordinates fall far outside the lon/lat envelope. Remediation: reproject at the boundary before validation, never inside it.

```python
import geopandas as gpd

def ensure_wgs84(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        raise ValueError("Cannot validate geometry: source CRS is undefined")
    return gdf.to_crs(epsg=4326) if gdf.crs.to_epsg() != 4326 else gdf
```

**Symptom: throughput collapses under surge load.**
Root cause: geometry parsing dominates CPU when payloads carry dense polygons. Remediation: short-circuit cheap field checks first (Pydantic validates in field-declaration order — keep `geometry` last in the model) and consider sampling vertices for the validity check on very large rings.

**Symptom: a `RESOLVED` incident still shows `containment_percentage < 100`.**
Root cause: the cross-field rule logs a warning rather than rejecting, by design, so legitimate partial-resolution edge cases are not blocked. Remediation: if your jurisdiction requires hard enforcement, promote the `model_validator` warning to a `raise ValueError`.

**Symptom: timestamps drift one day at a time across the batch.**
Root cause: naive datetimes are being treated as local time, not UTC. Remediation: the `validate_temporal_window` validator already normalizes to UTC — ensure upstream parsers attach `tzinfo` rather than stripping it.

**Symptom: the quarantine queue grows without bound during an exercise.**
Root cause: a partner agency is emitting a non-canonical enum (`state: 2` instead of `status: "ACTIVE"`). Remediation: fix the adapter that maps that agency into the canonical contract — do not loosen the enum, or you lose the NIMS-aligned lifecycle guarantee.

## Compliance Alignment

Automated attribute validation rules must map to federal interoperability standards and internal data governance policy. Maintain a versioned rule registry keyed to National Incident Management System (NIMS) resource typing, Federal Emergency Management Agency (FEMA) Public Assistance reporting requirements, and state emergency-management directives, and run schema updates through CI before deployment. Because failures are quarantined and emitted to an audit sink rather than dropped, the layer doubles as a chain-of-custody record — every rejected feature is reconstructable for after-action review, which is the audit posture ISO 22320 (the international standard for emergency management and incident command interoperability) expects of a shared operational picture.

## Related

- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) — the upstream stage that must satisfy these thresholds
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — the downstream merge that consumes validated records
- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — stateless rule evaluation on the transport edge
- [Validating FEMA Shapefile Schemas Automatically](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/validating-fema-shapefile-schemas-automatically/) — format-specific pre-check for federal submissions

Up: [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/)
