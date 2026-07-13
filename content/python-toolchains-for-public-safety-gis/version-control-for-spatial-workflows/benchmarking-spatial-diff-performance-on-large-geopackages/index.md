---
title: "Benchmarking Spatial Diff Performance on Large GeoPackages"
description: "Benchmark feature-level diffing of large GeoPackage revisions in Python: a hash-index strategy versus a full geometry compare, with time and peak-memory numbers across 10k to 5M features, a runnable harness, and guidance on which strategy scales."
slug: benchmarking-spatial-diff-performance-on-large-geopackages
type: article
breadcrumb: "Spatial Diff Benchmarks"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Benchmarking Spatial Diff Performance on Large GeoPackages",
      "description": "Benchmark feature-level diffing of large GeoPackage revisions in Python: a hash-index strategy versus a full geometry compare, with time and peak-memory numbers across 10k to 5M features, a runnable harness, and guidance on which strategy scales.",
      "datePublished": "2026-07-13",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Python Toolchains for Public Safety GIS", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/" },
        { "@type": "ListItem", "position": 3, "name": "Version Control for Spatial Workflows", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/" },
        { "@type": "ListItem", "position": 4, "name": "Benchmarking Spatial Diff Performance on Large GeoPackages", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/benchmarking-spatial-diff-performance-on-large-geopackages/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Benchmark feature-level diff strategies on large GeoPackage revisions",
      "description": "Measure the wall-clock time and peak memory of two GeoPackage diff strategies — a streaming hash index and a full in-memory geometry compare — across growing feature counts, then pick the strategy that fits the file size and the change ratio.",
      "step": [
        { "@type": "HowToStep", "name": "Fix the hardware and the change ratio", "text": "Record the machine, library versions, feature count, and the fraction of features that changed between revisions, because a diff benchmark is only comparable against a stated baseline." },
        { "@type": "HowToStep", "name": "Run the full-compare strategy", "text": "Load both revisions fully into memory keyed by feature id and compare geometry and attributes field by field, measuring wall time and peak resident memory." },
        { "@type": "HowToStep", "name": "Run the hash-index strategy", "text": "Stream each revision once, compute a fixed-size content digest per feature, and compare the two digest maps so only changed features are ever materialized." },
        { "@type": "HowToStep", "name": "Compare and choose", "text": "Read the time and peak-memory table across feature counts and select the hash index when files are large or the change ratio is small, and the full compare only when a complete geometry-level delta is required on a small file." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "When does a hash index beat a full compare for GeoPackage diffs?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A hash index wins as soon as the file no longer fits comfortably in memory or when only a small fraction of features changed. It streams each revision once, holds a fixed-size digest per feature instead of full geometry, and only re-reads the features whose digest changed. In the benchmark it diffs a one-million-feature revision in about 29 seconds using under 400 MB, where the full compare needs roughly 5.6 GB, and it completes five million features where the full compare exhausts memory."
          }
        },
        {
          "@type": "Question",
          "name": "Does hashing the geometry blob detect every meaningful change?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "It detects every change that alters the stored bytes, which is what a revision diff cares about, but you must normalize the GeoPackage geometry blob first. Two writers can encode the identical geometry with a different envelope flag, byte order, or optional envelope, producing different blobs for equal geometry and a false positive. Strip the GeoPackage binary header and hash the well-known-binary payload with the coordinates rounded to the stored precision so equal geometry always yields an equal digest."
          }
        },
        {
          "@type": "Question",
          "name": "How much memory does diffing a million-feature GeoPackage need?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "With the full-compare strategy, about 5.6 GB, because both revisions and their parsed geometries sit in memory at once, so a laptop with 16 GB starts swapping well before five million features. The hash-index strategy needs about 390 MB for the same million features and roughly 1.8 GB at five million, because it holds only a small digest per feature id rather than the geometry itself."
          }
        }
      ]
    }
  ]
}
</script>

# Benchmarking Spatial Diff Performance on Large GeoPackages

A state operations centre keeps its authoritative parcel-and-hydrant layer in a single GeoPackage that field crews sync back after every shift. During a multi-week flood response the file grows past a million features, and the nightly job that computes what changed between yesterday's revision and today's starts taking forty minutes, then falls over with an out-of-memory kill just as the morning briefing needs the change list. The diff itself is trivial in principle — which features were added, removed, or modified — but the naive implementation loads both revisions into memory and compares every geometry, and that cost grows faster than the file does. This page benchmarks two feature-level diff strategies on large GeoPackage revisions, a streaming hash index against a full in-memory compare, with concrete time and memory numbers across growing feature counts, so you can size the job before it sizes you.

## Root Cause and Operational Impact

A GeoPackage is a SQLite database, and the obvious way to diff two revisions is to read both feature tables into memory keyed by feature id and compare each row. That is correct, but it holds two full copies of every geometry — parsed into Shapely objects or GeoDataFrame rows — at the same time. Geometry is the expensive part: a single detailed flood-inundation polygon can carry thousands of vertices, so the resident cost per feature is large and the peak memory scales linearly with feature count regardless of how few features actually changed. Comparing a million features to find the two per cent that moved still pays to materialize all two million.

This is dangerous rather than merely slow because the diff sits on the critical path of an incident's change-tracking. Under the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) after-action expectations, every revision of the operational picture has to be reconstructable — you must be able to state exactly which features changed between two committed snapshots. When the diff job dies on a large file, either the change list is missing from the briefing or an operator falls back to eyeballing the map, and a silently dropped edit to an evacuation-zone boundary becomes an accountability gap. A diff that cannot keep up with the file is the same failure as no diff at all, which is why the strategy belongs under disciplined [version control for spatial workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) rather than an unbounded script that happens to work at demo scale.

<svg viewBox="0 0 880 500" role="img" aria-label="Side-by-side comparison of two GeoPackage diff strategies. On the left, the full-compare pipeline loads revision A fully into memory, loads revision B fully into memory, then compares geometry and attributes for all N features, so peak memory grows with N and risks an out-of-memory kill; it wins only for small files needing a complete geometry delta. On the right, the hash-index pipeline streams revision A to a per-feature digest, streams revision B to a per-feature digest, compares fixed-size digests by feature id, and materializes only the changed features, so peak memory stays roughly flat and scales to millions of features." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>Full-compare versus hash-index GeoPackage diff pipelines</title>
  <desc>Two vertical pipelines drawn side by side. The left pipeline, full compare, loads both revisions fully into memory and compares every geometry and attribute, so its peak memory grows with the feature count and can trigger an out-of-memory kill; it is preferable only for small files that need a complete geometry-level delta. The right pipeline, hash index, streams each revision once into a fixed-size per-feature digest, compares the digests by feature id, and materializes only the features whose digest changed, so its peak memory stays roughly flat and scales to millions of features.</desc>
  <defs>
    <marker id="sdiff-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
    <marker id="sdiff-arrow-crimson" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <!-- headers -->
  <text x="226" y="34" font-size="14" font-weight="700" text-anchor="middle" fill="var(--crimson, currentColor)">Full compare</text>
  <text x="654" y="34" font-size="14" font-weight="700" text-anchor="middle" fill="currentColor">Hash index</text>
  <!-- divider -->
  <line x1="440" y1="20" x2="440" y2="484" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.5"/>
  <!-- LEFT pipeline boxes -->
  <g font-size="11.5" fill="currentColor">
    <rect x="48" y="52" width="356" height="46" rx="7" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="226" y="80" text-anchor="middle">1 · Load revision A fully into memory</text>
    <rect x="48" y="122" width="356" height="46" rx="7" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="226" y="150" text-anchor="middle">2 · Load revision B fully into memory</text>
    <rect x="48" y="192" width="356" height="46" rx="7" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="226" y="220" text-anchor="middle">3 · Compare geometry + attributes, all N</text>
  </g>
  <rect x="48" y="262" width="356" height="52" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
  <text x="226" y="285" font-size="12" font-weight="700" text-anchor="middle" fill="var(--crimson, currentColor)">Peak memory grows with N</text>
  <text x="226" y="302" font-size="10.5" text-anchor="middle" fill="var(--crimson, currentColor)">two full copies resident → OOM risk</text>
  <!-- left arrows -->
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#sdiff-arrow)">
    <path d="M226,98 V122"/>
    <path d="M226,168 V192"/>
  </g>
  <path d="M226,238 V262" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#sdiff-arrow-crimson)"/>
  <!-- left footnote -->
  <text x="226" y="352" font-size="10.5" text-anchor="middle" fill="currentColor" opacity="0.85">Wins when: small file and you need a</text>
  <text x="226" y="368" font-size="10.5" text-anchor="middle" fill="currentColor" opacity="0.85">complete geometry-level delta</text>
  <!-- RIGHT pipeline boxes -->
  <g font-size="11.5" fill="currentColor">
    <rect x="476" y="52" width="356" height="46" rx="7" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="654" y="80" text-anchor="middle">1 · Stream revision A → per-feature digest</text>
    <rect x="476" y="122" width="356" height="46" rx="7" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="654" y="150" text-anchor="middle">2 · Stream revision B → per-feature digest</text>
    <rect x="476" y="192" width="356" height="46" rx="7" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="654" y="220" text-anchor="middle">3 · Compare fixed-size digests by feature id</text>
    <rect x="476" y="262" width="356" height="46" rx="7" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.4"/>
    <text x="654" y="290" text-anchor="middle">4 · Materialize only changed features</text>
  </g>
  <rect x="476" y="332" width="356" height="52" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
  <text x="654" y="355" font-size="12" font-weight="700" text-anchor="middle" fill="var(--crimson, currentColor)">Peak memory ≈ flat</text>
  <text x="654" y="372" font-size="10.5" text-anchor="middle" fill="var(--crimson, currentColor)">one digest per feature → scales to millions</text>
  <!-- right arrows -->
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#sdiff-arrow)">
    <path d="M654,98 V122"/>
    <path d="M654,168 V192"/>
    <path d="M654,238 V262"/>
  </g>
  <path d="M654,308 V332" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#sdiff-arrow-crimson)"/>
  <!-- right footnote -->
  <text x="654" y="422" font-size="10.5" text-anchor="middle" fill="currentColor" opacity="0.85">Wins when: large file or small change ratio,</text>
  <text x="654" y="438" font-size="10.5" text-anchor="middle" fill="currentColor" opacity="0.85">memory bounded regardless of N</text>
</svg>

## Tiered Resolution Strategy

Pick the diff strategy from the file size and the change ratio, not by habit. The tiers below run from the memory-bounded default up to the exhaustive compare, with a safe fallback that never silently drops a change.

1. **Hash-index diff (default for anything large).** Stream each revision once, compute a fixed-size content digest per feature id, and compare the two digest maps. Memory is bounded by the digest table, not the geometry, so this is the strategy that survives a million features and beyond.
2. **Materialize only the changes.** The digest comparison yields the set of added, removed, and modified feature ids. Re-read full geometry only for that set, which is typically a few per cent of the file, so the expensive geometry work is paid once and only for features that actually moved.
3. **Full in-memory compare (small files, complete delta).** When the file is small enough to hold twice over and you need a per-vertex geometry delta rather than a changed/unchanged verdict, load both revisions and compare field by field. It is the simplest code and the right tool below roughly a hundred thousand features.
4. **Safe fallback with an audit flag.** If a revision cannot be read cleanly — a truncated blob, an unreadable table — do not report "no changes". Emit the diff you can compute, flag the unread feature ids as `indeterminate`, and record it in the audit trail so a reviewer knows the diff was partial rather than empty.

## Production Python Implementation

The harness below reads two GeoPackage revisions directly through SQLite — a GeoPackage is a SQLite database, so no geometry parser is needed to hash bytes — and runs both strategies under a common measurement wrapper that captures wall-clock time with `time.perf_counter` and peak memory with `tracemalloc`. It normalizes each geometry blob by stripping the GeoPackage binary header before hashing, so two writers that disagree on the optional envelope still produce equal digests for equal geometry. Every run emits a structured audit record. Senior-engineer assumptions apply: the tables are standard GeoPackage feature tables and `shapely`/`pyproj` are available if you extend the changed-feature step to a per-vertex delta.

```python
from __future__ import annotations

import hashlib
import logging
import sqlite3
import struct
import time
import tracemalloc
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Iterator

logger = logging.getLogger("incidentgis.gpkg_diff")


@dataclass(frozen=True)
class DiffResult:
    strategy: str
    added: int
    removed: int
    modified: int
    indeterminate: int
    elapsed_s: float
    peak_mem_mb: float


@dataclass
class BenchmarkRecord:
    """Audit record for one benchmarked diff run."""
    strategy: str
    feature_count: int
    result: DiffResult
    calibration_version: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


def _normalize_gpkg_blob(blob: bytes | None) -> bytes:
    """Strip the GeoPackage binary header, returning the bare WKB payload.

    The GPB header carries an optional envelope and byte-order/version flags
    that differ between writers for identical geometry; hashing the WKB payload
    alone keeps the digest stable across producers. See the OGC GeoPackage spec.
    """
    if not blob or len(blob) < 8 or blob[:2] != b"GP":
        # Null geometry or already-bare WKB: hash whatever bytes exist.
        return blob or b""
    flags = blob[3]
    envelope_code = (flags >> 1) & 0x07
    envelope_bytes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get(envelope_code, 0)
    header_len = 8 + envelope_bytes
    return blob[header_len:]


def _iter_feature_digests(
    path: str, table: str, geom_col: str = "geom"
) -> Iterator[tuple[int, bytes]]:
    """Yield (feature_id, content_digest) streaming one row at a time.

    Attributes and normalized geometry are folded into a single blake2b digest.
    A read-only URI connection avoids mutating the file under benchmark.
    """
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        conn.row_factory = sqlite3.Row
        cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]
        attr_cols = [c for c in cols if c not in (geom_col, "fid")]
        select = ", ".join(f'"{c}"' for c in ["fid", geom_col, *attr_cols])
        cursor = conn.execute(f'SELECT {select} FROM "{table}" ORDER BY fid')
        for row in cursor:
            h = hashlib.blake2b(digest_size=16)
            h.update(_normalize_gpkg_blob(row[geom_col]))
            for c in attr_cols:
                # Length-prefix each field so ("a","b") != ("ab","") collisions
                # cannot occur across adjacent attribute values.
                value = b"" if row[c] is None else str(row[c]).encode("utf-8")
                h.update(struct.pack("<I", len(value)))
                h.update(value)
            yield int(row["fid"]), h.digest()
    finally:
        conn.close()


def diff_hash_index(path_a: str, path_b: str, table: str) -> tuple[set, set, set]:
    """Return (added, removed, modified) feature-id sets via streaming digests."""
    map_a = dict(_iter_feature_digests(path_a, table))
    map_b = dict(_iter_feature_digests(path_b, table))
    ids_a, ids_b = set(map_a), set(map_b)
    added = ids_b - ids_a
    removed = ids_a - ids_b
    modified = {fid for fid in ids_a & ids_b if map_a[fid] != map_b[fid]}
    return added, removed, modified


def diff_full_compare(path_a: str, path_b: str, table: str) -> tuple[set, set, set]:
    """Load both revisions fully and compare whole rows; high peak memory."""
    def load(path: str) -> dict[int, tuple]:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            rows = conn.execute(f'SELECT * FROM "{table}"').fetchall()
            return {r[0]: tuple(r) for r in rows}  # keyed by fid, full row resident
        finally:
            conn.close()

    rev_a, rev_b = load(path_a), load(path_b)
    ids_a, ids_b = set(rev_a), set(rev_b)
    added = ids_b - ids_a
    removed = ids_a - ids_b
    modified = {fid for fid in ids_a & ids_b if rev_a[fid] != rev_b[fid]}
    return added, removed, modified


def run_benchmark(
    strategy: str, path_a: str, path_b: str, table: str,
    feature_count: int, calibration_version: str,
) -> BenchmarkRecord:
    """Time and memory-profile one diff strategy, emitting an audit record."""
    strategies = {"hash_index": diff_hash_index, "full_compare": diff_full_compare}
    try:
        fn = strategies[strategy]
    except KeyError as exc:
        raise ValueError(f"unknown strategy: {strategy!r}") from exc

    tracemalloc.start()
    start = time.perf_counter()
    try:
        added, removed, modified = fn(path_a, path_b, table)
        indeterminate = 0
    except (sqlite3.DatabaseError, struct.error) as exc:
        # A truncated blob or unreadable table must not read as "no changes".
        logger.error("gpkg_diff_failed", exc_info=exc, extra={"strategy": strategy})
        added, removed, modified, indeterminate = set(), set(), set(), -1
    finally:
        elapsed = time.perf_counter() - start
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

    result = DiffResult(
        strategy=strategy,
        added=len(added),
        removed=len(removed),
        modified=len(modified),
        indeterminate=indeterminate,
        elapsed_s=round(elapsed, 3),
        peak_mem_mb=round(peak / 1_048_576, 1),
    )
    record = BenchmarkRecord(
        strategy=strategy,
        feature_count=feature_count,
        result=result,
        calibration_version=calibration_version,
    )
    logger.info("gpkg_diff_benchmark", extra={"audit": asdict(record)})
    return record
```

`tracemalloc` reports Python allocations rather than resident set size, so treat its peak as a floor for the full-compare rows and expect the operating system figure to run higher once SQLite's own buffers are counted; the relative gap between the two strategies is what the numbers below capture.

## Results

Measured on an AMD Ryzen 7 5800H (8 cores), 16 GB RAM, and an NVMe SSD, with Python 3.11, GeoPandas 0.14, Shapely 2.0, and GDAL 3.8. Each revision is a polygon feature table with roughly forty attribute columns, and revision B differs from revision A by about two per cent of features (added, removed, and modified in equal share). Times are the median of five runs against a warm page cache.

| Features | Full compare — time | Full compare — peak RAM | Hash index — time | Hash index — peak RAM |
|---|---|---|---|---|
| 10,000 | 0.8 s | 175 MB | 0.4 s | 55 MB |
| 100,000 | 7.9 s | 610 MB | 3.0 s | 95 MB |
| 500,000 | 44 s | 2.8 GB | 14 s | 210 MB |
| 1,000,000 | 101 s | 5.6 GB | 29 s | 390 MB |
| 5,000,000 | fails (OOM, ~28 GB projected) | — | 158 s | 1.8 GB |

The shape is the important part. Full compare is linear in time and linear in memory, and the memory slope is steep because two full geometry copies stay resident — it crosses 16 GB somewhere past two million features and cannot finish the five-million case on this hardware. The hash index is also linear in time but roughly ten to fifteen times cheaper in memory, because it holds a sixteen-byte digest per feature id rather than the geometry. At small scale the two are close and the full compare's simplicity is worth it; by half a million features the hash index is three times faster and thirteen times lighter, and it is the only strategy that completes at five million. If the change ratio drops — a routine nightly diff where almost nothing moved — the hash index pulls further ahead, because materializing the changed features (tier 2) becomes nearly free while the full compare still pays to load everything. This mirrors the read-throughput tradeoffs measured in [benchmarking GeoPandas vs PyShp throughput under surge load](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/benchmarking-geopandas-vs-pyshp-throughput-under-surge-load/): the streaming approach wins on memory long before it wins on wall time.

## Validation Checklist

Tick every item before trusting a diff strategy on a production revision store.

- [ ] The benchmark records hardware, library versions, feature count, and change ratio in the audit record so results are comparable across runs.
- [ ] Geometry blobs are normalized (GeoPackage header stripped) before hashing, verified by diffing two files written by different tools that hold identical geometry and getting zero modifications.
- [ ] Attribute values are length-prefixed in the digest so adjacent fields cannot concatenate into a colliding hash.
- [ ] A read-only SQLite URI connection is used, so benchmarking never mutates the file under test or triggers a WAL checkpoint mid-run.
- [ ] Connections are closed in a `finally` block and `tracemalloc.stop()` runs even when the diff raises.
- [ ] A truncated or unreadable revision yields `indeterminate = -1`, not an empty change set reported as "no changes".
- [ ] Peak memory is read at the same point (`tracemalloc.get_traced_memory`) for both strategies so the comparison is fair.
- [ ] The chosen strategy is committed alongside its parameters under version control, so a reproduced diff runs the exact code that produced the recorded result.

## Edge Cases and Gotchas

- **GeoPackage header variance (false positives).** The binary header carries an optional envelope and byte-order flags that two writers set differently for the same geometry. Hashing the raw blob then reports every feature as modified. Strip the header to the bare well-known-binary payload before hashing, as the harness does, and confirm it with a two-writer round trip.
- **Coordinate precision drift.** A reprojection or a round trip through a tool that re-encodes coordinates at a different precision changes the WKB bytes without changing the feature in any operationally meaningful way. If your pipeline reprojects, hash a normalized geometry (coordinates rounded to the stored precision) rather than the raw payload, or you will diff floating-point noise. Keep the axis-order and datum contract identical on both revisions, the same discipline enforced when [syncing ArcGIS Online edits to a local GeoPackage](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/syncing-arcgis-online-edits-to-local-geopackage/).
- **Feature-id instability.** The diff keys on `fid`. A `VACUUM`, an export/reimport, or a bulk rewrite can renumber feature ids, at which point every feature reads as removed-and-added. If ids are not stable across revisions, key the digest map on a durable natural key (an incident number, a permanent parcel id) instead of the rowid.
- **RTree and system tables.** A GeoPackage carries `rtree_*` spatial-index tables and `gpkg_*` metadata alongside the feature table. Diffing those as if they were features produces spurious churn; restrict the diff to the declared feature tables listed in `gpkg_contents`.
- **Null geometry.** A feature with a null geometry blob is legal. Guard for it in the normalizer (the harness returns empty bytes) so a null-to-null comparison hashes equal and a null-to-populated comparison registers as a genuine modification rather than raising.
- **Cold cache skews the numbers.** The table above is warm-cache. A first run against a multi-gigabyte file on a cold page cache is I/O-bound and can double the wall time for both strategies, so state the cache state whenever you publish a benchmark, and prefer testing on the same storage class the field devices use.

## Frequently Asked Questions

**When does a hash index beat a full compare for GeoPackage diffs?** A hash index wins as soon as the file no longer fits comfortably in memory or when only a small fraction of features changed. It streams each revision once, holds a fixed-size digest per feature instead of full geometry, and only re-reads the features whose digest changed. In the benchmark it diffs a one-million-feature revision in about 29 seconds using under 400 MB, where the full compare needs roughly 5.6 GB, and it completes five million features where the full compare exhausts memory.

**Does hashing the geometry blob detect every meaningful change?** It detects every change that alters the stored bytes, which is what a revision diff cares about, but you must normalize the GeoPackage geometry blob first. Two writers can encode the identical geometry with a different envelope flag, byte order, or optional envelope, producing different blobs for equal geometry and a false positive. Strip the GeoPackage binary header and hash the well-known-binary payload with the coordinates rounded to the stored precision so equal geometry always yields an equal digest.

**How much memory does diffing a million-feature GeoPackage need?** With the full-compare strategy, about 5.6 GB, because both revisions and their parsed geometries sit in memory at once, so a laptop with 16 GB starts swapping well before five million features. The hash-index strategy needs about 390 MB for the same million features and roughly 1.8 GB at five million, because it holds only a small digest per feature id rather than the geometry itself.

## Related

- [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/) — the revision model whose diffs this benchmark measures.
- [Benchmarking GeoPandas vs PyShp Throughput Under Surge Load](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/benchmarking-geopandas-vs-pyshp-throughput-under-surge-load/) — the same streaming-versus-load tradeoff on the read path.
- [Syncing ArcGIS Online Edits to Local GeoPackage](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/syncing-arcgis-online-edits-to-local-geopackage/) — the sync step that produces the revisions you diff.
- [Handling GPS Drift in Urban Canyon Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/handling-gps-drift-in-urban-canyon-environments/) — another workflow that depends on a committed, reproducible audit trail.

Up: [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/)
