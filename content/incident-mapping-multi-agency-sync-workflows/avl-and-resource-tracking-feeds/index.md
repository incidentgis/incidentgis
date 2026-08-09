---
title: "AVL & Resource Tracking Feeds"
description: "Most AVL questions do not need a precise position, and interval reporting spends its budget on parked units. Movement-triggered feeds, heartbeats, and telling a stationary engine from a dead radio."
slug: avl-and-resource-tracking-feeds
type: guide
breadcrumb: "AVL & Resource Tracking"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "AVL & Resource Tracking Feeds",
      "description": "Most AVL questions do not need a precise position, and interval reporting spends its budget on parked units. Movement-triggered feeds, heartbeats, and telling a stationary engine from a dead radio.",
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
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Design an AVL feed the operating picture can actually use",
      "description": "Report on movement rather than on an interval, keep a heartbeat so quiet units stay distinguishable from failed ones, classify silence against known coverage gaps, and show a projected position with growing uncertainty instead of a stale point.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Decide what the picture is asking",
          "text": "Establish which questions the feed serves, since availability and rough location dominate usage and only hazard-perimeter containment needs a precise fix — designing for the rarest question makes the feed expensive and no more useful."
        },
        {
          "@type": "HowToStep",
          "name": "Report on movement, not on an interval",
          "text": "Transmit when a unit has moved past a threshold or changed status, so message volume follows information instead of being spent on parked units repeating themselves."
        },
        {
          "@type": "HowToStep",
          "name": "Keep a heartbeat",
          "text": "Send a low-rate heartbeat from stationary units so that silence becomes meaningful, because without one a healthy parked engine and a failed radio look identical."
        },
        {
          "@type": "HowToStep",
          "name": "Classify silence against coverage gaps",
          "text": "Distinguish stationary, in a known dead zone, and unexplained silence, and escalate only the third, so dead-zone alerts do not become noise that gets muted."
        },
        {
          "@type": "HowToStep",
          "name": "Show projection, not a stale point",
          "text": "Render a unit in a coverage gap as a growing uncertainty region derived from its last heading and speed, so the display degrades honestly rather than asserting a position the system no longer knows."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Does an AVL feed need high positional accuracy?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Rarely. Of the four questions the operating picture asks of a vehicle position, the most common — is this unit committed or available — is answered by the status field and needs no position at all, and which division it is working in is answered by any fix. Reaching an address in a given time needs roughly 100 metres and the road segment, because which side of a median a unit is on decides the answer. Only containment inside a hazard perimeter needs about 20 metres, and it is the least frequently asked. An architecture optimised for the rarest question tends to be expensive without being more useful."
          }
        },
        {
          "@type": "Question",
          "name": "Why report on movement instead of on a fixed interval?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because interval reporting spends its budget on units that are not doing anything. A 240-unit fleet reporting every five seconds produces about 2.07 million messages over a twelve-hour period, most of them parked units repeating the same position, and has nothing left when thirty units start moving at once. Reporting when a unit has moved more than about 25 metres or changed status produces roughly 210,000 messages concentrated on units that are actually moving, and adding a two-minute heartbeat brings it to about 245,000 — more useful information than the five-second policy at an eighth of the volume."
          }
        },
        {
          "@type": "Question",
          "name": "How should a display handle a unit that has stopped reporting?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "By distinguishing three states rather than showing a marker at the last known position. A stationary healthy unit is confirmed by its heartbeat and can be drawn solid. A unit inside a known radio coverage gap should be drawn as a projected region derived from its last heading and speed, growing until it covers the gap, which is an honest statement of what is known. A unit silent outside any known gap past an escalation threshold is a safety event and should be flagged and escalated. Rendering all three identically means a supervisor cannot tell a parked engine from one whose radio died on the fire side of a ridge."
          }
        }
      ]
    }
  ]
}
</script>

# AVL & Resource Tracking Feeds

A division supervisor looks at the operating picture and sees eleven engines on the north flank. Nine are reporting normally, one is parked at a water point, and one stopped reporting twenty-two minutes ago on the far side of a ridge. All eleven render as identical markers, because the display shows every unit at its last known position and nothing distinguishes a unit that is stationary from one that has stopped speaking.

## Problem Framing

Automatic Vehicle Location (AVL) feeds look like the simplest layer in an incident system — a position, a unit identifier, a timestamp — and they carry more design decisions per byte than anything else on this site. The reason is that a position is not what the operating picture is actually asking for.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="av1-t av1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="av1-t">What an AVL position is actually asked to answer</title>
  <desc id="av1-d">Four questions the common operating picture asks of a vehicle position, with the accuracy each needs. Is this unit committed or available needs no position at all, only a status; it is answered by the record, not the fix. Which division is it working in needs about 500 metres and is answered by any fix. Can it reach this address in under eight minutes needs about 100 metres and the road segment, because the answer depends on which side of a median the unit is on. Is it inside the hazard perimeter needs about 20 metres and is the only question where a jittering position produces a materially wrong answer. Designing the feed for the fourth question when the first three dominate usage is how AVL pipelines end up expensive and no more useful.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">most AVL questions do not need a precise position</text>
  <text x="600" y="76" font-size="10" font-weight="700" fill="var(--muted)">accuracy needed</text>
  <rect x="40" y="88" width="800" height="60" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
  <text x="60" y="112" font-size="10.5" font-weight="700" fill="currentColor">is this unit committed or available?</text>
  <text x="60" y="132" font-size="10" fill="currentColor">answered by the status field — the position is irrelevant</text>
  <text x="640" y="122" font-size="11" font-weight="700" fill="var(--crimson-deep)">none</text>
  <rect x="40" y="160" width="800" height="60" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
  <text x="60" y="184" font-size="10.5" font-weight="700" fill="currentColor">which division is it working in?</text>
  <text x="60" y="204" font-size="10" fill="currentColor">any fix answers this, including a bad one</text>
  <text x="640" y="194" font-size="11" font-weight="700" fill="var(--crimson-deep)">~500 m</text>
  <rect x="40" y="232" width="800" height="60" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="256" font-size="10.5" font-weight="700" fill="currentColor">can it reach this address in under eight minutes?</text>
  <text x="60" y="276" font-size="10" fill="currentColor">needs the road segment — which side of the median decides the answer</text>
  <text x="640" y="266" font-size="11" font-weight="700" fill="var(--crimson-deep)">~100 m</text>
  <rect x="40" y="304" width="800" height="60" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.7"/>
  <text x="60" y="328" font-size="10.5" font-weight="700" fill="var(--cream)">is it inside the hazard perimeter?</text>
  <text x="60" y="348" font-size="10" fill="var(--cream)">the only question where jitter produces a materially wrong answer</text>
  <text x="640" y="338" font-size="11" font-weight="700" fill="var(--cream)">~20 m</text>
</svg>

Only one of those four questions needs a precise position, and it is the least frequently asked. Most AVL usage is answered by the *status* field and a coarse location, which is why an architecture optimised for positional accuracy tends to be expensive and no more useful. What the picture needs, in descending order of frequency, is: is this unit available, roughly where is it, can it get somewhere, and only occasionally, is it inside a hazard.

The second problem is that AVL is the highest-volume feed in the response, and almost all of that volume carries no information.

## Prerequisites

- **A settled unit identifier scheme** across every participating agency, or a reconciliation layer that produces one. Two agencies both running an "Engine 11" is the normal case, not an edge case.
- **A message transport with per-message priority**, as covered in [WebSocket and MQTT for live incident feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — an AVL flood must not delay a status change.
- **Known radio coverage geometry** for the incident area, even approximate. Without it, a silent unit and a unit in a dead zone are indistinguishable, and the display has to treat both as failures.
- **A CRS and axis-order contract** per the [coordinate reference system standard](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/). AVL vendors are a common source of latitude-first payloads.

## Reporting Policy

<svg viewBox="0 0 880 380" role="img" aria-labelledby="av2-t av2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="av2-t">Message volume from one AVL fleet, by reporting policy</title>
  <desc id="av2-d">A 240-unit fleet reporting for a twelve-hour operational period. A fixed five-second interval produces about 2.07 million messages, most of them from parked units repeating the same position. A fixed thirty-second interval produces about 345,000 but loses the resolution needed to tell which side of a junction a moving unit took. Reporting on movement — a fix only when the unit has moved more than 25 metres or changed status — produces about 210,000, concentrated entirely on units that are actually moving. Adding a heartbeat every two minutes for stationary units brings it to about 245,000 and restores the ability to distinguish a parked unit from a dead radio. The last policy carries more useful information than the first at an eighth of the volume.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">240 units, one 12-hour operational period</text>
  <rect x="300" y="88" width="520" height="34" rx="5" fill="var(--ember)" opacity="0.5" stroke="var(--ember)" stroke-width="1.4"/>
  <rect x="300" y="146" width="87" height="34" rx="5" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="204" width="53" height="34" rx="5" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="300" y="262" width="62" height="34" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.4"/>
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="110">every 5 s, fixed</text>
    <text x="8" y="168">every 30 s, fixed</text>
    <text x="8" y="226">on movement &gt; 25 m</text>
    <text x="8" y="284">movement + 2 min heartbeat</text>
  </g>
  <g font-size="10.5" font-weight="700" fill="var(--crimson-deep)">
    <text x="640" y="110" fill="currentColor">2 070 000</text>
    <text x="397" y="168">345 000</text><text x="363" y="226">210 000</text><text x="372" y="284">245 000</text>
  </g>
  <text x="640" y="128" font-size="9.5" fill="var(--ember-text)">mostly parked units repeating themselves</text>
  <text x="397" y="186" font-size="9.5" fill="var(--muted)">loses which side of a junction a unit took</text>
  <text x="363" y="244" font-size="9.5" fill="var(--muted)">cannot distinguish parked from dead radio</text>
  <text x="372" y="302" font-size="9.5" font-weight="700" fill="var(--crimson-deep)">more useful information than the first, at an eighth of the volume</text>
  <text x="8" y="352" font-size="10.5" fill="currentColor">Interval-based reporting spends its budget on the units that are not doing anything.</text>
</svg>

The volume difference is not primarily a bandwidth argument, though on a saturated incident link it is that too. It is that interval-based reporting spends its entire budget on units that are not doing anything, and then has nothing left when thirty units start moving at once — which is exactly the moment the picture matters.

Movement-triggered reporting inverts that. A parked engine costs one message every two minutes; an engine driving a division boundary costs a message every 25 metres. The volume follows the information, and the heartbeat is what preserves the ability to say that a quiet unit is quiet on purpose.

## Distinguishing Silence

<svg viewBox="0 0 880 340" role="img" aria-labelledby="av3-t av3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="av3-t">Three states a unit can be in, and how a feed distinguishes them</title>
  <desc id="av3-d">A unit that has not reported recently is in one of three states and the common operating picture must not conflate them. It may be stationary and healthy, which a heartbeat confirms. It may be moving through a radio dead zone, which is inferred from its last heading and speed plus the known coverage gap, and should be shown as a projected position with growing uncertainty rather than as a stale point. Or its radio may have failed, which is what remains when a heartbeat is missed outside any known coverage gap. Showing all three as a marker at the last known position, which is the default behaviour of most displays, means a supervisor cannot tell a parked engine from one that has stopped reporting.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">a unit that has not reported is in one of three states — never show them the same way</text>
  <rect x="40" y="76" width="256" height="170" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="312" y="76" width="256" height="170" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="584" y="76" width="256" height="170" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="104" font-size="11" font-weight="700" fill="var(--crimson-deep)">stationary, healthy</text>
  <text x="332" y="104" font-size="11" font-weight="700" fill="var(--crimson-deep)">moving, in a dead zone</text>
  <text x="604" y="104" font-size="11" font-weight="700" fill="var(--ember-text)">radio failed</text>
  <text x="60" y="132" font-size="10" fill="currentColor">confirmed by heartbeat</text>
  <text x="332" y="132" font-size="10" fill="currentColor">inferred from last heading,</text>
  <text x="332" y="150" font-size="10" fill="currentColor">speed and known coverage gap</text>
  <text x="604" y="132" font-size="10" fill="currentColor">heartbeat missed outside</text>
  <text x="604" y="150" font-size="10" fill="currentColor">any known gap</text>
  <text x="60" y="180" font-size="10" font-weight="700" fill="var(--crimson-deep)">show: solid marker</text>
  <text x="332" y="180" font-size="10" font-weight="700" fill="var(--crimson-deep)">show: projected position</text>
  <text x="332" y="198" font-size="10" fill="currentColor">with a growing uncertainty ring</text>
  <text x="604" y="180" font-size="10" font-weight="700" fill="var(--ember-text)">show: last known, flagged</text>
  <text x="604" y="198" font-size="10" fill="currentColor">and escalate — this is a safety event</text>
  <text x="60" y="228" font-size="10" fill="var(--muted)">age is short and expected</text>
  <text x="332" y="228" font-size="10" fill="var(--muted)">age is expected to grow</text>
  <text x="604" y="228" font-size="10" fill="var(--muted)">age is unexplained</text>
  <text x="8" y="292" font-size="10.5" fill="currentColor">Most displays render all three as a marker at the last known position, so a supervisor cannot tell a parked</text>
  <text x="8" y="312" font-size="10.5" fill="currentColor">engine from one whose radio died twenty minutes ago on the fire side of a ridge.</text>
</svg>

The three states in that figure are the whole reason a heartbeat exists. Without one, "no message for four minutes" is ambiguous between healthy and failed, and a display that resolves the ambiguity by showing the last known position resolves it in the most dangerous direction — a unit whose radio died on the fire side of a ridge appears identical to one at a water point.

A projected position for the dead-zone case is worth the implementation cost. A unit that entered a known gap at 40 km/h on a known heading has a small and computable set of places it can be, and showing that as an expanding uncertainty ring is far more useful to a supervisor than a stale point. Crucially it also degrades honestly: the ring grows until it covers the whole gap, at which point the display is saying "somewhere in here", which is true.

## Step-by-Step Implementation

```python
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry

logger = logging.getLogger("incidentgis.avl")

MOVEMENT_THRESHOLD_M = 25.0
HEARTBEAT_INTERVAL = timedelta(minutes=2)
# How long past a missed heartbeat before a unit is treated as a safety event.
SILENCE_ESCALATION = timedelta(minutes=5)


class UnitState(str, Enum):
    REPORTING = "reporting"
    STATIONARY = "stationary"
    PROJECTED = "projected"       # in a known coverage gap
    SILENT = "silent"             # unexplained — escalate


@dataclass(frozen=True)
class AvlFix:
    unit_id: str
    position: Point               # in the incident's projected CRS
    heading_deg: float
    speed_mps: float
    status: str
    reported_at: datetime


def should_transmit(previous: AvlFix | None, current: AvlFix) -> bool:
    """Movement-triggered reporting with a heartbeat.

    Volume follows information: a parked unit costs one message per heartbeat
    interval, a moving one costs a message per threshold of travel.
    """
    if previous is None:
        return True
    if current.status != previous.status:
        return True                      # status changes are never suppressed
    if current.position.distance(previous.position) >= MOVEMENT_THRESHOLD_M:
        return True
    return current.reported_at - previous.reported_at >= HEARTBEAT_INTERVAL


def classify_silence(
    last: AvlFix,
    now: datetime,
    coverage_gaps: BaseGeometry,
) -> tuple[UnitState, BaseGeometry | None]:
    """Decide what a unit's silence means, and what to draw.

    Returns the state and, for a projected unit, the region it could be in.
    Never returns a bare last-known point for a unit that should be escalated.
    """
    age = now - last.reported_at
    if age < HEARTBEAT_INTERVAL * 1.5:
        return (UnitState.STATIONARY if last.speed_mps < 1.0
                else UnitState.REPORTING), None

    in_gap = coverage_gaps.contains(last.position) or coverage_gaps.distance(
        last.position
    ) < last.speed_mps * age.total_seconds()

    if in_gap:
        # The unit can only be somewhere within its travel radius, intersected
        # with the gap. The ring grows honestly until it covers the whole gap.
        reach_m = max(last.speed_mps, 1.0) * age.total_seconds()
        possible = last.position.buffer(reach_m).intersection(coverage_gaps)
        logger.info("avl_unit_projected", extra={
            "unit_id": last.unit_id, "age_s": int(age.total_seconds()),
            "reach_m": round(reach_m),
        })
        return UnitState.PROJECTED, possible

    if age >= SILENCE_ESCALATION:
        # Not in a known gap and past the escalation threshold: this is a
        # safety event, not a display quirk.
        logger.warning("avl_unit_silent", extra={
            "unit_id": last.unit_id, "age_s": int(age.total_seconds()),
            "last_status": last.status,
        })
        return UnitState.SILENT, None

    return UnitState.STATIONARY, None
```

## Configuration Reference

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Movement threshold | `AVL_MOVEMENT_M` | `25` | Below the width of most road corridors, so a lane change does not report. |
| Heartbeat interval | `AVL_HEARTBEAT_S` | `120` | The upper bound on how long a healthy quiet unit looks unexplained. |
| Silence escalation | `AVL_SILENCE_S` | `300` | Past this, outside a known gap, it is a safety event. |
| Coverage gap layer | `AVL_COVERAGE_GAPS` | _unset_ | Without it every dead-zone unit escalates and the alert becomes noise. |
| Status priority topic | `AVL_STATUS_TOPIC` | `unit/+/status` | Status changes ride a separate topic so an AVL flood cannot delay them. |
| Position CRS | `AVL_CRS` | incident UTM | Distances are metric; a geographic CRS makes the threshold meaningless. |
| Max projected radius | `AVL_MAX_PROJECT_M` | `3000` | Beyond this the projection says nothing useful; fall back to escalation. |

## Verification and Smoke Test

```python
# A parked unit must produce heartbeats and nothing else.
assert sum(should_transmit(prev, fix) for prev, fix in parked_sequence) == expected_heartbeats

# A unit crossing a known dead zone must be PROJECTED, never SILENT.
state, region = classify_silence(last_fix, now, coverage_gaps)
assert state is UnitState.PROJECTED and region is not None

# A unit silent in good coverage must escalate.
state, _ = classify_silence(open_air_fix, now, coverage_gaps)
assert state is UnitState.SILENT
```

## Integration With Adjacent Workflows

Unit positions feed the [evacuation routing layer](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/) when computing which units can reach an address, and a projected position must be marked so the router does not treat it as surveyed. Status changes are validated by the same [attribute validation rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) as any other record, and AVL positions are subject to the same null-island and bounds checks — vendors are a common source of out-of-area fixes.

One organisational note that outlasts any of the parameters above. The reporting policy is a negotiation with the agencies whose vehicles are being tracked, not purely an engineering choice — a movement threshold that is comfortable for a fire district may be unacceptably coarse to a law-enforcement partner whose units are tracked for officer safety rather than for resource allocation. Agree the policy per agency, record it alongside the feed configuration, and expect it to differ across the participating organisations rather than trying to impose one number on all of them. A feed whose behaviour is documented and different is far easier to reason about during an incident than one that is uniform and quietly wrong for half its contributors.

## Troubleshooting

**Symptom: the message rate collapses when the incident gets busy.** Movement-triggered reporting is working as designed and the transport is saturating. Shed by widening the movement threshold for available units, never for committed ones.

**Symptom: every unit in a canyon escalates as silent.** The coverage gap layer is missing or too coarse. Without it, dead zones are indistinguishable from failures and the alert becomes noise that gets muted.

**Symptom: units jump between two positions while parked.** Multipath at a fixed location, covered in [handling GPS drift in urban canyons](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/handling-gps-drift-in-urban-canyon-environments/). Raising the movement threshold hides it; fixing it means detecting the directional bias.

**Symptom: two agencies' units overwrite each other.** Unit identifiers collide across agencies. The identifier must be scoped by agency before it reaches the picture.

**Symptom: positions are in the ocean.** Latitude-first payload from the AVL vendor. Assert bounds at ingest rather than trusting the feed.

## Frequently Asked Questions

**Does an AVL feed need high positional accuracy?** Rarely. Of the four questions the operating picture asks of a vehicle position, the most common — is this unit committed or available — is answered by the status field and needs no position at all, and which division it is working in is answered by any fix. Reaching an address in a given time needs roughly 100 metres and the road segment, because which side of a median a unit is on decides the answer. Only containment inside a hazard perimeter needs about 20 metres, and it is the least frequently asked. An architecture optimised for the rarest question tends to be expensive without being more useful.

**Why report on movement instead of on a fixed interval?** Because interval reporting spends its budget on units that are not doing anything. A 240-unit fleet reporting every five seconds produces about 2.07 million messages over a twelve-hour period, most of them parked units repeating the same position, and has nothing left when thirty units start moving at once. Reporting when a unit has moved more than about 25 metres or changed status produces roughly 210,000 messages concentrated on units that are actually moving, and adding a two-minute heartbeat brings it to about 245,000 — more useful information than the five-second policy at an eighth of the volume.

**How should a display handle a unit that has stopped reporting?** By distinguishing three states rather than showing a marker at the last known position. A stationary healthy unit is confirmed by its heartbeat and can be drawn solid. A unit inside a known radio coverage gap should be drawn as a projected region derived from its last heading and speed, growing until it covers the gap, which is an honest statement of what is known. A unit silent outside any known gap past an escalation threshold is a safety event and should be flagged and escalated. Rendering all three identically means a supervisor cannot tell a parked engine from one whose radio died on the fire side of a ridge.

## Related

- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — the transport an AVL flood must not be allowed to saturate.
- [Evacuation Routing & Road Network Analysis](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/) — where unit positions are consumed, and why a projected position must be marked as such.
- [Handling GPS Drift in Urban Canyon Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/handling-gps-drift-in-urban-canyon-environments/) — why a parked unit appears to move, and why raising the threshold only hides it.
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — the bounds and null-island checks an AVL vendor's payload must still pass.

Up: [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/)
