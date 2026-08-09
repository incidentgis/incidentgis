---
title: "Shelter Capacity & Resource Tracking Schemas"
description: "Design shelter capacity and resource-tracking schemas for emergency GIS: pydantic contracts, deterministic occupancy math, over-capacity alerting, and COP-ready GeoJSON."
slug: shelter-capacity-and-resource-tracking-schemas
type: guide
breadcrumb: "Shelter Capacity Schemas"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Shelter Capacity & Resource Tracking Schemas",
      "description": "Design shelter capacity and resource-tracking schemas for emergency GIS: pydantic contracts, deterministic occupancy math, over-capacity alerting, and COP-ready GeoJSON.",
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
        { "@type": "ListItem", "position": 3, "name": "Shelter Capacity & Resource Tracking Schemas", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/shelter-capacity-and-resource-tracking-schemas/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Model shelter capacity and resource inventory as COP-ready spatial features",
      "description": "Define a strict pydantic schema contract for shelters and typed resources, compute a deterministic occupancy state, raise over-capacity and resupply alerts, and publish each shelter as a lineage-stamped GeoJSON feature for the Common Operating Picture.",
      "step": [
        { "@type": "HowToStep", "name": "Define the shelter and resource schema contract", "text": "Model every shelter and its typed resource inventory as pydantic models with bounded fields, NIMS resource typing, and cross-field invariants so no impossible capacity value can enter the datastore." },
        { "@type": "HowToStep", "name": "Compute a deterministic occupancy state", "text": "Derive the capacity state from the occupancy-to-maximum ratio with fixed thresholds and integer math so every node computes the same status for the same inputs." },
        { "@type": "HowToStep", "name": "Raise over-capacity and resupply alerts", "text": "Evaluate the occupancy state and per-resource sufficiency against reorder thresholds, emitting structured alerts for over-capacity shelters and resources that will not last the operational period." },
        { "@type": "HowToStep", "name": "Publish shelter features to the Common Operating Picture", "text": "Serialize each shelter to a GeoJSON feature with normalized geometry and provenance fields so dispatch reads a single authoritative capacity picture." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should shelter capacity be a single number or several typed capacities?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Several. A single headcount hides the constraints that actually turn people away: accessible (ADA) beds, pet spaces, isolation or medical beds, and total sleeping capacity each fill at different rates. Model maximum_capacity as the governing total but carry ada_capacity, medical_capacity, and pet_capacity as separate bounded fields, because a shelter can be full for wheelchair users while still open for ambulatory occupants, and dispatch has to see both."
          }
        },
        {
          "@type": "Question",
          "name": "How do you keep occupancy state consistent across many field nodes?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Make the state a pure function of committed integer fields, not a stored flag that any node can edit. Compute status from the occupancy-to-maximum ratio with fixed thresholds and integer arithmetic, avoid floating-point comparisons on the boundary, and treat the closed operational flag as an override that always wins. Because the same inputs produce the same status everywhere, two nodes that hold the same record never disagree about whether a shelter is full."
          }
        },
        {
          "@type": "Question",
          "name": "How does this schema align with NIMS resource typing and the FEMA National Shelter System?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Carry the National Incident Management System (NIMS) kind and type code on every resource item so cots, potable water, and medical staff are counted in categories that mutual-aid partners already recognize, and expose the facility fields the Federal Emergency Management Agency (FEMA) National Shelter System expects — capacity, current population, and open or closed status — as first-class attributes. The schema is a superset: it satisfies external reporting while carrying the extra spatial and lineage fields the operational Common Operating Picture needs."
          }
        }
      ]
    }
  ]
}
</script>

# Shelter Capacity & Resource Tracking Schemas

## Problem Framing

Two hours after a levee overtops, the emergency operations center is standing up nine shelters across three counties, and the capacity picture is already wrong. One high-school gym reports "space available" on a whiteboard photo texted at 19:10 while a spreadsheet from the same site, emailed at 19:25, shows it at 140 of 120 cots — over capacity — because two agencies counted the same intake line. A partner county's shelter has run its accessible beds to zero but still shows green on the map because the feed carries one headcount and no breakdown. Dispatch, reading the map, routes a bus of forty evacuees including three wheelchair users to a site that cannot take any of them. None of the source systems is broken; there is simply no schema that makes capacity, occupancy, and resource inventory mean the same thing across every agency writing to the map. This page specifies that schema and the deterministic Python that computes state from it, implementing the [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/) contract for shelter and resource features that feed a shared Common Operating Picture (COP) under National Incident Management System (NIMS) resource typing and Federal Emergency Management Agency (FEMA) National Shelter System reporting.

## Prerequisites

This workflow assumes a senior engineer's fluency with the Python geospatial and validation stack and the following preconditions before the first shelter record is published:

- **Packages:** `pydantic >= 2.0` for the schema contract, `shapely >= 2.0` for geometry construction, and `geopandas >= 0.12` only where a shelter set is materialized to a layer. No heavyweight routing or raster dependency is required — capacity math is deliberately pure Python so it runs identically on a cloud node and a disconnected field tablet.
- **A geocoded, normalized shelter location.** Every shelter is a point feature in a single canonical reference system. Address-to-point normalization is owned upstream by the [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) workflow; this stage assumes each record already carries a valid `[lon, lat]` pair in EPSG:4326 and never re-geocodes.
- **A declared unit convention.** Resource quantities must agree on units before they are summed: potable water in litres, meals as ready-to-eat equivalents, cots as integer beds. A mixed-unit inventory is a data defect, not a rounding problem, so the unit is part of the schema, not a comment.
- **A lineage sink.** Every published shelter feature emits provenance — reporting agency, source system, observation time, and the schema version that validated it — under the [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) contract, so a post-incident audit can reconstruct who reported which capacity value and when.

## Schema and Capacity-State Model

A shelter feature is not one number on a map; it is a small graph of typed entities whose state must be computed the same way on every node. The governing entity is the shelter itself — a point geometry carrying several bounded capacity fields and an operational status. Hanging off it is a list of typed resource items (cots, potable water, meals, medical supplies, mobility equipment), each tagged with a NIMS kind and type code so mutual-aid partners count them in the same categories. The capacity status is never stored as an editable flag; it is derived from the ratio of current occupancy to maximum capacity through fixed thresholds, so two agencies holding the same record can never disagree about whether the shelter is full. The diagram below shows the data model on the left and the deterministic state ladder it drives on the right.

<figure class="diagram">
<svg viewBox="0 0 900 520" role="img" aria-label="Diagram of the shelter capacity data model and the deterministic capacity-state ladder. On the left, a Shelter entity carries a point geometry, maximum capacity, current occupancy, accessible and pet capacities, and an operational status, and owns one-to-many typed ResourceItem records that hold NIMS type, quantity on hand, quantity committed, reorder threshold, and unit. On the right, the occupancy-to-maximum ratio drives a state ladder from open, through near capacity, to full, then over capacity, which raises an alert to the Common Operating Picture; a closed operational flag overrides every state. A resource-sufficiency rule flags resupply when quantity on hand minus committed falls below the reorder threshold." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>Shelter capacity data model and deterministic capacity-state ladder</title>
  <desc>The Shelter entity holds a point geometry in EPSG:4326, a maximum capacity, a current occupancy, separate accessible and pet capacities, and an operational status. It owns one-to-many ResourceItem records, each carrying a NIMS resource type, quantity on hand, quantity committed, a reorder threshold, and a unit. The capacity state is computed from the occupancy-to-maximum ratio: below 0.90 the shelter is open, from 0.90 up to 1.0 it is near capacity, at exactly 1.0 it is full, and above 1.0 it is over capacity, which raises an over-capacity alert to the Common Operating Picture. A closed operational flag overrides every computed state. Separately, any resource whose quantity on hand minus quantity committed drops below its reorder threshold raises a resupply flag.</desc>
  <defs>
    <marker id="shelter-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="shelter-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- LEFT: data model -->
  <text x="40" y="34" font-size="12.5" font-weight="700" fill="var(--crimson, currentColor)">Data model</text>
  <!-- Shelter entity -->
  <rect x="40" y="46" width="290" height="176" rx="8" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="56" y="68" font-size="13" font-weight="700" fill="currentColor">Shelter</text>
  <line x1="40" y1="76" x2="330" y2="76" stroke="currentColor" stroke-width="1"/>
  <g font-size="11" fill="currentColor">
    <text x="56" y="96">geometry: Point [lon, lat] · EPSG:4326</text>
    <text x="56" y="115">maximum_capacity: int</text>
    <text x="56" y="134">current_occupancy: int</text>
    <text x="56" y="153">ada_capacity · medical_capacity: int</text>
    <text x="56" y="172">pet_capacity: int</text>
    <text x="56" y="191">is_open: bool  ·  status: enum (derived)</text>
    <text x="56" y="210">resources: ResourceItem[ ]</text>
  </g>
  <!-- ResourceItem entity -->
  <rect x="40" y="300" width="290" height="150" rx="8" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="56" y="322" font-size="13" font-weight="700" fill="currentColor">ResourceItem</text>
  <line x1="40" y1="330" x2="330" y2="330" stroke="currentColor" stroke-width="1"/>
  <g font-size="11" fill="currentColor">
    <text x="56" y="350">resource_type: str</text>
    <text x="56" y="369">nims_type: str (NIMS kind / type)</text>
    <text x="56" y="388">quantity_on_hand: int</text>
    <text x="56" y="407">quantity_committed: int</text>
    <text x="56" y="426">reorder_threshold: int  ·  unit: str</text>
  </g>
  <!-- relation Shelter -> ResourceItem -->
  <path d="M185,222 V300" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#shelter-plain)"/>
  <text x="196" y="266" font-size="10.5" fill="currentColor">owns 1..*</text>
  <!-- divider -->
  <line x1="372" y1="26" x2="372" y2="470" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.55"/>
  <!-- RIGHT: capacity-state ladder -->
  <text x="404" y="34" font-size="12.5" font-weight="700" fill="var(--crimson, currentColor)">Capacity state = occupancy ÷ maximum</text>
  <!-- OPEN -->
  <rect x="404" y="58" width="150" height="56" rx="8" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="479" y="82" font-size="12.5" font-weight="700" text-anchor="middle" fill="currentColor">OPEN</text>
  <text x="479" y="100" font-size="10.5" text-anchor="middle" fill="currentColor">ratio &lt; 0.90</text>
  <!-- NEAR CAPACITY -->
  <rect x="600" y="58" width="150" height="56" rx="8" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="675" y="82" font-size="12" font-weight="700" text-anchor="middle" fill="currentColor">NEAR CAPACITY</text>
  <text x="675" y="100" font-size="10.5" text-anchor="middle" fill="currentColor">0.90 ≤ ratio &lt; 1.0</text>
  <!-- FULL -->
  <rect x="600" y="164" width="150" height="56" rx="8" fill="var(--petal, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="675" y="188" font-size="12.5" font-weight="700" text-anchor="middle" fill="var(--crimson-deep, currentColor)">FULL</text>
  <text x="675" y="206" font-size="10.5" text-anchor="middle" fill="currentColor">ratio = 1.0</text>
  <!-- OVER CAPACITY -->
  <rect x="404" y="164" width="150" height="56" rx="8" fill="var(--petal, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
  <text x="479" y="188" font-size="12" font-weight="800" text-anchor="middle" fill="var(--crimson-deep, currentColor)">OVER CAPACITY</text>
  <text x="479" y="206" font-size="10.5" text-anchor="middle" fill="currentColor">ratio &gt; 1.0</text>
  <!-- CLOSED override -->
  <rect x="404" y="272" width="150" height="52" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6 4"/>
  <text x="479" y="294" font-size="12" font-weight="700" text-anchor="middle" fill="currentColor">CLOSED</text>
  <text x="479" y="312" font-size="10" text-anchor="middle" fill="currentColor">is_open = false (override)</text>
  <!-- forward transitions -->
  <g fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#shelter-plain)">
    <path d="M554,86 H600"/>
    <path d="M675,114 V164"/>
  </g>
  <!-- full -> over capacity -->
  <path d="M600,192 H554" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.7" marker-end="url(#shelter-flow)"/>
  <!-- closed override arrow -->
  <path d="M479,220 V272" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="6 4" marker-end="url(#shelter-plain)"/>
  <!-- over-capacity alert to COP -->
  <rect x="600" y="272" width="270" height="52" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="735" y="294" font-size="11.5" font-weight="700" text-anchor="middle" fill="var(--crimson, currentColor)">Over-capacity alert → COP</text>
  <text x="735" y="311" font-size="10" text-anchor="middle" fill="currentColor">structured event · reason code · lineage</text>
  <path d="M554,190 Q580,190 588,250 T600,296" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#shelter-flow)"/>
  <!-- resource sufficiency rule -->
  <rect x="404" y="372" width="466" height="82" rx="8" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.4"/>
  <text x="420" y="394" font-size="12" font-weight="700" fill="var(--crimson, currentColor)">Resource sufficiency</text>
  <text x="420" y="416" font-size="11" fill="currentColor">available = quantity_on_hand − quantity_committed</text>
  <text x="420" y="436" font-size="11" fill="currentColor">available &lt; reorder_threshold  →  raise resupply flag → COP</text>
</svg>
<figcaption>The shelter and typed-resource entities on the left drive the deterministic state ladder on the right; status is computed from the occupancy ratio, a closed flag overrides every state, over-capacity raises a structured COP alert, and any resource dropping below its reorder threshold raises a resupply flag.</figcaption>
</figure>

The state ladder is the part of the model that most repays being explicit, because it is the part teams are most tempted to simplify away.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="sh1-t sh1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="sh1-t">The capacity state is derived from the occupancy ratio, never stored as an editable flag</title>
  <desc id="sh1-d">A single axis of the ratio of current occupancy to maximum capacity, divided into four bands. Below 0.75 the shelter is OPEN, from 0.75 to 0.90 it is FILLING, from 0.90 to 1.00 it is NEAR_CAPACITY, and at or above 1.00 it is OVER_CAPACITY. The 0.90 boundary is the tunable SHELTER_NEAR_RATIO. Because the state is computed from the ratio on every node rather than stored as a flag someone sets, two agencies holding the same occupancy and capacity figures cannot disagree about whether the shelter is full — there is no separate field for them to disagree in. Lowering the near-capacity ratio buys lead time at a slow-intake site by declaring the pressure earlier.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">status = f(occupancy ÷ maximum) — there is no field for two agencies to disagree in</text>
  <text x="8" y="88" font-size="10.5" fill="currentColor">current occupancy ÷ maximum capacity</text>
  <rect x="160.0" y="110" width="365.2" height="52" rx="6" fill="var(--petal-soft)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="525.2" y="110" width="73.0" height="52" rx="6" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="598.3" y="110" width="48.7" height="52" rx="6" fill="var(--ember)" opacity="0.6" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="647.0" y="110" width="73.0" height="52" rx="6" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <path d="M160.0 166 V176" fill="none" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="160.0" y="192" font-size="10" text-anchor="middle" fill="var(--muted)">0</text>
  <path d="M525.2 166 V176" fill="none" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="525.2" y="192" font-size="10" text-anchor="middle" fill="var(--muted)">0.75</text>
  <path d="M598.3 166 V176" fill="none" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="598.3" y="192" font-size="10" text-anchor="middle" fill="var(--muted)">0.90</text>
  <path d="M647.0 166 V176" fill="none" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="647.0" y="192" font-size="10" text-anchor="middle" fill="var(--muted)">1.00</text>
  <path d="M720.0 166 V176" fill="none" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="720.0" y="192" font-size="10" text-anchor="middle" fill="var(--muted)">1.15</text>
  <text x="598.3" y="212" font-size="10" text-anchor="middle" fill="var(--crimson-deep)" font-weight="700">SHELTER_NEAR_RATIO</text>
  <circle cx="746" cy="116" r="7" fill="var(--petal-soft)"/>
  <text x="760" y="120" font-size="10.5" font-weight="700" fill="currentColor">OPEN</text>
  <circle cx="746" cy="138" r="7" fill="var(--petal)"/>
  <text x="760" y="142" font-size="10.5" font-weight="700" fill="currentColor">FILLING</text>
  <circle cx="746" cy="160" r="7" fill="var(--ember)" opacity="0.6"/>
  <text x="760" y="164" font-size="10.5" font-weight="700" fill="currentColor">NEAR_CAPACITY</text>
  <circle cx="746" cy="182" r="7" fill="var(--crimson)"/>
  <text x="760" y="186" font-size="10.5" font-weight="700" fill="currentColor">OVER_CAPACITY</text>
  <text x="8" y="252" font-size="11" font-weight="700" fill="currentColor">Why derived rather than stored</text>
  <text x="8" y="276" font-size="10.5" fill="currentColor">A stored flag is a third fact that can contradict the two it summarises. When a shelter's occupancy syncs</text>
  <text x="8" y="294" font-size="10.5" fill="currentColor">but its flag does not, the record says 340 of 350 occupied and OPEN, and every consumer picks a different</text>
  <text x="8" y="312" font-size="10.5" fill="currentColor">one to believe. Deriving the state removes the possibility rather than resolving the conflict.</text>
  <text x="8" y="344" font-size="10.5" font-weight="700" fill="var(--ember-text)">SHELTER_ZERO_CAP_OVER: an open shelter with maximum 0 and any occupant is over capacity, not valid.</text>
</svg>

The temptation is to add a `status` column that a shelter manager sets, on the reasonable-sounding grounds that the manager knows things the numbers do not. The cost is that the record then carries three facts where two would do, and the third can contradict the other two. During a sync that is not a hypothetical: occupancy updates every few minutes and a manually-set flag updates when someone remembers, so the steady state of the system is a record reading "340 of 350 occupied, status OPEN" and a set of consumers that each resolve it differently. Deriving the status makes the contradiction unrepresentable rather than merely discouraged.

The same reasoning drives the resupply threshold, which is the other place a stored constant quietly stops meaning anything.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="sh2-t sh2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="sh2-t">Why the reorder threshold is a function of consumption rate rather than a fixed count</title>
  <desc id="sh2-d">Cot stock at two shelters is plotted over four twelve-hour operational periods. Both start with 300 cots. A slow-intake shelter consumes about 40 per period and a surge-intake shelter about 130. A fixed reorder threshold of 50 units fires for both at very different moments: the slow shelter reaches it late in period six with ample time to resupply, while the surge shelter reaches it during period two, with only a few hours of stock left and a resupply lead time it cannot meet. A threshold derived instead from the site's own consumption rate times the configured number of lead periods fires for each at the same operational distance from running out, which is the quantity that actually matters.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">SHELTER_RESUPPLY_PERIODS turns a stock level into a lead time</text>
  <text x="8" y="66" font-size="10.5" fill="var(--muted)">cots on hand</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 240 H820"/><path d="M180 180 H820"/><path d="M180 120 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="140" y="304">0</text><text x="132" y="244">100</text><text x="132" y="184">200</text><text x="132" y="124">300</text>
  </g>
  <path d="M180 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 270 H820" fill="none" stroke="var(--ember)" stroke-width="1.6" stroke-dasharray="5 4"/>
  <text x="640" y="264" font-size="10.5" font-weight="700" fill="var(--ember-text)">fixed threshold · 50 units</text>
  <path d="M180 120 L340 144 L500 168 L660 192 L820 216" fill="none" stroke="var(--crimson-deep)" stroke-width="2.8"/>
  <path d="M180 120 L340 198 L500 276 L660 300" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <circle cx="633" cy="288" r="6" fill="var(--crimson)"/>
  <text x="380" y="120" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">slow intake · ~40 per period</text>
  <text x="200" y="230" font-size="10.5" font-weight="700" fill="var(--crimson)">surge intake · ~130 per period</text>
  <text x="330" y="330" font-size="10.5" font-weight="700" fill="var(--crimson)">fires here — hours of stock left</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="320">OP 1</text><text x="340" y="320">OP 2</text><text x="500" y="320">OP 3</text>
    <text x="660" y="320">OP 4</text><text x="820" y="320">OP 5</text>
  </g>
  <text x="8" y="360" font-size="10.5" fill="currentColor">Derive the threshold from each site's own burn rate and the lead periods you can actually resupply within.</text>
</svg>

A fixed reorder point of fifty cots is a number about inventory. What an operations chief needs is a number about *time* — will a resupply run started now arrive before the shelter runs out? Those coincide only if every shelter consumes at the same rate, which is exactly what a mass-care operation does not do: an evacuation-route shelter taking walk-ins during a coastal surge burns three times what a rural reception site does, and the fixed threshold fires for it two operational periods too late.

Deriving the threshold as consumption rate times `SHELTER_RESUPPLY_PERIODS` restores the property that matters. Both shelters then alarm at the same operational distance from empty, which means the alarms can be triaged by severity rather than by site, and the parameter itself becomes a statement about logistics — how many operational periods your resupply chain actually needs — rather than a guess about inventory.

## Step-by-Step Implementation

### Step 1 — Define the shelter and resource schema contract

The contract is the boundary where an impossible capacity value is stopped. Model the shelter and each resource item as `pydantic` models with bounded integer fields and cross-field invariants — occupancy cannot be negative, an accessible-bed count cannot exceed the total, and committed resource quantity cannot exceed what is on hand. Carry the NIMS kind and type code on every resource so cots and potable water are counted in categories mutual-aid partners already recognize. Validate before any record reaches the datastore, so the map can never render a shelter holding negative people or 300 of 120 beds because of a typo in an intake spreadsheet.

```python
import logging
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("incidentgis.shelter")


class ShelterStatus(str, Enum):
    OPEN = "open"
    NEAR_CAPACITY = "near_capacity"
    FULL = "full"
    OVER_CAPACITY = "over_capacity"
    CLOSED = "closed"


class ShelterRejected(RuntimeError):
    """Raised when a shelter or resource record violates the schema contract."""


class ResourceItem(BaseModel):
    resource_type: str                 # human label, e.g. "cot", "potable_water", "meal_rte"
    nims_type: Optional[str] = None    # NIMS resource kind/type code where the item is typed
    quantity_on_hand: int = Field(ge=0)
    quantity_committed: int = Field(ge=0)
    reorder_threshold: int = Field(ge=0)
    unit: str                          # litres, beds, rte_meals — no mixed units per type

    @model_validator(mode="after")
    def committed_within_hand(self) -> "ResourceItem":
        # A committed count above what is physically present is a data defect, not a shortage.
        if self.quantity_committed > self.quantity_on_hand:
            raise ValueError(
                f"{self.resource_type}: committed {self.quantity_committed} "
                f"exceeds on-hand {self.quantity_on_hand}"
            )
        return self


class Shelter(BaseModel):
    shelter_id: str
    name: str
    lon: float = Field(ge=-180.0, le=180.0)
    lat: float = Field(ge=-90.0, le=90.0)
    maximum_capacity: int = Field(ge=0)
    current_occupancy: int = Field(ge=0)
    ada_capacity: int = Field(ge=0, default=0)
    medical_capacity: int = Field(ge=0, default=0)
    pet_capacity: int = Field(ge=0, default=0)
    is_open: bool = True
    resources: List[ResourceItem] = Field(default_factory=list)
    reporting_agency: str
    observed_utc: str                  # ISO 8601, normalized upstream

    @model_validator(mode="after")
    def sub_capacities_within_total(self) -> "Shelter":
        # Accessible and medical beds are carved from the governing total, never added on top.
        for label, value in (("ada", self.ada_capacity), ("medical", self.medical_capacity)):
            if value > self.maximum_capacity:
                raise ValueError(
                    f"{label}_capacity {value} exceeds maximum_capacity {self.maximum_capacity}"
                )
        return self


def parse_shelter(record: dict) -> Shelter:
    """Validate a raw shelter record against the contract, failing closed on any violation."""
    try:
        shelter = Shelter(**record)
    except ValueError as exc:
        logger.error("Shelter rejected: %s", exc)
        raise ShelterRejected(str(exc)) from exc
    logger.info("Accepted shelter %s (%s)", shelter.shelter_id, shelter.name)
    return shelter
```

### Step 2 — Compute a deterministic occupancy state

Status must be a pure function of the committed integer fields, never a flag any node can toggle by hand. Compute the capacity state from the occupancy-to-maximum ratio using fixed thresholds and integer arithmetic on the boundary, so a shelter at exactly its maximum reads `FULL` rather than tipping between `FULL` and `NEAR_CAPACITY` on a floating-point rounding error. The closed operational flag is an override that always wins: a closed shelter is `CLOSED` regardless of how many cots remain, because dispatch must not route to it. Because the same inputs yield the same status on every node, this is the property that lets two agencies edit the same feature without disagreeing about whether it is full — the same determinism the [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) workflow depends on when it reconciles concurrent updates.

```python
import logging

logger = logging.getLogger("incidentgis.shelter")

NEAR_CAPACITY_RATIO = 0.90  # fraction of maximum at which a shelter is flagged near capacity


def derive_status(shelter: "Shelter") -> ShelterStatus:
    """Deterministically map occupancy and the open flag to a capacity state.

    Integer comparisons on the boundary avoid float rounding: FULL is exact
    equality with the maximum, over capacity is a strict integer excess.
    """
    if not shelter.is_open:
        return ShelterStatus.CLOSED

    maximum = shelter.maximum_capacity
    occupied = shelter.current_occupancy

    # A zero-capacity open shelter is degenerate; treat any occupant as over capacity.
    if maximum <= 0:
        logger.warning("Shelter %s open with zero maximum_capacity", shelter.shelter_id)
        return ShelterStatus.OVER_CAPACITY if occupied > 0 else ShelterStatus.FULL

    if occupied > maximum:
        return ShelterStatus.OVER_CAPACITY
    if occupied == maximum:
        return ShelterStatus.FULL

    # near_capacity boundary computed in integers: occupied * 100 >= ratio * maximum * 100
    near_threshold = (int(NEAR_CAPACITY_RATIO * 100) * maximum)
    if occupied * 100 >= near_threshold:
        return ShelterStatus.NEAR_CAPACITY
    return ShelterStatus.OPEN


def accessible_beds_remaining(shelter: "Shelter", ada_occupied: int) -> int:
    """Accessible beds are a separate constraint; a shelter can be OPEN yet ADA-full."""
    if ada_occupied < 0:
        raise ValueError("ada_occupied cannot be negative")
    return max(0, shelter.ada_capacity - ada_occupied)
```

### Step 3 — Raise over-capacity and resupply alerts

State on a map is passive; an alert is what actually moves a bus. Evaluate two independent rules per shelter and emit a structured event for each breach. The first is over-capacity: any shelter whose derived status is `OVER_CAPACITY` raises an alert carrying the overflow count so the operations center can open relief space. The second is resource sufficiency: for every typed resource, the *available* quantity is what is on hand minus what is already committed, and when that drops below the reorder threshold the shelter needs resupply before the next operational period. Both events are logged and returned as data, never printed, so they can be routed to the incident messaging bus and the audit trail alike.

```python
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List

logger = logging.getLogger("incidentgis.shelter")


@dataclass(frozen=True)
class ShelterAlert:
    shelter_id: str
    reason_code: str            # "over_capacity" | "resource_low"
    detail: str
    severity: str               # "warning" | "critical"
    raised_utc: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def evaluate_alerts(shelter: "Shelter") -> List[ShelterAlert]:
    """Return over-capacity and per-resource resupply alerts for one shelter."""
    alerts: List[ShelterAlert] = []
    try:
        status = derive_status(shelter)
    except ValueError as exc:
        # A record that cannot even be scored is itself a critical alert, not a silent drop.
        logger.error("Cannot score shelter %s: %s", shelter.shelter_id, exc)
        return [ShelterAlert(shelter.shelter_id, "scoring_error", str(exc), "critical")]

    if status is ShelterStatus.OVER_CAPACITY:
        overflow = shelter.current_occupancy - shelter.maximum_capacity
        detail = f"{overflow} over the {shelter.maximum_capacity}-person maximum"
        alerts.append(ShelterAlert(shelter.shelter_id, "over_capacity", detail, "critical"))
        logger.warning("OVER CAPACITY %s: %s", shelter.shelter_id, detail)

    for item in shelter.resources:
        available = item.quantity_on_hand - item.quantity_committed
        if available < item.reorder_threshold:
            detail = (
                f"{item.resource_type}: {available} {item.unit} available "
                f"(< reorder {item.reorder_threshold})"
            )
            alerts.append(ShelterAlert(shelter.shelter_id, "resource_low", detail, "warning"))
            logger.info("Resupply needed %s: %s", shelter.shelter_id, detail)

    return alerts
```

### Step 4 — Publish shelter features to the Common Operating Picture

The final stage serializes each validated, scored shelter into a GeoJSON feature the COP can render directly. The geometry is the normalized point; the properties carry the derived status, the raw capacity fields, and — critically — the lineage stamp so a reviewer can trace every rendered value back to the agency and observation time that produced it. Serialization never recomputes capacity from a display string; it reads the same integer fields Step 2 scored, so the published status and the alert stream can never diverge. This is the payload the ingestion boundary in [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) accepts and de-duplicates before it reaches the operational map.

```python
import logging
from typing import Any, Dict

logger = logging.getLogger("incidentgis.shelter")

SCHEMA_VERSION = "shelter-schema/1.2.0"


def to_geojson_feature(shelter: "Shelter") -> Dict[str, Any]:
    """Serialize a shelter to a COP-ready GeoJSON feature with derived status and lineage."""
    try:
        status = derive_status(shelter)
    except ValueError as exc:
        logger.error("Refusing to publish unscored shelter %s: %s", shelter.shelter_id, exc)
        raise ShelterRejected(f"cannot derive status for {shelter.shelter_id}") from exc

    resources = [
        {
            "resource_type": r.resource_type,
            "nims_type": r.nims_type,
            "available": r.quantity_on_hand - r.quantity_committed,
            "on_hand": r.quantity_on_hand,
            "unit": r.unit,
        }
        for r in shelter.resources
    ]

    feature = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [shelter.lon, shelter.lat]},
        "properties": {
            "shelter_id": shelter.shelter_id,
            "name": shelter.name,
            "status": status.value,
            "maximum_capacity": shelter.maximum_capacity,
            "current_occupancy": shelter.current_occupancy,
            "ada_capacity": shelter.ada_capacity,
            "medical_capacity": shelter.medical_capacity,
            "pet_capacity": shelter.pet_capacity,
            "resources": resources,
            # lineage — provenance for post-incident audit
            "reporting_agency": shelter.reporting_agency,
            "observed_utc": shelter.observed_utc,
            "schema_version": SCHEMA_VERSION,
        },
    }
    logger.info("Published shelter %s as %s", shelter.shelter_id, status.value)
    return feature
```

## Configuration Reference

Tune these parameters per deployment; a steady-state cloud node and a field-provisioned laptop will diverge, but every node in one incident must share the same threshold set or their derived statuses will disagree.

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Near-capacity ratio | `SHELTER_NEAR_RATIO` | `0.90` | Fraction of maximum that flags `NEAR_CAPACITY`; lower it for slow-intake sites where lead time matters. |
| Schema version | `SHELTER_SCHEMA_VERSION` | `shelter-schema/1.2.0` | Stamped into every feature's lineage; bump on any field change so audits pin the contract. |
| Strict units | `SHELTER_STRICT_UNITS` | `true` | When `true`, a resource whose unit is unknown for its type is rejected, not coerced. |
| Zero-capacity policy | `SHELTER_ZERO_CAP_OVER` | `true` | Treat an open shelter with zero maximum and any occupant as over capacity rather than valid. |
| Resupply lead periods | `SHELTER_RESUPPLY_PERIODS` | `1` | Operational periods of buffer the reorder threshold should cover before a shortage. |
| Alert sink | `SHELTER_ALERT_SINK` | `stdout-json` | Structured event target; point at the incident messaging bus in production, never a bare log file. |
| Canonical CRS | `SHELTER_TARGET_CRS` | `EPSG:4326` | Geometry interchange CRS; shelters publish in WGS 84 for cross-agency COP rendering. |

## Verification & Smoke Test

Run these assertions on a staging node before promoting a schema or threshold change. They confirm the contract rejects impossible records, the state function is deterministic on the boundary, and over-capacity and resupply alerts fire exactly when they should.

```python
def smoke_test() -> None:
    base = {
        "shelter_id": "SHL-001",
        "name": "Riverside High Gym",
        "lon": -95.37,
        "lat": 29.76,
        "maximum_capacity": 120,
        "current_occupancy": 108,
        "ada_capacity": 12,
        "reporting_agency": "County EOC",
        "observed_utc": "2026-07-13T19:25:00+00:00",
        "resources": [
            {"resource_type": "cot", "quantity_on_hand": 120, "quantity_committed": 108,
             "reorder_threshold": 20, "unit": "beds"},
            {"resource_type": "potable_water", "quantity_on_hand": 400, "quantity_committed": 380,
             "reorder_threshold": 50, "unit": "litres"},
        ],
    }

    # 1. Boundary determinism: 108/120 = 0.90 → exactly NEAR_CAPACITY, not OPEN.
    shelter = parse_shelter(base)
    assert derive_status(shelter) is ShelterStatus.NEAR_CAPACITY

    # 2. Over-capacity is a strict integer excess and raises a critical alert.
    over = parse_shelter({**base, "current_occupancy": 140})
    assert derive_status(over) is ShelterStatus.OVER_CAPACITY
    codes = {a.reason_code for a in evaluate_alerts(over)}
    assert "over_capacity" in codes

    # 3. Resource sufficiency: water available 400-380=20 < threshold 50 → resupply flag.
    water_codes = [a for a in evaluate_alerts(shelter) if a.reason_code == "resource_low"]
    assert any("potable_water" in a.detail for a in water_codes)

    # 4. The contract fails closed on an impossible sub-capacity.
    try:
        parse_shelter({**base, "ada_capacity": 999})
        raise AssertionError("expected ShelterRejected for ada_capacity > maximum")
    except ShelterRejected:
        pass

    # 5. A closed shelter is CLOSED regardless of remaining beds.
    closed = parse_shelter({**base, "is_open": False, "current_occupancy": 0})
    assert derive_status(closed) is ShelterStatus.CLOSED

    logger.info("shelter smoke test passed")


smoke_test()
```

A one-line dependency check for continuous integration confirms the stack is importable before the suite runs:

```bash
python -c "import pydantic, shapely, geopandas; print('shelter stack ok')"
python -m emergency_shelter.smoke   # exits non-zero on any failed assertion
```

## Integration With Adjacent Workflows

Shelter tracking sits downstream of location and upstream of the map. Each shelter's point geometry arrives already normalized from the [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) workflow, so this stage never re-geocodes an address; it trusts a validated `[lon, lat]` and rejects anything outside geographic bounds at the schema gate. Every published feature emits provenance — reporting agency, observation time, and schema version — under the [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) contract, which is what makes a contested capacity number defensible after the incident. When two agencies report the same physical shelter, the deterministic status function is what lets [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) reconcile them without a human arbitrating whether the site is full. And because capacity math is pure Python with no network dependency, the same scoring runs against a locally cached shelter set under the [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) pattern when a field node loses connectivity mid-operation.

## Troubleshooting

**Symptom: a shelter flips between `FULL` and `NEAR_CAPACITY` on consecutive refreshes with no occupancy change.** The state is being computed with a floating-point ratio and a `>=` comparison that rounds differently across builds. Use the integer boundary math in Step 2 — exact equality for `FULL`, a strict integer excess for over capacity — so a shelter at its maximum resolves to one state deterministically on every node.

**Symptom: the map shows green while wheelchair users are being turned away.** Only the total headcount is being scored; accessible beds are a separate constraint. Carry `ada_capacity` and its occupancy independently, expose `accessible_beds_remaining`, and render an ADA-full badge even when the governing status is `OPEN`, because a shelter can have general space and zero accessible space at once.

**Symptom: resupply alerts fire late, after a resource is already exhausted.** The rule is comparing raw `quantity_on_hand` to the threshold and ignoring commitments. Compute *available* as on-hand minus committed (Step 3); a cot count of 120 with 118 committed has an available of 2, and a threshold of 20 must trip on the available figure, not the shelf figure.

**Symptom: occupancy occasionally posts as a negative number and corrupts the ratio.** A raw feed is bypassing the schema contract and writing straight to the datastore. Route every write through `parse_shelter`; the `Field(ge=0)` bounds and the cross-field validators reject a negative occupancy or an over-total sub-capacity before it can be scored or rendered.

**Symptom: a post-incident audit cannot tell which agency reported a disputed capacity value.** The lineage fields are missing from the published feature. Ensure `to_geojson_feature` always stamps `reporting_agency`, `observed_utc`, and `schema_version`; a feature without provenance should never reach the COP, and the serializer should raise rather than publish one.

## Frequently Asked Questions

**Should shelter capacity be a single number or several typed capacities?**
Several. A single headcount hides the constraints that actually turn people away: accessible (ADA) beds, pet spaces, isolation or medical beds, and total sleeping capacity each fill at different rates. Model `maximum_capacity` as the governing total but carry `ada_capacity`, `medical_capacity`, and `pet_capacity` as separate bounded fields, because a shelter can be full for wheelchair users while still open for ambulatory occupants, and dispatch has to see both.

**How do you keep occupancy state consistent across many field nodes?**
Make the state a pure function of committed integer fields, not a stored flag that any node can edit. Compute status from the occupancy-to-maximum ratio with fixed thresholds and integer arithmetic, avoid floating-point comparisons on the boundary, and treat the closed operational flag as an override that always wins. Because the same inputs produce the same status everywhere, two nodes that hold the same record never disagree about whether a shelter is full.

**How does this schema align with NIMS resource typing and the FEMA National Shelter System?**
Carry the NIMS kind and type code on every resource item so cots, potable water, and medical staff are counted in categories that mutual-aid partners already recognize, and expose the facility fields the FEMA National Shelter System expects — capacity, current population, and open or closed status — as first-class attributes. The schema is a superset: it satisfies external reporting while carrying the extra spatial and lineage fields the operational Common Operating Picture needs.

## Related

- [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) — the lineage contract every published shelter feature stamps for audit.
- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) — normalizes the shelter address into the point geometry this schema trusts.
- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) — validates and de-duplicates the shelter features before they reach the operational map.
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — reconciles concurrent reports of the same shelter using the deterministic status.

Up: [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/)
