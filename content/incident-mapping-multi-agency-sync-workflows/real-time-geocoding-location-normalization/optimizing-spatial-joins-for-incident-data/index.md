# Optimizing Spatial Joins for Incident Data Under Surge Load

A county emergency operations center is fusing a live AVL (Automatic Vehicle Location) feed and a 9-1-1 call-plot stream against 1,400 jurisdictional, hazard-perimeter, and resource-grid polygons during a fast-moving wildfire. At a steady twenty positions a second the situational-awareness dashboard repaints cleanly; the moment a second mutual-aid agency joins and the rate triples, the per-point `sjoin` against every polygon turns into an O(n×m) scan, CPU saturates, the WebSocket buffer backs up, and the map freezes on a layer that is now ninety seconds stale. This page solves exactly that narrow failure — a spatial join that is correct at low volume but collapses under surge — by making the join index-first, window-batched, and degradable, after the incoming coordinates have already passed [real-time geocoding and location normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/).

## Root Cause and Operational Impact

The latency almost never lives in the geometry predicate itself. `ST_Intersects` and shapely's `intersects` are fast per pair; the cost is the number of pairs. Three upstream conditions turn a healthy join into a stall:

1. **No spatial index, so every point tests every polygon.** A naive `gpd.sjoin` still uses the index, but a hand-rolled `for point in points: for poly in polys:` loop — common in early dispatch tooling — is genuinely O(n×m). With 60 points/s and 1,400 polygons that is 84,000 predicate evaluations per second, and the GIL keeps it on one core.
2. **Mixed coordinate reference systems.** WGS 84 / EPSG:4326 degrees joined against a polygon layer in a projected state plane or UTM CRS either raises a `CRSError` or, worse, silently returns zero matches because the numeric ranges never overlap — the dashboard then shows incidents assigned to *no* jurisdiction.
3. **Synchronous per-message processing.** Joining one point per inbound message means re-acquiring locks, rebuilding candidate sets, and re-rendering on every single packet, which never amortizes and degrades non-linearly as the rate climbs.

In an office report this is a slow query. In an active incident it is a hazard: a frozen or wrong jurisdictional assignment routes a strike team across an evacuation hold line, drops a unit from the agency that actually owns the sector, or under-counts exposed structures in the NIMS (National Incident Management System) ICS-209 situation report. The fix has to hold its latency budget under surge *and* fail to a logged, audited safe default rather than to a blank map.

<svg viewBox="0 0 920 430" role="img" aria-label="Data-flow diagram of an index-first, surge-resilient spatial join. The live AVL and 9-1-1 point stream is buffered into a 2 to 5 second sliding window, reprojected from EPSG:4326 to the polygons' projected CRS, then narrowed by an R-tree or GiST bounding-box pre-filter so only candidate polygons survive. An exact intersects spatial join runs against the survivors and feeds the situational-awareness dashboard. A degraded branch shows a topology error or timeout routing the window to a nearest-centroid fallback join that stamps every row with fallback_mode true and an audit timestamp before reaching a reconciliation queue." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Index-first, window-batched spatial join with audited centroid fallback</title>
  <desc>A live stream of AVL and 9-1-1 incident points is buffered into a 2 to 5 second sliding window so index lookups and rendering amortize instead of firing per message. The window is reprojected from EPSG:4326 degrees into the jurisdiction layer's projected CRS, then passed through an R-tree or PostGIS GiST bounding-box pre-filter that discards every polygon outside the window extent, cutting the candidate set by 80 to 95 percent. An exact intersects spatial join runs only against the surviving candidates and feeds the situational-awareness dashboard along the definitive path. When the exact join raises a GEOS topology error, a CRS error, or a timeout, the window is routed to a degraded nearest-centroid fallback join bounded by a maximum distance; every degraded row is stamped with fallback_mode true and an audit timestamp and sent to a reconciliation queue rather than the map being allowed to freeze.</desc>
  <defs>
    <marker id="sj-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
    <marker id="sj-arrow-warn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <!-- 1. live stream -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <rect x="20" y="150" width="150" height="78" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="95" y="176" font-weight="700">Live point stream</text>
    <text x="95" y="195" font-size="11">AVL feed</text>
    <text x="95" y="211" font-size="11">9-1-1 call plots</text>
  </g>
  <!-- 2. sliding window buffer -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <rect x="210" y="150" width="158" height="78" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="289" y="176" font-weight="700">Sliding window</text>
    <text x="289" y="195" font-size="11">2-5 s micro-batch</text>
    <text x="289" y="211" font-size="11">join once per window</text>
  </g>
  <!-- 3. CRS normalize -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <rect x="408" y="150" width="158" height="78" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="487" y="176" font-weight="700">Reproject</text>
    <text x="487" y="195" font-family="monospace" font-size="10.5">EPSG:4326 -&gt; target</text>
    <text x="487" y="211" font-size="11">to projected CRS</text>
  </g>
  <!-- 4. index pre-filter -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <rect x="606" y="150" width="168" height="78" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="690" y="174" font-weight="700">Bbox pre-filter</text>
    <text x="690" y="192" font-size="11">R-tree / GiST index</text>
    <text x="690" y="208" font-size="11">candidates only (-80%)</text>
  </g>
  <!-- 5. exact join gate (diamond) -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <path d="M690,300 L606,255 L690,210 L774,255 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="690" y="252" font-weight="700">Exact join</text>
    <text x="690" y="270" font-size="10.5">sjoin(intersects)</text>
  </g>
  <!-- 6. dashboard (success) -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <rect x="770" y="30" width="130" height="70" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="835" y="58" font-weight="700">Dashboard</text>
    <text x="835" y="77" font-size="11">situational map</text>
  </g>
  <!-- 7. fallback (degraded) -->
  <g font-size="12.5" text-anchor="middle">
    <rect x="468" y="330" width="190" height="84" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="563" y="354" font-weight="700" fill="var(--crimson, currentColor)">Centroid fallback</text>
    <text x="563" y="373" font-size="11" fill="currentColor">sjoin_nearest · max_distance</text>
    <text x="563" y="389" font-size="10.5" fill="currentColor" font-family="monospace">fallback_mode=true</text>
    <text x="563" y="405" font-size="10.5" fill="currentColor">+ audit_ts → reconcile queue</text>
  </g>
  <!-- main left-to-right flow -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#sj-arrow)">
    <path d="M170,189 H206"/>
    <path d="M368,189 H404"/>
    <path d="M566,189 H602"/>
    <path d="M690,228 V206"/>
  </g>
  <!-- exact PASS up to dashboard -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#sj-arrow)">
    <path d="M774,255 H835 V104"/>
  </g>
  <text x="784" y="150" font-size="10.5" fill="currentColor" text-anchor="start">exact match</text>
  <!-- degraded branch to fallback -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#sj-arrow-warn)">
    <path d="M606,255 C560,255 560,300 563,326"/>
  </g>
  <text x="556" y="300" font-size="10.5" fill="var(--crimson, currentColor)" text-anchor="end">GEOS / CRS error · timeout</text>
</svg>

## Tiered Resolution Strategy

Work the join from the definitive, fully-correct path down to a safe default that is always logged and never ships silently:

1. **Definitive fix — index-first bounding-box pre-filter, then exact predicate.** Build an R-tree (`GeoDataFrame.sindex`) or PostGIS GiST index on the polygon layer once, reproject points into the polygons' projected CRS, restrict candidates with a bounding-box query (`&&` in PostGIS, `cx`/`sindex.query` in GeoPandas), and run `sjoin(predicate="intersects")` only against survivors. This cuts the candidate set by 80–95% and keeps the per-window cost flat as the point rate climbs.
2. **Batch the stream into sliding windows.** Buffer inbound points into 2–5 second micro-batches and join the whole window at once, so index lookups and rendering amortize instead of firing per message.
3. **Repair topology before it raises.** Run `make_valid()` (or `buffer(0)`) on the polygon layer at load time so self-intersections and slivers do not throw `GEOSException` mid-surge.
4. **Safe default with an audit flag.** If the exact join still raises (corrupt geometry, timeout, partitioned PostGIS), fall back to a nearest-centroid assignment with a bounded `max_distance`, stamp every degraded row with `fallback_mode=true` and an `audit_ts`, and route it to a reconciliation queue. A flagged approximate assignment is recoverable; a frozen dashboard is not.

The cost model here is worth drawing, because the difference between the naive and indexed join is not a constant factor — it is a different curve.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="sj-t sj-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="sj-t">Join time against incident count for a nested-loop join and an R-tree-backed join</title>
  <desc id="sj-d">Time to join incidents against a 12,000-polygon jurisdiction layer, plotted against the number of incidents on a logarithmic time axis. A nested-loop join tests every incident against every polygon, so its cost is the product: 1,000 incidents take about 1.4 seconds, 10,000 take about 14, and 100,000 take about 140. An R-tree-backed join tests each incident against the handful of candidate polygons its bounding box overlaps, so the cost is close to linear with a small constant: 1,000 take 0.04 seconds, 10,000 take 0.31, and 100,000 take 3.2. The two are within an order of magnitude at small volumes, which is why the naive version survives development, and two orders apart at the volumes a surge produces.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">joining against a 12,000-polygon jurisdiction layer</text>
  <text x="8" y="70" font-size="10" fill="var(--muted)">join time</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 240 H820"/><path d="M180 180 H820"/><path d="M180 120 H820"/><path d="M180 60 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="118" y="304">0.01 s</text><text x="128" y="244">0.1 s</text><text x="140" y="184">1 s</text>
    <text x="132" y="124">10 s</text><text x="126" y="64">100 s</text>
  </g>
  <path d="M180 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 213 L393 153 L607 93 L820 33" fill="none" stroke="var(--ember)" stroke-width="2.8"/>
  <path d="M180 288 L393 240 L607 191 L820 170" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <text x="560" y="80" font-size="11" font-weight="700" fill="var(--ember-text)">nested loop — O(n × m)</text>
  <text x="560" y="200" font-size="11" font-weight="700" fill="var(--crimson)">R-tree — near linear</text>
  <path d="M393 60 V300" fill="none" stroke="var(--crimson-deep)" stroke-width="1.4" stroke-dasharray="5 4"/>
  <text x="240" y="76" font-size="10" font-weight="700" fill="var(--crimson-deep)">a normal day ends here</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="320">100</text><text x="393" y="320">1 000</text><text x="607" y="320">10 000</text><text x="820" y="320">100 000</text>
    <text x="500" y="344" font-size="11">incidents joined</text>
  </g>
  <text x="8" y="372" font-size="10.5" fill="currentColor">Within an order of magnitude at development volumes; two orders apart at surge volumes.</text>
</svg>

The shape of that divergence explains why the naive join reaches production so often. At the volumes a developer works with — a few hundred incidents from a test extract — the nested loop finishes in under a second, and no profiler flags it. The cost is a product of two counts, so it only becomes visible when the count that grows during an incident actually grows.

Two practical notes about building the index. It has to be built on the *layer being searched*, not on the incidents: `geopandas` builds `sindex` lazily on first access, so a join written in the wrong direction silently indexes the small side and keeps the linear scan on the large one. And the index answers a bounding-box question, not a containment one — the candidate set it returns still has to be tested exactly. Skipping that second test is a correctness bug that surfaces as incidents assigned to a neighbouring jurisdiction whose bounding box happens to overlap.

## Production Python Implementation

The handler below normalizes and indexes the jurisdiction layer once, then joins each window index-first with an explicit fallback path. It uses full type hints, structured logging (no `print`), explicit exception boundaries, and emits an audit record on every degraded join so post-incident review can reconstruct exactly which assignments were approximate.

```python
import logging
from datetime import datetime, timezone
from typing import Tuple

import geopandas as gpd
import pandas as pd
from pyproj import CRS

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("incident_spatial_join")


class ResilientIncidentJoiner:
    """Index-first spatial join for live incident points against a static polygon
    layer, with a logged nearest-centroid fallback for degraded conditions."""

    def __init__(
        self,
        jurisdiction_gdf: gpd.GeoDataFrame,
        target_crs: str = "EPSG:32618",   # UTM 18N — set per operational area
        fallback_max_distance_m: float = 5000.0,
    ) -> None:
        self.target_crs: CRS = CRS.from_user_input(target_crs)
        self.fallback_max_distance_m = fallback_max_distance_m
        self.jurisdiction_gdf = self._normalize_and_index(jurisdiction_gdf)

    def _normalize_and_index(self, gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """Enforce the target CRS, repair invalid geometry, and force an R-tree build."""
        if gdf.crs is None:
            raise ValueError("Jurisdiction layer has no CRS; refuse to assume one.")
        if CRS.from_user_input(gdf.crs) != self.target_crs:
            logger.info("Reprojecting jurisdictions %s -> %s", gdf.crs, self.target_crs)
            gdf = gdf.to_crs(self.target_crs)
        gdf = gdf.copy()
        gdf["geometry"] = gdf["geometry"].make_valid()   # defuse GEOS topology errors
        _ = gdf.sindex                                   # trigger R-tree construction
        logger.info("Indexed %d jurisdiction polygons", len(gdf))
        return gdf

    def execute_join(self, window: gpd.GeoDataFrame) -> Tuple[gpd.GeoDataFrame, bool]:
        """Join one sliding window of incident points. Returns (result, exact)."""
        if window.crs is None:
            raise ValueError("Incident window has no CRS; normalize upstream first.")
        try:
            pts = window.to_crs(self.target_crs)

            # Bounding-box pre-filter: keep only polygons in the window's extent.
            minx, miny, maxx, maxy = pts.total_bounds
            candidates = self.jurisdiction_gdf.cx[minx:maxx, miny:maxy]
            if candidates.empty:
                logger.warning("Window extent matched no jurisdiction bbox")
                return self._fallback_centroid_join(pts)

            joined = gpd.sjoin(pts, candidates, how="left", predicate="intersects")
            unmatched = int(joined["index_right"].isna().sum())
            if unmatched:
                logger.info("%d/%d points fell outside all polygons", unmatched, len(joined))
            return joined, True

        except Exception:                # GEOSException, CRSError, timeouts, etc.
            logger.exception("Exact spatial join failed; degrading to centroid fallback")
            return self._fallback_centroid_join(window)

    def _fallback_centroid_join(self, window: gpd.GeoDataFrame) -> Tuple[gpd.GeoDataFrame, bool]:
        """Degraded mode: nearest jurisdiction within tolerance, flagged for audit."""
        pts = window.to_crs(self.target_crs)
        joined = gpd.sjoin_nearest(
            pts, self.jurisdiction_gdf, how="left",
            max_distance=self.fallback_max_distance_m,
        )
        joined["fallback_mode"] = True
        joined["audit_ts"] = datetime.now(timezone.utc).isoformat()
        logger.warning(
            "Emitted %d audit-flagged approximate assignments (max_distance=%.0fm)",
            len(joined), self.fallback_max_distance_m,
        )
        return joined, False
```

Feed the handler from the same window buffer that drains the live broker so each micro-batch is joined once rather than per message:

```python
def on_window(joiner: ResilientIncidentJoiner, batch: pd.DataFrame) -> gpd.GeoDataFrame:
    """Convert a 2-5s micro-batch of lon/lat rows to a window and join it."""
    window = gpd.GeoDataFrame(
        batch,
        geometry=gpd.points_from_xy(batch["lon"], batch["lat"]),
        crs="EPSG:4326",        # ingestion baseline; reprojected inside the joiner
    )
    result, exact = joiner.execute_join(window)
    if not exact:
        logger.warning("Window served in degraded mode — review reconciliation queue")
    return result
```

The other half of the cost lives in the CRS, and it is the half that turns a performance problem into a correctness one.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="cj-t cj-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cj-t">What a mismatched CRS does to a spatial join, at three stages</title>
  <desc id="cj-d">Three ways a join can be run against layers in different coordinate reference systems. If the frames carry different declared CRS values, geopandas raises and the join stops, which is the good outcome. If one layer has no CRS declared at all, the library assumes they match and joins raw coordinate values, so every incident falls outside every polygon and the join returns almost nothing without any error. If both are declared but one is reprojected inside the loop, the join is correct but reprojects the same geometries repeatedly, costing more than the join itself. Reprojecting both layers once, before the join, into a common projected CRS is the only arrangement that is both correct and fast.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the join is only as good as the frames going into it</text>
  <rect x="40" y="76" width="800" height="62" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="100" font-size="11" font-weight="700" fill="var(--crimson-deep)">different CRS, both declared → the library raises</text>
  <text x="60" y="120" font-size="10" fill="currentColor">a loud failure, caught in development, fixed in one line — the outcome you want</text>
  <rect x="40" y="150" width="800" height="62" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="174" font-size="11" font-weight="700" fill="var(--ember-text)">one layer has no CRS → raw values are compared</text>
  <text x="60" y="194" font-size="10" fill="currentColor">every incident falls outside every polygon · the join returns almost nothing · no error is raised</text>
  <rect x="40" y="224" width="800" height="62" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="248" font-size="11" font-weight="700" fill="currentColor">reprojected inside the loop → correct, and slower than the join</text>
  <text x="60" y="268" font-size="10" fill="currentColor">the same geometries transformed once per comparison instead of once per run</text>
  <text x="8" y="322" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Reproject both layers once, before the join, into a common projected CRS.</text>
  <text x="8" y="342" font-size="10.5" fill="currentColor">The middle row is the dangerous one: an empty result set reads as "no incidents in any jurisdiction", which is a plausible sentence.</text>
</svg>

The middle row is worth guarding against explicitly, because an empty join result is a plausible-looking outcome. "No incidents fell inside any jurisdiction" is a sentence a system can produce for legitimate reasons — an extract covering a quiet period, a filter applied upstream — so nothing about the empty frame announces that the join was meaningless.

Assert the CRS on both inputs before joining rather than relying on the library to notice. Two lines that raise on `crs is None`, and a comparison of the two EPSG codes, convert the silent failure into the loud one. It is the same fail-closed discipline the ingestion boundary applies, moved to the one place where a missing CRS produces a wrong answer rather than a rejected record.

## Validation Checklist

Verify each item before the join runs against a live operational feed:

- [ ] The jurisdiction layer is loaded with a non-`None` CRS and reprojected to the operational `target_crs` exactly once at startup.
- [ ] `GeoDataFrame.sindex` (or a PostGIS GiST index) exists on the polygon layer; no code path scans polygons in a Python `for` loop.
- [ ] Incoming points are normalized to a single CRS upstream and never joined directly from EPSG:4326 degrees against projected polygons.
- [ ] Points are buffered into 2–5 second windows; the join is called per window, not per inbound message.
- [ ] `make_valid()` runs at load time and a deliberately self-intersecting test polygon no longer raises `GEOSException`.
- [ ] A forced exception in `execute_join` falls through to the centroid path and every degraded row carries `fallback_mode=True` and an `audit_ts`.
- [ ] Bounding-box pre-filtering measurably shrinks the candidate set (log the `len(candidates)` ratio) and per-window latency holds under a simulated 3× surge.
- [ ] Points outside every polygon return null jurisdiction rather than a silent wrong match, and that count is logged per window.

## Edge Cases and Gotchas

**Axis-order inversion.** `pyproj` honours each authority's declared axis order. If points arrive as (lat, lon) but the geometry is built as `Point(x=lat, y=lon)`, the entire window lands in the wrong hemisphere and the join returns zero matches. Build geometry with `points_from_xy(lon, lat)` and spot-check one known coordinate.

**Null-island drift.** A dropped or failed transform pulls points toward (0, 0). Any point near the equator/prime-meridian intersection should be treated as a failed normalization and quarantined, not assigned to whatever polygon happens to be nearest the origin.

**Mixed-units silent zero-match.** Joining degrees against metres rarely raises — the numeric ranges simply never overlap, so `sjoin` returns all-null. Assert that the point CRS equals the polygon CRS after reprojection rather than trusting that both "look like coordinates."

**Offline device quirks.** Field tablets carry their own `pyproj` datum grids; if a high-accuracy NADCON/HARN grid is missing, the transform silently falls back to a lower-accuracy path and a point can shift across a jurisdiction boundary. Pin the grid set and assert availability before deployment.

**Agency-specific datum anomalies.** Legacy boundary files may be published in NAD27 while live feeds arrive in NAD83(2011) or ITRF2014; a coincident-datum assumption offsets assignments by tens of metres near sector edges. Resolve datum shifts explicitly during normalization. Where multiple agencies edit the same sector concurrently, pair this join with [conflict resolution in multi-agency edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) so a fast join does not overwrite a competing authoritative edit, and validate inbound geometry against [automated attribute validation rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) before it ever reaches the index.

## Related

- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/)
- [WebSocket & MQTT for Live Incident Feeds](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/)
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/)

Up: [Real-Time Geocoding & Location Normalization overview](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/)
