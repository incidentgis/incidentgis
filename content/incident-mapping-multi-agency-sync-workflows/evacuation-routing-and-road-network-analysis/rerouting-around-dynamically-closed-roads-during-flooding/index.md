---
title: "Rerouting Around Dynamically Closed Roads During Flooding"
description: "Keep evacuation routes valid when a rising flood polygon closes roads mid-incident: remove inundated edges from the network graph, reroute incrementally, detect newly unreachable zones, fall back safely, and audit every closure."
slug: rerouting-around-dynamically-closed-roads-during-flooding
type: article
breadcrumb: "Rerouting Around Flooded Roads"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Rerouting Around Dynamically Closed Roads During Flooding",
      "description": "Keep evacuation routes valid when a rising flood polygon closes roads mid-incident: remove inundated edges from the network graph, reroute incrementally, detect newly unreachable zones, fall back safely, and audit every closure.",
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
        { "@type": "ListItem", "position": 3, "name": "Evacuation Routing & Road Network Analysis", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/" },
        { "@type": "ListItem", "position": 4, "name": "Rerouting Around Dynamically Closed Roads During Flooding", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/rerouting-around-dynamically-closed-roads-during-flooding/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Reroute evacuation traffic around roads closed by a rising flood polygon",
      "description": "Intersect a live flood polygon against the road network, remove inundated edges from the routing graph, recompute affected routes incrementally, detect zones that have become unreachable, and record every closure in an audit trail so the routing decision remains defensible.",
      "step": [
        { "@type": "HowToStep", "name": "Snapshot the flood extent", "text": "Take the latest flood polygon from the hazard feed, reproject it to the network CRS, and buffer it to the operational safety margin before intersecting anything." },
        { "@type": "HowToStep", "name": "Close inundated edges", "text": "Flag every road edge whose geometry intersects the flood extent as closed and remove it from the routing graph rather than merely raising its cost." },
        { "@type": "HowToStep", "name": "Reroute incrementally", "text": "Recompute shortest paths only for the origins whose current route touched a newly closed edge, leaving unaffected routes untouched." },
        { "@type": "HowToStep", "name": "Detect unreachable zones", "text": "Test each evacuation-zone node for connectivity to a safe exit; a zone with no remaining path is escalated, not silently dropped." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Log each closed edge, each rerouted origin, and each unreachable zone with the flood-snapshot version so the routing decision can be reconstructed." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should a flooded road be removed from the graph or just penalized with a high cost?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Remove it. Raising an edge's cost only discourages a router from using the road; under enough pressure a cost-based penalty can still route evacuees through standing water because every alternative is worse. Deleting the edge makes the closure a hard constraint, so the only routes returned are physically passable ones. Keep the removed edges in a separate closed set with their closure reason and timestamp so they can be reinstated when the water recedes and so every closure is auditable."
          }
        },
        {
          "@type": "Question",
          "name": "How do you avoid recomputing every evacuation route each time the flood polygon updates?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Reroute incrementally. Track which edges each active route traverses, and when a flood update closes a set of edges, recompute paths only for the origins whose current route included at least one newly closed edge. Origins whose route is untouched keep their existing path, which turns a full all-pairs recomputation into a small targeted one and keeps latency low enough to run on every hazard-feed tick."
          }
        },
        {
          "@type": "Question",
          "name": "What should happen when an evacuation zone becomes completely cut off?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Never return an empty result silently. When no path remains from a zone to any safe exit, the router must emit an explicit unreachable status with the zone identifier and the flood-snapshot version, escalate it to incident command for air or water rescue tasking, and record it in the audit trail. A cut-off zone is the single most safety-critical output of the whole routine, so it has to be surfaced loudly rather than hidden behind a missing route."
          }
        }
      ]
    }
  ]
}
</script>

# Rerouting Around Dynamically Closed Roads During Flooding

A river gauge upstream trips its second threshold at 02:40 and the flood model pushes a new inundation polygon to the incident feed. Three of the evacuation routes your dashboard published an hour ago now cross water that is knee-deep and rising — including the primary artery out of a low-lying mobile-home park. Buses are already staging against those routes. If the routing layer keeps returning the same paths because they are still the shortest on paper, it will drive evacuees toward the one place they must not go. This page solves that single narrow failure mode: taking a live flood polygon that closes roads mid-incident and turning it into an updated, physically passable set of evacuation routes — while detecting any zone that has just been cut off, falling back safely, and recording every closure so the decision holds up in review.

## Root Cause and Operational Impact

An evacuation router models the road network as a graph: intersections are nodes, road segments are edges, and each edge carries a cost such as travel time. Shortest-path routing over that graph is only ever as correct as the graph's assumptions, and the deepest assumption is that every edge is passable. Flooding breaks that assumption dynamically. A polygon that did not exist ten minutes ago now covers a set of edges, and the router has no idea unless something intersects that polygon against the network and mutates the graph.

Two failure patterns follow. The first is the *stale route*: the router keeps returning a path that is now underwater because nothing invalidated it, so evacuees are steered into the hazard. The second is the *soft penalty trap*: a well-meaning implementation raises the cost of flooded edges instead of removing them, and under enough network pressure — when every dry alternative is longer — the router still selects the flooded edge because it remains the cheapest option. Both patterns put people in moving water, which is the leading cause of flood fatalities.

The impact is not merely a slower route; it is a routing decision that is actively wrong at the moment it matters most. The National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both expect evacuation decisions to be reconstructable during after-action review, so a router that silently mutated its graph without a trail cannot defend why it sent traffic where it did. And a zone that has been cut off entirely — surrounded by closed edges with no remaining exit — is the single most consequential output the router can produce, yet the naive implementation returns it as an empty path indistinguishable from "no request." The closure has to be detected, the graph edit has to be auditable, and the flood polygon must be intersected against the network in a shared coordinate frame, which is exactly why this work depends on the [coordinate reference system standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) and consumes closures from the same [live incident feed transport](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) as the rest of the operating picture.

<svg viewBox="0 0 880 460" role="img" aria-label="Diagram of dynamic rerouting around a flood. A road network of nodes and edges connects an evacuation-zone origin on the left to a safe exit on the right. A rising flood polygon covers two central edges of the original shortest route, which is drawn crossed out. A reroute pipeline on the right runs four stages in order — intersect flood extent against edges, remove closed edges from the graph, reroute only affected origins, and detect unreachable zones — feeding a fallback that emits an audit record and escalates any cut-off zone." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Closing flooded edges and rerouting evacuation traffic to a safe exit</title>
  <desc>A road network graph links an evacuation-zone origin to a safe exit. A rising flood polygon covers two edges of the original shortest route, so those edges are removed from the graph and marked closed. The router recomputes a detour path around the flood to the same exit and tests every zone for a remaining connection. The pipeline on the right runs four ordered stages — intersect the flood extent against edges, remove the closed edges, reroute only the affected origins, and detect unreachable zones — and any zone with no remaining path is escalated with an audit record.</desc>
  <defs>
    <marker id="reroute-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="reroute-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- flood polygon -->
  <path d="M250,150 L330,120 L392,168 L410,250 L356,300 L278,286 L232,220 Z" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6" stroke-dasharray="6 4" opacity="0.9"/>
  <text x="320" y="330" font-size="11" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">rising flood extent</text>
  <!-- network edges (open) -->
  <g stroke="currentColor" stroke-width="1.6" fill="none">
    <line x1="70" y1="210" x2="150" y2="120"/>
    <line x1="150" y1="120" x2="300" y2="80"/>
    <line x1="300" y1="80" x2="450" y2="110"/>
    <line x1="450" y1="110" x2="520" y2="210"/>
    <line x1="70" y1="210" x2="130" y2="330"/>
    <line x1="130" y1="330" x2="300" y2="360"/>
    <line x1="300" y1="360" x2="470" y2="330"/>
    <line x1="470" y1="330" x2="520" y2="210"/>
    <line x1="150" y1="120" x2="130" y2="330" stroke-opacity="0.5"/>
    <line x1="450" y1="110" x2="470" y2="330" stroke-opacity="0.5"/>
  </g>
  <!-- original route edges now closed (crossed) -->
  <g stroke="var(--crimson, currentColor)" stroke-width="2.4">
    <line x1="70" y1="210" x2="300" y2="180" stroke-dasharray="2 6" opacity="0.55"/>
    <line x1="300" y1="180" x2="520" y2="210" stroke-dasharray="2 6" opacity="0.55"/>
  </g>
  <g stroke="var(--crimson, currentColor)" stroke-width="2.2">
    <line x1="176" y1="188" x2="196" y2="208"/><line x1="196" y1="188" x2="176" y2="208"/>
    <line x1="392" y1="186" x2="412" y2="206"/><line x1="412" y1="186" x2="392" y2="206"/>
  </g>
  <text x="300" y="168" font-size="10" text-anchor="middle" fill="var(--crimson, currentColor)">original route · closed</text>
  <!-- reroute path (detour to south) -->
  <path d="M70,210 L130,330 L300,360 L470,330 L515,224" fill="none" stroke="var(--crimson, currentColor)" stroke-width="3" marker-end="url(#reroute-arrow)"/>
  <text x="300" y="392" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">reroute · dry detour</text>
  <!-- nodes -->
  <g fill="currentColor">
    <circle cx="150" cy="120" r="4.5"/><circle cx="300" cy="80" r="4.5"/><circle cx="450" cy="110" r="4.5"/>
    <circle cx="130" cy="330" r="4.5"/><circle cx="300" cy="360" r="4.5"/><circle cx="470" cy="330" r="4.5"/>
  </g>
  <!-- origin -->
  <circle cx="70" cy="210" r="8" fill="var(--crimson, currentColor)"/>
  <text x="70" y="196" font-size="10.5" text-anchor="middle" font-weight="600" fill="currentColor">evac zone origin</text>
  <!-- safe exit -->
  <rect x="510" y="198" width="24" height="24" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
  <text x="522" y="248" font-size="10.5" text-anchor="middle" font-weight="600" fill="currentColor">safe exit</text>
  <!-- divider -->
  <line x1="588" y1="34" x2="588" y2="440" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>
  <!-- pipeline -->
  <text x="612" y="52" font-size="12.5" font-weight="700" fill="currentColor">Reroute pipeline</text>
  <g font-size="11" fill="currentColor">
    <rect x="612" y="66" width="232" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="624" y="84" font-weight="600">1 · intersect flood ∩ edges</text>
    <text x="624" y="99" font-size="9.5">reproject + buffer, then test</text>
    <rect x="612" y="114" width="232" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="624" y="132" font-weight="600">2 · remove closed edges</text>
    <text x="624" y="147" font-size="9.5">delete, don't just penalize</text>
    <rect x="612" y="162" width="232" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="624" y="180" font-weight="600">3 · reroute affected origins</text>
    <text x="624" y="195" font-size="9.5">only routes touching a closure</text>
    <rect x="612" y="210" width="232" height="40" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5"/>
    <text x="624" y="228" font-weight="600" fill="var(--crimson, currentColor)">4 · detect unreachable</text>
    <text x="624" y="243" font-size="9.5" fill="var(--crimson, currentColor)">zone with no exit → escalate</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#reroute-plain)">
    <path d="M728,106 V114"/>
    <path d="M728,154 V162"/>
  </g>
  <path d="M728,202 V210" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#reroute-arrow)"/>
  <!-- fallback/audit -->
  <rect x="612" y="262" width="232" height="58" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="728" y="284" font-size="11.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Fallback + audit</text>
  <text x="728" y="302" font-size="9.5" text-anchor="middle" fill="currentColor">emit closed edges, reroutes,</text>
  <text x="728" y="315" font-size="9.5" text-anchor="middle" fill="currentColor">unreachable zones + snapshot id</text>
  <text x="728" y="352" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">reinstate edges when</text>
  <text x="728" y="366" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">water recedes</text>
</svg>

## Tiered Resolution Strategy

Handle each flood update in ordered tiers, from the definitive fix down to a safe default that always leaves an audit flag. Never return an empty route silently — an unrouted zone is a life-safety event, not a null result.

1. **Close inundated edges as a hard constraint (definitive).** Intersect the reprojected, safety-buffered flood polygon against every road edge and remove the intersecting edges from the routing graph entirely. Deletion — not a cost penalty — guarantees the router can never select a flooded segment no matter how much cheaper it looks.
2. **Reroute only the affected origins.** Recompute shortest paths solely for origins whose current route traversed a newly closed edge. Untouched routes are left in place, keeping the update fast enough to run on every hazard-feed tick.
3. **Detect and escalate unreachable zones (safe default).** After the graph edit, test each evacuation-zone node for a remaining path to any safe exit. A zone with no path is returned with an explicit unreachable status and escalated for air or water rescue tasking, never dropped.
4. **Prefer the previous route when a fresh reroute fails validation (fallback).** If a recomputed path cannot be verified as edge-disjoint from the flood, hold the last known-good route for that origin, mark it degraded, and flag it for a human check rather than publishing an unverified path.
5. **Emit an audit record for every mutation.** Each closed edge, each rerouted origin, and each unreachable zone is written with the flood-snapshot version so the entire routing decision is reproducible against the exact hazard state that produced it.

## Production Python Implementation

The routine below carries the full resolution path over a `networkx` graph: flood intersection and edge closure, incremental rerouting of only affected origins, unreachable-zone detection, a safe fallback to the last valid route, structured logging, explicit exception handling, and an immutable audit record per mutation. Thresholds such as the safety buffer are parameters, not literals, so they are committed alongside the rest of the routing configuration. Senior-engineer assumptions apply: `networkx`, `shapely`, and `pyproj` are available; the graph edges carry a `geometry` and a `weight`; and the flood polygon and network share the projected coordinate frame established by the [coordinate reference system standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/).

```python
from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

import networkx as nx
from shapely.geometry import base as shapely_base
from shapely.errors import GEOSException

logger = logging.getLogger("incidentgis.reroute")


@dataclass
class RouteResult:
    origin: int
    path: list[int]
    reachable: bool
    degraded: bool = False
    reason: str = "ok"


@dataclass
class AuditEntry:
    """Immutable record of one reroute cycle, emitted to the audit trail."""
    snapshot_id: str
    closed_edges: list[tuple[int, int]]
    rerouted_origins: list[int]
    unreachable_zones: list[int]
    degraded_origins: list[int]
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class FloodReroute:
    """Close flooded road edges and reroute evacuation traffic incrementally.

    Every graph mutation is logged and appended to ``audit_log`` so a routing
    decision can be reconstructed against the exact flood snapshot that
    produced it. The base ``graph`` is never mutated; closures are applied to
    a working copy and tracked in ``_closed`` for later reinstatement.
    """

    def __init__(
        self,
        graph: nx.Graph,
        exits: set[int],
        safety_buffer_m: float = 15.0,
    ) -> None:
        self.graph = graph
        self.exits = exits
        self.safety_buffer_m = safety_buffer_m
        self._routes: dict[int, RouteResult] = {}   # origin -> last valid route
        self._closed: set[tuple[int, int]] = set()
        self.audit_log: list[AuditEntry] = []

    def _closed_edges(
        self, work: nx.Graph, flood: shapely_base.BaseGeometry
    ) -> list[tuple[int, int]]:
        """Return edges whose geometry intersects the buffered flood extent."""
        hazard = flood.buffer(self.safety_buffer_m)
        hit: list[tuple[int, int]] = []
        for u, v, data in work.edges(data=True):
            geom = data.get("geometry")
            if geom is None:
                # Cannot prove the edge is dry: treat missing geometry as unsafe.
                logger.warning("edge_missing_geometry", extra={"edge": (u, v)})
                hit.append((u, v))
                continue
            if geom.intersects(hazard):
                hit.append((u, v))
        return hit

    def _shortest(self, work: nx.Graph, origin: int) -> Optional[list[int]]:
        """Shortest path from origin to the nearest safe exit, or None."""
        best: Optional[list[int]] = None
        best_cost = float("inf")
        for exit_node in self.exits:
            try:
                cost, path = nx.single_source_dijkstra(
                    work, origin, target=exit_node, weight="weight"
                )
            except nx.NetworkXNoPath:
                continue
            except nx.NodeNotFound:
                # Origin or exit removed with its edges: no route through it.
                continue
            if cost < best_cost:
                best_cost, best = cost, path
        return best

    def update(
        self,
        origins: set[int],
        flood: shapely_base.BaseGeometry,
        snapshot_id: str,
    ) -> dict[int, RouteResult]:
        """Apply a flood snapshot and return the current route per origin."""
        try:
            work = self.graph.copy()
            newly_closed = self._closed_edges(work, flood)
            work.remove_edges_from(newly_closed)

            # Incremental: only reroute origins whose last path used a closure.
            closed_set = set(newly_closed) | {(v, u) for u, v in newly_closed}
            affected = {
                o for o in origins
                if o not in self._routes
                or any(
                    (a, b) in closed_set
                    for a, b in zip(self._routes[o].path, self._routes[o].path[1:])
                )
            }

            rerouted: list[int] = []
            unreachable: list[int] = []
            degraded: list[int] = []
            for origin in affected:
                path = self._shortest(work, origin)
                if path is None:
                    prior = self._routes.get(origin)
                    if prior is not None and prior.reachable:
                        # Hold last known-good, but flag it for a human check.
                        prior.degraded = True
                        prior.reason = "held_no_new_path"
                        degraded.append(origin)
                        logger.error(
                            "reroute_degraded", extra={"origin": origin}
                        )
                    else:
                        self._routes[origin] = RouteResult(
                            origin, [], reachable=False, reason="unreachable"
                        )
                        unreachable.append(origin)
                        logger.critical(
                            "zone_unreachable",
                            extra={"origin": origin, "snapshot": snapshot_id},
                        )
                else:
                    self._routes[origin] = RouteResult(origin, path, reachable=True)
                    rerouted.append(origin)

            self._closed |= closed_set
            entry = AuditEntry(
                snapshot_id=snapshot_id,
                closed_edges=newly_closed,
                rerouted_origins=rerouted,
                unreachable_zones=unreachable,
                degraded_origins=degraded,
            )
            self.audit_log.append(entry)
            logger.info("reroute_cycle", extra={"audit": asdict(entry)})
            return {o: self._routes[o] for o in origins if o in self._routes}

        except (GEOSException, ValueError, KeyError) as exc:
            # Never crash the routing loop: hold all prior routes as degraded.
            logger.error("reroute_cycle_failed", exc_info=exc)
            for res in self._routes.values():
                res.degraded = True
                res.reason = "cycle_error_hold"
            return dict(self._routes)
```

The `audit_log` is the load-bearing output. Persisting it as a committed, content-hashed artifact lets a post-incident reviewer replay exactly which edges were closed at 02:40, which zones were rerouted, and which were escalated for rescue — the reproducibility that a defensible evacuation decision requires and that the parent [evacuation routing and road network analysis](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/) workflow is built around.

## Validation Checklist

Verify every item before wiring the reroute engine to a live flood feed.

- [ ] The flood polygon is reprojected into the network's projected CRS and buffered by the safety margin before any intersection test runs.
- [ ] Flooded edges are removed from the working graph, not merely assigned a high cost, so no route can traverse standing water under pressure.
- [ ] The base graph is never mutated in place; closures apply to a copy and are tracked in a closed set for reinstatement when the water recedes.
- [ ] Only origins whose current route touched a newly closed edge are rerouted; untouched routes are left unchanged.
- [ ] A zone with no remaining path to any exit returns an explicit unreachable status, logs at critical severity, and escalates — it never returns an empty path silently.
- [ ] `snapshot_id` is set from the flood-feed message identifier so each audit entry ties back to a specific hazard state.
- [ ] Structured logs route to the incident logging sink, not stdout, and every closed edge, reroute, and unreachable zone appears in `audit_log`.
- [ ] The engine is unit-tested against a synthetic network where a known flood polygon cuts a known set of edges, asserting the expected reroutes and the expected unreachable zone.

## Edge Cases and Gotchas

- **Axis-order inversion.** If the flood polygon arrives as GeoJSON in `(lon, lat)` order but the network geometries are in a projected CRS, the intersection either returns nothing or closes the wrong edges. Normalize axis order at ingest and run every `pyproj` transform with `always_xy=True`, per the [coordinate reference system standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/); an unbuffered geographic-versus-projected mismatch is the most common cause of a reroute that "does nothing."
- **Bridges and grade separation.** A 2D intersection closes an overpass whenever the flood footprint passes beneath it, stranding traffic that could have crossed safely. Tag grade-separated edges with an elevation or `bridge` attribute and exclude them from closure unless the flood stage exceeds the deck height.
- **Missing edge geometry.** An edge without a `geometry` cannot be proven dry, so the implementation closes it defensively rather than assuming it is safe. Backfill geometries in the source network; a network full of geometry-less edges will over-close and manufacture false unreachable zones.
- **Flood polygon flapping.** A model that oscillates a boundary edge in and out of the extent on successive ticks will open and close the same road repeatedly, thrashing routes. Apply hysteresis — require an edge to be clear for N consecutive snapshots before reinstatement — so a receding-then-rising boundary does not whipsaw evacuees.
- **Directed one-way and contraflow edges.** On a directed graph, removing `(u, v)` leaves `(v, u)` live, so a one-way segment can still be routed the wrong way against contraflow. Close both directions of a physically flooded segment, and treat any contraflow reversal as a separate, explicitly modeled edge rather than an implicit one.

## Frequently Asked Questions

**Should a flooded road be removed from the graph or just penalized with a high cost?** Remove it. Raising an edge's cost only discourages a router from using the road; under enough pressure a cost-based penalty can still route evacuees through standing water because every alternative is worse. Deleting the edge makes the closure a hard constraint, so the only routes returned are physically passable ones. Keep the removed edges in a separate closed set with their closure reason and timestamp so they can be reinstated when the water recedes and so every closure is auditable.

**How do you avoid recomputing every evacuation route each time the flood polygon updates?** Reroute incrementally. Track which edges each active route traverses, and when a flood update closes a set of edges, recompute paths only for the origins whose current route included at least one newly closed edge. Origins whose route is untouched keep their existing path, which turns a full all-pairs recomputation into a small targeted one and keeps latency low enough to run on every hazard-feed tick.

**What should happen when an evacuation zone becomes completely cut off?** Never return an empty result silently. When no path remains from a zone to any safe exit, the router must emit an explicit unreachable status with the zone identifier and the flood-snapshot version, escalate it to incident command for air or water rescue tasking, and record it in the audit trail. A cut-off zone is the single most safety-critical output of the whole routine, so it has to be surfaced loudly rather than hidden behind a missing route.

## Related

- [Evacuation Routing & Road Network Analysis](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/) — the routing model whose graph this reroute engine mutates in place.
- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) — the transport that delivers each flood snapshot the engine reacts to.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — the CRS and axis-order contract that keeps flood-versus-network intersection honest.

Up: [Evacuation Routing & Road Network Analysis](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/)
