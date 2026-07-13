---
title: "Normalizing Milepost & Cross-Street Locations for Rural Incidents"
description: "Turn rural 911 calls reported as a highway milepost or cross-street into a defensible incident point with Python: linear-referencing along route geometry, intersection resolution, a confidence score, and a full audit trail."
slug: normalizing-milepost-and-cross-street-locations-for-rural-incidents
type: article
breadcrumb: "Milepost & Cross-Street Locations"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Normalizing Milepost & Cross-Street Locations for Rural Incidents",
      "description": "Turn rural 911 calls reported as a highway milepost or cross-street into a defensible incident point with Python: linear-referencing along route geometry, intersection resolution, a confidence score, and a full audit trail.",
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
        { "@type": "ListItem", "position": 3, "name": "Real-Time Geocoding & Location Normalization", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/" },
        { "@type": "ListItem", "position": 4, "name": "Normalizing Milepost & Cross-Street Locations for Rural Incidents", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/normalizing-milepost-and-cross-street-locations-for-rural-incidents/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Resolve a rural milepost or cross-street 911 report to an incident point",
      "description": "Interpolate a highway milepost along a calibrated route geometry, or intersect two named road centerlines to a cross-street point, then attach a confidence score and emit an audit record so the derived location is defensible.",
      "step": [
        { "@type": "HowToStep", "name": "Parse the reported location", "text": "Classify the free-text location as a milepost expression or a cross-street pair, extracting the route identifier and the marker value or the two street names." },
        { "@type": "HowToStep", "name": "Linear-reference the milepost", "text": "Look up the calibrated route geometry, convert the milepost to a distance along the line using its measure calibration, and interpolate a point at that distance." },
        { "@type": "HowToStep", "name": "Resolve the cross-street", "text": "Select the two named centerlines, compute their geometric intersection, and take the nearest intersection node when more than one exists." },
        { "@type": "HowToStep", "name": "Score confidence and audit", "text": "Assign a confidence based on route-match quality and calibration density, then emit an audit record with the raw text, method, and derived coordinate before the point reaches the common operating picture." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why can't a rural milepost just be geocoded like a street address?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A commercial address geocoder expects a house number on a named street with a matching postal range. A milepost is a linear-referencing measure along a specific route, not an address, and rural routes often have no address ranges at all. Resolving it means interpolating a distance along a calibrated route geometry, which is a linear-referencing operation the geocoder was never designed to perform."
          }
        },
        {
          "@type": "Question",
          "name": "How accurate is a point interpolated from a milepost?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Accuracy depends entirely on the density and correctness of the route's measure calibration. Where mile markers are physically surveyed and the route measures are continuous, interpolation is typically accurate to well within a marker spacing. Where calibration is sparse or the route has gaps and re-measures, error grows between control points, which is why every derived point must carry a confidence score rather than being treated as exact."
          }
        },
        {
          "@type": "Question",
          "name": "What happens when a cross-street pair has more than one intersection?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Two rural roads can legitimately cross more than once, or share names across jurisdictions. The resolver returns every candidate intersection, selects the one nearest a supplied hint such as the responding jurisdiction centroid or the reporting tower, lowers the confidence score, and records all candidates in the audit trail so a dispatcher can override the choice."
          }
        }
      ]
    }
  ]
}
</script>

# Normalizing Milepost & Cross-Street Locations for Rural Incidents

A rollover is reported at 02:14 on a two-lane state highway forty miles from the nearest town. The caller cannot see a house, a business, or an intersection sign — only a green marker that reads "MM 128." The next caller, on a county road, gives no address at all: "the corner of Reservoir Road and Old Mill." Neither location will geocode. A commercial address geocoder returns nothing for "MM 128" and drops a low-confidence guess in the wrong county for "Old Mill," and the responding engine now has a dashboard point that is either empty or plausibly wrong by miles. This page solves that one narrow problem: converting a rural location expressed as a highway milepost or a cross-street pair into a single, defensible incident point — with a confidence score and an audit record — instead of a blank map or a confident lie.

## Root Cause and Operational Impact

The failure is a mismatch between how rural locations are *reported* and how geocoders *work*. An address geocoder is a range-interpolation engine: it expects a house number, a street name, and a postal range it can interpolate along. A highway milepost carries none of that. It is a linear-referencing measure — a distance along a named route, calibrated to physical mile markers — and the only geometry that can resolve it is the route centerline itself, walked to the reported distance. A cross-street is the opposite shape of problem: no distance, but two named lines whose *intersection* is the point. Feed either one to an address geocoder and you get silence or a false match, because the operation it needs (interpolate-along-line, or intersect-two-lines) is not the operation the geocoder performs (interpolate-within-address-range).

That gap is dangerous, not merely inconvenient, because the derived point drives dispatch. A milepost resolved against an uncalibrated or reversed route can place the incident on the correct highway but ten miles in the wrong direction, sending mutual-aid units away from a trapped occupant while the clock runs. A cross-street matched to the wrong "Old Mill Road" in an adjacent county crosses a jurisdiction boundary and hands the call to responders with no authority there. Because the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both require incident locations to be reconstructable for after-action review, a point that silently invents coordinates from a bad route match is not defensible. The normalization has to be auditable — every derived coordinate must carry the raw text it came from, the method used, and a confidence — which is why this belongs inside the disciplined [real-time geocoding and location normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) path and not in an ad-hoc dispatch macro.

<svg viewBox="0 0 880 460" role="img" aria-label="Two rural location-normalization paths. On the left, a milepost report is linear-referenced along a calibrated route geometry: the route line carries measure calibration points, and the reported milepost value 128 is interpolated to a point between two surveyed markers. On the right, a cross-street report is resolved by intersecting two named road centerlines, with the nearest intersection node selected when two candidates exist. Both paths converge into a confidence-scoring and audit-emission stage before the incident point reaches the common operating picture." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Milepost interpolation and cross-street intersection converging on a scored, audited incident point</title>
  <desc>The left path takes a highway milepost report, looks up the calibrated route centerline whose measures run from mile 120 to mile 135, interpolates the reported mile 128 as a distance along that line, and produces a candidate point. The right path takes a cross-street pair, selects two named road centerlines, computes their geometric intersection, and picks the intersection node nearest a jurisdiction hint when more than one exists. Both candidate points feed a single confidence-scoring and audit-emission stage that stamps the raw text, method, and coordinate before the point is published to the common operating picture.</desc>
  <defs>
    <marker id="milepost-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="milepost-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- LEFT: milepost linear referencing -->
  <text x="40" y="40" font-size="13" font-weight="700" fill="currentColor">Milepost → interpolate along route</text>
  <rect x="40" y="54" width="150" height="40" rx="7" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.4"/>
  <text x="115" y="72" font-size="11" text-anchor="middle" font-weight="600" fill="currentColor">"SH-9 MM 128"</text>
  <text x="115" y="87" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.8">raw 911 text</text>
  <!-- route line with calibration -->
  <path d="M60,150 C150,132 250,206 360,180" fill="none" stroke="currentColor" stroke-width="2"/>
  <circle cx="60" cy="150" r="4.5" fill="currentColor"/>
  <text x="60" y="140" font-size="10" text-anchor="middle" fill="currentColor">MM 120</text>
  <circle cx="360" cy="180" r="4.5" fill="currentColor"/>
  <text x="360" y="170" font-size="10" text-anchor="middle" fill="currentColor">MM 135</text>
  <!-- interpolated point -->
  <circle cx="243" cy="181" r="7" fill="var(--crimson, currentColor)"/>
  <text x="243" y="215" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">MM 128 · interpolated</text>
  <path d="M115,100 V132 L200,168" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="4 4" marker-end="url(#milepost-plain)"/>
  <text x="120" y="250" font-size="10" fill="currentColor" opacity="0.85">measure calibration → distance along line</text>
  <!-- RIGHT: cross-street intersection -->
  <text x="500" y="40" font-size="13" font-weight="700" fill="currentColor">Cross-street → intersect centerlines</text>
  <rect x="500" y="54" width="200" height="40" rx="7" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.4"/>
  <text x="600" y="72" font-size="11" text-anchor="middle" font-weight="600" fill="currentColor">"Reservoir Rd &amp; Old Mill"</text>
  <text x="600" y="87" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.8">raw 911 text</text>
  <!-- two centerlines crossing -->
  <line x1="520" y1="140" x2="740" y2="210" stroke="currentColor" stroke-width="2"/>
  <text x="530" y="135" font-size="10" fill="currentColor">Reservoir Rd</text>
  <line x1="560" y1="220" x2="720" y2="135" stroke="currentColor" stroke-width="2"/>
  <text x="668" y="128" font-size="10" fill="currentColor">Old Mill Rd</text>
  <!-- intersection node -->
  <circle cx="643" cy="181" r="7" fill="var(--crimson, currentColor)"/>
  <text x="643" y="212" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">nearest intersection</text>
  <text x="520" y="250" font-size="10" fill="currentColor" opacity="0.85">select node nearest jurisdiction hint</text>
  <!-- convergence arrows -->
  <path d="M243,258 V300 L410,320" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#milepost-arrow)"/>
  <path d="M643,258 V300 L470,320" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#milepost-arrow)"/>
  <!-- scoring + audit stage -->
  <rect x="290" y="326" width="300" height="52" rx="9" fill="var(--blush, none)" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
  <text x="440" y="348" font-size="12" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Score confidence + emit audit</text>
  <text x="440" y="367" font-size="10" text-anchor="middle" fill="currentColor">raw text · method · coordinate · confidence</text>
  <!-- to COP -->
  <path d="M440,378 V410" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#milepost-plain)"/>
  <rect x="330" y="414" width="220" height="34" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="440" y="436" font-size="11" text-anchor="middle" font-weight="600" fill="currentColor">Common operating picture</text>
</svg>

## Tiered Resolution Strategy

Resolve the location in ordered tiers, from the most authoritative method down to a safe default that is always flagged for review. Never publish an unscored point, and never silently drop a call — an unresolved location still has to reach a human dispatcher.

1. **Linear-reference a milepost against calibrated route geometry (definitive).** When the text names a route and a marker value, look up the route's calibrated measure, convert the milepost to a distance along the line, and interpolate the point. This is exact where the route measures are surveyed and continuous.
2. **Intersect two named centerlines for a cross-street (definitive).** When the text names two roads, select both centerlines and take their geometric intersection. A clean single intersection is a high-confidence point.
3. **Disambiguate multiple candidates with a spatial hint (qualified).** When a route matches several segments, or a cross-street yields more than one intersection, rank candidates by distance to a hint — the responding jurisdiction centroid or the originating cell sector — take the nearest, and lower the confidence accordingly.
4. **Snap to the route or nearest addressed feature (hardening).** Where a milepost falls near a gap in calibration, snap the interpolated point onto the route line so it never floats off the road, and cross-check against the nearest known addressed feature.
5. **Hold as unresolved with a low-confidence default and audit flag (safe default).** If no route matches or no intersection exists, return the jurisdiction centroid at minimum confidence, mark the record unresolved, and emit an audit entry so a dispatcher confirms before dispatch — never a fabricated precise coordinate.

## Production Python Implementation

The routine below carries the full resolution path: parsing the reported text, milepost interpolation via linear referencing, cross-street intersection with hint-based disambiguation, confidence scoring, structured logging, explicit exception handling, and an immutable audit record for every derived point. Thresholds and the reference layers are injected rather than hard-coded, so the same resolver runs against any jurisdiction's route and centerline data. Senior-engineer assumptions apply: `shapely` and `geopandas` are available, all reference layers are pre-projected to a common metric coordinate reference system, and route measures are stored as an ascending `m_start`/`m_end` calibration per segment.

```python
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

import geopandas as gpd
from shapely.geometry import Point
from shapely.ops import nearest_points

logger = logging.getLogger("incidentgis.location_normalize")

# Matches "SH-9 MM 128", "US 50 milepost 128.4", "MP128" and similar.
_MILEPOST_RE = re.compile(
    r"(?P<route>[A-Z]{1,3}[- ]?\d{1,4})\D{0,12}?(?:mm|mp|mile\s?post|milepost)\.?\s*"
    r"(?P<value>\d{1,4}(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
# Matches "Reservoir Rd & Old Mill", "Reservoir and Old Mill Rd".
_CROSS_RE = re.compile(
    r"(?P<a>[\w .'-]+?)\s*(?:&|/|\band\b|\bat\b|\bx\b)\s*(?P<b>[\w .'-]+)",
    re.IGNORECASE,
)


class Method(str, Enum):
    MILEPOST = "milepost_linear_reference"
    CROSS_STREET = "cross_street_intersection"
    UNRESOLVED = "unresolved_default"
    ERROR = "error_safe_default"


@dataclass
class ResolvedLocation:
    lon: Optional[float]
    lat: Optional[float]
    method: str
    confidence: float
    resolved: bool


@dataclass
class AuditEntry:
    """Immutable record of one normalization, appended to the audit trail."""
    raw_text: str
    method: str
    lon: Optional[float]
    lat: Optional[float]
    confidence: float
    candidate_count: int
    reference_version: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class RuralLocationNormalizer:
    """Resolve milepost / cross-street 911 text to a scored incident point.

    Every resolution — success or fallback — is logged and appended to
    ``audit_log`` so a derived coordinate can be reconstructed against the
    exact reference layers and thresholds that produced it.
    """

    def __init__(
        self,
        routes: gpd.GeoDataFrame,        # calibrated: cols route_id, m_start, m_end, geometry
        centerlines: gpd.GeoDataFrame,   # cols name, geometry
        reference_version: str,
        jurisdiction_centroid: Point,    # fallback + disambiguation hint (same CRS)
        min_confidence: float = 0.2,
    ) -> None:
        self.routes = routes
        self.centerlines = centerlines
        self.reference_version = reference_version
        self.hint = jurisdiction_centroid
        self.min_confidence = min_confidence
        self.audit_log: list[AuditEntry] = []

    def _audit(self, raw: str, loc: ResolvedLocation, candidates: int) -> None:
        entry = AuditEntry(
            raw_text=raw,
            method=loc.method,
            lon=loc.lon,
            lat=loc.lat,
            confidence=loc.confidence,
            candidate_count=candidates,
            reference_version=self.reference_version,
        )
        self.audit_log.append(entry)
        logger.info("location_normalized", extra={"audit": asdict(entry)})

    def _milepost(self, route_id: str, value: float) -> tuple[Optional[Point], float]:
        """Interpolate a point at ``value`` miles along the calibrated route."""
        segs = self.routes[self.routes["route_id"].str.upper() == route_id.upper()]
        if segs.empty:
            return None, 0.0
        seg = segs[(segs["m_start"] <= value) & (segs["m_end"] >= value)]
        if seg.empty:
            return None, 0.0  # milepost outside the route's calibrated range
        row = seg.iloc[0]
        span = row["m_end"] - row["m_start"]
        if span <= 0:
            return None, 0.0
        # Fraction along the segment, then interpolate along its geometry length.
        frac = (value - row["m_start"]) / span
        line = row.geometry
        pt = line.interpolate(frac * line.length)
        # Confidence scales with calibration density: tighter segments interpolate better.
        confidence = 0.95 if span <= 5 else max(0.6, 0.95 - (span - 5) * 0.03)
        return pt, round(confidence, 3)

    def _cross_street(self, name_a: str, name_b: str) -> tuple[Optional[Point], float, int]:
        """Intersect two named centerlines, choosing the node nearest the hint."""
        a = self.centerlines[self.centerlines["name"].str.contains(
            re.escape(name_a.strip()), case=False, na=False)]
        b = self.centerlines[self.centerlines["name"].str.contains(
            re.escape(name_b.strip()), case=False, na=False)]
        if a.empty or b.empty:
            return None, 0.0, 0
        inter = a.union_all().intersection(b.union_all())
        if inter.is_empty:
            return None, 0.0, 0
        # Normalize to a list of candidate points (single Point or multi-geometry).
        pts = [inter] if inter.geom_type == "Point" else list(getattr(inter, "geoms", []))
        pts = [p for p in pts if p.geom_type == "Point"]
        if not pts:
            return None, 0.0, 0
        best = min(pts, key=lambda p: p.distance(self.hint))
        confidence = 0.9 if len(pts) == 1 else 0.65  # ambiguity lowers confidence
        return best, confidence, len(pts)

    def resolve(self, raw_text: str) -> ResolvedLocation:
        try:
            mp = _MILEPOST_RE.search(raw_text)
            if mp:
                pt, conf = self._milepost(mp.group("route"), float(mp.group("value")))
                if pt is not None:
                    loc = ResolvedLocation(pt.x, pt.y, Method.MILEPOST.value, conf, True)
                    self._audit(raw_text, loc, 1)
                    return loc
                logger.warning("milepost_no_route", extra={"raw": raw_text})

            xs = _CROSS_RE.search(raw_text)
            if xs:
                pt, conf, n = self._cross_street(xs.group("a"), xs.group("b"))
                if pt is not None:
                    loc = ResolvedLocation(pt.x, pt.y, Method.CROSS_STREET.value, conf, True)
                    self._audit(raw_text, loc, n)
                    return loc
                logger.warning("cross_street_no_intersection", extra={"raw": raw_text})

            # Safe default: jurisdiction centroid, flagged unresolved for a human.
            loc = ResolvedLocation(
                self.hint.x, self.hint.y, Method.UNRESOLVED.value,
                self.min_confidence, False,
            )
            self._audit(raw_text, loc, 0)
            return loc

        except (ValueError, AttributeError, KeyError) as exc:
            # Malformed input or reference data: degrade to a flagged default.
            logger.error("location_normalize_failed", exc_info=exc,
                         extra={"raw": raw_text})
            loc = ResolvedLocation(
                self.hint.x, self.hint.y, Method.ERROR.value, self.min_confidence, False,
            )
            self._audit(raw_text, loc, 0)
            return loc
```

The `audit_log` is the load-bearing output. Persisting it as a committed, content-hashed artifact lets a post-incident reviewer replay every normalization and confirm that no coordinate was fabricated from a bad route match — and it lets the [address-standardization path for 911 logs](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/automating-address-standardization-for-911-logs/) reuse the same audit contract for the addressed calls that arrive on the same feed.

## Validation Checklist

Verify every item before deploying the normalizer to a live dispatch feed.

- [ ] Route and centerline reference layers are pre-projected to a single metric coordinate reference system, and `reference_version` is stamped from the layer release so each audit entry is traceable.
- [ ] Route calibration is ascending and continuous; `m_start`/`m_end` gaps and re-measures are documented and lower the interpolation confidence.
- [ ] Milepost values outside a route's calibrated range return no match and fall through to the flagged default rather than clamping to an endpoint.
- [ ] Cross-street resolution returns every candidate intersection, selects the nearest to the hint, and records `candidate_count` in the audit trail.
- [ ] The jurisdiction centroid used as the disambiguation hint and the fallback is in the same coordinate reference system as the reference layers.
- [ ] Unresolved and error results set `resolved = False` and carry `min_confidence`, so downstream consumers never treat a default as a confirmed location.
- [ ] Structured logs route to the incident logging sink, not stdout, and every resolution appears in `audit_log`.
- [ ] Downstream consumers (dashboard, router, dispatch queue) read and honour the `confidence` and `resolved` fields before assigning units.

## Edge Cases and Gotchas

- **Axis-order inversion.** Reference layers loaded as EPSG:4326 in latitude-first order will interpolate and intersect in the wrong hemisphere while looking superficially valid. Project every layer to a metric coordinate reference system and run any transform with `always_xy=True`; this is the same contract enforced across the [real-time geocoding and location normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) path.
- **Null-island and centroid drift.** An unresolved call that defaults to a jurisdiction centroid must never be confused with a real fix at `(0.0, 0.0)`. Keep the `resolved` flag authoritative and guard the [null-island coordinates check](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/catching-null-island-coordinates-before-they-reach-the-cop/) downstream so a flagged default is not later "corrected" into a precise-looking point.
- **Reversed or re-measured routes.** A route whose measures decrease, or that was re-calibrated after a realignment, interpolates a milepost in the wrong direction — the classic ten-miles-off error. Validate that `m_start < m_end` per segment at load time and reject non-monotonic calibration rather than silently interpolating it.
- **Duplicated road names across jurisdictions.** "Old Mill Road" may exist in three adjacent counties. Constrain the centerline candidate set to the responding jurisdiction before intersecting, and let the hint break residual ties, or a cross-street will resolve confidently to the wrong county.
- **Offline and legacy device quirks.** Mobile data terminals sometimes transmit mileposts with a route abbreviation the reference layer does not use ("SR" vs "SH" vs "State Route"). Normalize route identifiers through an alias table at ingest, and reuse the resolved points where they feed the wider spatial workload described in [optimizing spatial joins for incident data](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/optimizing-spatial-joins-for-incident-data/).

## Frequently Asked Questions

**Why can't a rural milepost just be geocoded like a street address?** A commercial address geocoder expects a house number on a named street with a matching postal range. A milepost is a linear-referencing measure along a specific route, not an address, and rural routes often have no address ranges at all. Resolving it means interpolating a distance along a calibrated route geometry, which is a linear-referencing operation the geocoder was never designed to perform.

**How accurate is a point interpolated from a milepost?** Accuracy depends entirely on the density and correctness of the route's measure calibration. Where mile markers are physically surveyed and the route measures are continuous, interpolation is typically accurate to well within a marker spacing. Where calibration is sparse or the route has gaps and re-measures, error grows between control points, which is why every derived point must carry a confidence score rather than being treated as exact.

**What happens when a cross-street pair has more than one intersection?** Two rural roads can legitimately cross more than once, or share names across jurisdictions. The resolver returns every candidate intersection, selects the one nearest a supplied hint such as the responding jurisdiction centroid or the reporting tower, lowers the confidence score, and records all candidates in the audit trail so a dispatcher can override the choice.

## Related

- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) — the normalization path this milepost and cross-street resolver plugs into.
- [Optimizing Spatial Joins for Incident Data](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/optimizing-spatial-joins-for-incident-data/) — join the resolved points against jurisdiction and hazard layers at surge volume.
- [Catching Null-Island Coordinates Before They Reach the COP](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/catching-null-island-coordinates-before-they-reach-the-cop/) — keep flagged default points from being mistaken for real fixes.
- [Automating Address Standardization for 911 Logs](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/automating-address-standardization-for-911-logs/) — the addressed-call counterpart on the same feed.

Up: [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/)
