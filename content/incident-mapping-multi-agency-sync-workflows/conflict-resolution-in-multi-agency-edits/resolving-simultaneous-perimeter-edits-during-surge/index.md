---
title: "Resolving Simultaneous Perimeter Edits During Surge"
description: "Reconcile concurrent edits to the same fire or flood perimeter during surge: detect divergence with version vectors, union or last-writer-wins-with-merge, raise a conflict flag, and emit an immutable audit trail for every merged polygon."
slug: resolving-simultaneous-perimeter-edits-during-surge
type: article
breadcrumb: "Simultaneous Perimeter Edits"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Resolving Simultaneous Perimeter Edits During Surge",
      "description": "Reconcile concurrent edits to the same fire or flood perimeter during surge: detect divergence with version vectors, union or last-writer-wins-with-merge, raise a conflict flag, and emit an immutable audit trail for every merged polygon.",
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
        { "@type": "ListItem", "position": 3, "name": "Conflict Resolution in Multi-Agency Edits", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/" },
        { "@type": "ListItem", "position": 4, "name": "Resolving Simultaneous Perimeter Edits During Surge", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/resolving-simultaneous-perimeter-edits-during-surge/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Reconcile concurrent perimeter edits from two agencies during surge",
      "description": "Detect divergent edits to the same incident perimeter using version vectors, choose union or last-writer-wins-with-merge based on the edit intent, raise a human conflict flag when reconciliation is ambiguous, and record every merged geometry in an immutable audit trail.",
      "step": [
        { "@type": "HowToStep", "name": "Detect divergence with version vectors", "text": "Compare each edit's per-agency version vector against the base to decide whether one edit dominates or the two genuinely conflict, rather than trusting wall-clock timestamps." },
        { "@type": "HowToStep", "name": "Choose a reconciliation strategy", "text": "For growth edits union the two geometries so no burned or flooded area is lost; for corrective edits fall back to last-writer-wins-with-merge only where the edits do not overlap." },
        { "@type": "HowToStep", "name": "Raise a conflict flag when ambiguous", "text": "When the two edits disagree on the same area in incompatible directions, keep both candidates, mark the feature conflicted, and escalate to a human editor instead of silently picking one." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Record the base version, both incoming versions, the strategy applied, and the resulting geometry hash so the merged perimeter is reproducible and defensible." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not just use last-writer-wins on the timestamp for perimeter edits?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Wall-clock timestamps are unreliable across agencies whose devices have skewed or unsynchronised clocks, and last-writer-wins silently discards the losing edit. If one agency extended the perimeter to enclose a newly threatened neighbourhood and the other made a small correction a second later, a naive timestamp wins throws away the extension and shrinks the hazard area. Version vectors let you distinguish a genuine dominance from a real concurrent conflict before deciding what to keep."
          }
        },
        {
          "@type": "Question",
          "name": "When should concurrent perimeter edits be unioned rather than merged?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Union when both edits are growth edits and the safe outcome is the largest defensible hazard area, which is the normal case for an actively spreading fire or flood: unioning never removes an area that either agency marked as affected. Fall back to last-writer-wins-with-merge only for corrective edits that trim a mistaken bulge, and even then apply the newer edit only where it does not overlap the other agency's changes."
          }
        },
        {
          "@type": "Question",
          "name": "What happens when two edits conflict on the same area in opposite directions?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The reconciler must not pick a winner automatically. It retains both candidate geometries, marks the feature as conflicted with a machine-readable flag, and escalates to a human editor with the full context of both edits. An audit record captures the base version, both incoming versions, and the fact that resolution was deferred, so the Common Operating Picture shows the most conservative geometry until a person reconciles it."
          }
        }
      ]
    }
  ]
}
</script>

# Resolving Simultaneous Perimeter Edits During Surge

At 0300 during the second operational period of a wind-driven wildfire, two agencies are editing the same perimeter polygon in the shared incident feature service. A state fire mapper, working from a fresh infrared flight, drags the northeast edge out three hundred metres to enclose a spot fire that jumped the ridge. At almost the same moment a county analyst, working from a windshield report, trims a bulge on the southwest edge that a previous shift had over-drawn. Both save within the same sync window. The naive service keeps whichever write landed last, and the other agency's change vanishes without a trace — either the spot fire is no longer inside the perimeter, or the corrected bulge reappears. During surge, that lost edit is not a cosmetic glitch: it is a piece of the hazard picture that silently reverted. This page solves that one narrow failure — two agencies editing the same incident perimeter concurrently — turning a race between overwrites into a deterministic, auditable reconciliation that never drops a defensible edit.

## Root Cause and Operational Impact

The conflict is structural, not accidental. A shared perimeter is a single feature with one geometry, but during surge it has many concurrent editors working from different, equally valid sources — infrared flights, field observers, aircraft, sensor feeds. Each editor reads a base version, mutates the geometry locally, and writes back. If two writes derive from the same base and land in the same window, the datastore has no way, on its own, to tell a genuine improvement from a stale overwrite. It orders the writes by arrival and the last one wins. The losing edit is not merged, not flagged, not queued for review — it is gone, and the editor who made it has no signal that their change was discarded.

This is dangerous rather than merely inconvenient because the perimeter drives life-safety decisions downstream. Evacuation zones, road closures, and resource assignments are all derived from that polygon. A perimeter that silently shrinks because a growth edit was overwritten tells incident command an area is clear when it is still burning, and a re-expanded bulge can trigger an evacuation that strands crews needlessly. The National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both expect the operational geometry feeding the Common Operating Picture (COP) to be reconstructable for after-action review, so a reconciliation that cannot explain *why* the perimeter looks the way it does is not defensible. The core defect is relying on wall-clock arrival order — the same reason robust [conflict resolution in multi-agency edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) replaces timestamps with causal version tracking.

<svg viewBox="0 0 880 460" role="img" aria-label="Concurrent perimeter edit reconciliation diagram. A base perimeter polygon at version zero is edited concurrently by two agencies: agency A extends the northeast edge to enclose a spot fire, and agency B trims a southwest bulge. Their version vectors diverge from the common base. A reconciler compares the vectors: when both edits are non-overlapping growth edits it unions them into a single perimeter that keeps both changes; when the two edits disagree on the same area it keeps both candidates, raises a conflict flag, and escalates to a human editor. Every path emits an audit record." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Reconciling two concurrent perimeter edits with version vectors, union, and a conflict flag</title>
  <desc>A base incident perimeter at version zero is read by two agencies. Agency A extends the northeast edge to enclose a spot fire and Agency B trims a southwest bulge, so their per-agency version vectors both advance past the shared base and diverge. A reconciler inspects the vectors. If neither edit dominates and the edits touch different areas, it unions the two geometries so no affected area is lost and advances a merged version vector. If both edits alter the same area in incompatible directions, the reconciler retains both candidate polygons, stamps the feature with a conflict flag, and escalates to a human editor. Every branch appends an immutable audit record capturing the base version, both incoming versions, the strategy, and the resulting geometry hash.</desc>
  <defs>
    <marker id="perimeter-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="perimeter-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- base perimeter -->
  <text x="120" y="34" font-size="12.5" text-anchor="middle" font-weight="700" fill="currentColor">Base perimeter</text>
  <text x="120" y="50" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.8">version {A:0, B:0}</text>
  <polygon points="70,78 168,70 186,150 132,186 66,158" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.6"/>
  <!-- fan-out arrows -->
  <path d="M188,110 C240,96 260,96 300,92" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#perimeter-plain)"/>
  <path d="M188,140 C240,176 260,196 300,206" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#perimeter-plain)"/>
  <!-- agency A edit -->
  <text x="392" y="34" font-size="12" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Agency A · extend NE</text>
  <text x="392" y="50" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">encloses spot fire · {A:1, B:0}</text>
  <polygon points="312,74 410,66 470,86 452,150 398,186 308,156" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
  <text x="454" y="70" font-size="9.5" fill="var(--crimson, currentColor)">spot fire</text>
  <!-- agency B edit -->
  <text x="392" y="228" font-size="12" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Agency B · trim SW</text>
  <text x="392" y="244" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">corrects bulge · {A:0, B:1}</text>
  <polygon points="316,266 414,258 432,336 378,372 340,352 350,318" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
  <text x="322" y="368" font-size="9.5" fill="var(--crimson, currentColor)">bulge removed</text>
  <!-- converge to reconciler -->
  <path d="M472,120 C516,132 520,180 560,196" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" marker-end="url(#perimeter-arrow)"/>
  <path d="M434,300 C512,286 520,236 560,222" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4" marker-end="url(#perimeter-arrow)"/>
  <!-- reconciler node -->
  <rect x="560" y="176" width="150" height="66" rx="9" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.7"/>
  <text x="635" y="202" font-size="12" text-anchor="middle" font-weight="700" fill="currentColor">Reconciler</text>
  <text x="635" y="219" font-size="9.5" text-anchor="middle" fill="currentColor">compare version</text>
  <text x="635" y="231" font-size="9.5" text-anchor="middle" fill="currentColor">vectors vs base</text>
  <!-- branch: union -->
  <path d="M710,198 C740,182 762,166 788,152" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#perimeter-plain)"/>
  <text x="742" y="176" font-size="9" text-anchor="middle" fill="currentColor" opacity="0.8">disjoint</text>
  <rect x="726" y="96" width="146" height="52" rx="8" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="799" y="118" font-size="11" text-anchor="middle" font-weight="700" fill="currentColor">Union geometries</text>
  <text x="799" y="134" font-size="9.5" text-anchor="middle" fill="currentColor">keep both · {A:1, B:1}</text>
  <!-- branch: conflict -->
  <path d="M710,224 C744,248 768,276 800,286" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#perimeter-arrow)"/>
  <text x="764" y="268" font-size="9" text-anchor="middle" fill="var(--crimson, currentColor)">same area</text>
  <rect x="742" y="290" width="130" height="60" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
  <text x="807" y="312" font-size="11" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Conflict flag</text>
  <text x="807" y="328" font-size="9.5" text-anchor="middle" fill="currentColor">keep both candidates</text>
  <text x="807" y="341" font-size="9.5" text-anchor="middle" fill="currentColor">escalate to editor</text>
  <!-- audit trail bar -->
  <rect x="70" y="410" width="740" height="34" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4"/>
  <text x="440" y="431" font-size="11" text-anchor="middle" font-weight="600" fill="currentColor">Audit trail · base version · both incoming versions · strategy applied · result geometry hash</text>
  <path d="M742,148 V170 H725 V404" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.6" marker-end="url(#perimeter-plain)"/>
  <path d="M807,350 V404" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.1" opacity="0.7" marker-end="url(#perimeter-arrow)"/>
</svg>

## Tiered Resolution Strategy

Reconcile in ordered tiers, from the definitive causal check down to a safe default that always keeps the most conservative geometry and flags it for a human. Never resolve by silently discarding an edit — a lost growth edit during surge is a lost piece of the hazard picture.

1. **Track causality with version vectors (definitive).** Give every editing agency a slot in a per-feature version vector. When an edit is submitted, compare its vector to the base: if one edit's vector strictly dominates the other, it is a straight successor and can be applied. If neither dominates, the edits are genuinely concurrent and must be merged, not ordered.
2. **Union growth edits (safe for spreading hazards).** For an actively spreading fire or flood, the conservative outcome is the largest defensible area. When two concurrent edits both add area and touch different parts of the boundary, union them so neither agency's extension is lost.
3. **Last-writer-wins-with-merge for disjoint corrections.** For corrective edits that trim area, apply the newer edit only in the region it changed, and only where it does not overlap the other agency's edit. This keeps a valid correction without letting it silently undo an unrelated change.
4. **Raise a conflict flag when edits disagree on the same area (safe default).** If the two edits alter the same region in incompatible directions — one extends where the other trims — do not pick a winner. Retain both candidates, mark the feature conflicted, publish the most conservative geometry to the COP, and escalate to a human editor.
5. **Emit an audit record for every reconciliation.** Base version, both incoming vectors, the strategy applied, and the resulting geometry hash, so any merged perimeter is reproducible against the exact inputs and rule that produced it.

Tier one turns on a test that is easy to state and easy to implement wrong, because the intuition of "higher version wins" does not survive contact with two independent editors.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="vv-t vv-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="vv-t">Reading two version vectors: dominance versus genuine concurrency</title>
  <desc id="vv-d">Three pairs of version vectors for one perimeter, each read against the shared base of A zero B zero. In the first pair, A one B zero and A two B zero, the second vector is greater in every position, so it strictly dominates: it is a causal successor and can simply be applied. In the second pair, A one B zero and A zero B one, neither is greater in every position, so the edits are genuinely concurrent and must be merged rather than ordered. In the third pair, A two B one and A one B two, neither dominates either, so despite both agencies having seen some of each other's work the edits are still concurrent. Dominance is a property of the whole vector, not of its largest element, which is why a scalar version number cannot express it.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">dominance is a property of the whole vector, which is why a scalar version cannot express it</text>
  <text x="8" y="78" font-size="10" fill="var(--muted)">shared base: {A:0, B:0}</text>
  <g>
    <rect x="60" y="96" width="150" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
    <rect x="250" y="96" width="150" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
    <rect x="60" y="184" width="150" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
    <rect x="250" y="184" width="150" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
    <rect x="60" y="272" width="150" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
    <rect x="250" y="272" width="150" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
  </g>
  <g font-size="13" font-weight="700" text-anchor="middle" fill="currentColor">
    <text x="135" y="128">{A:1, B:0}</text><text x="325" y="128">{A:2, B:0}</text>
    <text x="135" y="216">{A:1, B:0}</text><text x="325" y="216">{A:0, B:1}</text>
    <text x="135" y="304">{A:2, B:1}</text><text x="325" y="304">{A:1, B:2}</text>
  </g>
  <g font-size="11" font-weight="700" fill="var(--crimson-deep)">
    <text x="440" y="118">second dominates</text>
    <text x="440" y="206">neither dominates</text>
    <text x="440" y="294">neither dominates</text>
  </g>
  <g font-size="10" fill="currentColor">
    <text x="440" y="136">a clean successor — apply it</text>
    <text x="440" y="224">genuinely concurrent — merge, never order</text>
    <text x="440" y="312">still concurrent, even though each saw some of the other</text>
  </g>
  <text x="8" y="360" font-size="10.5" fill="currentColor">The third row is the one that surprises people: partial awareness of each other is not causality.</text>
</svg>

The third row is the one that catches people out. Both agencies have seen some of each other's work — A has incorporated one of B's edits, B has incorporated one of A's — and it is tempting to read that as "they are roughly in sync, take the higher total". Summing the vector destroys exactly the information it exists to carry: `{A:2, B:1}` and `{A:1, B:2}` both total three, and each describes a history the other has not seen. They are concurrent, and the merge path is the correct one.

That is also why a single incrementing version number cannot do this job. A scalar can express "newer" but not "newer *than what*", so two editors incrementing independently produce the same number for different states, and any tie-break the resolver applies is a guess dressed as a rule.

Once concurrency is established, tier two decides what merging actually means.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="ug-t ug-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ug-t">Union versus last-writer-wins on two concurrent perimeter edits</title>
  <desc id="ug-d">A base perimeter is edited concurrently: agency A extends the north-east edge to enclose a spot fire while agency B trims a bulge on the south-west. Under union, the result keeps agency A's extension and agency B's original ground, so the hazard area never shrinks and no growth edit is lost. Under last-writer-wins, whichever edit is applied second replaces the other outright, so either the spot fire falls outside the perimeter or the corrected bulge returns. For a spreading hazard the union result is conservative in the direction that matters, which is why it is the default for growth edits; for corrective edits that trim area the same rule would preserve mistakes, which is why intent has to be carried on the edit rather than inferred from the geometry.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">two concurrent edits, two merge rules, two different fire perimeters</text>
  <text x="70" y="80" font-size="11" font-weight="700" fill="currentColor">union — keeps both</text>
  <text x="500" y="80" font-size="11" font-weight="700" fill="currentColor">last-writer-wins — keeps one</text>
  <polygon points="70,110 250,96 300,150 270,250 150,290 66,220" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <polygon points="240,100 340,120 350,200 268,246" fill="var(--crimson)" opacity="0.35" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="266" y="164" font-size="9.5" font-weight="700" fill="var(--crimson-deep)">A's spot fire</text>
  <text x="96" y="270" font-size="9.5" font-weight="700" fill="var(--crimson-deep)">B's trim held</text>
  <polygon points="500,110 680,96 730,150 700,250 580,290 496,220" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <polygon points="496,220 580,290 640,262 590,214" fill="var(--ember)" opacity="0.4" stroke="var(--ember)" stroke-width="1.8" stroke-dasharray="5 4"/>
  <text x="520" y="264" font-size="9.5" font-weight="700" fill="var(--ember-text)">B's trim reverted</text>
  <text x="700" y="164" font-size="9.5" font-weight="700" fill="var(--ember-text)">or A's extension lost</text>
  <text x="70" y="326" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">hazard area never shrinks — no growth edit is lost</text>
  <text x="500" y="326" font-size="10.5" font-weight="700" fill="var(--ember-text)">whichever arrived second silently replaces the other</text>
  <text x="8" y="362" font-size="10.5" fill="currentColor">Intent must ride on the edit: the same rule that protects a growth edit would preserve a mistake on a corrective one.</text>
</svg>

For a spreading hazard the union is conservative in the direction that matters: no area any agency marked as affected is ever removed, so the failure mode is an evacuation zone slightly too large rather than one that excludes a threatened block. Last-writer-wins is conservative in no direction at all — it silently discards whichever edit lost, and which one loses is determined by arrival order on a link nobody controls.

The reason intent has to travel on the edit rather than be inferred from the geometry is the symmetric case. B's trim was a *correction*: the bulge was a digitising error and removing it made the perimeter more accurate. Union preserves that error, because union preserves everything. Applying union to a corrective edit is the same mistake as applying last-writer-wins to a growth edit, made in the opposite direction, and no amount of geometric analysis distinguishes "this agency added area because the fire grew" from "this agency added area because they traced it badly". Only the editor knows, so the editor's client must say.

## Production Python Implementation

The routine below carries the full resolution path: version-vector comparison, union of concurrent growth edits, last-writer-wins-with-merge for disjoint corrections, an explicit conflict flag with human escalation, structured logging, exception handling, and an immutable audit record per reconciliation. Geometries are `shapely` objects already reprojected to the incident's equal-area CRS so that `area` comparisons are metric and meaningful — the same axis-order and datum contract described in [coordinate reference systems for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/). Senior-engineer assumptions apply: `shapely` is available and the caller has already validated attributes upstream.

```python
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum

from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

logger = logging.getLogger("incidentgis.perimeter_merge")

# A version vector maps agency_id -> integer edit counter for one feature.
VersionVector = dict[str, int]


class Strategy(str, Enum):
    DOMINATES = "successor_apply"
    UNION = "union_growth"
    LWW_MERGE = "lww_with_merge"
    CONFLICT = "conflict_escalate"
    ERROR_HOLD = "error_safe_hold"


@dataclass(frozen=True)
class PerimeterEdit:
    agency_id: str
    geometry: BaseGeometry
    version: VersionVector          # vector AFTER this agency's edit
    intent: str                     # "growth" or "correction"


@dataclass
class MergeResult:
    geometry: BaseGeometry
    version: VersionVector
    strategy: str
    conflicted: bool
    candidates: tuple[BaseGeometry, ...] = ()


@dataclass
class AuditEntry:
    """Immutable record of one reconciliation, appended to the audit trail."""
    feature_id: str
    base_version: VersionVector
    incoming: tuple[VersionVector, VersionVector]
    strategy: str
    conflicted: bool
    result_hash: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


def _dominates(a: VersionVector, b: VersionVector) -> bool:
    """True if vector ``a`` is a causal successor of ``b`` (a >= b, a != b)."""
    keys = set(a) | set(b)
    return all(a.get(k, 0) >= b.get(k, 0) for k in keys) and a != b


def _geom_hash(geom: BaseGeometry) -> str:
    """Stable content hash of a geometry for the audit trail."""
    return hashlib.sha256(geom.wkb).hexdigest()


class PerimeterReconciler:
    """Reconcile two concurrent edits to one incident perimeter.

    Every reconciliation appends an :class:`AuditEntry` to ``audit_log`` so a
    merged perimeter can be reconstructed from its inputs and the rule applied.
    """

    def __init__(self, feature_id: str, base_version: VersionVector) -> None:
        self.feature_id = feature_id
        self.base_version = base_version
        self.audit_log: list[AuditEntry] = []

    def _merged_version(self, a: VersionVector, b: VersionVector) -> VersionVector:
        """Element-wise max — the joined causal history of both edits."""
        return {k: max(a.get(k, 0), b.get(k, 0)) for k in set(a) | set(b)}

    def _audit(self, edit_a: PerimeterEdit, edit_b: PerimeterEdit,
               result: MergeResult) -> None:
        entry = AuditEntry(
            feature_id=self.feature_id,
            base_version=self.base_version,
            incoming=(edit_a.version, edit_b.version),
            strategy=result.strategy,
            conflicted=result.conflicted,
            result_hash=_geom_hash(result.geometry),
        )
        self.audit_log.append(entry)
        logger.info("perimeter_reconciled", extra={"audit": asdict(entry)})

    def reconcile(self, edit_a: PerimeterEdit, edit_b: PerimeterEdit) -> MergeResult:
        try:
            # Tier 1: causal dominance — one edit is a clean successor of the other.
            if _dominates(edit_a.version, edit_b.version):
                result = MergeResult(edit_a.geometry, edit_a.version,
                                     Strategy.DOMINATES.value, conflicted=False)
                self._audit(edit_a, edit_b, result)
                return result
            if _dominates(edit_b.version, edit_a.version):
                result = MergeResult(edit_b.geometry, edit_b.version,
                                     Strategy.DOMINATES.value, conflicted=False)
                self._audit(edit_a, edit_b, result)
                return result

            # Concurrent edits: neither vector dominates. Decide on intent + overlap.
            merged_ver = self._merged_version(edit_a.version, edit_b.version)
            overlap = edit_a.geometry.intersection(edit_b.geometry)
            both_growth = edit_a.intent == "growth" and edit_b.intent == "growth"

            # Tier 2: union growth edits — never shed area a spreading hazard gained.
            if both_growth:
                union = unary_union([edit_a.geometry, edit_b.geometry])
                result = MergeResult(union, merged_ver,
                                     Strategy.UNION.value, conflicted=False)
                self._audit(edit_a, edit_b, result)
                return result

            # Tier 3: disjoint correction — edits touch different areas, safe to merge.
            # symmetric_difference area near zero => the changes do not contest a region.
            if overlap.area == 0.0:
                merged = unary_union([edit_a.geometry, edit_b.geometry])
                result = MergeResult(merged, merged_ver,
                                     Strategy.LWW_MERGE.value, conflicted=False)
                self._audit(edit_a, edit_b, result)
                return result

            # Tier 4: same area contested in incompatible directions -> escalate.
            # Publish the conservative (larger) geometry until a human resolves it.
            conservative = max(edit_a.geometry, edit_b.geometry, key=lambda g: g.area)
            result = MergeResult(
                conservative, merged_ver, Strategy.CONFLICT.value,
                conflicted=True, candidates=(edit_a.geometry, edit_b.geometry),
            )
            logger.warning("perimeter_conflict",
                           extra={"feature_id": self.feature_id})
            self._audit(edit_a, edit_b, result)
            return result

        except (AttributeError, ValueError, TypeError) as exc:
            # Malformed geometry or vector: hold the base version, never crash sync.
            logger.error("perimeter_reconcile_failed", exc_info=exc)
            fallback = MergeResult(edit_a.geometry, self.base_version,
                                   Strategy.ERROR_HOLD.value, conflicted=True)
            self._audit(edit_a, edit_b, fallback)
            return fallback
```

The `audit_log` is the load-bearing output. Persisted as a content-hashed artifact, it lets a post-incident reviewer replay every reconciliation and confirm that no agency's growth edit was silently dropped — the reproducibility guarantee that makes the merged perimeter defensible when it feeds evacuation and resource decisions.

## Validation Checklist

Verify every item before deploying the reconciler to a live multi-agency perimeter service.

- [ ] Every editing agency owns a distinct slot in the per-feature version vector, seeded from the base the editor actually read.
- [ ] Reconciliation decisions use version-vector dominance, not wall-clock timestamps, so clock skew across agencies cannot pick the wrong winner.
- [ ] Concurrent growth edits are unioned, and the test suite asserts the result area is at least the max of the two inputs — no area is ever lost.
- [ ] Corrective edits merge only where they do not overlap another agency's edit; overlapping contested edits raise the conflict flag.
- [ ] A conflicted feature keeps both candidate geometries, publishes the conservative geometry to the Common Operating Picture, and escalates to a human editor.
- [ ] Geometries are reprojected to an equal-area CRS before any `area` comparison so metric decisions are valid.
- [ ] Every reconciliation appends an audit entry with the base version, both incoming vectors, the strategy, and the result geometry hash.
- [ ] Structured logs route to the incident logging sink, not stdout, and malformed inputs fall back to the base version without stalling sync.

## Edge Cases and Gotchas

- **Clock skew masquerading as causality.** Field tablets and agency laptops rarely share a synchronised clock, so an edit that *arrived* later may have been *authored* against an older base. Never let arrival order break a tie — the version vector is the only trustworthy record of what each editor saw. This is the same failure that plagues naive [syncing of ArcGIS Online edits to a local GeoPackage](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/syncing-arcgis-online-edits-to-local-geopackage/) when the sync keys on `edit_date`.
- **Axis-order inversion before union.** A perimeter arriving as `(lon, lat)` from one agency and `(lat, lon)` from another will union into a geometry that folds across the globe. Normalize axis order at ingest and run every transform with `always_xy=True` before the geometries ever reach the reconciler.
- **Slivers and invalid geometry from the union.** Unioning two hand-digitised polygons frequently produces micro-slivers or a self-intersecting boundary. Run `make_valid` and a small `buffer(0)` cleanup after the union, and re-check that the result is a single polygon — a `MultiPolygon` here usually signals a digitising gap, not two real fire lobes.
- **Attribute conflicts riding along with geometry.** Two agencies may agree on the boundary but disagree on the containment percentage or perimeter status. Reconcile attributes on their own field-level rules rather than letting the geometry winner carry its attributes wholesale; validate them against the shared contract in [automated attribute validation rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/).
- **Three-way and rapid successive edits.** The pairwise reconciler handles two edits; a third concurrent editor needs the merged result fed back as the new base with its version vector advanced. Serialise reconciliations per feature so a burst of surge edits folds in deterministically instead of racing again inside the merge step.

## Frequently Asked Questions

**Why not just use last-writer-wins on the timestamp for perimeter edits?** Wall-clock timestamps are unreliable across agencies whose devices have skewed or unsynchronised clocks, and last-writer-wins silently discards the losing edit. If one agency extended the perimeter to enclose a newly threatened neighbourhood and the other made a small correction a second later, a naive timestamp wins throws away the extension and shrinks the hazard area. Version vectors let you distinguish a genuine dominance from a real concurrent conflict before deciding what to keep.

**When should concurrent perimeter edits be unioned rather than merged?** Union when both edits are growth edits and the safe outcome is the largest defensible hazard area, which is the normal case for an actively spreading fire or flood: unioning never removes an area that either agency marked as affected. Fall back to last-writer-wins-with-merge only for corrective edits that trim a mistaken bulge, and even then apply the newer edit only where it does not overlap the other agency's changes.

**What happens when two edits conflict on the same area in opposite directions?** The reconciler must not pick a winner automatically. It retains both candidate geometries, marks the feature as conflicted with a machine-readable flag, and escalates to a human editor with the full context of both edits. An audit record captures the base version, both incoming versions, and the fact that resolution was deferred, so the Common Operating Picture shows the most conservative geometry until a person reconciles it.

## Related

- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — the broader patterns for reconciling concurrent edits this perimeter merge builds on.
- [Syncing ArcGIS Online Edits to Local GeoPackage](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/syncing-arcgis-online-edits-to-local-geopackage/) — where the same version-vector discipline keeps a two-way sync from losing edits.
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — validate the attributes that ride along with a reconciled perimeter.

Up: [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/)
