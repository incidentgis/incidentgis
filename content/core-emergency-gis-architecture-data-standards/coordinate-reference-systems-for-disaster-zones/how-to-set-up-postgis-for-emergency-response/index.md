# How to Set Up PostGIS for Emergency Response

A county emergency operations center stands up a fresh PostGIS instance at the start of a flood activation, and within the first operational period three feeds — sheriff GPS tracks in WGS 84, a parcel layer in NAD83 State Plane, and a tactical overlay in a localized UTM grid — land in the same `incidents` table. The first spatial join to render a combined common operating picture either errors with `Operation on mixed SRID geometries` or, worse, returns silently misaligned geometry that places a shelter marker on the wrong block. The single narrow failure this page solves is the one that derails a new emergency PostGIS deployment every time: a database initialized without an enforced single operational [Coordinate Reference System for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/), so SRID fragmentation and unindexed geometry surface as data corruption and query collapse exactly when command needs the map most.

## Root Cause and Operational Impact

The danger is not that PostGIS cannot hold multiple coordinate systems — it can. The danger is that a default install does nothing to *force* convergence, so the failure is deferred until the worst possible moment. Three root causes compound:

1. **No SRID constraint on the geometry column.** A column declared `geometry` (with no type/SRID modifier) accepts a point in EPSG:4326 and a polygon in EPSG:2229 into adjacent rows. `ST_Intersects`, `ST_DWithin`, and every spatial join then throw a mixed-SRID error mid-incident, or — if the application strips SRIDs first — return geometrically meaningless results.
2. **No spatial index, or a deferred one.** Without a `GIST` index, every bounding-box filter degrades to a sequential scan. Under surge load, when six agencies are each panning the map and re-querying, sequential scans saturate the database and the common operating picture stops refreshing.
3. **Non-transactional ingestion over an unstable WAN.** Field connectivity drops mid-`COPY`, a partial batch commits, and the operational table now holds half a feed with no way to tell which rows are missing.

In a routine GIS shop these are tuning notes for next sprint. In an active incident they are hazards: a misaligned hazard polygon moves an evacuation hold line across a road, a stalled query blanks the situational map during a tactical push, and a half-ingested feed corrupts multi-agency data fusion because every downstream consumer trusts the table without re-checking it. The setup has to enforce convergence at the schema level, index immediately, and ingest transactionally — not best-effort.

<svg viewBox="0 0 780 470" role="img" aria-label="Data-flow pipeline ingesting three differently-projected emergency feeds into a single SRID-constrained PostGIS table, with bad rows routed to an audit table instead of being dropped." xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-width:780px;display:block;margin:1.5rem auto;font-family:inherit;color:var(--ink)">
  <title>PostGIS convergence pipeline: mixed-SRID feeds into one operational CRS</title>
  <desc>Three inbound feeds arrive in different coordinate systems: sheriff GPS in WGS 84 (EPSG:4326), a parcel layer in NAD83 State Plane (EPSG:2229), and a tactical overlay in a localized UTM grid. All three land first in a staging schema that preserves each native SRID. A BEFORE INSERT trigger then runs ST_MakeValid to repair geometry and ST_Transform to reproject every feature into a single operational CRS, EPSG:4326. Confirmed rows are upserted into the operational.incidents table, whose geometry column is SRID-constrained as geometry(Point, 4326), carries a ST_IsValid CHECK, and is GIST-indexed. Rows whose source SRID is unknown or whose geometry cannot be repaired branch off to a staging.rejects audit table with a reason code, rather than being silently dropped or aborting the batch.</desc>
  <defs>
    <marker id="pg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="currentColor"/>
    </marker>
    <marker id="pg-arrow-fail" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--crimson,#c8102e)"/>
    </marker>
  </defs>
  <style>
    .pg-box{fill:var(--cream,#fff);stroke:currentColor;stroke-width:1.5;}
    .pg-accent{fill:var(--petal-soft,#ffe6ea);stroke:var(--crimson,#c8102e);stroke-width:1.6;}
    .pg-good{fill:var(--ok-bg,#f5fff7);stroke:var(--ok-fg,#075d2a);stroke-width:1.7;}
    .pg-goodt{fill:var(--ok-fg,#075d2a);}
    .pg-fail{fill:var(--petal,#ffd1d8);stroke:var(--crimson,#c8102e);stroke-width:1.5;}
    .pg-t{fill:currentColor;font-size:13px;}
    .pg-sub{fill:var(--muted,#6b4549);font-size:11px;}
    .pg-failt{fill:var(--crimson-deep,#7a0a1f);font-size:12px;}
    .pg-flow{fill:none;stroke:currentColor;stroke-width:1.6;marker-end:url(#pg-arrow);}
    .pg-flowfail{fill:none;stroke:var(--crimson,#c8102e);stroke-width:1.6;stroke-dasharray:5 4;marker-end:url(#pg-arrow-fail);}
    .pg-lbl{font-size:13px;font-weight:600;}
    .pg-zone{fill:none;stroke:currentColor;stroke-width:1;stroke-dasharray:3 4;opacity:.55;}
  </style>
  <!-- column headers -->
  <text class="pg-sub" x="98" y="20" text-anchor="middle" font-weight="600">inbound feeds</text>
  <text class="pg-sub" x="300" y="20" text-anchor="middle" font-weight="600">staging (native SRID)</text>
  <text class="pg-sub" x="498" y="20" text-anchor="middle" font-weight="600">normalize on promote</text>
  <text class="pg-sub" x="692" y="20" text-anchor="middle" font-weight="600">operational (one CRS)</text>
  <!-- Feed 1: GPS -->
  <rect class="pg-box" x="14" y="44" width="168" height="60" rx="8"/>
  <text class="pg-t pg-lbl" x="98" y="68" text-anchor="middle">sheriff GPS tracks</text>
  <text class="pg-sub" x="98" y="86" text-anchor="middle">WGS 84 &#183; EPSG:4326</text>
  <!-- Feed 2: parcels -->
  <rect class="pg-box" x="14" y="124" width="168" height="60" rx="8"/>
  <text class="pg-t pg-lbl" x="98" y="148" text-anchor="middle">parcel layer</text>
  <text class="pg-sub" x="98" y="166" text-anchor="middle">NAD83 State Plane &#183; 2229</text>
  <!-- Feed 3: tactical -->
  <rect class="pg-box" x="14" y="204" width="168" height="60" rx="8"/>
  <text class="pg-t pg-lbl" x="98" y="228" text-anchor="middle">tactical overlay</text>
  <text class="pg-sub" x="98" y="246" text-anchor="middle">localized UTM grid</text>
  <!-- Staging -->
  <rect class="pg-zone" x="226" y="40" width="148" height="232" rx="10"/>
  <rect class="pg-box" x="240" y="116" width="120" height="80" rx="8"/>
  <text class="pg-t pg-lbl" x="300" y="150" text-anchor="middle">staging</text>
  <text class="pg-sub" x="300" y="170" text-anchor="middle">raw rows,</text>
  <text class="pg-sub" x="300" y="184" text-anchor="middle">SRIDs preserved</text>
  <!-- Trigger -->
  <rect class="pg-accent" x="424" y="112" width="148" height="88" rx="8"/>
  <text class="pg-failt pg-lbl" x="498" y="136" text-anchor="middle" style="fill:var(--crimson,#c8102e)">BEFORE INSERT</text>
  <text class="pg-sub" x="498" y="156" text-anchor="middle">ST_MakeValid()</text>
  <text class="pg-sub" x="498" y="172" text-anchor="middle">ST_Transform(&#8594; 4326)</text>
  <text class="pg-sub" x="498" y="188" text-anchor="middle">repair + reproject</text>
  <!-- Operational -->
  <rect class="pg-good" x="612" y="100" width="156" height="112" rx="8"/>
  <text class="pg-goodt pg-lbl" x="690" y="126" text-anchor="middle">operational.incidents</text>
  <text class="pg-sub" x="690" y="146" text-anchor="middle">geometry(Point, 4326)</text>
  <text class="pg-sub" x="690" y="162" text-anchor="middle">CHECK ST_IsValid(geom)</text>
  <text class="pg-sub" x="690" y="178" text-anchor="middle">GIST index on geom</text>
  <text class="pg-sub" x="690" y="196" text-anchor="middle">ON CONFLICT upsert</text>
  <!-- Reject / audit -->
  <rect class="pg-fail" x="424" y="356" width="344" height="86" rx="8"/>
  <text class="pg-failt pg-lbl" x="596" y="382" text-anchor="middle">staging.rejects (audit, not dropped)</text>
  <text class="pg-sub" x="596" y="402" text-anchor="middle">unknown SRID &#183; unrepairable geometry</text>
  <text class="pg-sub" x="596" y="418" text-anchor="middle">raw_payload + reason code, recoverable next period</text>
  <!-- feed -> staging arrows -->
  <path class="pg-flow" d="M182 74 L210 74 Q226 74 226 90 L226 132 L238 132"/>
  <path class="pg-flow" d="M182 154 L238 154"/>
  <path class="pg-flow" d="M182 234 L210 234 Q226 234 226 218 L226 178 L238 178"/>
  <!-- staging -> trigger -->
  <line class="pg-flow" x1="360" y1="156" x2="422" y2="156"/>
  <!-- trigger -> operational -->
  <line class="pg-flow" x1="572" y1="156" x2="610" y2="156"/>
  <!-- trigger -> rejects (failure branch) -->
  <path class="pg-flowfail" d="M498 200 L498 354"/>
  <!-- staging missing-srid straight to rejects -->
  <path class="pg-flowfail" d="M300 196 L300 399 L422 399"/>
  <!-- legend -->
  <line x1="14" y1="452" x2="44" y2="452" stroke="currentColor" stroke-width="1.6"/>
  <text class="pg-sub" x="50" y="456">confirmed &#8594; operational picture</text>
  <line x1="246" y1="452" x2="276" y2="452" stroke="var(--crimson,#c8102e)" stroke-width="1.6" stroke-dasharray="5 4"/>
  <text class="pg-sub" x="282" y="456">quarantined to audit table</text>
</svg>

The first two root causes are worth looking at separately, because one of them is a correctness failure deferred to the worst moment and the other is a performance failure that only appears when a second person shows up.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="pgb-t pgb-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="pgb-t">What an unconstrained geometry column accepts, and what a SRID-typed one refuses</title>
  <desc id="pgb-d">Two versions of the same table. On the left the geometry column is declared with no type or SRID modifier, so it accepts four rows in three different coordinate systems: sheriff GPS in EPSG 4326, a parcel layer in EPSG 2229, a tactical overlay in EPSG 32611 and shelter points in EPSG 4326. Any spatial predicate across them then fails at query time with a mixed-SRID error, mid-incident, or returns geometrically meaningless results if the application has stripped the SRIDs first. On the right the column is declared geometry Point 4326, so the two off-frame rows are refused at INSERT time by the authoring agency's own load job, and every query afterwards operates in one frame. The constraint does not prevent the problem occurring; it moves the failure from query time to load time, where there is somebody to fix it.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the constraint does not prevent the error — it moves it from query time to load time</text>
  <text x="60" y="80" font-size="11" font-weight="700" fill="currentColor">geometry</text>
  <text x="470" y="80" font-size="11" font-weight="700" fill="currentColor">geometry(Point, 4326)</text>
  <rect x="60" y="96" width="360" height="42" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <text x="76" y="122" font-size="10.5" fill="currentColor">sheriff GPS · SRID 4326</text>
  <rect x="60" y="146" width="360" height="42" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <text x="76" y="172" font-size="10.5" fill="currentColor">parcel layer · SRID 2229</text>
  <rect x="60" y="196" width="360" height="42" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <text x="76" y="222" font-size="10.5" fill="currentColor">tactical overlay · SRID 32611</text>
  <rect x="60" y="246" width="360" height="42" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <text x="76" y="272" font-size="10.5" fill="currentColor">shelter points · SRID 4326</text>
  <rect x="470" y="96" width="360" height="42" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <text x="486" y="122" font-size="10.5" fill="currentColor">sheriff GPS · SRID 4326</text>
  <rect x="470" y="146" width="360" height="42" rx="7" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.6" stroke-dasharray="6 4"/>
  <text x="486" y="172" font-size="10.5" fill="var(--ember-text)" font-weight="700">parcel layer · refused at INSERT</text>
  <rect x="470" y="196" width="360" height="42" rx="7" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.6" stroke-dasharray="6 4"/>
  <text x="486" y="222" font-size="10.5" fill="var(--ember-text)" font-weight="700">tactical overlay · refused at INSERT</text>
  <rect x="470" y="246" width="360" height="42" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <text x="486" y="272" font-size="10.5" fill="currentColor">shelter points · SRID 4326</text>
  <rect x="60" y="306" width="360" height="46" rx="7" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="76" y="326" font-size="10.5" font-weight="700" fill="var(--ember-text)">ST_DWithin → mixed-SRID error</text>
  <text x="76" y="343" font-size="10" fill="currentColor">at query time, during the incident</text>
  <rect x="470" y="306" width="360" height="46" rx="7" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="486" y="326" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">ST_DWithin → one frame, always</text>
  <text x="486" y="343" font-size="10" fill="currentColor">the bad rows never entered</text>
</svg>

The important word is *deferred*. An unconstrained column does not misbehave at load time — the insert succeeds, the row count is right, and a smoke test that checks "did the data land" passes. The system is now carrying a defect whose trigger is a spatial predicate across two rows that happen to disagree, which is to say: whose trigger is the first genuinely useful query somebody runs. Declaring `geometry(Point, 4326)` does not make the incompatible data compatible; it makes the load job fail while the person who produced it is still at their desk.

The index has the same shape of problem in a different register. A missing GIST index is invisible in development, because development has one client.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="pga-t pga-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="pga-t">Bounding-box query latency against concurrent map clients, with and without a GIST index</title>
  <desc id="pga-d">Ninety-fifth-percentile query latency on a logarithmic scale against the number of agency clients panning the map and re-querying at once. With a GIST index the latency starts near 4 milliseconds at one client and rises gently to about 34 milliseconds at twenty-four, staying two orders of magnitude inside the 250 millisecond refresh budget throughout. Without an index every bounding-box filter degrades to a sequential scan, so latency starts at 180 milliseconds at a single client, crosses the refresh budget at about two clients, and reaches several seconds by twelve. The deferred index is therefore not a slow-down that scales — it is a system that works in testing with one analyst and stops refreshing the common operating picture the moment a second agency joins.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="56" font-size="10.5" fill="var(--muted)">p95 latency</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 240 H820"/><path d="M180 180 H820"/><path d="M180 120 H820"/><path d="M180 60 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="120" y="304">1 ms</text><text x="128" y="244">10</text><text x="122" y="184">100</text>
    <text x="128" y="124">1 s</text><text x="120" y="64">10 s</text>
  </g>
  <path d="M180 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 156 H820" fill="none" stroke="var(--crimson-deep)" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="560" y="150" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">250 ms COP refresh budget</text>
  <path d="M180 164.7 L263.5 128.6 L374.8 107.8 L486 92.3 L597.3 79.1 L708.6 67.2 L820 60" fill="none" stroke="var(--ember)" stroke-width="2.8"/>
  <path d="M180 263.9 L263.5 253.3 L374.8 242.7 L486 231.2 L597.3 223.3 L708.6 215.1 L820 208.1" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <circle cx="196" cy="156" r="6" fill="var(--ember)"/>
  <text x="206" y="182" font-size="10.5" font-weight="700" fill="var(--ember-text)">over budget at two clients</text>
  <text x="200" y="80" font-size="11" font-weight="700" fill="var(--ember-text)">no index — sequential scan</text>
  <text x="600" y="252" font-size="11" font-weight="700" fill="var(--crimson)">GIST index</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="320">1</text><text x="263.5" y="320">4</text><text x="374.8" y="320">8</text><text x="486" y="320">12</text>
    <text x="597.3" y="320">16</text><text x="708.6" y="320">20</text><text x="820" y="320">24</text>
    <text x="500" y="344" font-size="11">agency clients panning and re-querying at once</text>
  </g>
  <text x="440" y="368" font-size="11" text-anchor="middle" fill="var(--muted)">It works with one analyst and stops refreshing the moment a second agency joins.</text>
</svg>

At a single analyst the unindexed database answers in 180 milliseconds, which is slow but works, and is exactly the condition under which the index gets deferred to "after the migration". The curve is not a gentle degradation — the whole point of a sequential scan is that its cost is a function of the table, so every additional client multiplies the same full scan. Two agencies put it past the refresh budget; by the time six are panning during a surge, the common operating picture has stopped updating and the symptom presented to the operations chief is "the map is frozen", which is not a phrase that leads anyone to a missing index.

Create the index in the same migration as the table, not in a follow-up. On an empty table it costs milliseconds; on a live one during an incident it takes a lock you cannot afford.

## Tiered Resolution Strategy

Work the build from the definitive fix down to a safe default that never ships a silently broken table:

1. **Definitive fix — constrain the SRID at the DDL level and index immediately.** Declare every geometry column with an explicit type and SRID (`geometry(Point, 4326)`), add `CHECK (ST_IsValid(geom))`, and attach the `GIST` index in the same migration. A row in the wrong projection cannot be inserted at all; a query cannot fall back to a sequential scan.
2. **Normalize at the boundary with a staging schema and trigger.** Land raw feeds in a `staging` schema that preserves native SRIDs, then promote to `operational` through a `BEFORE INSERT OR UPDATE` trigger that runs `ST_MakeValid` and `ST_Transform` into the single operational CRS. This isolates dirty input from the authoritative table.
3. **Ingest inside explicit transactions with conflict handling.** Wrap every load in `BEGIN`/`COMMIT`, use `ON CONFLICT` for idempotent re-sends, and roll back partial batches so a dropped WAN link leaves the table consistent.
4. **Safe default with an audit flag.** When a row's SRID cannot be confirmed or its geometry cannot be repaired, do not guess and do not drop it. Route it to a `staging.rejects` audit table with the raw payload and a loud reason code, and quarantine it from the operational picture. A flagged row is recoverable in the next operational period; a silently mis-projected one that reaches a responder's tablet is not.

## Production Python Implementation

The implementation below provisions the operational schema with an SRID-constrained, indexed geometry column, then ingests a feed transactionally. Geometry is repaired with `ST_MakeValid` and reprojected with `ST_Transform` inside a single statement; `always_xy`-style axis safety is handled server-side because the SRID is explicit on both sides of the transform. Unconfirmable rows are written to an audit table rather than dropped. It uses connection pooling, structured logging, and explicit exception boundaries throughout — no `print` statements, no silent fallbacks. This same transactional discipline is what every downstream [geospatial data ingestion pipeline](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) on the platform depends on.

```python
import json
import logging
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2 import sql
from psycopg2.extras import execute_batch
from psycopg2.pool import ThreadedConnectionPool

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("postgis_incident_setup")

OPERATIONAL_SRID = 4326  # single converged CRS for the common operating picture


class IncidentDBError(Exception):
    """Raised when the operational PostGIS table cannot be provisioned or loaded safely."""


def provision_operational_schema(pool: ThreadedConnectionPool, srid: int = OPERATIONAL_SRID) -> None:
    """
    Create the staging/operational schemas, an SRID-constrained geometry column, the
    validity CHECK, and the GIST index in one transaction. The SRID modifier on the
    column is what makes a wrong-projection insert impossible rather than deferred.
    """
    ddl = sql.SQL(
        """
        CREATE SCHEMA IF NOT EXISTS staging;
        CREATE SCHEMA IF NOT EXISTS operational;

        CREATE TABLE IF NOT EXISTS operational.incidents (
            id          TEXT PRIMARY KEY,
            agency_id   TEXT NOT NULL,
            reported_at TIMESTAMPTZ NOT NULL,
            accuracy_m  DOUBLE PRECISION,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            geom        geometry(Point, {srid}) NOT NULL
                        CONSTRAINT incidents_geom_valid CHECK (ST_IsValid(geom))
        );

        CREATE INDEX IF NOT EXISTS idx_incidents_geom
            ON operational.incidents USING GIST (geom);

        CREATE TABLE IF NOT EXISTS staging.rejects (
            received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reason      TEXT NOT NULL,
            raw_payload JSONB NOT NULL
        );
        """
    ).format(srid=sql.Literal(srid))

    conn = pool.getconn()
    try:
        with conn:  # commits on success, rolls back on any exception
            with conn.cursor() as cur:
                cur.execute(ddl)
        logger.info("Operational schema provisioned with SRID %d, validity CHECK, GIST index.", srid)
    except psycopg2.Error as exc:
        raise IncidentDBError(f"Schema provisioning failed: {exc.pgerror or exc}") from exc
    finally:
        pool.putconn(conn)


def _quarantine(cur: psycopg2.extensions.cursor, reason: str, record: dict[str, Any]) -> None:
    """Write an unconfirmable row to the audit table instead of dropping it."""
    cur.execute(
        "INSERT INTO staging.rejects (reason, raw_payload) VALUES (%s, %s)",
        (reason, json.dumps(record)),
    )
    logger.warning("Quarantined record %s: %s", record.get("id", "<no-id>"), reason)


def ingest_feed(pool: ThreadedConnectionPool, feed: list[dict[str, Any]],
                target_srid: int = OPERATIONAL_SRID) -> tuple[int, int]:
    """
    Transactionally ingest a feed. Each row is repaired (ST_MakeValid) and reprojected
    (ST_Transform) into the operational SRID in one statement; rows whose source SRID is
    unknown or whose geometry is unrepairable are quarantined with an audit reason rather
    than silently dropped. Returns (loaded, quarantined).
    """
    upsert = sql.SQL(
        """
        INSERT INTO operational.incidents (id, agency_id, reported_at, accuracy_m, geom)
        VALUES (
            %(id)s, %(agency)s, %(ts)s, %(acc)s,
            ST_Transform(ST_MakeValid(ST_GeomFromText(%(wkt)s, %(src_srid)s)), %(target)s)
        )
        ON CONFLICT (id) DO UPDATE
            SET geom = EXCLUDED.geom,
                accuracy_m = EXCLUDED.accuracy_m,
                updated_at = NOW()
        """
    )

    loaded = 0
    quarantined = 0
    conn = pool.getconn()
    try:
        with conn:
            with conn.cursor() as cur:
                for record in feed:
                    src_srid = record.get("srid")
                    wkt = record.get("geometry")
                    if not src_srid or not wkt:
                        _quarantine(cur, "missing source SRID or geometry", record)
                        quarantined += 1
                        continue
                    try:
                        # Savepoint isolates a bad row so one failure cannot abort the batch.
                        cur.execute("SAVEPOINT row_sp")
                        cur.execute(upsert, {
                            "id": record["id"],
                            "agency": record["agency"],
                            "ts": record["timestamp"],
                            "acc": record.get("accuracy"),
                            "wkt": wkt,
                            "src_srid": int(src_srid),
                            "target": target_srid,
                        })
                        cur.execute("RELEASE SAVEPOINT row_sp")
                        loaded += 1
                    except psycopg2.Error as exc:
                        cur.execute("ROLLBACK TO SAVEPOINT row_sp")
                        _quarantine(cur, f"geometry rejected: {exc.pgcode}", record)
                        quarantined += 1
        logger.info("Ingest complete: %d loaded, %d quarantined.", loaded, quarantined)
        return loaded, quarantined
    except psycopg2.Error as exc:
        raise IncidentDBError(f"Transactional ingest aborted: {exc.pgerror or exc}") from exc
    finally:
        pool.putconn(conn)


if __name__ == "__main__":
    dsn = "dbname=incident user=eoc_writer host=db.eoc.local sslmode=require"
    db_pool = ThreadedConnectionPool(minconn=2, maxconn=16, dsn=dsn)
    try:
        provision_operational_schema(db_pool)
        sample = [
            {"id": "INC-001", "agency": "sheriff", "timestamp": datetime.now(timezone.utc).isoformat(),
             "geometry": "POINT(-118.2437 34.0522)", "srid": 4326, "accuracy": 5.0},
            {"id": "INC-002", "agency": "public_works", "timestamp": datetime.now(timezone.utc).isoformat(),
             "geometry": "POINT(6485000 1840000)", "srid": 2229, "accuracy": 1.0},  # NAD83 State Plane CA V
        ]
        ingest_feed(db_pool, sample)
    finally:
        db_pool.closeall()
```

## Validation Checklist

Verify each item before the database backs a live common operating picture:

- [ ] `SELECT type, srid FROM geometry_columns WHERE f_table_name = 'incidents';` reports the single operational SRID — not `0` and not a mix.
- [ ] The geometry column was declared with an explicit type and SRID (`geometry(Point, 4326)`), so a wrong-projection insert is rejected by the column, not just by application code.
- [ ] `CHECK (ST_IsValid(geom))` is present and enforced; an invalid ring cannot reach the operational table.
- [ ] `\d operational.incidents` shows the `GIST` index, and `EXPLAIN (ANALYZE, BUFFERS)` on a bounding-box query uses an Index Scan, not a Seq Scan.
- [ ] Ingestion runs inside an explicit transaction; killing the loader mid-batch leaves zero partial rows in `operational.incidents`.
- [ ] A deliberately bad row (unknown SRID, self-intersecting polygon) lands in `staging.rejects` with a reason code rather than being dropped or aborting the batch.
- [ ] Re-sending the same feed is idempotent — `ON CONFLICT` updates rather than duplicating, and no row collapses toward null-island (0, 0).

## Edge Cases and Gotchas

**Axis-order inversion on import.** `ST_GeomFromText(..., src_srid)` trusts the WKT coordinate order you give it. Feeds delivered as GML or from authorities that publish lat/lon order can arrive swapped; PostGIS will faithfully store the swap. Spot-check one known point after import — a swapped Southern California incident lands in the Indian Ocean.

**Null-island drift.** A row with `srid` set but coordinates of `(0, 0)`, or a `ST_Transform` from an unset/zero SRID, parks geometry at the equator/prime-meridian intersection. Treat any feature within a degree of (0, 0) as a failed ingest until proven otherwise, and add a `CHECK` excluding the origin if your operating area is far from it.

**Agency-specific datum anomalies.** Legacy parcel layers often carry NAD27 or an older local datum while live GPS feeds use NAD83(2011) or ITRF2014. `ST_Transform` between them needs the correct datum shift grids installed in `spatial_ref_sys` / PROJ; a missing grid silently falls back to a lower-accuracy transform and offsets the layer by metres. This is the same discipline applied when [handling missing CRS in field-collected GPS logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/) before they reach the database.

**Offline device quirks and degraded-mode reads.** When WAN latency spikes or replication lags, point field clients at a read replica and serve the last-good picture from a local cache rather than blocking on the primary. Exporting the operational table to a local store ties this setup into broader [offline GIS data caching strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) so responders keep spatial visibility through a backhaul outage.

**Index bloat under surge.** High-churn upsert traffic bloats the `GIST` index over a long activation. `REINDEX INDEX CONCURRENTLY idx_incidents_geom;` rebuilds it without locking the table; watch `pg_stat_activity` for the blocking analytical query before you reindex, not after.

## Related

- [Converting CADRG Maps to GeoJSON with Python](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/converting-cadrg-maps-to-geojson-with-python/)
- [Handling Missing CRS in Field-Collected GPS Logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/)
- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/)

Up: [Coordinate Reference Systems for Disaster Zones overview](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/)
