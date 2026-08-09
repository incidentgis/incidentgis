---
title: "Reconciling Unit Identifiers Across Agency CAD Systems"
description: "County Engine 11 and City Engine 11 collide the moment a normaliser strips the prefix, and each fix overwrites the other. Scope identifiers instead, and time-bound the crosswalk because resource orders get reused."
slug: reconciling-unit-identifiers-across-agency-cad-systems
type: article
breadcrumb: "Reconciling Unit Identifiers"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Reconciling Unit Identifiers Across Agency CAD Systems",
      "description": "County Engine 11 and City Engine 11 collide the moment a normaliser strips the prefix, and each fix overwrites the other. Scope identifiers instead, and time-bound the crosswalk because resource orders get reused.",
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
          "name": "Reconciling Unit Identifiers Across Agency CAD Systems",
          "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/avl-and-resource-tracking-feeds/reconciling-unit-identifiers-across-agency-cad-systems/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Give every unit a key that cannot collide across agencies",
      "description": "Scope each agency's identifier with its own namespace rather than normalising it, derive display names separately, crosswalk to resource orders with validity windows, and refuse identifiers that arrive without an owning agency.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Scope rather than normalise",
          "text": "Prefix each agency's identifier with the agency's own namespace and keep the local identifier exactly as issued, so the compound key cannot collide by construction and no distinguishing information is destroyed."
        },
        {
          "@type": "HowToStep",
          "name": "Separate key from display name",
          "text": "Derive the short label a responder sees from the scoped key rather than using it for lookup, since a compact label is a presentation concern and the key is a correctness one."
        },
        {
          "@type": "HowToStep",
          "name": "Time-bound the crosswalk",
          "text": "Map scoped units to resource orders with validity windows, because a resource order identifies an assignment rather than a vehicle and is reused in later operational periods."
        },
        {
          "@type": "HowToStep",
          "name": "Refuse unscoped identifiers",
          "text": "Hold any fix arriving without an owning agency for configuration instead of defaulting it, since a feed that cannot say who a unit belongs to cannot be safely merged."
        },
        {
          "@type": "HowToStep",
          "name": "Audit every resolution",
          "text": "Log which scoped unit a resource order resolved to and when, so an after-action reconstruction matches what the picture showed at the time."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not just normalise unit identifiers to a canonical form?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because normalising destroys the only information that distinguishes two agencies' units. County fire's engine 11 reports as 11 and city fire's as E11; a normaliser that strips the type prefix and pads the number turns both into the same string, so two vehicles collapse into one record and each position overwrites the other. The failure is silent and bidirectional: both agencies see a unit behaving impossibly and each concludes the other's feed is broken. Scoping the identifier with the issuing agency's namespace produces a longer key that cannot collide by construction."
          }
        },
        {
          "@type": "Question",
          "name": "Does scoping make the identifiers awkward for responders to read?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No, because the key and the display name are different things. A scoped key like county-fire/11 exists for correctness — lookups, joins, deduplication — while the label drawn on the map is derived from it and can stay as short as the agency's own convention. Conflating the two is exactly what makes normalisation look attractive: it optimises the key for human reading, which is not what a key is for. Once they are separated, there is no cost to a long key at all."
          }
        },
        {
          "@type": "Question",
          "name": "Why does the resource-order crosswalk need validity windows?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because a resource order identifies an assignment, not a vehicle. On a multi-day incident the same order number is filled by a different unit in a later operational period, so a crosswalk without time bounds silently attributes the first unit's movements to the second from the moment the order is reused. With validity windows, a position reported at 23:10 resolves to the unit that held the order then, and an after-action query about 14:00 resolves to the one that held it earlier — which is the same failure as an identifier collision, with a longer fuse."
          }
        }
      ]
    }
  ]
}
</script>

# Reconciling Unit Identifiers Across Agency CAD Systems

Two engines vanish from the operating picture and reappear as one marker that jumps four kilometres every thirty seconds. County Engine 11 reports as `11`; City Engine 11 reports as `E11`; the ingest normaliser strips the type prefix, both become `UNIT-0011`, and each fix overwrites the other's position.

## Root Cause and Operational Impact

Unit identifiers are unique within the agency that issues them and nowhere else. That is not a defect in any agency's scheme — a county has no reason to coordinate its engine numbering with a neighbouring city — but it means that the moment two agencies contribute to one incident, identifier uniqueness is a property nobody owns.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="ui1-t ui1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ui1-t">Four agencies, four unit-identifier conventions, one collision</title>
  <desc id="ui1-d">Four agencies contributing to one incident use incompatible unit identifiers. County fire uses a bare number such as 11. City fire uses a type prefix such as E11 for engine eleven. The state agency uses a dispatch code with a region prefix such as NM-3-E11. A federal team uses a resource order number unrelated to the vehicle. County's 11 and city's E11 are the same string once a naive normaliser strips the prefix, so two different engines collide into one record, and whichever reports last overwrites the other's position. The collision is silent because both are legitimate identifiers in their own systems, and neither agency can see the other's namespace.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">four conventions, and one of them collides</text>
  <rect x="40" y="76" width="800" height="52" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="98" font-size="10.5" font-weight="700" fill="currentColor">county fire</text>
  <text x="220" y="98" font-size="12" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">11</text>
  <text x="380" y="98" font-size="10" fill="currentColor">bare number — no type, no agency</text>
  <text x="60" y="118" font-size="9.5" fill="var(--muted)">unique within the county only</text>
  <rect x="40" y="138" width="800" height="52" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="160" font-size="10.5" font-weight="700" fill="currentColor">city fire</text>
  <text x="220" y="160" font-size="12" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">E11</text>
  <text x="380" y="160" font-size="10" fill="currentColor">type prefix — collides with county 11 once stripped</text>
  <rect x="40" y="200" width="800" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="222" font-size="10.5" font-weight="700" fill="currentColor">state</text>
  <text x="220" y="222" font-size="12" font-weight="700" font-family="var(--font-mono)" fill="currentColor">NM-3-E11</text>
  <text x="380" y="222" font-size="10" fill="currentColor">region-scoped — globally unique already</text>
  <rect x="40" y="262" width="800" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="284" font-size="10.5" font-weight="700" fill="currentColor">federal team</text>
  <text x="220" y="284" font-size="12" font-weight="700" font-family="var(--font-mono)" fill="currentColor">O-4471</text>
  <text x="380" y="284" font-size="10" fill="currentColor">resource order number — unrelated to the vehicle</text>
  <text x="8" y="342" font-size="10.5" font-weight="700" fill="var(--ember-text)">County 11 and city E11 become one record, and whichever reports last overwrites the other's position.</text>
</svg>

The failure is worse than a display glitch because it is bidirectional and silent. Both agencies see a unit behaving impossibly, each concludes the other's feed is broken, and the record that a supervisor uses to decide whether a division is covered is now the interleaving of two vehicles. Nothing errors, because both identifiers are legitimate.

## Tiered Resolution Strategy

1. **Scope, never normalise (definitive).** Keep each agency's identifier exactly as issued and prefix it with the agency's own namespace. The compound key cannot collide by construction, and no information is destroyed.
2. **Separate the key from the display name.** A short label on the map is a presentation concern; the key is a correctness one. Conflating them is what makes normalising attractive.
3. **Crosswalk to an incident-scoped resource identifier, with validity windows.** Resource order numbers are reused between operational periods, so the mapping must be time-bounded.
4. **Reject an unscoped identifier at ingest (safe default).** A feed that cannot say which agency a unit belongs to cannot be safely merged; hold it for configuration rather than guessing.
5. **Audit every crosswalk resolution.** Which scoped identifier a resource order resolved to, and at what time, is what makes an after-action reconstruction possible.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="ui2-t ui2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ui2-t">Scoping rather than normalising</title>
  <desc id="ui2-d">Two approaches to reconciling unit identifiers. Normalising strips prefixes and pads numbers to produce one canonical string, which is compact and destroys the information that distinguishes two agencies' units, so collisions are inevitable and silent. Scoping keeps each agency's identifier exactly as issued and prefixes it with the agency's own namespace, producing a compound key that cannot collide by construction. The scoped key is longer and never wrong. A display name derived from the scoped key can still be short, because the display is a presentation concern and the key is a correctness one — conflating those two is what makes normalisation attractive.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">scope the identifier; never normalise it</text>
  <rect x="40" y="80" width="390" height="180" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <rect x="450" y="80" width="390" height="180" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="60" y="108" font-size="11" font-weight="700" fill="var(--ember-text)">normalise</text>
  <text x="470" y="108" font-size="11" font-weight="700" fill="var(--crimson-deep)">scope</text>
  <text x="60" y="140" font-size="11" font-family="var(--font-mono)" fill="currentColor">11 → UNIT-0011</text>
  <text x="60" y="162" font-size="11" font-family="var(--font-mono)" fill="currentColor">E11 → UNIT-0011</text>
  <text x="470" y="140" font-size="11" font-family="var(--font-mono)" fill="currentColor">county-fire/11</text>
  <text x="470" y="162" font-size="11" font-family="var(--font-mono)" fill="currentColor">city-fire/E11</text>
  <text x="60" y="196" font-size="10" fill="currentColor">compact, and destroys what</text>
  <text x="60" y="214" font-size="10" fill="currentColor">distinguished them</text>
  <text x="470" y="196" font-size="10" fill="currentColor">longer, and cannot collide</text>
  <text x="470" y="214" font-size="10" fill="currentColor">by construction</text>
  <text x="60" y="244" font-size="10" font-weight="700" fill="var(--ember-text)">collisions are silent</text>
  <text x="470" y="244" font-size="10" font-weight="700" fill="var(--crimson-deep)">display name stays short</text>
  <text x="8" y="296" font-size="10.5" fill="currentColor">A short label on the map is a presentation concern. The key is a correctness one.</text>
  <text x="8" y="318" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Conflating the two is exactly what makes normalising look attractive.</text>
</svg>

Tier one is the whole fix and it is usually resisted on the grounds that the keys get long. They do. `county-fire/11` is longer than `11`, and it is also correct — and because the display name is derived separately, nothing a responder reads gets longer.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="ui3-t ui3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ui3-t">The crosswalk that survives a unit being reassigned</title>
  <desc id="ui3-d">A crosswalk maps agency-scoped identifiers to an incident-scoped resource identifier, and it is time-bounded rather than permanent. County engine eleven is assigned to the incident at 06:00 under resource order O-4471 and released at 22:00. A different engine takes the same order number the following operational period. Because each crosswalk entry carries a validity window, a position reported at 23:10 under O-4471 resolves to the second engine and not the first, and an after-action query about O-4471 at 14:00 resolves to the first. A crosswalk without validity windows silently attributes one unit's movements to another as soon as a resource order is reused, which happens on every multi-day incident.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the crosswalk is time-bounded, because resource orders get reused</text>
  <path d="M120 200 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="120" y="222">06:00</text><text x="330" y="222">14:00</text><text x="540" y="222">22:00</text><text x="750" y="222">06:00 +1</text>
  </g>
  <rect x="120" y="120" width="420" height="40" rx="6" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.4"/>
  <text x="140" y="145" font-size="10.5" font-weight="700" fill="var(--cream)">county-fire/11 → O-4471</text>
  <rect x="560" y="120" width="280" height="40" rx="6" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="580" y="145" font-size="10.5" font-weight="700" fill="currentColor">city-fire/E7 → O-4471</text>
  <text x="140" y="108" font-size="9.5" fill="var(--muted)">assigned 06:00, released 22:00</text>
  <text x="580" y="108" font-size="9.5" fill="var(--muted)">same order, next period</text>
  <path d="M330 160 V196" fill="none" stroke="var(--crimson-deep)" stroke-width="1.6" stroke-dasharray="4 3"/>
  <text x="240" y="258" font-size="10" font-weight="700" fill="var(--crimson-deep)">a query about O-4471 at 14:00 → county-fire/11</text>
  <path d="M700 160 V196" fill="none" stroke="var(--crimson-deep)" stroke-width="1.6" stroke-dasharray="4 3"/>
  <text x="600" y="258" font-size="10" font-weight="700" fill="var(--crimson-deep)">a fix at 23:10 → city-fire/E7</text>
  <text x="8" y="304" font-size="10.5" fill="currentColor">Without validity windows, one unit's movements are silently attributed to another the moment an order is reused —</text>
  <text x="8" y="324" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">which happens on every multi-day incident.</text>
</svg>

Tier three is the part teams discover late. A resource order number identifies an *assignment*, not a vehicle, and on a multi-day incident the same order is filled by a different unit in a later operational period. A crosswalk without validity windows silently attributes the first unit's movements to the second, which is the same failure as the identifier collision with a longer fuse.

## Production Python Implementation

```python
from __future__ import annotations

import logging
from bisect import bisect_right
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger("incidentgis.unit_ids")


class UnscopedIdentifierError(ValueError):
    """A feed supplied a unit identifier with no owning agency."""


@dataclass(frozen=True)
class ScopedUnit:
    agency: str
    local_id: str

    @property
    def key(self) -> str:
        """Compound key — cannot collide across agencies by construction."""
        return f"{self.agency}/{self.local_id}"

    @property
    def display(self) -> str:
        """Short label for the map; presentation only, never a key."""
        return self.local_id


@dataclass(frozen=True)
class Assignment:
    unit: ScopedUnit
    resource_order: str
    valid_from: datetime
    valid_to: datetime | None      # None = still assigned


class Crosswalk:
    """Resolve a resource order to the unit that held it at a given time."""

    def __init__(self) -> None:
        self._by_order: dict[str, list[Assignment]] = {}

    def assign(self, assignment: Assignment) -> None:
        entries = self._by_order.setdefault(assignment.resource_order, [])
        # Close any open assignment for this order before opening a new one:
        # an order held by two units at once is a data defect, not a merge.
        for i, existing in enumerate(entries):
            if existing.valid_to is None:
                if existing.unit == assignment.unit:
                    return
                entries[i] = Assignment(
                    existing.unit, existing.resource_order,
                    existing.valid_from, assignment.valid_from,
                )
                logger.info("resource_order_reassigned", extra={
                    "order": assignment.resource_order,
                    "from_unit": existing.unit.key,
                    "to_unit": assignment.unit.key,
                })
        entries.append(assignment)
        entries.sort(key=lambda a: a.valid_from)

    def resolve(self, resource_order: str, at: datetime) -> ScopedUnit | None:
        """Which unit held this order at this instant?"""
        entries = self._by_order.get(resource_order, [])
        if not entries:
            return None
        starts = [a.valid_from for a in entries]
        idx = bisect_right(starts, at) - 1
        if idx < 0:
            return None
        candidate = entries[idx]
        if candidate.valid_to is not None and at >= candidate.valid_to:
            return None
        return candidate.unit


def scope_identifier(agency: str | None, local_id: str) -> ScopedUnit:
    """Refuse an unscoped identifier rather than guessing an owner."""
    if not agency:
        raise UnscopedIdentifierError(
            f"unit {local_id!r} arrived with no agency — hold for configuration"
        )
    return ScopedUnit(agency=agency.strip().lower(), local_id=local_id.strip())
```

## Validation Checklist

- [ ] Every unit key is `agency/local_id`; no code path constructs a key from `local_id` alone.
- [ ] Display names are derived separately and are never used for lookup.
- [ ] Local identifiers are preserved exactly as issued — no prefix stripping, no zero padding.
- [ ] Crosswalk entries carry a validity window and a reassignment closes the previous one.
- [ ] A resource order held by two units at the same instant is rejected as a defect.
- [ ] An identifier arriving without an agency is held for configuration, never defaulted.
- [ ] Every crosswalk resolution is logged with the order, the resolved unit and the timestamp.
- [ ] A fixture reproduces the county-11 / city-E11 collision and asserts two distinct records.

## Edge Cases and Gotchas

- **Agency names that are not stable either.** "County Fire", "county-fire" and "CoFD" are the same agency to a human. Fix the agency vocabulary once, in configuration, and normalise only that — it is a small closed set, unlike unit numbers.
- **A unit that changes agency mid-incident.** Mutual aid can move a vehicle between commands. Treat it as a new scoped unit with a crosswalk entry linking the two, rather than mutating the key, so historical positions stay attributed correctly.
- **Feeds that embed the agency inconsistently.** Some vendors put it in a field, some in a prefix, some nowhere. Extract it at the adapter boundary, exactly as the [record contract](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/) requires of every other field.
- **Resource orders reused within one operational period.** Rare and real, usually after a cancellation. The validity-window logic handles it; a crosswalk keyed only on the order does not.
- **Retroactive assignment corrections.** A crosswalk edited after the fact changes what historical positions resolve to. Version the crosswalk rather than editing in place, or an after-action reconstruction will not match what the picture showed at the time.

## Frequently Asked Questions

**Why not just normalise unit identifiers to a canonical form?** Because normalising destroys the only information that distinguishes two agencies' units. County fire's engine 11 reports as 11 and city fire's as E11; a normaliser that strips the type prefix and pads the number turns both into the same string, so two vehicles collapse into one record and each position overwrites the other. The failure is silent and bidirectional: both agencies see a unit behaving impossibly and each concludes the other's feed is broken. Scoping the identifier with the issuing agency's namespace produces a longer key that cannot collide by construction.

**Does scoping make the identifiers awkward for responders to read?** No, because the key and the display name are different things. A scoped key like county-fire/11 exists for correctness — lookups, joins, deduplication — while the label drawn on the map is derived from it and can stay as short as the agency's own convention. Conflating the two is exactly what makes normalisation look attractive: it optimises the key for human reading, which is not what a key is for. Once they are separated, there is no cost to a long key at all.

**Why does the resource-order crosswalk need validity windows?** Because a resource order identifies an assignment, not a vehicle. On a multi-day incident the same order number is filled by a different unit in a later operational period, so a crosswalk without time bounds silently attributes the first unit's movements to the second from the moment the order is reused. With validity windows, a position reported at 23:10 resolves to the unit that held the order then, and an after-action query about 14:00 resolves to the one that held it earlier — which is the same failure as an identifier collision, with a longer fuse.

## Related

- [AVL & Resource Tracking Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/avl-and-resource-tracking-feeds/) — the feed whose positions these keys have to keep apart.
- [Resolving Duplicate Incident Reports Across Jurisdictions](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/resolving-duplicate-incident-reports-across-jurisdictions/) — the same cross-agency identity problem where no shared key exists at all.
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — agency precedence as configuration agreed before an incident.
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — the adapter boundary where an agency field is extracted before validation runs.

Up: [AVL & Resource Tracking Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/avl-and-resource-tracking-feeds/)
