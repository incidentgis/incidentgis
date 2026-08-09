---
title: "Public Alerting & CAP Message Pipelines"
description: "The alert area a responder authors is not the area that gets delivered. Building valid CAP 1.2 messages from incident polygons, estimating channel overshoot before release, and why references and expires carry the risk."
slug: public-alerting-and-cap-message-pipelines
type: guide
breadcrumb: "Public Alerting & CAP"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Public Alerting & CAP Message Pipelines",
      "description": "The alert area a responder authors is not the area that gets delivered. Building valid CAP 1.2 messages from incident polygons, estimating channel overshoot before release, and why references and expires carry the risk.",
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
          "name": "Public Alerting & CAP Message Pipelines",
          "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/public-alerting-and-cap-message-pipelines/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Build and validate a CAP alert from an incident polygon",
      "description": "Derive the alert area from the reconciled incident perimeter, emit CAP 1.2 with correct references and a conservative expiry, estimate what each delivery channel will actually reach, and pass schema, profile, geometry and human validation before release.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Take the area from the reconciled perimeter",
          "text": "Derive the alert polygon from the perimeter the conflict resolver published, so the alert inherits a known provenance and audit trail rather than being drawn afresh."
        },
        {
          "@type": "HowToStep",
          "name": "Estimate the delivered area per channel",
          "text": "Compute the cell-sector union and the geographic-code coverage the polygon will produce, because each channel reshapes the area and the authoring tool shows only the authored one."
        },
        {
          "@type": "HowToStep",
          "name": "Emit CAP with references and a bounded expiry",
          "text": "Set msgType and list the exact prior identifiers an update supersedes, and set a conservative expires that is re-issued while the hazard persists rather than relying on a cancel arriving."
        },
        {
          "@type": "HowToStep",
          "name": "Keep the polygon inside the vertex budget",
          "text": "Simplify deliberately in a projected system when over budget, since a gateway that exceeds its limit simplifies the shape itself and the result is not the one you chose."
        },
        {
          "@type": "HowToStep",
          "name": "Pass all four validation gates",
          "text": "Validate against the CAP schema, then the receiving authority's profile, then the geometry including a latitude-first round trip, and finally a named human who confirms the message says what was intended."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why is the delivered alert area larger than the polygon we drew?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because each channel reshapes it. The CAP message itself carries the polygon verbatim, but a Wireless Emergency Alert is delivered by cell broadcast, so the effective area becomes the union of every cell sector intersecting the polygon and extends wherever a sector reaches beyond the boundary. An Emergency Alert System broadcast is delivered by geographic code, so it covers entire counties or subdivisions containing any part of the polygon. The three areas are nested and progressively coarser, and sizing a polygon tightly to limit over-alerting does not limit what the coarser channels deliver — which is why the estimated delivered area should be shown to the approver before release."
          }
        },
        {
          "@type": "Question",
          "name": "What makes a CAP update behave as an update rather than a new alert?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The references element. A message with msgType set to Update but no references is, to most consumers, simply a second independent alert, so a device that received both displays two evacuation orders with different boundaries and no way to tell which supersedes the other — worse than not having updated at all. References must list the exact prior identifiers, space separated, and those identifiers must be ones that were actually sent. The related discipline is expires: devices lose messages, so a cancel that never arrives leaves an alert live indefinitely, and a short expiry that is re-issued while the hazard persists is safer than a long one plus a cancel you are trusting to arrive."
          }
        },
        {
          "@type": "Question",
          "name": "What is the highest-consequence technical defect in a CAP pipeline?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Transposed coordinates. CAP polygons are written latitude first, which is the opposite of GeoJSON's longitude-first ordering, so a pipeline that emits its internal representation directly produces a syntactically valid alert describing somewhere else entirely. It passes schema validation, passes profile validation, and is delivered. The defence is to parse the emitted polygon back and assert it equals the authored geometry, rather than checking it visually in an authoring tool that may use the same wrong convention on the way back in."
          }
        }
      ]
    }
  ]
}
</script>

# Public Alerting & CAP Message Pipelines

An evacuation order is issued for a 4-square-kilometre polygon on the north edge of a fire. The Common Alerting Protocol (CAP) message carries the polygon exactly. The Wireless Emergency Alert derived from it reaches every handset attached to a cell sector that touches the polygon, which includes a sector whose tower serves a town 11 kilometres away. Two thousand people evacuate who were never in danger, and the roads they use are the ones the evacuation needed.

## Problem Framing

Public alerting is the one workflow on this site whose output is read by the public rather than by responders, and that changes the failure modes completely. A defect in the [common operating picture](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/) is seen by trained people who can question it; a defect in an alert is acted on immediately by tens of thousands of people who cannot. Over-alerting has a measurable cost in road capacity and in future compliance, and under-alerting has an obvious one.

The specific difficulty is that the alert area a responder authors is not the area that gets delivered. Every channel reshapes it, in a direction the author cannot see from the authoring tool.

<svg viewBox="0 0 880 400" role="img" aria-labelledby="cap1-t cap1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cap1-t">One incident polygon becoming three differently-shaped alert areas</title>
  <desc id="cap1-d">A single evacuation polygon is delivered through three channels, each of which reshapes it. The Common Alerting Protocol message itself carries the polygon verbatim, up to a practical vertex limit imposed by message size. A Wireless Emergency Alert is delivered by cell broadcast, so the area becomes the union of the cell sectors that intersect the polygon, which extends past it wherever a sector reaches beyond the boundary. An Emergency Alert System broadcast is delivered by geographic code, so the area becomes whole counties or FIPS subdivisions containing any part of the polygon. The three areas are nested and progressively coarser, and a resident's experience depends entirely on which channel reached them — which is why the same alert must state its intended area, not only its delivered one.</desc>
  <rect x="0" y="0" width="880" height="400" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one polygon, three delivery geometries</text>
  <path d="M120 120 H420 V320 H120 Z" fill="var(--petal-soft)" opacity="0.6" stroke="var(--line-strong)" stroke-width="1.6"/>
  <text x="128" y="112" font-size="10" font-weight="700" fill="var(--muted)">county boundary — EAS</text>
  <path d="M180 160 Q250 140 310 170 Q350 210 320 260 Q260 290 200 270 Q160 220 180 160 Z" fill="var(--petal)" opacity="0.8" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="196" y="150" font-size="10" font-weight="700" fill="var(--crimson-deep)">cell sectors — WEA</text>
  <path d="M210 190 Q260 176 292 200 Q306 232 284 250 Q244 262 216 244 Q200 214 210 190 Z" fill="var(--crimson)" opacity="0.55" stroke="var(--crimson-deep)" stroke-width="2"/>
  <text x="224" y="300" font-size="10" font-weight="700" fill="var(--crimson-deep)">the polygon — CAP</text>
  <rect x="470" y="110" width="370" height="52" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.6"/>
  <text x="490" y="132" font-size="10.5" font-weight="700" fill="var(--cream)">CAP polygon · as authored</text>
  <text x="490" y="150" font-size="10" fill="var(--cream)">verbatim, subject to a vertex budget</text>
  <rect x="470" y="174" width="370" height="52" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="490" y="196" font-size="10.5" font-weight="700" fill="currentColor">WEA · union of intersecting cell sectors</text>
  <text x="490" y="214" font-size="10" fill="currentColor">reaches past the boundary wherever a sector does</text>
  <rect x="470" y="238" width="370" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.5"/>
  <text x="490" y="260" font-size="10.5" font-weight="700" fill="currentColor">EAS · whole geographic codes</text>
  <text x="490" y="278" font-size="10" fill="currentColor">any county touching the polygon, entire</text>
  <text x="470" y="326" font-size="10.5" fill="currentColor">A resident's experience depends on which channel reached them.</text>
  <text x="470" y="348" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">So the message must record the intended area, not only the delivered one.</text>
</svg>

The three areas are nested and progressively coarser, and each is correct for its channel. What goes wrong is treating the authored polygon as the delivered area — sizing a polygon tightly to avoid over-alerting, and then discovering that the cell-sector union it produced was four times larger than intended.

## Prerequisites

- **A CAP 1.2 authoring library and the official XSD**, plus the specific profile of whichever alerting authority you submit through. CAP is a standard with per-authority profiles, and a message can be schema-valid and profile-invalid.
- **An authoritative incident polygon in EPSG:4326** with axis order settled per the [coordinate reference system standard](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — an inverted alert polygon is a category of error with an unusually large blast radius.
- **The geographic code set your EAS path uses** and, where available, the cell-sector geometry the WEA path will map onto, so the delivered areas can be estimated before release rather than observed afterwards.
- **A named human approver.** Nothing in this topic removes that requirement, and the design below is built around making their decision easy rather than replacing it.

## The Fields That Carry Meaning

<svg viewBox="0 0 880 380" role="img" aria-labelledby="cap2-t cap2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cap2-t">The CAP fields that decide what a device does with a message</title>
  <desc id="cap2-d">Five Common Alerting Protocol fields carry the operational meaning. The identifier, sender and sent timestamp together form the message's unique key, and a re-sent alert reusing an identifier is a different message to some consumers and the same one to others. Message type distinguishes an alert from an update, a cancel or an error, and it is what lets a device replace rather than accumulate. References names the prior identifiers an update supersedes, and omitting it turns an update into a second independent alert. Urgency, severity and certainty drive whether a handset presents the message immediately or silently. Effective, onset and expires bound the message's life, and an absent expires leaves an alert live indefinitely on devices that never receive the cancel.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">five fields carry the operational meaning — the rest is presentation</text>
  <rect x="40" y="72" width="800" height="54" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.6"/>
  <text x="60" y="94" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--cream)">identifier · sender · sent</text>
  <text x="60" y="113" font-size="10" fill="var(--cream)">the unique key — reusing an identifier is a new message to some consumers and the same one to others</text>
  <rect x="40" y="136" width="800" height="54" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="158" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">msgType</text>
  <text x="60" y="177" font-size="10" fill="currentColor">Alert · Update · Cancel · Error — what lets a device replace a message rather than accumulate one</text>
  <rect x="40" y="200" width="800" height="54" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="222" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">references</text>
  <text x="60" y="241" font-size="10" fill="currentColor">the prior identifiers this supersedes — omit it and an Update becomes a second independent alert</text>
  <rect x="40" y="264" width="800" height="54" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="286" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">urgency · severity · certainty</text>
  <text x="60" y="305" font-size="10" fill="currentColor">whether a handset presents immediately or silently — not free-text priority</text>
  <rect x="40" y="328" width="800" height="46" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="350" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">effective · onset · expires</text>
  <text x="60" y="368" font-size="10" fill="currentColor">an absent expires leaves the alert live forever on any device that never receives the cancel</text>
</svg>

Most CAP elements are presentation. Five carry operational behaviour, and two of those are the ones most often got wrong.

`references` is the field that makes an update an update. A CAP message with `msgType` of `Update` but no `references` is, to most consumers, simply a second alert — so a device that received both now shows two evacuation orders with different boundaries and no indication which supersedes the other. That is worse than not updating.

`expires` is the field that bounds the damage from everything else. Devices lose messages; a cancel that never arrives leaves the alert live forever unless it expires on its own. Setting a conservative expiry and re-issuing while the hazard persists is strictly safer than a long expiry and a cancel you are trusting to arrive.

## Validating Before Release

<svg viewBox="0 0 880 360" role="img" aria-labelledby="cap3-t cap3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cap3-t">Where a CAP message is validated, and what each gate catches</title>
  <desc id="cap3-d">Four validation stages before a Common Alerting Protocol message is released. Schema validation against the CAP 1.2 XSD catches structural errors and missing mandatory elements, and costs milliseconds. Profile validation against the receiving authority's own profile catches values that are legal in CAP and rejected by that gateway, such as an unsupported event code. Geometry validation checks the polygon is closed, wound correctly, within the sender's jurisdiction and inside the vertex budget the channel imposes. Operational validation is the only human step: it confirms the message says what the incident commander intended, in language a resident will act on. Each stage catches what the one before it cannot, and only the last one can catch a technically perfect alert that tells people to do the wrong thing.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">four gates — and only the last catches a perfect message that says the wrong thing</text>
  <rect x="40" y="76" width="800" height="58" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="98" font-size="10.5" font-weight="700" fill="currentColor">1 · schema — CAP 1.2 XSD</text>
  <text x="60" y="118" font-size="10" fill="currentColor">structure and mandatory elements · milliseconds · fully automatable</text>
  <rect x="40" y="146" width="800" height="58" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="168" font-size="10.5" font-weight="700" fill="currentColor">2 · profile — the receiving authority's own</text>
  <text x="60" y="188" font-size="10" fill="currentColor">values legal in CAP and rejected by that gateway — an unsupported event code, a disallowed category</text>
  <rect x="40" y="216" width="800" height="58" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="238" font-size="10.5" font-weight="700" fill="currentColor">3 · geometry</text>
  <text x="60" y="258" font-size="10" fill="currentColor">closed · wound correctly · inside the sender's jurisdiction · within the channel's vertex budget</text>
  <rect x="40" y="286" width="800" height="58" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <text x="60" y="308" font-size="10.5" font-weight="700" fill="var(--cream)">4 · operational — a human, always</text>
  <text x="60" y="328" font-size="10" fill="var(--cream)">does it say what the incident commander meant, in words a resident will act on? Nothing automates this.</text>
</svg>

Each gate catches what the one before it cannot, and the ordering matters because the cheap ones eliminate most failures before a human is asked to look. Schema validation is milliseconds and catches structural defects. Profile validation catches the values that are legal in CAP and rejected by a particular gateway — this is where an event code that works in one state's system fails in a neighbour's.

Geometry validation is where this site's usual concerns land: a closed ring, correct winding, inside the sender's jurisdiction, and within the vertex budget the channel imposes. A polygon exceeding the budget is not rejected by most gateways; it is *simplified*, and the simplification is not yours.

The fourth gate is human and cannot be automated away. A message can pass all three technical gates and tell people to shelter in place when the incident commander ordered an evacuation.

## Step-by-Step Implementation

```python
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from lxml import etree
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry

logger = logging.getLogger("incidentgis.cap")

CAP_NS = "urn:oasis:names:tc:emergency:cap:1.2"
# Practical ceiling before gateways simplify the polygon themselves.
MAX_ALERT_VERTICES = 100


@dataclass(frozen=True)
class AlertIntent:
    """What the incident commander decided, separate from how it is delivered."""
    event: str
    headline: str
    instruction: str
    urgency: str        # Immediate | Expected | Future | Past | Unknown
    severity: str       # Extreme | Severe | Moderate | Minor | Unknown
    certainty: str      # Observed | Likely | Possible | Unlikely | Unknown
    approver: str
    supersedes: tuple[str, ...] = ()


def _cap_polygon(geom: BaseGeometry) -> str:
    """CAP polygons are lat,lon pairs, space separated, first point repeated.

    Note the coordinate order: CAP is latitude first, the opposite of GeoJSON.
    Emitting lon,lat here produces a syntactically valid alert for somewhere
    else entirely, which is the highest-consequence axis-order bug on the site.
    """
    if not isinstance(geom, Polygon):
        raise ValueError("alert areas must be a single closed polygon")
    ring = list(geom.exterior.coords)
    if len(ring) > MAX_ALERT_VERTICES:
        raise ValueError(
            f"{len(ring)} vertices exceeds the {MAX_ALERT_VERTICES} budget; "
            "simplify deliberately rather than letting the gateway do it"
        )
    return " ".join(f"{lat:.6f},{lon:.6f}" for lon, lat in ring)


def build_alert(
    intent: AlertIntent,
    area: BaseGeometry,
    *,
    sender: str,
    expires_in: timedelta = timedelta(hours=2),
    identifier: str | None = None,
) -> bytes:
    """Build a CAP 1.2 alert from an incident polygon and a stated intent."""
    if intent.supersedes and not identifier:
        identifier = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    msg_type = "Update" if intent.supersedes else "Alert"

    root = etree.Element("alert", nsmap={None: CAP_NS})
    etree.SubElement(root, "identifier").text = identifier or str(uuid.uuid4())
    etree.SubElement(root, "sender").text = sender
    etree.SubElement(root, "sent").text = now.isoformat()
    etree.SubElement(root, "status").text = "Actual"
    etree.SubElement(root, "msgType").text = msg_type
    etree.SubElement(root, "scope").text = "Public"

    if intent.supersedes:
        # Without references an Update is just a second alert, and a device
        # that received both shows two orders with no way to rank them.
        etree.SubElement(root, "references").text = " ".join(intent.supersedes)

    info = etree.SubElement(root, "info")
    etree.SubElement(info, "category").text = "Safety"
    etree.SubElement(info, "event").text = intent.event
    etree.SubElement(info, "urgency").text = intent.urgency
    etree.SubElement(info, "severity").text = intent.severity
    etree.SubElement(info, "certainty").text = intent.certainty
    # A conservative expiry that is re-issued beats a long one plus a cancel
    # you are trusting to arrive on every device.
    etree.SubElement(info, "expires").text = (now + expires_in).isoformat()
    etree.SubElement(info, "headline").text = intent.headline
    etree.SubElement(info, "instruction").text = intent.instruction

    area_el = etree.SubElement(info, "area")
    etree.SubElement(area_el, "areaDesc").text = intent.headline
    etree.SubElement(area_el, "polygon").text = _cap_polygon(area)

    payload = etree.tostring(root, xml_declaration=True, encoding="UTF-8")
    logger.info("cap_alert_built", extra={
        "msg_type": msg_type, "approver": intent.approver,
        "vertices": len(list(area.exterior.coords)),
        "supersedes": intent.supersedes,
    })
    return payload
```

## Configuration Reference

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Sender identifier | `CAP_SENDER` | _unset_ | The registered sender ID; a message with the wrong one is rejected at the gateway. |
| Default expiry | `CAP_EXPIRES_MINUTES` | `120` | Short and re-issued beats long and cancelled. |
| Vertex budget | `CAP_MAX_VERTICES` | `100` | Above this the gateway simplifies for you, with a shape you did not choose. |
| Simplification tolerance | `CAP_SIMPLIFY_M` | `50` | Applied deliberately when over budget, in a projected CRS. |
| Overshoot warning ratio | `CAP_OVERSHOOT_WARN` | `1.5` | Warn the approver when the estimated delivered area exceeds the authored one by this factor. |
| Profile | `CAP_PROFILE` | _unset_ | The receiving authority's profile; schema-valid is not the same as accepted. |
| Approver required | `CAP_REQUIRE_APPROVER` | `true` | There is no supported value of `false`. |

## Verification and Smoke Test

Validate against the XSD, then against the profile, then assert the polygon round-trips:

```bash
xmllint --noout --schema CAP-v1.2.xsd alert.xml && echo "schema ok"
python -m incidentgis.cap.profile_check --profile state-ipaws alert.xml
python -m incidentgis.cap.geometry_check --jurisdiction county-bernalillo alert.xml
```

The geometry check must confirm the emitted `polygon` parses back to the polygon that was authored — the latitude-first ordering makes a silent transposition the single highest-consequence defect this pipeline can ship.

## Integration With Adjacent Workflows

The alert polygon comes from the reconciled perimeter that the [conflict resolver](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) produced, so an alert inherits every property of that reconciliation including its audit trail. Evacuation instructions should be consistent with the routes the [evacuation routing layer](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/) is publishing, since an alert telling people to leave via a road the router has closed is worse than no alert.

## Troubleshooting

**Symptom: the gateway rejects a message that validates against the XSD.** It is failing the authority's profile. Compare the event code and category against that authority's list, not against CAP's.

**Symptom: an update appears as a second alert on handsets.** `references` is missing or names an identifier that was never sent. It must list the exact prior identifiers, space separated.

**Symptom: the delivered area is far larger than the polygon.** That is cell-sector or geographic-code delivery working normally. Estimate it before release and show the approver the ratio.

**Symptom: the alert polygon appears in the wrong hemisphere.** CAP is latitude-first and GeoJSON is longitude-first. Assert a round-trip parse, not a visual check.

**Symptom: an old alert is still showing on some devices days later.** `expires` was long or absent and the cancel did not reach them. Shorten the expiry and re-issue while the hazard persists.

## Frequently Asked Questions

**Why is the delivered alert area larger than the polygon we drew?** Because each channel reshapes it. The CAP message itself carries the polygon verbatim, but a Wireless Emergency Alert is delivered by cell broadcast, so the effective area becomes the union of every cell sector intersecting the polygon and extends wherever a sector reaches beyond the boundary. An Emergency Alert System broadcast is delivered by geographic code, so it covers entire counties or subdivisions containing any part of the polygon. The three areas are nested and progressively coarser, and sizing a polygon tightly to limit over-alerting does not limit what the coarser channels deliver — which is why the estimated delivered area should be shown to the approver before release.

**What makes a CAP update behave as an update rather than a new alert?** The references element. A message with msgType set to Update but no references is, to most consumers, simply a second independent alert, so a device that received both displays two evacuation orders with different boundaries and no way to tell which supersedes the other — worse than not having updated at all. References must list the exact prior identifiers, space separated, and those identifiers must be ones that were actually sent. The related discipline is expires: devices lose messages, so a cancel that never arrives leaves an alert live indefinitely, and a short expiry that is re-issued while the hazard persists is safer than a long one plus a cancel you are trusting to arrive.

**What is the highest-consequence technical defect in a CAP pipeline?** Transposed coordinates. CAP polygons are written latitude first, which is the opposite of GeoJSON's longitude-first ordering, so a pipeline that emits its internal representation directly produces a syntactically valid alert describing somewhere else entirely. It passes schema validation, passes profile validation, and is delivered. The defence is to parse the emitted polygon back and assert it equals the authored geometry, rather than checking it visually in an authoring tool that may use the same wrong convention on the way back in.

## Related

- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — where the reconciled perimeter an alert area is derived from comes from.
- [Evacuation Routing & Road Network Analysis](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/) — the routes an evacuation instruction must be consistent with.
- [Fixing Axis Order Inversion in Cross-Agency GeoJSON](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/fixing-axis-order-inversion-in-cross-agency-geojson/) — the same transposition failure, where the blast radius is smaller.
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — the fail-closed validation discipline the four alert gates apply.

Up: [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/)
