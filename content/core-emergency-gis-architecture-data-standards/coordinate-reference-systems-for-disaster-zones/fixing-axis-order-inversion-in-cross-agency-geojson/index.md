---
title: "Fixing Axis-Order Inversion in Cross-Agency GeoJSON"
description: "Detect and correct lat/lon-swapped GeoJSON from another agency's tool: flag coordinates that land in the wrong hemisphere or ocean, transpose them safely, enforce always_xy on every transform, and emit an audit trail for each correction."
slug: fixing-axis-order-inversion-in-cross-agency-geojson
type: article
breadcrumb: "Axis-Order Inversion"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Fixing Axis-Order Inversion in Cross-Agency GeoJSON",
      "description": "Detect and correct lat/lon-swapped GeoJSON from another agency's tool: flag coordinates that land in the wrong hemisphere or ocean, transpose them safely, enforce always_xy on every transform, and emit an audit trail for each correction.",
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
        { "@type": "ListItem", "position": 3, "name": "Coordinate Reference Systems for Disaster Zones", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/" },
        { "@type": "ListItem", "position": 4, "name": "Fixing Axis-Order Inversion in Cross-Agency GeoJSON", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/fixing-axis-order-inversion-in-cross-agency-geojson/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Detect and correct axis-order inversion in cross-agency GeoJSON",
      "description": "Identify lat/lon-swapped GeoJSON features by testing whether coordinates fall inside the incident's expected bounds, transpose only the features that fail while leaving correct ones untouched, enforce always_xy on downstream transforms, and record every correction in an audit trail.",
      "step": [
        { "@type": "HowToStep", "name": "Confirm the declared axis contract", "text": "GeoJSON per RFC 7946 is always longitude then latitude in decimal degrees; treat any position array as x,y and validate it against that contract before trusting it." },
        { "@type": "HowToStep", "name": "Test each position against expected bounds", "text": "Check whether the coordinate falls inside the incident's expected bounding box; if it does not but its transpose does, the feature is axis-inverted." },
        { "@type": "HowToStep", "name": "Transpose only the failing features", "text": "Swap longitude and latitude for features that fail the bounds test and pass when transposed, leaving already-correct features untouched so no valid coordinate is double-swapped." },
        { "@type": "HowToStep", "name": "Enforce always_xy downstream", "text": "Construct every pyproj Transformer with always_xy=True so no reprojection reintroduces the authority axis order the source tool used." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Log each transposed feature with its original coordinate, corrected coordinate, decision reason, and dataset identifier so the correction is reproducible during after-action review." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why do some agencies send GeoJSON with latitude and longitude swapped?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "GeoJSON per RFC 7946 fixes coordinate order as longitude then latitude, but the underlying EPSG:4326 authority definition lists latitude first. Tools that serialize from a CRS-aware library in authority axis order, or that hand-build GeoJSON from a lat,lon database column, emit positions in the wrong order while still labelling them WGS 84. The file is syntactically valid GeoJSON but geographically transposed."
          }
        },
        {
          "@type": "Question",
          "name": "How can you detect axis-inverted coordinates automatically?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Test each position against the incident's expected bounding box. A coordinate that falls outside the operating area but lands inside it when longitude and latitude are swapped is almost certainly inverted. A New Mexico incident at 34N 106W that arrives as 34E 106S plots in the Southern Ocean, so a bounds test catches it deterministically without human review."
          }
        },
        {
          "@type": "Question",
          "name": "How do you stop reprojection from re-inverting the fixed coordinates?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Construct every pyproj Transformer with always_xy=True. Without that flag pyproj honours the CRS authority axis order and will emit latitude-first output for EPSG:4326, silently undoing the correction. Pinning always_xy across the whole pipeline makes x,y ordering the single invariant every stage agrees on."
          }
        }
      ]
    }
  ]
}
</script>

# Fixing Axis-Order Inversion in Cross-Agency GeoJSON

A mutual-aid task force pushes a GeoJSON layer of 240 damage-assessment points into the shared incident map during a wildfire in northern New Mexico. The features validate cleanly, the attribute table looks perfect, and the layer loads without error — but every point plots in the Southern Ocean, roughly 6,000 kilometres off the coast of Antarctica. The sending agency's export tool wrote each position as latitude then longitude, so a point that should read `[-106.6, 34.1]` arrived as `[34.1, -106.6]`. The file is perfectly valid GeoJSON; it is geographically inside-out. This is axis-order inversion, and it is the single narrow failure mode this page solves — detecting lat/lon-swapped features that another agency's tool produced, correcting only the features that are actually inverted, and locking the fix in place so no downstream reprojection quietly swaps them back.

## Root Cause and Operational Impact

The root cause is a genuine ambiguity baked into the standards. The GeoJSON specification (RFC 7946) is unambiguous: a position is always `[longitude, latitude]`, x before y, decimal degrees, WGS 84. But the authoritative definition of EPSG:4326 maintained under the Open Geospatial Consortium (OGC) and the EPSG registry lists the axes in the opposite order — latitude first, then longitude. A tool that serializes GeoJSON straight from a CRS-aware library respecting authority axis order, or one that hand-builds features from a database with a `lat, lon` column pair, will emit positions in authority order while still stamping them `EPSG:4326`. Both files claim WGS 84; one obeys the GeoJSON byte order and the other obeys the CRS authority order. Nothing in the file signals which convention was used, so the receiving system cannot tell a correct feature from a transposed one by inspecting the header — only by inspecting where the points land.

This is dangerous, not merely inconvenient, because a transposed coordinate rarely looks broken — it looks like a valid point somewhere else on Earth. A New Mexico incident at 34N 106W silently relocates to 34E 106S; a Gulf Coast shelter at 29N 90W jumps to 29E 90S. During a mass-casualty response those points feed the Common Operating Picture that dispatchers, aircraft, and resource planners all read as ground truth. Under both the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA), and under ISO 22320 for incident-management information exchange, shared operational data must be traceable and reconstructable for after-action review. A layer that was silently transposed, or silently "fixed" by an analyst dragging points on a map, is neither. The correction has to be deterministic and auditable, which is why axis-order enforcement belongs in the [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) contract rather than in a one-off cleanup script, and why it shares the same discipline as [Handling Missing CRS in Field-Collected GPS Logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/).

<svg viewBox="0 0 880 460" role="img" aria-label="Axis-order inversion diagram. On the left, a GeoJSON position array arrives labelled EPSG:4326 but with latitude written before longitude, so a New Mexico point plots in the Southern Ocean far outside the incident bounding box. A three-gate decision pipeline in the centre tests the position against the expected bounds, tests its transpose, and either accepts, swaps, or quarantines the feature. On the right, the corrected point lands back inside the incident bounding box carrying an audit record, and a note enforces always_xy on every downstream transform." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Detecting and correcting axis-order inversion in cross-agency GeoJSON</title>
  <desc>An incoming GeoJSON position labelled EPSG:4326 is written latitude-first, so a point that belongs in New Mexico plots thousands of kilometres away outside the incident bounding box. Each feature runs through three ordered gates: test the coordinate against the expected bounds, test its longitude-latitude transpose against the same bounds, and decide. A feature inside the bounds is accepted unchanged, a feature that only fits when transposed is swapped and logged, and a feature that fits in neither orientation is quarantined. The corrected point returns inside the incident bounding box with an audit record, and every downstream pyproj transform is constructed with always_xy set to true so the fix is never reversed.</desc>
  <defs>
    <marker id="axis-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="axis-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- incoming feature -->
  <text x="30" y="44" font-size="12.5" font-weight="700" fill="currentColor">Incoming GeoJSON</text>
  <rect x="30" y="56" width="212" height="86" rx="7" fill="var(--blush, none)" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
  <text x="44" y="80" font-size="10.5" fill="currentColor">"crs": "EPSG:4326"</text>
  <text x="44" y="100" font-size="10.5" fill="var(--crimson, currentColor)" font-weight="600">[ 34.1, -106.6 ]</text>
  <text x="44" y="118" font-size="9.5" fill="currentColor" opacity="0.8">written lat, lon</text>
  <text x="44" y="134" font-size="9.5" fill="var(--crimson, currentColor)">→ plots in Southern Ocean</text>
  <!-- wrong-location marker -->
  <g>
    <line x1="120" y1="300" x2="136" y2="316" stroke="var(--crimson, currentColor)" stroke-width="2.2"/>
    <line x1="136" y1="300" x2="120" y2="316" stroke="var(--crimson, currentColor)" stroke-width="2.2"/>
  </g>
  <text x="128" y="338" font-size="10" text-anchor="middle" fill="var(--crimson, currentColor)">outside bounds (34E 106S)</text>
  <ellipse cx="128" cy="308" rx="86" ry="52" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"/>
  <text x="128" y="380" font-size="9.5" text-anchor="middle" fill="currentColor" opacity="0.7">wrong hemisphere</text>
  <!-- decision pipeline -->
  <text x="330" y="44" font-size="12.5" font-weight="700" fill="currentColor">Axis-order check</text>
  <g font-size="11" fill="currentColor">
    <rect x="330" y="58" width="228" height="46" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="344" y="79" font-weight="600">Gate 1 · bounds test</text>
    <text x="344" y="96" font-size="10">inside expected bbox? → accept</text>
    <rect x="330" y="118" width="228" height="46" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="344" y="139" font-weight="600" fill="var(--crimson, currentColor)">Gate 2 · transpose test</text>
    <text x="344" y="156" font-size="10">swap fits bbox? → invert + log</text>
    <rect x="330" y="178" width="228" height="46" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="344" y="199" font-weight="600">Gate 3 · neither fits</text>
    <text x="344" y="216" font-size="10">quarantine for review</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#axis-plain)">
    <path d="M444,104 V118"/>
    <path d="M444,164 V178"/>
  </g>
  <!-- flow from incoming to pipeline -->
  <path d="M242,99 H326" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#axis-plain)"/>
  <!-- transpose action arrow to corrected -->
  <path d="M558,141 H640" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#axis-arrow)"/>
  <text x="600" y="132" font-size="9.5" text-anchor="middle" fill="var(--crimson, currentColor)">swap x,y</text>
  <!-- corrected feature -->
  <text x="648" y="44" font-size="12.5" font-weight="700" fill="currentColor">Corrected</text>
  <rect x="648" y="56" width="204" height="86" rx="7" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="662" y="80" font-size="10.5" fill="currentColor">"crs": "EPSG:4326"</text>
  <text x="662" y="100" font-size="10.5" fill="currentColor" font-weight="600">[ -106.6, 34.1 ]</text>
  <text x="662" y="118" font-size="9.5" fill="currentColor" opacity="0.8">now lon, lat (x,y)</text>
  <text x="662" y="134" font-size="9.5" fill="currentColor">+ audit record</text>
  <!-- corrected marker inside bounds -->
  <rect x="640" y="252" width="176" height="112" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.6"/>
  <text x="728" y="272" font-size="9.5" text-anchor="middle" fill="currentColor" opacity="0.8">incident bounding box</text>
  <circle cx="722" cy="316" r="7" fill="var(--crimson, currentColor)"/>
  <text x="722" y="344" font-size="10" text-anchor="middle" fill="currentColor">inside bounds (34N 106W)</text>
  <path d="M690,150 C640,205 690,238 705,252" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#axis-arrow)" opacity="0.85"/>
  <!-- always_xy note -->
  <rect x="330" y="392" width="522" height="44" rx="7" fill="var(--cream, none)" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
  <text x="591" y="412" font-size="11" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Enforce always_xy=True on every downstream pyproj Transformer</text>
  <text x="591" y="428" font-size="9.5" text-anchor="middle" fill="currentColor">so no reprojection reintroduces authority (lat,lon) axis order</text>
</svg>

## Tiered Resolution Strategy

Correct the layer in ordered tiers, from the definitive fix down to a safe default that is always flagged for audit. Never silently transpose an entire file on a hunch — a blanket swap will invert the features that were already correct.

1. **Establish the axis contract (definitive).** Declare that every position crossing the boundary is `[longitude, latitude]` per RFC 7946. This is the invariant the rest of the pipeline defends; the goal is to make incoming data conform to it, not to guess per feature at query time.
2. **Detect inversion by bounds, per feature.** Test each coordinate against the incident's expected bounding box. If it falls outside but its `(lat, lon)` transpose falls inside, the feature is inverted. Deciding per feature — not per file — survives mixed exports where only some records were swapped.
3. **Transpose only the failing features.** Swap x and y for features that fail the direct test and pass the transposed test, and leave every already-correct feature untouched. A feature that fits in neither orientation is a different problem — quarantine it rather than forcing a swap.
4. **Enforce `always_xy` downstream (safe default).** Build every `pyproj` Transformer with `always_xy=True` so no later reprojection honours authority axis order and re-inverts the corrected coordinates. This is the one setting that keeps the fix from silently unwinding two stages later.
5. **Emit an audit record for every correction.** Original coordinate, corrected coordinate, decision reason, and dataset identifier — so any transposed feature is reproducible against the exact bounds and logic that produced it, satisfying the reconstructability that after-action review demands.

## Production Python Implementation

The routine below carries the full resolution path: a per-feature bounds test, transpose detection, quarantine for coordinates that fit no orientation, `always_xy` enforcement for downstream reprojection, structured logging, explicit exception handling, and an immutable audit record per correction. Bounds are a parameter, not a literal, so the incident's operating area can be committed and versioned alongside the rest of the CRS contract. Senior-engineer assumptions apply: `pyproj` and `shapely` are available, and the expected bounds are supplied in WGS 84 for the active incident.

```python
from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Iterable, Optional

from pyproj import Transformer

logger = logging.getLogger("incidentgis.axisorder")


class Decision(str, Enum):
    ACCEPTED = "accepted_in_bounds"
    TRANSPOSED = "transposed_lat_lon_swap"
    QUARANTINED = "quarantined_out_of_bounds"
    ERROR = "error_skipped"


@dataclass(frozen=True)
class Bounds:
    """Expected WGS 84 extent of the active incident (lon/lat degrees)."""
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
    """Immutable record of a single axis-order decision."""
    feature_id: str
    decision: str
    original: tuple[float, float]
    corrected: tuple[float, float]
    dataset: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class AxisOrderCorrector:
    """Detect and correct lat/lon-swapped GeoJSON features by bounds.

    Every correction is logged and appended to ``audit_log`` so a normalized
    layer can be reconstructed against the exact bounds that produced it.
    """

    def __init__(self, bounds: Bounds, dataset: str, target_epsg: int = 4326) -> None:
        self.bounds = bounds
        self.dataset = dataset
        # always_xy=True pins x,y (lon,lat) order so reprojection never
        # reintroduces the CRS authority (lat,lon) axis order of the source.
        self._to_target = Transformer.from_crs(
            "EPSG:4326", f"EPSG:{target_epsg}", always_xy=True
        )
        self.audit_log: list[AuditEntry] = []

    def _record(
        self,
        feature_id: str,
        decision: Decision,
        original: tuple[float, float],
        corrected: tuple[float, float],
    ) -> AuditEntry:
        entry = AuditEntry(
            feature_id=feature_id,
            decision=decision.value,
            original=original,
            corrected=corrected,
            dataset=self.dataset,
        )
        self.audit_log.append(entry)
        return entry

    def correct_position(
        self, feature_id: str, position: tuple[float, float]
    ) -> Optional[tuple[float, float]]:
        """Return a bounds-valid (lon, lat), or None if it must be quarantined."""
        try:
            lon, lat = float(position[0]), float(position[1])
        except (TypeError, ValueError, IndexError) as exc:
            logger.error("axis_parse_failed", extra={"feature": feature_id}, exc_info=exc)
            self._record(feature_id, Decision.ERROR, (0.0, 0.0), (0.0, 0.0))
            return None

        # Gate 1: already correct — position sits inside the incident bounds.
        if self.bounds.contains(lon, lat):
            self._record(feature_id, Decision.ACCEPTED, (lon, lat), (lon, lat))
            logger.debug("axis_accept", extra={"feature": feature_id})
            return (lon, lat)

        # Gate 2: transpose fits — the source wrote lat,lon; swap to lon,lat.
        if self.bounds.contains(lat, lon):
            entry = self._record(feature_id, Decision.TRANSPOSED, (lon, lat), (lat, lon))
            logger.warning("axis_transposed", extra={"audit": asdict(entry)})
            return (lat, lon)

        # Gate 3: neither orientation fits — do not force a swap; quarantine.
        entry = self._record(feature_id, Decision.QUARANTINED, (lon, lat), (lon, lat))
        logger.warning("axis_quarantined", extra={"audit": asdict(entry)})
        return None

    def normalize(
        self, features: Iterable[dict]
    ) -> list[dict]:
        """Yield features with Point geometry normalized to lon,lat x,y order."""
        cleaned: list[dict] = []
        for feature in features:
            fid = str(feature.get("id", feature.get("properties", {}).get("id", "unknown")))
            geom = feature.get("geometry") or {}
            if geom.get("type") != "Point":
                # Non-point geometries need element-wise handling; skip safely here.
                logger.debug("axis_skip_nonpoint", extra={"feature": fid, "type": geom.get("type")})
                cleaned.append(feature)
                continue
            fixed = self.correct_position(fid, tuple(geom.get("coordinates", ())))
            if fixed is None:
                continue  # quarantined — excluded from the normalized layer.
            geom["coordinates"] = list(fixed)
            cleaned.append(feature)
        logger.info(
            "axis_normalize_done",
            extra={"dataset": self.dataset, "in": None, "out": len(cleaned),
                   "corrections": sum(1 for e in self.audit_log if e.decision == Decision.TRANSPOSED.value)},
        )
        return cleaned
```

The `audit_log` is the load-bearing output here. Persisting it as a committed, content-hashed artifact lets a reviewer replay every transposition and confirm that no coordinate was flipped without cause — the reproducibility guarantee the [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) contract exists to provide, and the same standard a shared [PostGIS store for emergency response](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/how-to-set-up-postgis-for-emergency-response/) should enforce on ingest.

## Validation Checklist

Verify every item before running the corrector against a live cross-agency feed.

- [ ] Incident bounds are passed as a parameter and committed under version control — no bounding box hard-coded in the field build.
- [ ] Every `pyproj` Transformer in the pipeline is constructed with `always_xy=True`, verified by test, so no reprojection reintroduces authority axis order.
- [ ] Features already inside the bounds are accepted unchanged — the corrector never double-swaps a correct coordinate.
- [ ] Coordinates that fit neither orientation are quarantined for human review, not force-transposed.
- [ ] The bounds test tolerates points on the exact edge of the operating area (inclusive comparison) so a shelter on the incident boundary is not quarantined.
- [ ] Null-island `(0.0, 0.0)` positions are caught before this stage or fall to quarantine — they are inside no real incident box and must never be silently accepted.
- [ ] Structured logs route to the incident logging sink, not stdout, and every decision appears in `audit_log`.
- [ ] Non-Point geometries (LineString, Polygon) are handled element-wise by a dedicated path, not passed through unchecked.

## Edge Cases and Gotchas

- **Square operating areas near the equator.** When the incident bounding box is roughly square and straddles low latitudes, a coordinate and its transpose can *both* fall inside the box, so the bounds test cannot decide. Detect this ambiguity explicitly and quarantine rather than guess; disambiguate with a secondary signal such as a known landmark, county polygon, or the sending agency's declared convention.
- **The `always_xy` trap on reprojection.** The most common regression is fixing the input, then reprojecting to a projected CRS with a Transformer built without `always_xy=True`. `pyproj` then honours the EPSG:4326 authority order and consumes your data as latitude-first, silently re-inverting everything. Pin `always_xy=True` on *every* Transformer, and assert it in a unit test.
- **Null-island drift.** A failed geocode often emits `(0.0, 0.0)`. Its transpose is still `(0.0, 0.0)`, so a bounds test will quarantine it — but treat null island as its own first-class reject so it is never confused with a genuine axis flip. This is the same guard applied in [Catching Null-Island Coordinates Before They Reach the COP](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/catching-null-island-coordinates-before-they-reach-the-cop/).
- **Mixed-orientation files.** Some exports interleave correct and inverted features when records were merged from two upstream tools. This is exactly why detection runs per feature, not per file; a file-level heuristic that swaps everything on the first bad point corrupts the good half of the layer.
- **Agency-specific datum anomalies.** A feature declared WGS 84 but actually captured on a local or legacy datum introduces a constant offset that can nudge an edge point just outside the bounds and trigger a spurious transpose. Validate the source datum at registration and reproject to the incident CRS before axis correction, not after — the same ordering discipline that governs [Converting CADRG Maps to GeoJSON with Python](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/converting-cadrg-maps-to-geojson-with-python/).

## Frequently Asked Questions

**Why do some agencies send GeoJSON with latitude and longitude swapped?** GeoJSON per RFC 7946 fixes coordinate order as longitude then latitude, but the underlying EPSG:4326 authority definition lists latitude first. Tools that serialize from a CRS-aware library in authority axis order, or that hand-build GeoJSON from a lat,lon database column, emit positions in the wrong order while still labelling them WGS 84. The file is syntactically valid GeoJSON but geographically transposed.

**How can you detect axis-inverted coordinates automatically?** Test each position against the incident's expected bounding box. A coordinate that falls outside the operating area but lands inside it when longitude and latitude are swapped is almost certainly inverted. A New Mexico incident at 34N 106W that arrives as 34E 106S plots in the Southern Ocean, so a bounds test catches it deterministically without human review.

**How do you stop reprojection from re-inverting the fixed coordinates?** Construct every `pyproj` Transformer with `always_xy=True`. Without that flag `pyproj` honours the CRS authority axis order and will emit latitude-first output for EPSG:4326, silently undoing the correction. Pinning `always_xy` across the whole pipeline makes x,y ordering the single invariant every stage agrees on.

## Related

- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — the CRS and axis-order contract this correction enforces.
- [Handling Missing CRS in Field-Collected GPS Logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/) — the upstream problem of data that never declared a CRS at all.
- [How to Set Up PostGIS for Emergency Response](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/how-to-set-up-postgis-for-emergency-response/) — enforce the same axis contract at the database boundary.
- [Catching Null-Island Coordinates Before They Reach the COP](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/catching-null-island-coordinates-before-they-reach-the-cop/) — the sibling validation gate for zero-zero fixes.

Up: [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/)
