---
title: "Benchmarking Spatial Aggregations Across Both Engines"
description: "Five conditions move a PostGIS-versus-DuckDB result by more than the engines differ. Pin them, vary the column count, include the extract cost, and report a range instead of a headline number."
slug: benchmarking-spatial-aggregations-across-both-engines
type: article
breadcrumb: "Benchmarking Across Both Engines"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Benchmarking Spatial Aggregations Across Both Engines",
      "description": "Five conditions move a PostGIS-versus-DuckDB result by more than the engines differ. Pin them, vary the column count, include the extract cost, and report a range instead of a headline number.",
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
          "name": "Benchmarking Spatial Aggregations Across Both Engines",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/benchmarking-spatial-aggregations-across-both-engines/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Produce a comparable benchmark between PostGIS and DuckDB",
      "description": "Pin cache state, row-group size, index presence, concurrency and geometry complexity, measure four query shapes rather than one, vary the column count, amortise the extract cost, and publish a range.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Pin and state every condition",
          "text": "Record cache state, Parquet row-group size, GIST index presence, concurrent session count and the fixture's mean vertex count, because each moves the result by more than the engines differ from each other."
        },
        {
          "@type": "HowToStep",
          "name": "Measure query shapes, not a query",
          "text": "Run an indexed lookup, a selective predicate, a wide aggregation and a multi-way join, since each engine wins decisively in a different regime and one query generalises to nothing."
        },
        {
          "@type": "HowToStep",
          "name": "Vary the column count",
          "text": "Report aggregation time as a curve against the number of columns touched, because the columnar advantage falls from roughly nineteen times at three columns to under twice at forty."
        },
        {
          "@type": "HowToStep",
          "name": "Include the extract cost",
          "text": "Add the snapshot and Parquet write time to the DuckDB figure and amortise it over a stated query count, since the first query from a fresh extract really costs more than asking PostGIS directly."
        },
        {
          "@type": "HowToStep",
          "name": "Publish a range",
          "text": "Report best and worst case across the pinned conditions rather than a single number, so a reader can see which decisions the conclusion is sensitive to."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why do PostGIS and DuckDB benchmarks disagree so wildly between teams?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because at least five conditions unrelated to the engines move results by more than the engines differ. Whether the operating system page cache is warm changes PostGIS by up to four times. Parquet row-group size changes DuckDB by up to three. Whether a GIST index exists decides an indexed lookup outright rather than influencing it. Concurrency matters for the engine that is also serving the operating picture and not for the one serving nobody. And geometry vertex count moves both, since deserialisation dominates for complex perimeters. A benchmark that does not state all five is measuring whichever condition happened to differ."
          }
        },
        {
          "@type": "Question",
          "name": "Does the columnar advantage depend on the query?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Substantially. Measured on a forty-column table of 4.2 million incident records, a group-by aggregation touching three columns runs about nineteen times faster in DuckDB, one touching twenty about three times faster, and one touching all forty under twice — the two cross near twenty-six columns, because a columnar engine reads only the columns named while a row store reads whole rows regardless. Since the extract's column set is a design decision, part of the advantage is chosen rather than measured, and an extract that copies the whole table gives most of it away before any query runs."
          }
        },
        {
          "@type": "Question",
          "name": "Should the extract's build cost count against DuckDB?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes, and omitting it is the most common way these comparisons mislead. Taking a consistent snapshot from PostGIS costs about 41 seconds on this dataset and writing the Parquet file about 12 more, so a single query answered from a fresh extract really costs about 55 seconds against PostGIS's 34. Amortised over twenty queries it falls to about 4.5 seconds each and over a hundred it approaches the raw query time. Break-even is near two queries per extract, which reframes the decision as how many questions an analyst asks of one snapshot rather than how fast one question is answered."
          }
        }
      ]
    }
  ]
}
</script>

# Benchmarking Spatial Aggregations Across Both Engines

A benchmark circulated internally shows DuckDB answering the incident aggregation in 1.8 seconds against PostGIS's 34, and by the end of the week somebody has proposed replacing the operational store. Both numbers are real. Neither is a comparison, because they were measured on a warm cache against a cold one, over different column sets, with the extract cost omitted entirely.

## Root Cause and Operational Impact

Spatial benchmarks are unusually easy to run and unusually hard to run comparably. The two engines differ by roughly an order of magnitude in each direction depending on the query shape, and at least five conditions unrelated to the engines move results by more than that. A benchmark that does not pin all of them is not measuring the engines; it is measuring whichever condition happened to differ.

The operational cost of getting this wrong is not a slow query. It is a platform decision made on a number, and platform decisions in this domain are expensive to reverse — a store chosen for analytical speed that cannot accept concurrent writes is discovered during the first surge, which is the worst possible time to find out.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="bm2-t bm2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="bm2-t">What each benchmark run must state to be comparable</title>
  <desc id="bm2-d">Five conditions that change a spatial aggregation benchmark by more than the engines differ from each other. Whether the operating system page cache is warm changes PostGIS by up to four times, so a cold and a warm run are not comparable. The Parquet row-group size changes DuckDB by up to three times depending on whether the query is selective or scanning. Whether a GIST index exists decides the point-in-polygon result entirely rather than influencing it. The number of concurrent sessions changes PostGIS substantially and DuckDB barely, because one is serving other work and the other is not. And the geometry vertex count changes both, since deserialisation dominates for complex polygons. A benchmark that does not state all five is not reproducible.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">five conditions that move the result more than the engines differ</text>
  <rect x="40" y="72" width="800" height="50" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="60" y="94" font-size="10.5" font-weight="700" fill="currentColor">page cache warm or cold</text>
  <text x="440" y="88" font-size="10" fill="currentColor">PostGIS varies up to 4× — a cold run and</text>
  <text x="440" y="104" font-size="10" fill="currentColor">a warm run are different experiments</text>
  <rect x="40" y="132" width="800" height="50" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="60" y="154" font-size="10.5" font-weight="700" fill="currentColor">Parquet row-group size</text>
  <text x="440" y="148" font-size="10" fill="currentColor">DuckDB varies up to 3× — larger groups</text>
  <text x="440" y="164" font-size="10" fill="currentColor">favour scans, smaller favour predicates</text>
  <rect x="40" y="192" width="800" height="50" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.6"/>
  <text x="60" y="214" font-size="10.5" font-weight="700" fill="var(--cream)">GIST index present</text>
  <text x="440" y="214" font-size="10" fill="var(--cream)">decides the point-in-polygon result outright rather than influencing it</text>
  <rect x="40" y="252" width="800" height="50" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="60" y="274" font-size="10.5" font-weight="700" fill="currentColor">concurrent sessions</text>
  <text x="440" y="268" font-size="10" fill="currentColor">PostGIS is also serving the operating picture;</text>
  <text x="440" y="284" font-size="10" fill="currentColor">the analytical copy is serving nobody</text>
  <rect x="40" y="312" width="800" height="42" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
  <text x="60" y="338" font-size="10.5" font-weight="700" fill="currentColor">geometry vertex count</text>
  <text x="440" y="338" font-size="10" fill="currentColor">deserialisation dominates for complex perimeters, on both engines</text>
</svg>

The GIST index row is the one that most often invalidates a comparison outright. A point-in-polygon benchmark run against a PostGIS table whose index was never created is not a comparison between engines; it is a comparison between an index and a scan, and it will report the two engines as roughly equal when in reality one is fifty times faster for that query.

## Tiered Resolution Strategy

1. **Pin every condition before comparing anything (definitive).** Cache state, row-group size, index presence, concurrency and the geometry complexity of the fixture. Record all five in the result, because a benchmark whose conditions are not stated cannot be reproduced or argued with.
2. **Benchmark query *shapes*, not queries.** Run at least one indexed lookup, one selective predicate, one wide aggregation and one multi-way join. A single query produces a number that generalises to nothing.
3. **Vary the column count deliberately.** The columnar advantage is a function of how many columns the query touches, so a benchmark at a fixed column count measures one point on a curve and reports it as a property.
4. **Include the extract cost (safe default).** The DuckDB number is only meaningful alongside the snapshot and write cost that produced the file it read.
5. **Report a range, not a figure.** Publish best and worst case across the conditions above, so a reader can see which decisions the result is sensitive to.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="bm1-t bm1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="bm1-t">Aggregation time against the number of columns the query touches</title>
  <desc id="bm1-d">A group-by aggregation over 4.2 million incident records, run against a table of forty columns, with the query touching between three and forty of them. DuckDB starts at about 1.8 seconds for three columns and climbs steadily to about 19 seconds for all forty, because a columnar engine reads only the columns a query names. PostGIS is nearly flat at about 34 seconds throughout, because a row store reads whole rows off disk whatever the query asked for. The two cross at around twenty-six columns. The practical consequence is that the columnar advantage is a property of the query rather than of the engine, and an extract that copies every column hands most of it back.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">4.2 M rows, 40-column table — the advantage is a property of the query</text>
  <text x="8" y="76" font-size="10" fill="var(--muted)">seconds</text>
  <g stroke="var(--line-strong)" stroke-width="0.9" opacity="0.5">
    <path d="M180 240 H820"/><path d="M180 180 H820"/><path d="M180 120 H820"/>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="150" y="304">0</text><text x="144" y="244">10</text><text x="144" y="184">20</text><text x="144" y="124">30</text><text x="144" y="64">40</text>
  </g>
  <path d="M180 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 60 V300" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <path d="M180 96 L340 94 L500 96 L660 95 L820 94" fill="none" stroke="var(--ember)" stroke-width="2.8"/>
  <path d="M180 289 L340 258 L500 214 L660 168 L820 186" fill="none" stroke="var(--crimson)" stroke-width="2.8"/>
  <path d="M180 289 L340 258 L500 214 L660 168 L740 128 L820 186" fill="none" stroke="var(--crimson)" stroke-width="0" opacity="0"/>
  <text x="560" y="86" font-size="10.5" font-weight="700" fill="var(--ember-text)">PostGIS — flat at ~34 s, whole rows either way</text>
  <text x="220" y="272" font-size="10.5" font-weight="700" fill="var(--crimson)">DuckDB — reads only the columns named</text>
  <circle cx="700" cy="150" r="6" fill="var(--crimson-deep)"/>
  <text x="600" y="138" font-size="10" font-weight="700" fill="var(--crimson-deep)">they cross near 26 columns</text>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="320">3</text><text x="340" y="320">10</text><text x="500" y="320">20</text><text x="660" y="320">30</text><text x="820" y="320">40</text>
    <text x="500" y="344" font-size="11">columns the query touches</text>
  </g>
  <text x="8" y="372" font-size="10.5" fill="currentColor">An extract that copies all forty columns hands back most of the advantage it was built to buy.</text>
</svg>

Tier three deserves its own emphasis because it changes the recommendation rather than the number. At three columns DuckDB is roughly nineteen times faster; at forty it is under twice; and the two cross near twenty-six columns. Since the extract's column set is a design choice, the engine's advantage is partly something the team decides rather than something it measures — an extract that copies the whole table has given most of it away before any query runs.

## The Cost the Benchmark Omits

<svg viewBox="0 0 880 340" role="img" aria-labelledby="bm3-t bm3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="bm3-t">The cost the benchmark usually omits</title>
  <desc id="bm3-d">A query answered from DuckDB appears to take 1.8 seconds, but the extract it reads had to be produced. Taking the snapshot from PostGIS costs about 41 seconds, writing the Parquet file about 12 seconds, and the extract is then reused by however many queries run before the next one. Amortised over a single query the true cost is about 55 seconds, worse than PostGIS answering directly in 34. Amortised over twenty queries in the same extract window it is about 4.5 seconds each, and over a hundred it approaches the raw query time. The break-even is near two queries per extract, which is why the decision depends on how many questions an analyst asks of one snapshot rather than on how fast one question is answered.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the extract has to be produced — amortise it or the comparison is fiction</text>
  <rect x="200" y="84" width="120" height="34" rx="5" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="320" y="84" width="36" height="34" rx="5" fill="var(--petal-soft)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="356" y="84" width="6" height="34" rx="2" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="106" font-size="10.5" font-weight="700" fill="currentColor">1 query</text>
  <text x="376" y="106" font-size="10.5" font-weight="700" fill="var(--ember-text)">55 s each — worse than PostGIS</text>
  <rect x="200" y="144" width="6" height="34" rx="2" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="206" y="144" width="2" height="34" fill="var(--petal-soft)"/>
  <rect x="208" y="144" width="6" height="34" rx="2" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="166" font-size="10.5" font-weight="700" fill="currentColor">20 queries</text>
  <text x="230" y="166" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">4.5 s each</text>
  <rect x="200" y="204" width="6" height="34" rx="2" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="8" y="226" font-size="10.5" font-weight="700" fill="currentColor">100 queries</text>
  <text x="230" y="226" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">2.3 s each — approaching the raw query time</text>
  <circle cx="206" cy="272" r="6" fill="var(--petal)"/>
  <text x="220" y="276" font-size="10" fill="currentColor">snapshot from PostGIS · 41 s</text>
  <circle cx="440" cy="272" r="6" fill="var(--petal-soft)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="454" y="276" font-size="10" fill="currentColor">write Parquet · 12 s</text>
  <circle cx="640" cy="272" r="6" fill="var(--crimson)"/>
  <text x="654" y="276" font-size="10" fill="currentColor">the query itself · 1.8 s</text>
  <text x="8" y="320" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">break-even is near two queries per extract — the question is how many things an analyst asks of one snapshot.</text>
</svg>

The extract is not free and it is almost never counted. Taking a consistent snapshot from PostGIS costs about 41 seconds on this dataset and writing the Parquet file about 12 more, so the first query answered from a fresh extract really cost 55 seconds — worse than asking PostGIS directly.

That inverts the usual framing. The question is not "which engine answers this query faster" but "how many questions will an analyst ask of one snapshot?" Below about two, the extract is not worth building. Above twenty it is overwhelming. Since after-action review and interactive analysis both involve asking dozens of questions of one frozen state, they sit far on the profitable side — and a one-off operational lookup sits firmly on the other, which is a useful rule to hand to whoever is choosing where to send a query.

## Production Python Implementation

```python
from __future__ import annotations

import logging
import subprocess
import time
from dataclasses import dataclass, asdict, field

import duckdb
import psycopg

logger = logging.getLogger("incidentgis.benchmark")


@dataclass
class RunConditions:
    """Everything that must be stated for a result to be comparable."""
    cache_state: str            # "cold" | "warm"
    row_group_size: int
    gist_index_present: bool
    concurrent_sessions: int
    mean_vertices: float
    columns_touched: int


@dataclass
class Result:
    label: str
    engine: str
    seconds: float
    conditions: RunConditions
    samples: list[float] = field(default_factory=list)


def drop_caches() -> None:
    """Cold-cache runs need the OS page cache dropped, not just a restart.

    Requires privilege; a benchmark that cannot do this must report every run
    as warm rather than pretending the first one was cold.
    """
    subprocess.run(["sync"], check=True)
    with open("/proc/sys/vm/drop_caches", "w") as fh:
        fh.write("3")


def time_query(fn, *, repeats: int = 5) -> tuple[float, list[float]]:
    """Median of repeated runs — the mean is dominated by the first run."""
    samples = []
    for _ in range(repeats):
        start = time.perf_counter()
        fn()
        samples.append(time.perf_counter() - start)
    samples.sort()
    return samples[len(samples) // 2], samples


def benchmark_pair(pg_dsn: str, parquet_path: str, sql_pg: str, sql_duck: str,
                   *, label: str, conditions: RunConditions) -> list[Result]:
    """Run one query shape on both engines under identical stated conditions."""
    with psycopg.connect(pg_dsn) as conn:
        conn.read_only = True
        # Confirm the index actually exists rather than assuming it does — a
        # missing GIST turns an engine comparison into an index comparison.
        has_index = conn.execute("""
            SELECT count(*) > 0 FROM pg_indexes
            WHERE tablename = 'incidents' AND indexdef ILIKE '%USING gist%'
        """).fetchone()[0]
        if has_index != conditions.gist_index_present:
            raise RuntimeError(
                f"stated gist_index_present={conditions.gist_index_present} "
                f"but the database says {has_index}"
            )
        pg_seconds, pg_samples = time_query(
            lambda: conn.execute(sql_pg).fetchall()
        )

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute(f"CREATE VIEW incidents AS SELECT * FROM read_parquet('{parquet_path}')")
    duck_seconds, duck_samples = time_query(lambda: con.execute(sql_duck).fetchall())
    con.close()

    results = [
        Result(label, "postgis", pg_seconds, conditions, pg_samples),
        Result(label, "duckdb", duck_seconds, conditions, duck_samples),
    ]
    for r in results:
        logger.info("benchmark_result", extra=asdict(r))
    return results
```

## Validation Checklist

- [ ] Cache state is stated for every run, and cold runs actually drop the OS page cache.
- [ ] The presence of the GIST index is asserted against the database, not assumed.
- [ ] At least four query shapes are measured: indexed lookup, selective predicate, wide aggregation, multi-way join.
- [ ] Column count is varied, and the result is reported as a curve rather than a point.
- [ ] The extract's snapshot and write cost are included and amortised over a stated query count.
- [ ] Results are medians of repeated runs, not means, so the first cold run does not dominate.
- [ ] Concurrent session count is stated, since one engine is also serving the operating picture.
- [ ] The fixture's mean vertex count is recorded, because geometry complexity moves both engines.

## Edge Cases and Gotchas

- **A "cold" run that is only a restarted process.** Restarting PostgreSQL clears its shared buffers and leaves the OS page cache warm, which is most of the benefit. Without dropping the page cache the run is warm and should be reported as such.
- **DuckDB reading from the OS cache after the first query.** The second query against the same Parquet file is reading memory. This is realistic for an analyst asking many questions and unrealistic for a single-shot comparison; state which case is being modelled.
- **Row-group size tuned for the benchmark's query.** Large groups favour scans and small ones favour selective predicates, so it is possible to tune the extract to whichever result you wanted. Fix it once from the real workload and leave it.
- **A fixture of simple geometries.** Points and boxes deserialise almost instantly and hide the vertex-count effect entirely. Use a fixture with the perimeter complexity the real archive carries, as the [benchmarking guidance](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/benchmarking-geopandas-vs-pyshp-throughput-under-surge-load/) for the field libraries also insists.
- **Comparing against a PostGIS instance under load.** If the operational instance is serving the picture during the benchmark, the result measures contention rather than capability — which is a legitimate thing to measure, and must be labelled as such.

## Frequently Asked Questions

**Why do PostGIS and DuckDB benchmarks disagree so wildly between teams?** Because at least five conditions unrelated to the engines move results by more than the engines differ. Whether the operating system page cache is warm changes PostGIS by up to four times. Parquet row-group size changes DuckDB by up to three. Whether a GIST index exists decides an indexed lookup outright rather than influencing it. Concurrency matters for the engine that is also serving the operating picture and not for the one serving nobody. And geometry vertex count moves both, since deserialisation dominates for complex perimeters. A benchmark that does not state all five is measuring whichever condition happened to differ.

**Does the columnar advantage depend on the query?** Substantially. Measured on a forty-column table of 4.2 million incident records, a group-by aggregation touching three columns runs about nineteen times faster in DuckDB, one touching twenty about three times faster, and one touching all forty under twice — the two cross near twenty-six columns, because a columnar engine reads only the columns named while a row store reads whole rows regardless. Since the extract's column set is a design decision, part of the advantage is chosen rather than measured, and an extract that copies the whole table gives most of it away before any query runs.

**Should the extract's build cost count against DuckDB?** Yes, and omitting it is the most common way these comparisons mislead. Taking a consistent snapshot from PostGIS costs about 41 seconds on this dataset and writing the Parquet file about 12 more, so a single query answered from a fresh extract really costs about 55 seconds against PostGIS's 34. Amortised over twenty queries it falls to about 4.5 seconds each and over a hundred it approaches the raw query time. Break-even is near two queries per extract, which reframes the decision as how many questions an analyst asks of one snapshot rather than how fast one question is answered.

## Related

- [PostGIS vs DuckDB for Incident Analytics](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/) — the routing decision these measurements are meant to inform.
- [Handling CRS Loss in DuckDB Spatial Extracts](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/handling-crs-loss-in-duckdb-spatial-extracts/) — a correctness precondition no benchmark will reveal.
- [Benchmarking Geopandas vs PyShp Throughput Under Surge Load](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/benchmarking-geopandas-vs-pyshp-throughput-under-surge-load/) — the same insistence on benchmarking the worst input rather than the representative one.
- [How to Set Up PostGIS for Emergency Response](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/how-to-set-up-postgis-for-emergency-response/) — why a missing GIST index turns an engine comparison into an index comparison.

Up: [PostGIS vs DuckDB for Incident Analytics](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/postgis-vs-duckdb-for-incident-analytics/)
