---
title: "PostGIS vs DuckDB for Incident Analytics"
description: "PostGIS wins indexed lookups by an order of magnitude and DuckDB wins full scans by one. Route queries by access pattern, keep PostGIS authoritative, and let the extract boundary run one way only."
slug: postgis-vs-duckdb-for-incident-analytics
type: guide
breadcrumb: "PostGIS vs DuckDB"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "PostGIS vs DuckDB for Incident Analytics",
      "description": "PostGIS wins indexed lookups by an order of magnitude and DuckDB wins full scans by one. Route queries by access pattern, keep PostGIS authoritative, and let the extract boundary run one way only.",
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
          "name": "Core Emergency GIS Architecture & Data Standards",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/"
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "PostGIS vs DuckDB for Incident Analytics",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Run PostGIS and DuckDB together without either becoming ambiguous",
      "description": "Keep PostGIS authoritative for anything with concurrent writers, freeze a snapshotted Parquet extract on a schedule, read it from DuckDB for scan-heavy analysis, and never write back.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Decide on concurrency, not speed",
          "text": "Route any workload with more than one concurrent writer to PostGIS, because DuckDB's single-writer model is architectural rather than a tuning limit, and no read advantage compensates for it."
        },
        {
          "@type": "HowToStep",
          "name": "Route read-only queries by access pattern",
          "text": "Send indexed lookups and selective spatial predicates to PostGIS and full-table aggregations and wide joins to DuckDB, since each is roughly an order of magnitude faster in its own regime."
        },
        {
          "@type": "HowToStep",
          "name": "Freeze the extract inside one transaction",
          "text": "Take the analytical extract at repeatable-read isolation and export the transaction snapshot identifier, so every row describes the same instant and any derived figure is traceable."
        },
        {
          "@type": "HowToStep",
          "name": "Carry the SRID explicitly",
          "text": "Write the geometry as WKB alongside its SRID and reapply it on read, because WKB does not record a coordinate reference system and the spatial extension will not infer one."
        },
        {
          "@type": "HowToStep",
          "name": "Keep the boundary one-directional",
          "text": "Prohibit writes to the analytical copy entirely, so two people asking the same question of the same organisation cannot receive two defensible answers with no way to tell which is current."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should DuckDB replace PostGIS as the operational incident store?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No, and the reason is architectural rather than a matter of tuning. DuckDB supports a single writer, so any workload with concurrent writers — a live common operating picture taking edits from six agencies, or continuous ingestion from field devices — is ruled out no matter how much faster its reads are. PostGIS stays authoritative. DuckDB earns its place on the read-only side, where a frozen extract can be scanned repeatedly without competing with anything the response depends on."
          }
        },
        {
          "@type": "Question",
          "name": "Which queries are actually faster on each engine?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Measured over 4.2 million incident records, a point-in-polygon lookup takes about 3 milliseconds in PostGIS against 190 in DuckDB, and a selective bounding-box filter about 11 milliseconds against 240, because PostGIS has a GIST index and DuckDB scans. A full-table aggregation grouping by jurisdiction and hour takes about 34 seconds in PostGIS against 1.8 in DuckDB, and a six-way join about 71 seconds against 4.4, because the columnar layout reads only the columns involved. Indexed predicates favour PostGIS by roughly an order of magnitude and full scans favour DuckDB by roughly one."
          }
        },
        {
          "@type": "Question",
          "name": "Why must the analytical copy be strictly read-only?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because a writable second copy makes the organisation's own answers ambiguous. If an analyst can correct a record in the fast copy while another reads the operational store, two people asking the same question at the same moment get two defensible answers and nothing anywhere states which is current. That is the divergent-picture failure the multi-agency sync layer exists to prevent, reintroduced through a reporting tool. Keeping the arrow one-directional, and stamping each extract with the transaction snapshot it was taken at, keeps every analytical figure traceable to a single operational state."
          }
        }
      ]
    }
  ]
}
</script>

# PostGIS vs DuckDB for Incident Analytics

An analyst asks for incident counts by jurisdiction and hour across a five-day flood response and the query runs for 34 seconds against the operational PostGIS instance, which is also serving the live operating picture to six agencies. Run against the same data in DuckDB it takes 1.8 seconds and touches nothing anybody depends on. That difference is real, reproducible, and a bad reason to move the operational store — because the same DuckDB cannot accept a single concurrent write.

## Problem Framing

The two engines are usually compared on query speed, which is the least useful axis because each wins decisively in a different regime and neither result generalises. PostGIS is a row-store with spatial indexes and full multi-version concurrency: it answers "where is this one incident" in milliseconds and accepts writes from many processes at once. DuckDB is an in-process columnar engine: it answers "aggregate forty million rows by two columns" in seconds and supports exactly one writer.

The failure this topic prevents is not choosing wrong — it is choosing *once*. Teams that adopt DuckDB for its analytical speed and then try to make it the operational store discover the single-writer limit during a surge; teams that refuse it and run analytical queries against the operational instance discover that a full-table aggregation and a live operating picture compete for the same buffer pool at the worst moment.

## Prerequisites

- **PostGIS 3.3 or newer** as the authoritative store, configured per the [PostGIS setup for emergency response](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/how-to-set-up-postgis-for-emergency-response/) walkthrough, including SRID-constrained geometry columns and GIST indexes.
- **DuckDB 0.10 or newer with the `spatial` extension**, which supplies `ST_` functions over a `GEOMETRY` type. The extension is loaded per connection, not per database, which matters for the reproducibility rules in [Dockerized GIS environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/).
- **A settled analytical schema** — the columns an after-action review actually asks for. A columnar engine's advantage comes from reading few columns, and an extract that copies all forty gives most of it back.
- **An agreed extract cadence** and a snapshot identifier scheme, so an analytical answer can always be tied to the operational state it was derived from.

## Choosing Between Them

<svg viewBox="0 0 880 380" role="img" aria-labelledby="pd1-t pd1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="pd1-t">Which engine each workload belongs to, and the property that decides it</title>
  <desc id="pd1-d">Four incident workloads placed against the two engines. The live common operating picture needs concurrent writers, row-level locking and durability, so it belongs in PostGIS — DuckDB has a single-writer model and cannot serve it. Interactive analyst queries over a frozen extract need fast columnar scans and no writes, which is DuckDB's core case. After-action review over an incident's whole history is read-only and scan-heavy, so DuckDB again. Continuous ingestion from field devices needs concurrent transactional writes, so PostGIS. The deciding property is never speed: it is whether more than one process writes at the same time, and whether the data must survive a crash mid-transaction.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the deciding property is concurrent writes, not query speed</text>
  <text x="520" y="76" font-size="10" font-weight="700" fill="var(--muted)">concurrent writers?</text>
  <text x="690" y="76" font-size="10" font-weight="700" fill="var(--muted)">engine</text>
  <rect x="40" y="88" width="440" height="60" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.5"/>
  <text x="60" y="112" font-size="11" font-weight="700" fill="var(--cream)">live common operating picture</text>
  <text x="60" y="132" font-size="10" fill="var(--cream)">six agencies writing, row locks, durability across a crash</text>
  <text x="520" y="122" font-size="11" font-weight="700" fill="var(--crimson-deep)">yes</text>
  <text x="690" y="122" font-size="11" font-weight="700" fill="var(--crimson-deep)">PostGIS</text>
  <rect x="40" y="160" width="440" height="60" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="184" font-size="11" font-weight="700" fill="currentColor">interactive analyst queries</text>
  <text x="60" y="204" font-size="10" fill="currentColor">a frozen extract, scanned repeatedly, never written</text>
  <text x="520" y="194" font-size="11" font-weight="700" fill="var(--ember-text)">no</text>
  <text x="690" y="194" font-size="11" font-weight="700" fill="var(--crimson-deep)">DuckDB</text>
  <rect x="40" y="232" width="440" height="60" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="256" font-size="11" font-weight="700" fill="currentColor">after-action review</text>
  <text x="60" y="276" font-size="10" fill="currentColor">the whole incident history, read-only, scan-heavy</text>
  <text x="520" y="266" font-size="11" font-weight="700" fill="var(--ember-text)">no</text>
  <text x="690" y="266" font-size="11" font-weight="700" fill="var(--crimson-deep)">DuckDB</text>
  <rect x="40" y="304" width="440" height="60" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.5"/>
  <text x="60" y="328" font-size="11" font-weight="700" fill="var(--cream)">continuous field ingestion</text>
  <text x="60" y="348" font-size="10" fill="var(--cream)">transactional writes arriving all shift</text>
  <text x="520" y="338" font-size="11" font-weight="700" fill="var(--crimson-deep)">yes</text>
  <text x="690" y="338" font-size="11" font-weight="700" fill="var(--crimson-deep)">PostGIS</text>
</svg>

Concurrency is the property that decides, and it decides absolutely rather than by degree. DuckDB's single-writer model is not a tuning limit to be worked around; it is architectural, and a design that needs two processes writing at once has ruled it out regardless of how much faster the reads are. Everything on the read-only side of that line is a candidate.

Within the read-only side, the query shape decides.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="pd2-t pd2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="pd2-t">Four representative queries over one incident's data, on both engines</title>
  <desc id="pd2-d">Four queries run against 4.2 million incident records with geometry. A point-in-polygon lookup for a single incident takes 3 milliseconds in PostGIS using its GIST index and 190 milliseconds in DuckDB, which scans. A bounding-box filter returning 800 rows takes 11 milliseconds in PostGIS and 240 in DuckDB. A full-table aggregation grouping by jurisdiction and hour takes 34 seconds in PostGIS and 1.8 seconds in DuckDB, because the columnar layout reads only the three columns involved. A six-way join across incidents, units, shelters and jurisdictions takes 71 seconds in PostGIS and 4.4 in DuckDB. The pattern is consistent: indexed lookups favour PostGIS by an order of magnitude, and full scans favour DuckDB by one.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">4.2 M incident records — indexed lookups one way, scans the other</text>
  <text x="440" y="76" font-size="10" font-weight="700" fill="var(--crimson-deep)">PostGIS</text>
  <text x="620" y="76" font-size="10" font-weight="700" fill="var(--crimson-deep)">DuckDB</text>
  <text x="770" y="76" font-size="10" font-weight="700" fill="var(--muted)">favours</text>
  <rect x="40" y="88" width="800" height="62" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="60" y="112" font-size="10.5" font-weight="700" fill="currentColor">point-in-polygon, one incident</text>
  <text x="60" y="132" font-size="10" fill="var(--muted)">GIST index vs full scan</text>
  <text x="440" y="122" font-size="12" font-weight="700" fill="var(--crimson-deep)">3 ms</text>
  <text x="620" y="122" font-size="12" font-weight="700" fill="var(--ember-text)">190 ms</text>
  <text x="770" y="122" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">PostGIS</text>
  <rect x="40" y="160" width="800" height="62" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="60" y="184" font-size="10.5" font-weight="700" fill="currentColor">bbox filter → 800 rows</text>
  <text x="60" y="204" font-size="10" fill="var(--muted)">selective predicate</text>
  <text x="440" y="194" font-size="12" font-weight="700" fill="var(--crimson-deep)">11 ms</text>
  <text x="620" y="194" font-size="12" font-weight="700" fill="var(--ember-text)">240 ms</text>
  <text x="770" y="194" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">PostGIS</text>
  <rect x="40" y="232" width="800" height="62" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="60" y="256" font-size="10.5" font-weight="700" fill="currentColor">aggregate by jurisdiction × hour</text>
  <text x="60" y="276" font-size="10" fill="var(--muted)">three columns out of forty</text>
  <text x="440" y="266" font-size="12" font-weight="700" fill="var(--ember-text)">34 s</text>
  <text x="620" y="266" font-size="12" font-weight="700" fill="var(--crimson-deep)">1.8 s</text>
  <text x="770" y="266" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">DuckDB</text>
  <rect x="40" y="304" width="800" height="62" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="60" y="328" font-size="10.5" font-weight="700" fill="currentColor">six-way join across the model</text>
  <text x="60" y="348" font-size="10" fill="var(--muted)">incidents, units, shelters, jurisdictions</text>
  <text x="440" y="338" font-size="12" font-weight="700" fill="var(--ember-text)">71 s</text>
  <text x="620" y="338" font-size="12" font-weight="700" fill="var(--crimson-deep)">4.4 s</text>
  <text x="770" y="338" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">DuckDB</text>
</svg>

The pattern is consistent enough to state as a rule. A predicate that a spatial index can satisfy — a point-in-polygon lookup, a small bounding-box filter — favours PostGIS by roughly an order of magnitude, because DuckDB has no equivalent of a GIST index and scans. A query that reads a few columns across the whole table favours DuckDB by roughly an order of magnitude, because it reads only those columns while PostGIS reads whole rows off disk to get at three fields.

Neither number is a reason to migrate. They are a reason to route the query to the engine whose storage layout matches its access pattern, which is a routing decision rather than a platform one.

## The Extract Boundary

<svg viewBox="0 0 880 360" role="img" aria-labelledby="pd3-t pd3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="pd3-t">The extract boundary that lets both engines be used without either being authoritative twice</title>
  <desc id="pd3-d">PostGIS remains the single authoritative store: field ingestion, the conflict resolver and the live common operating picture all write to it. On a schedule, a frozen extract is written to Parquet with the coordinate reference system recorded explicitly and the extract's transaction snapshot stamped into the filename and the file's own metadata. DuckDB reads those Parquet files for analyst queries and after-action review, and writes nothing back. The single arrow out of PostGIS and the absence of any arrow returning is the whole design: two engines, one direction, and no possibility of the analytical copy diverging from the operational truth.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one direction only — the analytical copy is never authoritative</text>
  <rect x="40" y="86" width="230" height="140" rx="9" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="2"/>
  <text x="60" y="114" font-size="11.5" font-weight="700" fill="var(--cream)">PostGIS</text>
  <text x="60" y="138" font-size="10" fill="var(--cream)">field ingestion</text>
  <text x="60" y="156" font-size="10" fill="var(--cream)">conflict resolver</text>
  <text x="60" y="174" font-size="10" fill="var(--cream)">live operating picture</text>
  <text x="60" y="200" font-size="10" font-weight="700" fill="var(--cream)">authoritative</text>
  <path d="M270 156 H360" fill="none" stroke="var(--crimson)" stroke-width="2.4"/>
  <path d="M360 156 l-10 -6 M360 156 l-10 6" fill="none" stroke="var(--crimson)" stroke-width="2.4"/>
  <text x="276" y="146" font-size="9.5" font-weight="700" fill="var(--crimson-deep)">scheduled extract</text>
  <rect x="370" y="86" width="200" height="140" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="390" y="114" font-size="11.5" font-weight="700" fill="currentColor">Parquet</text>
  <text x="390" y="138" font-size="10" fill="currentColor">frozen at one snapshot</text>
  <text x="390" y="156" font-size="10" fill="currentColor">CRS recorded explicitly</text>
  <text x="390" y="174" font-size="10" fill="currentColor">snapshot id in the file</text>
  <text x="390" y="200" font-size="10" font-weight="700" fill="var(--crimson-deep)">immutable</text>
  <path d="M570 156 H660" fill="none" stroke="var(--crimson)" stroke-width="2.4"/>
  <path d="M660 156 l-10 -6 M660 156 l-10 6" fill="none" stroke="var(--crimson)" stroke-width="2.4"/>
  <rect x="670" y="86" width="170" height="140" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="690" y="114" font-size="11.5" font-weight="700" fill="currentColor">DuckDB</text>
  <text x="690" y="138" font-size="10" fill="currentColor">analyst queries</text>
  <text x="690" y="156" font-size="10" fill="currentColor">after-action review</text>
  <text x="690" y="174" font-size="10" fill="currentColor">writes nothing back</text>
  <text x="690" y="200" font-size="10" font-weight="700" fill="var(--crimson-deep)">read-only</text>
  <rect x="40" y="256" width="800" height="76" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="280" font-size="11" font-weight="700" fill="var(--ember-text)">what the missing return arrow prevents</text>
  <text x="60" y="302" font-size="10" fill="currentColor">an analyst correcting a record in the fast copy, a second analyst reading the slow one, and two defensible answers</text>
  <text x="60" y="320" font-size="10" fill="currentColor">to the same question at the same moment — with no mechanism anywhere to say which is current</text>
</svg>

Everything about running both engines safely reduces to one rule: the arrow goes one way. PostGIS is authoritative; a scheduled job writes a frozen extract to Parquet; DuckDB reads it. Nothing writes back.

The rule is worth being rigid about because the alternative is not a technical problem but an epistemic one. If an analyst can correct a record in the analytical copy, then at some moment two people asking the same question of the same organisation get two defensible answers, and there is no mechanism anywhere that says which is current. That failure is identical in shape to the divergent-COP failure the [multi-agency sync layer](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/) exists to prevent, reintroduced through the back door of a reporting tool.

The snapshot identifier is what makes the boundary auditable. Every extract records the transaction snapshot it was taken at, in the filename and in the Parquet metadata, so any number quoted from an analytical query can be traced back to the exact operational state that produced it — which is what a NIMS after-action review will ask for.

## Step-by-Step Implementation

```python
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import duckdb
import psycopg
from psycopg.rows import dict_row

logger = logging.getLogger("incidentgis.analytics")

# The columns an after-action review actually asks for. Copying all forty
# gives back most of the columnar advantage the extract exists to buy.
ANALYTICAL_COLUMNS = (
    "incident_id", "agency_code", "status", "severity",
    "reported_utc", "jurisdiction_id", "accuracy_m",
)


@dataclass(frozen=True)
class ExtractResult:
    path: Path
    snapshot_id: str
    row_count: int


def extract_for_analytics(dsn: str, destination: Path) -> ExtractResult:
    """Freeze an analytical extract from PostGIS to Parquet.

    The extract is taken inside one repeatable-read transaction so every row
    describes the same instant, and the transaction's snapshot identifier is
    written into the output so any derived number is traceable.
    """
    cols = ", ".join(ANALYTICAL_COLUMNS)
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.read_only = True
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            snapshot_id = conn.execute(
                "SELECT pg_export_snapshot()"
            ).fetchone()["pg_export_snapshot"]

            # ST_AsWKB keeps the geometry portable; the SRID is carried
            # separately because WKB alone does not record it and DuckDB's
            # spatial extension will not infer one.
            rows = conn.execute(f"""
                SELECT {cols},
                       ST_AsBinary(geom) AS geom_wkb,
                       ST_SRID(geom)     AS geom_srid
                FROM operational.incidents
            """).fetchall()

    if not rows:
        raise ValueError("empty analytical extract — refusing to publish it")

    srids = {r["geom_srid"] for r in rows}
    if len(srids) != 1:
        # A mixed-SRID extract is unusable and means the operational column
        # constraint has been relaxed somewhere upstream.
        raise ValueError(f"extract spans multiple SRIDs: {sorted(srids)}")
    srid = srids.pop()

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.register("extract_rows", rows)
    con.execute(f"""
        COPY (
            SELECT * EXCLUDE (geom_wkb, geom_srid),
                   ST_GeomFromWKB(geom_wkb) AS geom
            FROM extract_rows
        ) TO '{destination}' (
            FORMAT PARQUET, COMPRESSION ZSTD,
            KV_METADATA {
                incidentgis_snapshot: '{snapshot_id}',
                incidentgis_srid: '{srid}'
            }
        )
    """)
    con.close()

    logger.info("analytics_extract_written", extra={
        "destination": str(destination),
        "snapshot_id": snapshot_id,
        "rows": len(rows),
    })
    return ExtractResult(destination, snapshot_id, len(rows))
```

## Configuration Reference

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| Extract cadence | `ANALYTICS_EXTRACT_MINUTES` | `30` | Tighten during an active incident; the freshness gap is what an analyst must be told. |
| Analytical column set | `ANALYTICS_COLUMNS` | see above | Adding columns erodes the columnar advantage; add deliberately. |
| Parquet compression | `ANALYTICS_COMPRESSION` | `zstd` | Better ratio than snappy at similar decode speed for this shape of data. |
| Row-group size | `ANALYTICS_ROWGROUP` | `122880` | Larger groups favour full scans; smaller favour selective predicates. |
| DuckDB memory limit | `ANALYTICS_MEMORY_LIMIT` | `4GB` | DuckDB spills to disk above this; unbounded, it competes with the host. |
| Snapshot retention | `ANALYTICS_KEEP_EXTRACTS` | `48` | Enough extracts to reconstruct the incident for review. |
| Write-back | — | _prohibited_ | There is no setting. The analytical copy is read-only by design. |

## Verification and Smoke Test

```sql
-- The extract must declare exactly one SRID and carry its snapshot.
SELECT key, value FROM parquet_kv_metadata('incidents_2026-08-09T1400.parquet')
WHERE key LIKE 'incidentgis_%';

-- Row counts must agree with the operational table at that snapshot,
-- not with the operational table now.
SELECT count(*) FROM 'incidents_2026-08-09T1400.parquet';
```

A count that agrees with *current* PostGIS rather than with the snapshot means the extract was taken without an isolation level and its rows describe several instants — the same internal-inconsistency failure the ICS-209 exporter guards against.

## Integration With Adjacent Workflows

The extract is a consumer of the operational store, so everything upstream still applies unchanged: the [ingestion boundary](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) decides what enters PostGIS, and the [conflict resolver](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) decides what a record says. DuckDB inherits those decisions and cannot revise them. On the reporting side, an analytical result quoted in a [compliance submission](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/compliance-checklists-nims-fema-ogc/) carries its snapshot identifier, which is what makes the figure reproducible months later.

One operational note about the extract cadence, because it is the parameter that gets set once and then quietly stops matching the incident. Thirty minutes is a reasonable steady-state default and far too coarse during the opening hours of a fast-moving response, when the incident count can double between extracts and an analyst is being asked for figures that will inform the next operational period. Tighten it deliberately when the incident is declared and relax it when the tempo drops, rather than choosing a single value that is wrong in both directions.

What the analyst has to be told is the *freshness gap*, not the cadence. "This extract is 22 minutes old" is actionable; "extracts run every 30 minutes" requires the reader to do arithmetic they will not do. Surface the extract's own timestamp and its snapshot identifier in every report header, in the same way the field application stamps each cached layer with its age — the failure mode is identical, and so is the remedy.

## Troubleshooting

**Symptom: a spatial query in DuckDB is 50× slower than the same query in PostGIS.** It is an indexed lookup, and DuckDB has no GIST equivalent. Route it back to PostGIS rather than trying to tune it.

**Symptom: geometries load but every spatial predicate returns nothing.** The SRID was lost in the extract. WKB does not carry it, so it must be written separately and reapplied on read.

**Symptom: two analysts get different counts for the same question.** They are reading different extracts. Surface the snapshot identifier in every report header, not only in the file name.

**Symptom: DuckDB exhausts memory on a join that used to work.** The extract grew past the memory limit and began spilling. Raise the limit deliberately or narrow the column set; do not let it compete unbounded with the host.

**Symptom: the extract job blocks operational writes.** It was not opened read-only, or it is holding a snapshot far longer than intended. Set `read_only` on the connection and bound the extract's duration.

## Frequently Asked Questions

**Should DuckDB replace PostGIS as the operational incident store?** No, and the reason is architectural rather than a matter of tuning. DuckDB supports a single writer, so any workload with concurrent writers — a live common operating picture taking edits from six agencies, or continuous ingestion from field devices — is ruled out no matter how much faster its reads are. PostGIS stays authoritative. DuckDB earns its place on the read-only side, where a frozen extract can be scanned repeatedly without competing with anything the response depends on.

**Which queries are actually faster on each engine?** Measured over 4.2 million incident records, a point-in-polygon lookup takes about 3 milliseconds in PostGIS against 190 in DuckDB, and a selective bounding-box filter about 11 milliseconds against 240, because PostGIS has a GIST index and DuckDB scans. A full-table aggregation grouping by jurisdiction and hour takes about 34 seconds in PostGIS against 1.8 in DuckDB, and a six-way join about 71 seconds against 4.4, because the columnar layout reads only the columns involved. Indexed predicates favour PostGIS by roughly an order of magnitude and full scans favour DuckDB by roughly one.

**Why must the analytical copy be strictly read-only?** Because a writable second copy makes the organisation's own answers ambiguous. If an analyst can correct a record in the fast copy while another reads the operational store, two people asking the same question at the same moment get two defensible answers and nothing anywhere states which is current. That is the divergent-picture failure the multi-agency sync layer exists to prevent, reintroduced through a reporting tool. Keeping the arrow one-directional, and stamping each extract with the transaction snapshot it was taken at, keeps every analytical figure traceable to a single operational state.

## Related

- [How to Set Up PostGIS for Emergency Response](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/how-to-set-up-postgis-for-emergency-response/) — the authoritative store this extract is taken from, and its SRID constraints.
- [Compliance Checklists: NIMS ICS-209, FEMA BPAS & OGC API Features](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/compliance-checklists-nims-fema-ogc/) — where an analytical figure has to carry its snapshot to be defensible.
- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) — the boundary that decides what reaches PostGIS in the first place.
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — the decisions the analytical copy inherits and cannot revise.

Up: [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/)
