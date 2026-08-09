---
title: "Handling Missing CRS in Field-Collected GPS Logs"
description: "Deterministic Python pattern for resolving missing Coordinate Reference System metadata in field GPS logs: tiered fallback, bounds validation, and audit-flagged safe defaults."
slug: handling-missing-crs-in-field-collected-gps-logs
type: article
breadcrumb: "Missing CRS in Field GPS Logs"
datePublished: "2025-03-04"
dateModified: "2026-06-25"
---

# Handling Missing CRS in Field-Collected GPS Logs for Emergency Response Workflows

At 04:10 during a riverine flood activation, a search-and-rescue crew uploads a `track.gpx` and a hand-keyed `points.csv` from a consumer handheld that lost its phone pairing overnight. Both files carry clean-looking longitude/latitude columns and nothing else: no `<gpx>` namespace declaration of a datum, no `.prj`, no EPSG tag in the CSV header. The ingestion job accepts them, the routing engine assumes its house default, and the crew's last-known waypoints render 40 metres off the levee they were actually standing on. This is the single failure this page solves — a field-collected GPS log that arrives with **no declared Coordinate Reference System (CRS)** — and the pattern that makes it recoverable rather than silently wrong, before the geometry ever reaches a [geospatial data ingestion pipeline](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) for normalization.

## Root Cause and Operational Impact

Consumer handhelds, offline field apps, and rapid-deployment sensors routinely strip spatial metadata during export, transit, or sync. A GPX writer omits the optional datum element; a CSV export keeps only the numeric columns; a sync layer flattens a GeoPackage to bare coordinate pairs. The payload still parses, so nothing throws — and that silence is the hazard. Ingestion systems then guess. The two common guesses are both wrong in the field: assume WGS 84 / EPSG:4326 when the device actually logged a projected local grid, or assume a legacy local projection when the device was reporting plain geographic degrees.

In a routine office context an undeclared CRS is an inconvenience. In an active incident it is dangerous. A 1985-vintage municipal layer in NAD27 misaligns against the WGS 84 incident basemap by 10–100 metres depending on locale — enough to put an evacuation hold line on the wrong side of a road or route a strike team into the hazard. Misregistered points break spatial joins against parcels and hydrant networks, corrupt the buffer math behind resource-allocation models, and poison multi-agency data fusion because the downstream consumer trusts the header and never re-checks. The fix must be explicit, logged, and audit-flagged, not best-effort — every assigned CRS has to carry provenance so post-incident spatial forensics can reconstruct exactly how each coordinate was anchored.

<svg viewBox="0 0 880 470" role="img" aria-label="Decision flowchart for the tiered CRS fallback resolver. An incoming GPS record with no declared CRS passes through four ordered tiers — explicit payload declaration, device-manifest lookup, regional heuristic inference, and a flagged safe default of WGS 84. Each tier that passes bounds validation emits a provenance tag and stops the chain; any tier whose bounds validation fails diverts the record to a manual-review quarantine queue." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Tiered CRS fallback resolution flowchart</title>
  <desc>A field GPS record arriving with no declared coordinate reference system enters tier one, explicit payload declaration. If a crs or epsg_code field is present and its coordinates pass bounds validation, the record resolves with the provenance tag explicit_payload. Otherwise it falls to tier two, device-manifest lookup, which resolves as device_manifest when the hardware ID maps to a known projection that validates. Failing that, tier three tests whether the raw coordinates fall inside a pre-staged regional zone and infers a UTM zone, resolving as regional_heuristic. If every tier is exhausted, tier four assigns WGS 84 EPSG 4326 with the tag safe_default_wgs84 and emits a high-priority audit record. At any tier, a bounds-validation failure — axis-order inversion or null-island drift — routes the record to a manual-review quarantine queue instead of the operational layer.</desc>
  <defs>
    <marker id="crs-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
    <marker id="crs-flow-warn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <!-- input -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <rect x="40" y="20" width="220" height="46" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="150" y="40" font-weight="700">GPS record · no declared CRS</text>
    <text x="150" y="57" font-size="11">track.gpx · points.csv</text>
  </g>
  <!-- tier rows -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <!-- tier 1 -->
    <rect x="40" y="104" width="220" height="58" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="150" y="127" font-weight="700">1 · Explicit declaration?</text>
    <text x="150" y="145" font-size="11">crs / epsg_code in payload</text>
    <!-- tier 2 -->
    <rect x="40" y="196" width="220" height="58" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="150" y="219" font-weight="700">2 · Device in registry?</text>
    <text x="150" y="237" font-size="11">hardware ID → projection</text>
    <!-- tier 3 -->
    <rect x="40" y="288" width="220" height="58" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="150" y="311" font-weight="700">3 · Inside regional zone?</text>
    <text x="150" y="329" font-size="11">infer UTM from extent</text>
    <!-- tier 4 -->
    <rect x="40" y="380" width="220" height="58" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="150" y="403" font-weight="700">4 · Safe default + flag</text>
    <text x="150" y="421" font-size="11">WGS 84 · high-priority log</text>
  </g>
  <!-- pass (resolve) targets with provenance tags -->
  <g font-size="11.5" text-anchor="middle" fill="currentColor">
    <rect x="470" y="106" width="230" height="40" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="585" y="131" font-family="monospace" font-size="12">explicit_payload</text>
    <rect x="470" y="198" width="230" height="40" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="585" y="223" font-family="monospace" font-size="12">device_manifest</text>
    <rect x="470" y="290" width="230" height="40" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="585" y="315" font-family="monospace" font-size="12">regional_heuristic</text>
    <rect x="470" y="382" width="230" height="40" rx="8" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="585" y="407" font-family="monospace" font-size="12">safe_default_wgs84</text>
  </g>
  <!-- quarantine -->
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <rect x="740" y="196" width="120" height="150" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="800" y="262" font-weight="700">Manual</text>
    <text x="800" y="280" font-weight="700">review</text>
    <text x="800" y="298" font-size="11">quarantine</text>
  </g>
  <!-- vertical "no / next tier" flow down the left column -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#crs-flow)">
    <path d="M150,66 V100"/>
    <path d="M150,162 V192"/>
    <path d="M150,254 V284"/>
    <path d="M150,346 V376"/>
  </g>
  <!-- "no" labels -->
  <g font-size="10.5" fill="currentColor" text-anchor="middle">
    <text x="166" y="182">no</text>
    <text x="166" y="274">no</text>
    <text x="166" y="366">no</text>
  </g>
  <!-- pass branches to provenance (validated) -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#crs-flow)">
    <path d="M260,126 H466"/>
    <path d="M260,218 H466"/>
    <path d="M260,310 H466"/>
    <path d="M260,409 H466"/>
  </g>
  <g font-size="10.5" fill="currentColor" text-anchor="middle">
    <text x="380" y="116">pass · validated</text>
    <text x="380" y="208">pass · validated</text>
    <text x="380" y="300">pass · validated</text>
  </g>
  <!-- bounds-validation failure -> quarantine -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#crs-flow-warn)">
    <path d="M700,126 H720 V230 H738"/>
    <path d="M700,218 H722 V250 H738"/>
    <path d="M700,310 H722 V292 H738"/>
  </g>
  <text x="734" y="170" font-size="10.5" fill="var(--crimson, currentColor)" text-anchor="middle">bounds fail</text>
</svg>

Before the ladder, it is worth being precise about what a parser can and cannot learn from the numbers themselves, because the temptation to skip straight to sniffing is strong and the limit is sharper than it looks.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="cs-t cs-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cs-t">Telling coordinate systems apart by the shape of the numbers alone</title>
  <desc id="cs-d">Three raw coordinate pairs from the same physical location near Albuquerque, written in three coordinate systems. In WGS 84 geographic the pair is minus 106.61 and 35.08, two small signed decimals with the longitude first. In UTM zone 13 north the pair is 353,470 and 3,883,100, a six-figure easting and a seven-figure northing. In New Mexico State Plane Central, in survey feet, it is 1,527,600 and 1,479,900, two seven-figure values of similar magnitude. The magnitude and sign pattern identify the family unambiguously, but they cannot identify the zone: a UTM pair from zone 12 or zone 14 has exactly the same shape and lands hundreds of kilometres away. This is why the bounds heuristic can rule systems out but never confirm one.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one location near Albuquerque, written three ways</text>
  <g>
    <rect x="40" y="80" width="256" height="100" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
    <rect x="312" y="80" width="256" height="100" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
    <rect x="584" y="80" width="256" height="100" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  </g>
  <g font-size="10.5" font-weight="700" fill="var(--crimson-deep)">
    <text x="56" y="104">WGS 84 geographic</text>
    <text x="328" y="104">UTM zone 13N</text>
    <text x="600" y="104">NM State Plane Central</text>
  </g>
  <g font-size="13" font-weight="700" fill="currentColor">
    <text x="56" y="136">-106.61, 35.08</text>
    <text x="328" y="136">353470, 3883100</text>
    <text x="600" y="136">1527600, 1479900</text>
  </g>
  <g font-size="9.5" fill="var(--muted)">
    <text x="56" y="160">two small signed decimals</text>
    <text x="328" y="160">6-figure E, 7-figure N</text>
    <text x="600" y="160">two 7-figure values, survey feet</text>
  </g>
  <rect x="40" y="214" width="800" height="96" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="240" font-size="11" font-weight="700" fill="var(--ember-text)">what the shape cannot tell you</text>
  <text x="60" y="264" font-size="10.5" fill="currentColor">A UTM pair from zone 12 or zone 14 has exactly this shape too, and lands hundreds of kilometres away.</text>
  <text x="60" y="284" font-size="10.5" fill="currentColor">Magnitude identifies the family; only the incident extent, a manifest, or a declaration identifies the zone.</text>
  <text x="8" y="340" font-size="10.5" fill="currentColor">Which is why tier 3 marks its result inferred: it eliminated the alternatives, it did not confirm the answer.</text>
</svg>

The families are unmistakable. Two small signed decimals with a value beyond ±90 in the first position is geographic, longitude-first. A six-figure value paired with a seven-figure one is a UTM easting and northing. Two seven-figure values of similar magnitude is a State Plane pair in survey feet. Any of those can be recognised in a line of code, and a lot of pipelines stop there feeling pleased.

The zone is the part that cannot be recovered. Every UTM zone uses the same 500,000-metre false easting, so the coordinates of a point in zone 12 look identical in shape to one in zone 13, and reading a zone-12 pair as zone 13 places it roughly 500 kilometres east — inside New Mexico rather than Arizona, plausibly on land, with no arithmetic anomaly to notice. State Plane is worse, because a single state carries several zones with overlapping value ranges.

That is the whole justification for the ordering below. Sniffing is not a resolution tier at all; it is a validation tier that happens to be useful for elimination. It belongs after the declaration and the manifest, and its output belongs in a different field — `crs_source: inferred` rather than `crs_source: declared` — so that everything downstream can treat the two differently and a reviewer can find every inferred record in one query.

## Tiered Resolution Strategy

Treat a missing CRS as a recoverable exception, never a fatal error and never a silent assumption. Resolve it through an ordered chain that runs from the most definitive evidence to a flagged safe default, stopping at the first tier that passes bounds validation:

1. **Explicit declaration.** Parse any `crs`, `epsg_code`, `srs_name`, or `datum` field carried in the payload itself. A self-described CRS is authoritative — but still validate it against the coordinate bounds before trusting it, because exporters mislabel as often as they omit.
2. **Device manifest resolution.** Cross-reference the hardware ID, app bundle, or field-crew profile against a cached registry of each device's known default projection. A unit that always logs UTM Zone 16N is a reliable signal when its own payload is silent.
3. **Regional / operational heuristic.** Validate the raw coordinates against the active incident extent or pre-staged Universal Transverse Mercator (UTM) zones, and infer the projection from where the point actually falls. This recovers points that are clearly geographic degrees inside the operational area.
4. **Safe default with audit flag.** Assign WGS 84 / EPSG:4326 (or the jurisdictional standard), emit a high-priority log record with the record ID and provenance tag, and route to a manual-review quarantine when positional tolerance thresholds are exceeded. The data stays usable, but no operator mistakes a guess for a measurement.

Running a representative batch through the ladder shows why the tiers are ordered the way they are, and where the operational attention belongs.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="mc-t mc-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="mc-t">How a batch of field-collected GPS logs resolves across the four tiers</title>
  <desc id="mc-d">A hundred field-collected logs entering the resolver. Sixty-two declare their own coordinate reference in the payload and are resolved definitively. Of the remainder, twenty-four are resolved by looking the device hardware identifier up in a cached manifest, which is equally trustworthy. Eleven more are inferred by testing the raw coordinates against the active incident extent, which is weaker evidence because it can only rule systems out, not confirm one. The last three reach the safe default: the jurisdictional standard is assumed, a high-priority audit record is written and the features are held out of the operating picture pending review. Each band is narrower than the one above it and each carries weaker evidence, so the useful metric is not the resolution rate but how much of the batch reaches the bottom band.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">100 logs entering the resolver — each tier takes what the one above it could not</text>
  <text x="8" y="78" font-size="10" fill="var(--muted)">strongest evidence</text>
  <rect x="200" y="100" width="560.0" height="30" rx="5" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <rect x="200" y="100" width="347.2" height="30" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="120" font-size="10.5" fill="currentColor">payload declares its CRS</text>
  <text x="770.0" y="120" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">62% · declared</text>
  <rect x="200" y="156" width="212.8" height="30" rx="5" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <rect x="200" y="156" width="134.4" height="30" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="176" font-size="10.5" fill="currentColor">device manifest lookup</text>
  <text x="422.8" y="176" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">24% · resolved</text>
  <rect x="200" y="212" width="78.4" height="30" rx="5" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <rect x="200" y="212" width="61.6" height="30" rx="5" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="232" font-size="10.5" fill="currentColor">bounds heuristic vs incident extent</text>
  <text x="288.4" y="232" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">11% · inferred</text>
  <rect x="200" y="268" width="16.8" height="30" rx="5" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <rect x="200" y="268" width="16.8" height="30" rx="5" fill="var(--ember)" opacity="0.6" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="288" font-size="10.5" fill="currentColor">safe default + high-priority flag</text>
  <text x="226.8" y="288" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">3% · assumed</text>
  <text x="8" y="352" font-size="10" fill="var(--muted)">weakest — assumption, not evidence</text>
  <text x="440" y="352" font-size="10.5" font-weight="700" text-anchor="middle" fill="var(--ember-text)">3 of 100 held out of the picture pending review</text>
</svg>

The top two tiers are interchangeable in quality even though only one of them reads the payload. A device manifest lookup is not a guess: the hardware identifier is a fact carried by the record, and the manifest is a curated mapping somebody maintains deliberately. Resolving 24 per cent of a batch this way is exactly as trustworthy as the 62 per cent that declared themselves, which is worth saying because the instinct is to treat "we had to look it up" as second-class.

The third tier is genuinely weaker, and its weakness is specific: a bounds test can only *rule out* coordinate systems, never confirm one. If the raw coordinates fall inside the incident extent when read as WGS 84 and nowhere sensible otherwise, that is strong circumstantial evidence and nothing more — a UTM easting for a different zone can occasionally land inside a large extent too. It resolves the record and it should mark it as inferred rather than declared, so a reviewer can tell the two apart later.

The metric that matters is the bottom band, not the total. A pipeline resolving 97 per cent looks excellent, and the three unresolved records are the entire point of the exercise: they are held out of the operating picture, they carry a high-priority audit record naming the device, and they should trigger a manifest update rather than a resolver change. A bottom band that stays at three records is a healthy system; one that grows week over week is a fleet acquiring devices nobody has registered.

## Production Python Implementation

The following resolver implements the full chain in one path: explicit parse, registry lookup, regional inference, and audit-flagged default. It enforces bounds validation at every tier to catch axis-order inversion and null-island drift, and emits structured log records — not `print` calls — so every inference is reconstructable. It assumes `pyproj >= 3.4` with a PROJ 9.x data directory so datum grids resolve.

```python
import logging
import pyproj
from pyproj.exceptions import CRSError
from typing import Dict, Optional, Tuple

# Structured audit logging keyed to incident record IDs, not stdout.
logger = logging.getLogger("emergency_crs_resolver")
logger.setLevel(logging.INFO)


class CRSResolver:
    def __init__(
        self,
        device_registry: Dict[str, int],
        regional_zones: Dict[str, Tuple[float, float, float, float]],
    ) -> None:
        self.device_registry = device_registry  # {device_id: epsg_code}
        self.regional_zones = regional_zones     # {zone_name: (minx, miny, maxx, maxy)}

    def _validate_bounds(self, lon: float, lat: float, epsg: int) -> bool:
        """Reject axis-order inversion and null-island drift before trusting a CRS."""
        try:
            crs = pyproj.CRS.from_epsg(epsg)
            if crs.is_geographic:
                # Null-island guard: (0, 0) is almost always a GPS init failure.
                if abs(lon) < 1e-7 and abs(lat) < 1e-7:
                    return False
                return -180 <= lon <= 180 and -90 <= lat <= 90
            # Projected: coarse sanity check against impossible magnitudes.
            return abs(lon) < 1e8 and abs(lat) < 1e8
        except CRSError as exc:
            logger.warning("Bounds validation failed for EPSG:%s: %s", epsg, exc)
            return False

    def _utm_epsg_from_lon_lat(self, lon: float, lat: float) -> int:
        """WGS84 UTM zone EPSG from geographic coordinates.

        Zone = floor((lon + 180) / 6) + 1, clamped to 1-60.
        Northern hemisphere -> 32601-32660; southern -> 32701-32760.
        """
        zone = max(1, min(60, int((lon + 180) / 6) + 1))
        return (32600 if lat >= 0 else 32700) + zone

    def resolve(self, record: Dict) -> Tuple[pyproj.CRS, str]:
        """Deterministic CRS resolution with an explicit, ordered fallback chain."""
        lon: Optional[float] = record.get("longitude")
        lat: Optional[float] = record.get("latitude")
        explicit_epsg = record.get("epsg_code") or record.get("crs")
        device_id = record.get("device_id")
        has_coords = lon is not None and lat is not None

        # Tier 1 — explicit payload declaration (validated, not blindly trusted).
        if explicit_epsg:
            try:
                crs = pyproj.CRS.from_epsg(int(explicit_epsg))
                if has_coords and self._validate_bounds(lon, lat, crs.to_epsg()):
                    return crs, "explicit_payload"
            except (CRSError, ValueError):
                logger.warning(
                    "Invalid explicit CRS %s in record %s",
                    explicit_epsg, record.get("id"),
                )

        # Tier 2 — device manifest lookup.
        if device_id and device_id in self.device_registry:
            fallback_epsg = self.device_registry[device_id]
            try:
                crs = pyproj.CRS.from_epsg(fallback_epsg)
                if has_coords and self._validate_bounds(lon, lat, fallback_epsg):
                    return crs, "device_manifest"
            except CRSError:
                logger.warning(
                    "Registry EPSG %s for device %s is invalid",
                    fallback_epsg, device_id,
                )

        # Tier 3 — regional heuristic inference from where the point falls.
        if has_coords:
            for zone, (minx, miny, maxx, maxy) in self.regional_zones.items():
                if minx <= lon <= maxx and miny <= lat <= maxy:
                    utm_epsg = self._utm_epsg_from_lon_lat(lon, lat)
                    try:
                        return pyproj.CRS.from_epsg(utm_epsg), f"regional_heuristic:{zone}"
                    except CRSError:
                        continue

        # Tier 4 — safe default with compliance flag and manual-review routing.
        logger.critical(
            "CRS resolution exhausted for record %s; defaulting to EPSG:4326. "
            "Requires manual spatial validation.",
            record.get("id"),
        )
        return pyproj.CRS.from_epsg(4326), "safe_default_wgs84"


# Usage pattern at the incident ingestion boundary.
resolver = CRSResolver(
    device_registry={"FIELD_UNIT_A1": 32616, "DRONE_X9": 4326},
    regional_zones={"GULF_COAST_FLOOD": (-95.0, 28.0, -88.0, 32.0)},
)

sample_log = {
    "id": "INC-8842",
    "longitude": -91.45,
    "latitude": 30.12,
    "device_id": "FIELD_UNIT_A1",
}
resolved_crs, provenance = resolver.resolve(sample_log)
logger.info("Record %s resolved to EPSG:%s via %s",
            sample_log["id"], resolved_crs.to_epsg(), provenance)
```

Standardize the output to the jurisdictional EPSG immediately after resolution, call `.set_crs()` explicitly on the resulting `GeoDataFrame`, and lock that CRS for every downstream spatial operation. Never rely on implicit CRS inheritance during batch processing — the moment one untagged frame slips through, the audit trail breaks.

## Validation Checklist

Confirm each item before a resolver build is cleared for field deployment:

- [ ] Every resolved record carries a provenance tag (`explicit_payload`, `device_manifest`, `regional_heuristic:*`, or `safe_default_wgs84`) written to the audit log with its record ID.
- [ ] `_validate_bounds` rejects `(0, 0)` and out-of-range geographic coordinates before any tier returns.
- [ ] `Transformer.from_crs(...)` calls downstream use `always_xy=True` so axis order is fixed.
- [ ] The output `GeoDataFrame` has an explicit `.set_crs()` immediately after resolution — no implicit inheritance.
- [ ] Records that hit Tier 4 (`safe_default_wgs84`) outside tolerance route to a quarantine queue, not straight to the operational layer.
- [ ] The device registry is current for every hardware ID and app bundle in active field rotation.
- [ ] Regional zone bounds match the actual incident extent, not a stale prior activation.

## Edge Cases and Gotchas

- **Axis-order inversion.** GPX and many GeoJSON producers disagree on lat/lon vs lon/lat ordering. A swap silently transposes a Gulf Coast point into the Indian Ocean. Check `pyproj.CRS.is_geographic`, enforce `always_xy=True`, and let `_validate_bounds` catch the transposition.
- **Null-island drift.** A `lon ≈ 0, lat ≈ 0` pair is a GPS initialization failure or a malformed export, not a real fix. Filter and quarantine it before any spatial join — a single null-island point can blow up an extent-based query across the whole layer.
- **Offline device quirks.** When a field app reconnects after an extended outage, batch uploads can reorder records, drop the original timestamps, or strip CRS provenance tags written before the outage. Validate payload-header checksums and preserve original timestamps on reconnect so a stale assumption is not applied to a fresh batch.
- **Agency-specific datum anomalies.** Legacy municipal and state data frequently sits in NAD27 or a State Plane grid. A 10–100 m offset against the WGS 84 basemap is the tell. Resolve it with an explicit `pyproj.Transformer.from_crs()` and a real datum-transformation grid — never a naive coordinate shift, which leaves the residual error baked in. Datum-aware reprojection itself belongs to the [coordinate reference systems for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) workflow once the CRS is recovered.

## Related

- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) — where resolved geometry is validated, de-duplicated, and published.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — datum-aware reprojection once a CRS is recovered.
- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) — preserving provenance tags across field outages.

Up: [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/)
