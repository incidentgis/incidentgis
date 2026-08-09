---
title: "Conflict Resolution in Multi-Agency Edits"
description: "Production Python workflow for resolving concurrent multi-agency GIS edit conflicts: precedence-weighted attribute merges, spatial overlap reconciliation, offline replay, and immutable audit logging."
slug: conflict-resolution-in-multi-agency-edits
type: guide
breadcrumb: "Conflict Resolution"
datePublished: "2025-02-21"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Conflict Resolution in Multi-Agency Edits: Python GIS Workflows",
      "description": "Production Python workflow for resolving concurrent multi-agency GIS edit conflicts: precedence-weighted attribute merges, spatial overlap reconciliation, offline replay, and immutable audit logging.",
      "datePublished": "2025-02-21",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Incident Mapping & Multi-Agency Sync", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/" },
        { "@type": "ListItem", "position": 3, "name": "Conflict Resolution in Multi-Agency Edits", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Resolve concurrent multi-agency GIS edit conflicts in Python",
      "description": "Ingest distributed delta logs, classify spatial and attribute conflicts, apply precedence-weighted resolution, and emit an immutable audit trail.",
      "step": [
        { "@type": "HowToStep", "name": "Ingest and version-tag deltas", "text": "Extract created/updated/deleted records from each agency replica and tag every delta with source_agency, edit timestamp, and sequence number." },
        { "@type": "HowToStep", "name": "Validate and classify conflicts", "text": "Repair invalid geometry, detect spatial overlaps, and flag attribute divergence on the shared merge key." },
        { "@type": "HowToStep", "name": "Resolve with precedence-weighted merge", "text": "Apply ICS authority precedence first, fall back to last-writer-wins on ties, and quarantine unresolvable spatial overlaps." },
        { "@type": "HowToStep", "name": "Commit and emit audit record", "text": "Write the reconciled feature state and an immutable audit entry capturing the original state, delta, and resolution rule." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should multi-agency edit conflicts use last-writer-wins?",
          "acceptedText": "",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Pure last-writer-wins is unsafe for incident GIS because a stale offline edit can overwrite an authoritative one. Apply Incident Command System authority precedence first and use last-writer-wins only to break ties between equal-authority agencies."
          }
        },
        {
          "@type": "Question",
          "name": "How are spatial overlap conflicts resolved automatically?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Overlaps that share a stable merge key are merged on attributes; overlaps between distinct features are routed to a quarantine table for supervisor adjudication rather than auto-merged, because automatically collapsing two real perimeters can hide a resource gap."
          }
        },
        {
          "@type": "Question",
          "name": "Why must area be computed in a projected CRS?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "geopandas overlay preserves the input CRS. In EPSG:4326 the .area property returns square degrees, not square metres, so overlap thresholds must be evaluated after reprojecting to a metric CRS such as an appropriate UTM zone."
          }
        }
      ]
    }
  ]
}
</script>

# Conflict Resolution in Multi-Agency Edits: Python GIS Workflows

A fire branch redraws an evacuation perimeter at 14:02. A sheriff's deputy, still on a degraded cellular link, syncs an hour-old replica at 14:47 that reopens a structure the fire branch already closed. If the synchronization layer applies a naive last-writer-wins merge, the closed structure resurrects as "active," units are committed to stale geometry, and the after-action review (AAR) inherits a timeline that cannot be reconciled. That single overwrite is the operational failure this workflow exists to prevent: deterministic, auditable reconciliation of concurrent edits across jurisdictions that never silently discards an authoritative change. The wider architecture this slots into is defined in [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/), where versioned feature services, local replicas, and a central reconciliation engine operate under strict latency and data-integrity constraints.

## Prerequisites

This pattern assumes the upstream pipeline is already in place; it reconciles deltas, it does not clean them.

- **Python packages:** `geopandas >= 0.14`, `shapely >= 2.0` (for `make_valid` and the vectorised predicate API), `pandas`, and `sqlite3` from the standard library for offline replay. `pyproj` is pulled in transitively for reprojection.
- **CRS contract:** every delta arrives in EPSG:4326 for storage. Area and distance comparisons happen only after reprojection to a metric CRS (an appropriate UTM zone, or EPSG:3857 for coarse display thresholds). Mixed-axis-order payloads must already be normalised — that normalisation is owned by [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/), and feeding un-normalised coordinates into the resolver produces false-positive overlap flags from projection drift.
- **Schema contract:** every feature carries a stable, globally unique merge key (`incident_id`), an `agency_type` that maps to an Incident Command System (ICS) authority tier, and a monotonic `last_edited` timestamp. Records that fail the field contract should be rejected by [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) before they ever reach this stage.

## Conflict Taxonomy and Resolution Flow

Edit conflicts in tactical GIS manifest along three axes: **spatial topology** violations (intersecting evacuation zones, overlapping hazard perimeters), **attribute divergence** (conflicting severity, status, or resource counts on the same `incident_id`), and **temporal sequencing** mismatches (an offline replica replaying older edits over newer ones). The resolver treats these in a fixed order — repair geometry, classify, then resolve — so the outcome is reproducible regardless of which replica synced first.

<svg viewBox="0 0 960 520" role="img" aria-label="Decision flowchart for the conflict resolver. An incoming tagged delta is first checked for valid geometry; invalid geometry is repaired with make_valid, and unrecoverable geometry is dropped. The delta is then tested for whether it shares the merge key with the base feature. If it does, an attribute-conflict check runs: differing attributes go to a precedence compare of FEDERAL over STATE over LOCAL over VOLUNTEER, where a clear authority winner is committed and an equal-authority tie falls back to last-writer-wins, both ending in a single commit plus immutable audit step. If the delta does not share the merge key but overlaps a distinct feature in metric area, it routes to the conflict_quarantine table for GIS supervisor adjudication." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Resolver decision flow: repair, classify, resolve by authority, commit with audit</title>
  <desc>A tagged delta enters and is validated: invalid geometry is repaired with make_valid, unrecoverable geometry is dropped. The resolver then branches on the merge key. When the delta shares the base merge key and attributes diverge, it runs a precedence compare — FEDERAL over STATE over LOCAL over VOLUNTEER — committing the authority winner, or falling back to last-writer-wins on an equal-authority tie; both paths end at a single commit-and-audit step that writes the reconciled state and an immutable audit row in one transaction. When the delta does not share the merge key but spatially overlaps a distinct feature beyond the area threshold, it is never auto-merged: it routes to the conflict_quarantine table for GIS supervisor adjudication.</desc>
  <defs>
    <marker id="cr-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="cr-flow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <!-- entry -->
    <rect x="20" y="38" width="150" height="44" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="95" y="58" font-weight="700">Tagged delta in</text>
    <text x="95" y="74" font-size="10.5">incident_id · agency_type</text>
    <!-- geometry valid? (diamond) -->
    <path d="M285,30 L360,60 L285,90 L210,60 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="285" y="56" font-size="11">Geometry</text>
    <text x="285" y="70" font-size="11">valid?</text>
    <!-- repair -->
    <rect x="232" y="132" width="106" height="42" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="285" y="151" font-size="11">make_valid()</text>
    <text x="285" y="166" font-size="10">repair geometry</text>
    <!-- drop -->
    <rect x="386" y="38" width="104" height="44" rx="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/>
    <text x="438" y="57" font-size="11">Drop + log</text>
    <text x="438" y="72" font-size="10">unrecoverable</text>
    <!-- shares merge key? (diamond) -->
    <path d="M285,232 L372,266 L285,300 L198,266 Z" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="285" y="262" font-size="11">Shares merge</text>
    <text x="285" y="276" font-size="11">key (base)?</text>
    <!-- attribute conflict? (diamond, left/yes path) -->
    <path d="M285,360 L368,392 L285,424 L202,392 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="285" y="388" font-size="11">Attribute</text>
    <text x="285" y="402" font-size="11">conflict?</text>
    <!-- precedence compare -->
    <rect x="478" y="350" width="166" height="62" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="561" y="372" font-weight="600" font-size="11.5">Precedence compare</text>
    <text x="561" y="389" font-size="10">FEDERAL &gt; STATE &gt;</text>
    <text x="561" y="402" font-size="10">LOCAL &gt; VOLUNTEER</text>
    <!-- tie? (diamond) -->
    <path d="M561,452 L636,482 L561,512 L486,482 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="561" y="478" font-size="11">Equal</text>
    <text x="561" y="492" font-size="11">authority?</text>
    <!-- last-writer-wins -->
    <rect x="684" y="451" width="150" height="44" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="759" y="470" font-size="11">Last-writer-wins</text>
    <text x="759" y="485" font-size="10">newest last_edited</text>
    <!-- commit + audit -->
    <rect x="700" y="350" width="160" height="62" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="780" y="374" font-weight="700">Commit + audit</text>
    <text x="780" y="391" font-size="10">reconciled state +</text>
    <text x="780" y="404" font-size="10">immutable audit row</text>
    <!-- spatial overlap (distinct feature) branch -->
    <path d="M561,232 L660,266 L561,300 L462,266 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="561" y="262" font-size="11">Overlaps distinct</text>
    <text x="561" y="276" font-size="11">feature?</text>
    <!-- quarantine -->
    <rect x="700" y="244" width="160" height="44" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="780" y="263" font-weight="600" font-size="11">conflict_quarantine</text>
    <text x="780" y="278" font-size="10">supervisor adjudication</text>
  </g>
  <!-- primary flows -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#cr-flow)">
    <path d="M170,60 H208"/>
    <!-- geometry yes → shares merge key -->
    <path d="M285,90 V230"/>
    <!-- shares key YES → attribute conflict -->
    <path d="M285,300 V358"/>
    <!-- attribute conflict YES → precedence -->
    <path d="M368,392 H476"/>
    <!-- precedence → commit -->
    <path d="M644,381 H698"/>
    <!-- tie NO (authority winner direct from compare): compare → commit already covers; tie YES → LWW -->
    <path d="M636,482 H682"/>
    <!-- LWW → commit -->
    <path d="M759,451 V414"/>
    <!-- shares key NO → overlap diamond -->
    <path d="M372,266 H460"/>
    <!-- overlap YES → quarantine -->
    <path d="M660,266 H698"/>
  </g>
  <!-- secondary / repair flows -->
  <g fill="none" stroke="currentColor" stroke-width="1.4">
    <!-- geometry NO → repair -->
    <path d="M270,84 L285,132" marker-end="url(#cr-flow-dim)"/>
    <!-- repair back up into shares-key (re-enter) -->
    <path d="M232,153 H190 V266 H196" marker-end="url(#cr-flow-dim)"/>
    <!-- geometry unrecoverable → drop -->
    <path d="M338,46 H384" marker-end="url(#cr-flow-dim)"/>
    <!-- attribute conflict NO → commit (no-op merge, accept delta) -->
    <path d="M285,424 V446 H780 V414" marker-end="url(#cr-flow-dim)"/>
  </g>
  <!-- edge labels -->
  <g font-size="9.5" fill="currentColor" text-anchor="middle">
    <text x="186" y="52">no</text>
    <text x="408" y="34">no fix</text>
    <text x="300" y="120">repair</text>
    <text x="298" y="226" fill="var(--crimson, currentColor)">yes</text>
    <text x="418" y="258">no</text>
    <text x="300" y="354">yes</text>
    <text x="423" y="384">yes</text>
    <text x="305" y="440">no</text>
    <text x="668" y="270" fill="var(--crimson, currentColor)">yes</text>
    <text x="664" y="474">tie</text>
    <text x="672" y="375" font-size="9">winner</text>
  </g>
</svg>

Of the three axes, the spatial one is the only one whose severity is continuous, and that turns out to matter more than it sounds. Attribute divergence and temporal sequencing are categorical — two values either differ or they do not, one edit either precedes another or it does not. Two polygons, by contrast, overlap by an *amount*, and almost every pair of hand-digitised perimeters overlaps a little.

<svg viewBox="0 0 880 400" role="img" aria-labelledby="ovl-title ovl-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ovl-title">The same overlap predicate producing opposite verdicts on either side of the 100 square metre threshold</title>
  <desc id="ovl-desc">Two panels of overlapping agency perimeters. On the left, two evacuation polygons genuinely overlap across a wide region measuring about 4,170 square metres; because that exceeds the 100 square metre quarantine threshold it is treated as a real disagreement about who owns the ground, so the feature is quarantined and both agencies are notified. On the right, two polygons share what is effectively the same boundary, differing only by a digitising sliver of about 12 square metres drawn twenty times wider than scale for visibility; because it falls under the threshold it is snapped and merged automatically with no human involvement. The geometric test is identical in both cases — only the magnitude differs — which is why the threshold, not the predicate, is the operational decision.</desc>
  <rect x="0" y="0" width="880" height="400" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">RESOLVER_OVERLAP_M2 = 100 — the same predicate, opposite verdicts</text>
  <text x="60" y="76" font-size="11" font-weight="700" fill="currentColor">A · genuine overlap</text>
  <text x="500" y="76" font-size="11" font-weight="700" fill="currentColor">B · digitising sliver</text>
  <!-- panel A -->
  <polygon points="60,110 290,90 310,270 80,290" fill="var(--petal-soft)" opacity="0.85" stroke="var(--crimson)" stroke-width="1.8"/>
  <polygon points="230,120 430,100 450,280 250,300" fill="var(--petal)" opacity="0.6" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <polygon points="230,120 292.6,113.7 310,270 247.3,275.5" fill="var(--ember)" opacity="0.55" stroke="var(--ember)" stroke-width="2"/>
  <text x="88" y="180" font-size="10.5" fill="currentColor">county</text>
  <text x="372" y="180" font-size="10.5" fill="currentColor">state</text>
  <!-- panel B -->
  <polygon points="500,110 690,100 700,280 510,290" fill="var(--petal-soft)" opacity="0.85" stroke="var(--crimson)" stroke-width="1.8"/>
  <polygon points="694,102 860,110 850,285 704,278" fill="var(--petal)" opacity="0.6" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <polygon points="690,100 694,102 704,278 700,280" fill="var(--ember)" stroke="var(--ember)" stroke-width="2"/>
  <text x="528" y="180" font-size="10.5" fill="currentColor">county</text>
  <text x="770" y="180" font-size="10.5" fill="currentColor">state</text>
  <text x="560" y="318" font-size="9.5" fill="var(--muted)">sliver drawn 20× wide</text>
  <!-- verdicts -->
  <text x="60" y="330" font-size="11" font-weight="700" fill="var(--crimson-deep)">4 170 m² &gt; 100 m²</text>
  <text x="60" y="348" font-size="10.5" fill="currentColor">quarantine · both agencies notified</text>
  <text x="500" y="330" font-size="11" font-weight="700" fill="var(--crimson-deep)">12 m² &lt; 100 m²</text>
  <text x="500" y="348" font-size="10.5" fill="currentColor">snap and merge · no human involved</text>
  <!-- scale -->
  <path d="M60 374 H160 M60 369 V379 M160 369 V379" fill="none" stroke="var(--muted)" stroke-width="1.4"/>
  <text x="168" y="378" font-size="10" fill="var(--muted)">65 m</text>
</svg>

Without a threshold, the resolver would quarantine essentially every pair of adjacent perimeters in the incident, because two analysts tracing the same ridge line will never produce coincident vertices. `RESOLVER_OVERLAP_M2` is what converts "these polygons intersect" — always true, operationally meaningless — into "these agencies disagree about who owns this ground", which is the question worth waking someone for. Set it too low and the review queue fills with digitising noise until operators start clearing it without reading; set it too high and a genuine hundred-metre disagreement about an evacuation boundary merges silently.

One caution about how that area is measured. The default `RESOLVER_AREA_CRS` of EPSG:3857 is convenient and wrong for this purpose at any temperate latitude — a 100 m² threshold evaluated in Web Mercator at 45° N is really a 50 m² threshold, and at 60° N a 25 m² one, so the resolver becomes progressively more sensitive the further north the incident sits. Set it to the incident's UTM zone, as the [coordinate reference system standard](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) requires for any area comparison, and the threshold means the same thing everywhere.

## Step-by-Step Implementation

The service follows a staged execution model — ingestion, validation/classification, resolution, commit — and each stage is stateless so it can run in a container and be horizontally scaled behind the ingestion queue.

### 1. Delta ingestion and version tracking

The reconciliation engine extracts `created`, `updated`, and `deleted` records from each agency replica and tags every delta with provenance before any merge logic runs. Concurrent sync requests are handled with `asyncio`; the snippet below isolates the tagging contract that the later stages depend on.

```python
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
)
logger = logging.getLogger("conflict.ingest")

DeltaOp = Literal["created", "updated", "deleted"]


@dataclass(frozen=True)
class TaggedDelta:
    incident_id: str
    op: DeltaOp
    source_agency: str
    agency_type: str            # FEDERAL | STATE | LOCAL | VOLUNTEER
    last_edited: datetime
    edit_sequence: int
    payload: dict = field(default_factory=dict)


def tag_delta(raw: dict, source_agency: str, agency_type: str) -> TaggedDelta:
    """Attach provenance to a raw edit. Rejects payloads missing the merge key."""
    try:
        return TaggedDelta(
            incident_id=raw["incident_id"],
            op=raw["op"],
            source_agency=source_agency,
            agency_type=agency_type,
            last_edited=datetime.fromisoformat(raw["last_edited"]).astimezone(timezone.utc),
            edit_sequence=int(raw["edit_sequence"]),
            payload=raw.get("payload", {}),
        )
    except (KeyError, ValueError) as exc:
        logger.error("Dropping untaggable delta from %s: %s", source_agency, exc)
        raise
```

### 2. Validation and conflict classification

Geometry is repaired before any spatial predicate runs — an invalid self-intersecting polygon will raise inside `overlay()` and abort the whole batch otherwise. The classifier returns explicit conflict reports rather than mutating state, so resolution and commit stay separable and testable.

```python
import geopandas as gpd
from shapely.geometry import shape
from shapely.validation import make_valid
from typing import Optional

logger = logging.getLogger("conflict.classify")


def validate_geometry(geom_dict: dict) -> Optional[gpd.GeoSeries]:
    """Repair invalid geometry; return None (and log) on unrecoverable input."""
    try:
        geom = shape(geom_dict)
        if not geom.is_valid:
            logger.warning("Repairing invalid geometry via make_valid")
            geom = make_valid(geom)
        return gpd.GeoSeries([geom], crs="EPSG:4326")
    except Exception as exc:  # noqa: BLE001 - geometry libs raise a wide set
        logger.error("Geometry validation failed: %s", exc)
        return None


def classify_spatial_overlap(
    gdf_a: gpd.GeoDataFrame,
    gdf_b: gpd.GeoDataFrame,
    crs_metric: str = "EPSG:3857",
) -> list[dict]:
    """
    Report intersecting features. Area is measured in a metric CRS, never in
    EPSG:4326 degrees, so overlap thresholds are expressed in square metres.
    """
    conflicts: list[dict] = []
    try:
        a_m = gdf_a.to_crs(crs_metric)
        b_m = gdf_b.to_crs(crs_metric)
        intersections = gpd.overlay(a_m, b_m, how="intersection")
        for _, row in intersections.iterrows():
            conflicts.append({
                "feature_ids": [row.get("id_1"), row.get("id_2")],
                "overlap_area_m2": float(row.geometry.area),
                "same_merge_key": row.get("id_1") == row.get("id_2"),
                "resolution_status": "PENDING_REVIEW",
            })
    except Exception as exc:  # noqa: BLE001
        logger.error("Spatial overlay failed: %s", exc)
    return conflicts
```

### 3. Precedence-weighted attribute resolution

Attribute conflicts on a shared `incident_id` resolve on ICS authority first; last-writer-wins is the tiebreaker only, never the primary rule. This is the inversion of naive sync: a fresh `VOLUNTEER` edit must never overwrite an older `FEDERAL` one.

```python
logger = logging.getLogger("conflict.resolve")

AGENCY_PRECEDENCE: dict[str, int] = {
    "FEDERAL": 3,
    "STATE": 2,
    "LOCAL": 1,
    "VOLUNTEER": 0,
}


def resolve_attribute_conflict(
    base: TaggedDelta,
    delta: TaggedDelta,
    precedence: dict[str, int] = AGENCY_PRECEDENCE,
) -> TaggedDelta:
    """Authority precedence wins; equal authority falls back to last-writer-wins."""
    try:
        base_rank = precedence[base.agency_type]
        delta_rank = precedence[delta.agency_type]
    except KeyError as exc:
        logger.critical("Unknown agency_type in precedence map: %s", exc)
        raise ValueError("Incomplete payload for conflict evaluation") from exc

    if delta_rank != base_rank:
        winner = delta if delta_rank > base_rank else base
        logger.info(
            "Resolved %s by authority: %s (%s) over %s",
            base.incident_id, winner.source_agency, winner.agency_type,
            base.source_agency if winner is delta else delta.source_agency,
        )
        return winner

    winner = delta if delta.last_edited >= base.last_edited else base
    logger.info("Resolved %s by last-writer-wins: %s", base.incident_id, winner.source_agency)
    return winner
```

### 4. Offline replay and commit with audit emission

Field operations run in degraded-network environments, so the resolver must replay edits cached during an outage and reconcile them against the canonical state on reconnect. Local replicas use SQLite; the SQLite-backed storage and delta-extraction patterns are covered in depth by [Syncing ArcGIS Online edits to local GeoPackage](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/syncing-arcgis-online-edits-to-local-geopackage/). Every committed resolution emits an immutable audit row.

```python
import json
import sqlite3

logger = logging.getLogger("conflict.commit")


def commit_resolution(conn: sqlite3.Connection, base: TaggedDelta, winner: TaggedDelta) -> None:
    """Apply the reconciled state and append an immutable audit record atomically."""
    rule = "authority" if winner.agency_type != base.agency_type else "last_writer_wins"
    try:
        with conn:  # transactional: feature update + audit insert commit together
            conn.execute(
                "UPDATE cop_features SET payload = ?, last_edited = ?, source_agency = ? "
                "WHERE incident_id = ?",
                (json.dumps(winner.payload), winner.last_edited.isoformat(),
                 winner.source_agency, winner.incident_id),
            )
            conn.execute(
                "INSERT INTO audit_log "
                "(incident_id, original_state, delta_state, resolution_rule, ts_utc) "
                "VALUES (?, ?, ?, ?, ?)",
                (base.incident_id, json.dumps(base.payload), json.dumps(winner.payload),
                 rule, datetime.now(timezone.utc).isoformat()),
            )
    except sqlite3.Error as exc:
        logger.error("Commit failed for %s, rolling back: %s", base.incident_id, exc)
        raise
```

Unresolvable spatial overlaps between **distinct** features (where `same_merge_key` is false) are never auto-merged. They route to a `conflict_quarantine` table with the full payload preserved for adjudication by a GIS supervisor — automatically collapsing two real perimeters can hide a resource gap, which is exactly the failure class this workflow guards against.

## Configuration Reference

These parameters are the tunable surface of the resolver. Treat them as policy, version-controlled alongside the service, not as inline constants.

| Parameter | Env var | Default | Purpose |
|-----------|---------|---------|---------|
| Agency precedence map | `RESOLVER_PRECEDENCE_JSON` | `FEDERAL:3,STATE:2,LOCAL:1,VOLUNTEER:0` | ICS authority ranking that drives attribute merges |
| Metric CRS for area | `RESOLVER_AREA_CRS` | `EPSG:3857` | CRS used before computing overlap area; set to a UTM zone for accuracy |
| Overlap quarantine threshold | `RESOLVER_OVERLAP_M2` | `100.0` | Min overlap (m²) between distinct features that triggers quarantine |
| Replay batch size | `RESOLVER_BATCH` | `500` | Deltas reconciled per micro-batch on reconnect |
| Retry backoff base | `RESOLVER_BACKOFF_S` | `2.0` | Base seconds for exponential backoff on transient sync failures |
| Clock-skew tolerance | `RESOLVER_SKEW_S` | `5.0` | Allowed `last_edited` skew before a tie is logged as suspect |

The skew tolerance is the parameter most likely to be misread as a precision setting, so it is worth being explicit about what it selects between.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="skew-title skew-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="skew-title">How the five-second clock-skew tolerance decides whether two edits can be ordered by time</title>
  <desc id="skew-desc">Two cases plotted on a twenty-second timeline. A shaded window of plus or minus five seconds around replica A's edit marks the span in which two timestamps cannot be trusted to order the edits, because the replicas' clocks are not synchronised to each other. In case one, replica B edits 1.2 seconds after replica A, inside the window, so the tie is recorded as suspect: the resolver falls back to agency precedence and raises a review flag rather than believing the clock. In case two, replica B edits 8.5 seconds after replica A, outside the window, so the later edit is treated as a genuine causal successor and applied in order. The tolerance is therefore not an error bar on the measurement — it is the boundary between two different resolution rules.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">RESOLVER_SKEW_S = 5.0 — the span in which timestamps cannot order two edits</text>
  <text x="201" y="76" font-size="10.5" fill="var(--muted)">±5 s skew window</text>
  <!-- case 1 -->
  <path d="M201 106 H471 V154 H201 Z" fill="var(--petal-soft)" opacity="0.9"/>
  <path d="M120 130 H660" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <text x="8" y="126" font-size="11" font-weight="700" fill="currentColor">case 1</text>
  <text x="8" y="142" font-size="10" fill="var(--muted)">Δ 1.2 s</text>
  <circle cx="336" cy="130" r="8" fill="var(--crimson)"/>
  <circle cx="368.4" cy="130" r="8" fill="var(--ember)"/>
  <text x="286" y="98" font-size="10" fill="currentColor">replica A</text>
  <text x="336" y="176" font-size="10" fill="currentColor">replica B</text>
  <text x="680" y="126" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">tie is suspect —</text>
  <text x="680" y="142" font-size="10.5" fill="currentColor">precedence + review flag</text>
  <!-- case 2 -->
  <path d="M201 226 H471 V274 H201 Z" fill="var(--petal-soft)" opacity="0.9"/>
  <path d="M120 250 H660" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <text x="8" y="246" font-size="11" font-weight="700" fill="currentColor">case 2</text>
  <text x="8" y="262" font-size="10" fill="var(--muted)">Δ 8.5 s</text>
  <circle cx="336" cy="250" r="8" fill="var(--crimson)"/>
  <circle cx="565.5" cy="250" r="8" fill="var(--crimson-deep)"/>
  <text x="286" y="218" font-size="10" fill="currentColor">replica A</text>
  <text x="516" y="296" font-size="10" fill="currentColor">replica B</text>
  <text x="680" y="246" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">genuine successor —</text>
  <text x="680" y="262" font-size="10.5" fill="currentColor">apply in causal order</text>
  <!-- shared axis -->
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="120" y="322">0 s</text><text x="255" y="322">5</text><text x="390" y="322">10</text>
    <text x="525" y="322">15</text><text x="660" y="322">20 s</text>
  </g>
  <text x="440" y="348" font-size="11" text-anchor="middle" fill="var(--muted)">The tolerance is not an error bar — it is the boundary between two different resolution rules.</text>
</svg>

Inside the window, the resolver is not saying "I cannot tell these apart to better than five seconds". It is saying something stronger: that the two timestamps carry no ordering information at all, because they were produced by clocks that were never synchronised to each other, and a 1.2-second difference is as likely to be a clock offset as an actual sequence. The correct response to no information is not to guess with a coin weighted by milliseconds — it is to fall back to a rule that does not depend on the clock, which is agency precedence, and to record that the fallback was used so the after-action review can find every decision made on that basis.

Outside the window, the assumption flips: a gap larger than any plausible skew is evidence of genuine causal ordering, and the later edit is applied as a successor. Choosing the value is therefore a question about your fleet rather than about the resolver. Devices synchronising against a common NTP source over a stable link hold well under a second and a two-second tolerance is generous; a fleet including tablets that have been off-network for hours can drift by tens of seconds, and a five-second setting will silently classify real successors as suspect ties. Measure the actual distribution of clock offsets across your devices at check-in and set the tolerance from its tail, not from a round number.

## Verification and Smoke Test

Before promoting a resolver build to staging, assert the two invariants that field incidents actually depend on: authority must beat recency, and area thresholds must be evaluated in metres. The block below is runnable against the functions above with no external service.

```python
from datetime import timedelta


def _smoke() -> None:
    now = datetime.now(timezone.utc)
    base = TaggedDelta("INC-001", "updated", "USFS", "FEDERAL", now, 10, {"status": "closed"})
    # A NEWER volunteer edit must NOT win over an older federal edit.
    stale_authority_vs_fresh_volunteer = TaggedDelta(
        "INC-001", "updated", "CERT", "VOLUNTEER", now + timedelta(minutes=45), 11,
        {"status": "active"},
    )
    winner = resolve_attribute_conflict(base, stale_authority_vs_fresh_volunteer)
    assert winner is base, "authority precedence must override recency"
    assert winner.payload["status"] == "closed"
    logger.info("smoke ok: authority precedence holds")


if __name__ == "__main__":
    _smoke()
```

Run it as a CI gate:

```bash
python -m conflict.resolver && echo "resolver smoke PASS"
```

## Integration with Adjacent Workflows

The resolver is the reconciliation stage of a longer pipeline and depends on its neighbours holding their contracts. Coordinates must be canonicalised upstream by [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) so that overlap classification does not fire on projection drift, and the field-level schema must already be enforced by [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) so the merge key and `agency_type` are guaranteed present. High-frequency edit streams from sensors, UAV feeds, and mobile CAD terminals are decoupled from reconciliation by [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/), which buffers deltas into a queue and feeds the resolver in micro-batches to prevent head-of-line blocking on the command console.

## Troubleshooting

**Symptom: `gpd.overlay` raises `TopologyException` mid-batch.** Root cause: an invalid input geometry slipped past validation. Ensure every feature passes through `validate_geometry` before it enters `classify_spatial_overlap`; `make_valid` resolves self-intersections and ring-order errors that abort the C-level predicate.

**Symptom: overlap areas look absurdly small (e.g. `0.0003`).** Root cause: area was computed in EPSG:4326, so the units are square degrees. Reproject to a metric CRS first — `classify_spatial_overlap` calls `to_crs` for exactly this reason; verify no caller bypasses it.

**Symptom: a closed feature reopens after a replica reconnects.** Root cause: the merge fell through to last-writer-wins because both records carried the same `agency_type`, or the offline replica's clock was ahead. Confirm `agency_type` is populated (not defaulted) and that `last_edited` is UTC; widen `RESOLVER_SKEW_S` only after auditing the device clocks.

**Symptom: distinct perimeters silently collapse into one feature.** Root cause: a quarantine path was bypassed and two features sharing an overlap but **not** a merge key were auto-merged. Assert `same_merge_key` before merging; route everything else to `conflict_quarantine`.

**Symptom: audit rows are missing for some commits.** Root cause: the feature update and audit insert were not in one transaction, so a mid-commit error left the update applied but the audit row absent. Keep both writes inside the single `with conn:` block in `commit_resolution` so they commit or roll back together.

## Related

- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) — canonicalise coordinates before reconciliation
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — enforce the merge-key and field contract upstream
- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — decouple high-frequency edit streams from the resolver
- [Syncing ArcGIS Online edits to local GeoPackage](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/syncing-arcgis-online-edits-to-local-geopackage/) — offline replica storage and delta extraction

Up: [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/)
