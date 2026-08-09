---
title: "Handling CRS Loss in DuckDB Spatial Extracts"
description: "Plain WKB has no field for a coordinate reference system, so a PostGIS extract reaches DuckDB unframed and every spatial predicate answers confidently in the wrong units. Carry the SRID as data, not metadata alone."
slug: handling-crs-loss-in-duckdb-spatial-extracts
type: article
breadcrumb: "CRS Loss in DuckDB Extracts"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Handling CRS Loss in DuckDB Spatial Extracts",
      "description": "Plain WKB has no field for a coordinate reference system, so a PostGIS extract reaches DuckDB unframed and every spatial predicate answers confidently in the wrong units. Carry the SRID as data, not metadata alone.",
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
          "name": "Handling CRS Loss in DuckDB Spatial Extracts",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/handling-crs-loss-in-duckdb-spatial-extracts/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Keep the coordinate reference system attached across a PostGIS to DuckDB extract",
      "description": "Write the SRID as both a column and Parquet metadata, verify both carriers at load time, refuse an unframed extract outright, and write distance-bearing extracts in a projected system so a forgotten reprojection still measures metres.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Write the SRID as a column",
          "text": "Include a dedicated srid column so the coordinate reference system is data rather than metadata, since no rewrite, repartition or column selection can silently drop it."
        },
        {
          "@type": "HowToStep",
          "name": "Write it as file metadata too",
          "text": "Also record the SRID as Parquet key-value metadata, which is readable before scanning any row and lets a loader reject an extract without reading it."
        },
        {
          "@type": "HowToStep",
          "name": "Verify both carriers at load",
          "text": "Raise when neither carrier is present and when the two disagree, rather than proceeding with an unframed geometry that will produce confident answers in the wrong units."
        },
        {
          "@type": "HowToStep",
          "name": "Assert a single SRID per extract",
          "text": "Fail on more than one distinct SRID, because a mixed-SRID extract means the operational column constraint has been relaxed upstream and should be fixed there."
        },
        {
          "@type": "HowToStep",
          "name": "Project extracts used for distance work",
          "text": "Write extracts feeding distance or area queries in the incident's projected system rather than in EPSG:4326, so a query that forgets to reproject still measures metres."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does a PostGIS geometry lose its SRID on the way to DuckDB?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because plain well-known binary has no field for a coordinate reference system. A PostGIS column enforces its SRID as part of the column type, but ST_AsBinary produces WKB, which carries only the shape. Extended WKB does include an SRID, yet it is not what ST_AsBinary emits, not every reader honours it, and it rarely survives a round trip through a columnar writer. The geometry that arrives in DuckDB is well-formed and unframed, and every spatial function then operates on raw coordinate numbers without any way to know what they mean."
          }
        },
        {
          "@type": "Question",
          "name": "What actually goes wrong when the SRID is missing?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Nothing errors, which is the problem. The same pair of coordinates 1,200 units apart is about 133 kilometres if the numbers are degrees, 1.2 kilometres if they are UTM metres, and about 366 metres if they are survey feet. All three are arithmetically correct answers to ST_Distance and only one describes the ground. Without a declared frame the engine silently adopts whichever interpretation the query author assumed and reports it with full confidence, so a proximity count in an after-action briefing can be wrong by orders of magnitude while looking entirely reasonable."
          }
        },
        {
          "@type": "Question",
          "name": "Is Parquet key-value metadata enough to carry the CRS?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "It is necessary and not sufficient, so carry the SRID in a column as well. Metadata is free per row and readable before any scan, which lets a loader reject a bad extract cheaply, but it is easy to omit at write time and several tools drop unknown keys when rewriting or repartitioning a file. A column cannot be dropped by a rewrite and makes a mixed-SRID extract detectable with a single query, but it is invisible until rows are read. The two carriers fail in different ways, so each catches the other's failure."
          }
        }
      ]
    }
  ]
}
</script>

# Handling CRS Loss in DuckDB Spatial Extracts

An analyst runs a proximity query against last week's extract to count incidents within 500 metres of each shelter, gets a plausible-looking table, and puts it in the after-action briefing. The extract's geometries are in EPSG:4326, the query assumed metres, and every "within 500 metres" is really within 500 degrees. The numbers are wrong by a factor no reviewer will spot, because the output is a count and counts always look reasonable.

## Root Cause and Operational Impact

A PostGIS geometry column carries its SRID as part of the column type, which is why the [operational store](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/how-to-set-up-postgis-for-emergency-response/) can refuse a mismatched insert. Nothing downstream of that column has the same guarantee, and the standard export path drops it at the first step.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="cl1-t cl1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cl1-t">Where the SRID is lost between PostGIS and a Parquet extract</title>
  <desc id="cl1-d">A geometry travelling from PostGIS to a Parquet file read by DuckDB passes through four representations. In the PostGIS column the SRID is enforced by the column type itself. Converting to well-known binary drops it, because plain WKB has no field for a coordinate reference system. Extended WKB does carry an SRID, but not every writer emits it and not every reader honours it. In Parquet the SRID exists only if something wrote it as key-value metadata or as a separate column. In DuckDB the geometry arrives with no CRS at all, and every spatial predicate then operates on raw numbers. The loss is silent at each step: the geometry is well-formed throughout and no operation fails.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the geometry stays well-formed the whole way — only its frame disappears</text>
  <rect x="30" y="86" width="185" height="94" rx="9" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <rect x="245" y="86" width="185" height="94" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <rect x="460" y="86" width="185" height="94" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="675" y="86" width="175" height="94" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="48" y="112" font-size="10.5" font-weight="700" fill="var(--cream)">PostGIS column</text>
  <text x="263" y="112" font-size="10.5" font-weight="700" fill="var(--ember-text)">ST_AsBinary → WKB</text>
  <text x="478" y="112" font-size="10.5" font-weight="700" fill="currentColor">Parquet</text>
  <text x="693" y="112" font-size="10.5" font-weight="700" fill="var(--ember-text)">DuckDB GEOMETRY</text>
  <text x="48" y="138" font-size="10" fill="var(--cream)">SRID enforced by</text>
  <text x="48" y="154" font-size="10" fill="var(--cream)">the column type</text>
  <text x="263" y="138" font-size="10" fill="currentColor">no SRID field exists</text>
  <text x="263" y="154" font-size="10" fill="currentColor">in plain WKB at all</text>
  <text x="478" y="138" font-size="10" fill="currentColor">SRID present only if</text>
  <text x="478" y="154" font-size="10" fill="currentColor">written as metadata</text>
  <text x="693" y="138" font-size="10" fill="currentColor">no CRS attached —</text>
  <text x="693" y="154" font-size="10" fill="currentColor">predicates use raw numbers</text>
  <g fill="none" stroke="var(--crimson)" stroke-width="2">
    <path d="M215 133 H239"/><path d="M430 133 H454"/><path d="M645 133 H669"/>
  </g>
  <text x="48" y="200" font-size="10" font-weight="700" fill="var(--crimson-deep)">safe</text>
  <text x="263" y="200" font-size="10" font-weight="700" fill="var(--ember-text)">lost here</text>
  <text x="478" y="200" font-size="10" font-weight="700" fill="var(--crimson-deep)">recoverable if written</text>
  <text x="693" y="200" font-size="10" font-weight="700" fill="var(--ember-text)">too late</text>
  <rect x="30" y="240" width="820" height="90" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="50" y="266" font-size="11" font-weight="700" fill="var(--crimson-deep)">why nothing errors</text>
  <text x="50" y="288" font-size="10.5" fill="currentColor">A geometry with no CRS is still a valid geometry. ST_Intersects compares coordinate numbers, and two layers in</text>
  <text x="50" y="306" font-size="10.5" fill="currentColor">different systems produce a confident answer about points that are nowhere near each other — the same failure the</text>
  <text x="50" y="324" font-size="10.5" fill="currentColor">unconstrained PostGIS column produces, minus the mixed-SRID error that would at least have raised.</text>
</svg>

Plain well-known binary has no field for a coordinate reference system. Extended WKB does, but it is not what `ST_AsBinary` produces, not every reader honours it, and it does not survive a round trip through most columnar writers. By the time the geometry reaches DuckDB it is a well-formed shape with no frame, and every spatial function operates on the raw numbers.

That is the whole danger: nothing errors. A geometry without a CRS is still a valid geometry, `ST_Intersects` still returns booleans, and `ST_Distance` still returns floats. The engine cannot tell that it is comparing degrees with metres, so it produces confident answers to questions nobody asked.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="cl3-t cl3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cl3-t">A distance query answered in three coordinate systems from the same numbers</title>
  <desc id="cl3-d">The same pair of coordinates, 1,200 units apart, interpreted under three assumptions. Read as EPSG 4326 degrees the separation is about 133 kilometres. Read as UTM metres it is 1.2 kilometres. Read as State Plane survey feet it is about 366 metres. All three are arithmetically correct answers to ST_Distance and only one corresponds to the ground. Because no engine can choose between them without a declared coordinate reference system, an extract that lost its SRID does not fail — it silently selects whichever interpretation the query author happened to assume, and reports it with full confidence.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the same 1 200 units, three defensible answers</text>
  <rect x="40" y="80" width="256" height="140" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <rect x="312" y="80" width="256" height="140" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="584" y="80" width="256" height="140" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="108" font-size="11" font-weight="700" fill="currentColor">read as EPSG:4326</text>
  <text x="332" y="108" font-size="11" font-weight="700" fill="currentColor">read as UTM metres</text>
  <text x="604" y="108" font-size="11" font-weight="700" fill="currentColor">read as survey feet</text>
  <text x="60" y="152" font-size="20" font-weight="700" fill="var(--ember-text)">133 km</text>
  <text x="332" y="152" font-size="20" font-weight="700" fill="var(--crimson-deep)">1.2 km</text>
  <text x="604" y="152" font-size="20" font-weight="700" fill="var(--ember-text)">366 m</text>
  <text x="60" y="184" font-size="10" fill="currentColor">degrees of separation</text>
  <text x="332" y="184" font-size="10" fill="currentColor">the correct answer here</text>
  <text x="604" y="184" font-size="10" fill="currentColor">State Plane units</text>
  <text x="60" y="206" font-size="10" font-weight="700" fill="var(--ember-text)">a county away</text>
  <text x="332" y="206" font-size="10" font-weight="700" fill="var(--crimson-deep)">on the same street</text>
  <text x="604" y="206" font-size="10" font-weight="700" fill="var(--ember-text)">the next building</text>
  <text x="8" y="266" font-size="10.5" fill="currentColor">No engine can choose between these without a declared CRS, so an extract that lost its SRID does not fail —</text>
  <text x="8" y="286" font-size="10.5" fill="currentColor">it silently adopts whichever interpretation the query author assumed, and reports it with full confidence.</text>
  <text x="8" y="320" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Which is why the SRID must be data in the extract, not knowledge in someone's head.</text>
</svg>

## Tiered Resolution Strategy

1. **Carry the SRID as a column, not only as metadata (definitive).** A dedicated `srid` column is data: no rewrite, repartition or copy can silently drop it, and a mixed-SRID extract becomes detectable with a single `SELECT DISTINCT`.
2. **Write it as Parquet key-value metadata as well.** Redundant on purpose. Metadata is readable before scanning a row, which lets a loader reject an extract without reading it, and it survives the case where a consumer selects a subset of columns.
3. **Reapply the CRS at load time and refuse without it.** The loader should attach the SRID explicitly and raise when neither carrier is present, rather than proceeding with an unframed geometry.
4. **Reproject at extract time for distance work (safe default).** If the analytical workload measures distances or areas, write the extract in the incident's projected CRS rather than in EPSG:4326, so a query that forgets to reproject is still measuring metres. This does not remove the need for the declaration; it removes the most common consequence of ignoring it.
5. **Assert single-SRID on every extract.** A mixed-SRID extract means the operational column constraint has been relaxed upstream, which is a defect worth surfacing at the extract rather than at the query.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="cl2-t cl2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="cl2-t">Three places to carry the SRID through an extract, and what each survives</title>
  <desc id="cl2-d">Three ways to keep a coordinate reference system attached to an extract. A Parquet key-value metadata entry travels with the file, survives copying and is readable before any row is scanned, but it is easy to omit and some tools drop unknown keys when rewriting. A dedicated SRID column is impossible to lose because it is data rather than metadata, costs a few bytes per row after compression, and makes a mixed-SRID extract detectable with a single query. Encoding the CRS in the filename survives nothing: a rename, a copy into a data lake, or an automated partitioning step all discard it. The recommendation is both of the first two, because they fail in different ways.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">carry it in two places, because they fail differently</text>
  <rect x="40" y="76" width="800" height="80" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="102" font-size="11" font-weight="700" fill="currentColor">Parquet key-value metadata</text>
  <text x="60" y="124" font-size="10" fill="currentColor">+ travels with the file · readable before scanning a single row · costs nothing per row</text>
  <text x="60" y="144" font-size="10" fill="currentColor">− easy to omit at write time · some rewriting tools drop unknown keys</text>
  <rect x="40" y="168" width="800" height="80" rx="9" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <text x="60" y="194" font-size="11" font-weight="700" fill="var(--cream)">a dedicated srid column</text>
  <text x="60" y="216" font-size="10" fill="var(--cream)">+ it is data, not metadata — no rewrite can silently drop it · a mixed-SRID extract is one query away</text>
  <text x="60" y="236" font-size="10" fill="var(--cream)">− a few bytes per row before compression, and effectively nothing after it</text>
  <rect x="40" y="260" width="800" height="80" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="286" font-size="11" font-weight="700" fill="var(--ember-text)">the filename</text>
  <text x="60" y="308" font-size="10" fill="currentColor">− survives nothing: a rename, a copy into a lake, or an automated partitioning step all discard it</text>
  <text x="60" y="328" font-size="10" fill="currentColor">and the file remains perfectly readable afterwards, which is what makes it a trap rather than a limitation</text>
</svg>

The recommendation to use both carriers is not belt-and-braces for its own sake — they fail in genuinely different ways. Key-value metadata is easy to omit at write time and is dropped by some tools that rewrite Parquet files, but it is free per row and readable without a scan. A column cannot be dropped by a rewrite, but it is invisible to a loader that has not read any rows yet. Carrying both means a defect in either path is caught by the other.

## Production Python Implementation

```python
from __future__ import annotations

import logging
from pathlib import Path

import duckdb

logger = logging.getLogger("incidentgis.duckdb_crs")

METADATA_KEY = "incidentgis_srid"


class MissingCRSError(RuntimeError):
    """Raised when an extract cannot state its coordinate reference system."""


def load_extract(path: Path, *, expected_srid: int) -> duckdb.DuckDBPyConnection:
    """Open a Parquet extract with its CRS verified from both carriers.

    Refuses to return a usable connection unless the extract states its SRID
    and that SRID is the one the caller expected. An unframed geometry is not
    a degraded input — it is an input that produces confident wrong answers.
    """
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")

    # Carrier one: file metadata, readable without scanning any rows.
    meta = con.execute(
        "SELECT value FROM parquet_kv_metadata(?) WHERE key = ?",
        [str(path), METADATA_KEY],
    ).fetchall()
    meta_srid = int(meta[0][0]) if meta else None

    # Carrier two: the srid column, which no rewrite can silently drop.
    column_srids = [
        row[0] for row in con.execute(
            "SELECT DISTINCT srid FROM read_parquet(?)", [str(path)]
        ).fetchall()
    ]

    if meta_srid is None and not column_srids:
        raise MissingCRSError(
            f"{path} states no SRID in metadata or column — refusing to guess"
        )
    if len(column_srids) > 1:
        raise MissingCRSError(
            f"{path} spans multiple SRIDs {sorted(column_srids)}; the "
            "operational column constraint has been relaxed upstream"
        )

    found = column_srids[0] if column_srids else meta_srid
    if meta_srid is not None and column_srids and meta_srid != found:
        raise MissingCRSError(
            f"{path} disagrees with itself: metadata {meta_srid}, column {found}"
        )
    if found != expected_srid:
        raise MissingCRSError(
            f"{path} is EPSG:{found}, caller expected EPSG:{expected_srid}"
        )

    # Attach the frame explicitly so every downstream predicate is measured
    # in the units the caller believes it is using.
    con.execute(
        "CREATE VIEW incidents AS "
        "SELECT * EXCLUDE (srid), ST_GeomFromWKB(geom_wkb) AS geom "
        "FROM read_parquet(?)",
        [str(path)],
    )
    logger.info("extract_loaded", extra={
        "path": str(path), "srid": found, "rows_scanned_for_srid": len(column_srids),
    })
    return con
```

## Validation Checklist

- [ ] Every extract writes the SRID both as a column and as Parquet key-value metadata.
- [ ] The loader raises when neither carrier is present, rather than proceeding unframed.
- [ ] The loader raises when the two carriers disagree.
- [ ] A `SELECT DISTINCT srid` assertion runs on every extract and fails on more than one value.
- [ ] Extracts feeding distance or area work are written in a projected CRS, not in EPSG:4326.
- [ ] Any query returning a distance states its units in the column name, so `distance_m` cannot be read as degrees.
- [ ] A smoke test loads an extract with the SRID deliberately stripped and asserts the loader refuses it.

## Edge Cases and Gotchas

- **Extended WKB that looks like it worked.** Some writers emit EWKB carrying an SRID, and some readers ignore the SRID while parsing the geometry successfully. The result passes a visual check and still arrives unframed. Do not rely on the geometry encoding to carry the frame.
- **A partitioned extract where only one partition has metadata.** Rewriting or repartitioning frequently preserves metadata on the first file and drops it on the rest. The column carrier is what saves this case.
- **Degrees that look like metres.** UTM eastings and State Plane values are large numbers, and a query written against a projected extract will produce absurd results if handed EPSG:4326 — but a query written the other way round produces *small* numbers that look entirely plausible. The dangerous direction is projected-expected, degrees-supplied.
- **`ST_Distance` on geographic coordinates in DuckDB.** It returns degrees, not metres, with no warning. There is no geography type to fall back on, so the projected-extract rule in tier four is doing real work.
- **A CRS that is correct and inappropriate.** An extract in EPSG:3857 carries a valid SRID and will still misreport areas by a factor of two at temperate latitudes, exactly as the [coordinate reference system standard](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) describes. Declaring the frame is necessary and not sufficient.

## Frequently Asked Questions

**Why does a PostGIS geometry lose its SRID on the way to DuckDB?** Because plain well-known binary has no field for a coordinate reference system. A PostGIS column enforces its SRID as part of the column type, but ST_AsBinary produces WKB, which carries only the shape. Extended WKB does include an SRID, yet it is not what ST_AsBinary emits, not every reader honours it, and it rarely survives a round trip through a columnar writer. The geometry that arrives in DuckDB is well-formed and unframed, and every spatial function then operates on raw coordinate numbers without any way to know what they mean.

**What actually goes wrong when the SRID is missing?** Nothing errors, which is the problem. The same pair of coordinates 1,200 units apart is about 133 kilometres if the numbers are degrees, 1.2 kilometres if they are UTM metres, and about 366 metres if they are survey feet. All three are arithmetically correct answers to ST_Distance and only one describes the ground. Without a declared frame the engine silently adopts whichever interpretation the query author assumed and reports it with full confidence, so a proximity count in an after-action briefing can be wrong by orders of magnitude while looking entirely reasonable.

**Is Parquet key-value metadata enough to carry the CRS?** It is necessary and not sufficient, so carry the SRID in a column as well. Metadata is free per row and readable before any scan, which lets a loader reject a bad extract cheaply, but it is easy to omit at write time and several tools drop unknown keys when rewriting or repartitioning a file. A column cannot be dropped by a rewrite and makes a mixed-SRID extract detectable with a single query, but it is invisible until rows are read. The two carriers fail in different ways, so each catches the other's failure.

## Related

- [PostGIS vs DuckDB for Incident Analytics](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/) — the extract boundary this CRS discipline protects.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — why a declared frame is necessary but an inappropriate one still misreports areas.
- [How to Set Up PostGIS for Emergency Response](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/how-to-set-up-postgis-for-emergency-response/) — the column constraint that makes a mixed-SRID extract a detectable upstream defect.
- [Fixing Axis Order Inversion in Cross-Agency GeoJSON](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/fixing-axis-order-inversion-in-cross-agency-geojson/) — the same class of failure — a valid geometry whose frame is ambiguous.

Up: [PostGIS vs DuckDB for Incident Analytics](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/)
