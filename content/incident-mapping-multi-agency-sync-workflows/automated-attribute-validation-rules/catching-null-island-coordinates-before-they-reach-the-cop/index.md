---
title: "Catching Null-Island Coordinates Before They Reach the COP"
description: "Stop (0,0) null-island and near-zero coordinates from failed geocodes and no-fix devices contaminating the Common Operating Picture: a Python validation rule that detects, quarantines, safe-defaults, and audits every rejected incident feature."
slug: catching-null-island-coordinates-before-they-reach-the-cop
type: article
breadcrumb: "Null-Island Coordinates"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Catching Null-Island Coordinates Before They Reach the COP",
      "description": "Stop (0,0) null-island and near-zero coordinates from failed geocodes and no-fix devices contaminating the Common Operating Picture: a Python validation rule that detects, quarantines, safe-defaults, and audits every rejected incident feature.",
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
        { "@type": "ListItem", "position": 3, "name": "Automated Attribute Validation Rules", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/" },
        { "@type": "ListItem", "position": 4, "name": "Catching Null-Island Coordinates Before They Reach the COP", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/catching-null-island-coordinates-before-they-reach-the-cop/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Catch null-island coordinates before they enter the Common Operating Picture",
      "description": "Detect (0,0) and near-zero coordinates produced by failed geocodes and no-fix devices, quarantine the affected incident features, substitute a safe default that is visibly flagged rather than plotted at null island, and emit an audit record for every rejection so the operating picture stays trustworthy.",
      "step": [
        { "@type": "HowToStep", "name": "Detect exact and near-zero coordinates", "text": "Reject any feature whose longitude and latitude both fall within an epsilon band around zero, catching both exact (0,0) sentinels and the near-zero drift produced by a receiver reporting a partial or failed fix." },
        { "@type": "HowToStep", "name": "Confirm against the incident area of interest", "text": "Bound-check every remaining coordinate against the incident's declared area-of-interest bounding box so a valid-looking coordinate that lands in the wrong ocean is caught even when it is not near zero." },
        { "@type": "HowToStep", "name": "Quarantine rather than drop", "text": "Route failing features to a quarantine queue and substitute a safe, visibly flagged default so the feature is never silently plotted at null island and never silently discarded." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Write the original coordinate, the failure reason, the substituted state, and the ruleset version to an immutable audit trail so every rejection is reproducible during after-action review." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why do (0,0) coordinates keep appearing in incident feeds?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The point at longitude 0, latitude 0 — informally called null island — is the default a system emits when a coordinate is missing or invalid: a geocoder that failed to match an address, a GPS device with no satellite fix, or a database column that defaulted numeric zero instead of null. Because zero is a valid number, these sentinels pass naive not-null checks and flow straight into the feed, plotting incidents in the Gulf of Guinea instead of the incident area."
          }
        },
        {
          "@type": "Question",
          "name": "Should a null-island feature be dropped or kept with a flag?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Dropping it silently loses the incident report and hides the data-quality failure from after-action review, which is unacceptable when a 911 call may be behind the record. The defensible approach is to quarantine the feature, substitute a safe default that is visibly flagged rather than plotted at null island, and emit an audit record with the original coordinate and failure reason so the incident is triaged by a human and the correction remains reproducible."
          }
        },
        {
          "@type": "Question",
          "name": "How do I catch near-zero coordinates, not just exact (0,0)?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A partial fix or a truncated geocode can produce values like 0.0001 that are not exactly zero yet still fall in the ocean off West Africa. Test both longitude and latitude against an epsilon band around zero rather than for exact equality, and additionally bound-check every coordinate against the incident's declared area-of-interest bounding box so any point outside the operational region is caught regardless of how close to zero it is."
          }
        }
      ]
    }
  ]
}
</script>

# Catching Null-Island Coordinates Before They Reach the COP

At 02:14 during a county-wide flood response, a mutual-aid engine company submits a structure-fire report through a mobile app while parked in a low-signal river valley. The device has no satellite fix, so its location service returns longitude 0, latitude 0. The report syncs, the attribute validator confirms every required field is present and non-null — because zero is present and is not null — and thirty seconds later the Common Operating Picture (COP) shared across three agencies shows a new structure fire in the Gulf of Guinea, four thousand kilometres off the coast of West Africa. A battalion chief scanning the map sees the incident count tick up but no marker in the county, a dispatcher wonders whether a unit went off-map, and the real fire has no symbol at all. This is the null-island failure, and it is the single narrow problem this page solves: stopping (0,0) and near-zero coordinates — the residue of failed geocodes and no-fix devices — from ever reaching the operating picture, without silently deleting the incident behind them.

## Root Cause and Operational Impact

Null island is the point where the equator meets the prime meridian at exactly longitude 0, latitude 0. Almost nothing real ever occurs there, which is precisely why it is dangerous: it is the value software emits when a coordinate is *absent* but the schema still demands a number. A geocoder that fails to match an address returns 0,0 rather than raising. A GPS receiver with no lock reports 0,0 until it acquires satellites. A database column typed `NUMERIC NOT NULL` with a default of `0` fills 0,0 when the upstream writer forgot to set it. In every case the sentinel is a valid float, so a validation rule that only checks for presence or non-null passes it straight through. Near-zero variants are worse still — a receiver mid-acquisition or a truncated geocode string can yield `0.0001, -0.0002`, which fails an exact `== 0` test yet still lands in open ocean.

The impact compounds across a multi-agency feed. A single null-island feature drags automatic map extents: any dashboard that zooms-to-fit its features now spans from the incident county to the Atlantic, rendering the real operational area a pixel wide. Spatial joins against jurisdiction polygons silently misattribute the incident to no agency at all. Any density or clustering analytic is skewed by an outlier four thousand kilometres from every other point. And because the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both require that incident data be reconstructable for after-action review, a feed that either plotted the phantom or silently deleted it is not defensible — the report may have originated from a live 911 call, and losing it without a trace is a records failure, not just a map glitch. The fix belongs at ingest, as a committed rule inside [automated attribute validation](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/), because the same records typically arrive from [real-time geocoding and location normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) where the failed match originated.

<svg viewBox="0 0 880 470" role="img" aria-label="Null-island detection diagram. On the left, a longitude-latitude grid shows the equator and prime meridian crossing at the zero-zero point off West Africa, where a dense group of rejected incident markers pile up; a dashed epsilon band surrounds that intersection and a separate rectangle marks the incident area of interest far from it. On the right, a validation pipeline lists three ordered gates — exact and near-zero test, area-of-interest bounds check, and quarantine with safe default — feeding an audit trail badge." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Detecting null-island coordinates and routing them to quarantine with an audit trail</title>
  <desc>A geographic grid shows the equator and prime meridian intersecting at longitude zero, latitude zero off the coast of West Africa, where failed-fix and failed-geocode incident markers accumulate. A dashed epsilon band around that intersection catches exact and near-zero coordinates, while the incident's declared area-of-interest bounding box sits elsewhere on the grid. Coordinates run through three ordered validation gates — an exact and near-zero zero test, an area-of-interest bounds check, and a quarantine step that substitutes a visibly flagged safe default — and every rejection is written to an immutable audit trail.</desc>
  <defs>
    <marker id="nullisle-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="nullisle-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- LEFT: coordinate grid -->
  <rect x="40" y="40" width="470" height="392" rx="6" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.2" opacity="0.9"/>
  <!-- faint graticule -->
  <g stroke="currentColor" stroke-width="0.6" opacity="0.28">
    <line x1="120" y1="40" x2="120" y2="432"/><line x1="200" y1="40" x2="200" y2="432"/>
    <line x1="360" y1="40" x2="360" y2="432"/><line x1="440" y1="40" x2="440" y2="432"/>
    <line x1="40" y1="120" x2="510" y2="120"/><line x1="40" y1="316" x2="510" y2="316"/>
  </g>
  <!-- prime meridian + equator (bold) crossing at null island -->
  <line x1="280" y1="40" x2="280" y2="432" stroke="currentColor" stroke-width="1.5"/>
  <line x1="40" y1="218" x2="510" y2="218" stroke="currentColor" stroke-width="1.5"/>
  <text x="286" y="56" font-size="10.5" fill="currentColor" opacity="0.8">prime meridian (lon 0)</text>
  <text x="46" y="212" font-size="10.5" fill="currentColor" opacity="0.8">equator (lat 0)</text>
  <!-- epsilon band around (0,0) -->
  <rect x="252" y="190" width="56" height="56" rx="4" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" stroke-dasharray="5 4"/>
  <text x="280" y="182" font-size="10" text-anchor="middle" fill="var(--crimson, currentColor)">±epsilon band</text>
  <!-- pile of rejected markers at null island -->
  <g fill="var(--crimson, currentColor)">
    <circle cx="280" cy="218" r="5"/><circle cx="270" cy="228" r="4.5"/><circle cx="291" cy="227" r="4.5"/>
    <circle cx="276" cy="208" r="4"/><circle cx="287" cy="210" r="4"/>
  </g>
  <text x="280" y="266" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">null island (0, 0)</text>
  <text x="280" y="280" font-size="9.5" text-anchor="middle" fill="var(--crimson, currentColor)">failed geocodes · no-fix devices</text>
  <!-- incident area of interest, elsewhere -->
  <rect x="360" y="86" width="104" height="66" rx="5" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="398" cy="112" r="4" fill="currentColor"/><circle cx="420" cy="126" r="4" fill="currentColor"/><circle cx="436" cy="106" r="4" fill="currentColor"/>
  <text x="412" y="170" font-size="10.5" text-anchor="middle" font-weight="600" fill="currentColor">incident area of interest</text>
  <text x="412" y="184" font-size="9.5" text-anchor="middle" fill="currentColor" opacity="0.8">valid coordinates</text>
  <!-- divider -->
  <line x1="540" y1="40" x2="540" y2="432" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>
  <!-- RIGHT: validation pipeline -->
  <text x="566" y="58" font-size="12.5" font-weight="700" fill="currentColor">Validation pipeline</text>
  <g font-size="11" fill="currentColor">
    <rect x="566" y="72" width="272" height="46" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="580" y="92" font-weight="600" fill="var(--crimson, currentColor)">Gate 1 · zero test</text>
    <text x="580" y="108" font-size="10">reject |lon| &lt; eps and |lat| &lt; eps</text>
    <rect x="566" y="130" width="272" height="46" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="580" y="150" font-weight="600">Gate 2 · AOI bounds</text>
    <text x="580" y="166" font-size="10">reject point outside area-of-interest bbox</text>
    <rect x="566" y="188" width="272" height="46" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="580" y="208" font-weight="600">Gate 3 · quarantine</text>
    <text x="580" y="224" font-size="10">hold feature · substitute flagged default</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#nullisle-plain)">
    <path d="M702,118 V130"/>
    <path d="M702,176 V188"/>
  </g>
  <path d="M702,234 V256" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#nullisle-arrow)"/>
  <!-- safe default block -->
  <rect x="566" y="260" width="272" height="58" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="702" y="283" font-size="11.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Safe default, visibly flagged</text>
  <text x="702" y="300" font-size="10" text-anchor="middle" fill="currentColor">never plotted at null island,</text>
  <text x="702" y="313" font-size="10" text-anchor="middle" fill="currentColor">never silently dropped</text>
  <!-- audit trail badge -->
  <path d="M702,318 V340" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#nullisle-plain)"/>
  <rect x="606" y="344" width="192" height="34" rx="17" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="632" cy="361" r="6" fill="var(--crimson, currentColor)"/>
  <text x="648" y="365" font-size="10" text-anchor="start" fill="currentColor" font-weight="600">audit trail · original + reason</text>
  <text x="702" y="404" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">pass all gates → accept,</text>
  <text x="702" y="418" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">forward to the operating picture</text>
</svg>

## Tiered Resolution Strategy

Handle the stream in ordered tiers, from the definitive test down to a safe default that is always flagged and always audited. Never delete a failing feature silently — a missing incident is itself a loss of accountability, and the record may trace back to a live call.

1. **Reject exact and near-zero coordinates (definitive).** Test both longitude and latitude against an epsilon band around zero rather than for exact equality. This catches the exact `0,0` sentinel *and* the near-zero drift of a partial fix in one rule.
2. **Bound-check against the incident area of interest.** A coordinate can be non-zero and still wrong — swapped, mistyped, or geocoded to the wrong country. Reject any point outside the incident's declared area-of-interest bounding box so ocean and out-of-region hits are caught regardless of proximity to zero.
3. **Quarantine and substitute a safe default (safe default).** Route the failing feature to a quarantine queue and give it a state a symbolizer can render as "location unknown" — never a coordinate at null island, never a dropped record. A human triages the queue against the originating report.
4. **Emit an audit record for every rejection.** Original coordinate, failure reason, substituted state, feature identifier, and the ruleset version — so any rejection is reproducible against the exact rule that produced it during after-action review.

## Production Python Implementation

The validator below carries the full resolution path: exact and near-zero detection, area-of-interest bounds checking, quarantine with a safe default, structured logging, explicit exception handling, and an immutable audit record per rejection. Thresholds and the area-of-interest bounding box are parameters, not literals, so they are committed and versioned alongside the rest of the attribute ruleset. Senior-engineer assumptions apply: `shapely` and `pyproj` are available, coordinates are WGS 84 in longitude, latitude order, and the caller has already normalized axis order at ingest.

```python
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

logger = logging.getLogger("incidentgis.nullisland")


class Verdict(str, Enum):
    ACCEPTED = "accepted"
    NULL_ISLAND = "null_island_zero_coord"
    OUT_OF_AOI = "outside_area_of_interest"
    ERROR_QUARANTINE = "error_safe_quarantine"


@dataclass
class IncidentFeature:
    feature_id: str
    lon: float
    lat: float
    source: str                       # e.g. "mobile_app", "geocoder", "avl"
    location_valid: bool = True       # False once quarantined
    verdict: str = Verdict.ACCEPTED.value


@dataclass
class BoundingBox:
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def contains(self, lon: float, lat: float) -> bool:
        return (
            self.min_lon <= lon <= self.max_lon
            and self.min_lat <= lat <= self.max_lat
        )


@dataclass
class AuditEntry:
    """Immutable record of a single rejection, emitted to the audit trail."""
    feature_id: str
    verdict: str
    original: tuple[float, float]
    source: str
    ruleset_version: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class NullIslandValidator:
    """Reject null-island and out-of-region coordinates before the COP.

    Every rejection is logged and appended to ``audit_log`` so a quarantined
    feature can be reconstructed against the exact ruleset that flagged it.
    """

    def __init__(
        self,
        ruleset_version: str,
        aoi: BoundingBox,
        zero_epsilon_deg: float = 0.01,   # ~1.1 km at the equator
    ) -> None:
        self.ruleset_version = ruleset_version
        self.aoi = aoi
        self.zero_epsilon_deg = zero_epsilon_deg
        self.audit_log: list[AuditEntry] = []
        self.quarantine: list[IncidentFeature] = []

    def _is_near_null_island(self, lon: float, lat: float) -> bool:
        """True when both axes sit inside the epsilon band around zero.

        Catches exact (0, 0) and near-zero residue from partial fixes and
        truncated geocodes; a real coordinate on only one axis (e.g. lon 0
        in the UK) is preserved because BOTH must be near zero to fail.
        """
        return (
            abs(lon) < self.zero_epsilon_deg
            and abs(lat) < self.zero_epsilon_deg
        )

    def _quarantine(self, feat: IncidentFeature, verdict: Verdict) -> IncidentFeature:
        """Hold the feature, mark location invalid, and emit an audit entry."""
        original = (feat.lon, feat.lat)
        feat.location_valid = False        # symbolize as "location unknown"
        feat.verdict = verdict.value
        entry = AuditEntry(
            feature_id=feat.feature_id,
            verdict=verdict.value,
            original=original,
            source=feat.source,
            ruleset_version=self.ruleset_version,
        )
        self.audit_log.append(entry)
        self.quarantine.append(feat)
        logger.warning("null_island_reject", extra={"audit": asdict(entry)})
        return feat

    def validate(self, feat: IncidentFeature) -> IncidentFeature:
        try:
            # Guard against non-finite values before any comparison.
            if not (math.isfinite(feat.lon) and math.isfinite(feat.lat)):
                return self._quarantine(feat, Verdict.NULL_ISLAND)

            # Tier 1: exact and near-zero coordinates are the null-island signature.
            if self._is_near_null_island(feat.lon, feat.lat):
                return self._quarantine(feat, Verdict.NULL_ISLAND)

            # Tier 2: non-zero but outside the incident's operating region.
            if not self.aoi.contains(feat.lon, feat.lat):
                return self._quarantine(feat, Verdict.OUT_OF_AOI)

            # Accept: trusted coordinate, forward to the operating picture.
            feat.location_valid = True
            feat.verdict = Verdict.ACCEPTED.value
            logger.debug(
                "null_island_accept",
                extra={"feature_id": feat.feature_id, "lon": feat.lon, "lat": feat.lat},
            )
            return feat

        except (TypeError, ValueError) as exc:
            # Malformed record: quarantine rather than crash the ingest loop.
            logger.error(
                "null_island_validate_failed",
                exc_info=exc,
                extra={"feature_id": getattr(feat, "feature_id", "unknown")},
            )
            return self._quarantine(feat, Verdict.ERROR_QUARANTINE)
```

The `audit_log` and `quarantine` list are the load-bearing outputs. Persisting the audit trail as a committed, content-hashed artifact lets a reviewer replay every rejection and confirm that no incident was silently dropped and none was ever plotted at null island — the reproducibility guarantee the wider [automated attribute validation](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) ruleset is built to provide.

## Validation Checklist

Verify every item before deploying the validator to a live multi-agency feed.

- [ ] The zero epsilon and the area-of-interest bounding box are passed as parameters and committed under version control — no literals hard-coded in the ingest service.
- [ ] `ruleset_version` is set from the running release tag so each audit entry is traceable to a specific commit.
- [ ] The near-zero test requires BOTH longitude and latitude to be near zero, so a legitimate coordinate on the prime meridian or equator (with a real value on the other axis) is not falsely rejected.
- [ ] Non-finite values (`NaN`, `inf`) are quarantined, not compared — the finiteness guard runs before any threshold test.
- [ ] Quarantined features carry `location_valid = False` and a symbolizer renders them as "location unknown," never at coordinates `(0, 0)`.
- [ ] No failing feature is deleted; every rejection appears in both `quarantine` and `audit_log` for human triage against the originating report.
- [ ] Structured logs route to the incident logging sink, not stdout, and every rejection emits a `null_island_reject` audit record.
- [ ] The validator is unit-tested against a fixture containing exact `(0,0)`, near-zero `(0.0001, -0.0002)`, an out-of-region ocean point, a `NaN`, and a valid in-area coordinate, asserting the expected verdict for each.

## Edge Cases and Gotchas

- **Legitimate zero on one axis.** Real incidents do occur on the prime meridian (Greenwich, eastern England, western Africa) and on the equator. Testing longitude *or* latitude for zero would falsely reject them; the rule must require *both* axes to be near zero, which is what the `_is_near_null_island` guard enforces.
- **Axis-order inversion masquerading as null island.** A feed emitting `(lat, lon)` where the pipeline expects `(lon, lat)` can push a valid mid-latitude coordinate through the bounds check and out again, or produce a phantom near zero when one axis is genuinely small. Normalize axis order at ingest and run every `pyproj` transform with `always_xy=True`, the same contract enforced in the [coordinate reference systems for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) standard, before this validator ever runs.
- **Epsilon too wide near a coastal incident.** A one-kilometre epsilon is safe off West Africa but could clip a genuine incident in the Gulf of Guinea littoral or on an equatorial island. Tie the epsilon to the incident's distance from `(0,0)` — with any real operating area, the area-of-interest bounds check in Tier 2 is the stronger guarantee and the epsilon only needs to catch the obvious sentinel.
- **Failed-geocode strings that parse to zero.** A geocoder returning an empty match sometimes serializes as the string `"0"` or `"0.0"` rather than a number. Coerce and validate types at the schema boundary so `"0"` is caught by the same rule; a sibling pattern for schema-level type contracts appears in [validating FEMA shapefile schemas automatically](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/validating-fema-shapefile-schemas-automatically/).
- **Datum offset hiding a near-zero point.** A device configured for a local or legacy datum introduces a constant offset that can nudge a true near-zero coordinate just outside the epsilon band, letting a genuine no-fix sentinel slip through. Validate the device datum at registration and reproject to the incident CRS before validation, not after.

## Frequently Asked Questions

**Why do (0,0) coordinates keep appearing in incident feeds?** The point at longitude 0, latitude 0 — informally called null island — is the default a system emits when a coordinate is missing or invalid: a geocoder that failed to match an address, a GPS device with no satellite fix, or a database column that defaulted numeric zero instead of null. Because zero is a valid number, these sentinels pass naive not-null checks and flow straight into the feed, plotting incidents in the Gulf of Guinea instead of the incident area.

**Should a null-island feature be dropped or kept with a flag?** Dropping it silently loses the incident report and hides the data-quality failure from after-action review, which is unacceptable when a 911 call may be behind the record. The defensible approach is to quarantine the feature, substitute a safe default that is visibly flagged rather than plotted at null island, and emit an audit record with the original coordinate and failure reason so the incident is triaged by a human and the correction remains reproducible.

**How do I catch near-zero coordinates, not just exact (0,0)?** A partial fix or a truncated geocode can produce values like 0.0001 that are not exactly zero yet still fall in the ocean off West Africa. Test both longitude and latitude against an epsilon band around zero rather than for exact equality, and additionally bound-check every coordinate against the incident's declared area-of-interest bounding box so any point outside the operational region is caught regardless of how close to zero it is.

## Related

- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — the ruleset this null-island check is committed into and versioned with.
- [Validating FEMA Shapefile Schemas Automatically](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/validating-fema-shapefile-schemas-automatically/) — enforce the type and schema contract that keeps a geocoded "0" string from slipping past as a number.
- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) — where failed matches originate, and where a normalized coordinate should be resolved before it reaches this gate.

Up: [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/)
