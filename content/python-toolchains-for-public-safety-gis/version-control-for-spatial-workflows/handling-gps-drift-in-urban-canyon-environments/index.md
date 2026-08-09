---
title: "Handling GPS Drift in Urban Canyon Environments"
description: "Correct multipath-induced GPS drift in dense urban cores with a version-controlled Python pipeline: reject reflected fixes on HDOP and velocity, fall back to last-known-good with a confidence score, and emit an immutable audit trail for every overridden coordinate."
slug: handling-gps-drift-in-urban-canyon-environments
type: article
breadcrumb: "GPS Drift in Urban Canyons"
datePublished: "2025-03-14"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Handling GPS Drift in Urban Canyon Environments",
      "description": "Correct multipath-induced GPS drift in dense urban cores with a version-controlled Python pipeline: reject reflected fixes on HDOP and velocity, fall back to last-known-good with a confidence score, and emit an immutable audit trail for every overridden coordinate.",
      "datePublished": "2025-03-14",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Python Toolchains for Public Safety GIS", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/" },
        { "@type": "ListItem", "position": 3, "name": "Version Control for Spatial Workflows", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/" },
        { "@type": "ListItem", "position": 4, "name": "Handling GPS Drift in Urban Canyon Environments", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/handling-gps-drift-in-urban-canyon-environments/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Correct GPS drift from urban multipath in an incident tracking feed",
      "description": "Reject multipath-corrupted GNSS fixes using HDOP and velocity gates, fall back to the last validated position with a degraded confidence score, and record every override in an immutable audit trail so corrected tracks remain defensible.",
      "step": [
        { "@type": "HowToStep", "name": "Gate on fix quality", "text": "Discard fixes with HDOP above threshold or fewer than four satellites before any geometry is trusted, and flag the record rather than dropping it." },
        { "@type": "HowToStep", "name": "Reject multipath outliers on velocity", "text": "Compute haversine velocity against the last validated fix and reject physically impossible jumps that indicate a reflected signal rather than real motion." },
        { "@type": "HowToStep", "name": "Fall back to last-known-good", "text": "When a fix is rejected, hold the last validated position and attach a reduced confidence score so downstream consumers can weight or suppress it." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Log every override with the original coordinate, the substituted coordinate, the reason code, and the calibration version so the correction is reproducible." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does GPS drift so badly between tall buildings?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Tall facades block direct line-of-sight to satellites and reflect their signals, so the receiver computes a position from delayed, reflected paths (multipath) and from a weak, poorly distributed satellite geometry (high HDOP). The result is a fix that can jump tens or hundreds of metres between consecutive samples even when the device is stationary."
          }
        },
        {
          "@type": "Question",
          "name": "Should drifted fixes be dropped or corrected?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Dropping them silently breaks track continuity and hides the failure from after-action review. The defensible approach is to substitute the last validated position, attach a reduced confidence score, and emit an audit record for every override, so a responder track never snaps to a reflected coordinate yet every correction remains reproducible and auditable."
          }
        },
        {
          "@type": "Question",
          "name": "What HDOP threshold should an urban tracking feed use?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A horizontal dilution of precision (HDOP) ceiling of 4.0 with a minimum of four satellites is a reasonable urban default, but it must be tuned per device and committed as a versioned parameter. Because the threshold materially changes which coordinates are accepted, it has to live under spatial version control so any corrected track can be reproduced against the exact calibration that produced it."
          }
        }
      ]
    }
  ]
}
</script>

# Handling GPS Drift in Urban Canyon Environments

A search team works a four-block grid between forty-storey towers in a downtown collapse zone. Their tracker reports them stationary at a staging point, then jumps 180 metres into the lobby of an adjacent building, then back, all within twelve seconds — while the team has not moved. The incident command dashboard now shows a resource inside a structure that is cordoned off, and a dispatcher reassigns the next task on the assumption that block is covered. The device did not malfunction: it is reporting reflected satellite signals off glass and concrete as if they were real motion. This is GPS drift in an urban canyon, and it is the single narrow failure mode this page solves — turning a stream of multipath-corrupted fixes into a continuous, defensible track without ever snapping a responder to a coordinate that is physically impossible.

## Root Cause and Operational Impact

In an urban canyon the receiver rarely has clean line-of-sight to enough satellites. Facades occlude part of the sky, leaving a weak and poorly distributed constellation that inflates horizontal dilution of precision (HDOP). Worse, the signals that do arrive often bounce off buildings first, so the receiver solves position from delayed reflected paths — multipath — and places the device tens or hundreds of metres from its true location. Consecutive fixes then disagree wildly even when the device is stationary, producing the characteristic "teleporting" track.

This is dangerous, not merely inconvenient, because every downstream decision in an incident inherits the error. A drifted fix snapped onto a building footprint implies a responder is inside a structure they never entered, corrupting accountability during an evacuation. A spurious 50 m/s velocity spike defeats geofence alerts and breaks any map-matched routing. And because the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both expect resource locations to be reconstructable for after-action review, a track that silently swallowed or smoothed away bad fixes is not legally defensible. The fix has to be auditable: every coordinate the pipeline overrides must be recorded, which is exactly why drift correction belongs inside [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) rather than buried in an ad-hoc field script.

<svg viewBox="0 0 880 470" role="img" aria-label="Urban-canyon multipath diagram. A satellite's direct line-of-sight ray to a street-level receiver is blocked by a tall building facade, while a second ray reflects off the opposite facade and reaches the receiver as a delayed multipath signal. The receiver's true position sits at street level, but the computed position is pulled tens of metres away toward the reflected ray. A side panel lists three rejection gates — HDOP ceiling, minimum satellites, and maximum velocity — feeding a last-known-good fallback that carries a degraded confidence badge." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Multipath in an urban canyon and the rejection gates that correct it</title>
  <desc>Tall building facades block the satellite's direct line of sight to a street-level GNSS receiver and reflect its signal off glass and concrete. The receiver solves position from the delayed reflected path, so the computed fix drifts tens of metres from the device's true location toward the reflected ray. The correction pipeline runs each fix through three gates in order — an HDOP ceiling, a minimum satellite count, and a maximum velocity check against the last validated fix — and any fix that fails a gate is replaced by the last-known-good position carrying a reduced confidence score and an audit record.</desc>
  <defs>
    <marker id="drift-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="drift-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- ground line -->
  <line x1="40" y1="392" x2="560" y2="392" stroke="currentColor" stroke-width="1.4"/>
  <text x="48" y="410" font-size="10.5" fill="currentColor" opacity="0.75">street level</text>
  <!-- left building facade -->
  <rect x="70" y="120" width="86" height="272" rx="4" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
  <g stroke="currentColor" stroke-width="0.8" opacity="0.55">
    <line x1="92" y1="150" x2="92" y2="380"/><line x1="113" y1="150" x2="113" y2="380"/><line x1="134" y1="150" x2="134" y2="380"/>
    <line x1="70" y1="172" x2="156" y2="172"/><line x1="70" y1="216" x2="156" y2="216"/><line x1="70" y1="260" x2="156" y2="260"/><line x1="70" y1="304" x2="156" y2="304"/><line x1="70" y1="348" x2="156" y2="348"/>
  </g>
  <!-- right building facade -->
  <rect x="404" y="96" width="86" height="296" rx="4" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
  <g stroke="currentColor" stroke-width="0.8" opacity="0.55">
    <line x1="426" y1="126" x2="426" y2="380"/><line x1="447" y1="126" x2="447" y2="380"/><line x1="468" y1="126" x2="468" y2="380"/>
    <line x1="404" y1="148" x2="490" y2="148"/><line x1="404" y1="192" x2="490" y2="192"/><line x1="404" y1="236" x2="490" y2="236"/><line x1="404" y1="280" x2="490" y2="280"/><line x1="404" y1="324" x2="490" y2="324"/>
  </g>
  <!-- satellite -->
  <g>
    <rect x="287" y="37" width="26" height="18" rx="3" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <rect x="266" y="40" width="17" height="12" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.3"/>
    <rect x="317" y="40" width="17" height="12" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.3"/>
  </g>
  <text x="300" y="26" font-size="11" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">GNSS satellite</text>
  <!-- receiver (true position) at street level -->
  <circle cx="250" cy="384" r="6.5" fill="currentColor"/>
  <text x="250" y="372" font-size="10.5" text-anchor="middle" font-weight="600" fill="currentColor">receiver · true position</text>
  <!-- direct (blocked) ray -->
  <line x1="293" y1="58" x2="262" y2="372" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 5" opacity="0.85"/>
  <g transform="translate(420,150) rotate(81)">
    <line x1="-9" y1="-9" x2="9" y2="9" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <line x1="-9" y1="9" x2="9" y2="-9" stroke="var(--crimson, currentColor)" stroke-width="2"/>
  </g>
  <text x="360" y="210" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.8" transform="rotate(81 360 210)">direct LOS blocked</text>
  <!-- reflected (multipath) ray: satellite -> right facade -> receiver -->
  <path d="M310,56 L446,236" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
  <path d="M446,236 L320,372" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.7" marker-end="url(#drift-arrow)"/>
  <circle cx="446" cy="236" r="4" fill="var(--crimson, currentColor)"/>
  <text x="500" y="232" font-size="10" text-anchor="start" fill="var(--crimson, currentColor)">reflection point</text>
  <text x="392" y="320" font-size="10" text-anchor="middle" fill="var(--crimson, currentColor)" transform="rotate(-47 392 320)">reflected / multipath</text>
  <!-- computed (drifted) position -->
  <g>
    <line x1="318" y1="372" x2="334" y2="388" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <line x1="334" y1="372" x2="318" y2="388" stroke="var(--crimson, currentColor)" stroke-width="2"/>
  </g>
  <text x="326" y="412" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">computed · drifted</text>
  <!-- drift offset measure -->
  <path d="M250,430 H326" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.2" marker-start="url(#drift-arrow)" marker-end="url(#drift-arrow)"/>
  <text x="288" y="448" font-size="10" text-anchor="middle" fill="var(--crimson, currentColor)">drift offset (tens of metres)</text>
  <!-- divider -->
  <line x1="592" y1="40" x2="592" y2="448" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>
  <!-- side panel: rejection gates -->
  <text x="616" y="56" font-size="12.5" font-weight="700" fill="currentColor">Correction pipeline</text>
  <g font-size="11" fill="currentColor">
    <rect x="616" y="72" width="224" height="44" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="628" y="92" font-weight="600">Gate 1 · HDOP ceiling</text>
    <text x="628" y="108" font-size="10">reject HDOP &gt; 4.0</text>
    <rect x="616" y="124" width="224" height="44" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="628" y="144" font-weight="600">Gate 2 · min satellites</text>
    <text x="628" y="160" font-size="10">reject fewer than 4 sats / no 2D-3D fix</text>
    <rect x="616" y="176" width="224" height="44" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="628" y="196" font-weight="600" fill="var(--crimson, currentColor)">Gate 3 · max velocity</text>
    <text x="628" y="212" font-size="10">reject jump &gt; 35 m/s vs last fix</text>
  </g>
  <!-- flow arrows between gates -->
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#drift-plain)">
    <path d="M728,116 V124"/>
    <path d="M728,168 V176"/>
  </g>
  <path d="M728,220 V236" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#drift-arrow)"/>
  <!-- fallback -->
  <rect x="616" y="240" width="224" height="58" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="728" y="262" font-size="11.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Hold last-known-good</text>
  <text x="728" y="280" font-size="10" text-anchor="middle" fill="currentColor">substitute last validated fix</text>
  <text x="728" y="293" font-size="10" text-anchor="middle" fill="currentColor">+ emit audit record</text>
  <!-- confidence badge -->
  <rect x="652" y="316" width="152" height="30" rx="15" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
  <circle cx="676" cy="331" r="6" fill="var(--crimson, currentColor)"/>
  <text x="690" y="335" font-size="9.5" text-anchor="start" fill="var(--crimson, currentColor)" font-weight="600">confidence ↓ degraded</text>
  <text x="728" y="372" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">pass all gates → accept,</text>
  <text x="728" y="386" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">advance last-known-good</text>
</svg>

## Tiered Resolution Strategy

Correct the stream in ordered tiers, from the definitive fix down to a safe default that is always flagged for audit. Never drop a record silently — a gap in the track is itself a loss of accountability.

1. **Accept only quality fixes (definitive).** Require a 2D/3D fix, at least four satellites, and HDOP at or below the committed ceiling. A fix that clears every gate is trusted and becomes the new last-known-good.
2. **Reject multipath outliers on kinematics.** Compute the implied haversine velocity against the last validated fix. A pedestrian or vehicle cannot exceed a physical ceiling, so a jump that does is a reflected signal, not motion — reject the coordinate.
3. **Hold last-known-good with degraded confidence (safe default).** When a fix is rejected for either reason, substitute the last validated position and attach a reduced confidence score so consumers can weight, dim, or suppress it rather than treating it as truth.
4. **Snap to a topological constraint (optional hardening).** Where a validated road or access-route network exists, map-match the held position onto it so the track cannot drift into an impassable alley or a building interior.
5. **Emit an audit record for every override.** Original coordinate, substituted coordinate, reason code, confidence, and the calibration version — so any corrected track is reproducible against the exact parameters that produced it.

Urban multipath does not look like noise, which is why filters designed for noise make it worse.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="mp-t mp-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="mp-t">Random error versus multipath, and why averaging helps one and not the other</title>
  <desc id="mp-d">Two error patterns around a responder standing still between tall buildings. Random error scatters roughly symmetrically about the true position, so averaging many fixes converges on it — more samples give a better answer. Multipath error is a reflected signal, so every fix is displaced in the same direction, away from the reflecting facade: the scatter is tight, the reported accuracy is optimistic, and averaging converges confidently on a position twenty metres inside the building. The distinguishing signature is that multipath produces low reported dilution of precision with a persistent directional bias, which is exactly the combination a naive quality filter reads as high-quality data.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">averaging fixes one of these and entrenches the other</text>
  <text x="80" y="80" font-size="11" font-weight="700" fill="currentColor">random error</text>
  <text x="520" y="80" font-size="11" font-weight="700" fill="var(--ember-text)">multipath</text>
  <circle cx="220" cy="200" r="9" fill="var(--crimson)"/>
  <text x="150" y="180" font-size="10" font-weight="700" fill="var(--crimson-deep)">true position</text>
  <g fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2">
    <circle cx="196" cy="176" r="5"/><circle cx="248" cy="184" r="5"/><circle cx="204" cy="228" r="5"/>
    <circle cx="252" cy="222" r="5"/><circle cx="226" cy="164" r="5"/><circle cx="184" cy="208" r="5"/>
    <circle cx="240" cy="206" r="5"/><circle cx="212" cy="240" r="5"/>
  </g>
  <text x="120" y="286" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">the mean converges on the truth</text>
  <text x="120" y="304" font-size="10" fill="currentColor">more samples, better answer</text>
  <rect x="620" y="120" width="30" height="180" fill="var(--muted)" opacity="0.3"/>
  <text x="656" y="140" font-size="10" font-weight="700" fill="var(--muted)">facade</text>
  <circle cx="560" cy="200" r="9" fill="var(--crimson)"/>
  <text x="486" y="180" font-size="10" font-weight="700" fill="var(--crimson-deep)">true position</text>
  <g fill="var(--ember)" stroke="var(--ember)" stroke-width="1.2">
    <circle cx="502" cy="196" r="5"/><circle cx="508" cy="204" r="5"/><circle cx="498" cy="210" r="5"/>
    <circle cx="512" cy="192" r="5"/><circle cx="504" cy="216" r="5"/><circle cx="496" cy="200" r="5"/>
  </g>
  <path d="M550 200 H516" fill="none" stroke="var(--ember)" stroke-width="1.6"/>
  <path d="M516 200 l9 -5 M516 200 l9 5" fill="none" stroke="var(--ember)" stroke-width="1.6"/>
  <text x="452" y="286" font-size="10.5" font-weight="700" fill="var(--ember-text)">tight scatter, optimistic accuracy</text>
  <text x="452" y="304" font-size="10" fill="currentColor">the mean converges on a point 20 m inside a building</text>
  <text x="8" y="348" font-size="10.5" fill="currentColor">Multipath signature: low reported dilution of precision plus a persistent directional bias —</text>
  <text x="8" y="366" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">exactly what a naive quality filter reads as high-confidence data.</text>
</svg>

The two panels contain the same number of fixes and the right-hand one has a *tighter* spread, which is the trap. Every quality heuristic built on precision — averaging, discarding outliers, weighting by reported accuracy — treats the multipath cluster as the better data. The receiver agrees: with several reflected satellites in view, the geometric dilution of precision is genuinely low, and the accuracy figure it reports is a statement about internal consistency rather than about truth.

So the detector cannot be built on scatter. It has to be built on the thing scatter does not capture: a persistent offset in a consistent direction, which shows up as a bias between a fix sequence and a motion model, or between GNSS and dead reckoning. A responder walking a straight corridor whose GNSS track is straight but displaced ten metres laterally is the signature to look for, and it requires comparing against something other than the fixes themselves.

The practical consequences are two. Do not average across a suspected multipath interval — averaging is what converts a recoverable per-fix error into a confidently wrong single position. And carry the environment as an attribute on the fix rather than inferring it later: a receiver that reports satellite count and elevation angles gives enough to flag urban-canyon conditions at collection time, when the flag can still travel with the data.

## Production Python Implementation

The routine below carries the full resolution path: quality gating, velocity-based multipath rejection, last-known-good fallback with confidence scoring, structured logging, explicit exception handling, and an immutable audit record per override. Thresholds are parameters, not literals, so they can be committed and versioned alongside the [Coordinate Reference System standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) that the rest of the pipeline enforces. Senior-engineer assumptions apply: `pyproj` and `geopandas` are available, and velocity here uses a haversine approximation rather than a projected metric to stay CRS-agnostic at the edge.

```python
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

logger = logging.getLogger("incidentgis.drift")

EARTH_RADIUS_M = 6_371_000.0


class Reason(str, Enum):
    ACCEPTED = "accepted"
    LOW_QUALITY = "low_quality_fix"
    MULTIPATH = "multipath_velocity_reject"
    ERROR_HOLD = "error_safe_hold"


@dataclass
class GNSSRecord:
    lat: float
    lon: float
    timestamp: float          # epoch seconds
    hdop: float
    satellites: int
    fix_type: int             # 0=none, 2=2D, 3=3D
    confidence: float = 1.0
    reason: str = Reason.ACCEPTED.value


@dataclass
class AuditEntry:
    """Immutable record of a single override, emitted to the audit trail."""
    timestamp: float
    reason: str
    original: tuple[float, float]
    substituted: tuple[float, float]
    confidence: float
    calibration_version: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class UrbanCanyonCorrector:
    """Reject multipath-corrupted GNSS fixes and hold last-known-good.

    Every override is logged and appended to ``audit_log`` so a corrected
    track can be reconstructed against the exact thresholds that produced it.
    """

    def __init__(
        self,
        calibration_version: str,
        hdop_ceiling: float = 4.0,
        min_satellites: int = 4,
        max_velocity_mps: float = 35.0,
    ) -> None:
        self.calibration_version = calibration_version
        self.hdop_ceiling = hdop_ceiling
        self.min_satellites = min_satellites
        self.max_velocity_mps = max_velocity_mps
        self._last_pos: Optional[tuple[float, float]] = None
        self._last_ts: Optional[float] = None
        self.audit_log: list[AuditEntry] = []

    def _haversine_velocity(
        self, lat2: float, lon2: float, ts2: float,
        lat1: float, lon1: float, ts1: float,
    ) -> float:
        """Implied speed (m/s) between two fixes; 0.0 if time is non-increasing."""
        dt = ts2 - ts1
        if dt <= 0:
            return 0.0
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2
        )
        dist = EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return dist / dt

    def _override(self, rec: GNSSRecord, reason: Reason, confidence: float) -> GNSSRecord:
        """Substitute last-known-good, score confidence, and emit an audit entry."""
        original = (rec.lat, rec.lon)
        if self._last_pos is not None:
            rec.lat, rec.lon = self._last_pos
        rec.confidence = confidence
        rec.reason = reason.value
        entry = AuditEntry(
            timestamp=rec.timestamp,
            reason=reason.value,
            original=original,
            substituted=(rec.lat, rec.lon),
            confidence=confidence,
            calibration_version=self.calibration_version,
        )
        self.audit_log.append(entry)
        logger.warning("gps_override", extra={"audit": asdict(entry)})
        return rec

    def correct(self, rec: GNSSRecord) -> GNSSRecord:
        try:
            # Tier 1: quality gate — reject weak or reflected geometry outright.
            if rec.fix_type < 2 or rec.hdop > self.hdop_ceiling \
                    or rec.satellites < self.min_satellites:
                return self._override(rec, Reason.LOW_QUALITY, confidence=0.3)

            # Tier 2: kinematic gate — a physically impossible jump is multipath.
            if self._last_pos is not None and self._last_ts is not None:
                vel = self._haversine_velocity(
                    rec.lat, rec.lon, rec.timestamp,
                    self._last_pos[0], self._last_pos[1], self._last_ts,
                )
                if vel > self.max_velocity_mps:
                    return self._override(rec, Reason.MULTIPATH, confidence=0.5)

            # Accept: trust the fix and advance last-known-good.
            self._last_pos = (rec.lat, rec.lon)
            self._last_ts = rec.timestamp
            rec.confidence = max(0.7, 1.0 - rec.hdop / self.hdop_ceiling)
            rec.reason = Reason.ACCEPTED.value
            logger.debug("gps_accept", extra={"hdop": rec.hdop, "sats": rec.satellites})
            return rec

        except (TypeError, ValueError) as exc:
            # Malformed record: degrade gracefully, never break track continuity.
            logger.error("gps_correct_failed", exc_info=exc)
            return self._override(rec, Reason.ERROR_HOLD, confidence=0.1)
```

The `audit_log` is the load-bearing output here. Persisting it as a committed, content-hashed artifact lets a post-incident reviewer replay every override and confirm that no responder location was fabricated — the reproducibility guarantee that [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) is built to provide.

Once multipath is detected the question becomes what to publish, and the honest answer depends on what the position is for.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="dp-t dp-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="dp-t">Three dispositions for a suspect fix, by what the position is used for</title>
  <desc id="dp-d">A fix flagged as multipath-affected can be handled three ways depending on the consumer. For unit tracking on the common operating picture, publish it with an inflated uncertainty radius: a supervisor needs to know roughly where the crew is, and a twenty-metre circle communicates that honestly. For map-matching to a road segment, snap it to the nearest segment and record the snap, because a road network constrains the position far more tightly than the fix does. For anything positional that will be recorded as evidence — a damage assessment point, a hazmat sample location — withhold it and request a deliberate observation, because an inflated radius is not good enough for a record that will be read years later without its context.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">what to do with a suspect fix depends on what the position is for</text>
  <rect x="40" y="76" width="800" height="72" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="102" font-size="11" font-weight="700" fill="currentColor">unit tracking on the operating picture</text>
  <text x="60" y="124" font-size="10" fill="currentColor">publish with an inflated uncertainty radius — a supervisor needs roughly where the crew is,</text>
  <text x="60" y="140" font-size="10" fill="currentColor">and a 20 m circle says that honestly where a bare point does not</text>
  <rect x="40" y="164" width="800" height="72" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="190" font-size="11" font-weight="700" fill="currentColor">map-matching to a road segment</text>
  <text x="60" y="212" font-size="10" fill="currentColor">snap to the nearest segment and record that it was snapped — the road network constrains the</text>
  <text x="60" y="228" font-size="10" fill="currentColor">position far more tightly than the fix does, so the network is the better evidence</text>
  <rect x="40" y="252" width="800" height="72" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="278" font-size="11" font-weight="700" fill="var(--ember-text)">a position that becomes a record</text>
  <text x="60" y="300" font-size="10" fill="currentColor">damage assessment, hazmat sample, evidence point — withhold and request a deliberate observation;</text>
  <text x="60" y="316" font-size="10" fill="currentColor">an inflated radius is not enough for something that will be read years later without its context</text>
</svg>

The middle row is the one that recovers the most value and is most often skipped. A responder in an urban canyon is almost always on a street, and a road centreline is a far stronger constraint than a GNSS fix with reflected satellites — snapping to the nearest segment typically lands within a couple of metres of truth, an order of magnitude better than the raw fix. The requirement is only that the snap be recorded, so a later reader can tell a measured position from an inferred one.

The bottom row is where the discipline has to hold against pressure. A damage-assessment point captured during an incident becomes, months later, the basis of a claim, and it will be read by somebody who has no idea the fix was taken between two eight-storey buildings. There is no uncertainty annotation that reliably survives that journey — it gets dropped in an export, a join, or a summary — so the only safe handling is not to record the position at all until it can be observed properly.

That distinction is worth encoding in the schema rather than in guidance. Give evidence-grade positions their own type with a required accuracy field and a maximum permitted value, so a suspect fix cannot be written into that table at all. A constraint the database enforces is one that survives the pressure of the incident; a convention in a runbook is not.

## Validation Checklist

Verify every item before deploying the corrector to a live tracking feed.

- [ ] HDOP ceiling, minimum satellite count, and max velocity are passed as parameters and committed under version control — no literals hard-coded in the field build.
- [ ] `calibration_version` is set from the running release tag so each audit entry is traceable to a specific commit.
- [ ] Low-quality and multipath rejections substitute last-known-good and attach a reduced confidence score rather than dropping the record.
- [ ] The first fix in a stream (no last-known-good yet) is handled without raising — a rejected first fix keeps its original coordinate but carries a low confidence and an audit entry.
- [ ] `timestamp` is monotonic per device; non-increasing timestamps yield velocity 0.0 and never a divide-by-zero.
- [ ] Structured logs route to the incident logging sink, not stdout, and every override appears in `audit_log`.
- [ ] Downstream consumers (dashboard, geofence, router) read and honour the `confidence` field instead of treating all fixes equally.
- [ ] The corrector is unit-tested against a synthetic multipath trace with known ground-truth and asserts RMSE within the operational threshold.

## Edge Cases and Gotchas

- **Axis-order inversion.** Records arriving as `(lon, lat)` from a tool that emits EPSG:4326 in x,y order will compute nonsense velocities and silently reject good fixes. Normalize axis order at ingest and run every `pyproj` transform with `always_xy=True`; this is the same contract enforced for the wider pipeline in the [Coordinate Reference System standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/).
- **Null-island drift.** A receiver with no fix often emits `(0.0, 0.0)`. The first such record has no last-known-good to fall back to, so guard explicitly: treat exact `0.0, 0.0` as an invalid fix in the quality gate, or the velocity check will see an Atlantic-Ocean teleport and the held position may itself be null island.
- **Stationary jitter vs. real motion.** Holding last-known-good too aggressively freezes a responder who is genuinely walking slowly through the canyon. Tune `max_velocity_mps` to the mode of travel (foot vs. vehicle) per device, and prefer a confidence-weighted smoother over a hard hold once a network constraint is available.
- **Offline device quirks.** Tablets that buffer fixes while offline can replay them out of order on reconnect, producing negative time deltas. The monotonic-timestamp guard returns 0.0 velocity for those, but you should also sort by timestamp on ingest so the kinematic gate evaluates the stream in true temporal order.
- **Agency-specific datum anomalies.** A device configured for a local or legacy datum (not WGS 84) introduces a constant offset that looks like a slow, steady drift the velocity gate will never catch. Validate the device datum at registration and reproject to the incident CRS before correction, not after.

## Related

- [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) — version the thresholds and audit trail this correction depends on.
- [Coordinate Reference System Standard for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — the CRS and axis-order contract that keeps drift correction from inverting coordinates.
- [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) — pin GDAL/PROJ so the corrector behaves identically on every field device.

Up: [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/)
