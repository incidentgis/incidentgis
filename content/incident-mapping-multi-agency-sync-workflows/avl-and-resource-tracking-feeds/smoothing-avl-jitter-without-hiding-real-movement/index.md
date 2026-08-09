---
title: "Smoothing AVL Jitter Without Hiding Real Movement"
description: "A parked engine and one creeping at walking pace produce the same per-fix displacement, so no threshold separates them. Gate on direction consistency instead, and let events bypass the smoother entirely."
slug: smoothing-avl-jitter-without-hiding-real-movement
type: article
breadcrumb: "Smoothing AVL Jitter"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Smoothing AVL Jitter Without Hiding Real Movement",
      "description": "A parked engine and one creeping at walking pace produce the same per-fix displacement, so no threshold separates them. Gate on direction consistency instead, and let events bypass the smoother entirely.",
      "datePublished": "2026-08-09",
      "dateModified": "2026-08-09",
      "author": {
        "@type": "Organization",
        "name": "Incident GIS"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Incident GIS"
      }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": "https://www.incidentgis.com/"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Incident Mapping & Multi-Agency Sync Workflows",
          "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/"
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "AVL & Resource Tracking Feeds",
          "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/avl-and-resource-tracking-feeds/"
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Smoothing AVL Jitter Without Hiding Real Movement",
          "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/avl-and-resource-tracking-feeds/smoothing-avl-jitter-without-hiding-real-movement/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Suppress AVL jitter without suppressing slow real movement",
      "description": "Gate fixes on the consistency of recent bearings rather than on displacement, keep the raw track, let status changes and large displacements bypass smoothing, and never smooth across a coverage gap.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Gate on direction, not distance",
          "text": "Publish a fix when the bearings of recent displacements agree within a tolerance, because jitter reverses while real movement advances and the displacement magnitude is identical in both."
        },
        {
          "@type": "HowToStep",
          "name": "Keep the raw track",
          "text": "Retain the unsmoothed positions alongside the displayed ones, since the smoothed track is a display artefact and after-action review and drift analysis both need the raw data."
        },
        {
          "@type": "HowToStep",
          "name": "Let events bypass the smoother",
          "text": "Publish immediately on a status change, on any displacement above a hard ceiling, and on the first fix after a heartbeat-only period, because those are exactly the events a smoother would hide."
        },
        {
          "@type": "HowToStep",
          "name": "Publish the smoothing state",
          "text": "Send the reason a position was published or held alongside the position, so a router never treats a held fix as a surveyed one."
        },
        {
          "@type": "HowToStep",
          "name": "Never smooth across a coverage gap",
          "text": "Suppress filtering when a unit reappears after a dead zone, since averaging across the gap invents an intermediate path nobody drove."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does a displacement threshold not work for AVL smoothing?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because a parked unit and a slowly moving one produce the same per-fix displacement. A parked engine's fixes scatter by ten to fifteen metres between reports through multipath, and an engine creeping along a fire line at walking pace also advances ten to fifteen metres between reports. Set the threshold below that and the parked unit wanders; set it above and the creeping unit shows as stationary for minutes at a time. The property that actually differs is direction: jitter reverses, so successive displacements undo each other, while real movement advances with consistent bearings."
          }
        },
        {
          "@type": "Question",
          "name": "What must never be smoothed?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Three things, because a smoother suppresses exactly the events that most need to be seen. A sudden stop is what a constant-velocity model overshoots by design, and a halt at speed can be a collision signature. A reversal along the unit's own track looks like jitter to a direction gate unless the displacement is large, which is what the hard ceiling is for. And the first movement after a long stationary period is delayed by any filter with a warm-up window, at precisely the moment a unit is being committed. Status changes, displacements above a ceiling, and post-gap fixes should all publish raw."
          }
        },
        {
          "@type": "Question",
          "name": "Should the smoothed position replace the raw one?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No — the smoothed track is a display artefact and the raw track is the record. After-action review needs what the receiver actually reported, multipath analysis needs the scatter that smoothing removes, and any consumer computing whether a unit was inside a hazard perimeter should use raw positions with their stated accuracy rather than a filtered estimate. Publishing the reason a position was held or released alongside it lets a routing layer refuse to treat a held fix as surveyed, which is the specific misuse worth preventing."
          }
        }
      ]
    }
  ]
}
</script>

# Smoothing AVL Jitter Without Hiding Real Movement

A supervisor watching the north flank sees eight engines drifting slowly around their staging positions all afternoon. The AVL smoother is turned up to stop it, and the next morning an engine creeping along a division boundary at walking pace shows as stationary for eleven minutes.

## Root Cause and Operational Impact

Position jitter and slow real movement produce the same per-fix displacement. A parked engine's fixes scatter by ten or fifteen metres between reports; an engine creeping along a fire line at walking pace also moves ten or fifteen metres between reports. Any filter that judges a fix by how far it moved cannot separate them.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="jt1-t jt1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="jt1-t">Two position traces that a smoother must treat differently</title>
  <desc id="jt1-d">Two traces of eight consecutive fixes. The first is a parked engine at a water point: the fixes scatter within about twelve metres with no consistent direction, and every apparent movement reverses. The second is an engine creeping along a division boundary at walking pace: the fixes also scatter within about twelve metres, but they advance consistently in one direction. A smoother tuned only on displacement magnitude cannot separate them, because the per-fix displacement is the same in both. Only the consistency of direction distinguishes jitter from slow real movement, which is why a displacement threshold alone either shows a parked unit wandering or freezes a unit that is genuinely moving.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">same per-fix displacement, opposite meanings</text>
  <text x="60" y="80" font-size="10.5" font-weight="700" fill="currentColor">parked at a water point</text>
  <g fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2">
    <circle cx="180" cy="170" r="6"/><circle cx="196" cy="158" r="6"/><circle cx="170" cy="184" r="6"/>
    <circle cx="204" cy="176" r="6"/><circle cx="176" cy="160" r="6"/><circle cx="198" cy="188" r="6"/>
    <circle cx="186" cy="150" r="6"/><circle cx="166" cy="172" r="6"/>
  </g>
  <circle cx="185" cy="170" r="34" fill="none" stroke="var(--crimson)" stroke-width="1.6" stroke-dasharray="4 3"/>
  <text x="130" y="238" font-size="10" fill="currentColor">scatter ~12 m, no consistent direction</text>
  <text x="130" y="256" font-size="10" font-weight="700" fill="var(--crimson-deep)">every apparent move reverses</text>
  <text x="500" y="80" font-size="10.5" font-weight="700" fill="currentColor">creeping along a division boundary</text>
  <g fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2">
    <circle cx="520" cy="186" r="6"/><circle cx="552" cy="176" r="6"/><circle cx="578" cy="184" r="6"/>
    <circle cx="608" cy="170" r="6"/><circle cx="636" cy="178" r="6"/><circle cx="666" cy="164" r="6"/>
    <circle cx="694" cy="172" r="6"/><circle cx="724" cy="158" r="6"/>
  </g>
  <path d="M516 192 L730 154" fill="none" stroke="var(--crimson)" stroke-width="1.6" stroke-dasharray="4 3"/>
  <text x="500" y="238" font-size="10" fill="currentColor">scatter ~12 m, advancing consistently</text>
  <text x="500" y="256" font-size="10" font-weight="700" fill="var(--crimson-deep)">walking pace, and real</text>
  <rect x="40" y="286" width="800" height="52" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="308" font-size="10.5" font-weight="700" fill="var(--ember-text)">a displacement threshold alone cannot separate these</text>
  <text x="60" y="328" font-size="10" fill="currentColor">set it low and the parked unit wanders; set it high and the moving unit freezes</text>
</svg>

What does separate them is the *consistency of direction*. Jitter reverses: each apparent movement is undone by the next. Real slow movement advances, and the bearings of successive displacements agree. That distinction is present in the data and is invisible to a displacement threshold, which is why tuning one produces the two failures above and nothing in between.

The operational cost of each is different and both are real. A wandering parked unit erodes trust in the whole display, so supervisors stop reading positions. A frozen moving unit is worse: it is a unit whose location the picture is actively misstating, at walking pace, along a fire line.

## Tiered Resolution Strategy

1. **Gate on direction consistency, not displacement (definitive).** Accept a fix when the bearings of the last few displacements agree within a tolerance; hold it when they do not.
2. **Keep the raw track alongside the smoothed one.** The smoothed position is for display; the raw track is what an after-action review and any [drift analysis](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/handling-gps-drift-in-urban-canyon-environments/) need.
3. **Bypass smoothing for anything that could be an event (safe default).** Status changes, displacements above a hard ceiling, and the first movement after a heartbeat-only period publish raw.
4. **Publish the smoothing state with the position.** A consumer must be able to tell a held position from a fresh one; a router in particular should not treat a held fix as surveyed.
5. **Never smooth across a coverage gap.** A unit that reappears after a dead zone has genuinely moved, and a filter that averages across the gap invents an intermediate path nobody drove.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="jt2-t jt2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="jt2-t">Four smoothing strategies against the two traces</title>
  <desc id="jt2-d">Four approaches judged on whether they hold a parked unit still and whether they preserve slow real movement. A displacement threshold holds the parked unit still only if set above the jitter, at which point it also suppresses the creeping unit entirely. A moving average holds the parked unit reasonably still and lags real movement by half the window, which at walking pace is tens of metres. A Kalman filter with a constant-velocity model holds the parked unit still and tracks the moving one with little lag, at the cost of tuning and of overshooting on a genuine sudden stop. Direction-consistency gating passes a fix only when recent displacements agree in bearing, holding the parked unit still and passing the creeping one immediately. The last is the cheapest and matches the distinction the data actually contains.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">judged on both traces, not one</text>
  <text x="470" y="76" font-size="10" font-weight="700" fill="var(--muted)">parked held still?</text>
  <text x="680" y="76" font-size="10" font-weight="700" fill="var(--muted)">slow movement kept?</text>
  <rect x="40" y="88" width="800" height="56" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="112" font-size="10.5" font-weight="700" fill="currentColor">displacement threshold</text>
  <text x="60" y="132" font-size="10" fill="currentColor">one number, no state</text>
  <text x="470" y="120" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">only if set high</text>
  <text x="680" y="120" font-size="10.5" font-weight="700" fill="var(--ember-text)">no — suppressed</text>
  <rect x="40" y="152" width="800" height="56" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
  <text x="60" y="176" font-size="10.5" font-weight="700" fill="currentColor">moving average</text>
  <text x="60" y="196" font-size="10" fill="currentColor">simple, stateful</text>
  <text x="470" y="184" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">mostly</text>
  <text x="680" y="184" font-size="10.5" font-weight="700" fill="var(--ember-text)">lags by half the window</text>
  <rect x="40" y="216" width="800" height="56" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="240" font-size="10.5" font-weight="700" fill="currentColor">Kalman, constant velocity</text>
  <text x="60" y="260" font-size="10" fill="currentColor">needs tuning; overshoots a sudden stop</text>
  <text x="470" y="248" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">yes</text>
  <text x="680" y="248" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">yes, little lag</text>
  <rect x="40" y="280" width="800" height="56" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.7"/>
  <text x="60" y="304" font-size="10.5" font-weight="700" fill="var(--cream)">direction-consistency gate</text>
  <text x="60" y="324" font-size="10" fill="var(--cream)">cheapest, and matches the distinction in the data</text>
  <text x="470" y="312" font-size="10.5" font-weight="700" fill="var(--cream)">yes</text>
  <text x="680" y="312" font-size="10.5" font-weight="700" fill="var(--cream)">yes, immediately</text>
</svg>

The direction gate wins on both traces and is also the cheapest to implement and explain, which matters more here than it usually does — an operations chief who does not understand why a marker is where it is will stop trusting the marker.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="jt3-t jt3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="jt3-t">What smoothing must never be allowed to hide</title>
  <desc id="jt3-d">Three events a smoother can suppress if it is applied without exceptions. A sudden stop, where a unit travelling at speed halts within one reporting interval, is exactly what a constant-velocity model overshoots, and it can be the signature of a collision. A reversal, where a unit turns back along its own track, is indistinguishable from jitter to a direction-consistency gate unless the displacement is large. A first movement after a long stationary period is suppressed by any filter with a warm-up window, delaying the picture at the moment a unit is committed. The remedy is that any status change, any displacement above a hard ceiling, and any first movement after a heartbeat-only period bypass smoothing entirely and are published raw.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">three things that must bypass the smoother entirely</text>
  <rect x="40" y="76" width="800" height="66" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="100" font-size="11" font-weight="700" fill="var(--ember-text)">a sudden stop</text>
  <text x="60" y="122" font-size="10" fill="currentColor">a constant-velocity model overshoots it by design — and a stop at speed can be a collision signature</text>
  <rect x="40" y="154" width="800" height="66" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="178" font-size="11" font-weight="700" fill="var(--ember-text)">a reversal along the same track</text>
  <text x="60" y="200" font-size="10" fill="currentColor">indistinguishable from jitter to a direction gate unless the displacement is large</text>
  <rect x="40" y="232" width="800" height="66" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="256" font-size="11" font-weight="700" fill="var(--ember-text)">the first movement after a long stop</text>
  <text x="60" y="278" font-size="10" fill="currentColor">any filter with a warm-up window delays it — at the moment the unit is being committed</text>
  <text x="8" y="326" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Status changes, displacement above a hard ceiling, and first movement after heartbeat-only: publish raw.</text>
</svg>

Tier three is the part that has to be built in from the start rather than added after an incident. Every smoother suppresses the events that most need to be seen, because those events look exactly like the noise it was built to remove.

## Production Python Implementation

```python
from __future__ import annotations

import logging
import math
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta

logger = logging.getLogger("incidentgis.avl_smoothing")

BEARING_TOLERANCE_DEG = 45.0
WINDOW = 3
HARD_CEILING_M = 60.0           # above this, always publish — it is an event
HEARTBEAT_GAP = timedelta(minutes=2)


@dataclass(frozen=True)
class Fix:
    x: float                    # projected CRS metres
    y: float
    status: str
    at: datetime


def _bearing(a: Fix, b: Fix) -> float:
    return math.degrees(math.atan2(b.y - a.y, b.x - a.x)) % 360.0


def _agree(bearings: list[float], tolerance: float) -> bool:
    """Do these bearings point the same way, allowing for wraparound?"""
    if len(bearings) < 2:
        return False
    ref = bearings[0]
    return all(
        min(abs(b - ref), 360.0 - abs(b - ref)) <= tolerance for b in bearings[1:]
    )


class DirectionGate:
    """Publish a fix when recent movement agrees in direction.

    Distinguishes jitter from slow real movement by consistency of bearing,
    which is the property that actually differs between them — displacement
    magnitude is identical in both cases.
    """

    def __init__(self) -> None:
        self._recent: deque[Fix] = deque(maxlen=WINDOW + 1)
        self._published: Fix | None = None

    def offer(self, fix: Fix) -> tuple[Fix, str]:
        """Return the fix to display and why it was chosen."""
        prev = self._published
        self._recent.append(fix)

        # Events always bypass the gate: a smoother that hides a sudden stop
        # is hiding the thing most worth seeing.
        if prev is not None and fix.status != prev.status:
            return self._publish(fix, "status_change")
        if prev is not None and math.dist((prev.x, prev.y), (fix.x, fix.y)) >= HARD_CEILING_M:
            return self._publish(fix, "above_ceiling")
        if prev is not None and fix.at - prev.at >= HEARTBEAT_GAP:
            # First movement after a heartbeat-only period, or a reappearance
            # after a coverage gap — never smooth across either.
            return self._publish(fix, "after_gap")
        if prev is None:
            return self._publish(fix, "first_fix")

        if len(self._recent) < WINDOW:
            return prev, "held_warmup"

        pts = list(self._recent)
        bearings = [_bearing(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        if _agree(bearings, BEARING_TOLERANCE_DEG):
            return self._publish(fix, "direction_consistent")

        logger.debug("avl_fix_held", extra={"reason": "jitter"})
        return prev, "held_jitter"

    def _publish(self, fix: Fix, reason: str) -> tuple[Fix, str]:
        self._published = fix
        logger.info("avl_fix_published", extra={"reason": reason})
        return fix, reason
```

## Validation Checklist

- [ ] The gate keys on bearing agreement, not on displacement magnitude alone.
- [ ] The raw track is retained alongside the displayed one.
- [ ] Status changes, displacements above the hard ceiling, and post-gap fixes bypass the gate.
- [ ] The publish reason travels with the position so consumers can tell held from fresh.
- [ ] No smoothing is applied across a known coverage gap.
- [ ] A fixture of a parked unit asserts the displayed position does not move.
- [ ] A fixture of a unit creeping at walking pace asserts it is not held.
- [ ] A routing consumer refuses to treat a held position as a surveyed one.

## Edge Cases and Gotchas

- **A unit reversing along its own track.** Bearings disagree by 180 degrees, so the gate reads it as jitter. The hard ceiling is what catches it, which is why the ceiling must be below a plausible reversal distance.
- **Smoothing in a geographic CRS.** Bearings and distances computed in degrees are meaningless. Work in the incident's projected system, as everything metric on this site does.
- **A stationary unit on a moving platform.** A crew on a boat or a unit on a transporter is genuinely moving while doing nothing, and the gate will pass it correctly — the display should distinguish moved-under-power from carried, if the feed can.
- **Warm-up after every hold.** A naive implementation resets its window on each held fix and never accumulates enough agreement to publish. Keep the window over offered fixes, not published ones.
- **Consumers that average again downstream.** A second smoothing pass in the display layer compounds the lag and is usually invisible in code review. Publish the reason and have consumers assert they are not re-filtering.

## Frequently Asked Questions

**Why does a displacement threshold not work for AVL smoothing?** Because a parked unit and a slowly moving one produce the same per-fix displacement. A parked engine's fixes scatter by ten to fifteen metres between reports through multipath, and an engine creeping along a fire line at walking pace also advances ten to fifteen metres between reports. Set the threshold below that and the parked unit wanders; set it above and the creeping unit shows as stationary for minutes at a time. The property that actually differs is direction: jitter reverses, so successive displacements undo each other, while real movement advances with consistent bearings.

**What must never be smoothed?** Three things, because a smoother suppresses exactly the events that most need to be seen. A sudden stop is what a constant-velocity model overshoots by design, and a halt at speed can be a collision signature. A reversal along the unit's own track looks like jitter to a direction gate unless the displacement is large, which is what the hard ceiling is for. And the first movement after a long stationary period is delayed by any filter with a warm-up window, at precisely the moment a unit is being committed. Status changes, displacements above a ceiling, and post-gap fixes should all publish raw.

**Should the smoothed position replace the raw one?** No — the smoothed track is a display artefact and the raw track is the record. After-action review needs what the receiver actually reported, multipath analysis needs the scatter that smoothing removes, and any consumer computing whether a unit was inside a hazard perimeter should use raw positions with their stated accuracy rather than a filtered estimate. Publishing the reason a position was held or released alongside it lets a routing layer refuse to treat a held fix as surveyed, which is the specific misuse worth preventing.

## Related

- [AVL & Resource Tracking Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/avl-and-resource-tracking-feeds/) — the reporting policy and heartbeat this filter sits behind.
- [Handling GPS Drift in Urban Canyon Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/handling-gps-drift-in-urban-canyon-environments/) — why the scatter has a direction, and why averaging entrenches it.
- [Reconciling Unit Identifiers Across Agency CAD Systems](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/avl-and-resource-tracking-feeds/reconciling-unit-identifiers-across-agency-cad-systems/) — making sure the track being smoothed belongs to one vehicle.
- [Evacuation Routing & Road Network Analysis](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/) — the consumer that must not treat a held position as surveyed.

Up: [AVL & Resource Tracking Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/avl-and-resource-tracking-feeds/)
