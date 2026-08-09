---
title: "Evacuation Routing & Road Network Analysis"
description: "Build auditable evacuation routing in Python on a directed road graph: one-way and contraflow handling, live hazard closures, capacity-aware paths, and reachability isochrones."
slug: evacuation-routing-and-road-network-analysis
type: guide
breadcrumb: "Evacuation Routing"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Evacuation Routing & Road Network Analysis",
      "description": "Build auditable evacuation routing in Python on a directed road graph: one-way and contraflow handling, live hazard closures, capacity-aware paths, and reachability isochrones.",
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
        { "@type": "ListItem", "position": 3, "name": "Evacuation Routing & Road Network Analysis", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Compute auditable evacuation routes on a road network under live hazard closures",
      "description": "Build a directed travel-time road graph that respects one-way and contraflow rules, overlay live hazard-perimeter closures, compute capacity-aware least-time routes to the nearest safe destination, and derive reachability isochrones for each evacuation zone.",
      "step": [
        { "@type": "HowToStep", "name": "Build a routable directed road graph", "text": "Convert road segments into a directed, travel-time-weighted graph that adds both directions for two-way roads, a single direction for one-way roads, and a governed reverse lane only when contraflow is active." },
        { "@type": "HowToStep", "name": "Apply live hazard closures", "text": "Index every edge geometry in a spatial tree, query it with the incoming hazard polygon, and remove or penalize only the intersecting edges so closures apply in milliseconds without rebuilding the graph." },
        { "@type": "HowToStep", "name": "Compute a capacity-aware route to safety", "text": "Attach a virtual sink to every safe destination and run a single least-time Dijkstra search with a BPR-style congestion weight so the fastest currently-open path to the best shelter is selected deterministically." },
        { "@type": "HowToStep", "name": "Derive evacuation-zone isochrones", "text": "Run a truncated single-source shortest-path search to the time budget and buffer the reachable nodes into a coverage surface that shows which areas can clear within the window." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why route on a directed road graph instead of straight-line distance to the nearest shelter?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Straight-line distance ignores one-way streets, rivers, closed bridges, and the hazard perimeter itself, so the nearest shelter by Euclidean distance is frequently unreachable or on the wrong side of the fire. A directed graph encodes travel time along real, currently-open segments, respects one-way and contraflow rules, and lets a single least-time search pick the shelter that is genuinely fastest to reach. It is also the only representation that can be audited edge by edge after the incident."
          }
        },
        {
          "@type": "Question",
          "name": "How should live hazard closures be applied without rebuilding the whole graph?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Keep the base road graph in memory and apply closures as a fast overlay: index every edge geometry in an STRtree, query it with the incoming hazard polygon, and remove or penalize only the intersecting edges. Rebuilding a metropolitan graph on every perimeter update costs seconds you do not have during a surge; an indexed overlay closes the affected edges in milliseconds and is trivially reversible when the hazard recedes."
          }
        },
        {
          "@type": "Question",
          "name": "Which coordinate reference system should evacuation routing run in?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A projected, metre-based system such as the local UTM zone, never geographic degrees. Edge weights, hazard buffers, capacity math, and isochrone radii are all expressed in metres, and those values are meaningless in EPSG:4326 where a degree of longitude shrinks toward the poles. Reproject the network and every hazard polygon into the same projected CRS before routing, then transform results back to WGS 84 only for display."
          }
        }
      ]
    }
  ]
}
</script>

# Evacuation Routing & Road Network Analysis

## Problem Framing

A fast-moving grass fire jumps a ridge at 14:20 and the sheriff orders a mandatory evacuation of three zones on the wildland-urban interface. Incident command needs to push turn-by-turn guidance to residents and to the deputies running door-to-door, and it needs to do so against a road network that is changing minute by minute: a low-water bridge is already under water, a two-lane county road has been converted to contraflow to double outbound capacity, and the fire perimeter itself is advancing across the only paved route out of the northern zone. If the routing engine sends a column of vehicles toward a shelter that sits on the wrong side of the fire, or up a one-way street into oncoming apparatus, the map has actively made the incident more dangerous. Evacuation routing exists to make that class of error structurally impossible: it computes least-time paths on a graph that encodes real, currently-open road segments, applies live hazard closures the instant a perimeter update lands, and records every decision so the routes remain defensible in the after-action review. This page specifies that engine as runnable Python and connects it to the wider [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/) contract that feeds it live perimeters and shelter status.

## Prerequisites

This workflow assumes a senior engineer is comfortable with graph algorithms and the Python geospatial stack, and that the following preconditions hold before the first route is computed:

- **Packages:** `networkx >= 3.0` for the directed graph and shortest-path search, `shapely >= 2.0` for geometry and the `STRtree` spatial index, and `pyproj >= 3.4` for reprojection. `igraph` or `pandana` are drop-in alternatives when the network reaches millions of edges and pure-Python Dijkstra becomes the bottleneck; the modelling here maps cleanly onto either.
- **A projected, metre-based CRS.** Every length, hazard buffer, and isochrone radius in this page is expressed in metres, which is only meaningful in a projected reference system. Route in the local Universal Transverse Mercator zone and treat geographic degrees as a display format only. The datum-aware reprojection is owned by the [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) workflow; this stage assumes the network and every hazard polygon already share one projected CRS.
- **A clean road-segment source.** Each segment must carry a stable identifier, from-node and to-node, a projected `LineString`, a length in metres, a free-flow speed, and a `oneway` flag. Whether the source is OpenStreetMap via `osmnx`, a county centreline file, or an agency roads geodatabase, the topology must be noded — segments that visually cross without sharing a node are two separate, unconnected edges and will silently break routing.
- **A live hazard feed.** Fire and flood perimeters arrive as polygons on a message backbone; the transport and delivery guarantees are handled by the [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) layer. This stage consumes a validated `Polygon` and applies it; it does not manage the subscription.
- **A shelter and assembly-point catalogue.** Destinations must be snapped to graph nodes and carry live open/closed and capacity status, aligned to the [shelter capacity and resource tracking schemas](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/shelter-capacity-and-resource-tracking-schemas/) so the router never sends evacuees to a facility that is already full.

## Routing Architecture

Evacuation routing is a staged transformation from a static base network to a hazard-aware, capacity-aware set of routes and reachability surfaces. The base graph is built once and kept resident in memory. Each perimeter update from the hazard feed is applied as a fast spatial overlay that closes or penalizes only the intersecting edges, leaving the rest of the multi-megabyte graph untouched. Routing then runs a single least-time search from each evacuation-zone origin to a virtual sink attached to every open shelter, so the algorithm — not a hand-coded rule — selects the destination that is genuinely fastest to reach on the roads that are still open. The same graph answers a second question the incident commander always asks: not just *which way out*, but *which areas can clear within the window*, which is an isochrone computed by a truncated shortest-path search. The diagram below traces a single origin-to-shelter route around a flood perimeter that has closed the three central segments.

<figure class="diagram">
<svg viewBox="0 0 880 500" role="img" aria-label="Road-network routing diagram: a grid of intersections with a flood hazard perimeter over the centre that closes three road segments; the computed evacuation route runs from the origin in the lower-left evacuation zone along the southern and eastern edges of the grid to the assembly point in the upper-right, skirting every closed segment." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>Evacuation route around a hazard perimeter on a road graph</title>
  <desc>A four-by-three grid of road intersections is drawn as nodes joined by open road segments. A flood hazard perimeter polygon covers the centre-top of the grid and closes three segments that fall inside it: the central east-west segment and two vertical segments running up from it, each marked with a cross. The origin node sits at the lower left inside an evacuation zone and the assembly point sits at the upper right. The computed evacuation route, drawn as a thick directed line, leaves the origin, runs east along the southern edge of the grid, then turns north up the eastern edge to the assembly point, avoiding every closed segment.</desc>
  <defs>
    <marker id="evac-route-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="evac-oneway-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- open road segments (grid) -->
  <g stroke="currentColor" stroke-width="1.3" opacity="0.6" fill="none">
    <line x1="120" y1="380" x2="320" y2="380"/>
    <line x1="320" y1="380" x2="520" y2="380"/>
    <line x1="520" y1="380" x2="720" y2="380"/>
    <line x1="120" y1="240" x2="320" y2="240"/>
    <line x1="520" y1="240" x2="720" y2="240"/>
    <line x1="120" y1="100" x2="320" y2="100"/>
    <line x1="320" y1="100" x2="520" y2="100"/>
    <line x1="520" y1="100" x2="720" y2="100"/>
    <line x1="120" y1="380" x2="120" y2="240"/>
    <line x1="120" y1="240" x2="120" y2="100"/>
    <line x1="320" y1="380" x2="320" y2="240"/>
    <line x1="520" y1="380" x2="520" y2="240"/>
    <line x1="720" y1="380" x2="720" y2="240"/>
    <line x1="720" y1="240" x2="720" y2="100"/>
  </g>
  <!-- one-way annotation on the left vertical -->
  <line x1="120" y1="230" x2="120" y2="120" stroke="currentColor" stroke-width="1.3" marker-end="url(#evac-oneway-arrow)"/>
  <text x="132" y="172" font-size="10" text-anchor="start" fill="currentColor" opacity="0.85">one-way</text>
  <!-- hazard perimeter -->
  <polygon points="296,150 566,140 582,268 300,276" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.7" stroke-dasharray="6 4"/>
  <text x="432" y="120" font-size="11.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">flood hazard perimeter</text>
  <!-- closed segments -->
  <g stroke="var(--crimson, currentColor)" stroke-width="1.8" stroke-dasharray="5 4" fill="none">
    <line x1="320" y1="240" x2="520" y2="240"/>
    <line x1="320" y1="240" x2="320" y2="100"/>
    <line x1="520" y1="240" x2="520" y2="100"/>
  </g>
  <g stroke="var(--crimson, currentColor)" stroke-width="2.2">
    <line x1="413" y1="233" x2="427" y2="247"/><line x1="427" y1="233" x2="413" y2="247"/>
    <line x1="313" y1="163" x2="327" y2="177"/><line x1="327" y1="163" x2="313" y2="177"/>
    <line x1="513" y1="163" x2="527" y2="177"/><line x1="527" y1="163" x2="513" y2="177"/>
  </g>
  <!-- computed evacuation route -->
  <g stroke="var(--crimson, currentColor)" stroke-width="3.4" fill="none">
    <line x1="120" y1="380" x2="320" y2="380" marker-end="url(#evac-route-arrow)"/>
    <line x1="320" y1="380" x2="520" y2="380" marker-end="url(#evac-route-arrow)"/>
    <line x1="520" y1="380" x2="720" y2="380" marker-end="url(#evac-route-arrow)"/>
    <line x1="720" y1="380" x2="720" y2="240" marker-end="url(#evac-route-arrow)"/>
    <line x1="720" y1="240" x2="720" y2="100" marker-end="url(#evac-route-arrow)"/>
  </g>
  <!-- nodes -->
  <g fill="currentColor">
    <circle cx="320" cy="380" r="4.5"/><circle cx="520" cy="380" r="4.5"/>
    <circle cx="120" cy="240" r="4.5"/><circle cx="320" cy="240" r="4.5"/>
    <circle cx="520" cy="240" r="4.5"/><circle cx="720" cy="240" r="4.5"/>
    <circle cx="120" cy="100" r="4.5"/><circle cx="320" cy="100" r="4.5"/>
    <circle cx="520" cy="100" r="4.5"/>
  </g>
  <!-- origin -->
  <circle cx="120" cy="380" r="8.5" fill="none" stroke="var(--crimson, currentColor)" stroke-width="2.2"/>
  <circle cx="120" cy="380" r="4.5" fill="var(--crimson, currentColor)"/>
  <text x="120" y="406" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">origin · evacuation zone</text>
  <!-- destination -->
  <circle cx="720" cy="100" r="8.5" fill="none" stroke="var(--crimson, currentColor)" stroke-width="2.2"/>
  <circle cx="720" cy="100" r="4.5" fill="var(--crimson, currentColor)"/>
  <text x="720" y="84" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">assembly point / shelter</text>
  <!-- legend -->
  <g font-size="10.5" fill="currentColor">
    <line x1="40" y1="462" x2="74" y2="462" stroke="var(--crimson, currentColor)" stroke-width="3.4"/>
    <text x="82" y="466" text-anchor="start">evacuation route</text>
    <line x1="212" y1="462" x2="246" y2="462" stroke="var(--crimson, currentColor)" stroke-width="1.8" stroke-dasharray="5 4"/>
    <g stroke="var(--crimson, currentColor)" stroke-width="2"><line x1="222" y1="456" x2="236" y2="468"/><line x1="236" y1="456" x2="222" y2="468"/></g>
    <text x="254" y="466" text-anchor="start">closed segment</text>
    <rect x="392" y="453" width="26" height="17" rx="3" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <text x="426" y="466" text-anchor="start">flood hazard</text>
    <line x1="560" y1="462" x2="594" y2="462" stroke="currentColor" stroke-width="1.3" opacity="0.6"/>
    <text x="602" y="466" text-anchor="start">open road</text>
  </g>
</svg>
<figcaption>The base grid holds every open road segment; the flood perimeter closes the three central segments, and a single least-time search returns the southern-then-eastern detour from the evacuation-zone origin to the assembly point.</figcaption>
</figure>

## Step-by-Step Implementation

### Step 1 — Build a routable directed road graph

Routing correctness begins with the graph. A two-way street is two directed edges; a one-way street is one; and a contraflow conversion temporarily opens the reverse lane of a one-way segment at a governed speed. Modelling these as distinct directed edges — rather than an undirected graph with side-flags — means the shortest-path search physically cannot traverse a one-way road backwards. Travel time, not raw length, is the edge weight, because a short segment on a 25 mph residential street is slower than a long segment on a highway and the evacuation cares about time.

```python
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable

import networkx as nx
from shapely.geometry import LineString

logger = logging.getLogger("incidentgis.evac.graph")


class RoadGraphError(RuntimeError):
    """Raised when the input segments cannot produce a routable graph."""


@dataclass(frozen=True)
class RoadSegment:
    seg_id: str
    u: int                    # from-node id
    v: int                    # to-node id
    geometry: LineString      # projected CRS (metres), not degrees
    length_m: float
    speed_mps: float          # free-flow speed
    oneway: bool
    contraflow_reversible: bool = False


def build_directed_graph(
    segments: Iterable[RoadSegment],
    contraflow_active: bool = False,
    contraflow_factor: float = 0.6,
) -> nx.DiGraph:
    """Build a directed, travel-time-weighted road graph.

    Two-way segments add both directions. One-way segments add only u->v,
    unless contraflow is active and the segment is flagged reversible, in
    which case the reverse lane opens at ``contraflow_factor`` of free-flow.
    """
    graph = nx.DiGraph()
    added = 0
    for seg in segments:
        try:
            if seg.length_m <= 0 or seg.speed_mps <= 0:
                raise RoadGraphError(
                    f"segment {seg.seg_id} has non-positive length or speed"
                )
            forward_time = seg.length_m / seg.speed_mps
            graph.add_edge(
                seg.u, seg.v, seg_id=seg.seg_id, length_m=seg.length_m,
                travel_time_s=forward_time, geometry=seg.geometry, direction="forward",
            )
            if not seg.oneway:
                graph.add_edge(
                    seg.v, seg.u, seg_id=seg.seg_id, length_m=seg.length_m,
                    travel_time_s=forward_time, geometry=seg.geometry, direction="reverse",
                )
            elif contraflow_active and seg.contraflow_reversible:
                # Contraflow opens the reverse lane at a governed speed only.
                graph.add_edge(
                    seg.v, seg.u, seg_id=seg.seg_id, length_m=seg.length_m,
                    travel_time_s=seg.length_m / (seg.speed_mps * contraflow_factor),
                    geometry=seg.geometry, direction="contraflow",
                )
            added += 1
        except RoadGraphError as exc:
            # A single malformed segment must not abort the whole build.
            logger.error("skip_segment", extra={"seg_id": seg.seg_id, "err": str(exc)})
            continue
    if graph.number_of_edges() == 0:
        raise RoadGraphError("no routable edges produced from input segments")
    logger.info(
        "graph_built",
        extra={"segments": added, "nodes": graph.number_of_nodes(),
               "edges": graph.number_of_edges()},
    )
    return graph
```

Build the graph deterministically: iterate segments in a stable, sorted order so that any ties in the later shortest-path search are broken identically on every run. Reproducibility is not a nicety here — a route that changes between two identical runs cannot be defended in an after-action review.

### Step 2 — Apply live hazard closures as a spatial overlay

When a new fire or flood perimeter arrives, do not rebuild the graph. Index the edge geometries once in a `shapely` `STRtree` and query it with the hazard polygon; only the handful of edges that actually intersect the perimeter need to change. The choice between *removing* an edge and *penalizing* it matters operationally: removal is correct for a flooded road that is physically impassable, while a large penalty is correct for a smoke-degraded corridor that should be used only if every clean route is gone. The live perimeters themselves come off the message backbone described in [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/); this function assumes the polygon is already validated and in the routing CRS.

```python
from __future__ import annotations

import logging

import networkx as nx
from shapely.geometry import LineString, Polygon
from shapely.strtree import STRtree

logger = logging.getLogger("incidentgis.evac.hazard")


class ClosureError(RuntimeError):
    """Raised when a hazard polygon cannot be resolved against the graph."""


def apply_hazard_closures(
    graph: nx.DiGraph,
    hazard: Polygon,
    buffer_m: float = 0.0,
    penalize_only: bool = False,
    penalty_factor: float = 1000.0,
) -> int:
    """Close or penalize every edge whose geometry intersects a hazard polygon.

    Returns the count of affected directed edges. When ``penalize_only`` is
    True the edges remain with an inflated travel time (last-resort routing);
    otherwise they are removed outright.
    """
    if hazard.is_empty or not hazard.is_valid:
        raise ClosureError("hazard polygon is empty or invalid")
    zone = hazard.buffer(buffer_m) if buffer_m else hazard

    edges = list(graph.edges(data=True))
    geoms: list[LineString] = [data["geometry"] for _, _, data in edges]
    tree = STRtree(geoms)  # bounding-box index for sub-linear candidate lookup

    affected: list[tuple[int, int]] = []
    # shapely >= 2.0: query() returns integer positions into ``geoms``.
    for pos in tree.query(zone):
        u, v, data = edges[int(pos)]
        # The bbox query is a coarse filter; confirm true intersection.
        if data["geometry"].intersects(zone):
            affected.append((u, v))

    for u, v in affected:
        if penalize_only:
            graph[u][v]["travel_time_s"] *= penalty_factor
            graph[u][v]["closed"] = "penalized"
        else:
            graph.remove_edge(u, v)

    logger.warning(
        "hazard_closures_applied",
        extra={"affected": len(affected),
               "mode": "penalize" if penalize_only else "remove",
               "buffer_m": buffer_m},
    )
    return len(affected)
```

Apply closures against a working copy of the graph (`graph.copy()`) if the base network must survive the incident untouched; removal is otherwise destructive and the base topology is gone. For a multi-day incident where perimeters advance and recede, a penalize-and-restore model on a persistent graph is usually cleaner than repeated copies.

### Step 3 — Compute a capacity-aware route to the nearest safe destination

With the graph hazard-adjusted, routing is a single shortest-path search — but "shortest" must mean least *time under load*, not least distance. A road at capacity moves slowly, so the edge weight follows a Bureau of Public Roads (BPR) style congestion curve that inflates travel time as the volume-to-capacity ratio climbs. Rather than routing to each shelter separately and comparing, attach a zero-cost virtual sink to every open destination and run one search; Dijkstra then selects the fastest-reachable shelter itself. Feed it only destinations that are actually accepting evacuees, per the shelter capacity contract.

```python
from __future__ import annotations

import logging
from typing import Callable, Hashable, Optional

import networkx as nx

logger = logging.getLogger("incidentgis.evac.route")


class NoRouteError(RuntimeError):
    """Raised when no open path exists from the origin to any safe node."""


def capacity_weight(
    congestion: dict[str, float],
    capacity_exponent: float = 4.0,
) -> Callable[[Hashable, Hashable, dict], float]:
    """Return a BPR-style edge-weight function.

    weight = free_flow_time * (1 + volume_capacity_ratio ** exponent)

    Congestion ratios arrive keyed by segment id from the live feed; a missing
    key is treated as free-flowing (0.0), never as an error.
    """
    def _weight(u: Hashable, v: Hashable, data: dict) -> float:
        base = float(data["travel_time_s"])
        ratio = max(0.0, float(congestion.get(data.get("seg_id", ""), 0.0)))
        return base * (1.0 + ratio ** capacity_exponent)
    return _weight


def route_to_safety(
    graph: nx.DiGraph,
    origin: Hashable,
    safe_nodes: set[Hashable],
    congestion: Optional[dict[str, float]] = None,
) -> list[Hashable]:
    """Least-time path from ``origin`` to the nearest open safe node.

    A virtual super-sink is attached to every safe node so a single Dijkstra
    call chooses the best destination. The sink is always removed afterwards
    so the graph is left pristine for the next query.
    """
    if origin not in graph:
        raise NoRouteError(f"origin node {origin!r} absent from graph")
    reachable_sinks = sorted(n for n in safe_nodes if n in graph)
    if not reachable_sinks:
        raise NoRouteError("no safe destination present in graph")

    weight_fn = capacity_weight(congestion or {})
    super_sink = "__SAFE_SINK__"
    graph.add_node(super_sink)
    for n in reachable_sinks:  # sorted -> deterministic tie-breaking
        graph.add_edge(n, super_sink, travel_time_s=0.0, seg_id="__sink__")
    try:
        path = nx.shortest_path(graph, origin, super_sink, weight=weight_fn)
    except nx.NetworkXNoPath as exc:
        raise NoRouteError(
            f"origin {origin!r} is isolated from every safe node"
        ) from exc
    finally:
        graph.remove_node(super_sink)  # never leave the scaffold behind

    route = path[:-1]  # drop the virtual sink from the returned path
    logger.info(
        "route_computed",
        extra={"origin": origin, "dest": route[-1], "hops": len(route)},
    )
    return route
```

The `finally` block is load-bearing: if the sink node were left attached after an exception, the next route query would traverse phantom zero-cost edges and return nonsense. Removing it unconditionally keeps the resident graph reusable across thousands of route requests during a surge.

### Step 4 — Derive evacuation-zone isochrones

Incident command needs reachability, not just routes: *which neighbourhoods can clear within fifteen minutes on the roads still open?* An isochrone answers that. Run a single-source shortest-path search truncated at the time budget, then buffer the reachable nodes into a coverage surface. Reverse the graph before the search and the same code answers the mirror question — *who can still reach this shelter* — which drives demand estimates for staffing and supplies.

```python
from __future__ import annotations

import logging
from typing import Hashable

import networkx as nx
from shapely.geometry import MultiPoint, Point, Polygon
from shapely.ops import unary_union

logger = logging.getLogger("incidentgis.evac.isochrone")


class IsochroneError(RuntimeError):
    """Raised when a reachability surface cannot be computed."""


def evacuation_isochrone(
    graph: nx.DiGraph,
    source: Hashable,
    cutoff_s: float,
    node_points: dict[Hashable, Point],
    buffer_m: float = 60.0,
) -> Polygon:
    """Reachability polygon: everywhere reachable from ``source`` within cutoff.

    Uses single-source Dijkstra truncated at the time budget, then buffers the
    reachable node points into a coverage surface. ``node_points`` maps node id
    to a projected Point so the buffer distance is a true metre radius.
    """
    if source not in graph:
        raise IsochroneError(f"source node {source!r} absent from graph")
    if cutoff_s <= 0:
        raise IsochroneError("cutoff must be a positive number of seconds")
    try:
        lengths = nx.single_source_dijkstra_path_length(
            graph, source, cutoff=cutoff_s, weight="travel_time_s"
        )
    except nx.NetworkXError as exc:
        raise IsochroneError("reachability search failed") from exc

    pts = [node_points[n] for n in lengths if n in node_points]
    if len(pts) < 3:
        raise IsochroneError("insufficient reachable nodes for a surface")

    surface = unary_union([p.buffer(buffer_m) for p in pts])
    logger.info(
        "isochrone_built",
        extra={"source": source, "reachable": len(pts), "cutoff_s": cutoff_s},
    )
    if isinstance(surface, Polygon):
        return surface
    # Disconnected buffers -> return the convex hull as a coverage envelope.
    return MultiPoint(pts).convex_hull
```

For production isochrones over a dense network, buffer-and-union of node points is a fast approximation; where a smoother boundary matters, sample points along each reachable edge or feed the reachable subgraph to a concave-hull routine. The approximation is deliberate — during an active evacuation, a surface computed in tens of milliseconds and refreshed every perimeter update beats a perfect boundary that arrives after the fire has moved.

## Configuration Reference

Tune these per deployment; a dense metropolitan graph and a rural county network will not share thresholds.

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Contraflow speed factor | `EVAC_CONTRAFLOW_FACTOR` | `0.6` | Reverse-lane speed as a fraction of free-flow when contraflow is active. |
| Hazard buffer | `EVAC_HAZARD_BUFFER_M` | `0.0` | Metres to pad the perimeter so edges skimming its edge also close. |
| Closure mode | `EVAC_PENALIZE_ONLY` | `false` | Penalize instead of remove for last-resort routing through degraded corridors. |
| Penalty factor | `EVAC_PENALTY_FACTOR` | `1000.0` | Travel-time multiplier for penalized edges. |
| BPR exponent | `EVAC_BPR_EXPONENT` | `4.0` | Steepness of the congestion curve; higher punishes near-capacity roads harder. |
| Isochrone cutoff | `EVAC_ISO_CUTOFF_S` | `900` | Reachability time budget in seconds (15 minutes). |
| Node coverage radius | `EVAC_ISO_BUFFER_M` | `60.0` | Metre buffer per reachable node when building the surface. |
| Routing CRS | `EVAC_CRS` | `EPSG:32610` | Projected metre CRS; never route in geographic degrees. |

Of the seven parameters above, the BPR exponent is the one whose default looks most arbitrary and matters most, because the whole point of an evacuation is that it happens on the part of the curve nobody normally uses.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="bpr-t bpr-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="bpr-t">The BPR congestion curve at three exponents, and what the exponent decides</title>
  <desc id="bpr-d">Travel time as a multiple of free-flow time plotted against the ratio of volume to capacity, using the Bureau of Public Roads function with exponents of two, four and eight. All three agree closely below about 70 per cent of capacity, so the exponent barely matters on an uncongested network. Past capacity they diverge sharply: at 120 per cent of capacity an exponent of two gives about 1.3 times free-flow, four gives about 1.3, and eight about 1.9 — and by 140 per cent the exponent of eight has more than doubled the penalty the exponent of two applies. Because an evacuation is precisely the condition in which corridors run past capacity, the exponent is not a tuning detail: it decides whether the router keeps loading a saturated arterial or starts pushing traffic onto parallel routes.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">EVAC_BPR_EXPONENT — irrelevant below capacity, decisive above it</text>
  <text x="8" y="70" font-size="10" fill="var(--muted)">travel time ÷ free-flow</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 260 H800"/><path d="M180 220 H800"/><path d="M180 180 H800"/><path d="M180 140 H800"/><path d="M180 100 H800"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="140" y="304">1×</text><text x="140" y="264">2×</text><text x="140" y="224">3×</text>
    <text x="140" y="184">4×</text><text x="140" y="144">5×</text><text x="140" y="104">6×</text>
  </g>
  <path d="M180 300 H800" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M622.9 60 V300" fill="none" stroke="var(--crimson-deep)" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="500" y="76" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">at capacity</text>
  <path d="M180.0 260.0 L202.1 260.0 L224.3 259.9 L246.4 259.9 L268.6 259.8 L290.7 259.6 L312.9 259.5 L335.0 259.3 L357.1 259.0 L379.3 258.8 L401.4 258.5 L423.6 258.2 L445.7 257.8 L467.9 257.5 L490.0 257.1 L512.1 256.6 L534.3 256.2 L556.4 255.7 L578.6 255.1 L600.7 254.6 L622.9 254.0 L645.0 253.4 L667.1 252.7 L689.3 252.1 L711.4 251.4 L733.6 250.6 L755.7 249.9 L777.9 249.1 L800.0 248.2" fill="none" stroke="var(--petal)" stroke-width="2.2"/>
  <path d="M180.0 260.0 L202.1 260.0 L224.3 260.0 L246.4 260.0 L268.6 260.0 L290.7 260.0 L312.9 260.0 L335.0 259.9 L357.1 259.8 L379.3 259.8 L401.4 259.6 L423.6 259.5 L445.7 259.2 L467.9 258.9 L490.0 258.6 L512.1 258.1 L534.3 257.5 L556.4 256.9 L578.6 256.1 L600.7 255.1 L622.9 254.0 L645.0 252.7 L667.1 251.2 L689.3 249.5 L711.4 247.6 L733.6 245.4 L755.7 242.9 L777.9 240.1 L800.0 237.0" fill="none" stroke="var(--crimson)" stroke-width="3.0"/>
  <path d="M180.0 260.0 L202.1 260.0 L224.3 260.0 L246.4 260.0 L268.6 260.0 L290.7 260.0 L312.9 260.0 L335.0 260.0 L357.1 260.0 L379.3 260.0 L401.4 260.0 L423.6 259.9 L445.7 259.9 L467.9 259.8 L490.0 259.7 L512.1 259.4 L534.3 259.0 L556.4 258.4 L578.6 257.4 L600.7 256.0 L622.9 254.0 L645.0 251.1 L667.1 247.1 L689.3 241.6 L711.4 234.2 L733.6 224.2 L755.7 211.1 L777.9 193.8 L800.0 171.5" fill="none" stroke="var(--crimson-deep)" stroke-width="2.2"/>
  <text x="640" y="120" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">exponent 8</text>
  <text x="640" y="232" font-size="10.5" font-weight="700" fill="var(--crimson)">exponent 4 (default)</text>
  <text x="640" y="286" font-size="10.5" font-weight="700" fill="currentColor">exponent 2</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="320">0</text><text x="357" y="320">0.4</text><text x="534" y="320">0.8</text>
    <text x="711" y="320">1.2</text><text x="800" y="320">1.4</text>
    <text x="490" y="344" font-size="11">volume ÷ capacity</text>
  </g>
  <text x="8" y="372" font-size="10.5" fill="currentColor">An evacuation is the condition that lives on the right-hand side of this chart.</text>
</svg>

Below about 70 per cent of capacity the three curves are indistinguishable, which is why the exponent almost never matters in ordinary traffic modelling and why a default gets carried forward without much thought. Past capacity they separate fast, and the separation is the behaviour the router will actually exhibit: a low exponent keeps assigning traffic to an arterial that is already saturated, because the modelled cost of doing so barely rises; a high exponent starts diverting onto parallel routes early, accepting longer nominal distances to avoid a corridor that is about to gridlock.

Neither is universally right, and the choice is a statement about the network rather than about the algorithm. Where a dense grid offers real alternatives — an urban evacuation with parallel arterials — a higher exponent uses them and spreads load. Where the alternatives are 20 kilometres of detour on a rural network with one road out, a high exponent will route evacuees onto that detour for a modelled saving that will not materialise, and the lower exponent's willingness to keep loading the main road is closer to what actually happens.

Two cautions on setting it. It interacts with `EVAC_CONTRAFLOW_FACTOR`, since contraflow raises capacity and therefore moves the whole network left along this axis — tune them together or the contraflow benefit gets eaten by a penalty curve calibrated for the pre-contraflow capacity. And validate against a real evacuation's observed travel times if you have one; a curve that reproduces a past event is worth more than any argument from first principles about the right exponent.

## Verification & Smoke Test

Run these assertions on a staging node before promoting any change to the routing engine. They confirm that a hazard closure forces a detour, that routing is deterministic, and that the graph survives a route query intact.

```python
import logging

from shapely.geometry import LineString, Polygon

logger = logging.getLogger("incidentgis.evac.smoke")


def smoke_test() -> None:
    # A unit square: node 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
    segs = [
        RoadSegment("s01", 0, 1, LineString([(0, 100), (100, 100)]), 100.0, 13.9, False),
        RoadSegment("s13", 1, 3, LineString([(100, 100), (100, 0)]), 100.0, 13.9, False),
        RoadSegment("s02", 0, 2, LineString([(0, 100), (0, 0)]), 100.0, 13.9, False),
        RoadSegment("s23", 2, 3, LineString([(0, 0), (100, 0)]), 100.0, 13.9, False),
    ]
    graph = build_directed_graph(segs)

    # 1. A hazard over the northern edge forces the southern detour 0 -> 2 -> 3.
    hazard = Polygon([(40, 92), (110, 92), (110, 108), (40, 108)])
    closed = apply_hazard_closures(graph, hazard)
    assert closed >= 1, "hazard must close the northern edge"
    route = route_to_safety(graph, origin=0, safe_nodes={3})
    assert 2 in route and 1 not in route, "route must detour south, not through the closure"

    # 2. Determinism: identical inputs yield an identical route.
    g2 = build_directed_graph(segs)
    apply_hazard_closures(g2, hazard)
    assert route == route_to_safety(g2, origin=0, safe_nodes={3}), \
        "routing must be deterministic for a fixed graph and hazard"

    # 3. The virtual sink is always cleaned up.
    assert "__SAFE_SINK__" not in graph, "super-sink must not survive a route query"

    logger.info("smoke test passed")


smoke_test()
```

A one-line CLI check confirms the stack is wired before the engine is deployed to a field node:

```bash
python -c "import networkx, shapely, pyproj; print('routing stack ok')"
```

The hazard buffer's default of zero deserves the same scrutiny, because zero is the value that makes the closure test a purely geometric one — and geometric adjacency is not the property that matters.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="hb-t hb-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="hb-t">Why a zero-metre hazard buffer leaves edges open that skim the perimeter</title>
  <desc id="hb-d">A fire perimeter is drawn with three road segments near its edge. With the hazard buffer at its default of zero metres, only the segment that geometrically crosses the perimeter is closed; a segment running parallel forty metres outside it and one clipping the perimeter at a single vertex both stay open, so the router will happily send an evacuation convoy along the edge of an active fire. Padding the perimeter by 150 metres closes all three. The buffer is not a safety margin against measurement error in the perimeter — it is an acknowledgement that a road within a hundred metres of a fire front is not usable even though it is not yet inside it.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">EVAC_HAZARD_BUFFER_M — the default of 0 closes only what the perimeter geometrically crosses</text>
  <text x="80" y="80" font-size="11" font-weight="700" fill="currentColor">buffer 0 m</text>
  <text x="500" y="80" font-size="11" font-weight="700" fill="currentColor">buffer 150 m</text>
  <path d="M120 190 Q170 110 250 130 Q330 150 340 220 Q320 300 220 300 Q120 285 120 190 Z" fill="var(--ember)" opacity="0.3" stroke="var(--ember)" stroke-width="2"/>
  <path d="M540 190 Q590 110 670 130 Q750 150 760 220 Q740 300 640 300 Q540 285 540 190 Z" fill="var(--ember)" opacity="0.3" stroke="var(--ember)" stroke-width="2"/>
  <path d="M524 190 Q580 92 678 116 Q772 142 782 222 Q758 320 638 318 Q516 300 524 190 Z" fill="none" stroke="var(--crimson-deep)" stroke-width="1.8" stroke-dasharray="6 4"/>
  <path d="M90 150 H370" fill="none" stroke="var(--ember-text)" stroke-width="3.4"/>
  <path d="M90 240 H370" fill="none" stroke="var(--crimson)" stroke-width="3.4"/>
  <path d="M90 330 H370" fill="none" stroke="var(--crimson)" stroke-width="3.4"/>
  <path d="M510 150 H790" fill="none" stroke="var(--ember-text)" stroke-width="3.4"/>
  <path d="M510 240 H790" fill="none" stroke="var(--ember-text)" stroke-width="3.4"/>
  <path d="M510 330 H790" fill="none" stroke="var(--ember-text)" stroke-width="3.4"/>
  <text x="90" y="142" font-size="9.5" fill="var(--ember-text)" font-weight="700">crosses — closed</text>
  <text x="90" y="232" font-size="9.5" fill="var(--crimson)" font-weight="700">clips one vertex — still open</text>
  <text x="90" y="322" font-size="9.5" fill="var(--crimson)" font-weight="700">40 m outside — still open</text>
  <text x="510" y="142" font-size="9.5" fill="var(--ember-text)" font-weight="700">closed</text>
  <text x="510" y="232" font-size="9.5" fill="var(--ember-text)" font-weight="700">closed</text>
  <text x="510" y="322" font-size="9.5" fill="var(--ember-text)" font-weight="700">closed</text>
  <text x="8" y="364" font-size="10.5" fill="currentColor">Not a margin for perimeter error — an acknowledgement that a road 40 m from a fire front is not a usable road.</text>
</svg>

At zero, `EVAC_HAZARD_BUFFER_M` closes exactly the edges the perimeter polygon intersects. Everything else stays in the graph, including a segment running forty metres outside an active fire front and one that touches the perimeter at a single vertex without crossing it. Both will be offered to evacuating traffic, and both are roads a division supervisor would refuse to send anyone down.

The buffer exists because the perimeter is a line on a map and the hazard is not. Radiant heat, spotting, smoke reducing visibility to nothing, and the simple fact that a fire front moves between the moment a perimeter is digitised and the moment a convoy reaches that segment — none of those are represented in the polygon, and all of them make the ground near it unusable. Padding by 100 to 200 metres encodes that, and the value is a fire-behaviour judgement rather than a GIS one; it should come from the incident's operations section, not from a config default.

The interaction with `EVAC_PENALIZE_ONLY` is worth thinking through before an incident rather than during one. With penalise-only enabled, buffered edges become extremely expensive rather than absent, so the router will still use them if there is no alternative — which is correct behaviour for a zone that would otherwise be unreachable, and dangerous behaviour if nobody notices the route went through the buffer. Pair the two settings with an explicit alert whenever a published route traverses a penalised edge, so "we had no other option" is a decision somebody made rather than a number the solver produced.

## Integration With Adjacent Workflows

Evacuation routing sits downstream of nearly every other sync workflow. Its hazard closures are driven by perimeters delivered over the [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/) backbone, so a dropped or replayed perimeter message translates directly into a wrong route — the delivery guarantees there are part of this engine's correctness envelope. Every length, buffer, and isochrone radius is metres, which is only coherent once the network and hazards share the projected reference frame that [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) establishes; route in degrees and the BPR weights and isochrones silently corrupt. Destinations come from the [shelter capacity and resource tracking schemas](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/shelter-capacity-and-resource-tracking-schemas/), so the router only ever offers open, under-capacity facilities. Because National Incident Management System (NIMS) doctrine and Federal Emergency Management Agency (FEMA) after-action review both require that operational decisions be reconstructable, the engine must emit a route record — origin, chosen destination, the perimeter version in force, the graph revision, and the ordered edge list — into the incident audit log, and it can publish reachability surfaces to an Open Geospatial Consortium (OGC) API – Features service for the common operating picture. When a perimeter advances mid-evacuation and invalidates a route already issued, the incremental reroute path is the subject of [rerouting around dynamically closed roads during flooding](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/rerouting-around-dynamically-closed-roads-during-flooding/).

## Troubleshooting

**Symptom: the route runs straight through the hazard polygon.** Almost always the network is in geographic degrees, so a `buffer_m` in metres is meaningless and the closure barely touches the edges, or the graph and the hazard are in different CRSes and never truly intersect. Reproject both into the shared projected CRS before calling `apply_hazard_closures`, and confirm `hazard.intersects` returns `True` for a known-closed edge in a unit test.

**Symptom: travel times and isochrones are absurdly small or large.** Edge weights were computed from a `length_m` that is actually in degrees, so a 100 m block reads as 0.001 "metres". Verify the segment geometries are projected and that `length_m` matches `geometry.length` to within rounding before trusting any route.

**Symptom: evacuees are directed the wrong way up a one-way street.** A segment reached `build_directed_graph` with `oneway=False` because the source attribute was missing or parsed as a string `"no"`. Validate the `oneway` flag as a real boolean at ingest, and confirm the reverse edge only ever appears for two-way roads or an active contraflow-reversible segment.

**Symptom: `NoRouteError` is raised even though roads out of the zone clearly exist.** Either the hazard buffer is large enough to close the last remaining corridor, or the origin snapped to a node on a disconnected graph component. Fall back to `penalize_only=True` so the corridor stays usable at high cost, and validate that the origin is in the graph's largest strongly-connected component before routing.

**Symptom: the same request returns a different route on successive runs.** Segments or safe nodes are being fed from an unordered `set` or `dict`, so tie-breaking in Dijkstra varies. Sort the segment iterable before `build_directed_graph` and pass `safe_nodes` through the sorted handling already in `route_to_safety`; identical inputs must always produce byte-identical routes for the audit trail to hold.

## Frequently Asked Questions

**Why route on a directed road graph instead of straight-line distance to the nearest shelter?** Straight-line distance ignores one-way streets, rivers, closed bridges, and the hazard perimeter itself, so the nearest shelter by Euclidean distance is frequently unreachable or on the wrong side of the fire. A directed graph encodes travel time along real, currently-open segments, respects one-way and contraflow rules, and lets a single least-time search pick the shelter that is genuinely fastest to reach. It is also the only representation that can be audited edge by edge after the incident.

**How should live hazard closures be applied without rebuilding the whole graph?** Keep the base road graph in memory and apply closures as a fast overlay: index every edge geometry in an STRtree, query it with the incoming hazard polygon, and remove or penalize only the intersecting edges. Rebuilding a metropolitan graph on every perimeter update costs seconds you do not have during a surge; an indexed overlay closes the affected edges in milliseconds and is trivially reversible when the hazard recedes.

**Which coordinate reference system should evacuation routing run in?** A projected, metre-based system such as the local UTM zone, never geographic degrees. Edge weights, hazard buffers, capacity math, and isochrone radii are all expressed in metres, and those values are meaningless in EPSG:4326 where a degree of longitude shrinks toward the poles. Reproject the network and every hazard polygon into the same projected CRS before routing, then transform results back to WGS 84 only for display.

## Related

- [Rerouting Around Dynamically Closed Roads During Flooding](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/rerouting-around-dynamically-closed-roads-during-flooding/)
- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/)
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/)
- [Shelter Capacity & Resource Tracking Schemas](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/shelter-capacity-and-resource-tracking-schemas/)

Up: [Incident Mapping & Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/)
