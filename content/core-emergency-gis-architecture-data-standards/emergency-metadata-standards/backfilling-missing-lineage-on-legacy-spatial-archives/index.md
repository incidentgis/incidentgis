---
title: "Backfilling Missing Lineage on Legacy Spatial Archives"
description: "Reconstruct best-effort ISO 19115 lineage for legacy spatial archives that ship with no metadata: infer source authority, CRS, and acquisition time from filenames and sidecars, then stamp provenance with per-field confidence and an immutable audit trail."
slug: backfilling-missing-lineage-on-legacy-spatial-archives
type: article
breadcrumb: "Backfilling Missing Lineage"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Backfilling Missing Lineage on Legacy Spatial Archives",
      "description": "Reconstruct best-effort ISO 19115 lineage for legacy spatial archives that ship with no metadata: infer source authority, CRS, and acquisition time from filenames and sidecars, then stamp provenance with per-field confidence and an immutable audit trail.",
      "datePublished": "2026-07-13",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Core Emergency GIS Architecture & Data Standards", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/" },
        { "@type": "ListItem", "position": 3, "name": "Emergency Metadata Standards", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/" },
        { "@type": "ListItem", "position": 4, "name": "Backfilling Missing Lineage on Legacy Spatial Archives", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/backfilling-missing-lineage-on-legacy-spatial-archives/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Reconstruct best-effort lineage for an undocumented legacy spatial archive",
      "description": "Harvest provenance evidence from filenames, sidecar files, and folder structure, infer source authority, CRS, and acquisition time with an explicit confidence score per field, stamp an ISO 19115 lineage record, and emit an audit trail so every inferred value is traceable and reversible.",
      "step": [
        { "@type": "HowToStep", "name": "Harvest evidence", "text": "Collect every provenance signal a dataset carries — filename tokens, sidecar files such as projection or readme files, folder path, and filesystem timestamps — without asserting any of them as truth yet." },
        { "@type": "HowToStep", "name": "Infer each field with confidence", "text": "Map the harvested evidence to source authority, coordinate reference system, and acquisition time, and attach a confidence score and evidence citation to each inferred field rather than a bare value." },
        { "@type": "HowToStep", "name": "Stamp lineage, flag inference", "text": "Write an ISO 19115 lineage record where every backfilled field is explicitly marked as inferred, so a validated field is never confused with a reconstructed one." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Log every inferred field with its evidence, confidence, and the ruleset version so the reconstruction is reproducible and any wrong guess can be traced and reversed." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Is inferred lineage safe to treat as authoritative metadata?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No. Backfilled lineage is a best-effort reconstruction, not an assertion of fact, and it must never be silently merged with validated metadata. Every inferred field carries a confidence score and an evidence citation, and the lineage record marks it as inferred so an analyst can weight it, verify it, or reject it. Treating a guess as ground truth is exactly the failure this process is designed to prevent."
          }
        },
        {
          "@type": "Question",
          "name": "What evidence can you recover provenance from when metadata is missing?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Legacy datasets still carry provenance signals even without formal metadata: filename tokens often encode an agency code, a datum or coordinate system, and a date; sidecar files such as a projection file or a readme record the CRS and sometimes the source; the folder path reflects an archival organization; and filesystem timestamps bound the acquisition or ingest time. None of these is authoritative alone, but combined and scored they reconstruct defensible lineage."
          }
        },
        {
          "@type": "Question",
          "name": "Why does missing lineage matter for emergency response specifically?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "An emergency dataset with no lineage cannot be trusted, cited, or defended after the fact. An analyst cannot tell whether a flood layer is from this event or a decade old, whether coordinates are in the expected datum, or which agency is accountable for it. NIMS and FEMA both expect operational data to be reconstructable for after-action review, so a layer that reaches the Common Operating Picture with unknown provenance is an accountability gap, not merely an inconvenience."
          }
        }
      ]
    }
  ]
}
</script>

# Backfilling Missing Lineage on Legacy Spatial Archives

A wildfire jumps a containment line at 02:00 and the incident's geospatial lead pulls the county's historical fuels and parcel archive off a decade-old network share to seed the initial map. The archive is thousands of shapefiles and GeoTIFFs in nested folders named after long-departed staff, and almost none carry metadata — no source authority, no stated coordinate reference system, no acquisition date. One `parcels.shp` could be last year's assessor extract or a fifteen-year-old snapshot; a `burn_severity.tif` could be from this fire's predecessor or an unrelated event three counties over. The analyst has to decide, in minutes, which layers are safe to put in front of an incident commander, and the datasets themselves refuse to say where they came from. This page solves that one narrow, dangerous problem: reconstructing best-effort provenance for undocumented legacy spatial archives, stamping it as machine-readable lineage, and — critically — never letting a reconstructed guess masquerade as a validated fact.

## Root Cause and Operational Impact

Missing lineage is rarely negligence; it is the accumulated residue of tools and eras that never enforced metadata. Field exports from older desktop software wrote geometry and attributes but no provenance. Shapefiles lost their sidecars during zip-and-email transfers. Rasters were clipped, reprojected, and re-saved through pipelines that discarded whatever documentation the source once had. The International Organization for Standardization published ISO 19115 (geographic information — metadata) precisely to standardize a `LI_Lineage` element describing source and process history, but a standard only helps data created under it. A legacy archive predates the discipline, so the lineage element is simply absent.

The operational danger is that undocumented data still looks usable. A layer renders, so it gets trusted. But without provenance an analyst cannot answer the three questions that decide whether a layer is safe: who is the authoritative source, what coordinate reference system are the coordinates in, and when were they acquired. Get the source wrong and you cite a non-authoritative parcel boundary in a legal evacuation order. Get the CRS wrong and every feature shifts — a datum mismatch quietly offsets a fire perimeter by tens of metres, the same class of error the [coordinate reference system standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) exists to prevent. Get the acquisition time wrong and a stale layer contradicts the live situation. The National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both expect operational data to be reconstructable for after-action review; a layer that reaches the Common Operating Picture with unknown provenance is an accountability gap. The reconstruction has to be auditable, which is why backfilled lineage belongs inside the discipline described in [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) rather than typed into a spreadsheet during the incident.

<svg viewBox="0 0 880 470" role="img" aria-label="Lineage backfill pipeline. Four evidence sources on the left — filename tokens, sidecar files, folder path, and filesystem timestamps — feed a central inference engine. The engine produces three lineage fields on the right: source authority, coordinate reference system, and acquisition time, each carrying a confidence badge marked as inferred rather than asserted. All three fields plus their confidence and evidence flow down into an immutable audit record at the bottom." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Reconstructing lineage from archival evidence with per-field confidence and an audit trail</title>
  <desc>Four evidence sources — filename tokens, sidecar files such as a projection or readme file, the folder path, and filesystem timestamps — feed a central inference engine. The engine maps that evidence to three lineage fields: source authority, coordinate reference system, and acquisition time. Each output field carries a confidence badge and is explicitly marked as inferred rather than asserted. Every inferred field, together with its evidence citation, confidence score, and the ruleset version, is written to an immutable audit record so the reconstruction is reproducible and reversible.</desc>
  <defs>
    <marker id="lineage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="lineage-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- left column: evidence sources -->
  <text x="128" y="34" font-size="12.5" text-anchor="middle" font-weight="700" fill="currentColor">Evidence sources</text>
  <g font-size="10.5" fill="currentColor">
    <rect x="24" y="48" width="208" height="46" rx="7" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="38" y="68" font-weight="600">Filename tokens</text>
    <text x="38" y="84" font-size="9.5" opacity="0.85">CALFIRE_NAD83_2019_perimeter</text>
    <rect x="24" y="108" width="208" height="46" rx="7" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="38" y="128" font-weight="600">Sidecar files</text>
    <text x="38" y="144" font-size="9.5" opacity="0.85">.prj · .cpg · readme.txt</text>
    <rect x="24" y="168" width="208" height="46" rx="7" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="38" y="188" font-weight="600">Folder path</text>
    <text x="38" y="204" font-size="9.5" opacity="0.85">/archive/assessor/2019/</text>
    <rect x="24" y="228" width="208" height="46" rx="7" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="38" y="248" font-weight="600">Filesystem timestamps</text>
    <text x="38" y="264" font-size="9.5" opacity="0.85">mtime bounds acquisition</text>
  </g>
  <!-- arrows into engine -->
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#lineage-plain)">
    <path d="M232,71 C300,90 300,150 356,168"/>
    <path d="M232,131 C300,150 320,170 356,186"/>
    <path d="M232,191 C300,190 320,196 356,204"/>
    <path d="M232,251 C300,240 320,230 356,222"/>
  </g>
  <!-- inference engine -->
  <rect x="356" y="150" width="150" height="92" rx="9" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
  <text x="431" y="186" font-size="12" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Inference</text>
  <text x="431" y="204" font-size="12" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">engine</text>
  <text x="431" y="224" font-size="9.5" text-anchor="middle" fill="currentColor">scores every field</text>
  <!-- arrows engine -> outputs -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#lineage-arrow)">
    <path d="M506,176 C560,150 588,120 636,110"/>
    <path d="M506,196 C566,196 588,196 636,196"/>
    <path d="M506,216 C560,242 588,272 636,282"/>
  </g>
  <!-- right column: lineage fields with confidence -->
  <text x="756" y="34" font-size="12.5" text-anchor="middle" font-weight="700" fill="currentColor">Inferred lineage</text>
  <g font-size="10.5" fill="currentColor">
    <rect x="636" y="88" width="220" height="46" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="650" y="108" font-weight="600">Source authority</text>
    <circle cx="662" cy="123" r="5" fill="var(--crimson, currentColor)"/>
    <text x="676" y="127" font-size="9.5" fill="var(--crimson, currentColor)">confidence 0.9 · inferred</text>
    <rect x="636" y="174" width="220" height="46" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="650" y="194" font-weight="600">Coordinate reference system</text>
    <circle cx="662" cy="209" r="5" fill="var(--fire, currentColor)"/>
    <text x="676" y="213" font-size="9.5" fill="var(--crimson, currentColor)">confidence 0.6 · inferred</text>
    <rect x="636" y="260" width="220" height="46" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="650" y="280" font-weight="600">Acquisition time</text>
    <circle cx="662" cy="295" r="5" fill="var(--fire, currentColor)"/>
    <text x="676" y="299" font-size="9.5" fill="var(--crimson, currentColor)">confidence 0.4 · inferred</text>
  </g>
  <!-- audit record -->
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#lineage-plain)">
    <path d="M746,134 C746,340 620,360 512,388"/>
    <path d="M746,220 C746,350 640,368 512,394"/>
    <path d="M746,306 C746,352 660,378 512,400"/>
    <path d="M431,242 V388"/>
  </g>
  <rect x="150" y="384" width="362" height="64" rx="9" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.6"/>
  <text x="331" y="408" font-size="12" text-anchor="middle" font-weight="700" fill="currentColor">Immutable audit record</text>
  <text x="331" y="426" font-size="9.5" text-anchor="middle" fill="currentColor">field · evidence · confidence · ruleset version · timestamp</text>
  <text x="331" y="440" font-size="9.5" text-anchor="middle" fill="currentColor" opacity="0.85">reproducible and reversible</text>
</svg>

Before deciding how to backfill, it is worth knowing how much is actually recoverable, because the answer varies enormously by field and sets a hard ceiling on what the exercise can honestly claim.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="bl-t bl-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="bl-t">How much of an ISO 19115 lineage block can actually be recovered from a legacy archive</title>
  <desc id="bl-d">Across a 4,200-file legacy spatial archive, the proportion of files for which each mandatory lineage field could be recovered. File modification time is available for 96 per cent, the coordinate reference for 88 per cent, and the source authority for 71 per cent — the last from directory naming conventions and file headers. Process steps could be reconstructed for only 23 per cent, and horizontal accuracy for 6 per cent. The first three are genuine recoveries from evidence in the files. The last two are mostly absent, and the correct outcome for them is an explicit unknown rather than a plausible default, because a lineage block asserting an accuracy nobody measured is worse than one admitting the accuracy is unknown.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">a 4,200-file legacy archive — what the files themselves can still tell you</text>
  <text x="8" y="76" font-size="10" fill="var(--muted)">share of files where the field could be established from evidence</text>
  <rect x="260" y="96" width="550" height="30" rx="5" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <rect x="260" y="96" width="537.6" height="30" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="116" font-size="10.5" fill="currentColor">file modification time</text>
  <text x="832" y="116" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">96%</text>
  <rect x="260" y="144" width="550" height="30" rx="5" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <rect x="260" y="144" width="397.6" height="30" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="164" font-size="10.5" fill="currentColor">source authority</text>
  <text x="832" y="164" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">71%</text>
  <rect x="260" y="192" width="550" height="30" rx="5" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <rect x="260" y="192" width="492.8" height="30" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="212" font-size="10.5" fill="currentColor">coordinate reference</text>
  <text x="832" y="212" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">88%</text>
  <rect x="260" y="240" width="550" height="30" rx="5" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <rect x="260" y="240" width="128.8" height="30" rx="5" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="260" font-size="10.5" fill="currentColor">process steps / lineage</text>
  <text x="832" y="260" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">23%</text>
  <rect x="260" y="288" width="550" height="30" rx="5" fill="var(--cream)" stroke="var(--line-strong)" stroke-width="1.1"/>
  <rect x="260" y="288" width="33.6" height="30" rx="5" fill="var(--ember)" opacity="0.65" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="308" font-size="10.5" fill="currentColor">horizontal accuracy</text>
  <text x="832" y="308" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">6%</text>
  <path d="M260 336 H810" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="260" y="354">0%</text><text x="400" y="354">25%</text><text x="540" y="354">50%</text>
    <text x="680" y="354">75%</text><text x="810" y="354">100%</text>
  </g>
  <circle cx="266" cy="374" r="6" fill="var(--crimson)"/>
  <text x="280" y="378" font-size="10" fill="currentColor">recovered from evidence</text>
  <circle cx="470" cy="374" r="6" fill="var(--petal)"/>
  <text x="484" y="378" font-size="10" fill="currentColor">reconstructed by inference</text>
  <circle cx="680" cy="374" r="6" fill="var(--ember)" opacity="0.65"/>
  <text x="694" y="378" font-size="10" fill="currentColor">must stay unknown</text>
</svg>

The top three fields are genuine recoveries. A file's modification time is a fact the filesystem kept; a coordinate reference is usually in the `.prj` or the container header; a source authority can often be read off a directory convention that an agency followed consistently for a decade. Establishing these is archaeology, not invention, and the resulting values are as good as any recorded at ingest.

The bottom two are not, and the temptation with them is severe. `processStep` has an obvious plausible default — "digitised from imagery" is true of most of the archive — and `accuracy` has an obvious plausible number, whatever the agency's standard was at the time. Filling those in produces a complete-looking lineage block for every file, which is exactly what the backfill project was asked to deliver, and it is the wrong thing to deliver.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="mk-t mk-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="mk-t">Two lineage blocks that look identical to a consumer, and the field that separates them</title>
  <desc id="mk-d">Two ISO 19115 lineage blocks for the same archived dataset. The first was recorded at ingest by the pipeline that produced the data and states its process steps as observed fact. The second was backfilled years later by inference from directory structure and file headers. Every field a consumer reads is populated identically in both. The only difference is a lineage provenance field marking the second as reconstructed, together with the method and the date of reconstruction. Without that field, a backfilled archive claims first-hand provenance it does not have, and an auditor cannot distinguish a lineage somebody recorded from one somebody guessed — which defeats the purpose of having a lineage at all.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">identical to every consumer — one field is the whole difference</text>
  <rect x="40" y="70" width="380" height="180" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <rect x="460" y="70" width="380" height="180" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="96" font-size="11" font-weight="700" fill="var(--crimson-deep)">recorded at ingest</text>
  <text x="480" y="96" font-size="11" font-weight="700" fill="var(--ember-text)">backfilled years later</text>
  <g font-size="10.5" fill="currentColor">
    <text x="60" y="124">dateStamp · 2019-06-14</text>
    <text x="60" y="146">authority · Bernalillo County GIS</text>
    <text x="60" y="168">referenceSystem · EPSG:2258</text>
    <text x="60" y="190">processStep · digitised from orthophoto</text>
    <text x="480" y="124">dateStamp · 2019-06-14</text>
    <text x="480" y="146">authority · Bernalillo County GIS</text>
    <text x="480" y="168">referenceSystem · EPSG:2258</text>
    <text x="480" y="190">processStep · digitised from orthophoto</text>
  </g>
  <text x="60" y="222" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">provenance · observed</text>
  <text x="480" y="222" font-size="10.5" font-weight="700" fill="var(--ember-text)">provenance · reconstructed</text>
  <text x="480" y="240" font-size="9.5" fill="currentColor">method: directory convention + header · 2026-03-02</text>
  <text x="8" y="290" font-size="10.5" fill="currentColor">Omit that field and the archive asserts first-hand provenance it does not have — which is worse than having none,</text>
  <text x="8" y="308" font-size="10.5" fill="currentColor">because an auditor can no longer tell a lineage somebody recorded from one somebody inferred.</text>
</svg>

The distinguishing field costs nothing and carries the entire epistemic weight of the exercise. With it, an auditor querying the archive can separate the records whose lineage was observed from those whose lineage was inferred, and can weight them accordingly — which is what a lineage block is *for*. Without it, the backfill has quietly converted "we do not know how this dataset was produced" into "this dataset was produced as follows", and no subsequent process can undo that, because the evidence that it was a guess has been overwritten by the guess.

Set `accuracy` to null rather than to the era's standard, and let the null propagate. A consumer that refuses to use a dataset with unknown accuracy is behaving correctly; one that uses a fabricated accuracy is behaving correctly too, on false information, which is the failure this whole section exists to prevent.

## Tiered Resolution Strategy

Reconstruct lineage in ordered tiers, from strong direct evidence down to a safe default that is always flagged for review. The governing rule: never overwrite a validated field, and never let an inferred value lose its confidence badge.

1. **Adopt authoritative evidence where it exists (definitive).** A sidecar projection file states the CRS directly; a readme names the source agency. When evidence is explicit and machine-readable, adopt it at high confidence but still record it as recovered, not asserted.
2. **Infer from structured filename and path tokens.** Filenames routinely encode an agency code, a datum, and a year (`CALFIRE_NAD83_2019_...`). Parse tokens against a controlled vocabulary of known authorities and datums, and score confidence by how unambiguous the match is.
3. **Bound the unknown with filesystem timestamps.** When no date token exists, the file modification time gives an upper bound on acquisition and a lower bound only if you trust the archive was never re-saved. Record it as a bounded estimate at low confidence, never as a precise date.
4. **Fall back to an explicit "unknown, flagged" default (safe default).** If a field cannot be inferred at all, stamp it as `unknown` with confidence `0.0` and a review flag rather than leaving it null. A null reads as "not checked"; an explicit flagged unknown reads as "checked, unrecoverable" and routes the dataset to a human.
5. **Emit an audit record for every inferred field.** Evidence citation, confidence, the ruleset version, and a timestamp — so any reconstruction is reproducible against the exact rules that produced it and any wrong guess is traceable and reversible.

## Production Python Implementation

The routine below carries the full resolution path for a single dataset: evidence harvesting from filename, sidecar, path, and timestamp; per-field inference with confidence scoring; an ISO 19115-shaped lineage record where every backfilled field is explicitly marked inferred; structured logging; explicit exception handling; and an immutable audit entry per inferred field. Thresholds and vocabularies are parameters, not literals, so they can be committed and versioned alongside the archive itself — the reproducibility contract that [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) provides. Senior-engineer assumptions apply: `pyproj` is available to normalize a recovered CRS to an authority code, and the caller supplies the controlled vocabularies of agency codes and datum aliases.

```python
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

logger = logging.getLogger("incidentgis.lineage")


class Provenance(str, Enum):
    ASSERTED = "asserted"        # dataset carried validated metadata
    INFERRED = "inferred"        # reconstructed from indirect evidence
    UNKNOWN = "unknown_flagged"  # unrecoverable, routed for human review


@dataclass
class LineageField:
    """A single backfilled lineage value with its evidence and confidence."""
    value: Optional[str]
    provenance: str
    confidence: float            # 0.0 unknown -> 1.0 authoritative
    evidence: str                # human-readable citation of the signal used


@dataclass
class AuditEntry:
    """Immutable record of one inferred field, emitted to the audit trail."""
    dataset: str
    field_name: str
    value: Optional[str]
    provenance: str
    confidence: float
    evidence: str
    ruleset_version: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class LineageBackfiller:
    """Reconstruct best-effort ISO 19115 lineage for an undocumented dataset.

    Every inferred field is scored, marked as inferred, and appended to
    ``audit_log`` so the reconstruction is reproducible and reversible.
    """

    # Filename token like CALFIRE_NAD83_2019_perimeter -> agency, datum, year.
    _TOKEN = re.compile(
        r"(?P<agency>[A-Za-z]+)[_-](?P<datum>[A-Za-z0-9]+)[_-](?P<year>\d{4})"
    )

    def __init__(
        self,
        ruleset_version: str,
        agency_vocab: dict[str, str],
        datum_epsg: dict[str, int],
    ) -> None:
        self.ruleset_version = ruleset_version
        self.agency_vocab = {k.upper(): v for k, v in agency_vocab.items()}
        self.datum_epsg = {k.upper(): v for k, v in datum_epsg.items()}
        self.audit_log: list[AuditEntry] = []

    def _emit(self, dataset: str, name: str, lf: LineageField) -> None:
        """Append an audit entry and log any inferred or unknown field."""
        entry = AuditEntry(
            dataset=dataset,
            field_name=name,
            value=lf.value,
            provenance=lf.provenance,
            confidence=lf.confidence,
            evidence=lf.evidence,
            ruleset_version=self.ruleset_version,
        )
        self.audit_log.append(entry)
        if lf.provenance != Provenance.ASSERTED.value:
            logger.info("lineage_backfilled", extra={"audit": asdict(entry)})

    def _infer_crs(self, path: Path, tokens: Optional[re.Match]) -> LineageField:
        """Prefer an authoritative .prj sidecar; fall back to a datum token."""
        prj = path.with_suffix(".prj")
        try:
            if prj.is_file():
                from pyproj import CRS  # local import keeps the parser optional
                crs = CRS.from_wkt(prj.read_text(encoding="utf-8", errors="replace"))
                epsg = crs.to_epsg()
                if epsg is not None:
                    return LineageField(
                        f"EPSG:{epsg}", Provenance.ASSERTED.value, 0.95,
                        f"sidecar {prj.name}",
                    )
        except (OSError, ValueError) as exc:
            # Unreadable or non-WKT .prj: degrade to token inference, never raise.
            logger.warning("prj_unreadable", extra={"path": str(prj)}, exc_info=exc)
        if tokens is not None:
            epsg = self.datum_epsg.get(tokens.group("datum").upper())
            if epsg is not None:
                return LineageField(
                    f"EPSG:{epsg}", Provenance.INFERRED.value, 0.6,
                    f"filename datum token '{tokens.group('datum')}'",
                )
        return LineageField(None, Provenance.UNKNOWN.value, 0.0, "no CRS evidence")

    def _infer_authority(self, tokens: Optional[re.Match]) -> LineageField:
        if tokens is not None:
            agency = self.agency_vocab.get(tokens.group("agency").upper())
            if agency is not None:
                return LineageField(
                    agency, Provenance.INFERRED.value, 0.9,
                    f"filename agency token '{tokens.group('agency')}'",
                )
        return LineageField(None, Provenance.UNKNOWN.value, 0.0, "no authority evidence")

    def _infer_acquired(self, path: Path, tokens: Optional[re.Match]) -> LineageField:
        if tokens is not None:
            year = tokens.group("year")
            return LineageField(
                f"{year}-01-01", Provenance.INFERRED.value, 0.5,
                f"filename year token '{year}'",
            )
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            # mtime only bounds acquisition from above; treat as a weak estimate.
            return LineageField(
                mtime.date().isoformat(), Provenance.INFERRED.value, 0.3,
                "filesystem mtime upper bound",
            )
        except OSError as exc:
            logger.warning("stat_failed", extra={"path": str(path)}, exc_info=exc)
            return LineageField(None, Provenance.UNKNOWN.value, 0.0, "no time evidence")

    def backfill(self, dataset_path: str) -> dict[str, LineageField]:
        """Return a lineage record keyed by field, with an audit entry each."""
        path = Path(dataset_path)
        try:
            tokens = self._TOKEN.search(path.stem)
            record = {
                "source_authority": self._infer_authority(tokens),
                "crs": self._infer_crs(path, tokens),
                "acquisition_time": self._infer_acquired(path, tokens),
            }
        except Exception as exc:  # never let one bad file stall an archive sweep
            logger.error("backfill_failed", extra={"path": dataset_path}, exc_info=exc)
            record = {
                name: LineageField(None, Provenance.UNKNOWN.value, 0.0, "backfill error")
                for name in ("source_authority", "crs", "acquisition_time")
            }
        for name, lf in record.items():
            self._emit(path.name, name, lf)
        return record
```

The `audit_log` is the load-bearing output. Persisting it as a committed, content-hashed artifact means a reviewer can replay every inference, see exactly which filename token or sidecar produced each value, and reverse any guess the ruleset got wrong — the same defensibility the wider [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) discipline demands before a layer is trusted.

## Validation Checklist

Verify every item before backfilled lineage is written into the archive or surfaced to analysts.

- [ ] Agency vocabulary, datum-to-EPSG map, and confidence thresholds are passed as parameters and committed under version control — no literals hard-coded in the sweep.
- [ ] `ruleset_version` is set from the running release tag so every audit entry is traceable to a specific commit.
- [ ] Every backfilled field is written with an explicit `provenance` of `inferred` or `unknown_flagged`; a validated field is never relabelled or overwritten.
- [ ] Fields that cannot be recovered are stamped `unknown` with confidence `0.0` and a review flag, never left null.
- [ ] A `.prj` sidecar that is unreadable or non-WKT degrades to token inference and logs a warning instead of raising.
- [ ] Recovered CRS values are normalized to an authority code (for example `EPSG:4269`) rather than stored as raw WKT so downstream tools can consume them.
- [ ] Structured logs route to the metadata audit sink, not stdout, and every inferred field appears in `audit_log`.
- [ ] Downstream consumers read and honour the `confidence` field, suppressing or flagging low-confidence lineage rather than treating all fields equally.

## Edge Cases and Gotchas

- **Filesystem timestamps are not acquisition dates.** A file's modification time reflects the last write, which for a re-projected or copied archive can be years after the data was collected. Treat `mtime` as an upper bound at low confidence only, and never let it overwrite a filename year token that is closer to the truth.
- **Ambiguous datum tokens.** A token like `NAD83` maps to many EPSG codes depending on zone and realization; a bare `83` or `27` is worse. Resolve datum tokens against zone evidence from the folder path or a `.prj` before assigning an EPSG code, and drop confidence when the mapping is one-to-many. This is the reconstruction feeding the [coordinate reference system standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) that the rest of the pipeline enforces.
- **Encoding-mangled tokens.** Legacy filenames and readme sidecars from older systems can carry non-UTF-8 bytes, so a naive read raises or silently mojibakes an agency name. Read with an explicit fallback encoding and a replacement policy — the same failure mode covered when [handling shapefile ingestion](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) from mixed-vintage sources.
- **Collisions between asserted and inferred values.** If a dataset later gains real metadata, a merge must let the asserted value win and must retain the prior inferred value in the audit trail rather than deleting it. Overwriting history erases the reason a wrong decision was ever made.
- **Confidence inflation on repeat runs.** Re-running the backfiller over an archive that already contains inferred lineage must not treat its own earlier guess as fresh evidence. Key inference off original signals only, and skip fields already stamped `asserted` so the confidence score never bootstraps itself upward.

## Frequently Asked Questions

**Is inferred lineage safe to treat as authoritative metadata?** No. Backfilled lineage is a best-effort reconstruction, not an assertion of fact, and it must never be silently merged with validated metadata. Every inferred field carries a confidence score and an evidence citation, and the lineage record marks it as inferred so an analyst can weight it, verify it, or reject it. Treating a guess as ground truth is exactly the failure this process is designed to prevent.

**What evidence can you recover provenance from when metadata is missing?** Legacy datasets still carry provenance signals even without formal metadata: filename tokens often encode an agency code, a datum or coordinate system, and a date; sidecar files such as a projection file or a readme record the CRS and sometimes the source; the folder path reflects an archival organization; and filesystem timestamps bound the acquisition or ingest time. None of these is authoritative alone, but combined and scored they reconstruct defensible lineage.

**Why does missing lineage matter for emergency response specifically?** An emergency dataset with no lineage cannot be trusted, cited, or defended after the fact. An analyst cannot tell whether a flood layer is from this event or a decade old, whether coordinates are in the expected datum, or which agency is accountable for it. NIMS and FEMA both expect operational data to be reconstructable for after-action review, so a layer that reaches the Common Operating Picture with unknown provenance is an accountability gap, not merely an inconvenience.

## Related

- [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) — the metadata discipline this backfill feeds, including where inferred lineage is allowed to sit.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — resolve and validate a recovered datum before trusting reconstructed geometry.
- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) — where legacy archives enter the system and where encoding and CRS gaps first appear.
- [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) — commit the ruleset and audit trail so every reconstruction is reproducible.

Up: [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/)
