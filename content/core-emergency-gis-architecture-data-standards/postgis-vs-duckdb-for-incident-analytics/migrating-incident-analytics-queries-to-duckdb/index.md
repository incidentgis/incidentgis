---
title: "Migrating Incident Analytics Queries to DuckDB"
description: "Most PostGIS analytical SQL ports by substitution, which is what makes the exceptions dangerous. Classify geography and transform queries first, shadow on answers rather than timings, and leave indexed lookups behind."
slug: migrating-incident-analytics-queries-to-duckdb
type: article
breadcrumb: "Migrating Analytics Queries"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Migrating Incident Analytics Queries to DuckDB",
      "description": "Most PostGIS analytical SQL ports by substitution, which is what makes the exceptions dangerous. Classify geography and transform queries first, shadow on answers rather than timings, and leave indexed lookups behind.",
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
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Migrating Incident Analytics Queries to DuckDB",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/migrating-incident-analytics-queries-to-duckdb/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Move analytical SQL from PostGIS to DuckDB without changing what it means",
      "description": "Classify queries that use geography or transforms before translating, rewrite ellipsoidal measurements into the incident's projected system, shadow every query on answers rather than timings, and leave indexed lookups in PostGIS.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Classify before translating",
          "text": "Search every query for the geography type, casts to it, and ST_Transform, because those are the constructs whose meaning changes under translation while the rest port by substitution."
        },
        {
          "@type": "HowToStep",
          "name": "Rewrite geography into a projected system",
          "text": "Replace ellipsoidal measurements with measurements in the incident's own UTM zone rather than Web Mercator, since the projection chosen becomes part of the answer."
        },
        {
          "@type": "HowToStep",
          "name": "Shadow on answers",
          "text": "Run each migrated query against both engines over the same snapshot and compare result sets, because a translation that changed the query's meaning is fast and wrong and no timing comparison reveals it."
        },
        {
          "@type": "HowToStep",
          "name": "State a numeric tolerance",
          "text": "Accept differences below an explicit threshold as floating-point aggregate ordering, and treat anything above it as divergence needing human judgement."
        },
        {
          "@type": "HowToStep",
          "name": "Leave what cannot port",
          "text": "Record queries DuckDB cannot answer as remaining in PostGIS and express the split as configuration, so routing is a named decision rather than something an analyst remembers."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How much PostGIS analytical SQL actually ports to DuckDB unchanged?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Most of it, which is precisely the risk. The core spatial predicates — ST_Intersects, ST_Area, ST_Buffer and similar — exist under the same names with the same semantics, and window functions and common table expressions are fully supported and often faster. When nineteen queries in twenty port by substitution, the twentieth tends to get the same treatment. The exceptions are the geography type, which does not exist at all, and ST_Transform, which resolves against whatever PROJ data the extension build carries and may select a different pipeline."
          }
        },
        {
          "@type": "Question",
          "name": "What happens to a query that used the geography type?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "It has to be rewritten to project first, and the projection chosen becomes part of the answer. A geography ST_DWithin measuring 500 metres along the ellipsoid stays within about half a metre of that when projected into the incident's own UTM zone, so the result is operationally identical. Projected into Web Mercator at temperate latitudes the same 500-metre radius covers roughly 707 metres of ground, so every proximity count grows — plausibly enough that the change can go unnoticed for weeks. The rewrite is mechanical in form and a decision in substance."
          }
        },
        {
          "@type": "Question",
          "name": "Why shadow on answers rather than on query times?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because the failure mode of a migration is a query that is fast and wrong. Comparing result sets over the same snapshot sorts every migrated query into four outcomes: identical, meaning it ported; differing within a stated tolerance, which is usually floating-point ordering inside an aggregate; differing materially, meaning the translation changed what the query asked; and unable to run at all, which identifies queries that belong in PostGIS. Only the third needs human judgement, and it is exactly the category a timing comparison cannot see."
          }
        }
      ]
    }
  ]
}
</script>

# Migrating Incident Analytics Queries to DuckDB

A reporting notebook that took four minutes against PostGIS runs in nine seconds against the extract, and the team moves the rest of the analytical queries across in an afternoon. Three weeks later somebody notices that shelter proximity counts have grown by roughly forty per cent since the migration. The queries were translated correctly; one of them used `geography`, and its replacement measures in Web Mercator.

## Root Cause and Operational Impact

Most of a PostGIS analytical query ports to DuckDB by substitution. `ST_Intersects`, `ST_Area`, `ST_Buffer` and the rest of the core predicates exist under the same names with the same semantics, and window functions and CTEs are fully supported and frequently faster. That high hit rate is exactly what makes the migration risky: when nineteen queries out of twenty port cleanly, the twentieth gets the same treatment.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="mg1-t mg1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="mg1-t">Four PostGIS constructs and what they become in DuckDB spatial</title>
  <desc id="mg1-d">Four things a PostGIS analytical query commonly uses, and their status in DuckDB's spatial extension. ST_Intersects, ST_Area and the other core predicates exist with the same names and semantics, so they port unchanged. The geography type does not exist at all, so any query relying on it for metres-on-a-sphere must be rewritten to project first and measure in a projected system. ST_Transform exists but depends on the PROJ data available to the extension build, so a transform that works in PostGIS may fail or select a different pipeline. Window functions and common table expressions are fully supported and often faster. The migration is therefore not a translation exercise: two of the four require a decision about what the query meant, not a substitution.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">two of these port; two require deciding what the query meant</text>
  <rect x="40" y="72" width="800" height="66" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="96" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">ST_Intersects · ST_Area · ST_Buffer</text>
  <text x="60" y="116" font-size="10" fill="currentColor">same names, same semantics — port unchanged</text>
  <text x="700" y="108" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">substitute</text>
  <rect x="40" y="150" width="800" height="66" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="174" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">geography type</text>
  <text x="60" y="194" font-size="10" fill="currentColor">does not exist — any metres-on-a-sphere query must project first and measure projected</text>
  <text x="700" y="186" font-size="10.5" font-weight="700" fill="var(--ember-text)">decide</text>
  <rect x="40" y="228" width="800" height="66" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="252" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">ST_Transform</text>
  <text x="60" y="272" font-size="10" fill="currentColor">exists, but depends on the PROJ data in the extension build — may pick a different pipeline</text>
  <text x="700" y="264" font-size="10.5" font-weight="700" fill="var(--ember-text)">decide</text>
  <rect x="40" y="306" width="800" height="60" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="330" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">window functions · CTEs</text>
  <text x="60" y="350" font-size="10" fill="currentColor">fully supported and frequently faster</text>
  <text x="700" y="342" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">substitute</text>
</svg>

Two constructs need a decision rather than a substitution. The `geography` type does not exist in DuckDB's spatial extension at all, so any query that relied on it for metres-on-the-ellipsoid must be rewritten to project first — and the projection chosen becomes part of the answer. `ST_Transform` exists but resolves against whatever PROJ data the extension build carries, so a transform that worked in PostGIS may select a different pipeline or fail, which is the same [pinned-binary problem](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/pinning-gdal-and-proj-versions-to-avoid-datum-grid-drift/) in a new place.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="mg3-t mg3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="mg3-t">The geography-to-projected rewrite, and where the answer moves</title>
  <desc id="mg3-d">A PostGIS query using ST_DWithin on the geography type measures 500 metres along the ellipsoid and is correct anywhere. The same query rewritten for DuckDB must project into a system first, and the choice of system decides the answer. Projected into the incident's UTM zone the result matches the geography answer to within about 0.4 metres over a 500-metre radius, which is operationally identical. Projected into Web Mercator the 500-metre radius becomes about 707 metres of ground at 45 degrees north, so the query silently returns a larger set. The rewrite is therefore not mechanical: it replaces an ellipsoidal measurement with a projected one, and only one projection choice preserves the meaning.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">ST_DWithin on geography → projected: the projection choice is the answer</text>
  <rect x="40" y="80" width="256" height="150" rx="9" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <rect x="312" y="80" width="256" height="150" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="584" y="80" width="256" height="150" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="108" font-size="11" font-weight="700" fill="var(--cream)">PostGIS geography</text>
  <text x="332" y="108" font-size="11" font-weight="700" fill="var(--crimson-deep)">projected to UTM</text>
  <text x="604" y="108" font-size="11" font-weight="700" fill="var(--ember-text)">projected to 3857</text>
  <text x="60" y="140" font-size="18" font-weight="700" fill="var(--cream)">500 m</text>
  <text x="332" y="140" font-size="18" font-weight="700" fill="var(--crimson-deep)">500.4 m</text>
  <text x="604" y="140" font-size="18" font-weight="700" fill="var(--ember-text)">707 m</text>
  <text x="60" y="170" font-size="10" fill="var(--cream)">along the ellipsoid</text>
  <text x="332" y="170" font-size="10" fill="currentColor">within 0.4 m over the radius</text>
  <text x="604" y="170" font-size="10" fill="currentColor">at 45° N — sec φ larger</text>
  <text x="60" y="200" font-size="10" font-weight="700" fill="var(--cream)">correct anywhere</text>
  <text x="332" y="200" font-size="10" font-weight="700" fill="var(--crimson-deep)">operationally identical</text>
  <text x="604" y="200" font-size="10" font-weight="700" fill="var(--ember-text)">a silently larger set</text>
  <text x="8" y="272" font-size="10.5" fill="currentColor">The rewrite replaces an ellipsoidal measurement with a projected one — mechanical in form, not in meaning.</text>
  <text x="8" y="296" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Only the incident's own UTM zone preserves what the original query was asking.</text>
</svg>

The geography rewrite is where the forty per cent came from. Projected into the incident's own UTM zone, a 500-metre radius stays 500 metres to within half a metre and the answer is operationally identical. Projected into Web Mercator at temperate latitudes it becomes roughly 707 metres of ground, so every proximity count grows — and grows plausibly, which is why nobody questioned it for three weeks.

## Tiered Resolution Strategy

1. **Classify every query before translating any of it (definitive).** Grep for `geography`, `ST_Transform`, `ST_DWithin` and any `::geography` cast. Those are the queries that need a decision; the rest are substitutions.
2. **Rewrite geography measurements into the incident's projected CRS, never Web Mercator.** The projection is the measurement, so it belongs in the extract as the [CRS handling guide](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/handling-crs-loss-in-duckdb-spatial-extracts/) describes, not chosen ad hoc per query.
3. **Shadow on answers, not on timings.** Run every migrated query against both engines over the same snapshot and compare result sets. A timing comparison tells you nothing about whether the query still means the same thing.
4. **Leave queries that cannot port where they are (safe default).** An indexed point-in-polygon lookup belongs in PostGIS. Discovering that during the migration is a result, not a failure, and it is what makes the final split defensible.
5. **Record the split as configuration.** Which engine answers which query should be a named routing decision in the codebase, not something an analyst remembers.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="mg2-t mg2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="mg2-t">Running both engines against the same question during a migration</title>
  <desc id="mg2-d">A shadow period runs each migrated query against both engines and compares the answers rather than the timings. Identical results mean the query has ported and can be cut over. Results differing by a rounding tolerance are usually a floating-point ordering difference in an aggregate and are acceptable once the tolerance is stated. Results differing materially mean the query did not mean what the migration assumed, most often because a geography measurement became a projected one. Results DuckDB cannot produce at all identify queries that must stay in PostGIS. Only the third category needs human judgement, and it is the one a timing-based comparison never surfaces.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">shadow on answers, not on timings</text>
  <rect x="40" y="76" width="800" height="60" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="100" font-size="11" font-weight="700" fill="var(--crimson-deep)">identical</text>
  <text x="220" y="100" font-size="10.5" fill="currentColor">the query ported — cut it over</text>
  <text x="640" y="100" font-size="10" fill="var(--muted)">no judgement needed</text>
  <text x="60" y="122" font-size="10" fill="var(--muted)">most of them</text>
  <rect x="40" y="148" width="800" height="60" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="172" font-size="11" font-weight="700" fill="var(--crimson-deep)">differs by ε</text>
  <text x="220" y="172" font-size="10.5" fill="currentColor">floating-point ordering inside an aggregate</text>
  <text x="640" y="172" font-size="10" fill="var(--muted)">state the tolerance</text>
  <text x="60" y="194" font-size="10" fill="var(--muted)">sums and means</text>
  <rect x="40" y="220" width="800" height="60" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="244" font-size="11" font-weight="700" fill="var(--ember-text)">differs materially</text>
  <text x="220" y="244" font-size="10.5" fill="currentColor">the query did not mean what the migration assumed</text>
  <text x="640" y="244" font-size="10" font-weight="700" fill="var(--ember-text)">human judgement</text>
  <text x="60" y="266" font-size="10" fill="var(--muted)">usually geography</text>
  <rect x="40" y="292" width="800" height="52" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="316" font-size="11" font-weight="700" fill="var(--crimson-deep)">cannot run</text>
  <text x="220" y="316" font-size="10.5" fill="currentColor">this query stays in PostGIS — that is a result, not a failure</text>
  <text x="60" y="336" font-size="10" fill="var(--muted)">indexed lookups</text>
</svg>

The shadow period is the whole safety mechanism, and it has to compare *answers*. Identical results mean the query ported. Results differing within a stated tolerance are usually floating-point ordering inside an aggregate, which is acceptable once the tolerance is written down. Results that differ materially mean the query did not mean what the migration assumed — that is the geography case, and it is invisible to any comparison of run times.

## Production Python Implementation

```python
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from decimal import Decimal

import duckdb
import psycopg

logger = logging.getLogger("incidentgis.migration")

# Constructs that need a decision rather than a substitution.
NEEDS_DECISION = (
    re.compile(r"::\s*geography", re.I),
    re.compile(r"\bgeography\s*\(", re.I),
    re.compile(r"\bST_Transform\s*\(", re.I),
)

TOLERANCE = Decimal("0.001")


@dataclass
class ShadowResult:
    label: str
    verdict: str            # ported | within_tolerance | diverged | postgis_only
    detail: str


def classify(sql: str) -> str:
    """Flag queries whose meaning changes under translation."""
    for pattern in NEEDS_DECISION:
        if pattern.search(sql):
            return "needs_decision"
    return "substitutable"


def shadow_compare(pg_dsn: str, parquet_path: str, *, label: str,
                   sql_pg: str, sql_duck: str) -> ShadowResult:
    """Run one query on both engines over the same snapshot, compare answers.

    Compares result sets rather than run times: a translation that changed the
    meaning of the query is fast and wrong, and timing cannot see it.
    """
    with psycopg.connect(pg_dsn) as conn:
        conn.read_only = True
        pg_rows = conn.execute(sql_pg).fetchall()

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute(
        "CREATE VIEW incidents AS SELECT * FROM read_parquet(?)", [parquet_path]
    )
    try:
        duck_rows = con.execute(sql_duck).fetchall()
    except duckdb.Error as exc:
        # Not a failure of the migration — a finding about where this query lives.
        logger.info("query_stays_in_postgis", extra={"label": label,
                                                     "reason": str(exc)[:200]})
        return ShadowResult(label, "postgis_only", str(exc)[:200])
    finally:
        con.close()

    if len(pg_rows) != len(duck_rows):
        return ShadowResult(
            label, "diverged",
            f"row counts differ: postgis {len(pg_rows)}, duckdb {len(duck_rows)}",
        )

    worst = Decimal(0)
    for a, b in zip(sorted(pg_rows), sorted(duck_rows)):
        for x, y in zip(a, b):
            if isinstance(x, (int, float, Decimal)) and isinstance(y, (int, float, Decimal)):
                delta = abs(Decimal(str(x)) - Decimal(str(y)))
                worst = max(worst, delta)
            elif x != y:
                return ShadowResult(label, "diverged", f"value differs: {x!r} vs {y!r}")

    if worst == 0:
        verdict, detail = "ported", "identical"
    elif worst <= TOLERANCE:
        verdict, detail = "within_tolerance", f"max delta {worst}"
    else:
        verdict, detail = "diverged", f"max delta {worst} exceeds {TOLERANCE}"

    logger.info("shadow_compare", extra={"label": label, "verdict": verdict,
                                         "detail": detail})
    return ShadowResult(label, verdict, detail)
```

## Validation Checklist

- [ ] Every query is classified for `geography`, `ST_Transform` and casts before any translation is written.
- [ ] Geography measurements are rewritten into the incident's projected CRS, never into Web Mercator.
- [ ] The shadow period compares result sets, not run times.
- [ ] A numeric tolerance is stated explicitly, and anything above it is treated as divergence.
- [ ] Queries DuckDB cannot answer are recorded as staying in PostGIS rather than being forced.
- [ ] The engine routing for each named query lives in configuration, not in an analyst's memory.
- [ ] The extension's PROJ build is pinned alongside the rest of the toolchain.
- [ ] A regression test runs the shadow comparison on every query after any extract schema change.

## Edge Cases and Gotchas

- **`ST_DWithin` without a geography cast.** In PostGIS on a geometry column it already measures in the column's units, so it ports cleanly — the danger is only the geography form. Grep for the cast, not the function.
- **Aggregate ordering changing sums.** Floating-point addition is not associative, so a parallel aggregation can differ from a serial one in the last few digits. That is the tolerance band and not a defect; without a stated tolerance it produces alarming diffs on every run.
- **A query that ports and is slower.** Indexed lookups run in DuckDB will produce identical answers and take fifty times longer. A shadow comparing only answers will pass them, so the routing decision needs the timing data too — just not as the correctness signal.
- **Extract schema drift.** A migrated query is validated against one extract schema. Adding or renaming a column later silently changes what the query sees, so re-run the shadow after any schema change rather than treating migration as one-off.
- **`geography` used for correctness across a wide area.** A query genuinely spanning several UTM zones cannot be rewritten into one projected system without error, and that is a legitimate reason for it to stay in PostGIS permanently.

## Frequently Asked Questions

**How much PostGIS analytical SQL actually ports to DuckDB unchanged?** Most of it, which is precisely the risk. The core spatial predicates — ST_Intersects, ST_Area, ST_Buffer and similar — exist under the same names with the same semantics, and window functions and common table expressions are fully supported and often faster. When nineteen queries in twenty port by substitution, the twentieth tends to get the same treatment. The exceptions are the geography type, which does not exist at all, and ST_Transform, which resolves against whatever PROJ data the extension build carries and may select a different pipeline.

**What happens to a query that used the geography type?** It has to be rewritten to project first, and the projection chosen becomes part of the answer. A geography ST_DWithin measuring 500 metres along the ellipsoid stays within about half a metre of that when projected into the incident's own UTM zone, so the result is operationally identical. Projected into Web Mercator at temperate latitudes the same 500-metre radius covers roughly 707 metres of ground, so every proximity count grows — plausibly enough that the change can go unnoticed for weeks. The rewrite is mechanical in form and a decision in substance.

**Why shadow on answers rather than on query times?** Because the failure mode of a migration is a query that is fast and wrong. Comparing result sets over the same snapshot sorts every migrated query into four outcomes: identical, meaning it ported; differing within a stated tolerance, which is usually floating-point ordering inside an aggregate; differing materially, meaning the translation changed what the query asked; and unable to run at all, which identifies queries that belong in PostGIS. Only the third needs human judgement, and it is exactly the category a timing comparison cannot see.

## Related

- [PostGIS vs DuckDB for Incident Analytics](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/) — the routing split this migration is trying to arrive at.
- [Handling CRS Loss in DuckDB Spatial Extracts](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/handling-crs-loss-in-duckdb-spatial-extracts/) — where the projected extract that a geography rewrite depends on comes from.
- [Pinning GDAL and PROJ Versions to Avoid Datum Grid Drift](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/pinning-gdal-and-proj-versions-to-avoid-datum-grid-drift/) — the same transformation-pipeline problem, in the extension's build.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — why Web Mercator is the wrong destination for any measurement.

Up: [PostGIS vs DuckDB for Incident Analytics](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/)
