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
    <text x="466" y="113" fill="var(--crimson, currentColor)">pass</text>
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
