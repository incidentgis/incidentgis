---
title: "Geo-Targeting Wireless Alerts Without Overshoot"
description: "A wireless alert is delivered to whole cell sectors, so a 4 km² polygon can reach 31 km². Estimating the delivered area before release, finding the dominant sector, and showing the approver a ratio rather than a map."
slug: geo-targeting-wireless-alerts-without-overshoot
type: article
breadcrumb: "Geo-Targeting Without Overshoot"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Geo-Targeting Wireless Alerts Without Overshoot",
      "description": "A wireless alert is delivered to whole cell sectors, so a 4 km² polygon can reach 31 km². Estimating the delivered area before release, finding the dominant sector, and showing the approver a ratio rather than a map.",
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
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Geo-Targeting Wireless Alerts Without Overshoot",
          "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/public-alerting-and-cap-message-pipelines/geo-targeting-wireless-alerts-without-overshoot/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Estimate and reduce wireless alert overshoot before release",
      "description": "Compute the union of cell sectors the alert polygon intersects, show the approver the delivered-to-authored ratio and the excess population, identify the dominant contributing sector, and word the message for the area that will actually receive it.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Estimate the delivered area",
          "text": "Union every cell sector the polygon intersects and compute the ratio to the authored area in a projected coordinate system, so the overshoot is visible at the moment of decision rather than discovered afterwards."
        },
        {
          "@type": "HowToStep",
          "name": "Name the dominant sector",
          "text": "Rank sectors by how much excess area each contributes, because one usually accounts for most of it and is the single highest-leverage thing to move the polygon away from."
        },
        {
          "@type": "HowToStep",
          "name": "Estimate the excess population",
          "text": "Count the people inside the broadcast footprint and outside the polygon, since that is the number that consumes road capacity and erodes future compliance."
        },
        {
          "@type": "HowToStep",
          "name": "Adjust or split where it is safe",
          "text": "Pull the boundary back from the dominant sector only where the excluded ground genuinely is not at risk, or split the alert into smaller polygons that avoid it."
        },
        {
          "@type": "HowToStep",
          "name": "Word the message for the delivered area",
          "text": "Name a recognisable boundary in the first line so a recipient well outside the polygon can resolve their situation in seconds instead of acting."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does a small alert polygon still reach a large area?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because a Wireless Emergency Alert is delivered by cell broadcast, so the unit of delivery is a cell sector rather than a polygon. Every sector intersecting the alert area receives the message in full and the delivered area is the union of those sectors, which makes it a property of the cell network's geometry rather than of the polygon. The practical consequence is that overshoot is not proportional to polygon size: it is dominated by the largest single sector the polygon happens to touch, so a 4 square-kilometre polygon clipping one rural sector can deliver over 30 square kilometres."
          }
        },
        {
          "@type": "Question",
          "name": "What is the highest-leverage way to reduce overshoot?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Identify the dominant contributing sector and, where it is safe, move the polygon boundary away from it. Because one sector typically accounts for most of the excess, a few hundred metres of adjustment can cut the delivered area several-fold, while shrinking the polygon elsewhere changes almost nothing. This is only acceptable when the excluded strip genuinely is not at risk — the alternative levers are splitting into smaller alerts, which multiplies message count and handset fatigue, and device-based geofencing, which narrows who acts rather than who receives."
          }
        },
        {
          "@type": "Question",
          "name": "What should the approver actually be shown before release?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Four numbers rather than a map: the authored area, the estimated delivered area and their ratio, the estimated population inside the broadcast footprint but outside the polygon, and the identifier of the sector contributing most of the excess. The ratio is what turns overshoot from a surprise into a decision, the excess-population figure is what makes the cost concrete in terms of road capacity and future compliance, and the dominant sector names the one lever most likely to change the answer. A map alone shows a shape, not a consequence."
          }
        }
      ]
    }
  ]
}
</script>

# Geo-Targeting Wireless Alerts Without Overshoot

An incident commander approves a tight 4-square-kilometre evacuation polygon precisely to avoid alerting people who are not at risk. The Wireless Emergency Alert derived from it reaches roughly 31 square kilometres, because one corner of the polygon clips a rural cell sector whose tower serves a town 11 kilometres away. Nine thousand people receive an evacuation order, and the roads the actual evacuation needs fill with cars from a town that was never threatened.

## Root Cause and Operational Impact

Wireless Emergency Alerts are delivered by cell broadcast, which means the unit of delivery is a cell sector, not a polygon. Every sector that intersects the alert area receives the message in full, and the delivered area is the union of those sectors. Nothing about that is a defect — it is how broadcast works — but it makes the delivered area a property of the *cell network's* geometry rather than of the authored polygon.

<svg viewBox="0 0 880 400" role="img" aria-labelledby="ot1-t ot1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ot1-t">How one cell sector turns a 4 square-kilometre polygon into a 31 square-kilometre alert</title>
  <desc id="ot1-d">An evacuation polygon of about 4 square kilometres sits on the north edge of a fire. Three cell sectors overlap it. Two are small urban sectors that add little beyond the boundary. The third is a rural sector whose tower serves a wedge extending 11 kilometres to the north-east, including a town that is nowhere near the hazard. Because a Wireless Emergency Alert is delivered to whole sectors, the union of the three is about 31 square kilometres, nearly eight times the authored area, and almost all of the excess comes from that single sector. Overshoot is therefore not proportional to polygon size — it is dominated by the largest sector the polygon happens to touch, which is why one vertex moved a few hundred metres can change the delivered population by thousands.</desc>
  <rect x="0" y="0" width="880" height="400" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">overshoot is dominated by the largest sector the polygon touches, not by its own size</text>
  <path d="M120 250 L300 120 L470 190 L400 320 Z" fill="var(--petal)" opacity="0.55" stroke="var(--crimson)" stroke-width="1.5"/>
  <path d="M300 180 L560 90 L640 210 L380 250 Z" fill="var(--ember)" opacity="0.3" stroke="var(--ember)" stroke-width="2"/>
  <path d="M200 210 L320 170 L350 260 L230 290 Z" fill="var(--petal)" opacity="0.5" stroke="var(--crimson)" stroke-width="1.5"/>
  <path d="M250 200 Q300 178 340 200 Q356 236 330 254 Q286 266 258 246 Q242 220 250 200 Z" fill="var(--crimson)" opacity="0.7" stroke="var(--crimson-deep)" stroke-width="2"/>
  <text x="252" y="290" font-size="10" font-weight="700" fill="var(--crimson-deep)">the polygon · 4 km²</text>
  <text x="470" y="120" font-size="10" font-weight="700" fill="var(--ember-text)">rural sector · 11 km reach</text>
  <circle cx="596" cy="132" r="7" fill="var(--ember)"/>
  <text x="486" y="176" font-size="10" fill="currentColor">a town with no hazard</text>
  <rect x="470" y="250" width="370" height="52" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="490" y="272" font-size="10.5" font-weight="700" fill="var(--ember-text)">delivered union · ~31 km²</text>
  <text x="490" y="290" font-size="10" fill="currentColor">7.8× the authored area — almost all from one sector</text>
  <rect x="470" y="312" width="370" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="490" y="334" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">move one vertex 300 m south</text>
  <text x="490" y="352" font-size="10" fill="currentColor">the sector drops out · delivered area falls to ~6 km²</text>
</svg>

The consequence that surprises people is that overshoot is not proportional to polygon size. It is dominated by the single largest sector the polygon happens to touch, so a polygon can be made smaller and deliver almost the same area, or moved 300 metres and deliver a fifth as much. Authoring intuition, which assumes a smaller shape means a smaller alert, is simply not applicable.

The operational cost is concrete. People outside the hazard who act on an evacuation order consume the road capacity the real evacuation needs — the [evacuation routing layer](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/) models capacity that over-alerting silently consumes. The longer-term cost is compliance: a population repeatedly alerted for hazards that did not reach them responds more slowly the next time.

## Tiered Resolution Strategy

1. **Estimate the delivered area before release (definitive).** Compute the union of intersecting sectors and show the approver the ratio. Everything else in this guide depends on the overshoot being visible at the moment of decision rather than discovered afterwards.
2. **Identify the dominant sector and test moving away from it.** Because one sector usually accounts for most of the excess, the highest-leverage edit is a small adjustment to the polygon boundary near it — and it is only acceptable if the ground being excluded genuinely is not at risk.
3. **Split the alert where the geography justifies it.** Two smaller polygons that avoid the large sector can deliver far less than one that clips it, at the cost of more messages.
4. **Use device-based geofencing as a narrowing layer, never as the plan.** Handsets that filter on the polygon get precision; the rest still receive the broadcast. It reduces the population that acts, not the population that receives.
5. **Word the message for the delivered area (safe default).** Whatever the overshoot, the text must let a recipient outside the polygon determine that quickly. That is not a substitute for reducing overshoot; it is what limits the damage from the overshoot that remains.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="ot2-t ot2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ot2-t">Four ways to reduce overshoot, and what each costs</title>
  <desc id="ot2-d">Four levers for reducing wireless alert overshoot. Shrinking the polygon away from a large sector's coverage is free and can cut the delivered area dramatically, but risks excluding people who are genuinely at risk, so it is only safe where the excluded strip is not hazardous. Splitting one alert into several smaller ones targets better and multiplies the message count, which has its own cost in handset fatigue. Using a device-based geofence, where handsets filter on the polygon themselves, is precise but only reaches devices whose software supports it. Accepting the overshoot and saying so in the message text costs nothing technically and shifts the burden onto wording that tells people outside the polygon they are not being asked to act. In practice the fourth is used with one of the first three, never alone.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">four levers, none of them free</text>
  <rect x="40" y="72" width="800" height="60" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="96" font-size="10.5" font-weight="700" fill="currentColor">pull the polygon back from a large sector</text>
  <text x="60" y="116" font-size="10" fill="currentColor">can cut delivered area by 5× · only safe where the excluded strip genuinely is not at risk</text>
  <rect x="40" y="144" width="800" height="60" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="168" font-size="10.5" font-weight="700" fill="currentColor">split into several smaller alerts</text>
  <text x="60" y="188" font-size="10" fill="currentColor">targets better · multiplies message count, and handset fatigue is a real cost</text>
  <rect x="40" y="216" width="800" height="60" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="240" font-size="10.5" font-weight="700" fill="currentColor">device-based geofencing</text>
  <text x="60" y="260" font-size="10" fill="currentColor">precise · reaches only devices whose software supports it, so it narrows rather than replaces</text>
  <rect x="40" y="288" width="800" height="60" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="312" font-size="10.5" font-weight="700" fill="var(--ember-text)">accept it, and say so in the text</text>
  <text x="60" y="332" font-size="10" fill="currentColor">free · shifts the burden onto wording that tells people outside the polygon not to act — never used alone</text>
</svg>

Tier five deserves emphasis because it is cheap and frequently skipped. An alert whose first line names the specific area — a road, a subdivision, a recognisable boundary — lets someone eleven kilometres away resolve their situation in seconds. An alert that says only "evacuate immediately" gives them no way to, so they act.

## Production Python Implementation

```python
from __future__ import annotations

import logging
from dataclasses import dataclass

import geopandas as gpd
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

logger = logging.getLogger("incidentgis.wea_overshoot")

# Ratio above which the approver must acknowledge the overshoot explicitly.
OVERSHOOT_WARN = 1.5


@dataclass(frozen=True)
class OvershootEstimate:
    authored_km2: float
    delivered_km2: float
    ratio: float
    excess_population: int
    dominant_sector: str
    dominant_excess_km2: float


def estimate_overshoot(
    alert_area: BaseGeometry,
    sectors: gpd.GeoDataFrame,
    population: gpd.GeoDataFrame,
    *,
    metric_crs: str,
) -> OvershootEstimate:
    """Estimate what a cell-broadcast alert will actually reach.

    Areas are computed in a projected CRS: measuring in EPSG:4326 would
    misreport the ratio by the square of the secant of the latitude, which is
    the one error that would make this whole estimate pointless.
    """
    if sectors.crs is None or population.crs is None:
        raise ValueError("sector and population layers must declare a CRS")

    sectors_m = sectors.to_crs(metric_crs)
    population_m = population.to_crs(metric_crs)
    area_m = gpd.GeoSeries([alert_area], crs=population.crs).to_crs(metric_crs).iloc[0]

    touched = sectors_m[sectors_m.intersects(area_m)]
    if touched.empty:
        raise ValueError("alert area intersects no cell sectors — check the CRS")

    delivered = unary_union(touched.geometry.tolist())
    excess = delivered.difference(area_m)

    # Population outside the polygon but inside the broadcast footprint: the
    # people who will act without being at risk.
    hit = population_m[population_m.intersects(excess)]
    excess_pop = int(hit["population"].sum()) if not hit.empty else 0

    # Which single sector contributes most of the excess? That is the lever.
    contributions = {
        row.sector_id: row.geometry.difference(area_m).area / 1e6
        for row in touched.itertuples()
    }
    dominant_id = max(contributions, key=contributions.get)

    estimate = OvershootEstimate(
        authored_km2=area_m.area / 1e6,
        delivered_km2=delivered.area / 1e6,
        ratio=delivered.area / area_m.area,
        excess_population=excess_pop,
        dominant_sector=str(dominant_id),
        dominant_excess_km2=contributions[dominant_id],
    )

    if estimate.ratio > OVERSHOOT_WARN:
        logger.warning("wea_overshoot_high", extra={
            "ratio": round(estimate.ratio, 2),
            "excess_population": estimate.excess_population,
            "dominant_sector": estimate.dominant_sector,
        })
    logger.info("wea_overshoot_estimated", extra={"ratio": round(estimate.ratio, 2)})
    return estimate
```

<svg viewBox="0 0 880 340" role="img" aria-labelledby="ot3-t ot3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ot3-t">What the approver should see before releasing</title>
  <desc id="ot3-d">The release screen shows four figures rather than a map alone. The authored area in square kilometres is what the incident commander decided. The estimated delivered area and the ratio between them make the overshoot explicit rather than leaving it to be discovered. The estimated population inside the delivered area but outside the polygon is the number that matters for road capacity and for future compliance, since those are the people who will act without being at risk. And the largest single contributing sector is named, because that is the one lever most likely to change the outcome. Presenting the ratio rather than the map is what turns overshoot from a surprise into a decision.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">show the approver four numbers, not a map</text>
  <rect x="40" y="76" width="390" height="98" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="102" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">authored area</text>
  <text x="60" y="140" font-size="22" font-weight="700" fill="currentColor">4.1 km²</text>
  <text x="60" y="162" font-size="10" fill="var(--muted)">what the incident commander decided</text>
  <rect x="450" y="76" width="390" height="98" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="470" y="102" font-size="10.5" font-weight="700" fill="var(--ember-text)">estimated delivered area</text>
  <text x="470" y="140" font-size="22" font-weight="700" fill="currentColor">31.4 km² · 7.8×</text>
  <text x="470" y="162" font-size="10" fill="var(--muted)">the ratio is the thing to read, not the map</text>
  <rect x="40" y="190" width="390" height="98" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="216" font-size="10.5" font-weight="700" fill="var(--ember-text)">people alerted, not at risk</text>
  <text x="60" y="254" font-size="22" font-weight="700" fill="currentColor">~9 400</text>
  <text x="60" y="276" font-size="10" fill="var(--muted)">road capacity, and future compliance</text>
  <rect x="450" y="190" width="390" height="98" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="470" y="216" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">largest contributing sector</text>
  <text x="470" y="250" font-size="14" font-weight="700" fill="currentColor">RUR-1142 · 24.8 km² of the excess</text>
  <text x="470" y="276" font-size="10" fill="var(--muted)">the one lever most likely to change the answer</text>
  <text x="8" y="322" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Presenting the ratio is what turns overshoot from a surprise into a decision.</text>
</svg>

## Validation Checklist

- [ ] The delivered-area estimate runs before every release and its ratio is shown to the approver.
- [ ] Areas are computed in a projected CRS, never in EPSG:4326.
- [ ] The dominant contributing sector is named on the release screen, not just the total.
- [ ] Excess population — inside the broadcast footprint, outside the polygon — is estimated and shown.
- [ ] A ratio above the configured threshold requires an explicit acknowledgement rather than a default approval.
- [ ] The message text names a recognisable area boundary in its first line.
- [ ] The sector geometry used for the estimate is dated, and its age is displayed alongside the estimate.
- [ ] A smoke test asserts the estimate is greater than or equal to the authored area for every fixture.

## Edge Cases and Gotchas

- **Sector geometry that is out of date.** Carriers re-sector regularly, and an estimate computed against last year's footprints is confidently wrong. Display the geometry's age next to the ratio so the approver can weigh it.
- **Sectors with no published geometry.** Some coverage is only available as a coarse polygon or not at all. Treat unknown sectors as maximally large rather than excluding them, so the estimate errs toward warning.
- **Terrain that makes a sector's real coverage smaller than its polygon.** A ridge can shadow half a sector's nominal footprint, so the estimate is an upper bound. That is the right direction to be wrong in, and it should be stated rather than tuned away.
- **A polygon that clips a sector by a few metres.** The delivered area jumps discontinuously as a vertex crosses a sector boundary, so small authoring adjustments can have large effects in both directions. Show the ratio live as the polygon is edited if the authoring tool allows it.
- **Estimating in EPSG:4326.** The ratio is a ratio of areas, and Web Mercator or geographic areas distort by latitude, which the [coordinate reference system standard](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) covers in detail. The ratio survives better than absolute areas do, but the excess-population figure does not.

## Frequently Asked Questions

**Why does a small alert polygon still reach a large area?** Because a Wireless Emergency Alert is delivered by cell broadcast, so the unit of delivery is a cell sector rather than a polygon. Every sector intersecting the alert area receives the message in full and the delivered area is the union of those sectors, which makes it a property of the cell network's geometry rather than of the polygon. The practical consequence is that overshoot is not proportional to polygon size: it is dominated by the largest single sector the polygon happens to touch, so a 4 square-kilometre polygon clipping one rural sector can deliver over 30 square kilometres.

**What is the highest-leverage way to reduce overshoot?** Identify the dominant contributing sector and, where it is safe, move the polygon boundary away from it. Because one sector typically accounts for most of the excess, a few hundred metres of adjustment can cut the delivered area several-fold, while shrinking the polygon elsewhere changes almost nothing. This is only acceptable when the excluded strip genuinely is not at risk — the alternative levers are splitting into smaller alerts, which multiplies message count and handset fatigue, and device-based geofencing, which narrows who acts rather than who receives.

**What should the approver actually be shown before release?** Four numbers rather than a map: the authored area, the estimated delivered area and their ratio, the estimated population inside the broadcast footprint but outside the polygon, and the identifier of the sector contributing most of the excess. The ratio is what turns overshoot from a surprise into a decision, the excess-population figure is what makes the cost concrete in terms of road capacity and future compliance, and the dominant sector names the one lever most likely to change the answer. A map alone shows a shape, not a consequence.

## Related

- [Public Alerting & CAP Message Pipelines](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/public-alerting-and-cap-message-pipelines/) — the message this delivered area is estimated for.
- [Evacuation Routing & Road Network Analysis](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/) — the road capacity that over-alerting silently consumes.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — why the area ratio must be computed in a projected system.
- [Optimizing Spatial Joins for Incident Data](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/optimizing-spatial-joins-for-incident-data/) — making the sector and population intersections fast enough to run while a polygon is being edited.

Up: [Public Alerting & CAP Message Pipelines](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/public-alerting-and-cap-message-pipelines/)
