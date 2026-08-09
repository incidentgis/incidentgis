---
title: "Resolving Duplicate Incident Reports Across Jurisdictions"
description: "Deterministic spatial-temporal deduplication in Python for incident reports that double-count across CAD dispatch boundaries: tiered match scoring, audit-flagged merges, and review-queue routing."
slug: resolving-duplicate-incident-reports-across-jurisdictions
type: article
breadcrumb: "Duplicate Incident Reports Across Jurisdictions"
datePublished: "2025-03-18"
dateModified: "2026-06-25"
---

# Resolving Duplicate Incident Reports Across Jurisdictions

At 02:47 a structure fire is called in from a cell phone routed through a county PSAP, dispatched as `INC-44021` in Computer-Aided Dispatch (CAD). Ninety seconds later the same column of smoke trips a city traffic-camera analytic and a neighboring mutual-aid agency self-dispatches an engine, writing `CTY-9930` to its own CAD with coordinates 110 metres west and a clock skewed four minutes by an un-synced NTP server. The common operating picture now shows two fires on the same block. The resource-allocation model counts two engines committed where one is, the after-action metrics inflate, and an operations chief stares at a map that lies. This page solves exactly that failure: two incident records that describe **one real-world event but never match on ID, exact coordinate, or timestamp**, and the Python pattern that collapses them without ever silently merging two events that were genuinely distinct. It is the deduplication concern that sits on top of [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/), because the library you reach for decides whether this runs in a command-center ETL node or on an offline tablet at the post.

## Root Cause and Operational Impact

Cross-boundary duplicates are not a data-entry mistake to be scolded out of existence — they are structural. Overlapping CAD dispatch zones, mutual-aid auto-dispatch, parallel sensor triggers (traffic cameras, gunshot detectors, smoke analytics), and multi-agency radio traffic all generate independent records for one event by design. None of them share a primary key, and three field-specific noise sources guarantee the records never line up exactly: GPS drift and differing Coordinate Reference System (CRS) implementations move the coordinate by tens of metres, un-synced dispatch clocks skew the timestamp by minutes, and free-text incident descriptions diverge entirely between agencies. Exact-match or raw-coordinate-equality filtering catches none of it.

In an office system a duplicate row is an inconvenience you fix at month-end. In an active incident it is operationally dangerous. A double-counted event corrupts real-time situational awareness, so the operations section commits or holds resources against a phantom. It poisons the deployment metrics that drive mutual-aid billing and the FEMA Incident Status Summary (NIMS ICS-209) rollup. And it breaks every downstream spatial join — buffer math, parcel intersection, hydrant assignment — because two geometries sit where one belongs. The fix must therefore be deterministic and conservative: a wrong merge that hides a second real fire is worse than a missed merge that leaves a visible duplicate, so the pattern biases toward flagging the ambiguous case for a human rather than auto-collapsing it.

<svg viewBox="0 0 960 470" role="img" aria-label="Deduplication data flow for one real-world incident reported three times. Three independent sources — County CAD record INC-44021 at 02:47, City CAD record CTY-9930 at 02:51 with coordinates 110 metres west, and a traffic-camera sensor trigger — converge into a normalization stage that reprojects every record to a common metric UTM CRS and bounds them within a plus-or-minus ten-minute temporal window. Normalized candidate pairs flow into a composite scorer weighting spatial proximity at 0.5, temporal overlap at 0.3, and attribute similarity at 0.2. The scorer routes each pair into one of three confidence lanes: a score of 0.85 or above auto-merges, assigning a shared master_id; a score between 0.65 and 0.85 routes to a human review queue and is excluded from resource counts; a score below 0.65 keeps both records as distinct. Every lane — merge, review, and distinct — writes to a single immutable audit log sink, so each decision is reconstructable and reversible." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Spatial-temporal deduplication flow: three reports, one event, three routed outcomes</title>
  <desc>Three independent records for one fire — County CAD INC-44021 (02:47), City CAD CTY-9930 (02:51, 110 m west, clock skewed), and a traffic-camera sensor trigger — enter a normalization stage that reprojects all geometry to a common metric UTM CRS and applies a plus-or-minus ten-minute temporal window. Candidate pairs feed a composite scorer weighting spatial 0.5, temporal 0.3, and attribute 0.2. The score routes each pair into one of three lanes: at or above 0.85 auto-merge with a shared master_id; 0.65 to 0.85 to a human review queue, held out of resource counts; below 0.65 keep both as distinct. All three lanes write to one immutable audit log, making every decision reconstructable and any merge reversible.</desc>
  <defs>
    <marker id="dedup-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="dedup-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <!-- stage labels -->
    <text x="100" y="20" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Three sources, one event</text>
    <text x="360" y="20" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Normalize &amp; score</text>
    <text x="760" y="20" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Routed by confidence band</text>
    <!-- separators -->
    <line x1="210" y1="30" x2="210" y2="404" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>
    <line x1="600" y1="30" x2="600" y2="404" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>
    <!-- sources -->
    <rect x="20" y="44" width="178" height="58" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="109" y="65" font-weight="600">County CAD</text>
    <text x="109" y="82" font-size="10">INC-44021 · 02:47</text>
    <text x="109" y="96" font-size="10">PSAP cell-phone call</text>
    <rect x="20" y="120" width="178" height="58" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="109" y="141" font-weight="600">City CAD</text>
    <text x="109" y="158" font-size="10">CTY-9930 · 02:51 · 110 m W</text>
    <text x="109" y="172" font-size="10">mutual-aid self-dispatch</text>
    <rect x="20" y="196" width="178" height="58" rx="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/>
    <text x="109" y="217" font-weight="600">Sensor trigger</text>
    <text x="109" y="234" font-size="10">traffic-camera analytic</text>
    <text x="109" y="248" font-size="10">no shared primary key</text>
    <!-- normalization -->
    <rect x="248" y="78" width="178" height="74" rx="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="337" y="100" font-weight="700">Normalize</text>
    <text x="337" y="118" font-size="10">reproject → metric UTM CRS</text>
    <text x="337" y="133" font-size="10">±10 min temporal window</text>
    <text x="337" y="147" font-size="10">UTC clocks · bounds-check</text>
    <!-- scorer -->
    <rect x="248" y="184" width="178" height="80" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
    <text x="337" y="206" font-weight="700">Composite scorer</text>
    <text x="337" y="224" font-size="10">spatial 0.5 + temporal 0.3</text>
    <text x="337" y="239" font-size="10">+ attribute 0.2 → 0..1</text>
    <text x="337" y="254" font-size="10">per candidate pair</text>
    <!-- outcome lanes -->
    <rect x="628" y="44" width="208" height="62" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
    <text x="732" y="65" font-weight="700">Auto-merge · score ≥ 0.85</text>
    <text x="732" y="82" font-size="10">assign shared master_id</text>
    <text x="732" y="97" font-size="10">both rows survive · reversible</text>
    <rect x="628" y="122" width="208" height="62" rx="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="732" y="143" font-weight="700">Review · 0.65–0.85</text>
    <text x="732" y="160" font-size="10">human queue · ops chief</text>
    <text x="732" y="175" font-size="10">held out of resource counts</text>
    <rect x="628" y="200" width="208" height="62" rx="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/>
    <text x="732" y="221" font-weight="700">Distinct · score &lt; 0.65</text>
    <text x="732" y="238" font-size="10">keep both · tag provenance</text>
    <text x="732" y="253" font-size="10">log the rejected near-miss</text>
    <!-- audit sink -->
    <rect x="248" y="344" width="588" height="48" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="542" y="366" font-weight="700">Immutable audit log — every decision recorded</text>
    <text x="542" y="382" font-size="10">master_id · dedup_state · dedup_score · both source IDs · keyed for idempotent replay</text>
    <!-- flows: sources to normalize -->
    <path d="M198,73 H224 V108 H246" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#dedup-arrow-dim)"/>
    <path d="M198,149 H224 V115 H246" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#dedup-arrow-dim)"/>
    <path d="M198,225 H224 V122 H246" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#dedup-arrow-dim)"/>
    <!-- normalize to scorer -->
    <path d="M337,152 V182" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#dedup-arrow)"/>
    <!-- scorer to three lanes -->
    <path d="M426,212 H520 V75 H626" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#dedup-arrow)"/>
    <path d="M426,224 H560 V153 H626" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#dedup-arrow-dim)"/>
    <path d="M426,236 H540 V231 H626" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#dedup-arrow-dim)"/>
    <!-- lanes to audit sink -->
    <path d="M836,90 H872 V330 H760 V342" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.85" marker-end="url(#dedup-arrow-dim)"/>
    <path d="M540,262 V342" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.85" marker-end="url(#dedup-arrow-dim)"/>
    <path d="M337,264 V330 H440 V342" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.85" marker-end="url(#dedup-arrow-dim)"/>
  </g>
</svg>

## Tiered Resolution Strategy

Treat a candidate duplicate the way the CRS resolver treats a missing datum: resolve through an ordered chain from the most definitive evidence to a flagged safe default, and never let the highest-confidence tier be a silent guess. Evaluate three concurrent dimensions — spatial proximity, temporal overlap, and attribute similarity — combine them into one composite score, and route by confidence band:

1. **Definitive identity match.** If both records carry a shared correlation key — a CAD-to-CAD exchange ID, a NIEM-XML `IncidentTrackingIdentification`, or a deduplicated 911 ANI/ALI reference — collapse them immediately. This is the only tier allowed to merge without spatial scoring.
2. **High-confidence spatial-temporal-attribute match.** Within a tight time window and a metric proximity buffer, with matching NENA-compliant incident type codes, auto-merge and assign a `master_id`. Every merge emits an audit record naming both source IDs.
3. **Ambiguous match → review queue.** A composite score in the uncertain band (here 0.65–0.85) routes to a human-review queue rather than auto-merging, preserving chain-of-custody for forensic audit. Resource counts treat the pair as *possibly one* and surface it for the ops chief, not as a settled merge.
4. **Distinct → keep both with audit flag.** Below the threshold, retain both records, tag each with the evaluation provenance, and log the near-miss so a post-incident reviewer can see the deduplicator considered and rejected the pair.

## Production Python Implementation

The resolver below runs the full path in one place: it harmonizes CRS to a metric projection, windows temporally to keep the comparison out of O(n²), scores each candidate pair on spatial, temporal, and attribute axes, then routes by confidence band and emits a structured audit record for every decision — merge, review, or keep. It uses `print`-free structured logging, explicit exception handling, and full type hints. It assumes `geopandas >= 0.14` (Shapely 2.x / GEOS) and a projected CRS appropriate to the operational area — pick the Universal Transverse Mercator (UTM) zone for the incident, not a continental default, so buffer distances are true metres. The metric reprojection step depends on a correctly resolved input CRS; recovering one when the upstream feed omits it is the job of [handling missing CRS in field-collected GPS logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/).

```python
import logging
from dataclasses import dataclass
from datetime import timedelta
from difflib import SequenceMatcher
from typing import Optional

import geopandas as gpd
from shapely.strtree import STRtree

logger = logging.getLogger("dedup.incidents")


@dataclass(frozen=True)
class DedupConfig:
    metric_crs: str = "EPSG:32610"     # UTM zone for the operational area
    spatial_threshold_m: float = 150.0  # proximity buffer in true metres
    time_window_min: int = 10           # ± dispatch-to-dispatch skew tolerance
    auto_merge_score: float = 0.85      # >= this: collapse automatically
    review_floor_score: float = 0.65    # [floor, auto): route to human review


def _score_pair(row, cand, cfg: DedupConfig) -> float:
    """Composite 0..1 similarity across space, time, and incident type."""
    dist = row.geometry.distance(cand.geometry)
    spatial = max(0.0, 1.0 - dist / cfg.spatial_threshold_m)

    dt_min = abs((row["dispatch_time"] - cand["dispatch_time"]).total_seconds()) / 60.0
    temporal = max(0.0, 1.0 - dt_min / cfg.time_window_min)

    # NENA-style code equality is a hard signal; fall back to description fuzz.
    if row.get("incident_code") and row["incident_code"] == cand.get("incident_code"):
        attribute = 1.0
    else:
        attribute = SequenceMatcher(
            None,
            str(row.get("description", "")).lower(),
            str(cand.get("description", "")).lower(),
        ).ratio()

    return 0.5 * spatial + 0.3 * temporal + 0.2 * attribute


def resolve_duplicate_incidents(
    incidents: gpd.GeoDataFrame, cfg: Optional[DedupConfig] = None
) -> gpd.GeoDataFrame:
    """Collapse cross-jurisdiction duplicates, emitting an audit record per decision.

    Returns the original frame with three added columns:
      master_id   – id of the surviving record (self for masters/distinct)
      dedup_state – 'master' | 'merged' | 'review' | 'distinct'
      dedup_score – composite score against the assigned master (NaN for masters)
    """
    cfg = cfg or DedupConfig()
    if incidents.empty:
        logger.info("No incidents to deduplicate; returning empty frame")
        return incidents

    try:
        work = incidents.to_crs(cfg.metric_crs)
    except Exception:
        logger.exception("CRS reprojection to %s failed; aborting dedup", cfg.metric_crs)
        raise  # a wrong projection silently corrupts every distance; never proceed

    work = work.sort_values("dispatch_time").copy()
    work["master_id"] = work.index
    work["dedup_state"] = "master"
    work["dedup_score"] = float("nan")

    geoms = list(work.geometry.values)
    tree = STRtree(geoms)
    settled: set = set()

    for idx, row in work.iterrows():
        if idx in settled:
            continue

        # Temporal pre-filter keeps the comparison out of O(n^2).
        lo = row["dispatch_time"] - timedelta(minutes=cfg.time_window_min)
        hi = row["dispatch_time"] + timedelta(minutes=cfg.time_window_min)
        in_window = work[(work["dispatch_time"] >= lo) & (work["dispatch_time"] <= hi)]

        # Spatial pre-filter via the index, then score survivors precisely.
        near_pos = tree.query(row.geometry.buffer(cfg.spatial_threshold_m))
        near_idx = set(work.iloc[near_pos].index) & set(in_window.index)
        near_idx.discard(idx)

        for cand_idx in near_idx:
            if cand_idx in settled:
                continue
            score = _score_pair(row, work.loc[cand_idx], cfg)

            if score >= cfg.auto_merge_score:
                work.loc[cand_idx, ["master_id", "dedup_state", "dedup_score"]] = (
                    idx, "merged", score,
                )
                settled.add(cand_idx)
                logger.info(
                    "MERGE master=%s merged=%s score=%.3f", idx, cand_idx, score
                )
            elif score >= cfg.review_floor_score:
                work.loc[cand_idx, ["master_id", "dedup_state", "dedup_score"]] = (
                    idx, "review", score,
                )
                logger.warning(
                    "REVIEW pair=(%s,%s) score=%.3f routed to manual queue",
                    idx, cand_idx, score,
                )
            else:
                logger.debug(
                    "DISTINCT pair=(%s,%s) score=%.3f kept separate", idx, cand_idx, score
                )

    # Re-attach results to the caller's original CRS frame by index.
    out = incidents.copy()
    out[["master_id", "dedup_state", "dedup_score"]] = work[
        ["master_id", "dedup_state", "dedup_score"]
    ]
    return out
```

Persist `master_id`, `dedup_state`, and `dedup_score` straight to the audit store; they are the chain-of-custody record that lets a reviewer reconstruct why two records became one. Never overwrite the source IDs in place — masters and merged records must both survive so a mistaken merge is reversible. The same scoring philosophy underpins [automated attribute validation rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/): normalize the incident-type codes there before they reach the attribute axis here, or the fuzzy fallback will carry the whole decision.

The three weights are not free parameters — each one degrades differently as the incident changes, and knowing which is about to become unreliable is most of the skill in tuning them.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="wt-t wt-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="wt-t">When each scoring component stops being trustworthy</title>
  <desc id="wt-d">The three components of the composite duplicate score, with the conditions that degrade each. Spatial proximity, weighted 0.5, is reliable until reports come from GPS in an urban canyon or from a milepost reference, at which point positions from the same incident can differ by hundreds of metres. Temporal overlap, weighted 0.3, is reliable until dispatch queues back up during a surge, when two reports of one event can be timestamped twenty minutes apart. Attribute similarity, weighted 0.2, is reliable until a mutual-aid partner joins using a different incident-type vocabulary, at which point the same event carries unrelated type codes. Crucially the degradations are not simultaneous: an urban surge breaks spatial and temporal together while leaving attributes intact, which is exactly when a fixed weighting is most wrong.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">each component fails under different conditions — and rarely at the same time</text>
  <rect x="40" y="76" width="800" height="86" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="102" font-size="11" font-weight="700" fill="var(--crimson-deep)">spatial proximity · weight 0.5</text>
  <text x="60" y="124" font-size="10" fill="currentColor">degrades with: urban-canyon GPS multipath · milepost-derived positions · a cell-sector centroid</text>
  <text x="60" y="146" font-size="10" fill="currentColor">two reports of one incident can then sit 300 m apart, scoring as distinct</text>
  <rect x="40" y="174" width="800" height="86" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="200" font-size="11" font-weight="700" fill="currentColor">temporal overlap · weight 0.3</text>
  <text x="60" y="222" font-size="10" fill="currentColor">degrades with: dispatch queue backlog during surge · a partner CAD bridge batching its pushes</text>
  <text x="60" y="244" font-size="10" fill="currentColor">two reports of one event can then be timestamped 20 minutes apart</text>
  <rect x="40" y="272" width="800" height="86" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="298" font-size="11" font-weight="700" fill="var(--ember-text)">attribute similarity · weight 0.2</text>
  <text x="60" y="320" font-size="10" fill="currentColor">degrades with: a mutual-aid partner using a different incident-type vocabulary</text>
  <text x="60" y="342" font-size="10" fill="currentColor">the same event then carries type codes with no lexical relationship at all</text>
</svg>

The interaction is what makes a fixed weighting fragile. An urban surge degrades spatial and temporal *together* — multipath from the buildings, backlog from the volume — while leaving attributes untouched, so the 0.8 of the score that has become unreliable outvotes the 0.2 that has not. A mutual-aid influx does the reverse: positions and times stay good and the vocabulary diverges, so a weighting that leans on attributes starts splitting genuine duplicates.

Two responses are worth more than re-tuning the constants. The first is to make each component report its own confidence alongside its score, and to renormalise the weights across the components that are currently trustworthy rather than applying fixed ones. A spatial component that knows its inputs are cell-sector centroids can say so, and the composite can lean on time and attributes instead.

The second is to widen the review band rather than move the auto-merge threshold when conditions degrade. Sending more pairs to a human is a visible, reversible cost; lowering the merge threshold to compensate for noisy inputs is an invisible, irreversible one — it merges incidents that were never the same event, and the audit record will faithfully report a confident score for each.

## Validation Checklist

Confirm each item before a deduplication build is cleared for field deployment:

- [ ] The metric CRS in `DedupConfig` is the UTM zone for the actual incident area, not a continental or web-mercator default — buffer distances must be true metres.
- [ ] Every `merged` and `review` record carries `master_id` and `dedup_score` written to the audit log alongside both source IDs.
- [ ] `auto_merge_score` and `review_floor_score` are tuned against a labeled sample from this jurisdiction, not left at the example defaults.
- [ ] A definitive identity tier (CAD exchange ID / NIEM `IncidentTrackingIdentification`) short-circuits scoring when a shared correlation key exists.
- [ ] Records in the `review` band route to a human queue and are excluded from auto-merge resource counts until cleared.
- [ ] Source records are never overwritten in place — both master and merged rows survive so any merge is reversible.
- [ ] Dispatch timestamps are normalized to a single timezone/UTC before windowing, so NTP skew between agency clocks is bounded by `time_window_min`, not by timezone offset.

Setting the two thresholds is a choice about which error you would rather make, and the two errors are not symmetric.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="th-t th-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="th-t">The operational cost of each error, and why the two thresholds are set differently</title>
  <desc id="th-d">Two errors are possible. A false merge combines two genuinely distinct incidents into one record: one of them disappears from the resource count, no unit is assigned to it, and because the surviving record looks complete nothing signals the loss — recovery requires someone to notice an incident that is not on the board. A false split leaves one incident as two records: it is double-counted in the resource tally, two units may be assigned where one was needed, and it is discovered within minutes by the second unit arriving on scene. Both are errors; only one of them removes an incident from the response. This asymmetry is why the auto-merge threshold sits high, the review band is wide, and the default when confidence is low is to keep both records.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">both are errors — only one of them removes an incident from the response</text>
  <rect x="40" y="76" width="390" height="200" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <rect x="460" y="76" width="380" height="200" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="60" y="104" font-size="11.5" font-weight="700" fill="var(--ember-text)">false merge — two incidents become one</text>
  <text x="480" y="104" font-size="11.5" font-weight="700" fill="var(--crimson-deep)">false split — one incident stays two</text>
  <g font-size="10.5" fill="currentColor">
    <text x="60" y="136">· one incident leaves the resource count</text>
    <text x="60" y="158">· no unit is assigned to it</text>
    <text x="60" y="180">· the surviving record looks complete</text>
    <text x="60" y="202">· nothing signals the loss</text>
    <text x="480" y="136">· the incident is double-counted</text>
    <text x="480" y="158">· two units may be assigned</text>
    <text x="480" y="180">· both records are present and visible</text>
    <text x="480" y="202">· the second unit on scene reports it</text>
  </g>
  <text x="60" y="240" font-size="10.5" font-weight="700" fill="var(--ember-text)">discovered when somebody notices an absence</text>
  <text x="60" y="258" font-size="10" fill="currentColor">which during a surge may be never</text>
  <text x="480" y="240" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">discovered in minutes, on scene</text>
  <text x="480" y="258" font-size="10" fill="currentColor">costs one wasted response</text>
  <rect x="40" y="298" width="800" height="46" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="326" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">so: merge threshold high, review band wide, and when confidence is low keep both records</text>
</svg>

The asymmetry is the whole justification for a 0.85 auto-merge threshold that will obviously leave real duplicates unmerged. Those duplicates land in the review queue, where a human clears them in seconds, and in the meantime the worst outcome is a resource tally that is slightly overstated — a condition an operations chief is well equipped to reason about, because it is visible.

A false merge is not visible. The record that survives carries a plausible location, a plausible type and a master identifier; the record that vanished leaves no trace on any board. Discovering it requires somebody to notice that a call which came in forty minutes ago has no unit assigned, which is precisely the kind of attention a surge does not have spare.

This also settles a question that comes up when the review queue grows: whether to raise the auto-merge rate to reduce reviewer load. The answer is no — the correct lever is more reviewers or better upstream normalisation, because trading queue depth for silent merges converts a visible, bounded cost into an invisible, unbounded one.

## Edge Cases and Gotchas

- **Axis-order inversion.** A neighboring agency exporting GeoJSON as lat/lon while yours is lon/lat transposes a point thousands of kilometres away, so it never enters any candidate set and the duplicate survives unmerged. Enforce `always_xy=True` on every transform and bounds-check coordinates against the incident extent before scoring.
- **Null-island drift.** A `(0, 0)` fix from a sensor that failed to acquire is within `spatial_threshold_m` of every other `(0, 0)` failure, so naive proximity merges unrelated events into one phantom incident at the equator. Filter and quarantine null-island coordinates before the spatial index is built.
- **Clock skew beyond the window.** Un-synced agency CAD clocks can exceed `time_window_min`, pushing a true duplicate outside the temporal pre-filter so it is never compared. Normalize all timestamps to UTC on ingest and widen the window only with a compensating raise in `auto_merge_score`, or genuine duplicates fall through silently.
- **Agency-specific datum anomalies.** A mutual-aid feed still publishing NAD27 or a State Plane grid lands 10–100 m off your WGS 84 basemap, inflating the measured distance so a real duplicate scores below threshold. Reproject with a real datum-transformation grid per the [coordinate reference systems for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) workflow before the records ever reach this resolver.
- **Offline device replay.** A tablet syncing after an outage replays a batch of already-merged records; without idempotency the resolver merges them a second time and corrupts the `master_id` chain. Key the audit store on source ID so a re-seen record is recognized as settled, not re-scored.

## Related

- [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/) — choosing the spatial library that decides whether this runs on a command-center node or an offline tablet.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — datum-aware reprojection so cross-agency feeds align before scoring.
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — normalizing incident-type codes that feed the attribute-similarity axis.

Up: [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/)
